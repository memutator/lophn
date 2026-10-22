// `lophn workflow start|report|stop|show`: 사람과 program이 workflow instance를 시작하고, report하고, 멈추고, 읽는다.
// 입력은 route 입력이 아니라 CLI 칸이고 route는 표에 두지 않는다(`run.ts`와 같은 import 순환 이유).
// report의 크기와 `--next` 값은 검사하지 않는다. core가 거절하거나 줄로 남긴다.
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import type { Route } from "../../../protocol/base/mod.ts";
import {
  type HandResult,
  workflowInstanceRead,
  workflowReport,
  workflowStart,
  workflowStop,
} from "../../../protocol/workflows/mod.ts";
import { callRoute } from "../../connection/mod.ts";
import { CLI_EXITS } from "../output.ts";
import {
  type CommandEntry,
  entryOf,
  ExitWith,
  type RunContext,
} from "./types.ts";

type Out = Promise<Result<unknown, LophnError>>;

function call(
  ctx: RunContext,
  route: Route,
  input: Record<string, unknown>,
): Out {
  if (ctx.client === undefined) {
    return Promise.resolve(
      err({ code: "unavailable", message: "lophn에 연결하지 못했다" }),
    );
  }
  return callRoute(ctx.client, { route, input });
}

// 넘기지 못했어도 시작과 기록은 성공이다. 조용히 잃지 않게 이유를 stderr에 남긴다.
async function start(input: Record<string, unknown>, ctx: RunContext): Out {
  const started = await call(ctx, workflowStart, input);
  if (!started.ok) return started;
  const { instance, handed } = started.value as {
    instance: { id: string };
    handed: HandResult;
  };
  const stdout = ctx.json ? { instance, handed } : instance.id;
  if (handed.outcome === "not_handed") {
    return ok(
      new ExitWith(
        CLI_EXITS.success,
        stdout,
        `not_handed: ${handed.reason}: ${handed.message}`,
      ),
    );
  }
  return ok(stdout);
}

function handedText(handed: HandResult | null): string {
  if (handed === null) return "none";
  if (handed.outcome === "not_handed") {
    return `not_handed ${handed.step}: ${handed.reason}`;
  }
  return `handed ${handed.step} -> ${handed.receiver}${
    handed.human_turn ? " (human turn)" : ""
  }`;
}

async function report(input: Record<string, unknown>, ctx: RunContext): Out {
  const reported = await call(ctx, workflowReport, input);
  if (!reported.ok || ctx.json) return reported;
  const { line, handed } = reported.value as {
    line: number;
    handed: HandResult | null;
  };
  return ok({ line, handed: handedText(handed) });
}

async function stop(input: Record<string, unknown>, ctx: RunContext): Out {
  const stopped = await call(ctx, workflowStop, { instance: input.instance });
  return stopped.ok
    ? ok((stopped.value as { instance: unknown }).instance)
    : stopped;
}

// `next_cursor`가 null일 때까지 줄을 모은다. instance와 last_reports는 마지막 page의 것이다.
async function show(input: Record<string, unknown>, ctx: RunContext): Out {
  const lines: unknown[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await call(ctx, workflowInstanceRead, {
      instance: input.instance,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!page.ok) return page;
    const value = page.value as {
      instance: unknown;
      last_reports: unknown;
      lines: unknown[];
      next_cursor: string | null;
    };
    lines.push(...value.lines);
    if (value.next_cursor === null) {
      return ok({
        instance: value.instance,
        last_reports: value.last_reports,
        lines,
      });
    }
    cursor = value.next_cursor;
  }
}

export const WORKFLOW_COMMANDS: readonly CommandEntry[] = [
  entryOf("workflow start", "workflow instance를 시작한다", {
    positional: ["workflow", "text"],
    run: start,
  }),
  entryOf("workflow report", "step의 결과를 report하고 다음으로 넘긴다", {
    positional: ["instance", "step", "text"],
    run: report,
  }),
  entryOf("workflow stop", "workflow instance를 멈춘다", {
    positional: ["instance"],
    run: stop,
  }),
  entryOf("workflow show", "workflow instance와 줄을 읽는다", {
    positional: ["instance"],
    run: show,
  }),
];
