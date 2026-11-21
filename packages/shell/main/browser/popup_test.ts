import assert from "node:assert/strict";
import { test } from "node:test";

import { createActivation } from "./activation.ts";
import { decidePopup } from "./popup.ts";
import { windowOpenHandler } from "./popup-host.ts";
import type { BrowserHooks } from "./registry.ts";

function setup() {
  let now = 100_000;
  const activation = createActivation({ nowMs: () => now });
  return {
    activation,
    advance: (ms: number) => (now += ms),
    open: (url: string, features = "") =>
      decidePopup({ url, features, activated: activation.fresh(1) }),
  };
}

test("popup needs a user input within 5000ms", () => {
  const t = setup();
  assert.deepEqual(t.open("https://a.example/"), {
    action: "deny",
    reason: "no-activation",
  });
  t.activation.mark(1);
  t.advance(4999);
  assert.equal(t.open("https://a.example/").action, "allow");
  t.advance(1);
  assert.deepEqual(t.open("https://a.example/"), {
    action: "deny",
    reason: "no-activation",
  });
});

test("popup is floated only with both width and height", () => {
  const t = setup();
  t.activation.mark(1);
  const url = "https://a.example/";
  assert.deepEqual(t.open(url, "width=500, Height=400.9"), {
    action: "allow",
    url,
    placement: { kind: "floated", width: 500, height: 400 },
  });
  for (const features of ["", "width=500", "width=0,height=400", "height=x"]) {
    assert.deepEqual(t.open(url, features), {
      action: "allow",
      url,
      placement: { kind: "docked" },
    });
  }
});

test("popup url that fails the navigation check is denied even with input", () => {
  const t = setup();
  t.activation.mark(1);
  assert.deepEqual(t.open("file:///etc/passwd"), {
    action: "deny",
    reason: "scheme",
  });
  assert.deepEqual(t.open("mailto:a@example.com"), {
    action: "deny",
    reason: "scheme",
    external: true,
  });
  assert.deepEqual(t.open("https://u:p@a.example/"), {
    action: "deny",
    reason: "credentials",
  });
});

// 깨지면 agent의 click이 사람의 컴퓨터에서 mailto 같은 OS 앱을 연다.
test("lophn이 넣은 input은 popup에는 활동이지만 window.open의 mailto를 OS 앱으로 넘기지 않는다", () => {
  let driven = true;
  const activation = createActivation({ nowMs: () => 100_000 }, () => driven);
  const opened: string[] = [];
  const blocked: string[] = [];
  const hooks = {
    activation,
    openExternal: (url: string) => void opened.push(url),
    popup: {
      blocked: () => void blocked.push("blocked"),
      open: () => {},
      tab: () => {},
    },
  } as unknown as BrowserHooks;
  const handle = windowOpenHandler({
    openerId: 1,
    hooks,
    adopt: () => {
      throw new Error("unused");
    },
    overrides: {},
  });
  const open = (url: string) =>
    handle({ url, features: "" } as Parameters<typeof handle>[0]);
  activation.mark(1);
  assert.equal(activation.fresh(1), true);
  open("mailto:a@example.test");
  assert.deepEqual(opened, []);
  assert.deepEqual(blocked, []);
  driven = false;
  activation.mark(1);
  open("mailto:a@example.test");
  assert.deepEqual(opened, ["mailto:a@example.test"]);
});
