// "내가 정한 것" artifact의 data를 모은다. 저장소는 읽기만 한다.
// 실행: node collect.mjs  → data/latest.json (4 MiB를 넘으면 data/latest-<n>.json으로 나눈다)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = "/home/pyosechang/projects/lophn";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "data");
const MAX = 4 * 1024 * 1024 - 64 * 1024;
const yaml = (await import(path.join(REPO, "node_modules/js-yaml/dist/js-yaml.mjs"))).default;

const git = (args) => {
  try {
    return execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  } catch {
    return "";
  }
};
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const DATE_RE = /20\d\d-\d\d-\d\d/;
// 결정 자신에 붙은 날짜만 쓴다: "(사람, 2026-11-05)", "(2026-10-21) ...". 글이 가리키는 옛 날짜는 쓰지 않는다.
const firstDate = (s) => {
  const t = String(s);
  const m = t.match(/\((?:\*\*)?(?:사람|agent)[^)]{0,20}?(20\d\d-\d\d-\d\d)/) || t.match(/^\s*\(?(20\d\d-\d\d-\d\d)\)?/);
  return m ? m[1] : null;
};

// ---------- 누가 정했나 ----------
function whoOf(text, fallback) {
  const m = String(text).match(/\((?:\*\*)?(사람|agent)/);
  if (m) return m[1] === "사람" ? "person" : "agent";
  if (/사람이 정했|사람이 정함|사람이 원한/.test(text)) return "person";
  return fallback;
}
const REVERSAL = /바꾼다|뒤집|되돌린다|거둔다|바뀌었다|바꿨다|되살린다|처음 정한 것을|앞서 .{0,30}정한 것/;

// ---------- 주제 ----------
const T = {
  agent: "agent 정의·호출",
  chat: "agent 대화·알림",
  coding: "coding agent·터미널",
  gui: "harness GUI",
  appsdk: "앱 SDK·command·release",
  appview: "앱 화면·자리",
  approval: "승인·권한·secret",
  model: "model·provider·구독",
  workflow: "workflow·job·event",
  browser: "artifact·browser·annotation",
  shell: "작업대 화면(탭·desk·sidebar)",
  keys: "단축키",
  look: "모양·theme·화면 규칙",
  settings: "설정",
  docs: "문서·기록 방식",
  test: "test·eval",
  platform: "platform·설치·코드 구조",
  work: "작업 방식",
  other: "기타",
};
const RULES = [
  ["gui", /harness-gui|claude-gui|\bgui\b/i],
  ["keys", /keyboard|keybinding|shortcut|단축키/i],
  ["docs", /docs-|changelog|change-log|issues?-|project-docs|records|catalog|flow-scenarios|wording|brief|plan-|install-checklist|main-queue|blueprint-renamed|remaining-eleven|issue-decisions|gallery-kit/i],
  ["test", /(^|-)(e2e|eval|test|smoke|prove)(-|$)|eval-|-e2e/i],
  ["approval", /approval|grant|secret|allow-all|permission|consent|keychain|shell-rules|권한|승인/i],
  ["model", /provider|model|subscription|oauth|chatgpt|claude-cache|cost|token|supergrok|antigravity|compact|구독/i],
  ["workflow", /workflow|(^|-)jobs?(-|$)|flow-|schedule|event|headless|(^|-)runs?(-|$)|pm-code-flow/i],
  ["browser", /artifact|browser|annotat|preview|mailto/i],
  ["coding", /coding-agent|terminal|hook|harness-catalog|handoff|app-engineer|터미널/i],
  ["appview", /app-place|tray|taskbar|float|app-panel|webview|app-view|tab-head|quick-launch|app-a2a|app-message|app-screen|app-notifies|session-lifecycle|app-session|app-reads|keep-alive|in-app-agent/i],
  ["appsdk", /activation|release|declaration|sdk|package|app-test|app-api|app-cap|publish|app-skills|app-identity|app-delete|archived-app|app-bound|domain|command-table|command-result|app-|앱/i],
  ["agent", /a2a|agent-call|agent-definition|agent-handle|team|spawn|callable|role|custom|operator|persona|memory|instructions|skill|private-workspace|agent-abstraction|agent-tab|agent-credential|lophn-agent|agents-|bare-runtime|harness-agent|carry-turn|turn|defer|tool/i],
  ["chat", /acp|chat|composer|markdown|answer|steer|session|title|inbox|notice|toast|dismiss|status|working-line/i],
  ["settings", /config|settings|설정/i],
  ["look", /appearance|theme|color|font|button|ui-kit|design|kit|wireframe|scrollbar|icon|time-picker|reading-font/i],
  ["shell", /desk|tab|split|pane|explorer|editor|window|layout|sidebar|launcher|place|workspace|project-settings|detach|left-sidebar|right-sidebar/i],
  ["platform", /platform|windows|macos|linux|deno|node|biome|install|data-root|core|standalone|socket|ipc|build|observability|log|trace|doctor|full-review|open-issues/i],
];
const MODULE_FALLBACK = [
  [/shell\//, "shell"], [/core\/apps|sdk/, "appsdk"], [/lophn-agent|agent-workspaces|router/, "agent"],
  [/coding-agent/, "coding"], [/design/, "look"], [/^tools$/, "docs"], [/^tests$/, "test"],
];
function topicByKeywords(key, modules = []) {
  for (const [t, re] of RULES) if (re.test(key)) return t;
  for (const [re, t] of MODULE_FALLBACK) if (modules.some((m) => re.test(m))) return t;
  return "other";
}
const ISSUE_TOPIC = {
  acp: "chat", activation: "appsdk", "agent-call": "agent", "agent-chat": "chat", "agent-definition": "agent",
  annotation: "browser", "app-call": "appsdk", approval: "approval", "browser-tab": "browser", "code-health": "platform",
  "coding-agent": "coding", contexts: "agent", eval: "test", event: "workflow", extension: "agent", "harness-gui": "gui",
  job: "workflow", keybindings: "keys", layers: "platform", planning: "docs", platform: "platform", problems: "appsdk",
  reuse: "appsdk", shell: "shell", "ui-kit": "look", workflow: "workflow", "workspace-layout": "shell",
  "workspace-session": "agent",
};
const ROADMAP_TOPIC = {
  "agent-browser-lifetime": "browser", "agent-platform": "agent", "agent-surface": "agent", "app-place": "appview",
  "app-sdk": "appsdk", "app-webview": "appview", approval: "approval", artifact: "browser", "browser-tab": "browser",
  "command-surface": "agent", "config-surface": "settings", "harness-config": "agent", "headless-schedule": "workflow",
  "inbox-history-sdk-migration": "chat", keybindings: "keys", mobile: "platform", "platform-ipc": "platform",
  "problem-ticket": "coding", "secret-request": "approval", "standalone-core": "platform",
  "subscription-oauth": "model", theme: "look", "tool-extension": "agent", "tool-lazy-loading": "agent",
  workflow: "workflow", "sdk-update-checkpoint": "appsdk",
};

// ---------- 판 → 날짜 ----------
function versionDates() {
  const map = new Map();
  // 옛 판마다 문서가 처음 생긴 때
  const log = git(["log", "--diff-filter=A", "--name-only", "--format=@@%cI", "--", "project-docs/products/change-log/*.md"]);
  let d = null;
  for (const line of log.split("\n")) {
    if (line.startsWith("@@")) d = line.slice(2, 12);
    else {
      const m = line.match(/change-log\/(\d+\.\d+\.\d+)\.md$/);
      if (m && d && (!map.has(m[1]) || map.get(m[1]) > d)) map.set(m[1], d);
    }
  }
  // package.json의 판이 처음 올라간 때
  const pj = git(["log", "--format=@@%cI", "-p", "--", "package.json"]);
  d = null;
  const seen = new Map();
  for (const line of pj.split("\n")) {
    if (line.startsWith("@@") && DATE_RE.test(line.slice(2, 12))) d = line.slice(2, 12);
    else {
      const m = line.match(/^\+\s*"version":\s*"([\d.]+)"/);
      if (m && d && (!seen.has(m[1]) || seen.get(m[1]) > d)) seen.set(m[1], d);
    }
  }
  for (const [v, day] of seen) if (!map.has(v)) map.set(v, day);
  return map;
}
const cmpVer = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
function dateOfVersion(map, v) {
  if (map.has(v)) return { date: map.get(v), exact: true };
  // 없으면 그보다 낮은 판 가운데 가장 가까운 것
  const lower = [...map.keys()].filter((k) => cmpVer(k, v) <= 0).sort(cmpVer);
  if (lower.length) return { date: map.get(lower[lower.length - 1]), exact: false };
  return { date: null, exact: false };
}

// ---------- 줄마다 날짜(git blame) ----------
const blameCache = new Map();
function blameDates(rel) {
  if (blameCache.has(rel)) return blameCache.get(rel);
  const out = git(["blame", "--line-porcelain", "--", rel]);
  const dates = [];
  let t = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("author-time ")) t = Number(line.slice(12));
    else if (line.startsWith("\t")) dates.push(t ? new Date(t * 1000 + 9 * 3600 * 1000).toISOString().slice(0, 10) : null);
  }
  blameCache.set(rel, dates);
  return dates;
}

const items = [];
let seq = 0;
function add(x) {
  items.push({
    n: seq++,
    text: x.text.trim(),
    by: x.by,
    topic: T[x.topic] || T.other,
    source: x.source,
    context: x.context,
    date: x.date || null,
    dateGuess: !!x.dateGuess,
    reversal: REVERSAL.test(x.text),
  });
}

// ---------- 1. change-log decisions ----------
const vmap = versionDates();
const CL = "project-docs/products/change-log";
let changeEntries = 0;
for (const v of fs.readdirSync(path.join(REPO, CL))) {
  const dir = path.join(REPO, CL, v);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".yaml")) continue;
    let y;
    try {
      y = yaml.load(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch {
      continue;
    }
    if (!y || !Array.isArray(y.decisions)) continue;
    changeEntries++;
    const { date, exact } = dateOfVersion(vmap, String(y.version || `${v}.0`));
    const topic = topicByKeywords(`${y.id} ${y.title}`, y.modules || []);
    for (const d of y.decisions) {
      if (!d || !d.text) continue;
      const by = d.by === "person" ? "person" : d.by === "agent" ? "agent" : "unmarked";
      add({ text: String(d.text), by, topic, source: "change", context: String(y.title || y.id), date: firstDate(d.text) || date, dateGuess: !firstDate(d.text) && !exact });
    }
  }
}

// ---------- 2. issues decided ----------
const ISS = "project-docs/issues";
let issueCount = 0;
for (const f of fs.readdirSync(path.join(REPO, ISS))) {
  if (!f.endsWith(".yaml")) continue;
  const rel = `${ISS}/${f}`;
  let y;
  try {
    y = yaml.load(read(rel));
  } catch {
    continue;
  }
  if (!y || !y.decided) continue;
  issueCount++;
  const text = String(y.decided);
  let date = firstDate(text);
  let guess = false;
  if (!date) {
    // 결정 글이 저장소에 처음 나타난 때(옛 md 이슈 파일 포함)
    const snippet = text.split("\n").map((s) => s.trim()).find((s) => s.length > 8) || text.trim();
    for (const len of [40, 24]) {
      const needle = [...snippet].slice(0, len).join("");
      const out = git(["log", "-S", needle, "--format=%cI", "--reverse", "--", "project-docs"]).trim();
      if (out) {
        date = out.split("\n")[0].slice(0, 10);
        break;
      }
    }
    if (!date) {
      date = git(["log", "--diff-filter=A", "--format=%cI", "--", rel]).trim().split("\n").pop()?.slice(0, 10) || null;
      guess = true;
    }
  }
  const topic = ISSUE_TOPIC[y.topic] || topicByKeywords(`${y.id} ${y.title}`, y.modules || []);
  add({ text, by: whoOf(text, "unmarked"), topic, source: "issue", context: String(y.title || y.id), date, dateGuess: guess });
}

// ---------- 3. roadmap "정한 것" ----------
const RM = "project-docs/products/roadmap";
for (const f of fs.readdirSync(path.join(REPO, RM)).filter((x) => x.endsWith(".md"))) {
  const rel = `${RM}/${f}`;
  const name = f.replace(/\.md$/, "");
  const lines = read(rel).split("\n");
  const blame = blameDates(rel);
  const title = (lines.find((l) => l.startsWith("# ")) || name).replace(/^# /, "");
  let inSec = false, secPerson = false, secDate = null, paraDate = null, cur = null;
  const flush = () => {
    if (!cur) return;
    const text = cur.lines.join("\n");
    const topic = name === "agent-platform" && /GUI/.test(text) ? "gui" : ROADMAP_TOPIC[name] || "other";
    add({
      text,
      by: whoOf(text, secPerson ? "person" : "unmarked"),
      topic,
      source: "roadmap",
      context: title,
      date: firstDate(text) || paraDate || secDate || blame[cur.at],
      dateGuess: false,
    });
    cur = null;
  };
  lines.forEach((line, i) => {
    if (/^##\s/.test(line)) {
      flush();
      inSec = /^##\s+정한 것/.test(line);
      secPerson = /\(사람/.test(line);
      secDate = (line.match(DATE_RE) || [null])[0];
      paraDate = null;
      return;
    }
    if (!inSec) return;
    if (/^(\d+\.|-)\s/.test(line)) {
      flush();
      cur = { at: i, lines: [line.replace(/^(\d+\.|-)\s+/, "")] };
    } else if (/^\s+\S/.test(line) && cur) {
      cur.lines.push(line.replace(/^\s+/, "").replace(/^(\d+\.|-)\s+/, "· "));
    } else if (line.trim() === "") {
      // 빈 줄은 항목을 끝내지 않는다(번호 목록 사이 빈 줄)
    } else {
      flush();
      const d = firstDate(line);
      if (d) paraDate = d;
    }
  });
  flush();
}

// ---------- 4. skill 안의 사람 말 ----------
const SK = ".claude/skills";
for (const s of fs.readdirSync(path.join(REPO, SK))) {
  const rel = `${SK}/${s}/SKILL.md`;
  if (!fs.existsSync(path.join(REPO, rel))) continue;
  const lines = read(rel).split("\n");
  const blame = blameDates(rel);
  let ruleSec = false;
  lines.forEach((line, i) => {
    if (/^##\s/.test(line)) {
      ruleSec = /사람이 .*정함/.test(line);
      return;
    }
    const clean = line.replace(/^\s*(\d+\.|-)\s+/, "");
    const quote = /\(사람:/.test(line);
    const stated = /사람이 정했다|사람이 원한 것은/.test(line);
    const rule = ruleSec && /^-\s/.test(line);
    if (!quote && !stated && !rule) return;
    const topic = rule ? "look" : s === "harness-gui" && /기준은 사람이 정했다/.test(line) ? "gui" : "work";
    add({ text: clean, by: "person", topic, source: "skill", context: s, date: blame[i], dateGuess: false });
  });
}

// ---------- 5. AGENT.md 정책 ----------
const agentLines = read("project-docs/products/AGENT.md").split("\n");
const policy = [];
let sec = null;
for (const line of agentLines) {
  const hm = line.match(/^(##+)\s+(.*)$/);
  if (hm) {
    const name = hm[2].replace(/^[\d.]+\s+/, "");
    if (hm[1] === "##") {
      sec = { name, decided: 0, proposed: 0, subs: [] };
      policy.push(sec);
    } else if (sec) sec.subs.push(name);
    continue;
  }
  if (!sec || !/^-\s+[A-Z]\d+\./.test(line)) continue;
  if (/제안/.test(line.replace(/^-\s+[A-Z]\d+\.\s*/, "").slice(-20)) || /\*\*제안\*\*/.test(line)) sec.proposed++;
  else sec.decided++;
}
const agentDate = git(["log", "-1", "--format=%cI", "--", "project-docs/products/AGENT.md"]).trim().slice(0, 10) || null;

// ---------- 쓰기 ----------
items.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.n - b.n);
const meta = {
  collectedAt: new Date().toISOString(),
  counts: { changeEntries, issues: issueCount },
  policy: { updated: agentDate, sections: policy.filter((p) => p.decided + p.proposed > 0) },
};
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/^latest(-\d+)?\.json$/.test(f)) fs.unlinkSync(path.join(OUT, f));
const whole = JSON.stringify({ ...meta, items });
if (Buffer.byteLength(whole) <= MAX) {
  fs.writeFileSync(path.join(OUT, "latest.json"), whole);
} else {
  const parts = [];
  let chunk = [], size = 2;
  const out = () => {
    const name = `latest-${parts.length + 1}.json`;
    fs.writeFileSync(path.join(OUT, name), JSON.stringify(chunk));
    parts.push(name);
    chunk = [];
    size = 2;
  };
  for (const it of items) {
    const s = Buffer.byteLength(JSON.stringify(it)) + 1;
    if (size + s > MAX && chunk.length) out();
    chunk.push(it);
    size += s;
  }
  if (chunk.length) out();
  fs.writeFileSync(path.join(OUT, "latest.json"), JSON.stringify({ ...meta, parts }));
}
const by = (k) => items.filter((i) => i.by === k).length;
console.log(`items ${items.length}: person ${by("person")}, agent ${by("agent")}, unmarked ${by("unmarked")}`);
