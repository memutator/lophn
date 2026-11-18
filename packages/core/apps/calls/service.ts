import { Buffer } from "node:buffer";
import {
  type Clock,
  err,
  fingerprint,
  type LophnError,
  ok,
  type Result,
} from "../../../base/mod.ts";
import type { IdSource } from "../../../base/mod.ts";
import type {
  AppInvocation,
  AppToolCaller,
  AppToolTarget,
  ProcessCallRequest,
  ToolCallInput,
  ToolCallOutput,
  ToolDenial,
} from "../../../protocol/apps/calls/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  AppIntake,
  AppProcessLink,
  AppToolCallPath,
  AppToolLookup,
  CallerDirectory,
  InvocationLedger,
} from "../ports.ts";
import {
  CALL_BODY_MAX_BYTES,
  SYNC_APPLY_MAX_BYTES,
  SYNC_APPLY_MAX_CHANGES,
} from "../runtime/entrypoint/limits.ts";
import type { FolderApply, FolderChange } from "../../folder/ports.ts";
import {
  heldInData,
  type PhoneChange,
  type SyncLog,
  type SyncLogRow,
} from "../sync/log.ts";
import { type CallAuth, type VerifiedCaller, verifyCaller } from "./caller.ts";
import { callAllowed, type CallGateDeps } from "./gate.ts";
import {
  createIntake,
  type Flight,
  systemTimers,
  type Timers,
} from "./intake.ts";
import type { RemoteForward } from "./forward.ts";
import { checkCallChain } from "./loop.ts";
import { createWriteQueue } from "./queue.ts";
import {
  type CallRecordBase,
  closedRow,
  decodeChangeset,
  deniedOutcome,
  deniedSummary,
  type Settled,
  settleResponse,
  unknownSettled,
} from "./record.ts";

// 앱의 상태. 활성 release와 보관 여부는 이 서비스가 모른다(조립이 앱 module의 읽기를 끼운다).
export interface AppStates {
  /** 지금 활성 release. 앱이 없거나 활성 release가 없으면 null. */
  activeRelease(app: Id<"app">): Result<Id<"rel"> | null>;
  archived(app: Id<"app">): Result<boolean>;
}

export type AppCallsDeps = CallGateDeps & {
  callers: CallerDirectory;
  lookup: AppToolLookup;
  apps: AppStates;
  ledger: InvocationLedger;
  link: AppProcessLink;
  clock: Clock;
  ids: IdSource;
  // 다른 기계의 앱 command로 넘긴다(`target.mode` remote).
  forward: RemoteForward;
  timers?: Timers;
  // sync 앱의 sync log. 없으면 폰이나 다른 기계에서 온 변경을 받지 않는다.
  sync?: SyncCalls;
  // 폰이나 다른 기계에서 온 변경이 그 앱 DB를 바꾼 뒤 적용 묶음 하나에 한 번 부른다(앱에 `data.changed`를 낸다).
  dataChanged?(app: Id<"app">): void;
};

// 호출 길이 쓰는 sync log의 면: 기록하기와 held 줄 풀기.
type SyncCalls = Pick<
  SyncLog,
  | "duplicate"
  | "duplicateFrom"
  | "written"
  | "unknown"
  | "phone"
  | "machine"
  | "merged"
  | "held"
  | "heldList"
  | "resolve"
  | "readChangeset"
>;

// 받은 변경에 주인의 operation 이름이 없을 때(앱 시작, rewind)와 core가 앱 DB를 바꾸는 일의 invocation 이름.
const SYNC_OPERATION = "lophn.sync";
const SNAPSHOT_MERGE_OPERATION = "lophn.snapshot_merge";
const HELD_APPLY_OPERATION = "lophn.sync_held_apply";

/** 정리된 흔적과 부딪어 적용하지 않은 변경(sync log의 held 줄)을 보고 푸는 길. 저절로 풀리지 않는다. */
export type SyncHeld = {
  /** 풀리지 않은 held 줄을 seq 순서로. */
  list(app: Id<"app">): Result<SyncLogRow[]>;
  /**
   * 사람의 다시 정함으로 그 변경을 지금 clock의 이 기계 write로 내보내고 줄을 푼다. invocation 하나(caller는 부른 사람이나
   * agent). 받고 적용하지 않은 변경은 다시 적용하고, 이 기계가 낸 변경(`heldInData`)은 이미 data에 있으니 다시 적용하지 않고
   * 건드린 row·칸의 지금 값을 새 clock으로 내보낸다.
   */
  apply(
    app: Id<"app">,
    seq: number,
    caller: AppToolCaller,
  ): Promise<Result<{ invocation: Id<"inv"> }>>;
  /** 적용하지도 내보내지도 않고 푼다. bytes는 기록에 남는다. `note`는 사람에게 그 뜻을 말한다. */
  discard(app: Id<"app">, seq: number): Result<{ note: string }>;
};

const DISCARD_NOTES = {
  data: "This change was made on this computer and stays in its data here. It is not sent to your other computers as a change. If this computer later sends a full copy of the app's data, the copy carries the current values.",
  received:
    "This change was not applied on this computer. It stays in the record and is not sent anywhere.",
} as const;

// core가 연 invocation 하나와 그 시작 시각.
type Opened = { base: CallRecordBase; startedAt: string };
type Job = { opened: Opened[]; abandoned: boolean };

// 폰에서 온 변경 하나를 컴퓨터에 적용하는 입력. operation과 started_at은 폰이 준 그대로 invocation에 남는다.
export type PhoneApply = {
  app: Id<"app">;
  release: Id<"rel">;
  operation: string;
  started_at: string;
  change: PhoneChange;
};

export type PhoneApplied = {
  status: "applied" | "duplicate" | "skipped";
  seq: number;
};

const DENIAL_MESSAGES: Record<ToolDenial["code"], string> = {
  gate_blocked: "the call is not granted",
  call_loop: "the app is already in the call chain",
  call_too_deep: "the call chain is too deep",
  app_archived: "the app is archived",
  app_unavailable: "the app is not running",
  not_declared: "the app does not declare this operation or command",
};

type Phase = "gate" | "queued" | "sent";

// 앱 호출과 event 전달은 부른 invocation이 있을 수 있고, 그 사슬로 루프·깊이를 본다.
function parentOf(caller: VerifiedCaller): Flight | null {
  return caller.kind === "app" || caller.kind === "event"
    ? caller.parent
    : null;
}

function forbidden(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

export function createAppCalls(deps: AppCallsDeps): {
  path: AppToolCallPath;
  // flight는 도는 호출 하나를 찾고, chainApps는 그 호출부터 위로 올라간 앱 목록이다(event 발행이 부모 invocation을 확인한다).
  intake: AppIntake & {
    flight(id: Id<"inv">): Flight | undefined;
    chainApps(parent: Id<"inv"> | null): Id<"app">[];
  };
  // 폰 sync가 이 앱의 write 줄과 접수를 같이 쓴다(`apps/sync`).
  phone: {
    apply(input: PhoneApply): Promise<Result<PhoneApplied>>;
    // 접수가 열리기를 기다린 뒤 write 줄을 쥔 채 work를 돈다. 줄이 정리되면(abandon) null이다.
    exclusive<T>(app: Id<"app">, work: () => Promise<T>): Promise<T | null>;
  };
  // 폴더에서 읽은 변경과 snapshot을 적용하는 길(folder import가 부른다).
  folder: FolderApply;
  syncHeld: SyncHeld;
} {
  const queue = createWriteQueue();
  const intake = createIntake({
    queue,
    timers: deps.timers ?? systemTimers,
  });

  function denied(
    code: ToolDenial["code"],
    invocation: Id<"inv"> | null,
  ): ToolCallOutput {
    return { invocation, outcome: deniedOutcome(code, DENIAL_MESSAGES[code]) };
  }

  // handler까지 가지 못한 호출을 한 번에 남긴다.
  async function recordDenied(
    base: CallRecordBase,
    code: ToolDenial["code"],
  ): Promise<Result<ToolCallOutput>> {
    const recorded = await deps.ledger.recordOnce(
      closedRow(base, {
        status: "denied",
        started_at: null,
        finished_at: deps.clock.now(),
        summary: deniedSummary(code),
      }),
    );
    if (!recorded.ok) return recorded;
    return ok(denied(code, base.id));
  }

  // preview 호출은 release가 없을 수 있어 기록 base가 아니라 보내는 값만 쥔다.
  type RequestBase = Pick<CallRecordBase, "id" | "app" | "mode" | "effect"> & {
    release: Id<"rel"> | null;
  };

  function requestOf(
    input: ToolCallInput,
    base: RequestBase,
  ): ProcessCallRequest {
    return {
      invocation: base.id,
      kind: input.kind,
      name: input.name,
      ...(input.input === undefined ? {} : { input: input.input }),
      context: {
        app: base.app,
        release: base.release,
        mode: base.mode,
        effect: base.effect,
        caller: input.caller,
      },
    };
  }

  async function call(
    input: ToolCallInput,
    auth: CallAuth,
  ): Promise<Result<ToolCallOutput>> {
    // preview만 부르는 credential이 live로 새면 안 된다. 어떤 조회보다 앞에서 막는다.
    if (auth.previewOnly) {
      if (input.caller.kind !== "person") {
        return forbidden("only a person can use a previews-only credential");
      }
      if (input.target.mode === "live") {
        return forbidden("this credential calls previews only");
      }
    }
    // 기기나 다른 기계가 붙은 person은 맞춰진 변경을 적을 때 core만 만든다.
    if (
      input.caller.kind === "person" &&
      (input.caller.device !== undefined || input.caller.machine !== undefined)
    ) {
      return forbidden("a call cannot claim a device or a machine");
    }
    const verified = verifyCaller(input, auth, {
      callers: deps.callers,
      activeRelease: deps.apps.activeRelease,
      flight: intake.flight,
    });
    if (!verified.ok) return verified;
    const caller = verified.value;

    const target = input.target;
    // 다른 기계의 앱은 command만, agent와 앱만 부른다(사람의 화면과 터미널은 `machines/call`로 간다). 이 기계의 앱처럼 조회·기록하지 않는다.
    if (target.mode === "remote") {
      if (
        input.kind !== "command" ||
        (caller.kind !== "agent" && caller.kind !== "app")
      ) {
        return forbidden(
          "only an agent or an app calls a command on another machine",
        );
      }
      // 받은 call은 다른 기계로 다시 넘기지 않는다. 받은 call을 돌리는 중인 이 기계의 앱(부모 호출이 remote)이 또 다른 기계를 부르는 길도 같다.
      if (caller.kind === "app" && caller.parent.remote) {
        return forbidden("a received remote call is not forwarded again");
      }
      return deps.forward({
        caller,
        target: { machine: target.machine, app: target.app as Id<"app"> },
        name: input.name,
        input: input.input,
      });
    }
    const app = target.app as Id<"app">;
    if (target.mode === "live") await intake.admit(app);

    const archived = deps.apps.archived(app);
    if (!archived.ok) return archived;
    if (archived.value) {
      // archived 앱은 agent와 다른 컴퓨터에게 없는 앱과 같다. 사람(화면)은 그대로 app_archived다.
      return auth.actor === "agent" || auth.actor === "remote"
        ? err({ code: "not_found", message: "app not found" })
        : ok(denied("app_archived", null));
    }

    if (target.mode === "preview") return callPreview(input, target);

    const found = deps.lookup.find(
      app,
      target.release as Id<"rel"> | null,
      input.kind,
      input.name,
    );
    if (!found.ok) return found;
    if (found.value === null) return ok(denied("not_declared", null));
    // 구독 handler는 event 전달만 부른다. 사람이나 다른 caller가 이름으로 부르면 선언에 없는 것과 같다.
    if (found.value.subscription && caller.kind !== "event") {
      return ok(denied("not_declared", null));
    }
    const { release, effect } = found.value;
    const declared = { public: found.value.public };

    const base: CallRecordBase = {
      id: deps.ids.newId("inv") as Id<"inv">,
      app,
      release,
      mode: target.mode,
      operation: { kind: input.kind, name: input.name },
      caller: input.caller,
      effect,
      input_hash: await fingerprint(input.input ?? null),
    };

    // operation은 사람(화면)만 부른다. 다른 caller는 handler에 보내기 전에 막는다.
    // 예외는 event 전달이다. 구독 handler는 core가 이름을 정해 부른다(`lookups.ts`가 구독 handler만 operation으로 찾아 준다).
    if (
      input.kind === "operation" &&
      caller.kind !== "person" &&
      caller.kind !== "event"
    ) {
      return recordDenied(base, "gate_blocked");
    }

    const parent = parentOf(caller);
    const refused = checkCallChain(
      app,
      intake.chainApps(parent === null ? null : parent.id),
    );
    if (refused !== null) return recordDenied(base, refused);

    const tooBig = checkSize(input, base);
    if (tooBig !== null) return tooBig;

    return run(input, caller, base, declared);
  }

  // 큰 입력은 control frame에 담기지 않는다. 다시 해도 안 되므로 기록·Gate·줄 앞에서 거절한다.
  function checkSize(
    input: ToolCallInput,
    base: RequestBase,
  ): Result<never> | null {
    const bytes = new TextEncoder().encode(
      JSON.stringify(requestOf(input, base)),
    ).length;
    if (bytes <= CALL_BODY_MAX_BYTES) return null;
    return err({
      code: "invalid_input",
      message: "call body exceeds the size limit",
    });
  }

  // preview는 일회용 DB라 rewind 대상이 아니고 release가 없을 수 있어 ledger를 쓰지 않는다.
  // 부른 쪽은 사람이나 그 앱 workspace의 session이다(verifyCaller). Gate도 줄도 기록도 없다.
  async function callPreview(
    input: ToolCallInput,
    target: Extract<AppToolTarget, { mode: "preview" }>,
  ): Promise<Result<ToolCallOutput>> {
    const app = target.app as Id<"app">;
    const found = await deps.lookup.findPreview(
      app,
      target.process_nonce,
      input.kind,
      input.name,
    );
    if (!found.ok) return found;
    if (found.value === null) return ok(denied("not_declared", null));
    const base: RequestBase = {
      id: deps.ids.newId("inv") as Id<"inv">,
      app,
      release: null,
      mode: "preview",
      effect: found.value.effect,
    };
    const tooBig = checkSize(input, base);
    if (tooBig !== null) return tooBig;
    const sent = await deps.link.call(target, requestOf(input, base));
    if (!sent.sent) return ok(denied("app_unavailable", null));
    return ok({
      invocation: null,
      outcome: settleResponse(sent.response).outcome,
    });
  }

  // 여기부터 호출은 도는 호출이다. drain이 기다리고 abandon이 닫는다.
  async function run(
    input: ToolCallInput,
    caller: VerifiedCaller,
    base: CallRecordBase,
    declared: { public: boolean },
  ): Promise<Result<ToolCallOutput>> {
    const app = base.app;
    let phase: Phase = "gate";
    let startedAt = deps.clock.now();
    let abandoned = false;
    let forced!: (result: Result<ToolCallOutput>) => void;
    const forcedResult = new Promise<Result<ToolCallOutput>>((resolve) => {
      forced = resolve;
    });

    const flight: Flight = {
      id: base.id,
      app,
      release: base.release,
      mode: "live",
      parent: parentOf(caller)?.id ?? null,
      remote: caller.kind === "remote" || (parentOf(caller)?.remote ?? false),
      async abandon() {
        abandoned = true;
        if (phase !== "sent") {
          forced(await recordDenied(base, "app_unavailable"));
          return;
        }
        forced(await closeUnknown(base, startedAt));
      },
    };

    // 본 일이 끝난 뒤에 abandon이 닫았으면 null이다. 이미 부른 쪽에 결과가 갔다.
    async function work(): Promise<Result<ToolCallOutput> | null> {
      if (caller.kind !== "person") {
        const allowed = await callAllowed(
          caller,
          { app, tool: input.name, effect: base.effect, ...declared },
          deps,
        );
        if (abandoned) return null;
        if (!allowed.ok) return allowed;
        if (!allowed.value) return recordDenied(base, "gate_blocked");
      }

      // write와 external은 앱마다 줄을 선다. read는 바로 간다.
      if (base.effect === "read") return execute(false);
      phase = "queued";
      const release = await queue.acquire(app);
      if (release === null || abandoned) return null;
      try {
        return await execute(true);
      } finally {
        release();
      }
    }

    const processTarget: AppToolTarget = {
      mode: "live",
      app,
      release: base.release,
    };

    async function execute(
      record: boolean,
    ): Promise<Result<ToolCallOutput> | null> {
      startedAt = deps.clock.now();
      if (record) {
        const begun = deps.ledger.begin({
          ...base,
          started_at: startedAt,
        });
        if (!begun.ok) return begun;
      }
      phase = "sent";
      const request = requestOf(input, base);
      const sent = await deps.link.call(processTarget, request);
      if (abandoned) return null;

      if (!sent.sent) {
        if (!record) return recordDenied(base, "app_unavailable");
        const closed = await deps.ledger.finish(base.id, {
          status: "failed",
          finished_at: deps.clock.now(),
          summary: deniedSummary("app_unavailable"),
          detail_hash: null,
          changeset: null,
        });
        if (!closed.ok) return closed;
        return ok(denied("app_unavailable", base.id));
      }

      const settled = settleResponse(sent.response);
      if (record) {
        const changeset = decodeChangeset(sent.response);
        const closed = await deps.ledger.finish(base.id, {
          status: settled.status,
          finished_at: deps.clock.now(),
          summary: settled.summary,
          detail_hash: null,
          changeset,
        });
        if (!closed.ok) return closed;
        // 같은 write 줄 안이라 sync log의 순서가 앱 DB에 적용된 순서와 같다.
        if (sent.response === null) await deps.sync?.unknown(closed.value);
        else {
          await deps.sync?.written(closed.value, sent.response.hlc, changeset);
        }
        return ok({ invocation: base.id, outcome: settled.outcome });
      }
      // 성공한 읽기는 기록을 남기지 않는다.
      if (settled.status === "succeeded") {
        return ok({ invocation: null, outcome: settled.outcome });
      }
      return settleRead(base, startedAt, settled);
    }

    intake.enter(flight);
    try {
      const done = await Promise.race([work(), forcedResult]);
      return done === null ? await forcedResult : done;
    } finally {
      intake.leave(base.id);
    }
  }

  // 보냈는데 끝을 보지 못한 호출을 결과 모름으로 닫는다.
  async function closeUnknown(
    base: CallRecordBase,
    startedAt: string,
  ): Promise<Result<ToolCallOutput>> {
    const settled = unknownSettled();
    const finishedAt = deps.clock.now();
    const closed =
      base.effect === "read"
        ? await deps.ledger.recordOnce(
            closedRow(base, {
              status: "unknown",
              started_at: startedAt,
              finished_at: finishedAt,
              summary: settled.summary,
            }),
          )
        : await deps.ledger.finish(base.id, {
            status: "unknown",
            finished_at: finishedAt,
            summary: settled.summary,
            detail_hash: null,
            changeset: null,
          });
    if (!closed.ok) return closed;
    if (base.effect !== "read") await deps.sync?.unknown(closed.value);
    return ok({ invocation: base.id, outcome: settled.outcome });
  }

  // 실패한 읽기는 시작을 미리 남기지 않았으므로 끝에서 한 번에 남긴다.
  async function settleRead(
    base: CallRecordBase,
    startedAt: string,
    settled: Settled,
  ): Promise<Result<ToolCallOutput>> {
    const recorded = await deps.ledger.recordOnce(
      closedRow(base, {
        status: settled.status,
        started_at: startedAt,
        finished_at: deps.clock.now(),
        summary: settled.summary,
      }),
    );
    if (!recorded.ok) return recorded;
    return ok({ invocation: base.id, outcome: settled.outcome });
  }

  async function exclusive<T>(
    app: Id<"app">,
    work: () => Promise<T>,
  ): Promise<T | null> {
    await intake.admit(app);
    const release = await queue.acquire(app);
    if (release === null) return null;
    try {
      return await work();
    } finally {
      release();
    }
  }

  function syncOf(): Result<SyncCalls> {
    return deps.sync === undefined
      ? err({ code: "unavailable", message: "sync is not attached" })
      : ok(deps.sync);
  }

  function activeIs(app: Id<"app">, release: Id<"rel">): Result<void> {
    const active = deps.apps.activeRelease(app);
    if (!active.ok) return active;
    return active.value === release
      ? ok(undefined)
      : err({
          code: "conflict",
          message: "the release is not active",
          details: { active_release: active.value },
        });
  }

  // 받은 쪽 시각이 보낸 쪽보다 뒤처져 있어도 시작이 끝보다 늦게 남지 않는다.
  function finish(
    open: Opened,
    status: "succeeded" | "failed",
    summary: AppInvocation["summary"],
    changeset: Uint8Array | null,
  ): Promise<Result<AppInvocation>> {
    const now = deps.clock.now();
    return deps.ledger.finish(open.base.id, {
      status,
      finished_at: now < open.startedAt ? open.startedAt : now,
      summary,
      detail_hash: null,
      changeset,
    });
  }

  // 앱 process가 받지 못했거나 거절한 일. 연 invocation을 모두 실패로 닫고 그 오류를 준다.
  async function closeFailed(
    opened: readonly Opened[],
    error: LophnError,
  ): Promise<Result<never>> {
    for (const open of opened) {
      const closed = await finish(
        open,
        "failed",
        { outcome: "failed", error_code: error.code },
        null,
      );
      if (!closed.ok) return closed;
    }
    return err(error);
  }

  // 답을 받지 못한 일. 보낸 뒤 잃었으면(relay·supervisor 통로가 `details.sent`를 단다) 앱 process가 한 transaction으로
  // 이미 적용했을 수 있어 결과 모름으로 닫는다. 그래야 그 변경을 모르는 rewind가 범위를 막는다. 보내기 전에 막혔거나 앱이
  // 거절했으면 실패로 닫는다.
  async function closeNotApplied(
    opened: readonly Opened[],
    error: LophnError,
  ): Promise<Result<never>> {
    if (error.details?.["sent"] !== true) return closeFailed(opened, error);
    for (const open of opened) {
      const closed = await closeUnknown(open.base, open.startedAt);
      if (!closed.ok) return closed;
    }
    return err(error);
  }

  function notSync(): LophnError {
    return { code: "invalid_input", message: "the app does not sync its data" };
  }

  function begin(job: Job, base: CallRecordBase, startedAt: string) {
    const begun = deps.ledger.begin({ ...base, started_at: startedAt });
    if (begun.ok) job.opened.push({ base, startedAt });
    return begun;
  }

  // core가 앱 DB를 바꾸는 일 하나(받은 변경, snapshot 합치기, held 다시 적용): 접수를 기다리고 도는 일로 들어 write 줄을
  // 잡은 채 work를 돈다. 그래서 sync log의 순서가 앱 DB에 적용된 순서와 같고 rewind·activation이 끝나기를 기다린다.
  // 도는 중 앱이 멈춰 정리되면(abandon) 연 invocation을 결과 모름으로 닫고 unavailable이다. work는 앱 process의 답을
  // 받은 뒤 `job.abandoned`면 null을 돌려주고, 아니면 `job.opened`를 비우고 스스로 닫는다.
  async function inLane<T>(
    app: Id<"app">,
    release: Id<"rel">,
    work: (job: Job) => Promise<Result<T> | null>,
  ): Promise<Result<T>> {
    await intake.admit(app);
    const job: Job = { opened: [], abandoned: false };
    const unavailable = (): Result<never> =>
      err({ code: "unavailable", message: "the app is not running" });
    let forced!: (result: Result<T>) => void;
    const forcedResult = new Promise<Result<T>>((resolve) => {
      forced = resolve;
    });
    const flight: Flight = {
      id: deps.ids.newId("inv") as Id<"inv">,
      app,
      release,
      mode: "live",
      parent: null,
      remote: false,
      async abandon() {
        job.abandoned = true;
        for (const open of job.opened) {
          await closeUnknown(open.base, open.startedAt);
        }
        forced(unavailable());
      },
    };
    async function run(): Promise<Result<T> | null> {
      const lane = await queue.acquire(app);
      if (lane === null || job.abandoned) return null;
      try {
        return await work(job);
      } finally {
        lane();
      }
    }
    intake.enter(flight);
    try {
      const done = await Promise.race([run(), forcedResult]);
      return done === null ? await forcedResult : done;
    } finally {
      intake.leave(flight.id);
    }
  }

  // 폰에서 온 변경 하나: write 줄 → invocation 시작 → 앱 process가 칸 단위 last-write-wins로 적용 → effective
  // changeset으로 닫기 → sync log 줄. 정리된 흔적과 부딪는 변경은 held 줄로 남기고 폰에는 skipped로 답한다(폰은 그
  // 변경을 outbox에서 지우고, 사람의 변경은 컴퓨터의 held 줄에 남는다).
  async function applyPhone(input: PhoneApply): Promise<Result<PhoneApplied>> {
    const attached = syncOf();
    if (!attached.ok) return attached;
    const sync = attached.value;
    const { app, release, change } = input;
    let changed = false;
    const done = await inLane<PhoneApplied>(app, release, async (job) => {
      const active = activeIs(app, release);
      if (!active.ok) return active;
      const known = sync.duplicate(change.device, change.id);
      if (!known.ok) return known;
      if (known.value !== null) {
        return ok({ status: "duplicate", seq: known.value });
      }
      const base: CallRecordBase = {
        id: deps.ids.newId("inv") as Id<"inv">,
        app,
        release,
        mode: "live",
        operation: { kind: "operation", name: input.operation },
        caller: {
          kind: "person",
          view_session: change.id,
          device: change.device,
        },
        effect: "write",
        input_hash: null,
      };
      const begun = begin(job, base, input.started_at);
      if (!begun.ok) return begun;
      const applied = await deps.link.syncApply(app, {
        changes: [{ hlc: change.hlc, changeset: base64(change.changeset) }],
      });
      if (job.abandoned) return null;
      const [open] = job.opened.splice(0);
      if (!applied.ok) return closeNotApplied([open!], applied.error);
      if (applied.value.status === "not_sync") {
        return closeFailed([open!], notSync());
      }
      const result = applied.value.results[0]!;
      changed = result.status === "applied";
      if (result.status === "held") {
        const closed = await finish(
          open!,
          "failed",
          { outcome: "failed", error_code: "held" },
          null,
        );
        if (!closed.ok) return closed;
        const held = await sync.held(
          app,
          release,
          { origin: "device", ...change },
          "past_horizon",
        );
        if (!held.ok) return held;
        return ok({ status: "skipped", seq: held.value });
      }
      const closed = await finish(
        open!,
        result.status === "applied" ? "succeeded" : "failed",
        result.status === "applied"
          ? { outcome: "succeeded" }
          : { outcome: "failed", error_code: "skipped" },
        result.status === "applied" ? unbase64(result.effective) : null,
      );
      if (!closed.ok) return closed;
      const logged = await sync.phone(closed.value, change, result.status);
      if (!logged.ok) return logged;
      return ok({ status: result.status, seq: logged.value });
    });
    if (changed) deps.dataChanged?.(app);
    return done;
  }

  // 폴더에서 온 변경 file 하나: 이미 받은 변경(같은 기계의 같은 id)은 건너뛰고, 남은 변경마다 invocation을 연 뒤 앱 DB
  // transaction 하나로 적용하고, 변경마다 effective로 닫고 sync log 줄(origin machine)이나 held 줄을 남긴다.
  async function applyChanges(
    input: Parameters<FolderApply["applyChanges"]>[0],
  ): ReturnType<FolderApply["applyChanges"]> {
    const attached = syncOf();
    if (!attached.ok) return attached;
    const sync = attached.value;
    const { app, release, origin, changes } = input;
    const counts = { applied: 0, skipped: 0, duplicate: 0, held: 0 };
    const size = changes.reduce(
      (sum, change) => sum + change.changeset.byteLength,
      0,
    );
    if (
      changes.length > SYNC_APPLY_MAX_CHANGES ||
      size > SYNC_APPLY_MAX_BYTES
    ) {
      return err({
        code: "invalid_input",
        message: "the changes exceed the size limit",
      });
    }
    if (changes.length === 0) return ok(counts);
    let changed = false;
    const done = await inLane(app, release, async (job) => {
      const active = activeIs(app, release);
      if (!active.ok) return active;
      const fresh: FolderChange[] = [];
      for (const change of changes) {
        const known = sync.duplicateFrom(origin, change.id);
        if (!known.ok) return known;
        if (known.value === null) fresh.push(change);
        else counts.duplicate++;
      }
      if (fresh.length === 0) return ok(counts);
      for (const change of fresh) {
        const begun = begin(
          job,
          {
            id: deps.ids.newId("inv") as Id<"inv">,
            app,
            release,
            mode: "live",
            operation: {
              kind: "operation",
              name: change.operation ?? SYNC_OPERATION,
            },
            caller: {
              kind: "person",
              view_session: change.id,
              machine: origin,
            },
            effect: "write",
            input_hash: null,
          },
          change.started_at ?? deps.clock.now(),
        );
        if (!begun.ok) {
          const closed = await closeFailed(job.opened.splice(0), begun.error);
          return closed.ok ? begun : closed;
        }
      }
      const applied = await deps.link.syncApply(app, {
        changes: fresh.map((change) => ({
          hlc: change.hlc,
          changeset: base64(change.changeset),
        })),
      });
      if (job.abandoned) return null;
      const opened = job.opened.splice(0);
      if (!applied.ok) return closeNotApplied(opened, applied.error);
      if (applied.value.status === "not_sync") {
        return closeFailed(opened, notSync());
      }
      // 앱 DB transaction은 이미 끝났다. 뒤 기록이 실패해도 앱은 바뀐 data를 다시 읽어야 한다.
      changed = applied.value.results.some(
        (result) => result.status === "applied",
      );
      for (const [i, result] of applied.value.results.entries()) {
        const change = fresh[i]!;
        const received = {
          machine: origin,
          id: change.id,
          hlc: change.hlc,
          changeset: change.changeset,
        };
        const closed = await finish(
          opened[i]!,
          result.status === "applied" ? "succeeded" : "failed",
          result.status === "applied"
            ? { outcome: "succeeded" }
            : { outcome: "failed", error_code: result.status },
          result.status === "applied" ? unbase64(result.effective) : null,
        );
        if (!closed.ok) return closed;
        const logged =
          result.status === "held"
            ? await sync.held(
                app,
                release,
                { origin: "machine", ...received },
                "past_horizon",
              )
            : await sync.machine(closed.value, received, result.status);
        if (!logged.ok) return logged;
        counts[result.status]++;
      }
      return ok(counts);
    });
    if (changed) deps.dataChanged?.(app);
    return done;
  }

  // 다른 기계의 snapshot 합치기: invocation 하나, 앱 DB transaction 하나. 정리된 흔적과 부딪어 적용하지 않은 row는 held 줄로
  // 남는다. 바뀐 것이 있으면 폰은 새 snapshot을 받는다(합친 변경들의 clock이 하나가 아니라 log 줄 하나로 보낼 수 없다).
  async function mergeSnapshot(
    input: Parameters<FolderApply["mergeSnapshot"]>[0],
  ): ReturnType<FolderApply["mergeSnapshot"]> {
    const attached = syncOf();
    if (!attached.ok) return attached;
    const sync = attached.value;
    const { app, release, origin } = input;
    let changed = false;
    const done = await inLane(app, release, async (job) => {
      const active = activeIs(app, release);
      if (!active.ok) return active;
      const base: CallRecordBase = {
        id: deps.ids.newId("inv") as Id<"inv">,
        app,
        release,
        mode: "live",
        operation: { kind: "operation", name: SNAPSHOT_MERGE_OPERATION },
        caller: {
          kind: "person",
          view_session: `snapshot:${input.n}`,
          machine: origin,
        },
        effect: "write",
        input_hash: null,
      };
      const begun = begin(job, base, deps.clock.now());
      if (!begun.ok) return begun;
      const absent = input.absentDeletes;
      const merged = await deps.link.snapshotMerge(app, {
        path: input.path,
        ...(absent === undefined
          ? {}
          : {
              absent_deletes: {
                below: absent.below,
                keep: absent.keep.map((row) => ({
                  table: row.table,
                  pk: Buffer.from(row.pk, "hex").toString("base64"),
                })),
              },
            }),
      });
      if (job.abandoned) return null;
      const [open] = job.opened.splice(0);
      // 답을 받지 못했으면 합쳐졌을 수 있다: 결과 모름으로 닫아 폰이 새 snapshot을 받게 한다.
      if (!merged.ok) return closeNotApplied([open!], merged.error);
      if (merged.value.status === "not_sync") {
        return closeFailed([open!], notSync());
      }
      const out = merged.value;
      changed = out.effective !== null || out.effective_dropped !== undefined;
      const closed = await finish(
        open!,
        "succeeded",
        out.effective_dropped === undefined
          ? { outcome: "succeeded" }
          : { outcome: "succeeded", changeset_dropped: out.effective_dropped },
        unbase64(out.effective),
      );
      if (!closed.ok) return closed;
      for (const row of out.held) {
        const held = await sync.held(
          app,
          release,
          {
            origin: "machine",
            machine: origin,
            hlc: row.hlc,
            changeset: unbase64(row.changeset)!,
          },
          "past_horizon",
        );
        if (!held.ok) return held;
      }
      if (changed) {
        const marked = await sync.merged(closed.value);
        if (!marked.ok) return marked;
      }
      return ok({ changed, deleted: out.deleted });
    });
    if (changed) deps.dataChanged?.(app);
    return done;
  }

  function heldRow(app: Id<"app">, seq: number): Result<SyncLogRow> {
    const attached = syncOf();
    if (!attached.ok) return attached;
    const row = attached.value.heldList(app).find((one) => one.seq === seq);
    return row === undefined
      ? err({ code: "not_found", message: "no held change has this seq" })
      : ok(row);
  }

  // held 줄의 변경을 지금 clock의 이 기계 write로 내보낸다(사람이나 앱 agent의 다시 정함). 보통 write처럼 sync log에 남아
  // 내보내지고, 그 held 줄은 풀린다. 받은 변경은 다시 적용하고 지금 data와 부딪으면 아무것도 바꾸지 않고 conflict다. 이 기계가
  // 낸 변경은 이미 data에 있어 앱 process가 지금 값을 새 clock으로 찍기만 한다(invocation은 data를 바꾸지 않아 changeset이
  // 없다: rewind가 그것을 되돌리려 하지 않는다).
  async function applyHeld(
    app: Id<"app">,
    seq: number,
    caller: AppToolCaller,
  ): Promise<Result<{ invocation: Id<"inv"> }>> {
    const attached = syncOf();
    if (!attached.ok) return attached;
    const sync = attached.value;
    const row = heldRow(app, seq);
    if (!row.ok) return row;
    const stored = row.value.changeset;
    if (stored === null) {
      return err({
        code: "not_found",
        message: "the held change has no bytes",
      });
    }
    const bytes = await sync.readChangeset(stored.hash, stored.size);
    if (!bytes.ok) return bytes;
    const inData = heldInData(row.value);
    const active = deps.apps.activeRelease(app);
    if (!active.ok) return active;
    if (active.value === null) {
      return err({ code: "not_found", message: "app not found" });
    }
    const release = active.value;
    return inLane(app, release, async (job) => {
      const still = activeIs(app, release);
      if (!still.ok) return still;
      const base: CallRecordBase = {
        id: deps.ids.newId("inv") as Id<"inv">,
        app,
        release,
        mode: "live",
        operation: { kind: "operation", name: HELD_APPLY_OPERATION },
        caller,
        effect: "write",
        input_hash: null,
      };
      const begun = begin(job, base, deps.clock.now());
      if (!begun.ok) return begun;
      const applied = await deps.link.syncReapply(app, {
        changeset: base64(bytes.value),
        ...(inData ? { release: true as const } : {}),
      });
      if (job.abandoned) return null;
      const [open] = job.opened.splice(0);
      if (!applied.ok) return closeNotApplied([open!], applied.error);
      if (applied.value.status === "not_sync") {
        return closeFailed([open!], notSync());
      }
      if (applied.value.status === "conflict") {
        return closeFailed([open!], {
          code: "conflict",
          message: applied.value.message,
        });
      }
      const effective = unbase64(applied.value.effective);
      const closed = await finish(
        open!,
        "succeeded",
        { outcome: "succeeded" },
        inData ? null : effective,
      );
      if (!closed.ok) return closed;
      await sync.written(
        closed.value,
        applied.value.hlc ?? undefined,
        effective,
      );
      const resolved = sync.resolve(seq, deps.clock.now());
      if (!resolved.ok) return resolved;
      return ok({ invocation: base.id });
    });
  }

  const folder: FolderApply = { applyChanges, mergeSnapshot };
  const syncHeld: SyncHeld = {
    list(app) {
      const attached = syncOf();
      return attached.ok ? ok(attached.value.heldList(app)) : attached;
    },
    apply: applyHeld,
    discard(app, seq) {
      const row = heldRow(app, seq);
      if (!row.ok) return row;
      const resolved = deps.sync!.resolve(seq, deps.clock.now());
      if (!resolved.ok) return resolved;
      return ok({
        note: heldInData(row.value)
          ? DISCARD_NOTES.data
          : DISCARD_NOTES.received,
      });
    },
  };

  return {
    path: { call },
    intake,
    phone: { apply: applyPhone, exclusive },
    folder,
    syncHeld,
  };
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function unbase64(text: string | null): Uint8Array | null {
  return text === null ? null : new Uint8Array(Buffer.from(text, "base64"));
}
