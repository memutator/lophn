import assert from "node:assert/strict";
import { test } from "node:test";
import type { PhoneRequestFrame } from "../../../protocol/phone/link.ts";
import { type AnswerDeps, answerRequest, phoneCapabilities } from "./answer.ts";
import type { LocationPort } from "./location.ts";

// A port that counts every native read, so a test can say "nothing was read".
function fake(opts: { permission?: boolean; services?: boolean } = {}) {
  const calls: string[] = [];
  const fix = { lat: 37.5665, lon: 126.978, accuracyM: 12, atMs: 0 };
  const location: LocationPort = {
    permission: async () => opts.permission ?? true,
    servicesEnabled: async () => opts.services ?? true,
    lastKnown: async () => (calls.push("lastKnown"), fix),
    current: async () => (calls.push("current"), fix),
  };
  const deps = (active = true): AnswerDeps => ({
    ctx: { location, drive: {} as never } as never,
    isActive: () => active,
    wait: () => () => {},
  });
  return { calls, deps };
}

const request = (kind: string, input: unknown = {}): PhoneRequestFrame => ({
  type: "request",
  id: "r1",
  kind,
  input,
  deadline_ms: 5000,
});

test("a denied OS permission, an unknown kind or an app not in front never reads the location", async () => {
  const denied = fake({ permission: false });
  const a = await answerRequest(request("location.get"), denied.deps());
  assert.deepEqual(a, {
    type: "response",
    id: "r1",
    ok: false,
    error: {
      code: "forbidden",
      message: "location permission is denied on the phone",
      details: { reason: "os_permission_denied" },
    },
  });

  const unknown = fake();
  const b = await answerRequest(request("camera.take"), unknown.deps());
  assert.ok(b && !b.ok);
  assert.deepEqual(b.error.details, { reason: "unsupported" });

  const background = fake();
  const c = await answerRequest(request("location.get"), background.deps(false));
  assert.ok(c && !c.ok);
  assert.deepEqual(c.error.details, { reason: "phone_in_background" });

  const off = fake({ services: false });
  const d = await answerRequest(request("location.get"), off.deps());
  assert.ok(d && !d.ok);
  assert.deepEqual(d.error.details, { reason: "location_off" });

  for (const one of [denied, unknown, background, off]) {
    assert.deepEqual(one.calls, []);
  }
});

test("an allowed request answers with the position; a bad input is invalid_input; an answer after the deadline is dropped", async () => {
  const granted = fake();
  const ok = await answerRequest(
    request("location.get", { max_age_ms: 1000 }),
    granted.deps(),
  );
  assert.deepEqual(ok, {
    type: "response",
    id: "r1",
    ok: true,
    value: {
      lat: 37.5665,
      lon: 126.978,
      accuracy_m: 12,
      at: "1970-01-01T00:00:00.000Z",
    },
  });
  assert.deepEqual(granted.calls, ["lastKnown"]);

  const bad = await answerRequest(
    request("location.get", { accuracy: "exact" }),
    granted.deps(),
  );
  assert.ok(bad && !bad.ok && bad.error.code === "invalid_input");

  const slow = fake();
  const never = await answerRequest(request("location.get"), {
    ...slow.deps(),
    ctx: {
      location: { ...slow.deps().ctx.location, current: () => new Promise(() => {}) },
      drive: {} as never,
    } as never,
    wait: (_ms, fn) => (queueMicrotask(fn), () => {}),
  });
  assert.equal(never, undefined);

  // what the link can be asked: the capabilities a backend may ask, and drive
  assert.deepEqual(phoneCapabilities(), [
    "location.get",
    "network.get",
    "drive.snapshot",
    "drive.act",
    "drive.screenshot",
    "drive.wait",
  ]);
});
