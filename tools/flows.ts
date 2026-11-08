// flow catalog 도구. 실행: node tools/flows.ts <entries|index|check|report|sample> [옵션]
// catalog는 project-docs/flows/. 규칙은 그 폴더의 README.md.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse, stringify } from "yaml";

type Obj = Record<string, unknown>;
type Entry = {
  id: string;
  kind: string;
  defined_in: string;
  area: string;
  accounted_by: string;
};
type Issue = { file: string; text: string; also?: string };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FLOWS = "project-docs/flows";
const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ENTRY_REF = /^(route|cli|tool|key|ipc|sdk|skill|control|system|ui):/;
const MANUAL = /^(system|ui):[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ACTORS = ["person", "agent", "coding-agent", "app", "shell", "system"];
const JOURNEY_ACTORS = ["person", "agent", "coding-agent"];
const CODES = [
  "invalid_input",
  "not_found",
  "forbidden",
  "unauthorized",
  "conflict",
  "unavailable",
  "internal",
];
const RISKS = ["data-loss", "permission", "secret", "sandbox", "twice-fixed"];
const OBSERVE = [
  "disk:",
  "ledger:",
  "event:",
  "request:",
  "process:",
  "screen:",
  "log:",
];
const FLOW_KEYS = [
  "id",
  "title",
  "actor",
  "entries",
  "uses",
  "pre",
  "when",
  "boundary",
  "code",
  "steps",
  "outcomes",
  "crosses_process",
  "risk",
  "refs",
  "docs",
  "unclear",
];
const OUTCOME_KEYS = ["id", "code", "when", "observe"];
const LAYERS = ["core-e2e", "harness-loop", "harness-wire", "live", "unit"];

// ---- 바탕 도구 ----

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const asObj = (value: unknown): Obj =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : {};
const strings = (value: unknown): string[] =>
  asArray(value).filter((v): v is string => typeof v === "string");

function git(args: string[]): string[] {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

const texts = new Map<string, string>();
function text(file: string): string {
  let found = texts.get(file);
  if (found === undefined) {
    found = readFileSync(`${ROOT}/${file}`, "utf8");
    texts.set(file, found);
  }
  return found;
}

function yamlOf(file: string): Obj {
  return asObj(parse(readFileSync(`${ROOT}/${file}`, "utf8")));
}

function yamlFiles(dir: string): string[] {
  if (!existsSync(`${ROOT}/${dir}`)) return [];
  return readdirSync(`${ROOT}/${dir}`)
    .filter((n) => n.endsWith(".yaml"))
    .sort()
    .map((n) => `${dir}/${n}`);
}

const isTest = (file: string) => file.endsWith("_test.ts");

// 앞이 같은 path 가운데 가장 긴 것. 끝이 /이면 폴더, 아니면 file 하나다.
function longestPrefix(file: string, prefixes: string[]): string | undefined {
  let best: string | undefined;
  for (const p of prefixes) {
    const hit = p.endsWith("/") ? file.startsWith(p) : file === p;
    if (hit && (best === undefined || p.length > best.length)) best = p;
  }
  return best;
}

// 주석 줄을 지워 주석 속 export가 안 잡히게 한다.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// ---- code에서 entry 뽑기 ----

type Raw = { id: string; kind: string; defined_in: string };

const ROUTE_CALL =
  /\b(?:defineRead|defineCommand|defineMemory|defineFile|defineUpload)\s*(?:<[^()]*>)?\s*\(\s*\{/g;

// 같은 route ID를 두 곳이 정의하면 기동 때 겹침 오류가 난다. 도구는 첫 정의만 세고 겹침을 따로 돌려준다.
type Duplicate = { id: string; first: string; second: string };

function routeEntries(files: string[], dupes: Duplicate[]): Raw[] {
  const found: Raw[] = [];
  const seen = new Map<string, string>();
  for (const file of files) {
    if (!/^packages\/(protocol|core)\//.test(file)) continue;
    const source = text(file);
    const starts = [...source.matchAll(ROUTE_CALL)].map((m) => m.index ?? 0);
    for (const [i, start] of starts.entries()) {
      // 다음 호출 앞까지만 본다. resource가 literal이 아닌 호출이 이웃의 값을 가져가지 않게 한다.
      const window = source.slice(start, starts[i + 1] ?? source.length);
      const resource = /\bresource:\s*"([^"]+)"/.exec(window)?.[1];
      const method = /\bmethod:\s*"([^"]+)"/.exec(window)?.[1];
      if (!resource || !method) {
        throw new Error(`${file}: route의 resource·method를 literal로 못 읽음`);
      }
      const id = `route:${resource}/${method}`;
      const before = seen.get(id);
      if (before) {
        dupes.push({ id, first: before, second: file });
        continue;
      }
      seen.set(id, file);
      found.push({ id, kind: "route", defined_in: file });
    }
  }
  return found;
}

function cliEntries(files: string[]): Raw[] {
  const found: Raw[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (
      !/^packages\/(cli|coding-agent)\/.+\.ts$/.test(file) ||
      isTest(file) ||
      file.endsWith("/types.ts")
    ) {
      continue;
    }
    for (const m of text(file).matchAll(/\bname:\s*"([^"]+)",\s*summary:/g)) {
      const id = `cli:${m[1]}`;
      if (seen.has(id)) throw new Error(`cli ID가 겹침: ${id} (${file})`);
      seen.add(id);
      found.push({ id, kind: "cli", defined_in: file });
    }
  }
  return found;
}

function toolEntries(files: string[]): Raw[] {
  const found: Raw[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (!file.startsWith("packages/") || isTest(file)) continue;
    for (const m of text(file).matchAll(
      /\bdefineTool\s*(?:<[^()]*>)?\s*\(\s*\{\s*name:\s*"([a-z][a-z0-9._-]*)"/g,
    )) {
      const id = `tool:${m[1]}`;
      if (seen.has(id)) throw new Error(`tool ID가 겹침: ${id} (${file})`);
      seen.add(id);
      found.push({ id, kind: "tool", defined_in: file });
    }
  }
  return found;
}

const KEYBINDINGS = "packages/shell/ipc/keybindings.ts";

function keyEntries(): Raw[] {
  const body = /export type Command =([^;]*);/.exec(text(KEYBINDINGS))?.[1];
  if (!body) throw new Error(`${KEYBINDINGS}: Command union을 못 읽음`);
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => ({
    id: `key:${m[1]}`,
    kind: "key",
    defined_in: KEYBINDINGS,
  }));
}

function ipcEntries(files: string[]): Raw[] {
  const found: Raw[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (!/^packages\/shell\/ipc\/[^/]+\.ts$/.test(file) || isTest(file)) {
      continue;
    }
    for (const m of text(file).matchAll(
      /export const [A-Z0-9_]*_CHANNEL\s*=\s*"([^"]+)"/g,
    )) {
      const id = `ipc:${m[1]}`;
      if (seen.has(id)) continue;
      seen.add(id);
      found.push({ id, kind: "ipc", defined_in: file });
    }
  }
  return found;
}

// package의 mod.ts에서 runtime export를 따라간다. type만 내보내는 것은 뺀다.
function sdkExports(
  pkg: string,
  file: string,
  visited: Set<string>,
  into: Map<string, string>,
) {
  if (visited.has(file)) return;
  visited.add(file);
  const source = stripComments(text(file));
  const here = dirname(file);
  const target = (spec: string) => {
    if (!spec.startsWith(".")) return undefined;
    const path = relative(ROOT, resolve(ROOT, here, spec));
    return [path, `${path}.ts`, `${path}.tsx`, `${path}/mod.ts`].find(
      (p) => existsSync(`${ROOT}/${p}`) && /\.tsx?$/.test(p),
    );
  };
  for (const m of source.matchAll(/export\s+\*\s+from\s+"([^"]+)"/g)) {
    const next = target(m[1] ?? "");
    if (next) sdkExports(pkg, next, visited, into);
  }
  for (const m of source.matchAll(
    /export\s*\{([^}]*)\}\s*(?:from\s*"([^"]+)")?/g,
  )) {
    const from = m[2] === undefined ? file : (target(m[2]) ?? file);
    for (const part of (m[1] ?? "").split(",")) {
      const item = part.trim();
      if (!item || /^type\s/.test(item)) continue;
      const name = item
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) into.set(name, from);
    }
  }
  for (const m of source.matchAll(
    /^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|enum)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    if (m[1]) into.set(m[1], file);
  }
  for (const m of source.matchAll(/^export\s+default\b/gm)) {
    if (m) into.set("default", file);
  }
}

function sdkEntries(): Raw[] {
  const found: Raw[] = [];
  const base = `${ROOT}/packages/sdk`;
  for (const pkg of readdirSync(base).sort()) {
    const mod = `packages/sdk/${pkg}/mod.ts`;
    if (!existsSync(`${ROOT}/${mod}`)) continue;
    const names = new Map<string, string>();
    sdkExports(pkg, mod, new Set(), names);
    for (const [name, file] of [...names].sort()) {
      // protocol에서 다시 내보낸 것도 SDK 표면이라 sdk area에 들게 mod.ts를 자리로 둔다.
      const at = file.startsWith("packages/sdk/") ? file : mod;
      found.push({ id: `sdk:${pkg}/${name}`, kind: "sdk", defined_in: at });
    }
  }
  return found;
}

function skillEntries(): Raw[] {
  const dir = "packages/core/agent-workspaces/skills";
  return readdirSync(`${ROOT}/${dir}`, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((name) => ({
      id: `skill:${name}`,
      kind: "skill",
      defined_in: `${dir}/${name}/`,
    }));
}

// 요청 schema를 import해서 union을 걷는다. 진단 요청처럼 다른 파일 schema가 섞여 있어서 text로는 못 읽는다.
async function controlEntries(): Promise<Raw[]> {
  const file = "packages/protocol/supervision/core-control.ts";
  const mod = (await import(pathToFileURL(`${ROOT}/${file}`).href)) as Obj;
  const types = new Set<string>();
  const walk = (schema: unknown) => {
    const node = asObj(schema);
    if (Array.isArray(node.options)) {
      for (const option of node.options) walk(option);
      return;
    }
    const type = asObj(asObj(asObj(node.shape).type).def);
    const values = asArray(type.values);
    if (values.length === 0) {
      throw new Error(`${file}: control 요청의 type을 못 읽음`);
    }
    for (const v of values) types.add(String(v));
  };
  walk(mod.controlRequestSchema);
  return [...types].sort().map((t) => ({
    id: `control:${t}`,
    kind: "control",
    defined_in: file,
  }));
}

function eventNames(files: string[]): string[] {
  const names = new Set<string>();
  for (const file of files) {
    if (!file.startsWith("packages/protocol/") || isTest(file)) continue;
    for (const m of text(file).matchAll(
      /\bdefine(?:Agent|Transient)?Event\s*(?:<[^()]*>)?\(\s*"([A-Z][A-Za-z0-9]*)"/g,
    )) {
      if (m[1]) names.add(m[1]);
    }
  }
  return [...names].sort();
}

// wireframe page id. frame의 `?frame=<id>`가 이것이다. area도 id가 있어서 뒤따르는 칸(description)으로 가른다.
function frameIds(files: string[]): string[] {
  const ids = new Set<string>();
  for (const file of files) {
    if (!/^tools\/wireframes\/.+\.tsx?$/.test(file)) continue;
    for (const m of text(file).matchAll(
      /\bid:\s*"([^"]+)",\s*title:\s*(?:"(?:[^"\\]|\\.)*"|'[^']*'|`[^`]*`)\s*,\s*description:/g,
    )) {
      if (m[1]) ids.add(m[1]);
    }
  }
  return [...ids].sort();
}

// ---- catalog 읽기 ----

type Catalog = {
  areas: Obj[];
  areaIds: string[];
  areaFiles: { file: string; data: Obj }[];
  journeyFiles: { file: string; data: Obj }[];
  testFiles: { file: string; data: Obj }[];
  broken: { file: string; message: string }[];
  testGroups: Obj[];
  journeyGroups: Obj[];
  entries: Entry[];
  events: string[];
  frames: string[];
  boundaries: Set<string>;
  agentLines: Set<string>;
  archDocs: string[];
  tracked: string[];
  testsTracked: string[];
  routeDuplicates: Duplicate[];
  owners: Map<string, string>;
  duplicates: { id: string; first: string; second: string; file: string }[];
};

function boundaryIds(): Set<string> {
  const ids = new Set<string>();
  const visit = (list: unknown) => {
    for (const node of asArray(list)) {
      const n = asObj(node);
      if (typeof n.id === "string") ids.add(n.id);
      visit(n.children);
    }
  };
  const catalog = yamlOf("project-docs/boundary-catalog.yaml");
  visit(catalog.elements);
  for (const node of asArray(catalog.interfaces)) {
    const id = asObj(node).id;
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

async function load(): Promise<Catalog> {
  const tracked = git(["ls-files"]).filter((f) => existsSync(`${ROOT}/${f}`));
  const tsFiles = tracked.filter(
    (f) => f.endsWith(".ts") || f.endsWith(".tsx"),
  );
  const areasYaml = yamlOf(`${FLOWS}/areas.yaml`);
  const areas = asArray(areasYaml.areas).map(asObj);
  const prefixes = areas.flatMap((a) => strings(a.entries));
  const prefixArea = new Map<string, string>();
  for (const a of areas) {
    for (const p of strings(a.entries)) prefixArea.set(p, String(a.id));
  }

  const routeDuplicates: Duplicate[] = [];
  const raws = [
    ...routeEntries(tsFiles, routeDuplicates),
    ...cliEntries(tsFiles),
    ...toolEntries(tsFiles),
    ...keyEntries(),
    ...ipcEntries(tsFiles),
    ...sdkEntries(),
    ...skillEntries(),
    ...(await controlEntries()),
  ];
  const seen = new Set<string>();
  for (const r of raws) {
    if (seen.has(r.id)) throw new Error(`entry ID가 겹침: ${r.id}`);
    seen.add(r.id);
  }

  // 여러 agent가 file을 하나씩 동시에 쓴다. 깨진 file 하나가 남의 check까지 막지 않게 따로 모은다.
  const broken: { file: string; message: string }[] = [];
  const loadDir = (dir: string) =>
    yamlFiles(dir).flatMap((file) => {
      try {
        return [{ file, data: yamlOf(file) }];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        broken.push({ file, message: message.split("\n")[0] ?? message });
        return [];
      }
    });
  const areaFiles = loadDir(`${FLOWS}/areas`);
  const journeyFiles = loadDir(`${FLOWS}/journeys`);
  const testFiles = loadDir(`${FLOWS}/tests`);

  // 소유: flow의 entries, area의 links, area의 ignore. 두 번째부터는 duplicates에 모은다.
  const owners = new Map<string, string>();
  const duplicates: Catalog["duplicates"] = [];
  const own = (id: string, owner: string, file: string) => {
    const first = owners.get(id);
    if (first === undefined) owners.set(id, owner);
    else duplicates.push({ id, first, second: owner, file });
  };
  for (const { file, data } of areaFiles) {
    const area = String(data.area);
    for (const f of asArray(data.flows).map(asObj)) {
      for (const id of strings(f.entries)) own(id, `flow:${f.id}`, file);
    }
    for (const l of asArray(data.links).map(asObj)) {
      if (typeof l.entry === "string") own(l.entry, `link:${area}`, file);
    }
    for (const i of asArray(data.ignore).map(asObj)) {
      if (typeof i.entry === "string") own(i.entry, `ignore:${area}`, file);
    }
  }

  const entries: Entry[] = raws.map((r) => {
    const prefix = longestPrefix(r.defined_in, prefixes);
    return {
      ...r,
      area: prefix === undefined ? "?" : (prefixArea.get(prefix) ?? "?"),
      accounted_by: owners.get(r.id) ?? "",
    };
  });

  const agentMd = readFileSync(
    `${ROOT}/project-docs/products/AGENT.md`,
    "utf8",
  );
  const archDir = `${ROOT}/project-docs/architecture`;
  return {
    areas,
    areaIds: areas.map((a) => String(a.id)),
    areaFiles,
    broken,
    journeyFiles,
    testFiles,
    testGroups: asArray(areasYaml.test_groups).map(asObj),
    journeyGroups: asArray(areasYaml.journey_groups).map(asObj),
    entries,
    events: eventNames(tsFiles),
    frames: frameIds(tracked),
    boundaries: boundaryIds(),
    agentLines: new Set(
      [...agentMd.matchAll(/^- ([A-Z]+\d+)\./gm)].map((m) => m[1] ?? ""),
    ),
    archDocs: existsSync(archDir)
      ? readdirSync(archDir)
          .filter((n) => n.endsWith(".md"))
          .map((n) => `architecture/${n}`)
          .sort()
      : [],
    tracked,
    testsTracked: tracked.filter(isTest).sort(),
    routeDuplicates,
    owners,
    duplicates,
  };
}

const flowsOf = (c: Catalog) =>
  c.areaFiles.flatMap(({ file, data }) =>
    asArray(data.flows)
      .map(asObj)
      .map((flow) => ({ flow, file, area: String(data.area) })),
  );

function outcomeRefs(c: Catalog): Set<string> {
  const refs = new Set<string>();
  for (const { flow } of flowsOf(c)) {
    for (const o of asArray(flow.outcomes).map(asObj)) {
      refs.add(`${flow.id}:${o.id}`);
    }
  }
  return refs;
}

// ---- check ----

function check(c: Catalog, only: string | undefined, partial: boolean) {
  const issues: Issue[] = [];
  const warnings: Issue[] = [];
  const add = (file: string, field: string, message: string, also?: string) =>
    issues.push({ file, text: `${file}: ${field}: ${message}`, also });
  const warn = (file: string, field: string, message: string) =>
    warnings.push({ file, text: `warning: ${file}: ${field}: ${message}` });

  for (const b of c.broken) add(b.file, "yaml", b.message);
  const generated = new Map(c.entries.map((e) => [e.id, e]));
  const flows = flowsOf(c);
  const outcomes = outcomeRefs(c);
  const flowIds = new Set(flows.map(({ flow }) => String(flow.id)));
  const manualOwned = new Set(
    [...c.owners.keys()].filter((id) => MANUAL.test(id)),
  );
  const events = new Set(c.events);
  const frames = new Set(c.frames);
  const tracked = new Set(c.testsTracked);

  const isEntryRef = (id: string) => generated.has(id) || manualOwned.has(id);
  const checkRefList = (file: string, field: string, list: unknown) => {
    for (const [i, ref] of asArray(list).entries()) {
      const where = `${field}[${i}]`;
      if (typeof ref !== "string") add(file, where, "문자열이어야 함");
      else if (ENTRY_REF.test(ref)) {
        if (!isEntryRef(ref)) add(file, where, `없는 entry: ${ref}`);
      } else if (!outcomes.has(ref)) {
        add(file, where, `없는 <flow>:<outcome>: ${ref}`);
      }
    }
  };
  const checkRefs = (file: string, field: string, list: unknown) => {
    for (const [i, ref] of asArray(list).entries()) {
      if (typeof ref !== "string" || !c.agentLines.has(ref)) {
        add(file, `${field}[${i}]`, `AGENT.md에 없는 줄 ID: ${String(ref)}`);
      }
    }
  };
  const checkStrings = (file: string, field: string, value: unknown) => {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
      add(file, field, "문자열 목록이어야 함");
    }
  };
  const unknownKeys = (file: string, field: string, o: Obj, ok: string[]) => {
    for (const k of Object.keys(o)) {
      if (!ok.includes(k)) add(file, field, `모르는 칸: ${k}`);
    }
  };

  // areas
  const flowOwner = new Map<string, string>();
  for (const { file, data } of c.areaFiles) {
    const name = file.replace(/^.*\//, "").replace(/\.yaml$/, "");
    const area = String(data.area);
    if (area !== name) add(file, "area", `file 이름(${name})과 다름: ${area}`);
    if (!c.areaIds.includes(area))
      add(file, "area", `areas.yaml에 없음: ${area}`);
    unknownKeys(file, "(top)", data, ["area", "flows", "links", "ignore"]);

    for (const [fi, raw] of asArray(data.flows).entries()) {
      const flow = asObj(raw);
      const id = typeof flow.id === "string" ? flow.id : "";
      const at = `flows[${id || fi}]`;
      const f = (field: string) => `${at}.${field}`;
      unknownKeys(file, at, flow, FLOW_KEYS);
      if (!KEBAB.test(id)) add(file, f("id"), `kebab-case여야 함: ${id}`);
      else if (flowOwner.has(id)) {
        add(
          file,
          f("id"),
          `flow id가 겹침: ${flowOwner.get(id)}`,
          flowOwner.get(id),
        );
      } else flowOwner.set(id, file);

      for (const k of [
        "title",
        "actor",
        "boundary",
        "code",
        "steps",
        "outcomes",
      ]) {
        if (flow[k] === undefined) add(file, f(k), "필요");
      }
      if (typeof flow.crosses_process !== "boolean") {
        add(file, f("crosses_process"), "true나 false여야 함");
      }
      if (flow.title !== undefined && typeof flow.title !== "string") {
        add(file, f("title"), "문자열이어야 함");
      }
      if (flow.actor !== undefined && !ACTORS.includes(String(flow.actor))) {
        add(file, f("actor"), `${ACTORS.join("|")} 가운데 하나: ${flow.actor}`);
      }
      if (strings(flow.entries).length + strings(flow.uses).length === 0) {
        add(file, at, "entries나 uses 가운데 하나는 비지 않아야 함");
      }
      checkStrings(file, f("entries"), flow.entries);
      for (const [i, id2] of strings(flow.entries).entries()) {
        const entry = generated.get(id2);
        if (entry === undefined && !MANUAL.test(id2)) {
          add(
            file,
            `${f("entries")}[${i}]`,
            `없는 entry (system:/ui:는 kebab-case): ${id2}`,
          );
        } else if (entry && entry.area !== area) {
          warn(
            file,
            `${f("entries")}[${i}]`,
            `다른 area(${entry.area})의 entry: ${id2}`,
          );
        }
      }
      checkStrings(file, f("uses"), flow.uses);
      checkStrings(file, f("pre"), flow.pre);
      checkRefList(file, f("uses"), flow.uses);
      checkRefList(file, f("pre"), flow.pre);

      checkStrings(file, f("boundary"), flow.boundary);
      for (const [i, b] of asArray(flow.boundary).entries()) {
        if (typeof b !== "string" || !c.boundaries.has(b)) {
          add(
            file,
            `${f("boundary")}[${i}]`,
            `boundary-catalog에 없는 ID: ${String(b)}`,
          );
        }
      }
      if (asArray(flow.boundary).length === 0 && flow.boundary !== undefined) {
        add(file, f("boundary"), "비어 있음");
      }
      checkStrings(file, f("code"), flow.code);
      if (asArray(flow.code).length === 0 && flow.code !== undefined) {
        add(file, f("code"), "비어 있음");
      }
      for (const [i, p] of strings(flow.code).entries()) {
        if (!existsSync(`${ROOT}/${p}`))
          add(file, `${f("code")}[${i}]`, `없는 path: ${p}`);
      }

      const steps = asArray(flow.steps);
      if (flow.steps !== undefined) {
        if (steps.length < 1 || steps.length > 7) {
          add(file, f("steps"), `1~7줄이어야 함 (${steps.length})`);
        }
        if (steps.some((s) => typeof s !== "string" || !s.trim())) {
          add(file, f("steps"), "비지 않은 문자열이어야 함");
        }
      }

      const seenOutcome = new Set<string>();
      if (flow.outcomes !== undefined && asArray(flow.outcomes).length === 0) {
        add(file, f("outcomes"), "비어 있음");
      }
      for (const [oi, rawOutcome] of asArray(flow.outcomes).entries()) {
        const o = asObj(rawOutcome);
        const oid = typeof o.id === "string" ? o.id : "";
        const oat = `${at}.outcomes[${oid || oi}]`;
        unknownKeys(file, oat, o, OUTCOME_KEYS);
        if (!KEBAB.test(oid) && !CODES.includes(oid)) {
          add(file, `${oat}.id`, `kebab-case여야 함: ${oid}`);
        }
        if (seenOutcome.has(oid))
          add(file, `${oat}.id`, `flow 안에서 겹침: ${oid}`);
        seenOutcome.add(oid);
        if (o.code !== undefined && !CODES.includes(String(o.code))) {
          add(
            file,
            `${oat}.code`,
            `오류 code 일곱 가운데 하나여야 함: ${o.code}`,
          );
        }
        if (o.when !== undefined && typeof o.when !== "string") {
          add(file, `${oat}.when`, "문자열이어야 함");
        }
        checkStrings(file, `${oat}.observe`, o.observe);
        for (const [i, ob] of strings(o.observe).entries()) {
          const where = `${oat}.observe[${i}]`;
          const known =
            ob === "response" ||
            ob.startsWith("response:") ||
            OBSERVE.some((p) => ob.startsWith(p));
          if (!known)
            add(
              file,
              where,
              `disk:|ledger:|event:|response|request:|process:|screen:|log: 로 시작해야 함: ${ob}`,
            );
          if (ob.startsWith("event:") && !events.has(ob.slice(6))) {
            add(file, where, `없는 event: ${ob.slice(6)}`);
          }
          if (ob.startsWith("screen:") && !frames.has(ob.slice(7))) {
            warn(file, where, `없는 frame id: ${ob.slice(7)}`);
          }
        }
      }

      checkStrings(file, f("risk"), flow.risk);
      for (const [i, r] of strings(flow.risk).entries()) {
        if (!RISKS.includes(r))
          add(file, `${f("risk")}[${i}]`, `모르는 risk: ${r}`);
      }
      checkStrings(file, f("refs"), flow.refs);
      checkRefs(file, f("refs"), flow.refs);
      checkStrings(file, f("docs"), flow.docs);
      for (const [i, d] of strings(flow.docs).entries()) {
        if (!existsSync(`${ROOT}/project-docs/${d}`)) {
          add(file, `${f("docs")}[${i}]`, `project-docs에 없는 path: ${d}`);
        }
      }
      checkStrings(file, f("unclear"), flow.unclear);
      if (flow.when !== undefined && typeof flow.when !== "string") {
        add(file, f("when"), "문자열이어야 함");
      }
    }

    for (const [i, raw] of asArray(data.links).entries()) {
      const l = asObj(raw);
      const entry =
        typeof l.entry === "string" ? generated.get(l.entry) : undefined;
      if (!entry)
        add(file, `links[${i}].entry`, `없는 entry: ${String(l.entry)}`);
      else if (entry.area !== area) {
        add(
          file,
          `links[${i}].entry`,
          `defined_in(${entry.defined_in})은 ${entry.area} area: ${entry.id}`,
        );
      }
      if (typeof l.flow !== "string" || !flowIds.has(l.flow)) {
        add(file, `links[${i}].flow`, `없는 flow: ${String(l.flow)}`);
      }
    }
    for (const [i, raw] of asArray(data.ignore).entries()) {
      const ig = asObj(raw);
      const entry =
        typeof ig.entry === "string" ? generated.get(ig.entry) : undefined;
      if (!entry)
        add(file, `ignore[${i}].entry`, `없는 entry: ${String(ig.entry)}`);
      else if (entry.area !== area) {
        add(
          file,
          `ignore[${i}].entry`,
          `defined_in(${entry.defined_in})은 ${entry.area} area: ${entry.id}`,
        );
      }
      if (typeof ig.reason !== "string" || !ig.reason.trim()) {
        add(file, `ignore[${i}].reason`, "이유 필요");
      }
    }
  }
  for (const d of c.routeDuplicates) {
    add(d.second, d.id, `route ID를 두 곳이 정의함: ${d.first}, ${d.second}`);
  }
  for (const d of c.duplicates) {
    add(d.file, "entries", `${d.id}를 두 번 소유함: ${d.first}, ${d.second}`);
  }

  // journeys
  const journeyIds = new Map<string, string>();
  const groupIds = c.journeyGroups.map((g) => String(g.id));
  for (const { file, data } of c.journeyFiles) {
    const name = file.replace(/^.*\//, "").replace(/\.yaml$/, "");
    if (String(data.group) !== name)
      add(file, "group", `file 이름(${name})과 다름: ${data.group}`);
    if (!groupIds.includes(String(data.group)))
      add(file, "group", `journey_groups에 없음: ${data.group}`);
    unknownKeys(file, "(top)", data, ["group", "journeys"]);
    for (const [ji, raw] of asArray(data.journeys).entries()) {
      const j = asObj(raw);
      const id = typeof j.id === "string" ? j.id : "";
      const at = `journeys[${id || ji}]`;
      unknownKeys(file, at, j, [
        "id",
        "title",
        "actor",
        "goal",
        "refs",
        "steps",
        "gaps",
      ]);
      if (!KEBAB.test(id)) add(file, `${at}.id`, `kebab-case여야 함: ${id}`);
      else if (journeyIds.has(id))
        add(
          file,
          `${at}.id`,
          `journey id가 겹침: ${journeyIds.get(id)}`,
          journeyIds.get(id),
        );
      else journeyIds.set(id, file);
      if (typeof j.title !== "string") add(file, `${at}.title`, "필요");
      if (!JOURNEY_ACTORS.includes(String(j.actor))) {
        add(
          file,
          `${at}.actor`,
          `${JOURNEY_ACTORS.join("|")} 가운데 하나: ${j.actor}`,
        );
      }
      checkStrings(file, `${at}.refs`, j.refs);
      checkRefs(file, `${at}.refs`, j.refs);
      checkStrings(file, `${at}.gaps`, j.gaps);
      if (asArray(j.steps).length === 0) add(file, `${at}.steps`, "비어 있음");
      for (const [si, rawStep] of asArray(j.steps).entries()) {
        const s = asObj(rawStep);
        unknownKeys(file, `${at}.steps[${si}]`, s, ["do", "screen", "flow"]);
        if (typeof s.flow !== "string" || !outcomes.has(s.flow)) {
          add(
            file,
            `${at}.steps[${si}].flow`,
            `없는 <flow>:<outcome>: ${String(s.flow)}`,
          );
        }
        if (s.screen !== undefined && !frames.has(String(s.screen))) {
          add(
            file,
            `${at}.steps[${si}].screen`,
            `없는 wireframe frame id: ${String(s.screen)}`,
          );
        }
      }
    }
  }

  // tests
  const testGroupIds = c.testGroups.map((g) => String(g.id));
  const groupPrefixes = c.testGroups.flatMap((g) => strings(g.paths));
  const prefixGroup = new Map<string, string>();
  for (const g of c.testGroups) {
    for (const p of strings(g.paths)) prefixGroup.set(p, String(g.id));
  }
  const listed = new Map<string, string>();
  for (const { file, data } of c.testFiles) {
    const name = file.replace(/^.*\//, "").replace(/\.yaml$/, "");
    if (String(data.group) !== name)
      add(file, "group", `file 이름(${name})과 다름: ${data.group}`);
    if (!testGroupIds.includes(String(data.group)))
      add(file, "group", `test_groups에 없음: ${data.group}`);
    unknownKeys(file, "(top)", data, ["group", "files"]);
    for (const [i, raw] of asArray(data.files).entries()) {
      const t = asObj(raw);
      const path = typeof t.path === "string" ? t.path : "";
      const at = `files[${i}]`;
      unknownKeys(file, at, t, ["path", "covers", "note"]);
      if (!tracked.has(path))
        add(file, `${at}.path`, `git이 아는 *_test.ts가 아님: ${path}`);
      else {
        const prefix = longestPrefix(path, groupPrefixes);
        const group =
          prefix === undefined ? undefined : prefixGroup.get(prefix);
        if (group !== String(data.group)) {
          add(
            file,
            `${at}.path`,
            `이 path의 group은 ${group ?? "(없음)"}: ${path}`,
          );
        }
      }
      const before = listed.get(path);
      if (before)
        add(file, `${at}.path`, `이미 올라 있음: ${path} (${before})`, before);
      else listed.set(path, file);
      if (!Array.isArray(t.covers))
        add(file, `${at}.covers`, "목록이어야 함 (비어도 됨)");
      for (const [ci, ref] of asArray(t.covers).entries()) {
        if (typeof ref !== "string" || !outcomes.has(ref)) {
          add(
            file,
            `${at}.covers[${ci}]`,
            `없는 <flow>:<outcome>: ${String(ref)}`,
          );
        }
      }
    }
  }

  // 빠짐없음
  const unaccountedList: string[] = [];
  if (!partial && only === undefined) {
    for (const e of c.entries) {
      if (!e.accounted_by) unaccountedList.push(e.id);
    }
    for (const id of unaccountedList.slice(0, 50)) {
      const e = generated.get(id);
      add(`${FLOWS}/areas`, id, `소유되지 않음 (area ${e?.area})`);
    }
    if (unaccountedList.length > 50) {
      add(
        `${FLOWS}/areas`,
        "(completeness)",
        `소유되지 않은 entry가 ${unaccountedList.length - 50}개 더 있음`,
      );
    }
    const missing = c.testsTracked.filter((t) => !listed.has(t));
    for (const t of missing.slice(0, 50)) {
      add(`${FLOWS}/tests`, t, "어느 tests file에도 오르지 않음");
    }
    if (missing.length > 50) {
      add(
        `${FLOWS}/tests`,
        "(completeness)",
        `오르지 않은 test file이 ${missing.length - 50}개 더 있음`,
      );
    }
  }

  const pick = (list: Issue[]) =>
    only === undefined
      ? list
      : list.filter((i) => i.file === only || i.also === only);
  return { issues: pick(issues), warnings: pick(warnings), flows, outcomes };
}

// ---- 출력 ----

function parseArgs(argv: string[]) {
  const flags = new Set(["json", "unaccounted", "partial"]);
  const values = new Map<string, string>();
  const on = new Set<string>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (!a.startsWith("--")) rest.push(a);
    else if (flags.has(a.slice(2))) on.add(a.slice(2));
    else {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a}에 값 필요`);
      values.set(a.slice(2), v);
    }
  }
  return { rest, on, values };
}

function countBy<T>(list: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of list)
    counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return new Map([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

function cmdEntries(c: Catalog, a: ReturnType<typeof parseArgs>) {
  const area = a.values.get("area");
  const kind = a.values.get("kind");
  const list = c.entries.filter(
    (e) =>
      (area === undefined || e.area === area) &&
      (kind === undefined || e.kind === kind) &&
      (!a.on.has("unaccounted") || !e.accounted_by),
  );
  for (const d of c.routeDuplicates) {
    console.error(
      `warning: route ID를 두 곳이 정의함: ${d.id} (${d.first}, ${d.second})`,
    );
  }
  if (a.on.has("json")) {
    console.log(JSON.stringify(list, null, 2));
    return;
  }
  for (const e of list) {
    console.log(
      `${e.id}\t${e.kind}\t${e.defined_in}\t${e.area}\t${e.accounted_by}`,
    );
  }
  console.log(
    `\n${list.length} entries (events ${c.events.length}, frames ${c.frames.length})`,
  );
  const sum = (m: Map<string, number>) =>
    [...m].map(([k, n]) => `${k} ${n}`).join(", ");
  console.log(`kind: ${sum(countBy(list, (e) => e.kind))}`);
  console.log(`area: ${sum(countBy(list, (e) => e.area))}`);
}

function cmdIndex(c: Catalog, a: ReturnType<typeof parseArgs>) {
  const area = a.values.get("area");
  for (const { flow, area: fa } of flowsOf(c)) {
    if (area !== undefined && fa !== area) continue;
    const outs = asArray(flow.outcomes)
      .map((o) => String(asObj(o).id))
      .join(",");
    console.log(`${flow.id} | ${fa} | ${flow.actor} | ${flow.title} | ${outs}`);
  }
  if (area !== undefined) return;
  for (const { data } of c.journeyFiles) {
    for (const j of asArray(data.journeys).map(asObj)) {
      console.log(`journey ${j.id} | ${data.group} | ${j.title}`);
    }
  }
}

function layerOf(path: string): string {
  if (path.startsWith("tests/e2e/")) return "core-e2e";
  if (path.startsWith("tests/harness/loop/")) return "harness-loop";
  if (path.startsWith("tests/harness/wire/")) return "harness-wire";
  if (path.startsWith("tests/live/")) return "live";
  return "unit";
}

const pct = (n: number, d: number) =>
  d === 0 ? "-" : `${((n / d) * 100).toFixed(0)}%`;
const frac = (n: number, d: number) => `${n}/${d} (${pct(n, d)})`;

function buildReport(c: Catalog) {
  const flows = flowsOf(c);
  const outcomeList = flows.flatMap(({ flow }) =>
    asArray(flow.outcomes).map((o) => `${flow.id}:${asObj(o).id}`),
  );

  // entry
  const byKind = countBy(c.entries, (e) => e.kind);
  const accountedKind = countBy(
    c.entries.filter((e) => e.accounted_by),
    (e) => e.kind,
  );
  const byArea = countBy(c.entries, (e) => e.area);
  const accountedArea = countBy(
    c.entries.filter((e) => e.accounted_by),
    (e) => e.area,
  );
  const unaccounted = c.entries.filter((e) => !e.accounted_by);
  const unaccountedByArea: Record<string, string[]> = {};
  for (const e of unaccounted) (unaccountedByArea[e.area] ??= []).push(e.id);

  // area별 flow
  const perArea: Record<
    string,
    { flows: number; outcomes: number; unclear: number; manual: number }
  > = {};
  for (const id of c.areaIds)
    perArea[id] = { flows: 0, outcomes: 0, unclear: 0, manual: 0 };
  for (const { flow, area } of flows) {
    const p = (perArea[area] ??= {
      flows: 0,
      outcomes: 0,
      unclear: 0,
      manual: 0,
    });
    p.flows++;
    p.outcomes += asArray(flow.outcomes).length;
    p.unclear += strings(flow.unclear).length;
    if (strings(flow.entries).some((e) => MANUAL.test(e))) p.manual++;
  }

  // 참조율
  const usedEvents = new Set<string>();
  const usedLines = new Set<string>();
  const usedDocs = new Set<string>();
  for (const { flow } of flows) {
    for (const o of asArray(flow.outcomes).map(asObj)) {
      for (const ob of strings(o.observe)) {
        if (ob.startsWith("event:")) usedEvents.add(ob.slice(6));
      }
    }
    for (const r of strings(flow.refs)) usedLines.add(r);
    for (const d of strings(flow.docs)) usedDocs.add(d);
  }
  const usedFrames = new Set<string>();
  const journeys = c.journeyFiles.flatMap(({ data }) =>
    asArray(data.journeys).map(asObj),
  );
  for (const j of journeys) {
    for (const r of strings(j.refs)) usedLines.add(r);
    for (const s of asArray(j.steps).map(asObj)) {
      if (typeof s.screen === "string") usedFrames.add(s.screen);
    }
  }
  const inSet = (used: Set<string>, all: string[]) =>
    all.filter((x) => used.has(x)).length;

  // test
  const tests = c.testFiles.flatMap(({ data }) =>
    asArray(data.files).map(asObj),
  );
  const coveredBy = new Map<string, Set<string>>();
  for (const t of tests) {
    const layer = layerOf(String(t.path));
    for (const ref of strings(t.covers)) {
      if (!coveredBy.has(ref)) coveredBy.set(ref, new Set());
      coveredBy.get(ref)?.add(layer);
    }
  }
  const outcomeSet = new Set(outcomeList);
  const covered = (ref: string) => coveredBy.has(ref) && outcomeSet.has(ref);
  const coveredCount = outcomeList.filter(covered).length;
  const byLayer: Record<string, number> = {};
  for (const l of LAYERS) {
    byLayer[l] = outcomeList.filter((r) => coveredBy.get(r)?.has(l)).length;
  }

  // risk
  const riskOutcomes: { ref: string; risk: string[] }[] = [];
  for (const { flow } of flows) {
    const risk = strings(flow.risk);
    if (risk.length === 0) continue;
    for (const o of asArray(flow.outcomes).map(asObj)) {
      riskOutcomes.push({ ref: `${flow.id}:${o.id}`, risk });
    }
  }
  const riskKinds: Record<string, { covered: number; total: number }> = {};
  for (const r of RISKS) {
    const list = riskOutcomes.filter((o) => o.risk.includes(r));
    riskKinds[r] = {
      covered: list.filter((o) => covered(o.ref)).length,
      total: list.length,
    };
  }
  const uncoveredRisk = riskOutcomes
    .filter((o) => !covered(o.ref))
    .map((o) => `${o.ref} [${o.risk.join(",")}]`);

  // journey
  const journeyRows = journeys.map((j) => {
    const steps = asArray(j.steps).map(asObj);
    return {
      id: String(j.id),
      covered: steps.filter(
        (s) => typeof s.flow === "string" && covered(s.flow),
      ).length,
      steps: steps.length,
    };
  });

  // e2e 후보
  const candidates = flows
    .filter(
      ({ flow }) =>
        flow.crosses_process === true && strings(flow.risk).length > 0,
    )
    .filter(
      ({ flow }) =>
        !asArray(flow.outcomes).some((o) =>
          coveredBy.get(`${flow.id}:${asObj(o).id}`)?.has("core-e2e"),
        ),
    )
    .map(({ flow }) => `${flow.id} [${strings(flow.risk).join(",")}]`);

  return {
    entries: {
      total: c.entries.length,
      by_kind: Object.fromEntries(
        [...byKind].map(([k, n]) => [
          k,
          { total: n, accounted: accountedKind.get(k) ?? 0 },
        ]),
      ),
      by_area: Object.fromEntries(
        [...byArea].map(([k, n]) => [
          k,
          { total: n, accounted: accountedArea.get(k) ?? 0 },
        ]),
      ),
      unaccounted: unaccounted.length,
      unaccounted_by_area: unaccountedByArea,
    },
    areas: perArea,
    refs: {
      events: { used: inSet(usedEvents, c.events), total: c.events.length },
      agent_lines: {
        used: inSet(usedLines, [...c.agentLines]),
        total: c.agentLines.size,
      },
      architecture_docs: {
        used: inSet(usedDocs, c.archDocs),
        total: c.archDocs.length,
      },
      frames: { used: inSet(usedFrames, c.frames), total: c.frames.length },
    },
    tests: {
      listed: tests.length,
      tracked: c.testsTracked.length,
      empty_covers: tests.filter((t) => strings(t.covers).length === 0).length,
    },
    coverage: {
      covered: coveredCount,
      total: outcomeList.length,
      by_layer: byLayer,
    },
    risk: {
      covered: riskOutcomes.filter((o) => covered(o.ref)).length,
      total: riskOutcomes.length,
      by_kind: riskKinds,
      uncovered: uncoveredRisk,
    },
    journeys: {
      rows: journeyRows,
      covered: journeyRows.reduce((n, j) => n + j.covered, 0),
      steps: journeyRows.reduce((n, j) => n + j.steps, 0),
    },
    e2e_candidates: candidates,
  };
}

function cmdReport(c: Catalog, a: ReturnType<typeof parseArgs>) {
  const r = buildReport(c);
  if (a.on.has("json")) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  const out: string[] = [];
  const table = (head: string[], rows: (string | number)[][]) => {
    out.push(`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`);
    for (const row of rows) out.push(`| ${row.join(" | ")} |`);
    out.push("");
  };
  const cap = (list: string[], max: number) => {
    out.push(...list.slice(0, max).map((l) => `- ${l}`));
    if (list.length > max) out.push(`- +${list.length - max} more`);
    out.push("");
  };

  out.push("# flows report", "", "## Entries", "");
  table(
    ["kind", "total", "accounted"],
    Object.entries(r.entries.by_kind).map(([k, v]) => [
      k,
      v.total,
      frac(v.accounted, v.total),
    ]),
  );
  table(
    ["area", "total", "accounted"],
    Object.entries(r.entries.by_area).map(([k, v]) => [
      k,
      v.total,
      frac(v.accounted, v.total),
    ]),
  );
  out.push(`Unaccounted: ${r.entries.unaccounted} of ${r.entries.total}`, "");
  const idLines: string[] = [];
  for (const [area, ids] of Object.entries(r.entries.unaccounted_by_area)) {
    idLines.push(`${area} (${ids.length})`);
    for (const id of ids) idLines.push(`  ${id}`);
  }
  out.push(
    ...idLines
      .slice(0, 50)
      .map((l) => (l.startsWith("  ") ? `  - ${l.trim()}` : `- ${l}`)),
  );
  if (idLines.length > 50) out.push(`- +${idLines.length - 50} more`);
  out.push("");

  out.push("## Flows", "");
  table(
    ["area", "flows", "outcomes", "unclear", "system/ui flows"],
    Object.entries(r.areas).map(([k, v]) => [
      k,
      v.flows,
      v.outcomes,
      v.unclear,
      v.manual,
    ]),
  );

  out.push("## Reference rates", "");
  table(
    ["what", "referenced"],
    [
      ["events in observe", frac(r.refs.events.used, r.refs.events.total)],
      [
        "AGENT.md line IDs",
        frac(r.refs.agent_lines.used, r.refs.agent_lines.total),
      ],
      [
        "architecture docs",
        frac(r.refs.architecture_docs.used, r.refs.architecture_docs.total),
      ],
      ["wireframe frames", frac(r.refs.frames.used, r.refs.frames.total)],
    ],
  );

  out.push("## Tests", "");
  out.push(
    `Test files listed ${frac(r.tests.listed, r.tests.tracked)}; files with empty covers: ${r.tests.empty_covers}`,
    "",
  );

  out.push("## Outcome coverage", "");
  table(
    ["layer", "covered"],
    [
      ["all", frac(r.coverage.covered, r.coverage.total)],
      ...Object.entries(r.coverage.by_layer).map(([k, n]) => [
        k,
        frac(n, r.coverage.total),
      ]),
    ],
  );

  out.push("## Risk coverage", "");
  table(
    ["risk", "covered"],
    [
      ["all", frac(r.risk.covered, r.risk.total)],
      ...Object.entries(r.risk.by_kind).map(([k, v]) => [
        k,
        frac(v.covered, v.total),
      ]),
    ],
  );
  out.push(`Uncovered risk outcomes (${r.risk.uncovered.length}):`, "");
  cap(r.risk.uncovered, 80);

  out.push("## Journey step coverage", "");
  table(
    ["journey", "covered steps"],
    [
      ...r.journeys.rows.map((j) => [j.id, frac(j.covered, j.steps)]),
      ["total", frac(r.journeys.covered, r.journeys.steps)],
    ],
  );

  out.push(
    "## E2E candidates",
    "",
    "crosses_process, risk가 있고 core-e2e가 덮지 않는 flow:",
    "",
  );
  cap(r.e2e_candidates, r.e2e_candidates.length);
  console.log(out.join("\n"));
}

// mulberry32. seed 문자열은 FNV-1a로 숫자로 만든다.
function random(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cmdSample(c: Catalog, a: ReturnType<typeof parseArgs>) {
  const area = a.values.get("area");
  if (area === undefined) throw new Error("--area 필요");
  const n = Number(a.values.get("n") ?? 5);
  const rand = random(a.values.get("seed") ?? "flows");
  const pool = flowsOf(c)
    .filter((f) => f.area === area)
    .map((f) => f.flow);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j] as Obj, pool[i] as Obj];
  }
  console.log(stringify({ area, flows: pool.slice(0, n) }));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const c = await load();
  if (cmd === "entries") return cmdEntries(c, args);
  if (cmd === "index") return cmdIndex(c, args);
  if (cmd === "report") return cmdReport(c, args);
  if (cmd === "sample") return cmdSample(c, args);
  // observe의 event:와 journey의 screen에 쓸 수 있는 이름.
  if (cmd === "events") return void console.log(c.events.join("\n"));
  if (cmd === "frames") return void console.log(c.frames.join("\n"));
  if (cmd === "check") {
    const file = args.values.get("file");
    const rel =
      file === undefined
        ? undefined
        : isAbsolute(file)
          ? relative(ROOT, file)
          : relative(ROOT, resolve(process.cwd(), file));
    const result = check(c, rel, args.on.has("partial"));
    for (const w of result.warnings) console.log(w.text);
    for (const i of result.issues) console.error(i.text);
    if (result.issues.length > 0) process.exit(1);
    const owned = [...c.owners.keys()].length;
    console.log(
      `flows check ok (${c.areaFiles.length} areas, ${result.flows.length} flows, ${result.outcomes.size} outcomes, ${c.journeyFiles.length} journey files, ${c.testFiles.length} test files, ${owned}/${c.entries.length} entries owned)`,
    );
    return;
  }
  throw new Error(
    "usage: node tools/flows.ts <entries|index|check|report|sample|events|frames> [옵션]",
  );
}

try {
  await main();
} catch (error) {
  console.error(`flows: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
