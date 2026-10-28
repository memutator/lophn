import assert from "node:assert/strict";
import { test } from "node:test";
import { type PlaceFacts, placeScope } from "./place-folders.ts";

const domain = (id: string) => ({
  id,
  folder: `/data/domains/${id}`,
});
const base: PlaceFacts = {
  place: null,
  projectFolders: ["/p1", "/p2"],
  appSource: "/app",
  domains: [domain("dom_a"), domain("dom_b")],
  dataFolder: "/data/projects/prj_a",
  allProjectFolders: ["/p1", "/p2", "/q"],
  workflowsFolder: "/data/projects/prj_a/workflows",
};
const workflows = "/data/projects/prj_a/workflows";
const project = { kind: "project", id: "prj_a" } as const;
const app = { kind: "app", id: "app_a" } as const;

// 이 규칙이 넓어지면 project place session이 앱 source를, app place session이 사람의 project 폴더나
// workflows/를, home session이 아무 폴더나 쓴다.
test("place 종류마다 쓰기 폴더는 그 그릇의 폴더와 받은 domain 폴더뿐이다", () => {
  const projectPlace = placeScope({
    ...base,
    place: project,
    domains: [domain("dom_a")],
  });
  assert.deepStrictEqual(projectPlace, {
    read: ["/p1", "/p2", "/data/domains/dom_a", workflows],
    write: ["/p1", "/p2", "/data/domains/dom_a", workflows],
    base: "/p1",
  });
  const appPlace = placeScope({
    ...base,
    place: app,
    domains: [domain("dom_a")],
  });
  assert.deepStrictEqual(appPlace, {
    read: ["/app", "/data/domains/dom_a"],
    write: ["/app", "/data/domains/dom_a"],
    base: "/app",
  });
  // 폴더 없는 project는 domain 폴더와 workflows/만 열고 상대 경로 기준은 data 폴더다
  assert.deepStrictEqual(
    placeScope({
      ...base,
      place: project,
      projectFolders: [],
      domains: [domain("dom_a")],
    }),
    {
      read: ["/data/domains/dom_a", workflows],
      write: ["/data/domains/dom_a", workflows],
      base: "/data/projects/prj_a",
    },
  );
  // home은 모든 project 폴더를 읽기만 한다
  assert.deepStrictEqual(placeScope({ ...base, place: null }), {
    read: ["/p1", "/p2", "/q"],
    write: [],
  });
});
