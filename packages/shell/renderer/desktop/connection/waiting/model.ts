// 대기 항목 하나를 카드가 그릴 값으로 바꾸는 순수 함수. 문구는 intent에서 program이 만든다(요청한 agent가 쓴
// 설명 칸은 없다). 대화 안 승인 카드도 이 함수를 쓴다.
import { formatRelativeTime, t } from "@lophn/wording";
import type {
  Intent,
  PendingApproval,
  RequestChoice,
} from "../../../../../protocol/approvals/mod.ts";
import { activationComparisonSchema } from "../../../../../protocol/apps/activation/activation.ts";
import type { AppGrantScope } from "../../../../../protocol/apps/mod.ts";
import type { CallAgent } from "../../../../../protocol/lophn-agent/calls.ts";
import type { WaitingEntry } from "../events/waiting-store.ts";

type Effect = "read" | "write" | "external";

/** 세부 칸 한 줄. */
interface Fact {
  readonly label: string;
  readonly value: string;
  readonly style: "text" | "code" | "effect";
  /** style이 effect일 때 효과 종류. */
  readonly effect?: Effect;
}

/** 늘어난 선언·손실 단계 한 줄. */
export interface Line {
  readonly label: string;
  readonly value: string;
}

export interface CardView {
  readonly kind: WaitingEntry["kind"];
  readonly title: string;
  readonly description: string;
  /** 누가·어느 session·어느 앱 또는 project. */
  readonly meta: string;
  readonly age: string;
  /** 요청한 agent의 이름. 거절 이유가 간다. agent가 없으면 null이다. */
  readonly requester: string | null;
  /** 펼쳤을 때 보이는 줄. 없으면 펼침 토글도 없다. */
  readonly facts: readonly Fact[];
  /** activation 카드의 늘어난 선언. */
  readonly added: readonly Line[];
  readonly loss: readonly Line[];
  /** 이전 활성 release가 없다. */
  readonly first: boolean;
  /** request가 가진 선택지 그대로. */
  readonly choices: readonly RequestChoice[];
}

/** id의 뒤쪽 여섯 글자. 이름을 모르는 session·앱·project를 구별한다. */
export function shortId(id: string): string {
  return id.slice(-6);
}

const AGENT_LABELS = {
  lophn: "waiting.label.agent-lophn",
  operator: "waiting.label.agent-operator",
  project_manager: "waiting.label.agent-project-manager",
  app_engineer: "waiting.label.agent-project-manager",
  coding_agent: "waiting.label.agent-coding",
} as const;

export function agentLabel(agent: CallAgent): string {
  return t(AGENT_LABELS[agent.role]);
}

function requesterOf(entry: WaitingEntry): string | null {
  return entry.agent === null ? null : agentLabel(entry.agent);
}

function metaOf(entry: WaitingEntry): string {
  const who = entry.agent !== null
    ? agentLabel(entry.agent)
    : entry.kind === "reaction"
    ? t("waiting.label.agent-reaction")
    : t("waiting.label.agent-lophn");
  const place = entry.place === null
    ? ""
    : entry.place.kind === "project"
    ? t("waiting.label.place-project", { id: shortId(entry.place.id) })
    : t("waiting.label.place-app", { id: shortId(entry.place.id) });
  const session = entry.session === null
    ? ""
    : t("waiting.label.session", { id: shortId(entry.session) });
  return [who, session, place].filter((part) => part !== "").join(" · ");
}

const EFFECT_LABELS = {
  read: "waiting.label.effect-read",
  write: "waiting.label.effect-write",
  external: "waiting.label.effect-external",
} as const;

const SETTINGS_LABELS = {
  instructions: "waiting.label.settings-instructions",
  agent_definition: "waiting.label.settings-agent-definition",
  skill: "waiting.label.settings-skill",
  setting: "waiting.label.settings-setting",
  grant: "waiting.label.settings-grant",
} as const;

const EVENT_LABELS = {
  ProblemOpened: "waiting.label.event-problem-opened",
  ProblemReopened: "waiting.label.event-problem-reopened",
  AppRestartHalted: "waiting.label.event-app-restart-halted",
  ReleaseActivationFailed: "waiting.label.event-activation-failed",
  KindViolationFound: "waiting.label.event-kind-violation",
  PublicToolsChanged: "waiting.label.event-public-tools-changed",
} as const;

const DECLARED_LABELS = {
  "net.fetch": "waiting.label.declared-network",
  "net.listen": "waiting.label.declared-listen",
  "secret.use": "waiting.label.declared-secret",
  "fs.read": "waiting.label.declared-file-read",
  "fs.write": "waiting.label.declared-file-write",
} as const;

const LOSS_LABELS = {
  drop_table: "waiting.label.loss-drop-table",
  drop_column: "waiting.label.loss-drop-column",
  narrow_type: "waiting.label.loss-narrow-type",
} as const;

function json(value: unknown): string {
  return JSON.stringify(value);
}

function scopeText(scope: AppGrantScope): string {
  switch (scope.kind) {
    case "fs.read":
    case "fs.write":
      return `${t(DECLARED_LABELS[scope.kind])} ${scope.path}${
        scope.recursive ? "/**" : ""
      }`;
    case "net.fetch":
    case "net.listen":
      return `${t(DECLARED_LABELS[scope.kind])} ${scope.host}:${scope.port}`;
    case "secret.use":
      return `${t(DECLARED_LABELS[scope.kind])} ${scope.name}`;
    case "app.call":
      return `${t("waiting.label.declared-app-api")} ${
        t("waiting.label.place-app", { id: shortId(scope.app) })
      } › ${scope.app_apis.join(", ")}`;
  }
}

function targetOf(intent: Intent): string {
  const target = intent.target;
  switch (target.kind) {
    case "app_api":
      return t("waiting.label.target-app-api", {
        app: t("waiting.label.place-app", { id: shortId(target.app) }),
        api: target.api,
      });
    case "mcp_tool":
      return t("waiting.label.target-mcp-tool", {
        server: target.server,
        tool: target.tool,
      });
    case "agent_call":
      return agentLabel(target.agent);
    case "settings_edit":
      return t(SETTINGS_LABELS[target.what]);
    case "app_resource":
      return scopeText(target.scope);
    case "reaction":
      return t(EVENT_LABELS[target.event]);
    case "activation":
      return t("waiting.label.place-app", { id: shortId(target.app) });
  }
}

function titleAndDescription(
  intent: Intent,
  target: string,
): { title: string; description: string } {
  const t_ = intent.target;
  switch (t_.kind) {
    case "app_api":
      return {
        title: t("waiting.title.app-api", {
          api: t_.api,
          app: t("waiting.label.place-app", { id: shortId(t_.app) }),
        }),
        description: intent.effect === "read"
          ? t("waiting.notice.app-api-read", { target })
          : intent.effect === "write"
          ? t("waiting.notice.app-api-write", { target })
          : t("waiting.notice.app-api-external", { target }),
      };
    case "mcp_tool":
      return {
        title: t("waiting.title.mcp-tool", { tool: t_.tool }),
        description: t("waiting.notice.mcp-tool", { target }),
      };
    case "settings_edit":
      return {
        title: t("waiting.title.settings-edit"),
        description: t("waiting.notice.settings-edit", { what: target }),
      };
    case "agent_call":
      return {
        title: t("waiting.title.agent-call"),
        description: t("waiting.notice.agent-call", { agent: target }),
      };
    default:
      return {
        title: t("waiting.title.app-resource"),
        description: t("waiting.notice.app-resource", { target }),
      };
  }
}

function declaredLines(resources: readonly string[]): Line[] {
  return resources.map((resource) => {
    const at = resource.indexOf(":");
    const kind = at === -1 ? "" : resource.slice(0, at);
    if (kind in DECLARED_LABELS) {
      return {
        label: t(DECLARED_LABELS[kind as keyof typeof DECLARED_LABELS]),
        value: resource.slice(at + 1),
      };
    }
    return { label: t("waiting.label.declared-other"), value: resource };
  });
}

function activationView(request: PendingApproval) {
  const parsed = activationComparisonSchema.safeParse(request.intent.input);
  const comparison = parsed.success ? parsed.data : null;
  const added: Line[] = [
    ...declaredLines(comparison?.added_resources ?? []),
    ...(comparison?.added_app_apis ?? []).map((use) => ({
      label: t("waiting.label.declared-app-api"),
      value: `${
        t("waiting.label.place-app", { id: shortId(use.app) })
      } › ${use.api}`,
    })),
  ];
  const loss: Line[] = (comparison?.loss_steps ?? []).flatMap((step) =>
    step.loss.map((one) => ({
      label: t(LOSS_LABELS[one.kind]),
      value: one.column === undefined
        ? one.table
        : `${one.table}.${one.column}`,
    }))
  );
  return { added, loss, first: comparison?.first ?? false };
}

const NO_LINES: readonly Line[] = [];

export function cardOf(entry: WaitingEntry, now = new Date()): CardView {
  const base = {
    kind: entry.kind,
    meta: metaOf(entry),
    age: formatRelativeTime(new Date(entry.receivedAt), now),
    requester: requesterOf(entry),
    facts: [] as Fact[],
    added: NO_LINES,
    loss: NO_LINES,
    first: false,
    choices: [] as readonly RequestChoice[],
  };
  switch (entry.kind) {
    case "coding":
      return {
        ...base,
        title: t("waiting.title.coding"),
        description: t("waiting.notice.coding"),
      };
    case "coding_start":
      return {
        ...base,
        title: t("waiting.title.coding-start"),
        description: t("waiting.notice.coding-start"),
      };
    case "question":
      return {
        ...base,
        title: t("waiting.title.question"),
        description: t("waiting.notice.question-loading"),
      };
    case "permission": {
      const intent = entry.request.intent;
      const target = targetOf(intent);
      return {
        ...base,
        ...titleAndDescription(intent, target),
        facts: [
          {
            label: t("waiting.label.fact-target"),
            value: target,
            style: "text",
          },
          {
            label: t("waiting.label.fact-input"),
            value: json(intent.input),
            style: "code",
          },
          {
            label: t("waiting.label.fact-effect"),
            value: t(EFFECT_LABELS[intent.effect]),
            style: "effect",
            effect: intent.effect,
          },
        ],
        choices: entry.request.choices,
      };
    }
    case "activation": {
      const view = activationView(entry.request);
      const counts = { declared: view.added.length, lost: view.loss.length };
      return {
        ...base,
        ...view,
        title: t("waiting.title.activation", {
          app: targetOf(entry.request.intent),
        }),
        description: view.first
          ? t("waiting.notice.activation-first", counts)
          : t("waiting.notice.activation-since", counts),
        choices: entry.request.choices,
      };
    }
    case "reaction": {
      const intent = entry.request.intent;
      const event = intent.target.kind === "reaction"
        ? intent.target.event
        : null;
      const eventText = event === null ? "" : t(EVENT_LABELS[event]);
      const opens = t("waiting.label.agent-project-manager");
      const detail = Object.keys(intent.input).length === 0
        ? null
        : json(intent.input);
      return {
        ...base,
        title: t("waiting.title.reaction", { agent: opens }),
        description: eventText,
        facts: [
          {
            label: t("waiting.label.fact-event"),
            value: eventText,
            style: "text",
          },
          ...(detail === null ? [] : [{
            label: t("waiting.label.fact-detail"),
            value: detail,
            style: "code" as const,
          }]),
          { label: t("waiting.label.fact-opens"), value: opens, style: "text" },
        ],
        choices: entry.request.choices,
      };
    }
  }
}
