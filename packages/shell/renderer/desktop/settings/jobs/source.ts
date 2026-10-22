// Scheduled jobs가 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은 core-source.ts만 안다.
// 화면이 쓰는 칸만 담는다. project 창의 job panel도 이 통로와 model.ts를 그대로 쓴다.
import type { JobRunState } from "../../../../../protocol/jobs/values.ts";
import type { SourceResult } from "../../../source-result.ts";

export type { JobRunState, SourceResult };

export type AgentRefView =
  | { readonly role: "lophn" }
  | { readonly role: "project_manager"; readonly project: string }
  | { readonly role: "app_engineer"; readonly app: string }
  | { readonly role: "operator"; readonly agent: string };

export type PlaceView =
  | { readonly kind: "project"; readonly id: string }
  | { readonly kind: "app"; readonly id: string };

export type JobActionView =
  | {
    readonly kind: "agent_run";
    readonly agent: AgentRefView;
    readonly agent_place: PlaceView | null;
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
  readonly creator: AgentRefView;
  /** `30m`, `6h`, `1d`처럼 숫자와 단위(m, h, d). */
  readonly every: string;
  /** `09:00`. every가 d 단위일 때만 있다. */
  readonly at: string | null;
  readonly action: JobActionView;
  readonly missed_policy: MissedPolicy;
  readonly enabled: boolean;
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
  /** Operator agent id → 이름. */
  readonly operators: Readonly<Record<string, string>>;
}

export interface JobPatch {
  readonly title?: string;
  readonly every?: string;
  /** every가 d 단위가 아니게 바꾸면 null. */
  readonly at?: string | null;
  readonly missed_policy?: MissedPolicy;
}

export interface JobsSource {
  /** core 연결 상태를 듣는다. 준비되면 화면이 다시 읽는다. 해제는 반환 함수다. */
  watch(listener: (state: { readonly state: string }) => void): () => void;
  list(): Promise<
    SourceResult<
      { readonly jobs: readonly JobView[]; readonly names: JobNames }
    >
  >;
  /** 새것이 앞이다. */
  runs(job: string): Promise<SourceResult<readonly JobRunView[]>>;
  setEnabled(job: string, enabled: boolean): Promise<SourceResult<null>>;
  update(job: string, patch: JobPatch): Promise<SourceResult<null>>;
  remove(job: string): Promise<SourceResult<null>>;
}
