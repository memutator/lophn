import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import { idSchema } from "../base/ids.ts";
import {
  browserTabStateSchema,
  type HostRequest,
  hostToolOutputSchema,
  hostWorkspaceSchema,
} from "../lophn-agent/host-queue.ts";
import { pageFrameSchema } from "../lophn-agent/page-view.ts";
import { REMOTE_FRAME_MAX_BYTES } from "../remote/channel.ts";

// shell main(host)과 core 사이의 양방향 연결이다. core의 loopback listener에서 Gateway 옆에 열린다.
// page를 드는 쪽(창, page host)이 있어야 하는 일(탭 열기·닫기·보이기, browser 호출, 멀리서 보는 page의 frame과 입력)만 다룬다:
// core가 host에 시킬 일(`HostRequest`)을 `request` frame으로 밀고, host는 보이는 workspace와 답과 탭 상태와 page frame을 올린다.
// 터미널과 coding session은 core가 갖고 화면은 route로 붙는다.
// host는 desktop 앱의 shell main이거나 display가 없는 기계에서 core가 띄운 page host다.
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
// 보는 쪽이 있는 page의 frame 한 장이다(`page_stream`이 켠 동안). frame은 JSON 글이고(이 연결은 binary frame을 받으면 닫는다)
// JPEG는 base64로 싣는다. JPEG 상한 PAGE_FRAME_MAX_BYTES(2 MiB)의 base64는 약 2.7 MiB라 host→core frame 상한
// HOST_LINK_FRAME_MAX_BYTES 안에 든다. HOST_LINK_BUFFER_LIMIT(1 MiB)은 core→host 쓰기에만 걸려 이 frame과 상관없다.
// seq는 host가 탭마다 process가 사는 동안 올리는 수이고 다시 0으로 돌아가지 않는다. host는 core가 그 seq로 `page_read`를 보내기
// 전에는 그 탭의 다음 frame을 보내지 않는다.
const pageFrameFrameSchema = z.strictObject({
  type: z.literal("page_frame"),
  tab: idSchema("tab"),
  seq: z.number().int().min(0),
  frame: pageFrameSchema,
});
// page의 상태가 바뀌었다. painting은 그 page를 그리는가(창이 최소화되거나 숨겨지면 false이고 frame이 오지 않는다), agent는 agent가
// 다루는 중인가, held는 사람이 가져왔는가(take control, 그 기계의 화면에서든 멀리서든)다. `page_stream`을 켤 때도 한 번 보낸다.
const pageStateFrameSchema = z.strictObject({
  type: z.literal("page_state"),
  tab: idSchema("tab"),
  painting: z.boolean(),
  agent: z.boolean(),
  held: z.boolean(),
});

export const hostFrameSchema = z.discriminatedUnion("type", [
  helloFrameSchema,
  visibleFrameSchema,
  responseFrameSchema,
  reportFrameSchema,
  pageFrameFrameSchema,
  pageStateFrameSchema,
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
