// T10 core import 정적 검사. packages/core/main/daemon/main.ts의 module graph(deno info --json)에서
// platform/responsiveness#R1의 core 흐름 경계를 확인한다: node:sqlite은 ledger
// 실행기만 쓰고, 동기 file API·압축·외부 fetch·앱/format/model 구현 import는
// graph 어디에도 없어야 한다. 동기 file·압축·fetch는 core의 command 흐름이
// 아니라 worker의 몫이므로, core로 들어온 import가 graph에 보이면 이 검사가
// 잡는다. R1의 동작 쪽 확인(30초 stop 동안의 응답)은 다른 테스트가 맡는다.

import { assert, assertEquals } from "@std/assert";

const REPO_ROOT = decodeURIComponent(
  new URL("../../../../", import.meta.url).pathname,
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

const LEDGER_EXECUTORS = "packages/core/storage/ledger/";
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

// format 구현(guest 계산, module 묶음, runner client), model 구현(lophn-agent),
// 앱 실행 구현의 code를 core가 import하지 않는다. format 처리는 문서 worker가,
// model 호출은 lophn agent 프로세스가, 앱 실행은 앱 프로세스가 맡는다. core가
// 여는 내장 format read(declaration·module_hash)는 T4 registry 계약대로
// declaration 모듈만 graph에 있어도 된다(Q10). core ledger command인 apps
// 모듈(registration 등록 포함)은 T9 registry 계약대로 graph에 있어도 된다(Q3).
// lophn-agent의 ledger registration 모듈(harness/provider의 command·read·schema)도
// core가 조립한다(architecture/lophn-agent 3.1). runtime 쪽 코드만 거르는다.
const IMPLEMENTATION_PREFIXES = [
  "packages/core/apps/entrypoint/",
  "packages/core/apps/runtime/entrypoint/",
  "packages/core/apps/invocations/context.ts",
  "packages/core/apps/automations/clock.ts",
  "packages/core/apps/agent-context/redaction.ts",
  "packages/core/apps/connections/client.ts",
  "packages/core/projects/formats/adapters/",
  "packages/core/projects/formats/check.ts",
  "packages/core/projects/formats/guest/bundle.ts",
  "packages/core/projects/formats/guest.ts",
  "packages/core/projects/formats/modules/",
  "packages/core/projects/formats/pure/input.ts",
  "packages/core/projects/formats/pure/module.ts",
  "packages/core/projects/formats/pure/utf8.ts",
  "packages/core/projects/formats/reads.ts",
  "packages/core/projects/formats/runner/",
  "packages/core/projects/formats/work.ts",
  "packages/core/lophn-agent/roles/",
];

// 자식 프로세스 입구와 그 자식만 쓰는 code. core 프로세스의 graph에 들어오면
// 안 된다. 옛 apps/ 아래 core 밖 앱(agent-runtime·app-supervisor·worker·shell·
// cli·mcp)이 있던 자리다.
const CHILD_PROCESS_PREFIXES = [
  "packages/core/main/agent-runtime/",
  "packages/core/main/app-supervisor/",
  "packages/core/main/worker/",
  "packages/core/problems/tests/work/",
  "packages/core/apps/releases/worker/",
  "packages/core/apps/revert/worker/",
  "packages/core/apps/tickets/worker/",
  "packages/core/config/worker/",
  "packages/core/diagnostics/worker/",
  "packages/core/problems/repairs/worker/",
  "packages/core/problems/reporting/worker/",
  "packages/core/projects/contexts/worker/",
  "packages/core/projects/file-tracking/worker/",
  "packages/core/projects/formats/worker/",
  "packages/core/projects/outline-and-search/worker/",
  "packages/core/secrets/worker/",
  "packages/core/storage/blobs/worker/",
  "packages/core/apps/data/worker/run.ts",
  "packages/shell/",
  "packages/coding-agent/cli/",
  "packages/coding-agent/mcp-server/main.ts",
  "packages/core/lophn-agent/agents/layers.ts",
  "packages/core/lophn-agent/session/answer-links.ts",
  "packages/core/lophn-agent/tools/app-toolkit.ts",
  "packages/core/lophn-agent/tool-judgment/builtin-binding.ts",
  "packages/core/lophn-agent/models/catalog-refresh.ts",
  "packages/core/lophn-agent/session/compactor.ts",
  "packages/core/lophn-agent/prompt-assembly/context-overview.ts",
  "packages/core/lophn-agent/tools/context-search.ts",
  "packages/core/lophn-agent/run-loop/core-call.ts",
  "packages/core/lophn-agent/run-loop/core-ports.ts",
  "packages/core/lophn-agent/extensions/mcp-toolkit.ts",
  "packages/core/lophn-agent/models/binding.ts",
  "packages/core/lophn-agent/run-loop/prepare.ts",
  "packages/core/lophn-agent/providers/watch.ts",
  "packages/core/lophn-agent/run-loop/redact-link.ts",
  "packages/core/lophn-agent/models/resolve.ts",
  "packages/core/lophn-agent/run-loop/blobs.ts",
  "packages/core/lophn-agent/run-loop/driver.ts",
  "packages/core/lophn-agent/session/history.ts",
  "packages/core/lophn-agent/extensions/skill-folders.ts",
  "packages/core/lophn-agent/tools/toolkit.ts",
  "packages/core/lophn-agent/waiting-and-recovery/wait-request.ts",
  "packages/core/apps/invocations/delivery/sender.ts",
];

function isChildProcessCode(path: string): boolean {
  return CHILD_PROCESS_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isImplementationImport(path: string): boolean {
  return IMPLEMENTATION_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    isChildProcessCode(path);
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
    args: ["info", "--json", "packages/core/main/daemon/main.ts"],
    cwd: REPO_ROOT,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  assert(
    code === 0,
    `deno info --json packages/core/main/daemon/main.ts 실패(code ${code}): ${
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
