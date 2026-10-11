'use strict';
/* Regras do Remédios (sem interface). Mesmos nomes de campos do app de Windows v0.4. */
(function () {
  var L = {};
  var DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var MC = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  L.pad = function (n) { return String(n).padStart(2, '0'); };
  L.iso = function (d) { return d.getFullYear() + '-' + L.pad(d.getMonth() + 1) + '-' + L.pad(d.getDate()); };
  L.hoje = function () { return L.iso(new Date()); };
  L.hhmm = function (d) { d = d || new Date(); return L.pad(d.getHours()) + ':' + L.pad(d.getMinutes()); };
  L.toMin = function (h) { var p = String(h).split(':').map(Number); return p[0] * 60 + p[1]; };
  L.dateOf = function (iso, hm) {
    var p = iso.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]);
    if (hm) { var m = L.toMin(hm); d.setHours(Math.floor(m / 60), m % 60, 0, 0); }
    return d;
  };
  L.addDays = function (iso, n) { var p = iso.split('-').map(Number); return L.iso(new Date(p[0], p[1] - 1, p[2] + n)); };
  L.diff = function (a, b) { return Math.round((L.dateOf(b) - L.dateOf(a)) / 864e5); };
  L.dataLonga = function (iso) { var d = L.dateOf(iso), p = iso.split('-').map(Number); return DIAS[d.getDay()] + ', ' + p[2] + ' de ' + MESES[p[1] - 1]; };
  L.curta = function (iso) { if (!iso) return '—'; var p = iso.split('-').map(Number); return p[2] + ' ' + MC[p[1] - 1]; };
  L.plural = function (n, s, p) { return L.num(n) + ' ' + (n === 1 ? s : (p || s + 's')); };
  L.num = function (n) { return String(+(+n).toFixed(2)).replace('.', ','); };
  L.uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  L.periodo = function (h) { var m = L.toMin(h); return m < 720 ? 'manhã' : m < 1080 ? 'tarde' : 'noite'; };
  L.horarioValido = function (h) { return /^\d{1,2}:\d{2}$/.test(String(h).trim()) && L.toMin(h) < 1440 && +String(h).split(':')[1] < 60; };
  L.normHorario = function (h) { return String(h).trim().padStart(5, '0'); };
  L.parseHorarios = function (txt) {
    var hs = String(txt || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!hs.length || !hs.every(L.horarioValido)) return null;
    return hs.map(L.normHorario).filter(function (h, i, a) { return a.indexOf(h) === i; }).sort();
  };

  L.SINTOMAS = [{ id: 'ansiedade', nome: 'Ansiedade' }, { id: 'insonia', nome: 'Insônia' }, { id: 'nausea', nome: 'Náusea' }, { id: 'cabeca', nome: 'Dor de cabeça' }, { id: 'humor', nome: 'Humor baixo' }];
  L.NIVEIS = ['nada', 'leve', 'médio', 'forte'];
  L.TIPOS_RECEITA = {
    semReceita: 'Sem receita', comum: 'Receita simples',
    especial: 'Controle especial — farmácia retém a receita',
    B: 'Notificação B (azul) — farmácia retém', A: 'Notificação A (amarela) — farmácia retém'
  };
  L.PASSOS = [{ id: 'receitaPedida', nome: 'Pedir receita ao médico' }, { id: 'receitaEmMaos', nome: 'Receita em mãos' }, { id: 'reservado', nome: 'Reservar na farmácia' }, { id: 'retirado', nome: 'Retirar e trazer para casa' }];
  L.PROMPT = 'Você me ajuda a acompanhar meus medicamentos. Analise os registros que eu anexar (doses marcadas, planos de redução e check-ins de sintomas). Diferencie o que está nos dados, o que é hipótese e o que falta saber. Não decida doses: hipóteses de ajuste são para eu discutir com meu médico. Diante de sinais de risco (convulsão, confusão forte, dor no peito, pensamentos de se machucar), oriente procurar o SAMU 192 ou o CVV 188. Responda em português, de forma direta.';

  L.configPadrao = function () {
    return { repetirMin: 10, alarmeAposMin: 30, desistirAposMin: 120, checkinHora: '21:00', avisosReposicaoHora: '10:00', pedirReceitaDias: 7,
      medico: { nome: '', whatsapp: '' }, farmacia: { nome: '', whatsapp: '' }, assinaturaEm: '' };
  };
  L.padrao = function () {
    return { versao: 1, meds: [], doses: {}, checkins: {}, adiamentos: {}, config: L.configPadrao(),
      assistente: { chave: '', modelo: 'gemini-2.5-flash', prompt: L.PROMPT, dias: 30, anexar: true, mensagens: [] } };
  };

  function normHs(lista) { return (Array.isArray(lista) ? lista : []).filter(L.horarioValido).map(L.normHorario).sort(); }
  L.normMed = function (m) {
    var r = m.reducao, hs = normHs(m.horarios);
    var red = r && Array.isArray(r.etapas) && r.etapas.length ? {
      ativa: r.ativa !== false,
      etapas: r.etapas.map(function (e) { var eh = normHs(e.horarios); return { descricao: String(e.descricao || ''), unidadesPorDose: +e.unidadesPorDose || 1, horarios: eh.length ? eh : hs, dias: Math.max(1, Math.round(+e.dias || 7)) }; }),
      etapaAtual: 0, etapaInicio: r.etapaInicio || L.hoje(), pausada: !!r.pausada, pausadaEm: r.pausadaEm || ''
    } : null;
    if (red) red.etapaAtual = Math.max(0, Math.min(+r.etapaAtual || 0, red.etapas.length - 1));
    return {
      id: String(m.id || L.uid()), nome: String(m.nome || 'Sem nome'), dosagem: String(m.dosagem || ''),
      unidadesPorDose: +m.unidadesPorDose || 1, horarios: hs, estoque: Math.max(0, +m.estoque || 0),
      estoqueConhecido: m.estoqueConhecido !== false, receita: m.receita || 'comum', horaLimite: L.horarioValido(m.horaLimite || '') ? L.normHorario(m.horaLimite) : '',
      inicioTratamento: m.inicioTratamento || '', ativo: m.ativo !== false, reducao: red,
      reposicao: m.reposicao && typeof m.reposicao === 'object' ? m.reposicao : {}
    };
  };
  L.normalizar = function (d) {
    var P = L.padrao();
    d = d && typeof d === 'object' ? d : {};
    var cfg = Object.assign(P.config, d.config || {});
    cfg.medico = Object.assign({ nome: '', whatsapp: '' }, (d.config || {}).medico || {});
    cfg.farmacia = Object.assign({ nome: '', whatsapp: '' }, (d.config || {}).farmacia || {});
    var doses = {};
    if (d.doses && typeof d.doses === 'object') Object.keys(d.doses).forEach(function (k) { if (/^\d{4}-\d{2}-\d{2}$/.test(k) && d.doses[k] && typeof d.doses[k] === 'object') doses[k] = d.doses[k]; });
    return {
      versao: 1, meds: (Array.isArray(d.meds) ? d.meds : []).map(L.normMed), doses: doses,
      checkins: d.checkins && typeof d.checkins === 'object' ? d.checkins : {},
      adiamentos: d.adiamentos && typeof d.adiamentos === 'object' ? d.adiamentos : {},
      config: cfg, assistente: Object.assign(P.assistente, d.assistente || {})
    };
  };

  L.ativos = function (D) { return D.meds.filter(function (m) { return m.ativo !== false; }); };
  L.esquema = function (m) {
    var r = m.reducao;
    if (r && r.ativa) { var e = r.etapas[r.etapaAtual]; return { horarios: e.horarios.length ? e.horarios : m.horarios, un: e.unidadesPorDose, dosagem: e.descricao || m.dosagem, reduzindo: true }; }
    return { horarios: m.horarios, un: m.unidadesPorDose, dosagem: m.dosagem, reduzindo: false };
  };
  L.porDia = function (m) { var e = L.esquema(m); return e.horarios.length * e.un; };
  L.diasRestantes = function (m) { if (m.estoqueConhecido === false) return null; var pd = L.porDia(m); return pd ? m.estoque / pd : null; };
  L.dataFim = function (m, hoje) { var dr = L.diasRestantes(m); return dr == null ? '' : L.addDays(hoje, Math.floor(dr)); };

  L.dosesDoDia = function (D, dia) {
    var reg = D.doses[dia] || {}, out = [];
    L.ativos(D).forEach(function (m) {
      if (m.inicioTratamento && m.inicioTratamento > dia) return;
      var e = L.esquema(m);
      e.horarios.forEach(function (h) {
        var key = m.id + '@' + h, r = reg[key];
        out.push({ med: m, horario: h, key: key, unidades: e.un, dosagem: e.dosagem, reduzindo: e.reduzindo, status: r ? r.s : 'pendente', em: r ? r.em : '' });
      });
    });
    return out.sort(function (a, b) { return L.toMin(a.horario) - L.toMin(b.horario) || a.med.nome.localeCompare(b.med.nome); });
  };
  L.marcar = function (D, dia, key, status, em) {
    var reg = D.doses[dia] = D.doses[dia] || {}, prev = reg[key];
    var m = D.meds.find(function (x) { return x.id === key.split('@')[0]; });
    if (m && m.estoqueConhecido !== false) {
      var un = L.esquema(m).un;
      if (status === 'tomei' && !(prev && prev.s === 'tomei')) m.estoque = Math.max(0, +(m.estoque - un).toFixed(3));
      if (status !== 'tomei' && prev && prev.s === 'tomei') m.estoque = +(m.estoque + un).toFixed(3);
    }
    if (status) reg[key] = { s: status, em: em || L.hhmm() }; else delete reg[key];
    delete D.adiamentos[dia + '|' + key];
  };

  L.precisaSegurar = function (D, hoje) {
    return [0, 1, 2].every(function (i) {
      var c = D.checkins[L.addDays(hoje, -i)];
      return c && L.SINTOMAS.some(function (s) { return (c[s.id] || 0) >= 2; });
    });
  };
  L.algumaReducaoAtiva = function (D) { return L.ativos(D).some(function (m) { return m.reducao && m.reducao.ativa; }); };
  L.statusReducao = function (D, m, hoje) {
    var r = m.reducao; if (!r || !r.ativa) return null;
    var e = r.etapas[r.etapaAtual], ref = r.pausada && r.pausadaEm ? r.pausadaEm : hoje;
    var faltam = e.dias - L.diff(r.etapaInicio, ref), ultima = r.etapaAtual === r.etapas.length - 1;
    var segurar = L.precisaSegurar(D, hoje);
    return { indice: r.etapaAtual, total: r.etapas.length, etapa: e, proxima: r.etapas[r.etapaAtual + 1] || null, faltam: faltam, ultima: ultima,
      dataProxima: L.addDays(r.etapaInicio, e.dias + (r.pausada && r.pausadaEm ? L.diff(r.pausadaEm, hoje) : 0)), pausada: !!r.pausada,
      sugerirSegurar: segurar, prontaParaAvancar: !ultima && faltam <= 0 && !r.pausada && !segurar };
  };
  L.pausar = function (m, hoje) {
    var r = m.reducao;
    if (r.pausada) { if (r.pausadaEm) r.etapaInicio = L.addDays(r.etapaInicio, L.diff(r.pausadaEm, hoje)); r.pausada = false; r.pausadaEm = ''; }
    else { r.pausada = true; r.pausadaEm = hoje; }
  };
  L.avancar = function (m, hoje) { var r = m.reducao; r.etapaAtual = Math.min(r.etapaAtual + 1, r.etapas.length - 1); r.etapaInicio = hoje; r.pausada = false; r.pausadaEm = ''; };
  L.etapasRapidas = function (m, seq, dias, horariosTxt) {
    var hs = L.parseHorarios(horariosTxt), d = Math.round(+dias);
    var nums = String(seq || '').trim().split(/[\s;]+/).filter(Boolean).map(function (x) { return +x.replace(',', '.'); });
    if (!hs) throw new Error('Horários no formato 08:00, 20:00.');
    if (!(d >= 1 && d <= 3650)) throw new Error('Duração de cada etapa: de 1 a 3650 dias.');
    if (!nums.length || nums.some(function (n) { return !(n > 0); })) throw new Error('Sequência: quantidades maiores que zero, separadas por espaço (ex.: 1 0,75 0,5).');
    if (nums.length > 50) throw new Error('Use até 50 etapas.');
    return nums.map(function (u) { return { descricao: u === m.unidadesPorDose ? m.dosagem : L.num(u) + ' un. de ' + (m.dosagem || m.nome), unidadesPorDose: u, horarios: hs, dias: d }; });
  };

  L.passosDe = function (m) { return m.receita === 'semReceita' ? L.PASSOS.slice(2) : L.PASSOS; };
  L.passoPendente = function (D, m) {
    var dr = L.diasRestantes(m);
    if (dr == null || dr > D.config.pedirReceitaDias) return null;
    var p = L.passosDe(m).find(function (x) { return !m.reposicao[x.id]; });
    return p ? { passo: p, dias: Math.floor(dr) } : null;
  };

  L.sequencia = function (D, hoje) {
    var n = 0;
    for (var i = 0; i < 400; i++) {
      var ds = L.dosesDoDia(D, L.addDays(hoje, -i));
      var ok = ds.length > 0 && ds.every(function (d) { return d.status !== 'pendente'; });
      if (i === 0) { if (ok) n++; continue; }
      if (!ok) break;
      n++;
    }
    return n;
  };

  L.resumo = function (D, hoje, dias) {
    var ini = L.addDays(hoje, -(dias - 1)), linhas = ['Resumo do Remédios — ' + L.curta(ini) + ' a ' + L.curta(hoje), ''];
    L.ativos(D).forEach(function (m) {
      var tom = 0, pul = 0, tot = 0;
      for (var i = 0; i < dias; i++) {
        var dia = L.addDays(ini, i);
        if (dia > hoje) break;
        L.dosesDoDia(D, dia).forEach(function (d) { if (d.med.id !== m.id) return; tot++; if (d.status === 'tomei') tom++; if (d.status === 'pulei') pul++; });
      }
      var l = '• ' + m.nome + (m.dosagem ? ' ' + m.dosagem : '') + ': ' + tom + ' de ' + tot + ' doses tomadas' + (pul ? ', ' + pul + ' puladas' : '') + '.';
      var st = L.statusReducao(D, m, hoje);
      if (st) l += ' Redução: etapa ' + (st.indice + 1) + ' de ' + st.total + ' (' + (st.etapa.descricao || L.num(st.etapa.unidadesPorDose) + ' un.') + '), desde ' + L.curta(m.reducao.etapaInicio) + (st.pausada ? ', em pausa' : '') + '.';
      linhas.push(l);
    });
    var cks = Object.keys(D.checkins).filter(function (k) { return k >= ini && k <= hoje; }).sort();
    linhas.push('', 'Check-ins (' + cks.length + '):');
    cks.forEach(function (k) {
      var c = D.checkins[k], alt = L.SINTOMAS.filter(function (s) { return (c[s.id] || 0) >= 1; });
      linhas.push('  ' + L.curta(k) + ': ' + (alt.length ? alt.map(function (s) { return s.nome + ' ' + L.NIVEIS[c[s.id]]; }).join(', ') : 'tudo ok') + (c.nota ? ' — ' + c.nota : ''));
    });
    return linhas.join('\n');
  };
  L.msgMedico = function (D, m, hoje) {
    var dr = L.diasRestantes(m), n = D.config.medico.nome;
    return 'Olá' + (n ? ', ' + n : '') + '! Meu ' + m.nome + (m.dosagem ? ' ' + m.dosagem : '') + (dr != null ? ' acaba em cerca de ' + L.plural(Math.floor(dr), 'dia') + ' (' + L.curta(L.dataFim(m, hoje)) + ')' : ' está acabando') + '. Pode me enviar uma nova receita? Obrigado!';
  };
  L.msgFarmacia = function (D, m) {
    return 'Olá! Gostaria de reservar ' + m.nome + (m.dosagem ? ' ' + m.dosagem : '') + '.' + (m.receita !== 'semReceita' && m.receita !== 'comum' ? ' Levo a receita na retirada.' : '') + ' Obrigado!';
  };
  L.contexto = function (D, hoje, dias) {
    var ini = L.addDays(hoje, -(dias - 1)), doses = {}, cks = {};
    Object.keys(D.doses).forEach(function (k) { if (k >= ini && k <= hoje) doses[k] = D.doses[k]; });
    Object.keys(D.checkins).forEach(function (k) { if (k >= ini && k <= hoje) cks[k] = D.checkins[k]; });
    return { periodo: { inicio: ini, fim: hoje, dias: dias }, escalaSintomas: L.NIVEIS,
      medicamentos: L.ativos(D).map(function (m) { return { nome: m.nome, dosagem: m.dosagem, horarios: m.horarios, unidadesPorDose: m.unidadesPorDose, inicioTratamento: m.inicioTratamento || null, planoReducao: m.reducao && m.reducao.ativa ? m.reducao : null }; }),
      doses: doses, checkins: cks };
  };

  /* Agenda de notificações locais. O iOS guarda no máximo 64 pendentes por app; usamos até 62.
     Prioridade: primeira notificação de cada dose (até 7 dias) > avisos > repetições das próximas 36 h. */
  L.planejarNotificacoes = function (D, agora) {
    var c = D.config, hoje = L.iso(agora), t0 = agora.getTime(), iniciais = [], extras = [], repet = [];
    var passo = Math.max(1, +c.repetirMin || 10), desistir = Math.max(passo, +c.desistirAposMin || 120), alarmeMin = +c.alarmeAposMin || 30;
    var offs = []; for (var o = passo; o <= desistir; o += passo) offs.push(o);
    if (offs.length > 4) {
      var al = offs.find(function (x) { return x >= alarmeMin; }) || offs[offs.length - 1];
      offs = [offs[0], offs[1], al, offs[offs.length - 1]].filter(function (x, i, a) { return a.indexOf(x) === i; }).sort(function (a, b) { return a - b; });
    }
    for (var i = 0; i < 7; i++) {
      var dia = L.addDays(hoje, i);
      L.dosesDoDia(D, dia).forEach(function (d) {
        if (d.status !== 'pendente') return;
        var t = L.dateOf(dia, d.horario).getTime(), lim = d.med.horaLimite ? L.dateOf(dia, d.med.horaLimite).getTime() : Infinity;
        var corpo = d.med.nome + ' · ' + [d.dosagem, L.plural(d.unidades, 'unidade')].filter(Boolean).join(' · ');
        var extra = { tipo: 'dose', dia: dia, key: d.key };
        if (t > t0 && t <= lim) iniciais.push({ at: t, title: 'Hora do remédio · ' + d.horario, body: corpo, extra: extra });
        var ad = D.adiamentos[dia + '|' + d.key];
        if (ad && ad > t0) extras.push({ at: ad, title: 'Lembrete adiado · ' + d.horario, body: corpo, extra: extra });
        offs.forEach(function (off) {
          var tk = t + off * 6e4;
          if (tk > t0 && tk <= lim && tk - t0 < 36 * 3600e3 && !(ad && ad > tk))
            repet.push({ at: tk, title: (off >= alarmeMin ? 'Dose atrasada · ' : 'Ainda não marcada · ') + d.horario, body: corpo + '. Toque para responder.', extra: extra });
        });
      });
    }
    if (L.algumaReducaoAtiva(D)) [0, 1].forEach(function (i) {
      var dia = L.addDays(hoje, i), t = L.dateOf(dia, c.checkinHora).getTime();
      if (!D.checkins[dia] && t > t0) extras.push({ at: t, title: 'Check-in de hoje', body: '30 segundos. É isso que decide se a etapa avança.', extra: { tipo: 'checkin' } });
    });
    var pend = L.ativos(D).map(function (m) { var p = L.passoPendente(D, m); return p ? m.nome + ': ' + p.passo.nome.toLowerCase() : null; }).filter(Boolean);
    if (pend.length) {
      var tr = L.dateOf(hoje, c.avisosReposicaoHora).getTime(); if (tr <= t0) tr = L.dateOf(L.addDays(hoje, 1), c.avisosReposicaoHora).getTime();
      extras.push({ at: tr, title: 'Reposição de remédios', body: pend.join(' · '), extra: { tipo: 'estoque' } });
    }
    if (c.assinaturaEm) {
      var ta = L.dateOf(L.addDays(c.assinaturaEm, 6), '10:00').getTime();
      if (ta > t0) extras.push({ at: ta, title: 'Renove o Remédios no Sideloadly', body: 'A instalação gratuita vence em ' + L.curta(L.addDays(c.assinaturaEm, 7)) + '. Sem renovar, o app não abre.', extra: { tipo: 'renovar' } });
    }
    var porTempo = function (a, b) { return a.at - b.at; };
    iniciais.sort(porTempo); repet.sort(porTempo);
    var lista = iniciais.slice(0, 44).concat(extras);
    lista = lista.concat(repet.slice(0, Math.max(0, 61 - lista.length))).sort(porTempo);
    var ultima = iniciais.slice(0, 44).pop();
    if (ultima) lista.push({ at: ultima.at + 3 * 6e4, title: 'Abra o Remédios', body: 'Abra o app para continuar recebendo os lembretes dos próximos dias.', extra: { tipo: 'abrir' } });
    lista = lista.slice(0, 62);
    lista.forEach(function (n, i) { n.id = i + 1; });
    return { lista: lista, ate: ultima ? L.iso(new Date(ultima.at)) : null };
  };

  window.Logica = L;
})();
