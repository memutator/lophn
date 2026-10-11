// context worker: kind `documents/contexts`(docs/architecture/documents.md 2.4). core가 감독 pipe로
// 보내는 세 일을 한다.
// - `context.index`: 계약이 가리키는 파일을 stat으로 훑어 derived/contexts.sqlite를 갱신한다
//   (이 worker가 그 파일의 유일한 writer다).
// - `context.check`: 계약이 가리키는 파일을 임시 snapshot으로 복사해 그 snapshot에서만 판을 검사한다.
// - `context.preview`: 만드는 중인 판을 같은 방식의 임시 snapshot에서 돌려 보기만 한다(index·ledger를 쓰지
//   않고 낼 command도 없다).
// 일은 packages/documents/contexts의 work-*.ts가 하고 여기는 IPC와 IO adapters를 잇는다. worker는
// `lophn.db`를 열지 않고 core에도 닿지 않는다. 낼 command(`context.record_violations`,
// `bundle.finish_check`)는 답에 실어 보내고 core가 좁은 machine 자격으로 낸다.
import {
  err,
  ok,
  type Result,
  systemClock,
} from "../../../packages/base/mod.ts";
import type { Clock, LophnError } from "../../../packages/base/mod.ts";
import {
  CONTEXT_WORK_OPS,
  contextCheckRequestSchema,
  type ContextCheckResponse,
  contextIndexRequestSchema,
  type ContextIndexResponse,
  contextPreviewWorkRequestSchema,
  type ContextPreviewWorkResponse,
  type ContextSubmission,
} from "../../../packages/contracts/documents/mod.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../../../packages/contracts/platform/mod.ts";
import {
  type IndexStore,
  openIndexStore,
} from "../../../packages/documents/contexts/index/mod.ts";
import { runPreviewJob } from "../../../packages/documents/contexts/preview/mod.ts";
import type { ValidationEnv } from "../../../packages/documents/contexts/validate/mod.ts";
import { createContextJobs } from "../../../packages/documents/contexts/work-jobs.ts";
import type {
  FinishCheckInput,
  RecordViolationsInput,
  SubmitPort,
} from "../../../packages/documents/contexts/work-types.ts";
import {
  type ChildSession,
  type ChildStreams,
  startChild,
} from "../../../packages/platform/responsiveness/mod.ts";
import {
  cleanSnapshots,
  type ContextFileOptions,
  createSnapshotPort,
  openProjectFiles,
} from "./contexts-files.ts";

export const CONTEXTS_KIND = "documents/contexts";

// data root 아래 worker가 쓰는 두 자리. core의 launch spec(apps/core/contexts-worker.ts)이 같은 자리만
// 쓰기를 허락한다.
export function contextsPaths(dataRoot: string) {
  return {
    index: `${dataRoot}/derived/contexts.sqlite`,
    staging: `${dataRoot}/documents/staging/context-check`,
  };
}

export type ContextsWorkerOptions = {
  streams: ChildStreams;
  clock?: Clock;
  // 시험이 파일 예산을 줄일 때 쓴다.
  files?: ContextFileOptions;
};

const NAME_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

// 미리보기 snapshot 폴더 이름: `prv_` + 소문자·숫자 26자. 호출마다 다르다.
function newSnapshotName(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(26));
  return `prv_${
    Array.from(bytes, (byte) => NAME_ALPHABET[byte % NAME_ALPHABET.length])
      .join("")
  }`;
}

function reply(
  request: WorkerRequest,
  result: Result<unknown>,
): WorkerResponse {
  return result.ok
    ? {
      type: "worker_response",
      request_id: request.request_id,
      ok: true,
      payload: result.value,
    }
    : {
      type: "worker_response",
      request_id: request.request_id,
      ok: false,
      error: { code: result.error.code, message: result.error.message },
    };
}

// 이 process의 index store. 처음 쓸 때 열고 손상이면 지우고 한 번 다시 만든다(index는 파생이다).
function openStore(path: string): IndexStore {
  try {
    return openIndexStore(path);
  } catch {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      try {
        Deno.removeSync(`${path}${suffix}`);
      } catch { /* 없으면 그대로 둔다 */ }
    }
    return openIndexStore(path);
  }
}

export function createContextsWorker(
  options: ContextsWorkerOptions,
): ChildSession {
  const clock = options.clock ?? systemClock;
  let dataRoot: string | undefined;
  let store: IndexStore | undefined;

  // 일이 내려는 command를 모은다. job이 끝나면 요청별로 꺼내 답에 싣는다.
  const submissions = new Map<string, ContextSubmission[]>();
  const keep = (key: string, submission: ContextSubmission) => {
    submissions.set(key, [...(submissions.get(key) ?? []), submission]);
  };
  const take = (key: string): ContextSubmission[] => {
    const taken = submissions.get(key) ?? [];
    submissions.delete(key);
    return taken;
  };
  const submit: SubmitPort = {
    finishCheck(input: FinishCheckInput) {
      keep(`check:${input.check}`, { command: "bundle.finish_check", input });
      return Promise.resolve(ok({}));
    },
    recordViolations(input: RecordViolationsInput) {
      keep(`index:${input.context}`, {
        command: "context.record_violations",
        input,
      });
      return Promise.resolve(ok({}));
    },
  };

  const exclude = () => dataRoot === undefined ? [] : [dataRoot];
  const jobs = createContextJobs({
    get store() {
      if (store === undefined) {
        store = openStore(contextsPaths(dataRoot!).index);
      }
      return store;
    },
    files: (folders, roots = []) =>
      openProjectFiles(roots, folders, {
        exclude: exclude(),
        ...options.files,
      }),
    clock,
    snapshots: {
      create: (check, folders, roots = []) =>
        createSnapshotPort(contextsPaths(dataRoot!).staging, {
          exclude: exclude(),
          ...options.files,
        }).create(check, folders, roots),
    },
    submit,
  });

  async function index(request: WorkerRequest): Promise<Result<unknown>> {
    const parsed = contextIndexRequestSchema.safeParse(request.payload);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid index request" });
    }
    const input = parsed.data;
    const done = await jobs.index({
      context: input.context,
      bundle: input.bundle,
      bundle_hash: input.bundle_hash,
      recorded_count: input.recorded_count,
      roots: input.roots,
    });
    const queued = take(`index:${input.context}`);
    if (!done.ok) return done;
    const response: ContextIndexResponse = {
      scanned: done.value.scanned,
      changed: done.value.changed.length,
      removed: done.value.removed.length,
      extracted: done.value.extracted,
      violation_count: done.value.violation_count,
      submissions: queued,
    };
    return ok(response);
  }

  async function check(request: WorkerRequest): Promise<Result<unknown>> {
    const parsed = contextCheckRequestSchema.safeParse(request.payload);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid check request" });
    }
    const input = parsed.data;
    const effects = new Map(
      input.app_commands.map((entry) => [
        `${entry.app}\u0000${entry.command}`,
        entry.effect,
      ]),
    );
    const env: ValidationEnv = {
      externalTypes: input.external_types,
      appCommandEffect: (app, command) =>
        effects.get(`${app}\u0000${command}`) ?? "unknown",
    };
    const done = await jobs.check({
      context: input.context,
      check: input.check,
      bundle: input.bundle,
      bundle_hash: input.bundle_hash,
      user_saved_views: input.user_saved_views,
      env,
      roots: input.roots,
    });
    const queued = take(`check:${input.check}`);
    if (!done.ok) return done;
    const response: ContextCheckResponse = {
      status: done.value.status,
      snapshot_hash: done.value.snapshot_hash,
      violation_count: done.value.violation_count,
      submissions: queued,
    };
    return ok(response);
  }

  // 같은 draft(와 같은 환경·폴더)를 묻는 요청은 하나로 합친다. 끝난 요청은 기억하지 않는다.
  const previews = new Map<string, Promise<Result<unknown>>>();

  function preview(request: WorkerRequest): Promise<Result<unknown>> {
    const parsed = contextPreviewWorkRequestSchema.safeParse(request.payload);
    if (!parsed.success) {
      return Promise.resolve(
        err({ code: "invalid_input", message: "invalid preview request" }),
      );
    }
    const input = parsed.data;
    const key = JSON.stringify(input);
    const joined = previews.get(key);
    if (joined !== undefined) return joined;
    const effects = new Map(
      input.app_commands.map((entry) => [
        `${entry.app}\u0000${entry.command}`,
        entry.effect,
      ]),
    );
    const env: ValidationEnv = {
      externalTypes: input.external_types,
      appCommandEffect: (app, command) =>
        effects.get(`${app}\u0000${command}`) ?? "unknown",
    };
    const run = runPreviewJob({
      snapshots: {
        create: (name, folders, roots = []) =>
          createSnapshotPort(contextsPaths(dataRoot!).staging, {
            exclude: exclude(),
            ...options.files,
          }).create(name, folders, roots),
      },
    }, {
      snapshot: newSnapshotName(),
      draft: input.draft,
      env,
      roots: input.roots,
    }).then((done): Result<unknown> => {
      if (!done.ok) return done;
      const response: ContextPreviewWorkResponse = {
        types: done.value.types,
        findings: done.value.findings,
        violation_count: done.value.violation_count,
        violations: done.value.violations,
      };
      return ok(response);
    });
    previews.set(key, run);
    const done = () => previews.delete(key);
    run.then(done, done);
    return run;
  }

  const session: ChildSession = startChild(options.streams, {
    onHello(hello) {
      if (hello.kind !== CONTEXTS_KIND) throw new Error("invalid worker kind");
      const root =
        (hello.scope.targets as Record<string, unknown>)["data_root"];
      if (typeof root !== "string" || !root.startsWith("/")) {
        throw new Error("data_root is missing");
      }
      dataRoot = root;
      // 이전 process가 남긴 snapshot은 결과를 알 수 없으므로 지운다.
      cleanSnapshots(contextsPaths(root).staging);
      return session.send({ type: "ready" });
    },
    onStop() {
      try {
        store?.close();
      } catch { /* 닫지 못해도 process가 끝난다 */ }
      store = undefined;
      return session.send({ type: "stopped" });
    },
    onParent(message) {
      if (message.type !== "worker_request") return;
      const run = message.op === CONTEXT_WORK_OPS.index
        ? index
        : message.op === CONTEXT_WORK_OPS.check
        ? check
        : message.op === CONTEXT_WORK_OPS.preview
        ? preview
        : undefined;
      if (run === undefined) {
        return session.send(
          reply(
            message,
            err({ code: "invalid_input", message: "unknown context op" }),
          ),
        );
      }
      // 이 handler는 pipe에서 온 순서대로 하나씩 돈다. 일은 기다리지 않고 맡겨서 다른 context의 일이
      // 서로 막지 않게 한다. 한 context의 일은 jobs가 줄 세운다.
      void run(message).then(
        (result) => result,
        (): Result<never, LophnError> =>
          err({ code: "unavailable", message: "context worker failed" }),
      ).then((result) => session.send(reply(message, result))).catch(() => {
        // pipe가 닫혔다. 답할 곳이 없다.
      });
    },
  });
  return session;
}

export async function runContextsWorker(): Promise<void> {
  // 진입점만 console을 stderr로 돌린다. stdout은 framed IPC 전용이다.
  console.log = console.info = console.debug = (...args: unknown[]) =>
    console.error(...args);
  const session = createContextsWorker({
    streams: { stdin: Deno.stdin, stdout: Deno.stdout, stderr: Deno.stderr },
  });
  await session.run();
}

if (import.meta.main) {
  await runContextsWorker();
}
