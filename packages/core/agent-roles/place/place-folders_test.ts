import { assertEquals } from "@std/assert";
import {
  type FolderScope,
  type PlaceFacts,
  placeScope,
  runtimeFolders,
} from "./place-folders.ts";

const base: PlaceFacts = {
  role: "operator",
  place: null,
  projectFolders: ["/p1", "/p2"],
  artifactsFolder: "/art",
  kindsFile: "/data/projects/prj_a/kinds.yaml",
  appSource: "/app",
  skillsFolder: "/data/projects/prj_a/skills",
  dataFolder: "/data/projects/prj_a",
  allProjectFolders: ["/p1", "/p2", "/q"],
};
const project = { kind: "project", id: "prj_a" } as const;

Deno.test("placeScope는 role별로 file tool이 닿는 폴더와 쓸 수 있는 폴더를 표 그대로 낸다", () => {
  const skills = "/data/projects/prj_a/skills";
  const kinds = "/data/projects/prj_a/kinds.yaml";
  const table: [Partial<PlaceFacts>, FolderScope][] = [
    // lophn은 모든 project 폴더를 읽기만 한다
    [{ role: "lophn" }, { read: ["/p1", "/p2", "/q"], write: [] }],
    // PM: project 폴더, artifacts, kinds 파일, 그 project 앱의 source, skill 폴더뿐이다. 앱의 `app/`(data·release 사본)이나
    // 다른 project의 앱 source는 facts에 없으니 들어올 수 없다.
    [
      { role: "project_manager", place: project },
      {
        read: ["/p1", "/p2", "/art", kinds, "/app", skills],
        write: ["/p1", "/p2", "/art", kinds, "/app", skills],
        base: "/p1",
      },
    ],
    // 앱이 없는 project의 PM
    [
      { role: "project_manager", place: project, appSource: null },
      {
        read: ["/p1", "/p2", "/art", kinds, skills],
        write: ["/p1", "/p2", "/art", kinds, skills],
        base: "/p1",
      },
    ],
    // 폴더 없는 project의 PM: 상대 경로 기준은 project의 data 폴더이고 허락은 늘지 않는다
    [
      {
        role: "project_manager",
        place: project,
        projectFolders: [],
        artifactsFolder: null,
        appSource: null,
      },
      {
        read: [kinds, skills],
        write: [kinds, skills],
        base: "/data/projects/prj_a",
      },
    ],
    // Operator는 kinds 파일, 앱 source, skill 폴더가 없다. artifacts 폴더는 project 폴더 뒤에 온다
    [
      { role: "operator", place: project },
      {
        read: ["/p1", "/p2", "/art"],
        write: ["/p1", "/p2", "/art"],
        base: "/p1",
      },
    ],
    [
      { role: "operator", place: project, artifactsFolder: null },
      { read: ["/p1", "/p2"], write: ["/p1", "/p2"], base: "/p1" },
    ],
    [{ role: "project_manager", place: null }, { read: [], write: [] }],
  ];
  for (const [facts, want] of table) {
    assertEquals(
      placeScope({ ...base, ...facts }),
      want,
      JSON.stringify(facts),
    );
  }
});

Deno.test("runtimeFolders는 모든 project 폴더, artifacts·skill 폴더, 앱 source를 read·write에 한 번씩 담고 write에 kinds 파일을 더한다", () => {
  assertEquals(
    runtimeFolders({
      kindsFiles: ["/data/projects/p/kinds.yaml"],
      projectFolders: ["/p1", "/p2", "/p1"],
      artifactFolders: ["/p1/a", "/q/a"],
      skillFolders: ["/d/p1/skills"],
      appSources: ["/app", "/p2"],
    }),
    {
      read: ["/p1", "/p2", "/p1/a", "/q/a", "/d/p1/skills", "/app"],
      write: [
        "/p1",
        "/p2",
        "/p1/a",
        "/q/a",
        "/d/p1/skills",
        "/app",
        "/data/projects/p/kinds.yaml",
      ],
    },
  );
});
