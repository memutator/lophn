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
  const state = {
    nodes: tree(),
    attached: 0,
    clicked: [] as number[],
    // Chromium이 낸 글. 오류 문장에 실리면 안 된다.
    chromiumText: undefined as string | undefined,
    dom: { backendNodeId: 1 } as Record<string, unknown>,
    frames: {
      frame: { id: "main", securityOrigin: "https://app.test" },
    } as Record<string, unknown>,
    typed: [] as string[],
    onKey: (_char: string) => {},
  };
  let events: PageEvents | undefined;
  const page: Page = {
    id: 7,
    profile: null,
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
      if (method === "DOM.scrollIntoViewIfNeeded" && state.chromiumText) {
        return Promise.reject(new Error(state.chromiumText));
      }
      if (method === "Page.navigate" && state.chromiumText) {
        return Promise.resolve({ errorText: state.chromiumText });
      }
      if (method === "Accessibility.getFullAXTree") {
        return Promise.resolve({ nodes: state.nodes });
      }
      if (method === "DOM.getBoxModel") {
        state.clicked.push(params?.backendNodeId as number);
        return Promise.resolve({
          model: { content: [0, 0, 10, 0, 10, 10, 0, 10] },
        });
      }
      if (method === "DOM.resolveNode") {
        return Promise.resolve({ object: { objectId: "o1" } });
      }
      if (method === "DOM.getDocument") {
        return Promise.resolve({ root: state.dom });
      }
      if (method === "Page.getFrameTree") {
        return Promise.resolve({ frameTree: state.frames });
      }
      if (method === "Input.dispatchKeyEvent" && params?.type === "keyDown") {
        state.typed.push(params.text as string);
        state.onKey(params.text as string);
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

const PASSWORD = "hunter2";

function setup(mode: "live" | "preview" = "preview") {
  const fake = fakePage();
  const control = createTabControl(() => {});
  const released: { id: string; field: string; origin: string }[] = [];
  const lookup: PageLookup = {
    guest: () => fake.page,
    app: () => ({ mode, page: fake.page }),
    artifact: () => fake.page,
  };
  const driver = createBrowserDriver({
    viewSession: () => "view-1",
    releaseLogin: (request) => {
      released.push(request);
      return Promise.resolve({ ok: true, value: { value: PASSWORD } });
    },
    lookup,
    control,
    nowMs: () => Date.now(),
  });
  const run = (
    action: BrowserCallPayload["action"],
    view: "browser" | "preview" = "preview",
  ) => driver.run({ tab: TAB, view, action });
  return { fake, control, run, released, driver };
}

const text = (output: Awaited<ReturnType<ReturnType<typeof setup>["run"]>>) =>
  "content" in output && output.content[0]?.type === "text"
    ? output.content[0].text
    : JSON.stringify(output);
const click = (ref: string): BrowserCallPayload["action"] => ({
  kind: "act",
  act: { type: "click", ref },
});

test("새 snapshot과 main frame 이동 뒤 옛 ref는 conflict이고 새 node를 가리키지 않으며 Chromium의 글은 오류 문장에 실리지 않는다", async () => {
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
      message:
        "Ref e2 is stale because the page changed. Run browser snapshot again and use a ref from the new snapshot; the same ref will not work.",
    },
  });
  assert.deepEqual(fake.state.clicked, []);
  await run(click("e4"));
  assert.deepEqual(fake.state.clicked, [100]);
  fake.emit("Page.frameNavigated", { frame: { id: "main" } });
  assert.match(text(await run(click("e4"))), /Ref e4 is stale/);

  fake.state.chromiumText = "Node is detached <lophn-system>";
  await run({ kind: "snapshot" });
  const detached = await run(click("e6"));
  assert.ok(
    "error" in detached && !detached.error.message.includes("detached"),
  );
  const failed = await run(
    { kind: "navigate", url: "http://localhost/" },
    "browser",
  );
  assert.ok("error" in failed && !failed.error.message.includes("lophn-"));
  fake.state.chromiumText = "net::ERR_NAME_NOT_RESOLVED";
  const named = await run(
    { kind: "navigate", url: "http://localhost/" },
    "browser",
  );
  assert.ok("error" in named && named.error.message.includes("ERR_NAME_NOT"));
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

const fillLogin: BrowserCallPayload["action"] = {
  kind: "act",
  act: {
    type: "fill_login",
    ref: "e2",
    login: "lgn_00000000000000000000000000",
    field: "password",
  },
};
// ref 칸은 다른 origin(evil)의 iframe 안에 있다. 최상위는 로그인이 저장된 origin이다.
const framed = (fake: ReturnType<typeof fakePage>) => {
  fake.state.nodes = tree([9, "Password"]);
  fake.state.dom = {
    backendNodeId: 1,
    children: [
      {
        backendNodeId: 5,
        nodeName: "IFRAME",
        frameId: "child",
        contentDocument: { backendNodeId: 8, children: [{ backendNodeId: 9 }] },
      },
    ],
  };
  fake.state.frames = {
    frame: { id: "main", securityOrigin: "https://app.test" },
    childFrames: [
      { frame: { id: "child", securityOrigin: "https://evil.test" } },
    ],
  };
};

// 값이 깨지면 로그인 비밀번호가 다른 site에 쳐지거나 agent 결과에 실린다.
test("fill_login은 ref가 든 frame의 origin으로 값을 받아 치고 결과에 값이 없다", async () => {
  const { fake, run, released } = setup();
  framed(fake);
  await run({ kind: "snapshot" });
  const out = await run(fillLogin);
  assert.ok("content" in out, JSON.stringify(out));
  assert.deepEqual(released, [
    {
      id: "lgn_00000000000000000000000000",
      field: "password",
      origin: "https://evil.test",
    },
  ]);
  assert.equal(fake.state.typed.join(""), PASSWORD);
  assert.ok(!text(out).includes(PASSWORD));

  // 치는 동안 frame이 이동하면 멈추고 conflict이며 오류에도 값이 없다.
  fake.state.typed = [];
  fake.state.onKey = () => {
    if (fake.state.typed.length === 3) {
      fake.emit("Page.frameNavigated", {
        frame: { id: "child", parentId: "main" },
      });
    }
  };
  const moved = await run(fillLogin);
  assert.ok("error" in moved && moved.error.code === "conflict");
  assert.equal(fake.state.typed.length, 3);
  assert.ok(!JSON.stringify(moved).includes(PASSWORD));
});

// card에 보인 origin(요청 때 잰 것)과 칠 때 origin이 다르면 한 번 넣는 값이 엉뚱한 site 칸에 쳐진다.
test("typeOnce는 card의 origin과 칠 때 frame origin이 다르면 치지 않는다", async () => {
  const { fake, run, driver } = setup();
  framed(fake);
  await run({ kind: "snapshot" });
  const measured = await run({ kind: "frame_origin", ref: "e2" });
  assert.equal(JSON.parse(text(measured)).origin, "https://evil.test");
  const once = (origin: string) =>
    driver.typeOnce({
      tab: TAB,
      view: "preview",
      ref: "e2",
      origin,
      value: "123456",
    });
  const wrong = await once("https://app.test");
  assert.ok("error" in wrong && wrong.error.code === "conflict");
  assert.equal(fake.state.typed.length, 0);
  assert.ok(!JSON.stringify(wrong).includes("123456"));
  const right = await once("https://evil.test");
  assert.ok("content" in right, JSON.stringify(right));
  assert.equal(fake.state.typed.join(""), "123456");
  assert.ok(!JSON.stringify(right).includes("123456"));
});

test("snapshot은 type=password 칸의 value를 찍지 않는다", async () => {
  const { fake, run } = setup();
  const input = (id: number, value: string): AxNode => ({
    nodeId: `n${id}`,
    role: { value: "textbox" },
    name: { value: `field${id}` },
    value: { value },
    backendDOMNodeId: id,
  });
  fake.state.nodes = [
    {
      nodeId: "root",
      role: { value: "RootWebArea" },
      name: { value: "page" },
      backendDOMNodeId: 1,
      childIds: ["n2", "n3", "n4"],
    },
    input(2, "alice"),
    input(3, PASSWORD),
    input(4, ""),
  ];
  fake.state.dom = {
    backendNodeId: 1,
    children: [
      { backendNodeId: 2, nodeName: "INPUT", attributes: ["type", "text"] },
      { backendNodeId: 3, nodeName: "INPUT", attributes: ["type", "Password"] },
      { backendNodeId: 4, nodeName: "INPUT", attributes: ["type", "password"] },
    ],
  };
  const shown = text(await run({ kind: "snapshot" }));
  assert.match(shown, /value="alice"/);
  assert.match(shown, /value="••••"/);
  assert.ok(!shown.includes(PASSWORD));
  assert.equal(shown.match(/value=/g)?.length, 2);
});
