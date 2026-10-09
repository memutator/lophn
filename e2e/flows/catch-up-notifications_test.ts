// operations slice flow E2E: catch-up-notifications(docs/flows/catch-up-notifications.md).
// 실제 headless shell과 실제 core를 임시 LOPHN_HOME으로 띄운다. 사람이 OS notification을 켠
// 상태에서 결정이 필요한 approval request가 생기면 notification 하나가 생긴다. headless 시험의
// OS 표시는 실패하도록 둔다(LOPHN_SHELL_OS_NOTIFY=fail). 사람은 things-to-confirm에서 지금
// 기다리는 결정과 notification을 구별해 보고, 전달 실패 이유를 보고, 읽음 처리한다. 읽음은
// 결정을 바꾸지 않고 다시 연 뒤에도 남는다.
// - approval request는 set-up-operator flow와 같은 사람 승인 요청(ApplyOperatorAssignment)이다.
// - 결정 제출(허락·거절)은 보호 창 몫이라 이 flow 밖이다.
import { assert, assertEquals } from "@std/assert";

import { copyFixture } from "../../fixtures/projects/scenarios.ts";
import { e2eEnabled } from "../harness.ts";
import {
  commandBody,
  documentTitled,
  type FlowShell,
  mustCall,
  openFlowShell,
  PROJECT,
  registerTrackedProject,
  removeHome,
  untilDocuments,
} from "../flow-support.ts";

const SLOT = "asg_01arz3ndektsv4rrffq69g5fav";
const APR = "apr_01arz3ndektsv4rrffq69g5faa";
const PRESET = "pst_01arz3ndektsv4rrffq69g5fa1";

interface NotificationEntry {
  notification: { id: string; read_at: string | null };
  source_event: string;
  delivery?: { state: string; reason?: string };
}

async function notifications(flow: FlowShell): Promise<NotificationEntry[]> {
  const read = await mustCall(flow, {
    kind: "read",
    resource: "notifications",
    method: "list",
    body: { limit: 200 },
  });
  return read.notifications as NotificationEntry[];
}

async function approvalStatus(flow: FlowShell): Promise<string> {
  const read = await mustCall(flow, {
    kind: "read",
    resource: "approvals",
    method: "get",
    body: { approval: APR },
  });
  return (read.request as { status: string }).status;
}

/** 사람이 설정에서 OS notification을 켠 것과 같은 settings apply다. */
async function turnOnOsNotifications(flow: FlowShell): Promise<void> {
  const read = await mustCall(flow, {
    kind: "read",
    resource: "settings",
    method: "get",
    body: { keys: ["shell.os_notifications"] },
  });
  await mustCall(flow, {
    kind: "command",
    resource: "settings",
    method: "apply",
    body: {
      input: {
        changes: [{
          layer: "common",
          key: "shell.os_notifications",
          action: "set",
          value: true,
        }],
      },
      idempotency_key: "os-notifications-on",
      compare: {
        revision: read.revision,
        defaults_revision: read.defaults_revision,
      },
      prepared: [],
    },
  });
}

/** set-up-operator flow와 같은 사람 Operator 붙이기 승인 요청을 만든다. */
async function createApproval(flow: FlowShell): Promise<void> {
  const index = await documentTitled(flow, "index");
  const preset = await mustCall(flow, {
    kind: "command",
    resource: "presets",
    method: "create",
    body: commandBody({
      id: PRESET,
      definition: {
        kind: "operator",
        name: "operator flow catch-up",
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
  const made = preset.preset as { id: string; definition_hash: string };
  const { fingerprint } = await import("../../packages/base/mod.ts");
  const value = {
    approval: APR,
    id: SLOT,
    bundle: {
      draft_version: index.latest_version,
      assignment: null,
      expected_assignment_revision: null,
      preset: made.id,
      preset_revision: 1,
      preset_definition: made.definition_hash,
      scope: { kind: "project", id: PROJECT },
      outputs: [{ document: index.id, content: "watch changes" }],
      read_apps: [],
      read_commands: [],
      schedule: {
        first_at: new Date(Date.now() + 3_600_000).toISOString(),
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
  await mustCall(flow, {
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
}

async function openNotificationsTab(flow: FlowShell): Promise<void> {
  await flow.until(
    `!!document.querySelector('[data-screen-body="things-to-confirm"] [role="tab"]')`,
    "things-to-confirm 화면이 열리지 않았다",
  );
  await flow.mouseClickText('[role="tab"]', "Notifications");
  await flow.until(
    `!!document.querySelector('[data-tab-panel="notifications"]')`,
    "notification 탭이 열리지 않았다",
  );
}

Deno.test({
  name:
    "flow catch-up-notifications: 결정 notification을 구별해 보고 OS 전달 실패 이유를 보며 읽음은 결정을 바꾸지 않고 다시 연 뒤에도 남는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("notes-basic"));
    let flow = await openFlowShell({
      start: "things-to-confirm",
      osNotifyFails: true,
    });
    const home = flow.home;
    let notification = "";
    try {
      await t.step(
        "1·2 사람이 OS notification을 켠 뒤 결정 요청이 생기면 notification 하나가 생기고 OS 전달 실패가 남는다",
        async () => {
          await registerTrackedProject(flow, { folder, globs: ["**/*.md"] });
          await untilDocuments(
            flow,
            ["index"],
            "추적한 파일이 문서가 되지 않았다",
          );
          await turnOnOsNotifications(flow);
          await createApproval(flow);
          assertEquals(await approvalStatus(flow), "pending");
          const deadline = Date.now() + 60_000;
          let found: NotificationEntry[] = [];
          while (Date.now() < deadline) {
            found = (await notifications(flow)).filter((entry) =>
              entry.source_event === "ApprovalRequestCreated"
            );
            if (found[0]?.delivery?.state === "failed") break;
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          assertEquals(found.length, 1, JSON.stringify(found));
          assertEquals(found[0]!.delivery?.state, "failed");
          assertEquals(found[0]!.delivery?.reason, "show_failed");
          notification = found[0]!.notification.id;
        },
      );

      await t.step(
        "3·5 things-to-confirm에서 기다리는 결정과 notification을 구별하고 전달 실패 이유를 본다",
        async () => {
          // 전달 실패는 다음 조회에서 보인다(platform/notifications#R10).
          await flow.reload();
          await flow.until(
            `document.querySelector('[data-count="decisions"]')?.textContent?.includes("1 decision")`,
            "기다리는 결정 1개가 보이지 않는다",
          );
          await openNotificationsTab(flow);
          const row = `[data-notification="${notification}"]`;
          await flow.until(
            `!!document.querySelector('${row}[data-unread]')`,
            "읽지 않은 notification이 보이지 않는다",
          );
          assertEquals(
            await flow.text(`${row} [data-os-failed="show_failed"]`),
            "Couldn't show this as a desktop notification",
          );
          assertEquals(await flow.count("[data-notification]"), 1);
        },
      );

      await t.step(
        "6 읽음 표시는 approval을 그대로 두고 notification만 읽음이 된다",
        async () => {
          const row = `[data-notification="${notification}"]`;
          await flow.mouseClick(`${row} [data-mark-read]`);
          await flow.until(
            `!!document.querySelector('${row}') && !document.querySelector('${row}[data-unread]')`,
            "읽음으로 바뀌지 않았다",
          );
          assertEquals(await approvalStatus(flow), "pending");
          const after = await notifications(flow);
          assertEquals(after.length, 1);
          assert(after[0]!.notification.read_at !== null, "읽음이 없다");
        },
      );

      await t.step(
        "6 다시 연 뒤에도 읽음과 대기 결정이 그대로이고 notification이 늘지 않는다",
        async () => {
          await flow.close();
          flow = await openFlowShell({ start: "things-to-confirm", home });
          await flow.until(
            `document.querySelector('[data-count="decisions"]')?.textContent?.includes("1 decision")`,
            "다시 연 뒤 기다리는 결정이 보이지 않는다",
          );
          await openNotificationsTab(flow);
          const row = `[data-notification="${notification}"]`;
          await flow.until(
            `!!document.querySelector('${row}')`,
            "다시 연 뒤 notification이 보이지 않는다",
          );
          assertEquals(await flow.count(`${row}[data-unread]`), 0);
          assertEquals(await flow.count("[data-notification]"), 1);
          assertEquals(await approvalStatus(flow), "pending");
          const after = await notifications(flow);
          assertEquals(after.length, 1);
          assert(after[0]!.notification.read_at !== null, "읽음이 사라졌다");
        },
      );
    } finally {
      await flow.close();
      await removeHome(home);
    }
  },
});
