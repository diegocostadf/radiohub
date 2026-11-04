#!/usr/bin/env python3
# RadioHub engine: JSON-RPC over stdin/stdout. GPL-3.0-or-later.
#
# The engine routes every call to one of the radio providers:
#   providers/chirp.py  analog radios through the CHIRP library (500+ models)
#   providers/qdmr.py   DMR radios through qdmr's dmrconf tool
# Channels always cross this boundary in the unified shape described in
# providers/base.py, so the app's screens work the same for every radio.
#
# Protocol: one JSON object per line.
#   request  {"id": 1, "method": "list_ports", "params": {}}
#   response {"id": 1, "result": ...}  or  {"id": 1, "error": {"message": "..."}}
#   event    {"event": "progress", "cur": 10, "max": 100, "msg": "..."}

import csv
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

from chirp import errors  # noqa: E402
from providers import base  # noqa: E402
from providers import chirp as chirp_p  # noqa: E402
from providers import qdmr as qdmr_p  # noqa: E402

_out_lock = threading.Lock()


def emit(obj):
    with _out_lock:
        sys.stdout.write(json.dumps(obj, default=str) + '\n')
        sys.stdout.flush()


class Session:
    provider = None


S = Session()


def need():
    if S.provider is None:
        raise base.ProviderError('Nenhum rádio carregado. Baixe do rádio ou abra um arquivo primeiro.')
    return S.provider


def backups_dir():
    d = os.path.expanduser('~/RadioHub/backups')
    os.makedirs(d, exist_ok=True)
    return d


def status(cur, mx, msg):
    emit({'event': 'progress', 'cur': cur, 'max': mx, 'msg': msg})


def is_dmr(model_id):
    return str(model_id or '').startswith('qdmr:')


# ---------------------------------------------------------------- methods
def m_ping(p):
    return {'ok': True, 'chirp': __import__('chirp').CHIRP_VERSION, 'dmr': qdmr_p.available()}


def m_list_ports(p):
    return [{'device': port.device, 'description': port.description or '', 'manufacturer': port.manufacturer or '',
             'vid': port.vid, 'pid': port.pid, 'is_usb': port.vid is not None,
             'is_system': ('Bluetooth' in port.device or 'debug-console' in port.device)}
            for port in list_ports.comports()]


_models_cache = None


def m_list_models(p):
    global _models_cache
    if _models_cache is None:
        out = chirp_p.catalog() + qdmr_p.QdmrProvider.catalog()
        out.sort(key=lambda x: x['label'].lower())
        _models_cache = out
    return _models_cache


def m_prompts(p):
    if is_dmr(p['model_id']):
        return qdmr_p.QdmrProvider.prompts()
    return chirp_p.prompts(p['model_id'])


def m_download(p):
    mid = p['model_id']
    if is_dmr(mid):
        S.provider = qdmr_p.QdmrProvider.download(mid.split(':', 1)[1], p.get('port'), backups_dir(), status)
    else:
        S.provider = chirp_p.ChirpProvider.download(mid, p['port'], backups_dir(), status)
    return S.provider.summary()


def m_open_image(p):
    path = p['path']
    if path.lower().endswith(('.yaml', '.yml')):
        key = (p.get('model_id') or '').split(':', 1)[-1] if is_dmr(p.get('model_id')) else None
        S.provider = qdmr_p.QdmrProvider.open_file(path, key)
    else:
        S.provider = chirp_p.ChirpProvider.open_file(path)
    return S.provider.summary()


def m_info(p):
    return need().summary()


def m_get_memories(p):
    return need().get_memories()


def m_validate(p):
    return need().validate(p['memories'])


def m_set_memories(p):
    return need().set_memories(p['memories'])


def m_erase_all(p):
    need().erase_all()
    return {'ok': True}


def m_get_extras(p):
    return need().get_extras()


def m_set_extras(p):
    return need().set_extras(p.get('extras') or {})


def m_parse_csv(p):
    prov = need()
    if not hasattr(prov, 'parse_csv'):
        # DMR radios: read the analog CHIRP CSV rows as FM channels
        tmp = chirp_p.generic_csv.CSVRadio(p['path'])
        f = tmp.get_features()
        mems = [chirp_p.mem_to_json(tmp.get_memory(n)) for n in range(f.memory_bounds[0], f.memory_bounds[1] + 1)]
        mems = [m for m in mems if not m['empty']]
        for m in mems:
            if m['mode'] not in ('FM', 'NFM', 'AM'):
                m['mode'] = 'FM'
            m['power'] = 'Padrão'
        return {'memories': mems, 'problems': []}
    return prov.parse_csv(p['path'])


CSV_FIELDS = ['Location', 'Name', 'Frequency', 'Duplex', 'Offset', 'Tone', 'rToneFreq', 'cToneFreq', 'DtcsCode',
              'DtcsPolarity', 'RxDtcsCode', 'CrossMode', 'Mode', 'TStep', 'Skip', 'Power', 'Comment', 'URCALL',
              'RPT1CALL', 'RPT2CALL', 'DVCODE']


def m_export_csv(p):
    mems = p.get('memories') or need().get_memories()
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator='\r\n')
    w.writerow(CSV_FIELDS)
    for d in mems:
        if d.get('empty') or d.get('mode') == 'DMR':
            continue  # the CHIRP CSV format has no DMR fields
        w.writerow([d['number'], d['name'], '%.6f' % float(d['freq']), d['duplex'], '%.6f' % float(d['offset'] or 0),
                    d['tmode'], '%.1f' % float(d['rtone']), '%.1f' % float(d['ctone']), '%03d' % int(d['dtcs']),
                    d['dtcs_polarity'], '%03d' % int(d.get('rx_dtcs') or d['dtcs']), d.get('cross_mode') or 'Tone->Tone',
                    d['mode'], '%.2f' % float(d.get('tuning_step') or 5), d.get('skip', ''),
                    '' if d.get('power') == 'Padrão' else d.get('power', ''), d.get('comment', ''), '', '', '', ''])
    if p.get('path'):
        with open(p['path'], 'w', newline='') as fh:
            fh.write(buf.getvalue())
        return {'path': p['path']}
    return {'csv': buf.getvalue()}


def m_save_image(p):
    return {'path': need().save(p['path'])}


def m_upload(p):
    return need().upload(p.get('port'), backups_dir(), status)


def m_write_db(p):
    prov = need()
    if not isinstance(prov, qdmr_p.QdmrProvider):
        raise base.ProviderError('A lista de contatos do RadioID só existe em rádios DMR.')
    return prov.write_db(p.get('ids') or [], p.get('port'), status)


METHODS = {k[2:]: v for k, v in globals().items() if k.startswith('m_')}
SLOW = {'download', 'upload', 'list_models', 'open_image', 'write_db'}


def handle(req):
    rid = req.get('id')
    try:
        fn = METHODS.get(req.get('method'))
        if not fn:
            raise ValueError('Método desconhecido: %s' % req.get('method'))
        emit({'id': rid, 'result': fn(req.get('params') or {})})
    except Exception as e:  # noqa: BLE001
        tb = traceback.format_exc()
        LOG.error('%s failed:\n%s', req.get('method'), tb)
        kind = ('radio' if isinstance(e, (errors.RadioError, base.ProviderError)) else
                'serial' if isinstance(e, (serial.SerialException, OSError)) else 'internal')
        msg = str(e) if isinstance(e, base.ProviderError) else (
            '%s: %s' % (e.__class__.__name__, e) if str(e) else e.__class__.__name__)
        emit({'id': rid, 'error': {'message': msg, 'kind': kind, 'detail': tb[-3000:]}})


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
