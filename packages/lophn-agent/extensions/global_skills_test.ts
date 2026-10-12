import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../contracts/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../apps/core/testing/ledger.ts";

// ReadGlobalSkills. 실제 reader(harness)와 실제 임시 폴더를 쓴다. 자리 skill은 place-extension-settings가 맡고
// 이 읽기는 전역 층(등록 폴더·개인 보관소·동봉)만 본다.

const OPERATIONS = ["ReadGlobalSkills"];

function credential(actor: "user" | "machine"): AuthenticatedContext {
  return {
    actor,
    principal: `${actor}-1`,
    credential_ref: `test:${actor}-1:${actor}`,
    scope: { operations: OPERATIONS, targets: {} },
    conditions: {},
  };
}

const userCred = credential("user");
const machineCred = credential("machine");

type Harness = { h: LedgerHarness; root: string };

async function withGlobalSkills(run: (ctx: Harness) => Promise<void>) {
  const opened = await createLedgerHarness({
    registrationModules: [
      new URL("./global_skills_registration_test.ts", import.meta.url),
    ],
    credentials: [userCred, machineCred],
    nowMs: Date.UTC(2026, 0, 1),
  });
  assert(opened.ok, opened.ok ? undefined : JSON.stringify(opened.error));
  const h = opened.value;
  try {
    const rows = value(
      await h.inspect(
        "select file from pragma_database_list where name = 'main'",
        [],
      ),
    );
    const file = String(rows[0]!["file"]);
    await run({ h, root: file.slice(0, file.lastIndexOf("/")) });
  } finally {
    await h.close();
  }
}

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function failure(result: Result<unknown>, code: string) {
  assert(
    !result.ok,
    result.ok ? "expected failure, got " + JSON.stringify(result.value) : "",
  );
  assertEquals(result.error.code, code);
}

type Listing = {
  skills: {
    name: string;
    description: string;
    source_kind: string;
    enabled: boolean;
  }[];
  skills_off: string[];
  shadowed: { name: string; kept: string; hidden: string }[];
  skipped: { path: string; reason: string }[];
};

function read(ctx: Harness, as = userCred) {
  return ctx.h.read({ resource: "global-skills", method: "read" }, as, {});
}

async function listing(ctx: Harness): Promise<Listing> {
  return value(await read(ctx)) as unknown as Listing;
}

function writeSkill(folder: string, name: string, description: string) {
  Deno.mkdirSync(`${folder}/${name}`, { recursive: true });
  Deno.writeTextFileSync(
    `${folder}/${name}/SKILL.md`,
    `---\nname: ${name}\ndescription: ${description}\n---\n본문\n`,
  );
}

function turnOff(ctx: Harness, names: string[]) {
  Deno.writeTextFileSync(`${ctx.root}/skills-off.json`, JSON.stringify(names));
}

Deno.test("lophn-agent/extensions#R1 shell/desktop#R50 [agent-I49]: 아무것도 등록하지 않으면 목록과 끈 이름이 모두 비어 있다", async () => {
  await withGlobalSkills(async (ctx) => {
    const empty = await listing(ctx);
    assertEquals(empty.skills, []);
    assertEquals(empty.skills_off, []);
    assertEquals(empty.shadowed, []);
  });
});

Deno.test("lophn-agent/extensions#R1 R5 shell/desktop#R50 [agent-I49]: 전역 목록은 등록 폴더·개인 보관소·동봉 순으로 이름·설명·출처를 주고 켜 둔 것이 기본이며 본문과 경로는 주지 않는다", async () => {
  await withGlobalSkills(async (ctx) => {
    writeSkill(`${ctx.root}/bundled`, "bundled-help", "Comes with lophn");
    writeSkill(`${ctx.root}/skills`, "personal-notes", "My own notes");
    writeSkill(`${ctx.root}/registered`, "team-style", "Team writing style");
    const found = await listing(ctx);
    assertEquals(
      found.skills.map((skill) => [
        skill.name,
        skill.source_kind,
        skill.enabled,
      ]),
      [
        ["team-style", "registered", true],
        ["personal-notes", "personal", true],
        ["bundled-help", "bundled", true],
      ],
    );
    assertEquals(found.skills[0]!.description, "Team writing style");
    const text = JSON.stringify(found);
    assert(!text.includes("본문"));
    assert(!text.includes(ctx.root));
  });
});

Deno.test("lophn-agent/extensions#R32 shell/desktop#R50 [agent-I49]: 자리(project·app) 폴더의 skill은 전역 목록에 나오지 않는다", async () => {
  await withGlobalSkills(async (ctx) => {
    writeSkill(
      `${ctx.root}/projects/prj_01arz3ndektsv4rrffq69g5fa1/skills`,
      "only-here",
      "Lives in one project",
    );
    writeSkill(
      `${ctx.root}/apps/app_01arz3ndektsv4rrffq69g5fa2/skills`,
      "only-app",
      "Lives in one app",
    );
    writeSkill(`${ctx.root}/skills`, "everywhere", "Personal");
    assertEquals((await listing(ctx)).skills.map((skill) => skill.name), [
      "everywhere",
    ]);
  });
});

Deno.test("lophn-agent/extensions#R4 shell/desktop#Q22 [agent-I49]: 전역에서 끈 skill은 목록에 남고 enabled가 false이며 끈 이름은 지금 없는 것도 그대로 돌려준다", async () => {
  await withGlobalSkills(async (ctx) => {
    writeSkill(`${ctx.root}/registered`, "alpha", "First");
    writeSkill(`${ctx.root}/registered`, "beta", "Second");
    turnOff(ctx, ["beta", "gone-for-now"]);
    const found = await listing(ctx);
    assertEquals(
      found.skills.map((skill) => [skill.name, skill.enabled]),
      [["alpha", true], ["beta", false]],
    );
    assertEquals(found.skills_off, ["beta", "gone-for-now"]);
    // 다시 켜면 목록은 그대로이고 켜짐만 바뀐다.
    turnOff(ctx, []);
    assertEquals(
      (await listing(ctx)).skills.map((skill) => skill.enabled),
      [true, true],
    );
  });
});

Deno.test("lophn-agent/extensions#R2 R3 shell/desktop#R50 [agent-I49]: 같은 이름은 먼저 발견한 출처 하나만 목록에 두고 가려진 출처와 제외한 꾸러미의 이유를 알린다", async () => {
  await withGlobalSkills(async (ctx) => {
    writeSkill(`${ctx.root}/registered`, "dup", "Registered wins");
    writeSkill(`${ctx.root}/bundled`, "dup", "Bundled loses");
    writeSkill(`${ctx.root}/bundled`, "Bad_Name", "Wrong name format");
    const found = await listing(ctx);
    assertEquals(found.skills.map((skill) => skill.description), [
      "Registered wins",
    ]);
    assertEquals(found.shadowed, [
      { name: "dup", kept: "registered", hidden: "bundled" },
    ]);
    assertEquals(found.skipped.length, 1);
    assert(found.skipped[0]!.path.endsWith("Bad_Name/SKILL.md"));
  });
});

Deno.test("lophn-agent/extensions#R10 shell/desktop#R50 [agent-I49]: 읽기는 파일을 만들거나 고치지 않는다", async () => {
  await withGlobalSkills(async (ctx) => {
    writeSkill(`${ctx.root}/registered`, "alpha", "First");
    const before = Deno.readTextFileSync(
      `${ctx.root}/registered/alpha/SKILL.md`,
    );
    await listing(ctx);
    await listing(ctx);
    assertEquals(
      Deno.readTextFileSync(`${ctx.root}/registered/alpha/SKILL.md`),
      before,
    );
    assertEquals(
      await Deno.stat(`${ctx.root}/skills-off.json`).catch(() => null),
      null,
    );
  });
});

Deno.test("lophn-agent/extensions#R11 shell/desktop#R50 [agent-I49]: 전역 skill 목록은 사람 화면만 읽고 machine은 거절된다", async () => {
  await withGlobalSkills(async (ctx) => {
    writeSkill(`${ctx.root}/registered`, "alpha", "First");
    failure(await read(ctx, machineCred), "forbidden");
    assertEquals((await listing(ctx)).skills.length, 1);
  });
});
