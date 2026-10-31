import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createLayoutStore } from "./layout-store.ts";
import { DEFAULT_DESK } from "./schema.ts";
import {
  SCHEMA_VERSION,
  toLayoutFile,
  type WorkspaceDesk,
  type WorkspaceLayout,
} from "./layout.ts";

const PRJ_A = "prj_00000000000000000000000000";
const PRJ_B = "prj_00000000000000000000000001";

function desk(path: string): WorkspaceDesk {
  const tab = { kind: "document_editor" as const, key: path, path };
  return {
    panes: [{ tabs: [tab], selected_tab: tab.key }],
    layout: "leaf" as const,
    focused_pane: 0,
    floats: [],
    detached: [],
  };
}

function layout(
  project: string,
  desks: Record<string, WorkspaceDesk>,
): WorkspaceLayout {
  return {
    schema_version: SCHEMA_VERSION,
    project,
    active_desk: DEFAULT_DESK,
    desks,
    rail_apps: [],
  };
}

test("project B를 저장해도 project A의 자리들이 그대로 읽히고, 저장한 적 없는 project는 null이다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-layout-"));
  try {
    const store = createLayoutStore(root);
    const a = layout(PRJ_A, {
      [DEFAULT_DESK]: desk("/a/default.md"),
      alpha: desk("/a/alpha.md"),
    });
    const b = layout(PRJ_B, { [DEFAULT_DESK]: desk("/b/default.md") });
    assert.deepEqual(
      await store.write(PRJ_A, JSON.stringify(toLayoutFile(a))),
      { ok: true, value: null },
    );
    assert.deepEqual(
      await store.write(PRJ_B, JSON.stringify(toLayoutFile(b))),
      { ok: true, value: null },
    );
    assert.deepEqual(await store.read(PRJ_A), {
      ok: true,
      value: { ok: true, layout: a },
    });
    assert.deepEqual(await store.read(PRJ_B), {
      ok: true,
      value: { ok: true, layout: b },
    });
    assert.deepEqual(await store.read("prj_00000000000000000000000002"), {
      ok: true,
      value: null,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
