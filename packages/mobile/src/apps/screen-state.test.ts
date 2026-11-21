import assert from "node:assert/strict";
import { test } from "node:test";
import { decideScreen, guestKeyOf, type ScreenFacts } from "./screen-state.ts";

const OPEN = { kind: "open", release: null, bundle_hash: "a".repeat(64), epoch: 0 } as const;

// A guest that is running: the bundle `a`, nothing wrong.
function running(over: Partial<ScreenFacts> = {}): ScreenFacts {
  const base: ScreenFacts = {
    computer: "connected",
    list: "ready",
    entry: true,
    fits: { ok: true },
    bound: OPEN,
    linked: true,
    bundle: { hash: "a", ok: true },
    attempt: 0,
    epoch: 0,
    guest: null,
  };
  return { ...base, guest: { key: guestKeyOf(base)!, state: "running" }, ...over };
}

const keyOf = (facts: ScreenFacts) => guestKeyOf(facts);

test("a running guest keeps its key through the computer going away and the list and view being read again", () => {
  const before = decideScreen(running());
  assert.deepEqual(before, { kind: "running", key: keyOf(running())!, away: false });
  for (const over of [
    { computer: "offline" },
    { computer: "connecting" },
    { computer: "update" },
    { list: "loading" },
    { list: "failed" },
    { bound: { kind: "opening" } },
    { computer: "offline", list: "loading", bound: { kind: "opening" } },
  ] as Partial<ScreenFacts>[]) {
    const now = decideScreen(running(over));
    assert.equal(now.kind, "running", JSON.stringify(over));
    assert.equal((now as { key: string }).key, (before as { key: string }).key, JSON.stringify(over));
    assert.equal((now as { away: boolean }).away, over.computer !== undefined);
  }
});

test("a running guest is replaced or taken down for a new bundle, Try again, an epoch, a failure and a screen that cannot run", () => {
  const key = (facts: ScreenFacts) => (decideScreen(facts) as { key: string }).key;
  const first = key(running());
  const newBundle = running({ bundle: { hash: "b", ok: true } });
  assert.notEqual(key({ ...newBundle, guest: null }), first);
  assert.notEqual(key(running({ attempt: 1, guest: null })), first);
  assert.notEqual(key(running({ epoch: 1, guest: null })), first);

  const down = (over: Partial<ScreenFacts>) => decideScreen(running(over)).kind;
  assert.equal(down({ guest: { key: first, state: { failed: "crashed" } } }), "failed");
  assert.equal(down({ bound: { kind: "stopped" } }), "stopped");
  assert.equal(down({ entry: false }), "stopped");
  assert.equal(down({ fits: { ok: false, reason: "phone_too_old" } }), "refused");
  // An app missing from a list that is still being read is not gone yet.
  assert.equal(down({ entry: false, list: "loading" }), "running");
});

test("a screen that has not run yet shows the notice for the computer being away", () => {
  const fresh = (over: Partial<ScreenFacts>) => decideScreen(running({ guest: null, ...over })).kind;
  assert.equal(fresh({ computer: "offline" }), "offline");
  assert.equal(fresh({ computer: "connecting" }), "loading");
  assert.equal(fresh({ list: "loading" }), "loading");
  assert.equal(fresh({ bound: { kind: "opening" } }), "loading");
  assert.equal(fresh({}), "running");
});
