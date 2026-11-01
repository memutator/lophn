import assert from "node:assert/strict";
import { test } from "node:test";

import type { InstallPorts } from "./install-common.ts";
import { type SharedSkill, syncSkillCopies } from "./skill-copies.ts";

// file Map 위의 대역이다. 폴더는 file의 path 앞부분이고 비지 않은 폴더는 지워지지 않는다.
function memory(files: Map<string, string>): InstallPorts {
  const below = (dir: string) => [
    ...new Set(
      [...files.keys()]
        .filter((path) => path.startsWith(`${dir}/`))
        .map((path) => path.slice(dir.length + 1).split("/")[0]),
    ),
  ];
  return {
    read: (path) => Promise.resolve(files.get(path) ?? null),
    write: (path, text) => {
      files.set(path, text);
      return Promise.resolve();
    },
    list: (dir) => {
      const names = below(dir);
      return Promise.resolve(names.length === 0 ? null : names);
    },
    remove: (path) => {
      if (files.delete(path)) return Promise.resolve();
      if (below(path).length > 0) {
        return Promise.reject(new Error("directory not empty"));
      }
      return Promise.resolve();
    },
  };
}

const DIR = "/home/u/.claude/skills";
const skill = (
  name: string,
  extra: SharedSkill["files"] = [],
): SharedSkill => ({
  slug: "notes",
  release: "rel_1",
  name,
  skill_md: `# ${name} v2`,
  files: extra,
});

// 사람이 둔 같은 이름의 skill은 그대로 두고, 표시 file이 있는 폴더만 덮고 지운다. 지울 때 사람이 넣은 file은 남는다.
test("sync는 표시 file이 있는 폴더만 덮고 지우며 사람의 같은 이름 폴더는 둔다", async () => {
  const files = new Map<string, string>([
    [`${DIR}/mine/SKILL.md`, "human"],
    [`${DIR}/lophn-owned/SKILL.md`, "old"],
    [
      `${DIR}/lophn-owned/.lophn-shared`,
      JSON.stringify({ app: "notes", release: "rel_0", files: ["SKILL.md"] }),
    ],
    [`${DIR}/gone/SKILL.md`, "old"],
    [`${DIR}/gone/refs/a.md`, "old"],
    [`${DIR}/gone/mine.txt`, "human"],
    [
      `${DIR}/gone/.lophn-shared`,
      JSON.stringify({
        app: "notes",
        release: "rel_0",
        files: ["SKILL.md", "refs/a.md"],
      }),
    ],
  ]);
  const done = await syncSkillCopies(memory(files), {
    dir: DIR,
    skills: [
      skill("mine"),
      skill("lophn-owned", [{ name: "refs/b.md", text: "b" }]),
      skill("../escape"),
      skill("fresh", [{ name: "../x.md", text: "x" }]),
    ],
  });
  assert.equal(files.get(`${DIR}/mine/SKILL.md`), "human");
  assert.equal(files.has(`${DIR}/mine/.lophn-shared`), false);
  assert.equal(files.get(`${DIR}/lophn-owned/SKILL.md`), "# lophn-owned v2");
  assert.equal(files.get(`${DIR}/lophn-owned/refs/b.md`), "b");
  assert.equal(files.has(`${DIR}/gone/SKILL.md`), false);
  assert.equal(files.has(`${DIR}/gone/refs/a.md`), false);
  assert.equal(files.has(`${DIR}/gone/.lophn-shared`), false);
  assert.equal(files.get(`${DIR}/gone/mine.txt`), "human");
  assert.deepEqual(done.written, ["lophn-owned"]);
  assert.deepEqual(done.removed, ["gone"]);
  assert.deepEqual(
    done.skipped.map((one) => one.name),
    ["mine", "../escape", "fresh"],
  );
  assert.equal(
    [...files.keys()].some((path) => path.includes("..")),
    false,
  );
});
