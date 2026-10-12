import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";

import {
  type CallerContents,
  type CallerFrame,
  checkCaller,
  checkInput,
  ContentsRegistry,
  guardIpc,
  type IpcEvent,
  MAX_IPC_BYTES,
} from "./ipc-guard.ts";

const origin = { scheme: "lophn-shell", host: "desktop", path: "/index.html" };

function frame(url: string, parent: CallerFrame | null = null): CallerFrame {
  return { url, parent };
}

function contents(id: number, url: string, destroyed = false): CallerContents {
  const main = frame(url);
  return { id, isDestroyed: () => destroyed, mainFrame: main };
}

function event(
  sender: CallerContents,
  senderFrame: CallerFrame | null,
): IpcEvent {
  return { sender, senderFrame };
}

const schema = z.object({ name: z.string().max(32) }).strict();

function registered(sender: CallerContents): ContentsRegistry {
  const registry = new ContentsRegistry();
  registry.register({ contents: sender, origin });
  return registry;
}

test("shell/app-frame#R23: 등록된 살아 있는 main frame만 IPC를 통과한다", () => {
  const sender = contents(1, "lophn-shell://desktop/index.html");
  const registry = registered(sender);
  const ok = checkCaller(registry, event(sender, sender.mainFrame));
  assert.equal(ok.ok, true);

  const dead = contents(1, "lophn-shell://desktop/index.html", true);
  registry.register({ contents: dead, origin });
  const gone = checkCaller(registry, event(dead, dead.mainFrame));
  assert.equal(gone.ok, false);
  if (!gone.ok) assert.equal(gone.error.code, "forbidden");
});

test("shell/app-frame#R4: subframe과 다른 origin의 sender는 거절한다", () => {
  const sender = contents(1, "lophn-shell://desktop/index.html");
  const registry = registered(sender);
  const child = frame("lophn-shell://desktop/index.html", sender.mainFrame);
  const sub = checkCaller(registry, event(sender, child));
  assert.equal(sub.ok, false);

  const foreign = frame("https://evil.example/index.html");
  const other = checkCaller(registry, event(sender, foreign));
  assert.equal(other.ok, false);
  if (!other.ok) assert.equal(other.error.code, "forbidden");

  const unknown = contents(2, "lophn-shell://desktop/index.html");
  const stranger = checkCaller(registry, event(unknown, unknown.mainFrame));
  assert.equal(stranger.ok, false);
});

test("shell/app-frame#R23: scheme·host·path를 각각 비교하고 prefix만으로 믿지 않는다", () => {
  const sender = contents(1, "lophn-shell://desktop/index.html.evil");
  const registry = registered(sender);
  const spoofed = checkCaller(registry, event(sender, sender.mainFrame));
  assert.equal(spoofed.ok, false);

  const otherHost = contents(1, "lophn-shell://other/index.html");
  const host = checkCaller(registry, event(otherHost, otherHost.mainFrame));
  assert.equal(host.ok, false);
});

test("shell/app-frame#R23: 모르는 필드와 64 KiB를 넘는 입력은 거절한다", () => {
  const extra = checkInput(schema, { name: "ok", token: "secret" });
  assert.equal(extra.ok, false);
  if (!extra.ok) assert.equal(extra.error.code, "invalid_input");

  const big = checkInput(schema, { name: "x".repeat(MAX_IPC_BYTES) });
  assert.equal(big.ok, false);

  const fine = checkInput(schema, { name: "Launcher" });
  assert.equal(fine.ok, true);
  if (fine.ok) assert.equal(fine.value.name, "Launcher");
});

test("shell/desktop#R16: guard는 caller와 입력을 함께 검사한다", () => {
  const sender = contents(1, "lophn-shell://desktop/index.html");
  const registry = registered(sender);
  const passed = guardIpc(registry, event(sender, sender.mainFrame), schema, {
    name: "Docs",
  });
  assert.equal(passed.ok, true);

  const refused = guardIpc(
    registry,
    event(sender, frame("lophn-shell://desktop/index.html", sender.mainFrame)),
    schema,
    { name: "Docs" },
  );
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.code, "forbidden");
});
