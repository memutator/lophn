import assert from "node:assert/strict";
import { test } from "node:test";

import { createActivation } from "./activation.ts";
import { decidePopup } from "./popup.ts";

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
