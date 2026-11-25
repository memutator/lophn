import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolResult } from "../../../protocol/lophn-agent/mod.ts";
import type { ToolCallRequest, ToolDone, ToolInfo } from "./ports.ts";
import { type BatchControl, runToolBatch } from "./tool-batch.ts";

function resultOf(status: ToolResult["status"], summary: string): ToolResult {
  return {
    status,
    summary,
    content: null,
    complete: true,
    source: null,
    continuation: null,
    pending: [],
  };
}

function makeControl(
  infos: Record<string, ToolInfo>,
  attempt: (request: ToolCallRequest) => Promise<ToolDone>,
): { control: BatchControl; attempted: string[] } {
  let seq = 0;
  const attempted: string[] = [];
  const control: BatchControl = {
    modelCall: "mcl_1",
    gate: async () => null,
    refuse: () => null,
    signalFor: () => ({
      signal: new AbortController().signal,
      release: () => {},
    }),
    wait: async () => "elapsed",
    random: () => 0,
    graceMs: 1000,
    pause: { begin: () => {}, end: () => {} },
    tools: {
      names: () => Object.keys(infos),
      info: (name) => infos[name],
      attempt: async (request) => {
        attempted.push(request.key);
        return await attempt(request);
      },
      close: async (_request, closed) => ({
        tool_call: `tcl_${++seq}`,
        status: closed.status,
        code: closed.code,
        result: resultOf(closed.status, closed.summary),
      }),
    },
  };
  return { control, attempted };
}

const INFOS: Record<string, ToolInfo> = {
  "file.write": { effect: "write", server: null },
  "shell.run": { effect: "external", server: null },
  "file.read": { effect: "read", server: null },
};

// 이유 없는 거절은 같은 응답의 남은 쓰기·바깥 호출을 멈추되, 읽기 호출은 막지 않고 stoppedByRejection을 세운다.
test("이유 없는 거절은 남은 쓰기·외부 호출을 멈추고 읽기는 계속 실행한다", async () => {
  const { control, attempted } = makeControl(INFOS, async (request) => {
    if (request.key === "c1") {
      return {
        tool_call: "tcl_1",
        status: "not_executed",
        code: "rejected",
        result: resultOf("not_executed", "The person rejected this call."),
        rejectedWithReason: false,
      };
    }
    return {
      tool_call: `tcl_${request.key}`,
      status: "success",
      code: "ok",
      result: resultOf("success", "done"),
    };
  });

  const outcome = await runToolBatch(control, [
    { id: "c1", name: "file.write", args: '{"path":"a.txt"}' },
    { id: "c2", name: "file.read", args: '{"path":"b.txt"}' },
    { id: "c3", name: "shell.run", args: '{"command":"echo hi"}' },
    { id: "c4", name: "file.write", args: '{"path":"c.txt"}' },
  ]);

  assert.equal(outcome.stoppedByRejection, true);
  assert.deepStrictEqual(attempted, ["c1", "c2"]);
  assert.equal(outcome.results[0]?.code, "rejected");
  assert.equal(outcome.results[1]?.status, "success");
  assert.equal(outcome.results[2]?.status, "not_executed");
  assert.equal(outcome.results[2]?.code, "earlier_call_rejected");
  assert.equal(outcome.results[3]?.status, "not_executed");
  assert.equal(outcome.results[3]?.code, "earlier_call_rejected");
});

// 이유 있는 거절은 그 이유를 model에 돌려주고 같은 응답의 남은 쓰기·외부 호출을 그대로 이어 간다.
test("이유 있는 거절은 남은 쓰기·외부 호출을 막지 않고 계속 실행한다", async () => {
  const { control, attempted } = makeControl(INFOS, async (request) => {
    if (request.key === "c1") {
      return {
        tool_call: "tcl_1",
        status: "not_executed",
        code: "rejected",
        result: resultOf(
          "not_executed",
          "The person rejected this call: use a different filename",
        ),
        rejectedWithReason: true,
      };
    }
    return {
      tool_call: `tcl_${request.key}`,
      status: "success",
      code: "ok",
      result: resultOf("success", "done"),
    };
  });

  const outcome = await runToolBatch(control, [
    { id: "c1", name: "file.write", args: '{"path":"a.txt"}' },
    { id: "c2", name: "shell.run", args: '{"command":"echo hi"}' },
  ]);

  assert.equal(outcome.stoppedByRejection, false);
  assert.deepStrictEqual(attempted, ["c1", "c2"]);
  assert.equal(outcome.results[0]?.code, "rejected");
  assert.equal(outcome.results[0]?.rejectedWithReason, true);
  assert.equal(outcome.results[1]?.status, "success");
});
