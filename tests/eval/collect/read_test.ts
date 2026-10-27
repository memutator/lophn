// 세 질문
// - contract: eval 수집이 만드는 `SessionRecord.sent_calls`. check와 judge가 보낸 쪽 기준 call 흐름을 여기서 읽는다.
// - 현실적 회귀: Gate가 막은 call을 지우거나 받는 쪽을 못 따라가는 수정, t0 앞(되살리기 흔적)의 turn과 그 call이 기록에 섞이는 수정.
// - 왜 지금 test로 못 잡나: 이 module은 core 없이 읽기 route 응답만 받으므로 core를 띄우는 e2e로는 모양이 어긋나도 잡히는 곳이 없다.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentSessionRead,
  callRead,
  modelCallList,
  toolCallList,
  turnBodyView,
  turnList,
} from "../../../packages/protocol/lophn-agent/mod.ts";
import { appList } from "../../../packages/protocol/apps/mod.ts";
import { projectList } from "../../../packages/protocol/projects/mod.ts";
import { collectSessions, type ReadPort } from "./read.ts";

const T0 = "2026-01-01T00:10:00.000Z";
const OLD = "2026-01-01T00:00:00.000Z";
const NEW = "2026-01-01T00:11:00.000Z";

const page = { as_of_seq: "1", next_cursor: null };
const ok = (value: unknown) => ({
  ok: true,
  value: { ...(value as object), ...page },
});

const sessions: Record<string, unknown> = {
  ses_root: { id: "ses_root", agent: { role: "lophn" } },
  ses_pm: {
    id: "ses_pm",
    agent: { role: "project_manager", project: "prj_tax" },
  },
};
const turns: Record<string, unknown[]> = {
  ses_root: [
    { id: "trn_old", session: "ses_root", started_at: OLD, finished_at: OLD },
    { id: "trn_new", session: "ses_root", started_at: NEW, finished_at: NEW },
  ],
  ses_pm: [],
};
const toolCall = (id: string, turn: string, outcome: unknown) => ({
  id,
  turn,
  tool: "call",
  input: id,
  output: null,
  retry_of: null,
  state: "finished",
  outcome,
});
const toolCalls = [
  toolCall("tcl_old", "trn_old", { kind: "success", code: "ok" }),
  toolCall("tcl_blocked", "trn_new", { kind: "not_executed", code: "denied" }),
  {
    ...toolCall("tcl_sent", "trn_new", { kind: "success", code: "ok" }),
    output: "h",
  },
];
const inputs: Record<string, unknown> = {
  tcl_old: { to: { role: "lophn" }, reply: "none", body: "old" },
  tcl_blocked: {
    to: { role: "project_manager", place: { project: "hr" } },
    reply: "none",
    body: "blocked",
  },
  tcl_sent: {
    to: { role: "project_manager", place: { project: "tax" } },
    reply: "result",
    body: "hi",
  },
};

const port: ReadPort = {
  async tryCall(route: unknown, input: unknown) {
    const i = input as Record<string, string>;
    switch (route) {
      case appList:
        return ok({ apps: [] });
      case projectList:
        return ok({ projects: [{ id: "prj_tax", name: "tax" }] });
      case agentSessionRead:
        return ok({ session: sessions[i.session] });
      case turnList:
        return ok({ turns: turns[i.session] });
      case modelCallList:
        return ok({ calls: [] });
      case toolCallList:
        return ok({ tool_calls: i.session === "ses_root" ? toolCalls : [] });
      case turnBodyView:
        return ok({
          value:
            i.kind === "tool_call_input"
              ? inputs[i.id]
              : {
                  content: {
                    call: "cal_1",
                    state: "accepted",
                    fail_reason: null,
                  },
                },
          truncated: false,
        });
      case callRead:
        return ok({
          call: {
            call: "cal_1",
            to: {
              kind: "new_session",
              agent: { role: "project_manager", project: "prj_tax" },
            },
            receiver_session: "ses_pm",
          },
        });
    }
    throw new Error("unexpected route");
  },
} as unknown as ReadPort;

test("t0 앞 turn의 call은 빼고 막힌 call과 새 session에 간 call은 보낸 쪽 순서로 남는다", async () => {
  const records = await collectSessions({ port }, ["ses_root"], T0);
  assert.deepStrictEqual(
    records.map((r) => r.session),
    ["ses_root", "ses_pm"],
  );
  const root = records[0];
  assert.deepStrictEqual(
    root.turns.map((t) => t.id),
    ["trn_new"],
  );
  assert.deepStrictEqual(
    root.tool_calls.map((t) => t.call.id),
    ["tcl_blocked", "tcl_sent"],
  );
  const [blocked, sent] = root.sent_calls;
  assert.deepStrictEqual(
    [blocked.order, blocked.outcome?.code, blocked.call],
    [0, "denied", null],
  );
  assert.deepStrictEqual(
    [sent.order, sent.reply, sent.call, sent.receiver_session],
    [1, "result", "cal_1", "ses_pm"],
  );
  assert.deepStrictEqual(sent.receiver_place?.name, "tax");
  assert.deepStrictEqual(records[1].place?.name, "tax");
});
