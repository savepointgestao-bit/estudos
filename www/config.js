/* Ligação com a nuvem (Supabase), projeto edital-em-dia.
   A chave abaixo é a publishable, feita para ficar no navegador. Sozinha ela não lê nada:
   as tabelas estão trancadas e só funções que exigem PIN + palavra de segurança respondem.
   Nunca coloque aqui a chave secret nem a service_role. */
window.NUVEM = {
  url: "https://otvwjuwfpkpdniqycuhc.supabase.co",
  chave: "sb_publishable_K40z6368hZ1Q8j998j28XQ_q_lYCMD2"
};
