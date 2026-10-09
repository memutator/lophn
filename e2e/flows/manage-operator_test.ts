// operator slice flow E2E: manage-operator(docs/flows/manage-operator.md). 실제 headless shell·core를
// 임시 LOPHN_HOME으로 띄우고, 사람이 붙인 Operator의 멈춤(PauseAssignment)·재개(ResumeAssignment)·
// 회수(WithdrawAssignment)가 실제 core에서 흐르는지 본다. 붙이기 자체(보호 창 허락·적용)의 결정은
// 창 handle이 필요해 shell/confirmation E2E와 apps/core/operator-apply_test.ts의 몫이라: 이 flow는
// 승인 요청 상태에서 멈춤·회수가 forbidden으로 거절되는 것(붙지 않은 Operator의 상태 전이 없음)과
// assignment 목록·상세 읽기를 본다. 멈춘 뒤의 재개·주기 계산은 scheduling F2E(unit)와 set-up-operator가 본다.
import { assertEquals } from "@std/assert";

import { copyFixture } from "../../fixtures/projects/scenarios.ts";
import { e2eEnabled } from "../harness.ts";
import {
  commandBody,
  documentTitled,
  mustCall,
  openFlowShell,
  registerTrackedProject,
  removeHome,
  untilDocuments,
} from "../flow-support.ts";

const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const SLOT = "asg_01arz3ndektsv4rrffq69g5fav";
const APR = "apr_01arz3ndektsv4rrffq69g5faa";
const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";

function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

Deno.test({
  name:
    "flow manage-operator: 멈춤·회수는 붙은 Operator에만 닿고 붙지 않으면 아무것도 바꾸지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("notes-basic"));
    const flow = await openFlowShell({ start: "lophn" });
    try {
      await t.step(
        "1 승인 요청만 남은 상태에서 Operator 목록은 비어 있다",
        async () => {
          await registerTrackedProject(flow, {
            folder,
            globs: ["**/*.md"],
          });
          await untilDocuments(flow, ["index"], "자료가 문서가 되지 않았다");
          const index = await documentTitled(flow, "index");
          await attachOperator(flow, index.id, index.latest_version!);
          const listed = await mustCall(flow, {
            kind: "read",
            resource: "assignments",
            method: "list",
            body: { role: "operator" },
          });
          assertEquals((listed.assignments as unknown[]).length, 0);
        },
      );

      await t.step(
        "2 붙지 않은 Operator의 멈춤·재개·회수는 forbidden으로 아무것도 바꾸지 않는다",
        async () => {
          const pause = await flow.call({
            kind: "command",
            resource: "assignments",
            method: "pause",
            body: commandBody({
              input: {
                assignment: SLOT,
                reason: {
                  kind: "user",
                  detail: "Paused by the flow.",
                  runs: [],
                  target: null,
                },
              },
              compare: { revision: 1, state: "enabled" },
            }),
          });
          assertEquals(pause.ok, false, JSON.stringify(pause));
          const listed = await mustCall(flow, {
            kind: "read",
            resource: "assignments",
            method: "list",
            body: { role: "operator" },
          });
          assertEquals((listed.assignments as unknown[]).length, 0);
          const withdrawn = await flow.call({
            kind: "command",
            resource: "assignments",
            method: "withdraw",
            body: commandBody({
              input: { assignment: SLOT },
              compare: { revision: 1, state: "enabled" },
            }),
          });
          assertEquals(withdrawn.ok, false, JSON.stringify(withdrawn));
        },
      );

      await t.step(
        "3 승인 요청은 여전히 대기로 남는다(멈춤·회수가 승인을 대신하지 않는다)",
        async () => {
          const pending = await mustCall(flow, {
            kind: "read",
            resource: "approvals",
            method: "get",
            body: { approval: APR },
          });
          assertEquals(
            (pending.request as { status: string }).status,
            "pending",
          );
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
    }
  },
});

async function attachOperator(
  flow: Awaited<ReturnType<typeof openFlowShell>>,
  document: string,
  draftVersion: string,
): Promise<void> {
  const { fingerprint } = await import("../../packages/base/mod.ts");
  const preset = await mustCall(flow, {
    kind: "command",
    resource: "presets",
    method: "create",
    body: commandBody({
      id: id("pst", 1),
      definition: {
        kind: "operator",
        name: "operator manage flow",
        origin: "user",
        prompt: "ab".repeat(32),
        capability: { bundles: [], tools: [] },
        context: [{ kind: "project", target: PROJECT, section: null }],
        mcp: { servers: [], tools: [] },
        safe_tools: [],
        skills: [],
        model: null,
        organizing_model: null,
        instructions: [],
      },
      copied_from: null,
    }),
  });
  const value = {
    approval: APR,
    id: SLOT,
    bundle: {
      draft_version: draftVersion,
      assignment: null,
      expected_assignment_revision: null,
      preset: (preset.preset as { id: string }).id,
      preset_revision: 1,
      preset_definition:
        (preset.preset as { definition_hash: string }).definition_hash,
      scope: { kind: "project", id: PROJECT },
      outputs: [{ document, content: "watch changes" }],
      read_apps: [],
      read_commands: [],
      schedule: {
        first_at: new Date(Date.now() + 60_000).toISOString(),
        every_ms: 60_000,
      },
      reason: "Attached from the roles screen.",
    },
  };
  const base = {
    concern: "lophn-agent/assignments",
    command: "ApplyOperatorAssignment",
    caller: "user",
    targets: [SLOT],
    input: { kind: "inline", value },
    input_hash: await fingerprint(value),
    comparison: {},
  };
  const action = {
    ...base,
    binding_hash: await fingerprint({ ...base, binding_hash: "0" }),
  };
  const created = await mustCall(flow, {
    kind: "command",
    resource: "approvals",
    method: "create",
    body: commandBody({
      id: APR,
      requester: "user",
      run: null,
      reason: "Attached from the roles screen.",
      effect: {
        changes: "Attach or change the Operator exactly as shown.",
        external: null,
        reversible: true,
        reversibility: "You can withdraw it at any time.",
      },
      action,
      expires_at: null,
    }),
  });
  assertEquals((created.request as { id: string }).id, APR);
}
