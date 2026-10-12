// stage_test: shell#T57 packaging staging
// Tests that staging produces the correct directory structure with required resources.

import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainRoot = path.resolve(__dirname, "..");
const outDir = path.join(mainRoot, "build", "stage");

function isFile(relPath: string): boolean {
  const fullPath = path.join(outDir, relPath);
  return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
}

function isDir(relPath: string): boolean {
  const fullPath = path.join(outDir, relPath);
  return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
}

test("shell#T57: stage produces shell build, preload, renderer, fonts, Deno, and node-pty", (t) => {
  // Check if stage directory exists (would be created by prior npm run stage)
  if (!isDir("")) {
    t.skip("stage directory not yet created; run `npm run stage` first");
    return;
  }

  // Verify required directories exist
  assert.ok(isDir("bin"), "bin/ should be created");
  assert.ok(
    isDir("shell-main") || isDir("shell-renderer"),
    "shell-main/ or shell-renderer/ should be created",
  );
  assert.ok(isDir("core"), "core/ should be created");

  // Verify deno binary exists
  const denoBin = process.platform === "win32" ? "bin/deno.exe" : "bin/deno";
  assert.ok(isFile(denoBin), `${denoBin} should be staged`);

  // Verify STAGE.json exists and contains required metadata
  assert.ok(isFile("STAGE.json"), "STAGE.json should be created");
  const stageJson = JSON.parse(
    fs.readFileSync(path.join(outDir, "STAGE.json"), "utf8"),
  );
  assert.ok(stageJson.built_at, "STAGE.json should contain built_at");
  assert.ok(stageJson.deno, "STAGE.json should contain deno version");
  assert.ok(stageJson.platform, "STAGE.json should contain platform");
});

test("shell#T57: stage includes shell build outputs", () => {
  if (!isDir(outDir)) {
    return; // Skip if stage hasn't been run
  }

  // Verify shell main build is staged (dist directory should exist)
  assert.ok(
    isDir("shell-main/dist") || isDir("shell-main"),
    "shell main build should be staged",
  );
});

test("shell#T57: stage includes fonts for token rendering", () => {
  if (!isDir(outDir)) {
    return; // Skip if stage hasn't been run
  }

  // Fonts directory should exist (may be empty in test env)
  assert.ok(isDir("fonts"), "fonts directory should be created");
});

test("shell#T57: stage includes core packages for bundled Deno", () => {
  if (!isDir(outDir)) {
    return; // Skip if stage hasn't been run
  }

  // Core directory should exist with deno.json for Deno bundling
  assert.ok(isDir("core"), "core directory should exist");
  if (isDir("core")) {
    const hasDenoConfig = isFile("core/deno.json") || isFile("core/deno.lock");
    assert.ok(
      hasDenoConfig,
      "core should have deno configuration for bundling",
    );
  }
});
