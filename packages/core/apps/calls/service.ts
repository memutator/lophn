import { type Clock, fingerprint, ok, type Result } from "../../../base/mod.ts";
import type { IdSource } from "../../../base/mod.ts";
import type {
  AppApiCallInput,
  AppApiCallOutput,
  AppApiDenial,
  AppApiTarget,
  ProcessCallRequest,
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
  ProjectDirectory,
} from "../ports.ts";
import { type CallAuth, type VerifiedCaller, verifyCaller } from "./caller.ts";
import { appApiIntent, askGate } from "./gate.ts";
import {
  createIntake,
  type Flight,
  systemTimers,
  type Timers,
} from "./intake.ts";
import { checkCallChain } from "./loop.ts";
import { pickProject } from "./project.ts";
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
  projects: ProjectDirectory;
  lookup: AppApiLookup;
  apps: AppStates;
  ledger: InvocationLedger;
  link: AppProcessLink;
  approvals: Approvals;
  clock: Clock;
  ids: IdSource;
  timers?: Timers;
};

const DENIAL_MESSAGES: Record<AppApiDenial["code"], string> = {
  gate_blocked: "the call is not granted",
  rejected: "the person rejected the call",
  cancelled: "the request was cancelled",
  call_loop: "the app is already in the call chain",
  call_too_deep: "the call chain is too deep",
  project_required: "this app-api needs a project",
  project_mismatch: "the project does not fit this call",
  project_not_found: "the project does not exist",
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
    code: AppApiDenial["code"],
    invocation: Id<"inv"> | null,
  ): AppApiCallOutput {
    return { invocation, outcome: deniedOutcome(code, DENIAL_MESSAGES[code]) };
  }

  // handler까지 가지 못한 호출을 한 번에 남긴다.
  async function recordDenied(
    base: CallRecordBase,
    code: AppApiDenial["code"],
  ): Promise<Result<AppApiCallOutput>> {
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

  async function call(
    input: AppApiCallInput,
    auth: CallAuth,
  ): Promise<Result<AppApiCallOutput>> {
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
      input.api,
    );
    if (!found.ok) return found;
    if (found.value === null) return ok(denied("not_declared", null));
    const { release, effect, project_scope: scoped } = found.value;

    const base: CallRecordBase = {
      id: deps.ids.newId("inv") as Id<"inv">,
      app,
      release,
      mode: target.mode,
      operation: { kind: "api", api: input.api },
      caller: input.caller,
      project: null,
      effect,
      input_hash: await fingerprint(input.input ?? null),
    };

    const picked = pickProject(
      scoped,
      input.project as Id<"prj"> | null | undefined,
      caller.kind === "agent"
        ? { kind: "agent", place: caller.place }
        : caller.kind === "app"
        ? { kind: "app", project: caller.parent.project }
        : { kind: "person" },
    );
    if (!picked.ok) return recordDenied(base, picked.code);
    base.project = picked.project;
    if (picked.project !== null) {
      const project = deps.projects.get(picked.project);
      if (!project.ok) return project;
      if (project.value === null) {
        return recordDenied(base, "project_not_found");
      }
    }

    const parent = caller.kind === "app" ? caller.parent : null;
    const refused = checkCallChain(
      app,
      intake.chainApps(parent === null ? null : parent.id),
    );
    if (refused !== null) return recordDenied(base, refused);

    return run(input, caller, base, target);
  }

  // 여기부터 호출은 도는 호출이다. drain이 기다리고 abandon이 닫는다.
  async function run(
    input: AppApiCallInput,
    caller: VerifiedCaller,
    base: CallRecordBase,
    target: AppApiTarget,
  ): Promise<Result<AppApiCallOutput>> {
    const app = base.app;
    const live = target.mode === "live";
    let phase: Phase = "gate";
    let startedAt = deps.clock.now();
    let abandoned = false;
    let forced!: (result: Result<AppApiCallOutput>) => void;
    const forcedResult = new Promise<Result<AppApiCallOutput>>((resolve) => {
      forced = resolve;
    });

    const flight: Flight = {
      id: base.id,
      app,
      release: base.release,
      mode: target.mode,
      parent: caller.kind === "app" ? caller.parent.id : null,
      project: base.project,
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
    async function work(): Promise<Result<AppApiCallOutput> | null> {
      if (caller.kind !== "person") {
        const intent = appApiIntent(
          caller,
          { app, api: input.api },
          base.effect,
          input.input,
        );
        const gated = await askGate(deps.approvals, intent);
        if (abandoned) return null;
        if (!gated.ok) return gated;
        if (!gated.value.pass) return recordDenied(base, gated.value.code);
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
    ): Promise<Result<AppApiCallOutput> | null> {
      if (consume !== null) {
        const used = await consume();
        if (abandoned) return null;
        if (!used.ok) return recordDenied(base, "gate_blocked");
      }
      startedAt = deps.clock.now();
      if (record) {
        const begun = deps.ledger.begin({ ...base, started_at: startedAt });
        if (!begun.ok) return begun;
      }
      phase = "sent";
      const request: ProcessCallRequest = {
        invocation: base.id,
        api: input.api,
        ...(input.input === undefined ? {} : { input: input.input }),
        context: {
          app,
          release: live ? base.release : null,
          mode: base.mode,
          project: base.project,
          effect: base.effect,
          caller: input.caller,
        },
      };
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
  ): Promise<Result<AppApiCallOutput>> {
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
  ): Promise<Result<AppApiCallOutput>> {
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
