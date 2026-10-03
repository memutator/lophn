// docs/concerns.yaml과 문서 metadata를 검사한다.
// 실행: node tools/check-docs.ts [--coverage]
//
// 검사하는 것
// - concern id가 겹치지 않고, 부모가 있고, summary가 있다
// - excludes와 moved_to가 있는 concern을 가리킨다
// - entity 하나는 concern 하나만 가진다
// - docs 아래 모든 .md가 metadata(type, concerns)를 가지고, concern이 트리에 있다
// - concern 하나에 하나씩 두는 문서 종류는 경로가 docs/<type>/<concern id>.md이다

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = join(import.meta.dirname, "..");
const docsDir = join(root, "docs");

// concern 하나에 파일 하나: docs/<type>/<concern id>.md
const perConcernTypes = ["intent", "domain-model", "requirements", "spec", "architecture"];
const otherTypes = ["guide", "flow"];
const allTypes = [...perConcernTypes, ...otherTypes];

type Concern = {
  id: string;
  line: number;
  summary?: string;
  excludes: { text: string; target?: string; line: number }[];
  entities: string[];
  movedTo?: string;
};

const errors: string[] = [];
const warnings: string[] = [];

function parseList(value: string): string[] {
  const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// concerns.yaml은 이 파일이 쓰는 모양만 읽는다(평평한 목록, 필드 다섯).
function readConcerns(path: string): Concern[] {
  const lines = readFileSync(path, "utf8").split("\n");
  const concerns: Concern[] = [];
  let current: Concern | undefined;
  let inExcludes = false;
  lines.forEach((raw, i) => {
    const line = i + 1;
    if (/^\s*#/.test(raw) || raw.trim() === "") return;
    let m = raw.match(/^- id:\s*(\S+)\s*$/);
    if (m) {
      current = { id: m[1], line, excludes: [], entities: [] };
      concerns.push(current);
      inExcludes = false;
      return;
    }
    if (!current) return;
    m = raw.match(/^  (\w+):\s*(.*)$/);
    if (m) {
      const [, key, value] = m;
      inExcludes = key === "excludes";
      if (key === "summary") current.summary = value.trim();
      else if (key === "entities") current.entities = parseList(value);
      else if (key === "moved_to") current.movedTo = value.trim();
      else if (key !== "excludes") errors.push(`concerns.yaml:${line} 모르는 필드 "${key}"`);
      return;
    }
    m = raw.match(/^    - (.+)$/);
    if (m && inExcludes) {
      const text = m[1];
      const arrow = text.split("->");
      const target = arrow.length > 1 ? arrow[arrow.length - 1].trim() : undefined;
      current.excludes.push({ text, target, line });
      return;
    }
    if (/^concerns:\s*$/.test(raw)) return;
    errors.push(`concerns.yaml:${line} 읽을 수 없는 줄: ${raw.trim()}`);
  });
  return concerns;
}

function checkConcerns(concerns: Concern[]): Map<string, Concern> {
  const byId = new Map<string, Concern>();
  for (const c of concerns) {
    if (byId.has(c.id)) errors.push(`concerns.yaml:${c.line} id가 겹침: ${c.id}`);
    byId.set(c.id, c);
    if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(c.id)) {
      errors.push(`concerns.yaml:${c.line} id 모양이 틀림(소문자, 숫자, -, /): ${c.id}`);
    }
  }
  const entityOwner = new Map<string, string>();
  for (const c of concerns) {
    const parent = c.id.split("/").slice(0, -1).join("/");
    if (parent && !byId.has(parent)) errors.push(`concerns.yaml:${c.line} 부모가 없음: ${c.id}`);
    if (!c.summary && !c.movedTo) errors.push(`concerns.yaml:${c.line} summary가 없음: ${c.id}`);
    if (c.movedTo && !byId.has(c.movedTo)) {
      errors.push(`concerns.yaml:${c.line} moved_to가 없는 concern을 가리킴: ${c.movedTo}`);
    }
    for (const e of c.excludes) {
      if (!e.target) errors.push(`concerns.yaml:${e.line} excludes에 "-> concern id"가 없음`);
      else if (!byId.has(e.target)) errors.push(`concerns.yaml:${e.line} excludes가 없는 concern을 가리킴: ${e.target}`);
      else if (e.target === c.id) errors.push(`concerns.yaml:${e.line} excludes가 자기 자신을 가리킴`);
    }
    for (const entity of c.entities) {
      const owner = entityOwner.get(entity);
      if (owner) errors.push(`concerns.yaml:${c.line} entity ${entity}를 ${owner}와 ${c.id}가 함께 가짐`);
      else entityOwner.set(entity, c.id);
    }
  }
  return byId;
}

function listMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listMarkdown(p));
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

function readMetadata(path: string): Record<string, string> | undefined {
  const lines = readFileSync(path, "utf8").split("\n");
  if (lines[0] !== "---") return undefined;
  const meta: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") return meta;
    const m = lines[i].match(/^(\w+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2];
  }
  return undefined;
}

function checkDocs(byId: Map<string, Concern>): Map<string, Set<string>> {
  // type -> 문서가 있는 concern id
  const covered = new Map<string, Set<string>>();
  for (const file of listMarkdown(docsDir)) {
    const rel = relative(docsDir, file).split(sep).join("/");
    const meta = readMetadata(file);
    if (!meta) {
      errors.push(`docs/${rel} metadata가 없음`);
      continue;
    }
    const type = meta.type?.trim();
    if (!type || !allTypes.includes(type)) {
      errors.push(`docs/${rel} type이 없거나 모름: ${type ?? "(없음)"} (가능: ${allTypes.join(", ")})`);
      continue;
    }
    const ids = parseList(meta.concerns ?? "");
    if (ids.length === 0) errors.push(`docs/${rel} concerns가 비어 있음`);
    for (const id of ids) {
      const c = byId.get(id);
      if (!c) errors.push(`docs/${rel} 없는 concern: ${id}`);
      else if (c.movedTo) warnings.push(`docs/${rel} 옮겨진 concern ${id} -> ${c.movedTo}`);
    }
    if (perConcernTypes.includes(type)) {
      const expected = `${type}/${ids[0]}.md`;
      if (rel !== expected) errors.push(`docs/${rel} 경로가 첫 concern과 맞지 않음(기대: docs/${expected})`);
      if (ids.length !== 1) errors.push(`docs/${rel} ${type} 문서는 concern 하나만 가진다`);
    }
    for (const id of ids) {
      if (!covered.has(type)) covered.set(type, new Set());
      covered.get(type)!.add(id);
    }
  }
  return covered;
}

function leaves(byId: Map<string, Concern>): string[] {
  const ids = [...byId.values()].filter((c) => !c.movedTo).map((c) => c.id);
  return ids.filter((id) => !ids.some((other) => other.startsWith(id + "/")));
}

const concerns = readConcerns(join(docsDir, "concerns.yaml"));
const byId = checkConcerns(concerns);
const covered = checkDocs(byId);

if (process.argv.includes("--coverage")) {
  const leafIds = leaves(byId);
  for (const type of perConcernTypes) {
    const missing = leafIds.filter((id) => !covered.get(type)?.has(id));
    console.log(`${type}: ${leafIds.length - missing.length}/${leafIds.length}`);
    for (const id of missing) console.log(`  없음 ${id}`);
  }
}

for (const w of warnings) console.log(`경고 ${w}`);
for (const e of errors) console.log(`오류 ${e}`);
console.log(`concern ${byId.size}개, 오류 ${errors.length}개, 경고 ${warnings.length}개`);
process.exit(errors.length > 0 ? 1 : 0);
