import { z } from "zod";
import { archiveStateSchema } from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import { defineRead } from "../base/route.ts";
import { projectInputSchema, projectReadSchema } from "./projects.ts";

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
  actors: ["user", "agent", "app"],
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
  actors: ["user", "agent", "app"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});
