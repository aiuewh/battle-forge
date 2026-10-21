"""Create an isolated preview of the prior delivered site for redraw measurements."""
from pathlib import Path
import zipfile
root=Path(__file__).resolve().parents[1]
dest=root.parent/'_引擎优化验证_20261014'/'baseline'
dest.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(root/'download/battle-forge-site-20261014.zip') as z:
    for name in z.namelist():
        if name.endswith('/'):
            continue
        rel=Path(name)
        if '..' in rel.parts or rel.is_absolute(): raise ValueError(name)
        target=dest/rel
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(z.read(name))
index=next(dest.rglob('index.html'))
base=index.parent
instrument='''<script>(()=>{const clear=CanvasRenderingContext2D.prototype.clearRect;CanvasRenderingContext2D.prototype.clearRect=function(...args){this.canvas.dataset.renderCount=String(Number(this.canvas.dataset.renderCount||0)+1);return clear.apply(this,args);};})();</script>'''
html=index.read_text(encoding='utf-8')
index.write_text(html.replace('<head>','<head>'+instrument,1),encoding='utf-8')
harness=(root/'public/action-flow-harness.html').read_text(encoding='utf-8').replace('http://localhost:3000/', 'http://localhost:3101/battle-forge/')
(base/'action-flow-harness.html').write_text(harness,encoding='utf-8')
print(base)
