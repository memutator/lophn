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
  artifactsFolder: "/art",
  kindsFile: "/data/projects/p/kinds.yaml",
  appSource: "/app",
  allProjectFolders: ["/p1", "/p2", "/q"],
};
const project = { kind: "project", id: "p" } as const;
const app = { kind: "app", id: "a" } as const;

Deno.test("placeScope는 role별로 file tool이 닿는 폴더와 쓸 수 있는 폴더를 표 그대로 낸다", () => {
  const table: [Partial<PlaceFacts>, { read: string[]; write: string[] }][] = [
    // lophn은 모든 project 폴더를 읽기만 한다
    [{ role: "lophn" }, { read: ["/p1", "/p2", "/q"], write: [] }],
    // kinds 파일은 PM만 쓴다. artifacts 폴더는 PM과 project place의 Operator만, project 폴더 뒤에 온다
    [
      { role: "project_manager", place: project },
      {
        read: ["/p1", "/p2", "/art", "/data/projects/p/kinds.yaml"],
        write: ["/p1", "/p2", "/art", "/data/projects/p/kinds.yaml"],
      },
    ],
    [
      { role: "operator", place: project },
      { read: ["/p1", "/p2", "/art"], write: ["/p1", "/p2", "/art"] },
    ],
    [
      { role: "operator", place: project, artifactsFolder: null },
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

Deno.test("runtimeFolders는 모든 project 폴더, artifacts 폴더, 앱 source를 read·write에 한 번씩 담고 write에 kinds 파일을 더한다", () => {
  assertEquals(
    runtimeFolders({
      kindsFiles: ["/data/projects/p/kinds.yaml"],
      projectFolders: ["/p1", "/p2", "/p1"],
      artifactFolders: ["/p1/a", "/q/a"],
      appSources: ["/app", "/p2"],
    }),
    {
      read: ["/p1", "/p2", "/p1/a", "/q/a", "/app"],
      write: [
        "/p1",
        "/p2",
        "/p1/a",
        "/q/a",
        "/app",
        "/data/projects/p/kinds.yaml",
      ],
    },
  );
});
