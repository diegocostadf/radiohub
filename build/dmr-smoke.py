#!/usr/bin/env python3
# CI check: the bundled dmrconf runs on its own, and accepts codeplugs written by RadioHub.
# Usage: python3 build/dmr-smoke.py <dmrconf> <example.yaml>
import os, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, 'engine'), os.path.join(ROOT, 'engine', 'site')]
import builtins, gettext  # noqa: E401
builtins._ = gettext.gettext
from providers import qdmr  # noqa: E402

exe, example = sys.argv[1], sys.argv[2]
env = dict(os.environ, DYLD_PRINT_LIBRARIES='1')
r = subprocess.run([exe, '--help'], capture_output=True, text=True, env=env)
leaks = [l for l in (r.stdout + r.stderr).splitlines() if '/opt/homebrew' in l or '/usr/local' in l]
if leaks:
    sys.exit('dmrconf still loads libraries from Homebrew:\n' + '\n'.join(leaks[:20]))
print('dmrconf runs without Homebrew libraries')

p = qdmr.QdmrProvider.open_file(example, 'd878uv')
mems = [m for m in p.get_memories() if not m['empty']]
dmr = [m for m in mems if m['mode'] == 'DMR']
p.set_memories([
    dict(mems[0], name='EDITADO'),
    {'number': len(mems) + 1, 'empty': False, 'name': 'BSB 2M', 'freq': '146.950000', 'duplex': '-', 'offset': '0.600000',
     'tmode': 'Tone', 'rtone': 88.5, 'ctone': 88.5, 'mode': 'FM', 'power': 'High'},
    {'number': len(mems) + 2, 'empty': False, 'name': 'DMR TESTE', 'freq': '439.000000', 'duplex': '-', 'offset': '7.600000',
     'mode': 'DMR', 'power': 'Padrão', 'dmr': {'color_code': 1, 'time_slot': 'TS2', 'contact': dmr[0]['dmr']['contact'], 'group_list': None}},
    {'number': 2, 'empty': True},
])
ex = p.get_extras()
ex['contacts'].append({'name': 'Brasil', 'type': 'GroupCall', 'number': 724})
p.set_extras(ex)
out = os.path.join(tempfile.mkdtemp(), 'radiohub.yaml')
p.save(out)
os.environ['RADIOHUB_DMRCONF'] = exe
for radio in ('d878uv', 'd868uv', 'uv390', 'md390', 'gd77', 'rd5r', 'dm1701'):
    for src in (example, out):
        b = out + '.' + radio + '.bin'
        r = subprocess.run([exe, '--radio', radio, 'encode', src, b], capture_output=True, text=True)
        ok = r.returncode == 0 and os.path.exists(b)
        print('%-8s %-14s %s' % (radio, os.path.basename(src), 'ok' if ok else 'FALHOU'))
        if not ok:
            sys.exit(r.stdout + r.stderr)
print('all codeplugs encoded')
