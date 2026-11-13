// 맥락 건강 데이터를 다시 모은다. 저장소는 읽기만 한다.
// 실행: node collect.mjs   (어느 폴더에서 돌려도 된다) → data/latest.json
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = "/home/pyosechang/projects/lophn";
const PROJECT_SKILLS =
  "/home/pyosechang/.lophn/projects/prj_01m664qk6c68vbvb5br15dr7dt/skills";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RANGE = "HEAD~30..HEAD";
const DOC_BIG = 50 * 1024;
const SKILL_BIG = 20 * 1024;

const { parse: parseYaml } = createRequire(path.join(REPO, "package.json"))("yaml");
const R = (p) => path.join(REPO, p);
const exists = (p) => fs.existsSync(R(p));
const read = (p) => fs.readFileSync(R(p), "utf8");
const git = (...args) =>
  execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
const gitOk = (...args) => {
  try {
    git(...args);
    return true;
  } catch {
    return false;
  }
};
function walk(dir, test, out = []) {
  if (!fs.existsSync(R(dir))) return out;
  for (const e of fs.readdirSync(R(dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== "__pycache__" && e.name !== "node_modules") walk(p, test, out);
    } else if (test(e.name)) out.push(p);
  }
  return out;
}
const kb = (n) => Math.round(n / 1024);
const docName = (p) => p.replace(/\/$/, "");

// ── 1. 코드보다 뒤처진 조각 ──
const KIND_LABEL = { instruction: "지침", skill: "skill", doc: "문서", catalog: "catalog", tool: "tool", record: "기록", plan: "plan" };
const registry = parseYaml(read("project-docs/context-component-registry.yaml"));
const byId = new Map(registry.components.map((c) => [c.id, c]));
const review = execFileSync("node", ["tools/context-review.ts", "--range", RANGE], {
  cwd: REPO,
  encoding: "utf8",
});
const staleItems = [];
let inStale = false;
for (const line of review.split("\n")) {
  if (line.startsWith("다시 볼 조각")) { inStale = true; continue; }
  if (line.startsWith("같은 변경에서 고친")) { inStale = false; continue; }
  const m = inStale && /^\s+(\S+) \[(\w+)\] ← (.*)$/.exec(line);
  if (!m) continue;
  const [, id, kind, why] = m;
  const c = byId.get(id);
  const causes = [...new Set(why.split("; ").map((w) => {
    const b = /^boundary (\S+)/.exec(w);
    if (b) return b[1];
    const p = /^path (\S+)/.exec(w);
    return p ? docName(p[1]).split("/").pop() : w;
  }))];
  staleItems.push({
    title: c ? docName(c.path) : id,
    detail: c?.description ?? "",
    note: `바뀐 곳: ${causes.join(", ")}`,
    sub: KIND_LABEL[kind] ?? kind,
    level: kind === "instruction" ? "high" : kind === "skill" || kind === "tool" ? "medium" : "low",
  });
}
const changedFiles = /바뀐 file (\d+)/.exec(review)?.[1];

// ── 2. 낡은 참조 ──
const contextFiles = [
  "AGENTS.md",
  ...walk(".claude/skills", (n) => n.endsWith(".md")),
  ...walk("project-docs/plan", (n) => n.endsWith(".md")),
];
const rootEntries = new Set(fs.readdirSync(REPO));
const scripts = new Set(Object.keys(JSON.parse(read("package.json")).scripts ?? {}));
const hasDeno = exists("deno.json") || exists("deno.jsonc");
const worktreeNames = new Set([
  ...(exists(".claude/worktrees") ? fs.readdirSync(R(".claude/worktrees")) : []),
  ...git("worktree", "list", "--porcelain").split("\n")
    .filter((l) => l.startsWith("worktree ")).map((l) => path.basename(l.slice(9))),
]);
const missingByFile = new Map();
function note(file, kind, target) {
  if (!missingByFile.has(file)) missingByFile.set(file, []);
  const list = missingByFile.get(file);
  if (!list.some((x) => x.kind === kind && x.target === target)) list.push({ kind, target });
}
for (const file of contextFiles) {
  const text = read(file);
  for (const m of text.matchAll(/`([^`\s]+)`/g)) {
    let s = m[1].replace(/:\d+(-\d+)?$/, "").replace(/[:,.)]+$/, "").replace(/#.*$/, "");
    if (!s.includes("/") || /[<*${]/.test(s)) continue;
    if (s.startsWith("./")) s = s.slice(2);
    const top = s.split("/")[0];
    if (!rootEntries.has(top) || top === ".dev-data") continue;
    if (!exists(s)) note(file, "path", s);
  }
  if (!hasDeno) for (const m of text.matchAll(/deno (task|run) ?([a-z:-]*)/g)) note(file, "deno", m[0].trim());
  for (const m of text.matchAll(/npm run ([a-z0-9:_-]+)/g)) if (!scripts.has(m[1])) note(file, "script", m[0]);
  for (const m of text.matchAll(/`([A-Za-z0-9._-]+)` worktree/g)) if (!worktreeNames.has(m[1])) note(file, "worktree", m[1]);
}
const refItems = [];
for (const [file, list] of missingByFile) {
  const parts = [];
  const deno = list.filter((x) => x.kind === "deno");
  const script = list.filter((x) => x.kind === "script");
  const wt = list.filter((x) => x.kind === "worktree");
  const paths = list.filter((x) => x.kind === "path");
  if (deno.length) parts.push(`저장소는 npm인데 deno 명령을 씀(${deno.map((x) => x.target).join(", ")})`);
  if (script.length) parts.push(`없는 npm script(${script.map((x) => x.target).join(", ")})`);
  if (wt.length) parts.push(`없어진 worktree(${wt.map((x) => x.target).join(", ")})`);
  if (paths.length) parts.push(`없는 파일·폴더 ${paths.length}개(${paths.map((x) => x.target.split("/").filter(Boolean).pop()).join(", ")})`);
  const lead = file === "AGENTS.md" || /plan\/README\.md$/.test(file);
  refItems.push({
    title: file,
    detail: parts.join(" · "),
    level: deno.length && lead ? "high" : deno.length || script.length || wt.length ? "medium" : "low",
  });
}
// 자동 허용 설정
for (const file of [".claude/settings.json", ".claude/settings.local.json"]) {
  if (!exists(file)) continue;
  const s = JSON.parse(read(file));
  const allow = s.permissions?.allow ?? [];
  const auto = (s.autoMode?.allow ?? []).filter((x) => x !== "$defaults");
  const dead = [];
  const pathsIn = (t) => [...t.matchAll(/(?:^|[\s(=`])((?:\.dev-data|tests|tools|project-docs|packages|\.claude)\/[^\s)*`,:]+)/g)].map((m) => m[1].replace(/\/$/, ""));
  // 없어진 path는 처음 없는 자리까지만 보인다(tests/eval/run.ts → tests/eval).
  const firstMissing = (p) => {
    const parts = p.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const sub = parts.slice(0, i).join("/");
      if (!exists(sub)) return sub.startsWith(".dev-data") ? parts.at(-1) : sub;
    }
    return p;
  };
  const scan = (t) => {
    if (!hasDeno && /deno /.test(t)) dead.push("deno 명령");
    for (const p of pathsIn(t)) if (!exists(p)) dead.push(firstMissing(p));
  };
  allow.forEach(scan);
  let cost = false;
  for (const t of auto) {
    if (/\$\s?\d+/.test(t) && /API|provider|model|eval/i.test(t)) cost = true;
    scan(t);
  }
  const uniq = [...new Set(dead)];
  if (!uniq.length && !cost) continue;
  const parts = [];
  if (uniq.length) parts.push(`자동 허용이 없어진 대상을 가리킴(${uniq.join(", ")})`);
  if (cost) {
    const max = Math.max(...auto.flatMap((t) => [...t.matchAll(/\$\s?(\d+)/g)].map((m) => Number(m[1]))));
    parts.push(`실제 provider 호출 비용 허락 줄이 남음(최대 $${max})`);
  }
  refItems.push({ title: file, detail: parts.join(" · "), level: cost ? "high" : "medium" });
}
const LEVEL_ORDER = { high: 0, medium: 1, low: 2, info: 3 };
refItems.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

// ── 3. 막는 장치가 이어지지 않은 실수 ──
const has = (file, re) => exists(file) && re.test(read(file));
const anyHas = (files, re) => files.some((f) => has(f, re));
const orchestrate = walk(".claude/skills/orchestrate", (n) => n.endsWith(".md"));
// 이슈마다 prevent가 말한 장치를 찾는 검사. 새 이슈는 검사가 없어 "자동 확인 없음"이 된다.
const PROBES = {
  "plan-reference-shape-unchecked-in-review": [
    ["planner-persona skill에 본보기 대조 문장", () => has(".claude/skills/planner-persona/SKILL.md", /본보기/)],
    ["orchestrate review 표에 본보기 대조 칸", () => has(".claude/skills/orchestrate/SKILL.md", /^\|[^\n]*본보기/m)],
  ],
  "app-dispatch-returns-wrong-tool-name": [
    ["wire 이름으로 찾는 test", () => has("packages/core/lophn-agent/tools/app-public_test.ts", /toolForWireName/)],
    ["brief 위험 test에 '입력부터 실행기까지 이어 본다'", () => anyHas([...orchestrate, ".claude/skills/write-test/SKILL.md"], /실행기까지/)],
  ],
  "sdk-bump-leaves-workspace-pin": [
    ["check deps 단계의 @lophn 판 일치 검사", () => anyHas(["tools/check-deps.ts", "tools/deps-workspace.ts"], /\.version\b|["']version["']/)],
    ["판 올림 끝남에 옛 판 grep(sdk-note skill)", () => has(".claude/skills/sdk-note/SKILL.md", /tools\/wireframes\/package\.json/)],
  ],
  "terminal-gui-opens-installed-app": [
    ["terminal-agent 문서 '지키는 것' 문장", () => has("project-docs/architecture/terminal-agent.md", /CLI 경로와 data root를 shell main에서 받는다/)],
    // launcher는 LOPHN_HOME이 없으면 ~/.lophn을 잡는다. 그 경우 멈추는 줄이 있는지 본다.
    ["개발 실행이 실제 data root(~/.lophn)면 앱을 띄우지 않음", () => anyHas(["packages/base/install/linux-install.ts", "packages/cli/main.ts"], /\.lophn[^\n]*(exit [1-9]|refuse|거절|띄우지 않)/)],
  ],
  "app-view-opened-without-release": [
    ["live 열기에 판 필수(schema)", () => has("packages/shell/ipc/app-frame.ts", /discriminatedUnion\(\s*"mode"/)],
    ["orchestrate review 표에 진짜 Electron 확인", () => has(".claude/skills/orchestrate/SKILL.md", /^\|[^\n]*진짜 Electron/m)],
  ],
};
const UNSURE = {
  "terminal-gui-opens-installed-app": "문서 문장은 들어갔다. 막는 장치는 찾지 못했지만, gui 요청이 이제 탭으로 바로 가서 data root를 쓰지 않으므로 필요 없어졌을 수도 있다(확실하지 않음).",
  "sdk-bump-leaves-workspace-pin": "판 올림 grep은 sdk-note skill의 문장으로 있다. check로 막는다는 부분은 찾지 못했다.",
};
const mistakeItems = [];
for (const f of walk("project-docs/issues", (n) => n.endsWith(".yaml"))) {
  const issue = parseYaml(read(f));
  if (issue?.kind !== "mistake" || issue.status !== "open") continue;
  const probes = PROBES[issue.id];
  const checks = probes ? probes.map(([label, fn]) => ({ label, ok: fn() })) : [];
  const done = checks.filter((c) => c.ok).length;
  const state = !probes ? "unknown" : done === checks.length ? "done" : done === 0 ? "missing" : "partial";
  mistakeItems.push({
    title: issue.title,
    checks,
    state,
    note: UNSURE[issue.id] ?? (state === "done" ? "막는 장치는 모두 있는데 이슈가 아직 열려 있다." : state === "unknown" ? "자동 확인 없음" : ""),
    level: state === "missing" ? "high" : state === "partial" ? "medium" : state === "unknown" ? "medium" : "info",
  });
}
mistakeItems.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

// ── 4. 끝났는데 남은 plan ──
const planItems = [];
for (const name of fs.readdirSync(R("project-docs/plan"))) {
  const dir = `project-docs/plan/${name}`;
  if (name === "tools" || !fs.statSync(R(dir)).isDirectory()) continue;
  const last = git("log", "-1", "--format=%cs", "--", dir);
  if (exists(`${dir}/status.md`)) {
    const rows = read(`${dir}/status.md`).split("\n").filter((l) => /^\| `/.test(l));
    const states = rows.map((l) => l.split("|")[5]?.trim());
    const merged = states.filter((s) => s === "merged").length;
    if (rows.length && merged === rows.length) {
      planItems.push({ title: name, detail: `task ${rows.length}개가 모두 합쳐졌는데 계획 폴더가 남아 있다.`, note: `마지막 변경 ${last}`, level: "medium" });
    }
    continue;
  }
  const readme = exists(`${dir}/README.md`) ? read(`${dir}/README.md`) : "";
  const branch = /branch: `([^`]+)`/.exec(readme)?.[1];
  const gone = branch && !gitOk("rev-parse", "--verify", "-q", branch);
  const missing = (missingByFile.get(`${dir}/README.md`) ?? []).length;
  const bits = ["상태표가 없어 끝났는지 확실하지 않다"];
  if (gone) bits.push(`작업 branch(${branch})가 없어졌다`);
  if (missing) bits.push(`없어진 파일·폴더 ${missing}개를 가리킨다`);
  if (gone || missing) planItems.push({ title: name, detail: bits.join(" · "), note: `마지막 변경 ${last}`, level: "low", unsure: true });
}

// ── 5. 너무 커진 문서 ──
const sizeItems = [];
for (const f of walk("project-docs/architecture", (n) => n.endsWith(".md"))) {
  const n = fs.statSync(R(f)).size;
  if (n >= DOC_BIG) sizeItems.push({ title: f, size: kb(n), sub: "설계 문서", level: n >= 100 * 1024 ? "high" : "medium" });
}
for (const f of [...walk(".claude/skills", (n) => n.endsWith(".md")), "AGENTS.md"]) {
  const n = fs.statSync(R(f)).size;
  if (n >= SKILL_BIG) sizeItems.push({ title: f, size: kb(n), sub: f === "AGENTS.md" ? "지침" : "skill", level: "medium" });
}
sizeItems.sort((a, b) => b.size - a.size);
for (const s of sizeItems) s.detail = `${s.size} KB · 읽을 때 대략 ${Math.round((s.size * 1024) / 3 / 1000)}k 글자`;

// ── 6. 다른 harness가 못 받는 맥락 ──
const reachItems = [];
const claudeSkills = exists(".claude/skills") ? fs.readdirSync(R(".claude/skills")).filter((n) => exists(`.claude/skills/${n}/SKILL.md`)) : [];
const agentsSkills = exists(".agents/skills");
if (claudeSkills.length && !agentsSkills) {
  reachItems.push({
    title: `저장소 skill ${claudeSkills.length}개는 Claude Code 자리에만 있다`,
    detail: `${claudeSkills.join(", ")}. Codex가 읽는 공용 자리(.agents/skills)는 없다. OpenCode는 이 자리도 읽는다는 조사 기록이 있다.`,
    level: "high",
  });
}
const projSkills = fs.existsSync(PROJECT_SKILLS) ? fs.readdirSync(PROJECT_SKILLS).filter((n) => fs.existsSync(path.join(PROJECT_SKILLS, n, "SKILL.md"))) : [];
if (!projSkills.length) {
  reachItems.push({ title: "lophn project의 Skills 폴더가 비어 있다", detail: "이 project에서 일하는 lophn agent는 위 skill을 하나도 받지 못한다.", level: "medium" });
}
if (!exists("LOPHN.md")) {
  reachItems.push({ title: "lophn agent용 지침 파일이 저장소에 없다", detail: "lophn agent는 AGENTS.md 대신 LOPHN.md를 읽는다. 저장소 지침(끝남 기준, 코드 규칙)이 lophn agent에게 실리지 않는다.", level: "medium" });
}
const settingsOnly = [".claude/settings.json", ".claude/settings.local.json"].filter(exists);
if (settingsOnly.length) {
  reachItems.push({ title: "자동 허용 규칙도 Claude Code 설정에만 있다", detail: "다른 harness는 같은 명령을 다시 묻거나 다른 기준으로 허락한다.", level: "low" });
}

// ── 쓰기 ──
const groups = [
  { id: "stale", title: "코드보다 뒤처진 조각", lead: `최근 commit 30개(파일 ${changedFiles ?? "?"}개 변경)에서 기대는 코드가 바뀌었는데 같이 고치지 않은 맥락`, items: staleItems, subOrder: ["지침", "skill", "tool", "catalog", "문서"] },
  { id: "refs", title: "낡은 참조", lead: "없어진 파일·명령·worktree를 가리키는 지침과 설정", items: refItems },
  { id: "mistakes", title: "막는 장치가 이어지지 않은 실수", lead: "열린 실수 기록마다 다시 막겠다고 한 장치가 실제로 있는지", items: mistakeItems },
  { id: "plans", title: "끝났는데 남은 plan", lead: "agent가 진행 중인 계획으로 읽을 수 있는 폴더", items: planItems },
  { id: "size", title: "너무 커진 문서", lead: `설계 문서 ${kb(DOC_BIG)} KB, skill·지침 ${kb(SKILL_BIG)} KB 이상`, items: sizeItems },
  { id: "reach", title: "다른 harness가 못 받는 맥락", lead: "한 harness 자리에만 있어 다른 agent에게 실리지 않는 맥락", items: reachItems },
];
// 사람이 먼저 볼 것: 문제 수(정보성 제외)
for (const g of groups) g.count = g.items.filter((i) => i.level !== "info").length;

const out = {
  collectedAt: new Date().toISOString(),
  commit: git("log", "-1", "--format=%h %cs"),
  groups,
};
fs.mkdirSync(path.join(HERE, "data"), { recursive: true });
fs.writeFileSync(path.join(HERE, "data/latest.json"), JSON.stringify(out, null, 2));
console.log(groups.map((g) => `${g.id}: ${g.count}/${g.items.length}`).join("\n"));
