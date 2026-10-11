import { assert, assertEquals } from "@std/assert";
import type { AgentDefinition } from "../../packages/contracts/lophn-agent/mod.ts";
import type { CoreCalls } from "./main.ts";
import { productDriver } from "./product-driver.ts";
import { discoverProductSkills } from "./skill-folders.ts";
import { ASG, HASH, MODEL, openWorld, RUN, SES } from "./testing/world.ts";

Deno.test("extensions#R1: 등록 폴더의 유효한 SKILL.md만 run context skills에 남고 잘못된 이름은 빠진다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-skill-scan-" });
  const root = `${home}/registered`;
  const outside = `${home}/outside/other`;
  try {
    await Deno.mkdir(`${root}/review-notes/nested`, { recursive: true });
    await Deno.mkdir(`${root}/bad-notes`, { recursive: true });
    await Deno.mkdir(outside, { recursive: true });
    await Deno.writeTextFile(
      `${root}/review-notes/SKILL.md`,
      "---\nname: review-notes\ndescription: Reads review notes\n---\n본문\n",
    );
    await Deno.writeTextFile(
      `${root}/review-notes/nested/SKILL.md`,
      "---\nname: nested-notes\ndescription: Nested skill\n---\n본문\n",
    );
    await Deno.writeTextFile(
      `${root}/bad-notes/SKILL.md`,
      "---\nname: Bad_Name\ndescription: Bad skill name\n---\n본문\n",
    );
    await Deno.writeTextFile(
      `${outside}/SKILL.md`,
      "---\nname: other-notes\ndescription: Outside the registered folder\n---\n본문\n",
    );
    await Deno.symlink(outside, `${root}/alias`);

    const calls = fakeCalls(root);
    const driver = productDriver()(calls);
    const prepared = await driver.prepare({
      run: RUN,
      assignment: ASG,
      session: null,
      stateSeq: "1",
      session: SES,
      reason: "priority",
    });
    assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
    const loop = prepared.value.loop(
      {
        run: RUN,
        assignment: ASG,
        token: "token",
        credential_ref: "cred",
      },
      { run: RUN, state_seq: "1", basis: HASH },
    );
    const context = await loop.deps.ports.context();
    assert(context.ok, context.ok ? "" : JSON.stringify(context.error));
    assertEquals(
      context.value.skills.map((skill) => skill.name),
      ["review-notes"],
    );
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

function skillSource(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n본문\n`;
}

async function writeSkill(
  folder: string,
  name: string,
  description: string,
): Promise<void> {
  await Deno.mkdir(`${folder}/${name}`, { recursive: true });
  await Deno.writeTextFile(
    `${folder}/${name}/SKILL.md`,
    skillSource(name, description),
  );
}

Deno.test("extensions#R1 extensions#R3: 등록 폴더, 개인 보관소, 동봉 skill 순으로 찾고 같은 이름은 먼저 찾은 하나만 쓰며 앱 소스·상위 폴더·중첩 꾸러미는 찾지 않는다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-skill-stores-" });
  const registered = `${home}/registered`;
  const personal = `${home}/data/skills`;
  const bundled = `${home}/install/assets/skills`;
  try {
    await writeSkill(registered, "review-notes", "Registered review notes");
    await writeSkill(personal, "review-notes", "Personal review notes");
    await writeSkill(personal, "personal-notes", "Personal notes");
    await writeSkill(`${personal}/personal-notes`, "nested-notes", "Nested");
    await writeSkill(bundled, "bundled-notes", "Bundled notes");
    await writeSkill(bundled, "personal-notes", "Bundled copy");
    // 등록 폴더의 상위와 앱 소스 폴더에 놓은 skill은 찾지 않는다.
    await writeSkill(home, "parent-notes", "Parent folder skill");
    await writeSkill(`${home}/app-source`, "app-notes", "App source skill");

    const found = await discoverProductSkills(
      fakeCalls(registered).machine,
      { personal, bundled },
    );
    assert(found !== null);
    assertEquals(
      found.entries.map((entry) => [entry.name, entry.source_kind]),
      [
        ["review-notes", "registered"],
        ["personal-notes", "personal"],
        ["bundled-notes", "bundled"],
      ],
    );
    assertEquals(found.entries[0].description, "Registered review notes");
    assertEquals(
      found.shadowing.map((each) => [each.name, each.dropped_bundle]),
      [
        ["review-notes", `${personal}/review-notes`],
        ["personal-notes", `${bundled}/personal-notes`],
      ],
    );

    // 개인 보관소와 동봉 폴더가 없으면 그 출처가 비었을 뿐 제외 진단은 아니다.
    const missing = await discoverProductSkills(
      fakeCalls(registered).machine,
      { personal: `${home}/none`, bundled: null },
    );
    assert(missing !== null);
    assertEquals(missing.entries.map((entry) => entry.name), ["review-notes"]);
    assertEquals(missing.skipped, []);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("extensions#R1 extensions#R4 lophn-agent/agents#R18: 제품 run은 data root의 개인 보관소를 찾고 agent 정의가 끄지 않은 skill만 선택으로 싣는다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-skill-personal-" });
  const previous = Deno.env.get("LOPHN_HOME");
  try {
    await writeSkill(`${home}/skills`, "personal-notes", "Personal notes");
    await writeSkill(`${home}/skills`, "other-notes", "Not chosen");
    Deno.env.set("LOPHN_HOME", home);
    const driver = productDriver()(
      fakeCalls(`${home}/registered`, {
        skills_off: ["other-notes"],
        body: "",
      }),
    );
    const prepared = await driver.prepare({
      run: RUN,
      assignment: ASG,
      session: null,
      stateSeq: "1",
      session: SES,
      reason: "priority",
    });
    assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
    const loop = prepared.value.loop(
      { run: RUN, assignment: ASG, token: "token", credential_ref: "cred" },
      { run: RUN, state_seq: "1", basis: HASH },
    );
    const context = await loop.deps.ports.context();
    assert(context.ok, context.ok ? "" : JSON.stringify(context.error));
    assertEquals(
      context.value.skills.map((skill) => [skill.name, skill.selected]),
      [["other-notes", false], ["personal-notes", true]],
    );
  } finally {
    if (previous === undefined) Deno.env.delete("LOPHN_HOME");
    else Deno.env.set("LOPHN_HOME", previous);
    await Deno.remove(home, { recursive: true });
  }
});

function fakeCalls(
  root: string,
  definition: AgentDefinition | null = null,
): CoreCalls {
  return openWorld({
    skillRoot: root,
    definition,
    workspaceModels: { lophn: MODEL() },
  }).calls;
}
