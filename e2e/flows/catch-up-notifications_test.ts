// platform operations slice flow E2E: catch-up-notifications(docs/flows/catch-up-notifications.md).
// 실제 shell(headless)·core·worker를 임시 LOPHN_HOME으로 띄운다. OS notification은 사람이
// settings에서 켠 뒤에만 가고, headless 표시는 LOPHN_SHELL_OS_NOTIFY=fail로 실패한다.
// 계기는 질문과 approval 요청의 notification, ticket 완료 보고다.
//
// 이 파일이 단정하지 않는 갈래:
// - 문제 닫힘(ProblemClosed). 사실을 내는 길이 machine credential의 record-report와 reproduction
//   Verification이라 이 shell 기동에서는 만들지 못한다(아래 ticket test의 ignore step).
//   끝난 question·approval의 오래된 notification과 ticket 검사 결과는 아래 test가 본다.
import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals } from "@std/assert";

import { fingerprint } from "../../packages/base/mod.ts";
import { startFakeProvider } from "../../tools/fake-provider/mod.ts";

import { copyFixture } from "../../fixtures/projects/scenarios.ts";
import { e2eEnabled, READY_TIMEOUT_MS } from "../harness.ts";
import {
  commandBody,
  delay,
  documentTitled,
  type FlowShell,
  mustCall,
  openFlowShell,
  PROJECT,
  registerTrackedProject,
  removeHome,
  untilDocuments,
} from "../flow-support.ts";

const RAW_OS_ERROR = "headless os-notification fails";

type Delivery = {
  state: string;
  reason?: string;
  observed_at?: string;
};

type Listed = {
  notification: { id: string; source_seq: string; read_at: string | null };
  source_event: string;
  occurred_at?: string;
  document?: string | null;
  delivery?: Delivery;
};

async function listNotifications(flow: FlowShell): Promise<Listed[]> {
  const page = await mustCall(flow, {
    kind: "read",
    resource: "notifications",
    method: "list",
    body: {},
  });
  return page.notifications as Listed[];
}

async function notificationOf(flow: FlowShell, id: string): Promise<Listed> {
  const got = await mustCall(flow, {
    kind: "read",
    resource: "notifications",
    method: "get",
    body: { notification: id },
  });
  return got as unknown as Listed;
}

async function runCount(flow: FlowShell): Promise<number> {
  const page = await mustCall(flow, {
    kind: "read",
    resource: "runs",
    method: "list",
    body: {},
  });
  return (page.runs as unknown[]).length;
}

async function openNotificationsTab(flow: FlowShell): Promise<void> {
  await flow.mouseClickText("[role=tab]", "Notifications");
  await flow.until(
    `document.querySelector("[data-tab-panel='notifications']") !== null`,
    "Notifications 탭이 열리지 않았다",
  );
}

function showsInternalName(text: string | null): boolean {
  const value = text ?? "";
  return value.includes(RAW_OS_ERROR) ||
    value.includes("show_failed") ||
    value.includes("unconfirmed") ||
    value.includes("ContextWatchedItemChanged");
}

const PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";
const MODEL = "claude-sonnet-4-5";
const APPROVAL = "apr_01arz3ndektsv4rrffq69g5faa";
const SLOT = "asg_01arz3ndektsv4rrffq69g5fav";
const QUESTION_PROMPT = "Which wording?";

/** 질문 하나를 만들고 곧 끝나는 model 판단 둘. */
const ASK_ONE = {
  steps: [
    {
      id: "ask",
      protocol: "messages" as const,
      reply: {
        text: "One decision is yours.",
        toolCalls: [{
          id: "toolu_1",
          name: "question.submit",
          arguments: JSON.stringify({
            prompt: QUESTION_PROMPT,
            reason: "the glossary has two possible meanings",
            options: [
              {
                key: "keep",
                label: "Keep the current wording",
                description: "Leave the glossary as it is.",
                evidence: [],
                adoption: null,
                action: null,
              },
              {
                key: "change",
                label: "Change the wording",
                description: "Rewrite the glossary entry.",
                evidence: [],
                adoption: null,
                action: null,
              },
            ],
            recommendation: null,
            expires_at: null,
          }),
        }],
        usage: { input: 20, output: 8 },
        stop: "tool_calls" as const,
      },
    },
    {
      id: "end",
      protocol: "messages" as const,
      reply: {
        text: "Tell me when you decide.",
        usage: { input: 40, output: 9 },
        stop: "end" as const,
      },
    },
  ],
};

type Created = { id: string; created_seq: string };

/**
 * 사람이 직접 낸 approval 요청 하나(Operator 붙이기). 허락·거절은 보호 확인 창의 몫이라 이
 * flow는 요청이 서는 데까지만 쓰고, 끝은 요청자의 취소로 만든다.
 */
async function createApproval(
  flow: FlowShell,
  document: string,
  draftVersion: string,
): Promise<Created> {
  const preset = await mustCall(flow, {
    kind: "command",
    resource: "presets",
    method: "create",
    body: commandBody({
      id: "pst_01arz3ndektsv4rrffq69g5fa1",
      definition: {
        kind: "operator",
        name: "catch-up operator",
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
    approval: APPROVAL,
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
      id: APPROVAL,
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
  const request = created.request as { id: string; created_seq: string };
  return { id: request.id, created_seq: request.created_seq };
}

async function untilNotificationsOf(
  flow: FlowShell,
  events: readonly string[],
  what: string,
): Promise<Listed[]> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last: Listed[] = [];
  for (;;) {
    last = await listNotifications(flow);
    const seen = last.map((row) => row.source_event).sort();
    if (JSON.stringify(seen) === JSON.stringify([...events].sort())) {
      return last;
    }
    assert(Date.now() < deadline, `${what}: ${JSON.stringify(seen)}`);
    await delay(250);
  }
}

Deno.test({
  name:
    "platform/notifications#R6 platform/notifications#R7 platform/approvals#R7 lophn-agent/questions#R9 lophn-agent/conversation#R11 flow catch-up-notifications: 끝난 question과 approval의 오래된 notification을 열면 당시 사실과 현재 결과만 보이고 되살리지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    const provider = startFakeProvider({
      script: ASK_ONE,
      nowMs: () => Date.now(),
      instant: true,
    });
    let flow = await openFlowShell({ start: "lophn" });
    const home = flow.home;
    try {
      let approval: Created = { id: "", created_seq: "" };
      let questionId = "";
      let before = { runs: 0, sessions: 0 };

      const counts = async () => ({
        runs: await runCount(flow),
        sessions: ((await mustCall(flow, {
          kind: "read",
          resource: "sessions",
          method: "list",
          body: {},
        })).sessions as unknown[]).length,
      });
      const question = async () => {
        const listed = await mustCall(flow, {
          kind: "read",
          resource: "questions",
          method: "list",
          body: {},
        });
        return (listed.questions as {
          id: string;
          status: string;
          answer: unknown;
          closed_reason: string | null;
          created_seq: string;
        }[]).find((row) => row.id === questionId);
      };
      const approvalNow = async () =>
        (await mustCall(flow, {
          kind: "read",
          resource: "approvals",
          method: "get",
          body: { approval: approval.id },
        })) as { request: { status: string }; use: unknown };

      await t.step(
        "platform/notifications#R1 lophn-agent/questions#R3 platform/approvals#R3: 질문과 approval 요청이 각각 하나의 notification이 되고 지금 기다리는 결정으로 보인다",
        async () => {
          await registerTrackedProject(flow, { folder });
          await untilDocuments(flow, ["glossary"], "문서 관측 대기");
          const glossary = await documentTitled(flow, "glossary");
          approval = await createApproval(
            flow,
            glossary.id,
            glossary.latest_version,
          );
          await mustCall(flow, {
            kind: "command",
            resource: "providers",
            method: "register",
            body: commandBody({
              id: PROVIDER,
              name: "fixture",
              definition: {
                key: "anthropic",
                display_name: "Anthropic",
                protocols: ["anthropic-messages"],
                auth_kinds: ["none"],
                models_endpoint: null,
                oauth: null,
                revision: "2026-01-01",
              },
              endpoint: provider.url,
              protocol: "anthropic-messages",
            }),
          });
          const defaults = await mustCall(flow, {
            kind: "read",
            resource: "agent-model-defaults",
            method: "read",
            body: {},
          });
          const seq =
            (defaults.defaults as { settings_seq: string }).settings_seq;
          await mustCall(flow, {
            kind: "command",
            resource: "agent-model-defaults",
            method: "change",
            body: commandBody(
              {
                judgment: {
                  provider: PROVIDER,
                  credentials: [],
                  model_name: MODEL,
                  reasoning_level: "provider_default",
                  options: {},
                },
                organizing: null,
                settings_seq: seq,
              },
              { settings_seq: seq },
            ),
          });
          await flow.click("[data-dock-toggle]");
          await flow.until(
            `document.querySelector("[data-new-session]") !== null`,
            "새 세션 단추가 서지 않았다",
          );
          await flow.click("[data-new-session]");
          await flow.until(
            `document.querySelector("[data-composer-input]") !== null`,
            "입력칸이 서지 않았다",
          );
          await flow.type("[data-composer-input]", "Tidy the glossary.");
          await flow.click("[data-send]");
          await untilNotificationsOf(
            flow,
            ["ApprovalRequestCreated", "QuestionCreated"],
            "질문과 approval notification 대기",
          );
          const asked = await mustCall(flow, {
            kind: "read",
            resource: "questions",
            method: "list",
            body: { status: "pending" },
          });
          questionId = (asked.questions as { id: string }[])[0].id;
          assertEquals((await approvalNow()).request.status, "pending");
          assertEquals((await question())?.status, "pending");
        },
      );

      await t.step(
        "platform/approvals#R7 lophn-agent/questions#R9: 질문은 미루고 approval은 요청자가 취소해 둘 다 끝난다",
        async () => {
          await flow.until(
            `document.querySelector("[data-question-text='ready']") !== null`,
            "질문이 칸에 서지 않았다",
          );
          await flow.click("[data-later]");
          await flow.until(
            `document.querySelector("[data-question-strip]") === null`,
            "미룬 질문이 칸에 남아 있다",
          );
          const cancelled = await mustCall(flow, {
            kind: "command",
            resource: "approvals",
            method: "cancel",
            body: commandBody(
              {
                approval: approval.id,
                created_seq: approval.created_seq,
                closed_reason: null,
              },
              { created_seq: approval.created_seq },
            ),
          });
          assertEquals(
            (cancelled.request as { status: string }).status,
            "cancelled",
          );
          assertEquals((await question())?.status, "cancelled");
          // 끝난 뒤에도 notification은 둘 다 그대로다.
          assertEquals((await listNotifications(flow)).length, 2);
          before = await counts();
        },
      );

      const openOld = async (
        sourceEvent: string,
        id: string,
        status: string,
      ) => {
        const row = (await listNotifications(flow)).find((item) =>
          item.source_event === sourceEvent
        );
        assert(row, `${sourceEvent} notification이 없다`);
        await openNotificationsTab(flow);
        await flow.click(
          `[data-notification="${row.notification.id}"] button`,
        );
        await flow.until(
          `document.querySelector("[data-detail='${id}'] [data-request-id='${id}'][data-status='${status}']") !== null`,
          `끝난 ${sourceEvent}의 현재 결과가 보이지 않는다`,
        );
        // 결정으로 가는 통로는 없다: 선택지·미루기·취소·허락 검토.
        for (
          const control of [
            "[data-option]",
            "[data-later]",
            "[data-cancel-question]",
            "[data-send-answer]",
            "[data-review]",
          ]
        ) {
          assertEquals(
            await flow.count(`[data-detail='${id}'] ${control}`),
            0,
            `끝난 요청에 ${control}가 남았다`,
          );
        }
        return row;
      };

      await t.step(
        "platform/notifications#R6 platform/notifications#R7 lophn-agent/questions#R9 lophn-agent/conversation#R11: 끝난 질문의 notification을 열면 현재 결과만 보이고 다시 답할 수 없으며 run이나 세션이 늘지 않는다",
        async () => {
          await flow.click('[data-screen="things-to-confirm"]');
          await flow.until(
            `document.querySelector("[data-current-screen]")?.getAttribute("data-current-screen") === "things-to-confirm"`,
            "things-to-confirm으로 가지 않았다",
          );
          // 지금 기다리는 결정은 없다. 끝난 것은 지난 결과에 있다.
          await flow.until(
            `document.querySelector("[data-tab-panel='waiting'] [data-counts]") !== null`,
            "기다리는 결정 목록이 서지 않았다",
          );
          assertEquals(
            await flow.count(
              "[data-tab-panel='waiting'] ul:not([data-counts]) li",
            ),
            0,
          );
          await openOld("QuestionCreated", questionId, "cancelled");
          const after = await question();
          assertEquals(after?.status, "cancelled");
          assertEquals(after?.answer, null);
          assertEquals(await counts(), before);
          assertEquals((await listNotifications(flow)).length, 2);
        },
      );

      await t.step(
        "platform/notifications#R6 platform/notifications#R7 platform/approvals#R7: 끝난 approval의 notification을 열면 현재 결과만 보이고 허락이나 실행으로 이어지지 않는다",
        async () => {
          await openOld("ApprovalRequestCreated", approval.id, "cancelled");
          const got = await approvalNow();
          assertEquals(got.request.status, "cancelled");
          assertEquals(got.use, null);
          const operators = await mustCall(flow, {
            kind: "read",
            resource: "assignments",
            method: "list",
            body: { role: "operator" },
          });
          assertEquals((operators.assignments as unknown[]).length, 0);
          assertEquals(await counts(), before);
        },
      );

      await t.step(
        "platform/notifications#R4 platform/notifications#R7: 다시 시작해도 같은 notification을 열면 같은 현재 결과이고 되살아나지 않는다",
        async () => {
          await flow.close();
          flow = await openFlowShell({ home, start: "things-to-confirm" });
          assertEquals((await listNotifications(flow)).length, 2);
          assertEquals((await question())?.status, "cancelled");
          assertEquals((await approvalNow()).request.status, "cancelled");
          await openOld("QuestionCreated", questionId, "cancelled");
          await openOld("ApprovalRequestCreated", approval.id, "cancelled");
          assertEquals(await counts(), before);
        },
      );
    } finally {
      try {
        await flow.close();
      } catch {
        // 이미 닫았거나 기동이 실패한 경우다.
      }
      await removeHome(home);
      await provider.close();
      await Deno.remove(folder, { recursive: true });
    }
  },
});

// ---- ticket 완료 보고와 실제 검사 결과 ----
// 완료 보고(ticket_completions)는 coding agent의 MCP 호출로만 생기고 그 credential은 OS keychain이
// 필요해 이 기동에서 만들 수 없다. 그래서 core를 끈 사이 ledger에 보고된 ticket 행을 심고(test-only
// seeding, apps/core/ticket-checker_test.ts와 같은 자리), 제품 core의 checker worker가 실제 Verification
// 행을 읽어 내는 TicketConfirmed·TicketCheckFailed만 notification이 되는지 본다.

const TICKET_APP = "app_01arz3ndektsv4rrffq69g5fav";
const CMD_HASH = "d".repeat(64);

type Reported = {
  ticket: string;
  seq: string;
  release: string;
  bundle: string;
};
const CONFIRMED: Reported = {
  ticket: "tkt_01arz3ndektsv4rrffq69g5fa1",
  seq: "1",
  release: "rel_01arz3ndektsv4rrffq69g5fa1",
  bundle: "a1".repeat(32),
};
const FAILED: Reported = {
  ticket: "tkt_01arz3ndektsv4rrffq69g5fa2",
  seq: "2",
  release: "rel_01arz3ndektsv4rrffq69g5fa2",
  bundle: "a2".repeat(32),
};
const WAITING: Reported = {
  ticket: "tkt_01arz3ndektsv4rrffq69g5fa3",
  seq: "3",
  release: "rel_01arz3ndektsv4rrffq69g5fa3",
  bundle: "a3".repeat(32),
};

function withDb<T>(home: string, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(`${home}/lophn.db`);
  try {
    return run(db);
  } finally {
    db.close();
  }
}

function seedReportedTicket(
  db: DatabaseSync,
  item: Reported,
  number: number,
): void {
  db.prepare(
    `insert into releases (id, app, number, code_commit, bundle_hash, blueprint_hash,
       data_schema, data_changes, ticket_source, created_by, created_at, status,
       activation, failure, blueprint, declarations)
     values (?, ?, ?, ?, ?, ?, 0, '[]', NULL, 'machine:releaser',
       '2026-10-07T00:00:00.000Z', 'prepared', NULL, NULL, '{}', '[]')`,
  ).run(
    item.release,
    TICKET_APP,
    number,
    "c".repeat(40),
    item.bundle,
    "e".repeat(64),
  );
  db.prepare(
    `insert into tickets (id, app, kind, title, what, why, inspect, preserve, problems,
       state, readiness, needs, cancel_reason, completion_seq, revision)
     values (?, ?, 'implementation', 't', 'w', 'y', '[]', '[]', '[]', 'reported',
       'ready', '[]', NULL, ?, ?)`,
  ).run(item.ticket, TICKET_APP, item.seq, item.seq);
  const condition = db.prepare(
    `insert into ticket_conditions (ticket, position, kind, input, condition_hash)
     values (?, ?, ?, ?, ?)`,
  );
  condition.run(item.ticket, 0, "app_test", '{"kind":"app_test"}', CMD_HASH);
  condition.run(
    item.ticket,
    1,
    "test_command",
    JSON.stringify({
      kind: "test_command",
      executable: "deno",
      argv: ["task", "test"],
      cwd: ".",
      timeout_ms: 60000,
      expected_exit_code: 0,
    }),
    CMD_HASH,
  );
  db.prepare(
    `insert into ticket_completions (ticket, seq, claim_seq, release, summary_hash,
       outputs, fix_records, verifications)
     values (?, ?, ?, ?, ?, '[]', '[]', '[]')`,
  ).run(item.ticket, item.seq, item.seq, item.release, "f".repeat(64));
}

function seedVerification(
  db: DatabaseSync,
  input: {
    id: string;
    kind: "app_test" | "test_command";
    result: "pass" | "fail";
    bundle: string;
    ticket?: Reported;
  },
): void {
  db.prepare(
    `insert into verifications (id, request_principal, request_key, request_hash, kind, app,
       target_bundle_hash, target_release, problem, basis_seq, before_release, after_release,
       ticket, ticket_check_index, ticket_check_hash, ticket_completion_seq, test, execution,
       result, reason, observations, recorded_seq, verification_canonical)
     values (?, 'user-1', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, '{}', '{}',
       ?, 'ran', '[]', '1', '{}')`,
  ).run(
    input.id,
    `key-${input.id}`,
    "f".repeat(64),
    input.kind,
    TICKET_APP,
    input.bundle,
    input.ticket?.ticket ?? null,
    input.ticket === undefined ? null : 1,
    input.ticket === undefined ? null : CMD_HASH,
    input.ticket?.seq ?? null,
    input.result,
  );
}

function ticketState(home: string, ticket: string): string {
  return withDb(
    home,
    (db) =>
      (db.prepare("select state from tickets where id = ?").get(ticket) as {
        state: string;
      }).state,
  );
}

Deno.test({
  name:
    "platform/notifications#R1 platform/notifications#R2 platform/notifications#R6 coding-agent/tickets#R18 coding-agent/tickets#R21 shell/desktop#R9 flow catch-up-notifications: ticket 완료 보고와 실제 검사 결과를 섞지 않고 notification을 열어도 ticket 상태는 그대로다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    // 첫 기동은 ledger와 schema를 만든다. 그 위에 보고된 ticket을 심고 shell을 다시 띄운다.
    let flow = await openFlowShell({ start: "things-to-confirm" });
    const home = flow.home;
    try {
      await flow.close();
      withDb(home, (db) => {
        db.prepare(
          `insert into apps (id, slug, name, description, planning_version, source_path,
             active_release, run_enabled, revision, status)
           values (?, 'notes', 'Notes', 'notes app', NULL, NULL, NULL, 0, '3', 'active')`,
        ).run(TICKET_APP);
        seedReportedTicket(db, CONFIRMED, 1);
        seedReportedTicket(db, FAILED, 2);
        seedReportedTicket(db, WAITING, 3);
        seedVerification(db, {
          id: "vrf_01arz3ndektsv4rrffq69g5fa1",
          kind: "app_test",
          result: "pass",
          bundle: CONFIRMED.bundle,
        });
        seedVerification(db, {
          id: "vrf_01arz3ndektsv4rrffq69g5fa2",
          kind: "test_command",
          result: "pass",
          bundle: CONFIRMED.bundle,
          ticket: CONFIRMED,
        });
        seedVerification(db, {
          id: "vrf_01arz3ndektsv4rrffq69g5fa3",
          kind: "app_test",
          result: "fail",
          bundle: FAILED.bundle,
        });
        seedVerification(db, {
          id: "vrf_01arz3ndektsv4rrffq69g5fa4",
          kind: "test_command",
          result: "pass",
          bundle: FAILED.bundle,
          ticket: FAILED,
        });
        // WAITING: 다른 묶음의 통과만 있다. 이 묶음의 근거가 아니다.
        seedVerification(db, {
          id: "vrf_01arz3ndektsv4rrffq69g5fa5",
          kind: "app_test",
          result: "pass",
          bundle: CONFIRMED.bundle,
        });
      });
      flow = await openFlowShell({ home, start: "things-to-confirm" });

      let confirmedId = "";
      let failedId = "";
      await t.step(
        "platform/notifications#R1 platform/notifications#R2 coding-agent/tickets#R18: 실제 검사 결과가 난 ticket만 notification이 되고 보고만 된 ticket은 되지 않는다",
        async () => {
          const deadline = Date.now() + READY_TIMEOUT_MS;
          let rows: Listed[] = [];
          for (;;) {
            rows = await listNotifications(flow);
            if (rows.length >= 2) break;
            assert(
              Date.now() < deadline,
              `검사 결과 notification 대기: ${
                JSON.stringify(rows.map((row) => row.source_event))
              }`,
            );
            await delay(250);
          }
          // checker가 남은 ticket을 마저 보는 시간을 주고 더 늘지 않는지 본다.
          await delay(3_000);
          rows = await listNotifications(flow);
          assertEquals(rows.map((row) => row.source_event).sort(), [
            "TicketCheckFailed",
            "TicketConfirmed",
          ]);
          confirmedId = rows.find((row) =>
            row.source_event === "TicketConfirmed"
          )!
            .notification.id;
          failedId = rows.find((row) =>
            row.source_event === "TicketCheckFailed"
          )!
            .notification.id;
          assertEquals(ticketState(flow.home, CONFIRMED.ticket), "confirmed");
          assertEquals(ticketState(flow.home, FAILED.ticket), "check_failed");
          // 근거가 아직 없는 ticket은 확인되지도 실패하지도 않고 보고된 채다.
          assertEquals(ticketState(flow.home, WAITING.ticket), "reported");
        },
      );

      await t.step(
        "platform/notifications#R3 shell/desktop#R9 shell/wording#R2: 두 notification은 서로 다른 안내로 읽히고 안쪽 상태 이름을 내지 않는다",
        async () => {
          await flow.until(
            `document.querySelector("[data-current-screen]")?.getAttribute("data-current-screen") === "things-to-confirm"`,
            "things-to-confirm 화면이 아니다",
          );
          await openNotificationsTab(flow);
          await flow.until(
            `document.querySelector("[data-notification='${confirmedId}']") !== null && document.querySelector("[data-notification='${failedId}']") !== null`,
            "두 notification 줄이 보이지 않는다",
          );
          const confirmed = String(
            await flow.text(`[data-notification="${confirmedId}"]`),
          );
          const failed = String(
            await flow.text(`[data-notification="${failedId}"]`),
          );
          assert(confirmed.includes("A task is ready"), confirmed);
          assert(failed.includes("A task's check failed"), failed);
          assert(!confirmed.includes("check failed"), confirmed);
          assert(!failed.includes("is ready"), failed);
          for (const text of [confirmed, failed]) {
            assert(!showsInternalName(text), text);
            assert(
              !/check_failed|TicketConfirmed|TicketCheckFailed/.test(text),
            );
          }
          // 보고된 ticket이 결정을 기다리는 일은 아니다.
          assertEquals(
            await flow.count(
              "[data-tab-panel='notifications'] [data-notification] [data-document]",
            ),
            0,
          );
        },
      );

      await t.step(
        "platform/notifications#R6 coding-agent/tickets#R21: 열고 읽음 표시해도 ticket 상태와 기다리는 결정은 바뀌지 않는다",
        async () => {
          const before = {
            confirmed: ticketState(flow.home, CONFIRMED.ticket),
            failed: ticketState(flow.home, FAILED.ticket),
            waiting: ticketState(flow.home, WAITING.ticket),
          };
          await flow.click(`[data-notification="${confirmedId}"] button`);
          await flow.click(`[data-notification="${failedId}"] button`);
          await flow.click(
            `[data-notification="${failedId}"] [data-mark-read]`,
          );
          await flow.until(
            `document.querySelector("[data-notification='${failedId}']")?.hasAttribute("data-unread") === false`,
            "읽음 표시가 되지 않았다",
          );
          assert(
            (await notificationOf(flow, failedId)).notification.read_at !==
              null,
          );
          assert(
            (await notificationOf(flow, confirmedId)).notification.read_at ===
              null,
          );
          await delay(2_000);
          assertEquals(
            ticketState(flow.home, CONFIRMED.ticket),
            before.confirmed,
          );
          assertEquals(ticketState(flow.home, FAILED.ticket), before.failed);
          assertEquals(ticketState(flow.home, WAITING.ticket), before.waiting);
          assertEquals((await listNotifications(flow)).length, 2);
          assertEquals(await runCount(flow), 0);
          await flow.mouseClickText("[role=tab]", "Waiting");
          await flow.until(
            `document.querySelector("[data-tab-panel='waiting'] [data-counts]") !== null`,
            "기다리는 결정 목록이 서지 않았다",
          );
          assertEquals(
            await flow.count(
              "[data-tab-panel='waiting'] ul:not([data-counts]) li",
            ),
            0,
          );
        },
      );

      await t.step({
        name:
          "coding-agent/tickets#R21 problems/closing: ticket 확인은 문제 닫힘이 아니고 ProblemClosed는 따로 notification이 된다",
        ignore: true,
        fn: () => {
          // 이 shell 기동에서는 닫힌 문제를 만들 길이 없다. ProblemClosed는 problems.closing 반응기가
          // 실제 reproduction Verification과 machine credential의 record-report로 내고(apps/core/
          // ticket-checker_test.ts의 repair 장면), 그 credential은 OS keychain이 필요하다.
          // 닫힘 notification은 apps/core/notifications-triggers_test.ts가 core에서 본다.
        },
      });
    } finally {
      try {
        await flow.close();
      } catch {
        // 이미 닫았거나 기동이 실패한 경우다.
      }
      await removeHome(home);
    }
  },
});
