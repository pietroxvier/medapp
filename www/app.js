'use strict';
/* Interface do Remédios para iPhone. Regras em logica.js; recursos nativos via window.Nativo (src/native.js). */
(function () {
  var L = window.Logica, N = window.Nativo || null, NATIVO = !!(N && N.isNative);
  var D = null, aba = 'hoje', sub = null, hoje = L.hoje(), redSel = null, ck = null, editCk = false, sheet = null;
  var alarme = false, dispensadas = {}, confirmAv = false, chatEnv = false, chatErro = '', rascChat = '';
  var perm = NATIVO ? 'desconhecido' : 'indisponivel', agenda = { total: 0, ate: null, erro: '' };
  var CHAVE = 'remedios.dados';
  var OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var CHEV = '<svg class="chev" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6"/></svg>';

  function $(s, e) { return (e || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function med(id) { return D.meds.find(function (m) { return m.id === id; }); }
  function agoraMin() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function toast(t) { var el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(function () { el.classList.remove('on'); }, 2600); }
  function focoEmCampo() { var a = document.activeElement; return a && /INPUT|TEXTAREA|SELECT/.test(a.tagName); }

  /* ---------- persistência ---------- */
  async function ler() {
    var txt = null;
    try { txt = NATIVO ? (await N.Preferences.get({ key: CHAVE })).value : localStorage.getItem(CHAVE); } catch (e) {}
    try { return L.normalizar(txt ? JSON.parse(txt) : null); } catch (e) { return L.padrao(); }
  }
  async function gravar() {
    var txt = JSON.stringify(D);
    if (NATIVO) await N.Preferences.set({ key: CHAVE, value: txt }); else localStorage.setItem(CHAVE, txt);
  }
  async function salvar(msg) { await gravar(); render(); if (msg) toast(msg); reagendarLogo(); }

  /* ---------- notificações locais ---------- */
  async function verPerm() {
    if (!NATIVO) return;
    try { perm = (await N.LocalNotifications.checkPermissions()).display; } catch (e) { perm = 'erro'; }
  }
  async function pedirPerm() {
    try { perm = (await N.LocalNotifications.requestPermissions()).display; } catch (e) { perm = 'erro'; }
    if (perm === 'granted') { await reagendar(); toast('Lembretes ativados'); }
    else toast('Ative em Ajustes do iPhone › Notificações › Remédios');
    render();
  }
  var tReag = null, reagendando = false;
  function reagendarLogo() { clearTimeout(tReag); tReag = setTimeout(reagendar, 700); }
  async function reagendar() {
    if (!NATIVO || perm !== 'granted' || reagendando) return;
    reagendando = true;
    try {
      var pend = (await N.LocalNotifications.getPending()).notifications.filter(function (n) { return +n.id < 9000; });
      if (pend.length) await N.LocalNotifications.cancel({ notifications: pend.map(function (n) { return { id: n.id }; }) });
      var plano = L.planejarNotificacoes(D, new Date());
      if (plano.lista.length) await N.LocalNotifications.schedule({ notifications: plano.lista.map(function (n) {
        var o = { id: n.id, title: n.title, body: n.body, schedule: { at: new Date(n.at), allowWhileIdle: true }, extra: n.extra };
        if (n.extra.tipo === 'dose') o.actionTypeId = 'DOSE';
        return o;
      }) });
      agenda = { total: plano.lista.length, ate: plano.ate, erro: '' };
    } catch (e) { agenda.erro = e.message || String(e); }
    reagendando = false;
    if (aba === 'mais' && !sub && !sheet && !focoEmCampo()) render();
  }
  async function testarNotif() {
    if (!NATIVO) { toast('Notificações só funcionam no app instalado no iPhone'); return; }
    if (perm !== 'granted') { await pedirPerm(); if (perm !== 'granted') return; }
    await N.LocalNotifications.schedule({ notifications: [{ id: 9999, title: 'Teste do Remédios', body: 'Se você está vendo isto, os lembretes chegam. Bloqueie a tela para conferir.', schedule: { at: new Date(Date.now() + 5000) } }] });
    toast('Notificação de teste em 5 segundos');
  }
  function tratarAcaoNotif(ev) {
    var ex = (ev && ev.notification && ev.notification.extra) || {}, a = ev && ev.actionId;
    if (!D) return;
    if (ex.tipo === 'dose') {
      if (a === 'tomei') { L.marcar(D, ex.dia, ex.key, 'tomei'); aba = 'hoje'; salvar('Marcado às ' + L.hhmm()); return; }
      if (a === 'adiar') { adiar(ex.dia, ex.key); return; }
      aba = 'hoje'; sub = null; alarme = true; render(true); return;
    }
    if (ex.tipo === 'checkin') { aba = 'reducao'; sub = null; render(true); return; }
    if (ex.tipo === 'estoque') { aba = 'estoque'; sub = null; render(true); return; }
    if (ex.tipo === 'renovar') { aba = 'mais'; sub = null; render(true); }
  }
  function adiar(dia, key) {
    var lim = Date.now() - 864e5;
    Object.keys(D.adiamentos).forEach(function (k) { if (D.adiamentos[k] < lim) delete D.adiamentos[k]; });
    D.adiamentos[dia + '|' + key] = Date.now() + 10 * 6e4;
    salvar('Lembro de novo em 10 min');
  }

  /* ---------- alarme em tela cheia (dentro do app) ---------- */
  function pendentesAgora() {
    var now = agoraMin(), t = Date.now();
    return L.dosesDoDia(D, hoje).filter(function (d) {
      var ad = D.adiamentos[hoje + '|' + d.key];
      return d.status === 'pendente' && L.toMin(d.horario) <= now && !(ad && ad > t);
    });
  }
  function checarAlarme() {
    var now = agoraMin(), c = D.config;
    var urg = pendentesAgora().filter(function (d) { var atraso = now - L.toMin(d.horario); return atraso >= c.alarmeAposMin && atraso <= c.desistirAposMin && !dispensadas[hoje + '|' + d.key]; });
    if (urg.length && !alarme) { alarme = true; render(); }
  }

  /* ---------- Pílu ---------- */
  function pilu(humor, tam) {
    var rosto;
    if (humor === 'joy') rosto = '<path d="M43 59q5-7 10 0M67 59q5-7 10 0" fill="none" stroke="#11131A" stroke-width="3.5" stroke-linecap="round"/><path d="M51 67q9 11 18 0z" fill="#11131A"/><path d="M100 14l2.5 6.5 6.5 2.5-6.5 2.5-2.5 6.5-2.5-6.5-6.5-2.5 6.5-2.5z" fill="#FFD66B" stroke="#11131A" stroke-width="2" stroke-linejoin="round"/>';
    else if (humor === 'wow') rosto = '<circle cx="48" cy="57" r="6.5" fill="#11131A"/><circle cx="72" cy="57" r="6.5" fill="#11131A"/><circle cx="50" cy="55" r="2" fill="#fff"/><circle cx="74" cy="55" r="2" fill="#fff"/><ellipse cx="60" cy="71" rx="4" ry="5" fill="#11131A"/>';
    else rosto = '<g class="olhos"><circle cx="48" cy="58" r="5" fill="#11131A"/><circle cx="72" cy="58" r="5" fill="#11131A"/></g><path d="M53 69q7 6 14 0" fill="none" stroke="#11131A" stroke-width="3.5" stroke-linecap="round"/>';
    return '<svg width="' + tam + '" height="' + tam + '" viewBox="0 0 120 120" aria-hidden="true" style="display:block;overflow:visible"><g transform="rotate(-24 60 60)"><rect x="10" y="34" width="100" height="52" rx="26" fill="#fff" stroke="#11131A" stroke-width="4"/><path d="M60 34H36a26 26 0 0 0 0 52h24z" fill="#2F3CFF" stroke="#11131A" stroke-width="4"/></g>' + rosto + '<circle cx="41" cy="68" r="4" fill="#FF8A8A" opacity=".75"/><circle cx="79" cy="68" r="4" fill="#FF8A8A" opacity=".75"/></svg>';
  }
  function faixa(cls, titulo, texto, botao, attrs) {
    return '<div class="faixa ' + cls + '"><div class="txt"><b>' + esc(titulo) + '</b><small>' + esc(texto) + '</small></div>' + (botao ? '<button class="btn p" ' + attrs + '>' + esc(botao) + '</button>' : '') + '</div>';
  }

  /* ================= HOJE ================= */
  function vHoje() {
    var c = D.config, doses = L.dosesDoDia(D, hoje), now = agoraMin();
    var atr = function (d) { return d.status === 'pendente' && now - L.toMin(d.horario) >= c.alarmeAposMin; };
    var feitas = doses.filter(function (d) { return d.status !== 'pendente'; }).length, pend = doses.length - feitas;
    var alvo = doses.find(atr) || doses.find(function (d) { return d.status === 'pendente' && L.toMin(d.horario) >= now; }) || doses.find(function (d) { return d.status === 'pendente'; });
    var seq = L.sequencia(D, hoje);
    var titulo = !doses.length ? 'Hoje' : pend === 0 ? 'Tudo marcado hoje.' : pend === 1 ? 'Falta uma dose.' : 'Faltam ' + pend + ' doses.';
    var h = '<div class="cab"><div class="sub">' + esc(L.dataLonga(hoje)) + '</div><h1>' + esc(titulo) + '</h1></div>';
    h += '<div class="fichas"><div class="ficha"><span class="ic"><svg width="22" height="22" viewBox="0 0 20 20"><path d="M10 1.5c.6 3.2 4.8 5 4.8 9.6A4.8 4.8 0 0 1 10 16a4.8 4.8 0 0 1-4.8-4.9c0-2.3 1.4-3.6 2.4-4.6.2 1.6.9 2.6 1.9 3 0-2.6-.4-5.4.5-8z" fill="#fff"/></svg></span><div><b>' + seq + '</b><small>' + (seq === 1 ? 'dia seguido' : 'dias seguidos') + '</small></div></div>' +
      '<div class="ficha"><span class="ic azul"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><div><b>' + feitas + '/' + doses.length + '</b><small>doses hoje</small></div></div></div>';

    var av = [];
    if (NATIVO && perm !== 'granted' && D.meds.length) av.push(faixa('ambar', 'Lembretes desligados', perm === 'denied' ? 'As notificações foram negadas. Ative em Ajustes do iPhone › Notificações › Remédios.' : 'Permita as notificações para o app avisar na hora de cada dose.', perm === 'denied' ? '' : 'Ativar', 'data-acao="perm"'));
    var venc = c.assinaturaEm ? L.diff(hoje, L.addDays(c.assinaturaEm, 7)) : 99;
    if (NATIVO && venc <= 1) av.push(faixa('verm', venc <= 0 ? 'A instalação vence hoje' : 'A instalação vence amanhã', 'Renove no Sideloadly para o app continuar abrindo.', 'Ver', 'data-ir="mais"'));
    L.ativos(D).forEach(function (m) {
      var st = L.statusReducao(D, m, hoje);
      if (st && st.sugerirSegurar && !st.pausada && L.ativos(D).filter(function (x) { return x.reducao && x.reducao.ativa; })[0] === m) av.push(faixa('ambar', 'Sintomas médios ou fortes há 3 dias', 'A regra do plano sugere segurar a etapa e falar com seu médico.', 'Ver', 'data-ir="reducao"'));
      else if (st && st.prontaParaAvancar) av.push(faixa('azul', m.nome + ': etapa ' + (st.indice + 1) + ' concluída', 'Próxima: ' + (st.proxima.descricao || '') + '. Confirme quando estiver pronto.', 'Ver', 'data-ir="reducao" data-med="' + m.id + '"'));
      var p = L.passoPendente(D, m);
      if (p) av.push(faixa('ambar', m.nome + ' acaba em ~' + L.plural(p.dias, 'dia'), 'Próximo passo: ' + p.passo.nome, 'Ver', 'data-ir="estoque"'));
      if (m.estoqueConhecido === false) av.push(faixa('neutra', 'Quanto tem de ' + m.nome + '?', 'Informe o estoque para o app avisar antes de acabar.', 'Informar', 'data-acao="ajustar" data-med="' + m.id + '"'));
    });
    if (L.algumaReducaoAtiva(D) && !D.checkins[hoje]) av.push(faixa('azul', 'Check-in de hoje', '30 segundos. É isso que decide se a etapa avança.', 'Fazer', 'data-ir="reducao"'));

    if (!D.meds.length) {
      h += '<div class="card"><h2>Comece por aqui</h2><p class="suave peq">Cadastre seus remédios ou traga os dados do app de Windows (arquivo dados.json).</p><div class="grade2"><button class="btn prim" data-acao="novoMed">+ Remédio</button><button class="btn" data-acao="importar">Importar</button></div></div>';
    } else if (alvo) {
      var a = atr(alvo);
      h += '<div class="missao' + (a ? ' atrasada' : '') + '"><div class="topo-m"><div class="info"><div class="botoes" style="align-items:center;gap:12px"><span class="tag">' + (a ? 'Atrasada' : 'Próxima') + ' · ' + alvo.horario + '</span><div class="pontos">' +
        doses.map(function (d) { return '<i class="' + (d.status !== 'pendente' ? 'on' : '') + '"></i>'; }).join('') + '</div></div>' +
        '<div class="nome">' + esc(alvo.med.nome) + '</div><div class="det">' + esc([alvo.dosagem, L.plural(alvo.unidades, 'unidade')].filter(Boolean).join(' · ')) + '</div></div>' +
        '<div class="pilu">' + pilu(a ? 'wow' : 'happy', 104) + '</div></div>' +
        '<div class="acoes"><button class="btn claro" data-acao="tomei" data-key="' + alvo.key + '">' + OK + 'Tomei</button><button class="btn vazado" data-acao="pulei" data-key="' + alvo.key + '">Pular</button></div></div>';
    } else if (doses.length) {
      h += '<div class="missao completa"><div class="info"><span class="tag">Missão cumprida</span><div class="nome">Dia completo!</div><div class="det">' + L.plural(doses.length, 'dose marcada', 'doses marcadas') + '. Sequência: ' + L.plural(seq, 'dia') + '.</div></div><div class="pilu">' + pilu('joy', 110) + '</div></div>';
    }
    h += av.join('');
    if (doses.length) {
      h += '<div class="cab" style="padding-top:8px;gap:10px"><div class="linha-sep"><h2>Linha do dia</h2><span class="peq suave">' + feitas + ' de ' + doses.length + ' marcadas</span></div><div class="barra"><div style="width:' + Math.round(feitas / doses.length * 100) + '%"></div></div></div>';
      h += '<div class="lista">' + doses.map(function (d) {
        var a = atr(d), f = d.status !== 'pendente', acoes;
        if (d.status === 'tomei') acoes = '<button class="btn feito" data-acao="desfazer" data-key="' + d.key + '" aria-label="Desfazer">' + OK + esc(d.em) + '</button>';
        else if (d.status === 'pulei') acoes = '<span class="selo">pulada</span><button class="btn link p" data-acao="desfazer" data-key="' + d.key + '">desfazer</button>';
        else acoes = '<button class="btn link p" data-acao="pulei" data-key="' + d.key + '">pular</button><button class="btn prim" data-acao="tomei" data-key="' + d.key + '">Tomei</button>';
        return '<div class="dose' + (a ? ' atrasada' : f ? ' feita' : '') + '"><div class="hora"><b>' + d.horario + '</b><span>' + (a ? 'atrasada' : L.periodo(d.horario)) + '</span></div>' +
          '<div class="nome"><b>' + esc(d.med.nome) + '</b><span>' + esc([d.dosagem, L.plural(d.unidades, 'un.', 'un.'), d.reduzindo ? 'redução' : ''].filter(Boolean).join(' · ')) + '</span></div><div class="acoes">' + acoes + '</div></div>';
      }).join('') + '</div>';
    }
    return '<div class="pilha">' + h + '</div>';
  }

  /* ================= REDUÇÃO ================= */
  var INFO = [
    [/pregabalina/i, [['Não pare de uma vez', 'A bula da pregabalina orienta retirada gradual, ao longo de pelo menos uma semana. Parar de repente pode causar abstinência.'], ['Sinais comuns ao reduzir', 'Insônia, ansiedade, náusea, dor de cabeça, suor, diarreia e sensação de gripe. Costumam ser temporários — é por isso que o check-in existe.']]],
    [/ritalin|metilfenidato/i, [['Cápsula LA', 'Engula inteira; não mastigue nem esmague as microesferas. Reduções costumam ser feitas trocando para uma concentração menor prescrita.'], ['Sinais comuns ao reduzir', 'Cansaço, sono aumentado, mais apetite e humor mais baixo nos primeiros dias. Humor muito baixo ou persistente: fale com seu médico.']]],
    [/sertralina/i, [['Não pare de uma vez', 'Parar a sertralina de repente pode causar tontura, “choquinhos”, irritabilidade, náusea e alterações de sono. Reduções são graduais.']]],
    [/propranolol|propanolol/i, [['Não pare de uma vez', 'Interromper o propranolol de repente pode causar efeito rebote: coração acelerado, palpitações e pressão mais alta.']]]
  ];
  function vReducao() {
    var com = L.ativos(D).filter(function (m) { return m.reducao && m.reducao.ativa; });
    var sem = L.ativos(D).filter(function (m) { return !(m.reducao && m.reducao.ativa); });
    if (!redSel || !com.some(function (m) { return m.id === redSel; })) redSel = com[0] ? com[0].id : null;
    var h = '<div class="cab"><h1>Redução</h1><p class="intro">O ritmo e as doses vêm do plano combinado com seu médico. O app acompanha e segura a etapa se o corpo pedir.</p></div>';
    if (com.length > 1) h += '<div class="segm">' + com.map(function (m) { return '<button class="' + (m.id === redSel ? 'on' : '') + '" data-acao="redsel" data-med="' + m.id + '">' + esc(m.nome) + '</button>'; }).join('') + '</div>';
    if (redSel) {
      var m = med(redSel), st = L.statusReducao(D, m, hoje), e = st.etapa, px = st.proxima;
      var forte = st.prontaParaAvancar || confirmAv;
      var rotAv = confirmAv ? (st.sugerirSegurar ? 'Sintomas fortes — confirmar mesmo assim?' : st.faltam > 0 ? 'Antes do previsto — confirmar?' : 'Confirmar?') : 'Ir para etapa ' + (st.indice + 2);
      var quando = st.ultima ? 'Última etapa' : st.pausada ? 'Contagem em pausa' : st.faltam > 0 ? 'em ' + L.plural(st.faltam, 'dia') + ' (' + L.curta(st.dataProxima) + ')' : 'Etapa concluída';
      h += '<div class="etapa"><div class="r"><span>' + esc(m.nome) + ' · etapa atual</span><span>desde ' + L.curta(m.reducao.etapaInicio) + '</span></div>' +
        '<div class="grande">' + (st.indice + 1) + ' de ' + st.total + (st.pausada ? ' · em pausa' : '') + '</div>' +
        '<div class="segs">' + m.reducao.etapas.map(function (_x, i) { return '<div class="' + (i <= st.indice ? 'on' : '') + '"></div>'; }).join('') + '</div>' +
        '<div class="caixas"><div class="caixa"><small>Agora</small><b>' + esc(e.descricao || L.num(e.unidadesPorDose) + ' un.') + '</b><small>' + esc(e.horarios.join(', ')) + ' · ' + L.num(e.unidadesPorDose) + ' un./dose</small></div>' +
        '<div class="caixa"><small>' + (px ? 'Depois' : 'Fim do plano') + '</small><b>' + esc(px ? px.descricao || L.num(px.unidadesPorDose) + ' un.' : '—') + '</b><small>' + esc(quando) + '</small></div></div>' +
        (st.ultima ? '' : '<button class="btn ' + (forte ? 'claro' : 'vazado') + '" data-acao="avancar" data-med="' + m.id + '">' + esc(rotAv) + '</button>') +
        '<div class="grade2"><button class="btn vazado" data-acao="pausar" data-med="' + m.id + '">' + (st.pausada ? 'Retomar' : 'Segurar etapa') + '</button><button class="btn vazado" data-acao="plano" data-med="' + m.id + '">Editar plano</button></div></div>';
    }
    h += vCheckin();
    var seg = L.precisaSegurar(D, hoje);
    h += '<div class="faixa ' + (seg ? 'ambar' : 'neutra') + '"><div class="txt"><b>Regra de segurança</b><small>Sintoma “médio” ou “forte” por 3 dias seguidos: o app não sugere avançar e recomenda falar com seu médico antes de reduzir de novo.' + (seg ? ' Isso está acontecendo agora.' : '') + '</small></div></div>';
    if (sem.length) h += '<div class="card"><h2>Montar um plano</h2><p class="suave peq">Cadastre as etapas que o médico passou. A partir de hoje, os lembretes e o estoque seguem a etapa atual.</p><div class="botoes">' + sem.map(function (m) { return '<button class="btn cont p" data-acao="plano" data-med="' + m.id + '">+ ' + esc(m.nome) + '</button>'; }).join('') + '</div></div>';
    if (redSel) {
      var achou = INFO.find(function (i) { return i[0].test(med(redSel).nome); });
      h += '<h3 style="margin:8px 4px 0">O que saber</h3>' + (achou ? achou[1] : [['Com orientação', 'Mudanças de dose devem seguir o plano combinado com seu médico.']]).map(function (i) { return '<div class="info-c"><b>' + esc(i[0]) + '</b><p>' + esc(i[1]) + '</p></div>'; }).join('');
    }
    h += '<div class="info-c alerta"><b>Procure atendimento na hora</b><p>Convulsão, confusão forte, dor no peito ou pensamentos de se machucar: SAMU 192. Para conversar agora: CVV 188 (24 h, gratuito).</p></div>';
    h += '<div class="card"><h2>Resumo para a consulta</h2><p class="suave peq">Doses marcadas, etapas e check-ins dos últimos 30 dias, em texto simples.</p><button class="btn" data-acao="resumo"><svg viewBox="0 0 24 24" style="stroke-width:2.2"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>Compartilhar resumo</button></div>';
    return '<div class="pilha">' + h + '</div>';
  }
  function vCheckin() {
    var salvo = D.checkins[hoje];
    if (salvo && !editCk) {
      var alt = L.SINTOMAS.filter(function (s) { return (salvo[s.id] || 0) >= 1; });
      return '<div class="card" style="gap:6px"><div class="linha-sep"><h2>Check-in feito</h2><button class="btn link p" data-acao="editarCk">editar</button></div><p class="suave" style="font-size:14px">' +
        esc((alt.length ? alt.map(function (s) { return s.nome + ': ' + L.NIVEIS[salvo[s.id]]; }).join(' · ') : 'Tudo ok.') + (salvo.nota ? ' — ' + salvo.nota : '')) + '</p></div>';
    }
    if (!ck) ck = Object.assign({}, salvo || {});
    return '<div class="card" style="gap:14px"><div><h2>Check-in de hoje</h2><p class="suave peq" style="margin-top:4px">Como você está hoje? Vale para todos os planos.</p></div>' +
      L.SINTOMAS.map(function (s) {
        var v = ck[s.id] || 0;
        return '<div class="sint"><span>' + esc(s.nome) + '</span><div class="niveis">' + L.NIVEIS.map(function (n, i) { return '<button aria-pressed="' + (v === i) + '" class="' + (v === i ? 'n' + i : '') + '" data-acao="nivel" data-s="' + s.id + '" data-n="' + i + '">' + n + '</button>'; }).join('') + '</div></div>';
      }).join('') +
      '<label class="campo">Anotação (opcional)<textarea id="notaCk" rows="2">' + esc(ck.nota || '') + '</textarea></label>' +
      '<button class="btn prim" style="height:50px;font-size:15px" data-acao="salvarCk">Salvar check-in</button></div>';
  }

  /* ================= ESTOQUE ================= */
  function vEstoque() {
    var c = D.config;
    var h = '<div class="cab"><h1>Estoque</h1><p class="intro">Desce sozinho quando você marca uma dose. Os avisos começam ' + c.pedirReceitaDias + ' dias antes de acabar, para a receita nunca virar o gargalo.</p></div>';
    var ms = L.ativos(D);
    if (!ms.length) h += '<div class="card suave">Nenhum remédio ativo. Cadastre em Ajustes › Remédios.</div>';
    h += ms.map(function (m) {
      var dr = L.diasRestantes(m), baixo = dr != null && dr <= c.pedirReceitaDias, pp = L.passoPendente(D, m), r = m.reposicao;
      var num = m.estoqueConhecido === false ? '<div class="botoes" style="align-items:baseline;gap:10px"><div class="num-grande neutro">?</div><div class="peq suave">estoque não informado</div></div>' :
        '<div class="botoes" style="align-items:baseline;gap:10px"><div class="num-grande' + (baixo ? ' ambar' : '') + '">' + (dr == null ? '—' : L.plural(Math.floor(dr), 'dia')) + '</div><div class="peq suave">' + L.num(m.estoque) + ' un. · ' + L.num(L.porDia(m)) + '/dia · acaba ' + L.curta(L.dataFim(m, hoje)) + '</div></div>' +
        '<div class="barra' + (baixo ? ' ambar' : '') + '"><div style="width:' + Math.min(100, Math.round((dr || 0) / 30 * 100)) + '%"></div></div>';
      var passos = L.passosDe(m).map(function (p) {
        var on = !!r[p.id], ag = pp && pp.passo.id === p.id;
        return '<div class="passo' + (ag ? ' agora' : '') + '"><button class="check' + (on ? ' on' : '') + '" aria-pressed="' + on + '" aria-label="' + esc(p.nome) + '" data-acao="passo" data-med="' + m.id + '" data-p="' + p.id + '">' + (on ? '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : '') + '</button><span class="t">' + esc(p.nome) + '</span>' +
          (on ? '<span class="quando">' + L.curta(r[p.id]) + '</span>' : ag ? '<span class="selo ambar">agora</span>' : '') + '</div>';
      }).join('');
      return '<div class="card" style="gap:10px"><h2>' + esc(m.nome) + (m.dosagem ? ' <span class="suave" style="font:400 15px var(--sans)">' + esc(m.dosagem) + '</span>' : '') + '</h2>' + num +
        '<div class="peq suave">' + esc(L.TIPOS_RECEITA[m.receita] || m.receita) + '</div><div>' + passos + '</div>' +
        '<div class="grade2">' + (m.receita !== 'semReceita' ? '<button class="btn p" style="height:40px" data-acao="msgMedico" data-med="' + m.id + '">Msg. ao médico</button>' : '') + '<button class="btn p" style="height:40px" data-acao="msgFarmacia" data-med="' + m.id + '">Msg. à farmácia</button></div>' +
        '<div class="botoes" style="align-items:center"><button class="btn prim" style="flex:1" data-acao="reabastecer" data-med="' + m.id + '">Chegou remédio</button><button class="btn link sub-l" data-acao="ajustar" data-med="' + m.id + '">ajustar</button></div></div>';
    }).join('');
    h += faixa('neutra', 'Por que o pedido não é 100% automático', 'Ritalina, pregabalina e sertralina são controladas: a farmácia precisa reter a receita física. O app prepara tudo até a retirada.');
    return '<div class="pilha">' + h + '</div>';
  }

  /* ================= ASSISTENTE ================= */
  function vAssistente() {
    var a = D.assistente;
    var h = '<div class="cab"><div class="cab-linha"><h1>Assistente</h1>' + (a.mensagens.length ? '<button class="btn p" data-acao="chatNovo">Nova conversa</button>' : '') + '</div><p class="intro">Evolução, tolerabilidade e raciocínio farmacológico a partir dos seus registros. O plano é alterado só por você.</p></div>';
    if (!a.chave) {
      h += '<form class="card" id="formChave" data-form="chave"><h2>Conecte seu Gemini</h2><p class="suave peq">Cole uma chave da API do Google AI Studio. Ela fica guardada só neste iPhone.</p>' +
        '<label class="campo">Chave da API<input name="chave" type="password" autocomplete="off" required placeholder="Cole sua chave"></label>' +
        '<label class="campo">Modelo<input name="modelo" required value="' + esc(a.modelo) + '"></label>' +
        '<div class="grade2"><button type="button" class="btn" data-acao="aistudio">Obter chave</button><button class="btn prim">Salvar</button></div></form>';
      return '<div class="pilha">' + h + '</div>';
    }
    if (!a.mensagens.length) {
      h += '<div class="card" style="gap:10px"><h3>O que você quer investigar?</h3>' + ATALHOS.map(function (t, i) { return '<button class="btn cont" style="justify-content:flex-start;height:auto;min-height:44px;padding:10px 14px;white-space:normal;text-align:left" data-acao="atalho" data-i="' + i + '">' + esc(t[0]) + '</button>'; }).join('') + '</div>';
    }
    h += '<div class="lista" style="gap:12px">' + a.mensagens.map(function (m) {
      var u = m.role === 'user';
      return '<div class="msg' + (u ? ' user' : '') + '"><div class="quem">' + (u ? 'Você' + (m.anexo ? ' · registros de ' + a.dias + ' dias anexados' : '') : 'Gemini') + '</div><div class="texto">' + esc(m.texto) + '</div>' + (m.incompleta ? '<small class="suave">Resposta cortada pelo limite de tamanho. Peça para continuar.</small>' : '') + '</div>';
    }).join('') + (chatEnv ? '<p class="suave" style="margin:0 4px">Gemini está analisando sua pergunta…</p>' : '') + '</div>';
    h += '<p class="erro" style="margin:0 4px">' + esc(chatErro) + '</p>';
    h += '<div class="compor"><textarea id="chatTexto" rows="3" placeholder="Conte o que mudou e o que você quer avaliar…"' + (chatEnv ? ' disabled' : '') + '>' + esc(rascChat) + '</textarea><div class="rodape">' +
      '<button class="marcar' + (a.anexar !== false ? ' on' : '') + '" data-acao="anexo"><i><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></i>Anexar registros de ' + a.dias + ' dias</button>' +
      '<button class="enviar" data-acao="enviar" aria-label="Enviar"' + (chatEnv ? ' disabled' : '') + '><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></div></div>';
    h += '<p class="mini suave" style="margin:0 4px">Com o anexo ligado, remédios, planos, doses e check-ins do período vão para a API do Google junto com a mensagem.</p>';
    h += '<details class="card cfg"><summary>Configurar assistente</summary><form id="formAssist" data-form="assist" class="pilha" style="margin-top:12px">' +
      '<label class="campo">Período de registros<select name="dias">' + [7, 30, 90].map(function (d) { return '<option value="' + d + '"' + (+a.dias === d ? ' selected' : '') + '>' + d + ' dias</option>'; }).join('') + '</select></label>' +
      '<label class="campo">Modelo<input name="modelo" required value="' + esc(a.modelo) + '"></label>' +
      '<label class="campo">Prompt inicial<textarea name="prompt" rows="8">' + esc(a.prompt) + '</textarea></label>' +
      '<div class="grade2"><button type="button" class="btn perigo p" data-acao="removerChave">Remover chave</button><button class="btn prim p">Salvar</button></div></form></details>';
    return '<div class="pilha">' + h + '</div>';
  }
  var ATALHOS = [
    ['Analisar minha evolução', 'Analise minha evolução documentada, tempo de uso e tolerabilidade. Diferencie dados registrados, hipóteses e lacunas.'],
    ['Revisar horários e registros', 'Revise meus horários previstos e os registros de tomada. Quais padrões aparecem e quais conclusões os dados ainda não permitem?'],
    ['Discutir hipóteses de ajuste', 'Que hipóteses de manter, aumentar ou reduzir doses merecem discussão clínica, considerando minha evolução? Explique mecanismos, riscos e informações que faltam.']
  ];
  async function enviarChat(texto) {
    var a = D.assistente;
    texto = String(texto || rascChat || '').trim();
    if (!texto || chatEnv || !a.chave) return;
    var anexar = a.anexar !== false;
    a.mensagens.push({ role: 'user', texto: texto, anexo: anexar });
    rascChat = ''; chatEnv = true; chatErro = '';
    await gravar(); render(); rolarFim();
    try {
      var ult = a.mensagens.length - 1;
      var contents = a.mensagens.map(function (m, i) {
        var t = m.texto;
        if (i === ult && anexar) t += '\n\n[Registros dos últimos ' + a.dias + ' dias, em JSON]\n' + JSON.stringify(L.contexto(D, hoje, +a.dias));
        return { role: m.role === 'user' ? 'user' : 'model', parts: [{ text: t }] };
      });
      var r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(a.modelo) + ':generateContent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': a.chave },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: a.prompt }] }, contents: contents })
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error((j.error && j.error.message) || 'Erro ' + r.status + ' na API do Gemini.');
      var cand = j.candidates && j.candidates[0];
      var txt = cand && cand.content && cand.content.parts ? cand.content.parts.map(function (p) { return p.text || ''; }).join('') : '';
      if (!txt) throw new Error('O Gemini não devolveu texto' + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : '') + '.');
      a.mensagens.push({ role: 'model', texto: txt, incompleta: cand.finishReason === 'MAX_TOKENS' });
    } catch (e) {
      chatErro = (e && e.message) || 'Falha de conexão.';
      if (/fetch|network|internet/i.test(chatErro)) chatErro = 'Sem conexão com a internet. A mensagem fica salva; tente de novo.';
    }
    chatEnv = false; await gravar(); render(); rolarFim();
  }
  function rolarFim() { var t = $('#tela'); t.scrollTop = t.scrollHeight; }

  /* ================= AJUSTES ================= */
  function vAjustes() {
    var c = D.config;
    var st = !NATIVO ? 'Rodando no navegador: notificações só funcionam no app instalado.' :
      perm === 'granted' ? (agenda.erro ? 'Erro ao agendar: ' + agenda.erro : agenda.total ? agenda.total + ' lembretes agendados' + (agenda.ate ? ', cobrindo doses até ' + L.curta(agenda.ate) : '') + '. Abrir o app renova a agenda.' : 'Nenhum lembrete pendente agora.') :
      perm === 'denied' ? 'Notificações negadas. Ative em Ajustes do iPhone › Notificações › Remédios.' : 'Notificações ainda não permitidas.';
    var h = '<h1 style="margin:6px 4px 4px">Ajustes</h1><div class="rot">Alertas</div>' +
      '<div class="card"><p style="font-size:14px;color:#3A3E4A">Se você não marcar a dose, o iPhone insiste: notificação na hora e repetições. Ao abrir o app com dose atrasada, o alarme aparece em tela cheia.</p>' +
      '<div class="grade2"><button class="btn prim" data-acao="' + (NATIVO && perm !== 'granted' && perm !== 'denied' ? 'perm' : 'testarNotif') + '">' + (NATIVO && perm !== 'granted' && perm !== 'denied' ? 'Ativar lembretes' : 'Testar notificação') + '</button><button class="btn" data-acao="testarAlarme">Ver alarme</button></div>' +
      '<p class="mini suave">' + esc(st) + ' Foco/Não Perturbe silencia os lembretes.</p></div>' +
      '<div class="rot">Escada de insistência</div><div class="grupo">' +
      [['repetirMin', 'Repetir a cada', ' min', 5, 5], ['alarmeAposMin', 'Alarme após', ' min', 5, 5], ['desistirAposMin', 'Desistir após', ' min', 10, 10], ['pedirReceitaDias', 'Pedir receita antes', ' dias', 1, 1]].map(function (s) {
        return '<div class="item" style="padding-right:12px"><span class="rotulo">' + s[1] + '</span><div class="stepper"><button data-acao="passoCfg" data-k="' + s[0] + '" data-d="-' + s[3] + '" data-min="' + s[4] + '" aria-label="Diminuir">−</button><span>' + c[s[0]] + s[2] + '</span><button data-acao="passoCfg" data-k="' + s[0] + '" data-d="' + s[3] + '" data-min="' + s[4] + '" aria-label="Aumentar">+</button></div></div>';
      }).join('') + '</div><p class="mini suave" style="margin:0 4px">O iOS guarda até 64 lembretes por app; as repetições valem para as próximas 36 horas. Cada remédio pode ter um horário-limite.</p>' +
      '<div class="rot">Outros avisos</div><div class="grupo">' +
      '<label class="item"><span class="rotulo">Check-in da redução</span><input type="time" data-cfg="checkinHora" value="' + esc(c.checkinHora) + '"></label>' +
      '<label class="item"><span class="rotulo">Avisos de reposição</span><input type="time" data-cfg="avisosReposicaoHora" value="' + esc(c.avisosReposicaoHora) + '"></label></div>' +
      '<div class="rot">Contatos para os pedidos</div><div class="grupo">' +
      [['medico.nome', 'Médico(a)', 'Dra. …', 'text'], ['medico.whatsapp', 'WhatsApp', '11 91234-5678', 'tel'], ['farmacia.nome', 'Farmácia', 'Nome da farmácia', 'text'], ['farmacia.whatsapp', 'WhatsApp', '11 91234-5678', 'tel']].map(function (f) {
        var p = f[0].split('.');
        return '<label class="item esq"><span class="rot-f">' + f[1] + '</span><input type="' + f[3] + '" data-cfg="' + f[0] + '" value="' + esc(c[p[0]][p[1]]) + '" placeholder="' + f[2] + '"></label>';
      }).join('') + '</div><p class="mini suave" style="margin:0 4px">Com o WhatsApp preenchido, os botões de mensagem abrem a conversa com o texto pronto. Sem número, o texto é copiado.</p>' +
      '<div class="rot">Remédios e dados</div><div class="grupo">' +
      '<button class="item" data-acao="abrirRemedios"><span class="icone-q"><svg viewBox="0 0 24 24"><path d="M10.5 20.5a4.95 4.95 0 0 1-7-7l6-6a4.95 4.95 0 0 1 7 7zM8.5 8.5l7 7"/></svg></span><span class="rotulo">Remédios</span><span class="det">' + L.plural(D.meds.length, 'remédio') + '</span>' + CHEV + '</button>' +
      '<button class="item" data-acao="exportar"><span class="rotulo">Exportar dados (.json)</span>' + CHEV + '</button>' +
      '<button class="item" data-acao="importar"><span class="rotulo">Importar dados</span><span class="det">do Windows ou backup</span>' + CHEV + '</button></div>' +
      '<p class="mini suave" style="margin:0 4px">Os dados ficam só neste iPhone. Apagar o app apaga os dados: exporte uma cópia de vez em quando.</p>';
    if (NATIVO) {
      var venc = L.addDays(c.assinaturaEm || hoje, 7), resta = L.diff(hoje, venc);
      h += '<div class="rot">Instalação (Sideloadly)</div><div class="grupo"><div class="item"><span class="rotulo">Renovada em ' + L.curta(c.assinaturaEm || hoje) + '</span><span class="det" style="color:' + (resta <= 1 ? 'var(--vermelho)' : 'var(--suave)') + '">vence ' + L.curta(venc) + '</span></div>' +
        '<button class="item" data-acao="renovei"><span class="rotulo" style="color:var(--azul);font-weight:600">Renovei hoje</span></button></div>' +
        '<p class="mini suave" style="margin:0 4px">Com Apple ID gratuito, a instalação vale 7 dias. Um dia antes, o app avisa. Toque em “Renovei hoje” depois de cada renovação.</p>';
    }
    h += '<div class="rodape-v">v0.5.0 · iOS' + (NATIVO ? '' : ' · navegador') + '</div>';
    return '<div class="pilha" style="gap:12px">' + h + '</div>';
  }
  function vRemedios() {
    var h = '<button class="voltar" data-acao="voltar"><svg viewBox="0 0 12 20"><path d="M10 2L2 10l8 8"/></svg>Ajustes</button>' +
      '<div class="cab-linha" style="padding:0 4px"><h1>Remédios</h1><button class="btn-mais" data-acao="novoMed" aria-label="Novo remédio"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button></div>' +
      '<p class="intro" style="margin:0 4px">Horários e doses normais. Durante um plano de redução, valem os da etapa atual.</p>';
    h += '<div class="lista">' + (D.meds.length ? D.meds.map(function (m) {
      return '<button class="remedio' + (m.ativo === false ? ' inativo' : '') + '" data-acao="editarMed" data-med="' + m.id + '"><div class="corpo"><div><b>' + esc(m.nome) + '</b>' +
        (m.reducao && m.reducao.ativa ? '<span class="selo azul" style="height:22px;font-size:11px">em redução</span>' : '') + (m.ativo === false ? '<span class="selo" style="height:22px;font-size:11px">inativo</span>' : '') + '</div>' +
        '<span class="d">' + esc([m.dosagem, m.horarios.join(', '), L.num(m.unidadesPorDose) + ' un./dose', m.horaLimite ? 'limite ' + m.horaLimite : ''].filter(Boolean).join(' · ')) + '</span></div>' + CHEV + '</button>';
    }).join('') : '<div class="card suave">Nenhum remédio cadastrado.</div>') + '</div>';
    return '<div class="pilha">' + h + '</div>';
  }

  /* ================= FOLHAS ================= */
  function abrirMed(m) {
    sheet = { tipo: 'med', id: m ? m.id : null, erro: '', confirmar: false, d: m ? { nome: m.nome, dosagem: m.dosagem, horarios: m.horarios.join(', '), un: m.unidadesPorDose, estoque: m.estoqueConhecido === false ? '' : String(m.estoque).replace('.', ','), receita: m.receita, horaLimite: m.horaLimite, inicioTratamento: m.inicioTratamento, ativo: m.ativo !== false }
      : { nome: '', dosagem: '', horarios: '08:00', un: 1, estoque: '', receita: 'comum', horaLimite: '', inicioTratamento: '', ativo: true } };
    render();
  }
  function abrirQtd(m, modo) { sheet = { tipo: 'qtd', id: m.id, modo: modo, erro: '', d: { q: modo === 'ajustar' && m.estoqueConhecido !== false ? String(m.estoque).replace('.', ',') : '' } }; render(); }
  function abrirPlano(m) {
    var r = m.reducao && m.reducao.ativa ? m.reducao : null;
    sheet = { tipo: 'plano', id: m.id, erro: '', confirmar: false, d: r ? { seq: r.etapas.map(function (e) { return L.num(e.unidadesPorDose); }).join(' '), dias: String(r.etapas[0].dias), horarios: r.etapas[0].horarios.join(', ') }
      : { seq: L.num(m.unidadesPorDose) + ' ' + L.num(m.unidadesPorDose / 2), dias: '7', horarios: m.horarios.join(', ') } };
    render();
  }
  function lerSheet() {
    var f = $('#formSheet'); if (!sheet || !f) return;
    new FormData(f).forEach(function (v, k) { sheet.d[k] = v; });
  }
  function campo(rot, nome, valor, tipo, ph, extra) {
    return '<label class="item"><span class="rot-f">' + rot + '</span><input name="' + nome + '" type="' + (tipo || 'text') + '" value="' + esc(valor) + '" placeholder="' + esc(ph || '') + '"' + (extra || '') + '></label>';
  }
  function vSheet() {
    if (!sheet) return '';
    var s = sheet, d = s.d, corpo = '', titulo = '';
    if (s.tipo === 'med') {
      titulo = s.id ? 'Editar ' + d.nome : 'Novo remédio';
      var RC = [['comum', 'Simples'], ['especial', 'Especial'], ['B', 'Azul B'], ['A', 'Amarela A'], ['semReceita', 'Sem']];
      corpo = '<div class="grupo plano">' + campo('Nome', 'nome', d.nome, 'text', 'Obrigatório') + campo('Dosagem', 'dosagem', d.dosagem, 'text', '150 mg') +
        campo('Horários', 'horarios', d.horarios, 'text', '08:00, 20:00', ' inputmode="numbers"') + campo('Estoque (un.)', 'estoque', d.estoque, 'text', 'não sei', ' inputmode="decimal"') +
        campo('Horário-limite', 'horaLimite', d.horaLimite, 'time') + campo('Início', 'inicioTratamento', d.inicioTratamento, 'date', '', ' max="' + hoje + '"') +
        '<div class="item" style="padding-right:12px"><span class="rotulo suave" style="font-size:14px">Unidades por dose</span><div class="stepper"><button type="button" data-acao="unSheet" data-d="-0.25">−</button><span>' + L.num(+d.un) + '</span><button type="button" data-acao="unSheet" data-d="0.25">+</button></div></div></div>' +
        '<div class="rot">Tipo de receita</div><div class="segm p">' + RC.map(function (r) { return '<button type="button" class="' + (d.receita === r[0] ? 'on' : '') + '" data-acao="receitaSheet" data-r="' + r[0] + '">' + r[1] + '</button>'; }).join('') + '</div>' +
        '<div class="grupo plano"><div class="item"><span class="rotulo">Ativo</span><button type="button" class="chave' + (d.ativo ? ' on' : '') + '" data-acao="ativoSheet" aria-label="Ativo"></button></div></div>' +
        (s.id ? '<button type="button" class="btn perigo" style="height:48px" data-acao="excluirSheet">' + (s.confirmar ? 'Toque de novo para excluir (o histórico some)' : 'Excluir remédio') + '</button>' : '');
    } else if (s.tipo === 'qtd') {
      var m = med(s.id), reab = s.modo === 'reabastecer';
      titulo = reab ? 'Chegou ' + m.nome : 'Estoque de ' + m.nome;
      corpo = '<div class="qtd"><span class="peq suave" style="font-weight:600">' + (reab ? 'Quantas unidades chegaram?' : 'Quantas unidades você tem agora?') + '</span><input name="q" inputmode="decimal" value="' + esc(d.q) + '" placeholder="0" autocomplete="off"><span class="peq suave">unidades</span>' +
        '<div class="botoes">' + [10, 30, 60].map(function (n) { return '<button type="button" class="btn cont p" data-acao="somaQ" data-n="' + n + '">+' + n + '</button>'; }).join('') + '</div></div>' +
        '<p class="peq suave" style="margin:0 4px">' + (reab ? 'Isso soma ao estoque e reinicia a lista de reposição.' : 'Substitui o estoque atual.') + '</p>';
    } else if (s.tipo === 'plano') {
      var mp = med(s.id);
      titulo = 'Plano · ' + mp.nome;
      corpo = '<p class="peq suave" style="margin:0 4px">Uma quantidade por etapa, em unidades (não miligramas). O app não escolhe as doses.</p><div class="grupo plano">' +
        campo('Sequência', 'seq', d.seq, 'text', '1 0,75 0,5') + campo('Dias por etapa', 'dias', d.dias, 'number', '7', ' min="1" max="3650"') + campo('Horários', 'horarios', d.horarios, 'text', '08:00, 20:00') + '</div>' +
        '<div class="previa" id="previa">' + previaPlano(mp, d) + '</div>' +
        '<p class="mini suave" style="margin:0 4px">O plano começa hoje na etapa 1. A passagem de etapa é confirmada por você.</p>' +
        (mp.reducao && mp.reducao.ativa ? '<button type="button" class="btn perigo" style="height:48px" data-acao="excluirSheet">' + (s.confirmar ? 'Toque de novo: lembretes voltam ao normal' : 'Encerrar plano') + '</button>' : '');
    }
    return '<div class="folha-fundo"><div class="vel" data-acao="fecharSheet"></div><form class="folha" id="formSheet" data-form="sheet" autocomplete="off"><div class="alca"></div>' +
      '<div class="barra-f"><button type="button" class="cancelar" data-acao="fecharSheet">Cancelar</button><b>' + esc(titulo) + '</b><button class="btn prim p">Salvar</button></div>' +
      corpo + '<p class="erro" style="margin:0 4px">' + esc(s.erro) + '</p></form></div>';
  }
  function previaPlano(m, d) {
    try {
      var et = L.etapasRapidas(m, d.seq, d.dias, d.horarios), data = hoje;
      return '<b style="font-size:14px">Prévia · ' + L.plural(et.length, 'etapa') + ' · ' + et.reduce(function (a, e) { return a + e.dias; }, 0) + ' dias</b>' + et.map(function (e, i) {
        var ini = data; data = L.addDays(data, e.dias);
        return '<div class="l"><span class="n">' + (i + 1) + '</span><div><b style="font-size:14px">' + L.num(e.unidadesPorDose) + ' un./dose</b><small>' + esc(e.horarios.join(' · ')) + ' · ' + L.curta(ini) + ' → ' + L.curta(L.addDays(ini, e.dias - 1)) + '</small></div></div>';
      }).join('');
    } catch (e) { return '<span class="peq">' + esc(e.message) + '</span>'; }
  }
  function salvarSheet() {
    lerSheet();
    var s = sheet, d = s.d;
    if (s.tipo === 'med') {
      var hs = L.parseHorarios(d.horarios);
      if (!String(d.nome).trim()) { s.erro = 'Informe o nome.'; return render(); }
      if (!hs) { s.erro = 'Horários no formato 08:00, 20:00.'; return render(); }
      if (d.horaLimite && !L.horarioValido(d.horaLimite)) d.horaLimite = '';
      var est = String(d.estoque).trim().replace(',', '.');
      if (est !== '' && !(+est >= 0)) { s.erro = 'Estoque inválido.'; return render(); }
      var alvo = s.id ? med(s.id) : { id: L.uid(), reducao: null, reposicao: {} };
      Object.assign(alvo, { nome: String(d.nome).trim(), dosagem: String(d.dosagem).trim(), horarios: hs, unidadesPorDose: +d.un || 1, estoqueConhecido: est !== '', estoque: est === '' ? 0 : +est,
        receita: d.receita, horaLimite: d.horaLimite || '', inicioTratamento: d.inicioTratamento || '', ativo: !!d.ativo });
      if (!s.id) D.meds.push(L.normMed(alvo));
      sheet = null; salvar('Salvo'); return;
    }
    if (s.tipo === 'qtd') {
      var m = med(s.id), q = +String(d.q).trim().replace(',', '.');
      if (String(d.q).trim() === '' || isNaN(q) || q < 0) { s.erro = 'Número inválido.'; return render(); }
      if (s.modo === 'reabastecer') { m.estoque = (m.estoqueConhecido === false ? 0 : m.estoque) + q; m.reposicao = {}; } else m.estoque = q;
      m.estoqueConhecido = true;
      sheet = null; salvar(s.modo === 'reabastecer' ? 'Estoque atualizado' : 'Estoque ajustado'); return;
    }
    if (s.tipo === 'plano') {
      var mp = med(s.id), et;
      try { et = L.etapasRapidas(mp, d.seq, d.dias, d.horarios); } catch (e) { s.erro = e.message; return render(); }
      mp.reducao = { ativa: true, etapas: et, etapaAtual: 0, etapaInicio: hoje, pausada: false, pausadaEm: '' };
      redSel = mp.id; sheet = null; salvar('Plano salvo');
    }
  }
  function excluirSheet() {
    lerSheet();
    if (!sheet.confirmar) { sheet.confirmar = true; return render(); }
    if (sheet.tipo === 'med') { var id = sheet.id; D.meds = D.meds.filter(function (m) { return m.id !== id; }); sheet = null; salvar('Remédio excluído'); }
    else if (sheet.tipo === 'plano') { med(sheet.id).reducao = null; sheet = null; salvar('Plano encerrado'); }
  }

  /* ================= ALARME ================= */
  function vAlarme() {
    if (!alarme) return '';
    var itens = pendentesAgora();
    return '<div class="alarme" role="alertdialog" aria-label="Hora do remédio"><div style="display:flex;align-items:center;gap:6px"><div style="flex:1"><div class="hora-a">' + L.hhmm() + ' · ALARME</div><h1>Hora do remédio</h1></div><div class="pilu">' + pilu('wow', 96) + '</div></div>' +
      '<div style="color:#DDE0FF;font-size:14px">Responda cada dose. Adiar agenda um novo lembrete em 10 minutos.</div><div class="pilha" style="flex:1;gap:12px">' +
      (itens.length ? itens.map(function (d) {
        return '<div class="item-a"><div style="display:flex;align-items:baseline;gap:10px"><b style="font:500 18px var(--mono)">' + d.horario + '</b><div><b style="font-size:18px;display:block">' + esc(d.med.nome) + '</b><span class="peq suave">' + esc([d.dosagem, L.plural(d.unidades, 'unidade')].filter(Boolean).join(' · ')) + '</span></div></div>' +
          '<div class="bt"><button class="btn prim" data-acao="tomei" data-key="' + d.key + '">Tomei</button><button class="btn" data-acao="adiar" data-key="' + d.key + '">+10 min</button><button class="btn" data-acao="pulei" data-key="' + d.key + '">Pular</button></div></div>';
      }).join('') : '<div class="vazio">Nenhuma dose pendente agora.</div>') +
      '</div><button class="btn vazado" style="align-self:flex-end" data-acao="fecharAlarme">Fechar</button></div>';
  }

  /* ================= AÇÕES ================= */
  async function copiar(txt, msg) {
    try { if (NATIVO && N.Clipboard) await N.Clipboard.write({ string: txt }); else await navigator.clipboard.writeText(txt); toast(msg || 'Copiado'); }
    catch (e) { toast('Não foi possível copiar'); }
  }
  async function compartilhar(titulo, txt) {
    if (NATIVO && N.Share) { try { await N.Share.share({ title: titulo, text: txt, dialogTitle: titulo }); return; } catch (e) { if (/cancel/i.test(String(e && e.message))) return; } }
    else if (navigator.share) { try { await navigator.share({ title: titulo, text: txt }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    copiar(txt, 'Copiado para colar onde quiser');
  }
  function abrirExterno(url) { if (NATIVO) location.href = url; else window.open(url, '_blank'); }
  function whats(numero, texto) {
    var n = String(numero || '').replace(/\D/g, '');
    if (!n) { copiar(texto, 'Mensagem copiada — cole no WhatsApp'); return; }
    if (n.length <= 11) n = '55' + n;
    abrirExterno('https://wa.me/' + n + '?text=' + encodeURIComponent(texto));
  }
  function exportar() {
    var dados = JSON.parse(JSON.stringify(D)); dados.assistente.chave = '';
    var txt = JSON.stringify(dados, null, 1);
    if (!NATIVO) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = 'remedios-' + hoje + '.json'; a.click(); return; }
    compartilhar('Dados do Remédios ' + hoje, txt);
  }
  function importar() {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json,text/plain';
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = async function () {
        var novo;
        try { var obj = JSON.parse(fr.result); if (!Array.isArray(obj.meds)) throw new Error(); novo = L.normalizar(obj); }
        catch (e) { toast('Arquivo inválido: esperado um .json com “meds”'); return; }
        if (!window.confirm('Importar ' + L.plural(novo.meds.length, 'remédio') + ' e ' + L.plural(Object.keys(novo.checkins).length, 'check-in') + '? Os dados atuais deste iPhone serão substituídos.')) return;
        novo.assistente.chave = D.assistente.chave;
        novo.config.assinaturaEm = D.config.assinaturaEm;
        D = novo; redSel = null; ck = null; await salvar('Dados importados');
      };
      fr.readAsText(f);
    };
    inp.click();
  }
  function irAba(a) { aba = a; sub = null; confirmAv = false; render(true); }

  document.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-acao],[data-ir],[data-aba]');
    if (!b || b.disabled) return;
    if (sheet && b.closest('#formSheet')) lerSheet();
    if (b.dataset.aba) { irAba(b.dataset.aba); return; }
    if (b.dataset.ir) { if (b.dataset.med) redSel = b.dataset.med; irAba(b.dataset.ir); return; }
    var a = b.dataset.acao, m = b.dataset.med ? med(b.dataset.med) : null, key = b.dataset.key;
    switch (a) {
      case 'tomei': L.marcar(D, hoje, key, 'tomei'); if (alarme && pendentesAgora().length === 0) alarme = false; salvar('Marcado às ' + L.hhmm()); break;
      case 'pulei': L.marcar(D, hoje, key, 'pulei'); if (alarme && pendentesAgora().length === 0) alarme = false; salvar('Dose marcada como pulada'); break;
      case 'desfazer': L.marcar(D, hoje, key, null); salvar('Desfeito'); break;
      case 'adiar': dispensadas[hoje + '|' + key] = true; adiar(hoje, key); if (pendentesAgora().length === 0) alarme = false; break;
      case 'fecharAlarme': pendentesAgora().forEach(function (d) { dispensadas[hoje + '|' + d.key] = true; }); alarme = false; render(); break;
      case 'testarAlarme': alarme = true; render(); break;
      case 'perm': pedirPerm(); break;
      case 'testarNotif': testarNotif(); break;
      case 'redsel': redSel = m.id; confirmAv = false; render(); break;
      case 'avancar': {
        var st = L.statusReducao(D, m, hoje);
        if (!st.prontaParaAvancar && !confirmAv) { confirmAv = true; render(); return; }
        confirmAv = false; L.avancar(m, hoje); salvar('Etapa ' + (m.reducao.etapaAtual + 1) + ' começa hoje'); break;
      }
      case 'pausar': L.pausar(m, hoje); salvar(m.reducao.pausada ? 'Etapa em pausa' : 'Contagem retomada'); break;
      case 'plano': abrirPlano(m); break;
      case 'nivel': { var nt = $('#notaCk'); if (nt) ck.nota = nt.value; ck[b.dataset.s] = +b.dataset.n; render(); break; }
      case 'editarCk': editCk = true; ck = Object.assign({}, D.checkins[hoje]); render(); break;
      case 'salvarCk': { var n2 = $('#notaCk'); ck.nota = n2 ? n2.value.trim() : ''; ck.em = new Date().toISOString(); D.checkins[hoje] = ck; ck = null; editCk = false; salvar('Check-in salvo'); break; }
      case 'resumo': compartilhar('Resumo para a consulta', L.resumo(D, hoje, 30)); break;
      case 'passo': {
        var pid = b.dataset.p;
        if (m.reposicao[pid]) delete m.reposicao[pid]; else m.reposicao[pid] = hoje;
        await salvar();
        if (pid === 'retirado' && m.reposicao[pid]) abrirQtd(m, 'reabastecer');
        break;
      }
      case 'msgMedico': whats(D.config.medico.whatsapp, L.msgMedico(D, m, hoje)); if (!m.reposicao.receitaPedida) { m.reposicao.receitaPedida = hoje; salvar(); } break;
      case 'msgFarmacia': whats(D.config.farmacia.whatsapp, L.msgFarmacia(D, m)); if (!m.reposicao.reservado) { m.reposicao.reservado = hoje; salvar(); } break;
      case 'reabastecer': abrirQtd(m, 'reabastecer'); break;
      case 'ajustar': abrirQtd(m, 'ajustar'); break;
      case 'novoMed': abrirMed(null); break;
      case 'editarMed': abrirMed(m); break;
      case 'abrirRemedios': sub = 'remedios'; render(true); break;
      case 'voltar': sub = null; render(true); break;
      case 'passoCfg': { var k = b.dataset.k; D.config[k] = Math.max(+b.dataset.min, D.config[k] + +b.dataset.d); salvar(); break; }
      case 'exportar': exportar(); break;
      case 'importar': importar(); break;
      case 'renovei': D.config.assinaturaEm = hoje; salvar('Próximo vencimento: ' + L.curta(L.addDays(hoje, 7))); break;
      case 'aistudio': abrirExterno('https://aistudio.google.com/apikey'); break;
      case 'chatNovo': D.assistente.mensagens = []; chatErro = ''; salvar(); break;
      case 'atalho': enviarChat(ATALHOS[+b.dataset.i][1]); break;
      case 'anexo': D.assistente.anexar = D.assistente.anexar === false; salvar(); break;
      case 'enviar': enviarChat(); break;
      case 'removerChave': if (window.confirm('Remover a chave da API deste iPhone?')) { D.assistente.chave = ''; salvar('Chave removida'); } break;
      case 'fecharSheet': sheet = null; render(); break;
      case 'unSheet': sheet.d.un = Math.max(0.25, +sheet.d.un + +b.dataset.d); render(); break;
      case 'receitaSheet': sheet.d.receita = b.dataset.r; render(); break;
      case 'ativoSheet': sheet.d.ativo = !sheet.d.ativo; render(); break;
      case 'somaQ': sheet.d.q = L.num((+String(sheet.d.q).replace(',', '.') || 0) + +b.dataset.n); render(); break;
      case 'excluirSheet': excluirSheet(); break;
    }
  });
  document.addEventListener('submit', async function (e) {
    var f = e.target; e.preventDefault();
    var fd = new FormData(f);
    if (f.dataset.form === 'sheet') { salvarSheet(); return; }
    if (f.dataset.form === 'chave') { D.assistente.chave = String(fd.get('chave')).trim(); D.assistente.modelo = String(fd.get('modelo')).trim() || D.assistente.modelo; salvar('Chave salva'); return; }
    if (f.dataset.form === 'assist') { D.assistente.dias = +fd.get('dias') || 30; D.assistente.modelo = String(fd.get('modelo')).trim() || D.assistente.modelo; D.assistente.prompt = String(fd.get('prompt')).trim() || L.PROMPT; salvar('Configurações salvas'); }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'chatTexto') rascChat = e.target.value;
    if (e.target.id === 'notaCk' && ck) ck.nota = e.target.value;
    if (sheet && sheet.tipo === 'plano' && e.target.closest('#formSheet')) { lerSheet(); var p = $('#previa'); if (p) p.innerHTML = previaPlano(med(sheet.id), sheet.d); }
  });
  document.addEventListener('change', function (e) {
    var k = e.target.dataset && e.target.dataset.cfg; if (!k) return;
    var v = e.target.value.trim(), p = k.split('.');
    if (e.target.type === 'time' && !L.horarioValido(v)) return;
    if (p.length === 2) D.config[p[0]][p[1]] = v; else D.config[k] = v;
    gravar().then(function () { toast('Salvo'); reagendarLogo(); });
  });

  /* ================= RENDER ================= */
  function render(trocou) {
    if (!D) return;
    var tela = $('#tela'), rol = tela.scrollTop, html;
    if (aba === 'reducao') html = vReducao();
    else if (aba === 'estoque') html = vEstoque();
    else if (aba === 'assistente') html = vAssistente();
    else if (aba === 'mais') html = sub === 'remedios' ? vRemedios() : vAjustes();
    else html = vHoje();
    tela.innerHTML = html;
    tela.scrollTop = trocou ? 0 : rol;
    $('#camada').innerHTML = vSheet() + vAlarme();
    document.querySelectorAll('#abas button').forEach(function (b) { var on = b.dataset.aba === aba; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
  }

  async function iniciar() {
    if (NATIVO) {
      try {
        await N.LocalNotifications.registerActionTypes({ types: [{ id: 'DOSE', actions: [{ id: 'tomei', title: 'Tomei', foreground: true }, { id: 'adiar', title: 'Adiar 10 min', foreground: true }] }] });
        N.LocalNotifications.addListener('localNotificationActionPerformed', function (ev) { if (D) tratarAcaoNotif(ev); else setTimeout(function () { tratarAcaoNotif(ev); }, 600); });
      } catch (e) {}
    }
    D = await ler();
    if (!D.config.assinaturaEm) { D.config.assinaturaEm = hoje; await gravar(); }
    await verPerm();
    render(true); checarAlarme(); reagendar();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      var h = L.hoje(); if (h !== hoje) { hoje = h; ck = null; editCk = false; dispensadas = {}; }
      verPerm().then(function () { if (!sheet && !focoEmCampo()) render(); checarAlarme(); reagendar(); });
    });
    setInterval(function () {
      if (document.visibilityState !== 'visible') return;
      var h = L.hoje(); if (h !== hoje) { hoje = h; ck = null; editCk = false; dispensadas = {}; reagendar(); }
      if (sheet || focoEmCampo() || chatEnv) return;
      render(); checarAlarme();
    }, 60000);
  }
  iniciar();
})();
