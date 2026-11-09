-- Edital em Dia / Habits: banco na nuvem protegido por PIN + palavra de seguranca.
-- Rode este arquivo inteiro no SQL Editor do projeto do Supabase.
-- Pode rodar de novo a qualquer momento: ele atualiza as funcoes e ajusta as tabelas
-- sem apagar nenhum PIN, palavra nem dados.
--
-- Como funciona:
--  * As tabelas ficam trancadas (RLS ligado, sem nenhuma policy). A chave publica
--    do app nao consegue ler nem gravar nada nelas diretamente.
--  * Os apps so falam com 4 funcoes: entrar, ler_estado, salvar_estado e sair.
--  * Pode haver varias CONTAS (uma por pessoa). Cada conta tem o seu PIN + palavra e os
--    seus proprios dados. Quem entra com o PIN + palavra de uma conta so enxerga os dados dela.
--  * Dentro de uma conta, cada app guarda os seus dados separados, pelo nome
--    (ex.: 'estudos', 'habits').
--  * O PIN e a palavra ficam guardados so como hash (bcrypt), nunca em texto.
--  * 5 erros seguidos (em qualquer conta) bloqueiam novas tentativas por 15 minutos.
--  * Sessao sem prazo fixo: cada uso renova. Depois de 48h sem nenhum acesso ela
--    deixa de valer e o app pede o PIN de novo.
--  * Criar ou trocar o acesso de uma conta: 2-definir-pin.sql.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------- Tabelas ----------
-- Tentativas erradas de login (uma contagem so, valendo para todas as contas).
create table if not exists public.bloqueio (
  id            int primary key default 1 check (id = 1),
  falhas        int not null default 0,
  bloqueado_ate timestamptz
);
insert into public.bloqueio (id) values (1) on conflict do nothing;

-- Uma linha por conta (pessoa).
create table if not exists public.acesso (
  id           int primary key,
  nome         text not null,
  pin_hash     text not null,
  palavra_hash text not null,
  criado       timestamptz not null default now()
);
-- bancos criados quando so existia uma conta (id fixo em 1, contador de erros na propria linha)
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.acesso'::regclass and contype = 'c' loop
    execute format('alter table public.acesso drop constraint %I', c.conname);
  end loop;
  alter table public.acesso alter column id drop default;
  alter table public.acesso add column if not exists nome text;
  update public.acesso set nome = 'principal' where nome is null;
  alter table public.acesso alter column nome set not null;
  alter table public.acesso add column if not exists criado timestamptz not null default now();
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'acesso' and column_name = 'falhas') then
    update public.bloqueio b set falhas = a.falhas, bloqueado_ate = a.bloqueado_ate
      from (select falhas, bloqueado_ate from public.acesso order by id limit 1) a;
    alter table public.acesso drop column falhas, drop column bloqueado_ate;
  end if;
end $$;
create unique index if not exists acesso_nome_unico on public.acesso (lower(btrim(nome)));

create table if not exists public.sessoes (
  token_hash    text primary key,
  conta         int not null references public.acesso (id) on delete cascade,
  criado        timestamptz not null default now(),
  ultimo_acesso timestamptz not null default now()
);
-- bancos de versoes anteriores: coluna do ultimo uso (antes a sessao durava 30 dias) e a conta dona da sessao
alter table public.sessoes add column if not exists ultimo_acesso timestamptz not null default now();
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'sessoes' and column_name = 'conta') then
    alter table public.sessoes add column conta int;
    update public.sessoes set conta = (select min(id) from public.acesso);   -- as sessoes antigas eram da unica conta
    delete from public.sessoes where conta is null;                          -- (sem conta nenhuma, sessao nao serve)
    alter table public.sessoes alter column conta set not null;
    alter table public.sessoes add constraint sessoes_conta_fk foreign key (conta) references public.acesso (id) on delete cascade;
  end if;
end $$;

create table if not exists public.estado (
  conta      int not null references public.acesso (id) on delete cascade,
  app        text not null,
  dados      jsonb not null,
  versao     int not null default 1,
  atualizado timestamptz not null default now(),
  primary key (conta, app)
);
do $$
declare pk text;
begin
  -- bancos criados quando so existia um app (coluna "id"): os dados viram o app 'estudos'
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'estado' and column_name = 'id') then
    alter table public.estado add column if not exists app text;
    update public.estado set app = 'estudos' where app is null;
    alter table public.estado drop column id;
    alter table public.estado alter column app set not null;
  end if;
  -- bancos criados quando so existia uma conta: os dados ficam com essa conta
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'estado' and column_name = 'conta') then
    if exists (select 1 from public.estado) and not exists (select 1 from public.acesso) then
      raise exception 'Ha dados salvos mas nenhuma conta. Crie o acesso primeiro (2-definir-pin.sql) e rode este arquivo de novo.';
    end if;
    alter table public.estado add column conta int;
    update public.estado set conta = (select min(id) from public.acesso);
    alter table public.estado alter column conta set not null;
    select conname into pk from pg_constraint where conrelid = 'public.estado'::regclass and contype = 'p';
    if pk is not null then execute format('alter table public.estado drop constraint %I', pk); end if;
    alter table public.estado add primary key (conta, app);
    alter table public.estado add constraint estado_conta_fk foreign key (conta) references public.acesso (id) on delete cascade;
  end if;
end $$;

alter table public.bloqueio enable row level security;
alter table public.acesso   enable row level security;
alter table public.sessoes  enable row level security;
alter table public.estado   enable row level security;
revoke all on public.bloqueio, public.acesso, public.sessoes, public.estado from anon, authenticated;

-- ---------- Funcoes internas (o app nao enxerga) ----------
create or replace function public._norm(t text) returns text
language sql stable set search_path = public, extensions, pg_temp as $$
  select lower(regexp_replace(extensions.unaccent(btrim(coalesce(t, ''))), '\s+', ' ', 'g'))
$$;

-- Sessao valida = usada nas ultimas 48h. Devolve a conta dona da sessao (ou nulo se nao vale).
-- Cada chamada valida renova o prazo.
drop function if exists public._sessao_ok(text);
create function public._sessao_ok(p_token text) returns int
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_conta int;
begin
  update public.sessoes set ultimo_acesso = now()
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and ultimo_acesso > now() - interval '48 hours'
  returning conta into v_conta;
  return v_conta;
end $$;

-- Cria ou troca o acesso de uma conta. Rode so pelo SQL Editor (2-definir-pin.sql).
--   p_nome   = nome da conta, so para voce se achar (ex.: o nome da pessoa)
--   p_pin    = 4 a 12 numeros
--   p_palavra = palavra de seguranca
-- Nome novo cria uma conta nova (com dados vazios). Nome que ja existe troca o PIN e a palavra dessa conta
-- (os dados dela ficam) e desconecta os aparelhos dela. As outras contas nao sao tocadas.
drop function if exists public.definir_acesso(text, text);   -- versao de uma conta so
create or replace function public.definir_acesso(p_nome text, p_pin text, p_palavra text) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare n text := lower(btrim(coalesce(p_nome, ''))); v int;
begin
  if n = '' then
    raise exception 'De um nome para a conta (ex.: o nome da pessoa).';
  end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4,12}$' then
    raise exception 'O PIN precisa ter de 4 a 12 numeros.';
  end if;
  if length(public._norm(p_palavra)) < 3 then
    raise exception 'A palavra de seguranca precisa ter pelo menos 3 letras.';
  end if;
  lock table public.acesso in exclusive mode;
  select id into v from public.acesso where lower(btrim(nome)) = n;
  -- no login o par PIN + palavra identifica a conta, entao ele nao pode ser igual ao de outra conta
  if exists (select 1 from public.acesso a
             where a.id is distinct from v
               and a.pin_hash = extensions.crypt(p_pin, a.pin_hash)
               and a.palavra_hash = extensions.crypt(public._norm(p_palavra), a.palavra_hash)) then
    raise exception 'Esse PIN com essa palavra ja e de outra conta. Troque a palavra ou o PIN.';
  end if;
  if v is null then
    select coalesce(max(id), 0) + 1 into v from public.acesso;
    insert into public.acesso (id, nome, pin_hash, palavra_hash)
    values (v, btrim(p_nome), extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
                              extensions.crypt(public._norm(p_palavra), extensions.gen_salt('bf', 10)));
  else
    update public.acesso
       set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
           palavra_hash = extensions.crypt(public._norm(p_palavra), extensions.gen_salt('bf', 10))
     where id = v;
    delete from public.sessoes where conta = v;  -- trocar o PIN desconecta os aparelhos dessa conta
  end if;
  update public.bloqueio set falhas = 0, bloqueado_ate = null where id = 1;
  return 'ok';
end $$;

-- ---------- Funcoes que o app usa ----------
create or replace function public.entrar(p_pin text, p_palavra text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  b public.bloqueio%rowtype;
  a record;
  ok_pin boolean; ok_pal boolean; v_conta int := null; tok text; nf int;
  pal text := public._norm(p_palavra);
begin
  select * into b from public.bloqueio where id = 1 for update;   -- uma tentativa por vez
  if not exists (select 1 from public.acesso) then
    return jsonb_build_object('ok', false, 'erro', 'nao_configurado');
  end if;
  if b.bloqueado_ate is not null and b.bloqueado_ate > now() then
    return jsonb_build_object('ok', false, 'erro', 'bloqueado',
      'minutos', ceil(extract(epoch from (b.bloqueado_ate - now())) / 60));
  end if;

  -- confere todas as contas e os dois valores sempre, para nao revelar qual existe nem qual errou
  for a in select id, pin_hash, palavra_hash from public.acesso order by id loop
    ok_pin := a.pin_hash = extensions.crypt(coalesce(p_pin, ''), a.pin_hash);
    ok_pal := a.palavra_hash = extensions.crypt(pal, a.palavra_hash);
    if ok_pin and ok_pal and v_conta is null then v_conta := a.id; end if;
  end loop;

  if v_conta is not null then
    update public.bloqueio set falhas = 0, bloqueado_ate = null where id = 1;
    delete from public.sessoes where ultimo_acesso < now() - interval '48 hours';
    tok := encode(extensions.gen_random_bytes(32), 'hex');
    insert into public.sessoes (token_hash, conta) values (encode(extensions.digest(tok, 'sha256'), 'hex'), v_conta);
    return jsonb_build_object('ok', true, 'token', tok, 'conta', v_conta);
  end if;

  -- Importante: erro volta como resultado normal (nao como excecao),
  -- senao o contador de falhas seria desfeito junto com a transacao.
  nf := b.falhas + 1;
  if nf >= 5 then
    update public.bloqueio set falhas = 0, bloqueado_ate = now() + interval '15 minutes' where id = 1;
    return jsonb_build_object('ok', false, 'erro', 'bloqueado', 'minutos', 15);
  end if;
  update public.bloqueio set falhas = nf where id = 1;
  return jsonb_build_object('ok', false, 'erro', 'incorreto', 'restantes', 5 - nf);
end $$;

-- versoes antigas (um app so) tinham outra assinatura: saem de cena para nao haver duas funcoes com o mesmo nome
drop function if exists public.ler_estado(text);
drop function if exists public.salvar_estado(text, jsonb, int, boolean);

create or replace function public.ler_estado(p_token text, p_app text default 'estudos') returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_conta int; e public.estado%rowtype;
begin
  v_conta := public._sessao_ok(p_token);
  if v_conta is null then
    return jsonb_build_object('ok', false, 'erro', 'sessao');
  end if;
  if p_app is null or p_app !~ '^[a-z0-9_-]{1,32}$' then
    return jsonb_build_object('ok', false, 'erro', 'app');
  end if;
  select * into e from public.estado where conta = v_conta and app = p_app;
  if not found then
    return jsonb_build_object('ok', true, 'existe', false);
  end if;
  return jsonb_build_object('ok', true, 'existe', true, 'versao', e.versao, 'dados', e.dados);
end $$;

-- p_base = versao que este aparelho tinha lido. Se a nuvem mudou depois disso,
-- devolve 'conflito' e o app pergunta qual lado manter (p_forcar = true sobrescreve).
create or replace function public.salvar_estado(p_token text, p_dados jsonb, p_base int, p_forcar boolean default false, p_app text default 'estudos') returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_conta int; v int;
begin
  v_conta := public._sessao_ok(p_token);
  if v_conta is null then
    return jsonb_build_object('ok', false, 'erro', 'sessao');
  end if;
  if p_app is null or p_app !~ '^[a-z0-9_-]{1,32}$' then
    return jsonb_build_object('ok', false, 'erro', 'app');
  end if;
  if p_dados is null or length(p_dados::text) > 5000000 then
    return jsonb_build_object('ok', false, 'erro', 'tamanho');
  end if;
  select versao into v from public.estado where conta = v_conta and app = p_app for update;
  if not found then
    insert into public.estado (conta, app, dados, versao) values (v_conta, p_app, p_dados, 1);
    return jsonb_build_object('ok', true, 'versao', 1);
  end if;
  if not coalesce(p_forcar, false) and (p_base is null or p_base <> v) then
    return jsonb_build_object('ok', false, 'erro', 'conflito', 'versao', v);
  end if;
  update public.estado set dados = p_dados, versao = v + 1, atualizado = now() where conta = v_conta and app = p_app;
  return jsonb_build_object('ok', true, 'versao', v + 1);
end $$;

create or replace function public.sair(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  delete from public.sessoes
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Limpeza de versoes anteriores ----------
-- (depois de trocar as funcoes acima, que nao usam mais a coluna "expira")
alter table public.sessoes drop column if exists expira;

-- ---------- Permissoes: so as 4 funcoes do app ficam abertas ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.entrar(text, text)                      to anon;
grant execute on function public.ler_estado(text, text)                  to anon;
grant execute on function public.salvar_estado(text, jsonb, int, boolean, text) to anon;
grant execute on function public.sair(text)                              to anon;

-- avisa a API do Supabase que as funcoes mudaram
notify pgrst, 'reload schema';
