#!/usr/bin/env python3
# Generates site/radios.json: every radio model RadioHub supports, grouped by brand.
# Used by the landing page (radiohub.diegocosta.digital) and kept in sync on each release.
import json, os, sys, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(ROOT, 'engine'), os.path.join(ROOT, 'engine', 'site')]
import builtins, gettext  # noqa: E401
builtins._ = gettext.gettext
builtins.ngettext = gettext.ngettext
import logging; logging.disable(logging.CRITICAL)
from providers import chirp as chirp_p, qdmr as qdmr_p  # noqa: E402

version = json.load(open(os.path.join(ROOT, 'package.json')))['version']
items = []
for m in chirp_p.catalog():
    items.append({'brand': m['vendor'], 'model': m['model'], 'variant': m['variant'], 'form': m['form'],
                  'type': 'analog', 'platforms': ['mac', 'windows']})
for m in qdmr_p.QdmrProvider.catalog():
    items.append({'brand': m['vendor'], 'model': m['model'], 'variant': '', 'form': m['form'],
                  'type': 'dmr', 'platforms': ['mac']})
seen, out = set(), []
for it in sorted(items, key=lambda x: (x['brand'].lower(), x['model'].lower(), x['variant'].lower(), x['type'])):
    k = (it['brand'], it['model'], it['variant'], it['type'])
    if k not in seen:
        seen.add(k); out.append(it)
brands = {}
for it in out:
    brands.setdefault(it['brand'], 0); brands[it['brand']] += 1
doc = {'version': version, 'generated': datetime.date.today().isoformat(), 'total': len(out),
       'brands': [{'name': b, 'count': n} for b, n in sorted(brands.items(), key=lambda x: x[0].lower())],
       'radios': out}
path = os.path.join(ROOT, 'site', 'radios.json')
with open(path, 'w', encoding='utf-8') as fh:
    json.dump(doc, fh, ensure_ascii=False, separators=(',', ':'))
print('%d modelos, %d marcas, %d DMR -> %s' % (len(out), len(brands), sum(1 for i in out if i['type'] == 'dmr'), path))
