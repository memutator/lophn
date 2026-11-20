import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createFileHookOptOut,
  createHookInstaller,
  type HookInstallResultNotice,
} from "./hook-install.ts";

test("ensureOnce installs missing hooks automatically without asking and reports result", async () => {
  const calls: string[][] = [];
  const results: HookInstallResultNotice[] = [];
  let changed = 0;

  const installer = createHookInstaller({
    hasHook: () => true,
    onResult: (r) => results.push(r),
    changed: () => {
      changed += 1;
    },
    runCli: async (args) => {
      calls.push(args);
      const input = JSON.parse(args[3]!) as { dry_run?: boolean };
      return {
        ok: true,
        data: {
          skill: "not_supported",
          hook: input.dry_run ? "missing" : "installed",
          files: ["/home/u/.claude/settings.json"],
        },
      };
    },
  });

  await installer.ensureRegistered("claude", "term_1");
  assert.equal(calls.length, 2);
  assert.equal(changed, 1);
  assert.deepEqual(results, [
    {
      harness: "claude",
      ok: true,
      files: ["/home/u/.claude/settings.json"],
      running: true,
      terminal: "term_1",
    },
  ]);
});

test("uninstall persists opt-out so future runs skip auto-install until manual install", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lophn-hook-optout-"));
  try {
    const file = join(dir, "hooks-opt-out.json");
    const calls: string[][] = [];
    const runCli = async (args: readonly string[]) => {
      calls.push([...args]);
      if (args[1] === "uninstall") {
        return { ok: true as const, data: { hook: "removed", files: [] } };
      }
      const input = JSON.parse(args[3]!) as { dry_run?: boolean };
      return {
        ok: true as const,
        data: {
          skill: "not_supported",
          hook: input.dry_run ? "missing" : "installed",
          files: ["/home/u/.claude/settings.json"],
        },
      };
    };

    const first = createHookInstaller({
      hasHook: () => true,
      optOut: createFileHookOptOut(file),
      runCli,
    });
    const removed = await first.uninstall("claude");
    assert.equal(removed.status, "missing");

    // Simulate a new core process loading the persisted opt-out file.
    calls.length = 0;
    const second = createHookInstaller({
      hasHook: () => true,
      optOut: createFileHookOptOut(file),
      runCli,
    });
    second.ensureOnce("claude", "term_2");
    await second.ensureRegistered("claude", "term_2");
    assert.equal(calls.length, 0);

    // Explicit install from Settings clears opt-out.
    const installed = await second.install("claude");
    assert.equal(installed.status, "installed");
    assert.equal(createFileHookOptOut(file).has("claude"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
