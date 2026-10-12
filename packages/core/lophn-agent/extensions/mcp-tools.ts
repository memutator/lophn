import { z } from "zod";
import {
  err,
  fingerprint,
  ok,
  type Result,
  sha256Hex,
} from "../../../base/mod.ts";
import type {
  McpServerConfig,
  ToolEffect,
  ToolResult,
} from "../../../protocol/lophn-agent/mod.ts";
import { limitJson } from "../tools/mod.ts";
import type {
  RunCredential,
  ToolDefinition,
  ToolHandler,
} from "../tools/mod.ts";

// 외부 MCP tool 자동 등록(concern lophn-agent/extensions).
// 연결 관리(mcp-connections.ts)가 검증을 모두 지난 목록을 주면 원래 쌍마다 호출 이름·정의 hash·사람 분류를
// 붙여 harness/tools의 ToolDefinition으로 만든다. 사람의 설정(registry)과 preset 선택만이 출처이며
// 문서·skill·server 응답은 어느 정의에도 들어가지 않는다.

// 소유 contract 이름 하나다. 외부 tool 호출은 MCP 통로 하나뿐이다. 판정·실행이 이 이름 하나를 본다.
export const EXTERNAL_TOOL_CONTRACT = "external_mcp_call";

// approval이 가리키는 소유 concern이다(platform/approvals의 concern id 모양).
export const EXTERNAL_TOOL_CONCERN = "lophn-agent/extensions";

// 서버+tool 쌍 하나의 대상 ID다. approval의 대상은 고정 ID 모양(`xxx_` + 26자)이어야 해서 정확한 쌍
// UTF-8 `JSON.stringify([server, tool])`의 SHA-256 앞 128 bit를 ULID 문자로 적는다. 같은 쌍은 늘
// 같은 ID이고 이름 충돌 처리와 무관하다.
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
export async function externalToolTargetId(
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

// 내장 묶음과 같은 실패 종류다. 목록·실행이 같은 종류를 쓴다(tools).
const EXTERNAL_TOOL_ERRORS: readonly string[] = [
  "invalid_input",
  "not_found",
  "forbidden",
  "conflict",
  "unavailable",
];

// 호출 이름의 접두다(tool-values canonicalExternalToolSchema).
export const EXTERNAL_TOOL_PREFIX = "ext_";

// 서버의 원래 tool 하나다. 목록 검증(mcp-connections)을 지난 view에 MCP 행동 hints를 얹은 값이다.
// hints는 사람 제안 참고일 뿐 분류·승인 근거가 아니다.
export type McpToolEntry = {
  server: string;
  // 서버가 알려준 원래 tool 이름이다.
  original: string;
  description: string | null;
  schema: Record<string, unknown>;
  hints?: {
    readOnly?: boolean;
    destructive?: boolean;
    idempotent?: boolean;
    openWorld?: boolean;
  };
};

// 등록된 서버 설정이다. 사람의 분류(classifications) 원본이 여기 있다.
export type McpToolsSource = {
  // 이름 → 설정. 존재하지 않는 서버는 연결도 정의도 없다.
  servers: ReadonlyMap<string, McpServerConfig>;
  // 검증을 모두 지난 tool 목록이다(mcp-connections toolList).
  tools: readonly McpToolEntry[];
};

// 사람이 고른 preset MCP 선택이다. 정확한 쌍만, wildcard는 없다.
export type McpSelection = {
  servers: readonly string[];
  tools: readonly { server_name: string; original_tool: string }[];
  // 안전 표시다. 이 쌍만 confirm 질문을 건너뛴다.
  safe_tools: readonly { server_name: string; original_tool: string }[];
};

// 기본 이름이다. 서버·tool 원래 이름의 지원 문자만 남기고 축약한다.
export function baseExternalToolName(server: string, original: string): string {
  const serverPart = server.replace(/[^A-Za-z0-9_-]+/g, "_");
  const toolPart = original.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40);
  return `${EXTERNAL_TOOL_PREFIX}${serverPart.slice(0, 16)}_${toolPart}`;
}

// 충돌 묶음의 suffix다. 원래 쌍 UTF-8 `JSON.stringify([server, tool])`의
// SHA-256 앞 8자라 등록 순서와 무관하다.
export function externalToolHashSuffix(
  server: string,
  original: string,
): Promise<string> {
  return sha256Hex(JSON.stringify([server, original])).then((hash) =>
    hash.slice(0, 8)
  );
}

// 정의를 만들기 전 이름·충돌 묶음을 정한다. 기본 이름이 겹치는 쌍은 묶음 전체에
// suffix를 붙인다. 남은 충돌은 등록을 거절한다.
export async function assignExternalToolNames(
  pairs: readonly { server: string; original: string }[],
): Promise<
  Result<ReadonlyMap<string, string>, { code: "conflict"; message: string }>
> {
  const canonical = new Map<string, string>();
  const groups = new Map<string, number[]>();
  for (let index = 0; index < pairs.length; index++) {
    const pair = pairs[index];
    const base = baseExternalToolName(pair.server, pair.original);
    canonical.set(`${pair.server}\0${pair.original}`, base);
    const group = groups.get(base) ?? [];
    group.push(index);
    groups.set(base, group);
  }
  for (const group of groups.values()) {
    if (group.length === 1) continue;
    for (const index of group) {
      const pair = pairs[index];
      const base = canonical.get(`${pair.server}\0${pair.original}`)!;
      const suffix = await externalToolHashSuffix(pair.server, pair.original);
      const renamed = `${base.slice(0, 55)}_${suffix}`;
      canonical.set(`${pair.server}\0${pair.original}`, renamed);
    }
  }
  // 남은 충돌은 등록 거절이다. 숫자로 우회하지 않는다.
  const seen = new Set<string>();
  for (const [key, name] of canonical) {
    if (seen.has(name)) {
      const [server, original] = key.split("\0");
      return err({
        code: "conflict",
        message:
          `tool 호출 이름 ${name} (${server}.${original})이 겹쳐 등록을 거절한다`,
      });
    }
    seen.add(name);
  }
  return ok(canonical);
}

// 사람 분류가 묶인 정의의 지문이다. 원본 정의의 name·description·inputSchema·hints만
// 본다. 하나라도 바뀌면 hash가 달라져 사람의 기존 분류를 이어 쓰지 않는다. hints는
// hash 재료일 뿐 분류 근거가 아니다.
export function mcpToolDefinitionHash(entry: McpToolEntry): Promise<string> {
  return fingerprint({
    name: entry.original,
    description: entry.description,
    inputSchema: entry.schema,
    hints: entry.hints ?? null,
  });
}

// 분류의 schema_hash가 현재 정의 hash와 같을 때만 사람 분류가 유효하다. 바뀐 정의·
// 분류가 없는 tool은 미분류 기본(external, 되돌림 모름 → confirm asks)으로 판정한다.
export function classificationOf(
  entry: McpToolEntry,
  server: McpServerConfig,
  definitionHash: string,
): { effect: ToolEffect; reversible: boolean; classified: boolean } {
  const found = server.classifications[entry.original];
  if (found === undefined || found.schema_hash !== definitionHash) {
    return { effect: "external", reversible: false, classified: false };
  }
  return {
    effect: found.effect,
    reversible: found.reversible,
    classified: true,
  };
}

// 여러 행동을 한 tool이 제공하면 가장 넓은 분류 하나를 적용한다:
// external > write > read.
export function widestEffect(effects: readonly ToolEffect[]): ToolEffect {
  if (effects.includes("external")) return "external";
  if (effects.includes("write")) return "write";
  return "read";
}

function pairKey(pair: { server_name: string; original_tool: string }): string {
  return `${pair.server_name}\0${pair.original_tool}`;
}

// 입력 검사다. 서버가 준 JSON Schema를 그대로 보이고(zod JSON Schema 변환 없이), 실행 검사는
// object인지만 본다. 서버 계약이 임의 JSON Schema라 lophn 쪽 zod_compile은 하지 않는다.
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

// MCP tool의 입력 JSON Schema다. 서버가 준 객체를 그대로 노출한다(검증을 지난 것만).
function toolInputSchema(entry: McpToolEntry): Record<string, unknown> {
  return entry.schema;
}

export type ExternalTool = {
  definition: ToolDefinition;
  server: string;
  // 서버가 알려준 원래 tool 이름이다. routing은 호출 이름이 아니라 이 이름으로 돌아간다.
  original: string;
  // 서버 설정 판이다(기록·판정 근거의 configuration_revision).
  configurationRevision: number;
  effect: ToolEffect;
  confirm: boolean;
  reversible: boolean;
  classified: boolean;
  definitionHash: string;
  // 이 쌍의 approval·범위 대상 ID다.
  target: string;
};

// 검증을 지난 목록과 사람 분류·preset 선택을 ToolDefinition으로 만든다. 사람의
// registry와 preset 선택만이 출처다: 어느 문서·skill·server 응답도 정의를 늘리지 않는다.
// 등록되지 않은 서버의 tool은 정의가 없다(없는 것과 같은 답). preset 선택 밖 tool도 정의가
// 없다(서버 전체·미래 tool 선택 없음).
export async function buildMcpTools(
  source: McpToolsSource,
  selection: McpSelection | null,
): Promise<
  Result<readonly ExternalTool[], { code: "conflict"; message: string }>
> {
  // 선택이 아직 고정되지 않았으면 제공도 없다. 선택된 서버·쌍만 남긴다.
  if (selection === null) return ok([]);
  const selectedServers = new Set(selection.servers);
  const selectedPairs = new Set(selection.tools.map(pairKey));
  const safePairs = new Set(selection.safe_tools.map(pairKey));
  const offered = source.tools.filter((entry) =>
    selectedServers.has(entry.server) &&
    selectedPairs.has(
      pairKey({ server_name: entry.server, original_tool: entry.original }),
    )
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
    const server = source.servers.get(entry.server);
    // 등록되지 않은 서버는 정의가 없다(사람만 서버를 정한다).
    if (server === undefined) continue;
    const name = names.value.get(`${entry.server}\0${entry.original}`)!;
    const definitionHash = await mcpToolDefinitionHash(entry);
    const classification = classificationOf(entry, server, definitionHash);
    // safe 표시다: 분류 기록이 아예 없는 tool은 사람이 그 tool을 직접 본
    // 표시 그대로 유효하다. 분류가 있었는데 정의 hash가 바뀐 tool은 분류와 함께
    // 무효다: safe 표시의 전제인 분류 일치가 무너진다.
    const hasClassification =
      server.classifications[entry.original] !== undefined;
    const safe = (!hasClassification || classification.classified) &&
      safePairs.has(pairKey({
        server_name: entry.server,
        original_tool: entry.original,
      }));
    const reversible = classification.reversible &&
      classification.effect !== "external";
    const notes = [
      classification.effect === "read"
        ? "reads only"
        : classification.effect === "write"
        ? "changes the machine's data"
        : "changes something outside lophn",
      ...(safe ? ["a person marked this tool safe"] : []),
      ...(reversible ? ["the person marks it reversible"] : []),
    ];
    const definition: ToolDefinition = {
      name,
      description: `MCP tool ${entry.original} of server ${entry.server}: ${
        entry.description ?? "(no description)"
      } (${notes.join("; ")})`,
      // revision은 정의 hash에서 온다. hash가 바뀌면 판정 근거도 새로 읽는다.
      revision: definitionHash.slice(0, 16),
      input: OBJECT_INPUT,
      inputSchema: toolInputSchema(entry),
      effect: classification.effect,
      // 안전 표시는 confirm 질문 하나만 건너뛴다. 역할 상한·confirm=true는 넓히지 못한다.
      confirm: classification.effect !== "read" && !safe,
      contract: EXTERNAL_TOOL_CONTRACT,
      scopeCheck: "tools the preset selection and role cap allow",
      // external은 되돌림 보장이 없다. write는 사람 선언만으로 보지 않는다.
      reversible,
      idempotent: classification.effect === "read",
      errors: EXTERNAL_TOOL_ERRORS,
      origin: "external",
    };
    tools.push({
      definition,
      server: entry.server,
      original: entry.original,
      configurationRevision: server.revision,
      effect: classification.effect,
      confirm: definition.confirm,
      reversible,
      classified: classification.classified,
      definitionHash,
      target: await externalToolTargetId(entry.server, entry.original),
    });
  }
  return ok(tools);
}

// ---- 호출 ----

export type McpInvokeCall = {
  // 사람이 붙인 서버 이름이다(원래 서버·tool로 정확히 돌아간다).
  server: string;
  original: string;
  input: unknown;
  // 같은 호출의 식별이다. 최초 ToolCall ID라 재전송이 handler를 다시 실행하지 않는다.
  requestKey: string;
};

export type McpCallOutcome =
  | { kind: "result"; result: unknown }
  // 요청은 나갔지만 응답을 못 받았다. 서버가 처리했는지 모른다.
  | { kind: "unknown"; reason: string };

// 이 ToolCall의 호출 통로다. 실제 연결은 agent runtime 조립이 낸다(mcp-connections). 연결이
// 없거나 사라진 이름은 err이다(없는 tool과 같은 답).
export type McpToolCall = (
  call: McpInvokeCall,
) => Promise<Result<unknown>>;

// 외부 MCP tool의 handler다. 판정과 진입 기록은 이 handler 앞에서 끝났다. 서버·원래
// 이름·입력을 그대로 MCP 통로에 넘긴다(호출 이름이 아니라 원래 쌍으로 routing한다).
export function createMcpToolHandlers(
  tools: readonly ExternalTool[],
  call: McpToolCall,
): ReadonlyMap<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  for (const tool of tools) {
    handlers.set(
      tool.definition.name,
      async (input: unknown, credential: RunCredential) => {
        const sent = await call({
          server: tool.server,
          original: tool.original,
          input,
          requestKey: credential.call ?? "",
        });
        if (!sent.ok) {
          return err({ code: "unavailable", message: sent.error.message });
        }
        const limited = limitJson(sent.value);
        // 상한을 넘은 결과는 content를 비우고 complete만 남긴다(limitJson).
        return ok(
          {
            status: "success",
            summary: `tool ${tool.original} of server ${tool.server} finished`,
            content: limited.content as ToolResult["content"],
            complete: limited.complete,
            source: null,
            continuation: null,
            pending: [],
          } satisfies ToolResult,
        );
      },
    );
  }
  return handlers;
}
