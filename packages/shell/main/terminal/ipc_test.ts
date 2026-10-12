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
    focus: { focused: () => focused, focus() {}, blur() {} },
    folders: {
      folders: () =>
        Promise.resolve([{ folder_ref: "fld_a", path: "/work/a" }]),
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
    confirmClose: () => Promise.resolve(true),
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
  const { sender, sent } = setup(true);
  const holding = createTerminalIpc({
    registry: (() => {
      const registry = new ContentsRegistry();
      registry.register({ contents: sender, origin });
      return registry;
    })(),
    focus: { focused: () => true, focus() {}, blur() {} },
    folders: { folders: () => Promise.resolve([]) },
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
    confirmClose: () => Promise.resolve(false),
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

test("shell/terminal#R1: 여러 등록 폴더면 시작하지 않고 고를 목록을 돌려준다", async () => {
  const sender = contents(1, "lophn-shell://desktop/index.html");
  const registry = new ContentsRegistry();
  registry.register({ contents: sender, origin });
  const ipc = createTerminalIpc({
    registry,
    focus: { focused: () => true, focus() {}, blur() {} },
    folders: {
      folders: () =>
        Promise.resolve([
          { folder_ref: "prj_1_0", path: "/work/a" },
          { folder_ref: "prj_1_1", path: "/work/b" },
        ]),
    },
    host: {
      request: () =>
        Promise.resolve({
          ok: false,
          reason: "choose_folder",
          message: "choose a registered folder before start",
        }),
    },
  });
  const reply = await ipc.open(event(sender), { project: "prj_1" });
  assert.equal(reply.ok, true);
  if (!reply.ok || reply.value.ok) return;
  assert.equal(reply.value.reason, "choose_folder");
  assert.deepEqual(reply.value.folders?.map((folder) => folder.folder_ref), [
    "prj_1_0",
    "prj_1_1",
  ]);
});

test("shell/terminal#R3: focus 알림은 main frame에서만 표에 적힌다", async () => {
  const sender = contents(1, "lophn-shell://desktop/index.html");
  const registry = new ContentsRegistry();
  registry.register({ contents: sender, origin });
  const marks: string[] = [];
  const ipc = createTerminalIpc({
    registry,
    focus: {
      focused: () => false,
      focus: (id, ref, generation) => {
        marks.push(`focus ${id} ${ref} ${generation}`);
      },
      blur: (id, ref) => {
        marks.push(`blur ${id} ${ref}`);
      },
    },
    folders: { folders: () => Promise.resolve([]) },
    host: {
      request: () =>
        Promise.resolve({ ok: false, reason: "host_lost", message: "no" }),
    },
  });
  const input = { terminal_ref: "term_1", generation: 2, focused: true };
  assert.equal((await ipc.focus(event(sender), input)).ok, true);
  assert.equal(
    (await ipc.focus(event(sender), { ...input, focused: false })).ok,
    true,
  );
  const child = frame("lophn-shell://desktop/index.html", sender.mainFrame);
  const refused = await ipc.focus({ sender, senderFrame: child }, input);
  assert.equal(refused.ok, false);
  assert.deepEqual(marks, ["focus 1 term_1 2", "blur 1 term_1"]);
});

test("shell/terminal#R8: snapshot은 after_seq를 host에 넘긴다", async () => {
  const { sender, ipc, sent } = setup(true);
  await ipc.snapshot(event(sender), { terminal_ref: "term_1", after_seq: 4 });
  assert.deepEqual(sent[0], {
    type: "snapshot",
    terminal_ref: "term_1",
    after_seq: 4,
  });
});
