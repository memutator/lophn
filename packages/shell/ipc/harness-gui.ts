// harness-gui와 main의 shell IPC 경계. 터미널 탭 하나가 ACP session 하나(extension harness-gui의 handle)를 그린다
// (`HarnessGuiTabApi`). `connect`로 붙어 쌓인 갱신을 처음부터 받고, 대화 조작은 `input`으로 보낸다.
// 이 파일은 main·preload·renderer가 함께 부르므로 import는 type뿐이다.
import type { AcpInput, AcpUpdate } from "../../protocol/acp/mod.ts";
import type { GuiHarness } from "../../protocol/extensions/mod.ts";

/** 탭이 그리는 session의 머리 값. */
export interface HarnessGuiInfo {
  readonly harness: GuiHarness;
  readonly cwd: string;
}

/** main → renderer push. 이 터미널에 GUI가 열렸다. 그 탭을 가진 창이 탭을 GUI view로 바꾸고 `ACK`로 답한다. */
export const HARNESS_GUI_TAB_OPENED_CHANNEL = "harness-gui:tab-opened";
/** renderer → main invoke. 열린 GUI를 탭에 붙였다. 1.5초 안에 오지 않으면 main이 handle을 닫는다. */
export const HARNESS_GUI_TAB_ACK_CHANNEL = "harness-gui:tab-ack";
/** main → renderer push. 탭의 view가 바뀌어야 한다(toggle이나 handle이 닫힘). */
export const HARNESS_GUI_TAB_VIEW_CHANNEL = "harness-gui:tab-view";
/** renderer → main invoke. handle에 붙어 쌓인 갱신을 `UPDATE`로 처음부터 받는다. */
export const HARNESS_GUI_TAB_CONNECT_CHANNEL = "harness-gui:tab-connect";
export const HARNESS_GUI_TAB_DISCONNECT_CHANNEL = "harness-gui:tab-disconnect";
/** main → renderer push. handle 하나의 갱신. */
export const HARNESS_GUI_TAB_UPDATE_CHANNEL = "harness-gui:tab-update";
/** renderer → main invoke. 대화 조작 하나를 handle에 준다. */
export const HARNESS_GUI_TAB_INPUT_CHANNEL = "harness-gui:tab-input";
/** renderer → main invoke. 탭의 GUI ↔ TUI toggle. */
export const HARNESS_GUI_TAB_TOGGLE_CHANNEL = "harness-gui:tab-toggle";
/** renderer → main invoke. 그 탭의 GUI가 도는 일(restart modal이 멈출 것으로 보인다). */
export const HARNESS_GUI_TAB_RUNNING_CHANNEL = "harness-gui:tab-running";
/** renderer → main invoke. 사람이 붙인 이미지를 탭의 임시 폴더에 쓰고 경로를 받는다. */
export const HARNESS_GUI_TAB_IMAGE_CHANNEL = "harness-gui:tab-image";

/** restart는 한쪽 process를 끄고 같은 session으로 다른 쪽을 띄우고, shared는 TUI와 GUI가 한 server에 같이 붙는다. */
export type HarnessGuiHandoff = "restart" | "shared";

export interface HarnessGuiTabOpened {
  readonly request: string;
  readonly terminal_ref: string;
  readonly handle: string;
  readonly harness: GuiHarness;
  readonly handoff: HarnessGuiHandoff;
}

export interface HarnessGuiTabView {
  readonly terminal_ref: string;
  readonly view: "gui" | "tui";
  /** handle이 닫혔다. 탭이 쥔 handle 참조를 지운다. */
  readonly closed?: true;
}

export type HarnessGuiTabToggleReply =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** `no_session`은 TUI의 session id를 아직 모른다(hook이 안 왔다). */
      readonly reason: "no_session" | "not_running" | "failed";
      readonly message: string;
    };

export interface HarnessGuiTabApi {
  onOpened(listener: (open: HarnessGuiTabOpened) => void): () => void;
  ackOpened(request: string): Promise<void>;
  onView(listener: (view: HarnessGuiTabView) => void): () => void;
  /** handle에 붙는다. 다시 부르면 처음부터 다시 받는다. handle이 없으면 null. */
  connect(
    handle: string,
    onUpdate: (update: AcpUpdate) => void,
  ): Promise<HarnessGuiInfo | null>;
  disconnect(handle: string): Promise<void>;
  /** 조작을 보냈으면 true다. 통로가 끊기거나 main이 거절하면 false다. */
  input(handle: string, input: AcpInput): Promise<boolean>;
  /** 그 탭의 GUI가 도는 일. 없으면 null. */
  running(
    terminalRef: string,
  ): Promise<{ turn: boolean; tasks: number } | null>;
  toggle(input: {
    terminal_ref: string;
    to: "gui" | "tui";
  }): Promise<HarnessGuiTabToggleReply>;
  /** 쓴 file의 절대 경로. 못 썼으면 null. */
  uploadImage(
    handle: string,
    image: { name: string; mime: string; data: Uint8Array },
  ): Promise<string | null>;
}
