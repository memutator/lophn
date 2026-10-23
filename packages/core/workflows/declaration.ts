import { parse } from "@std/yaml";
import type { Id } from "../../protocol/base/mod.ts";
import {
  FLOW_STEP_BY,
  type InstanceStep,
  type Participant,
  type WorkflowDeclaration,
  workflowDeclarationSchema,
  type WorkflowEntry,
} from "../../protocol/workflows/mod.ts";
import type { DefinitionFile } from "./ports.ts";

// 선언 file(workflow.yaml)을 읽어 WorkflowEntry와 instance 칸으로 옮기는 순수 함수다.
// 가리키는 이름이 있는지(by·with·next)는 보지 않는다. 시작할 때 넘길 줄에서 걸린다.

type Problem = NonNullable<WorkflowEntry["problem"]>;
type AgentDeclaration = Extract<WorkflowDeclaration, { kind: "agent" }>;
type FlowDeclaration = Extract<WorkflowDeclaration, { kind: "flow" }>;

export type ParsedDeclaration =
  | { ok: true; declaration: WorkflowDeclaration }
  | { ok: false; problem: Problem };

// core schema는 `2020-01-01`이나 `yes`를 날짜·불리언으로 바꾸지 않고 글로 남긴다.
// 고치는 쪽이 `workflow.list`를 다시 부르며 하나씩 고치므로 틀린 칸은 첫 하나만 싣는다.
export function parseDeclaration(file: DefinitionFile): ParsedDeclaration {
  if (file.declaration === null) {
    return {
      ok: false,
      problem: {
        reason: "no_declaration",
        message: "workflow.yaml is missing",
      },
    };
  }
  let value: unknown;
  try {
    value = parse(file.declaration, { schema: "core" });
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).split("\n")[0];
    return { ok: false, problem: { reason: "invalid_yaml", message } };
  }
  const shaped = workflowDeclarationSchema.safeParse(value);
  if (!shaped.success) {
    const issue = shaped.error.issues[0];
    const path = issue.path.map(String).join(".") || "(root)";
    return {
      ok: false,
      problem: {
        reason: "invalid_declaration",
        message: `${path}: ${issue.message}`,
      },
    };
  }
  return { ok: true, declaration: shaped.data };
}

export function participantsOf(
  declaration: AgentDeclaration,
): Record<string, Participant> {
  const out: Record<string, Participant> = {};
  for (const [key, p] of Object.entries(declaration.participants)) {
    out[key] = {
      role: p.role,
      ...(p.place !== undefined && { place: p.place }),
      ...(p.name !== undefined && { name: p.name }),
    };
  }
  return out;
}

export function stepsOf(declaration: AgentDeclaration): InstanceStep[] {
  return Object.entries(declaration.steps).map(([name, s]) => ({
    name,
    by: s.by,
    with: s.with ?? null,
    prompt: s.prompt,
    in: s.in ?? "",
    out: s.out ?? "",
    next: s.next ?? [],
  }));
}

// flow의 by·prompt 등은 읽지 않는다. instance도 step 목록을 가져야 화면이 그린다.
export function flowStepsOf(declaration: FlowDeclaration): InstanceStep[] {
  return Object.keys(declaration.steps).map((name) => ({
    name,
    by: FLOW_STEP_BY,
    with: null,
    prompt: "",
    in: "",
    out: "",
    next: [],
  }));
}

export function entryOf(
  project: Id<"prj">,
  key: string,
  file: DefinitionFile,
): WorkflowEntry {
  const base = { key, project, name: file.name, artifacts: file.artifacts };
  const parsed = parseDeclaration(file);
  if (!parsed.ok) {
    return {
      ...base,
      state: "invalid",
      kind: null,
      startable: false,
      problem: parsed.problem,
      participants: null,
      steps: null,
    };
  }
  const declaration = parsed.declaration;
  if (declaration.kind === "flow") {
    return {
      ...base,
      state: "ok",
      kind: "flow",
      startable: file.flow,
      problem: file.flow
        ? null
        : { reason: "no_flow_file", message: "flow.ts is missing" },
      participants: null,
      steps: flowStepsOf(declaration).map((s) => ({
        name: s.name,
        by: s.by,
        with: s.with,
        next: s.next,
      })),
    };
  }
  return {
    ...base,
    state: "ok",
    kind: "agent",
    startable: true,
    problem: null,
    participants: participantsOf(declaration),
    steps: stepsOf(declaration).map((s) => ({
      name: s.name,
      by: s.by,
      with: s.with,
      next: s.next,
    })),
  };
}
