import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import { createAppSkillsDeps, readAppSkills } from "./skills.ts";

const manifest = (name: string) =>
  `---\nname: ${name}\ndescription: ${name} desc\n---\nbody of ${name}`;

// 다른 agent에게 주는 것은 선언에서 public인 skill뿐이고, bundle 밖을 가리키는 symlink는 읽지 않는다.
test("app skills read gives only declared public skills inside the bundle", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "lophn-app-skills-"));
  try {
    const bundle = `${tmp}/bundle`;
    const skills = `${bundle}/.lophn/skills`;
    for (const name of ["pub", "priv", "undeclared", "linked"]) {
      await mkdir(`${skills}/${name}`, { recursive: true });
      await writeFile(`${skills}/${name}/SKILL.md`, manifest(name));
    }
    await writeFile(`${skills}/pub/extra.md`, "EXTRA");
    await writeFile(`${skills}/pub/notes.txt`, "NOT MD");
    await rm(`${skills}/linked`, { recursive: true });
    await mkdir(`${tmp}/outside`);
    await writeFile(`${tmp}/outside/SKILL.md`, manifest("linked"));
    await symlink(`${tmp}/outside`, `${skills}/linked`);

    const read = await readAppSkills(
      createAppSkillsDeps({ dir: () => ok(bundle) }),
      "app_x",
      [
        { name: "pub", public: true },
        { name: "priv", public: false },
        { name: "linked", public: true },
      ],
    );
    assert.deepStrictEqual(
      read.map((skill) => [skill.name, skill.files.map((file) => file.name)]),
      [["pub", ["extra.md"]]],
    );
    assert.strictEqual(read[0].description, "pub desc");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
