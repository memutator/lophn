# 사용: python3 -I owned.py <task id> [worktree]
# worker가 brief의 소유 밖 file을 고쳤는지 본다. 밖이 있으면 exit 1.
import os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from briefs import REPO, read_briefs, under, read_sequenced

tid = sys.argv[1]
wt = sys.argv[2] if len(sys.argv) > 2 else os.path.join(REPO, ".claude", "worktrees", tid)
b = read_briefs()[tid]
def git(*args):
    return subprocess.run(["git", "-C", wt, *args], capture_output=True, text=True, check=True).stdout
changed = set(git("diff", "--name-only", "main...HEAD").split())
changed |= {l[3:].split(" -> ")[-1] for l in git("status", "--porcelain").splitlines() if l}
seq = read_sequenced()
def allowed(f):
    if any(under(f, p) for p in b["owned"]):
        return True
    if f.startswith("packages/design/wording/catalog/") or f.endswith(".placeholders.ts"):
        return True
    return tid in seq.get(f, [])
outside = sorted(f for f in changed if not allowed(f))
print(f"{tid}: 바뀐 file {len(changed)}개, 소유 밖 {len(outside)}개")
for f in outside:
    print("  밖:", f)
sys.exit(1 if outside else 0)
