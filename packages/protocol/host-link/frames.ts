import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import { idSchema } from "../base/ids.ts";
import {
  browserTabStateSchema,
  type HostRequest,
  hostToolOutputSchema,
  hostWorkspaceSchema,
} from "../lophn-agent/host-queue.ts";
import { REMOTE_FRAME_MAX_BYTES } from "../remote/channel.ts";

// shell main(host)과 core 사이의 양방향 연결이다. core의 loopback listener에서 Gateway 옆에 열린다.
// 창이 있어야 하는 일(탭 열기·닫기·보이기, browser 호출)만 다룬다: core가 host에 시킬 일(`HostRequest`)을 `request` frame으로
// 밀고, host는 보이는 workspace와 답과 탭 상태를 올린다. 터미널과 coding session은 core가 갖고 화면은 route로 붙는다.
// 연결은 한 번에 하나이고 새 연결이 오면 옛 연결을 닫는다. 끊기면 host가 다시 붙어 `hello`부터 보낸다.
export const HOST_LINK_PATH = "/host-link";
export const HOST_LINK_SUBPROTOCOL = "lophn.host-link.1";
// 기기 frame과 같은 상한이다.
export const HOST_LINK_FRAME_MAX_BYTES = REMOTE_FRAME_MAX_BYTES;
// 읽지 못한 frame이 이만큼 쌓인 host는 닫는다(Gateway와 같은 규칙). host가 다시 붙어 처음부터 보낸다.
export const HOST_LINK_BUFFER_LIMIT = 1024 * 1024;
// 틀린 frame을 받으면 이 code로 닫는다.
export const HOST_LINK_CLOSE_INVALID = 1008;

const LIST_MAX = 64;

const visibleFields = {
  // host가 지금 그리는 workspace들이다. 그 workspace의 탭 요청만 이 host에 간다.
  workspaces: z.array(hostWorkspaceSchema).max(LIST_MAX),
};

const helloFrameSchema = z.strictObject({
  type: z.literal("hello"),
  version: z.literal(1),
  ...visibleFields,
});
const visibleFrameSchema = z.strictObject({
  type: z.literal("visible"),
  ...visibleFields,
});
// `retry`면 창이 받지 못한 것이라 요청은 다시 대기한다.
const responseFrameSchema = z.strictObject({
  type: z.literal("response"),
  id: idSchema("hrq"),
  result: z.enum(["done", "retry"]),
  output: hostToolOutputSchema.optional(),
});
// host 탭의 browser 상태나 닫힘이다.
const reportFrameSchema = z.strictObject({
  type: z.literal("report"),
  tab: idSchema("tab"),
  state: z.union([browserTabStateSchema, z.literal("closed")]),
});
export const hostFrameSchema = z.discriminatedUnion("type", [
  helloFrameSchema,
  visibleFrameSchema,
  responseFrameSchema,
  reportFrameSchema,
]);
export type HostFrame = z.infer<typeof hostFrameSchema>;
export type HostFrameType = HostFrame["type"];
export type HostFrameOf<T extends HostFrameType> = Extract<
  HostFrame,
  { type: T }
>;

// core가 host로 보내는 frame이다. 한 frame에 요청 하나다.
export type CoreFrame = { type: "request" } & HostRequest;

export function parseHostFrame(text: string): Result<HostFrame> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return err({ code: "invalid_input", message: "invalid host-link frame" });
  }
  const parsed = hostFrameSchema.safeParse(value);
  if (!parsed.success) {
    return err({ code: "invalid_input", message: "invalid host-link frame" });
  }
  return ok(parsed.data);
}
