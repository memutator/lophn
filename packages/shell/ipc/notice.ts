// main이 정한 알림(toast)과 보이는 Agent 탭을 창에 잇는 경계. 터미널 탭은 terminal 채널의
// focus·reveal을 그대로 쓰고 여기는 lophn Agent session과 알림 toast만 다룬다. 못 본 turn 끝은 core가 든다(`unseen`).
// main·preload·renderer가 함께 부르므로 import는 zod와 type뿐이다.
import { z } from "zod";
import type { OverlayLead } from "./overlay.ts";

const ULID = "[0-7][0-9a-hjkmnp-tv-z]{25}";
const session = z.string().regex(new RegExp(`^ses_${ULID}$`));
const app = z.string().regex(new RegExp(`^app_${ULID}$`));
const terminalRef = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);

/** 알림이 가리키는 탭. 누르면 이 탭을 고른다. */
export const noticeTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("terminal"), terminal_ref: terminalRef }).strict(),
  z.object({ kind: z.literal("session"), session }).strict(),
  // 앱이 사람에게 한 알림. 누르면 그 앱 공간을 연다.
  z.object({ kind: z.literal("app"), app }).strict(),
  // 앱 없는 program 기록(SDK 업데이트 필요). 누르면 Inbox를 연다.
  z.object({ kind: z.literal("inbox") }).strict(),
]);

/**
 * 그 Agent session 탭이나 앱 화면(view_session)이 이 창에 보이는지. 창은 보낸 webContents로 안다. 앱 화면이 보이면 그
 * 화면이 쥔 session의 승인·질문 알림을 낼 필요가 없다.
 */
export const noticeVisibleSchema = z.union([
  z.object({ session, visible: z.boolean() }).strict(),
  z
    .object({
      view_session: z.string().min(1).max(200),
      visible: z.boolean(),
    })
    .strict(),
]);

export type NoticeTarget = z.infer<typeof noticeTargetSchema>;
export type NoticeVisible = z.infer<typeof noticeVisibleSchema>;

/** 창이 focus를 가졌는데 그 탭이 안 보일 때 main이 그 창에 띄우라고 보내는 toast. */
export type NoticeToast = {
  id: string;
  title: string;
  /** 마지막 응답의 앞부분, 권한 물음의 요약, 실패 까닭. 모르면 없다. */
  body?: string;
  /** 제목 앞의 그림. main이 harness나 agent의 profile로 정한다. */
  lead?: OverlayLead;
  target: NoticeTarget;
};

/** main이 창에 고르라고 보내는 것: Agent session 탭, 앱 공간, Inbox. */
export type NoticeReveal =
  | { session: string }
  | { app: string }
  | { inbox: true };

/** preload가 shell renderer에 여는 알림 통로. */
export interface LophnNoticeApi {
  /** Agent session 탭이나 앱 화면이 보이게 됐거나 안 보이게 됐다. */
  visible(input: NoticeVisible): Promise<void>;
  /** toast를 눌렀다. 그 탭이 있는 창을 앞으로 가져오고 탭을 고르는 것은 main이 한다. */
  open(target: NoticeTarget): Promise<void>;
  onToast(listener: (toast: NoticeToast) => void): () => void;
  /** main이 그 Agent session 탭이나 앱 공간을 열라고 보낸다(알림 누름). */
  onReveal(listener: (reveal: NoticeReveal) => void): () => void;
}

export const NOTICE_VISIBLE_CHANNEL = "shell:notice-visible";
export const NOTICE_OPEN_CHANNEL = "shell:notice-open";
export const NOTICE_TOAST_CHANNEL = "shell:notice-toast";
export const NOTICE_REVEAL_CHANNEL = "shell:notice-reveal";
