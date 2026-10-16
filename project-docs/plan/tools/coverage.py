# 사용: python3 -I coverage.py
# 계획이 모자라거나 겹친 곳을 찾는다. 문제가 있으면 exit 1.
import os, re, sys, itertools
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from briefs import read_briefs, read_ownership, read_assignment, resolve_deps, overlap, under, exists, PLAN, read_sequenced, owner_unit

briefs, units, rows = read_briefs(), read_ownership(), read_assignment()
problems = []
new_paths = {}
sequenced = read_sequenced()
LEAD_FILES = ('packages/core/main/daemon/core.ts', 'packages/core/main/daemon/assembly.ts', 'packages/core/main/daemon/wiring/context.ts', 'packages/core/main/daemon/registration.ts', 'packages/shell/main/desktop/main.ts', 'packages/shell/main/desktop/wiring/context.ts', 'packages/protocol/registry.ts', 'deno.json', 'deno.lock')
def lead_or_list(p):
    return p in LEAD_FILES or p.endswith('/mod.ts') or p.endswith('/registry.ts') or p.endswith('/deno.json')
def shared(p):
    return p.startswith("packages/design/wording") or p.endswith(".placeholders.ts")
def bad(kind, msg):
    problems.append((kind, msg))

need = ["- 단위:", "- 선행:", "- 소유", "- 읽을 것:", "- 계약:", "## 할 일", "## 끝남", "## 보고"]
for t, b in briefs.items():
    for n in need:
        if n not in b["text"]:
            bad("꼴", f"{t}: '{n}' 없음")
    if b["unit"] not in units:
        bad("꼴", f"{t}: 단위 '{b['unit']}'가 ownership.md에 없음")
        continue
    if units[b["unit"]]["wave"] != b["wave"]:
        bad("꼴", f"{t}: wave {b['wave']}가 ownership.md의 {units[b['unit']]['wave']}와 다름")
    if not b["owned"] and b["unit"] != "cleanup":
        bad("소유", f"{t}: 소유 path가 없음")
    for p in b["owned"]:
        if b["unit"] == "cleanup" or any(under(p, q) for q in units[b["unit"]]["paths"]):
            continue
        if shared(p) and (b["wave"] or 0) >= 1:
            continue
        if t in sequenced.get(p, []):
            continue
        if b["wave"] == 1 and p.startswith(("packages/", "tools/")):
            continue
        if not p.startswith(("packages/", "tools/")):
            bad("소유", f"{t}: `{p}`는 저장소 path가 아님")
        elif not exists(p) and not any(under(p, q) or under(q, p) for u, v in units.items() if u != b["unit"] for q in v["paths"]):
            new_paths.setdefault(b["unit"], set()).add(p)
        else:
            bad("소유", f"{t}: `{p}`는 단위 {b['unit']}의 소유 밖")
    for d in b["deps"]:
        if d not in briefs and d not in units:
            bad("선행", f"{t}: 선행 '{d}'가 없는 task·단위")
    for w in ("자리", "시험"):
        if w in b["text"]:
            bad("말", f"{t}: '{w}'를 씀")

cited = {}
for t, b in briefs.items():
    for r in b["rows"]:
        cited.setdefault(r, []).append(t)
for r, u in sorted(rows.items()):
    if u == "lead":
        continue
    if r not in cited:
        bad("빠진 줄", f"{r} ({u})")

def ancestors(t, seen=None):
    seen = seen or set()
    for d in resolve_deps(briefs, briefs[t]["deps"]):
        if d not in seen:
            seen.add(d); ancestors(d, seen)
    return seen
anc = {t: ancestors(t) for t in briefs}
for a, b in itertools.combinations(sorted(briefs), 2):
    A, B = briefs[a], briefs[b]
    if A["wave"] != B["wave"] or a in anc[b] or b in anc[a]:
        continue
    hit = []
    for p in A["owned"]:
        for q in B["owned"]:
            if not overlap(p, q) or shared(p) or shared(q) or lead_or_list(p) or lead_or_list(q):
                continue
            narrow, nt = (q, B) if len(q) >= len(p) else (p, A)
            other = A if nt is B else B
            ou = owner_unit(narrow, units)
            if ou == nt["unit"] and ou != other["unit"]:
                continue
            hit.append((p, q))
    if hit:
        bad("겹친 소유", f"{a} ↔ {b}: `{hit[0][0]}` / `{hit[0][1]}`" + (f" 외 {len(hit)-1}" if len(hit) > 1 else ""))

if new_paths:
    print("[새 path] 지도에 없는 새 file이다. --apply면 ownership.md의 그 단위에 더한다.")
    for u in sorted(new_paths):
        for p in sorted(new_paths[u]):
            print(f"  {u}: `{p}`")
    if "--apply" in sys.argv:
        lines = open(os.path.join(PLAN, "ownership.md"), encoding="utf-8").read().split("\n")
        for u, ps in new_paths.items():
            i = lines.index(f"### {u}") + 1
            while i < len(lines) and lines[i].startswith("- "):
                i += 1
            lines[i:i] = [f"- `{p}`(새로)" for p in sorted(ps)]
        open(os.path.join(PLAN, "ownership.md"), "w", encoding="utf-8").write("\n".join(lines))
        print("  → ownership.md에 더했다")
print(f"brief {len(briefs)}개, inventory 줄 {sum(1 for u in rows.values() if u != 'lead')}개 중 인용 {sum(1 for r, u in rows.items() if u != 'lead' and r in cited)}개")
for kind in ("꼴", "소유", "선행", "말", "빠진 줄", "겹친 소유"):
    items = [m for k, m in problems if k == kind]
    if items:
        print(f"\n[{kind}] {len(items)}")
        for m in items[:200]:
            print("  " + m)
sys.exit(1 if problems else 0)
