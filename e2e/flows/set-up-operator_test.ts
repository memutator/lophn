// operator slice flow E2E: set-up-operator(docs/flows/set-up-operator.md). 실제 headless shell과
// 실제 core·documents worker·I/O worker를 임시 LOPHN_HOME으로 띄우고 예시 project 폴더 fixture
// (notes-basic)를 사람이 등록·추적한 프로젝트로 쓴다. 사람이 Operator preset 사본을 만들고
// 화면(coreOperatorSource.propose)과 같은 승인 요청(approvals/create, requester·caller user,
// action ApplyOperatorAssignment, 입력 {approval, id, bundle})을 만든 뒤 대기 상태까지 본다.
// - 허락·적용의 결정은 보호 창의 handle이 필요하다. 창 결정은 shell/confirmation E2E 몫이고
//   승인 없이 직접 부르는 길(forbidden)은 apps/core/operator-apply_test.ts가 실제 core에서 본다.
// - 사람 조작의 결과는 사람 command를 core 통로(window.lophnCore)로 만들고 읽는다.
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
    "flow set-up-operator: 사람 preset 사본과 Operator 붙이기 승인 요청이 만들어지고 대기로 남는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("notes-basic"));
    const flow = await openFlowShell({ start: "lophn" });
    try {
      await t.step(
        "1·2 추적한 프로젝트 자료가 고정 판으로 준비된다",
        async () => {
          await registerTrackedProject(flow, {
            folder,
            globs: ["**/*.md"],
          });
          await untilDocuments(
            flow,
            ["index"],
            "추적한 파일이 문서가 되지 않았다",
          );
        },
      );

      await t.step(
        "3 출력 문서 후보가 첫 실제 판을 가진다",
        async () => {
          const index = await documentTitled(flow, "index");
          assertEquals(index.status, "active");
          assert(index.latest_version !== null, "첫 판이 없다");
          const owner = await mustCall(flow, {
            kind: "read",
            resource: "assignments",
            method: "outputs",
            body: { document: index.id },
          });
          assertEquals(owner.output, null, "이미 Operator가 문서를 쓴다");
        },
      );

      await t.step(
        "4 Operator preset ��본이 만들어지고 붙이기 승인 요청이 대기로 남는다",
        async () => {
          const index = await documentTitled(flow, "index");
          const preset = await mustCall(flow, {
            kind: "command",
            resource: "presets",
            method: "create",
            body: commandBody({
              id: id("pst", 1),
              definition: {
                kind: "operator",
                name: "operator flow set-up",
                origin: "user",
                prompt: "ab".repeat(32),
                capability: { bundles: [], tools: [] },
                context: [{
                  kind: "project",
                  target: PROJECT,
                  section: null,
                }],
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
          const presetId = (preset.preset as { id: string }).id;
          assert(presetId.startsWith("pst_"), "preset이 만들어지지 않았다");

          // 화면(coreOperatorSource.propose)과 같은 승인 요청이다: requester·caller
          // user, action ApplyOperatorAssignment, 입력 {approval, id, bundle}.
          // 지문은 platform과 같은 canonical JSON의 sha256이다.
          const { fingerprint } = await import("../../packages/base/mod.ts");
          const value = {
            approval: APR,
            id: SLOT,
            bundle: {
              draft_version: index.latest_version,
              assignment: null,
              expected_assignment_revision: null,
              preset: presetId,
              preset_revision: 1,
              preset_definition:
                (preset.preset as { definition_hash: string }).definition_hash,
              scope: { kind: "project", id: PROJECT },
              outputs: [{ document: index.id, content: "watch changes" }],
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
          assertEquals(
            (created.request as { id: string }).id,
            APR,
            "승인 요청이 만들어지지 않았다",
          );
          const pending = await mustCall(flow, {
            kind: "read",
            resource: "approvals",
            method: "get",
            body: { approval: APR },
          });
          assertEquals(
            (pending.request as { status: string }).status,
            "pending",
            "허락 전 대기여야 한다",
          );
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
    }
  },
});
