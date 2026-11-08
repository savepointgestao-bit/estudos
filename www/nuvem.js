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
  // A tela reaproveita as classes do próprio site (.app .home .saudacao .hero .btn .f-lbl),
  // então herda céu, nuvens, chão de tijolo e o avião no tema Pixel, e segue o tema Clássico/escuro sozinha.
  css.textContent = `
#nvGate{position:fixed;inset:0;z-index:300;background:var(--bg,#eef1f6);overflow:auto;
  padding:max(20px,6vh) max(16px,env(safe-area-inset-right,0px)) 40px max(16px,env(safe-area-inset-left,0px))}
.nv-app{margin:0 auto}
.nv-hero .f-lbl{color:var(--sky-ink)}
.nv-hero input{background:var(--surface);border:2px solid var(--px,var(--line));padding:11px 12px;font-size:17px;color:var(--ink);
  font-family:var(--f-body);font-weight:400;text-transform:none;letter-spacing:0;min-width:0;width:100%;border-radius:10px}
.pixel .nv-hero input{border-width:3px}
.nv-hero input:focus{outline:2px solid var(--accent);outline-offset:1px}
.nv-hero .btn,.nv-hero .ghost{width:100%}
.nv-hero .btn{min-height:48px;font-size:16px}
.nv-hero .ghost{min-height:44px;font-size:14px}
.nv-hero p{margin:0}
.nv-hero #nvPin{text-align:center;letter-spacing:.4em;font-size:22px}
.nv-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;touch-action:manipulation}
.nv-hero .nv-key{min-height:52px;padding:0;font-family:var(--f-display);font-size:22px;font-weight:700;color:var(--ink);background:var(--surface);user-select:none;-webkit-user-select:none}
.nv-hero .nv-key.sm{font-size:12px;font-weight:600}
.nv-hero .nv-key:active{transform:translate(2px,2px)}
.nv-msg{font-size:13px;color:var(--danger);background:var(--surface);border:2px solid var(--px,var(--line));padding:8px 10px;border-radius:10px}
.nv-msg:empty{display:none}
`;
  document.head.appendChild(css);

  const gate = document.createElement("div");
  gate.id = "nvGate"; gate.hidden = true;
  document.body.appendChild(gate);

  const html = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // O app principal roda depois deste arquivo. Enquanto ele não terminou, a tela fica só com o fundo
  // (sem mostrar o app por baixo) e o conteúdo é desenhado no DOMContentLoaded.
  const quando = fn => document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn, { once: true }) : fn();
  const SOL = `<svg class="sd-ico" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/></svg>`;
  function icone() {
    try { if (pixelOn) return `<span class="sd-ico">${pixAviao(3)}</span>`; } catch (e) {}   // mesmo ícone da saudação do app
    return SOL;
  }
  const moldura = (titulo, sub, hero) => `<div class="app home nv-app">
      <header class="saudacao">${icone()}<div class="sd-txt"><h1>${html(titulo)}</h1><p>${html(sub)}</p></div></header>
      ${hero}
    </div>`;

  function mostrarEntrada(aviso) {
    gate.hidden = false; document.body.style.overflow = "hidden";
    quando(() => {
      gate.innerHTML = moldura("Edital em Dia", "Digite o PIN e a palavra de segurança para entrar.",
        `<form class="hero nv-hero" id="nvForm" autocomplete="off">
          <div class="eyebrow">Acesso</div>
          <div class="f-lbl"><label for="nvPin">PIN</label><input id="nvPin" type="password" inputmode="none" autocomplete="off" maxlength="12" required></div>
          <div class="nv-pad" id="nvPad" role="group" aria-label="Teclado numérico">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" class="ghost nv-key" data-k="${n}">${n}</button>`).join("")}
            <button type="button" class="ghost nv-key sm" data-k="limpar">Limpar</button>
            <button type="button" class="ghost nv-key" data-k="0">0</button>
            <button type="button" class="ghost nv-key sm" data-k="apagar">Apagar</button>
          </div>
          <label class="f-lbl" for="nvPal">Palavra de segurança<input id="nvPal" type="password" autocomplete="off" autocapitalize="none" required></label>
          <p class="nv-msg" id="nvMsg" role="alert">${html(aviso || "")}</p>
          <button class="btn" type="submit" id="nvOk">Entrar</button>
        </form>`);
      $nv("nvPin").focus();
      $nv("nvForm").addEventListener("submit", entrar);
      // teclado numérico na tela (o PIN não abre o teclado do celular; no computador dá para digitar normalmente)
      $nv("nvPin").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, ""); });
      $nv("nvPad").addEventListener("click", ev => {
        const b = ev.target.closest("[data-k]"); if (!b) return;
        const i = $nv("nvPin"), k = b.dataset.k;
        if (k === "apagar") i.value = i.value.slice(0, -1);
        else if (k === "limpar") i.value = "";
        else if (i.value.length < 12) i.value += k;
      });
    });
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
