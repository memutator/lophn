import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  AgentPlace,
  PlaceKind,
} from "../../../protocol/lophn-agent/mod.ts";
import { createSkillSnapshot, type SkillSnapshotDeps } from "./skill-read.ts";
import { receivedSkills } from "../agents/resolve.ts";
import {
  discoverSkills,
  mergeSkillLayers,
  type SkillFiles,
  type SkillSources,
} from "./skills.ts";
import { commandSkillsOf, createExtensionRegistry } from "./registry.ts";
import type { ProjectLayer } from "./project-settings.ts";

// 끌 수 없는 내장 skill은 어느 층에서 꺼도, 같은 이름의 사람 skill이 있어도 그대로 남는다. 이 규칙이 깨지면 place가
// 일하는 데 필요한 skill이 사람 설정 하나로 사라진다.

const skillFile = (
  name: string,
  body: string,
  description = `${name} description`,
) => `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;

// 메모리 안의 폴더 모양이다. 사람의 data root를 열지 않는다.
function treeOf(files: Record<string, string>): SkillFiles {
  const kind = (path: string) =>
    path in files
      ? ("file" as const)
      : Object.keys(files).some((one) => one.startsWith(`${path}/`))
        ? ("dir" as const)
        : null;
  const list = (dir: string) => {
    const names = new Set<string>();
    for (const path of Object.keys(files)) {
      if (path.startsWith(`${dir}/`)) {
        names.add(path.slice(dir.length + 1).split("/")[0]);
      }
    }
    return names.size === 0 ? null : [...names];
  };
  const read = (path: string) =>
    path in files ? { text: files[path], complete: true } : null;
  return { list, kind, read };
}

const SESSION = "ses_01" as Id<"ses">;
const PLACE: AgentPlace = { kind: "project", id: "prj_01" };
const DOMAIN = "dom_01";

type Case = {
  name: string;
  kind: PlaceKind;
  // 같은 이름의 사람 skill을 둔 층
  human: ("global" | "domain")[];
  off: { global?: boolean; project?: boolean; agent?: boolean };
  // 최종 write-kinds의 본문. null이면 목록에 없다.
  expect: "BUILTIN" | "GLOBAL" | "DOMAIN" | null;
};

const CASES: Case[] = [
  {
    name: "no human skill, nothing off",
    kind: "project",
    human: [],
    off: {},
    expect: "BUILTIN",
  },
  {
    name: "off at global",
    kind: "project",
    human: [],
    off: { global: true },
    expect: "BUILTIN",
  },
  {
    name: "off at project",
    kind: "project",
    human: [],
    off: { project: true },
    expect: "BUILTIN",
  },
  {
    name: "off at agent",
    kind: "project",
    human: [],
    off: { agent: true },
    expect: "BUILTIN",
  },
  {
    name: "off at every layer",
    kind: "project",
    human: [],
    off: { global: true, project: true, agent: true },
    expect: "BUILTIN",
  },
  {
    name: "global human skill with the same name",
    kind: "project",
    human: ["global"],
    off: {},
    expect: "BUILTIN",
  },
  {
    name: "domain human skill with the same name",
    kind: "project",
    human: ["domain"],
    off: {},
    expect: "BUILTIN",
  },
  {
    name: "human skills and off at every layer",
    kind: "project",
    human: ["global", "domain"],
    off: { global: true, project: true, agent: true },
    expect: "BUILTIN",
  },
  // 내장 skill은 선언한 place 종류의 것만이다. 다른 place 종류에는 이름이 비어 있어 사람 skill이 그대로 쓰인다.
  {
    name: "home has no project built-in",
    kind: "home",
    human: [],
    off: {},
    expect: null,
  },
  {
    name: "home keeps its own skill of that name",
    kind: "home",
    human: ["domain"],
    off: {},
    expect: "DOMAIN",
  },
];

for (const one of CASES) {
  test(`write-kinds stays: ${one.name}`, async () => {
    const files: Record<string, string> = {
      "/b/write-kinds/SKILL.md": skillFile("write-kinds", "BUILTIN"),
      "/b/spare-builtin/SKILL.md": skillFile("spare-builtin", "BUILTIN"),
    };
    if (one.human.includes("global")) {
      files["/g/write-kinds/SKILL.md"] = skillFile("write-kinds", "GLOBAL");
    }
    if (one.human.includes("domain")) {
      files["/p/write-kinds/SKILL.md"] = skillFile("write-kinds", "DOMAIN");
    }
    const port = treeOf(files);
    const globalOff = one.off.global ? ["write-kinds"] : [];
    const projectOff = one.off.project ? ["write-kinds"] : [];
    const agentOff = one.off.agent ? ["write-kinds"] : [];
    const deps: SkillSnapshotDeps = {
      port,
      builtin_root: "/b",
      personal_store: null,
      global: () => Promise.resolve({ roots: ["/g"], off: globalOff }),
      place: () =>
        Promise.resolve({
          place_skills: null,
          domain_stores: [{ domain: DOMAIN, folder: "/p" }],
          off: projectOff,
        }),
    };
    const snapshot = await createSkillSnapshot(deps, {
      id: SESSION,
      kind: one.kind,
      place: PLACE,
      off: agentOff,
    });

    const listed = snapshot.skills.find(
      (skill) => skill.name === "write-kinds",
    );
    const read = await snapshot.reader.read(SESSION, "write-kinds");
    if (one.expect === null) {
      assert.deepStrictEqual(listed, undefined);
      assert.deepStrictEqual(read.ok, false);
    } else {
      assert.deepStrictEqual(listed?.enabled, true);
      assert.deepStrictEqual(read.ok && read.value.trim(), one.expect);
    }
  });
}

test("a skill that can be turned off goes off, and a human skill of the same name replaces it", () => {
  const candidates = [
    {
      name: "maker",
      source: "builtin" as const,
      bundle_path: "/b/maker",
      domain: null,
    },
  ];
  const canOff = () => true;
  assert.deepStrictEqual(
    mergeSkillLayers(candidates, ["maker"], [], canOff).map(
      (one) => one.enabled,
    ),
    [false],
  );
  const replaced = mergeSkillLayers(
    [
      ...candidates,
      {
        name: "maker",
        source: "global" as const,
        bundle_path: "/g/maker",
        domain: null,
      },
    ],
    [],
    [],
    canOff,
  );
  assert.deepStrictEqual(
    replaced.map((one) => one.source),
    ["global"],
  );
  assert.deepStrictEqual(
    replaced.map((one) => one.enabled),
    [true],
  );
});

test("the agent gets every skill except the ones it turned off, and a built-in that cannot be turned off always", async () => {
  const port = treeOf({
    "/b/write-kinds/SKILL.md": skillFile("write-kinds", "BUILTIN"),
    "/g/a/SKILL.md": skillFile("a", "A"),
    "/g/b/SKILL.md": skillFile("b", "B"),
  });
  const deps: SkillSnapshotDeps = {
    port,
    builtin_root: "/b",
    personal_store: null,
    global: () => Promise.resolve({ roots: ["/g"], off: [] }),
    place: () =>
      Promise.resolve({ place_skills: null, domain_stores: [], off: [] }),
  };
  const receivedOf = async (off: string[]) => {
    const snapshot = await createSkillSnapshot(deps, {
      id: SESSION,
      kind: "project",
      place: PLACE,
      off,
    });
    const code = async (name: string) => {
      const read = await snapshot.reader.read(SESSION, name);
      return read.ok ? "ok" : read.error.code;
    };
    const listed = snapshot.skills.filter((s) => s.enabled).map((s) => s.name);
    const available = snapshot.skills.map((s) => ({
      name: s.name,
      can_disable: s.name !== "write-kinds",
      domain: null,
    }));
    return {
      listed,
      // resolve가 받는 이름도 목록과 같다.
      resolved: receivedSkills(available, off, []),
      b: await code("b"),
      builtin: await code("write-kinds"),
    };
  };
  assert.deepStrictEqual(await receivedOf([]), {
    listed: ["a", "b", "write-kinds"],
    resolved: ["a", "b", "write-kinds"],
    b: "ok",
    builtin: "ok",
  });
  assert.deepStrictEqual(await receivedOf(["b", "write-kinds", "missing"]), {
    listed: ["a", "write-kinds"],
    resolved: ["a", "write-kinds"],
    b: "forbidden",
    builtin: "ok",
  });
});

// frontmatter가 진짜 YAML이라 접은 글(`>`)과 따옴표 값이 읽힌다. 못 읽으면 그 skill이 조용히 사라진다.
// 층 순서는 전역, project·app, domain이고 뒤 층이 같은 이름을 덮는다.
test("skills in the place folder read YAML descriptions and sit between the global and domain layers", () => {
  const files = treeOf({
    "/g/x/SKILL.md": skillFile("x", "", "global"),
    "/g/folded/SKILL.md":
      "---\nname: folded\ndescription: >\n  one\n  two\n---\nBODY",
    "/g/quoted/SKILL.md": '---\nname: quoted\ndescription: "a: b"\n---\n',
    // 따옴표 없는 ": "는 YAML이 못 읽지만 전에는 읽혔다.
    "/g/colon/SKILL.md": "---\nname: colon\ndescription: Write it: how\n---\n",
    "/s/.lophn/skills/x/SKILL.md": skillFile("x", "", "place"),
    "/s/.lophn/skills/y/SKILL.md": skillFile("y", "", "place"),
    "/d/y/SKILL.md": skillFile("y", "", "domain"),
  });
  const entries = discoverSkills(
    files,
    {
      bundled: null,
      registered: ["/g"],
      personal: null,
      place: { source: "app", folder: "/s/.lophn/skills" },
      domains: [{ domain: DOMAIN, folder: "/d" }],
    },
    { kind: "app", off: [] },
  ).entries.map((one) => [one.name, one.source, one.description]);
  assert.deepStrictEqual(entries, [
    ["colon", "global", "Write it: how"],
    ["folded", "global", "one two"],
    ["quoted", "global", "a: b"],
    ["x", "app", "place"],
    ["y", "app", "place"],
    ["y", "domain", "domain"],
  ]);
});

// 합치기에서 진 skill은 agent가 그 domain을 고르지 않아도 돌아오지 않아, domain을 좁힌 agent가 받아야 할 skill을
// 조용히 잃었다.
test("same-name skills in a global layer and domains go to the agent by the domains it works in", async () => {
  const port = treeOf({
    "/g/x/SKILL.md": skillFile("x", "GLOBAL"),
    "/a/x/SKILL.md": skillFile("x", "A"),
    "/b/x/SKILL.md": skillFile("x", "B"),
  });
  const deps: SkillSnapshotDeps = {
    port,
    builtin_root: null,
    personal_store: null,
    global: () => Promise.resolve({ roots: ["/g"], off: [] }),
    place: () =>
      Promise.resolve({
        place_skills: null,
        domain_stores: [
          { domain: "dom_a", folder: "/a" },
          {
            domain: "dom_b",
            folder: "/b",
          },
        ],
        off: [],
      }),
  };
  const bodyFor = async (domains: string[]) => {
    const snapshot = await createSkillSnapshot(deps, {
      id: SESSION,
      kind: "project",
      place: PLACE,
      off: [],
      domains,
    });
    const read = await snapshot.reader.read(SESSION, "x");
    return read.ok ? read.value.trim() : read.error.code;
  };
  assert.deepStrictEqual(await bodyFor([]), "GLOBAL");
  assert.deepStrictEqual(await bodyFor(["dom_a"]), "A");
  assert.deepStrictEqual(await bodyFor(["dom_b"]), "B");
  assert.deepStrictEqual(await bodyFor(["dom_a", "dom_b"]), "A");
});

// 내장 skill은 선언한 place 종류의 prompt와 / 메뉴에만 뜬다. 종류를 건너뛰면 읽을 수 없는 skill이 prompt에 실리고
// (skill.read는 not_found), 한 읽기의 등록부를 같이 쓰는 다른 종류의 목록이 섞인다.
test("내장 skill은 선언한 place 종류의 prompt와 `/` 메뉴에만 뜬다", () => {
  const files = treeOf({
    "/b/write-kinds/SKILL.md": skillFile("write-kinds", "", "built-in"),
    "/g/write-kinds/SKILL.md": skillFile("write-kinds", "", "human"),
  });
  const sources: SkillSources = {
    bundled: "/b",
    registered: ["/g"],
    personal: null,
    domains: [],
  };
  const nowhere = "/nowhere";
  const layer: ProjectLayer = {
    domains: {
      skillsFolder: () => nowhere,
      folderArea: () => nowhere,
      domainIdOfFolder: () => null,
    },
    projectOf: () => null,
    extensionsFile: () => nowhere,
    settingsFolderArea: () => nowhere,
    projectIdOfFolder: () => null,
    placeSkillsFolder: () => nowhere,
  };
  const registry = createExtensionRegistry({
    root: "/r",
    projectLayer: layer,
    files: { read: () => null, writeAtomic: () => {} },
    skillFiles: files,
    domains: () => [],
    sourceFolder: () => null,
    global: {
      servers: [],
      skills: { bundled: "/b", registered: ["/g"], personal: null },
      skillsOff: [],
    },
  });
  const project: AgentPlace = { kind: "project", id: "prj_01" };
  const app: AgentPlace = { kind: "app", id: "app_01" };
  const table: [PlaceKind, AgentPlace | null, string][] = [
    ["home", null, "human"],
    ["project", project, "built-in"],
    ["app", app, "built-in"],
  ];
  const kindsYaml = (rows: readonly { name: string; description: string }[]) =>
    rows
      .filter((row) => row.name === "write-kinds")
      .map((row) => row.description);
  for (const [kind, place, expected] of table) {
    const prompt = discoverSkills(files, sources, { kind, off: [] }).entries;
    assert.deepStrictEqual(kindsYaml(prompt), [expected], `prompt of ${kind}`);
    // register.ts의 / 메뉴와 같은 갈래다.
    const menu = commandSkillsOf(
      place === null ? prompt : registry.skills(place, kind).entries,
      [],
      [],
    );
    assert.deepStrictEqual(kindsYaml(menu), [expected], `menu of ${kind}`);
  }
});

// model은 본문을 읽으려고 `path`를 채워 보낸다. `SKILL.md`가 실제 file인데 실패하면 읽을 길이 없어 같은 값을 되풀이한다.
// 실패 문장에 그 skill의 딸린 file 이름이 없으면 model은 없는 이름을 다시 추측한다.
test("skill.read는 path가 없거나 SKILL.md면 본문을 주고, 모르는 path의 실패에 딸린 file 이름을 싣는다", async () => {
  const port = treeOf({
    "/g/one/SKILL.md": skillFile("one", "BODY_ONE"),
    "/g/one/notes.md": "NOTES",
    "/g/one/skipped.txt": "TXT",
    "/g/two/SKILL.md": skillFile("two", "BODY_TWO"),
  });
  const snapshot = await createSkillSnapshot(
    {
      port,
      builtin_root: null,
      personal_store: null,
      global: () => Promise.resolve({ roots: ["/g"], off: [] }),
      place: () =>
        Promise.resolve({ place_skills: null, domain_stores: [], off: [] }),
    },
    { id: SESSION, kind: "project", place: PLACE, off: [] },
  );
  const read = (name: string, path?: string) =>
    snapshot.reader.read(SESSION, name, path);
  const outcome = async (name: string, path?: string) => {
    const result = await read(name, path);
    return result.ok
      ? result.value.trim()
      : `${result.error.code}: ${result.error.message}`;
  };

  assert.deepStrictEqual(await outcome("one"), "BODY_ONE");
  assert.deepStrictEqual(await outcome("one", "SKILL.md"), "BODY_ONE");
  assert.deepStrictEqual(await outcome("one", "./SKILL.md"), "BODY_ONE");
  assert.deepStrictEqual(await outcome("one", "notes.md"), "NOTES");
  assert.deepStrictEqual(
    await outcome("one", "design-app.md"),
    "not_found: skill one has no file design-app.md (files: notes.md)",
  );
  assert.deepStrictEqual(
    await outcome("two", "design-app.md"),
    "not_found: skill two has no file design-app.md (no bundled files)",
  );
});
