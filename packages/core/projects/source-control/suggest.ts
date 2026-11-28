// AI 커밋 메시지 요청 queue. core에는 외부 fetch가 없어 agent-runtime이 요청을 가져가 model을 부르고 답을 돌려준다.
// 사람의 `suggest_message` 호출은 답이 오거나, 취소되거나, 시간이 넘을 때까지 열려 있다. 메모리에만 있다(재시작하면 잃어도 된다).
import { err, ok, type Result } from "../../../base/mod.ts";
import type { CommitMessageRequest } from "../../../protocol/projects/source-control.ts";

const WAIT_MS = 60_000;

type Pending = {
  readonly request: CommitMessageRequest;
  taken: boolean;
  readonly settle: (result: Result<string>) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

export class CommitMessageQueue {
  readonly #pending = new Map<string, Pending>();

  /** 요청을 쌓고 답을 기다린다. 같은 id가 이미 있으면 conflict다. */
  ask(request: CommitMessageRequest): Promise<Result<string>> {
    if (this.#pending.has(request.request)) {
      return Promise.resolve(
        err({
          code: "conflict",
          message: "this suggestion request is already running",
          details: { reason: "write_in_progress" },
        }),
      );
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#finish(
          request.request,
          err({
            code: "unavailable",
            message: "the model did not answer in time",
            details: { reason: "timeout" },
          }),
        );
      }, WAIT_MS);
      timer.unref?.();
      this.#pending.set(request.request, {
        request,
        taken: false,
        settle: resolve,
        timer,
      });
    });
  }

  /** 아직 아무도 가져가지 않은 가장 오래된 요청. */
  take(): CommitMessageRequest | null {
    for (const one of this.#pending.values()) {
      if (one.taken) continue;
      one.taken = true;
      return one.request;
    }
    return null;
  }

  /** runtime의 답. 이미 끝난(취소·시간 넘김) 요청이면 false다. */
  done(id: string, message: string | null, error: string | null): boolean {
    if (!this.#pending.has(id)) return false;
    const text = message?.trim() ?? "";
    this.#finish(
      id,
      text !== ""
        ? ok(text)
        : err({
            code: "unavailable",
            message: error ?? "the model returned no message",
            details: { reason: "git_error" },
          }),
    );
    return true;
  }

  cancel(id: string): boolean {
    if (!this.#pending.has(id)) return false;
    this.#finish(
      id,
      err({
        code: "conflict",
        message: "suggestion cancelled",
        details: { reason: "cancelled" },
      }),
    );
    return true;
  }

  #finish(id: string, result: Result<string>): void {
    const one = this.#pending.get(id);
    if (one === undefined) return;
    this.#pending.delete(id);
    clearTimeout(one.timer);
    one.settle(result);
  }
}
