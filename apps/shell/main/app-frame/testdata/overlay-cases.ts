import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { checkInput } from "../../desktop/ipc-guard.ts";
import { fixture } from "./overlay-fixture.ts";

test("shell/app-frame#R24: singleton transparent sandbox overlay stays above attached app and closes hidden", () => {
  const f = fixture();
  const v = f.views[0]!;
  assert.equal(f.views.length, 1);
  assert.equal(v.color, "#00000000");
  assert.deepEqual(v.wc.urls, ["lophn-shell://overlay/index.html"]);
  assert.deepEqual(v.config, {
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      webSecurity: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      allowRunningInsecureContent: false,
      devTools: false,
      preload: "installed-preload",
    },
  });
  assert.equal(v.visible.at(-1), false);
  const app = {
    ...v.view,
    setVisible() {
      throw new Error("app must stay visible");
    },
  };
  f.controller.attach(app);
  assert.deepEqual(f.order, [app, v.view]);
  const identity = f.open();
  assert.deepEqual(v.bounds.at(-1), f.input().anchorRect);
  assert.equal(v.visible.at(-1), true);
  assert(f.controller.close(f.event(f.shell.object), identity).ok);
  assert.equal(v.visible.at(-1), false);
  assert(f.order.includes(app));
  f.controller.dispose();
  assert(v.released);
});

test("shell/app-frame#R24: tight sibling union and full body use integer local coordinates with nonzero body origin", () => {
  const f = fixture();
  const v = f.views[0]!;
  assert(f.controller.subscribe(f.event(v.wc.object), {}).ok);
  f.open("tooltip", "first");
  const second = f.input("popover", "second");
  second.anchorRect = { x: 400, y: 200, width: 100, height: 60 };
  assert(f.controller.open(f.event(f.shell.object), second).ok);
  let state = v.wc.messages.at(-1)!;
  assert("surfaces" in state);
  assert.deepEqual(state.bounds, { x: 100, y: 80, width: 400, height: 180 });
  assert.deepEqual(state.surfaces[1]!.rect, {
    x: 300,
    y: 120,
    width: 100,
    height: 60,
  });
  f.open("dialog", "dialog");
  state = v.wc.messages.at(-1)!;
  assert("surfaces" in state);
  assert.deepEqual(state.bounds, f.body);
  assert.deepEqual(state.surfaces[0]!.rect, {
    x: 90,
    y: 32,
    width: 200,
    height: 100,
  });
  assert.equal(
    f.controller.open(f.event(f.shell.object), {
      ...f.input("menu", "invalid"),
      anchorRect: { x: 1.5, y: 1, width: 1, height: 1 },
    }).ok,
    false,
  );
  f.controller.dispose();
});

test("shell/app-frame#R29: drag gets full body and latest bounds coalesce at 16ms with disposal cancellation", () => {
  const f = fixture();
  const v = f.views[0]!;
  const identity = f.open("drag");
  assert.deepEqual(v.bounds.at(-1), f.body);
  for (const width of [20, 30, 40]) {
    assert(
      f.controller.result(f.event(v.wc.object), {
        ...identity,
        type: "pointer",
        pointerId: 1,
        x: 150,
        y: 150,
        bounds: { x: 100, y: 80, width, height: 100 },
      }).ok,
    );
  }
  assert.equal(f.timers.size, 1);
  assert.equal(f.applied.length, 0);
  const callback = [...f.timers.values()][0]!;
  f.timers.clear();
  callback();
  assert.equal(f.applied[0]!.width, 40);
  assert(
    f.controller.result(f.event(v.wc.object), {
      ...identity,
      type: "pointer",
      pointerId: 1,
      x: 150,
      y: 150,
      bounds: { x: 100, y: 80, width: 50, height: 100 },
    }).ok,
  );
  f.controller.dispose();
  assert.equal(f.timers.size, 0);
  callback();
  assert.equal(f.applied.length, 1);
});

test("shell/app-frame#R24: crash recreates generation and suppresses stale result and async load completion", async () => {
  const f = fixture();
  const first = f.views[0]!;
  const identity = f.open();
  first.fail("crashed");
  assert.equal(f.views.length, 2);
  assert.equal(f.controller.generation, 2);
  assert(first.released);
  assert.equal((f.shell.messages.at(-1)! as { type: string }).type, "closed");
  assert.equal(
    f.controller.result(f.event(first.wc.object), {
      ...identity,
      type: "closed",
    }).ok,
    false,
  );
  first.wc.reject();
  await Promise.resolve();
  assert.equal(f.views.length, 2);
  f.open("popover", "next");
  f.views[1]!.fail("load_failed");
  assert.equal((f.shell.messages.at(-1)! as { type: string }).type, "closed");
  assert.equal(f.open === undefined, false);
  assert.equal(
    f.controller.open(f.event(f.shell.object), f.input("menu", "late")).ok,
    false,
  );
  f.controller.dispose();
});

test("shell/app-frame#R24: IPC rejects forged caller, window, frame, origin, generation, selection and bounded schema", () => {
  const f = fixture();
  const v = f.views[0]!;
  const identity = f.open();
  const other = f.contents("desktop");
  f.registry.register({
    contents: other.object,
    origin: { scheme: "lophn-shell", host: "desktop", path: "/index.html" },
  });
  for (
    const event of [f.event(other.object), f.event({ ...f.shell.object }), {
      sender: f.shell.object,
      senderFrame: { parent: f.shell.frame, url: f.shell.frame.url },
    }]
  ) {
    assert.equal(f.controller.open(event, f.input("menu", "forged")).ok, false);
  }
  assert.equal(
    f.controller.open(f.event(v.wc.object), f.input("menu", "overlay_open")).ok,
    false,
  );
  const oldUrl = f.shell.frame.url;
  for (
    const url of [
      "lophn-shell://confirmation/index.html",
      "lophn-shell://app/index.html",
      "https://desktop/index.html",
    ]
  ) {
    f.shell.frame.url = url;
    assert.equal(
      f.controller.open(f.event(f.shell.object), f.input("menu", "url")).ok,
      false,
    );
  }
  f.shell.frame.url = oldUrl;
  for (
    const input of [{ ...f.input("menu", "unknown"), command: "run" }, {
      ...f.input("menu", "oversize"),
      model: { label: "x".repeat(70000), choices: [] },
    }, {
      ...f.input("menu", "html"),
      model: { label: "label", choices: [], html: "<script>" },
    }]
  ) assert.equal(f.controller.open(f.event(f.shell.object), input).ok, false);
  for (
    const result of [
      { ...identity, type: "selected", choiceId: "fake" },
      { ...identity, type: "selected", choiceId: "no" },
      { ...identity, generation: 99, type: "closed" },
      { ...identity, surfaceId: "other", type: "closed" },
      {
        ...identity,
        type: "pointer",
        pointerId: 1,
        x: 100,
        y: 100,
        bounds: f.body,
      },
    ]
  ) assert.equal(f.controller.result(f.event(v.wc.object), result).ok, false);
  assert.equal(
    f.controller.result(f.event(f.shell.object), {
      ...identity,
      type: "closed",
    }).ok,
    false,
  );
  assert.equal(checkInput(z.string(), "한".repeat(23000)).ok, false);
  assert(
    f.controller.result(f.event(v.wc.object), {
      ...identity,
      type: "selected",
      choiceId: "yes",
    }).ok,
  );
  assert.equal((f.shell.messages.at(-1)! as { type: string }).type, "selected");
  f.controller.dispose();
});

test("shell/design-system#R33: notification toast action selects an enabled choice while tooltip and drag cannot select", () => {
  const f = fixture();
  const v = f.views[0]!;
  const select = (
    identity: { surfaceId: string; generation: number },
    choiceId = "yes",
  ) =>
    f.controller.result(f.event(v.wc.object), {
      ...identity,
      type: "selected",
      choiceId,
    }).ok;
  const notification = f.open("notification", "notification");
  assert.equal(select(notification, "no"), false);
  assert.equal(select(notification, "missing"), false);
  assert(select(notification));
  const last = f.shell.messages.at(-1)! as { type: string; choiceId: string };
  assert.deepEqual([last.type, last.choiceId], ["selected", "yes"]);
  assert.equal(v.wc.focuses() + f.shell.focuses(), 0);
  for (const kind of ["tooltip", "drag"] as const) {
    assert.equal(select(f.open(kind, kind)), false);
  }
  f.controller.dispose();
});

test("shell/design-system#R2: only interactive surfaces focus and restore shell on close", () => {
  const f = fixture();
  const v = f.views[0]!;
  for (const kind of ["tooltip", "drag", "notification"] as const) {
    const identity = f.open(kind, kind);
    assert.equal(v.wc.focuses(), 0);
    f.controller.close(f.event(f.shell.object), identity);
    assert.equal(f.shell.focuses(), 0);
  }
  const identity = f.open("menu");
  assert.equal(v.wc.focuses(), 1);
  f.controller.close(f.event(f.shell.object), identity);
  assert.equal(f.shell.focuses(), 1);
  f.controller.dispose();
});

test("shell/app-frame#R29: drag end relays final latest bounds before completed terminal at frame boundary", () => {
  const f = fixture();
  const v = f.views[0]!;
  const id = f.open("drag");
  const dto = {
    ...id,
    pointerId: 1,
    x: 150,
    y: 150,
    bounds: { x: 100, y: 80, width: 30, height: 40 },
  };
  assert(
    f.controller.result(f.event(v.wc.object), { ...dto, type: "pointer" }).ok,
  );
  assert(
    f.controller.result(f.event(v.wc.object), {
      ...dto,
      type: "drag-end",
      bounds: { ...dto.bounds, width: 50 },
    }).ok,
  );
  assert.equal(
    f.controller.result(f.event(v.wc.object), { ...dto, type: "pointer" }).ok,
    false,
  );
  assert.equal(
    f.controller.open(f.event(f.shell.object), f.input("drag", "second")).ok,
    false,
  );
  assert.equal(f.shell.messages.length, 0);
  const callback = [...f.timers.values()][0]!;
  f.timers.clear();
  callback();
  assert.equal(f.applied[0]!.width, 50);
  assert.deepEqual(
    f.shell.messages.map((e) => "type" in e ? e.type : "state"),
    ["pointer", "closed"],
  );
  assert.equal((f.shell.messages[1] as { reason: string }).reason, "completed");
  f.controller.dispose();
});

test("shell/app-frame#R29: cancellation and old callbacks never relay new drag pending data", () => {
  const f = fixture();
  const v = f.views[0]!;
  const id = f.open("drag");
  const dto = {
    ...id,
    type: "drag-end",
    pointerId: 1,
    x: 150,
    y: 150,
    bounds: { x: 100, y: 80, width: 40, height: 40 },
  };
  assert(f.controller.result(f.event(v.wc.object), dto).ok);
  const stale = [...f.timers.values()][0]!;
  assert(
    f.controller.result(f.event(v.wc.object), { ...id, type: "drag-cancel" })
      .ok,
  );
  const next = f.open("drag", "next");
  assert(f.controller.result(f.event(v.wc.object), { ...dto, ...next }).ok);
  stale();
  assert.equal(f.applied.length, 0);
  v.fail("crashed");
  stale();
  assert.equal(f.applied.length, 0);
  const current = f.views[1]!;
  const menu = f.open("menu", "menu");
  assert.equal(
    f.controller.result(f.event(current.wc.object), { ...dto, ...menu }).ok,
    false,
  );
  assert.equal(
    f.controller.result(f.event(current.wc.object), {
      ...menu,
      type: "drag-cancel",
    }).ok,
    false,
  );
  assert.equal(
    f.controller.result(f.event(current.wc.object), { ...dto, generation: 99 })
      .ok,
    false,
  );
  f.controller.dispose();
});

test("shell/app-frame#R29: resize latest frame reads current body once and retired callback cannot touch new view", () => {
  const f = fixture();
  const v = f.views[0]!;
  f.open("dialog");
  assert(f.controller.subscribe(f.event(v.wc.object), {}).ok);
  const before = v.bounds.length;
  const messages = v.wc.messages.length;
  for (const width of [700, 800, 1000]) {
    f.body.width = width;
    f.controller.refresh();
  }
  assert.equal(f.timers.size, 1);
  assert.equal(v.bounds.length, before);
  const callback = [...f.timers.values()][0]!;
  f.timers.clear();
  callback();
  assert.equal(v.bounds.length, before + 1);
  assert.equal(v.wc.messages.length, messages + 1);
  assert.equal(v.bounds.at(-1)!.width, 1000);
  f.controller.refresh();
  const stale = [...f.timers.values()][0]!;
  v.fail("crashed");
  const next = f.views[1]!;
  f.controller.refresh();
  stale();
  assert.equal(next.bounds.length, 0);
  f.controller.dispose();
  callback();
  stale();
  assert.equal(next.bounds.length, 0);
});

test("shell/app-frame#R22: dispose after the window closed skips the destroyed view and shell", () => {
  const f = fixture();
  const v = f.views[0]!;
  f.open("dialog");
  assert(f.controller.subscribe(f.event(v.wc.object), {}).ok);
  // 창이 닫혀 shell과 view webContents가 이미 destroy된 뒤의 정리다.
  f.shell.object.close();
  v.wc.object.close();
  f.controller.dispose();
  assert.equal((f.shell.messages.at(-1) as { type?: string })?.type, undefined);
  assert(v.released);
  // dispose가 이미 destroy된 view를 다시 건드리지 않는다.
  f.controller.dispose();
  assert(v.released);
});

test("shell/app-frame#R24: 검색 palette는 검색어를 연 쪽에 돌려주고 연 쪽이 바꾼 행만 고를 수 있다", () => {
  const f = fixture();
  const v = f.views[0]!;
  assert(f.controller.subscribe(f.event(v.wc.object), {}).ok);
  const palette = {
    ...f.input("palette", "palette"),
    model: {
      label: "Search",
      search: true,
      choices: [{ id: "old", label: "Old", group: "Documents" }],
    },
  };
  const opened = f.controller.open(f.event(f.shell.object), palette);
  assert(opened.ok);
  const identity = opened.value;
  assert(
    f.controller.result(f.event(v.wc.object), {
      ...identity,
      type: "query",
      text: "plan",
    }).ok,
  );
  assert.deepEqual(f.shell.messages.at(-1), {
    requestId: "palette",
    ...identity,
    type: "query",
    text: "plan",
  });
  // 연 쪽만 행을 바꾼다. overlay가 보낸 update는 거절한다.
  const model = {
    label: "Search",
    search: true,
    choices: [{
      id: "new",
      label: "Plan",
      group: "Documents",
      icon: "document" as const,
    }],
  };
  assert.equal(
    f.controller.update(f.event(v.wc.object), { ...identity, model }).ok,
    false,
  );
  assert(
    f.controller.update(f.event(f.shell.object), { ...identity, model }).ok,
  );
  const state = v.wc.messages.at(-1)!;
  assert("surfaces" in state);
  assert.deepEqual(state.surfaces[0]!.model, model);
  assert.equal(
    f.controller.result(f.event(v.wc.object), {
      ...identity,
      type: "selected",
      choiceId: "old",
    }).ok,
    false,
  );
  assert(
    f.controller.result(f.event(v.wc.object), {
      ...identity,
      type: "selected",
      choiceId: "new",
    }).ok,
  );
  assert.equal(
    f.controller.update(f.event(f.shell.object), { ...identity, model }).ok,
    false,
  );
  // 검색하지 않는 표면은 검색어도 행 바꾸기도 받지 않는다.
  const menu = f.open("menu", "menu");
  assert.equal(
    f.controller.result(f.event(v.wc.object), {
      ...menu,
      type: "query",
      text: "x",
    }).ok,
    false,
  );
  assert.equal(
    f.controller.update(f.event(f.shell.object), { ...menu, model }).ok,
    false,
  );
  f.controller.dispose();
});
