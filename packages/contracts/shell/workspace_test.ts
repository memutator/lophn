import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/route.ts";
import { ROUTES } from "./mod.ts";
import {
  appViewSchema,
  CONTEXT_SUB_TABS,
  currentViewStateSchema,
  selectionSchema,
  SUMMARY_MAX_BYTES,
  summarySchema,
  TAB_KINDS,
  TAB_PAGE_SIZE,
  VIEW_STRING_MAX_CHARS,
  viewTabSchema,
  WORKSPACE_ROUTES,
  workspaceBind,
  workspacePublish,
  workspaceRead,
  workspaceReadOutputSchema,
  workspaceUnpublish,
} from "./workspace.ts";

const ULID = "01arz3ndektsv4rrffq69g5fav";
const PRJ = `prj_${ULID}`;
const DOC = `doc_${ULID}`;
const VER = `ver_${ULID}`;
const APP = `app_${ULID}`;
const REL = `rel_${ULID}`;
const SES = `ses_${ULID}`;
const CTX = `ctx_${ULID}`;
const AT = "2026-10-04T06:48:00.000Z";

const editor = {
  key: "notes",
  kind: "document_editor" as const,
  document: DOC,
  selected: true,
};

const state = {
  window_ref: "win-1",
  generation: 3,
  observed_at: AT,
  project: PRJ,
  tabs: [editor],
  focused_pane: 0,
  selection: {
    document: DOC,
    version: VER,
    section: "intro",
    start_line: 2,
    end_line: 4,
  },
  app_view: {
    app: APP,
    release: REL,
    mode: "live" as const,
    surface: "board",
    view_generation: 1,
  },
  availability: "current" as const,
  omissions: [{ reason: "redaction", truncated: true, next_page: 1 }],
};

Deno.test(
  "shell/workspace#R1 shell/workspace#R9: 현재 보기는 세 탭 종류와 요청 창 참조만 받고 본문 field를 거절한다",
  () => {
    assert(currentViewStateSchema.safeParse(state).success);
    for (
      const tab of [
        editor,
        {
          key: "shell",
          kind: "terminal",
          project_folder: "src",
          selected: false,
        },
        {
          key: "panel",
          kind: "app_panel",
          app: APP,
          surface: "board",
          selected: false,
        },
      ]
    ) {
      assert(viewTabSchema.safeParse(tab).success);
    }
    // 옛 document_viewer는 지워졌다. 모르는 종류는 받지 않는다.
    assert(
      !viewTabSchema.safeParse({
        key: "fixed",
        kind: "document_viewer",
        document: DOC,
        version: VER,
        selected: false,
      }).success,
    );
    assert(
      !viewTabSchema.safeParse({
        ...editor,
        body: "secret note",
      }).success,
    );
    assert(
      !viewTabSchema.safeParse({
        key: "shell",
        kind: "terminal",
        project_folder: "src",
        selected: false,
        output: "token=abc",
      }).success,
    );
    assert(
      !viewTabSchema.safeParse({
        key: "panel",
        kind: "app_panel",
        app: APP,
        surface: "board",
        selected: false,
        dom: "<input>",
      }).success,
    );
    assert(
      !currentViewStateSchema.safeParse({
        ...state,
        screenshot: "png",
      }).success,
    );
  },
);

Deno.test(
  "shell/workspace#R3 shell/workspace#R9: focus 칸과 선택 탭은 값으로만 남고 선택 본문은 거절한다",
  () => {
    assertEquals(selectionSchema.parse(state.selection).section, "intro");
    assert(
      !selectionSchema.safeParse({
        ...state.selection,
        text: "selected words",
      }).success,
    );
    assert(
      !selectionSchema.safeParse({
        ...state.selection,
        end_line: 1,
      }).success,
    );
    assert(
      !currentViewStateSchema.safeParse({
        ...state,
        focused_pane: -1,
      }).success,
    );
    assert(
      currentViewStateSchema.safeParse({
        ...state,
        project: null,
        focused_pane: null,
        selection: null,
        app_view: null,
      }).success,
    );
  },
);

Deno.test(
  "shell/workspace#R10 platform/redaction#R12: 요약은 2048 UTF-8 bytes, 탭 page는 20개, 화면 문자열은 80자다",
  () => {
    assertEquals(SUMMARY_MAX_BYTES, 2048);
    assertEquals(TAB_PAGE_SIZE, 20);
    assertEquals(VIEW_STRING_MAX_CHARS, 80);
    const hangul = "가".repeat(682);
    assertEquals(new TextEncoder().encode(hangul).length, 2046);
    assert(summarySchema.safeParse(hangul).success);
    assert(!summarySchema.safeParse(`${hangul}가`).success);
    assert(summarySchema.safeParse("a".repeat(2048)).success);
    assert(!summarySchema.safeParse("a".repeat(2049)).success);
    const page = Array.from({ length: 20 }, (_, index) => ({
      ...editor,
      key: `tab-${index}`,
    }));
    assert(
      workspacePublish.input.safeParse({
        window_ref: "win-1",
        generation: 3,
        observed_at: AT,
        summary: "open notes",
        tab_pages: [page],
      }).success,
    );
    assert(
      !workspacePublish.input.safeParse({
        window_ref: "win-1",
        generation: 3,
        observed_at: AT,
        summary: "open notes",
        tab_pages: [[...page, { ...editor, key: "tab-20" }]],
      }).success,
    );
    assert(
      !viewTabSchema.safeParse({
        ...editor,
        key: "k".repeat(81),
      }).success,
    );
    assert(
      !selectionSchema.safeParse({
        ...state.selection,
        section: "s".repeat(81),
      }).success,
    );
  },
);

Deno.test(
  "shell/workspace#R11: 앱 보기는 app·release·mode·surface·view generation만 받고 상세 값을 거절한다",
  () => {
    assertEquals(appViewSchema.parse(state.app_view).mode, "live");
    assert(
      appViewSchema.safeParse({ ...state.app_view, mode: "preview" })
        .success,
    );
    for (
      const extra of [
        { hint: "click save" },
        { annotation: "draft" },
        { dom: "<form>" },
        { screenshot: "png" },
      ]
    ) {
      assert(!appViewSchema.safeParse({ ...state.app_view, ...extra }).success);
    }
    assert(
      !appViewSchema.safeParse({ ...state.app_view, mode: "edit" })
        .success,
    );
  },
);

Deno.test(
  "shell/workspace#R9 shell/workspace#R10: relay route는 memory이고 user publish·bind·unpublish와 agent read만 받는다",
  () => {
    assertEquals(
      WORKSPACE_ROUTES.map((
        route,
      ) => [route.kind, routePath(route), route.actors, route.name]),
      [
        ["memory", "/v1/workspace/publish", ["user"], "workspace.publish"],
        ["memory", "/v1/workspace/bind", ["user"], "workspace.bind"],
        ["memory", "/v1/workspace/unpublish", ["user"], "workspace.unpublish"],
        ["memory", "/v1/workspace/read", ["agent"], "workspace.read"],
      ],
    );
    assertEquals(ROUTES, WORKSPACE_ROUTES);
    for (const route of WORKSPACE_ROUTES) {
      assertEquals([...route.errors], [...ERROR_CODES]);
      assertEquals(route.confirmation, undefined);
    }
    assert(
      workspacePublish.input.safeParse({
        window_ref: "win-1",
        generation: 3,
        observed_at: AT,
        summary: "open notes",
        tab_pages: [[editor]],
      }).success,
    );
    assert(
      !workspacePublish.input.safeParse({
        window_ref: "win-1",
        generation: 3,
        observed_at: AT,
        summary: "open notes",
        tab_pages: [[editor]],
        draft: "unsaved",
      }).success,
    );
    assert(workspaceRead.input.safeParse({ session: SES }).success);
    assert(workspaceRead.input.safeParse({ session: SES, page: 1 }).success);
    assert(!workspaceRead.input.safeParse({ session: SES, page: -1 }).success);
    assert(
      workspaceReadOutputSchema.safeParse({
        availability: "current",
        observed_at: AT,
        generation: 3,
        summary: "open notes",
        next_page: 1,
      }).success,
    );
    assert(
      workspaceReadOutputSchema.safeParse({
        availability: "disconnected",
        reason: "main disconnected",
      }).success,
    );
    assert(
      workspaceReadOutputSchema.safeParse({
        availability: "unavailable",
        reason: "no bound window",
      }).success,
    );
    assert(
      workspaceReadOutputSchema.safeParse({
        availability: "current",
        observed_at: AT,
        generation: 3,
        summary: "open notes",
        trace: "safe",
      }).success,
    );
    assert(
      !workspaceReadOutputSchema.safeParse({
        availability: "unavailable",
      }).success,
    );
    assert(workspacePublish.output.safeParse({ accepted: true }).success);
    assert(workspaceBind.output.safeParse({ accepted: true }).success);
    assert(workspaceUnpublish.output.safeParse({ accepted: true }).success);
    const page = Array.from({ length: 20 }, (_, index) => ({
      ...editor,
      key: `page-${index}`,
      note: "kept",
    }));
    assert(
      workspaceReadOutputSchema.safeParse({
        availability: "current",
        observed_at: AT,
        generation: 3,
        summary: "open notes",
        next_page: 1,
        tab_page: page,
      }).success,
    );
    assert(
      !workspaceReadOutputSchema.safeParse({
        availability: "current",
        observed_at: AT,
        generation: 3,
        summary: "open notes",
        tab_page: [...page, { ...editor, key: "page-20" }],
      }).success,
    );
    // page는 요청 index다. next_page는 다음 index이고, 요약만 주는 첫 read는 tab_page를 생략한다.
    assert(workspaceRead.input.safeParse({ session: SES, page: 0 }).success);
  },
);

Deno.test("apps/agent-context#R2 shell/workspace#R11: 앱 패널 탭의 view_session은 additive optional이고 다른 탭 종류에는 둘 수 없다", () => {
  const base = {
    kind: "app_panel",
    key: "a",
    selected: true,
    app: APP,
    surface: "todos",
  };
  assert(viewTabSchema.safeParse(base).success);
  assert(viewTabSchema.safeParse({ ...base, view_session: "view-1" }).success);
  assert(!viewTabSchema.safeParse({ ...base, view_session: "" }).success);
  assert(
    !viewTabSchema.safeParse({
      kind: "terminal",
      key: "t",
      selected: false,
      project_folder: "p",
      view_session: "view-1",
    }).success,
  );
});

Deno.test(
  "shell/workspace#R14 [ctx-I37]: TAB_KINDS의 모든 종류는 현재 보기 탭 schema 가지 하나씩과 일치한다",
  () => {
    const branches = viewTabSchema.options.map((option) =>
      option.shape.kind.value
    );
    assertEquals([...branches].sort(), [...TAB_KINDS].sort());
    assertEquals(new Set(TAB_KINDS).size, TAB_KINDS.length);
  },
);

Deno.test(
  "shell/workspace#R14 [ctx-I53]: 현재 보기는 Contexts·Context·Search 탭을 context 참조·하위 탭·선언된 검색 key로만 받는다",
  () => {
    for (
      const tab of [
        { key: "contexts", kind: "contexts", selected: false },
        {
          key: "c",
          kind: "context",
          context: CTX,
          sub_tab: "violations",
          selected: true,
        },
        { key: "s", kind: "search", context: CTX, selected: false },
        {
          key: "s2",
          kind: "search",
          context: CTX,
          declared_search: "findings_about_change",
          selected: false,
        },
      ]
    ) {
      assert(viewTabSchema.safeParse(tab).success, JSON.stringify(tab));
      assert(
        workspaceReadOutputSchema.safeParse({
          availability: "current",
          observed_at: AT,
          generation: 1,
          summary: "s",
          tab_page: [tab],
        }).success,
      );
    }
    const context = {
      key: "c",
      kind: "context",
      context: CTX,
      sub_tab: "overview",
      selected: true,
    };
    // 모르는 하위 탭, 다른 id, 채운 입력·결과·본문은 받지 않는다.
    assert(!viewTabSchema.safeParse({ ...context, sub_tab: "nope" }).success);
    assert(!viewTabSchema.safeParse({ ...context, context: DOC }).success);
    assert(
      !viewTabSchema.safeParse({
        key: "s",
        kind: "search",
        context: CTX,
        selected: false,
        inputs: { change: "C-049" },
      }).success,
    );
    assert(
      !viewTabSchema.safeParse({
        key: "contexts",
        kind: "contexts",
        selected: false,
        context: CTX,
      }).success,
    );
    // Agent 탭은 다른 일이 맡는다.
    assert(!(TAB_KINDS as readonly string[]).includes("agent"));
    assertEquals([...CONTEXT_SUB_TABS], [
      "overview",
      "search",
      "violations",
      "glossary",
      "contract",
    ]);
  },
);
