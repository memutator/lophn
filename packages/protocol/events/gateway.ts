import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import { busEventSchema, eventConditionSchema } from "./bus.ts";
import { codingTerminalFrameSchema } from "../coding-agent/terminal-requests.ts";

// Gateway는 renderer가 건 조건으로 Bus를 걸러 보내는 WebSocket이다. 받는 principal은 사람 token 하나다.
// replay도 ack도 없다. 놓치거나 끊기면 붙은 쪽이 snapshot부터 다시 읽는다.
export const GATEWAY_PATH = "/v1/gateway";
export const GATEWAY_SUBPROTOCOL = "lophn.gateway.1";
export const GATEWAY_ACTORS = ["user"] as const;

// `closed` frame을 먼저 보내고 연결을 닫는다.
export const GATEWAY_CLOSE_SLOW_CONSUMER = 1013;
export const GATEWAY_CLOSE_CREDENTIAL_REVOKED = 1008;

// 연결 안에서 여러 번 보내면 조건을 통째로 바꾼다.
export const gatewayWatchFrameSchema = z.strictObject({
  type: z.literal("watch"),
  conditions: z.array(eventConditionSchema),
});
export type GatewayWatchFrame = z.infer<typeof gatewayWatchFrameSchema>;

export const gatewayClientFrameSchema = gatewayWatchFrameSchema;
export type GatewayClientFrame = z.infer<typeof gatewayClientFrameSchema>;

// 조건이 적용됐고 이제부터 맞는 event가 온다. renderer는 이 frame을 받은 뒤 snapshot을 읽는다.
export const gatewayReadyFrameSchema = z.strictObject({
  type: z.literal("ready"),
});
export const gatewayEventFrameSchema = z.strictObject({
  type: z.literal("event"),
  event: busEventSchema,
});
export const GATEWAY_CLOSED_REASONS = [
  "slow_consumer",
  "credential_revoked",
  "shutdown",
] as const;
export const gatewayClosedFrameSchema = z.strictObject({
  type: z.literal("closed"),
  reason: z.enum(GATEWAY_CLOSED_REASONS),
});

// ready·event·closed는 renderer에도 가는 frame이다. 터미널 요청 같은 shell main 전용 frame은
// 이 목록에 따로 더하고, shell main이 renderer로 중계하지 않는다.
export const GATEWAY_SERVER_FRAMES = [
  gatewayReadyFrameSchema,
  gatewayEventFrameSchema,
  gatewayClosedFrameSchema,
  codingTerminalFrameSchema,
] as const;

export const gatewayServerFrameSchema = z.discriminatedUnion(
  "type",
  GATEWAY_SERVER_FRAMES,
);
export type GatewayServerFrame = z.infer<typeof gatewayServerFrameSchema>;

export function parseGatewayClientFrame(
  text: string,
): Result<GatewayClientFrame> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return err({ code: "invalid_input", message: "invalid gateway frame" });
  }
  const parsed = gatewayClientFrameSchema.safeParse(value);
  if (!parsed.success) {
    return err({ code: "invalid_input", message: "invalid gateway frame" });
  }
  return ok(parsed.data);
}
