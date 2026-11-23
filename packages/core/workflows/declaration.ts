import { parse } from "yaml";
import type { Id } from "../../protocol/base/mod.ts";
import {
  declarationStepSchema,
  FLOW_STEP_BY,
  type InstanceStep,
  type Participant,
  validateInputDeclaration,
  type WorkflowDeclaration,
  workflowDeclarationSchema,
  type WorkflowEntry,
} from "../../protocol/workflows/mod.ts";
import type { DefinitionFile } from "./ports.ts";

// 선언 file(workflow.yaml)을 읽어 WorkflowEntry와 instance 칸으로 옮기는 순수 함수다.
// 가리키는 이름이 있는지(by·with·next)는 보지 않는다. 시작할 때 넘길 줄에서 걸린다.

type Problem = NonNullable<WorkflowEntry["problem"]>;

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
    const reason =
      issue.path[0] === "inputs" ? "invalid_inputs" : "invalid_declaration";
    return {
      ok: false,
      problem: {
        reason,
        message: `${path}: ${issue.message}`,
      },
    };
  }
  if (shaped.data.inputs !== undefined) {
    const checked = validateInputDeclaration(shaped.data.inputs);
    if (!checked.ok) {
      const details = Object.entries(checked.errors)
        .map(([field, msg]) => `inputs.${field}: ${msg}`)
        .join("; ");
      return {
        ok: false,
        problem: {
          reason: "invalid_inputs",
          message: details,
        },
      };
    }
  }
  const isFlow = file.flow || shaped.data.kind === "flow";
  if (!isFlow) {
    if (shaped.data.participants === undefined) {
      return {
        ok: false,
        problem: {
          reason: "invalid_declaration",
          message: "participants: required",
        },
      };
    }
    const steps = shaped.data.steps;
    if (steps === undefined || Object.keys(steps).length === 0) {
      return {
        ok: false,
        problem: {
          reason: "invalid_declaration",
          message: "steps: steps needs at least one step",
        },
      };
    }
    for (const [name, raw] of Object.entries(steps)) {
      const step = declarationStepSchema.safeParse(raw);
      if (!step.success) {
        const issue = step.error.issues[0];
        const path = ["steps", name, ...issue.path.map(String)].join(".");
        return {
          ok: false,
          problem: {
            reason: "invalid_declaration",
            message: `${path}: ${issue.message}`,
          },
        };
      }
    }
  }
  return { ok: true, declaration: shaped.data };
}

export function participantsOf(
  declaration: WorkflowDeclaration,
): Record<string, Participant> {
  const out: Record<string, Participant> = {};
  for (const [key, raw] of Object.entries(declaration.participants ?? {})) {
    // 선언은 모르는 칸을 받으므로 읽는 칸만 옮긴다.
    const p = raw as Participant;
    out[key] =
      "kind" in p
        ? { kind: "human" }
        : {
            agent: p.agent,
            ...(p.workspace !== undefined && { workspace: p.workspace }),
            ...(p.on !== undefined && { on: p.on }),
          };
  }
  return out;
}

export function stepsOf(declaration: WorkflowDeclaration): InstanceStep[] {
  return Object.entries(declaration.steps ?? {}).map(([name, raw]) => {
    const s = declarationStepSchema.parse(raw);
    return {
      name,
      by: s.by,
      with: s.with ?? null,
      prompt: s.prompt,
      in: s.in ?? "",
      out: s.out ?? "",
      next: s.next ?? [],
    };
  });
}

// flow의 by·prompt 등은 읽지 않는다. instance도 step 목록을 가져야 화면이 그린다.
export function flowStepsOf(declaration: WorkflowDeclaration): InstanceStep[] {
  return Object.keys(declaration.steps ?? {}).map((name) => ({
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
  const io = {
    ...(declaration.inputs !== undefined ? { inputs: declaration.inputs } : {}),
    ...(declaration.outputs !== undefined
      ? { outputs: declaration.outputs }
      : {}),
  };
  if (file.flow || declaration.kind === "flow") {
    return {
      ...base,
      state: "ok",
      kind: "flow",
      startable: file.flow,
      problem: file.flow
        ? null
        : { reason: "no_flow_file", message: "flow.ts is missing" },
      ...io,
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
    ...io,
    participants: participantsOf(declaration),
    steps: stepsOf(declaration).map((s) => ({
      name: s.name,
      by: s.by,
      with: s.with,
      next: s.next,
    })),
  };
}
