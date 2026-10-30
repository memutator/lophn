import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLayoutFile } from "./layout.ts";

const PROJECT = "prj_00000000000000000000000000";

function tab(path: string) {
  return { kind: "document_editor", key: path, path };
}

function v5(panes: string[][], splitRatio: number) {
  return {
    schema_version: 5,
    layout: {
      schema_version: 5,
      project: PROJECT,
      active_desk: "_default",
      desks: {
        _default: {
          panes: panes.map((paths) => ({
            tabs: paths.map(tab),
            selected_tab: paths[0] ?? null,
          })),
          split_ratio: splitRatio,
          focused_pane: 0,
          floats: [],
          detached: [],
        },
      },
    },
  };
}

test("판 5 파일(좌우 두 칸)을 읽어도 칸과 탭 순서와 비율이 그대로 이어진다", () => {
  const read = parseLayoutFile(v5([["/a.md", "/b.md"], ["/c.md"]], 0.3));
  assert.ok(read.ok);
  const desk = read.layout.desks._default!;
  assert.deepEqual(
    desk.panes.map((pane) => pane.tabs.map((item) => item.key)),
    [["/a.md", "/b.md"], ["/c.md"]],
  );
  assert.deepEqual(desk.layout, {
    dir: "row",
    ratio: 0.3,
    a: "leaf",
    b: "leaf",
  });

  const one = parseLayoutFile(v5([["/a.md"]], 0.5));
  assert.ok(one.ok);
  assert.equal(one.layout.desks._default!.layout, "leaf");
});

test("잎 수가 칸 수와 다른 판 6 파일은 손상으로 거절한다", () => {
  const file = v5([["/a.md"], ["/b.md"]], 0.5);
  const desk = file.layout.desks._default as Record<string, unknown>;
  delete desk.split_ratio;
  desk.layout = "leaf";
  file.schema_version = 6;
  file.layout.schema_version = 6;
  assert.deepEqual(parseLayoutFile(file), { ok: false, reason: "corrupt" });
});
