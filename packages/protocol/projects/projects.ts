import { z } from "zod";
import {
  archiveStateSchema,
  atSchema,
  defineEvent,
  sha256Schema,
} from "../server/mod.ts";
import { fixedDocumentRefOutputSchema } from "./address.ts";
import {
  absolutePathSchema,
  projectIdSchema,
  relativePathSchema,
  revisionSchema,
  slugSchema,
} from "./values.ts";

const folderFields = {
  path: absolutePathSchema,
  description: z.string(),
};
export const folderSchema = z.strictObject(folderFields);
export const folderOutputSchema = z.object(folderFields);
export type Folder = z.infer<typeof folderSchema>;
export const foldersSchema = z.array(folderSchema).refine(
  (folders) =>
    new Set(folders.map((folder) => folder.path)).size === folders.length,
  { message: "duplicate folder path" },
);
export const foldersOutputSchema = z.array(folderOutputSchema);

export const trackingGlobSchema = z.string().min(1).refine(
  (value) =>
    !value.startsWith("/") && !/^[A-Za-z]:/.test(value) &&
    !/[\\\p{Cc}]/u.test(value) &&
    !value.split("/").includes(".."),
  { message: "glob must be root-relative without parent components" },
);
const patternFields = {
  effect: z.enum(["include", "exclude"]),
  glob: trackingGlobSchema,
};
export const trackingPatternSchema = z.strictObject(patternFields);
export const trackingPatternOutputSchema = z.object(patternFields);
export type TrackingPattern = z.infer<typeof trackingPatternSchema>;
const trackingFields = {
  enabled: z.boolean(),
  patterns: z.array(trackingPatternSchema),
  use_gitignore: z.boolean(),
};
export const trackingRuleSetSchema = z.strictObject(trackingFields);
export const trackingRuleSetOutputSchema = z.object({
  ...trackingFields,
  patterns: z.array(trackingPatternOutputSchema),
});
export type TrackingRuleSet = z.infer<typeof trackingRuleSetSchema>;
export const INITIAL_TRACKING_PROPOSAL: TrackingRuleSet = {
  enabled: true,
  patterns: [{ effect: "include", glob: "**/*.md" }],
  use_gitignore: true,
};

const previewEntryFields = {
  folder_path: absolutePathSchema,
  path: relativePathSchema,
  included: z.boolean(),
  reason: z.string().min(1),
};
export const trackingPreviewEntrySchema = z.strictObject(previewEntryFields);
export const trackingPreviewEntryOutputSchema = z.object(previewEntryFields);
const previewFields = {
  project: projectIdSchema,
  base_revision: revisionSchema,
  folders: foldersSchema,
  tracking: trackingRuleSetSchema,
  observed_at: atSchema,
  entries: z.array(trackingPreviewEntrySchema),
  complete: z.boolean(),
  next_cursor: z.string().nullable(),
};
export const trackingPreviewSchema = z.strictObject(previewFields).refine(
  (value) => !value.complete || value.next_cursor === null,
  { message: "complete preview cannot have next cursor" },
).refine(
  (value) =>
    value.entries.every((entry) =>
      value.folders.some((folder) => folder.path === entry.folder_path)
    ),
  { message: "preview entry must belong to a registered root" },
);
export const trackingPreviewOutputSchema = z.object({
  ...previewFields,
  folders: foldersOutputSchema,
  tracking: trackingRuleSetOutputSchema,
  entries: z.array(trackingPreviewEntryOutputSchema),
}).refine((value) => !value.complete || value.next_cursor === null).refine(
  (value) =>
    value.entries.every((entry) =>
      value.folders.some((folder) => folder.path === entry.folder_path)
    ),
);
export type TrackingPreview = z.infer<typeof trackingPreviewSchema>;

const projectMetadataFields = {
  id: projectIdSchema,
  name: slugSchema,
  title: z.string().min(1),
  purpose: z.string(),
  revision: revisionSchema,
  status: archiveStateSchema,
};
export const projectSchema = z.object({
  ...projectMetadataFields,
  folders: foldersOutputSchema,
  tracking: trackingRuleSetOutputSchema,
});
export type Project = z.infer<typeof projectSchema>;
export const agentProjectSchema = z.object({
  ...projectMetadataFields,
  documents: z.array(fixedDocumentRefOutputSchema),
});
export type AgentProject = z.infer<typeof agentProjectSchema>;
export const userProjectSchema = projectSchema.extend({
  document_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  documents: z.array(fixedDocumentRefOutputSchema),
  initial_tracking_proposal: trackingRuleSetOutputSchema,
});
export const projectReadSchema = z.union([
  userProjectSchema,
  agentProjectSchema,
]);

export const projectCreateInputSchema = z.strictObject({
  id: projectIdSchema,
  name: slugSchema,
  title: z.string().min(1),
  purpose: z.string(),
  folders: foldersSchema,
  tracking: z.strictObject({ ...trackingFields, enabled: z.literal(false) }),
});
export const projectCompareSchema = z.strictObject({
  base_revision: revisionSchema,
});
export const projectInputSchema = z.strictObject({ project: projectIdSchema });
const updateFields = {
  name: slugSchema.optional(),
  title: z.string().min(1).optional(),
  purpose: z.string().optional(),
  folders: foldersSchema.optional(),
};
export const projectUpdateInputSchema = z.strictObject({
  project: projectIdSchema,
  ...updateFields,
  preview: trackingPreviewSchema.optional(),
}).refine(
  (value) =>
    Object.keys(updateFields).some((field) =>
      value[field as keyof typeof updateFields] !== undefined
    ),
  { message: "update must change at least one field" },
).refine(
  (value) => (value.folders !== undefined) === (value.preview !== undefined),
  { message: "folder changes require their tracking preview" },
).refine(
  (value) =>
    value.preview === undefined ||
    (value.preview.project === value.project &&
      JSON.stringify(value.preview.folders) === JSON.stringify(value.folders)),
  { message: "preview project and folders must match the request" },
);
export const projectSetTrackingInputSchema = z.strictObject({
  project: projectIdSchema,
  folders: foldersSchema,
  tracking: trackingRuleSetSchema,
  preview: trackingPreviewSchema,
}).refine(
  (value) =>
    value.project === value.preview.project &&
    JSON.stringify(value.folders) === JSON.stringify(value.preview.folders) &&
    JSON.stringify(value.tracking) === JSON.stringify(value.preview.tracking),
  { message: "tracking apply must use the exact preview configuration" },
);
export const projectPreviewTrackingInputSchema = z.strictObject({
  project: projectIdSchema,
  base_revision: revisionSchema,
  folders: foldersSchema,
  tracking: trackingRuleSetSchema,
  cursor: z.string().min(1).optional(),
});

const projectChangeFields = {
  name: slugSchema.optional(),
  title: z.string().min(1).optional(),
  purpose: z.string().optional(),
  folders: foldersOutputSchema.optional(),
};
export const projectChangedFieldsSchema = z.object(projectChangeFields).refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  { message: "changed fields cannot be empty" },
);
const blobReferenceSchema = z.object({
  hash: sha256Schema,
  size_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
const projectChangeValueSchema = z.union([
  projectChangedFieldsSchema,
  blobReferenceSchema,
]);
const trackingChangeValueSchema = z.union([
  z.object({
    folders: foldersOutputSchema,
    tracking: trackingRuleSetOutputSchema,
  }),
  blobReferenceSchema,
]);
export const projectCreated = defineEvent("ProjectCreated", {
  subject: projectIdSchema,
  payload: z.object({
    name: slugSchema,
    title: z.string().min(1),
    purpose: z.string(),
    folders: foldersOutputSchema,
    tracking: trackingRuleSetOutputSchema.refine((value) => !value.enabled),
  }),
});
export const projectUpdated = defineEvent("ProjectUpdated", {
  subject: projectIdSchema,
  payload: z.object({
    before: projectChangeValueSchema,
    after: projectChangeValueSchema,
  }),
});
export const projectTrackingChanged = defineEvent("ProjectTrackingChanged", {
  subject: projectIdSchema,
  payload: z.object({
    before: trackingChangeValueSchema,
    after: trackingChangeValueSchema,
  }),
});
export const projectArchived = defineEvent("ProjectArchived", {
  subject: projectIdSchema,
  payload: z.object({ before_revision: revisionSchema }),
});
export const projectUnarchived = defineEvent("ProjectUnarchived", {
  subject: projectIdSchema,
  payload: z.object({ before_revision: revisionSchema }),
});

export const PROJECT_EVENTS = [
  projectCreated,
  projectUpdated,
  projectTrackingChanged,
  projectArchived,
  projectUnarchived,
] as const;
