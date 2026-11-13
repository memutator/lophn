// 결정 대기함: 저장소를 읽어 사람이 정할 것을 모으고 data/latest.json을 쓴다.
// 저장소는 읽기만 한다. 실행: node collect.mjs [--hashes]
// --hashes: 항목마다 원문 지문(basis)을 출력한다. overrides.json의 요약이 원문과 맞는지 보는 데 쓴다.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = "/home/pyosechang/projects/lophn";
const DOCS = join(REPO, "project-docs");
const YAML = createRequire(join(REPO, "package.json"))("yaml");

const read = (p) => readFileSync(p, "utf8");
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
// 화면에 path·명령 모양을 펼치지 않는다: backtick 글은 남기되 기호를 뗀다. 파일 이름은 "(스크린샷)" 같은 말로 바꾼다.
const plain = (s) =>
  String(s ?? "")
    .replace(/\S+\.(png|jpe?g|gif|webp)\b/gi, "(스크린샷)")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
const firstSentences = (s, n) => {
  const parts = plain(s).split(/(?<=[.다])\s+/);
  return parts.slice(0, n).join(" ");
};

// markdown에서 제목이 match에 맞는 절의 본문(다음 같은 층 이상 제목 전까지)
function sections(md, match) {
  const lines = md.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{2,3}) (.*)$/.exec(lines[i]);
    if (!m || !match.test(m[2])) continue;
    const level = m[1].length;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const n = /^(#{1,6}) /.exec(lines[j]);
      if (n && n[1].length <= level) break;
      body.push(lines[j]);
    }
    out.push({ heading: m[2], body: body.join("\n") });
  }
  return out;
}
const bullets = (text) =>
  text.split("\n").filter((l) => /^\s*[-*] /.test(l)).map((l) => plain(l.replace(/^\s*[-*] /, "")));

const items = [];
const add = (it) => items.push({ details: [], note: null, recommend: null, ...it });

// 1. 이슈: status open이고 decide가 있는 것
for (const f of readdirSync(join(DOCS, "issues")).filter((f) => f.endsWith(".yaml")).sort()) {
  const doc = YAML.parse(read(join(DOCS, "issues", f)));
  if (doc?.status !== "open" || !doc.decide) continue;
  const rec = plain(doc.decide).match(/추천[^.]*\./)?.[0] ??
    plain(doc.fix).split(/(?=\s\d\.\s|\s-\s)/).find((l) => l.includes("추천")) ?? null;
  add({
    key: `issue:${doc.id}`,
    kind: "이슈",
    basis: hash(doc.decide + doc.fix + doc.impact),
    question: firstSentences(doc.decide.replace(/^\s*-\s*/, ""), 1),
    why: firstSentences(doc.impact, 2),
    recommend: rec ? plain(rec) : null,
    subject: plain(doc.title),
  });
}

// 2. 정책 제안: AGENT.md에서 "제안)"으로 끝나는 줄. 한 묶음으로 보이고 줄은 자세히에 둔다.
{
  const md = read(join(DOCS, "products", "AGENT.md"));
  const groups = new Map();
  let where = "";
  const WHERE = { home: "Home", app: "앱", project: "project", "어느 workspace든": "모든 workspace" };
  for (const line of md.split("\n")) {
    const h = /^### (.*)$/.exec(line);
    if (h) where = WHERE[h[1].trim()] ?? h[1].trim();
    const m = /^- [A-Z]+\d+\. (.*)\((?:[^()]*)제안\)\s*$/.exec(line);
    if (!m) continue;
    const partial = !/\(제안\)\s*$/.test(line);
    const text = plain(m[1]) + (partial ? ` (${plain(line.match(/\(([^()]*제안)\)\s*$/)[1])})` : "");
    if (!groups.has(where)) groups.set(where, []);
    groups.get(where).push(text);
  }
  const all = [...groups.values()].flat();
  if (all.length) {
    add({
      key: "policy",
      kind: "정책 제안",
      basis: hash(all.join("\n")),
      question: `agent 정책 제안 ${all.length}줄을 정한 것으로 받을지`,
      why: "agent가 쓴 정책 줄이라 사람이 확인하기 전까지 '제안'으로 남아 있다.",
      policyLines: all.length,
      details: [...groups].map(([heading, lines]) => ({ heading: `${heading}에서 일할 때`, lines })),
    });
  }
}

// 3. 계획 확인: plan/<계획>/README.md
const gitHas = (ref) => {
  try { execFileSync("git", ["-C", REPO, "rev-parse", "--verify", "--quiet", ref], { stdio: "ignore" }); return true; }
  catch { return false; }
};
for (const name of readdirSync(join(DOCS, "plan")).sort()) {
  const readme = join(DOCS, "plan", name, "README.md");
  if (!existsSync(readme)) continue;
  const md = read(readme);
  const details = [];
  const facts = [];
  for (const s of sections(md, /^(사람이 정할 것|남은 것)/)) {
    // 문단(빈 줄로 나뉨)마다: 글 줄이 머리, 이어지는 bullet이 항목
    let head = s.heading;
    for (const para of s.body.split(/\n\s*\n/)) {
      const text = para.split("\n").find((l) => l.trim() && !/^\s*[-*] /.test(l));
      if (text) head = plain(text);
      const lines = bullets(para);
      if (lines.length) details.push({ heading: head.replace(/[:.]$/, ""), lines });
    }
  }
  for (const s of sections(md, /^사람이 정한 것/)) {
    for (const l of s.body.split("\n")) if (/보류/.test(l) && /^\d+\./.test(l.trim())) facts.push(plain(l.replace(/^\s*\d+\.\s*/, "")));
  }
  const askHuman = md.split("\n").filter((l) => /^- 사람에게:/.test(l)).map((l) => plain(l.replace(/^- 사람에게:\s*/, "")));
  let allMerged = false;
  const status = join(DOCS, "plan", name, "status.md");
  if (existsSync(status)) {
    const rows = read(status).split("\n").filter((l) => /^\| `/.test(l));
    allMerged = rows.length > 0 && rows.every((l) => l.split("|")[5]?.trim() === "merged");
  }
  const branch = /^- branch: `([^`]+)`/m.exec(md)?.[1];
  const branchGone = branch ? !gitHas(`refs/heads/${branch}`) : false;
  if (!details.length && !facts.length && !askHuman.length && !allMerged) continue;
  if (askHuman.length) details.push({ heading: "끝난 뒤 사람이 볼 것", lines: askHuman });
  if (facts.length) details.push({ heading: "사람이 보류한 것", lines: facts });
  add({
    key: `plan:${name}`,
    kind: "계획 확인",
    basis: hash(details.map((d) => d.lines.join("\n")).join("\n") + allMerged + branchGone),
    question: allMerged ? `계획 ${name}: 작업이 모두 합쳐졌는데 폴더가 남아 있다. 닫을지` : `계획 ${name}에 사람 몫이 남아 있다`,
    why: plain(/^- 목표: (.*)$/m.exec(md)?.[1] ?? ""),
    subject: name,
    details,
    facts: { allMerged, branchGone },
  });
}

// 4. 로드맵: "정할 것" 절이 아직 열려 있는 것, 그리고 상태 줄의 "사람 확인이 남은 것"
// 제목이나 첫 문단에 이 말이 있으면 이미 정했거나 agent가 근거로 정하는 것이다.
const DONE = /정했다|정함|정한 것에서|추천안으로|추천대로|하지 않는다|근거로 정한다/;
for (const f of readdirSync(join(DOCS, "products", "roadmap")).filter((f) => f.endsWith(".md")).sort()) {
  const md = read(join(DOCS, "products", "roadmap", f));
  const name = f.replace(/\.md$/, "");
  const statusLine = /^상태: (.*)$/m.exec(md)?.[1] ?? "";
  const open = [];
  for (const s of sections(md, /정할 것/)) {
    if (DONE.test(s.heading) || /정할 것.*(정했다|추천안으로 정했다)/.test(statusLine)) continue;
    const heads = [...s.body.matchAll(/^### (.*)$/gm)].map((m) => m[1]);
    const numbered = [...s.body.matchAll(/^\d+\. \*\*(.*?)\*\*/gm)].map((m) => m[1]);
    if (heads.length) { for (const h of heads) if (!DONE.test(h)) open.push(plain(h)); }
    else if (!DONE.test(s.body.trim().split("\n\n")[0] ?? "")) open.push(...numbered.map(plain));
  }
  const check = /사람 확인이 남은 것: (.*?\.)(?=\s|$)/.exec(statusLine)?.[1];
  if (!open.length && !check) continue;
  const title = plain(/^# (.*)$/m.exec(md)?.[1] ?? name);
  const details = [];
  if (open.length) details.push({ heading: "아직 정하지 않은 것", lines: open });
  if (check) details.push({ heading: "사람 확인이 남은 것", lines: plain(check).replace(/\.$/, "").split(/,\s*/) });
  add({
    key: `roadmap:${name}`,
    kind: "계획 확인",
    basis: hash(open.join("\n") + (check ?? "")),
    question: open.length ? `${title}: 정할 것 ${open.length}가지` : `${title}: 사람 확인`,
    why: firstSentences(statusLine, 1),
    subject: title,
    details,
  });
}

// 5. 메모: 저장소 맨 위 issue.md (아직 이슈로 올리지 않은 것)
{
  const p = join(REPO, "issue.md");
  if (existsSync(p)) {
    const md = read(p);
    const details = [];
    let cur = null;
    let topic = "";
    for (const raw of md.split("\n")) {
      const h = /^\s*(#+)\s+(.*)$/.exec(raw);
      if (h && h[1].length === 1) { topic = h[2].trim(); continue; }
      if (h) { cur = { heading: h[2].trim() === "전역" ? "공통" : h[2].trim(), lines: [] }; details.push(cur); continue; }
      const b = /^\s*-\s+(.*\S)\s*,?$/.exec(raw);
      if (b && cur) cur.lines.push(plain(b[1]).replace(/[,;]$/, ""));
    }
    const lines = details.flatMap((d) => d.lines);
    if (lines.length) {
      add({
        key: "memo",
        kind: "메모",
        basis: hash(lines.join("\n")),
        question: `${topic || "메모"} 메모 ${lines.length}줄을 이슈로 올릴지`,
        why: "저장소에 적어 둔 메모로, 아직 이슈가 아니라 맡은 사람이 없다.",
        details: details.filter((d) => d.lines.length),
      });
    }
  }
}

// 요약 덮어쓰기: overrides.json의 사람 말 요약은 원문 지문(basis)이 같을 때만 쓴다.
const overrides = JSON.parse(read(join(HERE, "overrides.json")));
const RANK = { 급함: 0, 보통: 1, 낮음: 2 };
const out = items.map((it) => {
  const o = overrides[it.key];
  if (o && o.basis === it.basis) {
    const { basis: _b, ...rest } = o;
    return { ...it, ...rest, details: rest.details ?? it.details, stale: false };
  }
  return { ...it, priority: o?.priority ?? "보통", urgency: o?.urgency ?? null, stale: Boolean(o) };
});
out.sort((a, b) => RANK[a.priority] - RANK[b.priority]);

if (process.argv.includes("--hashes")) {
  for (const it of out) console.log(it.key, it.basis, it.stale ? "STALE" : "");
}

const data = {
  collectedAt: new Date().toISOString(),
  counts: {
    total: out.length,
    urgent: out.filter((i) => i.priority === "급함").length,
    policyLines: out.find((i) => i.key === "policy")?.policyLines ?? 0,
    stale: out.filter((i) => i.stale).length,
  },
  items: out.map(({ basis: _b, facts: _f, ...rest }) => rest),
};
mkdirSync(join(HERE, "data"), { recursive: true });
writeFileSync(join(HERE, "data", "latest.json"), JSON.stringify(data, null, 2));
console.log(`items ${out.length}, urgent ${data.counts.urgent}, stale ${data.counts.stale}`);
