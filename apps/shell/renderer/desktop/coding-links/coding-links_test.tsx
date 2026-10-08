// 회수·취소·생성 링크(`lophn://things-to-confirm/<cac|tkt|app id>`)가 Desktop에서 그 대상의 화면으로 가고,
// settings의 coding agent 탭과 앱 공간 Tasks 탭이 통로가 있을 때만 있다는 것(shell#T50)을 본다.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { act } from "react";
import { render } from "../../../../../packages/design/components/testing.ts";

import type { DesktopIntent, IntentApi } from "../../../ipc/shortcuts.ts";
import { AppSpace } from "../../app-frame/app-space.tsx";
import { fakeDetail } from "../../app-frame/app-detail/testdata/fake-source.ts";
import {
  fakeTasks,
  TKT_READY,
} from "../../app-frame/app-detail/tasks/testdata/fake-source.ts";
import type { CoreSource } from "../connection/connection.ts";
import { Desktop } from "../main.tsx";
import { find, flush } from "../lophn-space/testdata/dom.ts";
import { fakeSource } from "../lophn-space/testdata/fake-source.ts";
import { fakeSettings } from "../lophn-space/settings/testdata/fake-settings.ts";
import { SettingsScreen } from "../lophn-space/settings/settings-screen.tsx";
import {
  CAC_APP,
  CAC_DESK,
  fakeConnections,
} from "../lophn-space/settings/connections/testdata/fake-source.ts";
import {
  appRow,
  BUDGET,
  BUDGET_RELEASE,
  fakeApps,
} from "../lophn-space/apps/testdata/fake-apps.ts";

const core: CoreSource = {
  subscribe(listener) {
    listener({ state: "ready", confirmedAt: 1 });
    return () => {};
  },
  call: () => Promise.resolve({ ok: true, value: {} }),
};

function fakeIntents() {
  const listeners = new Set<(intent: DesktopIntent) => void>();
  const intents: IntentApi = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  async function send(intent: DesktopIntent) {
    act(() => {
      for (const listener of listeners) listener(intent);
    });
    await flush();
  }
  return { intents, send };
}

const BAR = 48;
const HEIGHT = 552;

// happy-dom은 배치를 하지 않는다. 덮는 운영 패널은 오른쪽 720px라고 둔다(app-space_test와 같다).
function withLayout<T>(width: number, run: () => Promise<T>): Promise<T> {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    let rect = [0, 0, 0, 0];
    if (this.matches("[data-ops-panel='overlay']")) {
      rect = [width - 720, BAR, 720, HEIGHT];
    } else if (this.closest("[data-phase]")) {
      rect = [0, BAR, width, HEIGHT];
    }
    const [x, y, w, h] = rect as [number, number, number, number];
    return {
      x,
      y,
      left: x,
      top: y,
      width: w,
      height: h,
      right: x + w,
      bottom: y + h,
      toJSON() {},
    } as DOMRect;
  };
  return run().finally(() => {
    HTMLElement.prototype.getBoundingClientRect = original;
  });
}

Deno.test("flow manage-coding-access 1, coding-agent#T40: coding 통로가 있는 settings만 Coding agents 탭을 두고 회수 링크의 연결을 먼저 보인다", async () => {
  {
    const settings = fakeSettings();
    using view = render(<SettingsScreen source={settings.source} />);
    await flush();
    const tabs = [...view.container.querySelectorAll("[role='tab']")].map((
      tab,
    ) => tab.textContent);
    assert(!tabs.includes("Coding agents"));
  }
  {
    const settings = fakeSettings();
    const coding = fakeConnections();
    using view = render(
      <SettingsScreen source={settings.source} coding={coding.source} />,
    );
    await flush();
    const tabs = [...view.container.querySelectorAll("[role='tab']")].map((
      tab,
    ) => tab.textContent);
    assert(tabs.includes("Coding agents"));
    // 링크가 없으면 처음 탭은 그대로 모델 연결이다.
    assertEquals(
      find(view.container, "[role='tab'][data-state='active']").textContent,
      "Connections",
    );
    assertEquals(coding.calls.detect, 0);
  }
  {
    const settings = fakeSettings();
    const coding = fakeConnections();
    using view = render(
      <SettingsScreen
        source={settings.source}
        coding={coding.source}
        initialConnection={CAC_APP}
      />,
    );
    await flush();
    assertEquals(
      find(view.container, "[role='tab'][data-state='active']").textContent,
      "Coding agents",
    );
    const first = find(view.container, "[data-connection-list] > li");
    assertEquals(first.getAttribute("data-focused"), "");
    assertStringIncludes(first.textContent ?? "", "Budget only");
    // 링크는 화면만 연다. 회수 창은 사람이 누를 때 연다.
    assertEquals(coding.calls.revoke, []);
  }
});

Deno.test("shell/desktop#R14, coding-agent#T40: 회수 링크는 lophn 공간 settings의 Coding agents 탭을 그 연결과 함께 열고 아무것도 회수하지 않는다", async () => {
  const win = fakeIntents();
  const { source } = fakeSource();
  const settings = fakeSettings();
  const coding = fakeConnections();
  using view = render(
    <Desktop
      source={core}
      lophn={source}
      settings={settings.source}
      coding={coding.source}
      intents={win.intents}
    />,
  );
  await flush();
  await win.send({ kind: "coding", target: CAC_DESK });
  const space = find(view.container, "[data-space='lophn']");
  assertEquals(space.getAttribute("data-current-screen"), "settings");
  assertEquals(
    find(view.container, "[role='tab'][data-state='active']").textContent,
    "Coding agents",
  );
  assertEquals(
    find(view.container, "[data-connection-list] > li").getAttribute(
      "data-focused",
    ),
    "",
  );
  assertEquals(coding.calls.revoke, []);
  assertEquals(coding.calls.connect, []);
});

Deno.test("shell/desktop#R14, coding-agent#T25: 취소 링크는 그 Task가 속한 앱 공간으로, 생성 링크는 앱 공간으로 열고 Task 통로가 없으면 things-to-confirm으로 간다", async () => {
  await withLayout(1280, async () => {
    const win = fakeIntents();
    const { source } = fakeSource();
    const apps = fakeApps({
      rows: [appRow(BUDGET, "Grocery budget", { release: BUDGET_RELEASE })],
      screen: "home",
    });
    const tasks = fakeTasks();
    const detail = fakeDetail();
    using view = render(
      <Desktop
        source={core}
        lophn={source}
        apps={apps.source}
        appDetail={detail.source}
        tasks={tasks.source}
        intents={win.intents}
      />,
    );
    await flush();
    // Task 링크: 그 Task의 앱을 읽어 앱 공간의 Tasks 탭에서 그 Task를 연다. 취소는 사람이 거기서 누른다.
    await win.send({ kind: "coding", target: TKT_READY });
    assertEquals(tasks.calls.get[0], TKT_READY);
    assert(view.container.querySelector("[data-space='app']") !== null);
    await flush();
    assert(
      view.container.querySelector("[data-tab-body='tasks']") !== null,
      "Tasks 탭이 열린다",
    );
    assert(view.container.querySelector("[data-task-detail]") !== null);
    assertEquals(tasks.calls.cancel, []);
  });
  await withLayout(1280, async () => {
    const win = fakeIntents();
    const { source } = fakeSource();
    const apps = fakeApps({
      rows: [appRow(BUDGET, "Grocery budget", { release: BUDGET_RELEASE })],
      screen: "home",
    });
    const tasks = fakeTasks();
    using view = render(
      <Desktop
        source={core}
        lophn={source}
        apps={apps.source}
        appDetail={fakeDetail().source}
        tasks={tasks.source}
        intents={win.intents}
      />,
    );
    await flush();
    // 생성 링크: 그 앱 공간에서 새 Task 입력이 펼쳐진 채 열린다. 아무것도 만들지 않는다.
    await win.send({ kind: "coding", target: BUDGET });
    await flush();
    assert(view.container.querySelector("[data-create-form]") !== null);
    assertEquals(tasks.calls.create, []);
  });
  {
    // 읽지 못한 Task 링크와 Task 통로가 없는 창은 things-to-confirm으로 간다.
    const win = fakeIntents();
    const { source } = fakeSource();
    using view = render(
      <Desktop source={core} lophn={source} intents={win.intents} />,
    );
    await flush();
    await win.send({ kind: "coding", target: TKT_READY });
    assertEquals(
      find(view.container, "[data-space='lophn']").getAttribute(
        "data-current-screen",
      ),
      "things-to-confirm",
    );
  }
});

Deno.test("flow manage-tickets 5: Tasks 통로가 없는 앱 공간의 Tasks 탭은 아직 없다고 말하고 있으면 Task 목록을 보인다", async () => {
  await withLayout(1280, async () => {
    const apps = fakeApps({
      rows: [appRow(BUDGET, "Grocery budget", { release: BUDGET_RELEASE })],
      screen: "home",
    });
    const props = {
      app: BUDGET,
      source: apps.source,
      detail: fakeDetail().source,
      windowWidth: 1280,
      onLauncher: () => {},
      onDocuments: () => {},
      onThingsToConfirm: () => {},
    };
    {
      using view = render(
        <AppSpace {...props} taskTarget={{ ticket: null, create: false }} />,
      );
      await flush();
      assertStringIncludes(
        find(view.container, "[data-slot-empty='tasks']").textContent ?? "",
        "Tasks aren't available here yet",
      );
    }
    {
      const tasks = fakeTasks();
      using view = render(
        <AppSpace
          {...props}
          tasks={tasks.source}
          taskTarget={{ ticket: null, create: false }}
        />,
      );
      await flush();
      assert(view.container.querySelector("[data-tasks-list]") !== null);
      assertEquals(tasks.calls.list, [BUDGET]);
    }
  });
});
