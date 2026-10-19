// 소스 낱말 검사: 주석과 test 이름의 옛 요구 ID·작업 번호, 쓰지 않는 말.
// 실행: deno run --allow-read tools/check-source.ts [root]
// 이름과 경로의 판·단계·작업 번호는 check-deps.ts가, 화면 문구는 check-wording.ts가 본다.
import { walk } from "./check-deps.ts";
import { readImports, readStringSites } from "./deps-imports.ts";
import {
  directory,
  normalize,
  readMembers,
  resolveWorkspace,
} from "./deps-workspace.ts";

type Issue = { file: string; line: number; rule: string; message: string };

// 주석이나 test 이름에서만 보는 꼴. 코드 안의 hex 색 같은 것과 섞이지 않게 한다. TODO는 남기지 않는다(남길 일은 작업으로).
const NUMBERED: [RegExp, string][] = [
  [/req-\d{3,}|#R\d+\b|\[R\d+\]/, "옛 요구 ID"],
  [/\b[TQDW]\d{2,3}\b/, "작업 번호"],
  [/\bS[1-9]\b/, "spec 번호"],
  [/\b(?:TODO|FIXME)\b/, "TODO"],
];

// 지운 기능과 바꾼 말 중 grep으로 오탐 없이 잡히는 옛 말. 옛 말 표는 git tag docs-before-trim에 있다.
const FORBIDDEN: [RegExp, string][] = [
  [/file-tracking/, "file-tracking"],
  [/doc@ver/, "doc@ver"],
  [/documents#/, "의도 참조(documents#)"],
  [/place 없는 문서/, "place 없는 문서"],
  [/series registry/i, "series registry"],
  [/change notification|바뀜 알림/i, "바뀜 알림(change notification)"],
  [/revert_run|run revert|run 되돌리기/, "run revert(session rewind로)"],
  [/Roles 화면|대화 dock/, "Roles 화면·대화 dock"],
  [/app-capability-api/, "app-capability-api(app-capability로)"],
  [/app-packages/, "app-packages(package-registry로)"],
  [/용어 후보/, "용어 후보(용어집으로)"],
];

const SOURCE = /\.(?:tsx?|js|css)$/;

// core daemon 진입점에서 import로 닿는 file(core main graph). child worker는 new URL로 띄워서 따라가지 않으니 graph 밖이다.
const CORE_MAIN_ENTRY = "packages/core/main/daemon/main.ts";
// 식별자 그대로의 fetch(와 globalThis.fetch. deps.fetch(처럼 property access로 주입받은 것은 걸리지 않는다.
// type 자리의 typeof globalThis.fetch는 호출이 아니라 모양이다.
const BARE_FETCH =
  /(?<![\w$.])fetch\s*\(|(?<!typeof\s)\bglobalThis\s*\.\s*fetch\b/;
// 이 check보다 먼저 있던 위반. file의 위반이 없어지면 검사가 목록에서 빼라고 알려준다.
const EXTERNAL_FETCH_LEFTOVERS: ReadonlyMap<string, string> = new Map([
  [
    "packages/core/apps/permissions/broker/net-fetch.ts",
    "못 고침: transport를 안 주면 globalThis.fetch로 떨어지는 기본값",
  ],
  [
    "packages/core/lophn-agent/run-loop/unwired.ts",
    "못 고침: 연결 안 된 runtime deps의 fetch가 전역 fetch를 그대로 넘긴다",
  ],
]);

// 줄에서 주석 부분. URL의 //는 앞에 공백이 없어 걸리지 않는다.
function commentOf(line: string): string | undefined {
  const text = line.trimStart();
  if (text.startsWith("*") || text.startsWith("/*")) return line;
  return /(?:^|\s)\/\/.*|\/\*.*/.exec(line)?.[0];
}

const TEST_NAME = /\b(?:Deno\.test|test|it|describe)\(\s*["'`]/;

// 문자열 literal은 같은 길이의 공백으로, 주석은 지워 줄 번호를 지킨 채 코드만 남긴다.
function codeOnly(source: string): string {
  let code = source;
  for (const { start, end } of readStringSites(source).reverse()) {
    code = code.slice(0, start) +
      code.slice(start, end).replace(/[^\n]/g, " ") +
      code.slice(end);
  }
  return code.replace(
    /\/\/.*|\/\*[\s\S]*?\*\//g,
    (comment) => comment.replace(/[^\n]/g, " "),
  );
}

// EXTERNAL_FETCH: core main graph의 네트워크는 인자로 받는다(AGENTS.md). 전역 fetch를 직접 부르면 test에서 바꿀 수 없다.
async function checkExternalFetch(
  root: string,
  files: string[],
  sources: Map<string, string>,
): Promise<Issue[]> {
  const members = await readMembers(root, files);
  const issues: Issue[] = [];
  const visited = new Set<string>();
  const hits = new Set<string>();
  const pending = [CORE_MAIN_ENTRY];
  while (pending.length) {
    const file = pending.pop()!;
    const source = sources.get(file);
    if (visited.has(file) || source === undefined) continue;
    visited.add(file);
    codeOnly(source).split("\n").forEach((line, index) => {
      if (BARE_FETCH.test(line)) {
        hits.add(file);
        if (EXTERNAL_FETCH_LEFTOVERS.has(file)) return;
        issues.push({
          file,
          line: index + 1,
          rule: "EXTERNAL_FETCH",
          message:
            "core main graph는 전역 fetch를 직접 쓰지 않는다. 주입받은 deps.fetch를 쓴다",
        });
      }
    });
    for (const { specifier } of readImports(source)) {
      const target = specifier.startsWith(".")
        ? normalize(`${directory(file)}/${specifier}`)
        : specifier.startsWith("@lophn/")
        ? resolveWorkspace(specifier, members)
        : undefined;
      if (target && !target.endsWith("_test.ts")) pending.push(target);
    }
  }
  for (const [file, reason] of EXTERNAL_FETCH_LEFTOVERS) {
    if (!hits.has(file)) {
      issues.push({
        file,
        line: 1,
        rule: "EXTERNAL_FETCH",
        message: `위반이 없다. EXTERNAL_FETCH_LEFTOVERS에서 뺀다 (${reason})`,
      });
    }
  }
  return issues;
}

export async function checkSource(root: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  const { files } = await walk(root);
  const sources = new Map<string, string>();
  for (const file of files) {
    if (!/^(?:packages|tools)\//.test(file) || !SOURCE.test(file)) continue;
    if (file === "tools/check-source.ts") continue;
    const text = await Deno.readTextFile(`${root}/${file}`);
    sources.set(file, text);
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      const at = (rule: string, message: string) =>
        issues.push({ file, line: index + 1, rule, message });
      const text = TEST_NAME.test(line) ? line : commentOf(line);
      if (text) {
        for (const [pattern, name] of NUMBERED) {
          if (pattern.test(text)) at("number", `주석·test 이름에 ${name} 금지`);
        }
      }
      for (const [pattern, name] of FORBIDDEN) {
        if (pattern.test(line)) at("term", `쓰지 않는 말: ${name}`);
      }
    });
  }
  issues.push(...await checkExternalFetch(root, files, sources));
  return issues;
}

if (import.meta.main) {
  try {
    const issues = await checkSource(Deno.args[0] ?? Deno.cwd());
    for (const i of issues) {
      console.error(`${i.file}:${i.line} [${i.rule}] ${i.message}`);
    }
    if (!issues.length) console.log("source: 통과");
    Deno.exit(issues.length ? 1 : 0);
  } catch (error) {
    console.error(
      `source: 검사 실패: ${error instanceof Error ? error.message : error}`,
    );
    Deno.exit(1);
  }
}
