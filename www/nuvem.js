/* Nuvem: acesso por PIN + palavra de segurança e cópia dos dados no Supabase.
   Se o config.js estiver vazio, nada aqui roda e o app funciona só no aparelho.
   O PIN e a palavra são conferidos no servidor. Este arquivo só guarda um token
   de sessão (30 dias) neste aparelho, nunca o PIN nem a palavra. */
(function () {
  const C = window.NUVEM || {};
  if (!C.url || !C.chave) return;

  const DADOS = "edital-em-dia-v2";        // mesma chave do app
  const LS = DADOS + ":nuvem";
  let est = { token: "", base: null, sujo: false };
  try { Object.assign(est, JSON.parse(localStorage.getItem(LS)) || {}); } catch (e) {}
  const gravar = () => { try { localStorage.setItem(LS, JSON.stringify(est)); } catch (e) {} };

  let statusTxt = "", ocupado = false, timer = null;

  /* ---------- Chamada ao servidor ---------- */
  async function rpc(nome, corpo) {
    const h = { "Content-Type": "application/json", apikey: C.chave };
    if (C.chave.startsWith("eyJ")) h.Authorization = "Bearer " + C.chave;   // chave antiga (JWT)
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(C.url.replace(/\/+$/, "") + "/rest/v1/rpc/" + nome, { method: "POST", headers: h, body: JSON.stringify(corpo), signal: ctl.signal });
      if (!r.ok) throw new Error("http " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  /* ---------- Tela de acesso ---------- */
  const css = document.createElement("style");
  css.textContent = `
#nvGate{position:fixed;inset:0;z-index:300;background:var(--bg,#eef1f6);display:flex;align-items:center;justify-content:center;padding:24px;overflow:auto}
#nvGate[hidden]{display:none}
.nv-card{width:100%;max-width:340px;background:var(--surface,#fff);color:var(--ink,#14213d);border:1px solid var(--line,#d7dce7);border-radius:16px;padding:22px 20px;display:flex;flex-direction:column;gap:14px;font-family:var(--f-body,system-ui,sans-serif)}
.pixel .nv-card{border:3px solid var(--px);box-shadow:4px 4px 0 var(--px);border-radius:0}
.nv-tit{font-family:var(--f-display,system-ui,sans-serif);font-weight:800;font-size:22px;margin:0}
.nv-sub{margin:0;font-size:14px;color:var(--muted,#5b6680)}
.nv-card label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:var(--muted,#5b6680);text-transform:uppercase;letter-spacing:.08em}
.nv-card input{background:var(--bg,#eef1f6);border:1px solid var(--line,#d7dce7);border-radius:10px;padding:12px;font-size:17px;color:var(--ink,#14213d);text-transform:none;letter-spacing:0;font-weight:400;min-width:0;font-family:inherit}
.nv-card .btn{min-height:46px;font-size:16px}
.nv-card .ghost{min-height:44px;font-size:14px}
.nv-msg{margin:0;font-size:13px;color:var(--danger,#c2412d);min-height:1.2em}
`;
  document.head.appendChild(css);

  const gate = document.createElement("div");
  gate.id = "nvGate"; gate.hidden = true;
  document.body.appendChild(gate);

  const html = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function mostrarEntrada(aviso) {
    gate.hidden = false; document.body.style.overflow = "hidden";
    gate.innerHTML = `<form class="nv-card" id="nvForm" autocomplete="off">
      <h1 class="nv-tit">Edital em Dia</h1>
      <p class="nv-sub">Digite o PIN e a palavra de segurança para entrar.</p>
      <label>PIN<input id="nvPin" type="password" inputmode="numeric" autocomplete="off" maxlength="12" required></label>
      <label>Palavra de segurança<input id="nvPal" type="password" autocomplete="off" autocapitalize="none" required></label>
      <p class="nv-msg" id="nvMsg" role="alert">${html(aviso || "")}</p>
      <button class="btn" type="submit" id="nvOk">Entrar</button>
    </form>`;
    $nv("nvPin").focus();
    $nv("nvForm").addEventListener("submit", entrar);
  }
  const $nv = id => document.getElementById(id);
  function esconder() { gate.hidden = true; gate.innerHTML = ""; document.body.style.overflow = ""; }

  async function entrar(ev) {
    ev.preventDefault();
    const pin = $nv("nvPin").value.trim(), pal = $nv("nvPal").value, msg = $nv("nvMsg"), bt = $nv("nvOk");
    bt.disabled = true; msg.textContent = "Entrando...";
    try {
      const r = await rpc("entrar", { p_pin: pin, p_palavra: pal });
      if (r.ok) {
        est = { token: r.token, base: est.base, sujo: est.sujo }; gravar();
        esconder(); sincronizar(); return;
      }
      $nv("nvPal").value = ""; $nv("nvPin").value = "";
      if (r.erro === "bloqueado") msg.textContent = `Muitas tentativas. Tente de novo em ${r.minutos} min.`;
      else if (r.erro === "nao_configurado") msg.textContent = "O acesso ainda não foi configurado no servidor.";
      else msg.textContent = `PIN ou palavra de segurança incorretos.${r.restantes != null && r.restantes <= 2 ? ` Restam ${r.restantes} tentativas.` : ""}`;
    } catch (e) {
      msg.textContent = "Sem conexão com o servidor. Confira a internet e tente de novo.";
    }
    bt.disabled = false; $nv("nvPin").focus();
  }

  function sessaoInvalida() {
    est.token = ""; gravar(); statusTxt = "";
    mostrarEntrada("Sua sessão expirou. Entre de novo.");
  }

  /* ---------- Escolha quando nuvem e aparelho divergem ---------- */
  function pedirEscolha(r) {
    gate.hidden = false; document.body.style.overflow = "hidden";
    gate.innerHTML = `<div class="nv-card">
      <h1 class="nv-tit">Dados diferentes</h1>
      <p class="nv-sub">Os dados da nuvem são diferentes dos deste aparelho. Qual você quer manter? O outro lado será substituído.</p>
      <button class="btn" type="button" id="nvNuvem">Usar os da nuvem</button>
      <button class="ghost" type="button" id="nvAqui">Manter os deste aparelho</button>
    </div>`;
    $nv("nvNuvem").onclick = () => adotar(r);
    $nv("nvAqui").onclick = async () => {
      esconder();
      try { est.base = r.versao; await enviar(true); } catch (e) { est.sujo = true; gravar(); }
    };
  }

  function adotar(r) {
    S = r.dados; S.exemplo = false;                       // S e KEY vêm do script principal
    try { localStorage.setItem(DADOS, JSON.stringify(S)); } catch (e) {}
    est.base = r.versao; est.sujo = false; gravar();
    location.hash = "#inicio"; location.reload();
  }

  /* ---------- Sincronização ---------- */
  async function enviar(forcar) {
    if (typeof S === "undefined" || S.exemplo) return;      // não sobe os dados de exemplo
    const r = await rpc("salvar_estado", { p_token: est.token, p_dados: S, p_base: est.base, p_forcar: !!forcar });
    if (r.ok) { est.base = r.versao; est.sujo = false; gravar(); statusTxt = "ok"; }
    else if (r.erro === "sessao") sessaoInvalida();
    else if (r.erro === "conflito") { const l = await rpc("ler_estado", { p_token: est.token }); if (l.ok && l.existe) pedirEscolha(l); }
    else statusTxt = "erro";
  }

  async function sincronizar() {
    if (!est.token || ocupado) return;
    ocupado = true;
    try {
      const r = await rpc("ler_estado", { p_token: est.token });
      if (!r.ok) return sessaoInvalida();
      const localReal = typeof S !== "undefined" && !S.exemplo;
      if (!r.existe) { if (localReal) await enviar(false); else statusTxt = "ok"; }
      else if (est.base === r.versao) { if (est.sujo) await enviar(false); else statusTxt = "ok"; }
      else if (!localReal || (est.base != null && !est.sujo)) adotar(r);   // aparelho novo, ou nuvem mais nova e nada alterado aqui
      else pedirEscolha(r);                                               // os dois lados mudaram
    } catch (e) { statusTxt = "offline"; }
    finally { ocupado = false; }
  }

  // chamado pelo app a cada alteração salva
  window.nuvemSujo = function () {
    if (!est.token) return;
    est.sujo = true; gravar(); statusTxt = "pendente";
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (ocupado) return;
      if (est.base == null) return sincronizar();
      ocupado = true;
      try { await enviar(false); } catch (e) { statusTxt = "offline"; } finally { ocupado = false; }
    }, 5000);
  };

  /* ---------- Parte da tela de Ajustes ---------- */
  window.nuvemAjustes = function () {
    const t = statusTxt === "ok" && !est.sujo ? ["on", "Tudo salvo na nuvem."]
      : statusTxt === "offline" ? ["", "Sem conexão. Suas alterações ficam no aparelho e sobem quando a internet voltar."]
      : statusTxt === "erro" ? ["", "Não consegui salvar na nuvem agora. Vou tentar de novo."]
      : est.sujo ? ["", "Alterações ainda não enviadas para a nuvem."] : ["", "Conectado."];
    return `<div class="c-sec"><span class="f-lbl">Nuvem</span>
      <p class="aj-status ${t[0]}">${t[1]}</p>
      <div class="row aj-btns">
        <button type="button" class="btn sm" data-aj="nuvem:sync">Sincronizar agora</button>
        <button type="button" class="ghost" data-aj="nuvem:sair">Sair deste aparelho</button>
      </div>
      <p class="note">Os dados dos estudos ficam salvos na nuvem, protegidos pelo PIN e pela palavra de segurança. Anexos ficam só neste aparelho.</p>
    </div>`;
  };
  window.nuvemAcao = async function (a) {
    if (a === "sync") {
      if (est.sujo) { try { await enviar(false); } catch (e) { statusTxt = "offline"; } } else await sincronizar();
    }
    if (a === "sair") {
      try { await rpc("sair", { p_token: est.token }); } catch (e) {}
      est = { token: "", base: null, sujo: false }; gravar(); statusTxt = "";
      mostrarEntrada();
    }
  };

  /* ---------- Início ---------- */
  if (!est.token) mostrarEntrada();
  window.addEventListener("load", () => { if (est.token) sincronizar(); });
  window.addEventListener("online", () => { if (est.token && est.sujo) sincronizar(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && est.token && est.sujo && !ocupado) { clearTimeout(timer); sincronizar(); }
  });
})();
