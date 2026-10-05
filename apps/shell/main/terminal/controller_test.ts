// shell/terminal#R3, R8: terminal channel의 ipcMain 등록, registry 검사를
// Node 테스트로 본다. ipcMain은 대역을 끼우고, 실제 Electron 창은 T25가 붙인다.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TERMINAL_CLOSE_CHANNEL,
  TERMINAL_INPUT_CHANNEL,
  TERMINAL_OPEN_CHANNEL,
  TERMINAL_RESIZE_CHANNEL,
  TERMINAL_RESTART_CHANNEL,
  TERMINAL_SNAPSHOT_CHANNEL,
} from "../../ipc/terminal.ts";
import {
  attachTerminalSurface,
  type MainIpc,
  registerTerminalIpc,
  removeTerminalIpc,
} from "./controller.ts";
import {
  type CallerContents,
  type CallerFrame,
  ContentsRegistry,
  type IpcEvent,
} from "../desktop/ipc-guard.ts";
import { createTerminalIpc } from "./ipc.ts";

const origin = { scheme: "lophn-shell", host: "desktop", path: "/index.html" };

function frame(url: string, parent: CallerFrame | null = null): CallerFrame {
  return { url, parent };
}

function contents(id: number, url: string): CallerContents {
  const main = frame(url);
  return { id, isDestroyed: () => false, mainFrame: main };
}

function event(sender: CallerContents): IpcEvent {
  return { sender, senderFrame: sender.mainFrame };
}

function harness(focused: boolean) {
  const registry = new ContentsRegistry();
  const handles = new Map<
    string,
    (event: unknown, input: unknown) => Promise<unknown>
  >();
  const removed: string[] = [];
  const register: MainIpc = {
    handle(channel, listener) {
      handles.set(channel, listener);
    },
    removeHandler(channel) {
      removed.push(channel);
      handles.delete(channel);
    },
  };
  const sent: unknown[] = [];
  const ipc = createTerminalIpc({
    registry,
    focus: { focused: () => focused },
    folders: {
      folders: () =>
        Promise.resolve([{ folder_ref: "fld_a", path: "/work/a" }]),
    },
    host: {
      request: async (message) => {
        sent.push(message);
        return await Promise.resolve({
          ok: true as const,
          runtime: {
            terminal_ref: "term_1",
            project: "prj_1",
            folder_ref: "fld_a",
            cwd_at_start: "/work/a",
            program_path: "/bin/bash",
            launch_kind: "shell" as const,
            state: "running" as const,
            generation: 1,
            columns: 80,
            rows: 24,
            exit_code: null,
            failure_reason: null,
            output_seq: 0,
            dropped_output: false,
          },
        });
      },
    },
  });
  registerTerminalIpc(register, ipc);
  return { registry, handles, sent, removed, ipc };
}

test("shell/terminal#R3: 등록된 main frame의 terminal input만 channel 등록을 통과한다", async () => {
  const gate = harness(true);
  const sender = contents(1, "lophn-shell://desktop/index.html");
  gate.registry.register({ contents: sender, origin });
  const listener = gate.handles.get(TERMINAL_INPUT_CHANNEL);
  assert.ok(listener);
  const reply = await listener(event(sender), {
    terminal_ref: "term_1",
    generation: 1,
    text: "ls\n",
  });
  assert.equal((reply as { ok: boolean }).ok, true);
  assert.equal(gate.sent.length, 1);
});

test("shell/terminal#R3: focus가 없는 터미널의 input은 channel에서 거절한다", async () => {
  const gate = harness(false);
  const sender = contents(1, "lophn-shell://desktop/index.html");
  gate.registry.register({ contents: sender, origin });
  const listener = gate.handles.get(TERMINAL_INPUT_CHANNEL);
  assert.ok(listener);
  const reply = await listener(event(sender), {
    terminal_ref: "term_1",
    generation: 1,
    text: "ls\n",
  });
  assert.equal((reply as { ok: boolean }).ok, true);
  if (!(reply as { ok: boolean }).ok) return;
  const value = (reply as { ok: true; value: { ok: boolean } }).value;
  assert.equal(value.ok, false);
  assert.equal(gate.sent.length, 0);
});

test("shell/terminal#R3: 등록되지 않은 sender의 terminal open은 거절한다", async () => {
  const gate = harness(true);
  const stranger = contents(9, "https://example.test/");
  const listener = gate.handles.get(TERMINAL_OPEN_CHANNEL);
  assert.ok(listener);
  const reply = await listener(event(stranger), { project: "prj_1" });
  assert.equal((reply as { ok: boolean }).ok, false);
  assert.equal(gate.sent.length, 0);
});

test("shell/terminal#R3: channel을 등록하면 여섯 개다", () => {
  const gate = harness(true);
  assert.deepEqual([...gate.handles.keys()].sort(), [
    TERMINAL_CLOSE_CHANNEL,
    TERMINAL_INPUT_CHANNEL,
    TERMINAL_OPEN_CHANNEL,
    TERMINAL_RESIZE_CHANNEL,
    TERMINAL_RESTART_CHANNEL,
    TERMINAL_SNAPSHOT_CHANNEL,
  ]);
});

test("shell/terminal#R3: remove는 여섯 channel을 뺀다", () => {
  const gate = harness(true);
  removeTerminalIpc({
    handle: () => {},
    removeHandler: (channel) => {
      gate.handles.delete(channel);
      gate.removed.push(channel);
    },
  });
  assert.equal(gate.handles.size, 0);
  assert.equal(gate.removed.length, 6);
});

test("shell/terminal#R3: attach는 desktop renderer를 registry에 넣고 닫힐 때 뺀다", () => {
  const registry = new ContentsRegistry();
  const sender = contents(2, "lophn-shell://desktop/index.html");
  let closed: (() => void) | undefined;
  const window = {
    once: (event: string, listener: () => void) => {
      if (event === "closed") closed = listener;
    },
    webContents: sender,
  };
  attachTerminalSurface(registry, window as never);
  const caller = registry.find(sender.id);
  assert.ok(caller);
  closed?.();
  assert.equal(registry.find(sender.id), undefined);
});
