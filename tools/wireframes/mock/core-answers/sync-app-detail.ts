// 앱 workspace gallery(App details, preview, Logs)가 core에서 읽는 route의 답. 화면이 `useCoreRead`로 읽으므로
// page는 MockDesktop의 events 연결을 이것으로 감싼다: 아래 route는 여기서 답하고 나머지는 원래 연결이 답한다.
// fake 쓰기가 바꾼 것은 `StateChanged`로 흘려 화면이 다시 읽게 한다.
import type { StateChange } from "../../../../packages/protocol/events/changes.ts";
import { jobList } from "../../../../packages/protocol/jobs/jobs.ts";
import { runList } from "../../../../packages/protocol/runs/runs.ts";
import type { CoreEventMessage } from "../../../../packages/shell/ipc/core.ts";
import type { CoreSource } from "../../../../packages/shell/renderer/desktop/connection/connection.ts";
import {
  type FakeAnswer,
  fakeAnswer,
} from "../../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import { fixedRuns } from "../scenarios/orders-shop.ts";

const COMMON = { as_of_seq: "0", next_cursor: null } as const;

/** 앱 Logs의 run 기록과 그 run을 연 job 제목. empty면 기록이 없다. */
export function runAnswers(app: string, empty: boolean): FakeAnswer[] {
  const runs = empty ? [] : fixedRuns(app);
  return [
    fakeAnswer(runList, () => ({
      ...COMMON,
      runs: runs.map((run) => ({
        ...run,
        job: run.job?.id ?? null,
      })) as never,
    })),
    fakeAnswer(jobList, () => ({
      ...COMMON,
      jobs: runs.flatMap((run) =>
        run.job === null ? [] : [{ id: run.job.id, title: run.job.title }],
      ) as never,
    })),
  ];
}

/** answers를 먼저 보고 없으면 원래 연결로 간다. changes가 알리는 것은 `StateChanged`로 흘린다. */
export function answering(
  answers: readonly FakeAnswer[],
  changes?: (listener: (changes: StateChange[]) => void) => () => void,
): (source: CoreSource) => CoreSource {
  return (source) => ({
    ...source,
    call(input) {
      const found = answers.find(
        ({ route }) =>
          route.kind === input.kind &&
          route.resource === input.resource &&
          route.method === input.method,
      );
      return found
        ? Promise.resolve({ ok: true, value: found.answer(input.body) })
        : source.call(input);
    },
    onEvent(listener: (message: CoreEventMessage) => void) {
      const stopInner = source.onEvent?.(listener) ?? (() => {});
      const stopChanges =
        changes?.((list) =>
          listener({
            kind: "event",
            event: {
              type: "StateChanged",
              subject: null,
              at: new Date().toISOString(),
              payload: { changes: list },
            },
          }),
        ) ?? (() => {});
      return () => {
        stopInner();
        stopChanges();
      };
    },
  });
}
