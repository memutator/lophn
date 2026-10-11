// 탭 kind registry 테스트. shell/workspace#R14: kind마다 선언이 하나이고, 공통 코드는 registry를 돌 뿐
// kind 이름으로 가르지 않는다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";

import {
  assembleCurrentView,
  buildPublishInput,
  type LayoutHint,
} from "./current-view.ts";
import { createLiveView } from "./live-view.ts";
import { parseLayoutFile, readPositionOf } from "./layout.ts";
import { restoreTab, type RestoreTargets } from "./restore.ts";
import type { LayoutTab } from "./schema.ts";
import { defineTabKind } from "./kinds/kind.ts";
import {
  BUILT_IN_TAB_KINDS,
  registerTabKind,
  tabKinds,
} from "./kinds/registry.ts";

// contracts/shell/workspace.ts의 TAB_KINDS와 같아야 한다. shell main의 tsc는 packages를 보지 않아
// 두 목록의 일치는 renderer 쪽 registry 테스트(deno)가 contracts를 읽어 검사한다.
const WIRE_KINDS = ["document_editor", "terminal", "app_panel"];

const PRJ = "prj_01h455vb4pex5v6nkc6gd5fdw1";
const AT = "2026-10-12T00:00:00.000Z";

const targets: RestoreTargets = {
  documentExists: () => Promise.resolve(true),
  app: () => Promise.resolve(true),
  canRead: () => Promise.resolve(true),
};

function fakeKind() {
  return defineTabKind({
    kind: "fake_board",
    layout: z.strictObject({
      kind: z.literal("fake_board"),
      key: z.string().min(1),
      board: z.string().min(1),
    }),
    readPosition: () => ({ section: "s", scroll_offset: 1 }),
    restore: (tab) =>
      Promise.resolve({
        kind: "placeholder" as const,
        key: tab.key,
        origin: tab.kind,
        title: tab.board,
        reason: "app_unavailable" as const,
      }),
    hint: (raw, key) =>
      typeof raw.board === "string"
        ? { kind: "fake_board" as const, key, board: raw.board }
        : null,
    scope: (hint, reads) =>
      reads.allow("board", hint.board, "boards", { board: hint.board }),
    view: (hint, selected, ctx) =>
      ctx.scope.allows("board", hint.board)
        ? {
          kind: "fake_board" as const,
          key: hint.key,
          board: hint.board,
          selected,
        }
        : null,
    describe: (view) => `board:${view.board}`,
  });
}

test("shell/workspace#R14 [ctx-I37]: TAB_KINDS의 모든 kind는 main registry에 하나씩 있고 registry에 더 있는 kind도 없다", () => {
  const names = tabKinds().map((kind) => kind.kind);
  assert.deepEqual([...names].sort(), [...WIRE_KINDS].sort());
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(
    BUILT_IN_TAB_KINDS.map((kind) => kind.kind).sort(),
    [...WIRE_KINDS].sort(),
  );
  assert.throws(() => registerTabKind(BUILT_IN_TAB_KINDS[0]));
});

test("shell/workspace#R14 [ctx-I37]: 등록한 가짜 kind는 공통 코드를 건드리지 않고 layout 읽기·복원·힌트·현재 보기에 쓰인다", async () => {
  const unregister = registerTabKind(fakeKind());
  try {
    const parsed = parseLayoutFile({
      schema_version: 1,
      layout: {
        schema_version: 1,
        project: PRJ,
        window_bounds: { x: 0, y: 0, width: 1280, height: 800 },
        last_space: "project",
        panes: [{
          tabs: [{ kind: "fake_board", key: "f1", board: "main" }],
          selected_tab: "f1",
        }],
        split_ratio: 0.5,
        focused_pane: 0,
        information_panel: { open: false, tab: "info" },
      },
    });
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    const tab = parsed.layout.panes[0]!.tabs[0] as unknown as LayoutTab;
    assert.deepEqual(readPositionOf(tab), { section: "s", scroll_offset: 1 });
    const restored = await restoreTab(tab, targets);
    assert.deepEqual(restored, {
      kind: "placeholder",
      key: "f1",
      origin: "fake_board",
      title: "main",
      reason: "app_unavailable",
    });

    // 현재 보기: 힌트 읽기 -> scope -> view -> 요약 줄.
    const published: { summary: string; tab_pages: unknown[][] }[] = [];
    const live = createLiveView({
      session: () => ({
        call(_kind, resource, method, body) {
          if (resource === "workspace" && method === "publish") {
            published.push(body as (typeof published)[number]);
          }
          return Promise.resolve({ ok: true, value: {} });
        },
      }),
      isLive: () => true,
      views: () => [],
      now: () => AT,
    });
    await live.hint("win-1", {
      project: PRJ,
      panes: [{
        tabs: [{ kind: "fake_board", key: "f1", board: "main" }],
        selected: "f1",
      }],
      focused_pane: 0,
    });
    assert.equal(published.length, 1);
    assert.deepEqual(published[0]!.tab_pages[0], [{
      kind: "fake_board",
      key: "f1",
      board: "main",
      selected: true,
    }]);
    assert.ok(published[0]!.summary.includes("fake_board:board:main"));

    const hint = {
      window_ref: "win-1",
      project: PRJ,
      panes: [{
        tabs: [{ kind: "fake_board", key: "f1", board: "other" }],
        selected: "f1",
      }],
      focused_pane: 0,
    } as unknown as LayoutHint;
    const out = assembleCurrentView({
      hint,
      registry: { isLive: () => true, appView: () => null },
      scope: { project: () => true, allows: () => false },
      observed_at: AT,
    });
    assert.ok(out.ok);
    if (!out.ok) return;
    // 범위 밖 대상은 kind의 view 판단으로 빠지고 omission이 남는다.
    assert.deepEqual(out.state.tabs, []);
    assert.equal(out.state.omissions[0]?.reason, "target_out_of_scope");
    assert.equal(buildPublishInput(out.state).input.tab_pages.length, 0);
  } finally {
    unregister();
  }
  // 내리면 모르는 kind다. 탭은 자리표시 없이 건너뛴다.
  assert.equal(
    tabKinds().some((kind) => kind.kind === "fake_board"),
    false,
  );
});
