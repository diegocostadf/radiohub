# RadioHub · DMR provider on top of qdmr's command line tool (dmrconf).
# GPL-3.0-or-later (qdmr is GPL-3.0 too: https://github.com/hmatuschek/qdmr).
#
# The codeplug is kept as qdmr's own YAML document. The app edits only what
# it understands (channels, contacts, group lists, zones, radio IDs); every
# other key (settings, APRS, roaming, extended options) is written back as is.

import datetime
import os
import re
import shutil
import subprocess
import sys
import tempfile

import yaml

from . import base

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# dmrconf radio keys (dmrconf 0.15.1 manual) → vendor, model, channel capacity, form
MODELS = [
    ('d868uv', 'AnyTone', 'AT-D868UV', 4000, 'handheld'),
    ('d868uve', 'AnyTone', 'AT-D868UVE', 4000, 'handheld'),
    ('d878uv', 'AnyTone', 'AT-D878UV', 4000, 'handheld'),
    ('d878uv2', 'AnyTone', 'AT-D878UVII', 4000, 'handheld'),
    ('d578uv', 'AnyTone', 'AT-D578UV', 4000, 'mobile'),
    ('d578uv2', 'AnyTone', 'AT-D578UVII', 4000, 'mobile'),
    ('md390', 'TYT', 'MD-390', 1000, 'handheld'),
    ('rt8', 'Retevis', 'RT8', 1000, 'handheld'),
    ('uv390', 'TYT', 'MD-UV390', 3000, 'handheld'),
    ('rt3s', 'Retevis', 'RT3S', 3000, 'handheld'),
    ('md2017', 'TYT', 'MD-2017', 3000, 'handheld'),
    ('rt82', 'Retevis', 'RT82', 3000, 'handheld'),
    ('gd73', 'Radioddity', 'GD-73', 1024, 'handheld'),
    ('gd77', 'Radioddity', 'GD-77', 1024, 'handheld'),
    ('rd5r', 'Baofeng', 'RD-5R', 1024, 'handheld'),
    ('dm1701', 'Baofeng', 'DM-1701', 3000, 'handheld'),
    ('rt84', 'Retevis', 'RT84', 3000, 'handheld'),
    ('dr1801uv', 'Baofeng', 'DR-1801UV', 1024, 'handheld'),
    ('dm32uv', 'Baofeng', 'DM-32UV', 4000, 'handheld'),
    ('opengd77', 'OpenGD77', 'Firmware OpenGD77 (GD-77, DM-1801, RD-5R)', 1024, 'handheld'),
    ('openuv380', 'OpenGD77', 'Firmware OpenUV380 (MD-UV380, RT3S)', 1024, 'handheld'),
]
BY_KEY = {m[0]: m for m in MODELS}
POWERS = ['Padrão', 'Max', 'High', 'Mid', 'Low', 'Min']


# ------------------------------------------------------------------ YAML
class Tagged(object):
    """A qdmr special value such as `!<!default> ""` (use the radio default)."""

    def __init__(self, tag, value=''):
        self.tag, self.value = tag, value

    def __repr__(self):
        return 'Tagged(%r)' % self.tag


class _Loader(yaml.SafeLoader):
    pass


class _Dumper(yaml.SafeDumper):
    pass


def _tagged_ctor(loader, suffix, node):
    if isinstance(node, yaml.ScalarNode):
        return Tagged('!' + suffix, loader.construct_scalar(node))
    if isinstance(node, yaml.SequenceNode):
        return Tagged('!' + suffix, loader.construct_sequence(node, deep=True))
    return Tagged('!' + suffix, loader.construct_mapping(node, deep=True))


_Loader.add_multi_constructor('!', _tagged_ctor)


def _tagged_repr(dumper, t):
    if isinstance(t.value, list):
        return dumper.represent_sequence(t.tag, t.value)
    if isinstance(t.value, dict):
        return dumper.represent_mapping(t.tag, t.value)
    return dumper.represent_scalar(t.tag, str(t.value or ''))


_Dumper.add_representer(Tagged, _tagged_repr)
DEFAULT = lambda: Tagged('!default', '')  # noqa: E731


def load_yaml(text):
    return yaml.load(text, Loader=_Loader) or {}


def dump_yaml(doc):
    return yaml.dump(doc, Dumper=_Dumper, sort_keys=False, allow_unicode=True, default_flow_style=False, width=120)


# ------------------------------------------------------------------ dmrconf
def dmrconf_path():
    env = os.environ.get('RADIOHUB_DMRCONF')
    if env and os.path.exists(env):
        return env
    exe = 'dmrconf.exe' if sys.platform == 'win32' else 'dmrconf'
    for p in (os.path.join(HERE, '..', 'providers', 'qdmr', 'Contents', 'MacOS', exe),  # bundled (Mac)
              os.path.join(HERE, '..', 'providers', 'qdmr', 'bin', exe),               # bundled (Windows, later)
              '/opt/homebrew/bin/' + exe, '/usr/local/bin/' + exe):                     # installed by the user
        if os.path.exists(p):
            return os.path.abspath(p)
    return shutil.which('dmrconf')


def available():
    return bool(dmrconf_path())


_PCT = re.compile(r'(\d{1,3})\s*%')


def run_dmrconf(args, status_fn=None, timeout=900):
    exe = dmrconf_path()
    if not exe:
        raise base.ProviderError('O suporte a rádios DMR ainda não está disponível neste sistema. '
                                 'Por enquanto ele funciona no Mac.')
    env = dict(os.environ)
    libdir = os.path.join(os.path.dirname(exe), '..', 'lib')
    if os.path.isdir(libdir):
        env['DYLD_FALLBACK_LIBRARY_PATH'] = os.path.abspath(libdir)
    p = subprocess.Popen([exe] + args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         env=env, text=True, errors='replace', bufsize=1,
                         creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    tail = []
    buf = ''
    while True:
        ch = p.stdout.read(1)
        if not ch:
            break
        if ch in '\r\n':
            line = buf.strip(); buf = ''
            if not line:
                continue
            tail = (tail + [line])[-40:]
            m = _PCT.search(line)
            if status_fn:
                status_fn(int(m.group(1)) if m else None, line)
        else:
            buf += ch
    if buf.strip():
        tail.append(buf.strip())
    code = p.wait(timeout=timeout)
    if code != 0:
        raise base.ProviderError('dmrconf falhou (código %s): %s' % (code, ' | '.join(tail[-6:]) or 'sem detalhes'))
    return '\n'.join(tail)


# ------------------------------------------------------------------ helpers
def _mhz(v):
    """'145.675 MHz' / '438.4 MHz' / 145.675 → float MHz."""
    if v is None or isinstance(v, Tagged):
        return None
    s = str(v).strip()
    m = re.match(r'^([0-9.]+)\s*([kMG]?Hz)?$', s)
    if not m:
        return None
    x = float(m.group(1)); unit = m.group(2) or 'MHz'
    return x / 1000.0 if unit == 'kHz' else x * 1000.0 if unit == 'GHz' else x


def _fmt_mhz(x):
    s = ('%.5f' % x).rstrip('0').rstrip('.')
    return '%s MHz' % s


def _tone_in(t):
    """qdmr tone mapping → ('ctcss', 88.5) | ('dcs', 23, inverted) | None."""
    if not isinstance(t, dict):
        return None
    if 'ctcss' in t:
        m = re.match(r'([0-9.]+)', str(t['ctcss']))
        return ('ctcss', round(float(m.group(1)), 1)) if m else None
    if 'dcs' in t:
        s = str(t['dcs']).strip()
        m = re.match(r'([\-iInN]?)([0-7]{1,3})', s)
        if m:
            return ('dcs', int(m.group(2)), m.group(1) in ('-', 'i', 'I'))
    return None


def _ctcss(v):
    return {'ctcss': '%.1f Hz' % float(v)}


def _dcs(code, inverted=False):
    return {'dcs': '%s%03d' % ('i' if inverted else 'n', int(code))}


def _kind(entry):
    for k in ('dmr', 'fm', 'am', 'm17'):
        if isinstance(entry, dict) and k in entry:
            return k
    return None


def _ref(v):
    """A reference field: '' for default/none, else the id string."""
    if v is None or isinstance(v, Tagged):
        return ''
    return str(v)


# ------------------------------------------------------------------ provider
class QdmrProvider(base.Provider):
    name = 'qdmr'

    def __init__(self, key, doc=None, path=None):
        if key not in BY_KEY:
            raise base.ProviderError('Modelo DMR desconhecido: %s' % key)
        self.key = key
        self.doc = doc or {}
        self.path = path
        self.backup_path = None

    # -- catalog
    @staticmethod
    def catalog():
        out = []
        ok = available()
        for key, vendor, model, cap, form in MODELS:
            out.append({'id': 'qdmr:' + key, 'vendor': vendor, 'model': model, 'variant': '',
                        'label': '%s %s' % (vendor, model), 'form': form, 'dmr': True,
                        'provider': 'qdmr', 'available': ok})
        return out

    @staticmethod
    def prompts():
        return {'experimental': 'A programação DMR usa o qdmr (código aberto, GPL v3). Ele ainda está em desenvolvimento e '
                                'pode falhar em alguns modelos. O RadioHub faz um backup completo antes de qualquer gravação.',
                'info': None,
                'pre_download': 'Ligue o rádio, conecte o cabo de programação e deixe o rádio na tela inicial. '
                                'Feche a CPS do fabricante se ela estiver aberta.',
                'pre_upload': None}

    # -- session
    @classmethod
    def download(cls, key, port, backups_dir, status_fn):
        fd, tmp = tempfile.mkstemp(suffix='.yaml'); os.close(fd)
        args = ['--radio', key]
        if port and not port.startswith('auto'):
            args += ['--device', port]
        args += ['read', tmp]
        run_dmrconf(args, lambda pct, line: status_fn(pct if pct is not None else 0, 100, line))
        with open(tmp, encoding='utf-8') as fh:
            text = fh.read()
        prov = cls(key, load_yaml(text), tmp)
        stamp = datetime.datetime.now().strftime('%Y-%m-%d_%H%M%S')
        bk = os.path.join(backups_dir, 'DMR_%s_%s.yaml' % (BY_KEY[key][2].replace(' ', '_'), stamp))
        with open(bk, 'w', encoding='utf-8') as fh:
            fh.write(text)
        prov.backup_path = bk
        return prov

    @classmethod
    def open_file(cls, path, key=None):
        with open(path, encoding='utf-8') as fh:
            doc = load_yaml(fh.read())
        if not isinstance(doc, dict) or 'channels' not in doc:
            raise base.ProviderError('Este arquivo não parece um codeplug do qdmr.')
        return cls(key or 'd878uv', doc, path)

    def summary(self):
        key, vendor, model, cap, form = BY_KEY[self.key]
        n = len(self.channels())
        return {'id': 'qdmr:' + self.key, 'vendor': vendor, 'model': model, 'variant': '', 'form': form,
                'label': '%s %s' % (vendor, model), 'provider': 'qdmr', 'dmr': True,
                'firmware': str(self.doc.get('version', '')) and ('codeplug qdmr ' + str(self.doc.get('version'))),
                'image_path': self.path, 'backup_path': self.backup_path, 'prompts_pre_upload': '',
                'features': {
                    'memory_bounds': [1, max(cap, n)], 'valid_modes': ['FM', 'NFM', 'AM', 'DMR'],
                    'valid_tmodes': ['', 'Tone', 'TSQL', 'DTCS'], 'valid_duplexes': ['', '+', '-', 'split', 'off'],
                    'valid_skips': [''], 'valid_tuning_steps': [5.0, 6.25, 12.5, 25.0], 'valid_cross_modes': [],
                    'valid_power_levels': POWERS, 'valid_name_length': 16,
                    'valid_bands': [[136000000, 174000000], [400000000, 480000000]],
                    'has_settings': False, 'has_comment': False, 'dmr': True}}

    # -- codeplug sections
    def channels(self):
        return self.doc.setdefault('channels', []) or []

    def _ids(self, section, inner=None):
        out = set()
        for e in self.doc.get(section) or []:
            body = e.get(inner) if inner and isinstance(e, dict) and inner in e else e
            if isinstance(body, dict) and body.get('id'):
                out.add(str(body['id']))
        return out

    def _new_id(self, prefix, used):
        i = 1
        while '%s%d' % (prefix, i) in used:
            i += 1
        return '%s%d' % (prefix, i)

    # -- unified channel model
    def to_unified(self, number, entry):
        kind = _kind(entry)
        b = entry.get(kind, {}) if kind else {}
        rx = _mhz(b.get('rxFrequency')) or 0.0
        tx = _mhz(b.get('txFrequency'))
        rx_only = bool(b.get('rxOnly'))
        if rx_only:
            duplex, offset = 'off', 0.0
        elif tx is None or abs(tx - rx) < 1e-6:
            duplex, offset = '', 0.0
        elif abs(tx - rx) > 20:
            duplex, offset = 'split', tx
        else:
            duplex, offset = ('+' if tx > rx else '-'), abs(tx - rx)
        tmode, rtone, ctone, dtcs, pol = '', 88.5, 88.5, 23, 'NN'
        if kind == 'fm':
            t_tx, t_rx = _tone_in(b.get('txTone')), _tone_in(b.get('rxTone'))
            if t_tx and t_tx[0] == 'dcs':
                tmode, dtcs = 'DTCS', t_tx[1]; pol = ('R' if t_tx[2] else 'N') * 2
            elif t_tx and t_rx and t_tx[0] == t_rx[0] == 'ctcss':
                tmode, rtone, ctone = 'TSQL', t_tx[1], t_rx[1]
            elif t_tx and t_tx[0] == 'ctcss':
                tmode, rtone = 'Tone', t_tx[1]
        power = b.get('power')
        mode = {'dmr': 'DMR', 'am': 'AM', 'm17': 'DMR'}.get(kind) or ('NFM' if b.get('bandwidth') == 'Narrow' else 'FM')
        d = {'number': number, 'extd_number': '', 'empty': False, 'qid': str(b.get('id', '')), 'kind': kind or 'fm',
             'name': str(b.get('name', '')), 'freq': '%.6f' % rx, 'duplex': duplex, 'offset': '%.6f' % offset,
             'tmode': tmode, 'rtone': rtone, 'ctone': ctone, 'dtcs': dtcs, 'rx_dtcs': dtcs, 'dtcs_polarity': pol,
             'cross_mode': 'Tone->Tone', 'mode': mode, 'tuning_step': 12.5, 'skip': '',
             'power': 'Padrão' if (power is None or isinstance(power, Tagged)) else str(power), 'comment': ''}
        if kind == 'dmr':
            d['dmr'] = {'color_code': int(b.get('colorCode', 1) or 0), 'time_slot': str(b.get('timeSlot', 'TS1')),
                        'contact': _ref(b.get('contact')), 'group_list': _ref(b.get('groupList')),
                        'radio_id': _ref(b.get('radioId'))}
        return d

    def from_unified(self, d, entry=None, used_ids=None):
        """Merge a unified channel into an existing qdmr entry (or a new one)."""
        want = 'dmr' if d.get('mode') == 'DMR' else ('am' if d.get('mode') == 'AM' else 'fm')
        old_kind = _kind(entry) if entry else None
        body = dict(entry[old_kind]) if (entry and old_kind == want) else {}
        if not body:
            base_body = entry[old_kind] if (entry and old_kind) else {}
            body = {'id': base_body.get('id') or self._new_id('ch', used_ids or set()), 'name': '',
                    'rxFrequency': '', 'txFrequency': '', 'timeout': DEFAULT(), 'rxOnly': False, 'vox': DEFAULT()}
            if want == 'dmr':
                body.update({'admit': 'ColorCode', 'colorCode': 1, 'timeSlot': 'TS1', 'radioId': DEFAULT(),
                             'groupList': None, 'contact': None})
            else:
                body.update({'squelch': DEFAULT(), 'admit': 'Always', 'rxTone': None, 'txTone': None,
                             'bandwidth': 'Wide'})
            body['power'] = DEFAULT()
        rx = float(d.get('freq') or 0)
        dup, off = d.get('duplex', ''), float(d.get('offset') or 0)
        tx = rx + off if dup == '+' else rx - off if dup == '-' else off if dup == 'split' else rx
        body['name'] = str(d.get('name', ''))[:16]
        body['rxFrequency'] = _fmt_mhz(rx)
        body['txFrequency'] = _fmt_mhz(tx)
        body['rxOnly'] = dup == 'off'
        p = d.get('power') or 'Padrão'
        body['power'] = DEFAULT() if p == 'Padrão' else p
        if want in ('fm', 'am'):
            if want == 'fm':
                body['bandwidth'] = 'Narrow' if d.get('mode') == 'NFM' else 'Wide'
            tm = d.get('tmode', '')
            if tm == 'Tone':
                body['txTone'], body['rxTone'] = _ctcss(d.get('rtone', 88.5)), None
            elif tm == 'TSQL':
                body['txTone'] = _ctcss(d.get('rtone') or d.get('ctone', 88.5))
                body['rxTone'] = _ctcss(d.get('ctone') or d.get('rtone', 88.5))
            elif tm == 'DTCS':
                inv = str(d.get('dtcs_polarity', 'NN')).startswith('R')
                body['txTone'] = body['rxTone'] = _dcs(d.get('dtcs', 23), inv)
            else:
                body['txTone'] = body['rxTone'] = None
        else:
            x = d.get('dmr') or {}
            body['colorCode'] = max(0, min(15, int(x.get('color_code', body.get('colorCode', 1)) or 0)))
            body['timeSlot'] = 'TS2' if str(x.get('time_slot', body.get('timeSlot', 'TS1'))).upper().endswith('2') else 'TS1'
            body['contact'] = x.get('contact') or None
            body['groupList'] = x.get('group_list') or None
            body['radioId'] = x.get('radio_id') or DEFAULT()
        return {want: body}

    def get_memories(self, bounds=None):
        chs = self.channels()
        lo, hi = (bounds or self.summary()['features']['memory_bounds'])
        out = [self.to_unified(i + 1, e) for i, e in enumerate(chs)]
        out += [{'number': n, 'empty': True} for n in range(len(chs) + 1, hi + 1)]
        return out

    def validate(self, mems):
        res = []
        contacts = self._ids('contacts', 'dmr')
        groups = self._ids('groupLists')
        for d in mems:
            errs = []
            if not d.get('empty'):
                try:
                    f = float(d.get('freq') or 0)
                    if not (30 <= f <= 1300):
                        errs.append('Frequência fora da faixa: %s MHz' % d.get('freq'))
                except ValueError:
                    errs.append('Frequência inválida')
                if len(str(d.get('name', ''))) > 16:
                    errs.append('Nome com mais de 16 caracteres')
                if d.get('mode') == 'DMR':
                    x = d.get('dmr') or {}
                    cc = int(x.get('color_code', 1) or 0)
                    if not 0 <= cc <= 15:
                        errs.append('Color code deve ser de 0 a 15')
                    if x.get('contact') and x['contact'] not in contacts:
                        errs.append('Contato não existe')
                    if x.get('group_list') and x['group_list'] not in groups:
                        errs.append('Lista RX não existe')
            res.append({'number': d['number'], 'errors': errs, 'warnings': []})
        return res

    def set_memories(self, mems):
        chs = self.channels()
        cur = {i + 1: e for i, e in enumerate(chs)}
        used = {str((e.get(_kind(e)) or {}).get('id')) for e in chs if _kind(e)}
        removed, applied, failed = set(), [], []
        for d in mems:
            n = int(d['number'])
            try:
                if d.get('empty'):
                    e = cur.pop(n, None)
                    if e and _kind(e):
                        removed.add(str(e[_kind(e)].get('id')))
                else:
                    errs = self.validate([d])[0]['errors']
                    if errs:
                        failed.append({'number': n, 'errors': errs}); continue
                    new = self.from_unified(d, cur.get(n), used)
                    used.add(str(new[_kind(new)]['id']))
                    cur[n] = new
                applied.append(n)
            except Exception as e:  # noqa: BLE001
                failed.append({'number': n, 'errors': [str(e)]})
        self.doc['channels'] = [cur[k] for k in sorted(cur)]
        if removed:
            self._drop_refs(removed)
        return {'applied': applied, 'failed': failed}

    def erase_all(self):
        removed = {str((e.get(_kind(e)) or {}).get('id')) for e in self.channels() if _kind(e)}
        self.doc['channels'] = []
        self._drop_refs(removed)

    def _drop_refs(self, ids):
        """Remove references to deleted ids (channels, contacts, lists) everywhere in the codeplug:
        zones, scan lists, roaming, positioning, and channel fields such as contact/groupList."""
        def walk(x):
            if isinstance(x, list):
                return [walk(i) for i in x if not (isinstance(i, str) and i in ids)]
            if isinstance(x, dict):
                return {k: (None if (k not in ('id', 'name') and isinstance(v, str) and v in ids) else walk(v))
                        for k, v in x.items()}
            return x
        for k in list(self.doc.keys()):
            self.doc[k] = walk(self.doc[k])

    # -- contacts, group lists, zones, radio IDs
    def get_extras(self):
        contacts = []
        for e in self.doc.get('contacts') or []:
            b = (e or {}).get('dmr')
            if isinstance(b, dict):
                contacts.append({'id': str(b.get('id')), 'name': str(b.get('name', '')),
                                 'type': str(b.get('type', 'GroupCall')), 'number': int(b.get('number', 0) or 0)})
        groups = [{'id': str(g.get('id')), 'name': str(g.get('name', '')), 'contacts': [str(c) for c in (g.get('contacts') or [])]}
                  for g in (self.doc.get('groupLists') or []) if isinstance(g, dict)]
        ch_ids = {str((e.get(_kind(e)) or {}).get('id')): i + 1 for i, e in enumerate(self.channels()) if _kind(e)}
        zones = [{'id': str(z.get('id')), 'name': str(z.get('name', '')),
                  'A': [ch_ids[c] for c in (z.get('A') or []) if c in ch_ids],
                  'B': [ch_ids[c] for c in (z.get('B') or []) if c in ch_ids]}
                 for z in (self.doc.get('zones') or []) if isinstance(z, dict)]
        ids = []
        for e in self.doc.get('radioIDs') or []:
            b = (e or {}).get('dmr')
            if isinstance(b, dict):
                ids.append({'id': str(b.get('id')), 'name': str(b.get('name', '')), 'number': int(b.get('number', 0) or 0)})
        return {'contacts': contacts, 'groupLists': groups, 'zones': zones, 'radioIDs': ids}

    def set_extras(self, x):
        if 'contacts' in x:
            old = {str((e or {}).get('dmr', {}).get('id')): e for e in (self.doc.get('contacts') or []) if isinstance(e, dict) and 'dmr' in e}
            others = [e for e in (self.doc.get('contacts') or []) if not (isinstance(e, dict) and 'dmr' in e)]
            used = set(old)
            out = []
            for c in x['contacts']:
                cid = c.get('id') or self._new_id('cont', used); used.add(cid)
                body = dict((old.get(cid) or {}).get('dmr') or {'ring': False})
                body.update({'id': cid, 'name': str(c.get('name', ''))[:16], 'type': c.get('type') or 'GroupCall',
                             'number': int(c.get('number') or 0)})
                out.append({'dmr': body})
            gone = set(old) - {c['dmr']['id'] for c in out}
            self.doc['contacts'] = out + others
            if gone:
                self._drop_refs(gone)
        if 'groupLists' in x:
            used = self._ids('groupLists'); out = []
            for g in x['groupLists']:
                gid = g.get('id') or self._new_id('grp', used); used.add(gid)
                out.append({'id': gid, 'name': str(g.get('name', ''))[:16], 'contacts': list(g.get('contacts') or [])})
            gone = self._ids('groupLists') - {g['id'] for g in out}
            self.doc['groupLists'] = out
            if gone:
                self._drop_refs(gone)
        if 'zones' in x:
            num_to_id = {i + 1: str((e.get(_kind(e)) or {}).get('id')) for i, e in enumerate(self.channels()) if _kind(e)}
            used = self._ids('zones'); out = []
            for z in x['zones']:
                zid = z.get('id') or self._new_id('zone', used); used.add(zid)
                out.append({'id': zid, 'name': str(z.get('name', ''))[:16],
                            'A': [num_to_id[n] for n in (z.get('A') or []) if n in num_to_id],
                            'B': [num_to_id[n] for n in (z.get('B') or []) if n in num_to_id]})
            self.doc['zones'] = out
        if 'radioIDs' in x:
            old = {str((e or {}).get('dmr', {}).get('id')): e for e in (self.doc.get('radioIDs') or []) if isinstance(e, dict) and 'dmr' in e}
            used = set(old); out = []
            for r in x['radioIDs']:
                rid = r.get('id') or self._new_id('id', used); used.add(rid)
                body = dict((old.get(rid) or {}).get('dmr') or {})
                body.update({'id': rid, 'name': str(r.get('name', ''))[:16], 'number': int(r.get('number') or 0)})
                out.append({'dmr': body})
            self.doc['radioIDs'] = out
            if out:
                st = self.doc.setdefault('settings', {}) or {}
                if not st.get('defaultID') or str(st.get('defaultID')) not in used:
                    st['defaultID'] = out[0]['dmr']['id']
                self.doc['settings'] = st
        return self.get_extras()

    # -- files and radio
    def save(self, path):
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(dump_yaml(self.doc))
        return path

    def upload(self, port, backups_dir, status_fn):
        stamp = datetime.datetime.now().strftime('%Y-%m-%d_%H%M%S')
        pre = os.path.join(backups_dir, 'DMR_pre-upload_%s.yaml' % stamp)
        self.save(pre)
        args = []
        if port and not port.startswith('auto'):
            args += ['--device', port]
        args += ['write', pre]
        run_dmrconf(args, lambda pct, line: status_fn(pct if pct is not None else 0, 100, line))
        return {'ok': True, 'saved_copy': pre}

    def write_db(self, ids, port, status_fn):
        args = []
        if port and not port.startswith('auto'):
            args += ['--device', port]
        if ids:
            args += ['--id', ','.join(str(i) for i in ids)]
        args += ['write-db']
        run_dmrconf(args, lambda pct, line: status_fn(pct if pct is not None else 0, 100, line))
        return {'ok': True}
