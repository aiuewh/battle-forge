from pathlib import Path
import sys
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
root=Path(__file__).resolve().parents[1]
base=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else next((root.parent/'_引擎优化验证_20261014'/'baseline').rglob('index.html')).parent
class Handler(SimpleHTTPRequestHandler):
    def translate_path(self,path):
        if path.startswith('/battle-forge/'):
            path=path[len('/battle-forge'):]
        return super().translate_path(path)
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(base),**kwargs)
ThreadingHTTPServer(('127.0.0.1',int(sys.argv[2]) if len(sys.argv)>2 else 3101),Handler).serve_forever()
