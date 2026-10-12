// desktop 창의 최소화·최대화·닫기(shell/desktop#R23). 창은 시스템 제목 표시줄이 없어서 상단 바가
// 직접 단추를 그린다. renderer는 동작 이름만 보내고 어느 창인지는 main이 sender로 정한다.
// 이 파일은 main·preload·renderer가 함께 부르므로 import가 없다.

/** renderer가 main에 창 동작을 시키거나 지금 상태를 묻는 요청. */
export const WINDOW_CONTROL_CHANNEL = "shell:window-control";
/** main이 창 상태가 바뀔 때 그 창 renderer로 보내는 알림. payload는 WindowState. */
export const WINDOW_STATE_CHANNEL = "shell:window-state";

export const WINDOW_ACTIONS = [
  "state",
  "minimize",
  "toggle-maximize",
  "close",
] as const;

export type WindowAction = (typeof WINDOW_ACTIONS)[number];

export interface WindowState {
  maximized: boolean;
}

export type WindowControlReply =
  | { ok: true; state: WindowState }
  | { ok: false; code: "forbidden" | "invalid_input" | "unavailable" };

export interface WindowControlsApi {
  /** 지금 창 상태. */
  state(): Promise<WindowControlReply>;
  minimize(): Promise<WindowControlReply>;
  /** 최대화면 되돌리고 아니면 최대화한다. */
  toggleMaximize(): Promise<WindowControlReply>;
  /** 닫기는 종료가 아니다(desktop#R21). 편집기 닫기 확인은 main이 먼저 본다. */
  close(): Promise<WindowControlReply>;
  /** 최대화·되돌림이 일어날 때마다 알린다. 해제 함수를 돌려준다. */
  subscribe(listener: (state: WindowState) => void): () => void;
}
