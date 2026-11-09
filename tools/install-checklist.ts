// 설치할 판과 지금 깔린 판의 차이로 "해야 할 것"과 "설치 뒤 확인할 것"의 markdown checklist를 만든다.
// 실행: node tools/install-checklist.ts [--from <x.y.z>] [--to <x.y.z>] [--out <file>]
// 재료는 change-log 항목(`checklist` 칸 포함)과 release notes의 "Action needed" 절이다.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { compare, loadChanges } from "./records.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NOTES = `${ROOT}/project-docs/products/release-notes`;
const SEMVER = /^\d+\.\d+\.\d+$/;
// checklist 항목이 이 말로 시작하면 "해야 할 것"이고 아니면 "확인할 것"이다.
const DO_PREFIX = "해야:";
// 저장 data의 모양이 바뀐 항목을 거칠게 가린다.
const DATA_WORDS =
  /schema|migration|ledger|data root|data step|settings\.json|secrets\.json|마이그레이션|저장 모양/i;

export type Change = {
  version: string;
  id: string;
  title: string;
  text: string;
  checklist: string[];
};
export type Note = { version: string; actions: string[] };

export function toChanges(rows: Record<string, unknown>[]): Change[] {
  return rows.map((d) => ({
    version: String(d.version),
    id: String(d.id),
    title: String(d.title),
    text: [d.title, d.change, d.follow_up].filter(Boolean).join("\n"),
    checklist: Array.isArray(d.checklist) ? d.checklist.map(String) : [],
  }));
}

// release notes의 "## Action needed" 절의 `- ` 항목.
export function readNotes(dir = NOTES): Note[] {
  if (!existsSync(dir)) return [];
  const notes: Note[] = [];
  for (const name of readdirSync(dir)) {
    const version = name.replace(/\.md$/, "");
    if (!SEMVER.test(version)) continue;
    const lines = readFileSync(`${dir}/${name}`, "utf8").split("\n");
    const start = lines.findIndex((l) => l.trim() === "## Action needed");
    if (start < 0) continue;
    const actions: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (line.startsWith("## ")) break;
      if (line.startsWith("- ")) actions.push(line.slice(2).trim());
      else if (actions.length > 0 && /^\s+\S/.test(line))
        actions[actions.length - 1] += ` ${line.trim()}`;
    }
    if (actions.length > 0) notes.push({ version, actions });
  }
  return notes;
}

const inRange = (v: string, from: string, to: string) =>
  compare(v, from) > 0 && compare(v, to) <= 0;

export function buildChecklist(input: {
  from: string | undefined;
  to: string;
  changes: Change[];
  notes: Note[];
}): string {
  const { from, to } = input;
  if (from === undefined) {
    return [
      `# lophn 설치 체크리스트 (처음 설치) → ${to}`,
      "",
      "## 확인할 것",
      "- [ ] 앱이 뜨고 빈 Home이 보인다",
      "- [ ] Settings > Providers에서 provider를 붙이고 기본 model을 정한다",
      "",
    ].join("\n");
  }
  const title = `# lophn 설치 체크리스트 ${from} → ${to}`;
  const order = compare(from, to);
  if (order > 0) {
    return [
      title,
      "",
      "> 경고: 깔린 판이 설치할 판보다 높다(downgrade). 새 판이 저장 data(schema 기록)를 이해하지 못하면 data root가 기동을 거절할 수 있다. 거절하면 `<root>/recovery/`의 사본을 기억해 둔다.",
      "",
    ].join("\n");
  }
  if (order === 0) return `${title}\n\n판이 같다. 할 일 없음.\n`;

  const changes = input.changes.filter((c) => inRange(c.version, from, to));
  const notes = input.notes.filter((n) => inRange(n.version, from, to));
  const out = [title, ""];

  const todo = [
    ...notes.flatMap((n) =>
      n.actions.map((a) => `${a} (release notes ${n.version})`),
    ),
    ...changes.flatMap((c) =>
      c.checklist
        .filter((i) => i.startsWith(DO_PREFIX))
        .map(
          (i) => `${i.slice(DO_PREFIX.length).trim()} (${c.version} ${c.id})`,
        ),
    ),
  ];
  out.push("## 해야 할 것");
  out.push(...(todo.length > 0 ? todo.map((t) => `- [ ] ${t}`) : ["없음"]), "");

  const data = changes.filter((c) => DATA_WORDS.test(c.text));
  if (data.length > 0) {
    out.push(
      "## 저장 data가 바뀐 것 (키워드로 가려서 틀릴 수 있다)",
      "- [ ] 실제 data root로 앱을 켜서 기동하는지 본다. 거절하면 `<root>/recovery/`의 사본을 둔 채 로그를 본다.",
      ...data.map((c) => `  - ${c.version} ${c.id}: ${c.title}`),
      "",
    );
  }

  out.push("## 확인할 것");
  if (changes.length === 0) out.push("바뀐 항목 없음");
  let last = "";
  for (const c of changes) {
    if (c.version !== last) out.push("", `### ${c.version}`);
    last = c.version;
    out.push(`- [ ] ${c.title} (${c.id})`);
    for (const i of c.checklist.filter((i) => !i.startsWith(DO_PREFIX)))
      out.push(`  - [ ] ${i}`);
  }
  out.push("");
  return out.join("\n");
}

function run(command: string, args: string[]): string | undefined {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

// 못 찾으면 undefined(첫 설치로 본다). 알려 주는 말은 note에 둔다.
export function installedVersion(): string | undefined {
  let version: string | undefined;
  if (process.platform === "linux") {
    version = run("dpkg-query", ["-W", "-f=${Version}", "lophn"]);
  } else if (process.platform === "darwin") {
    for (const app of ["lophn", "lophn-desktop"]) {
      const plist = `/Applications/${app}.app/Contents/Info.plist`;
      if (!existsSync(plist)) continue;
      version = run("/usr/libexec/PlistBuddy", [
        "-c",
        "Print :CFBundleShortVersionString",
        plist,
      ]);
      break;
    }
  } else if (process.platform === "win32") {
    // nsis perMachine false의 기본 위치.
    const exe = `${process.env.LOCALAPPDATA}\\Programs\\lophn\\lophn-desktop.exe`;
    if (existsSync(exe))
      version = run("powershell", [
        "-NoProfile",
        "-Command",
        `(Get-Item '${exe}').VersionInfo.ProductVersion`,
      ]);
  }
  return version && SEMVER.test(version) ? version : undefined;
}

export function checklistFor(from: string | undefined, to: string): string {
  return buildChecklist({
    from,
    to,
    changes: toChanges(loadChanges()),
    notes: readNotes(),
  });
}

function arg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const to =
    arg("--to") ??
    String(JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8")).version);
  const from = arg("--from") ?? installedVersion();
  const text = checklistFor(from, to);
  const out = arg("--out");
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);
}
