// release 준비 요청의 진행. 접수는 release 확정이 아니고
// 진행은 core command queue가 아니라 supervisor 메모리다. 메모리를 잃으면(supervisor가 다시 뜸) 이전
// 요청은 `unknown`이며 성공으로 다시 쓰지 않는다. 준비 한 번의 실제 일(commit 추출·build·봉인)은
// `PreparationRunner`가 하고 취소는 그 실행의 signal과 종료 확인으로 한다.
import { err, ok, type Result } from "../../../base/mod.ts";

type PreparationStatus =
  | "preparing"
  | "completed"
  | "cancelled"
  | "failed"
  | "unknown";

export type PreparationJob = {
  app: string;
  commit: string;
  request_key: string;
  // 연결된 source 경계다. core가 앱 등록에서 읽어 보낸다.
  source_path: string;
};

export type PreparationOutcome = {
  bundle_hash: string;
  blueprint_hash: string;
};

export type PreparationSnapshot = {
  app: string;
  request_key: string;
  status: PreparationStatus;
  bundle_hash: string | null;
  blueprint_hash: string | null;
};

// 준비 한 번을 돈다. 취소면 signal이 aborted이고 실행은 자식을 끝낸 뒤에야 돌려준다.
export interface PreparationRunner {
  run(
    job: PreparationJob,
    signal: AbortSignal,
  ): Promise<Result<PreparationOutcome>>;
}

export type PreparationService = {
  start(job: PreparationJob): Result<PreparationSnapshot>;
  get(app: string, requestKey: string): PreparationSnapshot;
  // 취소를 요청하고 실행 종료를 확인한 뒤 답한다. 끝난 요청은 그 상태 그대로다.
  cancel(app: string, requestKey: string): Promise<Result<void>>;
};

type Entry = {
  job: PreparationJob;
  status: Exclude<PreparationStatus, "unknown">;
  outcome: PreparationOutcome | null;
  controller: AbortController;
  done: Promise<void>;
};

function snapshotOf(
  app: string,
  requestKey: string,
  entry: Entry | undefined,
): PreparationSnapshot {
  if (entry === undefined) {
    return {
      app,
      request_key: requestKey,
      status: "unknown",
      bundle_hash: null,
      blueprint_hash: null,
    };
  }
  const done = entry.status === "completed" ? entry.outcome : null;
  return {
    app,
    request_key: requestKey,
    status: entry.status,
    bundle_hash: done?.bundle_hash ?? null,
    blueprint_hash: done?.blueprint_hash ?? null,
  };
}

export function createPreparationService(
  runner: PreparationRunner,
): PreparationService {
  const entries = new Map<string, Entry>();
  const keyOf = (app: string, requestKey: string) => `${app}\n${requestKey}`;

  return {
    start(job) {
      const key = keyOf(job.app, job.request_key);
      const known = entries.get(key);
      if (known !== undefined) {
        // 같은 request_key의 같은 요청은 같은 진행이다. commit이 다르면 다른 요청이다.
        return known.job.commit === job.commit
          ? ok(snapshotOf(job.app, job.request_key, known))
          : err({
            code: "conflict",
            message: "the request key is used for another commit",
          });
      }
      const controller = new AbortController();
      const entry: Entry = {
        job,
        status: "preparing",
        outcome: null,
        controller,
        done: Promise.resolve(),
      };
      entry.done = runner.run(job, controller.signal).then(
        (result) => {
          if (entry.status !== "preparing") return;
          if (controller.signal.aborted) entry.status = "cancelled";
          else if (result.ok) {
            entry.status = "completed";
            entry.outcome = result.value;
          } else entry.status = "failed";
        },
        () => {
          if (entry.status === "preparing") {
            entry.status = controller.signal.aborted ? "cancelled" : "failed";
          }
        },
      );
      entries.set(key, entry);
      return ok(snapshotOf(job.app, job.request_key, entry));
    },
    get(app, requestKey) {
      return snapshotOf(app, requestKey, entries.get(keyOf(app, requestKey)));
    },
    async cancel(app, requestKey) {
      const entry = entries.get(keyOf(app, requestKey));
      if (entry === undefined) {
        return err({
          code: "conflict",
          message: "the preparation is unknown",
        });
      }
      if (entry.status === "preparing") entry.controller.abort();
      await entry.done;
      return ok(undefined);
    },
  };
}
