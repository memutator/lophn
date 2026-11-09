// issue·change-log 항목 file과 architecture 문서의 꼴을 본다(check)와 목록(issues, changes).
// 실행: node tools/records.ts <check [--file <path>] [--partial] | issues [--topic t] [--status s] | changes [--version x.y]>
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

type Obj = Record<string, unknown>;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ISSUES = "project-docs/issues";
const CHANGES = "project-docs/products/change-log";
const ARCH = "project-docs/architecture";
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const MINOR_DIR = /^\d+\.\d+$/;

const ISSUE_KEYS = [
  "id",
  "title",
  "kind",
  "status",
  "topic",
  "modules",
  "now",
  "impact",
  "fix",
  "decide",
  "decided",
  "cause",
  "prevent",
  "closed",
  "guard",
  "regressed",
];
const CHANGE_KEYS = [
  "id",
  "version",
  "title",
  "modules",
  "checked",
  "change",
  "why",
  "decisions",
  "follow_up",
];

function read(path: string): string {
  return readFileSync(`${ROOT}/${path}`, "utf8");
}

function asObj(value: unknown): Obj {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

function yamlFiles(dir: string): string[] {
  if (!existsSync(`${ROOT}/${dir}`)) return [];
  return readdirSync(`${ROOT}/${dir}`)
    .filter((n) => n.endsWith(".yaml"))
    .sort()
    .map((n) => `${dir}/${n}`);
}

function changeFiles(): string[] {
  if (!existsSync(`${ROOT}/${CHANGES}`)) return [];
  return readdirSync(`${ROOT}/${CHANGES}`)
    .filter(
      (n) =>
        MINOR_DIR.test(n) && statSync(`${ROOT}/${CHANGES}/${n}`).isDirectory(),
    )
    .flatMap((d) => yamlFiles(`${CHANGES}/${d}`));
}

function load(file: string): { data: Obj; error?: string } {
  try {
    return { data: asObj(parse(read(file))) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { data: {}, error: message.split("\n")[0] ?? message };
  }
}

function catalogPaths(): Set<string> {
  const data = asObj(parse(read("project-docs/module-catalog.yaml")));
  return new Set(
    (Array.isArray(data.modules) ? data.modules : []).map((m) =>
      String(asObj(m).path),
    ),
  );
}

function registryIds(): Set<string> {
  const data = asObj(
    parse(read("project-docs/context-component-registry.yaml")),
  );
  return new Set(
    (Array.isArray(data.components) ? data.components : []).map((c) =>
      String(asObj(c).id),
    ),
  );
}

function compare(a: string, b: string): number {
  const pa = SEMVER.exec(a)?.slice(1).map(Number) ?? [0, 0, 0];
  const pb = SEMVER.exec(b)?.slice(1).map(Number) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

type Problem = { file: string; text: string };

function check(only: string | undefined, partial: boolean): Problem[] {
  const problems: Problem[] = [];
  const add = (file: string, field: string, message: string) =>
    problems.push({ file, text: `${file}: ${field}: ${message}` });
  const modules = catalogPaths();
  const registry = registryIds();

  const text = (file: string, data: Obj, field: string, required: boolean) => {
    const v = data[field];
    if (v === undefined) {
      if (required) add(file, field, "없음");
      return;
    }
    if (typeof v !== "string" || !v.trim())
      add(file, field, "비지 않은 글이어야 함");
  };
  const unknown = (file: string, data: Obj, keys: string[]) => {
    for (const k of Object.keys(data))
      if (!keys.includes(k)) add(file, k, "모르는 칸");
  };
  const moduleList = (file: string, data: Obj) => {
    if (!Array.isArray(data.modules))
      return add(file, "modules", "목록이어야 함");
    for (const m of strings(data.modules))
      if (!modules.has(m))
        add(file, "modules", `module-catalog에 없는 path: ${m}`);
  };
  const idOf = (file: string, data: Obj) => {
    const id = basename(file, ".yaml");
    if (data.id !== id) add(file, "id", `file 이름(${id})과 같아야 함`);
    if (!KEBAB.test(id)) add(file, "id", `kebab-case여야 함: ${id}`);
  };

  for (const file of yamlFiles(ISSUES)) {
    const { data, error } = load(file);
    if (error) {
      add(file, "yaml", error);
      continue;
    }
    unknown(file, data, ISSUE_KEYS);
    idOf(file, data);
    for (const f of ["title", "topic", "now", "impact"])
      text(file, data, f, true);
    if (typeof data.topic === "string" && !KEBAB.test(data.topic))
      add(file, "topic", "kebab-case여야 함");
    if (!["bug", "defect", "mistake"].includes(String(data.kind)))
      add(file, "kind", "bug | defect | mistake");
    const status = String(data.status);
    if (!["open", "fixed", "kept"].includes(status))
      add(file, "status", "open | fixed | kept");
    moduleList(file, data);
    text(file, data, "fix", status === "open");
    text(file, data, "closed", status !== "open");
    if (status !== "open" && (typeof data.guard !== "string" || !data.guard))
      add(file, "guard", "닫은 이슈는 guard가 있어야 함(없으면 없음)");
    text(file, data, "cause", data.kind === "mistake");
    text(file, data, "prevent", data.kind === "mistake");
    for (const f of ["decide", "decided", "regressed"])
      text(file, data, f, false);
  }

  const versions: string[] = [];
  for (const file of changeFiles()) {
    const { data, error } = load(file);
    if (error) {
      add(file, "yaml", error);
      continue;
    }
    unknown(file, data, CHANGE_KEYS);
    idOf(file, data);
    const version = String(data.version);
    const folder = basename(dirname(file));
    if (!SEMVER.test(version)) add(file, "version", `x.y.z여야 함: ${version}`);
    else if (!version.startsWith(`${folder}.`))
      add(file, "version", `폴더 ${folder}의 판이어야 함: ${version}`);
    else versions.push(version);
    for (const f of ["title", "change", "why"]) text(file, data, f, true);
    text(file, data, "follow_up", false);
    moduleList(file, data);
    for (const c of strings(data.checked))
      if (!registry.has(c)) add(file, "checked", `registry에 없는 ID: ${c}`);
    if (data.decisions !== undefined) {
      if (!Array.isArray(data.decisions))
        add(file, "decisions", "목록이어야 함");
      for (const [i, raw] of (Array.isArray(data.decisions)
        ? data.decisions
        : []
      ).entries()) {
        const d = asObj(raw);
        if (typeof d.text !== "string" || !d.text.trim())
          add(file, `decisions[${i}].text`, "비지 않은 글이어야 함");
        if (!["person", "agent"].includes(String(d.by)))
          add(file, `decisions[${i}].by`, "person | agent");
        for (const k of Object.keys(d))
          if (k !== "text" && k !== "by")
            add(file, `decisions[${i}].${k}`, "모르는 칸");
      }
    }
  }

  if (!partial) {
    const current = String(asObj(JSON.parse(read("package.json"))).version);
    if (!versions.includes(current))
      add("package.json", "version", `${current} 판의 change-log 항목이 없음`);
    for (const v of new Set(versions))
      if (compare(v, current) > 0)
        add(
          CHANGES,
          "version",
          `package.json(${current})보다 높은 판의 항목: ${v}`,
        );

    for (const name of readdirSync(`${ROOT}/${ARCH}`).sort()) {
      if (!name.endsWith(".md") || name === "README.md") continue;
      const file = `${ARCH}/${name}`;
      architecture(file, read(file), add);
    }
  } else if (only?.startsWith(`${ARCH}/`) && only.endsWith(".md")) {
    architecture(only, read(only), add);
  }

  return only === undefined
    ? problems
    : problems.filter((p) => p.file === only || p.file === "package.json");
}

// architecture는 설계만 적는다. 어느 file이 하는지는 code와 flow catalog가 맡는다.
function architecture(
  file: string,
  source: string,
  add: (file: string, field: string, message: string) => void,
) {
  const lines = source.split("\n");
  for (const [i, line] of lines.entries()) {
    if (/packages\//.test(line) || /[\w-]\.tsx?\b/.test(line))
      add(file, `${i + 1}행`, "code path나 .ts file 이름을 쓰지 않는다");
  }
  for (const h of ["## 문제", "## 지키는 것", "## 결정"])
    if (!lines.some((l) => l.trim() === h)) add(file, h, "절이 없음");
}

function listIssues(topic?: string, status?: string) {
  const rows = yamlFiles(ISSUES)
    .map((f) => load(f).data)
    .filter(
      (d) => (!topic || d.topic === topic) && (!status || d.status === status),
    )
    .sort((a, b) => `${a.topic}/${a.id}`.localeCompare(`${b.topic}/${b.id}`));
  let last = "";
  for (const d of rows) {
    if (d.topic !== last) console.log(`\n## ${String(d.topic)}`);
    last = String(d.topic);
    console.log(
      `- [${String(d.status)}] ${String(d.kind)} ${String(d.id)}: ${String(d.title)}`,
    );
  }
  console.log(`\n${rows.length} issues`);
}

function listChanges(minor?: string) {
  const rows = changeFiles()
    .map((f) => load(f).data)
    .filter((d) => !minor || String(d.version).startsWith(`${minor}.`))
    .sort((a, b) => compare(String(a.version), String(b.version)));
  for (const d of rows)
    console.log(`${String(d.version)} ${String(d.id)}: ${String(d.title)}`);
  console.log(`\n${rows.length} changes`);
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "check") {
  const file = arg(args, "--file");
  const only =
    file === undefined
      ? undefined
      : relative(ROOT, resolve(process.cwd(), file));
  const problems = check(
    only,
    args.includes("--partial") || only !== undefined,
  );
  for (const p of problems) console.error(p.text);
  if (problems.length > 0) process.exit(1);
  console.log("records check ok");
} else if (cmd === "issues") {
  listIssues(arg(args, "--topic"), arg(args, "--status"));
} else if (cmd === "changes") {
  listChanges(arg(args, "--version"));
} else {
  console.error(
    "usage: node tools/records.ts <check [--file <path>] [--partial] | issues [--topic t] [--status s] | changes [--version x.y]>",
  );
  process.exit(1);
}
