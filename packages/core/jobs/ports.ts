import type { Clock, Logger, Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import { definePort } from "../../protocol/base/mod.ts";
import type {
  JobRecord,
  JobRunRecord,
  JobTurn,
} from "../../protocol/jobs/mod.ts";
import type {
  AgentAddress,
  AgentAtWorkspace,
} from "../../protocol/lophn-agent/mod.ts";

// 시각은 Clock으로 읽고 timer는 이 port로 받는다. 테스트는 가짜를 꽂는다.
export type JobTimers = {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

// IANA 이름이다. 구현은 jobs wiring이 Intl.DateTimeFormat().resolvedOptions().timeZone으로 꽂는다.
export const jobZonePort = definePort<{ zone(): string }>("jobs.zone");

// job을 만들 때 이름을 푸는 port. 구현은 조립(core/main)이 꽂는다.
export type JobTargets = {
  creatorOf(session: Id<"ses">): AgentAtWorkspace | undefined;
  // 못 풀면 not_found.
  resolveAgent(address: AgentAddress): Result<AgentAtWorkspace>;
  // 없으면 not_found.
  resolveApp(ref: string): Result<Id<"app">>;
  resolveProject(ref: string): Result<Id<"prj">>;
};
export const jobTargetsPort = definePort<JobTargets>("jobs.targets");

// event를 때로 가진 job이 쓰는 판정. 앱 이름 풀기와 선언된 event, call 정책의 보이는 범위는 다른 module의 일이라 조립이 꽂는다.
export type JobEventPolicy = {
  // 앱(id, slug, 이름 가운데 하나)을 풀어 id와 slug를 준다. 못 풀면 not_found.
  resolveSource(ref: string): Result<{ app: Id<"app">; slug: string }>;
  // 그 앱의 active release가 그 event를 선언했나.
  declares(app: Id<"app">, event: string): boolean;
  // 그 session이 사람(또는 사람이 보는 앱 화면)이 연 것이 아닌가: 팀의 자식(`spawned_by`)이나 다른 workspace가 불러 연 것(`called_from`),
  // run(unattended 입력)이 연 것, workflow step이 받은 것. 그런 session의 event는 event job을 깨우지 않는다(job이 job을 깨우는 고리).
  // 터미널 탭(`term:`)은 사람이 연 것이다. 모르는 session은 driven으로 본다.
  drivenSession(session: string): boolean;
  // `from` workspace(job의 것, home이면 null)가 `to` workspace에 call 정책으로 닿을 수 있나.
  reaches(
    from: { kind: "project" | "app"; id: string } | null,
    to: { kind: "project" | "app"; id: string } | null,
  ): boolean;
};
export const jobEventPolicyPort = definePort<JobEventPolicy>("jobs.events");

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
  logger: Logger;
};

export type JobScheduler = {
  start(): Promise<Result<void>>;
  wake(): void;
  stop(): Promise<void>;
};
