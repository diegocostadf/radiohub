# RadioHub · analog provider on top of the CHIRP library (500+ models).
# GPL-3.0-or-later, same as CHIRP.

import datetime
import logging
import os
import re

import serial

from chirp import chirp_common, directory, import_logic
from chirp.drivers import generic_csv

from . import base

LOG = logging.getLogger('radiohub.chirp')
_drivers_loaded = False


def load_drivers():
    global _drivers_loaded
    if not _drivers_loaded:
        directory.import_drivers()
        _drivers_loaded = True


# ------------------------------------------------------------------ catalog
# Model-name patterns of vehicle/mobile rigs; the rest of VHF/UHF radios are
# handhelds. HF transceivers are "base".
_MOBILE_RE = re.compile(
    r'(^TM-|^TK-[78]|^TK-[0-9]{4}M|^FT-?[1-9]8[0-9]{2}|^FT-[1-9]9[0-9]{2}|'
    r'^FT-7[0-9]{3}|^FTM|^FT-2[0-9]{3}|^DR-|^IC-2[0-9]{3}|^IC-V8000|^ID-[45]100|'
    r'5888|778|779|^KT-|^BJ-[23]18|^TH-?9[0-9]{3}|^AT-5|^AT-7|^D578|'
    r'^UV-2[05]|^UV-50|^MD-9|^DB25|^DM-9|^BF-9500|^KG-UV9[0-9]{2}|'
    r'^KG-1000|^QYT|^TYT-9|^TH-7800|^TH-8600|^UV-?5001|^CP-?100|mobile|Mobile)')
_BASE_RE = re.compile(
    r'(^TS-|^IC-7[0-9]{2,3}|^IC-M7|^FT-?8[0-9]{2}(D|DX)?$|^FT-?9[0-9]{2}|'
    r'^FT-450|^FT-?1000|^HF-|^FT-?710$|^FTDX)')


def form_factor(rclass):
    model = rclass.MODEL or ''
    name = ('%s %s' % (model, rclass.VARIANT or '')).lower()
    if _BASE_RE.search(model):
        return 'base'
    if model in ('KT-8R',):
        return 'handheld'
    if _MOBILE_RE.search(model) or 'mobile' in name:
        return 'mobile'
    return 'handheld'


def model_info(rclass):
    return {'id': directory.radio_class_id(rclass), 'vendor': rclass.VENDOR, 'model': rclass.MODEL,
            'variant': rclass.VARIANT or '',
            'label': ('%s %s %s' % (rclass.VENDOR, rclass.MODEL, rclass.VARIANT or '')).strip(),
            'form': form_factor(rclass), 'provider': 'chirp', 'dmr': False, 'available': True}


def catalog():
    load_drivers()
    out = []
    for rclass in directory.DRV_TO_RADIO.values():
        if not issubclass(rclass, chirp_common.CloneModeRadio):
            continue
        if getattr(rclass, '_DETECTED_BY', None):
            continue
        out.append(model_info(rclass))
    return out


def prompts(model_id):
    load_drivers()
    pr = directory.get_radio(model_id).get_prompts()
    return {k: getattr(pr, k, None) for k in ('experimental', 'info', 'pre_download', 'pre_upload')}


# ------------------------------------------------------------------ serial
class TraceSerial(serial.Serial):
    """Serial port with the extras CHIRP drivers expect (same role as
    chirp.wxui.serialtrace.SerialTrace, without the wx dependency). Drivers
    call pipe.log(); a short trace of each session goes to ~/RadioHub/logs."""

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
        except Exception as e:  # noqa: BLE001
            LOG.warning('Sem arquivo de trace: %s', e)
            self._tracef = None

    def _t(self, kind, data):
        if self._tracef and data:
            try:
                self._tracef.write('%s %4d %s\n' % (kind, len(data), bytes(data[:64]).hex()))
            except Exception:  # noqa: BLE001
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
            except Exception:  # noqa: BLE001
                self._tracef = None

    def close(self):
        try:
            super().close()
        finally:
            if self._tracef:
                try:
                    self._tracef.close()
                except Exception:  # noqa: BLE001
                    pass
                self._tracef = None


def open_serial(port, rclass):
    if port.startswith('fake:'):  # developer testing without hardware
        from chirp.drivers import fake
        return getattr(fake, port[5:])()
    pipe = TraceSerial(baudrate=rclass.BAUD_RATE, rtscts=rclass.HARDWARE_FLOW, timeout=0.25)
    pipe.rts = rclass.WANTS_RTS
    pipe.dtr = rclass.WANTS_DTR
    pipe.port = port
    pipe.open()
    return pipe


# ------------------------------------------------------------------ channel conversion
def _mhz(hz):
    return chirp_common.format_freq(int(hz)) if hz is not None else ''


def mem_to_json(m):
    return {'number': m.number, 'extd_number': getattr(m, 'extd_number', '') or '', 'empty': bool(m.empty),
            'name': (m.name or '').rstrip(), 'freq': _mhz(m.freq) if not m.empty else '', 'duplex': m.duplex,
            'offset': _mhz(m.offset), 'tmode': m.tmode, 'rtone': m.rtone, 'ctone': m.ctone, 'dtcs': m.dtcs,
            'rx_dtcs': m.rx_dtcs, 'dtcs_polarity': m.dtcs_polarity, 'cross_mode': m.cross_mode, 'mode': m.mode,
            'tuning_step': m.tuning_step, 'skip': m.skip, 'power': str(m.power) if m.power else '',
            'comment': getattr(m, 'comment', '') or ''}


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
        return import_logic.find_closest_power(float(str(value).lower().replace('w', '')), levels)
    except Exception:  # noqa: BLE001
        return levels[0]


def json_to_mem(radio, d):
    if d.get('empty'):
        return chirp_common.Memory(number=int(d['number']), empty=True)
    m = radio.get_memory(int(d['number']))
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


# ------------------------------------------------------------------ provider
class ChirpProvider(base.Provider):
    name = 'chirp'

    def __init__(self, radio, image_path=None, backup_path=None):
        self.radio = radio
        self.image_path = image_path
        self.backup_path = backup_path

    @classmethod
    def download(cls, model_id, port, backups_dir, status_fn):
        load_drivers()
        rclass = directory.get_radio(model_id)
        pipe = open_serial(port, rclass)
        try:
            try:
                rclass = rclass.detect_from_serial(pipe)
            except NotImplementedError:
                pass
            radio = rclass(pipe)
            radio.status_fn = lambda s: status_fn(s.cur, s.max, s.msg)
            radio.sync_in()
        finally:
            try:
                pipe.close()
            except Exception:  # noqa: BLE001
                pass
        radio.pipe = None
        stamp = datetime.datetime.now().strftime('%Y-%m-%d_%H%M%S')
        path = os.path.join(backups_dir, ('%s_%s_%s.img' % (rclass.VENDOR, rclass.MODEL, stamp)).replace(' ', '_'))
        radio.save(path)
        return cls(radio, path, path)

    @classmethod
    def open_file(cls, path):
        load_drivers()
        return cls(directory.get_radio_by_image(path), path)

    def summary(self):
        r = self.radio
        info = model_info(r.__class__)
        f = r.get_features()
        info['features'] = {
            'memory_bounds': list(f.memory_bounds), 'valid_modes': list(f.valid_modes),
            'valid_tmodes': list(f.valid_tmodes), 'valid_duplexes': list(f.valid_duplexes),
            'valid_skips': list(f.valid_skips), 'valid_tuning_steps': list(f.valid_tuning_steps),
            'valid_cross_modes': list(f.valid_cross_modes),
            'valid_power_levels': [str(p) for p in (f.valid_power_levels or [])],
            'valid_name_length': f.valid_name_length, 'valid_bands': [[a, b] for a, b in (f.valid_bands or [])],
            'has_settings': bool(f.has_settings), 'has_comment': bool(f.has_comment), 'dmr': False}
        info['image_path'] = self.image_path
        info['backup_path'] = self.backup_path
        fw = ''
        for k, v in (getattr(r, 'metadata', None) or {}).items():
            if 'firmware' in k.lower() or k.lower().endswith('version'):
                fw = str(v)
                break
        info['firmware'] = fw
        try:
            info['prompts_pre_upload'] = r.get_prompts().pre_upload or ''
        except Exception:  # noqa: BLE001
            info['prompts_pre_upload'] = ''
        return info

    def get_memories(self, bounds=None):
        lo, hi = self.radio.get_features().memory_bounds
        out = []
        for n in range(lo, hi + 1):
            try:
                out.append(mem_to_json(self.radio.get_memory(n)))
            except Exception as e:  # noqa: BLE001
                out.append({'number': n, 'empty': True, 'error': str(e)})
        return out

    def _check(self, m):
        msgs = self.radio.validate_memory(m)
        return ([str(x) for x in msgs if isinstance(x, chirp_common.ValidationError)],
                [str(x) for x in msgs if not isinstance(x, chirp_common.ValidationError)])

    def validate(self, mems):
        res = []
        for d in mems:
            try:
                m = json_to_mem(self.radio, d)
                errs, warns = ([], []) if m.empty else self._check(m)
            except Exception as e:  # noqa: BLE001
                errs, warns = [str(e)], []
            res.append({'number': d['number'], 'errors': errs, 'warnings': warns})
        return res

    def set_memories(self, mems):
        applied, failed = [], []
        for d in mems:
            try:
                m = json_to_mem(self.radio, d)
                if m.empty:
                    self.radio.erase_memory(m.number)
                else:
                    errs, _w = self._check(m)
                    if errs:
                        failed.append({'number': d['number'], 'errors': errs})
                        continue
                    self.radio.set_memory(m)
                applied.append(d['number'])
            except Exception as e:  # noqa: BLE001
                failed.append({'number': d.get('number'), 'errors': [str(e)]})
        return {'applied': applied, 'failed': failed}

    def erase_all(self):
        lo, hi = self.radio.get_features().memory_bounds
        for n in range(lo, hi + 1):
            try:
                self.radio.erase_memory(n)
            except Exception:  # noqa: BLE001
                pass

    def parse_csv(self, path):
        src = generic_csv.CSVRadio(path)
        srcf = src.get_features()
        lo, hi = self.radio.get_features().memory_bounds
        out, problems = [], []
        for n in range(srcf.memory_bounds[0], srcf.memory_bounds[1] + 1):
            sm = src.get_memory(n)
            if sm.empty:
                continue
            if not (lo <= sm.number <= hi):
                problems.append({'number': sm.number, 'errors': ['Fora da faixa de canais do rádio']})
                continue
            try:
                out.append(mem_to_json(import_logic.import_mem(self.radio, srcf, sm)))
            except Exception as e:  # noqa: BLE001
                problems.append({'number': sm.number, 'errors': [str(e)]})
        return {'memories': out, 'problems': problems}

    def save(self, path):
        self.radio.save(path)
        return path

    def upload(self, port, backups_dir, status_fn):
        stamp = datetime.datetime.now().strftime('%Y-%m-%d_%H%M%S')
        pre = os.path.join(backups_dir, 'pre-upload_%s.img' % stamp)
        self.radio.save(pre)
        pipe = open_serial(port, self.radio.__class__)
        try:
            self.radio.pipe = pipe
            self.radio.status_fn = lambda s: status_fn(s.cur, s.max, s.msg)
            self.radio.sync_out()
        finally:
            try:
                pipe.close()
            except Exception:  # noqa: BLE001
                pass
            self.radio.pipe = None
        return {'ok': True, 'saved_copy': pre}
