import { assert } from "@std/assert";
import { createAppEngineerAssignmentInputSchema } from "./assignments.ts";

const asg = "asg_01arz3ndektsv4rrffq69g5fav";
const pst = "pst_01arz3ndektsv4rrffq69g5fav";
const app = "app_01arz3ndektsv4rrffq69g5fav";

Deno.test("lophn-agent/harness/model#R8: an app engineer is created from one preset revision", () => {
  assert(
    createAppEngineerAssignmentInputSchema.safeParse({
      id: asg,
      app_created_seq: "12",
      app,
      preset: pst,
      preset_revision: 1,
    }).success,
  );
  assert(
    !createAppEngineerAssignmentInputSchema.safeParse({
      id: asg,
      app_created_seq: "12",
      app,
      preset: pst,
      preset_revision: 1,
      model: "other",
    }).success,
  );
  assert(
    !createAppEngineerAssignmentInputSchema.safeParse({
      id: asg,
      app_created_seq: "12",
      app: "prj_01arz3ndektsv4rrffq69g5fav",
      preset: pst,
      preset_revision: 1,
    }).success,
  );
});
