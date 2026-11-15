import assert from "node:assert/strict";
import { test } from "node:test";

import { routeNotice } from "./rule.ts";

test("보고 있으면 알리지 않고, 아니면 focus 창의 toast, 창이 없으면 OS 알림이다", () => {
  assert.equal(routeNotice({ looking: true, toastable: true }), "none");
  assert.equal(routeNotice({ looking: false, toastable: true }), "toast");
  assert.equal(routeNotice({ looking: false, toastable: false }), "os");
});
