# task brief(<계획>/tasks/*.md)를 읽는 공용 함수. status.py와 lead/pick.py가 쓴다.
# 계획 하나가 project-docs/plan/<계획>/ 폴더 하나다. 여러 계획이 같이 돌 수 있다.
# brief가 없어도 돈다(빈 dict). brief 꼴은 .claude/skills/orchestrate/brief-template.md.
import os, re

PLANS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(PLANS))

def plan_dir(plan):
    path = os.path.join(PLANS, plan)
    if plan == "tools" or not os.path.isdir(os.path.join(path, "tasks")):
        raise SystemExit(f"계획 없음: {plan} (project-docs/plan/<계획>/tasks/가 있어야 한다)")
    return path

def plan_names():
    return sorted(n for n in os.listdir(PLANS)
                  if n != "tools" and os.path.isdir(os.path.join(PLANS, n, "tasks")))

# 여러 task가 key만 더하는 file. 소유가 겹쳐도 같이 돌린다(부딪치면 lead가 rebase 때 두 쪽을 다 남긴다).
def shared(path):
    return path.startswith("packages/design/wording") or path.endswith(".placeholders.ts")

def read_briefs(plan):
    briefs = {}
    tdir = os.path.join(plan_dir(plan), "tasks")
    if not os.path.isdir(tdir):
        return briefs
    for name in sorted(os.listdir(tdir)):
        if not name.endswith(".md") or name == "README.md":
            continue
        tid = name[:-3]
        text = open(os.path.join(tdir, name), encoding="utf-8").read()
        b = {"id": tid, "text": text, "unit": None, "wave": None, "deps": [], "owned": []}
        m = re.search(r"^- 단위:\s*`?([a-z0-9-]+)`?\s*\(wave\s*(\d+)\)", text, re.M)
        if m:
            b["unit"], b["wave"] = m.group(1), int(m.group(2))
        m = re.search(r"^- 선행:\s*(.*)$", text, re.M)
        if m:
            line = re.sub(r"\([^()]*\)", "", re.sub(r"\([^()]*\)", "", m.group(1)))
            line = re.split(r"\.(?:\s|$)", line, maxsplit=1)[0]  # 첫 문장까지만. 뒤는 설명이다.
            if not line.strip().startswith("없음"):
                b["deps"] = list(dict.fromkeys(re.findall(r"`?([a-z][a-z0-9-]*)`?", line)))
        raw = []
        for m in re.finditer(r"^- (?:추가 )?소유[^\n]*\n((?:[ \t]+[^\n]*\n)*)", text, re.M):
            for line in m.group(1).splitlines():
                raw += re.findall(r"`((?:packages|tools)/[^`]+)`", line)
        b["owned"] = sorted({x.rstrip("/") for r in raw for x in expand(r.strip())})
        briefs[tid] = b
    # 선행에는 task id나 단위 이름만 남긴다.
    names = set(briefs) | {b["unit"] for b in briefs.values() if b["unit"]}
    for b in briefs.values():
        b["deps"] = [d for d in b["deps"] if d in names]
    return briefs

def expand(tok):
    m = re.search(r"\{([^{}]+)\}", tok)
    if not m:
        return [tok]
    out = []
    for part in m.group(1).split(","):
        out += expand(tok[:m.start()] + part.strip() + tok[m.end():])
    return out

def under(path, prefix):
    path, prefix = path.rstrip("/"), prefix.rstrip("/")
    return path == prefix or path.startswith(prefix + "/")

def overlap(a, b):
    return under(a, b) or under(b, a)

def clash(b, others):
    # b가 소유한 path가 others(brief 목록)의 것과 겹치는가. shared file은 뺀다.
    return any(
        overlap(p, q)
        for o in others for p in b["owned"] if not shared(p) for q in o["owned"] if not shared(q)
    )

def resolve_deps(briefs, deps):
    out = []
    for d in deps:
        if d in briefs:
            out.append(d)
        else:
            out += [t for t, b in briefs.items() if b["unit"] == d]
    return out
