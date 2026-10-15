// 대기 목록의 고정 데이터. 모든 session의 대기 요청이 한 목록에 있고, 항목마다 어느 agent·session·앱 또는 project의
// 것인지 붙는다. 카드 문구는 program이 intent에서 만든 것이라 요청한 agent가 쓴 설명은 여기에 없다.
import type { AvatarProfile } from "@lophn/design/components";

import type { Vendor } from "../../vendors/vendor-icon.tsx";

export type Effect = "read" | "write" | "external";

export interface Requester {
  /** 요청한 agent의 이름. */
  readonly agent: string;
  readonly profile: AvatarProfile;
  /** coding agent면 harness의 vendor 아이콘을 avatar 대신 쓴다. */
  readonly vendor?: Vendor;
  /** 요청이 걸린 session의 제목. */
  readonly session: string;
  /** 어느 앱 또는 project의 것인지. */
  readonly scope: string;
  /** 요청한 지 얼마나 됐는지. */
  readonly age: string;
}

interface Base {
  readonly id: string;
  readonly from: Requester;
}

/** turn 안 request. app-api, MCP tool이면 선택지가 넷이고 설정 고치기면 둘이다. */
export interface PermissionItem extends Base {
  readonly kind: "permission";
  /** 대상을 부르는 동작 한 줄. */
  readonly action: string;
  /** program이 만든 한 줄 설명. */
  readonly summary: string;
  readonly target: string;
  /** 정규화한 입력. */
  readonly input: string;
  readonly effect: Effect;
  /** app-api·MCP tool이면 "tool", 설정 고치기면 "config". */
  readonly choices: "tool" | "config";
}

/** coding agent(harness)의 권한 물음. lophn 화면에서 답하지 않고 그 앱의 터미널 탭으로 간다. */
export interface CodingItem extends Base {
  readonly kind: "coding";
  readonly harness: string;
}

export interface QuestionItem extends Base {
  readonly kind: "question";
  readonly text: string;
  readonly options: readonly string[];
}

/** 앱 release의 선언 하나. */
export interface Declaration {
  readonly label: "Network host" | "Secret" | "File" | "Other app write";
  readonly value: string;
  readonly note?: string;
}

/** data 손실이 생길 수 있는 migration 단계. */
export interface LossStep {
  readonly what: string;
  readonly value: string;
}

/** activation 허락. 이전 활성 release보다 늘어난 선언과 손실 단계만 담는다. 첫 activation이면 previous가 없다. */
export interface ActivationItem extends Base {
  readonly kind: "activation";
  readonly app: string;
  readonly release: string;
  readonly previous?: string;
  readonly added: readonly Declaration[];
  readonly loss: readonly LossStep[];
}

/** 물음인 reaction. 어떤 domain event로 어떤 agent의 session을 열지 보인다. */
export interface ReactionItem extends Base {
  readonly kind: "reaction";
  readonly event: string;
  readonly detail: string;
  readonly opens: string;
}

export type WaitingItem =
  | PermissionItem
  | CodingItem
  | QuestionItem
  | ActivationItem
  | ReactionItem;

const OPERATOR: AvatarProfile = { kind: "icon", icon: "search" };
const ENGINEER: AvatarProfile = { kind: "icon", icon: "apps" };
const MANAGER: AvatarProfile = { kind: "icon", icon: "roles" };
const LOPHN: AvatarProfile = { kind: "icon", icon: "dock" };
const PROGRAM: AvatarProfile = { kind: "icon", icon: "compare" };

export const APP_API_CALL: PermissionItem = {
  id: "perm-app-api",
  kind: "permission",
  from: {
    agent: "Operator",
    profile: OPERATOR,
    session: "Month-end close",
    scope: "phroner project",
    age: "1 min ago",
  },
  action: "Call app-api in another app",
  summary: "Writes an entry in the Budget app.",
  target: "Budget › entries.create",
  input: '{ "category": "refunds", "amount": 1800, "month": "2026-09" }',
  effect: "write",
  choices: "tool",
};

export const EXTERNAL_CALL: PermissionItem = {
  id: "perm-mcp",
  kind: "permission",
  from: {
    agent: "Operator",
    profile: OPERATOR,
    session: "Month-end close",
    scope: "phroner project",
    age: "4 min ago",
  },
  action: "Call MCP tool",
  summary: "Sends an email through the mail server.",
  target: "mail › send_message",
  input: '{ "to": "finance@phroner.example", "subject": "Sep close" }',
  effect: "external",
  choices: "tool",
};

export const CONFIG_EDIT: PermissionItem = {
  id: "perm-config",
  kind: "permission",
  from: {
    agent: "Project Manager",
    profile: MANAGER,
    session: "Tighten review rules",
    scope: "phroner project",
    age: "6 min ago",
  },
  action: "Edit a settings file",
  summary: "Rewrites the Review rules section of LOPHN.md.",
  target: "LOPHN.md",
  input: 'Replace section "Review rules" (12 lines)',
  effect: "write",
  choices: "config",
};

const CODING_ASK: CodingItem = {
  id: "coding-orders",
  kind: "coding",
  from: {
    agent: "Claude Code",
    profile: { kind: "icon", icon: "terminal" },
    vendor: "claude-code",
    session: "Fix refund total",
    scope: "Orders app",
    age: "2 min ago",
  },
  harness: "Claude Code",
};

export const QUESTION: QuestionItem = {
  id: "question-weekly",
  kind: "question",
  from: {
    agent: "lophn",
    profile: LOPHN,
    session: "Weekly report",
    scope: "phroner project",
    age: "9 min ago",
  },
  text: "Include the three flaky scenarios in this week's regression count?",
  options: ["Include them", "Leave them out"],
};

export const ACTIVATION: ActivationItem = {
  id: "approval-activation",
  kind: "activation",
  from: {
    agent: "Orders App Engineer",
    profile: ENGINEER,
    session: "Refund flow",
    scope: "Orders app",
    age: "3 min ago",
  },
  app: "Orders",
  release: "release 7",
  previous: "release 6",
  added: [
    { label: "Network host", value: "api.payments.example" },
    { label: "Secret", value: "PAYMENTS_KEY" },
    { label: "File", value: "exports/", note: "read and write" },
    { label: "Other app write", value: "Inventory › stock.adjust" },
  ],
  loss: [
    { what: "Drops table", value: "legacy_orders" },
    { what: "Drops column", value: "orders.note" },
    { what: "Narrows type", value: "orders.total  number → integer" },
  ],
};

export const FIRST_ACTIVATION: ActivationItem = {
  id: "approval-first",
  kind: "activation",
  from: {
    agent: "Budget App Engineer",
    profile: ENGINEER,
    session: "Build the budget app",
    scope: "Budget app",
    age: "1 min ago",
  },
  app: "Budget",
  release: "release 1",
  added: [
    { label: "Network host", value: "rates.example.org" },
    { label: "Secret", value: "RATES_KEY" },
    { label: "File", value: "imports/", note: "read" },
    { label: "Other app write", value: "Orders › refunds.create" },
  ],
  loss: [],
};

export const REACTION: ReactionItem = {
  id: "approval-reaction",
  kind: "reaction",
  from: {
    agent: "Reaction",
    profile: PROGRAM,
    session: "",
    scope: "Orders app",
    age: "5 min ago",
  },
  event: "Problem opened in Orders app",
  detail: "Refund total does not match the order lines",
  opens: "Orders App Engineer",
};

/** 모든 종류가 섞인 한 목록. */
export const ALL_ITEMS: readonly WaitingItem[] = [
  APP_API_CALL,
  CODING_ASK,
  QUESTION,
  ACTIVATION,
  REACTION,
];

/** 결정한 뒤 잠깐 남는 줄. 접수와 적용 성공, 거절과 cancelled를 구별해 보인다. */
export interface SettledRow {
  readonly id: string;
  readonly title: string;
  readonly who: string;
  readonly state: "accepted" | "applied" | "denied" | "cancelled";
  readonly note: string;
}

export const SETTLED: readonly SettledRow[] = [
  {
    id: "settled-accepted",
    title: "Activate Orders release 7",
    who: "Orders App Engineer · Orders app",
    state: "accepted",
    note: "The activation is still running.",
  },
  {
    id: "settled-applied",
    title: "Open a session for Problem opened in Budget app",
    who: "Reaction · Budget app",
    state: "applied",
    note: "The Budget App Engineer session is open.",
  },
  {
    id: "settled-denied",
    title: "Call mail › send_message",
    who: "Operator · Month-end close",
    state: "denied",
    note: "The reason was sent to Operator.",
  },
  {
    id: "settled-cancelled",
    title: "Edit LOPHN.md",
    who: "Project Manager · Tighten review rules",
    state: "cancelled",
    note: "The turn ended before you answered.",
  },
];

/** 창 위 toast 한 줄. */
export interface ToastRow {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly action: string;
  /** 누르면 가는 곳. */
  readonly goes: "list" | "session";
}

export const TOASTS: readonly ToastRow[] = [
  {
    id: "toast-permission",
    title: "Operator needs permission",
    body: "Call Budget › entries.create (write)",
    action: "Review",
    goes: "list",
  },
  {
    id: "toast-approval",
    title: "Orders release 7 needs approval",
    body: "4 new declarations and 3 data-loss steps",
    action: "Review",
    goes: "list",
  },
  {
    id: "toast-question",
    title: "lophn has a question",
    body: "Weekly report",
    action: "Open session",
    goes: "session",
  },
  {
    id: "toast-restart",
    title: "App restart halted",
    body: "Orders kept crashing, so lophn stopped restarting it.",
    action: "Open session",
    goes: "session",
  },
];
