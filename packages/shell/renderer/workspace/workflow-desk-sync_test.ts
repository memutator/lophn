import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodingSession } from "../../../protocol/coding-agent/relay.ts";
import type { WorkflowOrigin } from "../../../protocol/workflows/origin.ts";
import type { SessionEntry } from "../desktop/connection/events/sessions-store.ts";
import {
  addDesk,
  defaultWorkspaceLayout,
  openTab,
  updateDesk,
} from "../shell/desk-model.ts";
import type { WorkflowInstanceSummaryView } from "./source.ts";
import {
  dismissedRunKey,
  dismissedSessionKey,
  dismissedTerminalKey,
  planWorkflowDeskSync,
} from "./workflow-desk-sync.ts";

const PROJECT = "prj_01m7skhem7kxqrxdnhwm4r96s1";
const OTHER_PROJECT = "prj_01m86hzhbtm24cj1qbrpw94tr8";
const INSTANCE = "wfi_01m8f0sh948bjk326z08hm173q";
const SES_OPEN = "ses_01000000000000000000000001";
const SES_DISMISSED = "ses_01000000000000000000000002";
const SES_NEW = "ses_01000000000000000000000003";

const origin = (
  step: string,
  overrides: Partial<WorkflowOrigin> = {},
): WorkflowOrigin => ({
  project: PROJECT,
  workflow: "feature-cleanroom",
  instance: INSTANCE,
  step,
  ...overrides,
});

function sessionEntry(
  session: string,
  over: Partial<SessionEntry> = {},
): SessionEntry {
  return {
    session,
    state: "running",
    archived: false,
    ended: null,
    agent: "lophn_prj_01m86hzhbtm24cj1qbrpw94tr8",
    workspace: { kind: "project", id: OTHER_PROJECT },
    spawnedBy: null,
    workflowOrigin: origin("research"),
    unseen: false,
    ...over,
  };
}

function codingSession(
  terminal: string,
  over: Partial<CodingSession> = {},
): CodingSession {
  return {
    session: "ses_01m8f0shayz2n0wapd23g5fr0c",
    terminal,
    harness: "antigravity",
    label: "Antigravity",
    project: OTHER_PROJECT,
    cwd: "/home/ubuntu/projects/harness-lab",
    title: null,
    state: "running",
    view: "gui",
    handoff: "restart",
    cli_session: null,
    last_active_at: null,
    switch: null,
    workflow_origin: origin("research-antigravity"),
    ...over,
  };
}

const runningInstance: WorkflowInstanceSummaryView = {
  id: INSTANCE,
  project: PROJECT,
  workflow: "feature-cleanroom",
  title: "TUI research",
  input: "research tui",
  state: "running",
  current: { step: "research-antigravity", human_turn: false },
  started_by: { kind: "user" },
  last_line: null,
  derived_status: "working",
  created_at: "2026-11-27T17:28:03.148Z",
  finished_at: null,
};

test("실행 중 workflow instance의 cross-project session과 GUI 터미널을 run 탭과 함께 instance desk로 모은다", () => {
  const plan = planWorkflowDeskSync({
    projectId: PROJECT,
    layout: defaultWorkspaceLayout(),
    runningWorkflows: [runningInstance],
    sessions: [
      sessionEntry("ses_worker_1"),
      sessionEntry("ses_archived", { archived: true }),
      sessionEntry("ses_other_project", {
        workflowOrigin: origin("research", { project: OTHER_PROJECT }),
      }),
    ],
    codingSessions: [codingSession("trm_agy_1")],
    dismissedTabs: new Set(),
    dismissedDesks: new Set(),
  });

  assert.deepStrictEqual(plan, [
    {
      kind: "run",
      instance: INSTANCE,
      workflow: "feature-cleanroom",
      title: "TUI research",
    },
    {
      kind: "session",
      session: "ses_worker_1",
      origin: origin("research"),
    },
    {
      kind: "terminal",
      terminal: "trm_agy_1",
      origin: origin("research-antigravity"),
    },
  ]);
});

test("이미 열린 탭과 사람이 직접 닫은 탭·지운 desk는 다시 열지 않는다", () => {
  let layout = addDesk(
    defaultWorkspaceLayout(),
    INSTANCE,
    "TUI research",
    "feature-cleanroom",
    INSTANCE,
  );
  layout = updateDesk(layout, INSTANCE, (desk) =>
    openTab(
      openTab(
        openTab(desk, {
          key: `workflow-instance:${INSTANCE}`,
          kind: "workflow",
          title: "TUI research",
          fields: { workflow: "feature-cleanroom", instance: INSTANCE },
        }),
        {
          key: `agent:${SES_OPEN}`,
          kind: "agent",
          title: "worker",
          fields: {
            agent: "lophn_prj_01m86hzhbtm24cj1qbrpw94tr8",
            workspace: OTHER_PROJECT,
            session: SES_OPEN,
          },
        },
      ),
      {
        key: "terminal-1",
        kind: "terminal",
        title: "Antigravity",
        fields: { terminal: "trm_open" },
      },
    ),
  );

  const plan = planWorkflowDeskSync({
    projectId: PROJECT,
    layout,
    runningWorkflows: [runningInstance],
    sessions: [
      sessionEntry(SES_OPEN),
      sessionEntry(SES_DISMISSED),
      sessionEntry(SES_NEW),
    ],
    codingSessions: [
      codingSession("trm_open"),
      codingSession("trm_dismissed"),
      codingSession("trm_new"),
    ],
    dismissedTabs: new Set([
      dismissedRunKey(INSTANCE),
      dismissedSessionKey(SES_DISMISSED),
      dismissedTerminalKey("trm_dismissed"),
    ]),
    dismissedDesks: new Set(),
  });

  assert.deepStrictEqual(plan, [
    { kind: "session", session: SES_NEW, origin: origin("research") },
    {
      kind: "terminal",
      terminal: "trm_new",
      origin: origin("research-antigravity"),
    },
  ]);

  // desk 자체가 닫혔고 dismissedDesks에 있으면 배경 생성하지 않는다.
  const dismissedDeskPlan = planWorkflowDeskSync({
    projectId: PROJECT,
    layout: defaultWorkspaceLayout(),
    runningWorkflows: [runningInstance],
    sessions: [sessionEntry(SES_NEW)],
    codingSessions: [codingSession("trm_new")],
    dismissedTabs: new Set(),
    dismissedDesks: new Set([INSTANCE]),
  });
  assert.deepStrictEqual(dismissedDeskPlan, []);
});
