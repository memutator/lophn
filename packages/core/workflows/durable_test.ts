import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  err,
  type Logger,
  manualClock,
  ok,
  type Result,
} from "../../base/mod.ts";
import { createKnownSecretRegistry } from "../../base/redaction/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import { DEFAULT_CALL_POLICY } from "../../protocol/lophn-agent/call-policy.ts";
import type { ReadSnapshot, Tx } from "../../protocol/server/mod.ts";
import {
  type WorkflowCheckpoint,
  workflowCheckpointUpsert,
} from "../../protocol/workflows/mod.ts";
import { withStepText } from "../main/daemon/wiring/workflows.ts";
import { createRouter } from "../router/mod.ts";
import type { RoutedInput } from "../router/ports.ts";
import type { KnownSecretMatch, Writer } from "../storage/ledger/mod.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import type {
  AgentCallsSettledEvent,
  AgentPrimitivePorts,
  AgentReportEvent,
  AgentTurnEndedEvent,
} from "./agent-primitive.ts";
import { WORKFLOW_CHECKPOINTS_SCHEMA_STEP } from "./checkpoint-schema.ts";
import { loadCheckpoints } from "./checkpoints.ts";
import { createWorkflowCommands } from "./commands.ts";
import { entryOf } from "./declaration.ts";
import { WORKFLOW_INPUTS_SCHEMA_STEP } from "./inputs-schema.ts";
import { workflowLinesSchemaSteps } from "./lines-schema.ts";
import type {
  DefinitionFile,
  StepTurn,
  WorkflowFiles,
  WorkflowFlows,
  WorkflowProjects,
  WorkflowRemote,
  WorkflowSnapshots,
} from "./ports.ts";
import { createWorkflowReads, deriveWorkflowStatus } from "./reads.ts";
import { workflowsNoHarnessKindSteps, workflowsSchemaSteps } from "./schema.ts";
import { createWorkflowService } from "./service.ts";
import { captureWorkflowSnapshot, materializeSnapshot } from "./snapshot.ts";
import {
  loadChildInstances,
  loadInstance,
  loadLines,
  runningInstances,
} from "./store.ts";

const PRJ_A = "prj_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"prj">;
const PRJ_B = "prj_01hzzzzzzzzzzzzzzzzzzzzzzb" as Id<"prj">;
const AT = "2026-11-23T12:00:00.000Z";
const lophnAtWorkspace = { agent: "lophn", workspace: null } as const;

const logger: Logger = {
  log: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  flush: () => Promise.resolve(),
};

function makeDurableHarness(options?: {
  files?: DefinitionFile[];
  snapshotCapture?: (
    project: Id<"prj">,
    workflow: string,
  ) => Promise<Result<string>>;
  lastTurn?: (session: Id<"ses">) => StepTurn | null;
}) {
  const db = new DatabaseSync(":memory:");
  for (const step of [
    ...workflowsSchemaSteps,
    ...workflowsNoHarnessKindSteps,
    ...workflowLinesSchemaSteps,
    WORKFLOW_INPUTS_SCHEMA_STEP,
    WORKFLOW_CHECKPOINTS_SCHEMA_STEP,
  ]) {
    db.exec(step.sql);
  }
  const sql = createSql(db, () => true);
  let seq = 0;
  const nextId = (prefix: string) => {
    seq += 1;
    const suffix = String(seq).padStart(26, "0");
    return `${prefix}_${suffix}`;
  };
  const tx = {
    sql,
    now: () => AT,
    newId: nextId,
    port: () => ({ push: () => {} }),
  } as unknown as Tx;
  const ctx = { actor: "machine", principal: "machine:workflows" } as never;

  const delivered: { session: string; input: RoutedInput }[] = [];
  let sessionCount = 0;
  const openedSessions: Id<"ses">[] = [];
  const router = createRouter({
    directory: {
      find: (session) =>
        openedSessions.includes(session)
          ? ({
              session,
              transport: "lophn",
              agent: lophnAtWorkspace,
              accepting: true,
              open: true,
              spawned_by: null,
              opened_by_machine: null,
              runs_on: null,
            } as never)
          : null,
      resolveAddress: () => ok(lophnAtWorkspace),
      archive: () => ok(false),
      membersOn: () => [],
      membersFrom: () => [],
      membersUnder: () => [],
      setWorkflowOrigin: () => {},
      openMember: () => err({ code: "forbidden", message: "unused" }),
      open: () => {
        sessionCount += 1;
        const ses =
          `ses_${String(sessionCount).padStart(26, "0")}` as Id<"ses">;
        openedSessions.push(ses);
        return ok({
          session: ses,
          transport: "lophn",
          agent: lophnAtWorkspace,
          accepting: true,
          open: true,
          spawned_by: null,
          opened_by_machine: null,
          runs_on: null,
        } as never);
      },
      app: () => null,
      accepts: () => null,
      listOpen: () => [],
      projectOfIdentity: () => null,
      identityOfProject: () => ok("pri_test"),
      appIdOf: () => err({ code: "not_found", message: "none" }),
    },
    store: {} as never,
    outbox: {} as never,
    seen: {} as never,
    self: () => "mch_self",
    steps: {} as never,
    announce: () => {},
    callPolicy: () => DEFAULT_CALL_POLICY,
    transport: {
      deliver: (_tx, to, input) => {
        delivered.push({ session: to.session, input });
        return ok(undefined);
      },
      cancel: () => ok(undefined),
      withdraw: () => ok(undefined),
    },
  });

  const commands = createWorkflowCommands(() => ok(router));
  const reads = createWorkflowReads();
  const snapshot: ReadSnapshot = {
    sql,
    as_of_seq: "1",
    port() {
      throw new Error("unregistered");
    },
  };

  let defFiles: DefinitionFile[] = options?.files ?? [];
  const launched: Parameters<WorkflowFlows["launch"]>[0][] = [];
  const stoppedFlows: Id<"wfi">[] = [];
  const stoppedSessions: Id<"ses">[] = [];
  let lastTurnFn = options?.lastTurn ?? (() => null);

  const turnEndedListeners = new Set<(e: AgentTurnEndedEvent) => void>();
  const callsSettledListeners = new Set<(e: AgentCallsSettledEvent) => void>();
  const reportListeners = new Set<(e: AgentReportEvent) => void>();
  let handOffCount = 0;
  let handOffImpl = async (): Promise<
    | { ok: true; session: Id<"ses"> }
    | { ok: false; reason: "unavailable"; message: string }
  > => {
    handOffCount += 1;
    const ses = `ses_01a${String(handOffCount).padStart(23, "0")}` as Id<"ses">;
    openedSessions.push(ses);
    return { ok: true, session: ses };
  };

  const agentPorts: AgentPrimitivePorts = {
    handOff: () => handOffImpl(),
    openOutgoingCalls: () => 0,
    subscribeTurnEnded: (fn) => {
      turnEndedListeners.add(fn);
      return () => turnEndedListeners.delete(fn);
    },
    subscribeCallsSettled: (fn) => {
      callsSettledListeners.add(fn);
      return () => callsSettledListeners.delete(fn);
    },
    subscribeReport: (fn) => {
      reportListeners.add(fn);
      return () => reportListeners.delete(fn);
    },
    stopSession: (ses) => {
      stoppedSessions.push(ses);
    },
    clock: manualClock(Date.UTC(2026, 10, 23, 12, 0, 0)),
  };

  const filesPort: WorkflowFiles = {
    list: () => Promise.resolve(ok(defFiles)),
  };
  const projectsPort: WorkflowProjects = {
    resolve: (ref) => {
      if (ref === "alpha" || ref === PRJ_A) {
        return Promise.resolve(ok({ id: PRJ_A, name: "alpha" }));
      }
      if (ref === "beta" || ref === PRJ_B) {
        return Promise.resolve(ok({ id: PRJ_B, name: "beta" }));
      }
      return Promise.resolve(
        err({ code: "not_found", message: "project not found" }),
      );
    },
    nameOf: (id) =>
      Promise.resolve(
        id === PRJ_A
          ? ok("alpha")
          : id === PRJ_B
            ? ok("beta")
            : err({ code: "not_found", message: "project not found" }),
      ),
  };
  const remotePort: WorkflowRemote = {
    computer: () => err({ code: "not_found", message: "none" }),
    workspace: () => err({ code: "not_found", message: "none" }),
    isPrivate: () => false,
    receivedStep: () => Promise.resolve(ok(null)),
    report: () => Promise.resolve(ok(undefined)),
    handOf: () => ok(null),
  };
  const snapshotsPort: WorkflowSnapshots | undefined =
    options?.snapshotCapture !== undefined
      ? { capture: options.snapshotCapture }
      : {
          capture: (_prj, wf) =>
            Promise.resolve(
              ok(
                JSON.stringify({
                  version: 1,
                  files: [
                    {
                      path: "flow.ts",
                      blob_id: createHash("sha256")
                        .update(`flow:${wf}:v1`)
                        .digest("hex"),
                    },
                  ],
                }),
              ),
            ),
        };

  const service = createWorkflowService({
    files: filesPort,
    projects: projectsPort,
    turns: {
      stopSession: (ses) => {
        stoppedSessions.push(ses);
        return Promise.resolve(ok(undefined));
      },
      stepTurn: () => Promise.resolve(ok(null)),
      openOutgoingCalls: () => Promise.resolve(ok(0)),
      lastTurn: (ses) => Promise.resolve(ok(lastTurnFn(ses))),
    },
    store: {
      create: (input) =>
        Promise.resolve(commands.create.handle(tx, ctx, input, {})),
      apply: (input, compare) =>
        Promise.resolve(commands.apply.handle(tx, ctx, input, compare)),
      upsertCheckpoint: (input) =>
        Promise.resolve(commands.upsertCheckpoint.handle(tx, ctx, input, {})),
      read: (id) =>
        Promise.resolve(reads.read.handle(snapshot, ctx, { instance: id })),
      running: () => Promise.resolve(runningInstances(sql)),
      checkpoints: (id) => Promise.resolve(loadCheckpoints(sql, id)),
      children: (id) => Promise.resolve(loadChildInstances(sql, id)),
    },
    flows: {
      launch: (start) => {
        launched.push(start);
        return Promise.resolve(ok(undefined));
      },
      stop: (id) => {
        stoppedFlows.push(id);
        return Promise.resolve(ok(undefined));
      },
    },
    remote: remotePort,
    snapshots: snapshotsPort,
    agentPorts,
    ids: { newId: nextId } as never,
    logger,
  });

  const readInstance = (id: Id<"wfi">) => {
    const r = reads.read.handle(snapshot, ctx, { instance: id });
    assert.ok(r.ok);
    return r.value;
  };

  return {
    db,
    sql,
    tx,
    ctx,
    commands,
    reads,
    service,
    delivered,
    launched,
    stoppedFlows,
    stoppedSessions,
    get handOffCount() {
      return handOffCount;
    },
    setFiles(next: DefinitionFile[]) {
      defFiles = next;
    },
    setLastTurn(fn: (session: Id<"ses">) => StepTurn | null) {
      lastTurnFn = fn;
    },
    setHandOff(fn: typeof handOffImpl) {
      handOffImpl = fn;
    },
    emitTurnEnded(e: AgentTurnEndedEvent) {
      for (const fn of [...turnEndedListeners]) fn(e);
    },
    emitReport(e: AgentReportEvent) {
      for (const fn of [...reportListeners]) fn(e);
    },
    readInstance,
    checkpointsOf(id: Id<"wfi">): WorkflowCheckpoint[] {
      const r = loadCheckpoints(sql, id);
      assert.ok(r.ok);
      return r.value;
    },
    linesOf(id: Id<"wfi">) {
      const r = loadLines(sql, id, { after: 0, limit: null });
      assert.ok(r.ok);
      return r.value;
    },
    instanceOf(id: Id<"wfi">) {
      const r = loadInstance(sql, id);
      assert.ok(r.ok && r.value !== null);
      return r.value;
    },
  };
}

// 1. Durable replay returns stored completed/failed checkpoints without re-calling agent,
//    and started human checkpoint re-attaches without re-sending prompt.
test("durable replay returns completed/failed checkpoint without re-calling agent and re-attaches started human wait", async () => {
  const h = makeDurableHarness({
    files: [
      {
        name: "pipeline",
        declaration:
          'flow_sdk: "2.0.0"\nparticipants:\n  helper: { agent: lophn }\n',
        flow: true,
        artifacts: { static: false, instance: false },
      },
    ],
  });
  try {
    const started = await h.service.start(
      { workflow: "alpha/pipeline", text: "build" },
      { kind: "user" },
    );
    assert.ok(started.ok);
    const id = started.value.instance.id as Id<"wfi">;
    assert.ok(started.value.instance.code_snapshot);

    // First runAgentCall executes handOff and completes on TurnEnded -> writes completed checkpoint.
    const firstCall = h.service.runAgentCall({
      instance: id,
      step: "draft",
      key: "draft/agent#1",
      agent: { agent: "lophn" },
      mode: "turn",
      prompt: "write draft",
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(h.handOffCount, 1);
    const startedCps = h.checkpointsOf(id);
    assert.equal(startedCps.length, 1);
    assert.equal(startedCps[0]!.state, "started");
    const ses1 = startedCps[0]!.handle_ref as Id<"ses">;
    assert.ok(ses1.startsWith("ses_"));

    h.emitTurnEnded({
      session: ses1,
      status: "completed",
      lastAssistantText: "draft complete",
    });
    const out1 = await firstCall;
    assert.deepStrictEqual(out1, {
      ok: true,
      result: { summary: "draft complete" },
    });

    // Replay of completed checkpoint returns stored output immediately WITHOUT calling handOff again.
    const replayOk = await h.service.runAgentCall({
      instance: id,
      step: "draft",
      key: "draft/agent#1",
      agent: { agent: "lophn" },
      mode: "turn",
      prompt: "write draft",
    });
    assert.deepStrictEqual(replayOk, {
      ok: true,
      result: { summary: "draft complete" },
    });
    assert.equal(h.handOffCount, 1);

    // Replay of failed checkpoint returns stored error immediately WITHOUT calling handOff.
    await h.service.upsertCheckpoint({
      instance: id,
      key: "lint/agent#1",
      kind: "agent",
      state: "failed",
      handle_ref: ses1,
      error: { reason: "model_error", message: "rate limit", session: ses1 },
    });
    const replayFail = await h.service.runAgentCall({
      instance: id,
      step: "lint",
      key: "lint/agent#1",
      agent: { agent: "lophn" },
      mode: "turn",
      prompt: "run lint",
    });
    assert.deepStrictEqual(replayFail, {
      ok: false,
      reason: "model_error",
      message: "rate limit",
      session: ses1,
    });
    assert.equal(h.handOffCount, 1);

    // Replay of started human checkpoint (surviving restart) re-attaches without re-sending prompt.
    const humanSes = "ses_01h00000000000000000000001" as Id<"ses">;
    await h.service.upsertCheckpoint({
      instance: id,
      key: "review/human#1",
      kind: "human",
      state: "started",
      handle_ref: humanSes,
    });
    const humanWait = h.service.runHumanStep({
      instance: id,
      step: "review",
      key: "review/human#1",
      participant: "helper",
      prompt: "should not resend",
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(h.handOffCount, 1); // no new handoff!

    // Explicit workflow.report resolves the re-attached human step and marks checkpoint completed.
    const reported = await h.service.report(
      {
        instance: id,
        step: "review",
        text: "approved by human",
        refs: ["docs/spec.md"],
      },
      { kind: "agent", session: humanSes },
    );
    assert.ok(reported.ok);
    const humanOut = await humanWait;
    assert.deepStrictEqual(humanOut, {
      ok: true,
      result: { summary: "approved by human", refs: ["docs/spec.md"] },
    });
    const finalHumanCp = h
      .checkpointsOf(id)
      .find((c) => c.key === "review/human#1")!;
    assert.equal(finalHumanCp.state, "completed");
  } finally {
    h.db.close();
  }
});

// 2. Restart reconcile(): marks started agent/tool (and interrupted human) as interrupted (never re-runs),
//    preserves idle human waiting as started (needs_you), keeps workflow checkpoint started, and relaunches durable flow.
test("reconcile marks interrupted agent/tool checkpoints without re-running while preserving idle human wait as needs_you", async () => {
  const h = makeDurableHarness({
    files: [
      {
        name: "durable",
        declaration: 'flow_sdk: "2.0.0"\nagent: lophn\n',
        flow: true,
        artifacts: { static: false, instance: false },
      },
      {
        name: "human-only",
        declaration: 'flow_sdk: "2.0.0"\nagent: lophn\n',
        flow: true,
        artifacts: { static: false, instance: false },
      },
    ],
  });
  try {
    const s1 = await h.service.start(
      { workflow: "alpha/durable", text: "go" },
      { kind: "user" },
    );
    const s2 = await h.service.start(
      { workflow: "alpha/human-only", text: "wait" },
      { kind: "user" },
    );
    assert.ok(s1.ok && s2.ok);
    const wfiMixed = s1.value.instance.id as Id<"wfi">;
    const wfiHuman = s2.value.instance.id as Id<"wfi">;
    h.launched.length = 0;

    const sesAgent = "ses_00000000000000000000000010" as Id<"ses">;
    const sesIdleHuman = "ses_00000000000000000000000011" as Id<"ses">;
    const sesBrokenHuman = "ses_00000000000000000000000012" as Id<"ses">;
    const childWfi = "wfi_00000000000000000000000099" as Id<"wfi">;

    // Mixed instance: started agent, started tool, interrupted human turn, and started child workflow.
    await h.service.upsertCheckpoint({
      instance: wfiMixed,
      key: "s1/agent#1",
      kind: "agent",
      state: "started",
      handle_ref: sesAgent,
    });
    await h.service.upsertCheckpoint({
      instance: wfiMixed,
      key: "s1/tool#1",
      kind: "tool",
      state: "started",
      handle_ref: "inv_1",
    });
    await h.service.upsertCheckpoint({
      instance: wfiMixed,
      key: "s1/human#1",
      kind: "human",
      state: "started",
      handle_ref: sesBrokenHuman,
    });
    await h.service.upsertCheckpoint({
      instance: wfiMixed,
      key: "s1/workflow#1",
      kind: "workflow",
      state: "started",
      handle_ref: childWfi,
    });

    // Human-only instance: idle human checkpoint (last turn completed normally, waiting for user).
    await h.service.upsertCheckpoint({
      instance: wfiHuman,
      key: "chat/human#1",
      kind: "human",
      state: "started",
      handle_ref: sesIdleHuman,
    });

    h.setLastTurn((ses) =>
      ses === sesBrokenHuman
        ? {
            turn: "trn_00000000000000000000000001" as Id<"trn">,
            state: "finished",
            outcome: { kind: "interrupted", reason: "restarted" },
          }
        : {
            turn: "trn_00000000000000000000000002" as Id<"trn">,
            state: "finished",
            outcome: { kind: "completed", reason: "answer_completed" },
          },
    );

    await h.service.reconcile();

    const mixedCps = new Map(
      h.checkpointsOf(wfiMixed).map((cp) => [cp.key, cp]),
    );
    assert.equal(mixedCps.get("s1/agent#1")?.state, "interrupted");
    assert.equal(mixedCps.get("s1/agent#1")?.error?.reason, "interrupted");
    assert.equal(mixedCps.get("s1/agent#1")?.error?.session, sesAgent);
    assert.equal(mixedCps.get("s1/tool#1")?.state, "interrupted");
    assert.equal(mixedCps.get("s1/human#1")?.state, "interrupted");
    assert.equal(mixedCps.get("s1/workflow#1")?.state, "started");
    assert.ok(h.linesOf(wfiMixed).some((l) => l.kind === "lophn_restarted"));

    // Idle human wait stayed started and derived_status is needs_you (no lophn_restarted).
    const humanRead = h.readInstance(wfiHuman);
    assert.equal(humanRead.checkpoints?.length, 1);
    assert.equal(humanRead.checkpoints![0]!.state, "started");
    assert.equal(humanRead.derived_status, "needs_you");
    assert.ok(!h.linesOf(wfiHuman).some((l) => l.kind === "lophn_restarted"));

    // Both durable flows with code_snapshot were relaunched with their reconciled checkpoints.
    assert.equal(h.launched.length, 2);
    const relaunchedMixed = h.launched.find((l) => l.instance === wfiMixed)!;
    assert.ok(relaunchedMixed.codeSnapshot);
    assert.equal(
      relaunchedMixed.checkpoints?.find((c) => c.key === "s1/agent#1")?.state,
      "interrupted",
    );

    // Replay of interrupted agent checkpoint returns interrupted outcome without invoking agent.
    const replayInterrupted = await h.service.runAgentCall({
      instance: wfiMixed,
      step: "s1",
      key: "s1/agent#1",
      agent: { agent: "lophn" },
      mode: "turn",
      prompt: "never rerun",
    });
    assert.equal(replayInterrupted.ok, false);
    assert.equal(replayInterrupted.reason, "interrupted");
    assert.equal(replayInterrupted.session, sesAgent);
    assert.equal(h.handOffCount, 0);
  } finally {
    h.db.close();
  }
});

// 3. ResumeWorkflow (default snapshot vs use_latest_code: true) + code snapshot capture/materialize round-trip.
test("ResumeWorkflow updates code_snapshot with code_updated when use_latest_code is true and relaunches with checkpoints", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lophn-wf-snap-"));
  const wfDir = join(dir, "wf");
  const outDir = join(dir, "out");
  const blobs = new Map<string, Uint8Array>();
  const blobStore = {
    async put(bytes: Uint8Array) {
      const hash = createHash("sha256").update(bytes).digest("hex");
      blobs.set(hash, new Uint8Array(bytes));
      return ok({ hash, sizeBytes: bytes.byteLength });
    },
    async get(hash: string) {
      const found = blobs.get(hash);
      return found
        ? ok(found)
        : err({ code: "not_found" as const, message: "missing" });
    },
  };
  await mkdir(join(wfDir, "lib"), { recursive: true });
  await mkdir(join(wfDir, "artifacts", "instance"), { recursive: true });
  await mkdir(join(wfDir, "node_modules", "pkg"), { recursive: true });
  await writeFile(
    join(wfDir, "workflow.yaml"),
    'flow_sdk: "2.0.0"\nagent: lophn\n',
  );
  await writeFile(join(wfDir, "flow.ts"), "export const version = 1;\n");
  await writeFile(join(wfDir, "lib", "util.ts"), "export const x = 1;\n");
  await writeFile(join(wfDir, "artifacts", "instance", "index.html"), "<hi/>");
  await writeFile(join(wfDir, "node_modules", "pkg", "index.js"), "ignored");

  const h = makeDurableHarness({
    files: [
      {
        name: "release",
        declaration: 'flow_sdk: "2.0.0"\nagent: lophn\n',
        flow: true,
        artifacts: { static: false, instance: false },
      },
    ],
    snapshotCapture: () => captureWorkflowSnapshot(wfDir, blobStore),
  });
  try {
    const started = await h.service.start(
      { workflow: "alpha/release", text: "ship" },
      { kind: "user" },
    );
    assert.ok(started.ok);
    const id = started.value.instance.id as Id<"wfi">;
    const snapV1 = started.value.instance.code_snapshot!;
    assert.ok(snapV1);
    const parsedV1 = JSON.parse(snapV1) as {
      version: number;
      files: { path: string; blob_id: string }[];
    };
    assert.equal(parsedV1.version, 1);
    assert.deepStrictEqual(
      parsedV1.files.map((f) => f.path),
      ["flow.ts", "lib/util.ts", "workflow.yaml"],
    );

    // Materialize round-trip restores exact source files excluding artifacts/ and node_modules/.
    const materialized = await materializeSnapshot(snapV1, outDir, {
      readBlob: (hash) => blobStore.get(hash),
    });
    assert.ok(materialized.ok);
    assert.equal(
      await readFile(join(outDir, "flow.ts"), "utf8"),
      "export const version = 1;\n",
    );

    // Save a completed checkpoint before crashing.
    await h.service.upsertCheckpoint({
      instance: id,
      key: "step1/agent#1",
      kind: "agent",
      state: "completed",
      output: { summary: "step1 done" },
    });

    // While working (not blocked), ResumeWorkflow returns conflict.
    const workingResume = await h.service.resume({ instance: id });
    assert.ok(!workingResume.ok);
    assert.equal(workingResume.error.code, "conflict");

    // Non-zero exit keeps instance running + blocked so ResumeWorkflow is allowed.
    const exited = await h.service.programExited({
      instance: id,
      code: 1,
      stderr_tail: "ReferenceError: boom",
    });
    assert.ok(exited.ok);
    assert.equal(h.readInstance(id).instance.state, "running");
    assert.equal(h.readInstance(id).derived_status, "blocked");

    // Default resume (use_latest_code omitted) uses original snapV1 + existing checkpoints.
    h.launched.length = 0;
    const resumedOld = await h.service.resume({ instance: id });
    assert.ok(resumedOld.ok);
    assert.equal(h.launched.length, 1);
    assert.equal(h.launched[0]!.codeSnapshot, snapV1);
    assert.equal(h.launched[0]!.checkpoints?.length, 1);

    // Update flow.ts on disk and call ResumeWorkflow with use_latest_code: true.
    await writeFile(join(wfDir, "flow.ts"), "export const version = 2;\n");
    h.launched.length = 0;
    const resumedNew = await h.service.resume({
      instance: id,
      use_latest_code: true,
    });
    assert.ok(resumedNew.ok);
    const snapV2 = resumedNew.value.instance.code_snapshot!;
    assert.notEqual(snapV2, snapV1);
    assert.ok(h.linesOf(id).some((l) => l.kind === "code_updated"));
    assert.equal(h.launched.length, 1);
    assert.equal(h.launched[0]!.codeSnapshot, snapV2);
    assert.equal(h.launched[0]!.checkpoints?.length, 1);
  } finally {
    h.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// 4. Sub-workflow workflow(): same-project allowed, cross-project forbidden, cycle conflict,
//    depth > 5 conflict, ReadWorkflowInstance children, and StopWorkflow cascade.
test("workflow() enforces same-project, cycle, depth 5, returns child SoftOutput, and StopWorkflow cascades to children", async () => {
  const flowDef = (name: string): DefinitionFile => ({
    name,
    declaration: 'flow_sdk: "2.0.0"\nagent: lophn\n',
    flow: true,
    artifacts: { static: false, instance: false },
  });
  const h = makeDurableHarness({
    files: [
      flowDef("root"),
      flowDef("sub-a"),
      flowDef("d1"),
      flowDef("d2"),
      flowDef("d3"),
      flowDef("d4"),
      flowDef("d5"),
      flowDef("d6"),
    ],
  });
  try {
    const rootStarted = await h.service.start(
      { workflow: "alpha/root", text: "go" },
      { kind: "user" },
    );
    assert.ok(rootStarted.ok);
    const rootId = rootStarted.value.instance.id as Id<"wfi">;

    // Cross-project -> forbidden.
    const crossProject = await h.service.runSubWorkflow({
      parentInstance: rootId,
      key: "cross",
      workflow: "beta/sub-a",
      input: "hi",
    });
    assert.equal(crossProject.ok, false);
    assert.equal(crossProject.reason, "forbidden");

    // Direct self cycle -> conflict.
    const selfCycle = await h.service.runSubWorkflow({
      parentInstance: rootId,
      key: "self-cycle",
      workflow: "root",
      input: "loop",
    });
    assert.equal(selfCycle.ok, false);
    assert.equal(selfCycle.reason, "conflict");

    // Same-project sub-workflow succeeds when child reports and exits 0.
    const subPromise = h.service.runSubWorkflow({
      parentInstance: rootId,
      key: "call-sub-a",
      workflow: "sub-a",
      input: "do sub work",
    });
    await new Promise((r) => setTimeout(r, 15));
    const rootRead = h.readInstance(rootId);
    assert.equal(rootRead.children?.length, 1);
    const childId = rootRead.children![0]!.instance as Id<"wfi">;
    assert.equal(rootRead.children![0]!.workflow, "sub-a");
    assert.equal(rootRead.children![0]!.derived_status, "working");

    // Indirect cycle (child calling ancestor "root") -> conflict.
    const indirectCycle = await h.service.runSubWorkflow({
      parentInstance: childId,
      key: "back-to-root",
      workflow: "root",
      input: "cycle",
    });
    assert.equal(indirectCycle.ok, false);
    assert.equal(indirectCycle.reason, "conflict");

    // Complete child with report + normal exit 0 -> parent receives SoftOutput.
    await h.service.report(
      {
        instance: childId,
        step: "done",
        text: "sub-a finished",
        refs: ["out/sub.md"],
        next: "end",
      },
      { kind: "program" },
    );
    const subOutcome = await subPromise;
    assert.deepStrictEqual(subOutcome, {
      ok: true,
      result: { summary: "sub-a finished", refs: ["out/sub.md"] },
    });

    // Depth 5 allowed (root -> d1 -> d2 -> d3 -> d4 -> d5), depth 6 (d5 -> d6) rejected with conflict.
    let currentParent = rootId;
    const activeChain: Promise<unknown>[] = [];
    for (const name of ["d1", "d2", "d3", "d4", "d5"]) {
      const p = h.service.runSubWorkflow({
        parentInstance: currentParent,
        key: `call-${name}`,
        workflow: name,
        input: name,
      });
      activeChain.push(p);
      await new Promise((r) => setTimeout(r, 15));
      const kids = h.readInstance(currentParent).children ?? [];
      const nextChild = kids.find((c) => c.workflow === name);
      assert.ok(nextChild, `expected child ${name}`);
      currentParent = nextChild.instance as Id<"wfi">;
    }
    const tooDeep = await h.service.runSubWorkflow({
      parentInstance: currentParent,
      key: "call-d6",
      workflow: "d6",
      input: "too deep",
    });
    assert.equal(tooDeep.ok, false);
    assert.equal(tooDeep.reason, "conflict");

    // StopWorkflow on root cascades recursively to all running descendants (d1..d5).
    const stopped = await h.service.stop(
      { instance: rootId },
      { kind: "user" },
    );
    assert.ok(stopped.ok);
    const outcomes = (await Promise.all(activeChain)) as Array<{
      ok: boolean;
      reason?: string;
    }>;
    assert.ok(outcomes.every((o) => !o.ok && o.reason === "cancelled"));
    assert.equal(h.instanceOf(currentParent).state, "stopped");
  } finally {
    h.db.close();
  }
});

// 5. Fail-closed checkpoint redaction (withStepText) & escalate() -> needs_you.
test("withStepText redacts checkpoint output/error recursively and fails closed when secrets are unready", async () => {
  const secret = "TOP_SECRET_CHECKPOINT_VALUE_777";
  const registry = createKnownSecretRegistry();
  registry.register([secret]);
  const readyKnown: KnownSecretMatch = {
    match: (t) => registry.match(t),
    prefixFrom: (t) => registry.prefixFrom(t),
    ready: true,
  };
  const unreadyKnown: KnownSecretMatch = {
    match: (t) => registry.match(t),
    prefixFrom: (t) => registry.prefixFrom(t),
    ready: false,
  };

  let receivedInput: unknown;
  const innerWriter = {
    command: async (_ctx: unknown, envelope: { input: unknown }) => {
      receivedInput = envelope.input;
      return ok({ result: {}, replayed: false, as_of_seq: "1" } as never);
    },
    close: async () => {},
  } as unknown as Writer;

  const readyWriter = withStepText(innerWriter, {
    relay: () => undefined,
    known: () => readyKnown,
  });
  const okRes = await readyWriter.command({} as never, {
    command: workflowCheckpointUpsert.name,
    input: {
      instance: "wfi_00000000000000000000000001",
      key: "s1/agent#1",
      kind: "agent",
      state: "completed",
      output: {
        summary: `token=${secret}`,
        data: { nested: [`key=${secret}`] },
      },
      error: { reason: "model_error", message: `leak=${secret}` },
    },
    idempotency_key: "idk_1",
    compare: {},
    prepared: [],
  });
  assert.ok(okRes.ok);
  const serialized = JSON.stringify(receivedInput);
  assert.ok(!serialized.includes(secret));

  // Unready knownSecrets fails closed with unavailable without reaching inner writer.
  let calledUnready = false;
  const unreadyWriter = withStepText(
    {
      command: async () => {
        calledUnready = true;
        return ok({} as never);
      },
      close: async () => {},
    } as unknown as Writer,
    {
      relay: () => undefined,
      known: () => unreadyKnown,
    },
  );
  const blockedRes = await unreadyWriter.command({} as never, {
    command: workflowCheckpointUpsert.name,
    input: {
      instance: "wfi_00000000000000000000000001",
      key: "s1/agent#1",
      kind: "agent",
      state: "completed",
      output: { summary: "hello" },
    },
    idempotency_key: "idk_2",
    compare: {},
    prepared: [],
  });
  assert.ok(!blockedRes.ok);
  assert.equal(blockedRes.error.code, "unavailable");
  assert.equal(calledUnready, false);
});

// 6. Unified declaration detection (flow.ts only, legacy kind ignored) & YAML interpreter checkpoint recording.
test("declaration detects mode solely by flow.ts and built-in YAML interpreter records step checkpoints through handoff, report, restart, and retry", async () => {
  // Legacy kind: flow WITHOUT flow.ts and WITHOUT steps -> invalid_declaration.
  const missingSteps = entryOf(PRJ_A, "alpha/no-steps", {
    name: "no-steps",
    declaration: "kind: flow\nagent: lophn\n",
    flow: false,
    artifacts: { static: false, instance: false },
  });
  assert.equal(missingSteps.startable, false);
  assert.equal(missingSteps.problem?.reason, "invalid_declaration");

  // Legacy kind: agent WITH flow.ts and NO steps -> valid flow!
  const flowIgnoringKind = entryOf(PRJ_A, "alpha/code-wf", {
    name: "code-wf",
    declaration: 'flow_sdk: "2.0.0"\nkind: agent\nagent: lophn\n',
    flow: true,
    artifacts: { static: false, instance: false },
  });
  assert.equal(flowIgnoringKind.startable, true);
  assert.equal(flowIgnoringKind.kind, "flow");

  // YAML workflow without kind field: step 1 (agent) -> report --next step 2 (human) -> restart -> idle human stays started.
  const yamlDecl = [
    "participants:",
    "  worker: { agent: lophn }",
    "  me: { kind: human }",
    "steps:",
    "  build:",
    "    by: worker",
    "    prompt: build artifact",
    "    next: [review]",
    "  review:",
    "    by: me",
    "    with: worker",
    "    prompt: review with user",
    "    next: [end]",
  ].join("\n");

  const h = makeDurableHarness({
    files: [
      {
        name: "yaml-pipe",
        declaration: yamlDecl,
        flow: false,
        artifacts: { static: false, instance: false },
      },
    ],
  });
  try {
    const started = await h.service.start(
      { workflow: "alpha/yaml-pipe", text: "go" },
      { kind: "user" },
    );
    assert.ok(started.ok);
    const id = started.value.instance.id as Id<"wfi">;
    const cp1 = h.checkpointsOf(id);
    assert.equal(cp1.length, 1);
    assert.equal(cp1[0]!.key, "build");
    assert.equal(cp1[0]!.kind, "agent");
    assert.equal(cp1[0]!.state, "started");
    const sesBuild = cp1[0]!.handle_ref as Id<"ses">;
    assert.ok(sesBuild.startsWith("ses_"));

    // Restart while non-human YAML step is started -> marked interrupted + blocked (never auto-rehandoff).
    const deliveredBefore = h.delivered.length;
    await h.service.reconcile();
    assert.equal(h.delivered.length, deliveredBefore);
    assert.equal(h.checkpointsOf(id)[0]!.state, "interrupted");
    assert.equal(h.readInstance(id).derived_status, "blocked");

    // RetryWorkflowStep continues same session and restores checkpoint back to started.
    const retried = await h.service.retry({ instance: id });
    assert.ok(retried.ok);
    assert.equal(h.checkpointsOf(id)[0]!.state, "started");
    assert.equal(h.readInstance(id).derived_status, "working");

    // Report --next review marks build completed and records review as human started (needs_you).
    const reported = await h.service.report(
      {
        instance: id,
        step: "build",
        text: "build ready",
        next: "review",
      },
      { kind: "agent", session: sesBuild },
    );
    assert.ok(reported.ok);
    const cpsAfter = h.checkpointsOf(id);
    assert.equal(cpsAfter.length, 2);
    assert.equal(cpsAfter[0]!.state, "completed");
    assert.deepStrictEqual(cpsAfter[0]!.output, { summary: "build ready" });
    assert.equal(cpsAfter[1]!.key, "review");
    assert.equal(cpsAfter[1]!.kind, "human");
    assert.equal(cpsAfter[1]!.state, "started");
    assert.equal(h.readInstance(id).derived_status, "needs_you");

    // Escalate also drives derived_status to needs_you.
    assert.equal(
      deriveWorkflowStatus({
        state: "running",
        current: null,
        latestStatusLine: "escalated",
        sessions: [],
        remoteSteps: [],
      }),
      "needs_you",
    );
    const esc = await h.service.escalate({
      instance: id,
      step: "review",
      reason: "need human approval",
    });
    assert.ok(esc.ok);
    assert.ok(h.linesOf(id).some((l) => l.kind === "escalated"));
  } finally {
    h.db.close();
  }
});
