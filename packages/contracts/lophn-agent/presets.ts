import { z } from "zod";
import {
  defineCommand,
  defineEvent,
  defineRead,
  idSchema,
  sha256Schema,
  withReadCommon,
} from "../platform/mod.ts";
import { instructionAttachmentOutputSchema } from "./instructions.ts";
import {
  presetDefinitionOutputSchema,
  presetDefinitionSchema,
  presetOriginSchema,
  presetRecordSchema,
} from "./preset-values.ts";
import { positiveRevisionSchema, readCursorSchema } from "./run-values.ts";
import { agentRoleSchema } from "./scope.ts";

const errors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
] as const;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

const createFields = {
  id: idSchema("pst"),
  definition: presetDefinitionSchema,
  copied_from: z.strictObject({
    preset: idSchema("pst"),
    revision: positiveRevisionSchema,
  }).nullable(),
};

export const createPresetInputSchema = z.strictObject(createFields).refine(
  (value) => value.definition.origin === "user",
  { message: "a person creates a user preset" },
);

export const revisePresetInputSchema = z.strictObject({
  preset: idSchema("pst"),
  definition: presetDefinitionSchema,
  reason: z.string().refine((value) => value.trim().length > 0, {
    message: "reason is blank",
  }),
});

export const revisePresetCompareSchema = z.strictObject({
  revision: positiveRevisionSchema,
});

export const registerDefaultPresetInputSchema = z.strictObject({
  id: idSchema("pst"),
  definition: presetDefinitionSchema,
  definition_hash: sha256Schema,
}).refine((value) => value.definition.origin === "product", {
  message: "a default preset is a product preset",
});

const presetResult = z.object({
  preset: presetRecordSchema,
});

export const registerDefaultPreset = defineCommand({
  resource: "presets",
  method: "register-default",
  name: "RegisterDefaultPreset",
  input: registerDefaultPresetInputSchema,
  output: presetResult,
  actors: ["machine"],
  errors: [...errors],
});

export const createPreset = defineCommand({
  resource: "presets",
  method: "create",
  name: "CreatePreset",
  input: createPresetInputSchema,
  output: presetResult,
  actors: ["user"],
  errors: [...errors],
});

export const revisePreset = defineCommand({
  resource: "presets",
  method: "revise",
  name: "RevisePreset",
  input: revisePresetInputSchema,
  output: presetResult,
  compare: revisePresetCompareSchema,
  actors: ["user"],
  errors: [...errors],
});

export const presetRead = defineRead({
  resource: "presets",
  method: "read",
  name: "ReadPreset",
  input: z.strictObject({
    preset: idSchema("pst"),
    revision: positiveRevisionSchema.optional(),
  }),
  output: withReadCommon(presetResult),
  actors: ["user", "agent", "machine", "coding_agent"],
  errors: [...readErrors],
});

export const presetList = defineRead({
  resource: "presets",
  method: "list",
  name: "ListPresets",
  input: z.strictObject({
    kind: agentRoleSchema.optional(),
    origin: presetOriginSchema.optional(),
    cursor: readCursorSchema.optional(),
  }),
  output: withReadCommon(z.object({
    presets: z.array(presetRecordSchema),
  })),
  actors: ["user", "agent", "machine", "coding_agent"],
  errors: [...readErrors],
});

// 그 문서를 지침으로 붙인 preset 판. in_use는 현재 assignment가 그 판을 쓰는지다.
const attachmentUseFields = {
  attachment: instructionAttachmentOutputSchema,
  in_use: z.boolean(),
};

export const instructionAttachmentUseSchema = z.object(attachmentUseFields);

export const presetInstructionAttachments = defineRead({
  resource: "presets",
  method: "instruction-attachments",
  name: "ReadPresetInstructionAttachments",
  input: z.strictObject({ document: idSchema("doc") }),
  output: withReadCommon(z.object({
    attachments: z.array(instructionAttachmentUseSchema),
  })),
  actors: ["user", "agent", "machine", "coding_agent"],
  errors: [...readErrors],
});

const presetSubject = idSchema("pst");

export const presetCreated = defineEvent("PresetCreated", {
  subject: presetSubject,
  payload: z.object({
    kind: agentRoleSchema,
    origin: presetOriginSchema,
    revision: positiveRevisionSchema,
    definition_hash: sha256Schema,
    definition: presetDefinitionOutputSchema,
  }),
});

export const presetRevised = defineEvent("PresetRevised", {
  subject: presetSubject,
  payload: z.object({
    before: z.object({
      revision: positiveRevisionSchema,
      definition_hash: sha256Schema,
    }),
    after: z.object({
      revision: positiveRevisionSchema,
      definition_hash: sha256Schema,
    }),
    reason: z.string(),
  }),
});

export const PRESET_ROUTES = [
  registerDefaultPreset,
  createPreset,
  revisePreset,
  presetRead,
  presetList,
  presetInstructionAttachments,
] as const;

export const PRESET_EVENTS = [presetCreated, presetRevised] as const;
