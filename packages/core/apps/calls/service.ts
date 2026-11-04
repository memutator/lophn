import {
  type Clock,
  err,
  fingerprint,
  ok,
  type Result,
} from "../../../base/mod.ts";
import type { IdSource } from "../../../base/mod.ts";
import type {
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
import { CALL_BODY_MAX_BYTES } from "../runtime/entrypoint/limits.ts";
import { type CallAuth, type VerifiedCaller, verifyCaller } from "./caller.ts";
import { callAllowed, type CallGateDeps } from "./gate.ts";
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

export type AppCallsDeps = CallGateDeps & {
  callers: CallerDirectory;
  lookup: AppToolLookup;
  apps: AppStates;
  ledger: InvocationLedger;
  link: AppProcessLink;
  clock: Clock;
  ids: IdSource;
  timers?: Timers;
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

function forbidden(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

export function createAppCalls(deps: AppCallsDeps): {
  path: AppToolCallPath;
  intake: AppIntake;
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
    const verified = verifyCaller(input, auth, {
      callers: deps.callers,
      activeRelease: deps.apps.activeRelease,
      flight: intake.flight,
    });
    if (!verified.ok) return verified;
    const caller = verified.value;

    const target = input.target;
    const app = target.app as Id<"app">;
    if (target.mode === "live") await intake.admit(app);

    const archived = deps.apps.archived(app);
    if (!archived.ok) return archived;
    if (archived.value) return ok(denied("app_archived", null));

    if (target.mode === "preview") return callPreview(input, target);

    const found = deps.lookup.find(
      app,
      target.release as Id<"rel"> | null,
      input.kind,
      input.name,
    );
    if (!found.ok) return found;
    if (found.value === null) return ok(denied("not_declared", null));
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
    if (input.kind === "operation" && caller.kind !== "person") {
      return recordDenied(base, "gate_blocked");
    }

    const parent = caller.kind === "app" ? caller.parent : null;
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
  // 부른 쪽은 사람이나 그 앱 place의 session이다(verifyCaller). Gate도 줄도 기록도 없다.
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

  return { path: { call }, intake };
}
