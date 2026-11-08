import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createWorkspaceLayoutStore } from "./workspace-layout-store.ts";

const PROJECT = "prj_00000000000000000000000000";
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

test("판 9 파일은 쓴 대로 읽힌다", async () => {
  await withRoot(async (root) => {
    const store = createWorkspaceLayoutStore(root);
    const layout = {
      active_desk: "_default",
      desks: {
        _default: {
          label: "Main",
          tabs: [tab("/a.md"), tab("/b.md")],
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
          floats: [{ tab: tab("/f.md"), rect: BOUNDS, minimized: false }],
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
      value: { ok: true, layout: { schema_version: 10, ...layout } },
    });
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
      value: { ok: true, layout: { schema_version: 10, ...layout } },
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
      value: { ok: true, layout: { schema_version: 10, ...stacked } },
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
        schema_version: 10,
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

test("Home layout의 agent 탭(workspace home)은 저장이 거절되지 않고 그대로 읽힌다", async () => {
  await withRoot(async (root) => {
    const store = createWorkspaceLayoutStore(root);
    const agent = {
      kind: "agent",
      key: "agent:lophn:1",
      agent: "lophn_home",
      workspace: { kind: "home" },
    };
    const layout = {
      active_desk: "_default",
      desks: {
        _default: {
          label: "Main",
          tabs: [agent],
          selected_tab: agent.key,
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
      value: { ok: true, layout: { schema_version: 10, ...layout } },
    });
  });
});

test("앱 workspace layout의 앱 화면 탭과 app workspace agent 탭은 저장이 거절되지 않고 그대로 읽힌다", async () => {
  await withRoot(async (root) => {
    const store = createWorkspaceLayoutStore(root);
    const app = "app_00000000000000000000000000";
    const screen = { kind: "app_screen", key: `app-screen:${app}`, app };
    const agent = {
      kind: "agent",
      key: "agent:lophn:1",
      agent: "lophn_home",
      workspace: { kind: "app", id: app },
    };
    const layout = {
      active_desk: "_default",
      desks: {
        _default: {
          label: "Main",
          tabs: [screen, agent],
          selected_tab: screen.key,
          groups: [
            {
              layout: {
                dir: "row",
                ratio: 0.5,
                a: { tab: screen.key },
                b: { tab: agent.key },
              },
              focus: screen.key,
            },
          ],
          floats: [],
          detached: [],
        },
      },
    };
    assert.deepEqual(await store.write(app, layout), { ok: true, value: null });
    assert.deepEqual(await store.read(app), {
      ok: true,
      value: { ok: true, layout: { schema_version: 10, ...layout } },
    });
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
      JSON.stringify({ schema_version: 10, active_desk: "_default", desks }),
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
      value: { ok: true, layout: { schema_version: 10, ...layout } },
    });
  });
});

test("터미널 명령(commands)은 쓴 대로 읽히고, 빈 값이나 모르는 필드는 거절한다", async () => {
  await withRoot(async (root) => {
    const store = createWorkspaceLayoutStore(root);
    const layout = {
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
    assert.deepEqual(await store.write(PROJECT, { ...layout, commands }), {
      ok: true,
      value: null,
    });
    const back = await store.read(PROJECT);
    assert.ok(back.ok && back.value?.ok);
    assert.deepEqual(back.value.layout.commands, commands);

    for (const bad of [
      [{ id: "cmd_1", label: "", command: "x" }],
      [{ id: "cmd_1", label: "Dev", command: "" }],
      [{ id: "cmd_1", label: "Dev", command: "x", extra: 1 }],
    ]) {
      const result = await store.write(PROJECT, { ...layout, commands: bad });
      assert.ok(!result.ok && result.error.code === "invalid_input");
    }
  });
});
