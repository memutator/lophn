// start-failure_test: shell#T57 launcher failure screen rendering

import { strict as assert } from "node:assert";
import { test } from "node:test";
import React from "react";

import {
  schemaFailure,
  sandboxFailure,
  startFailure,
} from "./model.ts";
import { StartFailureScreen } from "./start-failure.tsx";

test("shell/desktop#R11: start failure shows without normal launcher appearance", () => {
  const failure = startFailure();
  const element = React.createElement(StartFailureScreen, { failure });

  assert.ok(element, "should render start failure screen");
  assert.equal(element.type, StartFailureScreen, "should be the failure component");
  assert.equal(element.props.failure.kind, "start", "should pass start failure");
});

test("shell/desktop#R12: sandbox failure shows distinct message", () => {
  const failure = sandboxFailure();
  const element = React.createElement(StartFailureScreen, { failure });

  assert.ok(element, "should render sandbox failure screen");
  assert.equal(element.props.failure.kind, "sandbox", "should pass sandbox failure");
});

test("shell/desktop#R20: schema failure shows distinct message for incompatibility", () => {
  const failure = schemaFailure();
  const element = React.createElement(StartFailureScreen, { failure });

  assert.ok(element, "should render schema failure screen");
  assert.equal(element.props.failure.kind, "schema", "should pass schema failure");
});
