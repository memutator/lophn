// harness-gui 창과 main의 shell IPC 경계. 창 하나가 ACP session 하나(extension harness-gui의 handle)를 그린다.
// 창은 `connect`로 붙어 쌓인 갱신을 처음부터 받고, 대화 조작은 `input`으로 보낸다. 이 파일은 main·preload·renderer가
// 함께 부르므로 import는 type뿐이다.
import type { AcpInput, AcpUpdate } from "../../protocol/acp/mod.ts";
import type { GuiHarness } from "../../protocol/extensions/mod.ts";

/** renderer → main invoke. 이 창의 session에 붙는다. 쌓인 갱신을 `UPDATE`로 처음부터 보낸 뒤 이어서 보낸다. */
export const HARNESS_GUI_CONNECT_CHANNEL = "harness-gui:connect";
/** main → renderer push. 갱신 하나. */
export const HARNESS_GUI_UPDATE_CHANNEL = "harness-gui:update";
/** renderer → main invoke. 대화 조작 하나를 extension에 준다. */
export const HARNESS_GUI_INPUT_CHANNEL = "harness-gui:input";

/** 창이 그리는 session의 머리 값. */
export interface HarnessGuiInfo {
  readonly harness: GuiHarness;
  readonly cwd: string;
}

export interface HarnessGuiApi {
  /** 갱신을 듣기 시작하고 머리 값을 읽는다. 다시 부르면 처음부터 다시 받는다. */
  connect(onUpdate: (update: AcpUpdate) => void): Promise<HarnessGuiInfo>;
  /** 조작을 보냈으면 true다. 통로가 끊기거나 main이 거절하면 false다. */
  input(input: AcpInput): Promise<boolean>;
}
