import { isMap, isScalar, parse, parseDocument } from "yaml";
import { err, ok, type Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import {
  declarationStepSchema,
  FLOW_SDK_SUPPORTED_FROM,
  FLOW_SDK_VERSION,
  FLOW_STEP_BY,
  type InstanceStep,
  type Participant,
  type SessionOpenMode,
  validateInputDeclaration,
  type WorkflowDeclaration,
  type WorkflowEntry,
  workflowDeclarationSchema,
} from "../../protocol/workflows/mod.ts";
import type { DefinitionFile, FlowSdkInfo } from "./ports.ts";

export const DEFAULT_MISSING_FLOW_SDK = "1.0.0";
export const DEFAULT_FLOW_SDK_INFO: FlowSdkInfo = {
  current: FLOW_SDK_VERSION,
  supported_from: FLOW_SDK_SUPPORTED_FROM,
};

export function compareVersion(a: string, b: string): number {
  const left = a.split(/[.+-]/).map(Number);
  const right = b.split(/[.+-]/).map(Number);
  for (let at = 0; at < 3; at += 1) {
    const diff = (left[at] ?? 0) - (right[at] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function flowSdkStatusOf(
  flowSdk: string,
  info: FlowSdkInfo,
): "current" | "available" | "required" {
  if (compareVersion(flowSdk, info.supported_from) < 0) return "required";
  if (compareVersion(flowSdk, info.current) < 0) return "available";
  return "current";
}

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
  // 실행 모드는 오직 flow.ts 존재 여부로 결정한다(옛 YAML의 kind 칸은 무시한다).
  const isFlow = file.flow;
  if (!isFlow) {
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
    if (shaped.data.participants === undefined) {
      return {
        ok: false,
        problem: {
          reason: "invalid_declaration",
          message: "participants: required",
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
            ...(p.open !== undefined && { open: p.open }),
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
      ...(s.open !== undefined ? { open: s.open } : {}),
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
  flowSdkInfo: FlowSdkInfo = DEFAULT_FLOW_SDK_INFO,
): WorkflowEntry {
  const base = { key, project, name: file.name, artifacts: file.artifacts };
  const parsed = parseDeclaration(file);
  if (!parsed.ok) {
    return {
      ...base,
      state: "invalid",
      kind: null,
      flow_sdk: null,
      flow_sdk_status: null,
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
  if (file.flow) {
    const flowSdk = declaration.flow_sdk ?? DEFAULT_MISSING_FLOW_SDK;
    const flowSdkStatus = flowSdkStatusOf(flowSdk, flowSdkInfo);
    const problem =
      flowSdkStatus === "required"
        ? {
            reason: "broken_flow" as const,
            message: `@lophn/flow ${flowSdk} is below supported_from ${flowSdkInfo.supported_from}; migration is required before starting`,
          }
        : null;
    return {
      ...base,
      state: "ok",
      kind: "flow",
      flow_sdk: flowSdk,
      flow_sdk_status: flowSdkStatus,
      startable: problem === null,
      problem,
      ...io,
      ...(declaration.open !== undefined ? { open: declaration.open } : {}),
      participants:
        declaration.participants !== undefined
          ? participantsOf(declaration)
          : null,
      steps: flowStepsOf(declaration).map((s) => ({
        name: s.name,
        by: s.by,
        with: s.with,
        next: s.next,
      })),
    };
  }
  const parsedSteps = stepsOf(declaration);
  const defaultStep =
    declaration.default_step !== undefined &&
    parsedSteps.some((s) => s.name === declaration.default_step)
      ? declaration.default_step
      : undefined;
  return {
    ...base,
    state: "ok",
    kind: "agent",
    flow_sdk: null,
    flow_sdk_status: null,
    startable: true,
    problem: null,
    ...io,
    ...(defaultStep !== undefined ? { default_step: defaultStep } : {}),
    ...(declaration.open !== undefined ? { open: declaration.open } : {}),
    participants: participantsOf(declaration),
    steps: parsedSteps.map((s) => {
      const participants = participantsOf(declaration);
      const by = participants[s.by];
      const human = by !== undefined && "kind" in by && by.kind === "human";
      const target = human
        ? s.with !== null
          ? participants[s.with]
          : undefined
        : by;
      const participantOpen =
        target !== undefined && !("kind" in target) ? target.open : undefined;
      const open = s.open ?? participantOpen ?? (human ? "tab" : undefined);
      return {
        name: s.name,
        by: s.by,
        with: s.with,
        next: s.next,
        ...(open !== undefined ? { open } : {}),
      };
    }),
  };
}

export type WorkflowDefaultsPatch = {
  default_step?: string | null;
  open?: SessionOpenMode | null;
  step_open?: Record<string, SessionOpenMode | null>;
  inputs?: Record<string, unknown>;
};

// workflow.yaml의 주석·anchor·줄 순서를 보존하면서 기본값 칸(default_step, open, steps.*.open, inputs.*.default)만 갱신한다.
export function patchWorkflowDeclarationYaml(
  rawYaml: string,
  patch: WorkflowDefaultsPatch,
): Result<string> {
  const doc = parseDocument(rawYaml, { schema: "core" });
  if (doc.errors.length > 0 || !isMap(doc.contents)) {
    return err({
      code: "conflict",
      message: "workflow.yaml could not be parsed",
    });
  }
  const root = doc.contents;

  if (patch.default_step === null) {
    doc.delete("default_step");
  } else if (patch.default_step !== undefined) {
    const stepsNode = root.get("steps", true);
    if (!isMap(stepsNode) || !stepsNode.has(patch.default_step)) {
      return err({
        code: "not_found",
        message: `step '${patch.default_step}' not found`,
      });
    }
    const firstKey = stepsNode.items[0]?.key;
    const firstStep = isScalar(firstKey) ? String(firstKey.value) : null;
    if (firstStep === patch.default_step) {
      doc.delete("default_step");
    } else {
      doc.set("default_step", patch.default_step);
    }
  }

  if (patch.open === null) {
    doc.delete("open");
  } else if (patch.open !== undefined) {
    doc.set("open", patch.open);
  }

  if (patch.step_open !== undefined) {
    const stepsNode = root.get("steps", true);
    if (!isMap(stepsNode)) {
      return err({ code: "not_found", message: "steps not found" });
    }
    for (const [stepName, mode] of Object.entries(patch.step_open)) {
      const stepNode = stepsNode.get(stepName, true);
      if (!isMap(stepNode)) {
        return err({
          code: "not_found",
          message: `step '${stepName}' not found`,
        });
      }
      if (mode === null) {
        stepNode.delete("open");
      } else {
        stepNode.set("open", mode);
      }
    }
  }

  if (patch.inputs !== undefined) {
    const inputsNode = root.get("inputs", true);
    if (!isMap(inputsNode)) {
      return err({ code: "not_found", message: "inputs not found" });
    }
    for (const [key, value] of Object.entries(patch.inputs)) {
      const fieldNode = inputsNode.get(key, true);
      if (!isMap(fieldNode)) {
        return err({
          code: "not_found",
          message: `input '${key}' not found`,
        });
      }
      if (value === null || value === undefined) {
        fieldNode.delete("default");
      } else {
        fieldNode.set("default", value);
      }
    }
  }

  return ok(doc.toString({ lineWidth: 0 }));
}
