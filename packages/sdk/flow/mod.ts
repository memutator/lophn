import {
  type FallbackDecision,
  runWithFallback,
  type WithFallbackOptions,
} from "./fallback.ts";
import { createFlowRuntime } from "./runtime.ts";
import {
  type AgentAddress,
  type AgentMode,
  type AgentRequest,
  type Checkpoint,
  type CheckpointKind,
  type CheckpointState,
  currentPort,
  type EscalateRequest,
  type EventFilter,
  type EventHandler,
  type EventWorkspaceFilter,
  type FlowEvent,
  type FlowPort,
  type HumanRequest,
  type Outcome,
  type OutcomeReason,
  type ReportRequest,
  type SessionChoice,
  type SessionOpenMode,
  type SoftOutput,
  type ToolRequest,
  type WorkflowRequest,
} from "./wire.ts";

export type {
  AgentAddress,
  AgentMode,
  AgentRequest,
  Checkpoint,
  CheckpointKind,
  CheckpointState,
  EscalateRequest,
  EventFilter,
  EventHandler,
  EventWorkspaceFilter,
  FallbackDecision,
  FlowEvent,
  HumanRequest,
  Outcome,
  OutcomeReason,
  ReportRequest,
  SessionChoice,
  SessionOpenMode,
  SoftOutput,
  ToolRequest,
  WithFallbackOptions,
  WorkflowRequest,
};

function need(): FlowPort {
  const port = currentPort();
  if (!port) {
    throw new Error(
      "@lophn/flow can only run inside a lophn flow process (entry.ts)",
    );
  }
  return port;
}

const port = need();
const runtime = createFlowRuntime(port);

export const input: string = port.input;
export const inputs: Readonly<Record<string, unknown>> = port.inputs
  ? Object.isFrozen(port.inputs)
    ? port.inputs
    : Object.freeze({ ...port.inputs })
  : Object.freeze({});
export const instance: string = port.instance;

export function step<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  return runtime.step(key, fn);
}

export function agent(req: AgentRequest): Promise<Outcome<SoftOutput>> {
  return runtime.agent(req);
}

export function human(req: HumanRequest): Promise<Outcome<SoftOutput>> {
  return runtime.human(req);
}

export function workflow(req: WorkflowRequest): Promise<Outcome<SoftOutput>> {
  return runtime.workflow(req);
}

export function tool<T = unknown>(req: ToolRequest): Promise<Outcome<T>> {
  return runtime.tool<T>(req);
}

export function onEvent<T = unknown>(
  filter: EventFilter,
  handler: EventHandler<T>,
): () => void {
  return runtime.onEvent(filter, handler);
}

export function report(req: ReportRequest): Promise<Outcome<void>> {
  return runtime.report(req);
}

export function escalate(req: EscalateRequest): Promise<Outcome<void>> {
  return runtime.escalate(req);
}

export function withFallback<T>(
  outcome: Outcome<T>,
  opts: WithFallbackOptions<T>,
): Promise<Outcome<T>> {
  return runWithFallback({ agent, escalate }, outcome, opts);
}
