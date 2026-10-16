# task brief와 소유 지도를 읽는 공용 함수. status.py, owned.py, coverage.py가 쓴다.
import os, re

PLAN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(PLAN))

def read_briefs():
    briefs = {}
    tdir = os.path.join(PLAN, "tasks")
    for name in sorted(os.listdir(tdir)):
        if not name.endswith(".md") or name == "README.md":
            continue
        tid = name[:-3]
        text = open(os.path.join(tdir, name), encoding="utf-8").read()
        b = {"id": tid, "text": text, "unit": None, "wave": None, "deps": [], "owned": [], "rows": set()}
        m = re.search(r"^- 단위:\s*`?([a-z0-9-]+)`?\s*\(wave\s*(\d)\)", text, re.M)
        if m:
            b["unit"], b["wave"] = m.group(1), int(m.group(2))
        m = re.search(r"^- 선행:\s*(.*)$", text, re.M)
        if m:
            line = re.sub(r"\([^()]*\)", "", re.sub(r"\([^()]*\)", "", m.group(1)))
            line = re.split(r"\.(?:\s|$)", line, maxsplit=1)[0]
            if not line.strip().startswith("없음"):
                b["deps"] = [d for d in re.findall(r"`?([a-z][a-z0-9-]+)`?", line) if "-" in d or d in ("check", "shell-wiring", "wording-split")]
        raw = []
        for m in re.finditer(r"^- (?:추가 )?소유[^\n]*\n((?:[ \t]+[^\n]*\n)*)", text, re.M):
            for line in m.group(1).splitlines():
                raw += re.findall(r"`((?:packages|tools)/[^`]+)`", line)
        b["owned"] = sorted({x.rstrip("/") for r in raw for x in expand(r.strip())})
        b["rows"] = set()
        for line in text.splitlines():
            if re.search(r"넘길|넘김|넘긴다|몫이다\)|다른 단위 몫", line):
                continue
            b["rows"] |= set(re.findall(r"\b([IU]\d+(?:\.\d+)?#\d+)\b", line))
        briefs[tid] = b
    return briefs

def expand(tok):
    m = re.search(r"\{([^{}]+)\}", tok)
    if not m:
        return [tok]
    out = []
    for part in m.group(1).split(","):
        out += expand(tok[:m.start()] + part.strip() + tok[m.end():])
    return out

def exists(path):
    return os.path.exists(os.path.join(REPO, path))

def read_ownership():
    units, cur, wave = {}, None, None
    for line in open(os.path.join(PLAN, "ownership.md"), encoding="utf-8"):
        m = re.match(r"^## wave (\d)", line)
        if m:
            wave = int(m.group(1))
        m = re.match(r"^### (\S+)", line)
        if m:
            cur = m.group(1); units[cur] = {"wave": wave, "paths": []}; continue
        m = re.match(r"^- `([^`]+)`", line)
        if m and cur:
            units[cur]["paths"].append(m.group(1).rstrip("/"))
    return units

def read_assignment():
    rows, cur = {}, None
    for line in open(os.path.join(PLAN, "assignment.md"), encoding="utf-8"):
        m = re.match(r"^## (\S+)", line)
        if m:
            cur = m.group(1); continue
        m = re.match(r"^- `([IU][^`]+)`", line)
        if m and cur:
            rows[m.group(1)] = cur
    return rows

def under(path, prefix):
    path, prefix = path.rstrip("/"), prefix.rstrip("/")
    return path == prefix or path.startswith(prefix + "/")

def overlap(a, b):
    return under(a, b) or under(b, a)

def resolve_deps(briefs, deps):
    out = []
    for d in deps:
        if d in briefs:
            out.append(d)
        else:
            out += [t for t, b in briefs.items() if b["unit"] == d]
    return out

def read_sequenced():
    # ownership.md "순서로 나눠 쓰는 file": path -> 그 file을 고칠 수 있는 task id 목록
    out = {}
    for line in open(os.path.join(PLAN, "ownership.md"), encoding="utf-8"):
        m = re.match(r"^\s+- `([^`]+)`[^:]*:\s*(.+)$", line)
        if m and "→" in m.group(2):
            out[m.group(1)] = [t.strip() for t in re.sub(r"\([^)]*\)", "", m.group(2)).split("→")]
    return out

def owner_unit(path, units):
    best = None
    for u, v in units.items():
        for q in v["paths"]:
            if under(path, q) and (best is None or len(q) > len(best[1])):
                best = (u, q)
    return best[0] if best else None
