import assert from "node:assert/strict";
import { test } from "node:test";

import { contentBasis } from "../handle.ts";
import { GRANT, readApproval, submitApproval } from "./approval.ts";
import { createKinds } from "./mod.ts";
import { type Call, fakeCore, handle, id, ok } from "./kinds_fixture.ts";
import type { Called } from "./core.ts";

const APR = id("apr", 1);
const APP = id("app", 1);
const OTHER = id("app", 2);
const REL = id("rel", 1);
const PREV = id("rel", 2);
const BINDING = "b".repeat(64);
const HASH = "e".repeat(64);

function pending(
  action: Record<string, unknown>,
  requester = `app:${OTHER}`,
) {
  return {
    request: {
      id: APR,
      requester,
      run: null,
      reason_blob: "1".repeat(64),
      effect: {
        changes_blob: "2".repeat(64),
        external_blob: null,
        reversible: false,
        reversibility_blob: "3".repeat(64),
      },
      action: {
        caller: requester,
        input_hash: "4".repeat(64),
        binding_hash: BINDING,
        comparison: {},
        ...action,
      },
      expires_at: null,
      status: "pending",
      closed_reason_blob: null,
      created_seq: "12",
      closed_seq: null,
    },
    use: null,
  };
}

// 요청자가 쓴 글. 정확한 사실과 다르게 말해도 표시의 사실은 apps 읽기에서만 온다.
const TEXT = {
  approval: APR,
  reason: "Please allow this, it is totally safe.",
  changes: "Nothing important changes.",
  external: null,
  reversibility: "You can undo it any time.",
  closed_reason: null,
};

const COMPARISON = {
  previous_release: PREV,
  added_permissions: ["net.fetch api.example.com:443"],
  removed_permissions: [],
  added_commands: ["archive"],
  removed_commands: [],
  changed_commands: ["send"],
  command_changes: [{
    command: "send",
    kinds: ["effect", "confirm"],
    effect_from: "write",
    effect_to: "external",
    new_required_inputs: ["to"],
  }],
  external_commands: ["send"],
  description_only_commands: ["list"],
  added_automations: [],
  removed_automations: ["nightly"],
  changed_automations: [],
  added_screens: ["settings"],
  removed_screens: [],
  changed_screens: ["home"],
  added_problem_code_warnings: [],
  data_schema: { from: 1, to: 2 },
  data_changes: [{
    from: 1,
    to: 2,
    script_hash: "5".repeat(64),
    description: "Old notes without a date are dropped.",
  }],
  review_required: true,
};

const APP_GET = (): Called => ok({ app: { id: APP, name: "Budget" } });

function activation() {
  return pending({
    concern: "apps/releases",
    command: "release.start_activation",
    targets: [REL],
    input: {
      kind: "inline",
      value: {
        release: REL,
        approval: APR,
        previous_release: PREV,
        expected_grants_seq: 3,
        expected_schema: 1,
        key: "start-1",
      },
    },
  });
}

function releaseCore(over: Record<string, () => Called> = {}) {
  return fakeCore({
    "read:approvals/get": () => ok(activation()),
    "read:approvals/text": () => ok(TEXT),
    "read:releases/get": () =>
      ok({
        release: {
          id: REL,
          app: APP,
          number: 4,
          data_schema: 2,
          status: "prepared",
          bundle_hash: "6".repeat(64),
        },
      }),
    "read:releases/compare": () => ok({ comparison: COMPARISON }),
    "read:previews/get": () => ok({ observation: null, observed_at: null }),
    "read:apps/get": APP_GET,
    ...over,
  });
}

function reads(calls: Call[]): string[] {
  return calls.map((call) => `${call.kind}:${call.resource}/${call.method}`);
}

test("shell/confirmation-window#R5, shell/confirmation-window#R8: release activation은 apps 비교를 독립 재조회해 보이고 결정은 같은 approval binding에 묶인다", async () => {
  const core = releaseCore();
  const read = await readApproval(core, APR);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const view = read.value.view!;
  assert.equal(view.kind, "release_activation");
  assert.deepEqual(view.compare, COMPARISON);
  assert.deepEqual(view.version, {
    number: 4,
    data_schema: 2,
    status: "prepared",
  });
  assert.deepEqual(view.app, { id: APP, name: "Budget" });
  assert.equal(view.preview, null);
  // 비교는 요청이 묶은 이전 release로 읽는다.
  const compare = core.calls.find((call) => call.method === "compare")!;
  assert.deepEqual(compare.body, { release: REL, previous_release: PREV });
  // 결정 binding은 approval(요청·created_seq·binding_hash)이다. apps 표시는 binding이 아니다.
  assert.equal(read.value.targetRef, APR);
  assert.equal(
    contentBasis(read.value.content),
    contentBasis({ approval: APR, created_seq: "12", binding_hash: BINDING }),
  );
  assert.deepEqual(read.value.allowed, [
    "grant_approval_request",
    "reject_approval_request",
    "cancel_approval_request",
  ]);
  // 읽기뿐이다. 앱 결정을 열면서 preview를 시작하거나 command를 보내지 않는다.
  assert.equal(core.calls.every((call) => call.kind === "read"), true);
});

test("shell/confirmation-window#R10: 안전 preview는 apps/preview 읽기 결과가 같은 bundle로 준비됐을 때만 있다고 하고 그 밖에는 없다고 한다", async () => {
  const ready = await readApproval(
    releaseCore({
      "read:previews/get": () =>
        ok({
          observation: {
            ready: true,
            bundle_hash: "6".repeat(64),
            mode: "preview",
          },
          observed_at: null,
        }),
    }),
    APR,
  );
  assert.equal(ready.ok && ready.value.view!.preview !== null, true);
  const other = await readApproval(
    releaseCore({
      "read:previews/get": () =>
        ok({
          observation: {
            ready: true,
            bundle_hash: "7".repeat(64),
            mode: "preview",
          },
          observed_at: null,
        }),
    }),
    APR,
  );
  assert.equal(other.ok && other.value.view!.preview, null);
  const unreadable = await readApproval(
    releaseCore({
      "read:previews/get": () => ({
        ok: false,
        error: { code: "unavailable", message: "x" },
      }),
    }),
    APR,
  );
  assert.equal(unreadable.ok && unreadable.value.view!.preview, null);
});

test("shell/confirmation-window#R5: 요청과 지금 apps의 사실이 어긋나거나 apps를 못 읽으면 일부만 보이지 않고 읽기가 실패한다", async () => {
  const noCompare = await readApproval(
    releaseCore({
      "read:releases/compare": () => ({
        ok: false,
        error: { code: "unavailable", message: "x" },
      }),
    }),
    APR,
  );
  assert.equal(noCompare.ok, false);
  // 이전 release가 요청이 묶은 것과 다르다.
  const moved = await readApproval(
    releaseCore({
      "read:releases/compare": () =>
        ok({ comparison: { ...COMPARISON, previous_release: null } }),
    }),
    APR,
  );
  assert.equal(moved.ok, false);
  if (!moved.ok) assert.equal(moved.error.code, "conflict");
  // 요청 입력이 앱 결정의 접수 모양이 아니다.
  const blob = await readApproval(
    fakeCore({
      "read:approvals/get": () =>
        ok(pending({
          concern: "apps/releases",
          command: "release.start_activation",
          targets: [REL],
          input: { kind: "blob", sha256: HASH },
        })),
      "read:approvals/text": () => ok(TEXT),
    }),
    APR,
  );
  assert.equal(blob.ok, false);
});

test("shell/confirmation-window#R5: 앱 결정이 아닌 approval은 apps를 읽지 않고 그대로 approval 종류다", async () => {
  const core = fakeCore({
    "read:approvals/get": () =>
      ok(pending({
        concern: "documents/addressing",
        command: "document.rename",
        targets: [id("doc", 1)],
        input: { kind: "inline", value: { name: "a.md" } },
      })),
    "read:approvals/text": () => ok(TEXT),
  });
  const read = await readApproval(core, APR);
  assert.equal(read.ok && read.value.view!.kind, "approval");
  assert.deepEqual(reads(core.calls), [
    "read:approvals/get",
    "read:approvals/text",
  ]);
});

const FS = {
  kind: "fs.read",
  path: "/Users/someone/Documents/very/long/path",
  recursive: true,
};

function grantRequest(scope: Record<string, unknown>, app = APP) {
  return pending({
    concern: "apps/permissions",
    command: "grant.create",
    targets: [app],
    input: {
      kind: "inline",
      value: { app, kind: scope.kind, scope, approval: APR },
    },
    comparison: { grants_seq: "7" },
  });
}

function grantCore(
  scope: Record<string, unknown>,
  display: Record<string, unknown> | null,
  over: Record<string, () => Called> = {},
) {
  return fakeCore({
    "read:approvals/get": () => ok(grantRequest(scope)),
    "read:approvals/text": () => ok(TEXT),
    "read:grants/list": () => ok({ grants: [], display }),
    "read:apps/get": APP_GET,
    ...over,
  });
}

const DISPLAY = {
  app: APP,
  release: REL,
  requirements: [{
    kind: "fs.read",
    scope: { path: FS.path, recursive: true },
    reason: "Reads your statements.",
    granted: false,
    warnings: ["permissions.warning.outside-link"],
    outside_links: ["/Users/someone/Documents/very/long/path/link-out"],
  }, {
    kind: "net.fetch",
    scope: { host: "api.example.com", port: 443 },
    reason: "Looks up rates.",
    granted: false,
    warnings: [],
    outside_links: [],
  }],
  combination_warnings: [{
    key: "permissions.warning.file-read-and-network",
    kinds: ["fs.read", "net.fetch"],
  }],
  limit_keys: ["permissions.limit.not-isolated", "permissions.limit.rss"],
};

test("shell/confirmation-window#R8: grant는 요청 범위 원문 전체를 요청 입력에서 그대로 싣고 조합 경고와 한계 key는 apps 읽기에서만 온다", async () => {
  const read = await readApproval(grantCore(FS, DISPLAY), APR);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const view = read.value.view!;
  assert.equal(view.kind, "grant");
  // 줄이지 않은 원문 경로. kind는 범위가 아니라 별도 값이다.
  assert.deepEqual(view.access, {
    kind: "fs.read",
    scope: { path: FS.path, recursive: true },
  });
  assert.deepEqual(view.combination_warnings, [
    "permissions.warning.file-read-and-network",
  ]);
  assert.deepEqual(view.limit_keys, DISPLAY.limit_keys);
  assert.deepEqual(view.requirement, {
    reason: "Reads your statements.",
    granted: false,
    warnings: ["permissions.warning.outside-link"],
    outside_links: ["/Users/someone/Documents/very/long/path/link-out"],
  });
  assert.equal(view.target_app, null);
});

test("shell/confirmation-window#R8: 앱 쌍 연결은 부르는 앱과 대상 앱, command 범위를 grant 종류로 보인다", async () => {
  const scope = { kind: "app.call", app: OTHER, commands: ["list", "send"] };
  const core = grantCore(scope, { ...DISPLAY, requirements: [] }, {
    "read:apps/get": (() => {
      let n = 0;
      return () =>
        ok({
          app: {
            id: n++ === 0 ? APP : OTHER,
            name: n === 1 ? "Budget" : "Mailer",
          },
        });
    })(),
  });
  const read = await readApproval(core, APR);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const view = read.value.view!;
  assert.equal(view.kind, "grant");
  assert.deepEqual(view.app, { id: APP, name: "Budget" });
  assert.deepEqual(view.target_app, { id: OTHER, name: "Mailer" });
  assert.deepEqual(view.access, {
    kind: "app.call",
    scope: { app: OTHER, commands: ["list", "send"] },
  });
});

test("shell/confirmation-window#R5: grant 경고 자료가 없거나 범위가 요청과 어긋나면 읽기가 실패한다", async () => {
  const noDisplay = await readApproval(grantCore(FS, null), APR);
  assert.equal(noDisplay.ok, false);
  // 입력의 kind와 scope의 kind가 다르다.
  const mismatch = await readApproval(
    fakeCore({
      "read:approvals/get": () =>
        ok(pending({
          concern: "apps/permissions",
          command: "grant.create",
          targets: [APP],
          input: {
            kind: "inline",
            value: { app: APP, kind: "net.fetch", scope: FS, approval: APR },
          },
        })),
      "read:approvals/text": () => ok(TEXT),
      "read:grants/list": () => ok({ grants: [], display: DISPLAY }),
    }),
    APR,
  );
  assert.equal(mismatch.ok, false);
});

const WHEN = { kind: "interval", interval_ms: 3_600_000 };
const AUTOMATION_SCOPE = {
  kind: "automation.run",
  automation: "nightly",
  command: "sync",
  input_hash: HASH,
  when: WHEN,
};

function automationCore(over: Record<string, () => Called> = {}) {
  return fakeCore({
    "read:approvals/get": () => ok(grantRequest(AUTOMATION_SCOPE)),
    "read:approvals/text": () => ok(TEXT),
    "read:apps/get": APP_GET,
    "read:apps/blueprint": () =>
      ok({
        app: APP,
        release: REL,
        commands: [{
          key: "sync",
          label: "Sync",
          description: "Fetches new rows from the bank.",
          effect: "external",
          confirm: false,
          input: null,
        }],
        automations: [{
          key: "nightly",
          label: "Nightly sync",
          command: "sync",
          when: WHEN,
        }],
        declarations: {
          automations: [{
            key: "nightly",
            command: "sync",
            external: true,
            input_hash: HASH,
            when: WHEN,
          }],
        },
      }),
    "read:apps/automations": () =>
      ok({
        app: APP,
        automations: [{
          key: "nightly",
          declared: true,
          runnable: false,
          observed: false,
          release: REL,
        }],
        observed_at: null,
      }),
    ...over,
  });
}

test("shell/confirmation-window#R5: automation 켜기는 승인할 command·고정 입력·주기를 지금 선언과 정확히 맞춰 읽는다", async () => {
  const read = await readApproval(automationCore(), APR);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const view = read.value.view!;
  assert.equal(view.kind, "automation");
  assert.deepEqual(view.automation, {
    key: "nightly",
    label: "Nightly sync",
    when: WHEN,
    input_hash: HASH,
    external: true,
    runnable: false,
    reason: null,
  });
  assert.equal((view.app_command as Record<string, unknown>).effect, "external");
  assert.equal(
    (view.app_command as Record<string, unknown>).description,
    "Fetches new rows from the bank.",
  );
  // 선언이 승인 범위와 다르면(고정 입력이 바뀜) 옛 승인을 보이지 않는다.
  const otherInput = await readApproval(
    automationCore({
      "read:apps/blueprint": () =>
        ok({
          app: APP,
          release: REL,
          commands: [{
            key: "sync",
            label: "Sync",
            description: "x",
            effect: "external",
            confirm: false,
            input: null,
          }],
          automations: [],
          declarations: {
            automations: [{
              key: "nightly",
              command: "sync",
              external: true,
              input_hash: "f".repeat(64),
              when: WHEN,
            }],
          },
        }),
    }),
    APR,
  );
  assert.equal(otherInput.ok, false);
  if (!otherInput.ok) assert.equal(otherInput.error.code, "conflict");
});

const ACCEPT = {
  app: APP,
  release: REL,
  command: "pay",
  input_hash: HASH,
  approval: APR,
  key: "k-1",
  process_nonce: "n".repeat(26),
  caller: { kind: "app", app: OTHER, release: PREV },
};

function confirmCore(over: Record<string, () => Called> = {}) {
  return fakeCore({
    "read:approvals/get": () =>
      ok(pending({
        concern: "apps/invocations",
        command: "invocation.accept_confirm",
        targets: [APP, REL],
        input: { kind: "inline", value: ACCEPT },
        comparison: { release: REL },
      })),
    "read:approvals/text": () => ok(TEXT),
    "read:apps/get": APP_GET,
    "read:apps/blueprint": () =>
      ok({
        app: APP,
        release: REL,
        commands: [{
          key: "pay",
          label: "Pay invoice",
          description: "Sends the payment to the bank.",
          effect: "external",
          confirm: true,
          input: { type: "object" },
        }],
        automations: [],
        declarations: { automations: [] },
      }),
    ...over,
  });
}

test("shell/confirmation-window#R10: confirm command는 정확한 release의 command 선언과 입력 지문을 보이고 입력이 아닌 것을 입력인 척하지 않는다", async () => {
  const read = await readApproval(confirmCore(), APR);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const view = read.value.view!;
  assert.equal(view.kind, "confirm_command");
  assert.deepEqual(view.app_command, {
    key: "pay",
    label: "Pay invoice",
    description: "Sends the payment to the bank.",
    effect: "external",
    confirm: true,
    input: { type: "object" },
  });
  assert.equal(view.input_hash, HASH);
  // 요청이 싣고 온 정확한 동작(concern·command·대상)은 apps 표시에 덮이지 않는다.
  assert.equal(view.concern, "apps/invocations");
  assert.equal(view.command, "invocation.accept_confirm");
  assert.deepEqual(view.targets, [APP, REL]);
  assert.deepEqual((view.caller as Record<string, unknown>).kind, "app");
  // release가 바뀌었거나 confirm 명령이 아니면 새 요청이 있어야 한다.
  const moved = await readApproval(
    confirmCore({
      "read:apps/blueprint": () =>
        ok({
          app: APP,
          release: PREV,
          commands: [],
          automations: [],
          declarations: { automations: [] },
        }),
    }),
    APR,
  );
  assert.equal(moved.ok, false);
});

test("platform/approvals#R9, shell/confirmation-window#R9: 앱 결정의 허락은 approvals 허락 command에 handle과 요청의 CAS(created_seq·binding_hash)만 붙여 보낸다", async () => {
  const core = releaseCore({
    "command:approvals/grant": () => ok({ request: {} }),
  });
  const kinds = createKinds({
    core: () => core,
    clock: { now: () => 1 },
    random: (bytes) => bytes.fill(1),
  });
  const read = await kinds.canon.read(
    { kind: "approval_request", approval: APR },
    "cfw_1",
  );
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const sent = await kinds.submit.submit({
    handle: handle(),
    decision: GRANT,
    commandInput: { input: { binding_hash: "forged" }, approval: "x" },
    canonical: read.value,
  });
  assert.equal(sent.ok, true);
  const grant = core.calls.find((call) => call.method === "grant")!;
  assert.equal(grant.kind, "command");
  assert.equal(grant.resource, "approvals");
  const body = grant.body as Record<string, unknown>;
  // renderer가 보낸 입력은 쓰지 않고 정본의 binding만 쓴다.
  assert.deepEqual(body.input, {
    approval: APR,
    created_seq: "12",
    binding_hash: BINDING,
  });
  assert.deepEqual(body.compare, { created_seq: "12" });
  assert.equal(body.confirmation, "H".repeat(43));
  // activation·grant·accept_confirm을 이 창이 직접 부르지 않는다.
  assert.equal(
    core.calls.filter((call) => call.kind === "command").length,
    1,
  );
  const direct = await submitApproval(core, {
    handle: handle(),
    decision: "start_activation",
    approval: APR,
    createdSeq: "12",
    bindingHash: BINDING,
    commandInput: {},
  });
  assert.equal(direct.ok, false);
});
