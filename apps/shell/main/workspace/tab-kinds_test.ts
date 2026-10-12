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
const WIRE_KINDS = [
  "document_editor",
  "terminal",
  "app_panel",
  "contexts",
  "context",
  "search",
  "agents",
];

const PRJ = "prj_01h455vb4pex5v6nkc6gd5fdw1";
const AT = "2026-10-12T00:00:00.000Z";

const targets: RestoreTargets = {
  documentExists: () => Promise.resolve(true),
  app: () => Promise.resolve(true),
  canRead: () => Promise.resolve(true),
  context: () => Promise.resolve(true),
  declaredSearch: () => Promise.resolve(true),
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

// ---- Contexts·Context·Search 탭 kind (ctx-I53) ----

const CTX = "ctx_01h455vb4pex5v6nkc6gd5fdw1";
const VIW = "viw_01h455vb4pex5v6nkc6gd5fdw1";

function layoutWith(...tabs: Record<string, unknown>[]) {
  return {
    schema_version: 1,
    layout: {
      schema_version: 1,
      project: PRJ,
      window_bounds: { x: 0, y: 0, width: 1280, height: 800 },
      last_space: "project",
      panes: [{ tabs, selected_tab: tabs[0]!.key }],
      split_ratio: 0.5,
      focused_pane: 0,
      information_panel: { open: false, tab: "info" },
    },
  };
}

test("shell/workspace#R14 [ctx-I53]: Contexts·Context·Search 탭은 layout 파일에서 읽히고 대상 필드만 가진다", () => {
  const parsed = parseLayoutFile(layoutWith(
    { kind: "contexts", key: "contexts" },
    { kind: "context", key: `context:${CTX}`, context: CTX },
    {
      kind: "search",
      key: "search-1",
      context: CTX,
      declared_search: "findings_about_change",
      inputs: { kind: ["improvement"], range: { from: "1", to: "9" } },
      page: 2,
      saved_view: VIW,
    },
  ));
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const tabs = parsed.layout.panes[0]!.tabs as unknown as Record<
    string,
    unknown
  >[];
  assert.equal(tabs.length, 3);
  // 하위 탭은 기본 overview다.
  assert.equal(tabs[1]!.sub_tab, "overview");
  assert.equal(tabs[2]!.page, 2);
  assert.equal(tabs[2]!.saved_view, VIW);
});

test("shell/workspace#R14 [agent-I34]: Agents 탭은 layout 파일에서 열어 둔 agent와 함께 읽히고 맞지 않는 agent나 다른 필드는 거절된다", () => {
  const ASG = "asg_01h455vb4pex5v6nkc6gd5fdw1";
  const parsed = parseLayoutFile(layoutWith(
    { kind: "agents", key: "agents" },
    { kind: "agents", key: "agents-2", agent: ASG },
  ));
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const tabs = parsed.layout.panes[0]!.tabs as unknown as Record<
    string,
    unknown
  >[];
  assert.equal(tabs[0]!.agent, undefined);
  assert.equal(tabs[1]!.agent, ASG);
  const rejected = (tab: Record<string, unknown>) =>
    assert.equal(parseLayoutFile(layoutWith(tab)).ok, false);
  rejected({ kind: "agents", key: "agents", agent: "asg_1" });
  rejected({ kind: "agents", key: "agents", context: CTX });
});

test("shell/workspace#R14 [ctx-I53]: 다른 kind의 필드나 맞지 않는 값이 든 탭은 layout 검증이 거절한다", () => {
  const rejected = (tab: Record<string, unknown>) =>
    assert.equal(parseLayoutFile(layoutWith(tab)).ok, false);
  rejected({ kind: "contexts", key: "c", context: CTX });
  rejected({ kind: "context", key: "c", context: "ctx_1" });
  rejected({ kind: "context", key: "c", context: CTX, sub_tab: "nope" });
  rejected({ kind: "context", key: "c", context: CTX, document: "doc_x" });
  rejected({ kind: "search", key: "s", context: CTX, saved_view: "viw_1" });
  rejected({ kind: "search", key: "s", context: CTX, page: -1 });
  rejected({
    kind: "search",
    key: "s",
    context: CTX,
    inputs: Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`input${index}`, "x"]),
    ),
  });
  rejected({
    kind: "search",
    key: "s",
    context: CTX,
    inputs: { text: "x".repeat(5000) },
  });
});

test("shell/workspace#R6 [ctx-I53]: 없어졌거나 보관된 context의 탭은 이유를 가진 자리표시이고 살아 있으면 그대로다", async () => {
  const tab = {
    kind: "context" as const,
    key: "c",
    context: CTX,
    sub_tab: "glossary" as const,
  };
  assert.deepEqual(await restoreTab(tab, targets), { kind: "tab", tab });
  const gone: RestoreTargets = {
    ...targets,
    context: () => Promise.resolve(false),
  };
  assert.deepEqual(await restoreTab(tab, gone), {
    kind: "placeholder",
    key: "c",
    origin: "context",
    title: CTX,
    reason: "context_missing",
  });
  const search = {
    kind: "search" as const,
    key: "s",
    context: CTX,
    declared_search: null,
    inputs: {},
    page: 0,
    saved_view: null,
  };
  const restoredSearch = await restoreTab(search, gone);
  assert.equal(restoredSearch?.kind, "placeholder");
  if (restoredSearch?.kind === "placeholder") {
    assert.equal(restoredSearch.reason, "context_missing");
  }
  // contexts 탭은 대상이 없다.
  assert.deepEqual(
    await restoreTab({ kind: "contexts", key: "k" }, gone),
    { kind: "tab", tab: { kind: "contexts", key: "k" } },
  );
});

test("shell/workspace#R6 [ctx-I53]: 계약에서 사라진 선언된 검색의 탭은 자리표시이고 검색을 아직 고르지 않은 탭은 그대로다", async () => {
  const search = {
    kind: "search" as const,
    key: "s",
    context: CTX,
    declared_search: "findings_about_change",
    inputs: { kind: ["improvement"] },
    page: 0,
    saved_view: null,
  };
  const asked: string[] = [];
  const removed: RestoreTargets = {
    ...targets,
    declaredSearch: (context, name) => {
      asked.push(`${context} ${name}`);
      return Promise.resolve(false);
    },
  };
  const restored = await restoreTab(search, removed);
  assert.deepEqual(restored, {
    kind: "placeholder",
    key: "s",
    origin: "search",
    title: "findings_about_change",
    reason: "search_missing",
  });
  assert.deepEqual(asked, [`${CTX} findings_about_change`]);
  const unpicked = { ...search, declared_search: null };
  assert.deepEqual(await restoreTab(unpicked, removed), {
    kind: "tab",
    tab: unpicked,
  });
});

test("shell/workspace#R10 [ctx-I53]: 현재 보기는 context·하위 탭·선언된 검색의 key만 담고 읽을 수 없는 context는 omission이다", () => {
  const hint = {
    window_ref: "win-1",
    project: PRJ,
    panes: [{
      tabs: [
        { kind: "contexts", key: "contexts" },
        { kind: "context", key: "c", context: CTX, sub_tab: "violations" },
        {
          kind: "search",
          key: "s",
          context: CTX,
          declared_search: "findings_about_change",
          // 채운 입력은 힌트에 와도 현재 보기에 넣지 않는다.
          inputs: { change: "C-049" },
        },
        {
          kind: "context",
          key: "other",
          context: "ctx_01h455vb4pex5v6nkc6gd5fdw2",
          sub_tab: "overview",
        },
      ],
      selected: "c",
    }],
    focused_pane: 0,
  } as unknown as LayoutHint;
  const out = assembleCurrentView({
    hint,
    registry: { isLive: () => true, appView: () => null },
    scope: {
      project: () => true,
      allows: (group, ref) => group === "context" && ref === CTX,
    },
    observed_at: AT,
  });
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.deepEqual(out.state.tabs, [
    { kind: "contexts", key: "contexts", selected: false },
    {
      kind: "context",
      key: "c",
      context: CTX,
      sub_tab: "violations",
      selected: true,
    },
    {
      kind: "search",
      key: "s",
      context: CTX,
      declared_search: "findings_about_change",
      selected: false,
    },
  ]);
  assert.equal(out.state.omissions[0]?.reason, "target_out_of_scope");
  const published = buildPublishInput(out.state).input;
  assert.equal(JSON.stringify(published).includes("C-049"), false);
  assert.ok(published.summary.includes(`context:${CTX} violations`));
});

test("shell/workspace#R10 [ctx-I53]: 힌트의 모르는 하위 탭은 overview로 읽고 모양이 틀린 context는 탭에서 빠진다", async () => {
  const published: { tab_pages: Record<string, unknown>[][] }[] = [];
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
      tabs: [
        { kind: "context", key: "a", context: CTX, sub_tab: "weird" },
        { kind: "context", key: "b", context: "not-a-context" },
      ],
      selected: "a",
    }],
    focused_pane: 0,
  });
  // scope를 읽는 core 통로가 가짜라 모든 대상이 허용된다.
  const tabs = published[0]?.tab_pages[0] ?? [];
  assert.deepEqual(tabs.map((tab) => [tab.key, tab.sub_tab]), [[
    "a",
    "overview",
  ]]);
});
