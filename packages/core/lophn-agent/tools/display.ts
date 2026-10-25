// tool 줄의 분류·제목. 저장하지 않고 ToolCallStarted·ListToolCalls를 낼 때 만든다. 제목을 만드는
// 규칙이 없거나 redaction을 끝내지 못하면 tool 이름을 `other`로 낸다.
import type { ToolCallDisplay } from "../../../protocol/lophn-agent/mod.ts";
import type { ToolDefinition } from "./registry.ts";

// 제목은 한 줄이고 이보다 길면 앞 119자에 `…`를 붙인다.
const TITLE_MAX_CHARS = 120;

export async function toolCallDisplay(
  definition: ToolDefinition | undefined,
  name: string,
  input: unknown,
  redact: (text: string) => string | null | Promise<string | null>,
): Promise<ToolCallDisplay> {
  const fallback: ToolCallDisplay = { category: "other", title: name };
  const display = definition?.display;
  if (definition === undefined || display === undefined) return fallback;
  // 저장된 입력은 model이 틀리게 보낸 것일 수 있다.
  const parsed = definition.input.safeParse(input);
  if (!parsed.success) return fallback;
  let made: ToolCallDisplay;
  try {
    made = display(parsed.data);
  } catch {
    return fallback;
  }
  // 자르기 전에 redaction한다. 자른 뒤에 하면 120자 경계에 걸친 secret의 앞부분이 남는다.
  const redacted = await redact(made.title);
  if (redacted === null) return fallback;
  const title = redacted.replace(/\s+/g, " ").trim();
  if (title === "") return fallback;
  const chars = Array.from(title);
  return {
    category: made.category,
    title: chars.length > TITLE_MAX_CHARS
      ? `${chars.slice(0, TITLE_MAX_CHARS - 1).join("")}…`
      : title,
  };
}
