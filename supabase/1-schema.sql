-- Edital em Dia: banco na nuvem protegido por PIN + palavra de seguranca.
-- Rode este arquivo inteiro no SQL Editor do projeto novo do Supabase.
-- Pode rodar de novo a qualquer momento: ele atualiza as funcoes e ajusta a tabela de
-- sessoes sem apagar o PIN, a palavra nem os dados dos estudos.
--
-- Como funciona:
--  * As tabelas ficam trancadas (RLS ligado, sem nenhuma policy). A chave publica
--    do app nao consegue ler nem gravar nada nelas diretamente.
--  * O app so fala com 4 funcoes: entrar, ler_estado, salvar_estado e sair.
--  * O PIN e a palavra ficam guardados so como hash (bcrypt), nunca em texto.
--  * 5 erros seguidos bloqueiam novas tentativas por 15 minutos.
--  * Sessao sem prazo fixo: cada uso renova. Depois de 48h sem nenhum acesso ela
--    deixa de valer e o app pede o PIN de novo.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------- Tabelas ----------
create table if not exists public.acesso (
  id            int primary key default 1 check (id = 1),
  pin_hash      text not null,
  palavra_hash  text not null,
  falhas        int not null default 0,
  bloqueado_ate timestamptz
);

create table if not exists public.sessoes (
  token_hash text primary key,
  criado     timestamptz not null default now(),
  ultimo_acesso timestamptz not null default now()
);
-- bancos criados na versao anterior (sessao de 30 dias) ganham a coluna nova
alter table public.sessoes add column if not exists ultimo_acesso timestamptz not null default now();

create table if not exists public.estado (
  id         int primary key default 1 check (id = 1),
  dados      jsonb not null,
  versao     int not null default 1,
  atualizado timestamptz not null default now()
);

alter table public.acesso  enable row level security;
alter table public.sessoes enable row level security;
alter table public.estado  enable row level security;
revoke all on public.acesso, public.sessoes, public.estado from anon, authenticated;

-- ---------- Funcoes internas (o app nao enxerga) ----------
create or replace function public._norm(t text) returns text
language sql stable set search_path = public, extensions, pg_temp as $$
  select lower(regexp_replace(extensions.unaccent(btrim(coalesce(t, ''))), '\s+', ' ', 'g'))
$$;

-- Sessao valida = usada nas ultimas 48h. Cada chamada valida renova o prazo.
create or replace function public._sessao_ok(p_token text) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare n int;
begin
  update public.sessoes set ultimo_acesso = now()
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and ultimo_acesso > now() - interval '48 hours';
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Define (ou troca) o PIN e a palavra. Rode so pelo SQL Editor (2-definir-pin.sql).
create or replace function public.definir_acesso(p_pin text, p_palavra text) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if p_pin !~ '^[0-9]{4,12}$' then
    raise exception 'O PIN precisa ter de 4 a 12 numeros.';
  end if;
  if length(public._norm(p_palavra)) < 3 then
    raise exception 'A palavra de seguranca precisa ter pelo menos 3 letras.';
  end if;
  insert into public.acesso (id, pin_hash, palavra_hash, falhas, bloqueado_ate)
  values (1, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
             extensions.crypt(public._norm(p_palavra), extensions.gen_salt('bf', 10)), 0, null)
  on conflict (id) do update
    set pin_hash = excluded.pin_hash, palavra_hash = excluded.palavra_hash,
        falhas = 0, bloqueado_ate = null;
  delete from public.sessoes;  -- trocar o PIN desconecta todos os aparelhos
  return 'ok';
end $$;

-- ---------- Funcoes que o app usa ----------
create or replace function public.entrar(p_pin text, p_palavra text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  a public.acesso%rowtype;
  ok_pin boolean; ok_pal boolean; tok text; nf int;
begin
  select * into a from public.acesso where id = 1 for update;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'nao_configurado');
  end if;
  if a.bloqueado_ate is not null and a.bloqueado_ate > now() then
    return jsonb_build_object('ok', false, 'erro', 'bloqueado',
      'minutos', ceil(extract(epoch from (a.bloqueado_ate - now())) / 60));
  end if;

  -- confere os dois sempre, para nao revelar qual deles errou
  ok_pin := a.pin_hash = extensions.crypt(coalesce(p_pin, ''), a.pin_hash);
  ok_pal := a.palavra_hash = extensions.crypt(public._norm(p_palavra), a.palavra_hash);

  if ok_pin and ok_pal then
    update public.acesso set falhas = 0, bloqueado_ate = null where id = 1;
    delete from public.sessoes where ultimo_acesso < now() - interval '48 hours';
    tok := encode(extensions.gen_random_bytes(32), 'hex');
    insert into public.sessoes (token_hash) values (encode(extensions.digest(tok, 'sha256'), 'hex'));
    return jsonb_build_object('ok', true, 'token', tok);
  end if;

  -- Importante: erro volta como resultado normal (nao como excecao),
  -- senao o contador de falhas seria desfeito junto com a transacao.
  nf := a.falhas + 1;
  if nf >= 5 then
    update public.acesso set falhas = 0, bloqueado_ate = now() + interval '15 minutes' where id = 1;
    return jsonb_build_object('ok', false, 'erro', 'bloqueado', 'minutos', 15);
  end if;
  update public.acesso set falhas = nf where id = 1;
  return jsonb_build_object('ok', false, 'erro', 'incorreto', 'restantes', 5 - nf);
end $$;

create or replace function public.ler_estado(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e public.estado%rowtype;
begin
  if not public._sessao_ok(p_token) then
    return jsonb_build_object('ok', false, 'erro', 'sessao');
  end if;
  select * into e from public.estado where id = 1;
  if not found then
    return jsonb_build_object('ok', true, 'existe', false);
  end if;
  return jsonb_build_object('ok', true, 'existe', true, 'versao', e.versao, 'dados', e.dados);
end $$;

-- p_base = versao que este aparelho tinha lido. Se a nuvem mudou depois disso,
-- devolve 'conflito' e o app pergunta qual lado manter (p_forcar = true sobrescreve).
create or replace function public.salvar_estado(p_token text, p_dados jsonb, p_base int, p_forcar boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v int;
begin
  if not public._sessao_ok(p_token) then
    return jsonb_build_object('ok', false, 'erro', 'sessao');
  end if;
  if p_dados is null or length(p_dados::text) > 5000000 then
    return jsonb_build_object('ok', false, 'erro', 'tamanho');
  end if;
  select versao into v from public.estado where id = 1 for update;
  if not found then
    insert into public.estado (id, dados, versao) values (1, p_dados, 1);
    return jsonb_build_object('ok', true, 'versao', 1);
  end if;
  if not coalesce(p_forcar, false) and (p_base is null or p_base <> v) then
    return jsonb_build_object('ok', false, 'erro', 'conflito', 'versao', v);
  end if;
  update public.estado set dados = p_dados, versao = v + 1, atualizado = now() where id = 1;
  return jsonb_build_object('ok', true, 'versao', v + 1);
end $$;

create or replace function public.sair(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  delete from public.sessoes
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Limpeza da versao anterior ----------
-- (depois de trocar as funcoes acima, que nao usam mais a coluna "expira")
alter table public.sessoes drop column if exists expira;

-- ---------- Permissoes: so as 4 funcoes do app ficam abertas ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.entrar(text, text)                      to anon;
grant execute on function public.ler_estado(text)                        to anon;
grant execute on function public.salvar_estado(text, jsonb, int, boolean) to anon;
grant execute on function public.sair(text)                              to anon;
