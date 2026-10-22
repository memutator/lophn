// project sidebar Scheduled jobs panel의 순수 규칙과 글. renderer에서는 model.ts와 wording key로 옮긴다.
// 주기 글과 "Turned off"는 Settings job 화면과 같은 말이다(그 draft를 import하지 않는 것은 그 파일이 옮겨 가기 때문이다).
import { formatRelativeTime } from "@lophn/wording";

import type { JobView } from "../../mock/jobs-sidebar-data.ts";

/** 이 project에 걸린 job이면 true. 재료는 모두 `JobRecord`에 있다. */
export function isProjectJob(job: JobView, project: string): boolean {
  const { creator, action } = job;
  if (creator.role === "project_manager" && creator.project === project) {
    return true;
  }
  if (action.kind === "agent_run") {
    return action.agent_place?.kind === "project" &&
      action.agent_place.id === project;
  }
  return action.kind === "workflow_start" && action.project === project;
}

const UNIT = { m: "minute", h: "hour", d: "day" } as const;

export function everyText(every: string, at: string | null): string {
  const n = Number(every.slice(0, -1));
  const unit = UNIT[every.slice(-1) as keyof typeof UNIT];
  const base = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
  return at === null ? base : `${base} at ${at}`;
}

/** 아래 줄의 상태 하나. */
export function stateText(job: JobView): string {
  if (!job.enabled) return "Turned off";
  if (job.last_run?.state === "held") return "Waiting for your decision";
  if (job.next_due_at === null) return "Turned off";
  return `Next ${formatRelativeTime(new Date(job.next_due_at), new Date())}`;
}

export const failed = (job: JobView): boolean =>
  job.last_run?.state === "failed";
