import type { CallModel } from "../../packages/protocol/lophn-agent/mod.ts";
import type { JsonObject } from "../../packages/protocol/platform/mod.ts";
import {
  anthropicSystem,
  anthropicTools,
  type PromptMessage,
  type PromptRequest,
  type WirePacker,
} from "../../packages/core/lophn-agent/prompt-assembly/mod.ts";
import { buildRequest as buildChat } from "../../packages/core/lophn-agent/providers/adapters/chat-completions.ts";
import { buildRequest as buildMessages } from "../../packages/core/lophn-agent/providers/adapters/messages.ts";
import { buildRequest as buildResponses } from "../../packages/core/lophn-agent/providers/adapters/responses.ts";
import type { InvokeModelCall } from "../../packages/core/lophn-agent/providers/work.ts";

// 선택한 provider adapter와 고정한 model 선택을 loop가 쓰는 한 묶음으로 만든다. 선택·검증(catalog,
// credential)은 앞 단계가 끝낸 CallModel이다. 이 묶음은 요청 번역(pack)과 호출(invoke)만 안다.

export type ModelBinding = {
  call: CallModel;
  // provider API base. adapter가 path를 붙인다.
  endpoint: string;
  // token 사용량 정의 판(usage#R6).
  usageRevision: string;
  timeoutMs: number | null;
  pack: WirePacker;
  invoke: InvokeModelCall;
  // provider가 켜져 있고 쓸 수 있는지(R25).
  available(): Promise<boolean>;
};

function anthropicMessages(messages: readonly PromptMessage[]): unknown[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.parts.map((part) => {
      if (part.kind === "text") return { type: "text", text: part.text };
      if (part.kind === "tool_use") {
        return {
          type: "tool_use",
          id: part.id,
          name: part.name,
          input: part.input,
        };
      }
      return {
        type: "tool_result",
        tool_use_id: part.id,
        content: part.text,
      };
    }),
  }));
}

// Anthropic Messages 번역. cache 표시는 system 층에 이미 있어 adapter의 경계 표시는 모두 끈다(T19).
// model은 요청에 실을 이름(sent_model_name)이고 requestPatch는 option 값이 싣는 조각이다(harness/model#R22).
export function anthropicPacker(input: {
  model: string;
  maxTokens: number;
  requestPatch?: JsonObject;
}): WirePacker {
  return (request: PromptRequest) => ({
    body: buildMessages({
      model: input.model,
      max_tokens: input.maxTokens,
      system: anthropicSystem(request),
      messages: anthropicMessages(request.messages),
      tools: anthropicTools(request),
      boundaries: { system: false, tools: false, final_user: false },
      request_patch: input.requestPatch,
    }),
    opaque_bytes: 0,
  });
}

// system 층은 하나의 지시문으로 잇는다. OpenAI 계열은 cache를 자동으로 하므로 경계 표시가 없다(R26).
function systemText(request: PromptRequest): string {
  return request.system.map((block) => block.text).join("\n\n");
}

// OpenAI Responses 번역(provider#R3). function_call.call_id와 function_call_output.call_id가 대응한다.
// 연속한 text 조각은 한 message item이고 tool 결과·호출은 자기 item이다.
function responsesInput(messages: readonly PromptMessage[]): unknown[] {
  const items: unknown[] = [];
  for (const message of messages) {
    const text = message.role === "user" ? "input_text" : "output_text";
    let open: { type: string; text: string }[] | undefined;
    for (const part of message.parts) {
      if (part.kind === "text") {
        if (open === undefined) {
          open = [];
          items.push({ type: "message", role: message.role, content: open });
        }
        open.push({ type: text, text: part.text });
        continue;
      }
      open = undefined;
      if (part.kind === "tool_use") {
        items.push({
          type: "function_call",
          call_id: part.id,
          name: part.name,
          arguments: JSON.stringify(part.input),
        });
      } else {
        items.push({
          type: "function_call_output",
          call_id: part.id,
          output: part.text,
        });
      }
    }
  }
  return items;
}

export function responsesPacker(input: {
  model: string;
  maxTokens: number;
  requestPatch?: JsonObject;
}): WirePacker {
  return (request: PromptRequest) => ({
    body: buildResponses({
      model: input.model,
      instructions: systemText(request),
      input: responsesInput(request.messages),
      tools: request.tools.map((tool) => ({
        type: "function" as const,
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      })),
      max_output_tokens: input.maxTokens,
      request_patch: input.requestPatch,
    }).body,
    opaque_bytes: 0,
  });
}

// OpenAI Chat Completions 번역(provider#R3). assistant의 tool_calls[].id와 tool message의
// tool_call_id가 대응한다. 사람이 읽을 추론 본문은 보내지 않는다.
function chatMessages(messages: readonly PromptMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      const text = message.parts.flatMap((part) =>
        part.kind === "text" ? [part.text] : []
      ).join("");
      const calls = message.parts.flatMap((part) =>
        part.kind === "tool_use"
          ? [{
            id: part.id,
            type: "function" as const,
            function: {
              name: part.name,
              arguments: JSON.stringify(part.input),
            },
          }]
          : []
      );
      out.push({
        role: "assistant",
        ...(text === "" ? {} : { content: text }),
        ...(calls.length === 0 ? {} : { tool_calls: calls }),
      });
      continue;
    }
    let texts: string[] = [];
    const flush = () => {
      if (texts.length > 0) out.push({ role: "user", content: texts.join("") });
      texts = [];
    };
    for (const part of message.parts) {
      if (part.kind === "text") {
        texts.push(part.text);
        continue;
      }
      flush();
      if (part.kind === "tool_result") {
        out.push({ role: "tool", tool_call_id: part.id, content: part.text });
      }
    }
    flush();
  }
  return out;
}

export function chatPacker(input: {
  model: string;
  maxTokens: number;
  // provider 정의 key. 정의가 요구하는 quirk를 고른다.
  provider: string;
  requestPatch?: JsonObject;
}): WirePacker {
  return (request: PromptRequest) => ({
    body: buildChat({
      model: input.model,
      provider: input.provider,
      system: systemText(request),
      messages: chatMessages(request.messages),
      tools: request.tools.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        },
      })),
      max_tokens: input.maxTokens,
      request_patch: input.requestPatch,
    }),
    opaque_bytes: 0,
  });
}
