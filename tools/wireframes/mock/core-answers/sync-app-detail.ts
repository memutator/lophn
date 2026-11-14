// 앱 workspace gallery(App details, preview 탭, Logs)가 core에서 읽는 route의 답. 화면이 `useCoreRead`로 읽으므로
// page는 MockDesktop의 events 연결을 이것으로 감싼다: 아래 route는 여기서 답하고 나머지는 원래 연결이 답한다.
// fake 쓰기가 바꾼 것은 `StateChanged`로 흘려 화면이 다시 읽게 한다.
import type { StateChange } from "../../../../packages/protocol/events/changes.ts";
import { previewsGet } from "../../../../packages/protocol/apps/previews.ts";
import { jobList } from "../../../../packages/protocol/jobs/jobs.ts";
import { runList } from "../../../../packages/protocol/runs/runs.ts";
import type { CoreEventMessage } from "../../../../packages/shell/ipc/core.ts";
import type { CoreSource } from "../../../../packages/shell/renderer/desktop/connection/connection.ts";
import {
  type FakeAnswer,
  fakeAnswer,
} from "../../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import type { PreviewSource } from "../../../../packages/shell/renderer/workspace/app-preview-tab.tsx";
import { fixedRuns } from "../scenarios/orders-shop.ts";

type Changes = (listener: (changes: StateChange[]) => void) => () => void;

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

/** 그 앱에 ready인 preview 하나(running이 false면 없음). [Stop]이 멈추고 app_runtime 변경을 낸다. */
export function fakePreview(
  running: boolean,
  release: string,
  devices: Awaited<ReturnType<PreviewSource["devices"]>>,
) {
  const listeners = new Set<(changes: StateChange[]) => void>();
  const source: PreviewSource = {
    devices: () => Promise.resolve(devices),
    stop: (app) => {
      running = false;
      for (const listener of [...listeners]) {
        listener([{ name: "app_runtime", id: app }]);
      }
      return Promise.resolve();
    },
  };
  const answers = [
    fakeAnswer(previewsGet, ({ app }) => ({
      observation: running
        ? {
            app,
            release,
            bundle_hash: "0".repeat(64),
            mode: "preview" as const,
            process_nonce: "pv1",
            endpoint: null,
            ready: true,
            accepting: false as const,
          }
        : null,
      observed_at: null,
    })),
  ];
  const onChanged: Changes = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return { source, answers, onChanged };
}

/** answers를 먼저 보고 없으면 원래 연결로 간다. changes가 알리는 것은 `StateChanged`로 흘린다. */
export function answering(
  answers: readonly FakeAnswer[],
  ...changes: Changes[]
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
      const stops = changes.map((subscribe) =>
        subscribe((list) =>
          listener({
            kind: "event",
            event: {
              type: "StateChanged",
              subject: null,
              at: new Date().toISOString(),
              payload: { changes: list },
            },
          }),
        ),
      );
      return () => {
        stopInner();
        for (const stop of stops) stop();
      };
    },
  });
}
