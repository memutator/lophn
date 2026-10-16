# 사용: python3 -I status.py build | ready | set <id> <상태> [branch] [commit] [기록]
# 상태: todo, running, review, merged, blocked
import os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from briefs import PLAN, read_briefs, resolve_deps, overlap

STATUS = os.path.join(PLAN, "status.md")
COLS = ["id", "단위", "wave", "선행", "상태", "branch", "commit", "기록"]

def load():
    rows, freeze = {}, ""
    if not os.path.exists(STATUS):
        return rows, freeze
    for line in open(STATUS, encoding="utf-8"):
        m = re.match(r"^계약 고정:\s*(.*)$", line)
        if m:
            freeze = m.group(1).strip()
        if line.startswith("| ") and not line.startswith("| id ") and not line.startswith("|--"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) == len(COLS):
                rows[cells[0].strip("`")] = dict(zip(COLS, cells))
    return rows, freeze

def save(rows, freeze, briefs):
    order = sorted(briefs.values(), key=lambda b: (b["wave"] if b["wave"] is not None else 9, b["unit"] or "", b["id"]))
    lines = ["# 상태", "", "오케스트레이터만 고친다. `tools/status.py`가 brief에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.", "",
             f"계약 고정: {freeze or '(아직)'}", "",
             "| " + " | ".join(COLS) + " |", "|" + "---|" * len(COLS)]
    for b in order:
        r = rows.get(b["id"], {})
        deps = ", ".join(b["deps"]) or "없음"
        lines.append("| " + " | ".join([f"`{b['id']}`", b["unit"] or "?", str(b["wave"]), deps,
                                          r.get("상태", "todo") or "todo", r.get("branch", ""), r.get("commit", ""), r.get("기록", "")]) + " |")
    open(STATUS, "w", encoding="utf-8").write("\n".join(lines) + "\n")

def dependents(briefs):
    rev = {t: set() for t in briefs}
    for t, b in briefs.items():
        for d in resolve_deps(briefs, b["deps"]):
            rev.setdefault(d, set()).add(t)
    def walk(t, seen):
        for n in rev.get(t, ()):
            if n not in seen:
                seen.add(n); walk(n, seen)
        return seen
    return {t: len(walk(t, set())) for t in briefs}

def main():
    briefs = read_briefs()
    rows, freeze = load()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    if cmd == "build":
        save(rows, freeze, briefs); print(f"{len(briefs)} tasks"); return
    if cmd == "set":
        tid, state = sys.argv[2], sys.argv[3]
        r = rows.setdefault(tid, {})
        r["상태"] = state
        for i, k in enumerate(["branch", "commit", "기록"]):
            if len(sys.argv) > 4 + i:
                r[k] = sys.argv[4 + i]
        save(rows, freeze, briefs); return
    if cmd == "freeze":
        save(rows, sys.argv[2], briefs); return
    if cmd == "ready":
        state = {t: rows.get(t, {}).get("상태", "todo") for t in briefs}
        running = [t for t, s in state.items() if s in ("running", "review")]
        waves_done = {}
        for b in briefs.values():
            waves_done.setdefault(b["wave"], True)
            if state[b["id"]] != "merged":
                waves_done[b["wave"]] = False
        dep_count = dependents(briefs)
        ready = []
        for t, b in briefs.items():
            if state[t] != "todo":
                continue
            if b["wave"] == 3 and not freeze:
                continue
            if not all(v for w, v in waves_done.items() if w is not None and w < b["wave"]):
                continue
            if any(state.get(d) != "merged" for d in resolve_deps(briefs, b["deps"])):
                continue
            # wording catalog은 여러 화면 task가 key만 더한다. 부딪치면 lead가 rebase 때 두 쪽을 다 남긴다.
            def shared(p):
                return p.startswith("packages/design/wording") or p.endswith(".placeholders.ts")
            clash = [r for r in running if any(overlap(p, q) for p in b["owned"] if not shared(p) for q in briefs[r]["owned"] if not shared(q))]
            if clash:
                continue
            ready.append((b["wave"], -dep_count[t], t))
        free = max(0, 8 - len(running))
        print(f"running {len(running)}, 빈 slot {free}")
        for w, n, t in sorted(ready):
            print(f"wave {w}  뒤에 기다리는 task {-n:3d}  {t}")
        return
    print(__doc__ or "build | ready | set | freeze")

if __name__ == "__main__":
    main()
