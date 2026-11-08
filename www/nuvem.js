/* Nuvem: acesso por PIN + palavra de segurança e cópia dos dados no Supabase.
   Se o config.js estiver vazio, nada aqui roda e o app funciona só no aparelho.
   O PIN e a palavra são conferidos no servidor. Neste aparelho ficam guardados:
   - um token de sessão, que não tem prazo fixo mas vale só enquanto o app for usado:
     passadas 48h sem acesso o PIN é pedido de novo;
   - a palavra de segurança, salva na primeira vez que foi digitada (por isso depois só se pede o PIN).
   O PIN nunca é guardado.

   Serve a mais de um app no mesmo Supabase (mesmo PIN e palavra, dados separados por nome de app).
   O config.js de cada app diz quem ele é:
     window.NUVEM = { url, chave, app: "habits", ls: "habits:nuvem", visual: "px", titulo: "Habits" };
   e, se o app guarda os dados de outro jeito que o Estudos, define window.NUVEM_APP = { ler, real, trocar }. */
(function () {
  const C = window.NUVEM || {};
  if (!C.url || !C.chave) return;

  const APP = C.app || "estudos";          // nome dos dados deste app no banco
  const VIS = C.visual === "px" ? "px" : "site";
  const DADOS = "edital-em-dia-v2";        // chave dos dados do Estudos
  const LS = C.ls || (DADOS + ":nuvem");   // onde esta aparelho guarda a sessão
  // Como a nuvem enxerga os dados do app. O padrão é o do Estudos (variável S); outros apps trocam estas três funções.
  const A = Object.assign({
    ler: () => (typeof S === "undefined" ? null : S),
    real: () => typeof S !== "undefined" && !S.exemplo,                   // false = ainda só dados de exemplo
    trocar: dados => {                                                    // adota os dados da nuvem e recarrega
      dados.exemplo = false; S = dados;                                   // S e KEY vêm do script principal
      try { localStorage.setItem(DADOS, JSON.stringify(S)); } catch (e) {}
      location.hash = "#inicio"; location.reload();
    },
  }, window.NUVEM_APP || {});
  const TITULO = C.titulo || "Edital em Dia";
  const H48 = 48 * 3600e3;                 // sem acessar por mais que isso: pede o PIN de novo
  let est = { token: "", base: null, sujo: false, palavra: "", ultimo: 0 };
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
  // A tela reaproveita as classes do próprio site (.app .home .saudacao .hero .btn .f-lbl),
  // então herda céu, nuvens, chão de tijolo e o avião no tema Pixel, e segue o tema Clássico/escuro sozinha.
  const CSS_SITE = `
#nvGate{position:fixed;inset:0;z-index:300;background:var(--bg,#eef1f6);overflow:auto;
  padding:max(20px,6vh) max(16px,env(safe-area-inset-right,0px)) 40px max(16px,env(safe-area-inset-left,0px))}
.app.home.nv-app{margin:0 auto;display:flex;flex-direction:column;max-width:460px}
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
.nv-salva{font-size:13px;color:var(--sky-ink,var(--ink))}
`;
  // Visual "px": moldura pixel do app Habits (variáveis --bg --panel --field --text --muted --ink --accent --font do próprio app)
  const CSS_PX = `
#nvGate{position:fixed;inset:0;z-index:300;background:var(--bg);color:var(--text);font-family:var(--font);overflow:auto;
  padding:max(24px,7vh) max(19px,env(safe-area-inset-right,0px)) 44px max(19px,env(safe-area-inset-left,0px))}
.nvp{max-width:420px;margin:0 auto;display:flex;flex-direction:column;gap:20px}
.nvp-head{display:flex;align-items:center;gap:14px;margin:0 2px}
.nvp-head svg{flex:none;width:64px;height:48px;shape-rendering:crispEdges}
.nvp-head h1{margin:0;font-size:24px;font-weight:700}
.nvp-head p{margin:4px 0 0;color:var(--muted);font-size:14px}
.nvp-card{background:var(--panel);padding:16px;display:flex;flex-direction:column;gap:12px;
  box-shadow:0 -3px 0 0 var(--ink),0 3px 0 0 var(--ink),-3px 0 0 0 var(--ink),3px 0 0 0 var(--ink),0 7px 0 0 var(--drop)}
.nvp-card h2{margin:0;font-size:13px;font-weight:700;color:var(--muted);letter-spacing:.08em;text-transform:uppercase}
.nvp-card label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:700;color:var(--muted)}
.nvp-card input{background:var(--field);border:0;box-shadow:0 0 0 2px var(--ink);padding:11px 12px;font-size:17px;color:var(--text);outline:none;width:100%;min-width:0;font-weight:400}
.nvp-card input:focus{box-shadow:0 0 0 2px var(--ink),0 0 0 5px var(--accent)}
.nvp-card #nvPin{text-align:center;letter-spacing:.4em;font-size:22px}
.nvp-card .btn{flex:none;width:100%}
.nv-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;touch-action:manipulation}
.nvp-card .nv-key{height:52px;font-size:22px;padding:0;user-select:none;-webkit-user-select:none}
.nvp-card .nv-key.sm{font-size:13px}
.nvp-card .nv-key:active{transform:translate(2px,2px)}
.nvp-card p{margin:0}
.nv-salva{font-size:13px;color:var(--muted)}
.nv-msg{font-size:13px;color:var(--danger);background:var(--field);padding:8px 10px}
.nv-msg:empty{display:none}
`;
  const css = document.createElement("style");
  css.textContent = VIS === "px" ? CSS_PX : CSS_SITE;
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
  // avião pixel (o mesmo do ícone do app) para o visual "px"
  const AVIAO_PX = (() => {
    const L = ["................", "..kk............", "..kbk...........", "..kbbk..........", "..kbbbkkkkkkk...", ".kkbbbbbbbbwwkk.",
      "kybbbbbbbbbbbbbk", ".kkkkbbbbbbbbkk.", "....kbbbkkkkk...", "....kbbk........", "....kbk.........", "....kk.........."];
    const cor = { k: "#1b1f3b", b: "#2b4fd6", w: "#ffffff", y: "#f8b800" };
    let r = "";
    L.forEach((row, y) => { for (let x = 0; x < 16;) { const c = row[x]; if (c === ".") { x++; continue; } let n = 1; while (row[x + n] === c) n++; r += `<rect x="${x}" y="${y}" width="${n}" height="1" fill="${cor[c]}"/>`; x += n; } });
    return `<svg viewBox="0 0 16 12" aria-hidden="true">${r}</svg>`;
  })();
  // pedaços que mudam de um visual para o outro
  const K = VIS === "px" ? {
    caixa: "nvp-card", titulo: "h2", pin: i => `<label for="nvPin">PIN${i}</label>`, pal: i => `<label for="nvPal">Palavra de segurança${i}</label>`,
    tecla: "btn ghost nv-key", ghost: "btn ghost", btn: "btn",
  } : {
    caixa: "hero nv-hero", titulo: "div", pin: i => `<div class="f-lbl"><label for="nvPin">PIN</label>${i}</div>`, pal: i => `<label class="f-lbl" for="nvPal">Palavra de segurança${i}</label>`,
    tecla: "ghost nv-key", ghost: "ghost", btn: "btn",
  };
  const moldura = (titulo, sub, hero) => VIS === "px"
    ? `<div class="nvp"><header class="nvp-head">${AVIAO_PX}<div><h1>${html(titulo)}</h1><p>${html(sub)}</p></div></header>${hero}</div>`
    : `<div class="app home nv-app">
      <header class="saudacao">${icone()}<div class="sd-txt"><h1>${html(titulo)}</h1><p>${html(sub)}</p></div></header>
      ${hero}
    </div>`;

  function mostrarEntrada(aviso) {
    gate.hidden = false; document.body.style.overflow = "hidden";
    quando(() => {
      gate.innerHTML = moldura(TITULO, est.palavra ? "Digite o PIN para entrar." : "Digite o PIN e a palavra de segurança para entrar.",
        `<form class="${K.caixa}" id="nvForm" autocomplete="off">
          <${K.titulo} class="eyebrow">Acesso</${K.titulo}>
          ${K.pin(`<input id="nvPin" type="password" inputmode="none" autocomplete="off" maxlength="12" required>`)}
          <div class="nv-pad" id="nvPad" role="group" aria-label="Teclado numérico">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" class="${K.tecla}" data-k="${n}">${n}</button>`).join("")}
            <button type="button" class="${K.tecla} sm" data-k="limpar">Limpar</button>
            <button type="button" class="${K.tecla}" data-k="0">0</button>
            <button type="button" class="${K.tecla} sm" data-k="apagar">Apagar</button>
          </div>
          ${est.palavra
            ? `<p class="nv-salva" id="nvSalva">Palavra de segurança salva neste aparelho.</p>
          <button type="button" class="${K.ghost}" id="nvTroca">Trocar palavra</button>`
            : K.pal(`<input id="nvPal" type="password" autocomplete="off" autocapitalize="none" required>`)}
          <p class="nv-msg" id="nvMsg" role="alert">${html(aviso || "")}</p>
          <button class="${K.btn}" type="submit" id="nvOk">Entrar</button>
        </form>`);
      $nv("nvPin").focus();
      $nv("nvForm").addEventListener("submit", entrar);
      if ($nv("nvTroca")) $nv("nvTroca").onclick = () => { est.palavra = ""; gravar(); mostrarEntrada(); };
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
    const pin = $nv("nvPin").value.trim(), msg = $nv("nvMsg"), bt = $nv("nvOk");
    const pal = $nv("nvPal") ? $nv("nvPal").value : est.palavra;      // palavra salva ou digitada agora
    bt.disabled = true; msg.textContent = "Entrando...";
    try {
      const r = await rpc("entrar", { p_pin: pin, p_palavra: pal });
      if (r.ok) {
        est = { token: r.token, base: est.base, sujo: est.sujo, palavra: pal, ultimo: Date.now() }; gravar();
        esconder(); sincronizar(); return;
      }
      if ($nv("nvPal")) $nv("nvPal").value = "";
      $nv("nvPin").value = "";
      if (r.erro === "bloqueado") msg.textContent = `Muitas tentativas. Tente de novo em ${r.minutos} min.`;
      else if (r.erro === "nao_configurado") msg.textContent = "O acesso ainda não foi configurado no servidor.";
      else msg.textContent = `PIN ou palavra de segurança incorretos.${est.palavra ? " Se a palavra mudou, toque em Trocar palavra." : ""}${r.restantes != null && r.restantes <= 2 ? ` Restam ${r.restantes} tentativas.` : ""}`;
    } catch (e) {
      msg.textContent = "Sem conexão com o servidor. Confira a internet e tente de novo.";
    }
    bt.disabled = false; $nv("nvPin").focus();
  }

  function sessaoInvalida() {
    est.token = ""; gravar(); statusTxt = "";
    mostrarEntrada("Sua sessão expirou. Digite o PIN de novo.");
  }

  /* Sem prazo fixo: só vale a regra das 48h sem acessar. Cada uso renova (aqui e no servidor). */
  let ultimoGrav = 0;
  function tocar(agora) {
    est.ultimo = Date.now();
    if (agora || est.ultimo - ultimoGrav > 60000) { ultimoGrav = est.ultimo; gravar(); }
  }
  const expirouLocal = () => !!est.token && !!est.ultimo && Date.now() - est.ultimo > H48;
  function expirar48() {
    est.token = ""; est.ultimo = 0; gravar(); statusTxt = "";
    mostrarEntrada("Faz mais de 48h que você não acessa. Digite o PIN de novo.");
  }
  // devolve true se pode continuar usando; senão já mostra a tela do PIN
  function usar() {
    if (!est.token) return false;
    if (expirouLocal()) { expirar48(); return false; }
    tocar(); return true;
  }

  /* ---------- Escolha quando nuvem e aparelho divergem ---------- */
  function pedirEscolha(r) {
    gate.hidden = false; document.body.style.overflow = "hidden";
    gate.innerHTML = moldura("Dados diferentes", "Os dados da nuvem são diferentes dos deste aparelho. Qual você quer manter? O outro lado será substituído.",
      `<div class="${K.caixa}">
        <button class="${K.btn}" type="button" id="nvNuvem">Usar os da nuvem</button>
        <button class="${K.ghost}" type="button" id="nvAqui">Manter os deste aparelho</button>
      </div>`);
    $nv("nvNuvem").onclick = () => adotar(r);
    $nv("nvAqui").onclick = async () => {
      esconder();
      try { est.base = r.versao; await enviar(true); } catch (e) { est.sujo = true; gravar(); }
    };
  }

  function adotar(r) {
    est.base = r.versao; est.sujo = false; gravar();
    A.trocar(r.dados);
  }

  /* ---------- Sincronização ---------- */
  async function enviar(forcar) {
    if (!A.ler() || !A.real()) return;                       // não sobe os dados de exemplo
    const dados = A.ler();
    const r = await rpc("salvar_estado", { p_token: est.token, p_dados: dados, p_base: est.base, p_forcar: !!forcar, p_app: APP });
    if (r.ok) { est.base = r.versao; est.sujo = false; gravar(); statusTxt = "ok"; }
    else if (r.erro === "sessao") sessaoInvalida();
    else if (r.erro === "conflito") { const l = await rpc("ler_estado", { p_token: est.token, p_app: APP }); if (l.ok && l.existe) pedirEscolha(l); }
    else statusTxt = "erro";
  }

  async function sincronizar() {
    if (!est.token || ocupado) return;
    ocupado = true;
    try {
      const r = await rpc("ler_estado", { p_token: est.token, p_app: APP });
      if (!r.ok) return sessaoInvalida();
      tocar();
      const localReal = !!A.ler() && A.real();
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
  // [classe, texto] do estado da nuvem; o app pode usar para desenhar a própria seção
  window.nuvemStatus = () => statusTxt === "ok" && !est.sujo ? ["on", "Tudo salvo na nuvem."]
    : statusTxt === "offline" ? ["", "Sem conexão. Suas alterações ficam no aparelho e sobem quando a internet voltar."]
    : statusTxt === "erro" ? ["", "Não consegui salvar na nuvem agora. Vou tentar de novo."]
    : est.sujo ? ["", "Alterações ainda não enviadas para a nuvem."] : ["", "Conectado."];
  window.nuvemAjustes = function () {
    const t = window.nuvemStatus();
    return `<div class="c-sec"><span class="f-lbl">Nuvem</span>
      <p class="aj-status ${t[0]}">${t[1]}</p>
      <div class="row aj-btns">
        <button type="button" class="btn sm" data-aj="nuvem:sync">Sincronizar agora</button>
        <button type="button" class="ghost" data-aj="nuvem:sair">Sair deste aparelho</button>
      </div>
      <p class="note">Os dados dos estudos ficam salvos na nuvem, protegidos pelo PIN e pela palavra de segurança. Passadas 48h sem abrir o app, o PIN é pedido de novo (a palavra fica salva neste aparelho). Anexos ficam só neste aparelho.</p>
    </div>`;
  };
  window.nuvemAcao = async function (a) {
    if (a === "sync") {
      if (est.sujo) { try { await enviar(false); } catch (e) { statusTxt = "offline"; } } else await sincronizar();
    }
    if (a === "sair") {
      try { await rpc("sair", { p_token: est.token }); } catch (e) {}
      // mantém a versão e o "sujo" para, ao entrar de novo, não perguntar qual lado manter à toa
      est = { token: "", base: est.base, sujo: est.sujo, palavra: est.palavra, ultimo: 0 }; gravar(); statusTxt = "";
      mostrarEntrada();
    }
  };

  /* ---------- Início ---------- */
  if (est.token && !est.ultimo) { est.ultimo = Date.now(); gravar(); }   // sessão de antes desta regra: conta a partir de agora
  if (expirouLocal()) expirar48();
  else if (!est.token) mostrarEntrada();
  window.addEventListener("load", () => { if (usar()) sincronizar(); });
  window.addEventListener("online", () => { if (est.token && est.sujo) sincronizar(); });
  // qualquer toque ou tecla conta como uso (e pega o caso do app ficar aberto por dias sem ninguém mexer)
  ["pointerdown", "keydown"].forEach(ev => document.addEventListener(ev, () => { usar(); }, true));
  document.addEventListener("visibilitychange", () => {
    if (!est.token) return;
    if (document.visibilityState === "hidden") {
      tocar(true);                                                              // guarda a hora da última vez que usou
      if (est.sujo && !ocupado) { clearTimeout(timer); sincronizar(); }
    } else if (usar()) sincronizar();                                          // voltou ao app: confere a sessão e puxa o que mudou
  });
})();
