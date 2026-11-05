import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  AgentWorkspace,
  WorkspaceKind,
} from "../../../protocol/lophn-agent/mod.ts";
import { createSkillSnapshot, type SkillSnapshotDeps } from "./skill-read.ts";
import { sharedSkillsOf } from "./skill-folders.ts";
import { readSharedHeads } from "./skills.ts";
import { ok } from "../../../base/mod.ts";
import { receivedSkills } from "../agents/resolve.ts";
import {
  discoverSkills,
  mergeSkillLayers,
  type SkillFiles,
  type SkillSources,
} from "./skills.ts";
import { commandSkillsOf, createExtensionRegistry } from "./registry.ts";
import type { ProjectLayer } from "./project-settings.ts";

// 끌 수 없는 내장 skill은 어느 층에서 꺼도, 같은 이름의 사람 skill이 있어도 그대로 남는다. 이 규칙이 깨지면 workspace가
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
const WORKSPACE: AgentWorkspace = { kind: "project", id: "prj_01" };

type Case = {
  name: string;
  kind: WorkspaceKind;
  // 같은 이름의 사람 skill을 둔 층
  human: ("global" | "workspace-data")[];
  off: { global?: boolean; project?: boolean; agent?: boolean };
  // 최종 write-workflow의 본문. null이면 목록에 없다.
  expect: "BUILTIN" | "GLOBAL" | "WORKSPACE_DATA" | null;
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
    name: "workspace-data human skill with the same name",
    kind: "project",
    human: ["workspace-data"],
    off: {},
    expect: "BUILTIN",
  },
  {
    name: "human skills and off at every layer",
    kind: "project",
    human: ["global", "workspace-data"],
    off: { global: true, project: true, agent: true },
    expect: "BUILTIN",
  },
  // 내장 skill은 선언한 workspace 종류의 것만이다. 다른 workspace 종류에는 이름이 비어 있어 사람 skill이 그대로 쓰인다.
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
    human: ["workspace-data"],
    off: {},
    expect: "WORKSPACE_DATA",
  },
];

for (const one of CASES) {
  test(`write-workflow stays: ${one.name}`, async () => {
    const files: Record<string, string> = {
      "/b/write-workflow/SKILL.md": skillFile("write-workflow", "BUILTIN"),
      "/b/spare-builtin/SKILL.md": skillFile("spare-builtin", "BUILTIN"),
    };
    if (one.human.includes("global")) {
      files["/g/write-workflow/SKILL.md"] = skillFile(
        "write-workflow",
        "GLOBAL",
      );
    }
    if (one.human.includes("workspace-data")) {
      files["/p/write-workflow/SKILL.md"] = skillFile(
        "write-workflow",
        "WORKSPACE_DATA",
      );
    }
    const port = treeOf(files);
    const globalOff = one.off.global ? ["write-workflow"] : [];
    const projectOff = one.off.project ? ["write-workflow"] : [];
    const agentOff = one.off.agent ? ["write-workflow"] : [];
    const deps: SkillSnapshotDeps = {
      port,
      builtin_root: "/b",
      personal_store: null,
      shared: () => Promise.resolve([]),
      global: () => Promise.resolve({ roots: ["/g"], off: globalOff }),
      workspace: () =>
        Promise.resolve({
          workspace_skills: null,
          workspace_data: "/p",
          off: projectOff,
        }),
    };
    const snapshot = await createSkillSnapshot(deps, {
      id: SESSION,
      kind: one.kind,
      workspace: WORKSPACE,
      off: agentOff,
      apps: [],
    });

    const listed = snapshot.skills.find(
      (skill) => skill.name === "write-workflow",
    );
    const read = await snapshot.reader.read(SESSION, "write-workflow");
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
    "/b/write-workflow/SKILL.md": skillFile("write-workflow", "BUILTIN"),
    "/g/a/SKILL.md": skillFile("a", "A"),
    "/g/b/SKILL.md": skillFile("b", "B"),
  });
  const deps: SkillSnapshotDeps = {
    port,
    builtin_root: "/b",
    personal_store: null,
    shared: () => Promise.resolve([]),
    global: () => Promise.resolve({ roots: ["/g"], off: [] }),
    workspace: () =>
      Promise.resolve({
        workspace_skills: null,
        workspace_data: null,
        off: [],
      }),
  };
  const receivedOf = async (off: string[]) => {
    const snapshot = await createSkillSnapshot(deps, {
      id: SESSION,
      kind: "project",
      workspace: WORKSPACE,
      off,
      apps: [],
    });
    const code = async (name: string) => {
      const read = await snapshot.reader.read(SESSION, name);
      return read.ok ? "ok" : read.error.code;
    };
    const listed = snapshot.skills.filter((s) => s.enabled).map((s) => s.name);
    const available = snapshot.skills.map((s) => ({
      name: s.name,
      can_disable: s.name !== "write-workflow",
    }));
    return {
      listed,
      // resolve가 받는 이름도 목록과 같다.
      resolved: receivedSkills(available, off),
      b: await code("b"),
      builtin: await code("write-workflow"),
    };
  };
  assert.deepStrictEqual(await receivedOf([]), {
    listed: ["a", "b", "write-workflow"],
    resolved: ["a", "b", "write-workflow"],
    b: "ok",
    builtin: "ok",
  });
  assert.deepStrictEqual(await receivedOf(["b", "write-workflow", "missing"]), {
    listed: ["a", "write-workflow"],
    resolved: ["a", "write-workflow"],
    b: "forbidden",
    builtin: "ok",
  });
});

// frontmatter가 진짜 YAML이라 접은 글(`>`)과 따옴표 값이 읽힌다. 못 읽으면 그 skill이 조용히 사라진다.
// 층 순서는 전역, project·app, workspace-data이고 뒤 층이 같은 이름을 덮는다.
test("skills in the workspace folder read YAML descriptions and sit between the global and workspace-data layers", () => {
  const files = treeOf({
    "/g/x/SKILL.md": skillFile("x", "", "global"),
    "/g/folded/SKILL.md":
      "---\nname: folded\ndescription: >\n  one\n  two\n---\nBODY",
    "/g/quoted/SKILL.md": '---\nname: quoted\ndescription: "a: b"\n---\n',
    // 따옴표 없는 ": "는 YAML이 못 읽지만 전에는 읽혔다.
    "/g/colon/SKILL.md": "---\nname: colon\ndescription: Write it: how\n---\n",
    "/s/.lophn/skills/x/SKILL.md": skillFile("x", "", "workspace"),
    "/s/.lophn/skills/y/SKILL.md": skillFile("y", "", "workspace"),
    "/d/y/SKILL.md": skillFile("y", "", "workspace-data"),
  });
  const entries = discoverSkills(
    files,
    {
      bundled: null,
      registered: ["/g"],
      personal: null,
      workspace: { source: "app", folder: "/s/.lophn/skills" },
      workspaceData: "/d",
    },
    { kind: "app", off: [] },
  ).entries.map((one) => [one.name, one.source, one.description]);
  assert.deepStrictEqual(entries, [
    ["colon", "global", "Write it: how"],
    ["folded", "global", "one two"],
    ["quoted", "global", "a: b"],
    ["x", "app", "workspace"],
    ["y", "workspace-data", "workspace-data"],
  ]);
});

// 내장 skill은 선언한 workspace 종류의 prompt와 / 메뉴에만 뜬다. 종류를 건너뛰면 읽을 수 없는 skill이 prompt에 실리고
// (skill.read는 not_found), 한 읽기의 등록부를 같이 쓰는 다른 종류의 목록이 섞인다.
test("내장 skill은 선언한 workspace 종류의 prompt와 `/` 메뉴에만 뜬다", () => {
  const files = treeOf({
    "/b/write-workflow/SKILL.md": skillFile("write-workflow", "", "built-in"),
    "/g/write-workflow/SKILL.md": skillFile("write-workflow", "", "human"),
  });
  const sources: SkillSources = {
    bundled: "/b",
    registered: ["/g"],
    personal: null,
  };
  const nowhere = "/nowhere";
  const layer: ProjectLayer = {
    workspaceDataSkillsFolder: () => nowhere,
    isWorkspaceDataSkills: () => false,
    projectOf: () => null,
    extensionsFile: () => nowhere,
    settingsFolderArea: () => nowhere,
    projectIdOfFolder: () => null,
    workspaceSkillsFolder: () => nowhere,
  };
  const registry = createExtensionRegistry({
    root: "/r",
    projectLayer: layer,
    files: { read: () => null, writeAtomic: () => {} },
    skillFiles: files,
    sourceFolder: () => null,
    global: {
      servers: [],
      skills: { bundled: "/b", registered: ["/g"], personal: null },
      skillsOff: [],
    },
  });
  const project: AgentWorkspace = { kind: "project", id: "prj_01" };
  const app: AgentWorkspace = {
    kind: "app",
    id: "app_01h455vb4pex5v6nkc6gd5fd01",
  };
  const table: [WorkspaceKind, AgentWorkspace | null, string][] = [
    ["home", null, "human"],
    ["project", project, "built-in"],
    ["app", app, "human"],
  ];
  const builtinOnly = (
    rows: readonly { name: string; description: string }[],
  ) =>
    rows
      .filter((row) => row.name === "write-workflow")
      .map((row) => row.description);
  for (const [kind, workspace, expected] of table) {
    const prompt = discoverSkills(files, sources, { kind, off: [] }).entries;
    assert.deepStrictEqual(
      builtinOnly(prompt),
      [expected],
      `prompt of ${kind}`,
    );
    // register.ts의 / 메뉴와 같은 갈래다.
    const menu = commandSkillsOf(
      workspace === null ? prompt : registry.skills(workspace, kind).entries,
      [],
    );
    assert.deepStrictEqual(builtinOnly(menu), [expected], `menu of ${kind}`);
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
      shared: () => Promise.resolve([]),
      global: () => Promise.resolve({ roots: ["/g"], off: [] }),
      workspace: () =>
        Promise.resolve({
          workspace_skills: null,
          workspace_data: null,
          off: [],
        }),
    },
    { id: SESSION, kind: "project", workspace: WORKSPACE, off: [], apps: [] },
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

// 앱을 할당받지 않은 agent는 그 앱의 public skill을 목록에서도 skill.read로도 받지 않는다. 할당받아도 같은 이름의
// 전역 skill이 이기고(공유 층은 내장 바로 위), 앱 자기 workspace에서는 `app` 층이 있어 공유로 또 싣지 않는다.
test("shared skills reach only the agents the app is assigned to", async () => {
  const slug = "notes";
  const shared = {
    app: "app_01h455vb4pex5v6nkc6gd5fd01",
    slug,
    release: "rel_01h455vb4pex5v6nkc6gd5fd01",
    name: "share-me",
    description: "shared",
    skill_md: skillFile("share-me", "SHARED_BODY"),
    files: [{ name: "extra.md", text: "EXTRA" }],
  };
  const clash = { ...shared, name: "x", skill_md: skillFile("x", "FROM_APP") };
  // route처럼 요청한 slug의 것만 준다.
  const machine = (path: string, body: unknown) => {
    assert.strictEqual(path, "/apps/skills");
    const { apps } = body as { apps: string[] };
    return Promise.resolve(
      ok({ skills: apps.includes(slug) ? [shared, clash] : [] }),
    );
  };
  const deps: SkillSnapshotDeps = {
    port: treeOf({ "/g/x/SKILL.md": skillFile("x", "GLOBAL") }),
    builtin_root: null,
    personal_store: null,
    shared: (apps, workspace) => sharedSkillsOf(machine, apps, workspace),
    global: () => Promise.resolve({ roots: ["/g"], off: [] }),
    workspace: () =>
      Promise.resolve({
        workspace_skills: null,
        workspace_data: null,
        off: [],
      }),
  };
  const outcome = async (
    apps: string[],
    workspace: AgentWorkspace = WORKSPACE,
  ) => {
    const snapshot = await createSkillSnapshot(deps, {
      id: SESSION,
      kind: workspace.kind,
      workspace,
      off: [],
      apps,
    });
    const text = async (name: string, path?: string) => {
      const read = await snapshot.reader.read(SESSION, name, path);
      return read.ok ? read.value.trim() : read.error.code;
    };
    return {
      listed: snapshot.skills.map((skill) => skill.name),
      body: await text("share-me"),
      file: await text("share-me", "extra.md"),
      clash: await text("x"),
    };
  };

  assert.deepStrictEqual(await outcome([slug]), {
    listed: ["share-me", "x"],
    body: "SHARED_BODY",
    file: "EXTRA",
    clash: "GLOBAL",
  });
  assert.deepStrictEqual(await outcome([]), {
    listed: ["x"],
    body: "not_found",
    file: "not_found",
    clash: "GLOBAL",
  });
  const own: AgentWorkspace = {
    kind: "app",
    id: "app_01h455vb4pex5v6nkc6gd5fd01",
  };
  assert.deepStrictEqual((await outcome([slug], own)).listed, ["x"]);
});

// `/` 메뉴와 개수가 쓰는 동기 목록도 선언한 public skill만, bundle 안의 평범한 폴더에서만 읽는다.
test("shared skill heads skip undeclared, mismatched and symlinked skills", () => {
  const files = treeOf({
    "/b/.lophn/skills/pub/SKILL.md": skillFile("pub", "B"),
    "/b/.lophn/skills/private/SKILL.md": skillFile("private", "B"),
    "/b/.lophn/skills/renamed/SKILL.md": skillFile("other", "B"),
    "/b/.lophn/skills/linked/SKILL.md": skillFile("linked", "B"),
  });
  const guarded: SkillFiles = {
    ...files,
    kind: (path) => (path.endsWith("/linked") ? "symlink" : files.kind(path)),
  };
  const heads = readSharedHeads(guarded, [
    {
      app: "app_01",
      slug: "notes",
      bundle: "/b",
      names: ["linked", "pub", "renamed"],
    },
  ]);
  assert.deepStrictEqual(
    heads.map((head) => head.name),
    ["pub"],
  );
});
