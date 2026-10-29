import type {
  PromptMessage,
  PromptPart,
  PromptRequest,
  PromptTool,
} from "./model.ts";

// provider와 무관한 tool loading이다. 숨긴 정의(`deferred`)는 tools[]에서 빼고, tool.load 결과 자리에 불러온 정의를
// 글로 싣는다. model은 그 tool을 tools[]에 늘 있는 `tool_call`로 부른다. tools[]가 session 동안 같고 불러온 정의는
// 이력 끝에 붙으므로 prefix가 그대로다. native loading을 받는 요청(Anthropic defer_loading)만 이 변환을 건너뛴다.

export type InlinePart = Exclude<PromptPart, { kind: "tool_result_reference" }>;

export type InlineRequest = Omit<PromptRequest, "messages"> & {
  messages: { role: PromptMessage["role"]; parts: InlinePart[] }[];
};

// 숨긴 정의 가운데 이름이 맞는 것만 싣는다. 앞 turn이 불러온 tool이 지금 목록에 없으면(runtime이 다시 떠 목록을 새로
// 만든 session) 빼고 알린다. 없는 정의를 실으면 부를 수 없는 tool을 알려 준다.
function loadedText(
  names: readonly string[],
  hidden: ReadonlyMap<string, PromptTool>,
): string {
  const found = names.flatMap((name) => {
    const tool = hidden.get(name);
    return tool === undefined
      ? []
      : [
          {
            name: tool.name,
            description: tool.description,
            input_schema: tool.input_schema,
          },
        ];
  });
  if (found.length === 0) return "The loaded tools are no longer available.";
  return `Loaded tool definitions. Call each one with tool_call {"name": "<name>", "input": {...}}:\n${JSON.stringify(found)}`;
}

export function inlineToolLoading(request: PromptRequest): InlineRequest {
  const hidden = new Map(
    request.tools
      .filter((tool) => tool.deferred === true)
      .map((tool) => [tool.name, tool]),
  );
  return {
    system: request.system,
    tools: request.tools.filter((tool) => tool.deferred !== true),
    messages: request.messages.map((message) => {
      const parts: InlinePart[] = [];
      for (const part of message.parts) {
        if (part.kind !== "tool_result_reference") {
          parts.push(part);
          continue;
        }
        // 참조 조각은 늘 같은 id의 tool_result 뒤에 온다(historyResultParts). 그 결과 글 뒤에 정의를 잇는다.
        const text = loadedText(part.names, hidden);
        const at = parts.findIndex(
          (other) => other.kind === "tool_result" && other.id === part.id,
        );
        const result = parts[at];
        if (result?.kind === "tool_result") {
          parts[at] = { ...result, text: `${result.text}\n${text}` };
        } else parts.push({ kind: "tool_result", id: part.id, text });
      }
      return { role: message.role, parts };
    }),
  };
}
