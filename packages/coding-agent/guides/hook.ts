// Claude Code 세션 시작 hook 출력이다(coding-agent/guides#R23, R24; coding-agent#T35). summary를 10줄·1,200
// code point 안의 글 하나로 줄이고, 장애·시간 초과·빈 결과는 빈 문자열로 끝낸다(호출자가 stdout 빈 값·exit 0).
// 문제 모델에는 severity 축이 없어(problems/problem-codes) "warning 이상"은 모든 열린 문제다. coding agent가
// 맡을 수 있는 문제는 수리 작업 상태가 ready_to_hand_off·in_progress인 것이고 사람 확인이 먼저인 문제와
// 담당이 다른 문제는 빼며 info 수준의 자료는 문제가 아니라 목록에 없다.
import type { Result } from "../../base/mod.ts";
import {
  type CodingAgentSessionSummary,
  HOOK_CORE_WAIT_MS,
  HOOK_MAX_CODE_POINTS,
  HOOK_MAX_LINES,
  HOOK_MAX_PROBLEMS,
  HOOK_TOTAL_TIMEOUT_MS,
} from "../../contracts/coding-agent/mod.ts";

// 쪽을 이어 읽는 상한이다. coding agent 대상 문제가 첫 쪽 뒤에 있을 수 있어 몇 쪽까지만 본다.
const HOOK_MAX_PAGES = 4;

const CODING_AGENT_STATES: readonly string[] = [
  "ready_to_hand_off",
  "in_progress",
];

type HookProblem = CodingAgentSessionSummary["problems"][number];
type HookTicket = CodingAgentSessionSummary["tickets"][number];

export type HookFacts = {
  problems: readonly HookProblem[];
  tickets: readonly HookTicket[];
  // 아직 읽지 않은 쪽이 있다(나머지 수가 이상이다).
  more: boolean;
};

function oneLine(text: string, limit: number): string {
  const points = [...text.replace(/\p{Cc}+/gu, " ").trim()];
  return points.length <= limit
    ? points.join("")
    : `${points.slice(0, Math.max(0, limit - 1)).join("")}…`;
}

function ticketText(ticket: HookTicket): string {
  const ready = ticket.readiness === "ready" ? "ready" : "needs_confirmation";
  return `${ticket.id}(${ticket.state}, ${ready})`;
}

function build(facts: HookFacts, symptomLimit: number): string | null {
  const targeted = facts.problems.filter((problem) =>
    CODING_AGENT_STATES.includes(problem.repair_state)
  );
  const shown = targeted.slice(0, HOOK_MAX_PROBLEMS);
  const shownIds = new Set(shown.map((problem) => problem.id));
  const linked = new Set<string>();
  const lines: string[] = [];
  for (const problem of shown) {
    const mine = facts.tickets.filter((ticket) =>
      ticket.problems.includes(problem.id)
    );
    for (const ticket of mine) linked.add(ticket.id);
    const tail = mine.length === 0
      ? ""
      : ` → ${mine.map(ticketText).join(", ")}`;
    const symptom = symptomLimit === 0
      ? ""
      : ` ${oneLine(problem.symptom, symptomLimit)}`;
    lines.push(`- ${problem.id} [${problem.status}]${symptom}${tail}`);
  }
  const others = facts.tickets.filter((ticket) =>
    !linked.has(ticket.id) && ticket.readiness === "ready" &&
    !ticket.problems.some((id) => shownIds.has(id))
  );
  if (shown.length === 0 && others.length === 0) return null;
  const rest = targeted.length - shown.length;
  const out = [
    `lophn: 이 앱에서 coding agent가 맡을 수 있는 열린 일이다(문제 ${targeted.length}${
      facts.more ? "개 이상" : "개"
    }, ticket ${facts.tickets.length}개)`,
    ...lines,
  ];
  if (others.length > 0) {
    out.push(
      `- 문제와 연결되지 않은 ticket ${others.length}개: ${
        others.slice(0, 2).map((ticket) => ticket.id).join(", ")
      }${others.length > 2 ? " …" : ""}`,
    );
  }
  if (rest > 0 || facts.more) {
    out.push(`- 나머지 문제 ${rest > 0 ? rest : 0}개${facts.more ? " 이상" : ""}`);
  }
  out.push(
    "상세는 `lophn session summary`와 MCP lophn_ticket·lophn_problem으로 읽는다. 이 목록은 착수 지시가 아니다: 사람이 지정한 ticket만 claim하고 수리 지시 전에는 착수하지 않는다",
  );
  return out.join("\n");
}

// 상한 안의 글이다. 비어 있거나 상한에 맞출 수 없으면 빈 문자열이다.
export function renderHook(facts: HookFacts): string {
  for (const limit of [120, 60, 30, 0]) {
    const text = build(facts, limit);
    if (text === null) return "";
    if (
      text.split("\n").length <= HOOK_MAX_LINES &&
      [...text].length <= HOOK_MAX_CODE_POINTS
    ) {
      return text;
    }
  }
  return "";
}

export type HookRead = (
  input: { app: string; cursor?: string },
) => Promise<Result<CodingAgentSessionSummary>>;

export type HookLimits = {
  totalMs: number;
  coreWaitMs: number;
};

export const HOOK_LIMITS: HookLimits = {
  totalMs: HOOK_TOTAL_TIMEOUT_MS,
  coreWaitMs: HOOK_CORE_WAIT_MS,
};

// 시간 안에 끝나지 않으면 undefined다. timer는 끝나면 치운다.
async function within<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | undefined> {
  let timer: number | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// hook 하나의 실행이다. 어떤 장애도 던지지 않고 빈 문자열로 끝낸다(R24). 일반 summary는 이 함수를 쓰지
// 않고 실패를 그대로 보인다.
export async function runSummaryHook(
  read: HookRead,
  app: string,
  limits: HookLimits = HOOK_LIMITS,
): Promise<string> {
  try {
    const gather = async (): Promise<HookFacts | undefined> => {
      const problems: HookProblem[] = [];
      const tickets = new Map<string, HookTicket>();
      let cursor: string | undefined;
      let more = false;
      for (let page = 0; page < HOOK_MAX_PAGES; page += 1) {
        const got = await read({
          app,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!got.ok) return undefined;
        problems.push(...got.value.problems);
        for (const ticket of got.value.tickets) tickets.set(ticket.id, ticket);
        cursor = got.value.next_cursor ?? undefined;
        const targeted = problems.filter((problem) =>
          CODING_AGENT_STATES.includes(problem.repair_state)
        ).length;
        more = cursor !== undefined;
        // 나머지 수를 알 만큼 모였거나 더 읽을 쪽이 없으면 멈춘다.
        if (cursor === undefined || targeted > HOOK_MAX_PROBLEMS) break;
      }
      return { problems, tickets: [...tickets.values()], more };
    };
    const facts = await within(gather(), limits.coreWaitMs);
    return facts === undefined ? "" : renderHook(facts);
  } catch {
    return "";
  }
}

// 전체 5초 안에 끝낸다. coreWaitMs가 읽기 대기이고 totalMs가 process 전체 상한이다.
export async function runSummaryHookBounded(
  read: HookRead,
  app: string,
  limits: HookLimits = HOOK_LIMITS,
): Promise<string> {
  const text = await within(runSummaryHook(read, app, limits), limits.totalMs);
  return text ?? "";
}
