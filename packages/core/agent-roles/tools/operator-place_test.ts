import { assertEquals } from "@std/assert";
import type { Place, Role } from "../../../protocol/lophn-agent/places.ts";
import { operatorPlaceAllowed } from "./operator-place.ts";

const project = (id: string): Place => ({ kind: "project", id }) as Place;

// Operator는 자기 place의 것만 만들고 고친다.
Deno.test("an Operator is changed only in the caller's own place", () => {
  const cases: [Role, Place | null, Place, boolean][] = [
    ["project_manager", project("prj_a"), project("prj_a"), true],
    ["project_manager", project("prj_a"), project("prj_b"), false],
    ["lophn", null, project("prj_a"), false],
    ["operator", project("prj_a"), project("prj_a"), false],
  ];
  for (const [role, own, target, allowed] of cases) {
    assertEquals(operatorPlaceAllowed(role, own, target), allowed);
  }
});
