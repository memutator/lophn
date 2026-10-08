// 사람이 Operator를 붙이는 화면 통로(shell#T54에서 넘어온 것)를 실제 core에서 끝까지 본다.
// 화면은 approvals/create(requester·caller user, action ApplyOperatorAssignment)로 요청을 만들고
// 보호 창 허락(fake confirmation handle) 뒤 approvals/apply를 user 자격으로 부른다. 실제
// core 조립(임시 LOPHN_HOME)에서 그 dispatch가 machine 전용이었던 ApplyOperatorAssignment를
// 부르고 승인 결정 seq가 확정된 뒤 assignment가 붙는다. provider는 부르지 않고 사람 데이터
// root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  canonicalize,
  fingerprint,
  sha256Hex,
} from "../../packages/base/mod.ts";
import {
  applyOperatorAssignment,
  applyOperatorAssignmentInputSchema,
} from "../../packages/contracts/lophn-agent/mod.ts";
import type { ApprovalAction } from "../../packages/contracts/platform/mod.ts";
import { approvalBinding } from "../../packages/contracts/platform/mod.ts";
import type { ActorKind } from "../../packages/contracts/platform/mod.ts";
import { type CoreHarness, createCoreHarness } from "./testing/core.ts";

const PRESET = "pst_01arz3ndektsv4rrffq69g5fav";
const SLOT = "asg_01arz3ndektsv4rrffq69g5fav";
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";

const APPLIES =
  "select count(*) as n from events where type = 'AssignmentCreated'";

type Login = {
  token: string;
  context: { actor: ActorKind; principal: string };
};

const OPERATIONS = [
  "RegisterDefaultPreset",
  "create_approval_request",
  "grant_approval_request",
  "reject_approval_request",
  "cancel_approval_request",
  "apply_approved_action",
  "GetApproval",
  "ListApprovals",
  "ReadApprovalText",
  "ApplyOperatorAssignment",
  "ReadAssignment",
  "ListAssignments",
];

async function login(
  harness: CoreHarness,
  actor: ActorKind,
  principal: string,
  targets: Record<string, string> = {},
): Promise<Login> {
  const issued = await harness.credential({
    actor,
    principal,
    scope: { operations: OPERATIONS, targets },
    conditions: {},
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  return { token: issued.value.token, context: { actor, principal } };
}

async function post(
  harness: CoreHarness,
  path: string,
  token: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${harness.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch { /* 본문이 JSON이 아니다 */ }
  return { status: response.status, body: json };
}

function command(
  input: unknown,
  extra: { compare?: unknown; confirmation?: string; key?: string } = {},
) {
  return {
    input,
    idempotency_key: extra.key ?? `k-${crypto.randomUUID()}`,
    compare: extra.compare ?? {},
    prepared: [],
    ...(extra.confirmation === undefined
      ? {}
      : { confirmation: extra.confirmation }),
  };
}

// preset은 제품 preset validator_deps 없이 등록하는 길이 없어 user가 만든다.
async function createPreset(
  harness: CoreHarness,
  user: Login,
): Promise<string> {
  const definition = {
    kind: "operator",
    name: "Weekly watch",
    origin: "user",
    prompt: "ab".repeat(32),
    capability: { bundles: [], tools: [] },
    context: [{ kind: "assignment_scope", target: null, section: null }],
    mcp: { servers: [], tools: [] },
    safe_tools: [],
    skills: [],
    model: null,
    organizing_model: null,
    instructions: [],
  };
  const created = await post(
    harness,
    "presets/create",
    user.token,
    command({
      id: PRESET,
      definition,
      copied_from: null,
    }),
  );
  assertEquals(created.status, 200, JSON.stringify(created.body));
  const read = await post(harness, "presets/read", user.token, {
    preset: PRESET,
  });
  assertEquals(read.status, 200, JSON.stringify(read.body));
  return (read.body["preset"] as {
    definition_hash: string;
    revision: number;
  }).definition_hash;
}

// 화면 통로의 승인 요청 본문. 지문은 platform과 같은 canonical JSON의 sha256이다.
async function actionOf(
  harness: CoreHarness,
  approval: string,
  bundleHash: string,
): Promise<ApprovalAction> {
  void harness;
  const bundle = {
    draft_version: "ver_01arz3ndektsv4rrffq69g5fav",
    assignment: null,
    expected_assignment_revision: null,
    preset: PRESET,
    preset_revision: 1,
    preset_definition: bundleHash,
    scope: { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fav" },
    outputs: [{ document: DOC, content: "watch changes" }],
    read_apps: [],
    read_commands: [],
    schedule: {
      first_at: new Date(Date.now() + 60_000).toISOString(),
      every_ms: 60_000,
    },
    reason: "Attached from the roles screen.",
  };
  const value = {
    approval,
    id: SLOT,
    bundle,
  } as unknown as Parameters<typeof approvalBinding>[0] extends never ? never
    : NonNullable<ReturnType<typeof JSON.parse>>;
  const base = {
    concern: "lophn-agent/assignments",
    command: applyOperatorAssignment.name,
    caller: "user" as const,
    targets: [SLOT],
    input: { kind: "inline" as const, value },
    input_hash: await fingerprint(value),
    comparison: {},
  };
  return {
    ...base,
    binding_hash: await fingerprint(approvalBinding({
      ...base,
      binding_hash: "0",
    })),
  };
}

// 사람이 confirmation window에서 본 내용으로 handle을 발급한다. 승인 결정은
// route가 선언한 binding field(approval·bundle)의 내용 기준으로 묶인 handle이어야 한다.
async function confirmWindow(
  harness: CoreHarness,
  input: Record<string, unknown>,
): Promise<string> {
  const binding: Record<string, unknown> = {
    approval: input["approval"],
    bundle: input["bundle"],
  };
  const content = await sha256Hex(canonicalize(binding));
  const issued = await harness.confirmation({
    action: "issue",
    request: {
      type: "confirmation_handle_register",
      window_id: "win-operator",
      target_ref: String(binding.approval),
      content_hash: content,
      allowed_decisions: [applyOperatorAssignment.name],
      expires_at: new Date(Date.now() + 120_000).toISOString(),
    },
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  return (issued.value as { confirmation: string }).confirmation;
}

Deno.test("platform/approvals#R5 lophn-agent/assignments#R4: 사람이 Operator 붙이기를 승인하면 user 자격의 approvals/apply dispatch가 machine 전용이었던 ApplyOperatorAssignment를 부르고 승인 결정 seq로 assignment가 붙는다", async () => {
  const opened = await createCoreHarness({ io: true });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    const user = await login(harness, "user", "user-1");
    const bundleHash = await createPreset(harness, user);
    const approval = "apr_01arz3ndektsv4rrffq69g5faa";

    // 화면이 승인 요청을 만든다: requester·caller user, action ApplyOperatorAssignment.
    const action = await actionOf(harness, approval, bundleHash);
    const created = await post(
      harness,
      "approvals/create",
      user.token,
      command({
        id: approval,
        requester: user.context.actor,
        run: null,
        reason: "Attached from the roles screen.",
        effect: {
          changes:
            "Attaches or changes an Operator exactly as shown: its Preset version, where it works, the documents it reports to, the apps it may read, and its Repeating check.",
          external: null,
          reversible: true,
          reversibility:
            "You can pause, resume, or withdraw the Operator at any time.",
        },
        action,
        expires_at: null,
      }, { key: "operator-approval-1" }),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));

    // 승인 없이 user가 직접 부르는 길은 열지 않는다: 결정 보호 창 handle이 없다.
    const direct = await post(
      harness,
      "assignments/apply-operator",
      user.token,
      command({
        approval,
        id: SLOT,
        bundle: (action.input as { value: Record<string, unknown> }).value
          .bundle,
      }),
    );
    assertEquals(direct.status, 403, JSON.stringify(direct.body));

    // 사람이 보호 창에서 허락한다.
    const request = created.body["request"] as {
      created_seq: string;
      action: { binding_hash: string };
    };
    const grantInput = {
      approval,
      created_seq: request.created_seq,
      binding_hash: action.binding_hash,
    };
    const granted = await post(
      harness,
      "approvals/grant",
      user.token,
      command(
        grantInput,
        {
          compare: { created_seq: grantInput.created_seq },
          confirmation: await confirmWindow(harness, grantInput),
        },
      ),
    );
    assertEquals(granted.status, 200, JSON.stringify(granted.body));

    // 허락 뒤 화면이 approvals/apply를 user 자격으로 부른다.
    const applied = await post(
      harness,
      "approvals/apply",
      user.token,
      command({
        approval,
        action,
        idempotency_key: "operator-apply-1",
      }, { key: "operator-apply-1" }),
    );
    assertEquals(applied.status, 200, JSON.stringify(applied.body));

    // assignment가 붙었다: enabled operator 하나다.
    const listed = await post(harness, "assignments/list", user.token, {
      role: "operator",
    });
    assertEquals(listed.status, 200, JSON.stringify(listed.body));
    const operators = listed.body["assignments"] as {
      id: string;
      role: string;
      state: string;
      approval: string | null;
      outputs: { document: string; content: string }[];
    }[];
    assertEquals(operators.length, 1);
    assertEquals(operators[0]!.id, SLOT);
    assertEquals(operators[0]!.state, "enabled");
    assertEquals(operators[0]!.approval, approval);
    assertEquals(operators[0]!.outputs[0]!.document, DOC);
    // 적용 command의 결정 seq는 입력이 아니라 승인 기록이 확정한다
    // (lophn-agent#T53의 decision_seq 맞춤).
    assertEquals(
      (action.input as { value: { decision_seq?: string } }).value
        .decision_seq,
      undefined,
    );
    // 결정은 사람이 본 구성(bundle)과 승인에 묶인다(lophn-agent#T53).
    assertEquals(applyOperatorAssignment.binding, ["approval", "bundle"]);
    // 입력 모양 맞춤: 접수 필드(approval·id)와 초안 번들은 apply contract의
    // 입력 schema를 그대로 통과하고 결정 seq는 생략할 수 있다.
    const inline = action.input as {
      value: Record<string, unknown>;
    };
    assert(applyOperatorAssignmentInputSchema.safeParse(inline.value).success);
    assert(
      applyOperatorAssignmentInputSchema.safeParse({
        ...inline.value,
        decision_seq: "3",
      }).success,
    );
    assertEquals(countOf(harness, APPLIES), 1);
  } finally {
    await harness.close();
  }
});

function countOf(harness: CoreHarness, query: string): number {
  const ledger = new DatabaseSync(`${harness.dataRoot}/lophn.db`, {
    readOnly: true,
  });
  try {
    return Number((ledger.prepare(query).get() as { n: number }).n);
  } finally {
    ledger.close();
  }
}
