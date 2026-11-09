-- Rode DEPOIS do 1-schema.sql, no SQL Editor do Supabase.
-- Cria o acesso de uma pessoa (conta) ou troca o PIN e a palavra de uma conta que ja existe.
-- Troque os tres valores: nome da conta (so para voce se achar), PIN (so numeros, 4 a 12)
-- e palavra de seguranca. A palavra nao diferencia maiuscula, minuscula nem acento.
--
--  * Nome novo = conta nova, com dados vazios (cada conta enxerga so os seus dados).
--  * Nome que ja existe = troca o PIN e a palavra dessa conta; os dados ficam e os aparelhos dela
--    sao desconectados. As outras contas nao sao tocadas.
--  * Duas contas podem ter o mesmo PIN se tiverem palavras diferentes.
--
-- Depois de rodar, apague esta consulta do historico do SQL Editor, para o PIN nao ficar salvo la.
-- Para ver as contas que existem (sem mostrar PIN nem palavra):
--   select id, nome, criado from public.acesso order by id;

select public.definir_acesso('nome da pessoa', '1234', 'minha palavra');
