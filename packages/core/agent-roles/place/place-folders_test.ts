import { assertEquals } from "@std/assert";
import {
  type PlaceFacts,
  placeScope,
  runtimeFolders,
} from "./place-folders.ts";

const base: PlaceFacts = {
  role: "operator",
  place: null,
  projectFolders: ["/p1", "/p2"],
  draftFolders: ["/draft"],
  appSource: "/app",
  allProjectFolders: ["/p1", "/p2", "/q"],
};
const project = { kind: "project", id: "p" } as const;
const app = { kind: "app", id: "a" } as const;

Deno.test("placeScope는 role별로 file tool이 닿는 폴더와 쓸 수 있는 폴더를 표 그대로 낸다", () => {
  const table: [Partial<PlaceFacts>, { read: string[]; write: string[] }][] = [
    // lophn은 모든 project 폴더를 읽기만 한다
    [{ role: "lophn" }, { read: ["/p1", "/p2", "/q"], write: [] }],
    // 초안 폴더는 PM만
    [
      { role: "project_manager", place: project },
      { read: ["/p1", "/p2", "/draft"], write: ["/p1", "/p2", "/draft"] },
    ],
    [
      { role: "operator", place: project },
      { read: ["/p1", "/p2"], write: ["/p1", "/p2"] },
    ],
    [
      { role: "app_engineer", place: app },
      { read: ["/app"], write: ["/app"] },
    ],
    // 앱 place의 Operator는 쓰기 없음
    [{ role: "operator", place: app }, { read: ["/app"], write: [] }],
    [{ role: "operator", place: app, appSource: null }, {
      read: [],
      write: [],
    }],
    [{ role: "app_engineer", place: project }, { read: [], write: [] }],
  ];
  for (const [facts, want] of table) {
    assertEquals(
      placeScope({ ...base, ...facts }),
      want,
      JSON.stringify(facts),
    );
  }
});

Deno.test("runtimeFolders는 모든 project 폴더와 앱 source를 read·write에 한 번씩 담고 write에 draftRoot를 더한다", () => {
  assertEquals(
    runtimeFolders({
      draftRoot: "/drafts",
      projectFolders: ["/p1", "/p2", "/p1"],
      appSources: ["/app", "/p2"],
    }),
    {
      read: ["/p1", "/p2", "/app"],
      write: ["/p1", "/p2", "/app", "/drafts"],
    },
  );
});
