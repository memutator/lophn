import type { Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  type AgentEvent,
  agentEventSchema,
} from "../../../protocol/events/mod.ts";
import {
  agentEventMessageSchema,
  type ChildMessage,
  type ModelOutputMessage,
  modelOutputMessageSchema,
  type ParentMessage,
  turnSourceRequestSchema,
  type TurnSourceResponse,
} from "../../../protocol/supervision/mod.ts";
import type { TurnSource } from "./ports.ts";

// queue와 Bus는 core 메모리에 있다. agent runtime child가 감독 pipe로 보내는 `turn_source_request`와
// `agent_event`, `model_output`을 core 쪽에서 받는 handler다. 요청은 `TurnSource`를 그대로 부르고 event는
// Bus에 낸다. 쓰는 중인 model 날 글은 Bus에 싣지 않고 core의 `live-turns.ts`가 redaction한 뒤 낸다.

type TurnPipe = {
  // child message를 처리한다. 응답이 있으면 돌려주고, 이 handler의 message가 아니면 undefined를 돌려준다.
  // `handled`는 이 handler의 message였는지다.
  onMessage(message: ChildMessage): {
    handled: boolean;
    response?: Promise<ParentMessage>;
  };
};

export function createTurnPipe(options: {
  source: TurnSource;
  publish(event: AgentEvent): void;
  output(batch: ModelOutputMessage): void;
}): TurnPipe {
  const { source } = options;

  async function answer(
    message: ReturnType<typeof turnSourceRequestSchema.parse>,
  ): Promise<TurnSourceResponse> {
    const session = message.session as Parameters<TurnSource["began"]>[0];
    let result: Result<unknown>;
    switch (message.op) {
      case "next":
        result = await source.next();
        break;
      case "began":
        result = await source.began(session, message.message as Id<"msg">);
        break;
      case "ended":
        result = await source.ended(session);
        break;
      case "steering":
        result = await source.steering(session);
        break;
      case "settled":
        result = await source.settled(session, message.count!);
        break;
    }
    return result.ok
      ? {
          type: "turn_source_response",
          request_id: message.request_id,
          ok: true,
          value: result.value ?? null,
        }
      : {
          type: "turn_source_response",
          request_id: message.request_id,
          ok: false,
          error: {
            code: result.error.code,
            message: result.error.message.slice(0, 200),
          },
        };
  }

  return {
    onMessage(message) {
      if (message.type === "agent_event") {
        const parsed = agentEventMessageSchema.safeParse(message);
        const event = parsed.success
          ? agentEventSchema.safeParse(parsed.data.event)
          : undefined;
        if (event?.success) options.publish(event.data);
        return { handled: true };
      }
      if (message.type === "model_output") {
        const parsed = modelOutputMessageSchema.safeParse(message);
        if (parsed.success) options.output(parsed.data);
        return { handled: true };
      }
      if (message.type !== "turn_source_request") return { handled: false };
      const parsed = turnSourceRequestSchema.safeParse(message);
      if (!parsed.success) return { handled: true };
      return { handled: true, response: answer(parsed.data) };
    },
  };
}
