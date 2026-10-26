// 전역 hook 설치를 lophn 창의 dialog로 묻는다. 창에 push하고 그 창의 답을 기다린다(browser bridge의
// request id + ack 모양). 물을 창이 없거나 답하기 전에 창이 닫히거나 다시 load되면 거절이다.
// Electron은 모르고 deps로만 일한다.
import {
  CODING_HOOK_ASK_CHANNEL,
  CODING_HOOK_RESULT_CHANNEL,
  type HookAsk,
  type HookResult,
} from "../../../ipc/coding.ts";

export type HookAskWindow = {
  contentsId: number;
  send(channel: string, payload: unknown): void;
  /** 창이 닫히거나 다시 load된다. 해지를 돌려준다. */
  onGone(run: () => void): () => void;
};

export type HookAskerDeps = {
  /** 그 터미널을 가진 창. 모르면 마지막으로 focus를 받은 창이고, 창이 없으면 null이다. */
  pick(terminalRef: string | undefined): HookAskWindow | null;
  requestId(): string;
};

export type HookAsker = {
  ask(
    input: Omit<HookAsk, "request"> & { terminalRef?: string },
  ): Promise<boolean>;
  /** 결과를 그 창에 알린다. 답은 없다. */
  show(input: Omit<HookResult, "running"> & { terminalRef?: string }): void;
  /** 창이 보낸 답. 물은 창이 아닌 쪽의 답과 끝난 request의 답은 버린다. */
  answer(contentsId: number, request: string, accepted: boolean): void;
};

export function createHookAsker(deps: HookAskerDeps): HookAsker {
  const pending = new Map<
    string,
    { contentsId: number; settle(accepted: boolean): void }
  >();
  return {
    ask({ terminalRef, ...input }) {
      const window = deps.pick(terminalRef);
      if (window === null) return Promise.resolve(false);
      const request = deps.requestId();
      return new Promise((resolve) => {
        const off = window.onGone(() => settle(false));
        function settle(accepted: boolean) {
          if (!pending.delete(request)) return;
          off();
          resolve(accepted);
        }
        pending.set(request, { contentsId: window.contentsId, settle });
        const ask: HookAsk = { request, ...input };
        window.send(CODING_HOOK_ASK_CHANNEL, ask);
      });
    },
    show({ terminalRef, ...result }) {
      // terminalRef는 사람 터미널이 harness를 알아본 길에서만 있다. 그 harness는 이미 돌고 있다.
      const shown: HookResult = {
        ...result,
        running: terminalRef !== undefined,
      };
      deps.pick(terminalRef)?.send(CODING_HOOK_RESULT_CHANNEL, shown);
    },
    answer(contentsId, request, accepted) {
      const found = pending.get(request);
      if (found?.contentsId === contentsId) found.settle(accepted);
    },
  };
}
