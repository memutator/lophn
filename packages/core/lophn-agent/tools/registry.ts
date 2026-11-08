import type { z } from "zod";
import { canonicalize, type Result, sha256Hex } from "../../../base/mod.ts";
import type { AskedCall } from "../../../protocol/approvals/mod.ts";
import type {
  ToolCallDisplay,
  ToolEffect,
  ToolResult,
} from "../../../protocol/lophn-agent/mod.ts";
import type { ToolContext } from "./tool-context.ts";
import { inputJsonSchema } from "./wire.ts";

// tool 하나는 정의 하나다. 목록과 실행이 같은 schema·효과를 쓴다.
// 내장 이름은 `<자원>.<동사>` 점 표기다. model에는 wire 이름으로 간다(wire.ts).

type ToolOrigin = "builtin" | "app" | "external" | "extension";

export type ToolCallHandler = (
  input: unknown,
  ctx: ToolContext,
) => Promise<Result<ToolResult>>;

export type ToolDefinition = {
  // 정본 이름. wire 이름은 여기서 만든다.
  name: string;
  description: string;
  input: z.ZodType;
  // model에 보이는 입력 JSON Schema. 없으면 `input`에서 만든다. 앱 command처럼 선언이 이미 JSON Schema인 정의가
  // 자기 schema를 그대로 보이려고 쓴다. 실행 검사는 어느 쪽이든 `input`이 한다.
  inputSchema?: Record<string, unknown>;
  // registry와 Gate만 읽는다. model에 보이는 정의에는 없다.
  effect: ToolEffect;
  origin: ToolOrigin;
  // 실행. 정의에 handler가 없는 tool(앱, MCP)은 handlers 표로 실행한다.
  handler?: ToolCallHandler;
  // 사람 화면의 tool 줄 제목이다. 값은 실행기 검사(`input`)를 지난 입력만 받고 redaction 전 글이다.
  // 저장하지 않고 model에 보이지 않는다.
  display?: (input: unknown) => ToolCallDisplay;
  // Gate가 걸리는 tool만 둔다. null이면 그 호출은 거치지 않는다.
  // 값은 Gate에 넘길 호출이다. core를 읽어야 정해지는 호출이 있어 Promise도 된다.
  gate?: (
    input: unknown,
    ctx: ToolContext,
  ) => AskedCall | null | Promise<AskedCall | null>;
  // 이 tool이 core에 부르는 route 이름이다. agent credential 상한은 core가 대조하는 route 이름이어야 한다.
  operations: readonly string[];
};

// turn의 agent 자격이 가져야 하는 operation 목록이다. 제공 목록이 부르는 route 이름의 합집합이다.
export function runOperations(
  listed: readonly ToolDefinition[],
): readonly string[] {
  return [...new Set(listed.flatMap((definition) => definition.operations))];
}

// 정의가 바뀌었는지 가르는 값이다. model에 보이는 칸(이름, 설명, 입력 schema)과 효과에서 계산한다.
export async function definitionHash(tool: ToolDefinition): Promise<string> {
  const text = canonicalize([
    tool.name,
    tool.description,
    inputJsonSchema(tool),
    tool.effect,
  ]);
  return (await sha256Hex(text)).slice(0, 16);
}

// workspace 종류가 고정한 이름 목록에 든 정의다. 순서는 `definitions` 순서다(같은 판의 같은 bytes).
// model이 image를 받지 못하면 `image.read`를 뺀다. 정의가 없는 이름은 건너뛴다.
export function selectTools(
  names: readonly string[],
  model: { input_media: readonly string[] },
  definitions: readonly ToolDefinition[],
): readonly ToolDefinition[] {
  const allowed = new Set(names);
  if (!model.input_media.includes("image")) allowed.delete("image.read");
  return definitions.filter((tool) => allowed.has(tool.name));
}
