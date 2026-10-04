import { z } from "zod";
import {
  archiveStateSchema,
  atSchema,
  commandRequestSchema,
  defineCommand,
  defineEvent,
  defineRead,
  defineWorker,
  sha256Schema,
  withReadCommon,
} from "../platform/mod.ts";
import { documentRefOutputSchema } from "./address.ts";
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
  documents: z.array(documentRefOutputSchema),
});
export type AgentProject = z.infer<typeof agentProjectSchema>;
export const userProjectSchema = projectSchema.extend({
  document_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  documents: z.array(documentRefOutputSchema),
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

export const projectCreate = defineCommand({
  resource: "projects",
  method: "create",
  name: "project.create",
  input: projectCreateInputSchema,
  output: projectSchema,
  compare: z.strictObject({}),
  actors: ["user"],
  errors: ["invalid_input", "conflict", "forbidden"],
});
export const projectUpdate = defineCommand({
  resource: "projects",
  method: "update",
  name: "project.update",
  input: projectUpdateInputSchema,
  output: projectSchema,
  compare: projectCompareSchema,
  actors: ["user"],
  errors: ["invalid_input", "not_found", "conflict", "forbidden"],
});
export const projectSetTracking = defineCommand({
  resource: "projects",
  method: "set_tracking",
  name: "project.set_tracking",
  input: projectSetTrackingInputSchema,
  output: projectSchema,
  compare: projectCompareSchema,
  actors: ["user"],
  errors: ["invalid_input", "not_found", "conflict", "forbidden"],
});
// preview와 CAS가 다른 구성을 가리키는 요청을 handler 전에도 거절한다.
export const projectUpdateRequestSchema = commandRequestSchema(projectUpdate)
  .extend({ input: projectUpdateInputSchema, compare: projectCompareSchema })
  .refine(
    (value) =>
      value.input.preview === undefined ||
      value.input.preview.base_revision === value.compare.base_revision,
    { message: "preview and compare revisions must match" },
  );
export const projectSetTrackingRequestSchema = commandRequestSchema(
  projectSetTracking,
).extend({
  input: projectSetTrackingInputSchema,
  compare: projectCompareSchema,
}).refine(
  (value) => value.input.preview.base_revision === value.compare.base_revision,
  { message: "preview and compare revisions must match" },
);

export const projectArchive = defineCommand({
  resource: "projects",
  method: "archive",
  name: "project.archive",
  input: projectInputSchema,
  output: projectSchema,
  compare: projectCompareSchema,
  actors: ["user"],
  errors: ["not_found", "conflict", "forbidden"],
});
export const projectUnarchive = defineCommand({
  resource: "projects",
  method: "unarchive",
  name: "project.unarchive",
  input: projectInputSchema,
  output: projectSchema,
  compare: projectCompareSchema,
  actors: ["user"],
  errors: ["not_found", "conflict", "forbidden"],
});
export const projectList = defineRead({
  resource: "projects",
  method: "list",
  name: "project.list",
  input: z.strictObject({
    status: archiveStateSchema.optional(),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  }),
  output: withReadCommon(z.object({ projects: z.array(projectReadSchema) })),
  actors: ["user", "coding_agent", "agent", "app"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});
export const projectGet = defineRead({
  resource: "projects",
  method: "get",
  name: "project.get",
  input: projectInputSchema,
  output: withReadCommon(z.object({ project: projectReadSchema })),
  actors: ["user", "coding_agent", "agent", "app"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});
export const projectResolve = defineRead({
  resource: "projects",
  method: "resolve",
  name: "project.resolve",
  input: z.strictObject({ path: absolutePathSchema }),
  output: withReadCommon(
    z.object({ project: userProjectSchema, folder_path: absolutePathSchema }),
  ),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});
export const projectPreviewTracking = defineWorker({
  resource: "projects",
  method: "preview_tracking",
  name: "project.preview_tracking",
  input: projectPreviewTrackingInputSchema,
  output: trackingPreviewOutputSchema,
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
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

export const PROJECT_ROUTES = [
  projectCreate,
  projectUpdate,
  projectSetTracking,
  projectArchive,
  projectUnarchive,
  projectList,
  projectGet,
  projectResolve,
  projectPreviewTracking,
] as const;
export const PROJECT_EVENTS = [
  projectCreated,
  projectUpdated,
  projectTrackingChanged,
  projectArchived,
  projectUnarchived,
] as const;
