import { z } from "zod";
import { idSchema, jsonObjectSchema, sha256Schema } from "../platform/mod.ts";
import { sectionKeySchema } from "../documents/mod.ts";
import { positiveRevisionSchema } from "./run-values.ts";
import { agentRoleSchema, appCommandKeySchema } from "./scope.ts";
import { reasoningLevelSchema } from "./resolved-model.ts";

export const PRESET_ORIGINS = ["product", "user"] as const;
export const presetOriginSchema = z.enum(PRESET_ORIGINS);

export const CONTEXT_SELECTION_KINDS = [
  "all",
  "work_place",
  "assignment_scope",
  "project",
  "app",
  "context",
  "document",
  "sdk",
] as const;

const nonblankSchema = z.string().refine(
  (value) => value.trim().length > 0 && !value.includes("*"),
  { message: "expected an exact nonblank name" },
);

function unique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

const bundleFields = {
  name: nonblankSchema,
  revision: positiveRevisionSchema,
};

export const capabilityBundleSchema = z.strictObject(bundleFields);
export const capabilityBundleOutputSchema = z.object(bundleFields);

const toolFields = {
  tool: nonblankSchema,
  app_command: appCommandKeySchema.nullable(),
};

export const capabilityToolSchema = z.strictObject(toolFields);
export const capabilityToolOutputSchema = z.object(toolFields);

const capabilityFields = {
  bundles: z.array(capabilityBundleSchema),
  tools: z.array(capabilityToolSchema),
};

function capabilityShape(value: {
  bundles: readonly { name: string; revision: number }[];
  tools: readonly { tool: string; app_command: string | null }[];
}): boolean {
  return unique(value.bundles.map((bundle) => bundle.name)) &&
    unique(
      value.tools.map((tool) => `${tool.tool}\0${tool.app_command ?? ""}`),
    );
}

export const capabilitySelectionSchema = z.strictObject(capabilityFields)
  .refine(capabilityShape, { message: "duplicate bundle or tool" });

export const capabilitySelectionOutputSchema = z.object({
  bundles: z.array(capabilityBundleOutputSchema),
  tools: z.array(capabilityToolOutputSchema),
}).refine(capabilityShape, { message: "duplicate bundle or tool" });

const contextFields = {
  kind: z.enum(CONTEXT_SELECTION_KINDS),
  target: z.string().nullable(),
  section: sectionKeySchema.nullable(),
};

const TARGETED = new Set(["project", "app", "context", "document", "sdk"]);

function contextShape(value: {
  kind: string;
  target: string | null;
  section: string | null;
}): boolean {
  if (value.section !== null && value.kind !== "document") return false;
  if (TARGETED.has(value.kind)) {
    return value.target !== null && value.target.trim().length > 0;
  }
  return value.target === null;
}

export const contextSelectionSchema = z.strictObject(contextFields).refine(
  contextShape,
  { message: "context target does not match kind" },
);

export const contextSelectionOutputSchema = z.object(contextFields).refine(
  contextShape,
  { message: "context target does not match kind" },
);

const mcpToolFields = {
  server_name: nonblankSchema,
  original_tool: nonblankSchema,
};

export const mcpToolPairSchema = z.strictObject(mcpToolFields);
export const mcpToolPairOutputSchema = z.object(mcpToolFields);

export type McpToolPair = z.infer<typeof mcpToolPairSchema>;

function pairKey(pair: McpToolPair): string {
  return `${pair.server_name}\0${pair.original_tool}`;
}

const mcpFields = {
  servers: z.array(nonblankSchema),
  tools: z.array(mcpToolPairSchema),
};

function mcpShape(value: {
  servers: readonly string[];
  tools: readonly McpToolPair[];
}): boolean {
  return unique(value.servers) && unique(value.tools.map(pairKey)) &&
    value.tools.every((tool) => value.servers.includes(tool.server_name));
}

export const mcpSelectionSchema = z.strictObject(mcpFields).refine(mcpShape, {
  message: "mcp servers or tool pairs are not exact",
});

export const mcpSelectionOutputSchema = z.object({
  servers: z.array(nonblankSchema),
  tools: z.array(mcpToolPairOutputSchema),
}).refine(mcpShape, { message: "mcp servers or tool pairs are not exact" });

const modelFields = {
  provider: idSchema("pvd"),
  credentials: z.array(nonblankSchema),
  model_name: nonblankSchema,
  reasoning_level: reasoningLevelSchema,
  options: jsonObjectSchema,
};

function modelShape(value: { credentials: readonly string[] }): boolean {
  return unique(value.credentials);
}

export const presetModelSelectionSchema = z.strictObject(modelFields).refine(
  modelShape,
  { message: "duplicate credential key" },
);

export const presetModelSelectionOutputSchema = z.object(modelFields).refine(
  modelShape,
  { message: "duplicate credential key" },
);

// preset 판에 붙는 지침 연결. 파일 자리 값은 InstructionLocation이다.
const attachmentFields = {
  document: idSchema("doc"),
  order: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
};

export const presetInstructionSchema = z.strictObject(attachmentFields);
export const presetInstructionOutputSchema = z.object(attachmentFields);

function instructionsShape(value: {
  instructions: readonly { document: string; order: number }[];
}): boolean {
  const documents = value.instructions.map((item) => item.document);
  const orders = value.instructions.map((item) => item.order);
  return unique(documents) && unique(orders);
}

const definitionFields = {
  kind: agentRoleSchema,
  name: nonblankSchema,
  origin: presetOriginSchema,
  prompt: sha256Schema,
  capability: capabilitySelectionSchema,
  context: z.array(contextSelectionSchema),
  mcp: mcpSelectionSchema,
  safe_tools: z.array(mcpToolPairSchema),
  skills: z.array(nonblankSchema),
  model: presetModelSelectionSchema.nullable(),
  organizing_model: presetModelSelectionSchema.nullable(),
  instructions: z.array(presetInstructionSchema),
};

function definitionShape(value: {
  context: readonly { kind: string; target: string | null }[];
  safe_tools: readonly McpToolPair[];
  mcp: { tools: readonly McpToolPair[] };
  skills: readonly string[];
  instructions: readonly { document: string; order: number }[];
}): boolean {
  const selected = new Set(value.mcp.tools.map(pairKey));
  return unique(
    value.context.map((item) =>
      `${item.kind}\0${item.target ?? ""}\0${
        "section" in item ? item.section ?? "" : ""
      }`
    ),
  ) && unique(value.skills) &&
    unique(value.safe_tools.map(pairKey)) &&
    value.safe_tools.every((tool) => selected.has(pairKey(tool))) &&
    instructionsShape(value);
}

export const presetDefinitionSchema = z.strictObject(definitionFields).refine(
  definitionShape,
  { message: "preset selection is not exact" },
);

export const presetDefinitionOutputSchema = z.object({
  ...definitionFields,
  capability: capabilitySelectionOutputSchema,
  context: z.array(contextSelectionOutputSchema),
  mcp: mcpSelectionOutputSchema,
  safe_tools: z.array(mcpToolPairOutputSchema),
  model: presetModelSelectionOutputSchema.nullable(),
  organizing_model: presetModelSelectionOutputSchema.nullable(),
  instructions: z.array(presetInstructionOutputSchema),
}).refine(definitionShape, { message: "preset selection is not exact" });

export type PresetDefinition = z.infer<typeof presetDefinitionSchema>;

const presetFields = {
  id: idSchema("pst"),
  revision: positiveRevisionSchema,
  definition: presetDefinitionOutputSchema,
  definition_hash: sha256Schema,
};

export const presetRecordSchema = z.object(presetFields);
export type Preset = z.infer<typeof presetRecordSchema>;
