"""사용: python3 -I pick.py <계획> N
status.py <계획> ready 가운데 서로 소유가 겹치지 않는 task를 최대 N개 골라 id를 한 줄로 낸다."""
import os, subprocess, sys
TOOLS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, TOOLS)
from briefs import read_briefs, clash

if len(sys.argv) != 3:
    print(__doc__); sys.exit(0)
plan, n = sys.argv[1], int(sys.argv[2])
b = read_briefs(plan)
out = subprocess.run([sys.executable, "-I", os.path.join(TOOLS, "status.py"), plan, "ready"], capture_output=True, text=True).stdout.split("\n")
chosen = []
for t in [l.split()[-1] for l in out if l.startswith("wave ")]:
    if clash(b[t], [b[c] for c in chosen]):
        continue
    chosen.append(t)
    if len(chosen) == n:
        break
print(" ".join(chosen))
