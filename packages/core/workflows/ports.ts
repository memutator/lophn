import type { Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import type { TurnOutcome } from "../../protocol/lophn-agent/mod.ts";
import type {
  WorkflowInstance,
  workflowInstanceApply,
  workflowInstanceCreate,
  workflowInstanceRead,
} from "../../protocol/workflows/mod.ts";
import type { Input, Output } from "../../protocol/server/mod.ts";

// workflows 폴더의 하위 폴더 하나. declaration은 workflow.yaml의 글(없으면 null)이다.
export type DefinitionFile = {
  name: string;
  declaration: string | null;
  flow: boolean; // flow.ts가 있다
  artifacts: { static: boolean; instance: boolean };
};

// 구현은 wf-decl-reader가 끼운다.
export type WorkflowFiles = {
  list(project: Id<"prj">): Promise<Result<DefinitionFile[]>>;
};

export type WorkflowProjects = {
  // prj id 또는 project 이름. 없으면 not_found, 이름이 여럿이면 invalid_input.
  resolve(ref: string): Promise<Result<{ id: Id<"prj">; name: string }>>;
  nameOf(project: Id<"prj">): Promise<Result<string>>;
};

export type StepTurn = {
  // null이면 아직 가져가지 않았다.
  turn: Id<"trn"> | null;
  state: "running" | "finished" | null;
  outcome: TurnOutcome | null;
};

export type WorkflowTurns = {
  // 그 session에서 도는 turn이 있으면 멈춘다. 이미 끝났으면 ok.
  stopSession(session: Id<"ses">): Promise<Result<void>>;
  // 그 session이 받은 이 instance·step의 step 메시지 가운데 가장 나중 것. 그런 메시지가 없으면 null.
  stepTurn(
    session: Id<"ses">,
    instance: Id<"wfi">,
    step: string,
  ): Promise<Result<StepTurn | null>>;
};

// 두 command를 machine 자격으로 부른다.
export type WorkflowStore = {
  create(
    input: Input<typeof workflowInstanceCreate>,
  ): Promise<Result<Output<typeof workflowInstanceCreate>>>;
  apply(
    input: Input<typeof workflowInstanceApply>,
    compare: { state_seq: string },
  ): Promise<Result<Output<typeof workflowInstanceApply>>>;
  // ReadWorkflowInstance 전체 줄.
  read(
    instance: Id<"wfi">,
  ): Promise<Result<Output<typeof workflowInstanceRead>>>;
  // 모든 project의 running instance.
  running(): Promise<Result<WorkflowInstance[]>>;
};

// flow process를 띄우고 멈춘다. 구현은 flows wiring이 끼운다.
export type WorkflowFlows = {
  // err이면 service가 programExited로 instance를 닫는다.
  launch(start: {
    instance: Id<"wfi">;
    project: Id<"prj">;
    workflow: string;
    input: string;
    // flow의 앱 tool 호출을 맡는 agent 이름(선언의 agent, 없으면 lophn).
    agent: string;
  }): Promise<Result<void>>;
  // process를 죽이고 그 instance가 연 run을 취소한다. process가 없으면 ok.
  stop(instance: Id<"wfi">): Promise<Result<void>>;
};
