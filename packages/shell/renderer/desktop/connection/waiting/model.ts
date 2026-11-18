// 대기 항목 하나를 카드가 그릴 값으로 바꾸는 순수 함수. 문구는 turn request의 subject와 activation 동의에서
// program이 만든다(요청한 agent가 쓴 설명 칸은 없다).
import { formatRelativeTime, t } from "@lophn/i18n";
import type { TurnRequest } from "../../../../../protocol/approvals/turn-request.ts";
import type { ShareRequest } from "../../../../../protocol/approvals/share-request.ts";
import type { ActivationConsent } from "../../../../../protocol/apps/activation/consent.ts";
import type { JobHold } from "../../../../../protocol/jobs/jobs.ts";
import type { JobAction } from "../../../../../protocol/jobs/values.ts";
import {
  type AgentId,
  isLophn,
} from "../../../../../protocol/lophn-agent/workspaces.ts";
import type { WaitingEntry } from "../events/waiting-store.ts";
import { turnChoicesOf, type WaitingChoice } from "./decide.ts";
import { type InboxNames, NO_NAMES } from "./names.ts";

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

export interface ShareView {
  readonly who: string;
  readonly reason: string;
  readonly skills: number;
  readonly commands: number;
}

function shareWho(request: ShareRequest): string {
  return [
    ...request.agents.map((agent) => agent.name),
    ...(request.coding_agents ? [t("waiting.label.share-coding")] : []),
  ].join(", ");
}

export interface CardView {
  readonly kind: WaitingEntry["kind"];
  /** 이 컴퓨터가 아닌 기계의 이름(꼬리표). */
  readonly machine: string | undefined;
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
  /** activation 카드가 같이 승인할 앱 공유 요청. */
  readonly share: ShareView | null;
  readonly choices: readonly WaitingChoice[];
}

/** id의 뒤쪽 여섯 글자. 이름을 모르는 session·앱·project를 구별한다. */
export function shortId(id: string): string {
  return id.slice(-6);
}

// 카드는 agent 정의를 읽지 않아 이름 대신 lophn과 그 밖의 agent만 가른다.
export function agentLabel(agent: AgentId): string {
  return t(
    isLophn(agent)
      ? "waiting.label.agent-lophn"
      : "waiting.label.agent-unnamed",
  );
}

function requesterOf(entry: WaitingEntry): string | null {
  return entry.agent === null ? null : agentLabel(entry.agent);
}

function metaOf(entry: WaitingEntry, names: InboxNames): string {
  const who =
    entry.agent !== null
      ? agentLabel(entry.agent)
      : t("waiting.label.agent-lophn");
  const workspace =
    entry.workspace === null
      ? ""
      : entry.workspace.kind === "project"
        ? (names.projects.get(entry.workspace.id) ??
          t("waiting.label.workspace-project", {
            id: shortId(entry.workspace.id),
          }))
        : appText(entry.workspace.id, names);
  const session =
    entry.session === null
      ? ""
      : t("waiting.label.session", { id: shortId(entry.session) });
  // activation 동의는 앱이 대상이고 요청한 agent도 session도 없다. 앱은 id 대신 이름이다.
  if (entry.kind === "activation") return entry.request.app_name;
  // 공유 요청은 그 앱 workspace의 agent가 청했다. session의 agent 이름은 요청에 없어 앱 이름을 보인다.
  if (entry.kind === "share") return entry.request.app_name;
  return [who, session, workspace].filter((part) => part !== "").join(" · ");
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

function appText(app: string, names: InboxNames): string {
  return (
    names.apps.get(app) ??
    t("waiting.label.workspace-app", { id: shortId(app) })
  );
}

/** 도구 물음의 대상 한 줄. shell은 명령 자체가 세부라 대상 칸이 없다. */
function toolTarget(
  subject: Exclude<
    TurnRequest["subject"],
    { kind: "shell" | "harness" | "setting" }
  >,
  names: InboxNames,
): string {
  return subject.kind === "app_tool"
    ? t("waiting.label.target-tool", {
        app: appText(subject.app, names),
        tool: subject.tool,
      })
    : t("waiting.label.target-mcp-tool", {
        server: subject.server,
        tool: subject.tool,
      });
}

function permissionView(request: TurnRequest, names: InboxNames) {
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
    // 바뀜이 사람이 정할 거리 전부라 늘 보인다. 줄은 core가 만든 그대로(전체 경로)다.
    case "setting":
      return {
        title: t("waiting.title.setting"),
        description: t("waiting.notice.setting"),
        factsPinned: true,
        facts: subject.lines.map((line, at) => ({
          label:
            subject.lines.length === 1
              ? t("waiting.label.fact-change")
              : t("waiting.label.fact-change-nth", { n: at + 1 }),
          value: line,
          style: "text" as const,
        })),
        choices,
      };
    case "app_tool": {
      const target = toolTarget(subject, names);
      return {
        title: t("waiting.title.tool", {
          tool: subject.tool,
          app: appText(subject.app, names),
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
      const target = toolTarget(subject, names);
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
    // scope가 없는 자원이라 이름이 kind 하나다.
    if (resource === "notify.send") {
      return {
        label: t("waiting.label.declared-notify"),
        value: t("waiting.label.declared-notify-value"),
      };
    }
    const at = resource.indexOf(":");
    const kind = at === -1 ? "" : resource.slice(0, at);
    // 폰 기능은 이름 대신 사람이 읽는 한 문장이다. 모르는 capability는 이름 그대로 보인다.
    if (kind === "phone.use") {
      const capability = resource.slice(at + 1);
      return {
        label: t("waiting.label.declared-phone"),
        value:
          capability === "location.get"
            ? t("waiting.label.declared-phone-location")
            : capability,
      };
    }
    if (kind in DECLARED_LABELS) {
      return {
        label: t(DECLARED_LABELS[kind as keyof typeof DECLARED_LABELS]),
        value: resource.slice(at + 1),
      };
    }
    return { label: t("waiting.label.declared-other"), value: resource };
  });
}

function activationView(
  comparison: ActivationConsent["comparison"],
  names: InboxNames,
) {
  const added: Line[] = [
    ...declaredLines(comparison.added_resources),
    ...comparison.added_tools.map((use) => ({
      label: t("waiting.label.declared-tool"),
      value: `${appText(use.app, names)} › ${use.tool}`,
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

/** job이 할 일 한 줄. */
function jobActionText(action: JobAction, names: InboxNames): string {
  switch (action.kind) {
    case "agent_run":
      return t("waiting.notice.job-agent", { agent: agentLabel(action.agent) });
    case "tool_run":
      return t("waiting.notice.job-tool", {
        tool: action.tool,
        app: appText(action.app, names),
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

export function cardOf(
  entry: WaitingEntry & { readonly machineName?: string | undefined },
  names: InboxNames = NO_NAMES,
  now = new Date(),
): CardView {
  const base = {
    kind: entry.kind,
    machine: entry.machineName,
    meta: metaOf(entry, names),
    age: formatRelativeTime(new Date(entry.receivedAt), now),
    requester: requesterOf(entry),
    facts: [] as Fact[],
    factsPinned: false,
    added: NO_LINES,
    loss: NO_LINES,
    first: false,
    share: null as ShareView | null,
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
      return { ...base, ...permissionView(entry.request, names) };
    case "job_hold":
      return {
        ...base,
        title: entry.hold.job.title,
        description: jobActionText(entry.hold.job.action, names),
      };
    case "job_approval":
      return {
        ...base,
        title: entry.job.title,
        description: jobActionText(entry.job.action, names),
      };
    case "share": {
      const { request } = entry;
      const who = shareWho(request);
      return {
        ...base,
        title: t("waiting.title.share", { app: request.app_name }),
        description: t("waiting.notice.share", {
          who,
          skills: request.public_skills,
          commands: request.public_commands,
        }),
      };
    }
    case "activation": {
      const view = activationView(entry.request.comparison, names);
      const counts = { declared: view.added.length, lost: view.loss.length };
      return {
        ...base,
        ...view,
        title: t("waiting.title.activation", {
          app: appText(entry.request.app, names),
        }),
        description: view.first
          ? t("waiting.notice.activation-first", counts)
          : t("waiting.notice.activation-since", counts),
        share:
          entry.share === undefined
            ? null
            : {
                who: shareWho(entry.share),
                reason: entry.share.reason,
                skills: entry.share.public_skills,
                commands: entry.share.public_commands,
              },
        choices: ["allow", "reject"],
      };
    }
  }
}
