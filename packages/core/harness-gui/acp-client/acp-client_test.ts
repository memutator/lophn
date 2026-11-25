import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { CliProcess } from "../../../protocol/acp/mod.ts";
import {
  createAcpRuntime,
  createAntigravityDialect,
  createJsonRpcTransport,
  detectProtocolGeneration,
  isAgyVersionAtLeast,
  MAX_SUBAGENT_META_BYTES,
  mapAntigravitySubagentState,
  readAntigravityChildTranscript,
  readAntigravityChildWork,
} from "./index.ts";

function fakeProcess() {
  const written: Record<string, unknown>[] = [];
  let stdoutFn: (chunk: string) => void = () => {};
  let stderrFn: (chunk: string) => void = () => {};
  let exitFn: (code: number | null) => void = () => {};
  let ended = false;
  let killed = false;

  const proc: CliProcess = {
    pid: 42,
    write(text) {
      written.push(JSON.parse(text) as Record<string, unknown>);
    },
    end() {
      ended = true;
    },
    kill() {
      killed = true;
      setImmediate(() => exitFn(null));
    },
    onStdout: (fn) => void (stdoutFn = fn),
    onStderr: (fn) => void (stderrFn = fn),
    onExit: (fn) => void (exitFn = fn),
  };

  return {
    proc,
    written,
    get ended() {
      return ended;
    },
    get killed() {
      return killed;
    },
    pushStdout: (chunk: string) => stdoutFn(chunk),
    pushStderr: (chunk: string) => stderrFn(chunk),
    exit: (code: number | null) => exitFn(code),
  };
}

test("transport: frame isolation (maxFrameBytes & malformed JSON), partial wire activity, timeout + $/cancel_request, and stderr redaction", async () => {
  const fake = fakeProcess();
  const warnings: string[] = [];
  let wireActivities = 0;
  const transport = createJsonRpcTransport({
    label: "agy",
    spawn: () => fake.proc,
    command: "agy",
    args: ["acp"],
    maxFrameBytes: 64,
    requestTimeoutMs: 30,
    onWireActivity: () => {
      wireActivities += 1;
    },
    onWarning: (msg) => warnings.push(msg),
  });

  // Partial chunk without newline triggers onWireActivity immediately.
  fake.pushStdout('{"jsonrpc":"2.0"');
  assert.equal(wireActivities, 1);
  // Complete malformed line -> once-per-session warning, session stays alive.
  fake.pushStdout("not-json\n");
  fake.pushStdout("also-not-json\n");
  assert.equal(warnings.length, 1);

  // Oversized frame (> 64 bytes) is dropped without crashing.
  fake.pushStdout(`${"x".repeat(120)}\n`);
  assert.equal(transport.exited, false);

  // Stderr redacts credentials.
  fake.pushStderr("Authorization: Bearer sk-1234567890abcdef1234567890\n");
  assert.equal(transport.stderrTail().includes("sk-1234567890"), false);

  // Timed control request times out and sends $/cancel_request.
  const timedOut = await transport.request("session/list", { cwd: "/tmp" });
  assert.equal(timedOut.ok, false);
  if (!timedOut.ok) assert.equal(timedOut.timedOut, true);
  assert.equal(
    fake.written.some((msg) => msg.method === "$/cancel_request"),
    true,
  );

  // Untimed session/prompt rejects immediately on unexpected process exit.
  const pendingPrompt = transport.request("session/prompt", {
    sessionId: "s1",
    prompt: [],
  });
  fake.exit(137);
  const promptReply = await pendingPrompt;
  assert.equal(promptReply.ok, false);
});

test("transport: graceful stop runs session/cancel -> session/close -> stdin EOF -> kill", async () => {
  const fake = fakeProcess();
  const transport = createJsonRpcTransport({
    label: "agy",
    spawn: () => fake.proc,
    command: "agy",
    args: ["acp"],
    stopTimeouts: { cancelMs: 20, closeMs: 20, exitMs: 20 },
  });

  await transport.stop({
    sessionId: "ses_1",
    isTurnActive: () => true,
  });

  const methods = fake.written.map((m) => m.method);
  assert.equal(methods.indexOf("session/cancel") >= 0, true);
  assert.equal(
    methods.indexOf("session/close") > methods.indexOf("session/cancel"),
    true,
  );
  assert.equal(fake.ended, true);
  assert.equal(fake.killed, true);
});

test("runtime: initialize detects v1 vs v2 by response structure ('info' in response), not protocolVersion", async () => {
  // protocolVersion: 2 with v1 schema (agentInfo, no info) -> v1!
  assert.equal(
    detectProtocolGeneration({
      protocolVersion: 2,
      agentInfo: { name: "agy", version: "1.5.9" },
    }),
    "v1",
  );
  // Presence of 'info' -> v2!
  assert.equal(
    detectProtocolGeneration({
      protocolVersion: 1,
      info: { name: "acp-v2", version: "2.0.0" },
    }),
    "v2",
  );

  const fake = fakeProcess();
  const dialect = createAntigravityDialect({
    home: "/tmp/none",
    exists: () => Promise.resolve(false),
    loadReplayQuietPeriodMs: 40,
  });
  let committed = false;
  let runtime!: ReturnType<typeof createAcpRuntime>;
  const transport = createJsonRpcTransport({
    label: "agy",
    spawn: () => fake.proc,
    command: "agy",
    args: ["acp"],
    onWireActivity: () => runtime.notifyWireActivity(),
    onNotification: (m, p) => runtime.handleNotification(m, p),
  });
  runtime = createAcpRuntime({
    transport,
    dialect,
    hooks: {
      onSessionUpdate() {},
      onAgentRequest() {},
      onCancelRequest() {},
      onReplayStart() {},
      onSessionOpened() {},
      onReplayCommit() {
        committed = true;
      },
      onReplayAbort() {},
    },
  });

  const initPromise = runtime.initialize();
  fake.pushStdout(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: 2,
        agentInfo: { name: "Antigravity", version: "1.5.9" },
        agentCapabilities: { sessionCapabilities: { resume: {} } },
      },
    })}\n`,
  );
  const init = await initPromise;
  assert.equal(init.ok, true);
  if (init.ok) {
    assert.equal(init.info.generation, "v1");
    assert.equal(init.info.agentVersion, "1.5.9");
    assert.equal(init.info.supportsResume, true);
  }

  // Partial wire reads during draining extend the quiet window!
  const loadPromise = runtime.loadSession("s1", "/tmp", "collect");
  fake.pushStdout(`${JSON.stringify({ jsonrpc: "2.0", id: 2, result: {} })}\n`);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(committed, false);
  // Partial stdout bytes (no newline) bump the 40ms quiet timer.
  fake.pushStdout('{"jsonrpc":"2.0"');
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(committed, false);
  await loadPromise;
  assert.equal(committed, true);
  assert.equal(runtime.replayPhase, "skipping_late_replay");
  runtime.dispose();
});

test("antigravity-child-work: state mapping, path traversal rejection, symlink refusal, and byte cap", async () => {
  assert.equal(mapAntigravitySubagentState("SUBAGENT_STATE_ALIVE"), "running");
  assert.equal(
    mapAntigravitySubagentState("SUBAGENT_STATE_RUNNING"),
    "running",
  );
  assert.equal(
    mapAntigravitySubagentState("SUBAGENT_STATE_STARTING"),
    "running",
  );
  assert.equal(
    mapAntigravitySubagentState("SUBAGENT_STATE_PENDING"),
    "running",
  );
  assert.equal(mapAntigravitySubagentState("SUBAGENT_STATE_FAILED"), "error");
  assert.equal(mapAntigravitySubagentState("SUBAGENT_STATE_ERROR"), "error");
  assert.equal(
    mapAntigravitySubagentState("SUBAGENT_STATE_KILLED"),
    "cancelled",
  );
  assert.equal(
    mapAntigravitySubagentState("SUBAGENT_STATE_CANCELLED"),
    "cancelled",
  );
  // Unknown states MUST NEVER stay "running".
  assert.equal(
    mapAntigravitySubagentState("SUBAGENT_STATE_UNKNOWN_FUTURE"),
    "ok",
  );
  assert.equal(mapAntigravitySubagentState(""), "ok");

  assert.equal(isAgyVersionAtLeast("1.4.9", [1, 5, 0]), false);
  assert.equal(isAgyVersionAtLeast("1.5.0", [1, 5, 0]), true);
  assert.equal(isAgyVersionAtLeast("1.5.9", [1, 5, 0]), true);
  assert.equal(isAgyVersionAtLeast(null, [1, 5, 0]), true);

  const dir = mkdtempSync(join(tmpdir(), "lophn-child-work-"));
  try {
    // Path traversal rejected.
    assert.equal(await readAntigravityChildWork(dir, "../escape"), null);
    assert.equal(await readAntigravityChildTranscript(dir, "../escape"), null);

    // Oversized metadata (> 64 KiB) skipped cleanly.
    const subDir = join(
      dir,
      ".gemini",
      "antigravity-cli",
      "brain",
      "parent1",
      ".system_generated",
      "subagents",
    );
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      join(subDir, "huge.json"),
      JSON.stringify({
        conversationId: "huge",
        state: "SUBAGENT_STATE_ALIVE",
        pad: "a".repeat(MAX_SUBAGENT_META_BYTES + 100),
      }),
    );
    // Symlinked transcript refused.
    const childLogs = join(
      dir,
      ".gemini",
      "antigravity-cli",
      "brain",
      "child1",
      ".system_generated",
      "logs",
    );
    mkdirSync(childLogs, { recursive: true });
    const target = join(dir, "outside.jsonl");
    writeFileSync(
      target,
      '{"step_index":0,"source":"MODEL","type":"PLANNER_RESPONSE","content":"secret"}\n',
    );
    symlinkSync(target, join(childLogs, "transcript.jsonl"));

    const entries = await readAntigravityChildWork(dir, "parent1");
    assert.deepEqual(entries, []);
    assert.equal(await readAntigravityChildTranscript(dir, "child1"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
