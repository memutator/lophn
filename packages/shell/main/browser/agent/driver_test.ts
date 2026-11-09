import assert from "node:assert/strict";
import { test } from "node:test";

import { createTabControl } from "./control.ts";
import { type BrowserCallPayload, createBrowserDriver } from "./driver.ts";
import type { Page, PageEvents, PageLookup } from "./page.ts";
import type { AxNode } from "./snapshot.ts";

const TAB = "tab_01hzzzzzzzzzzzzzzzzzzzzzzz";

const tree = (...buttons: [number, string][]): AxNode[] => [
  {
    nodeId: "root",
    role: { value: "RootWebArea" },
    name: { value: "page" },
    backendDOMNodeId: 1,
    childIds: buttons.map(([id]) => `n${id}`),
  },
  ...buttons.map(
    ([id, name]): AxNode => ({
      nodeId: `n${id}`,
      role: { value: "button" },
      name: { value: name },
      backendDOMNodeId: id,
    }),
  ),
];

function fakePage() {
  const state = { nodes: tree(), attached: 0, clicked: [] as number[] };
  let events: PageEvents | undefined;
  const page: Page = {
    id: 7,
    isDestroyed: () => false,
    isDevToolsOpened: () => false,
    isLoading: () => false,
    url: () => "http://localhost/",
    title: () => "page",
    attach: () => void (state.attached += 1),
    detach: () => {},
    emulated: () => false,
    subscribe: (given) => void (events = given),
    send: ((method: string, params?: Record<string, unknown>) => {
      if (method === "Accessibility.getFullAXTree") {
        return Promise.resolve({ nodes: state.nodes });
      }
      if (method === "DOM.getBoxModel") {
        state.clicked.push(params?.backendNodeId as number);
        return Promise.resolve({
          model: { content: [0, 0, 10, 0, 10, 10, 0, 10] },
        });
      }
      if (method === "Runtime.evaluate") {
        return Promise.resolve({ result: { value: 1 } });
      }
      if (method === "Page.captureScreenshot") {
        return Promise.resolve({ data: "AA==" });
      }
      return Promise.resolve({});
    }) as Page["send"],
  };
  return {
    page,
    state,
    emit: (m: string, p: Record<string, unknown>) => events?.cdp(m, p),
  };
}

function setup(mode: "live" | "preview" = "preview") {
  const fake = fakePage();
  const control = createTabControl(() => {});
  const lookup: PageLookup = {
    guest: () => fake.page,
    app: () => ({ mode, page: fake.page }),
    artifact: () => fake.page,
  };
  const driver = createBrowserDriver({
    viewSession: () => "view-1",
    lookup,
    control,
    nowMs: () => Date.now(),
  });
  const run = (
    action: BrowserCallPayload["action"],
    view: "browser" | "preview" = "preview",
  ) => driver.run({ tab: TAB, view, action });
  return { fake, control, run };
}

const text = (output: Awaited<ReturnType<ReturnType<typeof setup>["run"]>>) =>
  "content" in output && output.content[0]?.type === "text"
    ? output.content[0].text
    : JSON.stringify(output);
const click = (ref: string): BrowserCallPayload["action"] => ({
  kind: "act",
  act: { type: "click", ref },
});

test("새 snapshot과 main frame 이동 뒤 옛 ref는 conflict이고 새 node를 가리키지 않는다", async () => {
  const { fake, run } = setup();
  fake.state.nodes = tree([100, "Old"]);
  assert.match(text(await run({ kind: "snapshot" })), /"Old" \[ref=e2\]/);
  // 같은 backend node가 다른 이름으로 다시 나온다. 옛 e2는 새 e4를 가리키면 안 된다.
  fake.state.nodes = tree([100, "New"]);
  assert.match(text(await run({ kind: "snapshot" })), /"New" \[ref=e4\]/);
  const old = await run(click("e2"));
  assert.deepEqual(old, {
    error: {
      code: "conflict",
      message: "stale ref e2: run browser snapshot again",
    },
  });
  assert.deepEqual(fake.state.clicked, []);
  await run(click("e4"));
  assert.deepEqual(fake.state.clicked, [100]);
  fake.emit("Page.frameNavigated", { frame: { id: "main" } });
  assert.match(text(await run(click("e4"))), /stale ref e4/);
});

test("사람이 가져간 탭에서 act·navigate·evaluate는 conflict이고 읽기는 된다", async () => {
  const { control, run } = setup("preview");
  await run({ kind: "snapshot" });
  control.take(TAB);
  const writes: BrowserCallPayload["action"][] = [
    click("e1"),
    { kind: "navigate", url: "http://localhost/" },
    { kind: "evaluate", expression: "1" },
  ];
  for (const action of writes) {
    const out = await run(action, "browser");
    assert.ok(
      "error" in out && out.error.code === "conflict",
      JSON.stringify(out),
    );
  }
  for (const action of [
    { kind: "snapshot" },
    { kind: "screenshot" },
    { kind: "logs" },
  ] as const) {
    assert.ok("content" in (await run(action)));
  }
  control.release(TAB);
  assert.ok("content" in (await run({ kind: "evaluate", expression: "1" })));
});

test("bind가 앱 live view를 가리켜도 그 page를 고르지 않는다", async () => {
  const { fake, run } = setup("live");
  const out = await run({ kind: "snapshot" });
  assert.ok("error" in out && out.error.code === "unavailable");
  assert.equal(fake.state.attached, 0);
});
