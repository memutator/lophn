import {
  type Clock,
  err,
  fingerprint,
  ok,
  type Result,
} from "../../../base/mod.ts";
import type { IdSource } from "../../../base/mod.ts";
import type {
  AppApiTarget,
  ProcessCallRequest,
  ToolCallInput,
  ToolCallOutput,
  ToolDenial,
} from "../../../protocol/apps/calls/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { Approvals } from "../../approvals/ports.ts";
import type {
  AppApiCallPath,
  AppApiLookup,
  AppIntake,
  AppProcessLink,
  CallerDirectory,
  InvocationLedger,
} from "../ports.ts";
import { CALL_BODY_MAX_BYTES } from "../runtime/entrypoint/limits.ts";
import { type CallAuth, type VerifiedCaller, verifyCaller } from "./caller.ts";
import { appApiIntent, askGate } from "./gate.ts";
import {
  createIntake,
  type Flight,
  systemTimers,
  type Timers,
} from "./intake.ts";
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

export type AppCallsDeps = {
  callers: CallerDirectory;
  lookup: AppApiLookup;
  apps: AppStates;
  ledger: InvocationLedger;
  link: AppProcessLink;
  approvals: Approvals;
  clock: Clock;
  ids: IdSource;
  timers?: Timers;
};

const DENIAL_MESSAGES: Record<ToolDenial["code"], string> = {
  gate_blocked: "the call is not granted",
  rejected: "the person rejected the call",
  cancelled: "the request was cancelled",
  call_loop: "the app is already in the call chain",
  call_too_deep: "the call chain is too deep",
  app_archived: "the app is archived",
  app_unavailable: "the app is not running",
  not_declared: "the app does not declare this app-api",
};

type Phase = "gate" | "queued" | "sent";

export function createAppCalls(
  deps: AppCallsDeps,
): { path: AppApiCallPath; intake: AppIntake } {
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

  function requestOf(
    input: ToolCallInput,
    base: CallRecordBase,
  ): ProcessCallRequest {
    return {
      invocation: base.id,
      api: input.tool,
      ...(input.input === undefined ? {} : { input: input.input }),
      context: {
        app: base.app,
        release: base.mode === "live" ? base.release : null,
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
    const verified = verifyCaller(input, auth, {
      callers: deps.callers,
      activeRelease: deps.apps.activeRelease,
      flight: intake.flight,
    });
    if (!verified.ok) return verified;
    const caller = verified.value;

    const target = input.target;
    const app = target.app as Id<"app">;
    const live = target.mode === "live";
    if (live) await intake.admit(app);

    const archived = deps.apps.archived(app);
    if (!archived.ok) return archived;
    if (archived.value) return ok(denied("app_archived", null));

    const found = deps.lookup.find(
      app,
      live ? target.release as Id<"rel"> | null : null,
      input.tool,
    );
    if (!found.ok) return found;
    if (found.value === null) return ok(denied("not_declared", null));
    const { release, effect } = found.value;

    const base: CallRecordBase = {
      id: deps.ids.newId("inv") as Id<"inv">,
      app,
      release,
      mode: target.mode,
      operation: { kind: "tool", tool: input.tool },
      caller: input.caller,
      effect,
      input_hash: await fingerprint(input.input ?? null),
    };

    const parent = caller.kind === "app" ? caller.parent : null;
    const refused = checkCallChain(
      app,
      intake.chainApps(parent === null ? null : parent.id),
    );
    if (refused !== null) return recordDenied(base, refused);

    // 큰 입력은 control frame에 담기지 않는다. 다시 해도 안 되므로 기록·Gate·줄 앞에서 거절한다.
    const bytes = new TextEncoder().encode(
      JSON.stringify(requestOf(input, base)),
    ).length;
    if (bytes > CALL_BODY_MAX_BYTES) {
      return err({
        code: "invalid_input",
        message: "call body exceeds the size limit",
      });
    }

    return run(input, caller, base, target);
  }

  // 여기부터 호출은 도는 호출이다. drain이 기다리고 abandon이 닫는다.
  async function run(
    input: ToolCallInput,
    caller: VerifiedCaller,
    base: CallRecordBase,
    target: AppApiTarget,
  ): Promise<Result<ToolCallOutput>> {
    const app = base.app;
    const live = target.mode === "live";
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
      mode: target.mode,
      parent: caller.kind === "app" ? caller.parent.id : null,
      async abandon() {
        abandoned = true;
        if (phase !== "sent") {
          forced(await recordDenied(base, "app_unavailable"));
          return;
        }
        forced(await closeUnknown(base, startedAt));
      },
    };

    let consume: (() => Promise<Result<void>>) | null = null;

    // 본 일이 끝난 뒤에 abandon이 닫았으면 null이다. 이미 부른 쪽에 결과가 갔다.
    async function work(): Promise<Result<ToolCallOutput> | null> {
      if (caller.kind !== "person") {
        const intent = appApiIntent(
          caller,
          { app, api: input.tool },
          base.effect,
          input.input,
        );
        const gated = await askGate(deps.approvals, intent);
        if (abandoned) return null;
        if (!gated.ok) return gated;
        if (!gated.value.pass) return recordDenied(base, gated.value.code);
        // 사람을 기다리는 Gate는 줄을 얻기 전에 끝내고, 허락은 줄을 얻은 뒤 실행 직전에 쓴다.
        // 사람 대기가 앱의 write 줄을 막지 않게 하려는 순서라 둘을 합치지 않는다.
        consume = gated.value.consume;
      }

      // write와 external은 앱마다 줄을 선다. read는 바로 간다.
      if (base.effect === "read") return execute(false);
      if (!live) return execute(true);
      phase = "queued";
      const release = await queue.acquire(app);
      if (release === null || abandoned) return null;
      try {
        return await execute(true);
      } finally {
        release();
      }
    }

    const processTarget: AppApiTarget = live
      ? { mode: "live", app, release: base.release }
      : target;

    async function execute(
      record: boolean,
    ): Promise<Result<ToolCallOutput> | null> {
      if (consume !== null) {
        const used = await consume();
        if (abandoned) return null;
        if (!used.ok) return recordDenied(base, "gate_blocked");
      }
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
        const closed = await deps.ledger.finish(base.id, {
          status: settled.status,
          finished_at: deps.clock.now(),
          summary: settled.summary,
          detail_hash: null,
          changeset: decodeChangeset(sent.response),
        });
        if (!closed.ok) return closed;
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
    const closed = base.effect === "read"
      ? await deps.ledger.recordOnce(closedRow(base, {
        status: "unknown",
        started_at: startedAt,
        finished_at: finishedAt,
        summary: settled.summary,
      }))
      : await deps.ledger.finish(base.id, {
        status: "unknown",
        finished_at: finishedAt,
        summary: settled.summary,
        detail_hash: null,
        changeset: null,
      });
    if (!closed.ok) return closed;
    return ok({ invocation: base.id, outcome: settled.outcome });
  }

  // 실패한 읽기는 시작을 미리 남기지 않았으므로 끝에서 한 번에 남긴다.
  async function settleRead(
    base: CallRecordBase,
    startedAt: string,
    settled: Settled,
  ): Promise<Result<ToolCallOutput>> {
    const recorded = await deps.ledger.recordOnce(closedRow(base, {
      status: settled.status,
      started_at: startedAt,
      finished_at: deps.clock.now(),
      summary: settled.summary,
    }));
    if (!recorded.ok) return recorded;
    return ok({ invocation: base.id, outcome: settled.outcome });
  }

  return { path: { call }, intake };
}
