import assert from "node:assert/strict";
import { test } from "node:test";

import { TERMINAL_BRIDGE_OPEN_CHANNEL } from "../../ipc/terminal.ts";
import { createBridge } from "./bridge.ts";
import { DEFAULT_LINK_PREFS, type LinkPrefs } from "./policy.ts";

const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);

function setup(prefs: LinkPrefs = DEFAULT_LINK_PREFS) {
  const sent: { channel: string; payload: unknown }[] = [];
  const timers: (() => void)[] = [];
  let requests = 0;
  const bridge = createBridge({
    paths: { socket: "/run/b.sock", shim: "/run/browser" },
    env: {},
    ids: { key: () => KEY, request: () => `req-${++requests}` },
    readPrefs: () => Promise.resolve(prefs),
    windows: () => [{
      send: (channel, payload) => sent.push({ channel, payload }),
    }],
    openExternal: () => {},
    timers: {
      after: (_ms, run) => {
        timers.push(run);
        return () => {};
      },
    },
    log: () => {},
  });
  return { bridge, sent, timers };
}

const line = (key: string, url: string, v = 1) =>
  JSON.stringify({ v, key, url });

test("unknown, unbound and wrong-version requests are declined and push nothing", async () => {
  const { bridge, sent } = setup();
  const issued = bridge.issue()!;
  const url = "https://example.com/";
  assert.deepEqual(await bridge.handleLine(line(OTHER_KEY, url)), "declined");
  // issue만 하고 bind하지 않은 key
  assert.deepEqual(await bridge.handleLine(line(issued.key, url)), "declined");
  bridge.bind(issued.key, "term_1");
  assert.deepEqual(
    await bridge.handleLine(line(issued.key, url, 2)),
    "declined",
  );
  bridge.revoke("term_1");
  assert.deepEqual(await bridge.handleLine(line(issued.key, url)), "declined");
  assert.deepEqual(sent, []);
});

test("system_browser setting declines per web and local urls", async () => {
  const { bridge, sent } = setup({
    web_links: "system_browser",
    local_links: "system_browser",
  });
  bridge.bind(bridge.issue()!.key, "term_1");
  for (const url of ["https://example.com/", "http://localhost:3000/"]) {
    assert.deepEqual(await bridge.handleLine(line(KEY, url)), "declined");
  }
  assert.deepEqual(sent, []);
});

test("browser_tab pushes to windows, ack gives pane, no ack declines", async () => {
  const { bridge, sent, timers } = setup();
  bridge.bind(bridge.issue()!.key, "term_1");
  const url = "https://example.com/";

  const opened = bridge.handleLine(line(KEY, url));
  await Promise.resolve();
  assert.deepEqual(sent.length, 1);
  assert.deepEqual(sent[0]?.channel, TERMINAL_BRIDGE_OPEN_CHANNEL);
  assert.deepEqual(sent[0]?.payload, {
    request: "req-1",
    terminal_ref: "term_1",
    url,
  });
  bridge.ack("req-1", true);
  assert.deepEqual(await opened, "pane");

  const unanswered = bridge.handleLine(line(KEY, url));
  await Promise.resolve();
  assert.deepEqual(sent.length, 2);
  timers.at(-1)!();
  assert.deepEqual(await unanswered, "declined");
});
