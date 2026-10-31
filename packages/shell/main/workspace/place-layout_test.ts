import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPlaceLayoutStore } from "./place-layout-store.ts";

const PROJECT = "prj_00000000000000000000000000";
const BOUNDS = { x: 0, y: 0, width: 400, height: 300 };

function tab(path: string) {
  return { kind: "document_editor", key: path, path };
}

// 칸 셋(둘째 칸이 focus), desk 둘, origin_pane·docked_at이 있는 float, detached. "/dup.md"는 두 칸에 있다.
function v7File() {
  return {
    schema_version: 7,
    layout: {
      schema_version: 7,
      project: PROJECT,
      active_desk: "review",
      desks: {
        _default: {
          panes: [
            { tabs: [tab("/a.md"), tab("/dup.md")], selected_tab: "/a.md" },
            { tabs: [tab("/b.md"), tab("/dup.md")], selected_tab: "/b.md" },
            { tabs: [tab("/c.md")], selected_tab: "/c.md" },
          ],
          layout: {
            dir: "row",
            ratio: 0.5,
            a: "leaf",
            b: { dir: "column", ratio: 0.5, a: "leaf", b: "leaf" },
          },
          focused_pane: 1,
          floats: [
            {
              tab: tab("/f1.md"),
              rect: BOUNDS,
              minimized: false,
              origin_pane: 2,
            },
            {
              tab: tab("/f2.md"),
              rect: BOUNDS,
              minimized: true,
              origin_pane: 0,
              docked_at: 1,
            },
          ],
          detached: [{ tab: tab("/d1.md"), bounds: BOUNDS }],
        },
        review: {
          panes: [{ tabs: [tab("/r.md")], selected_tab: "/r.md" }],
          layout: "leaf",
          focused_pane: 0,
          floats: [],
          detached: [],
        },
      },
      rail_apps: [],
    },
  };
}

async function withRoot(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "lophn-place-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("판 7 project layout을 올려 읽어도 tab이 desk마다 한 번씩 남고 옛 파일은 그대로다", async () => {
  await withRoot(async (root) => {
    const old = join(root, "shell", "layouts", `${PROJECT}.json`);
    await mkdir(join(root, "shell", "layouts"), { recursive: true });
    const text = JSON.stringify(v7File());
    await writeFile(old, text);

    const read = await createPlaceLayoutStore(root).read(PROJECT);
    assert.ok(read.ok && read.value?.ok);
    const { layout } = read.value;
    assert.equal(layout.schema_version, 8);
    assert.equal(layout.active_desk, "review");

    const main = layout.desks._default!;
    // 칸 셋이 group 하나가 된다: leaf = 칸의 고른 tab, 배치 tree는 그대로, tabs는 group이 맨 앞.
    assert.deepEqual(
      main.tabs.map((item) => item.key),
      ["/a.md", "/b.md", "/c.md", "/dup.md"],
    );
    assert.equal(main.selected_tab, "/b.md"); // focus 칸의 선택
    assert.deepEqual(main.groups, [
      {
        layout: {
          dir: "row",
          ratio: 0.5,
          a: { tab: "/a.md" },
          b: {
            dir: "column",
            ratio: 0.5,
            a: { tab: "/b.md" },
            b: { tab: "/c.md" },
          },
        },
        focus: "/b.md",
      },
    ]);
    assert.equal(main.label, "Main");
    assert.equal(main.workflow, undefined);
    assert.deepEqual(
      main.floats.map((item) => [item.tab.key, item.minimized]),
      [
        ["/f1.md", false],
        ["/f2.md", true],
      ],
    );
    assert.deepEqual(Object.keys(main.floats[0]!).sort(), [
      "minimized",
      "rect",
      "tab",
    ]);
    assert.deepEqual(
      main.detached.map((item) => item.tab.key),
      ["/d1.md"],
    );
    assert.deepEqual(
      [main.label, layout.desks.review!.label, layout.desks.review!.workflow],
      ["Main", "review", "review"],
    );

    assert.equal(await readFile(old, "utf8"), text);
    await assert.rejects(
      readFile(join(root, "shell", "places", `${PROJECT}.json`)),
    );
  });
});

test("판 7 칸이 5개 이상이거나 빈 칸이 있으면 group 없이 한 줄로 합치고 tab을 잃지 않는다", async () => {
  await withRoot(async (root) => {
    const names = ["a", "b", "c", "d", "e", "f"];
    const chain = (index: number): unknown =>
      index === names.length - 1
        ? "leaf"
        : { dir: "row", ratio: 0.5, a: "leaf", b: chain(index + 1) };
    const file = v7File();
    file.layout.desks = {
      _default: {
        panes: names.map((n) => ({
          tabs: [tab(`/${n}.md`)],
          selected_tab: `/${n}.md`,
        })),
        layout: chain(0),
        focused_pane: 0,
        floats: [],
        detached: [],
      },
      review: {
        panes: [
          { tabs: [tab("/x.md")], selected_tab: "/x.md" },
          { tabs: [], selected_tab: null },
        ],
        layout: { dir: "row", ratio: 0.5, a: "leaf", b: "leaf" },
        focused_pane: 0,
        floats: [],
        detached: [],
      },
    } as never;
    await mkdir(join(root, "shell", "layouts"), { recursive: true });
    await writeFile(
      join(root, "shell", "layouts", `${PROJECT}.json`),
      JSON.stringify(file),
    );
    const read = await createPlaceLayoutStore(root).read(PROJECT);
    assert.ok(read.ok && read.value?.ok);
    const { desks } = read.value.layout;
    assert.deepEqual(desks._default!.groups, []);
    assert.deepEqual(
      desks._default!.tabs.map((item) => item.key),
      names.map((n) => `/${n}.md`),
    );
    assert.deepEqual(desks.review!.groups, []);
    assert.deepEqual(
      desks.review!.tabs.map((item) => item.key),
      ["/x.md"],
    );
  });
});

test("판 8 파일은 쓴 대로 읽히고, place 파일이 있으면 옛 layout을 보지 않는다", async () => {
  await withRoot(async (root) => {
    const store = createPlaceLayoutStore(root);
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
      value: { ok: true, layout: { schema_version: 8, ...layout } },
    });

    await mkdir(join(root, "shell", "layouts"), { recursive: true });
    await writeFile(
      join(root, "shell", "layouts", `${PROJECT}.json`),
      JSON.stringify(v7File()),
    );
    await store.write(PROJECT, layout);
    const read = await store.read(PROJECT);
    assert.ok(read.ok && read.value?.ok);
    assert.equal(read.value.layout.desks._default!.tabs.length, 2);
  });
});

test("split을 가진 초기 판 8 파일은 group 하나로 읽고, 범위 밖 ratio는 저장하지 않는다", async () => {
  await withRoot(async (root) => {
    const store = createPlaceLayoutStore(root);
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
    await mkdir(join(root, "shell", "places"), { recursive: true });
    await writeFile(
      join(root, "shell", "places", "home.json"),
      JSON.stringify({
        schema_version: 8,
        ...desk({ split: { a: "/a.md", b: "/b.md", focus: "b" } }),
      }),
    );
    const read = await store.read("home");
    assert.ok(read.ok && read.value?.ok);
    assert.deepEqual(read.value.layout.desks._default!.groups, [
      {
        layout: {
          dir: "row",
          ratio: 0.5,
          a: { tab: "/a.md" },
          b: { tab: "/b.md" },
        },
        focus: "/b.md",
      },
    ]);
    // groups도 split도 없는 파일은 group이 없다.
    await writeFile(
      join(root, "shell", "places", "home.json"),
      JSON.stringify({ schema_version: 8, ...desk({}) }),
    );
    const none = await store.read("home");
    assert.ok(none.ok && none.value?.ok);
    assert.deepEqual(none.value.layout.desks._default!.groups, []);

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
    const store = createPlaceLayoutStore(root);
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

test("다른 판 파일은 unsupported_schema로 읽고 고치지 않는다", async () => {
  await withRoot(async (root) => {
    const file = join(root, "shell", "places", "home.json");
    await mkdir(join(root, "shell", "places"), { recursive: true });
    const text = JSON.stringify({ schema_version: 9, desks: {} });
    await writeFile(file, text);
    assert.deepEqual(await createPlaceLayoutStore(root).read("home"), {
      ok: true,
      value: { ok: false, reason: "unsupported_schema" },
    });
    assert.equal(await readFile(file, "utf8"), text);
  });
});

test("폴더 밖으로 나가는 place key는 읽기와 쓰기 모두 거절한다", async () => {
  await withRoot(async (root) => {
    const store = createPlaceLayoutStore(root);
    for (const place of ["../x", "a/b", "a\\b", "..", "", "x.json"]) {
      const read = await store.read(place);
      const write = await store.write(place, {});
      for (const result of [read, write]) {
        assert.ok(!result.ok && result.error.code === "invalid_input", place);
      }
    }
  });
});

test("Home layout의 agent 탭(work_place home)은 저장이 거절되지 않고 그대로 읽힌다", async () => {
  await withRoot(async (root) => {
    const store = createPlaceLayoutStore(root);
    const agent = {
      kind: "agent",
      key: "agent:lophn:1",
      agent: "lophn",
      work_place: { kind: "home" },
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
      value: { ok: true, layout: { schema_version: 8, ...layout } },
    });
  });
});

test("앱 place layout의 앱 화면 탭과 app work_place agent 탭은 저장이 거절되지 않고 그대로 읽힌다", async () => {
  await withRoot(async (root) => {
    const store = createPlaceLayoutStore(root);
    const app = "app_00000000000000000000000000";
    const screen = { kind: "app_screen", key: `app-screen:${app}`, app };
    const agent = {
      kind: "agent",
      key: "agent:lophn:1",
      agent: "lophn",
      work_place: { kind: "app", id: app },
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
      value: { ok: true, layout: { schema_version: 8, ...layout } },
    });
  });
});
