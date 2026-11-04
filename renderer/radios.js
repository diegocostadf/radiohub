// Original, generic radio illustrations by form factor (no brand artwork).
// GPL-3.0-or-later.
'use strict';
(function () {
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const C = { body: '#232833', body2: '#1A1E27', edge: '#3A4150', key: '#2E3440', keyTxt: '#9AA3AF', lcd: '#2A2213', lcdTxt: '#FFC15E', acc: '#F5A524', dim: '#5B6372' };

  function handheld(o) {
    let keys = '';
    const labels = ['1', '2', '3', 'M', '4', '5', '6', '▲', '7', '8', '9', '▼', '*', '0', '#', 'X'];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const x = 46 + c * 28, y = 230 + r * 22;
      keys += '<rect x="' + x + '" y="' + y + '" width="22" height="16" rx="4" fill="' + C.key + '"/><text x="' + (x + 11) + '" y="' + (y + 12) + '" font-size="9" text-anchor="middle" fill="' + C.keyTxt + '" font-family="-apple-system,sans-serif">' + labels[r * 4 + c] + '</text>';
    }
    let grille = '';
    for (let i = 0; i < 6; i++) grille += '<rect x="58" y="' + (176 + i * 7) + '" width="84" height="3" rx="1.5" fill="' + C.body2 + '"/>';
    return '<svg viewBox="0 0 200 360" role="img" aria-label="' + esc(o.label) + '" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="46" y="8" width="12" height="96" rx="6" fill="' + C.body2 + '" stroke="' + C.edge + '"/>' +
      '<rect x="128" y="22" width="22" height="30" rx="6" fill="' + C.key + '" stroke="' + C.edge + '"/>' +
      '<rect x="133" y="26" width="2" height="22" fill="' + C.dim + '"/><rect x="139" y="26" width="2" height="22" fill="' + C.dim + '"/><rect x="145" y="26" width="2" height="22" fill="' + C.dim + '"/>' +
      '<rect x="30" y="52" width="140" height="296" rx="22" fill="' + C.body + '" stroke="' + C.edge + '" stroke-width="1.5"/>' +
      '<rect x="22" y="128" width="9" height="56" rx="4" fill="' + C.key + '"/>' +
      '<circle cx="120" cy="70" r="4" fill="' + C.acc + '"/>' +
      '<rect x="44" y="84" width="112" height="78" rx="8" fill="' + C.lcd + '" stroke="' + C.edge + '"/>' +
      '<text x="54" y="104" font-size="10" fill="' + C.lcdTxt + '" opacity=".75" font-family="ui-monospace,Menlo,monospace">' + esc((o.vendor || '').slice(0, 14)) + '</text>' +
      '<text x="54" y="128" font-size="17" font-weight="700" fill="' + C.lcdTxt + '" font-family="ui-monospace,Menlo,monospace">' + esc(o.freq || '146.520') + '</text>' +
      '<text x="54" y="150" font-size="10" fill="' + C.lcdTxt + '" opacity=".75" font-family="ui-monospace,Menlo,monospace">' + esc((o.model || '').slice(0, 14)) + '</text>' +
      grille + keys + '</svg>';
  }

  function mobile(o) {
    let btns = '';
    for (let i = 0; i < 6; i++) btns += '<rect x="' + (96 + i * 30) + '" y="148" width="24" height="14" rx="4" fill="' + C.key + '"/>';
    return '<svg viewBox="0 0 360 220" role="img" aria-label="' + esc(o.label) + '" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="20" y="40" width="320" height="140" rx="18" fill="' + C.body + '" stroke="' + C.edge + '" stroke-width="1.5"/>' +
      '<rect x="32" y="180" width="296" height="12" rx="6" fill="' + C.body2 + '"/>' +
      '<circle cx="62" cy="96" r="24" fill="' + C.key + '" stroke="' + C.edge + '"/><circle cx="62" cy="96" r="4" fill="' + C.dim + '"/>' +
      '<circle cx="298" cy="96" r="24" fill="' + C.key + '" stroke="' + C.edge + '"/><circle cx="298" cy="96" r="4" fill="' + C.dim + '"/>' +
      '<rect x="96" y="60" width="168" height="76" rx="8" fill="' + C.lcd + '" stroke="' + C.edge + '"/>' +
      '<text x="108" y="80" font-size="10" fill="' + C.lcdTxt + '" opacity=".75" font-family="ui-monospace,Menlo,monospace">' + esc((o.vendor || '').slice(0, 20)) + '</text>' +
      '<text x="108" y="108" font-size="22" font-weight="700" fill="' + C.lcdTxt + '" font-family="ui-monospace,Menlo,monospace">' + esc(o.freq || '146.520') + '</text>' +
      '<text x="108" y="127" font-size="10" fill="' + C.lcdTxt + '" opacity=".75" font-family="ui-monospace,Menlo,monospace">' + esc((o.model || '').slice(0, 20)) + '</text>' +
      btns + '<circle cx="62" cy="154" r="6" fill="' + C.acc + '"/>' +
      '<path d="M298 150 c 20 10, 30 30, 20 50" stroke="' + C.dim + '" stroke-width="3" fill="none"/>' +
      '</svg>';
  }

  function base(o) {
    let meter = '';
    for (let i = 0; i < 9; i++) meter += '<rect x="' + (226 + i * 10) + '" y="' + (78 - i * 2) + '" width="6" height="' + (8 + i * 2) + '" rx="1" fill="' + (i < 6 ? C.acc : C.dim) + '"/>';
    return '<svg viewBox="0 0 360 230" role="img" aria-label="' + esc(o.label) + '" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="16" y="30" width="328" height="176" rx="14" fill="' + C.body + '" stroke="' + C.edge + '" stroke-width="1.5"/>' +
      '<rect x="30" y="206" width="20" height="10" rx="3" fill="' + C.body2 + '"/><rect x="310" y="206" width="20" height="10" rx="3" fill="' + C.body2 + '"/>' +
      '<rect x="36" y="48" width="170" height="64" rx="8" fill="' + C.lcd + '" stroke="' + C.edge + '"/>' +
      '<text x="48" y="68" font-size="10" fill="' + C.lcdTxt + '" opacity=".75" font-family="ui-monospace,Menlo,monospace">' + esc((o.vendor || '').slice(0, 20)) + '</text>' +
      '<text x="48" y="96" font-size="21" font-weight="700" fill="' + C.lcdTxt + '" font-family="ui-monospace,Menlo,monospace">' + esc(o.freq || '7.074.00') + '</text>' +
      '<rect x="218" y="48" width="110" height="40" rx="6" fill="' + C.body2 + '"/>' + meter +
      '<circle cx="272" cy="150" r="40" fill="' + C.key + '" stroke="' + C.edge + '" stroke-width="2"/><circle cx="272" cy="150" r="28" fill="' + C.body2 + '"/><circle cx="290" cy="138" r="5" fill="' + C.dim + '"/>' +
      '<circle cx="60" cy="156" r="16" fill="' + C.key + '" stroke="' + C.edge + '"/><circle cx="110" cy="156" r="16" fill="' + C.key + '" stroke="' + C.edge + '"/><circle cx="160" cy="156" r="16" fill="' + C.key + '" stroke="' + C.edge + '"/>' +
      '<text x="36" y="126" font-size="10" fill="' + C.keyTxt + '" font-family="-apple-system,sans-serif">' + esc((o.model || '').slice(0, 22)) + '</text>' +
      '<circle cx="320" cy="98" r="4" fill="' + C.acc + '"/></svg>';
  }

  const FORM_LABEL = { handheld: 'Rádio portátil (HT)', mobile: 'Rádio móvel (veicular)', base: 'Rádio base / HF' };
  window.RadioArt = {
    svg(m, opts) {
      const o = Object.assign({ label: (m && m.label) || 'Rádio', vendor: m && m.vendor, model: m && (m.model + (m.variant ? ' ' + m.variant : '')) }, opts || {});
      const f = (m && m.form) || 'handheld';
      return f === 'mobile' ? mobile(o) : f === 'base' ? base(o) : handheld(o);
    },
    formLabel(f) { return FORM_LABEL[f] || FORM_LABEL.handheld; }
  };
})();
