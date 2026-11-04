// extension이 CLI session 하나를 ACP로 내고 그 화면의 입력을 받는 계약이다. 창 하나가 handle 하나다.
// shell main tsc가 읽는 file이라 schema(zod)는 두지 않고 type만 import한다.
import type { AcpInput } from "../acp/input.ts";
import type { AcpUpdate } from "../acp/state.ts";

/** `lophn gui <harness>`와 open intent가 받는 harness. 이 목록은 여기 하나다. */
export const GUI_HARNESSES = ["claude", "codex", "opencode"] as const;
export type GuiHarness = (typeof GUI_HARNESSES)[number];

export function isGuiHarness(value: unknown): value is GuiHarness {
  return (GUI_HARNESSES as readonly unknown[]).includes(value);
}

/** 창 하나의 handle. `id`는 lophn session id가 아니라 이 창 하나의 id다. */
export type AcpSessionHandle = {
  readonly id: string;
  /** 창으로 보낸다. 창이 아직 없거나 늦게 열려도 쌓아 두었다가 처음부터 보여 준다. */
  publish(update: AcpUpdate): void;
  /** 창의 입력. */
  onInput(listener: (input: AcpInput) => void): void;
  /** 창이 닫히거나 `close()`가 불리면 한 번 불린다. */
  onClose(listener: () => void): void;
  /** 창을 닫는다. 두 번 불러도 같다. */
  close(): void;
};

export type AcpOpenOptions = {
  harness: GuiHarness;
  /** CLI가 도는 폴더. 창 제목 옆에 보인다. */
  cwd: string;
  title: string;
};

/** open intent가 extension에 넘기는 것. `lophn gui <harness> [--resume <id>]`의 값과 친 곳이다. */
export type HarnessGuiOpen = {
  harness: GuiHarness;
  /** 절대 경로. 있는 폴더인지는 여는 쪽이 본다. */
  cwd: string;
  /** 그 CLI 자신의 session id. */
  resume?: string;
};

export type ExtensionAcp = {
  open(options: AcpOpenOptions): AcpSessionHandle;
  /**
   * open intent를 받을 함수. 켜진 extension 하나가 `activate`에서 걸고 `deactivate`에서 돌려받은 함수로 건다.
   * 걸린 게 없으면(꺼져 있으면) shell main이 Settings › System › Extensions를 연다.
   */
  onOpenIntent(
    handler: (intent: HarnessGuiOpen) => void | Promise<void>,
  ): () => void;
};
