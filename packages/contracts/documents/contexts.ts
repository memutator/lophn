import { z } from "zod";
import {
  archiveStateSchema,
  defineEvent,
  idSchema,
  sha256Schema,
} from "../platform/mod.ts";
import {
  appIdSchema,
  documentIdSchema,
  revisionSchema,
  sectionKeySchema,
  versionIdSchema,
} from "./values.ts";

export const contextIdSchema = idSchema("ctx");

const nonblankSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});

export const CONTEXT_PERSPECTIVES = ["basis", "reference", "watch"] as const;
export const contextPerspectiveSchema = z.enum(CONTEXT_PERSPECTIVES);

const documentTargetFields = {
  kind: z.literal("document"),
  document: documentIdSchema,
  section: sectionKeySchema.nullable(),
};
const appCommandTargetFields = {
  kind: z.literal("app_command"),
  app: appIdSchema,
  command: nonblankSchema,
};
export const contextTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject(documentTargetFields),
  z.strictObject(appCommandTargetFields),
]);
export const contextTargetRecordSchema = z.discriminatedUnion("kind", [
  z.object(documentTargetFields),
  z.object(appCommandTargetFields),
]);
export type ContextTarget = z.infer<typeof contextTargetSchema>;

const itemFields = {
  target: contextTargetSchema,
  perspective: contextPerspectiveSchema,
  reason: nonblankSchema,
};
export const contextItemSchema = z.strictObject(itemFields);
export const contextItemOutputSchema = z.object({
  ...itemFields,
  target: contextTargetRecordSchema,
});
export type ContextItem = z.infer<typeof contextItemSchema>;

function targetKey(target: ContextTarget): string {
  return target.kind === "document"
    ? `document\u0000${target.document}\u0000${target.section ?? ""}`
    : `app_command\u0000${target.app}\u0000${target.command}`;
}

function uniqueTargets(items: readonly { target: ContextTarget }[]): boolean {
  return new Set(items.map((item) => targetKey(item.target))).size ===
    items.length;
}

export const contextItemsSchema = z.array(contextItemSchema).refine(
  uniqueTargets,
  { message: "duplicate context target" },
);
export const contextItemsOutputSchema = z.array(contextItemOutputSchema).refine(
  uniqueTargets,
  { message: "duplicate context target" },
);

const contextFields = {
  id: contextIdSchema,
  title: z.string().min(1),
  purpose: nonblankSchema,
  items: contextItemsOutputSchema,
  revision: revisionSchema,
  status: archiveStateSchema,
};
export const contextSchema = z.object(contextFields);
export type Context = z.infer<typeof contextSchema>;

export const contextCreateInputSchema = z.strictObject({
  id: contextIdSchema,
  title: z.string().min(1),
  purpose: nonblankSchema,
  items: contextItemsSchema,
});
export const contextCompareSchema = z.strictObject({
  base_revision: revisionSchema,
});
export const contextInputSchema = z.strictObject({
  context: contextIdSchema,
});
const contextUpdateFields = {
  title: z.string().min(1).optional(),
  purpose: nonblankSchema.optional(),
};
export const contextUpdateInputSchema = z.strictObject({
  context: contextIdSchema,
  ...contextUpdateFields,
}).refine(
  (value) =>
    Object.keys(contextUpdateFields).some((field) =>
      value[field as keyof typeof contextUpdateFields] !== undefined
    ),
  { message: "update must change at least one field" },
);
export const contextSetItemInputSchema = z.strictObject({
  context: contextIdSchema,
  item: contextItemSchema,
  position: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
    .optional(),
});
export const contextRemoveItemInputSchema = z.strictObject({
  context: contextIdSchema,
  target: contextTargetSchema,
});

export const WATCH_RESULTS = [
  "content_changed",
  "section_added",
  "section_missing",
  "unchanged",
  "unverified",
] as const;
export const CONFIRMED_WATCH_CHANGES = [
  "content_changed",
  "section_added",
  "section_missing",
] as const;
const moduleHashesSchema = z.strictObject({
  before: sha256Schema.nullable(),
  after: sha256Schema,
});
export const watchedItemComparisonSchema = z.strictObject({
  context: contextIdSchema,
  context_revision: revisionSchema,
  target: contextTargetSchema,
  source_seq: revisionSchema,
  before_version: versionIdSchema.nullable(),
  after_version: versionIdSchema,
  result: z.enum(WATCH_RESULTS),
  before_hash: sha256Schema.nullable(),
  after_hash: sha256Schema.nullable(),
  module_hashes: moduleHashesSchema,
  unverified_reason: nonblankSchema.nullable(),
}).refine(
  (value) => value.target.kind === "document",
  { message: "watch comparison accepts a document target only" },
).refine(
  (value) =>
    value.result === "unverified"
      ? value.unverified_reason !== null
      : value.unverified_reason === null,
  { message: "unverified comparison requires its reason" },
).refine(
  (value) => value.result !== "section_missing" || value.after_hash === null,
  { message: "missing section has no after hash" },
).refine(
  (value) =>
    value.result !== "content_changed" ||
    (value.before_hash !== null && value.after_hash !== null &&
      value.before_hash !== value.after_hash),
  { message: "content change requires distinct before and after hashes" },
).refine(
  (value) =>
    !["section_added", "section_missing"].includes(value.result) ||
    (value.target.kind === "document" && value.target.section !== null),
  { message: "section change requires a section target" },
);

const blobReferenceSchema = z.object({
  hash: sha256Schema,
  size_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
const contextCreatedValueSchema = z.union([
  z.object({
    title: z.string().min(1),
    purpose: nonblankSchema,
    items: contextItemsOutputSchema,
  }),
  blobReferenceSchema,
]);
export const contextCreated = defineEvent("ContextCreated", {
  subject: contextIdSchema,
  payload: contextCreatedValueSchema,
});
export const contextUpdated = defineEvent("ContextUpdated", {
  subject: contextIdSchema,
  payload: z.object({
    before: z.object(contextUpdateFields),
    after: z.object(contextUpdateFields),
    before_revision: revisionSchema,
  }).refine(
    (value) =>
      Object.values(value.before).some((field) => field !== undefined) &&
      Object.values(value.after).some((field) => field !== undefined),
    { message: "update event names the changed fields" },
  ),
});
export const contextItemSet = defineEvent("ContextItemSet", {
  subject: contextIdSchema,
  payload: z.object({
    target: contextTargetRecordSchema,
    before_item: contextItemOutputSchema.nullable(),
    item: contextItemOutputSchema,
    before_position: z.number().int().nonnegative().max(
      Number.MAX_SAFE_INTEGER,
    ).nullable(),
    position: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    before_revision: revisionSchema,
  }).refine(
    (value) =>
      targetKey(value.item.target) === targetKey(value.target) &&
      (value.before_item === null ||
        targetKey(value.before_item.target) === targetKey(value.target)),
    { message: "item event target must match its items" },
  ),
});
export const contextItemRemoved = defineEvent("ContextItemRemoved", {
  subject: contextIdSchema,
  payload: z.object({
    target: contextTargetRecordSchema,
    before_item: contextItemOutputSchema,
    before_position: z.number().int().nonnegative().max(
      Number.MAX_SAFE_INTEGER,
    ),
    before_revision: revisionSchema,
  }).refine(
    (value) => targetKey(value.before_item.target) === targetKey(value.target),
    { message: "removed item must match its target" },
  ),
});
export const contextArchived = defineEvent("ContextArchived", {
  subject: contextIdSchema,
  payload: z.object({ before_revision: revisionSchema }),
});
export const contextUnarchived = defineEvent("ContextUnarchived", {
  subject: contextIdSchema,
  payload: z.object({ before_revision: revisionSchema }),
});
export const contextWatchedItemChanged = defineEvent(
  "ContextWatchedItemChanged",
  {
    subject: contextIdSchema,
    payload: z.object({
      target: contextTargetRecordSchema,
      before_version: versionIdSchema.nullable(),
      after_version: versionIdSchema,
      source_seq: revisionSchema,
      change_kind: z.enum(CONFIRMED_WATCH_CHANGES),
    }).refine(
      (value) => value.target.kind === "document",
      { message: "watch change records a document target only" },
    ).refine(
      (value) =>
        !["section_added", "section_missing"].includes(value.change_kind) ||
        (value.target.kind === "document" && value.target.section !== null),
      { message: "section change requires a section target" },
    ),
  },
);

export const CONTEXT_EVENTS = [
  contextCreated,
  contextUpdated,
  contextItemSet,
  contextItemRemoved,
  contextArchived,
  contextUnarchived,
  contextWatchedItemChanged,
] as const;
