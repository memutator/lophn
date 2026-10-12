// Agent 화면 머리·session popover test의 fake. 값은 lophn-agent/sessions의 모양을 따른다.
// 시각·id는 고정이다.
import type { HeaderAgent, SessionLine } from "../header/types.ts";

export const HEADER_NOW = new Date("2026-10-06T09:00:00Z");

export function assignmentId(n: number): string {
  return `asg_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;
}

export function headerSessionId(n: number): string {
  return `ses_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;
}

/** Operator 이름. 고정 글자 "lophn"이 아닌 값으로 이름이 props에서 오는지 본다. */
export const EVAL_ANALYST: HeaderAgent = {
  assignment: assignmentId(1),
  name: "Eval analyst",
  profile: { kind: "icon", icon: "search" },
};

function minutesAgo(minutes: number): string {
  return new Date(HEADER_NOW.getTime() - minutes * 60_000).toISOString();
}

export function sessionLine(
  n: number,
  fields: Partial<Omit<SessionLine, "id">> & { title: string },
): SessionLine {
  return {
    id: headerSessionId(n),
    assignment: EVAL_ANALYST.assignment,
    status: "idle",
    activeAt: minutesAgo(60),
    group: "today",
    archived: false,
    ...fields,
  };
}

/**
 * popover가 받는 목록. 순서는 부르는 쪽이 정한 그대로다(Today 셋 → Earlier 하나 → archived 둘).
 * 마지막 줄은 다른 agent의 session이라 보이면 안 된다.
 */
export const HEADER_SESSIONS: readonly SessionLine[] = [
  sessionLine(1, {
    title: "Week 41 summary",
    status: "waiting",
    activeAt: minutesAgo(2),
  }),
  sessionLine(2, {
    title: "Regression on query-recipe-gap",
    status: "working",
    activeAt: minutesAgo(12),
  }),
  sessionLine(3, {
    title: "Release notes check",
    activeAt: minutesAgo(180),
  }),
  sessionLine(4, {
    title: "Findings about C-049",
    group: "earlier",
    activeAt: minutesAgo(2 * 24 * 60),
  }),
  sessionLine(5, {
    title: "Docs folder cleanup",
    group: "earlier",
    archived: true,
    activeAt: minutesAgo(21 * 24 * 60),
  }),
  sessionLine(6, {
    title: "First eval run",
    group: "earlier",
    archived: true,
    activeAt: minutesAgo(40 * 24 * 60),
  }),
  sessionLine(7, {
    assignment: assignmentId(2),
    title: "Failing scenarios",
    status: "working",
    activeAt: minutesAgo(12),
  }),
];

/** 지금 보는 session(Week 41 summary). */
export const HEADER_CURRENT = {
  id: headerSessionId(1),
  title: "Week 41 summary",
} as const;
