import assert from "node:assert/strict";
import { test } from "node:test";
import { agentFilePathOf, mayReadOtherProject } from "./instruction-rules.ts";

const project = { kind: "project", id: "prj_a1" } as const;

test("다른 project 지침은 lophn만 읽는다", () => {
  assert.deepStrictEqual(mayReadOtherProject("lophn"), true);
  for (const role of ["project_manager", "operator"] as const) {
    assert.deepStrictEqual(mayReadOtherProject(role), false);
  }
});

test("role 3개의 정의 file 경로는 전과 같다", () => {
  const of = (
    role: "lophn" | "project_manager" | "operator",
    place: typeof project | null,
    operator: string | null = null,
  ) => agentFilePathOf("/r", { role, operator, place });
  assert.deepStrictEqual(of("lophn", null), "/r/agents/lophn.md");
  assert.deepStrictEqual(
    of("project_manager", project),
    "/r/projects/prj_a1/agents/project-manager.md",
  );
  assert.deepStrictEqual(
    of("operator", project, "agt_c3"),
    "/r/projects/prj_a1/agents/agt_c3.md",
  );
  // place나 정체성이 없으면 자리를 못 구한다.
  assert.deepStrictEqual(of("operator", project), null);
  assert.deepStrictEqual(of("operator", null, "agt_c3"), null);
});
