// 작업대가 읽는 통로. projects get·문서 목록 read 결과와
// layout 저장·복원만 담는다.
// core를 직접 부르지 않고 화면이 주입한 통로만 쓴다.
import type { CleanUpMode } from "../../../protocol/base/follow-ups.ts";
import type { SettingsExportKind } from "../../../protocol/folder/settings-export.ts";
import type { PermissionMode } from "../../../protocol/lophn-agent/turn-values.ts";
import type {
  WorkflowInputsDeclaration,
  WorkflowOutputsDeclaration,
} from "../../../protocol/workflows/inputs.ts";
import type { FileFailure } from "../../ipc/files.ts";
import type { LayoutSource } from "../shell/layout-source.ts";
import type { AgentsSource } from "./agents/source.ts";
import type { FileSearchSource } from "./search/source.ts";

/** 연결 폴더. */
export interface ProjectFolderView {
  readonly path: string;
  /** 디스크에서 찾을 수 있는가. false면 sidebar가 "찾을 수 없음"을 보인다. */
  readonly found: boolean;
}

/** projects.get 결과에서 작업대가 쓰는 부분. */
export interface ProjectView {
  readonly id: string;
  /** 기계를 넘는 id(`pri_`). 앱 화면의 `place.workspace`로 간다. */
  readonly identity: string;
  /** 이 project가 전에 가졌던 `identity`(오래된 것이 앞). 앱 화면의 `place.workspace`로 간다. */
  readonly formerIdentities: readonly string[];
  readonly title: string;
  readonly folders: readonly ProjectFolderView[];
}

/** 폴더 한 단계의 항목. 이름순이다. */
export interface FolderEntry {
  readonly name: string;
  readonly kind: "file" | "folder";
}

/** 프로젝트 폴더에서 문서로 잡힌 파일. 경로는 등록 폴더 기준 상대 경로다. */
export interface FileRow {
  /** 이 파일이 속한 등록 폴더 경로. sidebar가 폴더 아래에 문서를 보일 때 쓴다. */
  readonly folder?: string;
  readonly path: string;
  readonly document: string;
  readonly title: string;
}

/** 파일 tree를 바꾸는 일의 결과. 실패는 main이 돌려준 code다. */
export type FileOpResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: FileFailure };

export type WorkflowProblemReason =
  | "no_declaration"
  | "invalid_yaml"
  | "invalid_declaration"
  | "invalid_inputs"
  | "no_flow_file"
  | "broken_flow";

/** workflow `agent` 입력 칸의 선택지. ListWorkflows가 이 project에서 부를 수 있는 agent를 함께 돌려준다. */
export interface CallableAgentOptionView {
  readonly name: string;
  readonly label?: string;
  readonly kind?: string;
}

/** `workflows` 목록의 한 줄. 틀린 선언도 `invalid`로 남겨 자리를 잃지 않게 한다. workflow-shell의 desk selector도 읽는다. */
export interface WorkflowEntryView {
  /** 보이는 이름 `<project 이름>/<name>`. 시작 입력으로도 쓴다. */
  readonly key: string;
  /** prj id. */
  readonly project: string;
  /** workflow 이름(slug). project 안에서 자리와 탭의 key다. */
  readonly name: string;
  readonly invalid: boolean;
  /** false면 시작하지 못한다(invalid 또는 flow.ts가 없다). */
  readonly startable: boolean;
  readonly kind: "agent" | "flow" | null;
  readonly problem: {
    readonly reason: WorkflowProblemReason | (string & {});
    readonly message: string;
  } | null;
  /** 선언적 시작 입력 폼 정의. 없으면 입력 글 칸만 보인다. */
  readonly inputs?: WorkflowInputsDeclaration;
  /** 선언적 출력 스키마. */
  readonly outputs?: WorkflowOutputsDeclaration;
  /** 기본 시작 step 이름(없으면 첫 step). */
  readonly default_step?: string;
  /** flow workflow의 기본 세션 열기 방식(없으면 각 호출/agent 기본값). */
  readonly open?: "tab" | "background";
  /** 선언의 참가자(key → agent handle이나 사람). 틀린 선언이면 null이다. */
  readonly participants: Readonly<
    Record<
      string,
      | {
          readonly agent: string;
          readonly workspace?:
            | { readonly project: string }
            | { readonly app: string };
          /** 그 agent가 도는 다른 컴퓨터(명단의 이름이나 id). 없으면 이 컴퓨터다. */
          readonly on?: string;
          readonly open?: "tab" | "background";
        }
      | { readonly kind: "human" }
    >
  > | null;
  /** 선언의 step 순서. 시작할 step 고르기와 workflow 화면의 step 줄이 읽는다. */
  readonly steps:
    | readonly {
        readonly name: string;
        readonly by: string;
        readonly with: string | null;
        readonly next: readonly string[];
        readonly parallel?: boolean;
        readonly needs?: readonly string[];
        readonly join?: "all" | "any";
        readonly open?: "tab" | "background";
      }[]
    | null;
  readonly artifacts: {
    readonly static: boolean;
    readonly instance: boolean;
  };
}

/** `workflow_instances/list`의 거르기 칸. */
export interface WorkflowInstanceFilter {
  readonly project: string;
  readonly workflow?: string;
  readonly state?: WorkflowState;
  readonly one_off?: boolean;
}

export type WorkflowState = "running" | "ended" | "stopped";

/** 읽을 때 계산한 workflow 상태. */
export type WorkflowDerivedStatus =
  | "working"
  | "needs_you"
  | "blocked"
  | "ended"
  | "stopped";

/** instance의 `workflow_origin`을 가진 session 한 줄. parent로 spawn tree를 이룬다. */
export interface WorkflowSessionNodeView {
  readonly session: string;
  readonly parent: string | null;
  readonly agent: string;
  readonly workspace:
    | { readonly kind: "project"; readonly id: string }
    | { readonly kind: "app"; readonly id: string }
    | null;
  /** 이 session이 가장 나중에 받은 step. spawn된 자식은 태어난 때 부모의 step이다. */
  readonly step?: string | null;
  readonly state: "running" | "waiting" | "idle" | "unknown";
  readonly waiting_for: "approval" | "question" | null;
  readonly last_assistant_preview: string | null;
  readonly last_error: string | null;
  readonly harness_gui?: boolean;
  readonly harness?: string | null;
  readonly cli_session?: string | null;
}

export type WorkflowCheckpointKind =
  | "step"
  | "agent"
  | "human"
  | "workflow"
  | "tool";

export type WorkflowCheckpointState =
  | "started"
  | "completed"
  | "failed"
  | "interrupted";

export interface WorkflowOutcomeErrorView {
  readonly reason: string;
  readonly message: string;
  readonly session?: string;
}

/** durable flow 실행의 checkpoint 한 줄. */
export interface WorkflowCheckpointView {
  readonly instance: string;
  readonly key: string;
  readonly kind: WorkflowCheckpointKind;
  readonly state: WorkflowCheckpointState;
  readonly handle_ref: string | null;
  readonly output: unknown | null;
  readonly error: WorkflowOutcomeErrorView | null;
  readonly started_at: string;
  readonly finished_at: string | null;
}

/** 부모 workflow가 `workflow()`로 띄운 자식 sub-workflow 요약. */
export interface WorkflowChildSummaryView {
  readonly instance: string;
  readonly workflow: string;
  readonly title?: string | null;
  readonly state: WorkflowState;
  readonly derived_status: WorkflowDerivedStatus;
  readonly started_at: string;
  readonly ended_at: string | null;
}

export type WorkflowLineBy =
  | { readonly kind: "user" }
  | { readonly kind: "agent"; readonly session: string }
  | { readonly kind: "lophn" }
  | { readonly kind: "job"; readonly job: string }
  | { readonly kind: "workflow"; readonly instance: string }
  | { readonly kind: "program" }
  /** 다른 컴퓨터의 참가자가 낸 report. computer는 받은 때 이 컴퓨터 명단의 이름이다. */
  | {
      readonly kind: "remote";
      readonly machine: string;
      readonly computer: string;
      readonly name: string;
    }
  /** 다른 컴퓨터의 lophn이 쓴 줄: 그 컴퓨터에서 step을 가져간 turn이 report 없이 끝났다. */
  | {
      readonly kind: "remote_lophn";
      readonly machine: string;
      readonly computer: string;
    };

/** instance를 시작한 쪽. job이면 제목을 붙여 온다(지워진 job은 null). */
export type WorkflowStartedBy =
  | { readonly kind: "user" }
  | {
      readonly kind: "job";
      readonly job: string;
      readonly title: string | null;
    }
  | { readonly kind: "workflow"; readonly instance: string }
  | { readonly kind: "agent"; readonly session: string };

/** instance 줄. 줄은 instance 안에서 1부터 이어 센다(seq는 글). */
export type WorkflowLineView = {
  readonly instance: string;
  readonly seq: string;
  readonly at: string;
  readonly by: WorkflowLineBy;
} & (
  | {
      readonly kind: "started";
      /** flow는 시작 step이 없다. */
      readonly step: string | null;
      readonly text: string;
    }
  | {
      readonly kind: "report";
      readonly step: string;
      readonly text: string;
      readonly next: string | null;
      readonly next_steps?: readonly string[];
      readonly session: "new" | "same";
      readonly refs?: readonly string[];
      readonly data?: unknown;
    }
  | {
      readonly kind: "edit";
      readonly op: string;
      readonly step: string | null;
      readonly detail: unknown;
    }
  | {
      readonly kind: "handed";
      readonly step: string;
      readonly participant: string;
      /** 다른 컴퓨터로 넘긴 step은 이 컴퓨터에 받은 session이 없다(null이고 `remote`가 있다). */
      readonly receiver: string | null;
      readonly human_turn: boolean;
      readonly cause: "start" | "report" | "edit" | "retry";
      readonly session: "new" | "same" | null;
      readonly remote?: {
        readonly machine: string;
        readonly computer: string;
        readonly call: string;
      } | null;
    }
  | {
      readonly kind: "not_handed";
      readonly step: string;
      readonly reason: string;
      readonly message: string;
    }
  | { readonly kind: "ended" }
  | { readonly kind: "stopped" }
  | {
      readonly kind: "lophn_restarted";
      /** flow는 step도 받은 쪽도 없다. */
      readonly step: string | null;
      readonly receiver: string | null;
    }
  | {
      readonly kind: "program_exited";
      readonly code: number | null;
      readonly stderr_tail: string;
    }
  | {
      readonly kind: "step_stalled";
      readonly step: string;
      readonly session: string | null;
    }
  | {
      readonly kind: "retried";
      readonly step: string | null;
      readonly session: string | null;
    }
  | {
      readonly kind: "escalated";
      readonly step: string | null;
      readonly text: string;
    }
  | { readonly kind: "code_updated" }
);

/** 시작할 때 선언에서 옮긴 instance. `state_seq`는 화면이 쓰지 않아 뺐다. */
export interface WorkflowInstanceView {
  readonly id: string;
  readonly project: string;
  readonly workflow: string;
  readonly title?: string | null;
  readonly input: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly state: WorkflowState;
  /** workflow.yaml의 참가자. agent는 agent 이름이고 workspace가 없으면 instance의 project다. */
  readonly participants: Readonly<
    Record<
      string,
      | {
          readonly agent: string;
          readonly workspace?:
            | { readonly project: string }
            | { readonly app: string };
          /** 그 agent가 도는 다른 컴퓨터(명단의 이름이나 id). 없으면 이 컴퓨터다. */
          readonly on?: string;
        }
      | { readonly kind: "human" }
    >
  >;
  readonly steps: readonly {
    readonly name: string;
    readonly by: string;
    readonly with: string | null;
    readonly prompt: string;
    readonly in: string;
    readonly out: string;
    readonly next: readonly string[];
    readonly parallel?: boolean;
    readonly needs?: readonly string[];
    readonly join?: "all" | "any";
  }[];
  readonly current: {
    readonly step: string;
    readonly human_turn: boolean;
  } | null;
  readonly active_steps?: readonly {
    readonly step: string;
    readonly human_turn: boolean;
  }[];
  readonly editor_session?: string | null;
  readonly started_by: WorkflowStartedBy;
  readonly code_snapshot?: string | null;
  readonly one_off?: boolean;
  readonly overridden?: boolean;
  readonly flow_agent?: string | null;
  readonly created_at: string;
  readonly finished_at: string | null;
}

export interface WorkflowInstanceSummaryView {
  readonly id: string;
  readonly project: string;
  readonly workflow: string;
  readonly title?: string | null;
  readonly state: WorkflowState;
  readonly current: WorkflowInstanceView["current"];
  readonly input: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly started_by: WorkflowStartedBy;
  readonly one_off?: boolean;
  readonly overridden?: boolean;
  readonly created_at: string;
  readonly finished_at: string | null;
  readonly last_line: WorkflowLineView | null;
  readonly derived_status?: WorkflowDerivedStatus;
}

/** 다른 컴퓨터로 넘긴 step call의 지금 상태. `delivery`는 끝나지 않은 동안만 있다. */
export interface WorkflowRemoteStepView {
  readonly call: string;
  readonly step: string;
  readonly machine: string;
  readonly computer: string;
  readonly state: "accepted" | "done" | "failed" | "cancelled";
  readonly delivery: "pending" | "unknown" | "held" | "running" | null;
}

/** `workflow_instances/read` 결과. 줄은 끝까지 이어 붙인 것이다. */
export interface WorkflowInstanceDetailView {
  readonly instance: WorkflowInstanceView;
  readonly last_reports: Readonly<Record<string, WorkflowLineView>>;
  readonly lines: readonly WorkflowLineView[];
  readonly remote_steps: readonly WorkflowRemoteStepView[];
  readonly derived_status?: WorkflowDerivedStatus;
  readonly sessions?: readonly WorkflowSessionNodeView[];
  readonly refs?: readonly string[];
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly checkpoints?: readonly WorkflowCheckpointView[];
  readonly children?: readonly WorkflowChildSummaryView[];
}

export type ReadResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      message: string;
      details?: Readonly<Record<string, unknown>>;
    };

/** `workflows(project)` 결과. 목록 외에 `agent` 입력용 callable agent 목록을 함께 싣는다. */
export type WorkflowListResult =
  | {
      readonly ok: true;
      readonly value: readonly WorkflowEntryView[];
      readonly callableAgents?: readonly CallableAgentOptionView[];
    }
  | { readonly ok: false; readonly message: string };

export interface WorkspaceSource {
  project(id: string): Promise<ReadResult<ProjectView>>;
  /** active project 목록. 상단 바의 project selector가 읽는다. */
  projects(): Promise<ReadResult<readonly { id: string; title: string }[]>>;
  /** 다른 기계의 workspace다. Explorer가 polling 간격을 늦추고 OS 전용 동작을 숨긴다. */
  readonly remote?: boolean;
  /** 폴더 한 단계를 디스크에서 읽는다(절대 경로). Explorer가 폴더를 펼칠 때 그 폴더만 부른다. */
  list(
    path: string,
    options?: { readonly force?: boolean },
  ): Promise<ReadResult<readonly FolderEntry[]>>;
  /** 이미 cache된 폴더 항목을 0ms로 꺼낸다(원격 Explorer SWR). 없으면 undefined. */
  listCached?(path: string): readonly FolderEntry[] | undefined;
  /** 원격 폴더의 background 갱신이 바뀐 항목을 받았을 때 알린다. */
  onDirectoryUpdated?(
    listener: (path: string, entries: readonly FolderEntry[]) => void,
  ): () => void;
  /** 다른 기계 workspace에서 project의 worktree 경로를 등록 폴더처럼 읽고 쓰게 알린다. 이 컴퓨터는 main이 core에서 읽어 없다. */
  registerRoots?(project: string, paths: readonly string[]): void;
  /** 새 파일·폴더. 없는 위쪽 폴더도 만들고, 이미 있으면 `conflict`다(덮어쓰지 않는다). */
  create(path: string, kind: "file" | "folder"): Promise<FileOpResult>;
  /** 이름 바꾸기이자 옮기기. 대상이 있으면 `conflict`, 폴더를 자기 안으로 옮기면 `invalid_input`이다. */
  rename(from: string, to: string): Promise<FileOpResult>;
  /** 붙여넣기·복제. `to`가 이미 있으면 `conflict`이고 아무것도 덮지 않는다. `to`가 `from` 안이면 `invalid_input`. */
  copy(from: string, to: string): Promise<FileOpResult>;
  /** 붙여넣은 바이트(클립보드 이미지)로 새 file만 만든다. 이미 있으면 `conflict`다. */
  writeBytes(path: string, bytes: Uint8Array): Promise<FileOpResult>;
  /** OS 휴지통으로 보낸다. 휴지통을 못 쓰면 `unavailable`이고 지우지 않는다. */
  trash(path: string): Promise<FileOpResult>;
  /** OS 파일 관리자에서 보인다. */
  reveal(path: string): Promise<FileOpResult>;
  /**
   * 연결 폴더를 더한다. OS 선택기로 폴더를 고르고 project에 잇는다. 사람이 선택기를 닫으면 `null`이고 아무것도 바꾸지 않는다.
   * 이미 있거나 겹치는 폴더는 core가 `invalid_input`으로 거절한다.
   */
  addFolder(project: string): Promise<ReadResult<ProjectView | null>>;
  /** 연결 폴더 하나를 project에서 뺀다. 디스크의 폴더는 그대로 둔다. */
  removeFolder(project: string, path: string): Promise<ReadResult<ProjectView>>;
  /**
   * Agents 탭과 sidebar의 Agents 묶음의 통로. 없으면 그 탭과 여는 길을 두지
   * 않는다. coreWorkspaceSource가 core 통로를 넣고 mock 모드는 fake를 넣는다.
   */
  readonly agentsSource?: AgentsSource;
  /** project 키워드 검색 통로. 없으면 Search 탭과 여는 길을 두지 않는다. */
  readonly searchSource?: FileSearchSource;
  /** workflow 정의 목록. 틀린 선언도 이유와 함께 담긴다. 읽기 실패를 빈 목록으로 돌려주지 않는다. */
  workflows(project: string): Promise<WorkflowListResult>;
  /** workflow instance 목록, 새것이 앞. */
  workflowInstances(
    filter: WorkflowInstanceFilter,
  ): Promise<ReadResult<readonly WorkflowInstanceSummaryView[]>>;
  workflowInstance(
    instance: string,
  ): Promise<ReadResult<WorkflowInstanceDetailView>>;
  /**
   * `workflow`는 entry의 key다. 넘기지 못해도(not_handed) 줄이 남으므로 결과는 instance id만 돌려주고
   * 화면이 instance를 다시 읽어 보인다.
   */
  startWorkflow(input: {
    workflow: string;
    title?: string;
    text: string;
    step?: string;
    inputs?: Record<string, unknown>;
    open?: "tab" | "background";
    step_open?: Record<string, "tab" | "background">;
    step_modes?: Record<string, PermissionMode>;
    participant_modes?: Record<string, PermissionMode>;
  }): Promise<ReadResult<{ instance: string; title?: string | null }>>;
  /** core 설정 `approvals.workflow_modes`에 기억해 둔 workflow 권한 단계를 읽는다. */
  readWorkflowModes?(
    project: string,
    workflow: string,
  ): Promise<ReadResult<Readonly<Record<string, PermissionMode>>>>;
  /** workflow 권한 단계(단계별 `step:<name>` 또는 참가자별 key)를 core 설정 `approvals.workflow_modes`에 합쳐 저장한다(`workflow.yaml`은 건드리지 않는다). */
  saveWorkflowModes?(
    project: string,
    workflow: string,
    modes: Readonly<Record<string, PermissionMode>>,
  ): Promise<ReadResult<null>>;
  /** 전역 기본 권한 단계(`approvals.default_mode`)를 읽는다. */
  readDefaultMode?(): Promise<ReadResult<PermissionMode>>;
  /** workflow instance의 제목을 바꾼다. */
  renameWorkflowInstance?(
    instance: string,
    title: string,
  ): Promise<ReadResult<{ title: string }>>;
  /** 시작 전(instance 생략) 또는 실행 중(instance 지정) workflow 편집용 lophn 세션을 열거나 기존 세션을 돌려준다. */
  openWorkflowEditor?(input: {
    readonly project: string;
    readonly workflow: string;
    readonly instance?: string;
  }): Promise<
    ReadResult<{
      readonly session: string;
      readonly agent: string;
      readonly created: boolean;
    }>
  >;
  stopWorkflow(instance: string): Promise<ReadResult<null>>;
  /** 막힌 step을 같은 session에서 이어서 다시 시도한다. step을 빼면 current step이다. */
  retryWorkflowStep(instance: string, step?: string): Promise<ReadResult<null>>;
  /** 멈춘(blocked) flow instance를 replay로 이어 간다. useLatestCode가 true면 최신 flow code로 snapshot을 갱신한다. */
  resumeWorkflow(
    instance: string,
    options?: { readonly useLatestCode?: boolean },
  ): Promise<ReadResult<WorkflowInstanceView>>;
  /** workflow 폴더와 관련 job·layout 이름을 바꾼다. */
  renameWorkflow?(input: {
    readonly project: string;
    readonly from: string;
    readonly to: string;
  }): Promise<ReadResult<{ readonly from: string; readonly to: string }>>;
  /** workflow 폴더·관련 job을 지우고 clean_up에 따라 follow-up/handoff를 연다. */
  deleteWorkflow?(input: {
    readonly project: string;
    readonly name: string;
    readonly cleanUp?: CleanUpMode;
  }): Promise<ReadResult<{ readonly handoff_session: string | null }>>;
  /** workflow·agent·skill·project_command·permission_rules를 대상 컴퓨터(온라인·오프라인 모두)로 보낸다(`settings_export/send`). */
  sendSettingsExport?(input: {
    readonly to: string;
    readonly items: readonly {
      readonly kind: SettingsExportKind;
      readonly id: string;
    }[];
    readonly project?: string;
    readonly note?: string;
  }): Promise<
    ReadResult<{
      readonly batch: string;
      readonly to_machine: string;
      readonly delivery_state: "queued" | "held_at_hub" | "delivered";
      readonly item_count: number;
    }>
  >;
  /** workflow.yaml의 기본값(default_step, open, steps.*.open, inputs.*.default)을 갱신한다. */
  setWorkflowDefaults?(input: {
    readonly project: string;
    readonly workflow: string;
    readonly default_step?: string | null;
    readonly open?: "tab" | "background" | null;
    readonly step_open?: Readonly<Record<string, "tab" | "background" | null>>;
    readonly inputs?: Readonly<Record<string, unknown>>;
  }): Promise<ReadResult<{ readonly entry: WorkflowEntryView }>>;
  /** 팔레트 파일 묶음. 문서로 잡힌 파일만 탭으로 열 수 있다. */
  files(project: string): Promise<ReadResult<readonly FileRow[]>>;
  /** workspace(project)의 desk layout 읽기와 저장. */
  readonly layout: LayoutSource;
}
