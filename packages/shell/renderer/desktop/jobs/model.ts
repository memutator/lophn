// Scheduled jobs 화면의 순수 규칙. 주기·할 일·기록 줄을 화면 말로 바꾼다. project 창의 job panel도 쓴다.
import type { StatusTone } from "@lophn/ui";
import { formatRelativeTime, type MessageKey, t } from "@lophn/i18n";

import { shortId } from "../connection/waiting/model.ts";
import { LOPHN_AGENT_NAME } from "../../../../protocol/lophn-agent/agent-values.ts";
import {
  type AgentId,
  LOPHN_AGENT_ID,
} from "../../../../protocol/lophn-agent/workspaces.ts";
import type {
  JobActionView,
  JobNames,
  JobRunState,
  JobRunView,
  JobView,
  MissedPolicy,
} from "./source.ts";

const EVERY_KEY = {
  m: "jobs.label.every-minutes",
  h: "jobs.label.every-hours",
  d: "jobs.label.every-days",
} as const;

export function scheduleText(every: string, at: string | null): string {
  const n = Number(every.slice(0, -1));
  const unit = every.slice(-1) as keyof typeof EVERY_KEY;
  return at !== null && unit === "d"
    ? t("jobs.label.every-days-at", { n, time: at })
    : t(EVERY_KEY[unit], { n });
}

/** 이 project에 걸린 job: 그 project workspace의 agent가 만들었거나, 그 project의 agent를 부르거나, 그 project의 workflow를 시작하는 것. */
export function jobsOfProject(
  jobs: readonly JobView[],
  project: string,
): JobView[] {
  return jobs.filter(
    ({ creator, action }) =>
      (creator.workspace?.kind === "project" &&
        creator.workspace.id === project) ||
      (action.kind === "agent_run" &&
        action.agent_workspace?.kind === "project" &&
        action.agent_workspace.id === project) ||
      (action.kind === "workflow_start" && action.project === project),
  );
}

export function nextText(job: JobView, now: Date): string {
  if (job.approved_at === null) return t("jobs.label.waiting-approval");
  if (!job.enabled || job.next_due_at === null) {
    return t("jobs.label.turned-off");
  }
  return t("jobs.label.next", {
    time: formatRelativeTime(new Date(job.next_due_at), now),
  });
}

/** agent 이름. 표에 없으면 lophn은 고정 이름이고 나머지는 이름 모르는 agent다. */
export function agentName(agent: AgentId, names: JobNames): string {
  return (
    names.agents[agent] ??
    (agent === LOPHN_AGENT_ID
      ? LOPHN_AGENT_NAME
      : t("jobs.label.agent-unnamed"))
  );
}

const nameOf = (table: Readonly<Record<string, string>>, id: string) =>
  table[id] ?? shortId(id);

/** 할 일 요약 한 줄(summary)과 무엇인지 알려 주는 뒤쪽 글(detail). */
export function actionText(
  action: JobActionView,
  names: JobNames,
): { summary: string; detail: string } {
  switch (action.kind) {
    case "agent_run":
      return {
        summary: t("jobs.label.action-agent", {
          agent: agentName(action.agent, names),
        }),
        detail: action.prompt,
      };
    case "tool_run":
      return {
        summary: t("jobs.label.action-tool"),
        detail: t("jobs.label.action-tool-detail", {
          app: nameOf(names.apps, action.app),
          tool: action.tool,
        }),
      };
    case "workflow_start":
      return {
        summary: t("jobs.label.action-workflow"),
        detail: t("jobs.label.action-workflow-detail", {
          project: nameOf(names.projects, action.project),
          workflow: action.workflow,
        }),
      };
  }
}

export function creatorText(
  creator: JobView["creator"],
  names: JobNames,
): string {
  const agent = agentName(creator.agent, names);
  const { workspace } = creator;
  if (workspace === null) return t("jobs.label.created-by", { agent });
  return t("jobs.label.created-by-workspace", {
    agent,
    workspace: nameOf(
      workspace.kind === "project" ? names.projects : names.apps,
      workspace.id,
    ),
  });
}

export const MISSED_OPTIONS: readonly {
  readonly value: MissedPolicy;
  readonly label: MessageKey;
}[] = [
  { value: "run", label: "jobs.label.missed-option-run" },
  { value: "hold", label: "jobs.label.missed-option-hold" },
];

export const missedText = (policy: MissedPolicy): string =>
  t(policy === "hold" ? "jobs.label.missed-hold" : "jobs.label.missed-run");

export const STATE: Record<
  JobRunState,
  { readonly tone: StatusTone; readonly label: MessageKey }
> = {
  queued: { tone: "neutral", label: "jobs.label.state-queued" },
  running: { tone: "neutral", label: "jobs.label.state-running" },
  done: { tone: "good", label: "jobs.label.state-done" },
  failed: { tone: "critical", label: "jobs.label.state-failed" },
  cancelled: { tone: "neutral", label: "jobs.label.state-cancelled" },
  held: { tone: "warning", label: "jobs.label.state-held" },
  skipped: { tone: "neutral", label: "jobs.label.state-skipped" },
  interrupted: { tone: "warning", label: "jobs.label.state-interrupted" },
};

// failed 줄의 reason은 `<code>: <message>`다. code는 화면 글이 아니라서 message만 보이고, 문장 끝 마침표는 wording이 붙인다.
const messageOf = (reason: string) =>
  reason.slice(reason.indexOf(": ") + 2).replace(/\.$/, "");

/** 기록 줄의 글. 놓친 차례를 접은 줄은 몇 번 놓쳤는지를 함께 말한다. */
export function runText(row: JobRunView): string {
  const count = row.missed_count;
  switch (row.state) {
    case "queued":
      return t("jobs.note.run-queued");
    case "running":
      return count === 0
        ? t("jobs.note.run-running")
        : t("jobs.note.run-running-missed", { count });
    case "done":
      return count === 0
        ? t("jobs.note.run-done")
        : t("jobs.note.run-done-missed", { count });
    case "failed":
      return row.reason === null
        ? t("jobs.note.run-failed")
        : t("jobs.note.run-failed-start", { message: messageOf(row.reason) });
    case "cancelled":
      return t("jobs.note.run-cancelled");
    case "held":
      return count === 0
        ? t("jobs.note.run-held")
        : t("jobs.note.run-held-missed", { count });
    case "skipped":
      return row.reason === "person"
        ? t("jobs.note.run-skipped-person")
        : row.reason === "overlap"
          ? t("jobs.note.run-skipped-overlap")
          : t("jobs.note.run-skipped-superseded");
    case "interrupted":
      return t("jobs.note.run-interrupted");
  }
}

export const whenText = (at: string, now: Date): string =>
  formatRelativeTime(new Date(at), now);

/** 기록 줄에 보이는 시각. 시작한 때, 시작하지 못했으면 차례였던 때다. */
export const runWhen = (row: JobRunView, now: Date): string =>
  whenText(row.started_at ?? row.due_at, now);
