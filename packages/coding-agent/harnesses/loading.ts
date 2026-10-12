// 네 loading 관측이다(coding-agent/harnesses#R10, R3, connection#R13·R14,
// T32). mcp_initialize·tool_discovery·skill_discovery·app_guide_loading을
// 각각 success·failure·unknown과 안전한 이유·다음 확인으로 낸다.
// 원칙은 셋이다. (1) 파일 존재·credential active·CLI fallback 성공을 loading
// 성공으로 쓰지 않는다. MCP 성공은 설치 Deno executable로 lophn-mcp를 띄운
// initialize·tools/list 응답뿐이다. (2) 관측하지 못한 것(timeout·읽기 실패·
// 미확인 제품 동작·별도 workspace)은 failure도 success도 아닌 unknown이다.
// (3) 읽기만 한다. 파일 눈에 쓰기 연산이 없고 trust·권한·workspace를 넓히지
// 않는다. 설정·skill·안내 파일 원문은 이유에 싣지 않는다.
import type {
  IntegrationTarget,
  LoadingCheck,
  LoadingResult,
  LoadingStage,
} from "../../protocol/coding-agent/mod.ts";
import * as json from "./adapters/json.ts";
import { BEGIN_MARKER, END_MARKER } from "./adapters/region.ts";
import * as toml from "./adapters/toml.ts";
import * as yaml from "./adapters/yaml.ts";
import type { FilePort } from "./integration/apply.ts";
import type { HarnessDefinition, LoadingSpec } from "./model.ts";
import { type RootInputs, rootOf } from "./resolvers.ts";
import { type SkillRootView, skillShadowsOf } from "./skills.ts";

// loading은 읽기만 한다. 쓰기 연산이 없는 눈이다.
export type ReadPort = Pick<FilePort, "read" | "listFiles">;

export type McpProbeRequest = {
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
};

// MCP probe 결과다. raw stdout·stderr는 없고 안전한 분류만 있다.
export type McpProbeResult =
  | { kind: "ok"; server: string | null; tools: readonly string[] }
  | {
    kind: "failed";
    phase: "start" | "initialize" | "tools_list";
    reason: "spawn_failed" | "exited" | "protocol" | "rpc_error";
    detail: string;
  }
  | { kind: "timeout"; phase: "initialize" | "tools_list" };

// 설치된 절대 Deno executable로 server를 띄우는 눈이다. 요청은 gate를 지난
// 것만 온다.
export type McpProbePort = {
  run(request: McpProbeRequest): Promise<McpProbeResult>;
};

export type LoadingPorts = { files: ReadPort; mcp: McpProbePort };

export type LoadingTrust = "trusted" | "rejected" | "unknown";

export type LoadingConnection = {
  id: string;
  // 회수된 연결이 revoked다. 읽지 못했으면 unknown이다.
  state: "active" | "revoked" | "unknown";
} | null;

export type LoadingInput = {
  definition: HarnessDefinition;
  target: IntegrationTarget;
  // home·env는 인자다. 사람의 실제 home을 읽지 않는다. cwd는 app이면
  // app_realpath로 덮인다.
  roots: RootInputs;
  // 설치된 Deno의 절대 경로다. probe가 실행하는 파일은 이것 하나다.
  denoExecutable: string;
  expectedTools: readonly string[];
  expectedSkills: readonly string[];
  connection: LoadingConnection;
  // 제품이 보고한 앱 폴더 신뢰다. 없으면 unknown이다.
  trust?: LoadingTrust;
  // session이 실제로 도는 폴더다. 없거나 앱 root면 앱 root에서 돈다.
  workspace?: string | null;
  // CLI fallback 결과다. 참고 표시일 뿐 MCP loading 판정에 쓰지 않는다.
  cliFallback?: LoadingResult;
};

export type LoadingReport = LoadingCheck & {
  // 사람이 다음에 확인할 방법이다. 설정·권한을 대신 바꾸지
  // 않는 안내다.
  next: string;
};

export const LOPHN_SKILL_NAMES = [
  "lophn-navigate",
  "lophn-save",
  "lophn-build-app",
  "lophn-repair",
] as const;

// probe에 넘기는 env 이름이다. 설정 파일의 다른 이름은 넘기지 않는다.
const SAFE_ENV = [
  "LOPHN_CONNECTION",
  "LOPHN_MCP_TOOLSETS",
  "LOPHN_DAEMON_URL",
  "LOPHN_APP",
  "LOPHN_AGENT_LABEL",
] as const;

const NO_GATES: LoadingSpec = {
  trust_gates: { mcp: false, skills: false, guide: false },
  guide_hiders: [],
  guide_workspace: "app_root",
  broken_config_effect: null,
  trust_source: null,
};

function report(
  stage: LoadingStage,
  result: LoadingResult,
  reason: string,
  next: string,
): LoadingReport {
  return { stage, result, reason, next };
}

function specOf(definition: HarnessDefinition): LoadingSpec {
  return definition.loading ?? NO_GATES;
}

export async function observeLoading(
  input: LoadingInput,
  ports: LoadingPorts,
): Promise<LoadingReport[]> {
  const mcp = await observeMcp(input, ports);
  const skills = await observeSkills(input, ports.files);
  const guide = await observeGuide(input, ports.files);
  return [mcp.init, mcp.tools, skills, guide];
}

// 검사하지 않은 네 단계다. target이 없을 때 쓴다.
export function unobservedLoading(
  reason: string,
  next: string,
): LoadingReport[] {
  const stages: LoadingStage[] = [
    "mcp_initialize",
    "tool_discovery",
    "skill_discovery",
    "app_guide_loading",
  ];
  return stages.map((stage) => report(stage, "unknown", reason, next));
}

// 앱 root·home 기준 root다. app이 아니면 project root는 없다.
function rootsFor(input: LoadingInput): RootInputs {
  return {
    ...input.roots,
    cwd: input.target.scope_kind === "app"
      ? input.target.app_realpath
      : input.roots.cwd,
  };
}

function separateWorkspace(input: LoadingInput): string | null {
  if (input.target.scope_kind !== "app") return null;
  const workspace = input.workspace;
  if (workspace === undefined || workspace === null) return null;
  const root = input.target.app_realpath.replace(/\/$/, "");
  const folder = workspace.replace(/\/$/, "");
  return folder === root || folder.startsWith(`${root}/`) ? null : folder;
}

type Text =
  | { kind: "text"; text: string }
  | { kind: "absent" }
  | { kind: "blocked" };

async function textOf(files: ReadPort, path: string): Promise<Text> {
  const read = await files.read(path);
  if (read.kind === "file") return { kind: "text", text: read.text };
  if (read.kind === "absent") return { kind: "absent" };
  return { kind: "blocked" };
}

function fallbackNote(input: LoadingInput): string {
  return input.cliFallback === "success"
    ? " CLI fallback이 되더라도 MCP loading 성공은 아니다."
    : "";
}

// MCP 항목이다. command·args·env로 정규화한다.
export type McpEntry = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

type EntryRead =
  | { kind: "entry"; entry: McpEntry }
  | { kind: "none" }
  | { kind: "broken" }
  | { kind: "shape" };

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === "string")
    ? (value as string[])
    : null;
}

function stringMap(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") return null;
    out[key] = item;
  }
  return out;
}

function normalized(
  value: unknown,
  shape: HarnessDefinition["mcp_shape"],
): EntryRead {
  if (value === null || value === undefined) return { kind: "none" };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { kind: "shape" };
  }
  const record = value as Record<string, unknown>;
  if (shape === "opencode_local") {
    const command = strings(record.command);
    const env = stringMap(record.environment);
    if (command === null || command.length === 0 || env === null) {
      return { kind: "shape" };
    }
    return {
      kind: "entry",
      entry: { command: command[0], args: command.slice(1), env },
    };
  }
  const args = record.args === undefined ? [] : strings(record.args);
  const env = stringMap(record.env);
  if (typeof record.command !== "string" || args === null || env === null) {
    return { kind: "shape" };
  }
  return { kind: "entry", entry: { command: record.command, args, env } };
}

function entryOf(
  definition: HarnessDefinition,
  format: "json" | "toml" | "yaml",
  key: string,
  text: string,
): EntryRead {
  if (text.trim() === "") return { kind: "none" };
  if (format === "json") {
    const read = json.ownedFragment(text, key);
    return read.ok ? normalized(read.value, definition.mcp_shape) : {
      kind: "broken",
    };
  }
  if (format === "toml") {
    const read = toml.ownedFragment(text, key);
    return read.ok ? normalized(read.value, definition.mcp_shape) : {
      kind: "broken",
    };
  }
  // YAML 목록은 yaml adapter의 map 모양에 담기지 않아 목록을 읽는 작은
  // 해석기를 쓴다. 파싱 가능 여부는 adapter가 정한다(깨진 설정 판정 하나).
  if (!yaml.parseYaml(text).ok) return { kind: "broken" };
  const tree = yamlTree(text);
  if (tree === null) return { kind: "broken" };
  return normalized(yamlAt(tree, key), definition.mcp_shape);
}

type YamlNode = string | string[] | { [key: string]: YamlNode };

type YamlLine = { indent: number; text: string };

class YamlUnreadable extends Error {}

function yamlScalar(raw: string): string {
  const text = raw.trim();
  if (text.startsWith('"')) {
    const end = text.lastIndexOf('"');
    if (end > 0) {
      try {
        return JSON.parse(text.slice(0, end + 1)) as string;
      } catch {
        return text.slice(1, end);
      }
    }
  }
  if (text.startsWith("'") && text.lastIndexOf("'") > 0) {
    return text.slice(1, text.lastIndexOf("'"));
  }
  return text.replace(/\s+#.*$/, "");
}

function yamlBlock(
  lines: readonly YamlLine[],
  start: number,
  indent: number,
): { value: { [key: string]: YamlNode }; next: number } {
  const map: { [key: string]: YamlNode } = {};
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent > indent) throw new YamlUnreadable();
    const match = line.text.match(/^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/);
    if (match === null) throw new YamlUnreadable();
    const [, key, rest] = match;
    if (rest !== undefined && rest.trim() !== "") {
      map[key] = yamlScalar(rest);
      index += 1;
      continue;
    }
    const following = lines[index + 1];
    const listed = following !== undefined && following.text.startsWith("- ") &&
      following.indent >= indent;
    if (listed) {
      const items: string[] = [];
      let at = index + 1;
      while (
        at < lines.length && lines[at].text.startsWith("- ") &&
        lines[at].indent >= indent
      ) {
        items.push(yamlScalar(lines[at].text.slice(2)));
        at += 1;
      }
      map[key] = items;
      index = at;
    } else if (following !== undefined && following.indent > indent) {
      const nested = yamlBlock(lines, index + 1, following.indent);
      map[key] = nested.value;
      index = nested.next;
    } else {
      map[key] = "";
      index += 1;
    }
  }
  return { value: map, next: index };
}

function yamlTree(text: string): { [key: string]: YamlNode } | null {
  const lines: YamlLine[] = [];
  for (const raw of text.split("\n")) {
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    const indent = raw.match(/^ */)?.[0].length ?? 0;
    lines.push({ indent, text: raw.slice(indent).trimEnd() });
  }
  try {
    return yamlBlock(lines, 0, 0).value;
  } catch (error) {
    if (error instanceof YamlUnreadable) return null;
    throw error;
  }
}

function yamlAt(
  tree: { [key: string]: YamlNode },
  key: string,
): unknown {
  let cursor: YamlNode = tree;
  for (const segment of key.split(".")) {
    if (typeof cursor === "string" || Array.isArray(cursor)) return null;
    const next: YamlNode | undefined = cursor[segment];
    if (next === undefined) return null;
    cursor = next;
  }
  return cursor;
}

// 설정 항목을 probe하기 전 gate다. 설치된 Deno executable 하나와 lophn MCP의
// 좁은 권한만 실행한다. 사람 설정에 적힌 다른 command·권한 확대는 실행하지
// 않는다(architecture 2.2: doctor probe는 절대 Deno executable 하나의 run
// 권한만 추가).
const BROAD_FLAGS = /^(?:-A|--allow-all|--allow-(?:run|write|ffi|sys))(?:=|$)/;
const LISTED_FLAGS = /^--allow-(?:read|env|net|import)$/;

export function probeRequestOf(
  entry: McpEntry,
  denoExecutable: string,
): { ok: true; request: McpProbeRequest } | { ok: false; reason: string } {
  if (!entry.command.startsWith("/") || entry.command !== denoExecutable) {
    return {
      ok: false,
      reason:
        "설정의 command가 설치된 Deno executable이 아니라 실행하지 않았다",
    };
  }
  if (entry.args[0] !== "run") {
    return {
      ok: false,
      reason: "설정 args가 `deno run`이 아니라 실행하지 않았다",
    };
  }
  for (const arg of entry.args) {
    if (BROAD_FLAGS.test(arg) || LISTED_FLAGS.test(arg)) {
      return {
        ok: false,
        reason: "설정 args가 lophn MCP의 좁은 권한을 넘어 실행하지 않았다",
      };
    }
  }
  const env: Record<string, string> = {};
  for (const name of SAFE_ENV) {
    const value = entry.env[name];
    if (value !== undefined) env[name] = value;
  }
  return {
    ok: true,
    request: { command: entry.command, args: entry.args, env },
  };
}

const MCP_NEXT_INSTALL =
  "`lophn harness plan`으로 설치 계획을 보고 사람이 install을 고른다";

async function observeMcp(
  input: LoadingInput,
  ports: LoadingPorts,
): Promise<{ init: LoadingReport; tools: LoadingReport }> {
  const { definition, target } = input;
  const spec = specOf(definition);
  const dependent = (reason: string): LoadingReport =>
    report(
      "tool_discovery",
      "unknown",
      reason,
      "mcp_initialize 결과를 먼저 확인한다",
    );
  const stop = (
    result: LoadingResult,
    reason: string,
    next: string,
  ) => ({
    init: report("mcp_initialize", result, reason, next),
    tools: dependent("MCP 초기화를 확인하지 못해 tool 발견은 확인하지 않았다"),
  });

  // 비활성 연결은 credential이 있어도 호출이 인증 거절된다.
  if (input.connection !== null && input.connection.state === "revoked") {
    return stop(
      "failure",
      `연결 ${input.connection.id}이 회수되어 MCP 호출이 인증 거절된다`,
      "`lophn connection list`로 연결 상태를 보고 사람이 새 연결을 만든다. credential은 자동으로 만들지 않는다",
    );
  }

  const config =
    definition.config_targets.find((entry) =>
      entry.scope_kind === target.scope_kind
    ) ?? definition.config_targets.find((entry) => entry.scope_kind === "user");
  if (config === undefined) {
    return stop(
      "unknown",
      `${definition.label}은 lophn이 확인할 수 있는 MCP 설정 위치가 없다(session 소유 stdio를 확인하지 못했다).${
        fallbackNote(input)
      }`,
      "`lophn mcp config`의 조각을 사람이 제품 설정에 넣고 제품에서 MCP 목록을 확인한다",
    );
  }

  const workspace = separateWorkspace(input);
  if (workspace !== null && config.scope_kind === "app") {
    return stop(
      "unknown",
      "session이 앱 root와 다른 workspace에서 돌아 앱 설정을 읽는지 알 수 없다",
      "앱 root에서 session을 열거나 그 workspace에 같은 설정이 있는지 사람이 확인한다",
    );
  }

  const root = rootOf(config.root_resolver, rootsFor(input));
  if (!root.ok) {
    return stop(
      "unknown",
      "설정 root를 풀지 못했다",
      "앱 폴더와 profile 선택을 확인한다",
    );
  }
  const path = `${root.value}/${config.path}`;
  if (
    spec.trust_gates.mcp && target.scope_kind === "app" &&
    config.scope_kind === "app" && input.trust === "rejected"
  ) {
    return stop(
      "failure",
      `앱 폴더를 제품이 신뢰하지 않아 ${config.path}를 읽지 않는다`,
      "신뢰는 사람이 제품에서 정한다. lophn은 신뢰를 대신 넓히지 않는다",
    );
  }

  const read = await textOf(ports.files, path);
  if (read.kind === "absent") {
    return stop(
      "failure",
      `MCP 설정 파일(${config.path})이 없다.${fallbackNote(input)}`,
      MCP_NEXT_INSTALL,
    );
  }
  if (read.kind === "blocked") {
    return stop(
      "unknown",
      `MCP 설정 위치(${config.path})를 파일로 읽지 못했다(symlink·디렉터리·읽기 오류)`,
      "설정 위치를 사람이 확인한다. lophn은 symlink를 따라가지 않는다",
    );
  }

  const entry = entryOf(definition, config.format, config.owned_key, read.text);
  if (entry.kind === "broken") {
    const effect = spec.broken_config_effect;
    return stop(
      "failure",
      `${config.path}를 해석하지 못한다(깨진 ${config.format.toUpperCase()}).${
        effect === null ? "" : ` ${effect}.`
      }`,
      "사람이 설정 파일의 문법을 고친 뒤 doctor를 다시 돌린다. lophn은 깨진 설정을 고치지 않는다",
    );
  }
  if (entry.kind === "none") {
    return stop(
      "failure",
      `${config.path}에 lophn MCP 항목(${config.owned_key})이 없다.${
        fallbackNote(input)
      }`,
      MCP_NEXT_INSTALL,
    );
  }
  if (entry.kind === "shape") {
    return stop(
      "failure",
      `${config.path}의 lophn MCP 항목 모양이 제품 계약과 다르다`,
      "사람이 항목을 확인하거나 `lophn mcp config`의 조각과 비교한다",
    );
  }

  const request = probeRequestOf(entry.entry, input.denoExecutable);
  if (!request.ok) {
    return stop(
      "unknown",
      request.reason,
      "설정의 command와 args를 `lophn mcp config`의 조각과 사람이 비교한다",
    );
  }

  const probed = await ports.mcp.run(request.request);
  if (probed.kind === "timeout") {
    const initTimeout = probed.phase === "initialize";
    return {
      init: initTimeout
        ? report(
          "mcp_initialize",
          "unknown",
          "MCP initialize 응답 시간이 초과되어 성공도 실패도 판정하지 않는다",
          "daemon과 설치 resource 상태를 보고 doctor를 다시 돌린다",
        )
        : report(
          "mcp_initialize",
          "success",
          "설치된 Deno로 lophn-mcp를 띄워 initialize 응답을 받았다",
          "tool 발견 결과를 확인한다",
        ),
      tools: initTimeout
        ? dependent("MCP 초기화가 확인되지 않아 tool 발견은 확인하지 않았다")
        : report(
          "tool_discovery",
          "unknown",
          "tools/list 응답 시간이 초과되어 성공도 실패도 판정하지 않는다",
          "doctor를 다시 돌린다",
        ),
    };
  }
  if (probed.kind === "failed") {
    const reason = failureReason(probed);
    if (probed.phase === "tools_list") {
      return {
        init: report(
          "mcp_initialize",
          "success",
          "설치된 Deno로 lophn-mcp를 띄워 initialize 응답을 받았다",
          "tool 발견 결과를 확인한다",
        ),
        tools: report(
          "tool_discovery",
          "failure",
          reason,
          "daemon·connection 설정과 MCP server 로그를 확인한다",
        ),
      };
    }
    return stop(
      "failure",
      reason,
      "daemon·connection 설정과 설치 resource를 확인하고 doctor를 다시 돌린다",
    );
  }

  const init = report(
    "mcp_initialize",
    "success",
    "설치된 Deno로 lophn-mcp를 띄워 initialize 응답을 받았다",
    "tool 발견 결과를 확인한다",
  );
  const missing = input.expectedTools.filter((name) =>
    !probed.tools.includes(name)
  );
  let tools: LoadingReport;
  if (probed.tools.length === 0) {
    tools = report(
      "tool_discovery",
      "failure",
      "tools/list가 tool을 하나도 돌려주지 않았다",
      "`--toolsets` 설정을 확인한다",
    );
  } else if (missing.length > 0) {
    tools = report(
      "tool_discovery",
      "failure",
      `tools/list에 기대한 tool이 없다: ${missing.join(", ")}`,
      "설치 version과 `--toolsets` 설정을 확인한다",
    );
  } else {
    tools = report(
      "tool_discovery",
      "success",
      `tools/list가 기대한 tool ${probed.tools.length}개를 돌려주었다`,
      "제품 안에서 tool 목록이 보이는지 사람이 확인한다",
    );
  }
  // 제품이 앱 설정을 신뢰하는지 모르면 server가 떠도 제품 loading은 모른다.
  if (
    spec.trust_gates.mcp && target.scope_kind === "app" &&
    config.scope_kind === "app" && input.trust !== "trusted"
  ) {
    const reason =
      `server는 응답하지만 제품이 앱 폴더를 신뢰해 ${config.path}를 읽는지 확인하지 못했다`;
    const next = "제품에서 앱 폴더 신뢰와 MCP 승인 상태를 사람이 확인한다";
    return {
      init: report("mcp_initialize", "unknown", reason, next),
      tools: report("tool_discovery", "unknown", reason, next),
    };
  }
  return { init, tools };
}

function failureReason(
  probed: Extract<McpProbeResult, { kind: "failed" }>,
): string {
  const where = probed.phase === "tools_list" ? "tools/list" : "initialize";
  switch (probed.reason) {
    case "spawn_failed":
      return `MCP server를 시작하지 못했다(${probed.detail})`;
    case "exited":
      return `${where} 응답 전에 MCP server가 종료됐다(${probed.detail})`;
    case "protocol":
      return `${where} 응답이 MCP 형식이 아니다(${probed.detail})`;
    default:
      return `${where} 요청을 MCP server가 거절했다(${probed.detail})`;
  }
}

// SKILL.md frontmatter의 name·description이다. 단순 `key: value` 줄만 읽는다.
function frontmatterOf(
  text: string,
): { name: string | null; description: string | null } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return { name: null, description: null };
  const end = lines.indexOf("---", 1);
  const body = end < 0 ? lines.slice(1) : lines.slice(1, end);
  let name: string | null = null;
  let description: string | null = null;
  for (let index = 0; index < body.length; index++) {
    const match = body[index].match(/^(name|description):\s*(.*)$/);
    if (match === null) continue;
    let value = match[2].trim();
    if (/^[>|][+-]?$/.test(value) || value === "") {
      const folded: string[] = [];
      while (index + 1 < body.length && /^\s+\S/.test(body[index + 1])) {
        folded.push(body[index + 1].trim());
        index += 1;
      }
      value = folded.join(" ");
    }
    value = yamlScalar(value);
    if (match[1] === "name") name = value === "" ? null : value;
    else description = value === "" ? null : value;
  }
  return { name, description };
}

type SkillView = {
  view: SkillRootView;
  // 이름별 발견 정보다.
  skills: Map<string, { described: boolean }>;
};

async function viewOf(
  files: ReadPort,
  dir: string,
  meta: Omit<SkillRootView, "names">,
): Promise<SkillView | "unreadable"> {
  const root = await files.read(dir);
  const empty = {
    view: { ...meta, names: [] as string[] },
    skills: new Map<string, { described: boolean }>(),
  };
  if (root.kind === "absent") return empty;
  if (root.kind !== "directory") return "unreadable";
  const listed = await files.listFiles(dir);
  if (listed.kind !== "files") return "unreadable";
  const skills = new Map<string, { described: boolean }>();
  for (const file of listed.files) {
    const match = file.path.match(/^([^/]+)\/SKILL\.md$/);
    if (match === null) continue;
    const meta = frontmatterOf(file.text);
    skills.set(meta.name ?? match[1], { described: meta.description !== null });
  }
  return {
    view: { ...meta, names: [...skills.keys()] },
    skills,
  };
}

// 앱 신뢰다. 제품 설정 안의 신뢰 목록을 읽을 수 있으면 사람이 알려 준 값보다
// 우선한다.
async function trustOf(
  input: LoadingInput,
  files: ReadPort,
): Promise<{ trust: LoadingTrust; note: string | null }> {
  const spec = specOf(input.definition);
  const target = input.target;
  if (target.scope_kind !== "app") return { trust: "unknown", note: null };
  const source = spec.trust_source;
  if (source === null) return { trust: input.trust ?? "unknown", note: null };
  const root = rootOf(source.root_resolver, rootsFor(input));
  if (!root.ok) return { trust: input.trust ?? "unknown", note: null };
  const read = await textOf(files, `${root.value}/${source.path}`);
  if (read.kind === "blocked") {
    return { trust: input.trust ?? "unknown", note: null };
  }
  // 파일이 없거나 깨지면 제품은 기본값(신뢰 목록 없음)을 쓴다.
  const tree = read.kind === "text" && yaml.parseYaml(read.text).ok
    ? yamlTree(read.text)
    : null;
  const listed = tree === null ? null : yamlAt(tree, source.list_key);
  const dirs = Array.isArray(listed) ? listed : [];
  const real = target.app_realpath.replace(/\/$/, "");
  const trusted = dirs.some((dir) => dir.replace(/\/$/, "") === real);
  return {
    trust: trusted ? "trusted" : "rejected",
    note: read.kind === "text" && tree === null
      ? spec.broken_config_effect
      : null,
  };
}

async function observeSkills(
  input: LoadingInput,
  files: ReadPort,
): Promise<LoadingReport> {
  const { definition, target } = input;
  const spec = specOf(definition);
  const stage = "skill_discovery";
  const scope = target.scope_kind;
  const install = definition.skill_targets.find((entry) =>
    entry.scope_kind === scope
  );
  if (install === undefined) {
    return report(
      stage,
      "unknown",
      `${definition.label}은 ${scope} 범위에 lophn skill 설치 root가 없다`,
      "`lophn harness inspect`로 제품이 읽는 skill 위치를 확인한다",
    );
  }
  if (input.expectedSkills.length === 0) {
    return report(
      stage,
      "unknown",
      "검사할 lophn skill 이름이 없다",
      "배포 skill 목록을 확인한다",
    );
  }
  if (install.scope_kind === "app" && separateWorkspace(input) !== null) {
    return report(
      stage,
      "unknown",
      "session이 앱 root와 다른 workspace에서 돌아 앱 skill root를 읽는지 알 수 없다",
      "앱 root에서 session을 열거나 그 workspace의 skill 위치를 사람이 확인한다",
    );
  }

  const roots = rootsFor(input);
  const trust = await trustOf(input, files);
  if (install.scope_kind === "app" && spec.trust_gates.skills) {
    if (trust.trust === "rejected") {
      return report(
        stage,
        "failure",
        `앱 폴더가 신뢰 목록에 없어 제품이 앱 skill root(${install.path})를 읽지 않는다.${
          trust.note === null ? "" : ` ${trust.note}.`
        }`,
        definition.skill_trust_note ??
          "신뢰는 사람이 제품에서 정한다. lophn은 신뢰를 대신 넓히지 않는다",
      );
    }
  }

  const discovery = definition.skill_discovery ?? definition.skill_targets;
  const views: SkillView[] = [];
  let installView: SkillView | null = null;
  for (const entry of discovery) {
    if (scope === "user" && entry.scope_kind === "app") continue;
    const root = rootOf(entry.root_resolver, roots);
    if (!root.ok) continue;
    const view = await viewOf(files, `${root.value}/${entry.path}`, {
      scope_kind: entry.scope_kind,
      root_resolver: entry.root_resolver,
      path: entry.path,
    });
    const isInstall = entry.scope_kind === install.scope_kind &&
      entry.root_resolver === install.root_resolver &&
      entry.path === install.path;
    if (view === "unreadable") {
      if (isInstall) {
        return report(
          stage,
          "unknown",
          `skill root(${entry.path})를 읽지 못했다(symlink·파일·읽기 오류)`,
          "skill root를 사람이 확인한다. lophn은 symlink를 따라가지 않는다",
        );
      }
      continue;
    }
    views.push(view);
    if (isInstall) installView = view;
  }
  if (installView === null) {
    return report(
      stage,
      "unknown",
      "skill 설치 root를 풀지 못했다",
      "앱 폴더와 profile 선택을 확인한다",
    );
  }

  const missing: string[] = [];
  const blank: string[] = [];
  const hidden: string[] = [];
  for (const name of input.expectedSkills) {
    const found = installView.skills.get(name);
    if (found === undefined) {
      missing.push(name);
      continue;
    }
    if (!found.described) blank.push(name);
    const shadows = skillShadowsOf(
      definition,
      scope,
      name,
      views.map((item) => item.view),
    ).filter((item) => item.relation === "shadowed_by");
    if (shadows.length > 0) {
      hidden.push(`${name}(${shadows[0].scope_kind}:${shadows[0].path})`);
    }
  }
  if (missing.length > 0) {
    return report(
      stage,
      "failure",
      `lophn skill이 발견 root(${install.path})에 없다: ${missing.join(", ")}`,
      "`lophn skills install`로 사람이 설치를 고른다",
    );
  }
  if (hidden.length > 0) {
    return report(
      stage,
      "failure",
      `더 우선하는 root의 동명 skill이 lophn skill을 가린다: ${
        hidden.join(", ")
      }`,
      "동명 skill은 사람이 정한다. lophn은 자동으로 교체하거나 지우지 않는다",
    );
  }
  if (blank.length > 0) {
    return report(
      stage,
      "failure",
      `skill 설명(description)이 비어 발견 목록에 설명이 나오지 않는다: ${
        blank.join(", ")
      }`,
      "배포 skill을 다시 설치할지 사람이 정한다",
    );
  }
  if (
    install.scope_kind === "app" && spec.trust_gates.skills &&
    trust.trust !== "trusted"
  ) {
    return report(
      stage,
      "unknown",
      "skill 파일은 있으나 제품이 앱 폴더를 신뢰해 앱 skill root를 읽는지 확인하지 못했다",
      definition.skill_trust_note ??
        "제품에서 앱 폴더 신뢰 상태를 사람이 확인한다",
    );
  }
  return report(
    stage,
    "success",
    `제품의 발견 규칙으로 lophn skill ${input.expectedSkills.length}개의 이름과 설명이 발견된다`,
    "제품 안에서 skill 목록이 보이는지 사람이 확인한다",
  );
}

function dirsBetween(root: string, workspace: string): string[] {
  const base = root.replace(/\/$/, "");
  const rest = workspace.replace(/\/$/, "").slice(base.length);
  const dirs: string[] = [];
  let cursor = base;
  for (const segment of rest.split("/").filter((item) => item !== "")) {
    cursor = `${cursor}/${segment}`;
    dirs.push(cursor);
  }
  return dirs;
}

async function observeGuide(
  input: LoadingInput,
  files: ReadPort,
): Promise<LoadingReport> {
  const { definition, target } = input;
  const spec = specOf(definition);
  const stage = "app_guide_loading";
  if (target.scope_kind !== "app") {
    return report(
      stage,
      "unknown",
      "앱이 없는 target이라 앱 안내 loading은 not_applicable이다",
      "앱 범위 target을 골라 doctor를 다시 돌린다",
    );
  }
  const root = target.app_realpath.replace(/\/$/, "");
  const workspace = separateWorkspace(input);
  if (workspace !== null) {
    return report(
      stage,
      "unknown",
      "session이 앱 root와 다른 workspace에서 돌아 앱 root의 AGENTS.md가 읽히는지 알 수 없다",
      "앱 root에서 session을 열거나 그 workspace의 안내 파일을 사람이 확인한다. lophn은 workspace를 바꾸지 않는다",
    );
  }
  if (
    spec.guide_workspace === "agent_workspace" &&
    typeof input.workspace !== "string"
  ) {
    return report(
      stage,
      "unknown",
      `${definition.label}의 agent workspace를 확인하지 못해 앱 root의 AGENTS.md가 읽히는지 알 수 없다`,
      "agent workspace가 앱 root인지 사람이 확인한다. lophn은 workspace 변경·본문 복제를 하지 않는다",
    );
  }
  const trust = await trustOf(input, files);
  const gated = spec.trust_gates.guide;
  if (gated && trust.trust === "rejected") {
    return report(
      stage,
      "failure",
      "앱 폴더를 제품이 신뢰하지 않아 project 안내를 건너뛴다",
      "신뢰는 사람이 제품에서 정한다. lophn은 신뢰를 대신 넓히지 않는다",
    );
  }

  for (const hider of spec.guide_hiders) {
    const found = await files.read(`${root}/${hider}`);
    if (found.kind !== "absent") {
      return report(
        stage,
        "failure",
        `${hider}가 AGENTS.md보다 먼저 읽히거나 AGENTS.md를 건너뛰게 해 lophn 안내가 가려진다`,
        `${hider}에 안내를 둘지 사람이 정한다. lophn은 이 파일을 고치지 않는다`,
      );
    }
  }

  const agents = await textOf(files, `${root}/AGENTS.md`);
  if (agents.kind === "absent") {
    return report(
      stage,
      "failure",
      "앱 root에 AGENTS.md가 없다",
      "앱 안내 설치는 사람이 고른 plan으로만 한다",
    );
  }
  if (agents.kind === "blocked") {
    return report(
      stage,
      "unknown",
      "AGENTS.md를 파일로 읽지 못했다(symlink·디렉터리·읽기 오류)",
      "AGENTS.md를 사람이 확인한다",
    );
  }
  const text = agents.text;
  if (!text.includes(BEGIN_MARKER) || !text.includes(END_MARKER)) {
    return report(
      stage,
      "failure",
      "AGENTS.md에 lophn 관리 구간이 없다",
      "관리 구간 설치는 사람이 고른 plan으로만 한다. marker 없는 기존 파일은 고치지 않는다",
    );
  }

  const unknowns: string[] = [];
  for (const instruction of definition.instructions) {
    if (instruction.mode === "region") {
      const file = await textOf(files, `${root}/${instruction.file}`);
      const body = instruction.body ?? "@AGENTS.md";
      if (file.kind !== "text" || !file.text.includes(body)) {
        return report(
          stage,
          "failure",
          `${instruction.file}가 ${body}로 AGENTS.md를 읽게 하지 않아 ${definition.label}은 lophn 안내를 읽지 않는다`,
          `사람이 ${instruction.file}에 ${body} 가져오기를 두거나 관리 구간 plan을 고른다`,
        );
      }
    } else if (instruction.mode === "json_member") {
      const verdict = await listsMember(input, files, instruction);
      if (verdict === "missing") {
        return report(
          stage,
          "failure",
          `${instruction.json_key}에 ${instruction.member}가 없어 ${definition.label}은 AGENTS.md를 읽지 않는다`,
          "사람이 설정 목록에 AGENTS.md를 더하거나 안내 plan을 고른다",
        );
      }
      if (verdict === "unknown") {
        unknowns.push(
          `${instruction.json_key} 설정을 읽지 못해 AGENTS.md 목록 여부를 알 수 없다`,
        );
      }
    }
  }

  if (input.workspace !== undefined && input.workspace !== null) {
    const nearer: string[] = [];
    for (const dir of dirsBetween(root, input.workspace)) {
      for (const name of ["AGENTS.override.md", "AGENTS.md"]) {
        const found = await files.read(`${dir}/${name}`);
        if (found.kind !== "absent") {
          nearer.push(`${dir.slice(root.length + 1)}/${name}`);
        }
      }
    }
    if (nearer.length > 0) {
      return report(
        stage,
        "unknown",
        `작업 폴더에 더 가까운 안내가 있어 lophn 안내와 어느 쪽이 따라지는지 알 수 없다: ${
          nearer.join(", ")
        }`,
        "가까운 안내 파일이 lophn 안내와 충돌하는지 사람이 읽어 본다. lophn은 그 파일을 고치지 않는다",
      );
    }
  }
  if (gated && trust.trust !== "trusted") {
    unknowns.push(
      "제품이 앱 폴더를 신뢰해 project 안내를 읽는지 확인하지 못했다",
    );
  }
  if (unknowns.length > 0) {
    return report(
      stage,
      "unknown",
      unknowns[0],
      "제품에서 안내 loading 상태를 사람이 확인한다",
    );
  }
  return report(
    stage,
    "success",
    "제품의 읽기 규칙으로 앱 root의 AGENTS.md lophn 관리 구간이 읽힌다",
    "제품 안에서 안내가 적용되는지 사람이 확인한다",
  );
}

async function listsMember(
  input: LoadingInput,
  files: ReadPort,
  instruction: HarnessDefinition["instructions"][number],
): Promise<"listed" | "missing" | "unknown"> {
  // 앱 설정과 사용자 설정 어느 쪽이든 목록에 있으면 제품이 읽는다.
  for (const entry of input.definition.config_targets) {
    const base = rootOf(entry.root_resolver, rootsFor(input));
    if (!base.ok) continue;
    const read = await textOf(files, `${base.value}/${entry.path}`);
    if (read.kind === "blocked") return "unknown";
    if (read.kind === "absent") continue;
    const key = instruction.json_key ?? "";
    const fragment = json.ownedFragment(read.text, key);
    if (!fragment.ok) return "unknown";
    const value = fragment.value;
    const member = instruction.member ?? "";
    if (value === member) return "listed";
    if (Array.isArray(value) && value.includes(member)) return "listed";
  }
  return "missing";
}
