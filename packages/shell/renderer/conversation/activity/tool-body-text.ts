// tool 줄을 펼쳤을 때의 입력·출력 글. DOM이 없어 폰의 단계 sheet도 import한다.
import type { ToolCallBodyView } from "../agent-tab-source.ts";
import type { ToolCallView } from "./model.ts";

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 입력 글: shell.run은 명령 전체, 그 밖은 입력 JSON이다. 잘린 값은 JSON 글의 앞부분 문자열이다. harness가 실은 본문은
 * 이미 글이라 따옴표 없이 그대로 보인다.
 */
export function inputText(call: ToolCallView, body: ToolCallBodyView): string {
  if (body.truncated || typeof body.value === "string") {
    return String(body.value);
  }
  const command =
    call.tool === "shell.run" ? recordOf(body.value)?.["command"] : undefined;
  return typeof command === "string"
    ? command
    : (JSON.stringify(body.value, null, 2) ?? "");
}

/** 출력 글: shell.run은 stdout과 stderr를 잇고, 그 밖은 결과의 content다. */
export function outputText(call: ToolCallView, body: ToolCallBodyView): string {
  if (body.truncated || typeof body.value === "string") {
    return String(body.value);
  }
  if (call.tool === "shell.run") {
    const content = recordOf(recordOf(body.value)?.["content"]);
    if (content !== null) {
      return [content["stdout"], content["stderr"]]
        .filter(
          (text): text is string => typeof text === "string" && text !== "",
        )
        .join("\n");
    }
  }
  const content = recordOf(body.value)?.["content"] ?? body.value;
  return typeof content === "string"
    ? content
    : (JSON.stringify(content, null, 2) ?? "");
}
