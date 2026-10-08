// 배포 skill 원본의 발견·검사·manifest 배포 시험이다(coding-agent/guides#R1, R2, R3, R4, R20). 실제 원본
// 디렉터리를 읽는 읽기 시험이고 쓰기는 temp dir에만 한다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { LOPHN_SKILL_NAMES } from "../harnesses/mod.ts";
import {
  DISTRIBUTED_SKILLS_DIR,
  type Distribution,
  loadDistribution,
  selectSkill,
  startupDiscovery,
} from "./distribution.ts";
import {
  checkManifest,
  SKILL_RELEASES,
  skillContentHash,
  type SkillRelease,
} from "./manifest.ts";

async function real(): Promise<Distribution> {
  const loaded = await loadDistribution();
  assert(loaded.ok);
  return loaded.value;
}

Deno.test("coding-agent/guides#R1 coding-agent/guides#R2: 배포 원본의 네 skill이 형식 검사와 manifest를 통과하고 거절된 원본이 없다", async () => {
  const dist = await real();
  assertEquals(dist.rejected, []);
  assertEquals(
    dist.skills.map((skill) => skill.name).sort(),
    [...LOPHN_SKILL_NAMES].sort(),
  );
  for (const skill of dist.skills) {
    assert(skill.description.length >= 1);
    assertEquals(skill.files[0].path.length > 0, true);
  }
});

Deno.test("coding-agent/guides#R1: 시작 발견에는 이름과 설명뿐이고 본문은 고른 skill만 읽힌다", async () => {
  const dist = await real();
  const discovered = startupDiscovery(dist.skills);
  assertEquals(discovered.length, dist.skills.length);
  for (const entry of discovered) {
    assertEquals(Object.keys(entry).sort(), ["description", "name"]);
  }
  const serialized = JSON.stringify(discovered);
  for (const skill of dist.skills) {
    // 본문 첫 제목 줄이 발견 입력에 복사되지 않았다.
    const heading = skill.body.split("\n").find((line) =>
      line.startsWith("# ")
    );
    assert(heading !== undefined);
    assertFalse(serialized.includes(heading));
  }
  const picked = selectSkill(dist.skills, "lophn-save");
  assert(picked !== undefined);
  assert(picked.body.includes("lophn_save"));
  assertEquals(selectSkill(dist.skills, "no-such-skill"), undefined);
});

Deno.test("coding-agent/guides#R3: 배포 원본의 본문에서 필요한 통로를 metadata 없이 찾는다", async () => {
  const dist = await real();
  for (const skill of dist.skills) {
    // 어떤 skill도 제품 전용 metadata에 의존하지 않는다: frontmatter key는 name·description뿐이다.
    const entry = skill.files.find((file) => file.path === "SKILL.md");
    assert(entry !== undefined);
    const front = entry.content.split("\n---\n")[0].split("\n").slice(1);
    const keys = front.filter((line) => /^[a-z-]+:/.test(line)).map((line) =>
      line.split(":")[0]
    );
    assertEquals(keys, ["name", "description"]);
    assert(/lophn_[a-z]+/.test(skill.body), `${skill.name}에 통로 이름이 없다`);
  }
});

Deno.test("coding-agent/guides#R20: 배포 skill의 version·content hash가 manifest 기록과 같다", async () => {
  const dist = await real();
  assertEquals(await checkManifest(dist.skills), []);
  for (const release of SKILL_RELEASES) {
    const skill = dist.skills.find((item) => item.name === release.name);
    assertEquals(skill?.version, release.version);
    assertEquals(skill?.hash, release.hash);
    assertEquals(await skillContentHash(skill?.files ?? []), release.hash);
  }
});

Deno.test("coding-agent/guides#R20: 같은 version에서 내용이 한 글자라도 바뀌면 배포 테스트가 실패한다", async () => {
  const dist = await real();
  const changed = dist.skills.map((skill) =>
    skill.name === "lophn-navigate"
      ? {
        name: skill.name,
        files: skill.files.map((file) =>
          file.path === "SKILL.md"
            ? { ...file, content: `${file.content}.` }
            : file
        ),
      }
      : skill
  );
  const issues = await checkManifest(changed);
  assertEquals(issues.length, 1);
  assertEquals(issues[0].name, "lophn-navigate");
  assert(issues[0].message.includes("version을 올리고"));
  // version을 올리고 새 hash를 기록하면 통과한다.
  const hash = await skillContentHash(
    changed.find((skill) => skill.name === "lophn-navigate")?.files ?? [],
  );
  const bumped: SkillRelease[] = SKILL_RELEASES.map((release) =>
    release.name === "lophn-navigate"
      ? { ...release, version: "1.0.1", hash }
      : release
  );
  assertEquals(await checkManifest(changed, bumped), []);
});

Deno.test("coding-agent/guides#R20: manifest에 없는 skill·내용 없는 기록·version 형식 오류를 거절한다", async () => {
  const dist = await real();
  const without = SKILL_RELEASES.filter((item) => item.name !== "lophn-save");
  assert(
    (await checkManifest(dist.skills, without)).some((issue) =>
      issue.name === "lophn-save" &&
      issue.message.includes("manifest에 없는")
    ),
  );
  assert(
    (await checkManifest(
      dist.skills.filter((skill) => skill.name !== "lophn-save"),
    )).some((issue) => issue.message.includes("내용이 없다")),
  );
  const bad = SKILL_RELEASES.map((item) => ({ ...item, version: "1" }));
  assert((await checkManifest(dist.skills, bad)).length > 0);
});

async function copyTree(from: string, to: string): Promise<void> {
  await Deno.mkdir(to, { recursive: true });
  for await (const entry of Deno.readDir(from)) {
    if (entry.isDirectory) {
      await copyTree(`${from}/${entry.name}`, `${to}/${entry.name}`);
    } else await Deno.copyFile(`${from}/${entry.name}`, `${to}/${entry.name}`);
  }
}

Deno.test("coding-agent/guides#R4 coding-agent/guides#R20: 외부 symlink·manifest 밖 사용자 skill·내용이 바뀐 skill은 배포로 읽히지 않고 거절 이유가 남는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "lophn-guides-dist-" });
  try {
    await copyTree(DISTRIBUTED_SKILLS_DIR, dir);
    // 사용자가 만든 skill은 manifest에 없으므로 배포 대상이 아니다.
    await Deno.mkdir(`${dir}/my-own`);
    await Deno.writeTextFile(
      `${dir}/my-own/SKILL.md`,
      '---\nname: my-own\ndescription: "mine"\n---\n본문\n',
    );
    // 내용이 바뀐 배포 skill이다.
    await Deno.writeTextFile(`${dir}/lophn-save/SKILL.md`, "---\n---\n");
    // 외부를 가리키는 symlink다.
    await Deno.symlink("/etc/hostname", `${dir}/lophn-repair/link.md`);
    const loaded = await loadDistribution(dir);
    assert(loaded.ok);
    assertEquals(
      loaded.value.skills.map((skill) => skill.name).sort(),
      ["lophn-build-app", "lophn-navigate"],
    );
    const rejected = new Map(
      loaded.value.rejected.map((item) => [item.directory, item.issues]),
    );
    assertEquals([...rejected.keys()].sort(), [
      "lophn-repair",
      "lophn-save",
      "my-own",
    ]);
    assert(rejected.get("lophn-repair")?.some((s) => s.includes("symlink")));
    assert(rejected.get("my-own")?.some((s) => s.includes("manifest")));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("coding-agent/guides#R2: 원본 디렉터리를 읽지 못하면 unavailable이다", async () => {
  const loaded = await loadDistribution("/nonexistent-skills-dir");
  assertFalse(loaded.ok);
  assertEquals(loaded.error.code, "unavailable");
});
