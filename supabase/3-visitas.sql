-- ============================================================================
-- Visitas e presenca ao vivo (Habits)
-- ----------------------------------------------------------------------------
-- Rode DEPOIS do 1-schema.sql, no SQL Editor do Supabase. Pode rodar de novo
-- quando quiser (nao apaga nada). Se um dia rodar o 1-schema.sql outra vez,
-- rode este de novo em seguida (o 1 tira as permissoes das funcoes novas).
--
-- O que faz:
--   * visita_casas    lista as outras contas que tem casa no Habits (e se estao online)
--   * visita_ver      devolve SO a casa e o personagem de outra conta (nunca tarefas,
--                     humor, diario ou qualquer outro dado)
--   * visita_presenca diz onde eu estou (casa, academia, escritorio ou visitando a casa
--                     de alguem) e devolve quem mais esta no mesmo lugar agora
--
-- Seguranca: igual ao resto. As tabelas nao tem policies e o anon nao enxerga nada
-- direto; so executa as funcoes abaixo, e todas exigem uma sessao valida.
-- Nao mexe no Estudos nem nos dados do Habits.
-- ============================================================================

create table if not exists public.presenca (
  conta      int primary key references public.acesso(id) on delete cascade,
  lugar      text        not null,
  x          int         not null default 0,
  y          int         not null default 0,
  face       text        not null default 'front',
  dir        int         not null default 1,
  mov        boolean     not null default false,
  ato        text        not null default '',
  atualizado timestamptz not null default now()
);
alter table public.presenca enable row level security;
revoke all on public.presenca from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Casas que posso visitar
-- ---------------------------------------------------------------------------
create or replace function public.visita_casas(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_conta int; v_lista jsonb;
begin
  v_conta := public._sessao_ok(p_token);
  if v_conta is null then
    return jsonb_build_object('ok', false, 'erro', 'sessao');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'conta', a.id,
           'nome', left(coalesce(nullif(btrim(e.dados->>'name'), ''), a.nome), 24),
           'online', coalesce(p.atualizado > now() - interval '10 seconds' and p.lugar <> '', false),
           'lugar', case when p.atualizado > now() - interval '10 seconds' then p.lugar else '' end
         ) order by a.id), '[]'::jsonb)
    into v_lista
    from public.acesso a
    join public.estado e on e.conta = a.id and e.app = 'habits'
    left join public.presenca p on p.conta = a.id
   where a.id <> v_conta
     and jsonb_typeof(e.dados->'home') = 'object';
  return jsonb_build_object('ok', true, 'eu', v_conta, 'casas', v_lista);
end $$;

-- ---------------------------------------------------------------------------
-- Ver a casa de outra conta (so casa + personagem)
-- ---------------------------------------------------------------------------
create or replace function public.visita_ver(p_token text, p_conta int) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_conta int; d jsonb; n text; v_nivel int;
begin
  v_conta := public._sessao_ok(p_token);
  if v_conta is null then
    return jsonb_build_object('ok', false, 'erro', 'sessao');
  end if;
  if p_conta is null or p_conta = v_conta then
    return jsonb_build_object('ok', false, 'erro', 'conta');
  end if;
  select e.dados, a.nome into d, n
    from public.estado e join public.acesso a on a.id = e.conta
   where e.conta = p_conta and e.app = 'habits';
  if not found or jsonb_typeof(d->'home') is distinct from 'object' then
    return jsonb_build_object('ok', false, 'erro', 'sem_casa');
  end if;
  v_nivel := case when (d->'user'->>'level') ~ '^[0-9]{1,3}$' then (d->'user'->>'level')::int else 1 end;
  return jsonb_build_object(
    'ok', true,
    'conta', p_conta,
    'nome', left(coalesce(nullif(btrim(d->>'name'), ''), n), 24),
    'avatar', case when jsonb_typeof(d->'avatar') = 'object' then d->'avatar' else '{}'::jsonb end,
    'home', d->'home',
    'nivel', v_nivel);
end $$;

-- ---------------------------------------------------------------------------
-- Onde estou + quem mais esta aqui (chamar a cada 1 a 3 segundos)
--   p_lugar: 'casa' (minha casa) | 'gym' | 'office' | 'visita:<conta>' | '' (saiu)
-- ---------------------------------------------------------------------------
create or replace function public.visita_presenca(
  p_token text, p_lugar text,
  p_x int default 0, p_y int default 0, p_face text default 'front',
  p_dir int default 1, p_mov boolean default false, p_ato text default ''
) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_conta int; v_sala text; v_alvo int; v_outros jsonb;
begin
  v_conta := public._sessao_ok(p_token);
  if v_conta is null then
    return jsonb_build_object('ok', false, 'erro', 'sessao');
  end if;

  if coalesce(p_lugar, '') = '' then
    delete from public.presenca where conta = v_conta;
    return jsonb_build_object('ok', true, 'eu', v_conta, 'sala', '', 'outros', '[]'::jsonb);
  end if;

  if p_lugar = 'casa' then
    v_sala := 'casa:' || v_conta;
  elsif p_lugar in ('gym', 'office') then
    v_sala := p_lugar;
  elsif p_lugar ~ '^visita:[0-9]{1,9}$' then
    v_alvo := substr(p_lugar, 8)::int;
    if v_alvo = v_conta or not exists (
         select 1 from public.estado e
          where e.conta = v_alvo and e.app = 'habits' and jsonb_typeof(e.dados->'home') = 'object') then
      return jsonb_build_object('ok', false, 'erro', 'destino');
    end if;
    v_sala := 'casa:' || v_alvo;
  else
    return jsonb_build_object('ok', false, 'erro', 'lugar');
  end if;

  insert into public.presenca as p (conta, lugar, x, y, face, dir, mov, ato, atualizado)
  values (v_conta, v_sala,
          greatest(-200, least(500, coalesce(p_x, 0))),
          greatest(-100, least(400, coalesce(p_y, 0))),
          case when p_face in ('front', 'side', 'back') then p_face else 'front' end,
          case when p_dir < 0 then -1 else 1 end,
          coalesce(p_mov, false),
          left(regexp_replace(coalesce(p_ato, ''), '[^a-z_]', '', 'g'), 16),
          now())
  on conflict (conta) do update
     set lugar = excluded.lugar, x = excluded.x, y = excluded.y, face = excluded.face,
         dir = excluded.dir, mov = excluded.mov, ato = excluded.ato, atualizado = excluded.atualizado;

  select coalesce(jsonb_agg(jsonb_build_object(
           'conta', p.conta,
           'nome', left(coalesce(nullif(btrim(e.dados->>'name'), ''), a.nome), 24),
           'avatar', case when jsonb_typeof(e.dados->'avatar') = 'object' then e.dados->'avatar' else '{}'::jsonb end,
           'x', p.x, 'y', p.y, 'face', p.face, 'dir', p.dir, 'mov', p.mov, 'ato', p.ato
         ) order by p.conta), '[]'::jsonb)
    into v_outros
    from public.presenca p
    join public.acesso a on a.id = p.conta
    left join public.estado e on e.conta = p.conta and e.app = 'habits'
   where p.lugar = v_sala and p.conta <> v_conta
     and p.atualizado > now() - interval '8 seconds';

  -- limpeza ocasional de quem sumiu ha mais de 1 hora
  if random() < 0.02 then
    delete from public.presenca where atualizado < now() - interval '1 hour';
  end if;

  return jsonb_build_object('ok', true, 'eu', v_conta, 'sala', v_sala, 'outros', v_outros);
end $$;

-- ---------------------------------------------------------------------------
-- Permissoes: so as 3 funcoes, so para o anon
-- ---------------------------------------------------------------------------
revoke execute on function public.visita_casas(text)    from public, anon, authenticated;
revoke execute on function public.visita_ver(text, int) from public, anon, authenticated;
revoke execute on function public.visita_presenca(text, text, int, int, text, int, boolean, text) from public, anon, authenticated;
grant execute on function public.visita_casas(text)    to anon;
grant execute on function public.visita_ver(text, int) to anon;
grant execute on function public.visita_presenca(text, text, int, int, text, int, boolean, text) to anon;

notify pgrst, 'reload schema';
