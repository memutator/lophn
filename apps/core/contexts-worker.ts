// context worker(kind `documents/contexts`)를 core 쪽에서 띄우고 일을 보내는 조립
// (docs/architecture/documents.md 2.4, 3.2 따라잡기, 7.4, 7.6, 7.7).
//
// - 띄우기: 첫 요청에서 platform 감독(`createSupervisor`)으로 띄운다. kind마다 child 하나. 읽을 Project
//   폴더가 늘면 새 권한으로 다시 띄운다.
// - `context.index`: 검색·overview·input 후보·개체·series 다음 이름·context 열기·위반 목록을 읽기 전에
//   그 context의 index를 따라잡는다. 같은 context에 이미 도는 scan이 있으면 그 결과를 기다리고, 직전
//   scan이 끝난 지 2초 안이면 새로 요청하지 않는다. 기한 안에 끝나지 않으면 있던 index로 답한다.
// - `context.check`: bundle.submit이 받아들여지면 후보 판을 worker에 보낸다. 답이 오지 않아 checking으로
//   남은 후보는 core가 시작할 때 `recover`가 다시 보낸다.
// - 결과 제출: worker는 core에 닿지 않고 낼 command를 답에 싣는다. core가 요청의 context·bundle·check와
//   맞는지 다시 보고 좁은 machine 자격으로 낸다.
//
// 이 모듈은 core의 module graph에 들어간다. node:sqlite와 동기 file API는 쓰지 않는다(파일을 읽고 index를
// 쓰는 일은 모두 worker 안이다).
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  bundleSubmitRoute,
  CONTEXT_WORK_OPS,
  type ContextCheckRequest,
  contextCheckResponseSchema,
  contextEntityRoute,
  contextGetRoute,
  contextIndexResponseSchema,
  contextInputOptionsRoute,
  contextOverviewRoute,
  type ContextPreviewRead,
  contextPreviewRoute,
  contextPreviewWorkResponseSchema,
  contextSearchRoute,
  contextSeriesNextRoute,
  type ContextSubmission,
  contextViolationsRoute,
  type ContextWorkInput,
  type ContextWorkList,
} from "../../packages/contracts/documents/mod.ts";
import { parseActor } from "../../packages/contracts/platform/mod.ts";
import type {
  ChildMessage,
  KindLaunchSpec,
  ParentMessage,
} from "../../packages/contracts/platform/mod.ts";
import type {
  CommandEnvelope,
  Writer,
} from "../../packages/platform/ledger/mod.ts";
import type { ReadHandler } from "../../packages/platform/api/mod.ts";
import type {
  ChildCallbacks,
  StartResult,
} from "../../packages/platform/responsiveness/mod.ts";
import { pagePreview } from "../../packages/documents/contexts/mod.ts";
import { checkLaunchSpec } from "../../packages/platform/security/mod.ts";

export const CONTEXTS_WORKER_KIND = "documents/contexts";

// 읽기가 index를 기다리는 한도와, 직전 scan이 끝난 뒤 새 scan을 요청하지 않는 시간(초기 구현값).
export const CONTEXT_INDEX_DEADLINE_MS = 2_000;
export const CONTEXT_INDEX_FRESH_MS = 2_000;
// worker가 한 일을 끝내기를 core가 기다리는 한도.
export const CONTEXT_INDEX_TIMEOUT_MS = 60_000;
export const CONTEXT_CHECK_TIMEOUT_MS = 120_000;
export const CONTEXT_PREVIEW_TIMEOUT_MS = 60_000;
// 답이 오지 않은(결과 불명) check를 다시 보내는 간격. 마지막 시도가 실패하면 후보는 checking으로 남는다.
export const CONTEXT_CHECK_RETRY_MS = [1_000, 3_000] as const;

// worker가 쓰는 두 자리. 같은 경로를 worker(apps/worker/documents/contexts.ts)도 쓴다.
export function contextsIndexPath(dataRoot: string): string {
  return `${dataRoot}/derived/contexts.sqlite`;
}
export function contextsStagingPath(dataRoot: string): string {
  return `${dataRoot}/documents/staging/context-check`;
}

// child가 코드와 deno 캐시를 올리는 읽기. 사용자 폴더가 아니다.
function codeReads(): string[] {
  const repo = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
  const home = Deno.env.get("HOME");
  let configured: string | undefined;
  try {
    configured = Deno.env.get("DENO_DIR");
  } catch { /* env 권한이 없으면 기본 위치를 쓴다 */ }
  const cache = configured ?? (home ? `${home}/.cache/deno` : "/tmp");
  return [repo, cache];
}

// 권한: 읽기는 Project 폴더와 자기 index·snapshot 자리, 쓰기는 index(+WAL)와 snapshot 폴더뿐이다.
// network·env·subprocess·FFI는 없다. `--no-prompt`는 launchArgv가 낸다.
export function contextsWorkerSpec(input: {
  dataRoot: string;
  roots: readonly string[];
}): KindLaunchSpec | undefined {
  const index = contextsIndexPath(input.dataRoot);
  const files = [index, `${index}-wal`, `${index}-shm`, `${index}-journal`];
  const staging = contextsStagingPath(input.dataRoot);
  const spec: KindLaunchSpec = {
    kind: CONTEXTS_WORKER_KIND,
    entry: new URL("../worker/documents/contexts.ts", import.meta.url).pathname,
    allow_read: [
      ...new Set([
        ...input.roots.filter((root) => root !== input.dataRoot),
        ...files,
        staging,
        ...codeReads(),
      ]),
    ],
    allow_write: [...files, staging],
    allow_net: [],
    allow_run: [],
    allow_sys: [],
    allow_env: [],
    policy: "on_request",
    memory_limit_bytes: 512 * 1024 * 1024,
  };
  const checked = checkLaunchSpec(spec);
  return checked.ok ? checked.value : undefined;
}

// ── process ───────────────────────────────────────────────────────────

// worker 요청 통로. documents-serving의 DocumentsChannel 모양 중 쓰는 부분이다.
export type ContextsChannel = {
  request(
    op: string,
    payload: unknown,
    timeoutMs?: number,
  ): Promise<Result<unknown>>;
  onMessage(message: ChildMessage): void;
  bind(send: ((payload: unknown) => Promise<boolean>) | null): void;
  failPending(message: string): void;
};

export type ContextsProcessDeps = {
  supervisor: {
    start(
      spec: unknown,
      hello: ParentMessage,
      callbacks: ChildCallbacks,
    ): Promise<StartResult>;
    updateSpec(
      spec: unknown,
      hello: ParentMessage,
      callbacks?: ChildCallbacks,
    ): Promise<StartResult>;
    send(kind: string, payload: unknown): Promise<StartResult>;
  };
  channel: ContextsChannel;
  dataRoot: string;
  epoch: string;
  apiPort: number;
  // 띄우기 전에 worker가 쓸 폴더를 만든다(worker는 자기 index 폴더를 만들 권한이 없다).
  prepare(): Promise<void>;
};

export type ContextsProcess = {
  // worker가 이 Project 폴더들을 읽을 수 있게 띄운다. 이미 그렇게 떠 있으면 그대로 둔다.
  ensure(roots: readonly string[]): Promise<boolean>;
  // 읽을 Project 폴더 전체가 이것이라고 알린다. 떠 있는 worker가 이 밖의 폴더를 읽을 수 있게 떠 있으면
  // 이 폴더들로만 다시 띄운다(폴더가 빠진 일 하나가 다시 띄운다). worker가 없으면 아무것도 하지 않는다.
  // 폴더가 늘 때는 일이 `ensure`로 스스로 요청하므로 여기서 늘리지 않는다.
  retain(roots: readonly string[]): Promise<void>;
  request(
    op: string,
    payload: unknown,
    timeoutMs: number,
  ): Promise<Result<unknown>>;
};

export function createContextsProcess(
  deps: ContextsProcessDeps,
): ContextsProcess {
  let allowed: string[] | undefined;
  let gaveUp = false;
  let chain: Promise<unknown> = Promise.resolve();

  const hello: ParentMessage = {
    type: "hello",
    core_epoch: deps.epoch,
    process_identity: deps.epoch,
    kind: CONTEXTS_WORKER_KIND,
    task: "contexts",
    scope: { operations: [], targets: { data_root: deps.dataRoot } },
    // worker는 core에 닿지 않는다. 자격은 core가 쥐고 worker에 주지 않는다.
    credential: "none",
    api_port: deps.apiPort,
  };
  const callbacks: ChildCallbacks = {
    onMessage: (message) => deps.channel.onMessage(message),
    // 끝난 child에 보낸 요청은 답이 오지 않는다. 자동으로 다시 보내지 않는다.
    onEnd: () =>
      deps.channel.failPending("context worker가 끝나 요청이 끝나지 못했다"),
    onGiveUp: () => {
      gaveUp = true;
    },
  };

  async function launch(roots: string[]): Promise<boolean> {
    const spec = contextsWorkerSpec({ dataRoot: deps.dataRoot, roots });
    if (spec === undefined) return false;
    try {
      await deps.prepare();
    } catch {
      return false;
    }
    const replace = allowed !== undefined || gaveUp;
    const started = replace
      ? await deps.supervisor.updateSpec(spec, hello, callbacks)
      : await deps.supervisor.start(spec, hello, callbacks);
    if (!started.ok) return false;
    allowed = roots;
    gaveUp = false;
    deps.channel.bind((payload) =>
      deps.supervisor.send(CONTEXTS_WORKER_KIND, payload).then((sent) =>
        sent.ok
      )
    );
    return true;
  }

  return {
    ensure(roots) {
      const run = chain.then(async () => {
        const known = allowed ?? [];
        if (
          allowed !== undefined && !gaveUp &&
          roots.every((root) => known.includes(root))
        ) {
          return true;
        }
        const next = [...new Set([...known, ...roots])].sort();
        return await launch(next);
      });
      chain = run.catch(() => undefined);
      return run;
    },
    retain(roots) {
      const run = chain.then(async () => {
        if (allowed === undefined || gaveUp) return;
        const keep = allowed.filter((root) => roots.includes(root));
        if (keep.length === allowed.length) return;
        await launch(keep);
      });
      chain = run.catch(() => undefined);
      return run;
    },
    request: (op, payload, timeoutMs) =>
      deps.channel.request(op, payload, timeoutMs),
  };
}

// ── 일 보내기 ─────────────────────────────────────────────────────────

export type ContextCheckEnvironment = {
  appCommands: ContextCheckRequest["app_commands"];
  externalTypes: ContextCheckRequest["external_types"];
};

export type ContextsDispatchDeps = {
  process: ContextsProcess;
  // reader Worker의 내부 read `context.work_input`
  readInput(
    input: { context: string; check?: string; bundle?: string },
  ): Promise<
    Result<ContextWorkInput>
  >;
  // 좁은 machine 자격으로 command를 낸다.
  command(envelope: CommandEnvelope): Promise<Result<unknown>>;
  // 검사 환경 중 core가 모르는 것: 앱 쪽이 알려 주는 앱 read 명령의 효과, 다른 context가 내놓는 public
  // type(그 참조 형식은 아직 정해지지 않았다). 없으면 알려 줄 것이 없는 것이라 앱 데이터 type이나 다른
  // context 참조가 든 판은 검사를 통과하지 못한다.
  environment?(): Promise<ContextCheckEnvironment>;
  // scan을 위해 읽은 입력을 알린다. 변화 감시(contexts-watch.ts)가 감시 폴더를 이 입력에 맞춘다.
  observed?(input: ContextWorkInput): void;
  // 활성 context와 아직 도는 검사의 목록(`context.work_list`). `recover`가 읽는다.
  list?(): Promise<Result<ContextWorkList>>;
  // 단조 시계(ms). 기한과 2초 규칙만 쓴다.
  nowMs(): number;
  sleep?(ms: number): Promise<void>;
  log?(message: string): void;
};

export type ContextsDispatcher = {
  // 읽기 전에 부른다. stale이 true면 기한 안에 따라잡지 못해 있던 index로 답한다.
  // `force`는 2초 규칙과 이미 도는 scan을 건너뛴다(변화 신호는 도는 scan이 시작된 뒤의 변화일 수 있다).
  ensureFresh(
    context: string,
    options?: { force?: boolean },
  ): Promise<{ stale: boolean }>;
  // bundle.submit이 받아들인 검사를 worker에 보낸다. 끝날 때까지(재시도 포함) 기다린다. 같은 check가
  // 이미 보내지는 중이면 그 결과를 기다린다.
  runCheck(input: { context: string; check: string }): Promise<boolean>;
  // core가 시작할 때 부른다: 결과를 받지 못해 아직 도는 검사(checking으로 남은 후보)를 다시 보낸다.
  // 보낸 검사 수를 돌려준다. 목록을 읽지 못하면 0이고 다음 시작이 다시 시도한다.
  recover(): Promise<number>;
  // `context.preview`: 만드는 중인 판을 지금 파일에 돌려 한 page를 돌려준다. 결과를 온전히 만들지 못하면
  // 부분 결과 없이 unavailable이다. 판단·파일·ledger·index는 바꾸지 않는다.
  preview(
    input: { context: string; bundle: string; cursor?: string },
  ): Promise<Result<ContextPreviewRead>>;
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createContextsDispatcher(
  deps: ContextsDispatchDeps,
): ContextsDispatcher {
  const sleep = deps.sleep ?? wait;
  const inflight = new Map<string, Promise<boolean>>();
  const finished = new Map<string, number>();

  // worker가 답에 실은 command 하나를 요청과 맞는지 보고 낸다.
  async function relay(
    submission: ContextSubmission,
    expect: { context: string; bundle_hash: string; check?: string },
  ): Promise<Result<unknown>> {
    if (submission.command === "context.record_violations") {
      const input = submission.input;
      if (
        input.context !== expect.context ||
        input.bundle_hash !== expect.bundle_hash
      ) {
        return err({
          code: "forbidden",
          message: "the submission does not belong to the request",
        });
      }
      return await deps.command({
        command: submission.command,
        input,
        // 같은 기록이 응답 유실로 다시 와도 한 번만 반영된다. 위반 수가 같아졌다면 command가 conflict로 거절한다.
        idempotency_key: `context-worker/record/${crypto.randomUUID()}`,
        compare: {},
        prepared: [],
      });
    }
    const input = submission.input;
    if (
      expect.check === undefined || input.check !== expect.check ||
      input.bundle_hash !== expect.bundle_hash
    ) {
      return err({
        code: "forbidden",
        message: "the submission does not belong to the request",
      });
    }
    return await deps.command({
      command: submission.command,
      input,
      idempotency_key:
        `context-worker/finish/${input.check}/${input.snapshot_hash}/${input.result}`,
      compare: {},
      prepared: [],
    });
  }

  async function scan(context: string): Promise<boolean> {
    const read = await deps.readInput({ context });
    if (!read.ok) return false;
    const input = read.value;
    deps.observed?.(input);
    // 만드는 중이거나 보관된 context는 훑지 않는다.
    if (input.applied === null) return true;
    if (!(await deps.process.ensure(input.roots))) return false;
    const answered = await deps.process.request(
      CONTEXT_WORK_OPS.index,
      {
        context,
        bundle: input.applied.content,
        bundle_hash: input.applied.bundle_hash,
        recorded_count: input.recorded_count,
        roots: input.roots,
      },
      CONTEXT_INDEX_TIMEOUT_MS,
    );
    if (!answered.ok) return false;
    const parsed = contextIndexResponseSchema.safeParse(answered.value);
    if (!parsed.success) return false;
    for (const submission of parsed.data.submissions) {
      const related = await relay(submission, {
        context,
        bundle_hash: input.applied.bundle_hash,
      });
      // 위반 수가 이미 같아졌거나 그 사이 판이 바뀐 conflict는 다음 scan이 맞춘다.
      if (!related.ok && related.error.code !== "conflict") {
        deps.log?.(
          `context.record_violations: ${related.error.code}: ${related.error.message}`,
        );
      }
    }
    return true;
  }

  async function ensureFresh(
    context: string,
    options?: { force?: boolean },
  ): Promise<{ stale: boolean }> {
    if (options?.force) {
      finished.delete(context);
      const running = inflight.get(context);
      if (running !== undefined) await running;
    }
    const last = finished.get(context);
    if (last !== undefined && deps.nowMs() - last < CONTEXT_INDEX_FRESH_MS) {
      return { stale: false };
    }
    let run = inflight.get(context);
    if (run === undefined) {
      const started = scan(context).catch(() => false);
      run = started.then((done) => {
        inflight.delete(context);
        if (done) finished.set(context, deps.nowMs());
        return done;
      });
      inflight.set(context, run);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), CONTEXT_INDEX_DEADLINE_MS);
    });
    try {
      const outcome = await Promise.race([run, late]);
      return { stale: outcome === "late" || outcome === false };
    } finally {
      clearTimeout(timer);
    }
  }

  async function checkOnce(
    input: { context: string; check: string },
  ): Promise<Result<boolean>> {
    const read = await deps.readInput(input);
    if (!read.ok) return read;
    const candidate = read.value.candidate;
    // 이미 결과가 났거나 판이 바뀐 검사는 보낼 것이 없다.
    if (candidate === null) return ok(false);
    if (!(await deps.process.ensure(read.value.roots))) {
      return err({ code: "unavailable", message: "context worker is down" });
    }
    const environment = await deps.environment?.() ??
      { appCommands: [], externalTypes: [] };
    const answered = await deps.process.request(
      CONTEXT_WORK_OPS.check,
      {
        context: input.context,
        check: input.check,
        bundle: candidate.content,
        bundle_hash: candidate.bundle_hash,
        roots: read.value.roots,
        user_saved_views: read.value.user_saved_views,
        external_types: [
          ...read.value.external_types,
          ...environment.externalTypes,
        ],
        app_commands: environment.appCommands,
      },
      CONTEXT_CHECK_TIMEOUT_MS,
    );
    if (!answered.ok) return answered;
    const parsed = contextCheckResponseSchema.safeParse(answered.value);
    if (!parsed.success) {
      return err({ code: "internal", message: "invalid check answer" });
    }
    if (parsed.data.submissions.length === 0) {
      return err({ code: "internal", message: "the check gave no result" });
    }
    for (const submission of parsed.data.submissions) {
      const related = await relay(submission, {
        context: input.context,
        bundle_hash: candidate.bundle_hash,
        check: input.check,
      });
      if (!related.ok) return related;
    }
    return ok(parsed.data.status === "passed");
  }

  const checking = new Map<string, Promise<boolean>>();

  function runCheck(
    input: { context: string; check: string },
  ): Promise<boolean> {
    const running = checking.get(input.check);
    if (running !== undefined) return running;
    const run = sendCheck(input);
    checking.set(input.check, run);
    const done = () => checking.delete(input.check);
    run.then(done, done);
    return run;
  }

  async function sendCheck(
    input: { context: string; check: string },
  ): Promise<boolean> {
    for (let attempt = 0;; attempt++) {
      const done = await checkOnce(input).catch((): Result<boolean> =>
        err({ code: "unavailable", message: "check dispatch failed" })
      );
      if (done.ok) {
        if (done.value) {
          // 새 판이 적용됐다. 다음 scan은 모든 파일을 다시 extract한다. 위반은 사람이 열지 않아도
          // 알려야 하므로 바로 한 번 훑는다(7.7).
          finished.delete(input.context);
          void ensureFresh(input.context);
        }
        return true;
      }
      // 결과 불명은 통과로 꾸미지 않는다. 답이 오지 않은 경우만 다시 보낸다.
      const retry = CONTEXT_CHECK_RETRY_MS[attempt];
      if (done.error.code !== "unavailable" || retry === undefined) {
        deps.log?.(
          `context.check ${input.check}: ${done.error.code}: ${done.error.message}`,
        );
        return false;
      }
      await sleep(retry);
    }
  }

  async function recover(): Promise<number> {
    const listed = await deps.list?.();
    if (listed === undefined) return 0;
    if (!listed.ok) {
      deps.log?.(
        `context.work_list: ${listed.error.code}: ${listed.error.message}`,
      );
      return 0;
    }
    const sent = listed.value.checks;
    await Promise.all(
      sent.map(({ context, check }) => runCheck({ context, check })),
    );
    return sent.length;
  }

  async function preview(
    input: { context: string; bundle: string; cursor?: string },
  ): Promise<Result<ContextPreviewRead>> {
    const read = await deps.readInput({
      context: input.context,
      bundle: input.bundle,
    });
    if (!read.ok) return read;
    const draft = read.value.draft;
    if (draft === null) {
      return err({ code: "internal", message: "the draft was not read" });
    }
    // 다른 판의 cursor는 worker를 부르기 전에 거절한다.
    const probed = pagePreview({
      ...input,
      as_of_seq: read.value.as_of_seq,
      outcome: { types: [], findings: [], violation_count: 0, violations: [] },
    });
    if (!probed.ok) return probed;
    if (!(await deps.process.ensure(read.value.roots))) {
      return err({ code: "unavailable", message: "context worker is down" });
    }
    const environment = await deps.environment?.() ??
      { appCommands: [], externalTypes: [] };
    const answered = await deps.process.request(
      CONTEXT_WORK_OPS.preview,
      {
        context: input.context,
        draft: draft.content,
        roots: read.value.roots,
        external_types: [
          ...read.value.external_types,
          ...environment.externalTypes,
        ],
        app_commands: environment.appCommands,
      },
      CONTEXT_PREVIEW_TIMEOUT_MS,
    );
    // 예산 초과, 파일을 읽을 수 없음, worker 중단은 모두 결과를 만들지 못한 것이다.
    if (!answered.ok) {
      return err({
        code: "unavailable",
        message: `the preview could not be made: ${answered.error.message}`,
      });
    }
    const parsed = contextPreviewWorkResponseSchema.safeParse(answered.value);
    if (!parsed.success) {
      return err({ code: "internal", message: "invalid preview answer" });
    }
    return pagePreview({
      ...input,
      as_of_seq: read.value.as_of_seq,
      outcome: parsed.data,
    });
  }

  return {
    ensureFresh,
    runCheck,
    recover,
    preview: (input) =>
      preview(input).catch((): Result<ContextPreviewRead> =>
        err({ code: "unavailable", message: "preview dispatch failed" })
      ),
  };
}

// ── core 연결 ─────────────────────────────────────────────────────────

const INDEXED_READS = [
  contextGetRoute,
  contextOverviewRoute,
  contextSearchRoute,
  contextInputOptionsRoute,
  contextEntityRoute,
  contextSeriesNextRoute,
  contextViolationsRoute,
];

// 요청이 받아들여지기 전에 조립이 시작된다. worker를 띄울 수 있는 core(io 감독이 있는 core)만
// `attach`로 dispatcher를 붙이고, 붙기 전에는 읽기도 submit도 그대로 지나간다.
export type ContextsHost = {
  attach(dispatcher: ContextsDispatcher): void;
  // index를 읽는 읽기 앞에 따라잡기를 끼우고, context.preview를 worker로 답하게 덮는다.
  overlayReads(reads: Map<string, ReadHandler>): void;
  // bundle.submit이 받아들여지면 검사를 worker에 보낸다.
  wrapWriter(writer: Writer): Writer;
  // 받아들여진 command마다 부른다(변화 감시가 감시 폴더를 다시 정하는 계기). 돌려받은 함수로 뺀다.
  onAccepted(listener: (command: string, input: unknown) => void): () => void;
};

function contextOfInput(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const context = (input as Record<string, unknown>)["context"];
  return typeof context === "string" && /^ctx_[0-9a-z]{26}$/.test(context)
    ? context
    : undefined;
}

export function createContextsHost(): ContextsHost {
  let dispatcher: ContextsDispatcher | undefined;
  const listeners = new Set<(command: string, input: unknown) => void>();
  return {
    attach(next) {
      dispatcher = next;
    },
    onAccepted(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    overlayReads(reads) {
      for (const route of INDEXED_READS) {
        const key = `${route.resource}/${route.method}`;
        const original = reads.get(key);
        if (original === undefined) continue;
        reads.set(key, async (ctx, input, credential) => {
          const context = contextOfInput(input);
          if (context !== undefined) await dispatcher?.ensureFresh(context);
          return await original(ctx, input, credential);
        });
      }
      // context.preview는 ledger가 아니라 worker가 답한다. 덮기 전(worker가 없는 조립)은 ledger 쪽
      // 자리가 unavailable로 답한다.
      const previewKey =
        `${contextPreviewRoute.resource}/${contextPreviewRoute.method}`;
      const placeholder = reads.get(previewKey);
      if (placeholder !== undefined) {
        reads.set(previewKey, async (ctx, input, credential) => {
          const asked = contextPreviewRoute.input.safeParse(input);
          if (dispatcher === undefined || !asked.success) {
            return await placeholder(ctx, input, credential);
          }
          // 읽는 쪽 검사(user와 lophn agent만)는 ledger 쪽 자리와 같다.
          const kind = parseActor(ctx.actor)?.kind;
          if (kind !== "user" && kind !== "agent") {
            return err({
              code: "forbidden",
              message: `${kind ?? "unknown"} cannot read contexts`,
            });
          }
          return await dispatcher.preview(asked.data);
        });
      }
    },
    wrapWriter(writer) {
      return {
        ...writer,
        async command(ctx, envelope) {
          const result = await writer.command(ctx, envelope);
          if (result.ok) {
            for (const listener of [...listeners]) {
              try {
                listener(envelope.command, envelope.input);
              } catch { /* 듣는 쪽의 오류가 command 결과를 바꾸지 않는다 */ }
            }
          }
          if (result.ok && envelope.command === bundleSubmitRoute.name) {
            const summary = result.value.result as
              | { context?: unknown; check?: unknown }
              | undefined;
            if (
              typeof summary?.context === "string" &&
              typeof summary.check === "string"
            ) {
              // 사람은 검사가 끝나기를 기다리지 않는다. 결과는 판 상태로 읽는다.
              void dispatcher?.runCheck({
                context: summary.context,
                check: summary.check,
              });
            }
          }
          return result;
        },
      };
    },
  };
}
