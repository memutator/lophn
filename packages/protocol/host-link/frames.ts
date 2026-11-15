import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import { acpStateSchema, acpUpdateSchema } from "../acp/state.ts";
import { idSchema } from "../base/ids.ts";
import {
  browserTabStateSchema,
  type HostRequest,
  hostToolOutputSchema,
  hostWorkspaceSchema,
} from "../lophn-agent/host-queue.ts";
import { terminalSessionReportSchema } from "../lophn-agent/session-lifecycle.ts";
import { REMOTE_FRAME_MAX_BYTES } from "../remote/channel.ts";

// shell main(host)과 core 사이의 양방향 연결이다. core의 loopback listener에서 Gateway 옆에 열린다.
// core가 host에 시킬 일(`HostRequest`)을 `request` frame으로 밀고, host는 답과 보고와 coding session·터미널 상태를 올린다.
// 연결은 한 번에 하나이고 새 연결이 오면 옛 연결을 닫는다. 끊기면 host가 다시 붙어 `hello`부터 보낸다.
export const HOST_LINK_PATH = "/host-link";
export const HOST_LINK_SUBPROTOCOL = "lophn.host-link.1";
// GUI 상태 snapshot은 route body 한도(256 KiB)에 들지 않는다. 기기 frame과 같은 상한이다.
export const HOST_LINK_FRAME_MAX_BYTES = REMOTE_FRAME_MAX_BYTES;
// 읽지 못한 frame이 이만큼 쌓인 host는 닫는다(Gateway와 같은 규칙). host가 다시 붙어 처음부터 보낸다.
export const HOST_LINK_BUFFER_LIMIT = 1024 * 1024;
// 틀린 frame을 받으면 이 code로 닫는다.
export const HOST_LINK_CLOSE_INVALID = 1008;

const LIST_MAX = 64;

// `#rrggbb`이거나 xterm 256색 palette 번호(`p0`~`p255`)다.
const terminalColorSchema = z
  .string()
  .regex(/^(#[0-9a-fA-F]{6}|p(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9]))$/);

// 같은 모양이 이어지는 글 한 토막이다. 없는 칸은 기본(색 없음, 꺼짐)이다.
const terminalRunSchema = z.strictObject({
  text: z.string(),
  fg: terminalColorSchema.optional(),
  bg: terminalColorSchema.optional(),
  bold: z.boolean().optional(),
  dim: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  inverse: z.boolean().optional(),
  // 두 칸을 차지하는 글자(CJK, emoji)의 토막이다.
  wide: z.boolean().optional(),
});

export const terminalLineSchema = z.strictObject({
  runs: z.array(terminalRunSchema),
  // 이 줄이 다음 줄로 이어진다(자동 줄바꿈). 폰이 줄을 다시 접을 때 쓴다.
  wrapped: z.boolean(),
});
export type TerminalLine = z.infer<typeof terminalLineSchema>;

const visibleFields = {
  // host가 지금 그리는 workspace들이다. 그 workspace의 탭 요청만 이 host에 간다.
  workspaces: z.array(hostWorkspaceSchema).max(LIST_MAX),
  // TUI 탭이 열린 harness session 전부다. core가 이 목록으로 TUI hold를 갱신한다.
  tui: z.array(idSchema("ses")).max(LIST_MAX),
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
// 터미널 coding agent의 지금 집합이다(통째로 바꾼다). 바뀔 때와 연결을 연 뒤 보낸다.
const codingReportFrameSchema = z.strictObject({
  type: z.literal("coding_report"),
  sessions: z.array(terminalSessionReportSchema).max(LIST_MAX),
});
// coding session 하나의 ACP 상태다. 연결을 열 때마다 snapshot부터 보내고 그 뒤로 updates다.
const codingSyncFrameSchema = z.strictObject({
  type: z.literal("coding_sync"),
  session: idSchema("ses"),
  snapshot: acpStateSchema.optional(),
  updates: z.array(acpUpdateSchema).optional(),
});
const codingClosedFrameSchema = z.strictObject({
  type: z.literal("coding_closed"),
  session: idSchema("ses"),
});
// 보는 중인 터미널의 지금 화면 전체다. 최신이 옛것을 대신하므로 느린 쪽은 건너뛴다.
// generation은 터미널을 다시 만들 때(재시작) 오르고, seq는 한 generation 안에서 화면마다 오른다.
const terminalScreenFrameSchema = z.strictObject({
  type: z.literal("terminal_screen"),
  terminal_ref: z.string().min(1),
  generation: z.number().int().min(0),
  seq: z.number().int().min(0),
  columns: z.number().int().min(1),
  rows: z.number().int().min(1),
  cursor: z.strictObject({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    hidden: z.boolean(),
  }),
  // viewport 위 scrollback의 끝쪽(`terminal_stream`의 tail 줄까지)이다.
  scrollback: z.array(terminalLineSchema),
  // viewport다.
  lines: z.array(terminalLineSchema),
});

export const hostFrameSchema = z.discriminatedUnion("type", [
  helloFrameSchema,
  visibleFrameSchema,
  responseFrameSchema,
  reportFrameSchema,
  codingReportFrameSchema,
  codingSyncFrameSchema,
  codingClosedFrameSchema,
  terminalScreenFrameSchema,
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
