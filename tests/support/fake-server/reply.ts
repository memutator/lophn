// Reply를 Response로 옮긴다. event 이름과 순서는 Anthropic Messages 실제 stream이다
// (message_start, content_block_*, message_delta, message_stop).

import type { Partial, Reply } from "./types.ts";

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
};
// server가 응답을 붙들고 있는 동안만 true다. 그 사이의 client 끊김만 aborted로 센다.
export type Held = { on: boolean };

const DEFAULT_USAGE = { input: 10, output: 5 };

function event(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

function start(inputTokens: number): string {
  return event("message_start", {
    message: {
      id: "msg_fake",
      type: "message",
      role: "assistant",
      model: "fake",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: 1 },
    },
  });
}

function textBlock(index: number, text: string, closed: boolean): string[] {
  return [
    event("content_block_start", {
      index,
      content_block: { type: "text", text: "" },
    }),
    event("content_block_delta", {
      index,
      delta: { type: "text_delta", text },
    }),
    ...(closed ? [event("content_block_stop", { index })] : []),
  ];
}

function toolBlock(
  index: number,
  call: { id: string; name: string },
  json: string,
  closed: boolean,
): string[] {
  return [
    event("content_block_start", {
      index,
      content_block: {
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: {},
      },
    }),
    event("content_block_delta", {
      index,
      delta: { type: "input_json_delta", partial_json: json },
    }),
    ...(closed ? [event("content_block_stop", { index })] : []),
  ];
}

function finish(stopReason: string, outputTokens: number): string[] {
  return [
    event("message_delta", {
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: outputTokens },
    }),
    event("message_stop", {}),
  ];
}

function partialChunks(partial: Partial): string[] {
  const block = "text" in partial
    ? textBlock(0, partial.text, false)
    : toolBlock(
      0,
      partial.tool,
      partial.tool.arguments.slice(0, partial.tool.arguments.length >> 1),
      false,
    );
  return [start(DEFAULT_USAGE.input), ...block];
}

// until이 abort되면(client가 끊거나 server를 닫으면) 붙들고 있던 stream을 닫는다.
function body(
  chunks: readonly string[],
  end: "close" | "hold",
  until: AbortSignal,
  held: Held,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let release = () => {};
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (end === "close") {
        controller.close();
        return;
      }
      held.on = true;
      return new Promise<void>((resolve) => {
        release = resolve;
        if (until.aborted) resolve();
        else until.addEventListener("abort", () => resolve(), { once: true });
      }).then(() => {
        held.on = false;
        try {
          controller.close();
        } catch {
          // client가 먼저 끊어 이미 닫혔다.
        }
      });
    },
    cancel() {
      release();
    },
  });
}

// silent는 여기 오지 않는다(header도 안 주므로 handle이 직접 기다린다).
export function toResponse(
  reply: Exclude<Reply, { kind: "silent" }>,
  until: AbortSignal,
  held: Held,
): Response {
  if (reply.kind === "error") {
    return new Response(reply.body ?? "", {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  }
  if (reply.kind === "raw") {
    return new Response(body(reply.chunks, reply.end ?? "close", until, held), {
      status: reply.status,
      headers: reply.headers,
    });
  }
  let chunks: string[];
  let end: "close" | "hold" = "close";
  if (reply.kind === "text") {
    const usage = reply.usage ?? DEFAULT_USAGE;
    chunks = [
      start(usage.input),
      ...textBlock(0, reply.text, true),
      ...finish("end_turn", usage.output),
    ];
  } else if (reply.kind === "tool") {
    const lead = reply.text === undefined ? [] : textBlock(0, reply.text, true);
    const offset = lead.length > 0 ? 1 : 0;
    chunks = [
      start(DEFAULT_USAGE.input),
      ...lead,
      ...reply.calls.flatMap((call, i) =>
        toolBlock(i + offset, call, call.arguments, true)
      ),
      ...finish("tool_use", DEFAULT_USAGE.output),
    ];
  } else {
    chunks = partialChunks(reply.partial);
    end = reply.kind === "stall" ? "hold" : "close";
  }
  return new Response(body(chunks, end, until, held), { headers: SSE_HEADERS });
}
