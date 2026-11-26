// 터미널 탭이 shell main에 오는 짧은 통로. 터미널 자체(열기, 닫기, 크기, 출력, 목록)는 core의 `terminals/*` route로 바로 간다.
// 여기 남는 것은 OS와 창에 붙은 것이다: 사람의 입력·다시 시작(main이 그 창이 그 터미널에 focus를 가졌는지 본 뒤 자기 shell
// capability를 실어 core에 넘긴다), 질의 응답(그 창이 그 터미널을 보일 때만), focus와 보이는 터미널 표, clipboard, link, 진단
// 기록, 알림을 누른 뒤의 탭 고르기.
import { z } from "zod";

const ref = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);
const generation = z.number().int().positive();

export const terminalInputSchema = z
  .object({
    terminal: ref,
    generation,
    text: z.string().min(1).max(8192),
  })
  .strict();

export const terminalRestartSchema = z
  .object({ terminal: ref, generation })
  .strict();

/** 사람이 고른 탭이 이 터미널인지. main의 focus 표가 입력 검사와 알림에 쓴다. */
export const terminalFocusSchema = z
  .object({
    terminal: ref,
    generation,
    focused: z.boolean(),
  })
  .strict();

/** 이 창이 그 터미널을 보이기 시작했거나(display가 붙음) 그만 보인다. main은 보이는 터미널의 질의 응답만 core에 넘긴다. */
export const terminalShownSchema = z
  .object({ terminal: ref, shown: z.boolean() })
  .strict();

/** 터미널에서 고른 글. main이 OS clipboard에 쓴다. shell 창 session은 web clipboard permission을 거절한다. */
export const terminalCopySchema = z
  .object({ text: z.string().min(1).max(60_000) })
  .strict();

/**
 * 터미널 진단 기록 한 묶음. 켜졌을 때만(설정 `diagnostics.trace`) main이 `<data root>/logs/terminal-trace.jsonl`에 쓴다.
 * 이벤트 이름·mode·좌표·개수만 싣는다. 친 글과 출력 내용은 싣지 않는다(비밀번호·token이 지나간다).
 */
export const terminalTraceSchema = z
  .object({
    events: z
      .array(
        z.record(
          z.string().max(40),
          z.union([z.string().max(200), z.number(), z.boolean(), z.null()]),
        ),
      )
      .max(500),
  })
  .strict();
export type TerminalTraceEvent = Record<
  string,
  string | number | boolean | null
>;

/** terminal에서 Ctrl/Cmd-click한 link. 어디에서 열지는 main이 사람의 설정으로 정한다. */
export const terminalLinkSchema = z
  .object({ url: z.string().max(8192) })
  .strict();

export type TerminalInput = {
  terminal: string;
  generation: number;
  text: string;
};
export type TerminalRestart = { terminal: string; generation: number };
export type TerminalFocus = {
  terminal: string;
  generation: number;
  focused: boolean;
};
export type TerminalShown = { terminal: string; shown: boolean };

/** OS 알림이나 toast를 누르면 main이 그 터미널 탭을 고르라고 보낸다. project는 그 터미널이 속한 project다. */
export type TerminalReveal = { terminal: string; project: string };

/**
 * link를 어디에서 열지. `tab`이면 창이 그 터미널 옆에 browser 탭을 연다. `os`면 main이 이미 OS browser로 넘겼다. `none`은 열 수
 * 없는 주소다.
 */
export type TerminalLinkWhere = "tab" | "os" | "none";

/** IPC 경계의 결과. main의 guard 거절과 core의 거절은 error다. */
export type TerminalCall<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: { code: string; message: string };
    };

/** preload가 shell renderer에 여는 터미널 통로. */
export interface TerminalApi {
  /** 사람이 친 글. 그 창이 그 터미널에 focus를 가졌을 때만 간다. */
  input(input: TerminalInput): Promise<TerminalCall<null>>;
  /** 숨은 xterm이 새 출력의 terminal 질의에 답한다. 사람의 입력으로 세지 않는다. 그 창이 그 터미널을 보일 때만 간다. */
  respond(input: TerminalInput): Promise<TerminalCall<null>>;
  /** 끝난 터미널을 같은 탭에서 다시 띄운다. focus한 창만 한다. */
  restart(input: TerminalRestart): Promise<TerminalCall<null>>;
  focus(input: TerminalFocus): Promise<TerminalCall<null>>;
  /** 이 창의 display가 그 터미널에 붙었다(`shown: true`) 또는 놓았다. */
  shown(input: TerminalShown): Promise<TerminalCall<null>>;
  /** terminal에서 Ctrl/Cmd-click한 link. */
  openLink(input: { url: string }): Promise<TerminalCall<TerminalLinkWhere>>;
  /** 사람이 Ctrl+Shift+C로 고른 글을 OS clipboard에 쓴다. */
  copy(input: { text: string }): Promise<TerminalCall<null>>;
  /** 사람이 Ctrl+Shift+V를 눌렀다. OS clipboard의 글을 돌려준다. */
  paste(): Promise<TerminalCall<string>>;
  /** OS clipboard나 drop의 이미지를 core 임시 경로에 쓰고 그 경로를 돌려준다. */
  pasteImage(input: {
    terminal: string;
    media_type: "image/png" | "image/jpeg" | "image/webp";
    data_base64: string;
  }): Promise<TerminalCall<{ path: string; bytes: number }>>;
  /** 진단 기록을 보낸다. 기록이 꺼져 있으면 false라 더 보내지 않는다. */
  trace(input: {
    events: TerminalTraceEvent[];
  }): Promise<TerminalCall<boolean>>;
  /** main이 그 터미널 탭을 골라 보이라고 보낸다(OS 알림 누름). 구독 해지를 돌려준다. */
  onReveal(listener: (reveal: TerminalReveal) => void): () => void;
}

export const TERMINAL_INPUT_CHANNEL = "shell:terminal-input";
export const TERMINAL_RESPONSE_CHANNEL = "shell:terminal-response";
export const TERMINAL_RESTART_CHANNEL = "shell:terminal-restart";
export const TERMINAL_FOCUS_CHANNEL = "shell:terminal-focus";
export const TERMINAL_SHOWN_CHANNEL = "shell:terminal-shown";
export const TERMINAL_LINK_CHANNEL = "shell:terminal-link";
export const TERMINAL_COPY_CHANNEL = "shell:terminal-copy";
export const TERMINAL_PASTE_CHANNEL = "shell:terminal-paste";
export const TERMINAL_PASTE_IMAGE_CHANNEL = "shell:terminal-paste-image";
export const TERMINAL_TRACE_CHANNEL = "shell:terminal-trace";
export const TERMINAL_REVEAL_CHANNEL = "shell:terminal-reveal";

export const terminalPasteImageSchema = z.strictObject({
  terminal: z.string().min(1),
  media_type: z.enum(["image/png", "image/jpeg", "image/webp"]),
  data_base64: z.string().min(1),
});
