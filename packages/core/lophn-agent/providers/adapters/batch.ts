// batch(JSON) 응답 본문을 stream과 같은 frame 열로 옮긴다. 성공 응답이
// SSE가 아니라 한 덩어리 JSON으로 와도(stream을 무시하는 호환 서버·고정 응답 서버)
// 같은 collector와 판정 표를 쓰게 하려는 것이다. 판정 규칙을 둘로 나누지 않는다.
// 읽을 수 없는 본문은 null이다. 호출자는 원인 불명으로 둔다.

import { cloudCodeFrames } from "./cloud-code.ts";
import type { SseFrame } from "./stream.ts";

type Json = Record<string, unknown>;

function frame(event: string, data: unknown): SseFrame {
  return { event, data: JSON.stringify(data) };
}

function object(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function messagesFrames(root: Json): SseFrame[] {
  if (root.type === "error") {
    return [frame("error", { type: "error", error: object(root.error) ?? {} })];
  }
  const frames: SseFrame[] = [
    frame("message_start", {
      type: "message_start",
      message: { usage: object(root.usage) ?? {} },
    }),
  ];
  const content = Array.isArray(root.content) ? root.content : [];
  let index = 0;
  for (const raw of content) {
    const block = object(raw);
    if (block === null) continue;
    if (block.type === "text" && typeof block.text === "string") {
      frames.push(
        frame("content_block_start", {
          type: "content_block_start",
          index,
          content_block: { type: "text", text: "" },
        }),
      );
      frames.push(
        frame("content_block_delta", {
          type: "content_block_delta",
          index,
          delta: { type: "text_delta", text: block.text },
        }),
      );
    } else if (block.type === "thinking") {
      // 사람이 읽을 reasoning 글. stream과 같은 frame으로 옮긴다.
      frames.push(
        frame("content_block_start", {
          type: "content_block_start",
          index,
          content_block: { type: "thinking", thinking: "" },
        }),
      );
      if (typeof block.thinking === "string" && block.thinking !== "") {
        frames.push(
          frame("content_block_delta", {
            type: "content_block_delta",
            index,
            delta: { type: "thinking_delta", thinking: block.thinking },
          }),
        );
      }
    } else if (block.type === "tool_use") {
      frames.push(
        frame("content_block_start", {
          type: "content_block_start",
          index,
          content_block: { type: "tool_use", id: block.id, name: block.name },
        }),
      );
      frames.push(
        frame("content_block_delta", {
          type: "content_block_delta",
          index,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify(block.input ?? {}),
          },
        }),
      );
    } else {
      continue;
    }
    frames.push(
      frame("content_block_stop", {
        type: "content_block_stop",
        index,
      }),
    );
    index += 1;
  }
  frames.push(
    frame("message_delta", {
      type: "message_delta",
      delta: { stop_reason: root.stop_reason },
    }),
  );
  frames.push(frame("message_stop", { type: "message_stop" }));
  return frames;
}

function responsesFrames(root: Json): SseFrame[] {
  const frames: SseFrame[] = [];
  const output = Array.isArray(root.output) ? root.output : [];
  for (const raw of output) {
    const item = object(raw);
    if (item === null) continue;
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        const text = object(part);
        if (text?.type === "output_text" && typeof text.text === "string") {
          frames.push(
            frame("response.output_text.delta", {
              type: "response.output_text.delta",
              delta: text.text,
            }),
          );
        }
      }
    } else if (item.type === "reasoning") {
      // stream과 같은 frame으로 요약 글을 옮긴다. 요약은 reasoning item에만 있다.
      frames.push(
        frame("response.output_item.added", {
          type: "response.output_item.added",
          item: { type: "reasoning", id: item.id, summary: [] },
        }),
      );
      const summary = Array.isArray(item.summary) ? item.summary : [];
      for (const [summaryIndex, raw] of summary.entries()) {
        const part = object(raw);
        if (part?.type !== "summary_text" || typeof part.text !== "string") {
          continue;
        }
        frames.push(
          frame("response.reasoning_summary_text.delta", {
            type: "response.reasoning_summary_text.delta",
            item_id: typeof item.id === "string" ? item.id : "",
            summary_index: summaryIndex,
            delta: part.text,
          }),
        );
      }
      frames.push(
        frame("response.output_item.done", {
          type: "response.output_item.done",
          item,
        }),
      );
    } else if (item.type === "function_call") {
      frames.push(
        frame("response.output_item.done", {
          type: "response.output_item.done",
          item,
        }),
      );
    }
  }
  if (root.status === "failed") {
    frames.push(
      frame("response.failed", {
        type: "response.failed",
        response: { error: object(root.error) ?? {} },
      }),
    );
    return frames;
  }
  const type =
    root.status === "incomplete" ? "response.incomplete" : "response.completed";
  frames.push(
    frame(type, {
      type,
      response: {
        usage: root.usage,
        incomplete_details: root.incomplete_details,
      },
    }),
  );
  return frames;
}

function chatFrames(root: Json): SseFrame[] {
  if (object(root.error) !== null) {
    return [frame("message", { error: root.error })];
  }
  const choice = Array.isArray(root.choices) ? object(root.choices[0]) : null;
  if (choice === null) return [];
  const message = object(choice.message) ?? {};
  const frames: SseFrame[] = [];
  // 사람이 읽을 reasoning 글은 content 앞에 온다.
  if (typeof message.reasoning_content === "string") {
    frames.push(
      frame("message", {
        choices: [
          {
            index: 0,
            delta: { reasoning_content: message.reasoning_content },
            finish_reason: null,
          },
        ],
      }),
    );
  }
  const delta: Json = {};
  if (typeof message.content === "string") delta.content = message.content;
  if (Array.isArray(message.tool_calls)) {
    delta.tool_calls = message.tool_calls.map((call, index) => ({
      index,
      ...(object(call) ?? {}),
    }));
  }
  frames.push(
    frame("message", { choices: [{ index: 0, delta, finish_reason: null }] }),
    frame("message", {
      choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }],
      ...(root.usage === undefined ? {} : { usage: root.usage }),
    }),
    { event: "message", data: "[DONE]" },
  );
  return frames;
}

export function framesFromBatch(
  protocol:
    | "anthropic-messages"
    | "openai-responses"
    | "openai-chat-completions"
    | "cloud-code-assist",
  text: string | null,
): SseFrame[] | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (protocol === "cloud-code-assist") return cloudCodeFrames(parsed);
  const root = object(parsed);
  if (root === null) return null;
  if (protocol === "anthropic-messages") return messagesFrames(root);
  if (protocol === "openai-responses") return responsesFrames(root);
  return chatFrames(root);
}
