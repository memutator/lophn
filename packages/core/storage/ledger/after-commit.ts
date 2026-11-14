import type { Logger, LophnError, Result } from "../../../base/mod.ts";
import { definePort } from "../../../protocol/base/mod.ts";
import { resolveChanges } from "../../../protocol/events/changes.ts";
import type { CommandDefinition } from "../../../protocol/server/mod.ts";
import { defineTxPort, type TxPortRegistration } from "./tx-ports.ts";
import type { CommandSuccess, Writer } from "./writer.ts";

// command handler는 writer Worker에서 돌고 queue와 Bus는 main thread에 있다. 그래서 handler는
// queue에 넣기와 agent event 내기를 "commit 뒤 할 일"로 모아 두고, `CommandSuccess`에 실려 main으로
// 돌아온 것을 commit 뒤에 적용한다. tx가 되돌아가면 모은 것은 버린다.

// Worker를 건너므로 structured clone 되는 값만 싣는다.
export type CommitAction = { topic: string; data: unknown };

interface AfterCommit {
  push(topic: string, data: unknown): void;
}

export const afterCommit = definePort<AfterCommit>("ledger.after-commit");

// route 정의의 `changes`를 푼 목록(StateChange[])을 싣는 topic이다. main thread가 `StateChanged` 하나로 낸다.
export const STATE_CHANGED_TOPIC = "ledger.state-changed";

// Worker는 command 하나를 run으로 돌린다. 모은 것은 확정된 새 command의 결과에만 실린다.
export function createAfterCommitCollector() {
  let pending: CommitAction[] = [];
  const registration: TxPortRegistration = defineTxPort(afterCommit, () => ({
    push(topic, data) {
      pending.push({ topic, data });
    },
  }));
  // handler가 성공하면 그 route의 `changes`를 입력·결과로 풀어 쌓는다. `tx.call`도 같은 표의 handle을 부르므로
  // 다른 command 안에서 돈 command의 것도 쌓인다. tx가 되돌아가면 run이 reset으로 버린다.
  function declared(definition: CommandDefinition): CommandDefinition {
    const changes = definition.route.changes;
    if (changes === undefined || changes.length === 0) return definition;
    return {
      ...definition,
      handle(tx, ctx, input, compare) {
        const raw = definition.handle(tx, ctx, input, compare);
        const result = raw as { ok?: unknown; value?: unknown } | null;
        if (typeof result === "object" && result?.ok === true) {
          pending.push({
            topic: STATE_CHANGED_TOPIC,
            data: resolveChanges(changes, input, result.value),
          });
        }
        return raw;
      },
    };
  }
  return {
    registration,
    declared,
    // command 하나를 돌린다. 확정된 새 command의 결과에만 모은 것을 싣는다. 되돌아간 tx와 재전달은 버린다.
    async run(
      execute: () => Promise<Result<CommandSuccess, LophnError>>,
    ): Promise<Result<CommandSuccess, LophnError>> {
      pending = [];
      const body = await execute();
      const taken = pending;
      pending = [];
      if (body.ok && !body.value.replayed && taken.length > 0) {
        body.value.after_commit = taken;
      }
      return body;
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
