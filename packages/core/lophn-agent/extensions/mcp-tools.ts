import { z } from "zod";
import { err, ok, type Result, sha256Hex } from "../../../base/mod.ts";
import type { JsonObject } from "../../../protocol/base/json-values.ts";
import {
  MCP_TOOL_PREFIX,
  TOOL_NAME_MAX,
  type ToolEffect,
  type ToolResult,
} from "../../../protocol/lophn-agent/mod.ts";
import { limitJson } from "../tools/mod.ts";
import type {
  RunCredential,
  ToolDefinition,
  ToolHandler,
} from "../tools/mod.ts";
import type { McpToolView } from "./mcp-connections.ts";
import type { McpRuntimeServer } from "./mcp-server.ts";

// 외부 MCP tool 정의 만들기(concern lophn-agent/extensions).
// 연결 관리(mcp-connections.ts)가 검증을 모두 지난 목록을 주면 tool마다 정의 하나를 만든다. 이름은
// `mcp__<server>__<tool>`이다. 효과는 tool의 `readOnlyHint`가 참이면 read, 아니면 external이다. 묻는지는 agent
// grant가 정하고 Gate는 `executeToolCall`이 부른다. 문서, skill, server 응답은 정의를 늘리지 않고 결과는 감싸지 않는다.

// 소유 contract 이름 하나다. 외부 tool 호출은 MCP 통로 하나뿐이다.
export const EXTERNAL_TOOL_CONTRACT = "external_mcp_call";

// 서버+tool 쌍 하나의 대상 ID다. 정확한 쌍 UTF-8 `JSON.stringify([server, tool])`의 SHA-256 앞 128 bit를 ULID
// 문자로 적는다. 같은 쌍은 늘 같은 ID이고 이름 처리와 무관하다.
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
async function externalToolTargetId(
  server: string,
  original: string,
): Promise<string> {
  const hex = (await sha256Hex(JSON.stringify([server, original]))).slice(
    0,
    32,
  );
  let value = BigInt("0x" + hex);
  let text = "";
  for (let index = 0; index < 26; index += 1) {
    text = CROCKFORD[Number(value & 31n)] + text;
    value >>= 5n;
  }
  return "mcp_" + text;
}

// 내장 묶음과 같은 실패 종류다.
const EXTERNAL_TOOL_ERRORS: readonly string[] = [
  "invalid_input",
  "not_found",
  "forbidden",
  "conflict",
  "unavailable",
];

// 서버의 원래 tool 하나다. 목록 검증(mcp-connections)을 지난 view다.
export type McpToolEntry = McpToolView;

// 등록된 서버 설정과 검증을 지난 tool 목록이다.
export type McpToolsSource = {
  // 이름 → 설정. 존재하지 않는 서버는 연결도 정의도 없다.
  servers: ReadonlyMap<string, McpRuntimeServer>;
  tools: readonly McpToolEntry[];
};

// 모델에 내보일 tool이다. 정확한 쌍만, wildcard는 없다.
export type McpSelection = {
  servers: readonly string[];
  tools: readonly { server_name: string; original_tool: string }[];
};

function pairKey(pair: { server_name: string; original_tool: string }): string {
  return `${pair.server_name}\0${pair.original_tool}`;
}

// 호출 이름이다. `mcp__<server>__<tool>`이 wire 이름 규칙(영문, 숫자, `_`, `-`)에 맞고 64자 이하면 그대로이고,
// 아니면 안전하지 않은 글자를 `_`로 바꾸고 줄여 쌍의 hash를 뒤에 붙인다. 같은 쌍은 늘 같은 이름이다.
async function externalToolName(
  server: string,
  original: string,
): Promise<string> {
  const plain = `${MCP_TOOL_PREFIX}${server}__${original}`;
  if (plain.length <= TOOL_NAME_MAX && /^[A-Za-z0-9_-]+$/.test(plain)) {
    return plain;
  }
  const suffix = (await sha256Hex(JSON.stringify([server, original]))).slice(
    0,
    8,
  );
  const readable = plain.replace(/[^A-Za-z0-9_-]+/g, "_");
  return `${readable.slice(0, TOOL_NAME_MAX - suffix.length - 1)}_${suffix}`;
}

// 이름이 겹치는 쌍은 등록을 거절한다. 숫자로 우회하지 않는다.
async function assignExternalToolNames(
  pairs: readonly { server: string; original: string }[],
): Promise<
  Result<ReadonlyMap<string, string>, { code: "conflict"; message: string }>
> {
  const names = new Map<string, string>();
  const taken = new Map<string, string>();
  for (const pair of pairs) {
    const name = await externalToolName(pair.server, pair.original);
    const key = `${pair.server}\0${pair.original}`;
    if (taken.has(name)) {
      return err({
        code: "conflict",
        message:
          `tool 호출 이름 ${name} (${pair.server}.${pair.original})이 겹쳐 등록을 거절한다`,
      });
    }
    taken.set(name, key);
    names.set(key, name);
  }
  return ok(names);
}

// 입력 검사다. 서버가 준 JSON Schema를 그대로 보이고(zod JSON Schema 변환 없이), 실행 검사는 object인지만 본다.
const OBJECT_INPUT: z.ZodType = z.unknown().superRefine((value, context) => {
  const plain = typeof value === "object" && value !== null &&
    !Array.isArray(value);
  if (!plain) {
    context.addIssue({
      code: "custom",
      message: "tool input must be an object",
    });
  }
});

export type ExternalTool = {
  definition: ToolDefinition;
  server: string;
  // 서버가 알려준 원래 tool 이름이다. routing은 호출 이름이 아니라 이 이름으로 돌아간다.
  original: string;
  effect: ToolEffect;
  // 이 쌍의 범위 대상 ID다.
  target: string;
};

// 검증을 지난 목록과 선택을 ToolDefinition으로 만든다. 등록되지 않은 서버의 tool은 정의가 없고 선택 밖 tool도
// 정의가 없다(서버 전체, 미래 tool 선택 없음). call을 주면 정의가 handler를 들고 실행은 `executeToolCall`이 한다.
export async function buildMcpTools(
  source: McpToolsSource,
  selection: McpSelection | null,
  call?: McpToolCall,
): Promise<
  Result<readonly ExternalTool[], { code: "conflict"; message: string }>
> {
  if (selection === null) return ok([]);
  const selectedServers = new Set(selection.servers);
  const selectedPairs = new Set(selection.tools.map(pairKey));
  const offered = source.tools.filter((entry) =>
    selectedServers.has(entry.server) &&
    selectedPairs.has(
      pairKey({ server_name: entry.server, original_tool: entry.original }),
    ) && source.servers.has(entry.server)
  );
  const names = await assignExternalToolNames(
    offered.map((entry) => ({
      server: entry.server,
      original: entry.original,
    })),
  );
  if (!names.ok) return names;
  const tools: ExternalTool[] = [];
  for (const entry of offered) {
    const name = names.value.get(`${entry.server}\0${entry.original}`)!;
    const effect: ToolEffect = entry.read_only ? "read" : "external";
    const definition: ToolDefinition = {
      name,
      description: `MCP tool ${entry.original} of server ${entry.server}: ${
        entry.description ?? "(no description)"
      }`,
      revision: (await sha256Hex(JSON.stringify([
        entry.original,
        entry.description,
        entry.schema,
        entry.read_only,
      ]))).slice(0, 16),
      input: OBJECT_INPUT,
      inputSchema: entry.schema,
      effect,
      origin: "external",
      gate: (input) => ({
        kind: "mcp_tool",
        target: {
          kind: "mcp_tool",
          server: entry.server,
          tool: entry.original,
        },
        effect,
        input: input as JsonObject,
      }),
      ...(call === undefined ? {} : {
        handler: async (input, ctx) =>
          await invoke(call, {
            server: entry.server,
            original: entry.original,
            input,
            requestKey: ctx.tool_call,
          }),
      }),
      confirm: false,
      contract: EXTERNAL_TOOL_CONTRACT,
      reversible: false,
      idempotent: effect === "read",
      errors: EXTERNAL_TOOL_ERRORS,
    };
    tools.push({
      definition,
      server: entry.server,
      original: entry.original,
      effect,
      target: await externalToolTargetId(entry.server, entry.original),
    });
  }
  return ok(tools);
}

// 정의 목록의 표로 호출 이름에서 쌍을 거꾸로 찾는다. 이름을 parse하지 않는다.

// ---- 호출 ----

type McpInvokeCall = {
  // 사람이 붙인 서버 이름이다(원래 서버·tool로 정확히 돌아간다).
  server: string;
  original: string;
  input: unknown;
  // 같은 호출의 식별이다. 최초 ToolCall ID라 재전송이 handler를 다시 실행하지 않는다.
  requestKey: string;
};

// 이 ToolCall의 호출 통로다. 실제 연결은 agent runtime 조립이 낸다(mcp-connections). 연결이 없거나 사라진 이름은
// err이다(없는 tool과 같은 답).
export type McpToolCall = (
  call: McpInvokeCall,
) => Promise<Result<unknown>>;

async function invoke(
  call: McpToolCall,
  request: McpInvokeCall,
): Promise<Result<ToolResult>> {
  const sent = await call(request);
  if (!sent.ok) {
    return err({ code: "unavailable", message: sent.error.message });
  }
  const limited = limitJson(sent.value);
  // 상한을 넘은 결과는 content를 비우고 complete만 남긴다(limitJson). 결과는 감싸지 않는다.
  return ok(
    {
      status: "success",
      summary: `tool ${request.original} of server ${request.server} finished`,
      content: limited.content as ToolResult["content"],
      complete: limited.complete,
      source: null,
      continuation: null,
      pending: [],
    } satisfies ToolResult,
  );
}

// 정의가 handler를 들지 않은 옛 실행 길의 handler 표다. 호출 이름 → handler.
export function createMcpToolHandlers(
  tools: readonly ExternalTool[],
  call: McpToolCall,
): ReadonlyMap<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  for (const tool of tools) {
    handlers.set(
      tool.definition.name,
      async (input: unknown, credential: RunCredential) =>
        await invoke(call, {
          server: tool.server,
          original: tool.original,
          input,
          requestKey: credential.call ?? "",
        }),
    );
  }
  return handlers;
}
