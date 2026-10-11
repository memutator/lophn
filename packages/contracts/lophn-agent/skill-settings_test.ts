import { assert, assertEquals } from "@std/assert";
import {
  SKILL_SOURCE_KINDS,
  skillShadowSchema,
  skillSkippedSchema,
  skillSummarySchema,
} from "./skill-settings.ts";

Deno.test("lophn-agent/extensions#R1 [agent-I19b]: a skill comes from the place, a registered folder, the personal store or the bundle, in that order", () => {
  assertEquals([...SKILL_SOURCE_KINDS], [
    "place",
    "registered",
    "personal",
    "bundled",
  ]);
  for (const source_kind of SKILL_SOURCE_KINDS) {
    assert(
      skillSummarySchema.safeParse({
        name: "review-notes",
        description: "Reads review notes",
        source_kind,
      }).success,
    );
  }
  assert(
    !skillSummarySchema.safeParse({
      name: "review-notes",
      description: "Reads review notes",
      source_kind: "workspace",
    }).success,
  );
});

Deno.test("lophn-agent/extensions#R33 [agent-I19b]: a hidden skill is reported with the source that won and the source that lost", () => {
  assert(
    skillShadowSchema.safeParse({
      name: "review-notes",
      kept: "place",
      hidden: "registered",
    }).success,
  );
  assert(
    !skillShadowSchema.safeParse({
      name: "review-notes",
      kept: "place",
      hidden: "elsewhere",
    }).success,
  );
});

Deno.test("lophn-agent/extensions#R2 [agent-I19b]: an excluded skill folder is reported with its path and the reason", () => {
  assert(
    skillSkippedSchema.safeParse({
      path: "/data/projects/prj/skills/Bad_Name",
      reason: "skill name uses characters outside lowercase letters",
    }).success,
  );
  assert(!skillSkippedSchema.safeParse({ path: "/x" }).success);
});
