import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { createNodeSkillFiles } from "../extensions/adapters/node-fs.ts";
import { discoverSkills, skillReceived } from "../extensions/skills.ts";
import { parseAgentFile } from "./definition-file.ts";
import { createSkillsOffStep } from "./skills-off-step.ts";

// 옛 `skills`를 가진 agent 파일을 옮긴 뒤에도 그 agent가 받는 skill이 같아야 한다. 어긋나면 agent가 갑자기 skill을 잃거나
// 받지 않던 skill을 받는다.
test("옛 skills를 옮긴 뒤에도 agent가 받는 skill 집합이 같다", async () => {
  const root = await mkdtemp(`${tmpdir()}/skills-off-`);
  try {
    const DOM_A = "dom_00000000000000000000000001";
    const DOM_B = "dom_00000000000000000000000002";
    const skill = async (folder: string, name: string) => {
      await mkdir(`${root}/${folder}/${name}`, { recursive: true });
      await writeFile(
        `${root}/${folder}/${name}/SKILL.md`,
        `---\nname: ${name}\ndescription: ${name} skill\n---\nbody\n`,
      );
    };
    await skill("bundled", "new-app");
    await skill("skills", "a");
    await skill("skills", "b");
    await skill(`domains/${DOM_A}/skills`, "in-a");
    await skill(`domains/${DOM_B}/skills`, "in-b");
    await mkdir(`${root}/agents`);
    const file = `${root}/agents/agt_01.md`;
    await writeFile(
      file,
      `---\nname: Writer\nskills: [a, in-a, new-app]\ndomains: [${DOM_A}]\n---\nHello\n`,
    );

    // 옛 규칙의 후보: 전역 층과 맡은 domain(DOM_A)의 skill.
    const sources = {
      bundled: `${root}/bundled`,
      registered: [],
      personal: `${root}/skills`,
    };
    const listed = [
      null,
      `${root}/domains/${DOM_A}/skills`,
      `${root}/domains/${DOM_B}/skills`,
    ]
      .flatMap((workspaceData, at) =>
        discoverSkills(
          createNodeSkillFiles(),
          { ...sources, workspaceData },
          { kind: null, off: [] },
        ).entries.map((one) => ({ ...one, mine: at !== 2 })),
      )
      .filter((one) => one.mine);
    const before = listed
      .filter(
        (one) =>
          !one.can_disable || ["a", "in-a", "new-app"].includes(one.name),
      )
      .map((one) => one.name);

    const step = createSkillsOffStep(`${root}/bundled`);
    assert.deepStrictEqual((await step.run(root)).ok, true);

    const text = await readFile(file, "utf8");
    assert.ok(!/^skills:/m.test(text), text);
    const moved = parseAgentFile(text, { agent: "agt_01" as never });
    assert.ok(moved.ok);
    const after = listed
      .filter((one) => skillReceived(one, moved.value.skills_off ?? []))
      .map((one) => one.name);
    assert.deepStrictEqual(
      [...new Set(after)].sort(),
      [...new Set(before)].sort(),
    );
    assert.deepStrictEqual(moved.value.skills_off, ["b"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
