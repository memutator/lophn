import type { CallModel } from "../../packages/contracts/lophn-agent/mod.ts";
import {
  anthropicSystem,
  anthropicTools,
  type PromptMessage,
  type PromptRequest,
  type WirePacker,
} from "../../packages/lophn-agent/harness/prompt-assemble/mod.ts";
import { buildRequest as buildMessages } from "../../packages/lophn-agent/harness/provider/adapters/messages.ts";
import type { InvokeModelCall } from "../../packages/lophn-agent/harness/provider/work.ts";

// 선택한 provider adapter와 고정한 model 선택을 loop가 쓰는 한 묶음으로 만든다. 선택·검증(catalog,
// credential)은 앞 단계가 끝낸 CallModel이다. 이 묶음은 요청 번역(pack)과 호출(invoke)만 안다.

export type ModelBinding = {
  call: CallModel;
  preset: { id: string; revision: number };
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
export function anthropicPacker(input: {
  model: string;
  maxTokens: number;
}): WirePacker {
  return (request: PromptRequest) => ({
    body: buildMessages({
      model: input.model,
      max_tokens: input.maxTokens,
      system: anthropicSystem(request),
      messages: anthropicMessages(request.messages),
      tools: anthropicTools(request),
      boundaries: { system: false, tools: false, final_user: false },
    }),
    opaque_bytes: 0,
  });
}
