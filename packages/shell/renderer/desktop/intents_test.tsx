import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { manualTimer, render } from "../../../design/components/testing.ts";

import type {
  OverlayApi,
  OverlayEvent,
  OverlayModel,
  OverlayOpen,
  OverlayUpdate,
} from "../../ipc/overlay.ts";
import type {
  DesktopIntent,
  IntentApi,
  ShortcutApi,
  WindowShortcut,
} from "../../ipc/shortcuts.ts";
import type { CoreSource } from "./connection/connection.ts";
import { Desktop } from "./main.tsx";
import { openProject } from "./router.ts";
import { fakeSource } from "./lophn-space/testdata/fake-source.ts";
import { find, flush } from "./lophn-space/testdata/dom.ts";
import { documentSearch } from "./palette/search.ts";
import {
  RequestDrafts,
  RequestsProvider,
} from "./lophn-space/things-to-confirm/context.tsx";
import {
  approval,
  approvalId,
  fakeRequests,
  manualTicks,
  question,
} from "./lophn-space/things-to-confirm/testdata/fake-source.ts";

const calls: unknown[] = [];
const core: CoreSource = {
  subscribe(listener) {
    listener({ state: "ready", confirmedAt: 1 });
    return () => {};
  },
  call: (input) => {
    calls.push(input);
    return Promise.resolve({ ok: true, value: {} });
  },
};

// 창 overlay와 main 통로의 가짜. 연 표면과 닫기만 남기고 결과·키·시키는 것은 테스트가 보낸다.
function fakeWindow() {
  const opened: OverlayOpen[] = [];
  const updates: OverlayUpdate[] = [];
  const closed: string[] = [];
  const timer = manualTimer();
  const overlayListeners = new Set<(event: OverlayEvent) => void>();
  const shortcutListeners = new Set<(shortcut: WindowShortcut) => void>();
  const intentListeners = new Set<(intent: DesktopIntent) => void>();
  let serial = 0;
  const overlay: OverlayApi = {
    open: (input) => {
      opened.push(input);
      return Promise.resolve({
        ok: true,
        value: { surfaceId: `surface_${++serial}`, generation: 1 },
      });
    },
    close: (input) => {
      closed.push(input.surfaceId);
      return Promise.resolve({ ok: true, value: null });
    },
    update: (input) => {
      updates.push(input);
      return Promise.resolve({ ok: true, value: null });
    },
    result: () => Promise.resolve({ ok: true, value: null }),
    subscribe: (listener) => {
      overlayListeners.add(listener);
      return () => overlayListeners.delete(listener);
    },
  };
  const shortcuts: ShortcutApi = {
    subscribe: (listener) => {
      shortcutListeners.add(listener);
      return () => shortcutListeners.delete(listener);
    },
  };
  const intents: IntentApi = {
    subscribe: (listener) => {
      intentListeners.add(listener);
      return () => intentListeners.delete(listener);
    },
  };
  async function press(shortcut: WindowShortcut) {
    act(() => {
      for (const listener of shortcutListeners) listener(shortcut);
    });
    await flush();
  }
  async function send(intent: DesktopIntent) {
    act(() => {
      for (const listener of intentListeners) listener(intent);
    });
    await flush();
  }
  function current() {
    return {
      requestId: opened.at(-1)!.requestId,
      surfaceId: `surface_${serial}`,
      generation: 1,
    };
  }
  async function emit(event: OverlayEvent) {
    act(() => {
      for (const listener of overlayListeners) listener(event);
    });
    await flush();
  }
  /** 지금 행 모양. 마지막으로 바꾼 행이 있으면 그것이다. */
  function model(): OverlayModel {
    const surfaceId = `surface_${serial}`;
    const updated = updates.filter((update) => update.surfaceId === surfaceId);
    return updated.at(-1)?.model ?? opened.at(-1)!.model;
  }
  async function type(text: string) {
    await emit({ ...current(), type: "query", text });
    timer.advance(150);
    await flush();
  }
  async function choose(label: string) {
    const choice = model().choices.find((item) => item.label === label);
    assert(choice, `no palette row ${label}`);
    await emit({ ...current(), type: "selected", choiceId: choice.id });
  }
  return {
    deps: { overlay, shortcuts, timer, platform: "linux" as const },
    intents,
    opened,
    closed,
    press,
    send,
    type,
    choose,
  };
}

function screen(container: HTMLElement): string | null {
  const space = container.querySelector("[data-space='lophn']");
  return space?.getAttribute("data-current-screen") ?? null;
}

Deno.test("shell/desktop#R18: 전역 팔레트는 런처에서도 lophn 전체 팔레트를 열고 창 팔레트와 달리 다시 받아도 닫지 않는다", async () => {
  const win = fakeWindow();
  const { source } = fakeSource();
  using view = render(
    <Desktop
      source={core}
      lophn={source}
      palette={win.deps}
      intents={win.intents}
    />,
  );
  await flush();
  // 런처에서 창 팔레트 키는 아무것도 열지 않는다.
  await win.press("palette");
  assertEquals(win.opened.length, 0);
  await win.send("global-palette");
  assertEquals(win.opened.length, 1);
  const model = win.opened[0]!.model;
  assertEquals(model.label, "Search lophn");
  assertEquals(
    [...new Set(model.choices.map((choice) => choice.group))],
    ["Projects", "Apps", "Actions"],
  );
  // 이미 열려 있으면 그대로 둔다.
  await win.send("global-palette");
  assertEquals(win.opened.length, 1);
  assertEquals(win.closed, []);
  await win.choose("Go to Settings");
  assertEquals(screen(view.container), "settings");
});

Deno.test("shell/desktop#R18: 전역 팔레트의 결과는 프로젝트·형제 화면·문서 읽기로 간다", async () => {
  const win = fakeWindow();
  const { source } = fakeSource({
    search: () => ({
      ok: true,
      value: {
        hits: [{
          document: "doc_9",
          version: "ver_3",
          latestVersion: "ver_3",
          section: "goals",
          title: "Release notes",
          snippet: "ship the release",
          format: "document",
          fromSummary: false,
        }],
        coverage: { lagging: false, rebuilding: false, omissions: 0 },
        nextCursor: null,
      },
    }),
  });
  using view = render(
    <Desktop
      source={core}
      initial={openProject("prj_1")}
      lophn={source}
      palette={{ ...win.deps, search: documentSearch(source) }}
      intents={win.intents}
    />,
  );
  await flush();
  await win.send("global-palette");
  await win.choose("Groceries");
  assertEquals(screen(view.container), "apps");
  await win.send("global-palette");
  await win.choose("Back to launcher");
  assertEquals(screen(view.container), null);
  // 문서는 검색어로 찾고 고르면 documents 화면에서 그 문서를 읽는다.
  await win.send("global-palette");
  await win.type("rel");
  await win.choose("Release notes");
  assertEquals(screen(view.container), "documents");
  assert(view.container.querySelector("[data-reader='doc_9']"));
  // 프로젝트 행은 그 프로젝트 작업대로 간다(작업대 통로가 없는 테스트라 lophn 공간을 떠난다).
  await win.send("global-palette");
  await win.choose("lophn");
  assertEquals(screen(view.container), null);
});

Deno.test("shell/desktop#R10: OS notification 클릭은 things-to-confirm을 열 뿐 읽음·결정 command를 보내지 않는다", async () => {
  const win = fakeWindow();
  const { source } = fakeSource();
  calls.length = 0;
  using view = render(
    <Desktop
      source={core}
      lophn={source}
      palette={win.deps}
      intents={win.intents}
    />,
  );
  await flush();
  assertEquals(screen(view.container), null);
  await win.send("things-to-confirm");
  assertEquals(screen(view.container), "things-to-confirm");
  assert(find(view.container, "[data-space='lophn']"));
  // 이 창은 core에 command를 보내지 않는다(읽음·답·승인이 아니다).
  assert(
    calls.every((call) => (call as { kind?: string }).kind !== "command"),
  );
  // 다른 형제를 보고 있어도 다시 things-to-confirm으로 간다.
  await win.send("global-palette");
  await win.choose("Go to Settings");
  assertEquals(screen(view.container), "settings");
  await win.send("things-to-confirm");
  assertEquals(screen(view.container), "things-to-confirm");
});

Deno.test("shell/desktop#R14: lophn://things-to-confirm/<id> 링크는 그 요청을 고른 things-to-confirm을 열고 결정 창은 열지 않는다", async () => {
  const win = fakeWindow();
  const { source } = fakeSource();
  const requests = fakeRequests({ requests: [question(1), approval(2)] });
  calls.length = 0;
  using view = render(
    <RequestsProvider
      deps={{
        source: requests.source,
        drafts: new RequestDrafts(),
        ticks: manualTicks().ticks,
      }}
    >
      <Desktop
        source={core}
        lophn={source}
        palette={win.deps}
        intents={win.intents}
      />
    </RequestsProvider>,
  );
  await flush();
  await win.send({ kind: "things-to-confirm", request: approvalId(2) });
  await flush();
  assertEquals(screen(view.container), "things-to-confirm");
  assertEquals(
    find(view.container, "[data-detail-column] [data-request-id]")
      .getAttribute("data-request-id"),
    approvalId(2),
  );
  // 고르기만 했다. 결정 창·답·읽음은 사람이 그 화면에서 누를 때만이다.
  assertEquals(requests.state.reviewed, []);
  assertEquals(requests.state.answered, []);
  assertEquals(requests.state.marked, []);
  assert(
    calls.every((call) => (call as { kind?: string }).kind !== "command"),
  );
});
