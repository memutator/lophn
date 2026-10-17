import { assertEquals } from "@std/assert";
import type { Role } from "../../../../protocol/lophn-agent/places.ts";
import { contextVisible, type VisiblePlace } from "./visible.ts";

const project = (id: string): VisiblePlace => ({ kind: "project", id });
const app = (id: string, owner: string | null): VisiblePlace => ({
  kind: "app",
  id,
  project: owner,
});

// Operator는 정의에 붙지 않은 context를 읽지 못하고, 나머지 role도 자기 범위 밖은 읽지 못한다.
Deno.test("a context is readable only inside the role's range", () => {
  const target = { context: "ctx_a", project: "prj_a" };
  const cases: [Role, VisiblePlace, string[], boolean][] = [
    ["lophn", null, [], true],
    ["project_manager", project("prj_a"), [], true],
    ["project_manager", project("prj_b"), [], false],
    ["app_engineer", app("app_a", "prj_a"), [], true],
    ["app_engineer", app("app_a", "prj_b"), [], false],
    ["app_engineer", app("app_a", null), [], false],
    ["operator", project("prj_a"), ["ctx_a"], true],
    ["operator", project("prj_a"), ["ctx_b"], false],
    ["operator", project("prj_a"), [], false],
    ["operator", app("app_a", null), ["ctx_a"], true],
    ["operator", app("app_a", "prj_a"), [], false],
  ];
  for (const [role, place, attached, expected] of cases) {
    assertEquals(
      contextVisible(role, place, attached, target),
      expected,
      `${role} ${JSON.stringify(place)} ${attached}`,
    );
  }
});
