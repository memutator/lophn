import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalize, err, ok } from "../../../../base/mod.ts";
import type {
  ActivationComparison,
  ActivationDataResult,
  ReleaseRecord,
} from "../../../../protocol/apps/mod.ts";
import type { AppDeclaration } from "../../declaration/mod.ts";
import { createActivationHandlers } from "./handler.ts";
import { type ContractChangedInfo, runActivation } from "./orchestrator.ts";
import type { ActivationPorts } from "./steps.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const NEW = "rel_01arz3ndektsv4rrffq69g5fb2";
const OLD = "rel_01arz3ndektsv4rrffq69g5fb1";
const ATTEMPT = "act_01arz3ndektsv4rrffq69g5fav";
const HASH = "a".repeat(64);

const release = {
  id: NEW,
  app: APP,
  number: 2,
  bundle_hash: HASH,
  data_schema: 2,
  data_changes: [{ from: 1, to: 2, script_hash: HASH, description: "add" }],
  status: "activating",
  activation: {
    attempt: ATTEMPT,
    previous_release: OLD,
    backup_hash: null,
    data_change_invocation: null,
    started_at: "2026-10-16T00:00:00.000Z",
  },
} as unknown as ReleaseRecord;

function result(schema: number): ActivationDataResult {
  return {
    release: NEW,
    attempt: ATTEMPT,
    invocation: null,
    data_schema: schema,
    integrity_ok: true,
  } as ActivationDataResult;
}

// 실제 DB는 schema 1이고 migration이 실패한다. restore가 돌려주는 schema만 경우마다 다르다.
function fake(restoredSchema: number) {
  const calls: string[] = [];
  const failures: unknown[] = [];
  const unavailable: string[] = [];
  const ports: ActivationPorts = {
    intake: {
      close: () => calls.push("close"),
      whenIdle: () => Promise.resolve({ idle: true }),
      abandon: () => Promise.resolve(),
      open: () => calls.push("open"),
    },
    supervisor: {
      stopCurrent: () => Promise.resolve(true),
      stopCandidate: () => Promise.resolve(true),
      startCandidate: () => {
        calls.push("startCandidate");
        return Promise.resolve(err({ code: "unavailable", message: "x" }));
      },
      openCandidate: () => Promise.resolve(ok(undefined)),
      run: (_app, id) => {
        calls.push(`run:${id}`);
        return Promise.resolve(ok(undefined));
      },
    },
    data: {
      inspect: () =>
        Promise.resolve(ok({ data_schema: 1, integrity_ok: true })),
      backup: () =>
        Promise.resolve(ok({ result: result(1), backup_hash: HASH })),
      migrate: () => {
        calls.push("migrate");
        return Promise.resolve(
          err({
            code: "unavailable",
            message: "step 1-2 was rolled back: NOT NULL constraint failed",
          }),
        );
      },
      restore: () => {
        calls.push("restore");
        return Promise.resolve(ok(result(restoredSchema)));
      },
    },
    core: {
      release: () => Promise.resolve(ok(release)),
      recordBackup: () => Promise.resolve(ok(undefined)),
      recordDataChange: () => Promise.resolve(ok(undefined)),
      recordDataRestore: (restored) => {
        calls.push("recordRestore");
        return Promise.resolve(
          restored.data_schema === 1
            ? ok(undefined)
            : err({ code: "conflict", message: "schema" }),
        );
      },
      completeActivation: () => {
        calls.push("complete");
        return Promise.resolve(ok(undefined));
      },
      failActivation: (input) => {
        failures.push(input.failure);
        return Promise.resolve(ok(undefined));
      },
      markUnavailable: (_app, _release, reason) => {
        unavailable.push(reason.code);
        return Promise.resolve();
      },
    },
    after: {
      pruneChangesets: () => Promise.resolve(),
      viewChanged: () => {},
    },
    progress: () => {},
    newInvocation: () => "inv_01arz3ndektsv4rrffq69g5fav",
  };
  return { ports, calls, failures, unavailable };
}

test("activation이 실패하면 복구본으로 되돌리고 이전 release가 남는다", async () => {
  const restored = fake(1);
  const outcome = await runActivation(restored.ports, release);
  assert.deepStrictEqual(outcome, {
    status: "failed",
    code: "migration_failed",
    previous: "started",
  });
  assert.deepStrictEqual(restored.failures, [
    {
      code: "migration_failed",
      summary:
        "the data change failed: step 1-2 was rolled back: NOT NULL constraint failed",
      restored: true,
    },
  ]);
  assert.ok(restored.calls.includes("restore"));
  assert.ok(restored.calls.includes(`run:${OLD}`));
  assert.ok(!restored.calls.includes("complete"));
  assert.deepStrictEqual(restored.calls.at(-1), "open");

  // 복원된 schema가 확인되지 않으면 이전 코드를 시작하지 않고 앱을 사용할 수 없는 상태로 둔다.
  const unconfirmed = fake(0);
  const stuck = await runActivation(unconfirmed.ports, release);
  assert.deepStrictEqual(stuck, {
    status: "unavailable",
    code: "restore_failed",
  });
  assert.deepStrictEqual(unconfirmed.unavailable, ["restore_failed"]);
  assert.deepStrictEqual(unconfirmed.failures, []);
  assert.ok(!unconfirmed.calls.includes(`run:${OLD}`));
});

function succeedingPorts(targetRelease: ReleaseRecord): ActivationPorts {
  return {
    intake: {
      close: () => {},
      whenIdle: () => Promise.resolve({ idle: true }),
      abandon: () => Promise.resolve(),
      open: () => {},
    },
    supervisor: {
      stopCurrent: () => Promise.resolve(true),
      stopCandidate: () => Promise.resolve(true),
      startCandidate: () =>
        Promise.resolve(
          ok({
            nonce: "n1",
            attestation: {
              release: targetRelease.id,
              bundle_hash: HASH,
              tools: [],
              data_schema: targetRelease.data_schema,
              process_nonce: "n1",
              connection_ok: true as const,
            },
          }),
        ),
      openCandidate: () => Promise.resolve(ok(undefined)),
      run: () => Promise.resolve(ok(undefined)),
    },
    data: {
      inspect: () =>
        Promise.resolve(
          ok({ data_schema: targetRelease.data_schema, integrity_ok: true }),
        ),
      backup: () =>
        Promise.resolve(ok({ result: result(1), backup_hash: HASH })),
      migrate: () => Promise.resolve(ok(result(targetRelease.data_schema))),
      restore: () => Promise.resolve(ok(result(1))),
    },
    core: {
      release: () => Promise.resolve(ok(targetRelease)),
      recordBackup: () => Promise.resolve(ok(undefined)),
      recordDataChange: () => Promise.resolve(ok(undefined)),
      recordDataRestore: () => Promise.resolve(ok(undefined)),
      completeActivation: () => Promise.resolve(ok(undefined)),
      failActivation: () => Promise.resolve(ok(undefined)),
      markUnavailable: () => Promise.resolve(),
    },
    after: {
      pruneChangesets: () => Promise.resolve(),
      viewChanged: () => {},
    },
    progress: () => {},
    newInvocation: () => "inv_01arz3ndektsv4rrffq69g5fav",
  };
}

const PREV_DECL: Pick<AppDeclaration, "commands" | "skills" | "events"> = {
  commands: [
    {
      name: "legacy_cmd",
      description: "old public command",
      effect: "read",
      public: true,
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "changed_cmd",
      description: "v1",
      effect: "write",
      public: true,
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
      },
    },
  ],
  skills: [
    {
      name: "helper-skill",
      public: true,
      commands: ["legacy_cmd"],
    },
  ],
  events: [
    {
      name: "item_created",
      description: "v1 event",
      payloadSchema: {
        type: "object",
        properties: { id: { type: "string" } },
      },
    },
  ],
};

const NEXT_DECL: Pick<AppDeclaration, "commands" | "skills" | "events"> = {
  commands: [
    {
      name: "changed_cmd",
      description: "v2",
      effect: "write",
      public: true,
      inputSchema: {
        type: "object",
        properties: { id: { type: "number" } },
      },
    },
  ],
  skills: [],
  events: [
    {
      name: "item_created",
      description: "v2 event",
      payloadSchema: {
        type: "object",
        properties: { id: { type: "string" }, count: { type: "number" } },
      },
    },
  ],
};

test("onContractChanged가 즉시 release.activate와 activation.consent [Allow] 모두에서 previousRelease -> nextRelease diff로 호출된다", async () => {
  const declarations = new Map<
    string,
    Pick<AppDeclaration, "commands" | "skills" | "events">
  >([
    [OLD, PREV_DECL],
    [NEW, NEXT_DECL],
  ]);

  const preparedRelease = {
    ...release,
    status: "prepared",
    data_schema: 1,
    data_changes: [],
    activation: null,
  } as unknown as ReleaseRecord;

  const activatingRelease = {
    ...preparedRelease,
    status: "activating",
    activation: {
      attempt: ATTEMPT,
      previous_release: OLD,
      backup_hash: null,
      data_change_invocation: null,
      started_at: "2026-10-16T00:00:00.000Z",
    },
  } as unknown as ReleaseRecord;

  // 1) 즉시 activate (동의 불필요)
  const directReceived: ContractChangedInfo[] = [];
  const noConsentComparison: ActivationComparison = {
    first: false,
    previous_release: OLD as never,
    added_resources: [],
    added_tools: [],
    loss_steps: [],
  };
  const directEnqueued: string[] = [];
  const directHandlers = createActivationHandlers({
    releases: {
      get: () => ok(preparedRelease),
      comparison: () => Promise.resolve(ok(noConsentComparison)),
    },
    consents: { ask: () => Promise.resolve(ok(undefined)) },
    enqueue: (_app, relId) => {
      directEnqueued.push(relId);
      return ok(undefined);
    },
  });
  const directDecision = await directHandlers.activate(preparedRelease);
  assert.ok(directDecision.ok);
  assert.strictEqual(directDecision.value, "started");
  assert.deepStrictEqual(directEnqueued, [NEW]);

  const directOutcome = await runActivation(
    succeedingPorts(activatingRelease),
    activatingRelease,
    {
      loadDeclaration: (id) => ok(declarations.get(id) ?? null),
      onContractChanged: (info) => {
        directReceived.push(info);
      },
    },
  );
  assert.deepStrictEqual(directOutcome, { status: "active", opened: true });
  assert.strictEqual(directReceived.length, 1);
  assert.strictEqual(directReceived[0].app, APP);
  assert.strictEqual(directReceived[0].previousRelease, OLD);
  assert.strictEqual(directReceived[0].nextRelease, NEW);
  assert.deepStrictEqual(directReceived[0].changes, [
    { surface: "command", name: "changed_cmd", change: "changed" },
    { surface: "command", name: "legacy_cmd", change: "removed" },
    { surface: "skill", name: "helper-skill", change: "removed" },
    { surface: "event", name: "item_created", change: "changed" },
  ]);

  // 2) activation.consent [Allow] 경로 (동의 필요 후 허용)
  const consentReceived: ContractChangedInfo[] = [];
  const needsConsentComparison: ActivationComparison = {
    first: false,
    previous_release: OLD as never,
    added_resources: ["network:api.example.com"],
    added_tools: [],
    loss_steps: [],
  };
  let askedComparison: ActivationComparison | null = null;
  const consentEnqueued: string[] = [];
  const consentHandlers = createActivationHandlers({
    releases: {
      get: () => ok(preparedRelease),
      comparison: () => Promise.resolve(ok(needsConsentComparison)),
    },
    consents: {
      ask: (_rel, cmp) => {
        askedComparison = cmp;
        return Promise.resolve(ok(undefined));
      },
    },
    enqueue: (_app, relId) => {
      consentEnqueued.push(relId);
      return ok(undefined);
    },
  });
  const waiting = await consentHandlers.activate(preparedRelease);
  assert.ok(waiting.ok);
  assert.strictEqual(waiting.value, "waiting_consent");
  assert.notStrictEqual(askedComparison, null);

  const allowed = await consentHandlers.consented({
    release: NEW,
    comparison: canonicalize(askedComparison),
  });
  assert.ok(allowed.ok);
  assert.deepStrictEqual(consentEnqueued, [NEW]);

  const consentOutcome = await runActivation(
    succeedingPorts(activatingRelease),
    activatingRelease,
    {
      loadDeclaration: (id) => ok(declarations.get(id) ?? null),
      onContractChanged: (info) => {
        consentReceived.push(info);
      },
    },
  );
  assert.deepStrictEqual(consentOutcome, { status: "active", opened: true });
  assert.strictEqual(consentReceived.length, 1);
  assert.deepStrictEqual(consentReceived[0], directReceived[0]);

  // 3) 계약 변화가 없으면 onContractChanged는 호출되지 않는다.
  const noDiffReceived: ContractChangedInfo[] = [];
  await runActivation(succeedingPorts(activatingRelease), activatingRelease, {
    loadDeclaration: () => ok(PREV_DECL),
    onContractChanged: (info) => {
      noDiffReceived.push(info);
    },
  });
  assert.strictEqual(noDiffReceived.length, 0);
});
