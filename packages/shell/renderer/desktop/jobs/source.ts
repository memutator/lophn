// Jobs가 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은 core-source.ts만 안다.
// 화면이 쓰는 칸만 담는다. project 창의 job panel도 이 통로와 model.ts를 그대로 쓴다.
import type { JobRunState } from "../../../../protocol/jobs/values.ts";
import type { AgentId } from "../../../../protocol/lophn-agent/workspaces.ts";
import type { SourceResult } from "../../source-result.ts";

export type { JobRunState, SourceResult };

export type WorkspaceView =
  | { readonly kind: "project"; readonly id: string }
  | { readonly kind: "app"; readonly id: string };

export type JobActionView =
  | {
      readonly kind: "agent_run";
      readonly agent: AgentId;
      readonly agent_workspace: WorkspaceView | null;
      readonly prompt: string;
    }
  | {
      readonly kind: "tool_run";
      readonly app: string;
      readonly tool: string;
    }
  | {
      readonly kind: "workflow_start";
      readonly project: string;
      readonly workflow: string;
    };

export type MissedPolicy = "run" | "hold";

export interface JobView {
  readonly id: string;
  readonly title: string;
  /** 만든 session의 agent와 workspace. home은 workspace가 null이다. */
  readonly creator: {
    readonly agent: AgentId;
    readonly workspace: WorkspaceView | null;
  };
  /** `30m`, `6h`, `1d`처럼 숫자와 단위(m, h, d). event job은 null이다. */
  readonly every: string | null;
  /** `09:00`. every가 d 단위일 때만 있다. */
  readonly at: string | null;
  /** event로 도는 job의 때. source는 `lophn`이거나 앱 slug다. 주기 job은 null이다. */
  readonly trigger: {
    readonly source: string;
    readonly event: string;
    readonly min_interval: string;
    readonly pass_event: boolean;
  } | null;
  /** event job의 기록: 차례를 연 수, 건너뛴 수(busy | too_soon), 마지막 시각. */
  readonly fired_count: number;
  readonly skipped_count: number;
  readonly last_fired_at: string | null;
  readonly last_skipped_at: string | null;
  readonly last_skip_reason: "busy" | "too_soon" | null;
  /** event job의 앱이 지금 그 event를 내지 않는다(job.list만 채운다). */
  readonly source_gone?: boolean;
  readonly action: JobActionView;
  readonly missed_policy: MissedPolicy;
  readonly enabled: boolean;
  /** null이면 사람의 등록 승인을 기다린다(대기 목록에서 승인한다). */
  readonly approved_at: string | null;
  readonly next_due_at: string | null;
  readonly last_run: {
    readonly state: JobRunState;
    readonly due_at: string;
    readonly started_at: string | null;
  } | null;
}

export interface JobRunView {
  readonly id: string;
  readonly due_at: string;
  readonly missed_count: number;
  readonly state: JobRunState;
  readonly reason: string | null;
  readonly instance: string | null;
  readonly session: string | null;
  readonly started_at: string | null;
}

/** id → 이름 표. 못 찾은 id는 짧은 id로 보인다. */
export interface JobNames {
  readonly apps: Readonly<Record<string, string>>;
  readonly projects: Readonly<Record<string, string>>;
  /** agent id → 이름(lophn 포함). */
  readonly agents: Readonly<Record<string, string>>;
}

export interface JobPatch {
  readonly title?: string;
  /** 주기 job만. event job은 제목만 고친다. */
  readonly every?: string;
  /** every가 d 단위가 아니게 바꾸면 null. */
  readonly at?: string | null;
  readonly missed_policy?: MissedPolicy;
}

export interface JobsSource {
  list(): Promise<
    SourceResult<{
      readonly jobs: readonly JobView[];
      readonly names: JobNames;
    }>
  >;
  /** 새것이 앞이다. */
  runs(job: string): Promise<SourceResult<readonly JobRunView[]>>;
  setEnabled(job: string, enabled: boolean): Promise<SourceResult<null>>;
  update(job: string, patch: JobPatch): Promise<SourceResult<null>>;
  remove(job: string): Promise<SourceResult<null>>;
}
