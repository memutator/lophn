// `lophn mcp config` command다(coding-agent/cli#R9, T30). 선택 제품의
// executable·분리 argv·안전 env 설정 조각만 문자열로 내고 제품 설정 파일은
// 읽지도 고치지도 않는다. 조각에는 connection 참조와 toolsets만 있고 token·
// 운영 data 경로는 없다(R12). 시작 조각의 절대 경로는 설치가 해석해 주는 base다.
import type { HarnessId } from "../../../protocol/coding-agent/mod.ts";
import { cliMcpConfigSchema } from "../../../protocol/coding-agent/mod.ts";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  catalogOf,
  type LaunchInputs,
  launchOf,
  mcpEntryOf,
  setTomlOwned as setToml,
} from "../../harnesses/mod.ts";
import type { CommandEntry } from "./types.ts";

// 검증을 지난 입력이다. connection 필수는 schema가 거절하고 여기서도 다시 본다.
export type McpConfigRequest = {
  target: HarnessId;
  scope: "user" | "app";
  connection?: string;
  toolsets?: string;
};

export const MCP_COMMANDS: readonly CommandEntry[] = [
  { name: "mcp config", input: cliMcpConfigSchema },
];

// 설치가 해석한 시작 base다. connection·toolsets는 요청이 채운다.
export type LaunchBase = Omit<LaunchInputs, "connection" | "toolsets">;

export type McpConfigOutput = {
  target: string;
  scope: "user" | "app";
  executable: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  fragment: {
    format: "json" | "toml" | "yaml";
    // 조각이 들어갈 소유 key다.
    key: string;
    // 제품 root 기준 위치 안내다(`codex_home/config.toml`). 절대 경로가 아니다.
    location: string | null;
    text: string;
  };
};

const DEFAULT_TOOLSETS = "core,app";

function nest(key: string, value: unknown): unknown {
  return key.split(".").reduceRight<unknown>(
    (inner, segment) => ({ [segment]: inner }),
    value,
  );
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function yamlText(key: string, value: Record<string, unknown>): string {
  const segments = key.split(".");
  const lines: string[] = [];
  segments.forEach((segment, depth) => {
    lines.push(`${"  ".repeat(depth)}${segment}:`);
  });
  const pad = "  ".repeat(segments.length);
  for (const [name, item] of Object.entries(value)) {
    if (Array.isArray(item)) {
      lines.push(`${pad}${name}:`);
      for (const entry of item) {
        lines.push(`${pad}  - ${yamlScalar(String(entry))}`);
      }
    } else if (item !== null && typeof item === "object") {
      lines.push(`${pad}${name}:`);
      for (const [inner, text] of Object.entries(item)) {
        lines.push(`${pad}  ${inner}: ${yamlScalar(String(text))}`);
      }
    } else lines.push(`${pad}${name}: ${yamlScalar(String(item))}`);
  }
  return `${lines.join("\n")}\n`;
}

// 선택 제품·범위의 설정 조각이다. 파일을 읽거나 쓰지 않는다.
export function mcpConfigOf(
  input: McpConfigRequest,
  base: LaunchBase,
): Result<McpConfigOutput> {
  const definition = catalogOf(input.target);
  if (definition === undefined) {
    return err({ code: "invalid_input", message: "알 수 없는 제품이다" });
  }
  if (input.connection === undefined) {
    return err({ code: "invalid_input", message: "connection이 필요하다" });
  }
  const launch = launchOf({
    ...base,
    connection: input.connection,
    toolsets: input.toolsets ?? DEFAULT_TOOLSETS,
  });
  const entry = mcpEntryOf(definition.mcp_shape, launch) as Record<
    string,
    unknown
  >;
  const seat = definition.config_targets.find((item) =>
    item.scope_kind === input.scope
  );
  // OpenClaw는 자동 merge 대상이 없고 사람 config의 조각만 안내한다.
  if (seat === undefined && definition.harness_id !== "openclaw") {
    return err({
      code: "invalid_input",
      message:
        `${definition.label}은 ${input.scope} 범위 MCP 설정을 만들지 않는다`,
    });
  }
  const key = seat?.owned_key ?? "mcp.servers.lophn";
  const format = seat?.format ?? "json";
  const location = seat === undefined
    ? null
    : `${seat.root_resolver}/${seat.path}`;
  let text: string;
  if (format === "toml") {
    const set = setToml("", key, entry);
    text = set.kind === "changed" ? set.text : "";
  } else if (format === "yaml") text = yamlText(key, entry);
  else text = `${JSON.stringify(nest(key, entry), null, 2)}\n`;
  return ok({
    target: input.target,
    scope: input.scope,
    executable: launch.executable,
    args: launch.args,
    env: launch.env,
    fragment: { format, key, location, text },
  });
}
