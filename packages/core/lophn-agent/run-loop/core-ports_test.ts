import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { err, ok } from "../../../base/mod.ts";
import { routePath } from "../../../protocol/base/mod.ts";
import {
  finishToolCall,
  recordToolRequest,
  TURN_BLOB_PURPOSES,
  turnRead,
} from "../../../protocol/lophn-agent/mod.ts";
import { defineTool } from "../tools/define.ts";
import { createCorePorts } from "./core-ports.ts";

test("when StartModelCall fails the steering stays queued and the model is not called", async () => {
  let invoked = 0;
  let settled = 0;
  const ports = createCorePorts({
    seat: { turn: "trn_t1", session: "ses_s1" },
    clock: { now: () => "2026-11-06T00:00:00.000Z", nowMs: () => 0 },
    ids: { newId: (prefix: string) => `${prefix}_x` },
    // StartModelCall만 거절한다.
    machine: () =>
      Promise.resolve(err({ code: "unavailable", message: "no ledger" })),
    blobs: {
      prepare: (_purpose: string, bytes: Uint8Array) =>
        Promise.resolve(ok({ hash: "h".repeat(64), size_bytes: bytes.length })),
    },
    redact: (text: string) => text,
    model: {
      call: {},
      endpoint: "",
      usageRevision: "1",
      invoke: () => {
        invoked += 1;
        return Promise.resolve(
          err({ code: "internal", message: "unreachable" }),
        );
      },
    },
    turnInputs: {
      settled: () => {
        settled += 1;
        return Promise.resolve(ok(undefined));
      },
    },
    tools: { listed: [] },
    events: { publish() {}, output() {} },
  } as never);

  const result = await ports.model.call(
    {
      prompt: {
        basis: {},
        diff: null,
        cache_boundaries: [],
        input_budget: 1,
        measured_tokens: null,
      },
      body: { messages: [] },
      applied: ["msg_steer"],
      kind: "initial",
      retry_of: null,
    } as never,
    new AbortController().signal,
  );
  assert.equal(result.ok, false);
  assert.equal(invoked, 0);
  assert.equal(settled, 0);
});

// tool call 하나를 실제 core-ports로 돌린다. core의 finish route만 `rejectFinish`가 거절할 수 있다.
async function attemptProbe(options: {
  result: unknown;
  failOutputBlob?: boolean;
  effect?: "read" | "write";
  failRequest?: boolean;
  rejectFinish?: (input: Record<string, unknown>) => boolean;
}) {
  const finishes: { input: Record<string, unknown>; accepted: boolean }[] = [];
  const turnRecord = {
    turn: {
      id: "trn_00000000000000000000000000",
      session: "ses_00000000000000000000000000",
      input_message: "msg_00000000000000000000000000",
      state: "running",
      basis: "a".repeat(64),
      started_at: "2026-11-06T00:00:00.000Z",
      limits: { model_attempts: null, stall_ms: 300_000 },
      mode: "attended",
      elapsed: { active_ms: 0, stall_ms: 0, checkpoint_at: null },
      finished_at: null,
      outcome: null,
      result: null,
      state_seq: "1",
    },
    as_of_seq: "1",
    next_cursor: null,
  };
  let ran = 0;
  const machine = (path: string, body: unknown) => {
    const input = (body as { input: Record<string, unknown> }).input;
    if (options.failRequest === true && path === routePath(recordToolRequest)) {
      return Promise.resolve(
        err({ code: "unavailable", message: "disk full" }),
      );
    }
    if (path === routePath(turnRead)) return Promise.resolve(ok(turnRecord));
    if (path === routePath(finishToolCall)) {
      const rejected = options.rejectFinish?.(input) === true;
      finishes.push({ input, accepted: !rejected });
      return Promise.resolve(
        rejected
          ? err({ code: "invalid_input", message: "json too deep" })
          : ok({ tool_call: input["tool_call"], outcome: input["outcome"] }),
      );
    }
    // route마다 출력 schema가 달라 command 응답을 그 모양으로 낸다.
    return Promise.resolve(
      ok({
        tool_call: input["tool_call"] ?? input["id"],
        idempotency_key: input["tool_call"],
        decision: "allow",
      }),
    );
  };
  const probe = defineTool({
    name: "probe.read",
    description: "probe",
    effect: options.effect ?? "read",
    input: z.strictObject({}),
    routes: [],
    handler: () => {
      ran += 1;
      return Promise.resolve(ok(options.result as never));
    },
  });
  const ports = createCorePorts({
    seat: {
      turn: "trn_00000000000000000000000000",
      session: "ses_00000000000000000000000000",
    },
    clock: { now: () => "2026-11-06T00:00:00.000Z", nowMs: () => 0 },
    ids: { newId: (prefix: string) => `${prefix}_00000000000000000000000001` },
    machine,
    blobs: {
      prepare: (purpose: string, bytes: Uint8Array) =>
        options.failOutputBlob === true &&
        purpose === TURN_BLOB_PURPOSES.tool_call_output
          ? Promise.resolve(err({ code: "unavailable", message: "busy" }))
          : Promise.resolve(
              ok({ hash: "h".repeat(64), size_bytes: bytes.length }),
            ),
    },
    redact: (text: string) => text,
    model: {},
    tools: {
      listed: [probe],
      context: () =>
        ({
          listed: [probe],
          gate: { check: () => Promise.resolve(ok({ kind: "run" })) },
          questions: { ask: () => Promise.resolve(ok([])) },
        }) as never,
    },
    events: { publish() {}, output() {} },
  } as never);
  const done = await ports.tools.attempt(
    {
      model_call: "mcl_00000000000000000000000001",
      key: "call_1",
      order: 0,
      name: "probe_read",
      input: {},
      attempt: 0,
      retry_of: null,
    },
    new AbortController().signal,
    { begin() {}, end() {} },
  );
  return { done, finishes, ran: () => ran };
}

const success = (extra: Record<string, unknown> = {}) => ({
  status: "success" as const,
  summary: "ok",
  content: null,
  complete: true,
  source: null,
  continuation: null,
  pending: [],
  ...extra,
});

// 진입한 tool call의 행은 어떤 실패에도 finished로 닫힌다(ledger 정합). 끝나지 않은 행은 ACP 화면에 영원히
// 실행 중으로 남았다.
test("a tool call whose result blob cannot be stored is still finished as uncertain", async () => {
  const { done, finishes } = await attemptProbe({
    result: success(),
    failOutputBlob: true,
  });

  assert.equal(done.status, "uncertain");
  assert.equal(finishes.length, 1);
  assert.deepEqual(finishes[0].input["outcome"], {
    kind: "uncertain",
    code: "uncertain",
  });
});

// image.read(base64 5 MiB), web.fetch(긴 URL summary·256 KiB page), settings.get(깊이 25 schema)의 result는 core의
// finish 본문 한도에 걸려 거절됐고, 같은 입력의 retry도 거절돼 행 둘이 started로 남았다.
test("a result the finish route rejects is recorded in compact form and the call still succeeds", async () => {
  const deep = Array.from({ length: 20 }).reduce<unknown>(
    (inner) => ({ inner }),
    "leaf",
  );
  const { done, finishes } = await attemptProbe({
    result: success({
      summary: `fetched https://example.com/${"a".repeat(500)}`,
      content: {
        image: { media_type: "image/png", data_base64: "AAAA" },
        deep,
      },
    }),
    // 깊이 16과 summary 400자를 넘는 본문은 core가 invalid_input으로 거절한다.
    rejectFinish: (input) => {
      const result = input["result"] as { summary: string; content: unknown };
      return (
        result.summary.length > 400 ||
        JSON.stringify(result.content).includes("leaf")
      );
    },
  });

  assert.equal(done.status, "success");
  assert.equal(finishes.length, 2);
  assert.equal(finishes[1].accepted, true);
  assert.deepEqual(finishes[1].input["outcome"], {
    kind: "success",
    code: "ok",
  });
  const record = finishes[1].input["result"] as {
    summary: string;
    content: unknown;
  };
  assert.ok(record.summary.length <= 400);
  // 이미지는 개수만 남아 context 추정이 그대로다.
  assert.deepEqual(record.content, {
    image: { media_type: "image/png", data_base64: "" },
  });
});

// 기록 없이 돈 쓰기는 rewind 기록도 남지 않는다. 읽기는 기록을 못 해도 돈다.
test("a write tool call whose request cannot be recorded does not run but a read tool does", async () => {
  const write = await attemptProbe({
    result: success(),
    effect: "write",
    failRequest: true,
  });
  assert.equal(write.ran(), 0);
  assert.equal(write.done.status, "not_executed");
  assert.equal(write.done.code, "unrecorded");

  const read = await attemptProbe({ result: success(), failRequest: true });
  assert.equal(read.ran(), 1);
  assert.equal(read.done.status, "success");
});
