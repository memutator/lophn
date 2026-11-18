// 전역 hook 설치를 lophn 창의 dialog로 묻는다. core는 `HookInstallAsked`를 내고 `coding_agents/hook_answer`로 오는 답을 기다린다
// (request id 하나에 답 하나). 물을 곳(붙은 shell)이 없거나 답하기 전에 그 연결이 닫히면 거절이다. Bus와 연결은 deps로만 안다.
import type {
  HookAsk,
  HookResult,
} from "../../protocol/coding-agent/coding-agents.ts";

export type HookAskWindow = {
  /** 답을 보낼 곳을 가린다. 다른 곳이 보낸 같은 request의 답은 버린다. */
  contentsId: number;
  send(kind: "ask" | "result", payload: unknown): void;
  /** 묻는 곳이 사라진다(연결이 닫힌다). 해지를 돌려준다. */
  onGone(run: () => void): () => void;
};

export type HookAskerDeps = {
  /** 그 터미널을 물을 곳. 없으면(붙은 shell이 없다) null이다. */
  pick(terminalRef: string | undefined): HookAskWindow | null;
  requestId(): string;
};

export type HookAsker = {
  ask(
    input: Omit<HookAsk, "request" | "terminal"> & { terminalRef?: string },
  ): Promise<boolean>;
  /** 결과를 알린다. 답은 없다. */
  show(input: Omit<HookResult, "running"> & { terminalRef?: string }): void;
  /** 받은 답. 물은 곳이 아닌 쪽의 답과 끝난 request의 답은 버린다. */
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
        window.send("ask", { request, ...input });
      });
    },
    show({ terminalRef, ...result }) {
      // terminalRef는 사람 터미널이 harness를 알아본 길에서만 있다. 그 harness는 이미 돌고 있다.
      const shown: HookResult = {
        ...result,
        running: terminalRef !== undefined,
      };
      deps.pick(terminalRef)?.send("result", shown);
    },
    answer(contentsId, request, accepted) {
      const found = pending.get(request);
      if (found?.contentsId === contentsId) found.settle(accepted);
    },
  };
}
