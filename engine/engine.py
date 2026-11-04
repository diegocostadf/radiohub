#!/usr/bin/env python3
# RadioHub engine: JSON-RPC over stdin/stdout on top of the CHIRP library.
# Copyright (C) 2026. Licensed under the GNU GPL v3 (same as CHIRP).
#
# Protocol: one JSON object per line.
#   request  {"id": 1, "method": "list_ports", "params": {}}
#   response {"id": 1, "result": ...}  or  {"id": 1, "error": {"message": "..."}}
#   event    {"event": "progress", "cur": 10, "max": 100, "msg": "..."}

import csv
import datetime
import io
import json
import logging
import os
import sys
import threading
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(1, os.path.join(HERE, 'site'))

logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
LOG = logging.getLogger('radiohub')

import builtins  # noqa: E402
import gettext  # noqa: E402
builtins._ = gettext.gettext  # CHIRP expects gettext's _ to exist
builtins.ngettext = gettext.ngettext

import serial  # noqa: E402
from serial.tools import list_ports  # noqa: E402

from chirp import chirp_common, directory, errors, import_logic  # noqa: E402
from chirp.drivers import generic_csv  # noqa: E402

_out_lock = threading.Lock()


def emit(obj):
    with _out_lock:
        sys.stdout.write(json.dumps(obj, default=str) + '\n')
        sys.stdout.flush()


class Session:
    radio = None
    model_id = None
    image_path = None


S = Session()
_drivers_loaded = False


def load_drivers():
    global _drivers_loaded
    if not _drivers_loaded:
        directory.import_drivers()
        _drivers_loaded = True


# ---------------------------------------------------------------- helpers

def mhz(hz):
    return chirp_common.format_freq(int(hz)) if hz is not None else ''


def model_info(rclass):
    return {
        'id': directory.radio_class_id(rclass),
        'vendor': rclass.VENDOR,
        'model': rclass.MODEL,
        'variant': rclass.VARIANT or '',
        'label': ('%s %s %s' % (rclass.VENDOR, rclass.MODEL,
                                rclass.VARIANT or '')).strip(),
    }


def features_info(radio):
    f = radio.get_features()
    return {
        'memory_bounds': list(f.memory_bounds),
        'valid_modes': list(f.valid_modes),
        'valid_tmodes': list(f.valid_tmodes),
        'valid_duplexes': list(f.valid_duplexes),
        'valid_skips': list(f.valid_skips),
        'valid_tuning_steps': list(f.valid_tuning_steps),
        'valid_cross_modes': list(f.valid_cross_modes),
        'valid_power_levels': [str(p) for p in (f.valid_power_levels or [])],
        'valid_name_length': f.valid_name_length,
        'valid_bands': [[a, b] for a, b in (f.valid_bands or [])],
        'has_settings': bool(f.has_settings),
        'has_comment': bool(f.has_comment),
    }


def mem_to_json(m):
    return {
        'number': m.number,
        'extd_number': getattr(m, 'extd_number', '') or '',
        'empty': bool(m.empty),
        'name': (m.name or '').rstrip(),
        'freq': mhz(m.freq) if not m.empty else '',
        'duplex': m.duplex,
        'offset': mhz(m.offset),
        'tmode': m.tmode,
        'rtone': m.rtone,
        'ctone': m.ctone,
        'dtcs': m.dtcs,
        'rx_dtcs': m.rx_dtcs,
        'dtcs_polarity': m.dtcs_polarity,
        'cross_mode': m.cross_mode,
        'mode': m.mode,
        'tuning_step': m.tuning_step,
        'skip': m.skip,
        'power': str(m.power) if m.power else '',
        'comment': getattr(m, 'comment', '') or '',
    }


def _power_from_str(radio, value):
    levels = radio.get_features().valid_power_levels or []
    if not levels:
        return None
    if not value:
        return levels[0]
    for p in levels:
        if str(p).lower() == str(value).lower():
            return p
    try:
        watts = float(str(value).lower().replace('w', ''))
        return import_logic.find_closest_power(watts, levels)
    except Exception:
        return levels[0]


def json_to_mem(radio, d):
    m = radio.get_memory(int(d['number']))
    if d.get('empty'):
        m = chirp_common.Memory(number=int(d['number']), empty=True)
        return m
    m.empty = False
    m.freq = chirp_common.parse_freq(str(d['freq']))
    m.name = str(d.get('name', ''))
    m.duplex = d.get('duplex', '') or ''
    m.offset = chirp_common.parse_freq(str(d.get('offset') or '0'))
    m.tmode = d.get('tmode', '') or ''
    m.rtone = float(d.get('rtone') or 88.5)
    m.ctone = float(d.get('ctone') or 88.5)
    m.dtcs = int(d.get('dtcs') or 23)
    m.rx_dtcs = int(d.get('rx_dtcs') or 23)
    m.dtcs_polarity = d.get('dtcs_polarity') or 'NN'
    m.cross_mode = d.get('cross_mode') or 'Tone->Tone'
    m.mode = d.get('mode') or 'FM'
    m.tuning_step = float(d.get('tuning_step') or 5.0)
    m.skip = d.get('skip', '') or ''
    m.power = _power_from_str(radio, d.get('power'))
    if hasattr(m, 'comment'):
        m.comment = d.get('comment', '') or ''
    return m


def need_radio():
    if S.radio is None:
        raise errors.RadioError('Nenhum rádio carregado. Baixe do rádio '
                                'ou abra um arquivo de imagem primeiro.')
    return S.radio


def backups_dir():
    d = os.path.expanduser('~/RadioHub/backups')
    os.makedirs(d, exist_ok=True)
    return d


def status_cb(status):
    emit({'event': 'progress', 'cur': status.cur, 'max': status.max,
          'msg': status.msg})


class TraceSerial(serial.Serial):
    """Serial port with the extras CHIRP drivers expect (same role as
    chirp.wxui.serialtrace.SerialTrace, without the wx dependency).

    Drivers call pipe.log(); we also keep a short trace of each session in
    ~/RadioHub/logs (last 10 kept) to help diagnose communication problems.
    """

    def __init__(self, *a, **k):
        self._tracef = None
        self.last_write = None
        super().__init__(*a, **k)

    def open(self):
        super().open()
        try:
            d = os.path.expanduser('~/RadioHub/logs')
            os.makedirs(d, exist_ok=True)
            old = sorted(f for f in os.listdir(d) if f.startswith('trace-'))
            for f in old[:-9]:
                try:
                    os.remove(os.path.join(d, f))
                except OSError:
                    pass
            stamp = datetime.datetime.now().strftime('%Y-%m-%d_%H%M%S')
            self._tracef = open(os.path.join(d, 'trace-%s.txt' % stamp), 'w')
            self.log('Porta %s aberta (baud %s)' % (self.port, self.baudrate))
        except Exception as e:
            LOG.warning('Sem arquivo de trace: %s', e)
            self._tracef = None

    def _t(self, kind, data):
        if self._tracef and data:
            try:
                self._tracef.write('%s %4d %s\n' % (kind, len(data),
                                                     bytes(data[:64]).hex()))
            except Exception:
                self._tracef = None

    def write(self, data):
        self.last_write = (datetime.datetime.now(), len(data))
        r = super().write(data)
        self._t('W', data)
        return r

    def read(self, size=1):
        self.last_write = None
        data = super().read(size)
        self._t('R', data)
        return data

    def log(self, message):
        if self._tracef:
            try:
                self._tracef.write('# %s\n' % message)
                self._tracef.flush()
            except Exception:
                self._tracef = None

    def close(self):
        try:
            super().close()
        finally:
            if self._tracef:
                try:
                    self._tracef.close()
                except Exception:
                    pass
                self._tracef = None


def open_serial(port, rclass):
    if port.startswith('fake:'):  # developer testing without hardware
        from chirp.drivers import fake
        return getattr(fake, port[5:])()
    pipe = TraceSerial(baudrate=rclass.BAUD_RATE,
                       rtscts=rclass.HARDWARE_FLOW, timeout=0.25)
    pipe.rts = rclass.WANTS_RTS
    pipe.dtr = rclass.WANTS_DTR
    pipe.port = port
    pipe.open()
    return pipe


def radio_summary():
    r = S.radio
    info = model_info(r.__class__)
    info['form'] = _form_factor(r.__class__)
    info['features'] = features_info(r)
    info['image_path'] = S.image_path
    md = getattr(r, 'metadata', None) or {}
    fw = ''
    for k, v in md.items():
        if 'firmware' in k.lower() or k.lower().endswith('version'):
            fw = str(v)
            break
    info['firmware'] = fw
    try:
        pr = r.get_prompts()
        info['prompts_pre_upload'] = pr.pre_upload or ''
    except Exception:
        info['prompts_pre_upload'] = ''
    return info


# ---------------------------------------------------------------- methods

def m_ping(p):
    return {'ok': True, 'chirp': __import__('chirp').CHIRP_VERSION}


def m_list_ports(p):
    out = []
    for port in list_ports.comports():
        out.append({
            'device': port.device,
            'description': port.description or '',
            'manufacturer': port.manufacturer or '',
            'vid': port.vid, 'pid': port.pid,
            'is_usb': port.vid is not None,
            'is_system': ('Bluetooth' in port.device or
                          'debug-console' in port.device),
        })
    return out


import re  # noqa: E402

# Model-name patterns of vehicle/mobile rigs (the rest of VHF/UHF radios are
# treated as handhelds). Radios covering HF (< 30 MHz) count as base/HF rigs.
_MOBILE_RE = re.compile(
    r'(^TM-|^TK-[78]|^TK-[0-9]{4}M|^FT-?[1-9]8[0-9]{2}|^FT-[1-9]9[0-9]{2}|'
    r'^FT-7[0-9]{3}|^FTM|^FT-2[0-9]{3}|^DR-|^IC-2[0-9]{3}|^IC-V8000|^ID-[45]100|'
    r'5888|778|779|^KT-|^BJ-[23]18|^TH-?9[0-9]{3}|^AT-5|^AT-7|^D578|'
    r'^UV-2[05]|^UV-50|^MD-9|^DB25|^DM-9|^BF-9500|^KG-UV9[0-9]{2}|'
    r'^KG-1000|^QYT|^TYT-9|^TH-7800|^TH-8600|^UV-?5001|^CP-?100|mobile|Mobile)')


_BASE_RE = re.compile(
    r'(^TS-|^IC-7[0-9]{2,3}|^IC-M7|^FT-?8[0-9]{2}(D|DX)?$|^FT-?9[0-9]{2}|'
    r'^FT-450|^FT-?1000|^HF-|^FT-?710$|^FTDX)')


def _form_factor(rclass):
    model = rclass.MODEL or ''
    name = ('%s %s' % (model, rclass.VARIANT or '')).lower()
    if _BASE_RE.search(model):
        return 'base'
    if model in ('KT-8R',):
        return 'handheld'
    if _MOBILE_RE.search(model) or 'mobile' in name:
        return 'mobile'
    return 'handheld'


_models_cache = None


def m_list_models(p):
    global _models_cache
    if _models_cache is not None:
        return _models_cache
    load_drivers()
    out = []
    for rclass in directory.DRV_TO_RADIO.values():
        if not issubclass(rclass, chirp_common.CloneModeRadio):
            continue
        if getattr(rclass, '_DETECTED_BY', None):
            continue
        info = model_info(rclass)
        info['form'] = _form_factor(rclass)
        out.append(info)
    out.sort(key=lambda x: x['label'].lower())
    _models_cache = out
    return out


def m_prompts(p):
    load_drivers()
    rclass = directory.get_radio(p['model_id'])
    pr = rclass.get_prompts()
    return {k: getattr(pr, k, None) for k in
            ('experimental', 'info', 'pre_download', 'pre_upload')}


def m_download(p):
    load_drivers()
    rclass = directory.get_radio(p['model_id'])
    pipe = open_serial(p['port'], rclass)
    try:
        try:
            rclass = rclass.detect_from_serial(pipe)
        except NotImplementedError:
            pass
        radio = rclass(pipe)
        radio.status_fn = status_cb
        radio.sync_in()
    finally:
        try:
            pipe.close()
        except Exception:
            pass
    radio.pipe = None
    S.radio = radio
    S.model_id = directory.radio_class_id(rclass)
    stamp = datetime.datetime.now().strftime('%Y-%m-%d_%H%M%S')
    fname = '%s_%s_%s.img' % (rclass.VENDOR, rclass.MODEL, stamp)
    path = os.path.join(backups_dir(), fname.replace(' ', '_'))
    radio.save(path)
    S.image_path = path
    info = radio_summary()
    info['backup_path'] = path
    return info


def m_open_image(p):
    load_drivers()
    radio = directory.get_radio_by_image(p['path'])
    S.radio = radio
    S.model_id = directory.radio_class_id(radio.__class__)
    S.image_path = p['path']
    return radio_summary()


def m_info(p):
    need_radio()
    return radio_summary()


def m_get_memories(p):
    r = need_radio()
    lo, hi = r.get_features().memory_bounds
    out = []
    for n in range(lo, hi + 1):
        try:
            out.append(mem_to_json(r.get_memory(n)))
        except Exception as e:
            out.append({'number': n, 'empty': True, 'error': str(e)})
    return out


def _validate(r, m):
    msgs = r.validate_memory(m)
    return [str(x) for x in msgs
            if isinstance(x, chirp_common.ValidationError)], \
           [str(x) for x in msgs
            if not isinstance(x, chirp_common.ValidationError)]


def m_validate(p):
    r = need_radio()
    results = []
    for d in p['memories']:
        try:
            m = json_to_mem(r, d)
            errs, warns = ([], []) if m.empty else _validate(r, m)
        except Exception as e:
            errs, warns = [str(e)], []
        results.append({'number': d['number'], 'errors': errs,
                        'warnings': warns})
    return results


def m_set_memories(p):
    r = need_radio()
    applied, failed = [], []
    for d in p['memories']:
        try:
            m = json_to_mem(r, d)
            if m.empty:
                r.erase_memory(m.number)
            else:
                errs, _w = _validate(r, m)
                if errs:
                    failed.append({'number': d['number'], 'errors': errs})
                    continue
                r.set_memory(m)
            applied.append(d['number'])
        except Exception as e:
            failed.append({'number': d.get('number'), 'errors': [str(e)]})
    return {'applied': applied, 'failed': failed}


def m_erase_all(p):
    r = need_radio()
    lo, hi = r.get_features().memory_bounds
    for n in range(lo, hi + 1):
        try:
            r.erase_memory(n)
        except Exception:
            pass
    return {'ok': True}


def m_parse_csv(p):
    """Read a CHIRP CSV and convert each row for the loaded radio."""
    r = need_radio()
    src = generic_csv.CSVRadio(p['path'])
    srcf = src.get_features()
    lo, hi = r.get_features().memory_bounds
    out, problems = [], []
    for n in range(srcf.memory_bounds[0], srcf.memory_bounds[1] + 1):
        sm = src.get_memory(n)
        if sm.empty:
            continue
        if not (lo <= sm.number <= hi):
            problems.append({'number': sm.number,
                             'errors': ['Fora da faixa de canais do rádio']})
            continue
        try:
            dm = import_logic.import_mem(r, srcf, sm)
            out.append(mem_to_json(dm))
        except import_logic.DestNotCompatible as e:
            problems.append({'number': sm.number, 'errors': [str(e)]})
        except Exception as e:
            problems.append({'number': sm.number, 'errors': [str(e)]})
    return {'memories': out, 'problems': problems}


CSV_FIELDS = ['Location', 'Name', 'Frequency', 'Duplex', 'Offset', 'Tone',
              'rToneFreq', 'cToneFreq', 'DtcsCode', 'DtcsPolarity',
              'RxDtcsCode', 'CrossMode', 'Mode', 'TStep', 'Skip', 'Power',
              'Comment', 'URCALL', 'RPT1CALL', 'RPT2CALL', 'DVCODE']


def m_export_csv(p):
    mems = p.get('memories') or m_get_memories({})
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator='\r\n')
    w.writerow(CSV_FIELDS)
    for d in mems:
        if d.get('empty'):
            continue
        w.writerow([d['number'], d['name'], '%.6f' % float(d['freq']),
                    d['duplex'], '%.6f' % float(d['offset'] or 0),
                    d['tmode'], '%.1f' % float(d['rtone']),
                    '%.1f' % float(d['ctone']), '%03d' % int(d['dtcs']),
                    d['dtcs_polarity'], '%03d' % int(d['rx_dtcs']),
                    d['cross_mode'], d['mode'],
                    '%.2f' % float(d['tuning_step']), d['skip'], d['power'],
                    d.get('comment', ''), '', '', '', ''])
    if p.get('path'):
        with open(p['path'], 'w', newline='') as fh:
            fh.write(buf.getvalue())
        return {'path': p['path']}
    return {'csv': buf.getvalue()}


def m_save_image(p):
    r = need_radio()
    r.save(p['path'])
    return {'path': p['path']}


def m_upload(p):
    r = need_radio()
    rclass = r.__class__
    # safety copy of what is about to be written
    stamp = datetime.datetime.now().strftime('%Y-%m-%d_%H%M%S')
    pre = os.path.join(backups_dir(), 'pre-upload_%s.img' % stamp)
    r.save(pre)
    pipe = open_serial(p['port'], rclass)
    try:
        r.pipe = pipe
        r.status_fn = status_cb
        r.sync_out()
    finally:
        try:
            pipe.close()
        except Exception:
            pass
        r.pipe = None
    return {'ok': True, 'saved_copy': pre}


METHODS = {k[2:]: v for k, v in globals().items() if k.startswith('m_')}
SLOW = {'download', 'upload', 'list_models', 'open_image'}


def handle(req):
    rid = req.get('id')
    try:
        fn = METHODS.get(req.get('method'))
        if not fn:
            raise ValueError('Método desconhecido: %s' % req.get('method'))
        emit({'id': rid, 'result': fn(req.get('params') or {})})
    except Exception as e:
        tb = traceback.format_exc()
        LOG.error('%s failed:\n%s', req.get('method'), tb)
        kind = 'radio' if isinstance(e, errors.RadioError) else (
            'serial' if isinstance(e, (serial.SerialException, OSError))
            else 'internal')
        emit({'id': rid, 'error': {
            'message': '%s: %s' % (e.__class__.__name__, e) if str(e)
            else e.__class__.__name__,
            'kind': kind, 'detail': tb[-3000:]}})


def main():
    emit({'event': 'ready'})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError:
            continue
        if req.get('method') in SLOW:
            threading.Thread(target=handle, args=(req,), daemon=True).start()
        else:
            handle(req)


if __name__ == '__main__':
    main()
