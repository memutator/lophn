// deno-binary_test: shell#T57 bundled Deno binary resolution
// Tests that packaged apps correctly resolve the bundled Deno binary.

import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveDenoBinary } from "./deno-binary.ts";

test("shell/desktop#R20: development uses system deno command", () => {
  const binary = resolveDenoBinary({ isPackaged: false });
  assert.equal(binary, "deno", "development mode should use 'deno' command");
});

test("shell/desktop#R20: packaged app resolves bundled Deno at the install root", () => {
  const resourcesPath = "/opt/lophn/resources";
  const binary = resolveDenoBinary(
    { isPackaged: true, resourcesPath },
    () => {},
  );

  const expected = process.platform === "win32"
    ? "/opt/lophn/deno.exe"
    : "/opt/lophn/deno";
  assert.equal(
    binary,
    expected,
    "packaged mode should resolve binary from resourcesPath",
  );
});

test("shell/desktop#R20: missing resourcesPath falls back to system deno", () => {
  const binary = resolveDenoBinary({ isPackaged: true }, () => {});
  assert.equal(
    binary,
    "deno",
    "missing resourcesPath should fall back to system deno",
  );
});

test("shell/desktop#R20: log callback receives resolution messages", () => {
  const logs: string[] = [];
  resolveDenoBinary(
    { isPackaged: true, resourcesPath: "/app/resources" },
    (msg) => logs.push(msg),
  );

  assert.ok(
    logs.some((msg) => msg.includes("resolved bundled deno")),
    "should log resolution message",
  );
});
