-- ============================================================================
-- Mensagens entre as contas (app Contatos, dentro do celular do Habits)
-- ----------------------------------------------------------------------------
-- Rode DEPOIS do 1-schema.sql e do 3-visitas.sql, no SQL Editor do Supabase.
-- Pode rodar de novo quando quiser (nao apaga nada). Se um dia rodar o
-- 1-schema.sql outra vez, rode este de novo em seguida.
--
-- O que faz:
--   * msg_contatos  lista as outras contas (online ou nao), com a ultima mensagem
--                   e quantas nao foram lidas
--   * msg_ler       devolve a conversa com uma conta e marca as recebidas como lidas
--   * msg_enviar    manda uma mensagem (ate 500 letras, no maximo 20 por minuto)
--
-- Seguranca: igual ao resto. A tabela nao tem policies e o anon nao enxerga nada
-- direto; so executa as funcoes abaixo, e todas exigem uma sessao valida. Cada
-- pessoa so le as mensagens em que e quem enviou ou quem recebeu.
-- Mensagens com mais de 90 dias sao apagadas automaticamente.
-- Nao mexe no Estudos nem nos dados do Habits.
-- ============================================================================

create table if not exists public.mensagem (
  id     bigint generated always as identity primary key,
  de     int         not null references public.acesso(id) on delete cascade,
  para   int         not null references public.acesso(id) on delete cascade,
  texto  text        not null check (char_length(texto) between 1 and 500),
  criado timestamptz not null default now(),
  lida   boolean     not null default false
);
create index if not exists mensagem_par_idx on public.mensagem (least(de, para), greatest(de, para), id);
create index if not exists mensagem_nao_lidas_idx on public.mensagem (para) where not lida;
alter table public.mensagem enable row level security;
revoke all on public.mensagem from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Contatos
-- ---------------------------------------------------------------------------
create or replace function public.msg_contatos(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_conta int; v_lista jsonb; v_total int;
begin
  v_conta := public._sessao_ok(p_token);
  if v_conta is null then
    return jsonb_build_object('ok', false, 'erro', 'sessao');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'conta', a.id,
           'nome', left(coalesce(nullif(btrim(e.dados->>'name'), ''), a.nome), 24),
           'online', coalesce(p.atualizado > now() - interval '10 seconds' and p.lugar <> '', false),
           'lugar', case when p.atualizado > now() - interval '10 seconds' then p.lugar else '' end,
           'nao_lidas', (select count(*) from public.mensagem m where m.de = a.id and m.para = v_conta and not m.lida),
           'ultima', u.texto,
           'ultima_de_mim', coalesce(u.de = v_conta, false),
           'ultima_em', extract(epoch from u.criado)::bigint
         ) order by a.id), '[]'::jsonb)
    into v_lista
    from public.acesso a
    join public.estado e on e.conta = a.id and e.app = 'habits'
    left join public.presenca p on p.conta = a.id
    left join lateral (
      select left(m.texto, 80) as texto, m.de, m.criado
        from public.mensagem m
       where least(m.de, m.para) = least(a.id, v_conta) and greatest(m.de, m.para) = greatest(a.id, v_conta)
       order by m.id desc limit 1) u on true
   where a.id <> v_conta
     and jsonb_typeof(e.dados->'home') = 'object';
  select count(*) into v_total from public.mensagem where para = v_conta and not lida;
  return jsonb_build_object('ok', true, 'eu', v_conta, 'nao_lidas', v_total, 'contatos', v_lista);
end $$;

-- ---------------------------------------------------------------------------
-- Ler a conversa (p_depois = id da ultima mensagem que o app ja tem; 0 = do comeco)
-- ---------------------------------------------------------------------------
create or replace function public.msg_ler(p_token text, p_com int, p_depois bigint default 0) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_conta int; v_msgs jsonb;
begin
  v_conta := public._sessao_ok(p_token);
  if v_conta is null then
    return jsonb_build_object('ok', false, 'erro', 'sessao');
  end if;
  if p_com is null or p_com = v_conta or not exists (select 1 from public.acesso where id = p_com) then
    return jsonb_build_object('ok', false, 'erro', 'conta');
  end if;
  update public.mensagem set lida = true where de = p_com and para = v_conta and not lida;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'de_mim', t.de = v_conta,
           'texto', t.texto,
           'em', extract(epoch from t.criado)::bigint
         ) order by t.id), '[]'::jsonb)
    into v_msgs
    from (select m.* from public.mensagem m
           where least(m.de, m.para) = least(v_conta, p_com) and greatest(m.de, m.para) = greatest(v_conta, p_com)
             and m.id > coalesce(p_depois, 0)
           order by m.id desc limit 60) t;
  return jsonb_build_object('ok', true, 'eu', v_conta, 'mensagens', v_msgs);
end $$;

-- ---------------------------------------------------------------------------
-- Enviar
-- ---------------------------------------------------------------------------
create or replace function public.msg_enviar(p_token text, p_para int, p_texto text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_conta int; v_texto text; v_id bigint; v_em timestamptz;
begin
  v_conta := public._sessao_ok(p_token);
  if v_conta is null then
    return jsonb_build_object('ok', false, 'erro', 'sessao');
  end if;
  if p_para is null or p_para = v_conta or not exists (select 1 from public.acesso where id = p_para) then
    return jsonb_build_object('ok', false, 'erro', 'conta');
  end if;
  v_texto := btrim(coalesce(p_texto, ''));
  if v_texto = '' then
    return jsonb_build_object('ok', false, 'erro', 'vazia');
  end if;
  if char_length(v_texto) > 500 then
    return jsonb_build_object('ok', false, 'erro', 'longa');
  end if;
  if (select count(*) from public.mensagem where de = v_conta and criado > now() - interval '1 minute') >= 20 then
    return jsonb_build_object('ok', false, 'erro', 'rapido');
  end if;
  insert into public.mensagem (de, para, texto) values (v_conta, p_para, v_texto)
    returning id, criado into v_id, v_em;
  if random() < 0.02 then
    delete from public.mensagem where criado < now() - interval '90 days';
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'em', extract(epoch from v_em)::bigint);
end $$;

-- ---------------------------------------------------------------------------
-- Permissoes: so as 3 funcoes, so para o anon
-- ---------------------------------------------------------------------------
revoke execute on function public.msg_contatos(text)             from public, anon, authenticated;
revoke execute on function public.msg_ler(text, int, bigint)     from public, anon, authenticated;
revoke execute on function public.msg_enviar(text, int, text)    from public, anon, authenticated;
grant execute on function public.msg_contatos(text)          to anon;
grant execute on function public.msg_ler(text, int, bigint)  to anon;
grant execute on function public.msg_enviar(text, int, text) to anon;

notify pgrst, 'reload schema';
