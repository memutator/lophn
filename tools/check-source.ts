// 소스 낱말 검사: 주석과 test 이름의 옛 요구 ID·작업 번호, 쓰지 않는 말.
// 실행: node tools/check-source.ts [root]
// 이름과 경로의 판·단계·작업 번호는 check-deps.ts가 본다.
import { readFile } from "node:fs/promises";
import process from "node:process";

import { SHELL_ROUTES } from "../packages/shell/main/desktop/core/routes.ts";
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
  [/workspace 없는 문서/, "workspace 없는 문서"],
  [/series registry/i, "series registry"],
  [/change notification|바뀜 알림/i, "바뀜 알림(change notification)"],
  [/revert_run|run revert|run 되돌리기/, "run revert(session rewind로)"],
  [/Roles 화면|대화 dock/, "Roles 화면·대화 dock"],
  [/app-capability-api/, "app-capability-api(app-capability로)"],
  [/app-packages/, "app-packages(package-registry로)"],
  [/용어 후보/, "용어 후보(용어집으로)"],
];

// import.meta.url에서 URL.pathname으로 path를 얻으면 Windows에서 `/C:/…`가 되고 공백·한글이 %-인코딩된 채 남는다. 줄이 나뉘어도 잡도록 file 전체에서 본다.
const META_URL_PATHNAME = /import\.meta\.url\s*,?\s*\)\s*\.pathname/g;

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
    "packages/core/main/daemon/wiring/remote.ts",
    "못 고침: push sender(Expo Push)에 넘기는 core의 외부 fetch. CoreOptions로 주입받게 하면 지워진다",
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

const TEST_NAME = /\b(?:test|it|describe)\(\s*["'`]/;

// 문자열 literal은 같은 길이의 공백으로, 주석은 지워 줄 번호를 지킨 채 코드만 남긴다.
function codeOnly(source: string): string {
  let code = source;
  for (const { start, end } of readStringSites(source).reverse()) {
    code =
      code.slice(0, start) +
      code.slice(start, end).replace(/[^\n]/g, " ") +
      code.slice(end);
  }
  return code.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " "),
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
    codeOnly(source)
      .split("\n")
      .forEach((line, index) => {
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

// SHELL_ROUTE: shell(main·renderer)가 core route를 문자열(kind, resource, method)로 부르는데 protocol의 route 목록(SHELL_ROUTES)에 없는 짝이면 type check가 못 본다.
// 읽는 꼴(문자열 literal이 쉼표로 이어진 줄을 호출 이름 바로 뒤에서 찾는다. 줄이 나뉘거나 제네릭이 끼어도 된다):
// - call·internal·coreInternal("read", "apps", "get", …): kind가 첫 인자
// - read·memory·command·upload<T>("skills", "read", …): kind가 호출 이름
// - fileStream("apps", "screen_file", …): file route
// - "memory:settings/list" 같은 이름 문자열(renderer 허용 목록)
// 못 읽는 꼴: kind나 resource, method가 변수인 호출(`internal(kind, …)`), link.command(route, …)처럼 route 객체를 넘기는 호출(type이 본다).
const SHELL_ROUTE_ROOTS = /^packages\/shell\/(?:main|renderer)\//;
const ROUTE_NAMES = new Set(
  SHELL_ROUTES.map((r) => `${r.kind}:${r.resource}/${r.method}`),
);
const KIND_FIRST = ["call", "internal", "coreInternal"];
const KIND_BY_CALLEE: Record<string, string> = {
  read: "read",
  memory: "memory",
  command: "command",
  upload: "upload",
  fileStream: "file",
};
const ROUTE_KINDS = ["command", "read", "file", "memory", "upload"];
const CALLEE = new RegExp(
  `(?<![\\w$])(${[...KIND_FIRST, ...Object.keys(KIND_BY_CALLEE)].join(
    "|",
  )})\\s*(?:<[\\s\\S]*?>)?\\s*\\(\\s*$`,
);
const ROUTE_NAME = new RegExp(`^(?:${ROUTE_KINDS.join("|")}):[\\w-]+/[\\w-]+$`);
function checkShellRoutes(file: string, source: string): Issue[] {
  const sites = readStringSites(source);
  const calls: { name: string; line: number }[] = [];
  for (let i = 0; i < sites.length; i++) {
    const first = sites[i];
    if (ROUTE_NAME.test(first.specifier)) {
      calls.push({ name: first.specifier, line: first.line });
    }
    if (
      i > 0 &&
      /^\s*,\s*$/.test(source.slice(sites[i - 1].end, first.start))
    ) {
      continue;
    }
    const callee = CALLEE.exec(
      source.slice(Math.max(0, first.start - 400), first.start),
    )?.[1];
    if (!callee) continue;
    const run = [first.specifier];
    for (let j = i + 1; j < sites.length; j++) {
      if (!/^\s*,\s*$/.test(source.slice(sites[j - 1].end, sites[j].start))) {
        break;
      }
      run.push(sites[j].specifier);
    }
    const [kind, resource, method] = KIND_FIRST.includes(callee)
      ? run
      : [KIND_BY_CALLEE[callee], ...run];
    if (!ROUTE_KINDS.includes(kind) || method === undefined) continue;
    calls.push({ name: `${kind}:${resource}/${method}`, line: first.line });
  }
  return calls
    .filter((c) => !ROUTE_NAMES.has(c.name))
    .map((c) => ({
      file,
      line: c.line,
      rule: "SHELL_ROUTE",
      message: `protocol에 없는 route를 부른다: ${c.name}`,
    }));
}

// NATIVE_TITLE: 화면의 hover 설명은 @lophn/ui의 Tooltip으로 쓴다. DOM의 title 속성, svg <title>은 native tooltip이라 지연·모양이 따로 놀고 접근성 이름과도 섞인다.
// 읽는 꼴: 소문자 JSX tag(DOM)의 title 속성. 대문자 component의 title prop은 DOM이 아니니 본다. document.title은 창 제목이다.
const NATIVE_TITLE_ROOTS =
  /^(?:packages\/shell\/renderer|packages\/design\/components|packages\/sdk|tools\/wireframes)\//;
const NATIVE_TITLE_TAG_LINES = 30;
const NATIVE_TITLE_ALLOWED: ReadonlyMap<string, string> = new Map([
  [
    "tools/wireframes/gallery.tsx",
    "화면 틀을 담은 iframe의 title은 tooltip이 아니라 접근성 이름이다",
  ],
]);

// 주석을 같은 길이의 공백으로 바꿔 줄 번호를 지킨다. 문자열은 그대로 둔다(setAttribute("title")를 봐야 한다).
function withoutComments(source: string): string {
  return source.replace(/(?:^|\s)\/\/.*|\/\*[\s\S]*?\*\//gm, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );
}

// 줄 안에 title 속성이 있는 DOM tag. `<tag`에서 닫는 `>`까지 `{}` 깊이를 세며 걷는다(속성은 여러 줄이고 `=>`를 품는다).
function titleAttributeLines(code: string): number[] {
  const found: number[] = [];
  for (const open of code.matchAll(/(?<![\w$\])/])<([a-z][\w-]*)(?=[\s/>])/g)) {
    const start = open.index!;
    const line = code.slice(0, start).split("\n").length;
    if (open[1] === "title") found.push(line);
    let depth = 0;
    let lines = 0;
    for (let i = start + open[0].length; i < code.length; i++) {
      const char = code[i];
      if (char === "\n" && ++lines > NATIVE_TITLE_TAG_LINES) break;
      if (char === '"' || char === "'" || (char === "`" && depth > 0)) {
        i++;
        while (i < code.length && code[i] !== char) {
          if (code[i] === "\\" && depth > 0) i++;
          i++;
        }
      } else if (char === "{") depth++;
      else if (char === "}") {
        if (--depth < 0) break;
      } else if (depth === 0 && char === ">") break;
      else if (
        depth === 0 &&
        /\s/.test(code[i - 1] ?? "") &&
        /^title\s*=(?![=>])/.test(code.slice(i, i + 12))
      ) {
        found.push(line + lines);
        break;
      }
    }
  }
  return found;
}

function checkNativeTitle(file: string, source: string): Issue[] {
  const code = withoutComments(source);
  const at = (line: number, message: string): Issue => ({
    file,
    line,
    rule: "NATIVE_TITLE",
    message,
  });
  const issues: Issue[] = [];
  if (file.endsWith(".tsx")) {
    for (const line of titleAttributeLines(code)) {
      issues.push(
        at(
          line,
          "DOM tag의 title은 native tooltip이다. @lophn/ui/overlay의 Tooltip을 쓰거나 뺀다(이름이면 aria-label)",
        ),
      );
    }
  }
  code.split("\n").forEach((text, index) => {
    if (
      /(?<!document)\.title\s*=(?![=>])|\.setAttribute\(\s*["'`]title["'`]/.test(
        text,
      )
    ) {
      issues.push(
        at(index + 1, "DOM의 title을 코드로 쓰지 않는다. Tooltip을 쓴다"),
      );
    }
  });
  return issues;
}

export async function checkSource(root: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  const { files } = await walk(root);
  const sources = new Map<string, string>();
  for (const file of files) {
    if (!/^(?:packages|tools)\//.test(file) || !SOURCE.test(file)) continue;
    if (file === "tools/check-source.ts") continue;
    const text = await readFile(`${root}/${file}`, "utf8");
    sources.set(file, text);
    if (file.startsWith("packages/")) {
      for (const match of text.matchAll(META_URL_PATHNAME)) {
        issues.push({
          file,
          line: text.slice(0, match.index).split("\n").length,
          rule: "meta-url-pathname",
          message: "import.meta.url의 .pathname 대신 fileURLToPath를 쓴다",
        });
      }
    }
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
  issues.push(...(await checkExternalFetch(root, files, sources)));
  const titleHits = new Set<string>();
  for (const [file, source] of sources) {
    if (!NATIVE_TITLE_ROOTS.test(file)) continue;
    const found = checkNativeTitle(file, source);
    if (found.length) titleHits.add(file);
    if (!NATIVE_TITLE_ALLOWED.has(file)) issues.push(...found);
  }
  for (const [file, reason] of NATIVE_TITLE_ALLOWED) {
    if (sources.has(file) && !titleHits.has(file)) {
      issues.push({
        file,
        line: 1,
        rule: "NATIVE_TITLE",
        message: `위반이 없다. NATIVE_TITLE_ALLOWED에서 뺀다 (${reason})`,
      });
    }
  }
  for (const [file, source] of sources) {
    if (!SHELL_ROUTE_ROOTS.test(file) || /_test\.tsx?$/.test(file)) continue;
    issues.push(...checkShellRoutes(file, source));
  }
  return issues;
}

if (import.meta.main) {
  try {
    const issues = await checkSource(process.argv[2] ?? process.cwd());
    for (const i of issues) {
      console.error(`${i.file}:${i.line} [${i.rule}] ${i.message}`);
    }
    if (!issues.length) console.log("source: 통과");
    process.exit(issues.length ? 1 : 0);
  } catch (error) {
    console.error(
      `source: 검사 실패: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}
