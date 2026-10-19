import { assertEquals } from "@std/assert";
import {
  appIdOfFolder,
  lophnAgentsFolder,
  placeAgentsFolder,
  placeDataFolder,
  projectIdOfFolder,
  projectsDataArea,
} from "./data-folder.ts";

Deno.test("data root 아래 정의·설정 자리는 전과 같다", () => {
  const project = { kind: "project", id: "prj_a1" } as const;
  assertEquals(projectsDataArea("/r"), "/r/projects");
  assertEquals(placeDataFolder("/r", project), "/r/projects/prj_a1");
  assertEquals(placeAgentsFolder("/r", project), "/r/projects/prj_a1/agents");
  assertEquals(
    placeDataFolder("/r", { kind: "app", id: "app_b2" }),
    "/r/apps/app_b2",
  );
  assertEquals(lophnAgentsFolder("/r"), "/r/agents");
  assertEquals(projectIdOfFolder("prj_a1"), "prj_a1");
  assertEquals(appIdOfFolder("app_b2"), "app_b2");
  assertEquals(appIdOfFolder("prj_a1"), null);
  for (const name of ["app_b2", "prj_", "prj_A1", "x.json", "prj_a1/x"]) {
    assertEquals(projectIdOfFolder(name), null);
  }
});
