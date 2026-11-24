import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createWorkspaceLayoutStore } from "./workspace-layout-store.ts";

const PROJECT = "prj_00000000000000000000000000";
const MACHINE = "mch_00000000000000000000000000";
const SESSION = "ses_00000000000000000000000000";
const CORE_TAB = "tab_00000000000000000000000000";
const BOUNDS = { x: 0, y: 0, width: 400, height: 300 };

function tab(path: string) {
  return { kind: "document_editor", key: path, path };
}

async function withRoot(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "lophn-workspace-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("옛 layouts/ 파일이 있어도 읽지 않고 workspace 파일이 없으면 null이다", async () => {
  await withRoot(async (root) => {
    await mkdir(join(root, "shell", "layouts"), { recursive: true });
    await writeFile(
      join(root, "shell", "layouts", `${PROJECT}.json`),
      JSON.stringify({ schema_version: 7 }),
    );
    assert.deepEqual(await createWorkspaceLayoutStore(root).read(PROJECT), {
      ok: true,
      value: null,
    });
  });
});

test("판 14 파일에서 공통 칸(machine, owner, handed_tab)이 없는 탭은 없이, 있는 탭은 그 칸과 함께 쓴 대로 읽힌다", async () => {
  await withRoot(async (root) => {
    const store = createWorkspaceLayoutStore(root);
    const layout = {
      active_desk: "_default",
      desks: {
        _default: {
          label: "Main",
          tabs: [
            tab("/a.md"),
            {
              ...tab("/b.md"),
              machine: MACHINE,
              owner: SESSION,
              handed_tab: CORE_TAB,
            },
          ],
          selected_tab: "/b.md",
          groups: [
            {
              layout: {
                dir: "column",
                ratio: 0.3,
                a: { tab: "/a.md" },
                b: { tab: "/b.md" },
              },
              focus: "/b.md",
            },
          ],
          floats: [
            {
              tab: { ...tab("/f.md"), machine: MACHINE },
              rect: BOUNDS,
              minimized: false,
            },
          ],
          detached: [],
        },
      },
    };
    assert.deepEqual(await store.write("home", layout), {
      ok: true,
      value: null,
    });
    assert.deepEqual(await store.read("home"), {
      ok: true,
      value: { ok: true, layout: { schema_version: 14, ...layout } },
    });
    // 꼴이 틀린 공통 칸은 저장하지 않는다.
    for (const field of ["machine", "owner", "handed_tab"]) {
      const wrong = structuredClone(layout);
      wrong.desks._default.tabs[0] = {
        ...tab("/a.md"),
        [field]: "nope",
      } as never;
      assert.equal((await store.write("home", wrong)).ok, false);
    }
  });
});

test("터미널 탭은 harness가 없어도 읽히고 있으면 그대로 읽힌다", async () => {
  await withRoot(async (root) => {
    const store = createWorkspaceLayoutStore(root);
    const terminal = (key: string, extra: object = {}) => ({
      kind: "terminal",
      key,
      project_folder: "/work",
      ...extra,
    });
    const layout = {
      active_desk: "_default",
      desks: {
        _default: {
          label: "Main",
          tabs: [
            terminal("t-plain"),
            terminal("t-agent", { harness: "claude" }),
          ],
          selected_tab: "t-plain",
          groups: [],
          floats: [],
          detached: [],
        },
      },
    };
    assert.deepEqual(await store.write("home", layout), {
      ok: true,
      value: null,
    });
    assert.deepEqual(await store.read("home"), {
      ok: true,
      value: { ok: true, layout: { schema_version: 14, ...layout } },
    });
  });
});

test("범위 밖 ratio는 저장하지 않는다", async () => {
  await withRoot(async (root) => {
    const store = createWorkspaceLayoutStore(root);
    const desk = (over: object) => ({
      active_desk: "_default",
      desks: {
        _default: {
          label: "Main",
          tabs: [tab("/a.md"), tab("/b.md"), tab("/c.md")],
          selected_tab: "/a.md",
          floats: [],
          detached: [],
          ...over,
        },
      },
    });
    const wild = await store.write(
      "home",
      desk({
        groups: [
          {
            layout: {
              dir: "row",
              ratio: 0.99,
              a: { tab: "/a.md" },
              b: { tab: "/b.md" },
            },
            focus: "/a.md",
          },
        ],
      }),
    );
    assert.ok(!wild.ok && wild.error.code === "invalid_input");
  });
});

test("tab을 둘로 만들거나 group 규칙을 어긴 layout은 저장하지 않는다", async () => {
  await withRoot(async (root) => {
    const store = createWorkspaceLayoutStore(root);
    const desk = (over: object) => ({
      active_desk: "_default",
      desks: {
        _default: {
          label: "Main",
          tabs: [tab("/a.md"), tab("/b.md"), tab("/c.md"), tab("/d.md")],
          selected_tab: "/a.md",
          groups: [],
          floats: [],
          detached: [],
          ...over,
        },
      },
    });
    const pair = (a: string, b: string, focus = a) => ({
      layout: { dir: "row", ratio: 0.5, a: { tab: a }, b: { tab: b } },
      focus,
    });
    const results = [
      // 같은 tab이 float에도 있다.
      desk({ floats: [{ tab: tab("/a.md"), rect: BOUNDS, minimized: false }] }),
      // 붙어 있지 않다.
      desk({ groups: [pair("/a.md", "/c.md")] }),
      // leaf 순서와 tabs 순서가 다르다.
      desk({ groups: [pair("/b.md", "/a.md")] }),
      // 한 tab이 두 group에 든다.
      desk({ groups: [pair("/a.md", "/b.md"), pair("/b.md", "/c.md")] }),
      // leaf가 1개다.
      desk({ groups: [{ layout: { tab: "/a.md" }, focus: "/a.md" }] }),
      // focus가 leaf가 아니다.
      desk({ groups: [pair("/a.md", "/b.md", "/c.md")] }),
    ].map((layout) => store.write("home", layout));
    for (const result of await Promise.all(results)) {
      assert.ok(!result.ok && result.error.code === "invalid_input");
    }
    assert.deepEqual(await store.read("home"), { ok: true, value: null });

    // 4개 leaf까지는 저장된다.
    const four = {
      dir: "column",
      ratio: 0.5,
      a: pair("/a.md", "/b.md").layout,
      b: pair("/c.md", "/d.md").layout,
    };
    assert.deepEqual(
      await store.write(
        "home",
        desk({ groups: [{ layout: four, focus: "/c.md" }] }),
      ),
      { ok: true, value: null },
    );
  });
});

test("칸의 stack은 쓴 대로 읽히고, 보이던 tab의 kind가 빠져도 칸의 다른 tab이 남는다", async () => {
  await withRoot(async (root) => {
    const store = createWorkspaceLayoutStore(root);
    const desk = (tabs: object[], pane: object) => ({
      active_desk: "_default",
      desks: {
        _default: {
          label: "Main",
          tabs,
          selected_tab: "/t.md",
          groups: [
            {
              layout: { dir: "row", ratio: 0.5, a: { tab: "/t.md" }, b: pane },
              focus: "/t.md",
            },
          ],
          floats: [],
          detached: [],
        },
      },
    });
    const stacked = desk(
      [tab("/t.md"), tab("/c.md"), tab("/a.md"), tab("/b.md")],
      { tab: "/c.md", stack: ["/a.md", "/b.md", "/c.md"] },
    );
    assert.deepEqual(await store.write("home", stacked), {
      ok: true,
      value: null,
    });
    assert.deepEqual(await store.read("home"), {
      ok: true,
      value: { ok: true, layout: { schema_version: 14, ...stacked } },
    });

    // 숨은 tab이 group 밖에 떨어져 있으면 저장하지 않는다.
    const apart = desk(
      [tab("/t.md"), tab("/c.md"), tab("/x.md"), tab("/a.md")],
      { tab: "/c.md", stack: ["/a.md", "/c.md"] },
    );
    const write = await store.write("home", apart);
    assert.ok(!write.ok && write.error.code === "invalid_input");

    // 보이던 tab의 kind가 없어지면 이웃이 보이고 group의 tab은 다시 붙는다.
    const gone = { kind: "gone_kind", key: "/c.md" };
    await writeFile(
      join(root, "shell", "workspaces", "home.json"),
      JSON.stringify({
        schema_version: 14,
        ...desk(
          [tab("/t.md"), gone, tab("/x.md"), tab("/a.md"), tab("/b.md")],
          { tab: "/c.md", stack: ["/a.md", "/b.md", "/c.md"] },
        ),
      }),
    );
    const read = await store.read("home");
    assert.ok(read.ok && read.value?.ok);
    const main = read.value.layout.desks._default!;
    assert.deepEqual(
      main.tabs.map((item) => item.key),
      ["/t.md", "/b.md", "/a.md", "/x.md"],
    );
    assert.deepEqual(main.groups[0]!.layout, {
      dir: "row",
      ratio: 0.5,
      a: { tab: "/t.md" },
      b: { tab: "/b.md", stack: ["/a.md", "/b.md"] },
    });
  });
});

test("다른 판 파일은 unsupported_schema로 읽고 고치지 않는다", async () => {
  await withRoot(async (root) => {
    const file = join(root, "shell", "workspaces", "home.json");
    await mkdir(join(root, "shell", "workspaces"), { recursive: true });
    const text = JSON.stringify({ schema_version: 8, desks: {} });
    await writeFile(file, text);
    assert.deepEqual(await createWorkspaceLayoutStore(root).read("home"), {
      ok: true,
      value: { ok: false, reason: "unsupported_schema" },
    });
    assert.equal(await readFile(file, "utf8"), text);
  });
});

test("손상된 파일은 읽을 때 .bak으로 한 벌 남긴다", async () => {
  await withRoot(async (root) => {
    const file = join(root, "shell", "workspaces", "home.json");
    await mkdir(join(root, "shell", "workspaces"), { recursive: true });
    const text = '{"schema_version": 12, "desks": ';
    await writeFile(file, text);
    assert.deepEqual(await createWorkspaceLayoutStore(root).read("home"), {
      ok: true,
      value: { ok: false, reason: "corrupt" },
    });
    assert.equal(await readFile(`${file}.bak`, "utf8"), text);
  });
});

test("폴더 밖으로 나가는 workspace key는 읽기와 쓰기 모두 거절한다", async () => {
  await withRoot(async (root) => {
    const store = createWorkspaceLayoutStore(root);
    for (const workspace of ["../x", "a/b", "a\\b", "..", "", "x.json"]) {
      const read = await store.read(workspace);
      const write = await store.write(workspace, {});
      for (const result of [read, write]) {
        assert.ok(
          !result.ok && result.error.code === "invalid_input",
          workspace,
        );
      }
    }
  });
});

test("quick 필드가 없는 파일도 읽히고, quick이 있는 파일은 쓴 대로 읽힌다", async () => {
  await withRoot(async (root) => {
    const dir = join(root, "shell", "workspaces");
    await mkdir(dir, { recursive: true });
    const desks = {
      _default: {
        label: "Main",
        tabs: [
          tab("/a.md"),
          { kind: "project_settings", key: "project-settings" },
        ],
        selected_tab: "project-settings",
        groups: [],
        floats: [],
        detached: [],
      },
    };
    await writeFile(
      join(dir, `${PROJECT}.json`),
      JSON.stringify({ schema_version: 13, active_desk: "_default", desks }),
    );
    const store = createWorkspaceLayoutStore(root);
    const old = await store.read(PROJECT);
    assert.ok(old.ok && old.value?.ok);
    assert.equal(old.value.layout.quick, undefined);
    assert.deepEqual(
      old.value.layout.desks._default?.tabs.map((item) => item.key),
      ["/a.md", "project-settings"],
    );

    const quick = {
      order: ["search", "terminal", "pin:app_x:main"],
      apps: [{ app: "app_x", surface: "main" }],
      hidden: ["search"],
    };
    const { schema_version: _, ...rest } = old.value.layout;
    assert.deepEqual(await store.write(PROJECT, { ...rest, quick }), {
      ok: true,
      value: null,
    });
    const back = await store.read(PROJECT);
    assert.ok(back.ok && back.value?.ok);
    assert.deepEqual(back.value.layout.quick, quick);

    const bad = await store.write(PROJECT, {
      ...rest,
      quick: { order: [], apps: [{ app: "app_x" }] },
    });
    assert.ok(!bad.ok && bad.error.code === "invalid_input");
  });
});

test("browser 탭의 keep_alive는 쓴 대로 읽히고 없는 옛 탭도 읽힌다", async () => {
  await withRoot(async (root) => {
    const store = createWorkspaceLayoutStore(root);
    const layout = {
      active_desk: "_default",
      desks: {
        _default: {
          label: "Main",
          tabs: [
            { kind: "browser", key: "b-old", url: "https://a.test/" },
            {
              kind: "browser",
              key: "b-keep",
              url: "https://b.test/",
              keep_alive: true,
            },
          ],
          selected_tab: "b-old",
          groups: [],
          floats: [],
          detached: [],
        },
      },
    };
    assert.deepEqual(await store.write("home", layout), {
      ok: true,
      value: null,
    });
    assert.deepEqual(await store.read("home"), {
      ok: true,
      value: { ok: true, layout: { schema_version: 14, ...layout } },
    });
  });
});

test("판 13 layout의 commands는 core 가져오기가 성공하면 판 14로 옮겨 지우고, 실패하면 판 13을 유지해 다음에 다시 시도한다", async () => {
  await withRoot(async (root) => {
    const dir = join(root, "shell", "workspaces");
    await mkdir(dir, { recursive: true });
    const base = {
      active_desk: "_default",
      desks: {
        _default: {
          label: "Main",
          tabs: [],
          selected_tab: null,
          groups: [],
          floats: [],
          detached: [],
        },
      },
    };
    const commands = [{ id: "cmd_1", label: "Dev", command: "npm run dev" }];
    const filePath = join(dir, `${PROJECT}.json`);
    await writeFile(
      filePath,
      JSON.stringify({ schema_version: 13, ...base, commands }),
    );

    // 1. migrateCommands가 실패하면 판 13 파일과 commands를 그대로 유지한다.
    let shouldSucceed = false;
    const imported: { project: string; count: number }[] = [];
    const store = createWorkspaceLayoutStore(root, {
      async migrateCommands(project, list) {
        if (!shouldSucceed) return false;
        imported.push({ project, count: list.length });
        return true;
      },
    });
    const first = await store.read(PROJECT);
    assert.ok(first.ok && first.value?.ok);
    assert.equal(first.value.layout.schema_version, 14);
    const onDiskFailed = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(onDiskFailed.schema_version, 13);
    assert.deepEqual(onDiskFailed.commands, commands);

    // 실패 상태에서 write가 와도 판 13 commands가 사라지지 않는다.
    assert.deepEqual(await store.write(PROJECT, base), {
      ok: true,
      value: null,
    });
    const afterWriteFailed = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(afterWriteFailed.schema_version, 13);
    assert.deepEqual(afterWriteFailed.commands, commands);

    // 2. 다음 시도에서 성공하면 core로 옮기고 판 14로 저장해 commands를 지운다.
    shouldSucceed = true;
    const second = await store.read(PROJECT);
    assert.ok(second.ok && second.value?.ok);
    assert.deepEqual(imported, [{ project: PROJECT, count: 1 }]);
    const onDiskMigrated = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(onDiskMigrated.schema_version, 14);
    assert.equal("commands" in onDiskMigrated, false);

    // 3. 판 14 write는 commands 필드를 거절한다.
    const rejected = await store.write(PROJECT, { ...base, commands });
    assert.ok(!rejected.ok && rejected.error.code === "invalid_input");
  });
});

test("leaf 하나의 bundle group은 label·group_id·collapsed와 함께 쓴 대로 읽히고, 쌓이지 않은 leaf 하나는 거절된다", async () => {
  await withRoot(async (root) => {
    const store = createWorkspaceLayoutStore(root);
    const layout = (group: object) => ({
      active_desk: "_default",
      desks: {
        _default: {
          label: "Main",
          tabs: [tab("/a.md"), tab("/b.md"), tab("/c.md")],
          selected_tab: "/c.md",
          groups: [group],
          floats: [],
          detached: [],
        },
      },
    });
    const bundle = {
      layout: { tab: "/a.md", stack: ["/a.md", "/b.md"] },
      focus: "/a.md",
      group_id: "wf:1/s1",
      label: "Step 1",
      collapsed: true,
    };
    assert.deepEqual(await store.write("home", layout(bundle)), {
      ok: true,
      value: null,
    });
    assert.deepEqual(await store.read("home"), {
      ok: true,
      value: { ok: true, layout: { schema_version: 14, ...layout(bundle) } },
    });
    const single = await store.write(
      "home",
      layout({ layout: { tab: "/a.md" }, focus: "/a.md", label: "x" }),
    );
    assert.ok(!single.ok && single.error.code === "invalid_input");

    // bundle에서 알 수 없는 kind가 빠져 stack이 1개가 되면 group이 풀리고, 2개 이상 남으면 bundle이 남는다.
    await writeFile(
      join(root, "shell", "workspaces", "home.json"),
      JSON.stringify({
        schema_version: 14,
        active_desk: "_default",
        desks: {
          _default: {
            label: "Main",
            tabs: [
              tab("/a.md"),
              { kind: "gone_kind", key: "/gone.md" },
              tab("/b.md"),
              tab("/c.md"),
              { kind: "gone_kind", key: "/gone2.md" },
            ],
            selected_tab: "/a.md",
            groups: [
              {
                layout: { tab: "/a.md", stack: ["/a.md", "/gone.md"] },
                focus: "/a.md",
                label: "Dissolves",
              },
              {
                layout: {
                  tab: "/gone2.md",
                  stack: ["/b.md", "/c.md", "/gone2.md"],
                },
                focus: "/gone2.md",
                group_id: "wf:1/s2",
                label: "Survives",
                collapsed: true,
              },
            ],
            floats: [],
            detached: [],
          },
        },
      }),
    );
    const read = await store.read("home");
    assert.ok(read.ok && read.value?.ok);
    const readDesk = read.value.layout.desks._default!;
    assert.deepEqual(readDesk.groups, [
      {
        layout: { tab: "/c.md", stack: ["/b.md", "/c.md"] },
        focus: "/c.md",
        group_id: "wf:1/s2",
        label: "Survives",
        collapsed: true,
      },
    ]);
  });
});
