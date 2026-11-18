// extension이 여는 ACP handle(`ctx.acp`). handle은 탭이 닫히거나 extension이 닫을 때까지 update를 접은 상태(`AcpState`) 하나만
// 쥔다. 늦게 붙는 화면은 그 상태를 snapshot으로 한 번 받고 이어서 새 update를 받는다(raw update와 글 조각을 쌓지 않는다).
import type { IdSource } from "../../base/id.ts";
import type { AcpInput } from "../../protocol/acp/input.ts";
import { EMPTY_ACP_STATE, reduceAcp } from "../../protocol/acp/reduce.ts";
import type { AcpState, AcpUpdate } from "../../protocol/acp/state.ts";
import type {
  AcpSessionHandle,
  AcpTabHandlers,
  ExtensionAcp,
  GuiHarness,
} from "../../protocol/extensions/acp-session.ts";

/** 화면 쪽이 handle 하나에 붙는 listener. */
export type AcpListener = {
  snapshot(state: AcpState): void;
  update(update: AcpUpdate): void;
  closed(): void;
};

/** core가 쥐는 열린 handle 하나. 터미널 탭 하나에 묶인다. */
export type AcpHandle = {
  readonly id: string;
  readonly terminal: string;
  readonly harness: GuiHarness;
  readonly handoff: "restart" | "shared";
  readonly cwd: string;
  state(): AcpState;
  /** 지금 상태를 snapshot으로 한 번 준 뒤 update를 잇는다. 돌려받은 함수로 뗀다. */
  attach(listener: AcpListener): () => void;
  input(input: AcpInput): void;
  close(): void;
};

export function createAcp(
  ids: IdSource,
  // handle이 열릴 때 부른다. 화면에 보이는 일은 받는 쪽이 한다.
  opened: (handle: AcpHandle) => void,
): { acp: ExtensionAcp; tab(): AcpTabHandlers | undefined } {
  let tab: AcpTabHandlers | undefined;
  const acp: ExtensionAcp = {
    open(options) {
      const id = ids.newId("win");
      let state: AcpState = EMPTY_ACP_STATE;
      const attached = new Set<AcpListener>();
      const inputs: Array<(input: AcpInput) => void> = [];
      const closers: Array<() => void> = [];
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        state = EMPTY_ACP_STATE;
        for (const listener of [...attached]) listener.closed();
        attached.clear();
        for (const listener of closers) listener();
      };
      const handle: AcpSessionHandle = {
        id,
        publish(update) {
          if (closed) return;
          state = reduceAcp(state, update);
          for (const listener of attached) listener.update(update);
        },
        onInput: (listener) => void inputs.push(listener),
        onClose: (listener) => void closers.push(listener),
        close,
      };
      opened({
        id,
        terminal: options.terminal.id,
        harness: options.harness,
        handoff: options.handoff,
        cwd: options.terminal.cwd,
        state: () => state,
        attach(listener) {
          if (closed) {
            listener.closed();
            return () => {};
          }
          listener.snapshot(state);
          attached.add(listener);
          return () => void attached.delete(listener);
        },
        input: (input) => inputs.forEach((listener) => listener(input)),
        close,
      });
      return handle;
    },
    onTab(next) {
      tab = next;
      return () => {
        if (tab === next) tab = undefined;
      };
    },
  };
  return { acp, tab: () => tab };
}
