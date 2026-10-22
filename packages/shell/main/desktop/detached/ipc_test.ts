import assert from "node:assert/strict";
import { test } from "node:test";

import type { DetachedTaken } from "../../../ipc/detached.ts";
import { ContentsRegistry } from "../ipc-guard.ts";
import { createDetachedIpc } from "./ipc.ts";
import { DetachedRegistry } from "./registry.ts";

const PROJECT = "prj_01h455vb4pex5v6nkc6gd5fd00";
const TAB = { key: "terminal:1", kind: "terminal" };
const RUNTIME = { terminal_ref: "term_1", generation: 3 };

// project 창 하나와 detached 창 하나를 흉내 낸다. 창은 열 때마다 새 ref를 받는다.
function setup() {
  const registry = new ContentsRegistry();
  const entries = new DetachedRegistry();
  const senders = new Map<number, { ref: string; detached: boolean }>();
  const contentsOf = (id: number, url: string) => {
    const contents = {
      id,
      isDestroyed: () => false,
      mainFrame: null as unknown as { parent: null; url: string },
    };
    contents.mainFrame = { parent: null, url };
    registry.register({
      contents,
      origin: { scheme: "app", host: "desktop", path: "/" },
    });
    return {
      sender: contents,
      senderFrame: contents.mainFrame,
    };
  };
  let windows = 0;
  const hidden = new Map<string, boolean>();
  const handlers = new Map(
    createDetachedIpc({
      registry,
      entries,
      refOf: (sender) => senders.get(sender.id),
      openWindow: () => ({
        ref: `detached-${++windows}`,
        bounds: { x: 0, y: 0, width: 1, height: 1 },
      }),
      closeWindow: () => {},
      focusWindow: () => {},
      setHidden: (ref, value) => hidden.set(ref, value),
      isAlive: () => true,
      send: () => {},
      owns: () => true,
      moveViews: () => ({ ok: true }),
    }),
  );
  const call = (channel: string, event: unknown, input: unknown) =>
    handlers.get(channel as never)!(event as never, input) as {
      ok: boolean;
      value?: unknown;
    };
  return { entries, senders, contentsOf, call, hidden };
}

test("project를 떠났다 돌아온 detached terminal은 PTY 참조를 한 번만 받는다", () => {
  const { entries, senders, contentsOf, call } = setup();
  senders.set(1, { ref: "project-1", detached: false });
  senders.set(2, { ref: "detached-1", detached: true });
  const project = contentsOf(1, "app://desktop/");
  const detached = contentsOf(2, "app://desktop/");
  const open = { project: PROJECT, tab: TAB, transfer: null, bounds: null };

  assert.equal(call("shell:detached-open", project, open).ok, true);
  // 창이 현재 PTY 참조를 알린다.
  assert.equal(
    call("shell:detached-changed", detached, { tab: TAB, resume: RUNTIME }).ok,
    true,
  );
  // project를 떠나면 창이 조용히 닫힌다.
  call("shell:detached-close", project, { key: null });
  entries.remove("detached-1");

  // 돌아와 transfer 없이 열면 들어 둔 참조로 이어 붙는다.
  assert.equal(call("shell:detached-open", project, open).ok, true);
  senders.set(3, { ref: "detached-2", detached: true });
  const taken = call(
    "shell:detached-take",
    contentsOf(3, "app://desktop/"),
    null,
  )
    .value as DetachedTaken;
  assert.deepEqual(taken.transfer, { value: RUNTIME, views: [] });

  // 한 번 쓰면 지워진다. 다시 닫고 열어도 다른 창이 같은 PTY를 받지 않는다.
  entries.remove("detached-2");
  assert.equal(call("shell:detached-open", project, open).ok, true);
  senders.set(4, { ref: "detached-3", detached: true });
  const again = call(
    "shell:detached-take",
    contentsOf(4, "app://desktop/"),
    null,
  )
    .value as DetachedTaken;
  assert.equal(again.transfer, null);
});

test("showOnly는 보낸 project 창의 detached 창만 숨기고 보이며, 없는 key는 missing이다", () => {
  const { senders, contentsOf, call, hidden } = setup();
  senders.set(1, { ref: "project-1", detached: false });
  senders.set(2, { ref: "project-2", detached: false });
  senders.set(3, { ref: "detached-1", detached: true });
  const one = contentsOf(1, "app://desktop/");
  const two = contentsOf(2, "app://desktop/");
  const open = (win: typeof one, key: string) =>
    call("shell:detached-open", win, {
      project: PROJECT,
      tab: { key, kind: "terminal" },
      transfer: null,
      bounds: null,
    });
  open(one, "a"); // detached-1
  open(one, "b"); // detached-2
  open(two, "c"); // detached-3
  // 숨김 상태는 setHidden 호출이 있을 때만 map에 생긴다. 처음 창은 보인다.
  const shown = (ref: string) => hidden.get(ref) !== true;

  const reply = call("shell:detached-show", one, { keys: ["a", "x"] });
  assert.deepEqual(reply.value, { missing: ["x"] });
  assert.equal(shown("detached-1"), true);
  assert.equal(shown("detached-2"), false);
  assert.equal(shown("detached-3"), true);

  // detached 창이 보내면 거절되고 상태는 그대로다.
  const forbidden = call(
    "shell:detached-show",
    contentsOf(3, "app://desktop/"),
    {
      keys: [],
    },
  ) as { ok: boolean; error?: { code: string } };
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.error?.code, "forbidden");
  assert.equal(shown("detached-1"), true);
  assert.equal(shown("detached-2"), false);
});
