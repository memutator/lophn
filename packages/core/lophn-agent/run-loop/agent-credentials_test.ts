import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import { createAgentCredentialLink } from "./agent-credentials.ts";

const SESSION = "ses_01hzzzzzzzzzzzzzzzzzzzzz01";
const TURN = "trn_01hzzzzzzzzzzzzzzzzzzzzz01";
const MSG = "msg_01hzzzzzzzzzzzzzzzzzzzzz01";
const PROJECT = "prj_01hzzzzzzzzzzzzzzzzzzzzz01";

function makeLink(allowedOps: readonly string[]) {
  const issued: unknown[] = [];
  const ended: string[] = [];
  const link = createAgentCredentialLink({
    issuer: {
      issue: async (input) => {
        issued.push(input);
        return ok({ token: "tok_1", credential_ref: "cred_1" });
      },
      endBy: (_key, value) => {
        ended.push(value);
        return 1;
      },
    },
    machine: async (path) => {
      const common = { as_of_seq: "1", next_cursor: null };
      if (path === "/turns/read") {
        return ok({
          turn: {
            id: TURN,
            session: SESSION,
            input_message: MSG,
            state: "running",
            basis: "a".repeat(64),
            started_at: "2026-11-25T00:00:00.000Z",
            limits: { model_attempts: null, stall_ms: 300_000 },
            mode: "attended",
            elapsed: { active_ms: 0, stall_ms: 0, checkpoint_at: null },
            finished_at: null,
            outcome: null,
            result: null,
            state_seq: "1",
          },
          ...common,
        });
      }
      if (path === "/sessions/read") {
        return ok({
          session: {
            id: SESSION,
            agent: "lophn_home",
            workspace: { kind: "project", id: PROJECT },
            title: null,
            lifecycle: "open",
            forked_from: null,
            model_selection: null,
            compaction: null,
            permission_mode: "workspace",
            called_from: null,
            spawned_by: null,
            opened_by_app: null,
            harness: null,
            state_seq: "1",
          },
          ...common,
        });
      }
      throw new Error(`unexpected path: ${path}`);
    },
    process: "agent-runtime",
    operationsFor: () => allowedOps,
    conditionsFor: () => ({}),
  });
  return { link, issued, ended };
}

// workspace 상한 밖 operation 요청은 undefined로 묵묵히 버리지 않고 forbidden 거부 프레임을 돌려준다.
test("agent credential 요청에 workspace 상한 밖 operation이 있으면 forbidden 거부 프레임을 돌려준다", async () => {
  const { link, issued } = makeLink(["ReadSession", "ListFiles"]);

  const denied = await link.onMessage({
    type: "agent_credential_request",
    request_id: "req_1",
    session: SESSION,
    turn: TURN,
    operations: ["ReadSession", "DeleteApp", "UpdateSettings"],
  });

  assert.deepStrictEqual(denied, {
    type: "agent_credential_response",
    request_id: "req_1",
    ok: false,
    error: {
      code: "forbidden",
      message:
        "operations not permitted in project workspace: DeleteApp, UpdateSettings",
      operations: ["DeleteApp", "UpdateSettings"],
    },
  });
  assert.equal(issued.length, 0);

  // 상한 안 operation만 요청하면 정상 발급한다.
  const granted = await link.onMessage({
    type: "agent_credential_request",
    request_id: "req_2",
    session: SESSION,
    turn: TURN,
    operations: ["ReadSession"],
  });
  assert.deepStrictEqual(granted, {
    type: "agent_credential_response",
    request_id: "req_2",
    credential: "tok_1",
    credential_ref: "cred_1",
  });
  assert.equal(issued.length, 1);
});
