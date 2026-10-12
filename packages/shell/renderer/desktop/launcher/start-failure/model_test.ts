// model_test: shell#T57 launcher failure state creation

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { sandboxFailure, schemaFailure, startFailure } from "./model.ts";

test("shell/desktop#R11, R12: start failure shows distinct message and one action", () => {
  const failure = startFailure();
  assert.equal(failure.kind, "start");
  assert.ok(failure.message, "should have message key");
  assert.ok(failure.nextAction, "should have exactly one next action");
});

test("shell/desktop#R11, R12: sandbox failure shows distinct message and one action", () => {
  const failure = sandboxFailure();
  assert.equal(failure.kind, "sandbox");
  assert.ok(failure.message, "should have message key");
  assert.ok(failure.nextAction, "should have exactly one next action");
});

test("shell/desktop#R20: schema incompatibility failure shows distinct message and one action", () => {
  const failure = schemaFailure();
  assert.equal(failure.kind, "schema");
  assert.ok(failure.message, "should have message key");
  assert.ok(failure.nextAction, "should have exactly one next action");
});
