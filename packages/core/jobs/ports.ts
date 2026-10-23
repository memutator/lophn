import type { Clock, Result } from "../../base/mod.ts";
import { definePort } from "../../protocol/base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import type {
  AgentRef,
  NamedAgent,
  Place,
} from "../../protocol/lophn-agent/mod.ts";
import type {
  JobRecord,
  JobRunRecord,
  JobTurn,
} from "../../protocol/jobs/mod.ts";

// 시각은 Clock으로 읽고 timer는 이 port로 받는다. 테스트는 가짜를 꽂는다.
export type JobTimers = {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

// IANA 이름이다. 구현은 jobs wiring이 Intl.DateTimeFormat().resolvedOptions().timeZone으로 꽂는다.
export const jobZonePort = definePort<{ zone(): string }>("jobs.zone");

// job을 만들 때 이름을 푸는 port. 구현은 조립(core/main)이 꽂는다.
export type JobTargets = {
  creatorOf(session: Id<"ses">): AgentRef | undefined;
  // coding agent는 invalid_input.
  resolveAgent(
    named: NamedAgent,
  ): Result<{ agent: AgentRef; place: Place | null }>;
  // 없으면 not_found.
  resolveApp(ref: string): Result<Id<"app">>;
  resolveProject(ref: string): Result<Id<"prj">>;
};
export const jobTargetsPort = definePort<JobTargets>("jobs.targets");

// job command가 commit 뒤 할 일로 싣는다.
export const JOBS_CHANGED_TOPIC = "jobs.changed";
export type JobsChangedData = {
  job: Id<"job">;
  job_run: Id<"jbr"> | null;
};

export type JobSchedulerStore = {
  claimDue(
    startup: boolean,
  ): Promise<Result<{ start: JobTurn[]; next_due_at: string | null }>>;
  open(): Promise<Result<JobTurn[]>>;
  started(
    jobRun: Id<"jbr">,
    found: {
      run: Id<"run"> | null;
      instance: Id<"wfi"> | null;
      session: Id<"ses"> | null;
    },
  ): Promise<Result<void>>;
  ended(
    jobRun: Id<"jbr">,
    state: "done" | "failed" | "cancelled",
    reason?: string,
  ): Promise<Result<void>>;
};

export type JobStarter = {
  start(
    job: JobRecord,
    jobRun: JobRunRecord,
  ): Promise<
    Result<{
      run: Id<"run"> | null;
      instance: Id<"wfi"> | null;
      session: Id<"ses"> | null;
    }>
  >;
  waitRun(
    run: Id<"run">,
  ): Promise<Result<{ state: "done" | "failed" | "cancelled" }>>;
  // 한 번 읽고 기다리지 않는다.
  runState(
    run: Id<"run">,
  ): Promise<Result<"running" | "done" | "failed" | "cancelled">>;
  instanceState(
    instance: Id<"wfi">,
  ): Promise<Result<"running" | "ended" | "stopped">>;
};

export type JobSchedulerDeps = {
  clock: Clock;
  timers: JobTimers;
  store: JobSchedulerStore;
  starter: JobStarter;
};

export type JobScheduler = {
  start(): Promise<Result<void>>;
  wake(): void;
  stop(): Promise<void>;
};
