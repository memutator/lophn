// 현재 보기 상태 조립 테스트. shell/workspace#R9, R10과 shell/terminal#R8,
// lophn-agent/harness/prompt-assemble#R25–R28의 수집 절반(shell 쪽)이다.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type AppView,
  assembleCurrentView,
  buildPublishInput,
  type CurrentViewState,
  type LayoutHint,
  SUMMARY_MAX_BYTES,
  TAB_PAGE_SIZE,
  type ViewRegistry,
  type ViewScope,
  type ViewTab,
} from "./current-view.ts";

const PRJ = "prj_01h455vb4pex5v6nkc6gd5fdw1";
const DOC = "doc_01h455vb4pex5v6nkc6gd5fdw1";
const DOC2 = "doc_01h455vb4pex5v6nkc6gd5fdw2";
const VER = "ver_01h455vb4pex5v6nkc6gd5fdw1";
const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const AT = "2026-10-04T06:48:00.000Z";

function liveRegistry(): ViewRegistry {
  return {
    isLive: (ref) => ref === "win-1" || ref === "win-2",
    appView: (app, surface) =>
      app === APP && surface === "board"
        ? { release: REL, mode: "live", view_generation: 7 }
        : null,
  };
}

function fullScope(): ViewScope {
  return {
    project: () => true,
    document: () => true,
    app: () => true,
  };
}

function narrowScope(allowed: string): ViewScope {
  return {
    project: (id) => id === allowed,
    document: (doc) => doc === DOC,
    app: (app) => app === APP,
  };
}

function hint(partial: Partial<LayoutHint> = {}): LayoutHint {
  return {
    window_ref: "win-1",
    project: PRJ,
    panes: [
      {
        tabs: [
          { kind: "document_editor", key: "t1", document: DOC },
          { kind: "terminal", key: "t2", project_folder: "/repo/apps/api" },
        ],
        selected: "t1",
      },
    ],
    focused_pane: 0,
    ...partial,
  };
}

test("shell/workspace#R9: 등록된 창의 힌트만 CurrentViewState가 되고 모르는 창은 아무 상태도 만들지 않는다", () => {
  const ok = assembleCurrentView({
    hint: hint(),
    registry: liveRegistry(),
    scope: fullScope(),
    observed_at: AT,
  });
  assert.ok(ok.ok);
  assert.equal(ok.state.window_ref, "win-1");
  assert.equal(ok.state.availability, "current");
  assert.equal(ok.state.observed_at, AT);

  const unknown = assembleCurrentView({
    hint: hint({ window_ref: "win-9" }),
    registry: liveRegistry(),
    scope: fullScope(),
    observed_at: AT,
  });
  assert.deepEqual(unknown, { ok: false, reason: "unknown_window" });
});

test("shell/workspace#R9: 두 창은 각자의 탭과 선택만 묶는다", () => {
  const first = assembleCurrentView({
    hint: hint({
      selection: {
        document: DOC,
        version: VER,
        section: "intro",
        start_line: 2,
        end_line: 4,
      },
    }),
    registry: liveRegistry(),
    scope: fullScope(),
    observed_at: AT,
  });
  assert.ok(first.ok);
  assert.deepEqual(
    first.state.tabs.map((tab) => tab.key),
    ["t1", "t2"],
  );
  assert.deepEqual(first.state.selection, {
    document: DOC,
    version: VER,
    section: "intro",
    start_line: 2,
    end_line: 4,
  });

  const second = assembleCurrentView({
    hint: hint({
      window_ref: "win-2",
      panes: [
        {
          tabs: [
            {
              kind: "document_viewer",
              key: "t3",
              document: DOC2,
              version: VER,
            },
          ],
          selected: "t3",
        },
      ],
      selection: {
        document: DOC2,
        version: VER,
        section: "spec",
        start_line: 10,
        end_line: 12,
      },
    }),
    registry: liveRegistry(),
    scope: fullScope(),
    observed_at: AT,
  });
  assert.ok(second.ok);
  assert.equal(second.state.window_ref, "win-2");
  assert.deepEqual(
    second.state.tabs.map((tab) => tab.key),
    ["t3"],
  );
  assert.equal(second.state.selection?.document, DOC2);
  // 다른 창의 상태를 대신 쓰지 않는다.
  assert.notDeepEqual(second.state.tabs, first.state.tabs);
  assert.notDeepEqual(second.state.selection, first.state.selection);
});

test("shell/workspace#R9: 선택은 판·절·줄 범위만이고 본문·초안·출력·DOM은 field로도 없다", () => {
  const out = assembleCurrentView({
    hint: hint({
      selection: {
        document: DOC,
        version: VER,
        section: "intro",
        start_line: 2,
        end_line: 4,
      },
    }),
    registry: liveRegistry(),
    scope: fullScope(),
    observed_at: AT,
  });
  assert.ok(out.ok);
  assert.deepEqual(Object.keys(out.state.selection ?? {}), [
    "document",
    "version",
    "section",
    "start_line",
    "end_line",
  ]);
  assert.equal(JSON.stringify(out.state).includes("body_text"), false);
  assert.equal(JSON.stringify(out.state).includes("draft"), false);
  assert.equal(JSON.stringify(out.state).includes("output"), false);
  assert.equal(JSON.stringify(out.state).includes("dom"), false);
  assert.equal(JSON.stringify(out.state).includes("screenshot"), false);
});

test("shell/workspace#R10: 힌트의 scope 밖 대상은 빼고 omission으로 표시한다", () => {
  const out = assembleCurrentView({
    hint: hint({
      panes: [
        {
          tabs: [
            { kind: "document_editor", key: "t1", document: DOC },
            { kind: "document_editor", key: "t4", document: DOC2 },
          ],
          selected: "t1",
        },
      ],
    }),
    registry: liveRegistry(),
    scope: narrowScope(PRJ),
    observed_at: AT,
  });
  assert.ok(out.ok);
  assert.deepEqual(
    out.state.tabs.map((tab) => tab.key),
    ["t1"],
  );
  assert.equal(
    out.state.omissions.some((item) => item.reason === "target_out_of_scope"),
    true,
  );
});

test("shell/workspace#R10: 상세 탭은 한 page에 20개씩이다", () => {
  const tabs: ViewTab[] = [];
  for (let i = 0; i < 45; i++) {
    tabs.push({
      kind: "document_editor",
      key: `t${i}`,
      document: DOC,
      selected: i === 0,
    });
  }
  const published = buildPublishInput(
    view("win-1", tabs),
  );
  assert.equal(published.input.tab_pages.length, 3);
  assert.equal(published.input.tab_pages[0]?.length, TAB_PAGE_SIZE);
  assert.equal(published.input.tab_pages[2]?.length, 5);
});

test("shell/workspace#R10: 요약은 2048 bytes 이하로 줄고 잘림·생략 수·관측 시각을 남긴다", () => {
  const entries: ViewTab[] = [];
  for (let i = 0; i < 200; i++) {
    entries.push({
      kind: "document_editor",
      key: `tab-${i}`,
      document: DOC,
      selected: false,
    });
  }
  const published = buildPublishInput(
    view("win-1", entries, {
      document: DOC,
      version: VER,
      section: "intro",
      start_line: 1,
      end_line: 2,
    }),
  );
  const summary = published.input.summary;
  const bytes = new TextEncoder().encode(summary).length;
  assert.ok(bytes <= SUMMARY_MAX_BYTES, `summary is ${bytes} bytes`);
  assert.equal(summary.includes(`observed ${AT}`), true);
  assert.equal(/omitted \d+/.test(summary), true);
  const truncated = published.omissions.some(
    (item) => item.reason === "summary_truncated" && item.truncated,
  );
  assert.equal(truncated, true);
});

test("shell/workspace#R11: 앱 보기는 registry의 app·release·mode·surface·view generation 참조만이다", () => {
  const out = assembleCurrentView({
    hint: hint({
      panes: [
        {
          tabs: [
            { kind: "app_panel", key: "t5", app: APP, surface: "board" },
          ],
          selected: "t5",
        },
      ],
      app_tab: "t5",
    }),
    registry: liveRegistry(),
    scope: fullScope(),
    observed_at: AT,
  });
  assert.ok(out.ok);
  const appView: AppView | null = out.state.app_view;
  assert.deepEqual(appView, {
    app: APP,
    release: REL,
    mode: "live",
    surface: "board",
    view_generation: 7,
  });
  // 살아 있지 않은 view는 없다.
  const dead = assembleCurrentView({
    hint: hint({
      panes: [
        {
          tabs: [{ kind: "app_panel", key: "t5", app: APP, surface: "board" }],
          selected: "t5",
        },
      ],
      app_tab: "t5",
    }),
    registry: { isLive: () => true, appView: () => null },
    scope: fullScope(),
    observed_at: AT,
  });
  assert.ok(dead.ok);
  assert.equal(dead.state.app_view, null);
  assert.equal(
    dead.state.omissions.some((item) => item.reason === "app_not_live"),
    true,
  );
});

test("lophn-agent/harness/prompt-assemble#R28: 관측 시각은 수집 때 고정되고 이전 상태를 재사용하지 않는다", () => {
  const first = assembleCurrentView({
    hint: hint(),
    registry: liveRegistry(),
    scope: fullScope(),
    observed_at: AT,
  });
  const later = assembleCurrentView({
    hint: hint(),
    registry: liveRegistry(),
    scope: fullScope(),
    observed_at: "2026-10-04T07:00:00.000Z",
  });
  assert.ok(first.ok && later.ok);
  assert.notEqual(first.state.observed_at, later.state.observed_at);
  assert.notDeepEqual(first.state, later.state);
});

function view(
  windowRef: string,
  tabs: ViewTab[],
  selection: CurrentViewState["selection"] = null,
): CurrentViewState {
  return {
    window_ref: windowRef,
    generation: 3,
    observed_at: AT,
    project: PRJ,
    tabs,
    focused_pane: 0,
    selection,
    app_view: null,
    availability: "current",
    omissions: [{ reason: "one", truncated: false }],
  };
}
