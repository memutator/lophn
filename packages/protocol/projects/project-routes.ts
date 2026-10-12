import { z } from "zod";
import {
  archiveStateSchema,
  commandRequestSchema,
  defineCommand,
  defineRead,
  defineWorker,
  withReadCommon,
} from "../platform/mod.ts";
import {
  absolutePathSchema,
  projectIdSchema,
  revisionSchema,
} from "./values.ts";
import {
  projectCompareSchema,
  projectCreateInputSchema,
  projectInputSchema,
  projectPreviewTrackingInputSchema,
  projectReadSchema,
  projectSchema,
  projectSetTrackingInputSchema,
  projectUpdateInputSchema,
  trackingPreviewOutputSchema,
  userProjectSchema,
} from "./projects.ts";

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
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "conflict",
    "unavailable",
  ],
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
    "conflict",
    "unavailable",
  ],
});
// host가 고정한 authenticated current cwd 근거(CredentialConditions.cwd)만 쓴다. caller path는 없다.
export const projectResolveCwd = defineRead({
  resource: "projects",
  method: "resolve_cwd",
  name: "project.resolve_cwd",
  input: z.strictObject({}),
  output: withReadCommon(z.object({ project: projectIdSchema })),
  actors: ["coding_agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});
export const projectTrackingRoots = defineRead({
  resource: "projects",
  method: "tracking_roots",
  name: "project.tracking_roots",
  input: z.strictObject({}),
  output: withReadCommon(z.object({
    roots: z.array(z.object({
      project: projectIdSchema,
      revision: revisionSchema,
      path: absolutePathSchema,
    })),
  })),
  actors: ["machine"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
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

export const PROJECT_ROUTES = [
  projectCreate,
  projectUpdate,
  projectSetTracking,
  projectArchive,
  projectUnarchive,
  projectList,
  projectGet,
  projectResolve,
  projectResolveCwd,
  projectTrackingRoots,
  projectPreviewTracking,
] as const;
