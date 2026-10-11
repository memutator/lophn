import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../base/mod.ts";
import type { Result } from "../../base/mod.ts";
import { createNodeSkillFiles } from "./adapters/node-fs.ts";
import {
  discoverSkills,
  listSkillsSync,
  SKILL_BODY_MAX_BYTES,
  type SkillFilesPort,
  type SkillSources,
} from "./mod.ts";

// 동기 skill 목록(agents read와 `/` 메뉴가 읽는다). 파일은 temp dir만 쓰고 사람의 실제 home은 열지 않는다.

function manifest(name: string, description: string) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n본문\n`;
}

function writeSkill(
  folder: string,
  name: string,
  description: string,
  bundle = name,
) {
  Deno.mkdirSync(`${folder}/${bundle}`, { recursive: true });
  Deno.writeTextFileSync(
    `${folder}/${bundle}/SKILL.md`,
    manifest(name, description),
  );
}

async function withHome(run: (home: string) => void | Promise<void>) {
  const home = await Deno.makeTempDir({ prefix: "lophn-skills-sync-" });
  try {
    await run(home);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
}

function sources(home: string, over: Partial<SkillSources> = {}) {
  return {
    place: `${home}/place/skills`,
    registered: [`${home}/reg-a`, `${home}/reg-b`],
    personal: `${home}/personal`,
    bundled: `${home}/bundled`,
    ...over,
  } satisfies SkillSources;
}

Deno.test("lophn-agent/extensions#R1 [agent-I19b]: skills are found in the order place, registered folders in order, personal store, bundle", async () => {
  await withHome((home) => {
    writeSkill(`${home}/bundled`, "from-bundle", "Bundle");
    writeSkill(`${home}/personal`, "from-personal", "Personal");
    writeSkill(`${home}/reg-b`, "from-b", "Second folder");
    writeSkill(`${home}/reg-a`, "from-a", "First folder");
    writeSkill(`${home}/place/skills`, "from-place", "Place");
    const listing = listSkillsSync(createNodeSkillFiles(), sources(home));
    assertEquals(
      listing.entries.map((entry) => [entry.name, entry.source_kind]),
      [
        ["from-place", "place"],
        ["from-a", "registered"],
        ["from-b", "registered"],
        ["from-personal", "personal"],
        ["from-bundle", "bundled"],
      ],
    );
    assertEquals(listing.entries[0].description, "Place");
    assertEquals(listing.skipped, []);
  });
});

Deno.test("lophn-agent/extensions#R1 [agent-I19b]: only a registered folder itself and the bundles right under each folder are looked at", async () => {
  await withHome((home) => {
    // 등록 폴더 자신이 꾸러미일 수 있다.
    Deno.mkdirSync(`${home}/reg-a`, { recursive: true });
    Deno.writeTextFileSync(
      `${home}/reg-a/SKILL.md`,
      manifest("folder-itself", "The registered folder is a bundle"),
    );
    writeSkill(`${home}/reg-a`, "child", "Child");
    // 꾸러미 아래 중첩, 숨김 폴더, 상위 폴더, 다른 자리의 skill 폴더는 찾지 않는다.
    writeSkill(`${home}/reg-a/child`, "nested", "Nested", "inner");
    writeSkill(`${home}/reg-a`, "hidden-one", "Hidden", ".hidden");
    writeSkill(home, "parent-one", "Parent folder");
    writeSkill(`${home}/other-place/skills`, "other-place-one", "Elsewhere");
    // place 폴더 자신은 꾸러미가 아니라 꾸러미를 담는 폴더다.
    Deno.mkdirSync(`${home}/place/skills`, { recursive: true });
    Deno.writeTextFileSync(
      `${home}/place/skills/SKILL.md`,
      manifest("place-root", "Not a bundle"),
    );
    const listing = listSkillsSync(createNodeSkillFiles(), sources(home));
    assertEquals(listing.entries.map((entry) => entry.name), [
      "folder-itself",
      "child",
    ]);
  });
});

Deno.test("lophn-agent/extensions#R33 [agent-I19b]: a skill of the same name is used once, from the earlier source, and the hidden ones are reported", async () => {
  await withHome((home) => {
    writeSkill(`${home}/bundled`, "review", "Bundled");
    writeSkill(`${home}/personal`, "review", "Personal");
    writeSkill(`${home}/reg-b`, "review", "Second");
    writeSkill(`${home}/reg-a`, "review", "First");
    writeSkill(`${home}/place/skills`, "review", "Place");
    const listing = listSkillsSync(createNodeSkillFiles(), sources(home));
    assertEquals(
      listing.entries.map((entry) => [entry.name, entry.description]),
      [["review", "Place"]],
    );
    assertEquals(listing.shadowed, [
      { name: "review", kept: "place", hidden: "registered" },
      { name: "review", kept: "place", hidden: "registered" },
      { name: "review", kept: "place", hidden: "personal" },
      { name: "review", kept: "place", hidden: "bundled" },
    ]);
  });
});

Deno.test("lophn-agent/extensions#R3 [agent-I19b]: inside one source the bundle folder name in English order decides, and the listing is the same every time", async () => {
  await withHome((home) => {
    writeSkill(`${home}/place/skills`, "review", "From zeta", "zeta");
    writeSkill(`${home}/place/skills`, "review", "From alpha", "alpha");
    const first = listSkillsSync(createNodeSkillFiles(), sources(home));
    const second = listSkillsSync(createNodeSkillFiles(), sources(home));
    assertEquals(first, second);
    assertEquals(first.entries.map((entry) => entry.description), [
      "From alpha",
    ]);
    // 등록 폴더의 순서를 바꾸면 선택이 바뀐다.
    writeSkill(`${home}/reg-a`, "other", "A");
    writeSkill(`${home}/reg-b`, "other", "B");
    const swapped = listSkillsSync(
      createNodeSkillFiles(),
      sources(home, { registered: [`${home}/reg-b`, `${home}/reg-a`] }),
    );
    assertEquals(
      swapped.entries.find((entry) => entry.name === "other")?.description,
      "B",
    );
  });
});

Deno.test("lophn-agent/extensions#R2 [agent-I19b]: a wrong manifest is left out with its path and reason, and an exact boundary is kept", async () => {
  await withHome((home) => {
    const folder = `${home}/place/skills`;
    writeSkill(folder, "a".repeat(64), "Name at the limit");
    writeSkill(folder, "b".repeat(65), "Name over the limit", "too-long-name");
    writeSkill(folder, "Upper", "Upper case", "upper-case");
    writeSkill(folder, "-edge", "Leading hyphen", "edge-hyphen");
    writeSkill(folder, "x", "d".repeat(1024), "long-description-ok");
    writeSkill(folder, "y", "d".repeat(1025), "long-description-bad");
    Deno.mkdirSync(`${folder}/no-name`, { recursive: true });
    Deno.writeTextFileSync(
      `${folder}/no-name/SKILL.md`,
      "---\ndescription: no name\n---\n",
    );
    Deno.mkdirSync(`${folder}/not-a-skill`, { recursive: true });
    const listing = listSkillsSync(
      createNodeSkillFiles(),
      sources(home, { registered: [] }),
    );
    assertEquals(listing.entries.map((entry) => entry.name), [
      "a".repeat(64),
      "x",
    ]);
    assertEquals(
      listing.skipped.map((skipped) => skipped.path.replace(folder, "")).sort(),
      [
        "/edge-hyphen/SKILL.md",
        "/long-description-bad/SKILL.md",
        "/no-name/SKILL.md",
        "/too-long-name/SKILL.md",
        "/upper-case/SKILL.md",
      ],
    );
    assert(listing.skipped.every((skipped) => skipped.reason.length > 0));
  });
});

Deno.test("lophn-agent/extensions#R6 [agent-I19b]: a manifest over the read limit and a symbolic link are left out, never half read", async () => {
  await withHome((home) => {
    const folder = `${home}/place/skills`;
    Deno.mkdirSync(`${folder}/huge`, { recursive: true });
    Deno.writeTextFileSync(
      `${folder}/huge/SKILL.md`,
      manifest("huge", "Too large") + "x".repeat(SKILL_BODY_MAX_BYTES),
    );
    writeSkill(`${home}/outside`, "linked", "Outside", "linked");
    Deno.mkdirSync(folder, { recursive: true });
    Deno.symlinkSync(`${home}/outside/linked`, `${folder}/alias`);
    const listing = listSkillsSync(
      createNodeSkillFiles(),
      sources(home, { registered: [] }),
    );
    assertEquals(listing.entries, []);
    assertEquals(
      listing.skipped.map((skipped) => skipped.path.replace(folder, "")).sort(),
      ["/alias", "/huge/SKILL.md"],
    );
  });
});

Deno.test("lophn-agent/extensions#R1 [agent-I19b]: a source that is not there is empty, and a null source is not looked at", async () => {
  await withHome((home) => {
    const none = listSkillsSync(
      createNodeSkillFiles(),
      sources(home, {
        place: null,
        registered: [],
        personal: null,
        bundled: null,
      }),
    );
    assertEquals(none.entries, []);
    assertEquals(none.skipped, []);
    assertEquals(none.shadowed, []);
    // 만들지 않은 자리·개인·동봉 폴더는 그 출처가 비어 있을 뿐 제외 진단이 아니다.
    const absent = listSkillsSync(
      createNodeSkillFiles(),
      sources(home, { registered: [] }),
    );
    assertEquals(absent.entries, []);
    assertEquals(absent.skipped, []);
    // 사람이 등록한 폴더가 없으면 알린다.
    const missing = listSkillsSync(
      createNodeSkillFiles(),
      sources(home, {
        place: null,
        registered: [`${home}/gone`],
        personal: null,
        bundled: null,
      }),
    );
    assertEquals(missing.entries, []);
    assertEquals(missing.skipped.map((skipped) => skipped.path), [
      `${home}/gone`,
    ]);
  });
});

// 같은 규칙을 비동기 발견(run 준비)과 동기 목록(화면)이 따로 구현한다. 둘이 어긋나면 화면이 보인 skill과
// run이 받는 skill이 달라진다.
function asyncPort(): SkillFilesPort {
  const node = createNodeSkillFiles();
  const wrap = <T>(read: () => T): Promise<Result<T>> => {
    try {
      return Promise.resolve({ ok: true, value: read() });
    } catch (error) {
      return Promise.resolve({
        ok: false,
        error: { code: "internal", message: String(error) },
      });
    }
  };
  return {
    list: (dir) => wrap(() => node.list(dir)),
    kind: (path) => wrap(() => node.kind(path)),
    read: (path, max) => wrap(() => node.read(path, max)),
    executable: () => Promise.resolve({ ok: true, value: false }),
  };
}

Deno.test("lophn-agent/extensions#R1 lophn-agent/extensions#R3 [agent-I19b]: the sync listing and the run's discovery agree on names, sources and hidden skills", async () => {
  await withHome(async (home) => {
    writeSkill(`${home}/place/skills`, "review", "Place review");
    writeSkill(`${home}/place/skills`, "only-place", "Only place");
    writeSkill(`${home}/reg-a`, "review", "Registered review");
    writeSkill(`${home}/reg-a`, "audit", "Audit");
    writeSkill(`${home}/reg-b`, "audit", "Second audit");
    writeSkill(`${home}/personal`, "notes", "Notes");
    writeSkill(`${home}/bundled`, "notes", "Bundled notes");
    writeSkill(`${home}/bundled`, "basics", "Basics");
    writeSkill(`${home}/reg-a`, "Bad_Name", "Wrong", "bad-folder");

    const roots = sources(home);
    const sync = listSkillsSync(createNodeSkillFiles(), roots);
    const discovered = await discoverSkills({
      port: asyncPort(),
      clock: manualClock(0),
      registered_roots: roots.registered,
      place_store: roots.place,
      personal_store: roots.personal,
      bundled_root: roots.bundled,
      max_file_bytes: SKILL_BODY_MAX_BYTES,
      selection: null,
    });
    assert(discovered.ok);
    assertEquals(
      sync.entries.map((entry) => [
        entry.name,
        entry.description,
        entry.source_kind,
      ]),
      discovered.value.entries.map((entry) => [
        entry.name,
        entry.description,
        entry.source_kind,
      ]),
    );
    assertEquals(
      sync.skipped.map((skipped) => skipped.path),
      discovered.value.skipped.map((skipped) => skipped.path),
    );
    assertEquals(sync.shadowed.length, discovered.value.shadowing.length);
  });
});
