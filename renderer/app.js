// RadioHub renderer. GPL-3.0-or-later.
// Desenvolvido por Diego Costa · www.diegocosta.digital
'use strict';
(function () {
  const rh = window.rh;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const STEPS = [
    { id: 'connect', label: 'Conectar rádio' },
    { id: 'download', label: 'Identificar e backup' },
    { id: 'channels', label: 'Canais e região' },
    { id: 'review', label: 'Revisar e gravar' }
  ];
  const POPULAR = ['Quansheng UV-K1', 'Quansheng UV-K5', 'Baofeng UV-5R', 'Baofeng BF-888', 'Baofeng UV-82', 'Baofeng UV-17', 'Radioddity GA-510', 'Retevis H777', 'TYT TH-UV88', 'Yaesu FT-60', 'Yaesu FT-65R', 'Kenwood TH-D74 (clone mode)'];
  const TONES = [67.0, 69.3, 71.9, 74.4, 77.0, 79.7, 82.5, 85.4, 88.5, 91.5, 94.8, 97.4, 100.0, 103.5, 107.2, 110.9, 114.8, 118.8, 123.0, 127.3, 131.8, 136.5, 141.3, 146.2, 151.4, 156.7, 159.8, 162.2, 165.5, 167.9, 171.3, 173.8, 177.3, 179.9, 183.5, 186.2, 189.9, 192.8, 196.6, 199.5, 203.5, 206.5, 210.7, 218.1, 225.7, 229.1, 233.6, 241.8, 250.3, 254.1];

  const st = {
    view: 'connect', ports: [], knownPorts: null, newPorts: new Set(), port: null,
    models: [], modelQuery: '', model: null, prompts: null, photos: {},
    busy: false, progress: null, radio: null, original: [], working: [], errors: {},
    filter: 'Todos', chat: [], aiHistory: null, chatBusy: false,
    settings: { hasKey: {}, providers: [], models: {}, dev: {} }, done: new Set(), keyWaiting: false, providerModels: {}
  };

  // ------------------------------------------------------------ utils
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 3400);
  }
  function modal(title, body, buttons) {
    return new Promise((resolve) => {
      const m = $('#modal');
      m.innerHTML = '<div class="box" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">' + esc(title) + '</h2><div class="muted" style="white-space:pre-line">' + esc(body) + '</div><div class="row" style="justify-content:flex-end">' +
        buttons.map((b, i) => '<button type="button" class="btn ' + (b.primary ? 'primary' : b.danger ? 'danger' : '') + '" data-i="' + i + '">' + esc(b.label) + '</button>').join('') + '</div></div>';
      m.hidden = false;
      m.onclick = (e) => { const i = e.target.getAttribute('data-i'); if (i !== null) { m.hidden = true; resolve(buttons[+i].value); } };
      const p = m.querySelector('.btn.primary') || m.querySelector('.btn'); if (p) p.focus();
    });
  }
  // Electron wraps errors as "Error invoking remote method 'x': Error: <msg>".
  function cleanErr(e) {
    let raw = (e && e.message) || String(e);
    raw = raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '');
    const parts = raw.split('\n@@DETAIL@@\n');
    return { msg: parts[0].replace(/^\[\w+\]\s*/, ''), detail: parts[1] || '' };
  }
  function friendly(msg) {
    const m = msg || '';
    if (/Resource busy|Errno 16|exclusively lock/i.test(m)) return 'A porta está sendo usada por outro programa. Feche o CHIRP (ou outro app de rádio) e tente de novo.';
    if (/could not open port|No such file|Errno 2|FileNotFound/i.test(m)) return 'A porta do rádio sumiu. Reconecte o cabo, espere a porta aparecer na etapa 1 e tente de novo.';
    if (/Permission denied|Errno 13/i.test(m)) return 'O macOS não deixou o app abrir a porta. Reconecte o cabo e tente de novo.';
    if (/did not respond|No response|timeout|timed out|short read|Failed to communicate|empty response/i.test(m)) return 'O rádio não respondeu. Desligue o rádio, desconecte o cabo, ligue o rádio, conecte o cabo de novo e tente outra vez. Confira também se o modelo e a porta estão certos.';
    if (/firmware/i.test(m) && /support|unsupported|not supported/i.test(m)) return 'O driver não aceita a versão de firmware deste rádio. ' + m;
    if (/O motor parou/.test(m)) return m;
    return '';
  }
  async function call(method, params) {
    try { return await rh.engine(method, params); }
    catch (e) { const c = cleanErr(e); const err = new Error(c.msg); err.detail = c.detail; err.friendly = friendly(c.msg); throw err; }
  }
  function errBox(e) {
    return '<div class="notice bad">' + esc(e.friendly || e.message) + '</div>' +
      '<details class="muted"><summary style="cursor:pointer;color:var(--acc)">Ver detalhes técnicos</summary><pre class="mono" style="white-space:pre-wrap;font-size:12px;margin:10px 0 0;user-select:text">' + esc(e.message + (e.detail ? '\n\n' + e.detail : '')) + '</pre><span style="font-size:12px">Também gravado em ~/RadioHub/logs/radiohub.log</span></details>';
  }
  function fmtF(v) { const n = parseFloat(v); return isNaN(n) ? '' : n.toFixed(n * 1e4 % 10 ? 5 : 3).replace(/0+$/, '').replace(/\.$/, '.0'); }
  function groupOf(m) {
    if (m.empty) return null;
    const f = parseFloat(m.freq), nm = (m.name || '').toUpperCase();
    if (f >= 108 && f < 137) return 'Aviação';
    if (f >= 156 && f <= 162.1) return 'Marítimo';
    if (nm.startsWith('BF')) return 'Baofeng';
    if (f >= 462 && f <= 467.8) return 'FRS / TALK';
    if (m.duplex === '+' || m.duplex === '-') return 'Repetidoras';
    if (f >= 76 && f < 108) return 'Rádio FM';
    return 'Outros';
  }
  const SAME_KEYS = ['empty', 'name', 'freq', 'duplex', 'offset', 'tmode', 'rtone', 'ctone', 'dtcs', 'mode', 'power', 'skip', 'rx_dtcs', 'dtcs_polarity', 'tuning_step'];
  function sameMem(a, b) {
    if (!a || !b) return false;
    if (a.empty && b.empty) return true;
    return SAME_KEYS.every((k) => String(a[k]) === String(b[k]));
  }
  function diff() {
    const add = [], chg = [], del = [];
    st.working.forEach((w, i) => {
      const o = st.original[i];
      if (sameMem(o, w)) return;
      if (o.empty && !w.empty) add.push(w); else if (!o.empty && w.empty) del.push(o); else chg.push(w);
    });
    return { add, chg, del };
  }
  function idxOf(number) { return st.working.findIndex((m) => m.number === number); }
  function provider() { return (st.settings.providers || []).find((p) => p.id === st.settings.provider) || { id: 'groq', label: 'Groq', price: 'Grátis' }; }
  function aiReady() { return !!(st.settings.hasKey || {})[st.settings.provider]; }
  function radioContext() {
    const r = st.radio; if (!r) return {};
    return {
      radio: r.label, firmware: r.firmware || '', regiao: st.settings.region || 'Brasília, DF',
      limites_canais: r.features.memory_bounds, modos: r.features.valid_modes, duplex: r.features.valid_duplexes,
      tons: r.features.valid_tmodes, potencias: r.features.valid_power_levels, tamanho_nome: r.features.valid_name_length,
      faixas_mhz: (r.features.valid_bands || []).map((b) => [b[0] / 1e6, b[1] / 1e6]),
      canais_atuais: st.working.filter((m) => !m.empty).map((m) => [m.number, m.name, m.freq, m.duplex, m.offset, m.tmode, m.rtone, m.mode])
    };
  }

  // ------------------------------------------------------------ radio art
  function modelFor(r) { return r ? (st.models.find((m) => m.id === r.id) || r) : null; }
  async function loadPhoto(id) { if (id && st.photos[id] === undefined) { st.photos[id] = (await rh.getPhoto(id)) || null; } return st.photos[id]; }
  function art(m, opts) {
    if (!m) return '';
    const ph = st.photos[m.id];
    if (ph) return '<img src="' + ph + '" alt="Foto do ' + esc(m.label) + '" style="width:100%;height:100%;object-fit:contain">';
    return window.RadioArt.svg(m, opts);
  }
  function deviceCard(m, extra) {
    if (!m) return '<div class="device empty"><div class="device-art">' + window.RadioArt.svg({ form: 'handheld', label: 'Rádio', vendor: '', model: '' }, { freq: '---.---' }) + '</div><div class="muted" style="text-align:center">Escolha o modelo para ver o aparelho</div></div>';
    return '<div class="device"><div class="device-art">' + art(m, extra && extra.freq ? { freq: extra.freq } : null) + '</div>' +
      '<div class="device-info"><span class="muted" style="font-size:12px">' + esc(m.vendor) + ' · ' + esc(window.RadioArt.formLabel(m.form)) + '</span><strong style="font-size:18px">' + esc(m.model + (m.variant ? ' ' + m.variant : '')) + '</strong>' +
      (extra && extra.html ? extra.html : '') +
      '<div class="row" style="gap:8px;margin-top:4px"><button type="button" class="btn sm" data-photo="' + esc(m.id) + '">' + (st.photos[m.id] ? 'Trocar foto' : 'Usar foto do meu rádio') + '</button>' + (st.photos[m.id] ? '<button type="button" class="btn sm" data-unphoto="' + esc(m.id) + '">Voltar à ilustração</button>' : '') + '</div>' +
      (st.photos[m.id] ? '' : '<span class="muted" style="font-size:11px">Ilustração genérica do tipo de aparelho.</span>') + '</div></div>';
  }

  // ------------------------------------------------------------ chrome
  function renderSteps() {
    const order = STEPS.map((s) => s.id);
    $('#steps').innerHTML = STEPS.map((s, i) => {
      const done = st.done.has(s.id) && s.id !== st.view;
      const can = i === 0 || st.done.has(order[i - 1]) || (st.radio && i >= 2);
      return '<li class="' + (s.id === st.view ? 'cur' : done ? 'done' : '') + '"><button type="button" data-go="' + s.id + '"' + (can && !st.busy ? '' : ' disabled') + '><span class="dot">' + (done ? '✓' : i + 1) + '</span>' + esc(s.label) + '</button></li>';
    }).join('');
    const b = $('#radioBadge');
    const m = st.radio ? modelFor(st.radio) : null;
    if (m) {
      b.hidden = false;
      b.innerHTML = '<div class="badge-art">' + art(m, { freq: '' }) + '</div><div style="display:flex;flex-direction:column;min-width:0"><small>' + (st.port ? 'Conectado' : 'Arquivo aberto') + '</small><strong style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(m.model) + '</strong>' + (st.radio.firmware ? '<small class="mono">' + esc(st.radio.firmware) + '</small>' : '') + '</div>';
    } else b.hidden = true;
    document.querySelectorAll('.side-link').forEach((a) => a.classList.toggle('on', a.getAttribute('data-go') === st.view));
  }
  function go(view) { if (st.busy) return; st.view = view; render(); $('#view').focus(); }
  function render() {
    renderSteps();
    const v = $('#view');
    ({ connect: vConnect, download: vDownload, channels: vChannels, review: vReview, settings: vSettings, about: vAbout })[st.view](v);
    const ai = $('#ai');
    ai.hidden = st.view !== 'channels';
    if (!ai.hidden) renderAI();
  }

  // ------------------------------------------------------------ step 1
  async function pollPorts() {
    try {
      const ports = await call('list_ports');
      const devs = ports.map((p) => p.device);
      if (st.knownPorts === null) st.knownPorts = new Set(devs);
      else devs.forEach((d) => { if (!st.knownPorts.has(d)) { st.newPorts.add(d); st.knownPorts.add(d); st.port = d; } });
      const changed = JSON.stringify(devs) !== JSON.stringify(st.ports.map((p) => p.device));
      st.ports = ports;
      if (st.port && !devs.includes(st.port)) st.port = null;
      if (!st.port) { const usb = ports.find((p) => p.is_usb && !p.is_system); if (usb) st.port = usb.device; }
      if (changed && st.view === 'connect') renderPorts();
    } catch (e) { /* engine starting */ }
  }
  function renderPorts() {
    const box = $('#ports'); if (!box) return;
    const list = st.ports.slice().sort((a, b) => (b.is_usb - a.is_usb) || (a.is_system - b.is_system));
    box.innerHTML = list.length ? list.map((p) => {
      const isNew = st.newPorts.has(p.device);
      const hint = p.is_system ? 'Porta do sistema · não é um rádio' : (p.is_usb ? ((p.manufacturer || p.description || 'Dispositivo USB') + (isNew ? ' · provavelmente o seu rádio' : '')) : (p.description || ''));
      return '<label class="port ' + (st.port === p.device ? 'sel' : '') + '"><input type="radio" name="port" value="' + esc(p.device) + '"' + (st.port === p.device ? ' checked' : '') + '><span style="flex:1;display:flex;flex-direction:column;gap:3px;min-width:0"><span class="mono" style="overflow:hidden;text-overflow:ellipsis">' + esc(p.device) + '</span><span class="muted" style="font-size:13px">' + esc(hint) + '</span></span>' + (isNew ? '<span class="pill ok">Detectado agora</span>' : '') + '</label>';
    }).join('') : '<div class="muted">Nenhuma porta encontrada ainda.</div>';
  }
  function renderModels() {
    const box = $('#models'); if (!box) return;
    const q = st.modelQuery.trim().toLowerCase();
    let list;
    if (!q) {
      const pop = POPULAR.map((l) => st.models.find((m) => m.label === l)).filter(Boolean);
      list = pop.length ? pop : st.models.slice(0, 40);
    } else list = st.models.filter((m) => m.label.toLowerCase().includes(q)).slice(0, 120);
    box.innerHTML = (q ? '' : '<div class="models-head">Mais usados · digite para buscar entre ' + st.models.length + ' modelos</div>') +
      list.map((m) => '<button type="button" data-model="' + esc(m.id) + '" class="model-row ' + (st.model && st.model.id === m.id ? 'sel' : '') + '"><span class="mini-art" aria-hidden="true">' + window.RadioArt.svg(m, { freq: '' }) + '</span><span style="flex:1;min-width:0"><span style="display:block">' + esc(m.label) + '</span><span class="muted" style="font-size:12px">' + esc(window.RadioArt.formLabel(m.form)) + '</span></span></button>').join('') ||
      '<div class="muted" style="padding:10px">Nenhum modelo encontrado.</div>';
  }
  function vConnect(v) {
    v.innerHTML =
      '<header style="display:flex;flex-direction:column;gap:8px"><span class="eyebrow">Etapa 1 de 4</span><h1>Conecte o seu rádio</h1><p class="lead">Ligue o rádio, conecte o cabo de dados e escolha o modelo. A porta nova aparece sozinha.</p></header>' +
      '<div class="connect-grid"><div style="display:flex;flex-direction:column;gap:18px;min-width:0">' +
      '<section class="card" aria-label="Portas"><div class="spread"><h2>Portas encontradas</h2><span class="muted row" style="font-size:13px;gap:8px"><span class="spin"></span>Procurando a cada 2 s</span></div><div id="ports" style="display:flex;flex-direction:column;gap:10px"></div>' +
      '<details class="muted"><summary style="cursor:pointer;color:var(--acc)">Nenhuma porta nova apareceu?</summary><p>O cabo provavelmente só carrega. Teste outro cabo USB-C de dados ou o cabo de 2 pinos na entrada de fone do rádio. Ligue o rádio antes de conectar o cabo.</p></details></section>' +
      '<section class="card" aria-label="Modelo"><div class="spread"><h2>Modelo do rádio</h2><span id="modelSel" class="muted"></span></div><label class="sr" for="mq">Buscar modelo</label><input id="mq" class="input" placeholder="Buscar: UV-K1, UV-5R, Yaesu FT-60…" value="' + esc(st.modelQuery) + '"><div id="models" class="models"></div></section>' +
      '</div><aside id="devicePane" aria-label="Aparelho">' + deviceCard(st.model) + '<div id="prompt"></div></aside></div>' +
      '<div class="footer"><button type="button" class="btn" id="openImg">Abrir arquivo .img</button><button type="button" class="btn primary" id="toDownload">Baixar do rádio</button></div>';
    renderPorts(); renderModels(); renderPrompt();
    $('#mq').addEventListener('input', (e) => { st.modelQuery = e.target.value; renderModels(); });
    v.querySelector('#ports').addEventListener('change', (e) => { if (e.target.name === 'port') { st.port = e.target.value; renderPorts(); } });
    $('#models').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-model]'); if (!b) return;
      await selectModel(b.getAttribute('data-model')); renderModels(); refreshDevicePane();
    });
    $('#openImg').onclick = openImage;
    $('#toDownload').onclick = () => {
      if (!st.port) return toast('Escolha a porta do rádio.');
      if (!st.model) return toast('Escolha o modelo do rádio.');
      st.done.add('connect'); go('download'); startDownload();
    };
  }
  function refreshDevicePane() {
    const d = $('#devicePane'); if (!d) return;
    d.innerHTML = deviceCard(st.model) + '<div id="prompt"></div>'; renderPrompt();
  }
  async function selectModel(id) {
    st.model = st.models.find((m) => m.id === id) || null;
    st.prompts = null;
    if (st.model) {
      rh.setSettings({ lastModel: id });
      await loadPhoto(id);
      try { st.prompts = await call('prompts', { model_id: id }); } catch (e) {}
    }
    const s = $('#modelSel'); if (s) s.textContent = st.model ? st.model.label : 'Nenhum escolhido';
  }
  function renderPrompt() {
    const s = $('#modelSel'); if (s) s.textContent = st.model ? st.model.label : 'Nenhum escolhido';
    const p = $('#prompt'); if (!p) return;
    const pr = st.prompts || {};
    const parts = [];
    if (pr.experimental) parts.push('<details class="notice bad"><summary style="cursor:pointer"><strong>Driver experimental do CHIRP</strong>: o backup automático protege o seu rádio. Ver aviso original</summary>\n' + esc(pr.experimental) + '</details>');
    if (pr.pre_download) parts.push('<details class="notice"><summary style="cursor:pointer"><strong>Instruções do driver</strong> (em inglês)</summary>\n' + esc(pr.pre_download) + '</details>');
    p.innerHTML = parts.join('');
  }
  async function openImage() {
    const path = await rh.openFile('img'); if (!path) return;
    try {
      st.radio = await call('open_image', { path }); st.port = null;
      await loadPhoto(st.radio.id);
      await loadMemories(true);
      st.done.add('connect'); st.done.add('download'); go('channels');
    } catch (e) { modal('Não deu para abrir o arquivo', e.friendly || e.message, [{ label: 'OK', primary: true }]); }
  }

  // ------------------------------------------------------------ step 2
  async function startDownload() {
    st.busy = true; st.progress = { cur: 0, max: 1, msg: 'Conectando…' }; st.error = null; render();
    try {
      st.radio = await call('download', { port: st.port, model_id: st.model.id });
      await loadPhoto(st.radio.id);
      await loadMemories(true);
      st.done.add('download');
    } catch (e) { st.error = e; }
    st.busy = false; st.progress = null; render();
  }
  async function loadMemories(reset) {
    const mems = await call('get_memories');
    st.working = mems.map((m) => Object.assign({}, m));
    if (reset) { st.original = mems.map((m) => Object.assign({}, m)); st.errors = {}; }
  }
  function vDownload(v) {
    const r = st.radio, f = r && r.features;
    let body;
    if (st.busy) {
      const p = st.progress || {}; const pct = p.max ? Math.round(100 * p.cur / p.max) : 0;
      body = '<div class="connect-grid"><section class="card"><div class="spread"><h2>Lendo a memória do rádio</h2><span class="mono">' + pct + '%</span></div><div class="bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><div style="width:' + pct + '%"></div></div><span class="muted">' + esc(p.msg || '') + '</span><span class="muted">Não desconecte o cabo nem desligue o rádio.</span></section><aside>' + deviceCard(st.model, { freq: 'LENDO…' }) + '</aside></div>';
    } else if (st.error) {
      body = '<div class="connect-grid"><section class="card"><h2>Não foi possível ler o rádio</h2>' + errBox(st.error) + '<div class="muted" style="font-size:13px">Modelo: ' + esc(st.model ? st.model.label : '—') + ' · Porta: <span class="mono">' + esc(st.port || '—') + '</span></div><ul class="muted" style="margin:0;padding-left:18px"><li>Feche o CHIRP se ele estiver aberto.</li><li>Desconecte o cabo, ligue o rádio e conecte de novo.</li><li>Confirme o modelo e a porta.</li></ul><div class="row"><button type="button" class="btn primary" id="retry">Tentar de novo</button><button type="button" class="btn" data-go="connect">Voltar</button></div></section><aside>' + deviceCard(st.model) + '</aside></div>';
    } else if (r) {
      const used = st.working.filter((m) => !m.empty).length;
      const info = '<div class="grid2" style="margin-top:6px"><div><div class="muted" style="font-size:12px">Firmware</div><div class="mono">' + esc(r.firmware || 'não informado') + '</div></div><div><div class="muted" style="font-size:12px">Canais em uso</div><div class="mono">' + used + ' de ' + (f.memory_bounds[1] - f.memory_bounds[0] + 1) + '</div></div><div><div class="muted" style="font-size:12px">Porta</div><div class="mono" style="overflow:hidden;text-overflow:ellipsis">' + esc((st.port || '—').replace('/dev/', '')) + '</div></div><div><div class="muted" style="font-size:12px">Modos</div><div class="mono">' + esc(f.valid_modes.join(' ')) + '</div></div></div><span class="pill ok" style="align-self:flex-start">Leitura concluída</span>';
      body = '<section class="card hero">' + deviceCard(modelFor(r), { html: info, freq: (st.working.find((m) => !m.empty) || {}).freq ? fmtF(st.working.find((m) => !m.empty).freq) : '' }) + '</section>' +
        '<section class="card"><h2>Backup automático</h2><p class="muted" style="margin:0">Cópia completa salva em <span class="mono" style="color:var(--txt)">' + esc(r.backup_path || r.image_path || '') + '</span>. Dá para voltar a ela a qualquer momento com "Abrir arquivo .img".</p><div><button type="button" class="btn sm" id="reveal">Mostrar no Finder</button></div></section>';
    } else body = '<div class="muted">Nada lido ainda.</div>';
    v.innerHTML = '<header style="display:flex;flex-direction:column;gap:8px"><span class="eyebrow">Etapa 2 de 4</span><h1>' + (r && !st.busy && !st.error ? 'Encontramos o seu rádio' : 'Identificando o rádio') + '</h1></header>' + body +
      '<div class="footer"><button type="button" class="btn" data-go="connect"' + (st.busy ? ' disabled' : '') + '>Voltar</button><button type="button" class="btn primary" data-go="channels"' + (r && !st.busy ? '' : ' disabled') + '>Ver canais</button></div>';
    const rt = $('#retry'); if (rt) rt.onclick = startDownload;
    const rv = $('#reveal'); if (rv) rv.onclick = () => rh.reveal(r.backup_path || r.image_path);
  }

  // ------------------------------------------------------------ step 3
  function opts(list, cur, labels) {
    const l = list.slice(); if (cur !== undefined && cur !== null && !l.map(String).includes(String(cur))) l.unshift(cur);
    return l.map((o) => '<option value="' + esc(o) + '"' + (String(o) === String(cur) ? ' selected' : '') + '>' + esc((labels && labels[o]) || (o === '' ? '—' : o)) + '</option>').join('');
  }
  function rowHtml(i) {
    const f = st.radio.features; const m = st.working[i]; const o = st.original[i];
    const cls = st.errors[m.number] ? 'err' : (o.empty ? 'new' : (sameMem(o, m) ? '' : 'chg'));
    const toneVal = m.tmode === 'DTCS' ? m.dtcs : (m.tmode === 'TSQL' ? m.ctone : m.rtone);
    return '<tr class="' + cls + '" data-i="' + i + '"><td class="n">' + String(m.number).padStart(3, '0') + '</td>' +
      '<td><input class="cell w-name" data-k="name" maxlength="' + (f.valid_name_length || 16) + '" value="' + esc(m.name) + '" aria-label="Nome do canal ' + m.number + '"></td>' +
      '<td><input class="cell w-f mono" data-k="freq" value="' + esc(fmtF(m.freq)) + '" aria-label="Frequência em MHz"></td>' +
      '<td><select class="cell w-d" data-k="duplex" aria-label="Deslocamento">' + opts(f.valid_duplexes, m.duplex, { off: 'só RX' }) + '</select></td>' +
      '<td><input class="cell w-o mono" data-k="offset" value="' + esc(fmtF(m.offset)) + '" aria-label="Valor do deslocamento"' + (m.duplex === '+' || m.duplex === '-' || m.duplex === 'split' ? '' : ' disabled') + '></td>' +
      '<td><select class="cell w-t" data-k="tmode" aria-label="Tipo de tom">' + opts(f.valid_tmodes, m.tmode) + '</select></td>' +
      '<td>' + (m.tmode === 'DTCS' ? '<input class="cell w-tn mono" data-k="dtcs" value="' + esc(String(m.dtcs).padStart(3, '0')) + '" aria-label="Código DCS">' : '<select class="cell w-tn mono" data-k="tone" aria-label="Subtom"' + (m.tmode ? '' : ' disabled') + '>' + opts(TONES, toneVal) + '</select>') + '</td>' +
      '<td><select class="cell w-m" data-k="mode" aria-label="Modo">' + opts(f.valid_modes, m.mode) + '</select></td>' +
      '<td><select class="cell w-p" data-k="power" aria-label="Potência">' + opts(f.valid_power_levels, m.power) + '</select></td>' +
      '<td><button type="button" class="btn sm icon" data-del="' + i + '" aria-label="Apagar canal ' + m.number + '">✕</button>' + (st.errors[m.number] ? '<div class="errtxt">' + esc(st.errors[m.number].join(' · ')) + '</div>' : '') + '</td></tr>';
  }
  function updateCounts() {
    const d = diff(); const n = d.add.length + d.chg.length + d.del.length;
    const b = $('#toReview'); if (b) b.textContent = 'Revisar alterações (' + n + ')';
  }
  function vChannels(v) {
    const groups = {}; st.working.forEach((m) => { const g = groupOf(m); if (g) groups[g] = (groups[g] || 0) + 1; });
    const total = Object.values(groups).reduce((a, b) => a + b, 0);
    if (st.filter !== 'Todos' && !groups[st.filter]) st.filter = 'Todos';
    const rows = st.working.map((m, i) => ({ m, i })).filter(({ m }) => !m.empty && (st.filter === 'Todos' || groupOf(m) === st.filter));
    v.innerHTML =
      '<header class="spread" style="align-items:flex-end"><div style="display:flex;flex-direction:column;gap:6px"><span class="eyebrow">Etapa 3 de 4</span><h1>Canais</h1></div><div class="row"><button type="button" class="btn sm" id="impCsv">Importar CSV</button><button type="button" class="btn sm" id="expCsv">Exportar CSV</button><button type="button" class="btn sm" id="saveImg">Salvar imagem</button><button type="button" class="btn sm" id="addCh">+ Canal</button></div></header>' +
      '<div class="chips" role="group" aria-label="Filtrar por grupo">' + ['Todos'].concat(Object.keys(groups).sort()).map((g) => '<button type="button" class="chip ' + (st.filter === g ? 'on' : '') + '" data-filter="' + esc(g) + '">' + esc(g) + ' · ' + (g === 'Todos' ? total : groups[g]) + '</button>').join('') + '</div>' +
      '<div class="tablebox"><table><thead><tr><th>Nº</th><th>Nome</th><th>Frequência</th><th>Desloc.</th><th>Valor</th><th>Tom</th><th>Subtom</th><th>Modo</th><th>Potência</th><th><span class="sr">Ações</span></th></tr></thead><tbody>' +
      rows.map(({ i }) => rowHtml(i)).join('') + '</tbody></table>' + (rows.length ? '' : '<div class="muted" style="padding:20px">Nenhum canal neste grupo. Use "+ Canal" ou peça ao assistente.</div>') + '</div>' +
      '<div class="footer"><button type="button" class="btn" data-go="download">Voltar</button><button type="button" class="btn primary" id="toReview" data-go="review">Revisar alterações</button></div>';
    updateCounts();
    v.querySelector('.chips').onclick = (e) => { const g = e.target.getAttribute('data-filter'); if (g) { st.filter = g; render(); } };
    const tb = v.querySelector('tbody');
    tb.addEventListener('change', onCellChange);
    tb.addEventListener('click', (e) => { const i = e.target.getAttribute('data-del'); if (i !== null) { const m = st.working[+i]; st.working[+i] = { number: m.number, empty: true }; delete st.errors[m.number]; e.target.closest('tr').remove(); updateCounts(); } });
    $('#addCh').onclick = addChannel; $('#impCsv').onclick = importCsv; $('#expCsv').onclick = exportCsv; $('#saveImg').onclick = saveImage;
  }
  // Edits re-render only the edited row, so focus and scroll stay where they are.
  function onCellChange(e) {
    const tr = e.target.closest('tr'); const k = e.target.getAttribute('data-k'); if (!tr || !k) return;
    const i = +tr.getAttribute('data-i'); const m = Object.assign({}, st.working[i]); let val = e.target.value;
    if (k === 'tone') { if (m.tmode === 'TSQL') { m.ctone = parseFloat(val); m.rtone = parseFloat(val); } else m.rtone = parseFloat(val); }
    else if (k === 'dtcs') { m.dtcs = parseInt(val, 10) || 23; m.rx_dtcs = m.dtcs; }
    else if (k === 'freq' || k === 'offset') { val = val.replace(',', '.'); const n = parseFloat(val); m[k] = isNaN(n) ? m[k] : n.toFixed(6); }
    else m[k] = val;
    if (k === 'duplex' && (val === '+' || val === '-') && !(parseFloat(m.offset) > 0)) m.offset = parseFloat(m.freq) > 300 ? '5.000000' : '0.600000';
    st.working[i] = m;
    validateRows([m]).then(() => {
      const cur = document.querySelector('tr[data-i="' + i + '"]'); if (!cur) return;
      // keep focus on whichever cell of this row has it now (Tab may have moved it)
      const act = document.activeElement; const keepKey = act && cur.contains(act) ? act.getAttribute('data-k') : null;
      const tmp = document.createElement('tbody'); tmp.innerHTML = rowHtml(i); const nr = tmp.firstChild;
      cur.replaceWith(nr); updateCounts();
      if (keepKey) { const el = nr.querySelector('[data-k="' + keepKey + '"]'); if (el && !el.disabled) el.focus(); }
    });
  }
  async function validateRows(mems) {
    try {
      const res = await call('validate', { memories: mems });
      res.forEach((r) => { if (r.errors.length) st.errors[r.number] = r.errors; else delete st.errors[r.number]; });
    } catch (e) { toast(e.message); }
  }
  function addChannel() {
    const i = st.working.findIndex((m) => m.empty); if (i < 0) return toast('Não há canal livre no rádio.');
    const f = st.radio.features;
    st.working[i] = { number: st.working[i].number, empty: false, name: 'NOVO', freq: '146.520000', duplex: '', offset: '0.000000', tmode: '', rtone: 88.5, ctone: 88.5, dtcs: 23, rx_dtcs: 23, dtcs_polarity: 'NN', cross_mode: 'Tone->Tone', mode: f.valid_modes.includes('FM') ? 'FM' : f.valid_modes[0], tuning_step: 5, skip: '', power: (f.valid_power_levels || [''])[0] || '' };
    st.filter = 'Todos'; validateRows([st.working[i]]).then(() => { render(); const tr = document.querySelector('tr[data-i="' + i + '"]'); if (tr) { tr.scrollIntoView({ block: 'center' }); const n = tr.querySelector('[data-k="name"]'); if (n) { n.focus(); n.select(); } } });
  }
  async function importCsv() {
    const path = await rh.openFile('csv'); if (!path) return;
    try {
      const r = await call('parse_csv', { path });
      const choice = await modal('Importar ' + r.memories.length + ' canais', (r.problems.length ? r.problems.length + ' linhas foram ignoradas (fora da faixa ou incompatíveis).\n\n' : '') + 'Substituir a lista inteira pelo arquivo, ou só gravar por cima das posições que o arquivo traz?', [{ label: 'Cancelar', value: null }, { label: 'Mesclar', value: 'merge' }, { label: 'Substituir tudo', value: 'replace', primary: true }]);
      if (!choice) return;
      if (choice === 'replace') st.working = st.working.map((m) => ({ number: m.number, empty: true }));
      r.memories.forEach((m) => { const i = idxOf(m.number); if (i >= 0) st.working[i] = m; });
      await validateRows(r.memories); st.filter = 'Todos'; render(); toast(r.memories.length + ' canais importados. Nada foi gravado no rádio ainda.');
    } catch (e) { modal('Não deu para importar', e.friendly || e.message, [{ label: 'OK', primary: true }]); }
  }
  async function exportCsv() {
    const path = await rh.saveFile('csv', (st.radio.model || 'radio').replace(/\W+/g, '_') + '.csv'); if (!path) return;
    try { await call('export_csv', { path, memories: st.working }); toast('CSV salvo.'); } catch (e) { toast(e.message); }
  }
  async function saveImage() {
    const path = await rh.saveFile('img', (st.radio.model || 'radio').replace(/\W+/g, '_') + '.img'); if (!path) return;
    try { await syncToEngine(); await call('save_image', { path }); toast('Imagem salva.'); } catch (e) { toast(e.message); }
  }
  async function syncToEngine() {
    const d = diff(); const mems = d.add.concat(d.chg).concat(d.del.map((o) => ({ number: o.number, empty: true })));
    if (!mems.length) return { applied: [], failed: [] };
    const r = await call('set_memories', { memories: mems });
    r.failed.forEach((f) => { st.errors[f.number] = f.errors; });
    return r;
  }

  // ------------------------------------------------------------ AI panel
  function renderAI() {
    const ai = $('#ai'); const p = provider();
    const region = st.settings.region || 'Brasília, DF';
    ai.innerHTML = '<div class="ai-head"><div class="spread"><strong>Assistente de frequências</strong><button type="button" class="btn sm" data-go="settings" title="Trocar provedor">' + esc(p.label) + ' · ' + esc(p.price) + '</button></div><div class="muted" style="font-size:12px">Região: ' + esc(region) + '</div></div>' +
      '<div class="ai-log" id="log">' + (st.chat.length ? '' : (aiReady()
        ? '<div class="msg">Oi! Posso montar listas de frequências da sua região, organizar e renumerar canais, ou explicar qualquer ajuste. Nada é gravado sem a sua revisão.</div>'
        : '<div class="msg">Para usar o assistente, conecte um provedor de IA. O padrão é o ' + esc(p.label) + ', ' + (p.price === 'Grátis' ? 'que é grátis' : p.price.toLowerCase()) + '.</div><button type="button" class="btn primary sm" data-go="settings" style="align-self:flex-start">Conectar IA</button>')) +
      st.chat.map(renderMsg).join('') + (st.chatBusy ? '<div class="msg sys"><span class="spin"></span> ' + esc(st.chatStatus || 'Pensando…') + '</div>' : '') + '</div>' +
      '<form class="ai-form" id="aiForm"><div class="chips">' + ['Repetidoras da minha região', 'Aeroporto mais próximo', 'Remover duplicados', 'Renumerar por grupo'].map((q) => '<button type="button" class="chip" data-q="' + esc(q) + '" style="font-size:12px;padding:5px 10px">' + esc(q) + '</button>').join('') + '</div>' +
      '<label class="sr" for="ask">Mensagem para o assistente</label><div class="row" style="flex-wrap:nowrap;gap:8px"><input id="ask" class="input" style="flex:1;min-width:0" placeholder="Peça uma lista, uma região ou um ajuste…" autocomplete="off"' + (st.chatBusy ? ' disabled' : '') + '><button type="submit" class="btn primary" aria-label="Enviar" style="width:44px;padding:0"' + (st.chatBusy ? ' disabled' : '') + '>→</button></div></form>';
    const log = $('#log'); log.scrollTop = log.scrollHeight;
    $('#aiForm').onsubmit = (e) => { e.preventDefault(); const t = $('#ask').value.trim(); if (t) sendChat(t); };
    ai.querySelector('.chips').onclick = (e) => { const q = e.target.getAttribute('data-q'); if (q) sendChat(q + (q.includes('região') ? ' (' + region + ')' : '')); };
    log.onclick = (e) => {
      const a = e.target.getAttribute('data-apply'); if (a !== null) applyProposal(+a);
      const d = e.target.getAttribute('data-details'); if (d !== null) { st.chat[+d].open = !st.chat[+d].open; renderAI(); }
      const u = e.target.getAttribute('data-url'); if (u) { e.preventDefault(); rh.openUrl(u); }
    };
  }
  function renderMsg(c, idx) {
    if (c.role === 'user') return '<div class="msg me">' + esc(c.text) + '</div>';
    if (c.role === 'error') return '<div class="msg" style="background:var(--badbg);color:#FFD0C7">' + esc(c.text) + '</div>';
    if (c.role === 'status') return '<div class="msg sys">' + esc(c.text) + '</div>';
    if (c.role === 'proposal') {
      const p = c.proposal; const ops = p.operations || []; const sets = ops.filter((o) => o.action === 'set'); const dels = ops.filter((o) => o.action === 'delete');
      const conflicts = sets.filter((o) => { const i = idxOf(o.number); return i >= 0 && !st.working[i].empty && Math.abs(parseFloat(st.working[i].freq) - parseFloat(o.freq)) > 1e-6; }).length;
      return '<div class="prop"><strong style="font-size:13px">Proposta de alterações</strong><div class="muted" style="font-size:13px">' + esc(p.summary || '') + '</div>' +
        '<div class="line"><span>Canais a gravar</span><span class="mono" style="color:var(--ok)">+' + sets.length + '</span></div>' +
        (dels.length ? '<div class="line"><span>Canais a apagar</span><span class="mono" style="color:var(--bad)">−' + dels.length + '</span></div>' : '') +
        '<div class="line"><span>Substituem canais ocupados</span><span class="mono">' + conflicts + '</span></div>' +
        (c.open ? '<ul>' + ops.map((o) => '<li>' + esc((o.action === 'delete' ? 'Apagar ' : '') + String(o.number).padStart(3, '0') + ' ' + (o.name || '') + ' ' + (o.freq ? fmtF(o.freq) : '') + (o.duplex && o.duplex !== 'off' ? ' ' + o.duplex + fmtF(o.offset) : '') + (o.tmode ? ' ' + o.tmode + ' ' + (o.tmode === 'DTCS' ? o.dtcs : o.rtone || o.ctone) : '') + (o.note ? ' · ' + o.note : '')) + '</li>').join('') + '</ul>' : '') +
        '<div class="row" style="gap:8px">' + (c.applied ? '<span class="pill ok">Aplicado na lista</span>' : '<button type="button" class="btn primary sm" data-apply="' + idx + '">Aplicar</button>') + '<button type="button" class="btn sm" data-details="' + idx + '">' + (c.open ? 'Ocultar' : 'Ver detalhes') + '</button></div>' +
        ((p.sources || []).length ? '<div class="muted" style="font-size:12px">Fontes: ' + p.sources.map((s) => '<a href="#" data-url="' + esc(s.url) + '">' + esc(s.title || String(s.url).replace(/^https?:\/\//, '').split('/')[0]) + '</a>').join(' · ') + '</div>' : '<div class="muted" style="font-size:12px">Sem fonte citada: confira antes de gravar.</div>') + '</div>';
    }
    return '<div class="msg">' + esc(c.text) + '</div>';
  }
  async function sendChat(text) {
    if (st.chatBusy) return;
    if (!aiReady()) { st.chat.push({ role: 'error', text: 'Conecte um provedor de IA em Configurações para usar o assistente.' }); renderAI(); return; }
    st.chat.push({ role: 'user', text });
    st.chatBusy = true; st.chatStatus = 'Pensando…'; renderAI();
    try {
      const res = await rh.chat({ history: st.aiHistory, text, context: radioContext() });
      st.aiHistory = res.history;
      res.items.forEach((it) => {
        if (it.type === 'text') st.chat.push({ role: 'assistant', text: it.text });
        else if (it.type === 'status') st.chat.push({ role: 'status', text: it.text });
        else if (it.type === 'proposal') st.chat.push({ role: 'proposal', proposal: it.proposal || { operations: [] } });
      });
      if (!res.items.length) st.chat.push({ role: 'assistant', text: '(sem resposta)' });
    } catch (e) { st.chat.push({ role: 'error', text: cleanErr(e).msg }); }
    st.chatBusy = false; render();
  }
  async function applyProposal(idx) {
    const c = st.chat[idx]; if (!c || c.applied) return;
    const f = st.radio.features; const touched = [];
    (c.proposal.operations || []).forEach((o) => {
      const i = idxOf(o.number); if (i < 0) return;
      if (o.action === 'delete') { st.working[i] = { number: o.number, empty: true }; return; }
      if (!o.freq || isNaN(parseFloat(o.freq))) return;
      const base = st.working[i].empty ? { dtcs_polarity: 'NN', cross_mode: 'Tone->Tone', skip: '', tuning_step: 5, rx_dtcs: 23 } : st.working[i];
      const m = Object.assign({}, base, {
        number: o.number, empty: false, name: (o.name || '').slice(0, f.valid_name_length || 16), freq: parseFloat(o.freq).toFixed(6),
        duplex: o.duplex || '', offset: parseFloat(o.offset || 0).toFixed(6), tmode: o.tmode || '',
        rtone: o.rtone || base.rtone || 88.5, ctone: o.ctone || o.rtone || base.ctone || 88.5, dtcs: o.dtcs || base.dtcs || 23,
        mode: o.mode || base.mode || 'FM', power: o.power || base.power || (f.valid_power_levels || [''])[0] || ''
      });
      if (m.duplex && !f.valid_duplexes.includes(m.duplex)) m.duplex = '';
      if (!f.valid_modes.includes(m.mode)) m.mode = f.valid_modes.includes('FM') ? 'FM' : f.valid_modes[0];
      if (m.tmode && !f.valid_tmodes.includes(m.tmode)) m.tmode = '';
      st.working[i] = m; touched.push(m);
    });
    c.applied = true;
    if (touched.length) await validateRows(touched);
    const bad = touched.filter((m) => st.errors[m.number]).length;
    render(); toast(touched.length + ' canais aplicados' + (bad ? ', ' + bad + ' com erro (em vermelho)' : '') + '. Revise antes de gravar.');
  }

  // ------------------------------------------------------------ step 4
  function vReview(v) {
    const d = diff(); const errs = Object.keys(st.errors).length; const p = st.progress;
    const pct = p && p.max ? Math.round(100 * p.cur / p.max) : 0;
    const item = (sym, color, m) => '<div class="spread" style="padding:10px 16px;border-bottom:1px solid var(--line)"><span class="row"><span style="color:' + color + ';font-weight:700;width:18px">' + sym + '</span><span class="mono muted">' + String(m.number).padStart(3, '0') + '</span>' + esc(m.name || '') + '</span><span class="mono muted">' + esc(fmtF(m.freq)) + (m.duplex === '+' || m.duplex === '-' ? ' ' + m.duplex + fmtF(m.offset) : '') + ' ' + esc(m.mode || '') + '</span></div>';
    const list = d.add.map((m) => item('+', 'var(--ok)', m)).concat(d.chg.map((m) => item('~', 'var(--warn)', m))).concat(d.del.map((m) => item('−', 'var(--bad)', m)));
    v.innerHTML = '<header style="display:flex;flex-direction:column;gap:8px"><span class="eyebrow">Etapa 4 de 4</span><h1>Revise antes de gravar</h1><p class="lead">' + (st.radio.backup_path ? 'O backup de hoje já está salvo. Dá para voltar ao estado anterior a qualquer momento.' : 'Uma cópia do que será gravado é salva antes do envio.') + '</p></header>' +
      '<section class="grid3"><div class="card"><span class="muted">Adicionados</span><span class="stat" style="color:var(--ok)">+' + d.add.length + '</span></div><div class="card"><span class="muted">Alterados</span><span class="stat" style="color:var(--warn)">' + d.chg.length + '</span></div><div class="card"><span class="muted">Removidos</span><span class="stat" style="color:var(--bad)">−' + d.del.length + '</span></div></section>' +
      (errs ? '<div class="notice bad">' + errs + ' canais têm erro e precisam ser corrigidos antes de gravar.</div>' : '') +
      '<section class="card" style="padding:0;overflow:hidden;max-height:320px;overflow-y:auto">' + (list.join('') || '<div class="muted" style="padding:16px">Nenhuma alteração em relação ao que foi lido do rádio.</div>') + '</section>' +
      (p ? '<section class="card"><div class="spread"><strong>Gravando no rádio</strong><span class="mono">' + pct + '%</span></div><div class="bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><div style="width:' + pct + '%"></div></div><span class="muted">Não desconecte o cabo nem desligue o rádio. ' + esc(p.msg || '') + '</span></section>' : '') +
      (!st.port && st.radio ? '<section class="card"><h2>Porta para gravar</h2><label class="sr" for="upPort">Porta</label><select id="upPort" class="input">' + st.ports.map((x) => '<option>' + esc(x.device) + '</option>').join('') + '</select></section>' : '') +
      (st.radio.prompts_pre_upload ? '<details class="notice"><summary style="cursor:pointer"><strong>Instruções do driver para gravar</strong> (em inglês)</summary>\n' + esc(st.radio.prompts_pre_upload) + '</details>' : '') +
      '<div class="footer"><button type="button" class="btn" data-go="channels"' + (st.busy ? ' disabled' : '') + '>Voltar e ajustar</button><div class="row"><button type="button" class="btn" id="expCsv2"' + (st.busy ? ' disabled' : '') + '>Exportar CSV</button><button type="button" class="btn primary" id="upload"' + (st.busy || errs || !list.length ? ' disabled' : '') + '>Gravar no rádio</button></div></div>';
    $('#expCsv2').onclick = exportCsv; $('#upload').onclick = doUpload;
  }
  async function doUpload() {
    const port = st.port || ($('#upPort') && $('#upPort').value);
    if (!port) return toast('Conecte o rádio e escolha a porta.');
    const ok = await modal('Gravar no rádio?', 'As alterações vão substituir os canais do rádio. Mantenha o rádio ligado e o cabo conectado até o fim.', [{ label: 'Cancelar', value: false }, { label: 'Gravar', value: true, primary: true }]);
    if (!ok) return;
    st.busy = true; st.progress = { cur: 0, max: 1, msg: 'Preparando…' }; render();
    try {
      const r = await syncToEngine();
      if (r.failed.length) throw new Error(r.failed.length + ' canais foram recusados pelo driver. Corrija os que estão em vermelho.');
      const up = await call('upload', { port });
      await loadMemories(true);
      st.busy = false; st.progress = null; render();
      modal('Gravação concluída', 'Os canais já estão no rádio. Uma cópia do que foi enviado ficou em:\n' + up.saved_copy, [{ label: 'OK', primary: true }]);
    } catch (e) {
      st.busy = false; st.progress = null; render();
      modal('A gravação não terminou', (e.friendly || e.message) + '\n\nO backup continua salvo. Confira o cabo e tente de novo.', [{ label: 'OK', primary: true }]);
    }
  }

  // ------------------------------------------------------------ settings
  function vSettings(v) {
    const s = st.settings; const p = provider(); const has = (s.hasKey || {})[p.id];
    const models = st.providerModels[p.id];
    const cur = (s.models || {})[p.id] || (models && models.suggested) || '';
    v.innerHTML = '<header style="display:flex;flex-direction:column;gap:8px"><h1>Configurações</h1><p class="lead">Escolha a inteligência artificial do assistente. As opções grátis funcionam sem cartão de crédito.</p></header>' +
      '<section class="card"><h2>Provedor de IA</h2><div class="prov-grid" role="radiogroup" aria-label="Provedor de IA">' +
      (s.providers || []).map((x) => '<button type="button" role="radio" aria-checked="' + (x.id === p.id) + '" class="prov ' + (x.id === p.id ? 'on' : '') + '" data-prov="' + x.id + '"><span class="spread" style="width:100%"><strong>' + esc(x.label) + '</strong><span class="pill ' + (x.price === 'Grátis' || x.price === 'Local' ? 'ok' : 'mute') + '">' + esc(x.price) + '</span></span><span class="muted" style="font-size:12px;text-align:left">' + esc(x.note) + '</span>' + ((s.hasKey || {})[x.id] && !x.noKey ? '<span style="font-size:12px;color:var(--ok)">● Conectado</span>' : '') + '</button>').join('') + '</div></section>' +
      '<section class="card"><div class="spread"><h2>' + esc(p.label) + '</h2>' + (has ? '<span class="pill ok">' + (p.noKey ? 'Sem chave' : 'Conectado') + '</span>' : '<span class="pill mute">Não conectado</span>') + '</div>' +
      (p.noKey
        ? '<p class="muted" style="margin:0">Não precisa de chave. Abra o app Ollama no Mac e baixe um modelo que use ferramentas, por exemplo: <span class="mono" style="color:var(--txt)">ollama pull qwen3</span>.</p>'
        : (st.keyWaiting
          ? '<div class="notice"><strong>Site do ' + esc(p.label) + ' aberto.</strong>\nEntre na sua conta, crie uma chave (pode chamar de RadioHub) e clique em Copiar. O RadioHub pega a chave sozinho e fecha a janela.</div><div class="row"><span class="spin"></span><span class="muted">Aguardando você copiar a chave…</span></div>'
          : '<ol class="muted" style="margin:0;padding-left:20px;line-height:1.8"><li>Clique em <strong style="color:var(--txt)">Conectar</strong>. Abre o site oficial do ' + esc(p.label) + ' dentro do app.</li><li>Entre na sua conta (ou crie uma).</li><li>Crie uma chave e clique em <strong style="color:var(--txt)">Copiar</strong>.</li><li>Pronto: o RadioHub captura a chave, salva e fecha a janela.</li></ol>' +
            '<div class="row"><button type="button" class="btn primary" id="wizard">' + (has ? 'Gerar nova chave' : 'Conectar ' + esc(p.label)) + '</button>' + (p.id === 'claude' ? '<button type="button" class="btn" id="billing">Adicionar créditos</button>' : '') + '</div>' +
            '<details class="muted"><summary style="cursor:pointer;color:var(--acc)">Já tenho uma chave e quero colar</summary><div class="row" style="margin-top:10px"><label for="key" class="sr">Chave da API</label><input id="key" type="password" class="input" style="flex:1 1 320px" placeholder="Cole a chave aqui" autocomplete="off"><button type="button" class="btn" id="saveKey">Salvar</button></div></details>')) +
      '<div class="row" style="align-items:flex-end"><div style="display:flex;flex-direction:column;gap:6px;flex:1 1 300px"><label for="mdl" class="muted">Modelo</label>' +
      (models && models.models.length ? '<select id="mdl" class="input">' + opts(models.models, cur) + '</select>' : '<input id="mdl" class="input" value="' + esc(cur) + '" placeholder="automático">') + '</div>' +
      '<button type="button" class="btn" id="loadModels"' + (has ? '' : ' disabled') + '>Atualizar lista</button><button type="button" class="btn" id="testAI"' + (has ? '' : ' disabled') + '>Testar</button></div>' +
      '<span class="muted" style="font-size:12px">' + (p.id === 'claude' ? 'O Claude pesquisa na web sozinho.' : 'Este provedor não pesquisa na web sozinho: o assistente lê sites conhecidos (LABRE, repetidoras.com.br, SkyVector) para conferir as frequências.') + ' Chaves ficam criptografadas pelo Keychain do Mac.</span></section>' +
      '<section class="card"><h2>Região</h2><label for="region" class="muted">Região padrão do assistente</label><div class="row"><input id="region" class="input" style="flex:1 1 300px;max-width:420px" value="' + esc(s.region || 'Brasília, DF') + '"><button type="button" class="btn" id="saveRegion">Salvar</button></div></section>' +
      '<section class="card" style="border-style:dashed"><div class="spread"><h2 class="muted">Atualização de firmware</h2><span class="pill mute">Fase 2</span></div><span class="muted">Vai verificar a versão do rádio, baixar o firmware oficial e gravar com travas de segurança.</span></section>' +
      '<div class="footer"><button type="button" class="btn" id="back">Voltar</button><button type="button" class="btn" data-go="about">Sobre e apoio</button></div>';
    v.querySelector('.prov-grid').onclick = async (e) => {
      const b = e.target.closest('[data-prov]'); if (!b) return;
      st.settings = await rh.setSettings({ provider: b.getAttribute('data-prov') }); st.aiHistory = null; render();
      if ((st.settings.hasKey || {})[st.settings.provider] && !st.providerModels[st.settings.provider]) loadModels(true);
    };
    if ($('#wizard')) $('#wizard').onclick = async () => {
      st.keyWaiting = true; render();
      const r = await rh.keyWizard(p.id);
      st.keyWaiting = false; st.settings = await rh.getSettings(); render();
      if (r && r.ok) { toast('Chave capturada e salva. Testando…'); await loadModels(true); testAI(); }
      else if (r && r.reason === 'closed') toast('Janela fechada sem copiar a chave.');
    };
    if ($('#billing')) $('#billing').onclick = () => rh.openBilling();
    if ($('#saveKey')) $('#saveKey').onclick = async () => { const k = $('#key').value.trim(); if (!k) return; st.settings = await rh.setSettings({ apiKey: k, keyProvider: p.id }); toast('Chave salva.'); render(); await loadModels(true); };
    $('#mdl').onchange = async (e) => { st.settings = await rh.setSettings({ models: { [p.id]: e.target.value } }); toast('Modelo salvo.'); };
    $('#loadModels').onclick = () => loadModels(false);
    $('#testAI').onclick = testAI;
    $('#saveRegion').onclick = async () => { st.settings = await rh.setSettings({ region: $('#region').value.trim() }); toast('Região salva.'); };
    $('#back').onclick = () => go(st.radio ? 'channels' : 'connect');
  }
  async function loadModels(quiet) {
    const id = st.settings.provider;
    try {
      const r = await rh.listModels(id); st.providerModels[id] = r;
      if (!(st.settings.models || {})[id] && r.suggested) st.settings = await rh.setSettings({ models: { [id]: r.suggested } });
      if (st.view === 'settings') render();
      if (!quiet) toast(r.models.length + ' modelos disponíveis.');
    } catch (e) { if (!quiet) modal('Não deu para listar os modelos', cleanErr(e).msg, [{ label: 'OK', primary: true }]); }
  }
  async function testAI() {
    try { const r = await rh.testAI(st.settings.provider); toast('IA funcionando: ' + r); }
    catch (e) {
      const msg = cleanErr(e).msg;
      const credit = /credit|billing|balance|quota|insufficient/i.test(msg);
      const ok = await modal(credit ? 'Faltam créditos ou cota' : 'A IA não respondeu', credit ? (st.settings.provider === 'claude' ? 'A chave foi salva, mas a conta da API ainda não tem créditos. Adicione créditos e teste de novo.' : 'A cota grátis deste provedor acabou por hoje ou exige créditos. Tente outro provedor grátis.\n\n' + msg) : msg, credit && st.settings.provider === 'claude' ? [{ label: 'Depois', value: false }, { label: 'Adicionar créditos', value: true, primary: true }] : [{ label: 'OK', primary: true }]);
      if (ok) rh.openBilling();
    }
  }

  // ------------------------------------------------------------ about
  function pixPayload(key, name, city) {
    const f = (id, v) => id + String(v.length).padStart(2, '0') + v;
    const ascii = (t, n) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, n);
    let p = f('00', '01') + f('26', f('00', 'br.gov.bcb.pix') + f('01', key)) + f('52', '0000') + f('53', '986') + f('58', 'BR') + f('59', ascii(name, 25)) + f('60', ascii(city, 15)) + f('62', f('05', '***')) + '6304';
    let crc = 0xFFFF;
    for (let i = 0; i < p.length; i++) { crc ^= p.charCodeAt(i) << 8; for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF; }
    return p + crc.toString(16).toUpperCase().padStart(4, '0');
  }
  function vAbout(v) {
    const d = st.settings.dev || {};
    const payload = pixPayload(d.pix || '', d.name || '', 'Brasilia');
    let qr = '';
    try { const q = window.qrcode(0, 'M'); q.addData(payload); q.make(); qr = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); } catch (e) {}
    v.innerHTML = '<header style="display:flex;flex-direction:column;gap:8px"><span class="eyebrow">Sobre</span><h1>RadioHub</h1><p class="lead">Versão ' + esc(st.settings.version || '') + '. Gestão de rádios com os drivers do CHIRP e assistente de frequências com IA.</p></header>' +
      '<div class="about-grid"><section class="card"><h2>Desenvolvido por</h2><strong style="font-size:22px">' + esc(d.name) + '</strong>' +
      '<div class="contact"><span class="muted">WhatsApp</span><a href="#" data-url="' + esc(d.whatsapp) + '">' + esc(d.phone) + '</a></div>' +
      '<div class="contact"><span class="muted">Site</span><a href="#" data-url="' + esc(d.site) + '">' + esc((d.site || '').replace('https://', '')) + '</a></div>' +
      '<div class="contact"><span class="muted">E-mail</span><a href="#" data-url="mailto:' + esc(d.email) + '">' + esc(d.email) + '</a></div></section>' +
      '<section class="card pix"><h2>Apoie o projeto</h2><p class="muted" style="margin:0">Se o RadioHub te ajudou, um Pix de qualquer valor ajuda a manter o desenvolvimento.</p><div class="qr" aria-label="QR Code Pix">' + qr + '</div>' +
      '<div class="contact"><span class="muted">Chave Pix</span><span class="mono">' + esc(d.pix) + '</span></div><div class="row"><button type="button" class="btn primary sm" id="cpKey">Copiar chave Pix</button><button type="button" class="btn sm" id="cpCode">Copiar Pix copia e cola</button></div></section></div>' +
      '<section class="card"><div class="spread"><h2>Atualizações</h2><button type="button" class="btn sm" id="chkUpd">Verificar agora</button></div><span class="muted" id="updState">O RadioHub verifica sozinho ao abrir e a cada 6 horas, e avisa quando sair uma versão nova. Versões e novidades em radiohub.diegocosta.digital.</span></section>' +
      '<section class="card"><h2>Créditos</h2><span class="muted">Drivers de rádio: CHIRP (chirpmyradio.com), software livre sob a licença GPL v3. O RadioHub também é GPL v3. Ilustrações dos rádios são genéricas, feitas para o app. Backups em ~/RadioHub/backups e registros em ~/RadioHub/logs.</span></section>' +
      '<div class="footer"><button type="button" class="btn" id="back">Voltar</button></div>';
    v.onclick = (e) => { const u = e.target.getAttribute('data-url'); if (u) { e.preventDefault(); rh.openUrl(u); } };
    $('#chkUpd').onclick = async () => {
      const s = $('#updState'); s.textContent = 'Verificando…';
      try {
        const r = await rh.checkUpdate();
        s.textContent = r.reason === 'not-configured' ? 'Atualizações ainda não configuradas nesta versão.' : r.available ? 'Versão ' + r.latest.version + ' disponível.' : 'Você está na versão mais recente (' + r.current + ').';
      } catch (e) { s.textContent = 'Não consegui verificar agora: ' + cleanErr(e).msg; }
    };
    $('#cpKey').onclick = async () => { await rh.copy(d.pix); toast('Chave Pix copiada.'); };
    $('#cpCode').onclick = async () => { await rh.copy(payload); toast('Pix copia e cola copiado.'); };
    $('#back').onclick = () => go(st.radio ? 'channels' : 'connect');
  }

  // ------------------------------------------------------------ updates
  function mdLite(t) { // release notes: keep it plain, just bullets and line breaks
    return esc(String(t || '').slice(0, 2000)).replace(/^#+\s*/gm, '').replace(/^\s*[-*]\s+/gm, '• ').replace(/\*\*([^*]+)\*\*/g, '$1');
  }
  function fmtMB(n) { return n ? (n / 1048576).toFixed(0) + ' MB' : ''; }
  function updateBar() {
    const b = $('#updateBar'); if (!b) return;
    if (!st.update) { b.hidden = true; return; }
    b.hidden = false;
    b.innerHTML = '<span>Nova versão <strong>' + esc(st.update.version) + '</strong> disponível</span><button type="button" class="btn primary sm" id="updOpen">Atualizar</button><button type="button" class="btn sm" id="updLater" aria-label="Fechar aviso">Depois</button>';
    $('#updOpen').onclick = () => showUpdate(st.update, true);
    $('#updLater').onclick = () => { b.hidden = true; };
  }
  function showUpdate(info, force) {
    st.update = info; updateBar();
    if (st.updateShown && !force) return; st.updateShown = true;
    const m = $('#modal');
    m.innerHTML = '<div class="box" role="dialog" aria-modal="true" aria-labelledby="ut"><span class="pill ok" style="align-self:flex-start">Atualização disponível</span><h2 id="ut">RadioHub ' + esc(info.version) + '</h2>' +
      '<div class="muted" style="font-size:13px">Você está na versão ' + esc(st.settings.version || '') + (info.size ? ' · download de ' + fmtMB(info.size) : '') + '</div>' +
      (info.notes ? '<div class="notice" style="max-height:200px;overflow:auto;white-space:pre-line">' + mdLite(info.notes) + '</div>' : '') +
      '<div id="updProg" hidden><div class="bar"><div id="updBar" style="width:0%"></div></div><span class="muted" id="updTxt" style="font-size:12px">Baixando…</span></div>' +
      '<div class="row" id="updBtns" style="justify-content:flex-end"><button type="button" class="btn" data-u="skip">Pular esta versão</button><button type="button" class="btn" data-u="later">Depois</button><button type="button" class="btn primary" data-u="go">Atualizar agora</button></div></div>';
    m.hidden = false;
    m.onclick = async (e) => {
      const a = e.target.getAttribute('data-u'); if (!a) return;
      if (a === 'later') { m.hidden = true; return; }
      if (a === 'skip') { await rh.skipUpdate(info.version); st.update = null; updateBar(); m.hidden = true; return; }
      if (a === 'go') {
        $('#updBtns').hidden = true; $('#updProg').hidden = false;
        try {
          const r = await rh.downloadUpdate();
          const isWin = st.settings.platform === 'win32';
          const steps = isWin
            ? 'O instalador da versão ' + esc(info.version) + ' foi aberto.\n\n1. Feche o RadioHub (botão abaixo).\n2. Siga os passos do instalador.\n3. O RadioHub abre sozinho no final.\n\nSeus backups, chaves e configurações continuam onde estão.'
            : 'O instalador da versão ' + esc(info.version) + ' foi aberto.\n\n1. Feche o RadioHub (botão abaixo).\n2. Na janela do instalador, arraste o RadioHub para a pasta Aplicativos e escolha Substituir.\n3. Abra o RadioHub de novo.\n\nSeus backups, chaves e configurações continuam onde estão.';
          m.innerHTML = '<div class="box" role="dialog" aria-modal="true" aria-labelledby="ud"><h2 id="ud">Quase lá</h2><div class="muted" style="white-space:pre-line">' + steps + '</div><div class="muted mono" style="font-size:12px">' + esc(r.path) + '</div><div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-u="stay">Depois</button><button type="button" class="btn primary" data-u="quit">Fechar o RadioHub</button></div></div>';
          m.onclick = (ev) => { const b = ev.target.getAttribute('data-u'); if (b === 'quit') rh.quit(); if (b === 'stay') m.hidden = true; };
        } catch (err) {
          $('#updBtns').hidden = false; $('#updProg').hidden = true;
          toast(cleanErr(err).msg);
        }
      }
    };
  }
  rh.onUpdate((info) => showUpdate(info));
  rh.onUpdateProgress((p) => {
    const bar = $('#updBar'), txt = $('#updTxt'); if (!bar) return;
    const pct = p.total ? Math.round(100 * p.got / p.total) : 0;
    bar.style.width = pct + '%'; txt.textContent = 'Baixando… ' + fmtMB(p.got) + (p.total ? ' de ' + fmtMB(p.total) : '');
  });

  // ------------------------------------------------------------ boot
  document.addEventListener('click', async (e) => {
    const g = e.target.closest('[data-go]'); if (g && !g.disabled) { go(g.getAttribute('data-go')); return; }
    const ph = e.target.closest('[data-photo]');
    if (ph) { const id = ph.getAttribute('data-photo'); try { const url = await rh.choosePhoto(id); if (url) { st.photos[id] = url; render(); } } catch (err) { toast(cleanErr(err).msg); } return; }
    const un = e.target.closest('[data-unphoto]');
    if (un) { const id = un.getAttribute('data-unphoto'); await rh.removePhoto(id); st.photos[id] = null; render(); }
  });
  rh.onEngineEvent((msg) => {
    if (msg.event === 'progress') { st.progress = msg; if (st.view === 'download' || st.view === 'review') render(); }
    if (msg.event === 'engine-exit') toast('O motor reiniciou. Se algo falhou, tente de novo.');
  });
  (async function boot() {
    st.settings = await rh.getSettings();
    document.body.classList.add('plat-' + (st.settings.platform || 'darwin'));
    $('#devCredit').innerHTML = 'por <a href="#" data-go="about">' + esc((st.settings.dev || {}).name || '') + '</a>';
    render();
    for (let i = 0; i < 40 && !st.models.length; i++) {
      try { st.models = await call('list_models'); } catch (e) { await new Promise((r) => setTimeout(r, 500)); }
    }
    if (st.settings.lastModel) await selectModel(st.settings.lastModel);
    await pollPorts(); render();
    setInterval(() => { if (!st.busy) pollPorts(); }, 2000);
  })();
})();
