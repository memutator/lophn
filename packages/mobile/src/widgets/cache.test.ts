import assert from "node:assert/strict";
import { test } from "node:test";
import type { AppWidget } from "../../../protocol/apps/widget.ts";
import { type Bindings, buildCache } from "./cache.ts";

const widget = (app: string, text: string): AppWidget => ({
  app,
  app_name: app,
  key: "today",
  label: "Today",
  screen: null,
  value: { v: 1, rows: [{ kind: "text", text, style: "title" }] },
  at: "2026-11-16T05:00:00.000Z",
});

const bindings: Bindings = {
  v: 1,
  widgets: {
    "1": { host: "A", app: "app_a", key: "today" },
    "2": { host: "B", app: "app_b", key: "today" },
  },
};
const time = (ms: number) => `t${ms}`;

test("a widget of a computer that left the pairing list keeps no rows, and no other computer's value takes its place", () => {
  const first = buildCache({
    bindings,
    paired: new Set(["A", "B"]),
    lists: new Map([
      ["A", [widget("app_a", "from A")]],
      ["B", [widget("app_b", "from B")]],
    ]),
    previous: null,
    now: 1,
    time,
  });
  assert.equal(first.widgets["1"]?.rows?.[0]?.kind, "text");

  // A is removed. Even if B answers with an app of the same key, and A's old rows are in the previous cache.
  const next = buildCache({
    bindings,
    paired: new Set(["B"]),
    lists: new Map([["B", [widget("app_a", "from B"), widget("app_b", "from B")]]]),
    previous: first,
    now: 2,
    time,
  });
  assert.equal(next.widgets["1"]?.state, "computer_removed");
  assert.equal(next.widgets["1"]?.rows, null);
  assert.doesNotMatch(JSON.stringify(next.widgets["1"]), /from A/);
  assert.equal(next.widgets["2"]?.state, "ok");

  // A widget rebound to another computer does not show the old binding's rows while the new computer cannot be reached.
  const rebound = buildCache({
    bindings: { v: 1, widgets: { "1": { host: "B", app: "app_b", key: "today" } } },
    paired: new Set(["B"]),
    lists: new Map([["B", null]]),
    previous: first,
    now: 3,
    time,
  });
  assert.doesNotMatch(JSON.stringify(rebound.widgets["1"]), /from A/);

  // The same binding keeps its rows when the computer cannot be reached, dimmed, with the time they were fetched.
  const offline = buildCache({
    bindings,
    paired: new Set(["A", "B"]),
    lists: new Map([["A", null]]),
    previous: first,
    now: 4,
    time,
  });
  assert.equal(offline.widgets["1"]?.stale, true);
  assert.match(JSON.stringify(offline.widgets["1"]), /from A/);
  assert.equal(offline.widgets["1"]?.footer, "Offline t1");
  // B was not asked: unchanged.
  assert.deepEqual(offline.widgets["2"], first.widgets["2"]);
});
