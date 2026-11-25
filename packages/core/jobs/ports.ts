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
  PermissionMode,
} from "../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import { afterCommit } from "../storage/ledger/after-commit.ts";

// 시각은 Clock으로 읽고 timer는 이 port로 받는다. 테스트는 가짜를 꽂는다.
export type JobTimers = {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

// IANA 이름이다. 구현은 jobs wiring이 Intl.DateTimeFormat().resolvedOptions().timeZone으로 꽂는다.
export const jobZonePort = definePort<{ zone(): string }>("jobs.zone");

// 이 기계의 id다(`<root>/machine.json`). job의 주인 기계와 견주는 데 쓴다. 읽지 못하면 unavailable이다(남의 job으로 보고 돌리지 않는다).
// 구현은 jobs wiring이 Worker마다 처음 한 번 읽어 둔다.
export const jobMachinePort = definePort<{ id(): Result<Id<"mch">> }>(
  "jobs.machine",
);

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

// job이 가리키는 앱·project가 active인지 본다(보관됐거나 지워졌으면 false).
// jobs는 apps·projects 표를 직접 읽지 않으므로 조립(jobs-registration)이 꽂는다.
export type JobTargetAvailability = {
  appActive(id: Id<"app">): boolean;
  projectActive(id: Id<"prj">): boolean;
};
export const jobTargetAvailabilityPort = definePort<JobTargetAvailability>(
  "jobs.target_availability",
);

export const ALL_TARGETS_AVAILABLE: JobTargetAvailability = {
  appActive: () => true,
  projectActive: () => true,
};

// 격리된 단위 테스트가 이 port를 꽂지 않았으면 모두 active로 본다.
export function targetAvailabilityOf(
  holder: Pick<Tx, "port">,
): JobTargetAvailability {
  const port = holder.port(jobTargetAvailabilityPort) as
    | Partial<JobTargetAvailability>
    | undefined;
  if (
    typeof port?.appActive === "function" &&
    typeof port?.projectActive === "function"
  ) {
    return port as JobTargetAvailability;
  }
  return ALL_TARGETS_AVAILABLE;
}

// job의 대상(action의 앱·project 또는 이 기계 앱의 event trigger)이 보관됐거나 지워졌으면 true다.
// 다른 컴퓨터의 앱 event trigger(source_machine 있음)는 이 기계에 앱이 없을 수 있어 건너뛰지 않는다.
export function isJobTargetUnavailable(
  job: Pick<JobRecord, "action" | "trigger">,
  availability: JobTargetAvailability,
): boolean {
  const { action, trigger } = job;
  if (
    trigger != null &&
    trigger.app != null &&
    trigger.source_machine === undefined &&
    !availability.appActive(trigger.app as Id<"app">)
  ) {
    return true;
  }
  switch (action.kind) {
    case "tool_run":
      return !availability.appActive(action.app as Id<"app">);
    case "agent_run":
      if (action.agent_workspace == null) return false;
      return action.agent_workspace.kind === "app"
        ? !availability.appActive(action.agent_workspace.id as Id<"app">)
        : !availability.projectActive(action.agent_workspace.id as Id<"prj">);
    case "workflow_start":
      return !availability.projectActive(action.project as Id<"prj">);
  }
}

// workflow_start job의 현재 participant별 권한 단계(기억된 설정·기본값 해석)를 읽는 port.
// 구현은 조립(jobs-registration)이 settings(`approvals.workflow_modes`)와 workflow 선언으로 꽂는다.
export type JobWorkflowModes = {
  workflowModesOf(
    project: Id<"prj">,
    workflow: string,
  ): Record<string, PermissionMode>;
};
export const jobWorkflowModesPort = definePort<JobWorkflowModes>(
  "jobs.workflow_modes",
);

const NO_WORKFLOW_MODES: JobWorkflowModes = {
  workflowModesOf: () => ({}),
};

// 격리된 단위 테스트가 이 port를 꽂지 않았으면 빈 map으로 본다.
export function workflowModesPortOf(
  holder: Pick<Tx, "port">,
): JobWorkflowModes {
  const port = holder.port(jobWorkflowModesPort) as
    | Partial<JobWorkflowModes>
    | undefined;
  if (typeof port?.workflowModesOf === "function") {
    return port as JobWorkflowModes;
  }
  return NO_WORKFLOW_MODES;
}

// 승인 시점의 participant별 권한 단계(approvedModes)와 지금 기억된 단계(currentModes)를 비교해
// 어느 participant라도 'full'로 올라갔으면 true를 돌려준다(재승인 전까지 멈춤).
export function hasModeEscalated(
  approvedModes: Readonly<Record<string, PermissionMode>> | null | undefined,
  currentModes: Readonly<Record<string, PermissionMode>> | null | undefined,
): boolean {
  if (currentModes === null || currentModes === undefined) return false;
  for (const [key, mode] of Object.entries(currentModes)) {
    if (mode === "full" && (approvedModes?.[key] ?? "workspace") !== "full") {
      return true;
    }
  }
  return false;
}

export function isJobModeEscalated(
  job: Pick<JobRecord, "action" | "approved_at" | "participant_modes">,
  modes: JobWorkflowModes,
): boolean {
  if (job.approved_at === null || job.action.kind !== "workflow_start") {
    return false;
  }
  const current = modes.workflowModesOf(
    job.action.project as Id<"prj">,
    job.action.workflow,
  );
  return hasModeEscalated(job.participant_modes ?? null, current);
}

export function enrichJobWithModes(
  job: JobRecord,
  modes: JobWorkflowModes,
): JobRecord {
  if (job.action.kind !== "workflow_start") return job;
  const approvedModes = job.participant_modes ?? null;
  const currentModes = modes.workflowModesOf(
    job.action.project as Id<"prj">,
    job.action.workflow,
  );
  const escalated =
    job.approved_at !== null && hasModeEscalated(approvedModes, currentModes);
  const effectiveModes =
    Object.keys(currentModes).length > 0
      ? currentModes
      : approvedModes !== null && Object.keys(approvedModes).length > 0
        ? approvedModes
        : undefined;
  return {
    ...job,
    ...(effectiveModes !== undefined
      ? { participant_modes: effectiveModes }
      : {}),
    approval_paused_reason: escalated ? "mode_escalated" : null,
  };
}

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
  // 이 기계의 call 정책에서 `workspace`(home이면 null)가 private인가.
  isPrivate(workspace: { kind: "project" | "app"; id: string } | null): boolean;
};
export const jobEventPolicyPort = definePort<JobEventPolicy>("jobs.events");

// job이나 job run을 바꾼 command가 commit 뒤 할 일로 싣는다. wiring이 이 topic으로 scheduler를 깨운다.
// 바뀐 것이 없으면 싣지 않는다(깨운 scheduler가 차례를 가져가고 다시 깨우는 고리를 끊는다).
export const JOBS_CHANGED_TOPIC = "jobs.changed";
export function jobsChanged(tx: Tx): void {
  tx.port(afterCommit).push(JOBS_CHANGED_TOPIC, null);
}

// 놓친 차례가 새 held 줄로 commit된 뒤 낼 `JobHeld`를 싣는 topic이다. wiring이 Bus로 낸다.
// 이미 있는 held 줄이 갱신될 때는 싣지 않는다(사람은 이미 알고 있다).
export const JOB_HELD_TOPIC = "job_held";
export function jobHeld(
  tx: Pick<Tx, "port" | "now">,
  held: { job: string; run: string; job_title: string },
): void {
  tx.port(afterCommit).push(JOB_HELD_TOPIC, {
    type: "JobHeld",
    subject: held.job,
    at: tx.now(),
    payload: held,
  });
}

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
  workflowModesOf?(
    project: string,
    workflow: string,
  ): Promise<Record<string, PermissionMode>> | Record<string, PermissionMode>;
};

export type JobScheduler = {
  start(): Promise<Result<void>>;
  wake(): void;
  stop(): Promise<void>;
};
