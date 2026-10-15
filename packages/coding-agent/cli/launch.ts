// CLI 실행 argv의 권한 계산이다.
// 일반 CLI는 core loopback과 helper 실행뿐이고, 설치·감지·`daemon`·`sdk add --apply`가 요구하는 write·run은
// 정확한 경로와 파일로만 준다: 선택한 제품 설정 파일, `<H>/integrations`, 앱 source의 `deno.json`·`deno.lock`,
// instance lock 파일, 설치 Deno와 `lophn-desktop`, PATH 폴더 읽기. `-A`·일반 `--allow-write`·`--allow-run`,
// 폴더 단위나 와일드카드 쓰기는 없다. 명령 시점에야 알 수 있는 경로(제품 설정 파일·앱 source)는 사람이 고른
// target·앱에서 정확한 경로로 계산해(`planSelection`) 그 실행의 argv에만 더한다.
import {
  type IntegrationTarget,
  LOPHN_TERMINAL_OBSERVE,
} from "../../protocol/coding-agent/mod.ts";
import {
  DETECTION_FALLBACK_DIRS,
  type RootInputs,
  selectedSkillDirs,
  selectedWriteFiles,
  WRITE_TEMP_SUFFIX,
} from "../harnesses/mod.ts";
import { SKILL_RELEASES } from "../guides/mod.ts";

// 실행 entry의 설치 resource root 기준 경로다.
export const CLI_ENTRY = "packages/coding-agent/cli/main.ts";

// CLI가 읽는 환경 이름이다. token 이름은 없다.
export const CLI_ENV_NAMES = [
  "LOPHN_HOME",
  "LOPHN_CONNECTION",
  "LOPHN_DAEMON_URL",
  "LOPHN_APP",
  "LOPHN_TERMINAL_OBSERVE",
  "HOME",
  "DENO_DIR",
  "PATH",
  "XDG_RUNTIME_DIR",
  "TMPDIR",
  "CODEX_HOME",
  "XDG_CONFIG_HOME",
  "HERMES_HOME",
] as const;

export type CliLaunchInputs = {
  // 설치 Deno의 절대 경로다.
  deno: string;
  // 설치 resource root(`<설치>/platform`)다.
  resources: string;
  // Deno cache 절대 위치다.
  cache: string;
  // 사람의 home이다(제품 감지가 읽는 정해진 bin 폴더의 기준이다).
  home: string;
  // data root `H`다.
  dataRoot: string;
  // `lophn-desktop`의 절대 경로다(`daemon start|stop`).
  desktop: string;
  // 설치 묶음의 credential helper 절대 경로다.
  credentialHelper: string;
  // instance lock 파일의 절대 경로다(`<H>/run/instance.lock`).
  instanceLock: string;
  // 현재 작업 폴더다(`--input-file` 상대 경로).
  cwd: string;
  // PATH의 절대 폴더들이다. 제품 감지가 읽는다. home 기준 정해진 bin 폴더(`DETECTION_FALLBACK_DIRS`)는
  // 이 목록과 따로 고정으로 더해진다.
  pathDirs: readonly string[];
  // core loopback `host:port` 목록이다.
  loopback: readonly string[];
};

// 명령 시점에 사람의 선택에서 계산한 정확한 경로다.
export type CliSelection = {
  // 선택한 제품 설정 파일(과 앱 범위의 관리 구간 지침 파일)이다.
  harnessFiles: readonly string[];
  // `sdk add --apply` 대상 앱 source 폴더다. 이 폴더의 `deno.json`·`deno.lock` 두 파일만 열린다.
  sdkSourceDirs: readonly string[];
  // `session observe`가 쓰는 환경의 관측 socket 하나다. Unix socket 연결은 그 경로의 읽기·쓰기 권한이다.
  observeSockets?: readonly string[];
  // `skills install`이 쓰는 lophn skill 디렉터리의 정확한 경로다. 선택한 제품 skill root 아래 배포 skill 이름의
  // 디렉터리뿐이다(root 폴더 전체나 사람의 다른 skill은 열리지 않는다).
  skillDirs?: readonly string[];
};

export const NO_SELECTION: CliSelection = {
  harnessFiles: [],
  sdkSourceDirs: [],
};

function exactPath(path: string): boolean {
  return path.startsWith("/") && !path.split("/").includes("..") &&
    !/[\0\n,]/.test(path);
}

// 선택에서 온 정확한 파일 목록이다. 선택한 설정 파일마다 쓰는 중 temp 이름도 함께 정확한 경로로 든다.
export function selectionFiles(selection: CliSelection): string[] {
  const files: string[] = [];
  for (const file of selection.harnessFiles) {
    files.push(file, `${file}${WRITE_TEMP_SUFFIX}`);
  }
  for (const dir of selection.sdkSourceDirs) {
    const base = dir.replace(/\/+$/, "");
    files.push(`${base}/deno.json`, `${base}/deno.lock`);
  }
  files.push(...(selection.observeSockets ?? []));
  files.push(...(selection.skillDirs ?? []));
  return files.filter(exactPath);
}

// 선택이 더하는 읽기·쓰기 flag다. 여러 `--allow-read`·`--allow-write`는 합쳐진다. 선택이 없으면 비어 있다.
export function selectionFlags(selection: CliSelection): string[] {
  const files = selectionFiles(selection);
  if (files.length === 0) return [];
  const list = files.join(",");
  return [`--allow-read=${list}`, `--allow-write=${list}`];
}

// 선택과 상관없이 고정인 권한이다. 고정 경로의 이름은 launcher script와 같다.
export function cliStaticFlags(inputs: CliLaunchInputs): string[] {
  const root = inputs.dataRoot.replace(/\/$/, "");
  const integrations = `${root}/integrations`;
  const read = [
    inputs.resources,
    inputs.cache,
    `${root}/run`,
    integrations,
    inputs.cwd,
    "/proc/self/stat",
    ...DETECTION_FALLBACK_DIRS.map((dir) =>
      `${inputs.home.replace(/\/$/, "")}/${dir}`
    ),
    ...inputs.pathDirs.filter(exactPath),
  ];
  const write = [integrations, inputs.instanceLock];
  return [
    `--allow-read=${read.join(",")}`,
    `--allow-write=${write.join(",")}`,
    `--allow-env=${CLI_ENV_NAMES.join(",")}`,
    `--allow-net=${inputs.loopback.join(",")}`,
    `--allow-run=${
      [inputs.credentialHelper, inputs.deno, inputs.desktop].join(",")
    }`,
  ];
}

// 실행 argv를 분리 배열로 만든다. shell 문자열로 합치지 않는다.
export function cliLaunchArgv(
  inputs: CliLaunchInputs,
  selection: CliSelection,
  args: readonly string[],
): { command: string; args: string[] } {
  const resources = inputs.resources.replace(/\/$/, "");
  return {
    command: inputs.deno,
    args: [
      "run",
      "--cached-only",
      "--frozen",
      "--no-prompt",
      `--config=${resources}/deno.json`,
      ...cliStaticFlags(inputs),
      ...selectionFlags(selection),
      `${resources}/${CLI_ENTRY}`,
      ...args,
    ],
  };
}

// 설치 target을 쓰는 command다. 입력의 exact target 하나가 쓰는 파일만 정확한 경로로 열린다.
const TARGET_WRITE_COMMANDS = [
  "harness plan",
  "harness install",
  "harness update",
  "harness remove",
  "connection install",
];

export type SelectionRequest = {
  // 표의 command 이름이다(`harness install`).
  command: string;
  // 공통 option이 합쳐진 입력이다(`app`, `target`, `apply` 등).
  input: Record<string, unknown>;
  roots: RootInputs;
};

export type SelectionDeps = {
  // `sdk add --apply`의 앱이 연결한 source 폴더다. 모르면 undefined다.
  sourceDirOf(app: string): Promise<string | undefined>;
};

// 사람의 선택에서 이 실행이 더 열 정확한 경로를 계산한다. 계산하지 못하면 아무것도 더하지 않는다(그
// command는 권한이 없어 unavailable로 끝난다).
export async function planSelection(
  request: SelectionRequest,
  deps: SelectionDeps,
): Promise<CliSelection> {
  if (TARGET_WRITE_COMMANDS.includes(request.command)) {
    const target = request.input.target as IntegrationTarget | undefined;
    if (target === undefined || typeof target !== "object") {
      return NO_SELECTION;
    }
    const files = selectedWriteFiles(target, request.roots);
    return files.ok
      ? { harnessFiles: files.value, sdkSourceDirs: [] }
      : NO_SELECTION;
  }
  if (request.command === "app sync-tools") {
    const target = request.input.target as IntegrationTarget | undefined;
    if (target === undefined || typeof target !== "object") {
      return NO_SELECTION;
    }
    const released = SKILL_RELEASES.map((release) => release.name);
    const names = Array.isArray(request.input.names)
      ? request.input.names as string[]
      : released;
    if (!names.every((name) => released.includes(name))) return NO_SELECTION;
    // 앱 root 두 위치만: 관리 구간 지침 파일(과 그 temp)과 skill root 아래 lophn skill
    // 디렉터리. ignore 갱신은 앱 root의 .gitignore 하나다.
    if (target.scope_kind !== "app") return NO_SELECTION;
    const writes = selectedWriteFiles(target, request.roots);
    const dirs = selectedSkillDirs(target, request.roots, names);
    if (!writes.ok || !dirs.ok) return NO_SELECTION;
    const root = target.app_realpath.replace(/\/$/, "");
    return {
      harnessFiles: [...writes.value, `${root}/.gitignore`],
      sdkSourceDirs: [],
      skillDirs: dirs.value,
    };
  }
  if (request.command === "skills install") {
    const target = request.input.target as IntegrationTarget | undefined;
    if (target === undefined || typeof target !== "object") {
      return NO_SELECTION;
    }
    const released = SKILL_RELEASES.map((release) => release.name);
    const names = Array.isArray(request.input.names)
      ? request.input.names as string[]
      : released;
    if (!names.every((name) => released.includes(name))) return NO_SELECTION;
    const dirs = selectedSkillDirs(target, request.roots, names);
    return dirs.ok
      ? { harnessFiles: [], sdkSourceDirs: [], skillDirs: dirs.value }
      : NO_SELECTION;
  }
  if (request.command === "session observe") {
    const socket = request.roots.env.get(LOPHN_TERMINAL_OBSERVE);
    return socket !== undefined && exactPath(socket)
      ? { harnessFiles: [], sdkSourceDirs: [], observeSockets: [socket] }
      : NO_SELECTION;
  }
  if (
    request.command === "sdk add" && request.input.apply === true &&
    typeof request.input.app === "string"
  ) {
    const dir = await deps.sourceDirOf(request.input.app);
    return dir !== undefined && exactPath(dir)
      ? { harnessFiles: [], sdkSourceDirs: [dir] }
      : NO_SELECTION;
  }
  return NO_SELECTION;
}
