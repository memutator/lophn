// agent-I39: 앱 공간의 agent. title bar의 select가 후보를 보이고(R37), 고르면 앱 화면 옆 칸에 Agent 화면이
// 그 앱 자리로 열리며 칸을 닫을 수 있고(R38), Manage는 같은 칸에 Agents 탭과 같은 관리 화면을 앱 자리로 연다(R39).
// select 안쪽은 agent-select_test, Agent 화면 안쪽은 conversation의 test, 관리 화면 안쪽은 workspace/agents의
// test가 본다. 여기서는 앱 공간이 그것들을 맞물리는지를 본다.
import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  focus,
  one,
  pressAsync,
  render,
  settle,
  unmountSettled,
} from "../../../../packages/design/components/testing.ts";

import type {
  AppFrameViewState,
  LophnShellViewsApi,
} from "../../ipc/app-frame.ts";
import type { AgentViewSourceFactory } from "../conversation/agent-source.ts";
import {
  type FakeAgent,
  fakeAgentSource,
  LOPHN as LOPHN_FACE,
} from "../conversation/testdata/fake-agent-source.ts";
import {
  appRow,
  BUDGET,
  BUDGET_RELEASE,
  fakeApps,
} from "../desktop/lophn-space/apps/testdata/fake-apps.ts";
import { find, flush } from "../desktop/lophn-space/testdata/dom.ts";
import {
  createFakeAgentsSource,
  ENGINEER_ID,
  LOPHN_ID,
  RELEASE_ID,
} from "../workspace/agents/fake-source.ts";
import type { AgentsSource } from "../workspace/agents/source.ts";
import { AppSpace } from "./app-space.tsx";
import { agentPanePlacement } from "./agent-pane.tsx";

const APP_ENGINEER_ID = "asg_01arz3ndektsv4rrffq69g5fa4";

const budget = appRow(BUDGET, "Grocery budget", { release: BUDGET_RELEASE });

function fakeViews() {
  const calls: unknown[][] = [];
  const api: LophnShellViewsApi = {
    openApp(input) {
      calls.push(["open", input.app]);
      return Promise.resolve({
        view_session: "view-1",
        app: input.app,
        release: input.release ?? null,
        mode: input.mode,
        screen: input.screen,
        size: input.size,
        connectionState: "running",
      });
    },
    setViewBounds(input) {
      calls.push(["bounds", input.bounds]);
      return Promise.resolve({ generation: 1 });
    },
    setViewsHidden(input) {
      calls.push(["hide", ...input.view_sessions]);
      return Promise.resolve({ generation: 2 });
    },
    closeView(input) {
      calls.push(["close", input.view_session]);
      return Promise.resolve();
    },
    reopenView: () => Promise.reject(new Error("conflict")),
    subscribeViewState(_listener: (state: AppFrameViewState) => void) {
      return () => {};
    },
  };
  return { api, calls };
}

/** 이 앱 자리의 목록: lophn · Context Engineer(거른다) · App Engineer · Operator "Release notes". */
function appAgents(): { source: AgentsSource; listed: string[] } {
  const base = createFakeAgentsSource();
  const listed: string[] = [];
  const source: AgentsSource = {
    ...base,
    async list(place) {
      listed.push(place);
      const result = await base.list(place);
      if (!result.ok) return result;
      const [lophn, ...rest] = result.value;
      return {
        ok: true,
        value: [lophn, {
          ...lophn,
          assignment: APP_ENGINEER_ID,
          role: "app_engineer",
          name: "App Engineer",
          profile: { kind: "icon", icon: "apps" },
        }, ...rest],
      };
    },
    async overview(place) {
      listed.push(`overview:${place}`);
      return await base.overview(place);
    },
  };
  return { source, listed };
}

interface Opened {
  readonly assignment: string;
  readonly place: { readonly kind: string; readonly id: string };
}

/** agent마다 자기 이름의 얼굴을 가진 fake source를 주는 factory. */
function viewFactory(): { factory: AgentViewSourceFactory; opened: Opened[] } {
  const opened: Opened[] = [];
  const fakes = new Map<string, FakeAgent>();
  const names: Record<string, string> = {
    [LOPHN_ID]: "lophn",
    [APP_ENGINEER_ID]: "App Engineer",
    [RELEASE_ID]: "Release notes",
  };
  const factory: AgentViewSourceFactory = (agent) => {
    opened.push(agent);
    let fake = fakes.get(agent.assignment);
    if (fake === undefined) {
      fake = fakeAgentSource({
        agent: {
          ...LOPHN_FACE,
          assignment: agent.assignment,
          name: names[agent.assignment] ?? "?",
          place: { kind: "app", name: "Grocery budget" },
        },
      });
      fakes.set(agent.assignment, fake);
    }
    return fake.source;
  };
  return { factory, opened };
}

interface SpaceOptions {
  agents?: AgentsSource;
  factory?: AgentViewSourceFactory;
  width?: number;
  onInstructions?: () => void;
  onSettings?: () => void;
}

function space(options: SpaceOptions) {
  const views = fakeViews();
  const apps = fakeApps({ rows: [budget], screen: "home" });
  const tree = (
    <AppSpace
      app={BUDGET}
      source={apps.source}
      views={views.api}
      windowWidth={options.width ?? 1280}
      onLauncher={() => {}}
      onDocuments={() => {}}
      onThingsToConfirm={() => {}}
      {...(options.agents === undefined ? {} : { agents: options.agents })}
      {...(options.factory === undefined
        ? {}
        : { agentViewSource: options.factory })}
      {...(options.onInstructions === undefined
        ? {}
        : { onInstructions: options.onInstructions })}
      {...(options.onSettings === undefined
        ? {}
        : { onSettings: options.onSettings })}
    />
  );
  return { tree, views };
}

async function pickFromSelect(
  container: HTMLElement,
  item: string,
): Promise<void> {
  const trigger = find(container, "header [data-agent-select]");
  focus(trigger);
  await pressAsync(trigger, "Enter");
  click(one(document, item));
  await settle();
  await flush();
}

function menuLabels(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].map(
    (item) =>
      item.hasAttribute("data-agent-manage")
        ? "Manage"
        : item.querySelector("[data-agent-name]")!.textContent ?? "",
  );
}

Deno.test("shell/app-frame#R37 [agent-I39]: 앱 공간 title bar의 window controls 바로 옆에 agent select 하나가 있고 후보는 lophn · App Engineer · 이 앱 자리의 Operator · Manage이며 Context Engineer가 없다", async () => {
  const { source, listed } = appAgents();
  const { tree } = space({ agents: source, factory: viewFactory().factory });
  using view = render(tree);
  await flush();
  const bar = find(view.container, "header");
  assertEquals(bar.querySelectorAll("[data-agent-select]").length, 1);
  // 후보는 project가 아니라 이 앱 자리로 읽는다.
  assertEquals(listed.filter((place) => !place.startsWith("overview:")), [
    BUDGET,
  ]);
  // 바 오른쪽 조작의 맨 끝, 곧 window controls 바로 앞이다.
  const buttons = [...bar.querySelectorAll("button")];
  const select = find(bar, "[data-agent-select]");
  assert(
    buttons.indexOf(select as HTMLButtonElement) >
      buttons.indexOf(
        find(bar, "[data-app-bar='app-details']") as HTMLButtonElement,
      ),
    "the select comes after the bar's own controls",
  );
  const trigger = find(bar, "[data-agent-select]");
  focus(trigger);
  await pressAsync(trigger, "Enter");
  assertEquals(menuLabels(), [
    "lophn",
    "App Engineer",
    "Release notes",
    "Manage",
  ]);
  assert(!(document.body.textContent ?? "").includes("Context Engineer"));
  await unmountSettled(view);
});

Deno.test("shell/app-frame#R37 [agent-I39]: agent 목록 통로가 없는 앱 공간에는 select를 두지 않는다", async () => {
  const { tree } = space({});
  using view = render(tree);
  await flush();
  assertEquals(view.container.querySelector("[data-agent-select]"), null);
  assertEquals(view.container.querySelector("[data-agent-pane]"), null);
  await unmountSettled(view);
});

Deno.test("shell/app-frame#R38 [agent-I39]: lophn을 고르면 앱 화면 옆 칸에 Agent 화면이 이 앱 자리의 그 agent로 열리고 앱 view는 닫히지 않는다", async () => {
  const { source } = appAgents();
  const { factory, opened } = viewFactory();
  const { tree, views } = space({ agents: source, factory });
  using view = render(tree);
  await flush();
  assertEquals(view.container.querySelector("[data-agent-pane]"), null);
  await pickFromSelect(view.container, `[data-agent="${LOPHN_ID}"]`);
  assertEquals(opened, [{
    assignment: LOPHN_ID,
    place: { kind: "app", id: BUDGET },
  }]);
  const pane = find(view.container, "[data-agent-pane]");
  assertEquals(pane.getAttribute("data-agent-pane"), "agent");
  assertEquals(
    find(pane, "[data-agent-header]").textContent?.includes("lophn"),
    true,
  );
  // 칸은 앱 화면과 나란히 있고 앱 view를 닫지 않는다.
  assert(
    find(view.container, "[data-space=app]").contains(pane),
    "the pane is inside the app space",
  );
  assertEquals(views.calls.filter((call) => call[0] === "close"), []);
  await unmountSettled(view);
});

Deno.test("shell/app-frame#R38 [agent-I39]: 다른 agent를 고르면 같은 칸이 그 agent로 바뀌고 Operator는 자기 assignment와 앱 자리로 열린다", async () => {
  const { source } = appAgents();
  const { factory, opened } = viewFactory();
  const { tree } = space({ agents: source, factory });
  using view = render(tree);
  await flush();
  await pickFromSelect(view.container, `[data-agent="${APP_ENGINEER_ID}"]`);
  assert(
    find(view.container, "[data-agent-header]").textContent?.includes(
      "App Engineer",
    ),
  );
  await pickFromSelect(view.container, `[data-agent="${RELEASE_ID}"]`);
  assertEquals(view.container.querySelectorAll("[data-agent-pane]").length, 1);
  assert(
    find(view.container, "[data-agent-header]").textContent?.includes(
      "Release notes",
    ),
  );
  assertEquals(opened.map((agent) => agent.assignment).slice(-1), [
    RELEASE_ID,
  ]);
  assertEquals(
    opened.every((agent) =>
      agent.place.kind === "app" && agent.place.id === BUDGET
    ),
    true,
  );
  await unmountSettled(view);
});

Deno.test("shell/app-frame#R38 [agent-I39]: Agent 화면의 Close tab으로 칸을 닫으면 칸만 사라지고 앱 view는 그대로다", async () => {
  const { source } = appAgents();
  const { tree, views } = space({
    agents: source,
    factory: viewFactory().factory,
  });
  using view = render(tree);
  await flush();
  await pickFromSelect(view.container, `[data-agent="${LOPHN_ID}"]`);
  const pane = find(view.container, "[data-agent-pane]");
  const more = one(pane, '[aria-label="More"]');
  focus(more);
  await pressAsync(more, "Enter");
  const close = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")]
    .find((item) => item.textContent?.trim() === "Close tab")!;
  click(close);
  await settle();
  await flush();
  assertEquals(view.container.querySelector("[data-agent-pane]"), null);
  assertEquals(views.calls.filter((call) => call[0] === "close"), []);
  await unmountSettled(view);
});

Deno.test("shell/app-frame#R38 [agent-I39]: Agent 화면을 열 core 통로가 없으면 칸이 아직 준비 안 됐다고 말하고 닫을 수 있다", async () => {
  const { source } = appAgents();
  const { tree } = space({ agents: source });
  using view = render(tree);
  await flush();
  await pickFromSelect(view.container, `[data-agent="${LOPHN_ID}"]`);
  const pane = find(view.container, "[data-agent-pane]");
  assert(find(pane, "[data-agent-not-ready]").textContent!.trim().length > 0);
  assertEquals(pane.querySelector("[data-agent-header]"), null);
  click(find(pane, "[data-agent-pane-close]"));
  await flush();
  assertEquals(view.container.querySelector("[data-agent-pane]"), null);
  await unmountSettled(view);
});

Deno.test("shell/app-frame#R36 [agent-I39]: 칸은 넓은 창에서 앱 화면 옆 열이고 좁은 창에서는 앱 화면을 덮는다", async () => {
  assertEquals(agentPanePlacement(false, 1280), "hidden");
  assertEquals(agentPanePlacement(true, 1280), "docked");
  assertEquals(agentPanePlacement(true, 960), "docked");
  assertEquals(agentPanePlacement(true, 959), "overlay");

  for (
    const [width, placement] of [[1280, "docked"], [800, "overlay"]] as const
  ) {
    const { source } = appAgents();
    const { tree } = space({
      agents: source,
      factory: viewFactory().factory,
      width,
    });
    using view = render(tree);
    await flush();
    await pickFromSelect(view.container, `[data-agent="${LOPHN_ID}"]`);
    assertEquals(
      find(view.container, "[data-agent-pane]").getAttribute(
        "data-agent-placement",
      ),
      placement,
    );
    await unmountSettled(view);
  }
});

Deno.test("shell/app-frame#R39 [agent-I39]: Manage는 같은 칸에 Agents 탭과 같은 관리 화면을 이 앱 자리로 열고 agent 칸을 바꿔 놓는다", async () => {
  const { source, listed } = appAgents();
  const { factory } = viewFactory();
  const { tree } = space({ agents: source, factory });
  using view = render(tree);
  await flush();
  await pickFromSelect(view.container, `[data-agent="${LOPHN_ID}"]`);
  await pickFromSelect(view.container, "[data-agent-manage]");
  assertEquals(view.container.querySelectorAll("[data-agent-pane]").length, 1);
  const pane = find(view.container, "[data-agent-pane]");
  assertEquals(pane.getAttribute("data-agent-pane"), "manage");
  assertEquals(pane.querySelector("[data-agent-header]"), null);
  // 같은 component: 카드와 New Operator, 구역이 있다.
  const cards = [...pane.querySelectorAll<HTMLElement>("[data-agent-card]")];
  assert(cards.some((card) => card.textContent!.includes("Release notes")));
  assert(pane.querySelector("[data-section=instructions]"));
  assert(
    [...pane.querySelectorAll("button")].some((button) =>
      button.textContent!.includes("New Operator")
    ),
  );
  // 읽기는 앱 자리로 갔다.
  assertEquals(listed.filter((place) => place.startsWith("overview:")), [
    `overview:${BUDGET}`,
  ]);
  await unmountSettled(view);
});

Deno.test("shell/app-frame#R39 [agent-I39]: 관리 칸에서 Operator를 열고 저장하면 앱 자리로 저장하고 목록(select)도 다시 읽는다", async () => {
  const fake = createFakeAgentsSource();
  const places: string[] = [];
  const lists: string[] = [];
  const source: AgentsSource = {
    ...fake,
    list(place) {
      lists.push(place);
      return fake.list(place);
    },
    saveAgent(place, input) {
      places.push(place);
      return fake.saveAgent(place, input);
    },
  };
  const { tree } = space({ agents: source, factory: viewFactory().factory });
  using view = render(tree);
  await flush();
  await pickFromSelect(view.container, "[data-agent-manage]");
  const pane = find(view.container, "[data-agent-pane]");
  const card = pane.querySelector<HTMLElement>(
    `[data-agent-card][data-assignment="${RELEASE_ID}"]`,
  )!;
  click(
    [...card.querySelectorAll("button")].find((button) =>
      button.textContent!.trim() === "Open"
    )!,
  );
  await flush();
  const save = [...pane.querySelectorAll("button")].find((button) =>
    button.textContent!.trim() === "Save"
  )!;
  click(save);
  await flush();
  assertEquals(places, [BUDGET]);
  // select가 저장 뒤에 같은 앱 자리의 목록을 다시 읽는다.
  assertEquals(lists, [BUDGET, BUDGET]);
  assertEquals(fake.calls.length, 1);
  await unmountSettled(view);
});

Deno.test("shell/app-frame#R39 [agent-I39]: 관리 칸의 Instructions [Edit]는 앱 지침을 열고 [Add server]는 settings로 간다", async () => {
  const { source } = appAgents();
  let instructions = 0;
  let settings = 0;
  const { tree } = space({
    agents: source,
    factory: viewFactory().factory,
    onInstructions: () => instructions++,
    onSettings: () => settings++,
  });
  using view = render(tree);
  await flush();
  await pickFromSelect(view.container, "[data-agent-manage]");
  const pane = find(view.container, "[data-agent-pane]");
  const edit = [
    ...find(pane, "[data-section=instructions]").querySelectorAll("button"),
  ].find((button) => button.textContent!.trim() === "Edit")!;
  click(edit);
  assertEquals(instructions, 1);
  const addServer = [
    ...find(pane, "[data-section=mcp]").querySelectorAll("button"),
  ].find((button) => button.textContent!.includes("Add"))!;
  click(addServer);
  assertEquals(settings, 1);
  await unmountSettled(view);
});

Deno.test("shell/app-frame#R39 [agent-I39]: 관리 칸은 닫을 수 있고 닫으면 칸만 사라진다", async () => {
  const { source } = appAgents();
  const { tree, views } = space({
    agents: source,
    factory: viewFactory().factory,
  });
  using view = render(tree);
  await flush();
  await pickFromSelect(view.container, "[data-agent-manage]");
  click(find(view.container, "[data-agent-pane-close]"));
  await flush();
  assertEquals(view.container.querySelector("[data-agent-pane]"), null);
  assertEquals(views.calls.filter((call) => call[0] === "close"), []);
  await unmountSettled(view);
});

Deno.test("shell/app-frame#R39 [agent-I39]: Agent 화면의 권한 요약 같은 Permissions 이동은 같은 칸의 관리 화면으로 간다", async () => {
  const { source } = appAgents();
  const { tree } = space({ agents: source, factory: viewFactory().factory });
  using view = render(tree);
  await flush();
  await pickFromSelect(view.container, `[data-agent="${LOPHN_ID}"]`);
  const permission = find(view.container, "[data-agent-pane]").querySelector<
    HTMLElement
  >("[data-composer-permissions]");
  assert(permission, "the header shows the permission summary");
  act(() => click(permission));
  await flush();
  assertEquals(
    find(view.container, "[data-agent-pane]").getAttribute("data-agent-pane"),
    "manage",
  );
  await unmountSettled(view);
});

// ENGINEER_ID는 Context Engineer다. 앱 공간에서는 어느 길로도 열리지 않는다.
Deno.test("shell/app-frame#R37 [agent-I39]: Context Engineer는 select에도 칸에도 나오지 않는다", async () => {
  const { source } = appAgents();
  const { factory, opened } = viewFactory();
  const { tree } = space({ agents: source, factory });
  using view = render(tree);
  await flush();
  const trigger = find(view.container, "header [data-agent-select]");
  focus(trigger);
  await pressAsync(trigger, "Enter");
  assertEquals(
    document.querySelector(`[data-agent="${ENGINEER_ID}"]`),
    null,
  );
  assertEquals(opened, []);
  await unmountSettled(view);
});
