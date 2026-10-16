import sys,subprocess,re
sys.path.insert(0,'/home/pyosechang/projects/lophn/project-docs/plan/tools')
from briefs import *
n=int(sys.argv[1])
b=read_briefs()
st=open('/home/pyosechang/projects/lophn/project-docs/plan/status.md').read()
running=[m.group(1) for m in re.finditer(r"^\| `([^`]+)` \|[^\n]*\| running \|",st,re.M)]
out=subprocess.run(['python3','-I','/home/pyosechang/projects/lophn/project-docs/plan/tools/status.py','ready'],capture_output=True,text=True).stdout.split('\n')
ids=[l.split()[-1] for l in out if l.startswith('wave ')]
def shared(p): return p.startswith('packages/design/wording') or p.endswith('.placeholders.ts')
chosen=[]
for t in ids:
    if any(overlap(p,q) for c in chosen+running if c in b for p in b[t]['owned'] if not shared(p) for q in b[c]['owned'] if not shared(q)): continue
    chosen.append(t)
    if len(chosen)==n: break
print(' '.join(chosen))
