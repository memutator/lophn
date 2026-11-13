import type { CallModel } from "../../../protocol/lophn-agent/mod.ts";
import type { JsonObject } from "../../../protocol/base/mod.ts";
import {
  anthropicSystem,
  anthropicTools,
  type PromptMessage,
  type PromptRequest,
  type WirePacker,
} from "../prompt-assembly/mod.ts";
import {
  buildRequest as buildChat,
  imagePart,
} from "../providers/adapters/chat-completions.ts";
import { buildCloudCodeRequest as buildCloudCode } from "../providers/adapters/cloud-code.ts";
import {
  buildRequest as buildMessages,
  imageBlock,
} from "../providers/adapters/messages.ts";
import {
  buildRequest as buildResponses,
  imageItem,
} from "../providers/adapters/responses.ts";
import type { InvokeModelCall } from "../providers/work.ts";

// 선택한 provider adapter와 고정한 model 선택을 loop가 쓰는 한 묶음으로 만든다. 선택·검증(catalog,
// credential)은 앞 단계가 끝낸 CallModel이다. 이 묶음은 요청 번역(pack)과 호출(invoke)만 안다.

// 전송하는 output 상한과 입력 예산의 예약 몫은 같은 값이다. catalog/override의 output을
// 그대로 쓰되 전체 context를 전부 output으로 예약하지 않는다.

export function cappedOutput(limits: {
  context_limit: number;
  output_limit: number;
}): number {
  return Math.min(limits.output_limit, Math.max(1, limits.context_limit - 1));
}

export type ModelBinding = {
  call: CallModel;
  // model이 받는 입력 media. image를 받지 못하면 image tool을 주지 않는다.
  inputMedia: readonly string[];
  // provider API base. adapter가 path를 붙인다.
  endpoint: string;
  // token 사용량 정의 판.
  usageRevision: string;
  pack: WirePacker;
  invoke: InvokeModelCall;
  // provider가 켜져 있고 쓸 수 있는지.
  available(): Promise<boolean>;
};

// 이미지 입력이 없는 model에는 이미지를 보내지 않고 글 한 줄로 바꾼다.
const IMAGE_OMITTED = "(image omitted: this model does not accept image input)";

function anthropicMessages(
  messages: readonly PromptMessage[],
  images: boolean,
): unknown[] {
  return messages.map((message) => {
    const content: Record<string, unknown>[] = [];
    for (const part of message.parts) {
      if (part.kind === "text") {
        content.push({ type: "text", text: part.text });
      } else if (part.kind === "image") {
        content.push(
          images
            ? (imageBlock(part.media_type, part.data_base64) as Record<
                string,
                unknown
              >)
            : { type: "text", text: IMAGE_OMITTED },
        );
      } else if (part.kind === "tool_use") {
        content.push({
          type: "tool_use",
          id: part.id,
          name: part.name,
          input: part.input,
        });
      } else if (part.kind === "tool_result") {
        content.push({
          type: "tool_result",
          tool_use_id: part.id,
          content: part.text,
        });
      } else if (part.kind === "tool_result_image") {
        // 같은 tool_use id의 tool_result 안에 이미지를 더한다. 앞에 그 결과가 없으면 이미지만 담는다.
        const extra = images
          ? imageBlock(part.media_type, part.data_base64)
          : { type: "text", text: IMAGE_OMITTED };
        const result = content.find(
          (block) =>
            block.type === "tool_result" && block.tool_use_id === part.id,
        );
        if (result === undefined) {
          content.push({
            type: "tool_result",
            tool_use_id: part.id,
            content: [extra],
          });
        } else {
          const text = result.content;
          result.content = [
            ...(typeof text === "string" && text !== ""
              ? [{ type: "text", text }]
              : Array.isArray(text)
                ? text
                : []),
            extra,
          ];
        }
      }
    }
    return { role: message.role, content };
  });
}

// Anthropic Messages 번역. cache 표시는 system 층(anthropicSystem)과 대화 끝(buildRequest)이 단다.
// model은 요청에 실을 이름(sent_model_name)이고 requestPatch는 option 값이 싣는 조각이다.
export function anthropicPacker(input: {
  model: string;
  maxTokens: number;
  images: boolean;
  requestPatch?: JsonObject;
}): WirePacker {
  return (request: PromptRequest) => {
    return {
      body: buildMessages({
        model: input.model,
        max_tokens: input.maxTokens,
        system: anthropicSystem(request),
        messages: anthropicMessages(request.messages, input.images),
        tools: anthropicTools(request),
        request_patch: input.requestPatch,
      }),
      opaque_bytes: 0,
    };
  };
}

// system 층은 하나의 지시문으로 잇는다. OpenAI 계열은 cache를 자동으로 하므로 경계 표시가 없다.
function systemText(request: Pick<PromptRequest, "system">): string {
  return request.system.map((block) => block.text).join("\n\n");
}

// OpenAI Responses 번역. function_call.call_id와 function_call_output.call_id가 대응한다.
// 연속한 text 조각은 한 message item이고 tool 결과·호출은 자기 item이다.
function responsesInput(messages: PromptMessage[], images: boolean): unknown[] {
  const items: unknown[] = [];
  for (const message of messages) {
    const text = message.role === "user" ? "input_text" : "output_text";
    let open: unknown[] | undefined;
    for (const part of message.parts) {
      if (part.kind === "text" || part.kind === "image") {
        if (open === undefined) {
          open = [];
          items.push({ type: "message", role: message.role, content: open });
        }
        open.push(
          part.kind === "text"
            ? { type: text, text: part.text }
            : images
              ? imageItem(part.media_type, part.data_base64)
              : { type: "input_text", text: IMAGE_OMITTED },
        );
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
      } else if (part.kind === "tool_result") {
        items.push({
          type: "function_call_output",
          call_id: part.id,
          output: part.text,
        });
      } else if (part.kind === "tool_result_image") {
        // 같은 call_id의 결과 output을 배열로 바꿔 이미지를 더한다.
        const extra = images
          ? imageItem(part.media_type, part.data_base64)
          : { type: "input_text", text: IMAGE_OMITTED };
        const result = items.find((item) => {
          const typed = item as { type: string; call_id?: string };
          return (
            typed.type === "function_call_output" && typed.call_id === part.id
          );
        }) as { output: string | unknown[] } | undefined;
        if (result === undefined) {
          items.push({
            type: "function_call_output",
            call_id: part.id,
            output: [extra],
          });
        } else {
          result.output = [
            ...(typeof result.output === "string"
              ? result.output === ""
                ? []
                : [{ type: "input_text", text: result.output }]
              : result.output),
            extra,
          ];
        }
      }
    }
  }
  return items;
}

export function responsesPacker(input: {
  model: string;
  maxTokens: number;
  images: boolean;
  requestPatch?: JsonObject;
}): WirePacker {
  return (request: PromptRequest) => {
    return {
      body: buildResponses({
        model: input.model,
        instructions: systemText(request),
        input: responsesInput(request.messages, input.images),
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
    };
  };
}

// OpenAI Chat Completions 번역. assistant의 tool_calls[].id와 tool message의
// tool_call_id가 대응한다. 사람이 읽을 추론 본문은 보내지 않는다.
function chatMessages(messages: PromptMessage[], images: boolean): unknown[] {
  const out: unknown[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      // 한 turn의 agent message 여럿이 assistant message 하나의 text part 여럿으로 잇는다. 그대로 붙이면
      // 글이 맞붙으므로 줄바꿈 둘로 잇는다.
      const text = message.parts
        .flatMap((part) => (part.kind === "text" ? [part.text] : []))
        .join("\n\n");
      const calls = message.parts.flatMap((part) =>
        part.kind === "tool_use"
          ? [
              {
                id: part.id,
                type: "function" as const,
                function: {
                  name: part.name,
                  arguments: JSON.stringify(part.input),
                },
              },
            ]
          : [],
      );
      out.push({
        role: "assistant",
        ...(text === "" ? {} : { content: text }),
        ...(calls.length === 0 ? {} : { tool_calls: calls }),
      });
      continue;
    }
    // user가 보낸 글과 이미지. 이미지가 있으면 content가 배열이고 없으면 글 하나다.
    let pieces: unknown[] = [];
    let hasImage = false;
    // tool message에는 이미지를 실을 수 없다. tool message가 모두 나간 뒤 user message 하나로 보낸다.
    const pictures: unknown[] = [];
    const flush = () => {
      if (pieces.length > 0) {
        out.push({
          role: "user",
          content: hasImage
            ? pieces
            : pieces.map((piece) => (piece as { text: string }).text).join(""),
        });
      }
      pieces = [];
      hasImage = false;
    };
    for (const part of message.parts) {
      if (part.kind === "text") {
        pieces.push({ type: "text", text: part.text });
        continue;
      }
      if (part.kind === "image") {
        if (images) {
          pieces.push(imagePart(part.media_type, part.data_base64));
          hasImage = true;
        } else pieces.push({ type: "text", text: IMAGE_OMITTED });
        continue;
      }
      flush();
      if (part.kind === "tool_result") {
        out.push({ role: "tool", tool_call_id: part.id, content: part.text });
      } else if (part.kind === "tool_result_image") {
        pictures.push(
          images
            ? imagePart(part.media_type, part.data_base64)
            : { type: "text", text: IMAGE_OMITTED },
        );
      }
    }
    flush();
    if (pictures.length > 0) {
      out.push({
        role: "user",
        content: [
          { type: "text", text: "Images from the tool results:" },
          ...pictures,
        ],
      });
    }
  }
  return out;
}

export function chatPacker(input: {
  model: string;
  maxTokens: number;
  images: boolean;
  // provider 정의 key. 정의가 요구하는 quirk를 고른다.
  provider: string;
  requestPatch?: JsonObject;
}): WirePacker {
  return (request: PromptRequest) => {
    return {
      body: buildChat({
        model: input.model,
        provider: input.provider,
        system: systemText(request),
        messages: chatMessages(request.messages, input.images),
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
    };
  };
}

// Google Cloud Code Assist 번역. envelope(project·requestId·label·sessionId)는 보내기 직전에 cloudCodeShape가 씌운다.
// output 상한은 싣지 않는다: 계정 model의 상한을 모르고 server가 그 model의 기본값을 쓴다.
export function cloudCodePacker(input: {
  model: string;
  images: boolean;
  requestPatch?: JsonObject;
}): WirePacker {
  return (request: PromptRequest) => {
    return {
      body: buildCloudCode({
        model: input.model,
        system: systemText(request),
        messages: request.messages,
        tools: request.tools,
        images: input.images,
        request_patch: input.requestPatch,
      }),
      opaque_bytes: 0,
    };
  };
}
