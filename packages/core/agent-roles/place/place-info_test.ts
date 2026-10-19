import { assert, assertEquals } from "@std/assert";
import { type PlaceData, placeInfo, type PlaceProject } from "./place-info.ts";

function project(id: string, name: string): PlaceProject {
  return { id, name, purpose: `${name} purpose`, folders: [], subfolders: [] };
}

const data: PlaceData = {
  self: { role: "operator", name: "Mina" },
  project: project("prj_1", "own"),
  app: null,
  agents: [],
  kinds: null,
  kindsFile: null,
  apps: [],
  projects: [],
  release: null,
  artifacts: null,
  skillsFolder: null,
};

Deno.test("PM의 place 정보에 artifact 목록이 이름 순으로 실리고 50개를 넘으면 줄어든다", () => {
  const items = Array.from({ length: 52 }, (_, i) => ({
    name: `a${String(i).padStart(2, "0")}`,
    title: `Title ${i}`,
    description: i === 0 ? "" : "desc",
  }));
  const text = placeInfo("project_manager", {
    ...data,
    self: { role: "project_manager", name: "own" },
    artifacts: { folder: "/data/artifacts", items: items.reverse() },
  }, 100_000);
  assert(text.includes("Folder: /data/artifacts"));
  assert(text.includes("- a00: Title 0 (artifacts/a00/index.html)"));
  assert(text.includes("- a01: Title 1 — desc (artifacts/a01/index.html)"));
  assert(!text.includes("a50:"));
  assertEquals(text.split("\n").filter((l) => l === "2 more").length, 1);
  assert(!placeInfo("operator", data, 100_000).includes("Artifacts"));
});
