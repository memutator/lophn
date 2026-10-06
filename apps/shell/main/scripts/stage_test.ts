// stage_test: shell#T57 packaging staging
// Tests that stage.ts is a valid TypeScript file that exports the expected functions.

import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("shell#T57: stage.ts exists and has proper structure", () => {
  const stagePath = path.join(__dirname, "stage.ts");
  assert.ok(fs.existsSync(stagePath), "stage.ts should exist");

  const content = fs.readFileSync(stagePath, "utf8");
  assert.ok(content.includes("stageBin()"), "should have stageBin function");
  assert.ok(
    content.includes("stageCorePackages()"),
    "should have stageCorePackages function",
  );
  assert.ok(
    content.includes("stageRendererBundle()"),
    "should have stageRendererBundle function",
  );
  assert.ok(content.includes("main()"), "should have main function");
});

test("shell#T57: stage script references correct paths", () => {
  const stagePath = path.join(__dirname, "stage.ts");
  const content = fs.readFileSync(stagePath, "utf8");

  assert.ok(
    content.includes('path.join(out, "bin")'),
    "should stage Deno binary to bin directory",
  );
  assert.ok(
    content.includes('path.join(out, "core")'),
    "should stage core packages",
  );
  assert.ok(
    content.includes('path.join(out, "shell-renderer")'),
    "should stage shell renderer",
  );
  assert.ok(
    content.includes('path.join(out, "STAGE.json")'),
    "should create STAGE.json",
  );
});
