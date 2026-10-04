import assert from "node:assert/strict";
import { test } from "node:test";

import type { TerminalReply } from "../../ipc/terminal.ts";
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

function setup(focused: boolean) {
  const sender = contents(1, "lophn-shell://desktop/index.html");
  const registry = new ContentsRegistry();
  registry.register({ contents: sender, origin });
  const sent: unknown[] = [];
  const ipc = createTerminalIpc({
    registry,
    focus: { focused: () => focused },
    folders: {
      folders: async () => [{ folder_ref: "fld_a", path: "/work/a" }],
    },
    host: {
      request: async (message) => {
        sent.push(message);
        const reply: TerminalReply = {
          ok: true,
          runtime: {
            terminal_ref: "term_1",
            project: "prj_1",
            folder_ref: "fld_a",
            cwd_at_start: "/work/a",
            program_path: "/bin/bash",
            launch_kind: "shell",
            state: "running",
            generation: 1,
            columns: 80,
            rows: 24,
            exit_code: null,
            failure_reason: null,
            output_seq: 0,
            dropped_output: false,
          },
        };
        return await Promise.resolve(reply);
      },
    },
    confirmClose: async () => true,
  });
  return { sender, ipc, sent };
}

test("shell/terminal#R3: focus가 없는 터미널에는 입력을 보내지 않는다", async () => {
  const { sender, ipc, sent } = setup(false);
  const reply = await ipc.input(event(sender), {
    terminal_ref: "term_1",
    generation: 1,
    text: "ls\n",
  });
  assert.equal(reply.ok, true);
  if (!reply.ok) return;
  assert.equal(reply.value.ok, false);
  assert.equal(sent.length, 0);
});

test("shell/terminal#R3: focus가 있는 main frame의 입력만 host로 간다", async () => {
  const { sender, ipc, sent } = setup(true);
  const reply = await ipc.input(event(sender), {
    terminal_ref: "term_1",
    generation: 1,
    text: "ls\n",
  });
  assert.equal(reply.ok, true);
  assert.equal(sent.length, 1);
});

test("shell/terminal#R1: open은 등록 폴더 목록을 host에 넘기고 renderer 경로를 믿지 않는다", async () => {
  const { sender, ipc, sent } = setup(true);
  await ipc.open(event(sender), { project: "prj_1" });
  const message = sent[0] as { folders: { path: string }[]; type: string };
  assert.equal(message.type, "open");
  assert.equal(message.folders[0]?.path, "/work/a");
});

test("shell/app-frame#R4: subframe sender의 terminal IPC는 거절한다", async () => {
  const { sender, ipc } = setup(true);
  const child = frame("lophn-shell://desktop/index.html", sender.mainFrame);
  const reply = await ipc.open(
    { sender, senderFrame: child },
    { project: "prj_1" },
  );
  assert.equal(reply.ok, false);
});

test("shell/terminal#R10: 닫기 확인을 취소하면 host에 close를 보내지 않는다", async () => {
  const { sender, ipc, sent } = setup(true);
  const holding = createTerminalIpc({
    registry: (() => {
      const registry = new ContentsRegistry();
      registry.register({ contents: sender, origin });
      return registry;
    })(),
    focus: { focused: () => true },
    folders: { folders: async () => [] },
    host: {
      request: async (message) => {
        sent.push(message);
        return await Promise.resolve({
          ok: false,
          reason: "host_lost",
          message: "no",
        });
      },
    },
    confirmClose: async () => false,
  });
  const reply = await holding.close(event(sender), {
    terminal_ref: "term_1",
    generation: 1,
  });
  assert.equal(reply.ok, true);
  if (!reply.ok) return;
  assert.equal(reply.value.ok, false);
  if (reply.value.ok) return;
  assert.equal(reply.value.message, "close cancelled");
  assert.equal(
    sent.some((item) => (item as { type?: string }).type === "close"),
    false,
  );
});
