// harness-gui와 main의 shell IPC 경계. 터미널 탭 하나가 ACP session 하나(extension harness-gui의 handle)를 그린다
// (`HarnessGuiTabApi`). `connect`로 붙으면 지금까지 접은 상태(snapshot)를 먼저 받고 이어서 갱신을 모아 받는다. 대화 조작은
// `input`으로 보낸다.
// 이 파일은 main·preload·renderer가 함께 부르므로 import는 type뿐이다.
import type { AcpInput, AcpState, AcpUpdate } from "../../protocol/acp/mod.ts";
import type {
  AcpCliSession,
  AcpRewindPreview,
  GuiHarness,
} from "../../protocol/extensions/mod.ts";

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
/** renderer → main invoke. handle에 붙는다. 현재 상태(snapshot)와 이어지는 갱신을 `UPDATE`로 받는다. */
export const HARNESS_GUI_TAB_CONNECT_CHANNEL = "harness-gui:tab-connect";
export const HARNESS_GUI_TAB_DISCONNECT_CHANNEL = "harness-gui:tab-disconnect";
/** main → renderer push. handle 하나의 snapshot이나 모은 갱신(`HarnessGuiTabUpdate`). */
export const HARNESS_GUI_TAB_UPDATE_CHANNEL = "harness-gui:tab-update";
/** renderer → main invoke. 대화 조작 하나를 handle에 준다. */
export const HARNESS_GUI_TAB_INPUT_CHANNEL = "harness-gui:tab-input";
/** renderer → main invoke. 탭의 GUI ↔ TUI toggle. */
export const HARNESS_GUI_TAB_TOGGLE_CHANNEL = "harness-gui:tab-toggle";
/** renderer → main invoke. 그 탭의 GUI가 도는 일(restart modal이 멈출 것으로 보인다). */
export const HARNESS_GUI_TAB_RUNNING_CHANNEL = "harness-gui:tab-running";
/**
 * renderer → main invoke. 그 터미널에 살아 있는 GUI handle과 지금 view. 탭은 view를 저장하지 않아, 저장본에서 다시 만들어진
 * 탭(다른 workspace에 갔다 옴, 창 다시 load)이 이것으로 GUI를 되찾는다.
 */
export const HARNESS_GUI_TAB_CURRENT_CHANNEL = "harness-gui:tab-current";
/** renderer → main invoke. 그 탭의 CLI가 이 폴더에서 가진 지난 session 목록(최근 순). */
export const HARNESS_GUI_TAB_SESSIONS_CHANNEL = "harness-gui:tab-sessions";
/** renderer → main invoke. 그 사람 메시지로 rewind하면 되돌아갈 file. */
export const HARNESS_GUI_TAB_REWIND_PREVIEW_CHANNEL =
  "harness-gui:tab-rewind-preview";
/** renderer → main invoke. 사람이 붙인 이미지를 탭의 임시 폴더에 쓰고 경로를 받는다. */
export const HARNESS_GUI_TAB_IMAGE_CHANNEL = "harness-gui:tab-image";
/** renderer → main invoke. 그 탭의 임시 폴더에 쓴 이미지를 다시 읽는다. 대화의 그림을 그리는 데 쓴다. */
export const HARNESS_GUI_TAB_IMAGE_READ_CHANNEL = "harness-gui:tab-image-read";

/** restart는 한쪽 process를 끄고 같은 session으로 다른 쪽을 띄우고, shared는 TUI와 GUI가 한 server에 같이 붙는다. */
export type HarnessGuiHandoff = "restart" | "shared";

export type HarnessGuiSessionEntry = AcpCliSession;
export type HarnessGuiRewindPreview = AcpRewindPreview;

/**
 * `UPDATE` push 하나. snapshot은 붙은 직후 한 번만 오고(그 뒤 `updates`는 비어 있다) 현재 상태로 갈아 끼운다. 이어서는 한 tick에
 * 모인 갱신이 순서대로 온다.
 */
export interface HarnessGuiTabBatch {
  readonly snapshot?: AcpState;
  readonly updates: readonly AcpUpdate[];
}

export interface HarnessGuiTabUpdate extends HarnessGuiTabBatch {
  readonly handle: string;
}

export interface HarnessGuiTabOpened {
  readonly request: string;
  readonly terminal_ref: string;
  readonly handle: string;
  readonly harness: GuiHarness;
  readonly handoff: HarnessGuiHandoff;
}

export interface HarnessGuiTabCurrent {
  readonly handle: string;
  readonly harness: GuiHarness;
  readonly handoff: HarnessGuiHandoff;
  readonly view: "gui" | "tui";
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
      /** `no_session`은 TUI의 session id를 아직 모른다(hook이 안 왔다). `extension_off`는 harness-gui가 꺼져 있다. */
      readonly reason:
        | "no_session"
        | "not_running"
        | "extension_off"
        | "failed";
      readonly message: string;
    };

export interface HarnessGuiTabApi {
  onOpened(listener: (open: HarnessGuiTabOpened) => void): () => void;
  ackOpened(request: string): Promise<void>;
  onView(listener: (view: HarnessGuiTabView) => void): () => void;
  /** handle에 붙는다. 다시 부르면 snapshot부터 다시 받는다. handle이 없으면 null. */
  connect(
    handle: string,
    onBatch: (batch: HarnessGuiTabBatch) => void,
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
  /** 그 터미널에 살아 있는 GUI. 없으면 null. */
  current(terminalRef: string): Promise<HarnessGuiTabCurrent | null>;
  /** 그 CLI의 지난 session. run이 없거나 못 주면 빈 배열. */
  sessions(handle: string): Promise<HarnessGuiSessionEntry[]>;
  /** 되돌아갈 file. run이 없거나 못 주면 null. */
  rewindPreview(
    handle: string,
    message: string,
  ): Promise<HarnessGuiRewindPreview | null>;
  /** 쓴 file의 절대 경로. 못 썼으면 null. */
  uploadImage(
    handle: string,
    image: { name: string; mime: string; data: Uint8Array },
  ): Promise<string | null>;
  /** 그 탭의 임시 폴더에 쓴 이미지의 bytes와 MIME. 그 폴더 밖이거나 이미지가 아니거나 못 읽으면 null. */
  readImage(
    handle: string,
    path: string,
  ): Promise<{ mime: string; data: Uint8Array } | null>;
}
