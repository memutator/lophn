// 실행: node tools/check-deps.ts [root]
import { readdir, readFile } from "node:fs/promises";
import process from "node:process";

import { checkDeclarationGraph } from "./deps-declaration.ts";
import { readImports } from "./deps-imports.ts";
import {
  directory,
  inside,
  normalize,
  readMembers,
  resolveWorkspace,
} from "./deps-workspace.ts";

type Violation = {
  file: string;
  line: number;
  rule: string;
  message: string;
};
// build는 `.deb` 준비가 낸 source 사본이다(gitignore). 옛 판 사본이 지금 workspace와 다를 수 있다.
const EXCLUDED = new Set([
  "node_modules",
  ".claude",
  ".dev-data",
  "dist",
  "build",
]);

// package가 import해도 되는 다른 package. 자기 package 안은 늘 된다.
export const PACKAGE_DEPENDENCIES: Record<string, string[]> = {
  base: [],
  protocol: ["base"],
  core: ["protocol", "base", "cli"],
  cli: ["protocol", "base"],
  "coding-agent": ["protocol", "base"],
  design: [],
  sdk: ["protocol", "design"],
  shell: ["protocol", "base", "design"],
};
// shell main의 terminal host만 coding-agent를 더 쓸 수 있다.
const TERMINAL_HOST = [
  "packages/shell/terminal-host",
  "packages/shell/main/terminal",
];
// core가 packages/cli에서 가져올 수 있는 것은 명령 표(commands/)와 parser·help뿐이다. binary 입구(main.ts)와 connection/,
// 출력(output.ts)은 node 전용이고 HTTP client·harness code를 끌어와서 agent runtime에 실리면 안 된다.
// 반대로 core가 가져오는 쪽(commands/, parser.ts, help.ts)도 그것들을 import하지 않는다.
const CLI_FOR_CORE = [
  "packages/cli/commands/",
  "packages/cli/parser.ts",
  "packages/cli/help.ts",
];
const CLI_BINARY_ONLY = [
  "packages/cli/main.ts",
  "packages/cli/connection/",
  "packages/cli/output.ts",
];
// 폴더("/"로 끝)는 그 아래 전부, 아니면 그 file이다.
const cliHit = (path: string, list: readonly string[]) =>
  list.some((x) => (x.endsWith("/") ? path.startsWith(x) : path === x));
// 본체 안 extension 폴더의 code는 ctx로만 lophn에 닿는다(protocol/extensions의 ExtensionContext). shell main 내부와 electron을
// import하지 못하고 protocol, base, 자기 폴더만 쓴다. 따로 받는 package로 옮겨도 구조가 같도록 하는 규칙이다.
const EXTENSION_DIR = "packages/shell/main/extensions/bundled/";
function extensionViolation(
  file: string,
  specifier: string,
  target: string | undefined,
): string | undefined {
  if (!file.startsWith(EXTENSION_DIR)) return;
  if (specifier === "electron" || specifier.startsWith("electron/")) {
    return `extension은 electron을 import하지 않고 ctx로만 닿는다: ${specifier}`;
  }
  if (!target) return;
  return target.startsWith("packages/protocol/") ||
    target.startsWith("packages/base/") ||
    target.startsWith(
      `${EXTENSION_DIR}${file.slice(EXTENSION_DIR.length).split("/")[0]}/`,
    )
    ? undefined
    : `extension은 protocol, base, 자기 폴더만 import: ${specifier}`;
}

// 앱 process 진입점만 sdk를 더 쓸 수 있다. 앱 code보다 먼저 cap-problem의 exception observer를 건다.
const APP_ENTRYPOINT = "packages/core/apps/runtime/entrypoint";

export async function walk(
  root: string,
): Promise<{ files: string[]; paths: string[] }> {
  const files: string[] = [];
  const paths: string[] = [];
  async function visit(parent: string) {
    for (const entry of await readdir(parent ? `${root}/${parent}` : root, {
      withFileTypes: true,
    })) {
      if (EXCLUDED.has(entry.name)) continue;
      const path = parent ? `${parent}/${entry.name}` : entry.name;
      paths.push(path);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit("");
  return { files: files.sort(), paths: paths.sort() };
}

// test는 제품 module graph에 들지 않아 base·protocol의 test도 runtime의 test 도구를 쓴다.
const PORTABLE_TEST_IMPORTS: ReadonlySet<string> = new Set([
  "node:test",
  "node:assert/strict",
]);

function numberedName(segment: string): boolean {
  const name = segment.replace(/\.[^.]+$/, "").replace(/_test$/, "");
  return (
    name
      .split(/[-.]/)
      .some((token) => /^(?:v\d+|[mw]\d+|milestone\d*)$/i.test(token)) ||
    /^phase-?\d*$/i.test(name) ||
    /^(?:new|old|legacy)-/i.test(name) ||
    /-next$/i.test(name)
  );
}

// core 안 층. 바닥(그 밖 전부) < harness(lophn-agent) < workspace 층(agent-workspaces)·feature module(projects, apps, runs) < main(조립).
// harness와 바닥은 workspace 층과 feature module을 모르고, workspace 층과 feature module은 서로 모른다. 둘 다 harness는 쓸 수 있다.
// feature module끼리는 서로 import하지 않는다(project-docs/architecture/layers.md).
const CORE_HARNESS = "lophn-agent";
const CORE_WORKSPACES = "agent-workspaces";
const CORE_FEATURES = new Set([
  "projects",
  "apps",
  "runs",
  "workflows",
  "jobs",
]);
function coreModule(path: string): string | undefined {
  const parts = path.split("/");
  return parts[0] === "packages" && parts[1] === "core" && parts.length > 3
    ? parts[2]
    : undefined;
}
function coreLayerViolation(file: string, target: string): string | undefined {
  const from = coreModule(file);
  const to = coreModule(target);
  if (!from || !to || from === to) return;
  if (from !== "main" && to === "main") {
    return `module은 core/main을 import하지 않는다: ${from} → main`;
  }
  const upper = (name: string) =>
    name === CORE_HARNESS ||
    name === CORE_WORKSPACES ||
    CORE_FEATURES.has(name);
  if (from !== "main" && !upper(from) && upper(to)) {
    return `바닥은 ${CORE_HARNESS}, ${CORE_WORKSPACES}, feature module을 import하지 않는다: ${from} → ${to}`;
  }
  if (
    from === CORE_HARNESS &&
    (to === CORE_WORKSPACES || CORE_FEATURES.has(to))
  ) {
    return `${CORE_HARNESS}는 ${CORE_WORKSPACES}와 feature module을 import하지 않는다: ${from} → ${to}`;
  }
  if (
    (from === CORE_WORKSPACES && CORE_FEATURES.has(to)) ||
    (CORE_FEATURES.has(from) && to === CORE_WORKSPACES)
  ) {
    return `feature module과 ${CORE_WORKSPACES}는 서로 import하지 않는다: ${from} → ${to}`;
  }
  if (CORE_FEATURES.has(from) && CORE_FEATURES.has(to)) {
    return `feature module끼리는 서로 import하지 않는다: ${from} → ${to}`;
  }
}

// harness 폴더가 feature module의 protocol을 아는 것(rule harness-domain). 앞 task가 못 끊은 file은 이유와 함께 면제한다.
// 목록 file이 위반을 다 없애면 검사가 빼라고 알려준다.
const HARNESS_DIR = `packages/core/${CORE_HARNESS}/`;
const HARNESS_FEATURE_PROTOCOLS = [
  "apps",
  "problems",
  "projects",
  "coding-agent",
];
const HARNESS_LEFTOVERS: ReadonlyMap<string, string> = new Map([
  [
    "packages/core/lophn-agent/run-loop/runtime-access.ts",
    "못 옮김: agent runtime이 열 core route 목록이 apps protocol의 route 값을 직접 import한다",
  ],
  [
    "packages/core/lophn-agent/tools/file/outline.ts",
    "못 옮김: file.outline이 projects protocol의 parseOutline으로 md 제목 tree를 만든다",
  ],
  [
    "packages/core/lophn-agent/extensions/skill-folders.ts",
    "못 옮김: 공유 skill 받기가 apps protocol의 appSkills로 할당한 앱의 public skill 본문을 읽는다",
  ],
  [
    "packages/core/lophn-agent/tools/app-toolkit.ts",
    "못 옮김: 동적 tool 묶음이 apps protocol의 appTools를 읽는다",
  ],
  [
    "packages/core/lophn-agent/tools/app-tool/command.ts",
    "못 옮김: 앱 command의 호출 정의가 apps protocol의 app runtime·AppTools를 쓴다",
  ],
  [
    "packages/core/lophn-agent/tools/file/image.ts",
    "못 옮김: file.image가 apps protocol의 annotationsGet으로 annotation 이미지를 읽는다",
  ],
  [
    "packages/core/lophn-agent/tools/file/read.ts",
    "못 옮김: file.read가 projects protocol의 openableKind로 열 수 있는 형식을 고른다",
  ],
]);

// tool 정의 file은 agent runtime child에서 실려서 store·DB 코드를 끌어오면 안 된다(rule tool-file).
const FEATURE_TOOL_WORKSPACES = ["packages/core/apps/agent-tools/"];
const WORKSPACE_TOOL_DIR = `packages/core/${CORE_WORKSPACES}/tools/`;
const SPI = `packages/core/${CORE_HARNESS}/tools/spi.ts`;
function toolFileViolation(
  file: string,
  specifier: string,
  target: string | undefined,
): string | undefined {
  const workspace = FEATURE_TOOL_WORKSPACES.find((path) =>
    file.startsWith(path),
  );
  const workspaceTool = file.startsWith(WORKSPACE_TOOL_DIR);
  if (!workspace && !workspaceTool) return;
  if (specifier === "node:sqlite") return "node:sqlite를 import하지 않는다";
  if (!target) return;
  if (target.startsWith("packages/core/storage/")) {
    return `storage를 import하지 않는다: ${specifier}`;
  }
  if (workspaceTool) {
    return target.startsWith(`packages/core/${CORE_WORKSPACES}/`) &&
      /\/(?:store|ledger|register)(?:[-./]|$)/.test(target)
      ? `store·ledger·register를 import하지 않는다: ${specifier}`
      : undefined;
  }
  const ok =
    target === SPI ||
    target.startsWith("packages/base/") ||
    target.startsWith("packages/protocol/") ||
    target.startsWith(workspace!);
  return ok
    ? undefined
    : `feature module의 tool 정의 file은 base, protocol, 같은 폴더, ${CORE_HARNESS}/tools/spi.ts만 import: ${specifier}`;
}

function harnessProtocol(file: string, target: string): string | undefined {
  if (!file.startsWith(HARNESS_DIR)) return;
  const top = HARNESS_FEATURE_PROTOCOLS.find((name) =>
    target.startsWith(`packages/protocol/${name}/`),
  );
  return top && `protocol/${top} import`;
}

function protocolTop(file: string): string | undefined {
  if (!file.startsWith("packages/protocol/")) return;
  const parts = file.split("/");
  return parts.length > 3 ? parts[2] : undefined;
}

type Edge = { from: string; to: string; file: string; line: number };
function cyclicEdges(edges: Edge[]): Edge[] {
  const graph = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!graph.has(edge.from)) graph.set(edge.from, new Set());
    graph.get(edge.from)!.add(edge.to);
  }
  function reaches(
    from: string,
    goal: string,
    seen = new Set<string>(),
  ): boolean {
    if (from === goal) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return [...(graph.get(from) ?? [])].some((to) => reaches(to, goal, seen));
  }
  return edges.filter((edge) => reaches(edge.to, edge.from));
}

// 새 계약으로 바뀌어 곧 지울 옛 file이다. 이 file의 import는 protocol 순환에 세지 않는다.
// 쓰는 곳을 걷고 file을 지우면 여기서도 뺀다. cleanup 때 이 목록은 비어야 한다.
const LEAVING_FILES = new Set(["packages/protocol/server/registration.ts"]);

// annotation 입력과 lophn agent 계약이 AgentId를 함께 쓴다. workspaces.ts는 base만 import하므로 실행 순환이 아니다.
// extensions의 ACP handle은 acp의 type만 import한다. lophn-agent/harness-host.ts가 extensions의 extensionSettingKey를
// 쓰지만 type import는 실행 순환이 아니다. harness-host가 그 함수를 config 쪽에서 받게 되면 이 둘을 뺀다.
const PROTOCOL_CYCLE_EXCEPTIONS = new Set([
  "packages/protocol/apps/annotation.ts\0../lophn-agent/workspaces.ts",
  "packages/protocol/extensions/acp-session.ts\0../acp/input.ts",
  "packages/protocol/extensions/acp-session.ts\0../acp/state.ts",
]);

export async function checkRepo(root: string): Promise<Violation[]> {
  root = normalize(root.startsWith("/") ? root : `${process.cwd()}/${root}`);
  const { files, paths } = await walk(root);
  const members = await readMembers(root, files);
  const violations: Violation[] = [];
  const edges: Edge[] = [];
  const sources = new Map<string, string>();
  const harnessHits = new Set<string>();
  const add = (file: string, line: number, rule: string, message: string) =>
    violations.push({ file, line, rule, message });
  const harness = (file: string, line: number, what: string) => {
    harnessHits.add(file);
    if (!HARNESS_LEFTOVERS.has(file)) {
      add(
        file,
        line,
        "harness-domain",
        `${CORE_HARNESS}는 feature module의 protocol을 모른다: ${what}`,
      );
    }
  };

  for (const path of paths) {
    if (!/^(packages|tools)\//.test(path)) continue;
    // 내장 skill 폴더 이름은 사람이 `/`로 치는 이름(`new-app`)이라 판 이름이 아니다.
    if (path.startsWith("packages/core/agent-workspaces/skills/")) continue;
    const segment = path.slice(path.lastIndexOf("/") + 1);
    if (numberedName(segment)) {
      add(path, 1, "name", `판·단계·작업 번호 이름 금지: ${segment}`);
    }
  }
  for (const file of files) {
    const own =
      file.split("/")[0] === "packages" ? file.split("/")[1] : undefined;
    const portable = own === "base" || own === "protocol";
    if (!/\.tsx?$/.test(file)) continue;
    const test = file.endsWith("_test.ts");
    // test 코드는 package 규칙에서 뺀다. 여러 package를 같이 띄우는 통합 test가 있어서다.
    // core를 import하는 것만은 test도 core 안에서만 한다.
    const testCode =
      /_test\.tsx?$/.test(file) || /\/(?:testing|testdata)\//.test(file);
    const source = await readFile(`${root}/${file}`, "utf8");
    sources.set(file, source);
    for (const { specifier, line } of readImports(source)) {
      const relative =
        specifier.startsWith("./") || specifier.startsWith("../");
      const absoluteTarget = relative
        ? normalize(`${root}/${directory(file)}/${specifier}`)
        : undefined;
      const target = absoluteTarget
        ? inside(absoluteTarget, root)
          ? absoluteTarget.slice(root.length + 1)
          : undefined
        : specifier.startsWith("@lophn/")
          ? resolveWorkspace(specifier, members)
          : undefined;
      if (specifier.startsWith("@lophn/") && !target) {
        add(
          file,
          line,
          "workspace",
          `workspace exports로 해석할 수 없음: ${specifier}`,
        );
      }
      const testImport = test && PORTABLE_TEST_IMPORTS.has(specifier);
      if (
        portable &&
        !testImport &&
        /^(?:npm:|jsr:|node:|https?:)/.test(specifier)
      ) {
        add(
          file,
          line,
          "portable-import",
          `이식할 수 없는 specifier: ${specifier}`,
        );
      }
      // base와 protocol이 repo 밖에서 가져오는 것은 protocol의 zod와 test의 test 도구뿐이다.
      if (
        portable &&
        !relative &&
        !specifier.startsWith("@lophn/") &&
        !testImport &&
        !(own === "protocol" && specifier === "zod")
      ) {
        add(
          file,
          line,
          "external",
          `${own}는 허용된 외부 specifier만 import: ${specifier}`,
        );
      }
      const from = protocolTop(file);
      const to = target ? protocolTop(target) : undefined;
      // 순환은 제품 코드의 import로만 센다. test가 두 module을 같이 쓰는 것은 실행 순환이 아니다.
      if (
        from &&
        to &&
        from !== to &&
        !testCode &&
        !LEAVING_FILES.has(file) &&
        !PROTOCOL_CYCLE_EXCEPTIONS.has(`${file}\0${specifier}`)
      ) {
        edges.push({ from, to, file, line });
      }
      const targetPackage = target?.startsWith("packages/")
        ? target.split("/")[1]
        : undefined;
      if (
        !(testCode && targetPackage !== "core") &&
        own &&
        own in PACKAGE_DEPENDENCIES &&
        targetPackage &&
        targetPackage !== own &&
        !PACKAGE_DEPENDENCIES[own].includes(targetPackage) &&
        !(
          targetPackage === "coding-agent" &&
          own === "shell" &&
          TERMINAL_HOST.some((workspace) => inside(file, workspace))
        ) &&
        !(
          own === "core" &&
          specifier === "@lophn/cap-problem" &&
          inside(file, APP_ENTRYPOINT)
        ) &&
        !(
          own === "cli" &&
          targetPackage === "coding-agent" &&
          file === "packages/cli/main.ts"
        )
      ) {
        add(
          file,
          line,
          "package",
          targetPackage === "core"
            ? `core를 import하는 것은 core뿐: ${specifier}`
            : `package 의존 금지 ${own} → ${targetPackage}: ${specifier}`,
        );
      }
      if (!testCode && target) {
        if (
          own === "core" &&
          targetPackage === "cli" &&
          !cliHit(target, CLI_FOR_CORE)
        ) {
          add(
            file,
            line,
            "cli-surface",
            `core는 packages/cli에서 commands/, parser.ts, help.ts만 import한다: ${specifier}`,
          );
        }
        if (cliHit(file, CLI_FOR_CORE) && cliHit(target, CLI_BINARY_ONLY)) {
          add(
            file,
            line,
            "cli-surface",
            `commands/, parser.ts, help.ts는 main.ts, connection/, output.ts를 import하지 않는다: ${specifier}`,
          );
        }
        const message = coreLayerViolation(file, target);
        if (message) add(file, line, "core-layer", message);
        const protocol = harnessProtocol(file, target);
        if (protocol) harness(file, line, protocol);
      }
      const extension = extensionViolation(file, specifier, target);
      if (extension) add(file, line, "extension", extension);
      if (!testCode) {
        const tool = toolFileViolation(file, specifier, target);
        if (tool) add(file, line, "tool-file", tool);
      }
      // testing/ 안은 *_test.ts와 같은 testing/ 안 파일만 import한다(제품 module graph에 test 도구가 들어가지 않게).
      const testing =
        target && /^packages\/[^/]+\/(?:.+\/)?testing\//.exec(target)?.[0];
      if (testing && !test && !inside(file, testing.slice(0, -1))) {
        add(
          file,
          line,
          "testing",
          `testing/은 *_test.ts와 testing/ 안에서만 import: ${specifier}`,
        );
      }
    }
  }
  for (const [file, reason] of HARNESS_LEFTOVERS) {
    if (files.includes(file) && !harnessHits.has(file)) {
      add(
        file,
        1,
        "harness-domain",
        `위반이 없다. HARNESS_LEFTOVERS에서 뺀다 (${reason})`,
      );
    }
  }
  checkDeclarationGraph(sources, add);
  for (const edge of cyclicEdges(edges)) {
    add(
      edge.file,
      edge.line,
      "protocol-cycle",
      `protocol 최상위 사이 순환: ${edge.from} → ${edge.to}`,
    );
  }
  return violations.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.rule.localeCompare(b.rule),
  );
}

if (import.meta.main) {
  try {
    const violations = await checkRepo(process.argv[2] ?? process.cwd());
    for (const violation of violations) {
      console.error(
        `${violation.file}:${violation.line} [${violation.rule}] ${violation.message}`,
      );
    }
    if (!violations.length) console.log("deps: 통과");
    process.exit(violations.length ? 1 : 0);
  } catch (error) {
    console.error(
      `deps: 검사 실패: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
}
