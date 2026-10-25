// tool 줄의 분류·제목. 저장하지 않고 ToolCallStarted·ListToolCalls를 낼 때 만든다. 제목을 만드는
// 규칙이 없거나 redaction을 끝내지 못하면 tool 이름을 `other`로 낸다.
import type { ToolCallDisplay } from "../../../protocol/lophn-agent/mod.ts";
import type { ToolDefinition } from "./registry.ts";

export function toolCallDisplay(
  _definition: ToolDefinition | undefined,
  name: string,
  _input: unknown,
  _redact: (text: string) => string | null | Promise<string | null>,
): Promise<ToolCallDisplay> {
  return Promise.resolve({ category: "other", title: name });
}
