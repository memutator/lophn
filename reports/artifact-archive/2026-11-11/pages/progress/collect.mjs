// 진행 현황 수집: lophn 저장소를 읽기만 하고 data/latest.json을 쓴다.
// 실행: node collect.mjs [저장소 경로]
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = process.argv[2] ?? "/home/pyosechang/projects/lophn";
const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = join(REPO, "project-docs");
const require = createRequire(join(REPO, "package.json"));
const { parse } = require("yaml");

const DAY = 86400000;
const now = new Date();
const since7 = now.getTime() - 7 * DAY;

const git = (...args) =>
  execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

// 사람에게 보일 글에서 path, hash, 코드 따옴표를 걷는다.
function clean(text) {
  let s = String(text ?? "");
  s = s.replace(/\*\*/g, "");
  // path나 commit을 담은 괄호 묶음은 통째로 뺀다.
  s = s.replace(/\s*\([^()]*(\/|\.ya?ml|\.md|commit|change-?log|`[0-9a-f]{7,}`)[^()]*\)/g, "");
  s = s.replace(/`[^`]*\/[^`]*`/g, "");
  s = s.replace(/`([^`]*)`/g, "$1");
  s = s.replace(/[\w./{},-]+\.(md|ya?ml|ts|tsx)\b/g, "");
  s = s.replace(/(,\s*)+(?=[,.다])/g, "");
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  s = s.replace(/\s+([,.])/g, "$1").replace(/\s{2,}/g, " ").trim();
  return s;
}
const firstSentence = (s) => {
  const m = s.match(/^(.+?[다음])\.(\s|$)/);
  return m ? m[1] + "." : s;
};
const vnum = (v) => v.split(".").map(Number);
const vcmp = (a, b) => {
  const x = vnum(a), y = vnum(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

// ---------- 계획 ----------
const STATE_WORDS = {
  merged: "merged", 합침: "merged", done: "merged", 끝남: "merged",
  running: "running", 진행: "running", review: "running",
  todo: "todo", 대기: "todo", ready: "todo",
  blocked: "blocked", 보류: "blocked",
  dropped: "dropped", 안함: "dropped",
};
function parseTable(lines, start) {
  const rows = [];
  const head = lines[start].split("|").slice(1, -1).map((c) => c.trim());
  for (let i = start + 2; i < lines.length && lines[i].startsWith("|"); i++) {
    rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
  }
  return { head, rows };
}
function findTaskTables(text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("|") || (i > 0 && lines[i - 1].startsWith("|"))) continue;
    const t = parseTable(lines, i);
    const h = t.head;
    const idCol = h.findIndex((c) => c === "id" || c === "task");
    const waveCol = h.indexOf("wave");
    if (idCol >= 0 && waveCol >= 0) out.push({ ...t, idCol, waveCol, stateCol: h.indexOf("상태") });
  }
  return out;
}
function plans() {
  const dir = join(DOCS, "plan");
  return readdirSync(dir)
    .filter((n) => n !== "tools" && statSync(join(dir, n)).isDirectory())
    .map((name) => {
      const readme = readFileSync(join(dir, name, "README.md"), "utf8");
      const goalLine = readme.split("\n").find((l) => /^-\s*목표:/.test(l)) ?? "";
      const goal = firstSentence(clean(goalLine.replace(/^-\s*목표:\s*/, "")));
      const statusPath = join(dir, name, "status.md");
      const source = existsSync(statusPath) ? readFileSync(statusPath, "utf8") : readme;
      const tables = findTaskTables(source);
      const tasks = [];
      let recorded = false;
      for (const t of tables) {
        for (const r of t.rows) {
          const id = r[t.idCol].replace(/`/g, "");
          const raw = t.stateCol >= 0 ? r[t.stateCol] : "";
          if (t.stateCol >= 0) recorded = true;
          tasks.push({ id, wave: Number(r[t.waveCol]) || 0, state: STATE_WORDS[raw] ?? (raw ? "todo" : "unknown") });
        }
      }
      // README의 글로 남긴 상태(보류, 하지 않음)를 표에 덧입힌다.
      const blockedWaves = [...readme.matchAll(/wave (\d+)\*\*:[^\n]*`blocked`/g)].map((m) => Number(m[1]));
      for (const task of tasks) {
        if (task.state === "unknown") task.state = blockedWaves.includes(task.wave) ? "blocked" : "todo";
        if (new RegExp("`" + task.id + "`는 하지 않는다").test(readme)) task.state = "dropped";
      }
      const notes = [];
      if (/보류한다|보류가 풀릴 때까지/.test(readme)) notes.push("실제 provider 호출 확인이 보류 중");
      if (/사람의 Electron 확인은 아직|사람이 아직 직접 하지 않았다/.test(readme)) notes.push("사람의 실제 앱 확인 대기");
      if (/사람에게: 끝난 뒤 Electron/.test(readme)) notes.push("끝난 뒤 사람의 실제 로그인 확인을 부탁할 차례");
      if (!recorded) notes.push("task별 상태 기록이 없다");
      const live = tasks.filter((t) => t.state !== "dropped");
      if (live.length && live.every((t) => t.state === "merged")) notes.push("모든 task가 합쳐졌는데 계획 폴더가 남아 있다");
      const last = git("log", "-1", "--format=%cI", "--", `project-docs/plan/${name}`).trim();
      const opened = git("log", "--diff-filter=A", "--format=%cI", "--", `project-docs/plan/${name}/README.md`)
        .trim().split("\n").pop();
      const count = (s) => tasks.filter((t) => t.state === s).length;
      return {
        name, goal, tasks, notes, lastChanged: last || null, opened: opened || null,
        counts: { merged: count("merged"), running: count("running"), todo: count("todo"), blocked: count("blocked"), dropped: count("dropped"), unknown: count("unknown") },
      };
    });
}

// ---------- change-log ----------
function releaseDates() {
  const map = new Map();
  for (const line of git("log", "--format=%cI\t%s", "--grep=^Release [0-9]").split("\n")) {
    const [date, subject] = line.split("\t");
    const m = subject?.match(/^Release (\d+\.\d+\.\d+)/);
    if (m && !map.has(m[1])) map.set(m[1], date);
  }
  return map;
}
function addDates(path) {
  // file이 처음 들어온 commit 시각. 옛 꼴에서 한꺼번에 옮긴 commit은 실제 날이 아니다.
  const out = new Map();
  let date = null;
  for (const line of git("log", "--no-renames", "--diff-filter=A", "--format=@@%cI", "--name-only", "--", path).split("\n")) {
    if (line.startsWith("@@")) date = line.slice(2);
    else if (line.trim()) out.set(line.trim(), date); // 오래된 것이 뒤에 오므로 마지막 값이 처음 날이다.
  }
  return out;
}
function changes(released) {
  const dir = join(DOCS, "products/change-log");
  const rel = releaseDates();
  const added = addDates("project-docs/products/change-log");
  const perCommit = new Map();
  for (const d of added.values()) perCommit.set(d, (perCommit.get(d) ?? 0) + 1);
  // 옛 꼴은 판마다 file 하나(<x.y.z>.md)였다. 그 file이 들어온 날이 그 판의 날이다.
  const oldFile = new Map();
  for (const [p, d] of added) {
    const m = p.match(/change-log\/(\d+\.\d+\.\d+)\.md$/);
    if (m) oldFile.set(m[1], d);
  }
  const tagDate = (v) => {
    try {
      return execFileSync("git", ["-C", REPO, "log", "-1", "--format=%cI", `v${v}`, "--"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
    } catch { return null; }
  };
  const dateOf = (version, path, title) => {
    // x.y.0은 판을 연 날에 여러 일이 묶여 올라가므로 일마다 날을 따로 찾는다.
    if (rel.has(version) && !version.endsWith(".0")) return rel.get(version);
    const a = added.get(path);
    if (a && (perCommit.get(a) ?? 0) <= 5) return a; // 한꺼번에 옮긴 commit의 날은 실제 날이 아니다.
    // 최근 판이면 제목이 처음 적힌 commit을 찾는다(옛 꼴의 판 file 안 제목).
    if (/^0\.2[23]\./.test(version) && title) {
      const first = git("log", "--reverse", "--format=%cI", "-F", `-S${title}`, "--", "project-docs/products/change-log").split("\n")[0];
      if (first) return first;
    }
    return rel.get(version) ?? tagDate(version) ?? oldFile.get(version) ?? null;
  };
  const items = [];
  for (const minor of readdirSync(dir)) {
    if (!/^\d+\.\d+$/.test(minor)) continue;
    for (const f of readdirSync(join(dir, minor))) {
      if (!f.endsWith(".yaml")) continue;
      const doc = parse(readFileSync(join(dir, minor, f), "utf8"));
      const path = `project-docs/products/change-log/${minor}/${f}`;
      // 날짜: 그 판을 main에 올린 commit. x.y.0 처럼 그런 commit이 없으면 file이 들어온 날.
      const date = dateOf(doc.version, path, doc.title);
      items.push({ version: doc.version, minor, title: clean(doc.title), date, decisions: (doc.decisions ?? []).length, person: (doc.decisions ?? []).filter((d) => d.by === "person").length });
    }
  }
  items.sort((a, b) => vcmp(b.version, a.version) || (b.date ?? "").localeCompare(a.date ?? ""));
  const recent = items.filter((i) => i.date && Date.parse(i.date) >= since7);
  const afterRelease = items.filter((i) => vcmp(i.version, released) > 0);
  // 날마다 몇 건(최근 14일)
  const days = [];
  for (let d = 13; d >= 0; d--) {
    const day = new Date(now.getTime() - d * DAY);
    const key = day.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    days.push({ day: key, count: 0 });
  }
  for (const i of items) {
    if (!i.date) continue;
    const key = new Date(i.date).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    const slot = days.find((d) => d.day === key);
    if (slot) slot.count++;
  }
  const byMinor = (m) => items.filter((i) => i.minor === m).map(({ title, date, person }) => ({ title, date, person }));
  return {
    recentCount: recent.length,
    afterReleaseCount: afterRelease.length,
    perDay: days,
    groups: ["0.23", "0.22"].map((m) => ({ minor: m, released: vcmp(`${m}.0`, released) <= 0, items: byMinor(m) })),
  };
}

// ---------- release ----------
function latestRelease() {
  const dir = join(DOCS, "products/release-notes");
  const files = readdirSync(dir).filter((f) => /^\d+\.\d+\.\d+\.md$/.test(f)).map((f) => f.slice(0, -3)).sort(vcmp);
  const version = files.at(-1);
  const text = readFileSync(join(dir, `${version}.md`), "utf8");
  const summary = text.split("\n").find((l, i) => i > 0 && l.trim() && !l.startsWith("#")) ?? "";
  let date = null;
  try { date = git("log", "-1", "--format=%cI", `v${version}`).trim(); } catch { /* tag 없음 */ }
  return { version, summary: clean(summary), date };
}

// ---------- 이슈 ----------
function issues() {
  const dir = join(DOCS, "issues");
  const added = addDates("project-docs/issues");
  const bulk = new Map();
  for (const d of added.values()) bulk.set(d, (bulk.get(d) ?? 0) + 1);
  const list = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".yaml")) continue;
    const doc = parse(readFileSync(join(dir, f), "utf8"));
    list.push({ ...doc, path: `project-docs/issues/${f}`, file: join(dir, f) });
  }
  const open = list.filter((i) => i.status === "open");
  for (const i of open) {
    let date = added.get(i.path) ?? null;
    let sure = true;
    if (!date) {
      date = statSync(i.file).mtime.toISOString(); // 아직 commit하지 않은 이슈
    } else if ((bulk.get(date) ?? 0) > 5) {
      // 한꺼번에 옮긴 commit: id가 처음 나온 commit을 찾는다.
      const first = git("log", "--reverse", "--format=%cI", `-S${i.id}`, "--", "project-docs").split("\n")[0];
      if (first) date = first;
      sure = (bulk.get(date) ?? 0) <= 5;
    }
    i.opened = date;
    i.openedSure = sure;
  }
  const tally = (key) => {
    const m = new Map();
    for (const i of open) m.set(i[key], (m.get(i[key]) ?? 0) + 1);
    return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  };
  const recent = [...open].sort((a, b) => Date.parse(b.opened) - Date.parse(a.opened)).slice(0, 8)
    .map((i) => ({ title: clean(i.title), kind: i.kind, topic: i.topic, opened: i.opened, sure: i.openedSure, needsPerson: Boolean(i.decide) }));
  return {
    open: open.length,
    total: list.length,
    byKind: tally("kind"),
    byTopic: tally("topic"),
    needsPerson: open.filter((i) => i.decide).length,
    recent,
  };
}

// ---------- 큰 일 대기열 ----------
function roadmap() {
  const dir = join(DOCS, "products/roadmap");
  return readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => {
    const lines = readFileSync(join(dir, f), "utf8").split("\n");
    const title = clean((lines.find((l) => l.startsWith("# ")) ?? f).replace(/^# /, ""));
    const stateLine = clean((lines.find((l) => /^상태:/.test(l)) ?? "").replace(/^상태:\s*/, ""));
    let state;
    if (/남은 일 없음|남은 것은 없/.test(stateLine) || /^(끝남|완료)/.test(stateLine)) state = "done";
    else if (/개념 정리/.test(stateLine)) state = "idea";
    else if (/^구현했다/.test(stateLine) && !/남은 native|열지 않았다/.test(stateLine)) state = "done";
    else if (/^로드맵/.test(stateLine) && !/land|만들었다|구현/.test(stateLine)) state = "waiting";
    else state = "partial";
    // 머리말(로드맵., 끝남.)을 떼고 두 문장까지.
    const body = stateLine.replace(/^(로드맵|끝남|완료|구현했다|개념 정리만 했다)[^.]*?\.\s*/, "");
    const sentences = (body.match(/[^.]+?[다음]\.(?=\s|$)/g) ?? [body])
      .map((s) => s.trim())
      .filter((s) => s.length > 12 && !/(^|\s)(은|는|의|에)?\s*다\.$|\s에 있다\.$|^[^\s]*다\.$/.test(s))
      .filter((s) => !/흐름과 지키는 것|아래 "|아래는|planner가|사람이 방향을 냈|원문과 다시/.test(s));
    const remain = sentences.filter((s) => /남은|남는|열지 않았|확인하지 않았|돌려 보는|보류/.test(s));
    const line = (remain.length ? remain : sentences).slice(0, 1).join(" ").trim();
    const last = git("log", "-1", "--format=%cI", "--", `project-docs/products/roadmap/${f}`).trim();
    return { title, state, line, lastChanged: last || null };
  });
}

const release = latestRelease();
const data = {
  collectedAt: now.toISOString(),
  version: JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version,
  release,
  plans: plans(),
  changes: changes(release.version),
  issues: issues(),
  roadmap: roadmap(),
};
mkdirSync(join(HERE, "data"), { recursive: true });
writeFileSync(join(HERE, "data/latest.json"), JSON.stringify(data, null, 1));
console.log(`plans ${data.plans.length}, open issues ${data.issues.open}, changes 7d ${data.changes.recentCount}, after ${release.version} ${data.changes.afterReleaseCount}`);
