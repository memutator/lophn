import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  TerminalAgent,
  TerminalRuntime,
} from "../../../protocol/coding-agent/terminals.ts";
import { TerminalStore } from "./store.ts";

const runtime = (agent: TerminalAgent): TerminalRuntime => ({
  terminal_ref: "trm_1",
  project: "prj_1",
  folder_ref: "fld_1",
  cwd_at_start: "/tmp",
  program_path: "/bin/bash",
  state: "running",
  generation: 1,
  columns: 80,
  rows: 24,
  exit_code: null,
  failure_reason: null,
  output_seq: 0,
  dropped_output: false,
  agent,
});

// Claude의 SessionStart hook이 1초 foreground 훑기보다 먼저 오면 foreground만 다른 push가 뒤따른다.
// 그것을 버리면 첫 메시지 전까지 GUI로 바꾸는 단추가 "foreground가 아니다"로 막혔다.
test("foreground나 이름만 바뀐 agent push도 반영한다", () => {
  const store = new TerminalStore(null, null);
  store.remember("tab", "trm_1");
  const hooked: TerminalAgent = {
    harness: "claude",
    state: "idle",
    hooked: true,
    session: "s1",
  };
  store.noteRuntime(runtime(hooked));
  store.noteRuntime(runtime({ ...hooked, foreground: true }));
  assert.equal(store.agentOf("tab")?.foreground, true);
  store.noteRuntime(runtime({ ...hooked, foreground: true, name: "research" }));
  assert.equal(store.agentOf("tab")?.name, "research");
});

// GUI 탭은 xterm이 서지 않아 항목의 generation이 0에 머문다(core가 연 탭) 하거나 항목이 아예 없다(다시 켠 앱).
// 그래도 core가 알린 runtime의 generation으로 focus를 보고해야 못 본 끝의 점이 꺼진다.
const AGENT: TerminalAgent = {
  harness: "claude",
  state: "idle",
  hooked: true,
};

test("generationOf는 adopt한 0과 layout만 읽은 탭도 runtime의 generation을 따른다", () => {
  const store = new TerminalStore(null, null);
  store.adopt("adopted", {
    terminalRef: "trm_1",
    generation: 0,
    folderRef: null,
  });
  store.remember("restored", "trm_2");
  assert.equal(store.generationOf("adopted"), 0);
  assert.equal(store.generationOf("restored"), 0);
  const seen: number[] = [];
  store.subscribe(() => seen.push(store.version()));
  store.noteRuntime(runtime(AGENT));
  store.noteRuntime({
    ...runtime(AGENT),
    terminal_ref: "trm_2",
    generation: 3,
  });
  assert.equal(store.generationOf("adopted"), 1);
  assert.equal(store.generationOf("restored"), 3);
  assert.equal(store.refOf("restored"), "trm_2");
  assert.ok(seen.length >= 2);
});
