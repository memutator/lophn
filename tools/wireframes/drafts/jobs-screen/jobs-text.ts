// job 화면의 글. 순수 함수라 renderer에서는 model.ts와 wording key로 옮긴다. 짧은 낱말(상태)은 마침표가 없고 문장은 있다.
import { formatRelativeTime } from "@lophn/wording";
import type { StatusTone } from "@lophn/ui";

import type {
  AgentRefView,
  JobActionView,
  JobRunState,
  JobRunView,
  JobView,
  NAMES,
} from "../../mock/jobs-screen-data.ts";

type Names = typeof NAMES;

const UNIT = { m: "minute", h: "hour", d: "day" } as const;

export function everyText(every: string, at: string | null): string {
  const n = Number(every.slice(0, -1));
  const unit = UNIT[every.slice(-1) as keyof typeof UNIT];
  const base = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
  return at === null ? base : `${base} at ${at}`;
}

export function nextText(job: JobView): string {
  if (!job.enabled || job.next_due_at === null) return "Turned off";
  return `Next ${formatRelativeTime(new Date(job.next_due_at), new Date())}`;
}

function agentName(agent: AgentRefView, names: Names): string {
  switch (agent.role) {
    case "lophn":
      return "lophn";
    case "project_manager":
      return "Project Manager";
    case "app_engineer":
      return "App Engineer";
    case "operator":
      return names.operators[agent.agent] ?? "an agent";
  }
}

function placeName(agent: AgentRefView, names: Names): string | null {
  switch (agent.role) {
    case "project_manager":
      return names.projects[agent.project] ?? null;
    case "app_engineer":
      return names.apps[agent.app] ?? null;
    default:
      return null;
  }
}

/** 할 일 요약 한 줄(summary)과 무엇인지 알려 주는 뒤쪽 글(detail). */
export function actionText(
  action: JobActionView,
  names: Names,
): { summary: string; detail: string } {
  switch (action.kind) {
    case "agent_run":
      return {
        summary: `Asks ${agentName(action.agent, names)}`,
        detail: action.prompt,
      };
    case "tool_run":
      return {
        summary: "Uses an app tool",
        detail: `${names.apps[action.app] ?? "An app"} · ${action.tool}`,
      };
    case "workflow_start":
      return {
        summary: "Starts a workflow",
        detail: `${
          names.projects[action.project] ?? "A project"
        } / ${action.workflow}`,
      };
  }
}

export function creatorText(creator: AgentRefView, names: Names): string {
  const place = placeName(creator, names);
  const who = agentName(creator, names);
  return place === null ? `Created by ${who}` : `Created by ${who} · ${place}`;
}

export const MISSED_OPTIONS = [
  { value: "run", label: "Start once when lophn turns on" },
  { value: "hold", label: "Ask me first" },
] as const;

export const missedText = (policy: JobView["missed_policy"]): string =>
  policy === "hold" ? "If missed: asks you first" : "If missed: starts once";

export const STATE: Record<JobRunState, { tone: StatusTone; label: string }> = {
  queued: { tone: "neutral", label: "Queued" },
  running: { tone: "neutral", label: "Running" },
  done: { tone: "good", label: "Done" },
  failed: { tone: "critical", label: "Failed" },
  cancelled: { tone: "neutral", label: "Cancelled" },
  held: { tone: "warning", label: "Waiting" },
  skipped: { tone: "neutral", label: "Skipped" },
  interrupted: { tone: "warning", label: "Interrupted" },
};

const missedCount = (n: number) => n === 1 ? "once" : `${n} times`;

// failed 줄의 reason은 `<code>: <message>`다. code는 화면 글이 아니라서 message만 보인다.
const messageOf = (reason: string) => reason.slice(reason.indexOf(": ") + 2);

/** 기록 줄의 글. 놓친 차례를 접은 줄은 몇 번 놓쳤는지를 함께 말한다. */
export function runText(row: JobRunView): string {
  const missed = row.missed_count === 0
    ? ""
    : `Missed ${missedCount(row.missed_count)}`;
  switch (row.state) {
    case "queued":
      return "Waiting to start.";
    case "running":
      return missed === "" ? "Running now." : `${missed}, running now.`;
    case "done":
      return missed === "" ? "Finished." : `${missed}, started once.`;
    case "failed":
      return row.reason === null
        ? "Failed while running."
        : `Could not start. ${messageOf(row.reason)}`;
    case "cancelled":
      return "Cancelled before it finished.";
    case "held":
      return missed === ""
        ? "Waiting for your decision."
        : `${missed}. Waiting for your decision.`;
    case "skipped":
      return row.reason === "person"
        ? "You skipped it."
        : row.reason === "overlap"
        ? "Skipped because the previous turn was still going."
        : "Replaced by the turn that came on time.";
    case "interrupted":
      return "Interrupted because lophn was turned off.";
  }
}

export const whenText = (at: string): string =>
  formatRelativeTime(new Date(at), new Date());

/** 기록 줄에 보이는 시각. 시작한 때, 시작하지 못했으면 차례였던 때다. */
export const runWhen = (row: JobRunView): string =>
  whenText(row.started_at ?? row.due_at);
