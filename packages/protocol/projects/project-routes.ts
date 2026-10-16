import { z } from "zod";
import { archiveStateSchema } from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import { defineRead } from "../base/route.ts";
import { projectIdSchema } from "./values.ts";
import {
  projectInputSchema,
  projectReadSchema,
} from "./projects.ts";

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
