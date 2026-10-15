import { z } from "zod";
import { withReadCommon } from "../../base/envelope.ts";
import { defineRead } from "../../base/route.ts";
import { projectIdSchema } from "../../projects/values.ts";

export const projectSummarySchema = z.strictObject({
  id: projectIdSchema,
  name: z.string(),
  purpose: z.string(),
  archived: z.boolean(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

// 보관한 project도 싣는다(앱 data는 남는다).
export const appProjects = defineRead({
  resource: "apps",
  method: "projects",
  name: "app.projects",
  input: z.strictObject({}),
  output: withReadCommon(z.object({ projects: z.array(projectSummarySchema) })),
  actors: ["app", "user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});
