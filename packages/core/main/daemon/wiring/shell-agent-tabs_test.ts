import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  shellAgentTabsStep,
  shellLayoutGroupsStep,
  shellLayoutMachinesStep,
  shellLayoutOwnersStep,
} from "./shell-agent-tabs.ts";
import {
  createIdSource,
  manualClock,
  seededRandom,
} from "../../../../base/mod.ts";

// 이 step은 ids를 쓰지 않지만 DataStep은 deps를 늘 받는다.
const stepDeps = {
  ids: createIdSource({ clock: manualClock(0), random: seededRandom(1) }),
};

const RECT = { x: 10, y: 20, width: 400, height: 300 };
const agent = (key: string) => ({
  kind: "agent",
  key,
  agent: "lophn_home",
  workspace: { kind: "home" },
});
const doc = (key: string) => ({ kind: "document_editor", key, path: key });

test("저장된 layout과 전역 float에서 Agent 탭만 걷어내고 group·고른 탭을 맞추며 다시 돌아도 같다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-shell-agent-tabs-"));
  try {
    await mkdir(join(root, "shell", "workspaces"), { recursive: true });
    const layoutFile = join(root, "shell", "workspaces", "home.json");
    const floatsFile = join(root, "shell", "global-floats.json");
    await writeFile(
      layoutFile,
      JSON.stringify({
        schema_version: 10,
        active_desk: "_default",
        desks: {
          _default: {
            label: "Main",
            tabs: [agent("a1"), doc("d1"), doc("d2"), doc("d3")],
            selected_tab: "a1",
            groups: [
              {
                layout: {
                  dir: "row",
                  ratio: 0.5,
                  a: { tab: "a1" },
                  b: { tab: "d1" },
                },
                focus: "a1",
              },
              {
                layout: {
                  dir: "row",
                  ratio: 0.5,
                  a: { tab: "d2" },
                  b: { tab: "d3" },
                },
                focus: "d2",
              },
            ],
            floats: [{ tab: agent("a2"), rect: RECT, minimized: false }],
            detached: [{ tab: agent("a3"), bounds: RECT }],
          },
        },
      }),
    );
    await writeFile(
      floatsFile,
      JSON.stringify({
        schema_version: 2,
        floats: [
          {
            workspace: { kind: "home" },
            tab: agent("a4"),
            rect: RECT,
            minimized: false,
          },
          {
            workspace: { kind: "home" },
            tab: doc("d9"),
            rect: RECT,
            minimized: true,
          },
        ],
      }),
    );
    assert.deepEqual(await shellAgentTabsStep.run(root, stepDeps), {
      ok: true,
      value: undefined,
    });
    const layout = JSON.parse(await readFile(layoutFile, "utf8"));
    const desk = layout.desks._default;
    assert.deepEqual(
      desk.tabs.map((tab: { key: string }) => tab.key),
      ["d1", "d2", "d3"],
    );
    assert.equal(desk.selected_tab, "d1");
    // Agent 탭이 든 group은 풀리고 다른 group은 그대로다.
    assert.equal(desk.groups.length, 1);
    assert.equal(desk.groups[0].focus, "d2");
    assert.deepEqual([desk.floats, desk.detached], [[], []]);
    const floats = JSON.parse(await readFile(floatsFile, "utf8"));
    assert.deepEqual(
      floats.floats.map((item: { tab: { key: string } }) => item.tab.key),
      ["d9"],
    );

    const again = await readFile(layoutFile, "utf8");
    assert.deepEqual(await shellAgentTabsStep.run(root, stepDeps), {
      ok: true,
      value: undefined,
    });
    assert.equal(await readFile(layoutFile, "utf8"), again);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const [step, layout, globalFloats] of [
  [shellLayoutMachinesStep, [10, 11], [2, 3]],
  [shellLayoutOwnersStep, [11, 12], [3, 4]],
] as const) {
  test(`${step.id}: 판 ${layout[0]} layout과 판 ${globalFloats[0]} 전역 float은 탭 값이 byte 그대로 판만 ${layout[1]}·${globalFloats[1]}로 오르고, 판이 다르거나 손상된 파일은 바뀌지 않으며 다시 돌아도 같다`, async () => {
    const root = await mkdtemp(join(tmpdir(), "lophn-shell-layout-bump-"));
    try {
      const folder = join(root, "shell", "workspaces");
      await mkdir(folder, { recursive: true });
      const desk = {
        label: "Main",
        tabs: [
          doc("d1"),
          {
            ...doc("d2"),
            machine: "mch_00000000000000000000000000",
            owner: "ses_00000000000000000000000000",
            handed_tab: "tab_00000000000000000000000000",
          },
        ],
        selected_tab: "d2",
        groups: [
          {
            layout: {
              dir: "row",
              ratio: 0.4,
              a: { tab: "d1" },
              b: { tab: "d2" },
            },
            focus: "d2",
          },
        ],
        floats: [{ tab: doc("d3"), rect: RECT, minimized: true }],
        detached: [],
      };
      const old = (version: number) =>
        JSON.stringify({
          schema_version: version,
          active_desk: "_default",
          desks: { _default: desk },
        });
      const floats = (version: number) =>
        JSON.stringify({
          schema_version: version,
          floats: [
            {
              workspace: { kind: "home" },
              tab: doc("d9"),
              rect: RECT,
              minimized: false,
              pinned: true,
            },
          ],
        });
      const [from, to] = layout;
      await writeFile(join(folder, "home.json"), old(from));
      await writeFile(join(folder, "other.json"), old(from - 1));
      const broken = `{"schema_version": ${from}, `;
      await writeFile(join(folder, "broken.json"), broken);
      const floatsFile = join(root, "shell", "global-floats.json");
      await writeFile(floatsFile, floats(globalFloats[0]));

      for (let run = 0; run < 2; run += 1) {
        assert.deepEqual(await step.run(root, stepDeps), {
          ok: true,
          value: undefined,
        });
        // 판만 바뀐다: 탭 값과 group, 고른 탭이 그대로다.
        assert.equal(
          await readFile(join(folder, "home.json"), "utf8"),
          old(to),
        );
        assert.equal(
          await readFile(floatsFile, "utf8"),
          floats(globalFloats[1]),
        );
        assert.equal(
          await readFile(join(folder, "other.json"), "utf8"),
          old(from - 1),
        );
        assert.equal(
          await readFile(join(folder, "broken.json"), "utf8"),
          broken,
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("shell.layout-groups: 판 12 layout은 split group·칸 stack을 byte 그대로 두고 판만 13으로 오르며 전역 float은 그대로고 다시 돌아도 같다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-shell-layout-groups-"));
  try {
    const folder = join(root, "shell", "workspaces");
    await mkdir(folder, { recursive: true });
    const desk = {
      label: "Main",
      tabs: [doc("d1"), doc("d2"), doc("d3"), doc("d4")],
      selected_tab: "d1",
      groups: [
        {
          layout: {
            dir: "row",
            ratio: 0.4,
            a: { tab: "d1" },
            b: { tab: "d2", stack: ["d2", "d3", "d4"] },
          },
          focus: "d1",
        },
      ],
      floats: [],
      detached: [],
    };
    const file = (version: number) =>
      JSON.stringify({
        schema_version: version,
        active_desk: "_default",
        desks: { _default: desk },
      });
    const floatsFile = join(root, "shell", "global-floats.json");
    const floats = JSON.stringify({ schema_version: 4, floats: [] });
    await writeFile(join(folder, "home.json"), file(12));
    await writeFile(join(folder, "other.json"), file(11));
    await writeFile(floatsFile, floats);
    for (let run = 0; run < 2; run += 1) {
      assert.deepEqual(await shellLayoutGroupsStep.run(root, stepDeps), {
        ok: true,
        value: undefined,
      });
      assert.equal(await readFile(join(folder, "home.json"), "utf8"), file(13));
      assert.equal(
        await readFile(join(folder, "other.json"), "utf8"),
        file(11),
      );
      assert.equal(await readFile(floatsFile, "utf8"), floats);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
