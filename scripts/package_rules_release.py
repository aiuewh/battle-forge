"""Package the verified static build, excluding local reset/test entry points."""
from pathlib import Path
import hashlib
import json
import shutil
import zipfile
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
version = '20261014-rules1'
build = root / 'out'
assert (build / 'index.html').exists()
assert any('2026.10.14-rules.1' in p.read_text(encoding='utf-8') for p in (build/'_next').rglob('*.js'))
excluded = {'action-flow-harness.html', 'test-bootstrap.html', 'preview.html', 'emblem-preview.html', 'emblem-preview.txt'}
site = root/'download'/f'battle-forge-site-{version}.zip'
with zipfile.ZipFile(site, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for path in sorted(build.rglob('*')):
        rel = path.relative_to(build)
        if path.is_file() and rel.name not in excluded and 'emblem-preview' not in rel.parts:
            z.write(path, rel.as_posix())
    z.writestr('.nojekyll', '')
with zipfile.ZipFile(site) as z:
    assert z.testzip() is None
    assert not any('harness' in name or 'test-bootstrap' in name for name in z.namelist())
subprocess.run([sys.executable, str(root/'scripts/build_src_zip.py')], check=True)
source = root/'download'/f'battle-forge-app-src-{version}.zip'
shutil.copy2(root/'download/battle-forge-app-src.zip', source)
card = root.parent.parent/'【D&D 2024版】.json'
before = json.loads((root.parent/'_引擎优化前_20261014'/card.name).read_text(encoding='utf-8'))
after = json.loads(card.read_text(encoding='utf-8'))
entry_before = next(e for e in before['data']['character_book']['entries'] if e['id']==810000)
entry_after = next(e for e in after['data']['character_book']['entries'] if e['id']==810000)
assert entry_before['content'] != entry_after['content']
entry_before['content'] = entry_after['content']
assert before == after, 'Unexpected card changes'
manifest = {p.name: {'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in [site, source, card]}
(root.parent/'引擎优化交付校验_20261014.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(manifest, ensure_ascii=False, indent=2))
