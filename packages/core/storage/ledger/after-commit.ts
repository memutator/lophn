import type { Logger } from "../../../base/mod.ts";
import { definePort } from "../../../protocol/base/mod.ts";
import { defineTxPort, type TxPortRegistration } from "./tx-ports.ts";
import type { Writer } from "./writer.ts";

// command handler는 writer Worker에서 돌고 입력함과 Bus는 main thread에 있다. 그래서 handler는
// 입력함에 넣기와 agent event 내기를 "commit 뒤 할 일"로 모아 두고, `CommandSuccess`에 실려 main으로
// 돌아온 것을 commit 뒤에 적용한다. tx가 되돌아가면 모은 것은 버린다.

// Worker를 건너므로 structured clone 되는 값만 싣는다.
export type CommitAction = { topic: string; data: unknown };

interface AfterCommit {
  push(topic: string, data: unknown): void;
}

export const afterCommit = definePort<AfterCommit>("ledger.after-commit");

// Worker가 command 하나를 돌릴 때마다 reset하고, 성공한 새 command 뒤에만 take한다.
export function createAfterCommitCollector() {
  let pending: CommitAction[] = [];
  const registration: TxPortRegistration = defineTxPort(afterCommit, () => ({
    push(topic, data) {
      pending.push({ topic, data });
    },
  }));
  return {
    registration,
    reset() {
      pending = [];
    },
    take(): CommitAction[] {
      const taken = pending;
      pending = [];
      return taken;
    },
  };
}

// 지금 도는 command를 부른 자격의 principal이다. command가 아닌 곳에서는 null이다. 본문 blob은 그 이름으로 준비돼
// 있어, command를 거쳐 들어온 효과(session을 끝내며 보내는 알림 등)도 같은 이름으로 기록해야 한다.
interface RequestPrincipal {
  principal(): string | null;
}

export const requestPrincipal = definePort<RequestPrincipal>(
  "ledger.request-principal",
);

// 확정된 새 command 결과의 할 일을 적용한다. 재전달에는 할 일이 없다.
export function withAfterCommit(
  writer: Writer,
  apply: (actions: readonly CommitAction[]) => void,
  logger: Logger,
): Writer {
  return {
    ...writer,
    async command(ctx, envelope) {
      const done = await writer.command(ctx, envelope);
      if (done.ok && !done.value.replayed) {
        const actions = done.value.after_commit;
        if (actions !== undefined && actions.length > 0) {
          try {
            apply(actions);
          } catch (thrown) {
            logger.error({
              component: "after-commit",
              event: "apply_failed",
              fields: { error: String(thrown) },
            });
          }
        }
      }
      return done;
    },
  };
}
