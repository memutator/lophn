import type { Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import type { RemoteWorkspace } from "../../protocol/lophn-agent/calls.ts";
import type { TurnOutcome } from "../../protocol/lophn-agent/mod.ts";
import type { AgentAddress } from "../../protocol/lophn-agent/workspaces.ts";
import type { Input, Output } from "../../protocol/server/mod.ts";
import type {
  CallableAgentOption,
  SessionChoice,
  WorkflowCheckpoint,
  WorkflowInstance,
  workflowCheckpointUpsert,
  workflowInstanceApply,
  workflowInstanceCreate,
  workflowInstanceRead,
} from "../../protocol/workflows/mod.ts";

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
  // 그 session이 보낸 열린(accepted) agent_calls 개수. worker 응답을 기다리는 중에는 stall로 보지 않는다.
  openOutgoingCalls(session: Id<"ses">): Promise<Result<number>>;
  // 선택: 그 session의 가장 최근 turn 상태(재시작 시 human step turn이 끊겼는지 판별하는 데 쓴다).
  lastTurn?(session: Id<"ses">): Promise<Result<StepTurn | null>>;
  // 선택: 그 session에 실행 중인 turn이 있는지.
  isTurnRunning?(session: Id<"ses">): Promise<Result<boolean>>;
};

// 세 command를 machine 자격으로 부른다.
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
  // Phase 4: durable checkpoint 저장·조회 및 직계 자식 sub-workflow 조회(선택적 — 옛 test fake 호환).
  upsertCheckpoint?(
    input: Input<typeof workflowCheckpointUpsert>,
  ): Promise<Result<Output<typeof workflowCheckpointUpsert>>>;
  checkpoints?(instance: Id<"wfi">): Promise<Result<WorkflowCheckpoint[]>>;
  children?(parent: Id<"wfi">): Promise<Result<WorkflowInstance[]>>;
};

// flow 폴더 source를 content-addressed blob으로 고정해 manifest JSON을 만든다.
export type WorkflowSnapshots = {
  capture(project: Id<"prj">, workflow: string): Promise<Result<string>>;
};

// 다른 컴퓨터의 참가자. 구현은 workflows wiring이 명단(machine links), call 정책, Router의 mail 명령으로 끼운다.
export type WorkflowRemote = {
  // 참가자의 on을 명단의 다른 컴퓨터 하나로 푼다(`call send --on`과 같은 풀이). 이 컴퓨터, 없거나 여럿인 이름은 오류다.
  computer(ref: string): Result<{ machine: Id<"mch">; computer: string }>;
  // 참가자의 workspace 이름(없으면 instance의 project)을 기계를 건너는 이름으로 바꾼다.
  workspace(
    name: AgentAddress["workspace"],
    project: Id<"prj">,
  ): Result<RemoteWorkspace>;
  // instance의 project가 이 컴퓨터의 call 정책에서 private인가. private은 다른 컴퓨터로 넘기지 않는다.
  isPrivate(project: Id<"prj">): boolean;
  // 그 session이 다른 컴퓨터에서 받은 그 instance·step의 step call. 없으면 null이다.
  receivedStep(
    session: Id<"ses">,
    instance: Id<"wfi">,
    step: string,
  ): Promise<Result<string | null>>;
  // 받은 step의 report를 보낸 컴퓨터로 낸다(reply mail). 글은 여기서 redaction을 거친다.
  report(input: {
    call: string;
    session: Id<"ses">;
    text: string;
    next: string | null;
    choice: SessionChoice;
  }): Promise<Result<void>>;
  // 이 컴퓨터가 다른 컴퓨터로 넘긴 step call의 instance와 step. 없으면 null이다.
  handOf(call: string): Result<{ instance: Id<"wfi">; step: string } | null>;
};

// project workspace에서 호출 가능한 agent 목록. 구현은 workflows wiring이 agents/cards로 끼운다.
export type WorkflowAgents = {
  listCallable(project: Id<"prj">): Promise<Result<CallableAgentOption[]>>;
};

// flow process를 띄우고 멈춘다. 구현은 flows wiring이 끼운다.
export type WorkflowFlows = {
  // err이면 service가 programExited로 instance를 닫는다.
  launch(start: {
    instance: Id<"wfi">;
    project: Id<"prj">;
    workflow: string;
    input: string;
    inputs?: Record<string, unknown>;
    // flow의 앱 tool 호출을 맡는 agent 이름(선언의 agent, 없으면 lophn).
    agent: string;
    // Phase 4 durable replay: 저장된 checkpoint 목록과 고정 code snapshot manifest.
    checkpoints?: WorkflowCheckpoint[];
    codeSnapshot?: string | null;
  }): Promise<Result<void>>;
  // process를 죽이고 그 instance가 연 run을 취소한다. process가 없으면 ok.
  stop(instance: Id<"wfi">): Promise<Result<void>>;
};
