import { stringify } from "yaml";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  FLOW_SDK_VERSION,
  FLOW_STEP_BY,
  type InstanceStep,
  type Participant,
  type SessionOpenMode,
  type StepJoinMode,
  WORKFLOW_FLOW_FILE,
  type WorkflowInstance,
  type WorkflowRunOverride,
} from "../../protocol/workflows/mod.ts";

export type InlineStepInput = {
  readonly name: string;
  readonly by: string;
  readonly with?: string;
  readonly prompt: string;
  readonly in?: string;
  readonly out?: string;
  readonly next?: string[];
  readonly parallel?: boolean;
  readonly needs?: string[];
  readonly join?: StepJoinMode;
  readonly open?: SessionOpenMode;
};

export function normalizeInlineSteps(
  rawSteps: readonly InlineStepInput[],
): Result<InstanceStep[]> {
  const seen = new Set<string>();
  const out: InstanceStep[] = [];
  for (const s of rawSteps) {
    if (seen.has(s.name)) {
      return err({
        code: "conflict",
        message: `duplicate step name '${s.name}'`,
      });
    }
    seen.add(s.name);
    out.push({
      name: s.name,
      by: s.by,
      with: s.with ?? null,
      prompt: s.prompt,
      in: s.in ?? "",
      out: s.out ?? "",
      next: s.next ?? [],
      ...(s.parallel !== undefined ? { parallel: s.parallel } : {}),
      ...(s.needs !== undefined ? { needs: s.needs } : {}),
      ...(s.join !== undefined ? { join: s.join } : {}),
      ...(s.open !== undefined ? { open: s.open } : {}),
    });
  }
  return ok(out);
}

function describeParticipant(p: Participant): string {
  if ("kind" in p) return "human";
  const parts = [`agent: ${p.agent}`];
  if (p.workspace !== undefined) {
    parts.push(
      "project" in p.workspace
        ? `project: ${p.workspace.project}`
        : "app" in p.workspace
          ? `app: ${p.workspace.app}`
          : "home",
    );
  }
  if (p.on !== undefined) parts.push(`on: ${p.on}`);
  return parts.join(", ");
}

function lineCount(content: string): number {
  if (content === "") return 0;
  return content.split("\n").length;
}

function previewText(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

export function applyRunOverrides(input: {
  baseParticipants: Readonly<Record<string, Participant>>;
  baseSteps: readonly InstanceStep[];
  override: WorkflowRunOverride | undefined;
}): Result<{
  participants: Record<string, Participant>;
  steps: InstanceStep[];
  diffLines: string[];
}> {
  const participants: Record<string, Participant> = {
    ...input.baseParticipants,
  };
  let steps: InstanceStep[] = input.baseSteps.map((s) => ({ ...s }));
  const diffLines: string[] = [];
  const ov = input.override;
  if (ov === undefined) {
    return ok({ participants, steps, diffLines });
  }

  if (ov.participants !== undefined) {
    const changes: string[] = [];
    for (const [key, value] of Object.entries(ov.participants)) {
      if (value === null) {
        if (!Object.hasOwn(participants, key)) {
          return err({
            code: "not_found",
            message: `participant '${key}' not found`,
          });
        }
        delete participants[key];
        changes.push(`-${key}`);
      } else {
        const existed = Object.hasOwn(participants, key);
        participants[key] = value;
        changes.push(
          `${existed ? "~" : "+"}${key} (${describeParticipant(value)})`,
        );
      }
    }
    if (changes.length > 0) {
      diffLines.push(`Participants: ${changes.join(", ")}`);
    }
  }

  if (ov.steps !== undefined) {
    if (
      ov.patch_steps !== undefined ||
      ov.add_steps !== undefined ||
      ov.remove_steps !== undefined
    ) {
      return err({
        code: "invalid_input",
        message:
          "override.steps cannot be combined with patch_steps, add_steps, or remove_steps",
      });
    }
    const normalized = normalizeInlineSteps(ov.steps);
    if (!normalized.ok) return normalized;
    steps = normalized.value;
    diffLines.push(
      `Steps replaced: ${steps.map((s) => s.name).join(" -> ") || "(none)"}`,
    );
  } else {
    const stepChanges: string[] = [];
    if (ov.remove_steps !== undefined) {
      for (const name of ov.remove_steps) {
        const idx = steps.findIndex((s) => s.name === name);
        if (idx < 0) {
          return err({
            code: "not_found",
            message: `step '${name}' not found`,
          });
        }
        steps.splice(idx, 1);
        stepChanges.push(`-${name}`);
      }
    }
    if (ov.patch_steps !== undefined) {
      for (const [name, patch] of Object.entries(ov.patch_steps)) {
        const idx = steps.findIndex((s) => s.name === name);
        if (idx < 0) {
          return err({
            code: "not_found",
            message: `step '${name}' not found`,
          });
        }
        const filtered = Object.fromEntries(
          Object.entries(patch).filter(
            ([k, v]) =>
              v !== undefined &&
              !(
                (k === "open" ||
                  k === "parallel" ||
                  k === "needs" ||
                  k === "join") &&
                v === null
              ),
          ),
        );
        const updated = { ...steps[idx]!, ...filtered };
        if (patch.open === null) delete updated.open;
        if (patch.parallel === null) delete updated.parallel;
        if (patch.needs === null) delete updated.needs;
        if (patch.join === null) delete updated.join;
        steps[idx] = updated;
        const fields = Object.keys(patch).join("/");
        stepChanges.push(`~${name} (${fields})`);
      }
    }
    if (ov.add_steps !== undefined) {
      for (const entry of ov.add_steps) {
        if (steps.some((s) => s.name === entry.step.name)) {
          return err({
            code: "conflict",
            message: `step '${entry.step.name}' already exists`,
          });
        }
        let at = steps.length;
        if (entry.after !== undefined) {
          const afterIdx = steps.findIndex((s) => s.name === entry.after);
          if (afterIdx < 0) {
            return err({
              code: "not_found",
              message: `step '${entry.after}' not found`,
            });
          }
          at = afterIdx + 1;
        }
        steps.splice(at, 0, {
          name: entry.step.name,
          by: entry.step.by,
          with: entry.step.with ?? null,
          prompt: entry.step.prompt,
          in: entry.step.in ?? "",
          out: entry.step.out ?? "",
          next: entry.step.next ?? [],
          ...(entry.step.parallel !== undefined
            ? { parallel: entry.step.parallel }
            : {}),
          ...(entry.step.needs !== undefined
            ? { needs: entry.step.needs }
            : {}),
          ...(entry.step.join !== undefined ? { join: entry.step.join } : {}),
          ...(entry.step.open !== undefined ? { open: entry.step.open } : {}),
        });
        stepChanges.push(`+${entry.step.name} (by: ${entry.step.by})`);
      }
    }
    if (stepChanges.length > 0) {
      diffLines.push(`Steps: ${stepChanges.join(", ")}`);
    }
  }

  return ok({ participants, steps, diffLines });
}

export function summarizeFileChanges(
  baseFiles: Readonly<Record<string, string>>,
  patches: Readonly<Record<string, string | null>>,
): string[] {
  const parts: string[] = [];
  for (const [path, content] of Object.entries(patches).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (content === null) {
      if (Object.hasOwn(baseFiles, path)) parts.push(`${path} (removed)`);
    } else if (Object.hasOwn(baseFiles, path)) {
      parts.push(`${path} (modified, ${lineCount(content)} lines)`);
    } else {
      parts.push(`${path} (added, ${lineCount(content)} lines)`);
    }
  }
  return parts;
}

export function buildOneOffApprovalLines(input: {
  projectName: string;
  workflow: string;
  execution: "agent" | "flow";
  participants: Readonly<Record<string, Participant>>;
  steps: readonly InstanceStep[];
  files?: Readonly<Record<string, string>>;
  flowAgent?: string;
  open?: SessionOpenMode;
  text: string;
}): string[] {
  const lines: string[] = [
    `One-off ${input.execution === "flow" ? "flow" : "YAML"} workflow "${input.workflow}" in project ${input.projectName}`,
  ];
  const participantEntries = Object.entries(input.participants);
  if (participantEntries.length > 0) {
    lines.push(
      `Participants: ${participantEntries
        .map(([k, p]) => `${k} (${describeParticipant(p)})`)
        .join(", ")}`,
    );
  }
  if (input.steps.length > 0) {
    lines.push(`Steps: ${input.steps.map((s) => s.name).join(" -> ")}`);
  }
  if (input.files !== undefined) {
    const fileList = Object.entries(input.files)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, content]) => `${path} (${lineCount(content)} lines)`);
    lines.push(`Files: ${fileList.join(", ")}`);
  }
  if (input.flowAgent !== undefined && input.flowAgent !== "lophn") {
    lines.push(`App tool agent: ${input.flowAgent}`);
  }
  if (input.open !== undefined) {
    lines.push(`Session open mode: ${input.open}`);
  }
  lines.push(`Input: ${previewText(input.text)}`);
  return lines;
}

export function buildOverrideApprovalLines(input: {
  projectName: string;
  workflow: string;
  execution: "agent" | "flow";
  diffLines: readonly string[];
  fileChanges: readonly string[];
  flowAgentOverride?: string;
  openOverride?: SessionOpenMode;
  text: string;
}): string[] {
  const lines: string[] = [
    `Base workflow: ${input.projectName}/${input.workflow} (${input.execution === "flow" ? "flow" : "YAML"}, this instance only)`,
    ...input.diffLines,
  ];
  if (input.fileChanges.length > 0) {
    lines.push(`Files: ${input.fileChanges.join(", ")}`);
  }
  if (input.flowAgentOverride !== undefined) {
    lines.push(`App tool agent: ${input.flowAgentOverride}`);
  }
  if (input.openOverride !== undefined) {
    lines.push(`Session open mode: ${input.openOverride}`);
  }
  lines.push(`Input: ${previewText(input.text)}`);
  return lines;
}

export function buildOverrideCodeApprovalLines(input: {
  instance: string;
  workflow: string;
  fileChanges: readonly string[];
  flowAgentOverride?: string;
  resume: boolean;
}): string[] {
  const lines: string[] = [
    `Instance: ${input.instance} (${input.workflow}, base workflow folder unchanged)`,
  ];
  if (input.fileChanges.length > 0) {
    lines.push(`Files: ${input.fileChanges.join(", ")}`);
  }
  if (input.flowAgentOverride !== undefined) {
    lines.push(`App tool agent: ${input.flowAgentOverride}`);
  }
  lines.push(
    input.resume
      ? "Action: update instance snapshot and resume flow"
      : "Action: update instance snapshot without resuming",
  );
  return lines;
}

export function serializeInstanceToYaml(input: {
  instance: Pick<
    WorkflowInstance,
    "participants" | "steps" | "open_mode" | "flow_agent"
  >;
  isFlow: boolean;
  flowSdkVersion?: string;
}): string {
  const doc: Record<string, unknown> = {};
  if (input.isFlow) {
    doc["flow_sdk"] = input.flowSdkVersion ?? FLOW_SDK_VERSION;
    if (
      input.instance.flow_agent !== undefined &&
      input.instance.flow_agent !== null &&
      input.instance.flow_agent !== "" &&
      input.instance.flow_agent !== "lophn"
    ) {
      doc["agent"] = input.instance.flow_agent;
    }
  }
  if (
    input.instance.open_mode !== undefined &&
    input.instance.open_mode !== null
  ) {
    doc["open"] = input.instance.open_mode;
  }
  if (Object.keys(input.instance.participants).length > 0) {
    doc["participants"] = input.instance.participants;
  }
  if (input.instance.steps.length > 0) {
    const steps: Record<string, Record<string, unknown>> = {};
    for (const s of input.instance.steps) {
      if (input.isFlow) {
        steps[s.name] = {
          ...(s.by !== FLOW_STEP_BY ? { by: s.by } : {}),
          ...(s.open !== undefined ? { open: s.open } : {}),
        };
      } else {
        // permission_mode는 사람 전용 설정이므로 workflow.yaml에 절대 저장하지 않는다.
        const stepObj: Record<string, unknown> = {
          by: s.by,
          ...(s.with !== null ? { with: s.with } : {}),
          prompt: s.prompt,
          ...(s.in !== "" ? { in: s.in } : {}),
          ...(s.out !== "" ? { out: s.out } : {}),
          ...(s.next.length > 0 ? { next: s.next } : {}),
          ...(s.parallel !== undefined ? { parallel: s.parallel } : {}),
          ...(s.needs !== undefined && s.needs.length > 0
            ? { needs: s.needs }
            : {}),
          ...(s.join !== undefined ? { join: s.join } : {}),
          ...(s.open !== undefined ? { open: s.open } : {}),
        };
        steps[s.name] = stepObj;
      }
    }
    doc["steps"] = steps;
  }
  return stringify(doc, { lineWidth: 0 });
}

export function hasFlowEntryFile(
  files: Readonly<Record<string, string | null>> | undefined,
): boolean {
  if (files === undefined) return false;
  return (
    Object.hasOwn(files, WORKFLOW_FLOW_FILE) &&
    files[WORKFLOW_FLOW_FILE] !== null
  );
}
