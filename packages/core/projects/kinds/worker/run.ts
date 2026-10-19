// kinds worker: kind `documents/kinds`. core가 감독 pipe로 보내는 네 일을 한다.
// - `kinds.sync`: kinds 파일과 domain 그릇의 파일을 훑어 derived/kinds.sqlite를 갱신하고 상태와 위반을 답한다
//   (이 worker가 그 파일의 유일한 writer다).
// - `kinds.get`·`kinds.list`·`kinds.check`: 훑지 않고 index를 있는 그대로 읽어 답한다(훑는 일은 sync만 한다).
// worker는 `lophn.db`를 열지 않고 core에도 닿지 않는다. 위반은 답에 실어 보내고 problem으로 올리는 일은 core가
// 한다.
import type { z } from "zod";
import { err, type Result, systemClock } from "../../../../base/mod.ts";
import type { Clock, LophnError } from "../../../../base/mod.ts";
import { domainKindsFile } from "../../../../protocol/domains/paths.ts";
import {
  KINDS_WORK_OPS,
  KINDS_WORKER_KIND,
  kindsCheckWorkRequestSchema,
  kindsIndexPath,
  kindsListWorkRequestSchema,
  kindsWorkRequestSchema,
} from "../../../../protocol/projects/mod.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../../../../protocol/supervision/mod.ts";
import {
  type ChildSession,
  type ChildStreams,
  startChild,
} from "../../../supervision/responsiveness/mod.ts";
import { type IndexStore, openIndexStore } from "../index/store.ts";
import { openProjectFiles } from "./files.ts";
import { createKindsJobs } from "./jobs.ts";

export { KINDS_WORKER_KIND };

type KindsWorkerOptions = {
  streams: ChildStreams;
  clock?: Clock;
};

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

function createKindsWorker(options: KindsWorkerOptions): ChildSession {
  const clock = options.clock ?? systemClock;
  let dataRoot: string | undefined;
  let store: IndexStore | undefined;

  const jobs = createKindsJobs({
    store() {
      if (store === undefined) store = openStore(kindsIndexPath(dataRoot!));
      return store;
    },
    open: (roots, folders) =>
      openProjectFiles(roots, folders, { exclude: [dataRoot!] }),
    clock,
  });

  // 요청이 마음대로 읽을 파일을 정하지 못하게 kinds 파일은 그 domain의 정해진 자리여야 한다.
  function handle<T extends { domain: string; kinds_file: string }>(
    schema: z.ZodType<T>,
    request: WorkerRequest,
    run: (input: T) => Promise<Result<unknown>>,
  ): Promise<Result<unknown>> {
    const parsed = schema.safeParse(request.payload);
    const error = !parsed.success
      ? "invalid kinds request"
      : parsed.data.kinds_file !==
          domainKindsFile(dataRoot!, parsed.data.domain)
      ? "kinds_file is not the domain's kinds file"
      : undefined;
    if (!parsed.success || error !== undefined) {
      return Promise.resolve(err({ code: "invalid_input", message: error! }));
    }
    return run(parsed.data);
  }

  function dispatch(request: WorkerRequest): Promise<Result<unknown>> {
    switch (request.op) {
      case KINDS_WORK_OPS.sync:
        return handle(kindsWorkRequestSchema, request, jobs.sync);
      case KINDS_WORK_OPS.get:
        return handle(kindsWorkRequestSchema, request, jobs.get);
      case KINDS_WORK_OPS.list:
        return handle(kindsListWorkRequestSchema, request, jobs.list);
      case KINDS_WORK_OPS.check:
        return handle(kindsCheckWorkRequestSchema, request, jobs.check);
      default:
        return Promise.resolve(
          err({ code: "invalid_input", message: "unknown kinds op" }),
        );
    }
  }

  const session: ChildSession = startChild(options.streams, {
    onHello(hello) {
      if (hello.kind !== KINDS_WORKER_KIND) {
        throw new Error("invalid worker kind");
      }
      const root =
        (hello.scope.targets as Record<string, unknown>)["data_root"];
      if (typeof root !== "string" || !root.startsWith("/")) {
        throw new Error("data_root is missing");
      }
      dataRoot = root;
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
      // 이 handler는 pipe에서 온 순서대로 하나씩 돈다. 일은 기다리지 않고 맡겨서 다른 domain의 일이 서로
      // 막지 않게 한다. 한 domain의 일은 jobs가 줄 세운다.
      void dispatch(message).then(
        (result) => result,
        (): Result<never, LophnError> =>
          err({ code: "unavailable", message: "kinds worker failed" }),
      ).then((result) => session.send(reply(message, result))).catch(() => {
        // pipe가 닫혔다. 답할 곳이 없다.
      });
    },
  });
  return session;
}

export async function runKindsWorker(): Promise<void> {
  // 진입점만 console을 stderr로 돌린다. stdout은 framed IPC 전용이다.
  console.log = console.info = console.debug = (...args: unknown[]) =>
    console.error(...args);
  const session = createKindsWorker({
    streams: { stdin: Deno.stdin, stdout: Deno.stdout, stderr: Deno.stderr },
  });
  await session.run();
}

if (import.meta.main) {
  await runKindsWorker();
}
