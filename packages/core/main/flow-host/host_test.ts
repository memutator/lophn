import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { manualClock, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { RunRecord } from "../../../protocol/runs/mod.ts";
import {
  FLOW_SDK_NAME,
  FLOW_SDK_VERSION,
  type FlowHostMessage,
  type FlowRequest,
  flowStartMessageSchema,
} from "../../../protocol/workflows/flow-wire.ts";
import type { WorkflowCheckpoint } from "../../../protocol/workflows/instances.ts";
import type {
  Spawned,
  SpawnedPipe,
} from "../../supervision/responsiveness/process.ts";
import { createFlowEventRegistry } from "../../workflows/event-subscriptions.ts";
import {
  createFlowHost,
  type FlowHostWorkflows,
  flowCommand,
  startMessage,
} from "./host.ts";

const INSTANCE = "wfi_01arz3ndektsv4rrffq69g5fav" as Id<"wfi">;
const PROJECT = "prj_01arz3ndektsv4rrffq69g5faw" as Id<"prj">;
const APP_ID = "app_01arz3ndektsv4rrffq69g5fax" as Id<"app">;
const SESSION = "ses_01arz3ndektsv4rrffq69g5fay" as Id<"ses">;
const AT = "2026-11-23T12:00:00.000Z";

function createInMemoryByteSource() {
  const queue: Uint8Array[] = [];
  let notify: (() => void) | null = null;
  let closed = false;
  const encoder = new TextEncoder();

  const source: SpawnedPipe = {
    async read(buffer: Uint8Array): Promise<number | null> {
      for (;;) {
        if (queue.length > 0) {
          const head = queue[0]!;
          if (head.byteLength <= buffer.byteLength) {
            queue.shift();
            buffer.set(head, 0);
            return head.byteLength;
          }
          buffer.set(head.subarray(0, buffer.byteLength), 0);
          queue[0] = head.subarray(buffer.byteLength);
          return buffer.byteLength;
        }
        if (closed) return null;
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
    },
    cancel() {
      closed = true;
      notify?.();
      notify = null;
    },
    get bufferedBytes() {
      return queue.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    },
  };

  return {
    source,
    pushLine(line: string) {
      if (closed) return;
      queue.push(encoder.encode(`${line}\n`));
      notify?.();
      notify = null;
    },
    close() {
      if (closed) return;
      closed = true;
      notify?.();
      notify = null;
    },
  };
}

function createFakeSpawned() {
  const stdout = createInMemoryByteSource();
  const stderr = createInMemoryByteSource();
  const decoder = new TextDecoder();
  let stdinBuf = "";
  const inbox: FlowHostMessage[] = [];
  const waiters: Array<() => void> = [];
  let resolveExit!: (code: number | null) => void;
  let exitDone = false;
  const exited = new Promise<number | null>((resolve) => {
    resolveExit = resolve;
  });

  const finish = (code: number | null) => {
    if (exitDone) return;
    exitDone = true;
    stdout.close();
    stderr.close();
    resolveExit(code);
  };

  const child: Spawned = {
    pid: 12345,
    stdout: stdout.source,
    stderr: stderr.source,
    stdin: {
      write(bytes: Uint8Array) {
        stdinBuf += decoder.decode(bytes, { stream: true });
        for (
          let i = stdinBuf.indexOf("\n");
          i >= 0;
          i = stdinBuf.indexOf("\n")
        ) {
          const line = stdinBuf.slice(0, i);
          stdinBuf = stdinBuf.slice(i + 1);
          inbox.push(JSON.parse(line) as FlowHostMessage);
          for (const wake of waiters.splice(0)) wake();
        }
        return Promise.resolve();
      },
      close() {
        return Promise.resolve();
      },
    },
    exited,
    terminate() {
      finish(null);
      return Promise.resolve(true);
    },
  };

  async function nextMessage(
    predicate: (msg: FlowHostMessage) => boolean,
  ): Promise<FlowHostMessage> {
    for (;;) {
      const idx = inbox.findIndex(predicate);
      if (idx >= 0) return inbox.splice(idx, 1)[0]!;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  }

  return {
    child,
    inbox,
    sendRequest(req: FlowRequest) {
      stdout.pushLine(JSON.stringify(req));
    },
    nextMessage,
    exit(code: number | null) {
      finish(code);
    },
  };
}

// Node로 옮기며 한 번 없어졌던 한도다. 없으면 AI가 짠 flow가 기계 memory를 다 잡는다.
test("a flow process starts with a V8 heap limit before its entry", () => {
  const command = flowCommand("/data/sdk/entry.ts", "/data/wf/flow.ts");
  assert.deepStrictEqual(command.args, [
    "--max-old-space-size=512",
    "/data/sdk/entry.ts",
    "/data/wf/flow.ts",
  ]);
});

test("startMessage forwards optional inputs and checkpoints into the start frame", () => {
  const plain = startMessage({ instance: INSTANCE, input: "run" });
  assert.deepStrictEqual(plain, {
    type: "start",
    instance: INSTANCE,
    input: "run",
  });
  assert.ok(flowStartMessageSchema.safeParse(plain).success);

  const cp: WorkflowCheckpoint = {
    instance: INSTANCE,
    key: "plan",
    kind: "step",
    state: "completed",
    handle_ref: null,
    output: { ok: true },
    error: null,
    started_at: AT,
    finished_at: AT,
  };
  const full = startMessage({
    instance: INSTANCE,
    input: "run",
    inputs: { mode: "fast", retries: 2 },
    checkpoints: [cp],
  });
  assert.deepStrictEqual(full, {
    type: "start",
    instance: INSTANCE,
    input: "run",
    inputs: { mode: "fast", retries: 2 },
    checkpoints: [cp],
  });
  assert.ok(flowStartMessageSchema.safeParse(full).success);
});

test("durable flow-host materializes codeSnapshot, routes all v2 wire frames, and cleans up on exit", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "flow-host-v2-"));
  try {
    // Fake installed SDK copy so linkFlowSdk & module resolution check work
    const sdkDir = join(dataRoot, "sdk", "flow", FLOW_SDK_VERSION);
    await mkdir(sdkDir, { recursive: true });
    await writeFile(
      join(sdkDir, "package.json"),
      JSON.stringify({
        name: FLOW_SDK_NAME,
        version: FLOW_SDK_VERSION,
        type: "module",
        exports: "./mod.ts",
      }),
    );
    await writeFile(join(sdkDir, "mod.ts"), "export const v = 2;\n");

    const flowBytes = new TextEncoder().encode(
      'import { v } from "@lophn/flow"; console.log(v);\n',
    );
    const flowHash = createHash("sha256").update(flowBytes).digest("hex");
    const manifestJson = JSON.stringify({
      version: 1,
      files: [
        {
          path: "flow.ts",
          blob_id: flowHash,
          size_bytes: flowBytes.byteLength,
        },
      ],
    });

    const checkpoints = new Map<string, WorkflowCheckpoint>();
    checkpoints.set("cached-tool", {
      instance: INSTANCE,
      key: "cached-tool",
      kind: "tool",
      state: "completed",
      handle_ref: "inv_cached",
      output: { fromCache: true },
      error: null,
      started_at: AT,
      finished_at: AT,
    });

    const reports: unknown[] = [];
    const escalations: unknown[] = [];
    const exitedCalls: unknown[] = [];
    let cancelledAgentSignal = false;
    let resolveInFlightAgent!: () => void;
    let toolRunsStarted = 0;

    const workflows: FlowHostWorkflows = {
      async upsertCheckpoint(input) {
        const existing = checkpoints.get(input.key);
        const next: WorkflowCheckpoint = {
          instance: input.instance,
          key: input.key,
          kind: input.kind,
          state: input.state,
          handle_ref:
            input.handle_ref !== undefined
              ? input.handle_ref
              : (existing?.handle_ref ?? null),
          output: input.state === "completed" ? (input.output ?? null) : null,
          error:
            input.state === "failed" || input.state === "interrupted"
              ? (input.error ?? null)
              : null,
          started_at: existing?.started_at ?? AT,
          finished_at: input.state === "started" ? null : AT,
        };
        checkpoints.set(input.key, next);
        return ok({ checkpoint: next });
      },
      async loadCheckpoints() {
        return ok([...checkpoints.values()]);
      },
      async runAgentCall(req) {
        if (req.key === "cancel-me") {
          if (req.signal?.aborted) {
            cancelledAgentSignal = true;
          } else {
            await new Promise<void>((resolve) => {
              resolveInFlightAgent = resolve;
              req.signal?.addEventListener(
                "abort",
                () => {
                  cancelledAgentSignal = true;
                  resolve();
                },
                { once: true },
              );
            });
          }
          return {
            ok: false,
            reason: "cancelled",
            message: "cancelled",
            session: SESSION,
          };
        }
        return {
          ok: true,
          result: { summary: `agent:${req.key}:${req.mode ?? "turn"}` },
        };
      },
      async runHumanStep(req) {
        return {
          ok: true,
          result: { summary: `human:${req.key}:${req.with?.agent ?? ""}` },
        };
      },
      async runSubWorkflow(req) {
        return {
          ok: true,
          result: { summary: `sub:${req.workflow}:${req.input}` },
        };
      },
      async report(input) {
        reports.push(input);
        return ok({ line: "1", handed: null });
      },
      async escalate(input) {
        escalations.push(input);
        return ok({ line: "2" });
      },
      async programExited(input) {
        exitedCalls.push(input);
        return ok(undefined);
      },
    };

    const flowEvents = createFlowEventRegistry({
      reaches: () => true,
    });

    const runs = {
      async start(): Promise<Result<RunRecord>> {
        toolRunsStarted += 1;
        return ok({
          id: "run_01arz3ndektsv4rrffq69g5fa1" as Id<"run">,
          kind: "tool",
          target: { app: APP_ID, tool: "notes.add" },
          state: "done",
          result: { added: true },
          error: null,
          session: null,
          session_opened: false,
          input_message: null,
          turn: null,
          invocation: "inv_01arz3ndektsv4rrffq69g5fa2",
          schema: null,
          job: null,
          instance: INSTANCE,
          created_at: AT,
          finished_at: AT,
        } as unknown as RunRecord);
      },
      async wait(): Promise<Result<RunRecord>> {
        throw new Error("unexpected wait");
      },
      async cancel(): Promise<Result<RunRecord>> {
        throw new Error("unexpected cancel");
      },
      async cancelOfInstance() {},
    };

    const fake = createFakeSpawned();
    let spawnedFlowPath = "";
    const host = createFlowHost({
      dataRoot,
      env: {},
      clock: manualClock(Date.parse(AT)),
      runs,
      resolveAgent: (addr) =>
        ok({
          agent: addr.agent,
          workspace: { kind: "project", id: PROJECT },
        }),
      resolveApp: () => ok(APP_ID),
      flowEvents: () => flowEvents,
      workflows,
      redact: (line) => line,
      spawn(opts) {
        spawnedFlowPath = opts.args[opts.args.length - 1]!;
        return fake.child;
      },
      readSnapshotBlob: async (hash) =>
        hash === flowHash
          ? ok(flowBytes)
          : { ok: false, error: { code: "not_found", message: "missing" } },
    });

    const launched = await host.launch({
      instance: INSTANCE,
      project: PROJECT,
      workflow: "demo",
      input: "start text",
      inputs: { env: "prod" },
      agent: "lophn",
      checkpoints: [...checkpoints.values()],
      codeSnapshot: manifestJson,
    });
    assert.ok(launched.ok);

    // Materialized under <data>/projects/.flow-snapshots/... and resolves @lophn/flow
    assert.ok(spawnedFlowPath.includes("/projects/.flow-snapshots/"));
    assert.equal(
      await readFile(spawnedFlowPath, "utf8"),
      new TextDecoder().decode(flowBytes),
    );
    const resolvedSdk = createRequire(spawnedFlowPath).resolve(FLOW_SDK_NAME);
    assert.ok(resolvedSdk.endsWith(`/sdk/flow/${FLOW_SDK_VERSION}/mod.ts`));

    const startFrame = await fake.nextMessage((m) => m.type === "start");
    assert.equal(startFrame.type, "start");
    assert.equal(startFrame.checkpoints?.length, 1);

    // 1. step_begin & step_end
    fake.sendRequest({ type: "step_begin", id: "1", key: "s1" });
    const r1 = await fake.nextMessage(
      (m) => m.type === "response" && m.id === "1",
    );
    assert.equal(r1.type === "response" && r1.outcome.ok, true);
    assert.equal(checkpoints.get("s1")?.state, "started");

    fake.sendRequest({
      type: "step_end",
      id: "2",
      key: "s1",
      outcome: { ok: true, result: { done: 1 } },
    });
    const r2 = await fake.nextMessage(
      (m) => m.type === "response" && m.id === "2",
    );
    assert.equal(r2.type === "response" && r2.outcome.ok, true);
    assert.equal(checkpoints.get("s1")?.state, "completed");

    // 2. agent, human, workflow
    fake.sendRequest({
      type: "agent",
      id: "3",
      key: "s1/agent#1",
      agent: { agent: "lophn" },
      prompt: "do it",
      mode: "report",
    });
    const r3 = await fake.nextMessage(
      (m) => m.type === "response" && m.id === "3",
    );
    assert.deepStrictEqual(r3.type === "response" && r3.outcome, {
      ok: true,
      result: { summary: "agent:s1/agent#1:report" },
    });

    fake.sendRequest({
      type: "human",
      id: "4",
      key: "s1/human#1",
      with: { agent: "experimenter" },
      prompt: "discuss",
    });
    const r4 = await fake.nextMessage(
      (m) => m.type === "response" && m.id === "4",
    );
    assert.deepStrictEqual(r4.type === "response" && r4.outcome, {
      ok: true,
      result: { summary: "human:s1/human#1:experimenter" },
    });

    fake.sendRequest({
      type: "workflow",
      id: "5",
      key: "s1/workflow#1",
      workflow: "sub-flow",
      input: "go",
    });
    const r5 = await fake.nextMessage(
      (m) => m.type === "response" && m.id === "5",
    );
    assert.deepStrictEqual(r5.type === "response" && r5.outcome, {
      ok: true,
      result: { summary: "sub:sub-flow:go" },
    });

    // 3. tool replay hit skips runs.start; fresh tool executes & checkpoints
    fake.sendRequest({
      type: "tool",
      id: "6",
      key: "cached-tool",
      app: "notes",
      tool: "notes.add",
    });
    const r6 = await fake.nextMessage(
      (m) => m.type === "response" && m.id === "6",
    );
    assert.deepStrictEqual(r6.type === "response" && r6.outcome, {
      ok: true,
      result: { fromCache: true },
    });
    assert.equal(toolRunsStarted, 0);

    fake.sendRequest({
      type: "tool",
      id: "7",
      key: "fresh-tool",
      app: "notes",
      tool: "notes.add",
      input: { title: "hi" },
    });
    const r7 = await fake.nextMessage(
      (m) => m.type === "response" && m.id === "7",
    );
    assert.deepStrictEqual(r7.type === "response" && r7.outcome, {
      ok: true,
      result: { added: true },
    });
    assert.equal(toolRunsStarted, 1);
    assert.equal(checkpoints.get("fresh-tool")?.state, "completed");

    // 4. cancel aborts in-flight agent by cancel_id
    fake.sendRequest({
      type: "agent",
      id: "8",
      key: "cancel-me",
      agent: { agent: "lophn" },
      prompt: "slow",
      cancel_id: "c_99",
    });
    fake.sendRequest({ type: "cancel", id: "9", cancel_id: "c_99" });
    const r9 = await fake.nextMessage(
      (m) => m.type === "response" && m.id === "9",
    );
    assert.equal(r9.type === "response" && r9.outcome.ok, true);
    const r8 = await fake.nextMessage(
      (m) => m.type === "response" && m.id === "8",
    );
    assert.equal(cancelledAgentSignal, true);
    assert.equal(
      r8.type === "response" && !r8.outcome.ok && r8.outcome.reason,
      "cancelled",
    );
    resolveInFlightAgent?.();

    // 5. subscribe -> event frame -> unsubscribe
    fake.sendRequest({
      type: "subscribe",
      id: "10",
      subscription_id: "sub_1",
      source: "notes",
      event: "created",
    });
    const r10 = await fake.nextMessage(
      (m) => m.type === "response" && m.id === "10",
    );
    assert.equal(r10.type === "response" && r10.outcome.ok, true);
    assert.equal(flowEvents.hasAppSubscribers(APP_ID, "created"), true);

    flowEvents.dispatchAppEvent({
      app: APP_ID,
      source: "notes",
      event: "created",
      payload: { id: "n1" },
    });
    const ev = await fake.nextMessage((m) => m.type === "event");
    assert.deepStrictEqual(ev, {
      type: "event",
      subscription_id: "sub_1",
      source: "notes",
      event: "created",
      payload: { id: "n1" },
    });

    // 6. report (with refs & data) & escalate
    fake.sendRequest({
      type: "report",
      id: "11",
      step: "draft",
      text: "done",
      refs: ["/tmp/out.md"],
      data: { count: 1 },
      next: "end",
    });
    const r11 = await fake.nextMessage(
      (m) => m.type === "response" && m.id === "11",
    );
    assert.equal(r11.type === "response" && r11.outcome.ok, true);
    assert.equal(reports.length, 1);

    fake.sendRequest({
      type: "escalate",
      id: "12",
      step: "draft",
      reason: "need human approval",
    });
    const r12 = await fake.nextMessage(
      (m) => m.type === "response" && m.id === "12",
    );
    assert.equal(r12.type === "response" && r12.outcome.ok, true);
    assert.equal(escalations.length, 1);

    // 7. Process exit unsubscribes flowEvents, cleans up materialized snapshot dir, and records programExited
    const snapshotDir = dirname(spawnedFlowPath);
    fake.exit(0);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(flowEvents.hasAppSubscribers(APP_ID, "created"), false);
    assert.equal(exitedCalls.length, 1);
    await assert.rejects(() => stat(snapshotDir));
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
