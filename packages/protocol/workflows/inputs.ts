import { z } from "zod";

export const WORKFLOW_INPUT_FIELD_TYPES = [
  "string",
  "text",
  "number",
  "boolean",
  "select",
  "multiselect",
  "agent",
  "path",
  "project",
] as const;
export const workflowInputFieldTypeSchema = z.enum(WORKFLOW_INPUT_FIELD_TYPES);
export type WorkflowInputFieldType = z.infer<
  typeof workflowInputFieldTypeSchema
>;

export const WORKFLOW_INPUT_PATH_KINDS = ["file", "dir", "any"] as const;
export const workflowInputPathKindSchema = z.enum(WORKFLOW_INPUT_PATH_KINDS);
export type WorkflowInputPathKind = z.infer<typeof workflowInputPathKindSchema>;

export const workflowInputScalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);
export type WorkflowInputScalar = z.infer<typeof workflowInputScalarSchema>;

// 조건 하나는 equals·in·truthy 가운데 정확히 하나다. 배열이면 모두 만족(AND)해야 보인다.
export const workflowInputWhenAtomSchema = z.union([
  z.strictObject({
    field: z.string().min(1),
    equals: workflowInputScalarSchema,
  }),
  z.strictObject({
    field: z.string().min(1),
    in: z.array(workflowInputScalarSchema).min(1),
  }),
  z.strictObject({
    field: z.string().min(1),
    truthy: z.boolean(),
  }),
]);
export type WorkflowInputWhenAtom = z.infer<typeof workflowInputWhenAtomSchema>;

export const workflowInputWhenSchema = z.union([
  workflowInputWhenAtomSchema,
  z.array(workflowInputWhenAtomSchema).min(1),
]);
export type WorkflowInputWhen = z.infer<typeof workflowInputWhenSchema>;

export const workflowInputOptionSchema = z.union([
  z.string().min(1),
  z.strictObject({
    value: z.string().min(1),
    label: z.string().min(1).optional(),
  }),
]);
export type WorkflowInputOption = z.infer<typeof workflowInputOptionSchema>;

export const workflowInputKeySchema = z.string().min(1).max(63);

// 선언은 모르는 칸을 틀렸다고 하지 않는다. 세부 제약(select options 유무, when 대상, default type)은
// validateInputDeclaration이 검사해 invalid_inputs 문제로 드러낸다.
export const workflowInputFieldSchema = z.object({
  type: workflowInputFieldTypeSchema,
  label: z.string().min(1).optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  placeholder: z.string().optional(),
  when: workflowInputWhenSchema.optional(),
  options: z.array(workflowInputOptionSchema).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  kind: workflowInputPathKindSchema.optional(),
  // 이 입력을 쓰는 step 이름. 시작 화면이 그 step 자리에 칸을 둔다(없거나 모르는 이름이면 run 전체의 설정이다).
  steps: z.array(z.string().min(1)).optional(),
});
export type WorkflowInputField = z.infer<typeof workflowInputFieldSchema>;

export const workflowInputsSchema = z.record(
  workflowInputKeySchema,
  workflowInputFieldSchema,
);
export type WorkflowInputsDeclaration = z.infer<typeof workflowInputsSchema>;

// 시작 입력·instance·job·flow wire가 주고받는 정규화/원시 inputs 값 객체.
// z.toJSONSchema(job tool 입력)와 Record<string, unknown> 호출자 모두에 맞는다.
export const workflowInputValuesSchema = z.record(z.string(), z.unknown());
export type WorkflowInputValues = z.infer<typeof workflowInputValuesSchema>;

export const WORKFLOW_OUTPUT_FIELD_TYPES = [
  "string",
  "number",
  "boolean",
  "json",
  "path",
  "refs",
] as const;
export const workflowOutputFieldTypeSchema = z.enum(
  WORKFLOW_OUTPUT_FIELD_TYPES,
);
export type WorkflowOutputFieldType = z.infer<
  typeof workflowOutputFieldTypeSchema
>;

export const workflowOutputFieldSchema = z.object({
  type: workflowOutputFieldTypeSchema.optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
});
export type WorkflowOutputField = z.infer<typeof workflowOutputFieldSchema>;

export const workflowOutputsSchema = z.record(
  workflowInputKeySchema,
  workflowOutputFieldSchema,
);
export type WorkflowOutputsDeclaration = z.infer<typeof workflowOutputsSchema>;

export type ValidateWorkflowInputsOptions = {
  callableAgents?: ReadonlySet<string>;
};

export type ValidateWorkflowInputsResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> };

export type ValidateInputDeclarationResult =
  | { ok: true }
  | { ok: false; errors: Record<string, string> };

function optionValue(option: WorkflowInputOption): string {
  return typeof option === "string" ? option : option.value;
}

function optionValueSet(
  options: readonly WorkflowInputOption[] | undefined,
): Set<string> {
  return new Set((options ?? []).map(optionValue));
}

function whenAtoms(when: WorkflowInputWhen): readonly WorkflowInputWhenAtom[] {
  return Array.isArray(when) ? when : [when];
}

function isTruthyValue(value: unknown): boolean {
  // multiselect 빈 배열은 선택 없음(falsy)으로 본다.
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function evaluateWhenAtom(
  atom: WorkflowInputWhenAtom,
  values: Readonly<Record<string, unknown>>,
): boolean {
  const actual = values[atom.field];
  if ("equals" in atom) return actual === atom.equals;
  if ("in" in atom) return atom.in.some((item) => item === actual);
  return isTruthyValue(actual) === atom.truthy;
}

export function evaluateInputWhen(
  when: WorkflowInputWhen | undefined,
  values: Readonly<Record<string, unknown>>,
): boolean {
  if (when === undefined) return true;
  return whenAtoms(when).every((atom) => evaluateWhenAtom(atom, values));
}

export function resolveInputDefaults(
  declarations: WorkflowInputsDeclaration,
  rawValues: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...rawValues };
  for (const [key, field] of Object.entries(declarations)) {
    if (out[key] === undefined && field.default !== undefined) {
      out[key] = structuredClone(field.default);
    }
  }
  return out;
}

function validateFieldValue(
  field: WorkflowInputField,
  value: unknown,
  opts: { checkRequired: boolean; callableAgents?: ReadonlySet<string> },
): string | null {
  if (value === undefined || value === null) {
    return opts.checkRequired && field.required ? "is required" : null;
  }
  switch (field.type) {
    case "string":
    case "text": {
      if (typeof value !== "string") return "must be a string";
      if (opts.checkRequired && field.required && value.trim().length === 0) {
        return "is required";
      }
      return null;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return "must be a finite number";
      }
      if (field.min !== undefined && value < field.min) {
        return `must be >= ${field.min}`;
      }
      if (field.max !== undefined && value > field.max) {
        return `must be <= ${field.max}`;
      }
      return null;
    }
    case "boolean": {
      if (typeof value !== "boolean") return "must be a boolean";
      return null;
    }
    case "select": {
      if (typeof value !== "string") return "must be a string";
      const allowed = optionValueSet(field.options);
      if (!allowed.has(value)) return "must be one of the declared options";
      return null;
    }
    case "multiselect": {
      if (!Array.isArray(value)) return "must be an array of options";
      const allowed = optionValueSet(field.options);
      for (const item of value) {
        if (typeof item !== "string" || !allowed.has(item)) {
          return "must contain only declared options";
        }
      }
      if (opts.checkRequired && field.required && value.length === 0) {
        return "is required";
      }
      return null;
    }
    case "agent": {
      if (typeof value !== "string" || value.trim().length === 0) {
        return "must be a non-empty agent name";
      }
      if (
        opts.callableAgents !== undefined &&
        !opts.callableAgents.has(value)
      ) {
        return `unknown or uncallable agent '${value}'`;
      }
      return null;
    }
    case "path": {
      if (typeof value !== "string" || value.trim().length === 0) {
        return "must be a non-empty path";
      }
      return null;
    }
    case "project": {
      if (typeof value !== "string" || value.trim().length === 0) {
        return "must be a non-empty project";
      }
      return null;
    }
  }
}

export function validateWorkflowInputs(
  declarations: WorkflowInputsDeclaration,
  rawValues: Readonly<Record<string, unknown>> = {},
  opts: ValidateWorkflowInputsOptions = {},
): ValidateWorkflowInputsResult {
  const entries = Object.entries(declarations);
  const resolved = resolveInputDefaults(declarations, rawValues);

  // 숨겨진 필드의 값은 후속 when 조건에도 보이지 않게 고정점까지 수렴한다(cycle 방어 상한 포함).
  let visible = new Set(entries.map(([key]) => key));
  for (let pass = 0; pass <= entries.length; pass += 1) {
    const effective: Record<string, unknown> = {};
    for (const key of visible) {
      if (resolved[key] !== undefined) effective[key] = resolved[key];
    }
    const next = new Set<string>();
    for (const [key, field] of entries) {
      if (evaluateInputWhen(field.when, effective)) {
        next.add(key);
      }
    }
    if (
      next.size === visible.size &&
      [...next].every((key) => visible.has(key))
    ) {
      visible = next;
      break;
    }
    visible = next;
  }

  const normalized: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const [key, field] of entries) {
    if (!visible.has(key)) continue;
    const value = resolved[key];
    const problem = validateFieldValue(field, value, {
      checkRequired: true,
      callableAgents: opts.callableAgents,
    });
    if (problem !== null) {
      errors[key] = problem;
    } else if (value !== undefined && value !== null) {
      normalized[key] = value;
    }
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, value: normalized };
}

export function validateInputDeclaration(
  declarations: WorkflowInputsDeclaration,
): ValidateInputDeclarationResult {
  const errors: Record<string, string> = {};
  const keys = Object.keys(declarations);
  const declared = new Set(keys);
  const deps = new Map<string, string[]>();

  for (const [key, field] of Object.entries(declarations)) {
    if (field.type === "select" || field.type === "multiselect") {
      if (!Array.isArray(field.options) || field.options.length === 0) {
        errors[key] = `${field.type} requires non-empty options`;
      } else {
        const seen = new Set<string>();
        for (const opt of field.options) {
          const val = optionValue(opt);
          if (seen.has(val)) {
            errors[key] = `duplicate option '${val}'`;
            break;
          }
          seen.add(val);
        }
      }
    }

    if (field.type === "number") {
      if (field.min !== undefined && !Number.isFinite(field.min)) {
        errors[key] ??= "min must be a finite number";
      }
      if (field.max !== undefined && !Number.isFinite(field.max)) {
        errors[key] ??= "max must be a finite number";
      }
      if (
        field.min !== undefined &&
        field.max !== undefined &&
        field.min > field.max
      ) {
        errors[key] ??= "min must be <= max";
      }
    }

    if (field.when !== undefined) {
      const refs: string[] = [];
      for (const atom of whenAtoms(field.when)) {
        if (atom.field === key) {
          errors[key] ??= "when cannot reference itself";
        } else if (!declared.has(atom.field)) {
          errors[key] ??= `when references unknown input '${atom.field}'`;
        } else {
          refs.push(atom.field);
        }
      }
      deps.set(key, refs);
    }

    if (field.default !== undefined && errors[key] === undefined) {
      const problem = validateFieldValue(field, field.default, {
        checkRequired: false,
      });
      if (problem !== null) {
        errors[key] = `invalid default: ${problem}`;
      }
    }
  }

  // when 의존 그래프 cycle 검사 (0 = unvisited, 1 = visiting, 2 = visited).
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const visit = (node: string) => {
    state.set(node, 1);
    stack.push(node);
    for (const target of deps.get(node) ?? []) {
      const targetState = state.get(target) ?? 0;
      if (targetState === 1) {
        const start = stack.indexOf(target);
        const cycle = [...stack.slice(start), target];
        for (const member of cycle) {
          errors[member] ??= `when cycle detected: ${cycle.join(" -> ")}`;
        }
      } else if (targetState === 0) {
        visit(target);
      }
    }
    stack.pop();
    state.set(node, 2);
  };

  for (const key of keys) {
    if ((state.get(key) ?? 0) === 0) visit(key);
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true };
}
