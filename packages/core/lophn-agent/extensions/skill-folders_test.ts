import { assert, assertEquals } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import {
  type AgentDefinition,
  skillFoldersSetting,
  skillsOffSetting,
} from "../../../protocol/lophn-agent/mod.ts";
import { routePath, settingsGet } from "../../../protocol/server/mod.ts";
import type { CoreCall } from "../run-loop/core-call.ts";
import type { CoreCalls } from "../../main/agent-runtime/main.ts";
import { productDriver } from "../../main/agent-runtime/product-driver.ts";
import { discoverProductSkills, productSkillStores } from "./skill-folders.ts";
import {
  APP,
  ASG,
  HASH,
  MODEL,
  openWorld,
  OTHER_PRJ,
  PRJ,
  RUN,
  SES,
  type WorldOptions,
} from "../../main/agent-runtime/testing/world.ts";

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

Deno.test("extensions#R1 extensions#R33 [agent-I19b]: 자리 skill 폴더가 등록 폴더보다 먼저고 같은 이름은 자리의 것을 쓰며 자리 밖 폴더는 찾지 않는다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-skill-place-" });
  const registered = `${home}/registered`;
  const personal = `${home}/data/skills`;
  const place = `${home}/data/projects/${PRJ}/skills`;
  try {
    await writeSkill(place, "review-notes", "Place review notes");
    await writeSkill(place, "phroner-style", "Only this project");
    await writeSkill(registered, "review-notes", "Registered review notes");
    await writeSkill(registered, "audit", "Registered audit");
    await writeSkill(personal, "personal-notes", "Personal notes");
    // 다른 project의 skill 폴더는 이 자리의 stores에 없으므로 찾지 않는다.
    await writeSkill(
      `${home}/data/projects/${OTHER_PRJ}/skills`,
      "other-project",
      "Another project",
    );

    const found = await discoverProductSkills(
      fakeCalls(registered).machine,
      { place, personal, bundled: null },
    );
    assert(found !== null);
    assertEquals(
      found.entries.map((entry) => [entry.name, entry.source_kind]),
      [
        ["phroner-style", "place"],
        ["review-notes", "place"],
        ["audit", "registered"],
        ["personal-notes", "personal"],
      ],
    );
    assertEquals(found.entries[1].description, "Place review notes");
    assertEquals(
      found.shadowing.map((each) => [each.name, each.dropped_bundle]),
      [["review-notes", `${registered}/review-notes`]],
    );

    // 아직 만들지 않은 자리 폴더는 그 출처가 비어 있을 뿐 제외 진단이 아니다.
    const empty = await discoverProductSkills(
      fakeCalls(registered).machine,
      { place: `${home}/data/projects/none/skills`, personal, bundled: null },
    );
    assert(empty !== null);
    assertEquals(empty.skipped, []);
    assertEquals(empty.entries.map((entry) => entry.name), [
      "audit",
      "review-notes",
      "personal-notes",
    ]);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("extensions#R32 [agent-I19b]: 자리의 skill 폴더는 data root 아래 그 자리의 폴더이고 자리가 없으면 없다", () => {
  const previous = Deno.env.get("LOPHN_HOME");
  try {
    Deno.env.set("LOPHN_HOME", "/data/home/");
    assertEquals(
      productSkillStores({ kind: "project", id: PRJ }).place,
      `/data/home/projects/${PRJ}/skills`,
    );
    assertEquals(
      productSkillStores({ kind: "app", id: APP }).place,
      `/data/home/apps/${APP}/skills`,
    );
    assertEquals(productSkillStores(null).place, null);
  } finally {
    if (previous === undefined) Deno.env.delete("LOPHN_HOME");
    else Deno.env.set("LOPHN_HOME", previous);
  }
});

type PreparedWorld = {
  names: [string, boolean][];
};

// LOPHN_HOME 아래에 자리 skill을 놓고 run을 준비해 run context가 싣는 skill 목록을 본다.
async function skillsOfRun(
  home: string,
  options: WorldOptions,
): Promise<PreparedWorld> {
  const previous = Deno.env.get("LOPHN_HOME");
  try {
    Deno.env.set("LOPHN_HOME", home);
    const world = openWorld({
      workspaceModels: { lophn: MODEL(), operator: MODEL() },
      ...options,
    });
    const prepared = await productDriver()(world.calls).prepare({
      run: RUN,
      assignment: ASG,
      stateSeq: "1",
      session: options.session === null ? null : SES,
      reason: "priority",
    });
    assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
    const loop = prepared.value.loop(
      { run: RUN, assignment: ASG, token: "token", credential_ref: "cred" },
      { run: RUN, state_seq: "1", basis: HASH },
    );
    const context = await loop.deps.ports.context();
    assert(context.ok, context.ok ? "" : JSON.stringify(context.error));
    return {
      names: context.value.skills.map((
        skill,
      ) => [skill.name, skill.selected]),
    };
  } finally {
    if (previous === undefined) Deno.env.delete("LOPHN_HOME");
    else Deno.env.set("LOPHN_HOME", previous);
  }
}

Deno.test("extensions#R32 extensions#R4 lophn-agent/agents#R18 [agent-I19b]: 한 자리에서 여는 agent는 그 자리의 skill만 더 받고 agent 정의가 끈 것은 꺼진 채 싣는다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-skill-run-place-" });
  try {
    await writeSkill(`${home}/skills`, "personal-notes", "Personal");
    await writeSkill(`${home}/projects/${PRJ}/skills`, "here-only", "Here");
    await writeSkill(`${home}/projects/${PRJ}/skills`, "turn-off", "Off");
    await writeSkill(
      `${home}/projects/${OTHER_PRJ}/skills`,
      "there-only",
      "There",
    );
    await writeSkill(`${home}/apps/${APP}/skills`, "app-only", "App");

    // project 자리의 session: 그 자리의 skill과 전역의 skill이다.
    const inProject = await skillsOfRun(home, {
      session: { kind: "project", id: PRJ },
      definition: { skills_off: ["turn-off"], body: "" },
    });
    assertEquals(inProject.names, [
      ["here-only", true],
      ["turn-off", false],
      ["personal-notes", true],
    ]);

    // 다른 project와 앱에서 여는 같은 built-in agent는 이 자리의 skill을 받지 않는다.
    const inOther = await skillsOfRun(home, {
      session: { kind: "project", id: OTHER_PRJ },
    });
    assertEquals(inOther.names, [
      ["there-only", true],
      ["personal-notes", true],
    ]);
    const inApp = await skillsOfRun(home, {
      session: { kind: "app", id: APP },
    });
    assertEquals(inApp.names, [
      ["app-only", true],
      ["personal-notes", true],
    ]);
  } finally {
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

// 설정 두 줄만 답하는 machine 호출이다. 값이 없는 key는 설정하지 않은 것(resolved false)으로 답한다.
function machineWithSettings(values: Record<string, unknown>): CoreCall {
  return (path, body) => {
    assertEquals(path, routePath(settingsGet));
    const keys = (body as { keys: string[] }).keys;
    return Promise.resolve(ok({
      settings: keys.map((key) => ({
        key,
        resolved: key in values,
        value: values[key] ?? null,
        source_layer: key in values ? "common" : null,
        choices: [],
        revision: 1,
        apply_at: "next_run",
      })),
      revision: 1,
      defaults_revision: "defaults-1",
      as_of_seq: "1",
      next_cursor: null,
    }));
  };
}

Deno.test("extensions#R4 shell/desktop#Q22 [agent-I49]: 전역에서 끈 skill은 run이 발견하는 목록에서 빠지고 자리 층의 같은 이름은 남는다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-skill-global-off-" });
  const registered = `${home}/registered`;
  const personal = `${home}/data/skills`;
  const bundled = `${home}/install/assets/skills`;
  const place = `${home}/data/projects/${PRJ}/skills`;
  try {
    await writeSkill(registered, "team-style", "Registered");
    await writeSkill(registered, "audit", "Registered audit");
    await writeSkill(personal, "personal-notes", "Personal");
    await writeSkill(bundled, "bundled-help", "Bundled");
    await writeSkill(place, "audit", "Place audit");
    const machine = machineWithSettings({
      [skillFoldersSetting.key]: [registered],
      [skillsOffSetting.key]: ["team-style", "bundled-help", "audit", "gone"],
    });
    const found = await discoverProductSkills(machine, {
      place,
      personal,
      bundled,
    });
    assert(found !== null);
    assertEquals(
      found.entries.map((entry) => [entry.name, entry.source_kind]),
      [["audit", "place"], ["personal-notes", "personal"]],
    );
    // 끈 설정이 없거나 비어 있으면 아무것도 가리지 않는다.
    for (
      const values of [
        { [skillFoldersSetting.key]: [registered] },
        { [skillFoldersSetting.key]: [registered], [skillsOffSetting.key]: [] },
      ]
    ) {
      const all = await discoverProductSkills(machineWithSettings(values), {
        personal,
        bundled,
      });
      assert(all !== null);
      assertEquals(
        all.entries.map((entry) => entry.name),
        ["audit", "team-style", "personal-notes", "bundled-help"],
      );
    }
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});
