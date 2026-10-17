import { assertEquals } from "@std/assert";
import { agentFilePathOf, mayReadOtherProject } from "./instruction-rules.ts";

const project = { kind: "project", id: "prj_a1" } as const;
const app = { kind: "app", id: "app_b2" } as const;

Deno.test("다른 project 지침은 lophn만 읽는다", () => {
  assertEquals(mayReadOtherProject("lophn"), true);
  for (const role of ["project_manager", "app_engineer", "operator"] as const) {
    assertEquals(mayReadOtherProject(role), false);
  }
});

Deno.test("role 4개의 정의 file 경로는 전과 같다", () => {
  const of = (
    role: "lophn" | "project_manager" | "app_engineer" | "operator",
    place: typeof project | typeof app | null,
    operator: string | null = null,
  ) => agentFilePathOf("/r", { role, operator, place });
  assertEquals(of("lophn", null), "/r/agents/lophn.md");
  assertEquals(
    of("project_manager", project),
    "/r/projects/prj_a1/agents/project-manager.md",
  );
  assertEquals(
    of("app_engineer", app),
    "/r/apps/app_b2/agents/app-engineer.md",
  );
  assertEquals(
    of("operator", app, "agt_c3"),
    "/r/apps/app_b2/agents/agt_c3.md",
  );
  assertEquals(
    of("operator", project, "agt_c3"),
    "/r/projects/prj_a1/agents/agt_c3.md",
  );
  // place나 정체성이 없으면 자리를 못 구한다.
  assertEquals(of("project_manager", app), null);
  assertEquals(of("app_engineer", null), null);
  assertEquals(of("operator", project), null);
  assertEquals(of("operator", null, "agt_c3"), null);
});
