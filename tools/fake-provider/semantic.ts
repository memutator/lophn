// 정상 흐름만 protocol 응답으로 바꾼다. 오류·partial·reset·여러 tool은 raw response로 써서
// 여기가 종료 event를 합성하지 않게 한다.
import type { Protocol, SemanticReply, StepResponse } from "./types.ts";

type Usage = NonNullable<SemanticReply["usage"]>;

function json(value: unknown): string {
  return JSON.stringify(value);
}

function anthropicUsage(
  usage: Usage | undefined,
): Record<string, number> | undefined {
  if (!usage) return undefined;
  const out: Record<string, number> = {};
  // Anthropic은 cache를 input 합계 밖에 둔다. 없는 필드는 0으로 채우지 않는다.
  if (usage.input !== undefined) out.input_tokens = usage.input;
  if (usage.cacheRead !== undefined) {
    out.cache_read_input_tokens = usage.cacheRead;
  }
  if (usage.cacheWrite !== undefined) {
    out.cache_creation_input_tokens = usage.cacheWrite;
  }
  if (usage.output !== undefined) out.output_tokens = usage.output;
  return Object.keys(out).length ? out : undefined;
}

function responsesUsage(
  usage: Usage | undefined,
): Record<string, unknown> | undefined {
  if (!usage) return undefined;
  const out: Record<string, unknown> = {};
  // OpenAI는 cache를 input 합계 안에 둔다.
  if (usage.input !== undefined) out.input_tokens = usage.input;
  if (usage.output !== undefined) out.output_tokens = usage.output;
  if (usage.cacheRead !== undefined) {
    out.input_tokens_details = { cached_tokens: usage.cacheRead };
  }
  if (usage.reasoning !== undefined) {
    out.output_tokens_details = { reasoning_tokens: usage.reasoning };
  }
  return Object.keys(out).length ? out : undefined;
}

function anthropic(reply: SemanticReply): StepResponse {
  const stop = reply.stop ?? (reply.toolCalls?.length ? "tool_calls" : "end");
  const stopReason = stop === "max_tokens"
    ? "max_tokens"
    : stop === "tool_calls"
    ? "tool_use"
    : "end_turn";
  const content: unknown[] = [];
  if (reply.text !== undefined) {
    content.push({ type: "text", text: reply.text });
  }
  for (const call of reply.toolCalls ?? []) {
    content.push({
      type: "tool_use",
      id: call.id,
      name: call.name,
      input: JSON.parse(call.arguments),
    });
  }
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: json({
      id: "msg_fixture",
      type: "message",
      role: "assistant",
      content,
      stop_reason: stopReason,
      ...(anthropicUsage(reply.usage)
        ? { usage: anthropicUsage(reply.usage) }
        : {}),
    }),
  };
}

function responses(reply: SemanticReply): StepResponse {
  const stop = reply.stop ?? (reply.toolCalls?.length ? "tool_calls" : "end");
  const cut = stop === "incomplete" || stop === "max_tokens";
  const output: unknown[] = [];
  if (reply.text !== undefined) {
    output.push({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: reply.text }],
    });
  }
  for (const call of reply.toolCalls ?? []) {
    output.push({
      type: "function_call",
      call_id: call.id,
      name: call.name,
      arguments: call.arguments,
    });
  }
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: json({
      id: "resp_fixture",
      status: cut ? "incomplete" : "completed",
      ...(stop === "max_tokens"
        ? { incomplete_details: { reason: "max_output_tokens" } }
        : {}),
      output,
      ...(responsesUsage(reply.usage)
        ? { usage: responsesUsage(reply.usage) }
        : {}),
    }),
  };
}

function chat(reply: SemanticReply): StepResponse {
  const stop = reply.stop ?? (reply.toolCalls?.length ? "tool_calls" : "end");
  const finish = stop === "length"
    ? "length"
    : stop === "tool_calls"
    ? "tool_calls"
    : "stop";
  const message: Record<string, unknown> = { role: "assistant" };
  if (reply.text !== undefined) message.content = reply.text;
  if (reply.toolCalls?.length) {
    message.tool_calls = reply.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    }));
  }
  const usage = reply.usage;
  const body: Record<string, unknown> = {
    id: "chatcmpl_fixture",
    choices: [{ index: 0, message, finish_reason: finish }],
  };
  if (usage) {
    body.usage = {
      ...(usage.input !== undefined ? { prompt_tokens: usage.input } : {}),
      ...(usage.output !== undefined
        ? { completion_tokens: usage.output }
        : {}),
      ...(usage.cacheRead !== undefined
        ? { prompt_tokens_details: { cached_tokens: usage.cacheRead } }
        : {}),
      ...(usage.reasoning !== undefined
        ? { completion_tokens_details: { reasoning_tokens: usage.reasoning } }
        : {}),
    };
  }
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: json(body),
  };
}

const BUILDERS: Record<Protocol, (reply: SemanticReply) => StepResponse> = {
  messages: anthropic,
  responses,
  chat_completions: chat,
};

export function buildReply(
  protocol: Protocol,
  reply: SemanticReply,
): StepResponse {
  return BUILDERS[protocol](reply);
}
