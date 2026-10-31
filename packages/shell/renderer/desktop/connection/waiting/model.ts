// 대기 항목 하나를 카드가 그릴 값으로 바꾸는 순수 함수. 문구는 turn request의 subject와 activation 동의에서
// program이 만든다(요청한 agent가 쓴 설명 칸은 없다).
import { formatRelativeTime, t } from "@lophn/i18n";
import type { TurnRequest } from "../../../../../protocol/approvals/turn-request.ts";
import type { ActivationConsent } from "../../../../../protocol/apps/activation/consent.ts";
import type { JobHold } from "../../../../../protocol/jobs/jobs.ts";
import type { JobAction } from "../../../../../protocol/jobs/values.ts";
import {
  type AgentId,
  LOPHN_AGENT_ID,
} from "../../../../../protocol/lophn-agent/places.ts";
import type { WaitingEntry } from "../events/waiting-store.ts";
import { turnChoicesOf, type WaitingChoice } from "./decide.ts";

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
  /** 세부가 사람이 정할 거리 전부라(shell 명령) 접지 않고 늘 보인다. */
  readonly factsPinned: boolean;
  /** activation 카드의 늘어난 선언. */
  readonly added: readonly Line[];
  readonly loss: readonly Line[];
  /** 이전 활성 release가 없다. */
  readonly first: boolean;
  readonly choices: readonly WaitingChoice[];
}

/** id의 뒤쪽 여섯 글자. 이름을 모르는 session·앱·project를 구별한다. */
export function shortId(id: string): string {
  return id.slice(-6);
}

// 카드는 agent 정의를 읽지 않아 이름 대신 lophn과 그 밖의 agent만 가른다.
export function agentLabel(agent: AgentId): string {
  return t(
    agent === LOPHN_AGENT_ID
      ? "waiting.label.agent-lophn"
      : "waiting.label.agent-unnamed",
  );
}

function requesterOf(entry: WaitingEntry): string | null {
  return entry.agent === null ? null : agentLabel(entry.agent);
}

function metaOf(entry: WaitingEntry): string {
  const who =
    entry.agent !== null
      ? agentLabel(entry.agent)
      : t("waiting.label.agent-lophn");
  const place =
    entry.place === null
      ? ""
      : entry.place.kind === "project"
        ? t("waiting.label.place-project", { id: shortId(entry.place.id) })
        : t("waiting.label.place-app", { id: shortId(entry.place.id) });
  const session =
    entry.session === null
      ? ""
      : t("waiting.label.session", { id: shortId(entry.session) });
  // activation 동의는 앱이 대상이고 요청한 agent도 session도 없다. 앱은 id 대신 이름이다.
  if (entry.kind === "activation") return entry.request.app_name;
  return [who, session, place].filter((part) => part !== "").join(" · ");
}

const EFFECT_LABELS = {
  read: "waiting.label.effect-read",
  write: "waiting.label.effect-write",
  external: "waiting.label.effect-external",
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

function appText(app: string): string {
  return t("waiting.label.place-app", { id: shortId(app) });
}

/** 도구 물음의 대상 한 줄. shell은 명령 자체가 세부라 대상 칸이 없다. */
function toolTarget(
  subject: Exclude<TurnRequest["subject"], { kind: "shell" | "harness" }>,
): string {
  return subject.kind === "app_tool"
    ? t("waiting.label.target-tool", {
        app: appText(subject.app),
        tool: subject.tool,
      })
    : t("waiting.label.target-mcp-tool", {
        server: subject.server,
        tool: subject.tool,
      });
}

function permissionView(request: TurnRequest) {
  const subject = request.subject;
  const choices = turnChoicesOf(request);
  switch (subject.kind) {
    case "shell":
      return {
        title: t("waiting.title.shell"),
        description: t("waiting.notice.shell"),
        factsPinned: true,
        facts: [
          {
            label: t("waiting.label.fact-command"),
            value: subject.command,
            style: "code" as const,
          },
          ...(request.always_patterns.length === 0
            ? []
            : [
                {
                  label: t("waiting.label.fact-always"),
                  value: request.always_patterns.join(", "),
                  style: "code" as const,
                },
              ]),
        ],
        choices,
      };
    case "app_tool": {
      const target = toolTarget(subject);
      return {
        title: t("waiting.title.tool", {
          tool: subject.tool,
          app: appText(subject.app),
        }),
        description:
          subject.effect === "read"
            ? t("waiting.notice.tool-read", { target })
            : subject.effect === "write"
              ? t("waiting.notice.tool-write", { target })
              : t("waiting.notice.tool-external", { target }),
        factsPinned: false,
        facts: toolFacts(target, subject.effect),
        choices,
      };
    }
    case "mcp_tool": {
      const target = toolTarget(subject);
      return {
        title: t("waiting.title.mcp-tool", { tool: subject.tool }),
        description: t("waiting.notice.mcp-tool", { target }),
        factsPinned: false,
        facts: toolFacts(target, subject.effect),
        choices,
      };
    }
    case "harness":
      return {
        title: t("waiting.title.coding"),
        description: t("waiting.notice.coding"),
        factsPinned: false,
        facts: [],
        choices: [],
      };
  }
}

function toolFacts(target: string, effect: Effect): Fact[] {
  return [
    { label: t("waiting.label.fact-target"), value: target, style: "text" },
    {
      label: t("waiting.label.fact-effect"),
      value: t(EFFECT_LABELS[effect]),
      style: "effect",
      effect,
    },
  ];
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

function activationView(comparison: ActivationConsent["comparison"]) {
  const added: Line[] = [
    ...declaredLines(comparison.added_resources),
    ...comparison.added_tools.map((use) => ({
      label: t("waiting.label.declared-tool"),
      value: `${appText(use.app)} › ${use.tool}`,
    })),
  ];
  const loss: Line[] = comparison.loss_steps.flatMap((step) =>
    step.loss.map((one) => ({
      label: t(LOSS_LABELS[one.kind]),
      value:
        one.column === undefined ? one.table : `${one.table}.${one.column}`,
    })),
  );
  return { added, loss, first: comparison.first };
}

/** job이 할 일 한 줄. 앱은 id뿐이라 짧은 id로 보인다. */
function jobActionText(action: JobAction): string {
  switch (action.kind) {
    case "agent_run":
      return t("waiting.notice.job-agent", { agent: agentLabel(action.agent) });
    case "tool_run":
      return t("waiting.notice.job-tool", {
        tool: action.tool,
        app: appText(action.app),
      });
    case "workflow_start":
      return t("waiting.notice.job-workflow", { workflow: action.workflow });
  }
}

/** 놓친 수와 마지막 차례 시각. */
export function jobHoldNote(hold: JobHold, now = new Date()): string {
  return t("waiting.notice.job-missed", {
    count: hold.job_run.missed_count,
    due: formatRelativeTime(new Date(hold.job_run.due_at), now),
  });
}

const NO_LINES: readonly Line[] = [];

export function cardOf(entry: WaitingEntry, now = new Date()): CardView {
  const base = {
    kind: entry.kind,
    meta: metaOf(entry),
    age: formatRelativeTime(new Date(entry.receivedAt), now),
    requester: requesterOf(entry),
    facts: [] as Fact[],
    factsPinned: false,
    added: NO_LINES,
    loss: NO_LINES,
    first: false,
    choices: [] as readonly WaitingChoice[],
  };
  switch (entry.kind) {
    case "question":
      return {
        ...base,
        title: t("waiting.title.question"),
        description: t("waiting.notice.question-loading"),
      };
    case "permission":
      return { ...base, ...permissionView(entry.request) };
    case "job_hold":
      return {
        ...base,
        title: entry.hold.job.title,
        description: jobActionText(entry.hold.job.action),
      };
    case "job_approval":
      return {
        ...base,
        title: entry.job.title,
        description: jobActionText(entry.job.action),
      };
    case "activation": {
      const view = activationView(entry.request.comparison);
      const counts = { declared: view.added.length, lost: view.loss.length };
      return {
        ...base,
        ...view,
        title: t("waiting.title.activation", {
          app: appText(entry.request.app),
        }),
        description: view.first
          ? t("waiting.notice.activation-first", counts)
          : t("waiting.notice.activation-since", counts),
        choices: ["allow", "reject"],
      };
    }
  }
}
