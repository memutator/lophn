"""task 상태 표(../status.md)를 다룬다. 오케스트레이터만 쓴다.

사용: python3 -I status.py build | ready | set <id> <상태> [branch] [commit] [기록]
상태: todo, running, review, merged, blocked
- build: tasks/*.md에서 id, 단위, wave, 선행을 다시 읽어 표를 만든다. 상태·branch·commit·기록은 그대로 둔다.
- ready: 지금 띄울 수 있는 task. 앞 wave가 모두 merged, 선행이 merged, running task와 소유가 안 겹침.
- set: 한 task의 상태 칸을 고친다.
"""
import os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from briefs import PLAN, read_briefs, resolve_deps, clash

STATUS = os.path.join(PLAN, "status.md")
COLS = ["id", "단위", "wave", "선행", "상태", "branch", "commit", "기록"]
MAX_WORKERS = 8  # core type check 하나가 약 2.6GB다. RAM에 맞춰 고친다.

def load():
    rows = {}
    if not os.path.exists(STATUS):
        return rows
    for line in open(STATUS, encoding="utf-8"):
        if line.startswith("| ") and not line.startswith("| id ") and not line.startswith("|--"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) == len(COLS):
                rows[cells[0].strip("`")] = dict(zip(COLS, cells))
    return rows

def save(rows, briefs):
    order = sorted(briefs.values(), key=lambda b: (b["wave"] if b["wave"] is not None else 9, b["unit"] or "", b["id"]))
    lines = ["# 상태", "",
             "오케스트레이터만 고친다. `tools/status.py build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.", "",
             "| " + " | ".join(COLS) + " |", "|" + "---|" * len(COLS)]
    for b in order:
        r = rows.get(b["id"], {})
        lines.append("| " + " | ".join([f"`{b['id']}`", b["unit"] or "?", str(b["wave"]), ", ".join(b["deps"]) or "없음",
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

def ready(briefs, rows):
    state = {t: rows.get(t, {}).get("상태", "todo") or "todo" for t in briefs}
    running = [briefs[t] for t, s in state.items() if s in ("running", "review")]
    wave_done = {}
    for b in briefs.values():
        wave_done.setdefault(b["wave"], True)
        if state[b["id"]] != "merged":
            wave_done[b["wave"]] = False
    dep_count = dependents(briefs)
    out = []
    for t, b in briefs.items():
        if state[t] != "todo":
            continue
        if not all(v for w, v in wave_done.items() if w is not None and b["wave"] is not None and w < b["wave"]):
            continue
        if any(state.get(d) != "merged" for d in resolve_deps(briefs, b["deps"])):
            continue
        if clash(b, running):
            continue
        out.append((b["wave"] if b["wave"] is not None else 9, -dep_count[t], t))
    return len(running), sorted(out)

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd not in ("build", "ready", "set"):
        print(__doc__)
        return
    briefs, rows = read_briefs(), load()
    if cmd == "build":
        save(rows, briefs); print(f"{len(briefs)} tasks")
    elif cmd == "set":
        tid, state = sys.argv[2], sys.argv[3]
        if tid not in briefs:
            sys.exit(f"brief 없음: {tid}")
        r = rows.setdefault(tid, {})
        r["상태"] = state
        for i, k in enumerate(["branch", "commit", "기록"]):
            if len(sys.argv) > 4 + i:
                r[k] = sys.argv[4 + i]
        save(rows, briefs)
    else:
        n_running, found = ready(briefs, rows)
        print(f"running {n_running}, 빈 slot {max(0, MAX_WORKERS - n_running)}")
        for w, n, t in found:
            print(f"wave {w}  뒤에 기다리는 task {-n:3d}  {t}")

if __name__ == "__main__":
    main()
