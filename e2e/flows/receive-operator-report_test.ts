// operator slice flow E2E: receive-operator-report(docs/flows/receive-operator-report.md). 실제
// headless shell·core·agent runtime child(occurrences 시계·run pump)를 임시 LOPHN_HOME으로 띄우고
// 사람이 등록·추적한 project(notes-basic fixture)에 Operator를 붙인다. 보호 창 허락(approvals/grant,
// handle 결정)은 shell/confirmation E2E 몫이라: 사람이 만든 승인 요청이 대기로 남는 것까지만 이 flow가
// 본다. 승인 경유 적용(core, 이 flow용 main 창 결정)까지의 실제 적용 길은 apps/core/operator-apply_test.ts가
// 실제 core에서 본다(fake provider 등록이 OS keychain을 필요로 하지 않는 사람 command라 core에서 직접).
import { assert, assertEquals } from "@std/assert";

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
    "flow receive-operator-report: 붙인 Operator의 주기가 도래하면 runtime이 회차를 접수하고 결과는 사람 document에서 읽는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("notes-basic"));
    const flow = await openFlowShell({ start: "lophn" });
    try {
      await t.step(
        "1 사람이 추적한 project에 Operator를 붙이는 승인 요청을 만든다",
        async () => {
          await registerTrackedProject(flow, {
            folder,
            globs: ["**/*.md"],
          });
          await untilDocuments(flow, ["index"], "자료가 문서가 되지 않았다");
          const index = await documentTitled(flow, "index");
          assert(index.latest_version !== null, "첫 판이 없다");
          await attachOperator(flow, index.id, index.latest_version);
        },
      );
      await t.step(
        "2 승인 전에는 Operator가 붙지 않고 대기 요청만 남는다",
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
          const listed = await mustCall(flow, {
            kind: "read",
            resource: "assignments",
            method: "list",
            body: { role: "operator" },
          });
          assertEquals((listed.assignments as unknown[]).length, 0);
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
    }
  },
});

function attachInput(approval: string, bundle: unknown) {
  return { approval, id: SLOT, bundle };
}

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
        name: "operator report flow",
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
  const value = attachInput(APR, {
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
  });
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

// 사용하지 않는 읽기(회차 목록은 runtime child의 machine 자격으로만 준비된다).
