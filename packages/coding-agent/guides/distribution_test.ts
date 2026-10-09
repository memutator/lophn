// 배포 skill 원본의 발견·검사·manifest 배포 시험이다(coding-agent/guides#R1, R2, R3, R4, R20). 실제 원본
// 디렉터리를 읽는 읽기 시험이고 쓰기는 temp dir에만 한다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { LOPHN_SKILL_NAMES } from "../harnesses/mod.ts";
import { GUIDE_BYTES_MAX } from "./managed-files.ts";
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

// sync가 관리 구간에 채우는 몸통 원본이다(templates/). 설정 파일과 같은 몫이다.
async function templateBody(name: string): Promise<string> {
  const path = decodeURIComponent(
    new URL(`./templates/${name}`, import.meta.url).pathname,
  );
  return await Deno.readTextFile(path);
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

Deno.test("coding-agent/guides#R13: 몸통·marker를 합친 안내 파일 전체가 32 KiB 안이다", async () => {
  const guide = await templateBody("app-root-guide.body.md");
  const thin = await templateBody("thin-claude.body.md");
  const ignore = await templateBody("app-ignore.body.md");
  const whole = (text: string): string =>
    `# 안내\n\n<!-- begin lophn-managed -->\n${text}\n<!-- end lophn-managed -->\n`;
  for (
    const [name, text] of [["app_guide", guide], ["thin_claude", thin], [
      "app_ignore",
      ignore,
    ]] as const
  ) {
    const bytes = new TextEncoder().encode(whole(text));
    assert(
      bytes.length <= GUIDE_BYTES_MAX,
      `${name}이 32 KiB를 넘는다: ${bytes.length}`,
    );
  }
});

Deno.test("coding-agent/guides#R14: 안내 몸통은 요구 목록 항목만 있고 ticket 본문·묶음·token이 없다", async () => {
  // deno fmt가 몸통을 줄바꿈하므로 공백 차이는 무시하고 읽는다.
  const text = (await templateBody("app-root-guide.body.md")).replace(
    /\s+/g,
    " ",
  );
  // 요구 목록 항목이다(R14).
  for (
    const term of [
      "lophn 앱이다",
      "필요한 배포 skill",
      "시작 summary",
      "사람이 ticket을 지정했거나",
      "blueprint.ts`가 정본 선언",
      "machine 생성물",
      "machine이 만든 파일은",
      "용어는",
      "SDK Package는",
      "문제 보고는",
      "실제 테스트는",
      "preview는",
      "보고할 때",
    ]
  ) {
    assert(text.includes(term), term);
  }
  // ticket 본문·묶음·token은 없다(R14).
  for (const forbidden of ["cac_", "record_fix", "bundle", "token"]) {
    assertFalse(text.includes(forbidden), forbidden);
  }
});
