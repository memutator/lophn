// 기록(TrialRecord)만 보는 check. core 없이 fixture에서도 돈다.
import type { ProgramCheck } from "../../types.ts";
import { type Count, countOk, countText } from "../calls.ts";
import { toolCallsOf } from "../records.ts";

// calendar-mvp 안에서 App Engineer가 보내는 call은 coding agent로만 간다.
// lophn이 App Engineer에게 보내는 첫 call(fake 대본)은 lophn session의 것이라 세지 않는다.
export function aeCallsOnlyToCodingAgent(id: string): ProgramCheck {
  return {
    kind: "program",
    id,
    run({ trial }) {
      const calls = trial.sessions
        .filter((s) => s.agent.role === "app_engineer")
        .flatMap((s) => s.sent_calls);
      // receiver는 coding agent이면 풀리지 않을 수 있어 to를 본다.
      const wrong = calls.filter((c) => {
        const to = c.to as { role?: unknown } | null;
        return to?.role !== "coding_agent" || c.reply !== "conversation";
      });
      return {
        pass: calls.length > 0 && wrong.length === 0,
        reason: calls.length === 0
          ? "App Engineer가 보낸 call이 없음"
          : `App Engineer call ${calls.length}개 중 coding agent 대화가 아닌 것 ${wrong.length}개`,
      };
    },
  };
}

function successCalls(
  trial: Parameters<typeof toolCallsOf>[0],
  command: string,
) {
  return toolCallsOf(trial).filter((c) =>
    c.call.app_api?.command === command && c.call.outcome?.kind === "success"
  );
}

// Operator가 앱의 app-api tool을 불렀나.
export function appApiCalled(
  id: string,
  opts: { command: string; count?: Count },
): ProgramCheck {
  return {
    kind: "program",
    id,
    run({ trial }) {
      const n = successCalls(trial, opts.command).length;
      const count = opts.count ?? { min: 1 };
      return {
        pass: countOk(n, count),
        reason: `${opts.command} 성공 ${n}번 (기대 ${countText(count)})`,
      };
    },
  };
}

export function appApiOrder(
  id: string,
  opts: { first: string; then: string },
): ProgramCheck {
  return {
    kind: "program",
    id,
    run({ trial }) {
      const first = successCalls(trial, opts.first)
        .map((c) => c.call.id).sort()[0];
      const hit = first !== undefined &&
        successCalls(trial, opts.then).some((c) => c.call.id > first);
      return {
        pass: hit,
        reason: hit
          ? `${opts.first} 뒤에 ${opts.then}`
          : `${opts.first} 성공 뒤에 ${opts.then} 성공이 없음`,
      };
    },
  };
}

// AE가 problem을 읽었나.
export function readProblem(id: string): ProgramCheck {
  return {
    kind: "program",
    id,
    run({ trial }) {
      const n =
        ["problem.get", "problem.body"].flatMap((tool) =>
          toolCallsOf(trial, tool)
        ).filter((c) =>
          c.call.outcome?.kind === "success" &&
          trial.sessions.some((s) =>
            s.agent.role === "app_engineer" && s.tool_calls.includes(c)
          )
        ).length;
      return { pass: n > 0, reason: `problem 읽기 성공 ${n}번` };
    },
  };
}
