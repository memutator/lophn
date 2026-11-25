// 대기 항목 하나를 카드가 그릴 값으로 바꾸는 순수 함수. 문구는 turn request의 subject와 activation 동의에서
// program이 만든다(요청한 agent가 쓴 설명 칸은 없다).
import { formatRelativeTime, t } from "@lophn/i18n";
import type { ShareRequest } from "../../../../../protocol/approvals/share-request.ts";
import type { TurnRequest } from "../../../../../protocol/approvals/turn-request.ts";
import type { ActivationConsent } from "../../../../../protocol/apps/activation/consent.ts";
import type { PhoneCapability } from "../../../../../protocol/apps/phone-request.ts";
import type { JobHold } from "../../../../../protocol/jobs/jobs.ts";
import type { JobAction } from "../../../../../protocol/jobs/values.ts";
import type { MailHold } from "../../../../../protocol/lophn-agent/mail.ts";
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
  /** mail hold의 "Sent … · arrived … · expires …" 한 줄. 다른 항목은 빈 글이다. */
  readonly times: string;
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
  /** 되돌리기(rewind) 기록 밖의 호출인지. */
  readonly outsideRewind?: boolean;
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
  if (entry.kind === "mail_hold") return mailTo(entry.hold, names);
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

// 폰 기능마다 사람이 읽는 한 문장이다. 기능을 더하면 여기도 한 줄이다(없으면 type 오류).
const PHONE_CAPABILITY_LABELS = {
  "location.get": "waiting.label.declared-phone-location",
  "network.get": "waiting.label.declared-phone-network",
  "haptics.play": "waiting.label.declared-phone-haptics",
  "clipboard.read": "waiting.label.declared-phone-clipboard-read",
  "clipboard.write": "waiting.label.declared-phone-clipboard-write",
  "code.scan": "waiting.label.declared-phone-code-scan",
  "link.open": "waiting.label.declared-phone-link-open",
  "share.text": "waiting.label.declared-phone-share-text",
  "camera.capture": "waiting.label.declared-phone-camera-capture",
  "photos.pick": "waiting.label.declared-phone-photos-pick",
  "files.pick": "waiting.label.declared-phone-files-pick",
  "share.file": "waiting.label.declared-phone-share-file",
} as const satisfies Record<PhoneCapability, string>;

/** 폰 기능 grant의 이름. 동의 카드의 줄과 앱 상세가 같은 문장을 쓴다. 모르는 capability는 이름 그대로다. */
export function phoneCapabilityText(capability: string): string {
  return Object.hasOwn(PHONE_CAPABILITY_LABELS, capability)
    ? t(PHONE_CAPABILITY_LABELS[capability as PhoneCapability])
    : capability;
}

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

/** 도구 물음의 대상 한 줄. */
function toolTarget(
  subject: Extract<TurnRequest["subject"], { kind: "app_tool" | "mcp_tool" }>,
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

function extraRequestFacts(request: TurnRequest): Fact[] {
  const out: Fact[] = [];
  if (request.reason !== null && request.reason !== "") {
    out.push({
      label: t("waiting.label.fact-reason"),
      value: request.reason,
      style: "text",
    });
  }
  return out;
}

function permissionView(request: TurnRequest, names: InboxNames) {
  const subject = request.subject;
  const choices = turnChoicesOf(request);
  const extra = extraRequestFacts(request);
  const outsideRewind = request.outside_rewind;
  switch (subject.kind) {
    case "shell":
      return {
        title: t("waiting.title.shell"),
        description: t("waiting.notice.shell"),
        factsPinned: true,
        outsideRewind,
        facts: [
          {
            label: t("waiting.label.fact-command"),
            value: subject.command,
            style: "code" as const,
          },
          ...extra,
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
    case "file_read":
      return {
        title: t("waiting.title.file-read"),
        description: request.reason ?? t("waiting.notice.file-read"),
        factsPinned: true,
        outsideRewind,
        facts: [
          {
            label: t("waiting.label.fact-path"),
            value: subject.path,
            style: "code" as const,
          },
          {
            label: t("waiting.label.fact-folder"),
            value: subject.folder,
            style: "text" as const,
          },
        ],
        choices,
      };
    case "file_write":
      return {
        title: t("waiting.title.file-write"),
        description: request.reason ?? t("waiting.notice.file-write"),
        factsPinned: true,
        outsideRewind,
        facts: [
          {
            label: t("waiting.label.fact-path"),
            value: subject.path,
            style: "code" as const,
          },
          {
            label: t("waiting.label.fact-folder"),
            value: subject.folder,
            style: "text" as const,
          },
        ],
        choices,
      };
    case "local_tool":
      return {
        title: t("waiting.title.local-tool", { name: subject.name }),
        description: t(
          subject.changed
            ? "waiting.notice.local-tool-changed"
            : "waiting.notice.local-tool",
        ),
        factsPinned: true,
        outsideRewind,
        facts: [
          {
            label: t("waiting.label.fact-path"),
            value: subject.path,
            style: "code" as const,
          },
          {
            label: t("waiting.label.fact-sha256"),
            value: subject.sha256.slice(0, 16),
            style: "code" as const,
          },
          ...extra,
        ],
        choices,
      };
    // 바뀜이 사람이 정할 거리 전부라 늘 보인다. 줄은 core가 만든 그대로(전체 경로)다.
    case "setting":
      return {
        title: t("waiting.title.setting"),
        description: t("waiting.notice.setting"),
        factsPinned: true,
        outsideRewind,
        facts: [
          ...subject.lines.map((line, at) => ({
            label:
              subject.lines.length === 1
                ? t("waiting.label.fact-change")
                : t("waiting.label.fact-change-nth", { n: at + 1 }),
            value: line,
            style: "text" as const,
          })),
          ...extra,
        ],
        choices,
      };
    case "project_command":
      return {
        title: t("waiting.title.project-command", { name: subject.name }),
        description: t("waiting.notice.project-command"),
        factsPinned: true,
        outsideRewind,
        facts: [
          {
            label: t("waiting.label.fact-command"),
            value: subject.command,
            style: "code" as const,
          },
          ...(subject.cwd === null
            ? []
            : [
                {
                  label: t("waiting.label.fact-cwd"),
                  value: subject.cwd,
                  style: "text" as const,
                },
              ]),
          ...(subject.env_keys.length === 0
            ? []
            : [
                {
                  label: t("waiting.label.fact-env-keys"),
                  value: subject.env_keys.join(", "),
                  style: "text" as const,
                },
              ]),
          ...extra,
        ],
        choices,
      };
    case "project_command_definition": {
      const name = subject.after?.name ?? subject.before?.name ?? "";
      const summaryLine = (item: {
        name: string;
        command: string;
        cwd: string | null;
        env_keys: readonly string[];
      }) =>
        [
          `${item.name}: ${item.command}`,
          item.cwd === null ? null : `cwd: ${item.cwd}`,
          item.env_keys.length === 0
            ? null
            : `env: ${item.env_keys.join(", ")}`,
        ]
          .filter((part): part is string => part !== null)
          .join("\n");
      return {
        title:
          subject.action === "add"
            ? t("waiting.title.project-command-add", { name })
            : subject.action === "update"
              ? t("waiting.title.project-command-update", { name })
              : t("waiting.title.project-command-remove", { name }),
        description: t("waiting.notice.project-command-definition"),
        factsPinned: true,
        outsideRewind,
        facts: [
          ...(subject.before === null
            ? []
            : [
                {
                  label: t("waiting.label.fact-before"),
                  value: summaryLine(subject.before),
                  style: "code" as const,
                },
              ]),
          ...(subject.after === null
            ? []
            : [
                {
                  label: t("waiting.label.fact-after"),
                  value: summaryLine(subject.after),
                  style: "code" as const,
                },
              ]),
          ...extra,
        ],
        choices,
      };
    }
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
        outsideRewind,
        facts: [...toolFacts(target, subject.effect), ...extra],
        choices,
      };
    }
    case "mcp_tool": {
      const target = toolTarget(subject, names);
      return {
        title: t("waiting.title.mcp-tool", { tool: subject.tool }),
        description: t("waiting.notice.mcp-tool", { target }),
        factsPinned: false,
        outsideRewind,
        facts: [...toolFacts(target, subject.effect), ...extra],
        choices,
      };
    }
    case "harness":
      return {
        title: t("waiting.title.coding"),
        description: t("waiting.notice.coding"),
        factsPinned: false,
        outsideRewind: false,
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
        value: phoneCapabilityText(capability),
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

/** 받을 곳 한 줄. project는 core가 이 컴퓨터의 이름을 실어 주고(`project_name`), 이 컴퓨터에 없으면 기계 사이 id의 짧은 꼴이다. */
function mailTo(hold: MailHold, names: InboxNames): string {
  const to = hold.address;
  if (!("workspace" in to)) {
    return t("waiting.notice.mail-to-session", { id: shortId(to.session) });
  }
  const workspace =
    "home" in to.workspace
      ? t("left-sidebar.label.home")
      : "app" in to.workspace
        ? appText(to.workspace.app, names)
        : (hold.project_name ??
          t("waiting.label.workspace-project", {
            id: shortId(to.workspace.project),
          }));
  return t("waiting.notice.mail-to", { agent: to.agent, workspace });
}

const PREVIEW_CHARS = 240;

/** 맡긴 글의 앞부분. 줄바꿈은 공백 하나로 접고, 길면 끝에 `…`이다(core가 이미 500자로 잘라 보낸다). */
function mailPreview(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > PREVIEW_CHARS ? `${one.slice(0, PREVIEW_CHARS)}…` : one;
}

function mailTimes(hold: MailHold, now: Date): string {
  const relative = (at: string) => formatRelativeTime(new Date(at), now);
  return t("waiting.notice.mail-times", {
    sent: relative(hold.sent_at),
    arrived: relative(hold.arrived_at),
    expires: relative(hold.expires_at),
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
    times: "",
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
    case "mail_hold":
      return {
        ...base,
        title: t("waiting.title.mail-hold", {
          name: entry.hold.from.name,
          computer: entry.hold.computer,
        }),
        description: mailPreview(entry.hold.text),
        times: mailTimes(entry.hold, now),
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
