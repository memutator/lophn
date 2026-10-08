// 배포 skill 설치 시험이다(coding-agent/guides#R4, R5, R20, coding-agent/cli#R10). HOME·project·lophn home은
// 모두 temp harness-home fixture이고 사람의 실제 설정 root(~/.claude 등)와 실제 harness는 열지 않는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { filePort, storeOf } from "../harnesses/mod.ts";
import {
  type Fixture,
  fixture,
  fixtureLaunch,
  NOW,
  targetOf,
  write,
} from "../harnesses/testing/mod.ts";
import { type DistributedSkill, loadDistribution } from "./distribution.ts";
import { installSkills } from "./install.ts";

async function distribution(): Promise<readonly DistributedSkill[]> {
  const loaded = await loadDistribution();
  assert(loaded.ok);
  return loaded.value.skills;
}

function installInput(
  fx: Fixture,
  skills: readonly DistributedSkill[],
  harness: "claude" | "codex" = "claude",
  scope: "user" | "app" = "user",
  names?: readonly string[],
) {
  return {
    target: targetOf(harness, scope, fx),
    names,
    skills,
    roots: { home: fx.home, env: fx.env, cwd: fx.project },
    launch: fixtureLaunch(),
    operationId: "op-skills",
    now: NOW,
  };
}

const ports = (fx: Fixture) => ({
  files: filePort(),
  store: storeOf(fx.lophn),
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("coding-agent/guides#R4 coding-agent/cli#R10: 배포 skill 네 개가 고른 제품의 skill root 바로 아래 skill별 디렉터리에 본문과 보조 자료째 설치되고 파일별 결과가 changed다", async () => {
  const fx = await fixture();
  try {
    const skills = await distribution();
    const done = await installSkills(installInput(fx, skills), ports(fx));
    assert(done.ok);
    assertEquals(done.value.status, "complete");
    assertEquals(done.value.skills.length, 4);
    for (const skill of done.value.skills) {
      assertEquals(skill.outcome, "changed");
      assert(skill.files.every((file) => file.outcome === "changed"));
      assert(skill.version.length > 0 && skill.hash.length === 64);
      const text = await Deno.readTextFile(
        `${fx.home}/.claude/skills/${skill.name}/SKILL.md`,
      );
      assert(text.startsWith("---\nname: "));
    }
    // 보조 자료가 같은 skill 디렉터리 안에 있다.
    assert(
      await exists(
        `${fx.home}/.claude/skills/lophn-repair/references/investigation.md`,
      ),
    );
    // 원본 위치와 무관하게 설치 사본이 읽힌다(외부 symlink가 아니다).
    const stat = await Deno.lstat(`${fx.home}/.claude/skills/lophn-save`);
    assertFalse(stat.isSymlink);
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/guides#R5 coding-agent/cli#R10: 고른 제품의 skill root만 쓰고 다른 제품 root와 설정 파일은 만들지 않는다", async () => {
  const fx = await fixture();
  try {
    const skills = await distribution();
    const done = await installSkills(
      installInput(fx, skills, "codex"),
      ports(fx),
    );
    assert(done.ok);
    assertEquals(done.value.status, "complete");
    assert(await exists(`${fx.home}/.agents/skills/lophn-navigate/SKILL.md`));
    assertFalse(await exists(`${fx.home}/.claude`));
    assertFalse(await exists(`${fx.home}/.claude.json`));
    // skill만 설치한다: MCP 설정·안내 파일은 만들지 않는다.
    assertFalse(await exists(`${fx.home}/.codex`));
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/cli#R10: names로 고른 skill만 설치하고 배포하지 않는 이름은 오류이며 아무것도 쓰지 않는다", async () => {
  const fx = await fixture();
  try {
    const skills = await distribution();
    const picked = await installSkills(
      installInput(fx, skills, "claude", "user", ["lophn-save"]),
      ports(fx),
    );
    assert(picked.ok);
    assertEquals(picked.value.skills.map((skill) => skill.name), [
      "lophn-save",
    ]);
    assert(await exists(`${fx.home}/.claude/skills/lophn-save/SKILL.md`));
    assertFalse(await exists(`${fx.home}/.claude/skills/lophn-repair`));

    const unknown = await installSkills(
      installInput(fx, skills, "claude", "user", ["my-own-skill"]),
      ports(fx),
    );
    assertFalse(unknown.ok);
    assertEquals(unknown.error.code, "invalid_input");
    assertFalse(await exists(`${fx.home}/.claude/skills/my-own-skill`));
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/cli#R10 coding-agent/guides#R20: 다시 설치하면 파일마다 unchanged이고 내용이 바뀐 새 version은 바뀐 파일만 changed다", async () => {
  const fx = await fixture();
  try {
    const skills = await distribution();
    const first = await installSkills(installInput(fx, skills), ports(fx));
    assert(first.ok);
    const second = await installSkills(installInput(fx, skills), ports(fx));
    assert(second.ok);
    assertEquals(second.value.status, "complete");
    for (const skill of second.value.skills) {
      assertEquals(skill.outcome, "unchanged");
      assert(skill.files.every((file) => file.outcome === "unchanged"));
    }
    // 새 version이다: 한 파일 내용만 바뀐다.
    const newer = skills.map((skill) =>
      skill.name === "lophn-repair"
        ? {
          ...skill,
          version: "1.0.1",
          files: skill.files.map((file) =>
            file.path === "references/investigation.md"
              ? { ...file, content: `${file.content}\n9. 추가\n` }
              : file
          ),
        }
        : skill
    );
    const third = await installSkills(installInput(fx, newer), ports(fx));
    assert(third.ok);
    const repair = third.value.skills.find((skill) =>
      skill.name === "lophn-repair"
    );
    assertEquals(repair?.outcome, "changed");
    assertEquals(
      repair?.files.map((file) => [file.path, file.outcome]).sort(),
      [
        ["SKILL.md", "unchanged"],
        ["references/investigation.md", "changed"],
      ],
    );
    assertEquals(
      third.value.skills.filter((skill) => skill.outcome === "unchanged")
        .length,
      3,
    );
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/guides#R5 coding-agent/cli#R10: 같은 이름의 사람 skill은 덮지 않고 파일별 충돌로 남고 사람이 고친 설치 skill도 충돌이다", async () => {
  const fx = await fixture();
  try {
    const skills = await distribution();
    // receipt 없는 같은 이름의 사람 skill이다.
    const mine = "---\nname: lophn-save\ndescription: mine\n---\n내 것\n";
    await write(`${fx.home}/.claude/skills/lophn-save/SKILL.md`, mine);
    const done = await installSkills(installInput(fx, skills), ports(fx));
    assert(done.ok);
    assertEquals(done.value.status, "partial");
    const save = done.value.skills.find((skill) => skill.name === "lophn-save");
    assertEquals(save?.outcome, "conflict");
    assert(save?.files.every((file) => file.outcome === "conflict"));
    assertEquals(
      await Deno.readTextFile(`${fx.home}/.claude/skills/lophn-save/SKILL.md`),
      mine,
    );
    // 나머지는 설치됐다.
    assertEquals(
      done.value.skills.filter((skill) => skill.outcome === "changed").length,
      3,
    );

    // 설치된 skill을 사람이 고치면 갱신이 충돌이다.
    const edited = `${fx.home}/.claude/skills/lophn-navigate/SKILL.md`;
    await Deno.writeTextFile(edited, "사람이 고쳤다\n");
    const again = await installSkills(installInput(fx, skills), ports(fx));
    assert(again.ok);
    const navigate = again.value.skills.find((skill) =>
      skill.name === "lophn-navigate"
    );
    assertEquals(navigate?.outcome, "conflict");
    assertEquals(await Deno.readTextFile(edited), "사람이 고쳤다\n");
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/guides#R4: 앱 범위 설치는 그 앱 폴더의 skill root에만 쓰고 user root는 만들지 않는다", async () => {
  const fx = await fixture();
  try {
    const skills = await distribution();
    const done = await installSkills(
      installInput(fx, skills, "claude", "app"),
      ports(fx),
    );
    assert(done.ok);
    assertEquals(done.value.status, "complete");
    assert(
      await exists(`${fx.project}/.claude/skills/lophn-build-app/SKILL.md`),
    );
    assertFalse(await exists(`${fx.home}/.claude`));
  } finally {
    await fx.dispose();
  }
});
