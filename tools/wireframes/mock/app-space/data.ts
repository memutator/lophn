// 앱 공간 gallery page들이 같이 쓰는 고정 데이터. 운영 패널과 문제 목록은 앞 화면의 fake source가 채우고 여기는 Orders 앱
// 화면과 run 목록의 고정 값을 둔다.

import type { RunRecordView } from "../../../../packages/shell/renderer/workspace/sidebar/run-list.tsx";
import { BUDGET_REVIEWER_ID } from "../../../../packages/shell/renderer/workspace/agents/fake-source.ts";

export const APP_NAME = "Orders";

// ---- 앱 화면 (Orders가 그린 view) ----

interface OrderRow {
  readonly id: string;
  readonly customer: string;
  readonly status: "Open" | "Shipped";
  readonly total: string;
}

export const ORDER_ROWS: readonly OrderRow[] = [
  { id: "1043", customer: "Hana Park", status: "Open", total: "$18.50" },
  { id: "1042", customer: "Dae Kim", status: "Open", total: "$41.99" },
  { id: "1041", customer: "Jun Seo", status: "Shipped", total: "$73.00" },
  { id: "1040", customer: "Ari Choi", status: "Shipped", total: "$9.20" },
];

// ---- Background(run) 목록 ----

// 가짜 대화 source(`mockAgentTabSource`)가 아는 session id. 이 id의 session은 제목이 보이고 나머지는 "New session"이다.
const KNOWN = "ses_01h455vb4pex5v6nkc6gd5f";
const MINUTE = 60_000;
const ago = (minutes: number) =>
  new Date(Date.now() - minutes * MINUTE).toISOString();

/**
 * 이 앱의 고정 run 기록. Budget reviewer 둘(running, failed)과 이 앱에 놓인 다른 agent 하나(done)의 agent run은 session을 열었고,
 * Orders tool run 둘(done, failed)은 session이 없다. agent run 하나와 tool run 하나(done)는 job이 열어 job 제목이 이름 자리에 온다. 다른 앱의 run이나 lophn run도 섞여 있어 목록이 이 앱 것만 남기는 것을 보인다.
 */
export function fixedRuns(app: string): readonly RunRecordView[] {
  const operator = {
    agent: BUDGET_REVIEWER_ID,
    place: { kind: "app", id: app },
  } as const;
  return [
    {
      id: "run_budget_running",
      kind: "agent",
      target: { agent: operator },
      session: `${KNOWN}001`,
      session_opened: true,
      state: "running",
      created_at: ago(3),
      job: null,
    },
    {
      id: "run_operator_done",
      kind: "agent",
      target: { agent: operator },
      session: `${KNOWN}002`,
      session_opened: true,
      state: "done",
      created_at: ago(55),
      job: { id: "job_fakebudgetcheck", title: "Check budget limits" },
    },
    {
      id: "run_tool_done",
      kind: "tool",
      target: { app, tool: "orders.export_csv" },
      session: null,
      session_opened: false,
      state: "done",
      created_at: ago(90),
      job: { id: "job_fakeexport", title: "Export orders nightly" },
    },
    {
      id: "run_budget_failed",
      kind: "agent",
      target: { agent: operator },
      session: `${KNOWN}004`,
      session_opened: true,
      state: "failed",
      created_at: ago(5 * 60),
      job: null,
    },
    {
      id: "run_tool_failed",
      kind: "tool",
      target: { app, tool: "orders.sync_inventory" },
      session: null,
      session_opened: false,
      state: "failed",
      created_at: ago(26 * 60),
      job: null,
    },
    {
      id: "run_other_app",
      kind: "tool",
      target: {
        app: "app_01h455vb4pex5v6nkc6gd5fd09",
        tool: "budget.close_month",
      },
      session: null,
      session_opened: false,
      state: "done",
      created_at: ago(30),
      job: null,
    },
    {
      id: "run_lophn",
      kind: "agent",
      target: { agent: { agent: "lophn", place: null } },
      session: null,
      session_opened: false,
      state: "done",
      created_at: ago(20),
      job: null,
    },
  ];
}
