import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appIdOfFolder,
  workspaceDataFolder,
  projectIdOfFolder,
  projectsDataArea,
} from "./data-folder.ts";

test("data root 아래 정의·설정 자리는 전과 같다", () => {
  const project = { kind: "project", id: "prj_a1" } as const;
  assert.deepStrictEqual(projectsDataArea("/r"), "/r/projects");
  assert.deepStrictEqual(
    workspaceDataFolder("/r", project),
    "/r/projects/prj_a1",
  );
  assert.deepStrictEqual(
    workspaceDataFolder("/r", { kind: "app", id: "app_b2" }),
    "/r/apps/app_b2",
  );
  assert.deepStrictEqual(projectIdOfFolder("prj_a1"), "prj_a1");
  assert.deepStrictEqual(appIdOfFolder("app_b2"), "app_b2");
  assert.deepStrictEqual(appIdOfFolder("prj_a1"), null);
  for (const name of ["app_b2", "prj_", "prj_A1", "x.json", "prj_a1/x"]) {
    assert.deepStrictEqual(projectIdOfFolder(name), null);
  }
});
