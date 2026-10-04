// T10 core import 정적 검사. apps/core의 module graph(deno info --json)에서
// platform/responsiveness#R1의 core 흐름 경계를 확인한다: node:sqlite은 ledger
// 실행기만 쓰고, 동기 file API·압축·외부 fetch·앱/format/model 구현 import는
// graph 어디에도 없어야 한다. 동기 file·압축·fetch는 core의 command 흐름이
// 아니라 worker의 몫이므로, core로 들어온 import가 graph에 보이면 이 검사가
// 잡는다. R1의 동작 쪽 확인(30초 stop 동안의 응답)은 다른 테스트가 맡는다.

import { assert, assertEquals } from "@std/assert";

const REPO_ROOT = decodeURIComponent(
  new URL("../../../", import.meta.url).pathname,
);

type InfoSpan = { start?: { line?: number } };
type InfoDep = {
  specifier: string;
  code?: { specifier: string; span?: InfoSpan };
  type?: { specifier: string; span?: InfoSpan };
};
type InfoModule = {
  kind?: string;
  specifier?: string;
  dependencies?: InfoDep[];
};
type InfoFile = { modules: InfoModule[] };

type GraphDeps = {
  // repo 상대 경로의 local file 모듈.
  files: string[];
  // file → file import의 방향.
  imports: { from: string; to: string }[];
  // non-file specifier(node:·npm:·http:)를 직접 import한 local.
  specifierImports: { from: string; specifier: string }[];
  // graph에 나타난 non-file specifier 전부.
  specifiers: string[];
};

const LEDGER_EXECUTORS = "packages/platform/ledger/";
const FILE_SCHEME = "file://";

// core graph에서 허용되지 않는 specifier. 압축(node:zlib)과 외부 fetch(node:http
// 계열·undici)만 막는다. node:sqlite은 ledger 실행기 규칙이 따로 본다.
const OUTSIDE_MODULES = new Set([
  "node:zlib",
  "node:http",
  "node:https",
  "node:http2",
  "undici",
]);

// Deno와 node:fs의 동기 file API. node:sqlite의 DatabaseSync·StatementSync는
// class 이름이라 목록에 없고, ledger 실행기 규칙에서 허가된 boundary다.
const SYNC_FILE_API =
  /\b(?:readTextFileSync|readFileSync|writeTextFileSync|writeFileSync|appendFileSync|mkdirSync|mkdtempSync|makeTempDirSync|makeTempFileSync|removeSync|rmdirSync|rmSync|renameSync|readdirSync|readlinkSync|readLinkSync|realpathSync|realPathSync|statSync|lstatSync|fstatSync|truncateSync|ftruncateSync|unlinkSync|utimesSync|futimesSync|lutimesSync|utimeSync|copyFileSync|accessSync|chmodSync|fchmodSync|chownSync|fchownSync|lchownSync|linkSync|symlinkSync|openSync|closeSync|existsSync)\b/;

// core graph에 있으면 안 되는 압축 token과 외부 fetch token. fetch는 주입한
// port client(options.fetch)의 속성으로도 쓰이므로 속성 access 앞의 fetch는
// 외부 호출로 세지 않는다.
const COMPRESSION =
  /\b(?:zlib|brotli|gzip|gunzip|deflate|inflate|CompressionStream|DecompressionStream)\b/;
const EXTERNAL_FETCH = /(?<![\w.$])fetch\s*\(/;

// format 구���(documents/formats), model 구현(lophn-agent), 앱 실행 구현의 code를
// core가 import하지 않는다. format 처리는 문서 worker가, model 호출은 lophn agent
// 프로세스가, 앱 실행은 앱 프로세스가 맡는다. core ledger command인 apps
// 모듈(registration 등록 포함)은 T9 registry 계약대로 graph에 있어도 된다(Q3).
const IMPLEMENTATION_PREFIXES = [
  "packages/apps/entrypoint/",
  "packages/apps/runtime/entrypoint/",
  "packages/apps/invocations/context.ts",
  "packages/apps/automations/clock.ts",
  "packages/apps/agent-context/redaction.ts",
  "packages/apps/connections/client.ts",
  "packages/documents/formats/",
  "packages/lophn-agent/",
];

function isImplementationImport(path: string): boolean {
  return IMPLEMENTATION_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    (path.startsWith("apps/") && !path.startsWith("apps/core/"));
}

// 문자열·주석을 먼저 지워 token을 code로만 본다. template literal 본문도 text로
// 지우므로 `${}` 안의 token은 못 본다. 이 검사는 graph에 다시 들어온 무거운
// import를 잡는 tripwire라 그 한계를 받는다.
function codeOnly(source: string): string {
  return source
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, " ")
    .replace(/'(?:\\.|[^'\\\n])*'/g, " ")
    .replace(/"(?:\\.|[^"\\\n])*"/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

function toLocal(specifier: string): string | undefined {
  if (!specifier.startsWith(FILE_SCHEME)) return undefined;
  const local = decodeURIComponent(specifier.slice(FILE_SCHEME.length));
  return local.startsWith(REPO_ROOT)
    ? local.slice(REPO_ROOT.length)
    : undefined;
}

function depTarget(dep: InfoDep): string {
  return dep.code?.specifier ?? dep.type?.specifier ?? dep.specifier;
}

async function runInfo(): Promise<InfoFile> {
  const command = new Deno.Command("deno", {
    args: ["info", "--json", "apps/core/main.ts"],
    cwd: REPO_ROOT,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  assert(
    code === 0,
    `deno info --json apps/core/main.ts 실패(code ${code}): ${
      new TextDecoder().decode(stderr)
    }`,
  );
  return JSON.parse(new TextDecoder().decode(stdout)) as unknown as InfoFile;
}

// graph를 테스트끼리 한 번만 얻는다.
let graph: Promise<GraphDeps> | undefined;

function graphDeps(): Promise<GraphDeps> {
  graph ??= (async () => {
    const parsed = await runInfo();
    const files: string[] = [];
    const imports: { from: string; to: string }[] = [];
    const specifierImports: { from: string; specifier: string }[] = [];
    const specifiers = new Set<string>();
    for (const module of parsed.modules) {
      const from = toLocal(module.specifier ?? "");
      if (from === undefined) {
        if (module.specifier) specifiers.add(module.specifier);
        continue;
      }
      files.push(from);
      for (const dep of module.dependencies ?? []) {
        const target = depTarget(dep);
        const local = toLocal(target);
        if (local === undefined) {
          if (!target.startsWith(FILE_SCHEME)) {
            specifiers.add(target);
            specifierImports.push({ from, specifier: target });
          }
          continue;
        }
        imports.push({ from, to: local });
      }
    }
    return {
      files,
      imports,
      specifierImports,
      specifiers: [...specifiers],
    };
  })();
  return graph;
}

let sources: Promise<Map<string, string>> | undefined;

function moduleSources(files: string[]): Promise<Map<string, string>> {
  sources ??= (async () => {
    const read = new Map<string, string>();
    for (const path of files) {
      read.set(path, await Deno.readTextFile(`${REPO_ROOT}${path}`));
    }
    return read;
  })();
  return sources;
}

Deno.test(
  "platform/responsiveness#R1: core module graph의 node:sqlite은 ledger 실행기만 import한다",
  async () => {
    const deps = await graphDeps();
    const offenders = deps.specifierImports
      .filter(({ specifier }) => specifier === "node:sqlite")
      .filter(({ from }) => !from.startsWith(LEDGER_EXECUTORS))
      .map(({ from }) => `${from}: node:sqlite`);
    assertEquals(
      offenders,
      [],
      "node:sqlite을 ledger 실행기 밖에서 import했다",
    );
  },
);

Deno.test(
  "platform/responsiveness#R1: core module graph에 동기 file API가 없다",
  async () => {
    const deps = await graphDeps();
    const read = await moduleSources(deps.files);
    const offenders: string[] = [];
    for (const [path, source] of read) {
      const match = SYNC_FILE_API.exec(codeOnly(source));
      if (match) offenders.push(`${path}: ${match[0]}`);
    }
    assertEquals(offenders, [], "core graph에 동기 file API가 있다");
  },
);

Deno.test(
  "platform/responsiveness#R1: core module graph에 압축과 외부 fetch가 없다",
  async () => {
    const deps = await graphDeps();
    const read = await moduleSources(deps.files);
    const offenders: string[] = [];
    for (const specifier of deps.specifiers) {
      if (OUTSIDE_MODULES.has(specifier)) offenders.push(specifier);
    }
    for (const [path, source] of read) {
      const code = codeOnly(source);
      const compressed = COMPRESSION.exec(code);
      if (compressed) offenders.push(`${path}: ${compressed[0]}`);
      const fetched = EXTERNAL_FETCH.exec(code);
      if (fetched) offenders.push(`${path}: ${fetched[0]}`);
    }
    assertEquals(
      offenders,
      [],
      "core graph에 압축이나 외부 fetch가 있다",
    );
  },
);

Deno.test(
  "platform/responsiveness#R1: core module graph는 앱·format·model 구현을 import하지 않는다",
  async () => {
    const deps = await graphDeps();
    const offenders = deps.imports
      .filter(({ to }) => isImplementationImport(to))
      .map(({ from, to }) => `${from} → ${to}`);
    assertEquals(offenders, [], "core가 앱·format·model 구현을 import했다");
  },
);
