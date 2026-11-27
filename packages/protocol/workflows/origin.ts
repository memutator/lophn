import { z } from "zod";
import { idSchema } from "../base/ids.ts";

export const workflowNameSchema = z
  .string()
  .max(63)
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);

// session이 속한 workflow instance와 step이다(`sessions.workflow_origin`). step을 넘길 때마다 갱신하고 team spawn 자식은 열 때 이어받는다.
export const workflowOriginSchema = z.strictObject({
  project: idSchema("prj"),
  workflow: workflowNameSchema,
  instance: idSchema("wfi"),
  step: z.string().min(1),
});
export type WorkflowOrigin = z.infer<typeof workflowOriginSchema>;
