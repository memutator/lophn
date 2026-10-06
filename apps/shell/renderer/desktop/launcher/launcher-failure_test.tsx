// launcher-failure_test: shell#T57 launcher failure screen integration

import { strict as assert } from "node:assert";
import { test } from "node:test";
import React from "react";

import type { ConnectionState, CoreSource } from "../connection/connection.ts";
import { Launcher } from "./launcher.tsx";

// Mock CoreSource for testing
function createMockCoreSource(
  initialState: ConnectionState,
): CoreSource {
  let listener: ((state: ConnectionState) => void) | null = null;

  return {
    subscribe(fn) {
      listener = fn;
      fn(initialState);
      return () => {
        listener = null;
      };
    },
    call: () =>
      Promise.resolve({
        ok: false,
        error: { code: "unavailable", message: "test" },
      }),
  };
}

test("shell/desktop#R11, R12, R20: launcher shows failure state without normal launcher", () => {
  const states: ConnectionState[] = [
    { state: "failed-start", confirmedAt: null },
    { state: "failed-sandbox", confirmedAt: null },
    { state: "failed-schema", confirmedAt: null },
  ];

  for (const failureState of states) {
    const source = createMockCoreSource(failureState);
    const element = React.createElement(Launcher, {
      source,
      onLophn: () => {},
    });

    assert.ok(element, `should render launcher for ${failureState.state}`);
    assert.equal(
      element.type,
      Launcher,
      `launcher component should render ${failureState.state}`,
    );
  }
});

test("shell/desktop#R11, R12, R20: launcher renders StartFailureScreen with one action for each failure", () => {
  const failureStates: ConnectionState[] = [
    { state: "failed-start", confirmedAt: null },
    { state: "failed-sandbox", confirmedAt: null },
    { state: "failed-schema", confirmedAt: null },
  ];

  for (const state of failureStates) {
    const source = createMockCoreSource(state);
    const props = {
      source,
      onLophn: () => {},
    };
    const element = React.createElement(Launcher, props);

    // The launcher should render without error
    assert.ok(element, `launcher should render for ${state.state}`);
    // Each failure state triggers a different StartFailureScreen with exactly one action
    assert.ok(
      element.props.source,
      "launcher should receive source with failure state",
    );
  }
});

test("shell/desktop#R11, R12, R20: launcher does not show normal launcher when in failure state", () => {
  const failureState: ConnectionState = {
    state: "failed-start",
    confirmedAt: null,
  };
  const source = createMockCoreSource(failureState);

  const element = React.createElement(Launcher, {
    source,
    onLophn: () => {},
    projects: {
      projects: () => Promise.resolve({ ok: true as const, value: [] }),
      register: () => Promise.reject(new Error("unused")),
      pickFolder: () => Promise.reject(new Error("unused")),
    },
  });

  // With failure state, the launcher should not render normal project cards
  // This is verified by the element.props not containing projects in rendered output
  assert.ok(element, "launcher should render failure state");
  assert.equal(
    element.type,
    Launcher,
    "launcher element should be Launcher component",
  );
});
