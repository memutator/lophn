import { err, ok, type Result } from "../../base/mod.ts";
import {
  type Invocation,
  invocationDenied,
  invocationFinished,
  invocationRecordDenied,
  invocationRecordFinished,
  type InvocationRecordFinishedInput,
  invocationRecordStarted,
  invocationStarted,
} from "../../contracts/apps/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
} from "../../contracts/platform/mod.ts";
import {
  applyDenied,
  applyFinished,
  applyStarted,
  summaryWithinLimit,
} from "./model.ts";
import { insertInvocation, loadInvocation, updateInvocation } from "./store.ts";

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

// machine 통보만 받는다. route actors가 이미 걸러도 여기서 한 번 더 본다.
function requireMachine(ctx: RequestContext): Result<void> {
  return ctx.actor.startsWith("machine")
    ? ok(undefined)
    : conflict("invocation records are machine notifications only");
}

// 요약은 redaction 뒤에도 같은 한도를 유지해야 한다.
function checkSummary(
  summary: InvocationRecordFinishedInput["summary"],
): Result<void> {
  return summaryWithinLimit(summary)
    ? ok(undefined)
    : invalid("invocation summary exceeds the limit");
}

const ACCEPTED = { accepted: true as const };

export function createInvocationsCommands(): {
  recordStarted: CommandDefinition<typeof invocationRecordStarted>;
  recordFinished: CommandDefinition<typeof invocationRecordFinished>;
  recordDenied: CommandDefinition<typeof invocationRecordDenied>;
} {
  return {
    recordStarted: {
      route: invocationRecordStarted,
      handle(tx, ctx, input) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const current = loadInvocation(tx.sql, input.invocation);
        if (!current.ok) return current;
        const applied = applyStarted(current.value, input);
        if (!applied.ok) return applied;
        if (applied.value === null) return ok(ACCEPTED);
        const seq = tx.emit(invocationStarted, input.invocation, {
          app: input.app,
          release: input.release,
          mode: input.mode,
          operation: input.operation,
          trigger: input.trigger,
          caller: input.caller,
          started_at: input.started_at,
        });
        const invocation: Invocation = { ...applied.value };
        // 접수(accepted)가 먼저 있던 confirm 호출은 같은 행을 running으로 옮긴다.
        if (current.value === null) {
          insertInvocation(tx, invocation);
        } else {
          const stored = updateInvocation(tx, invocation);
          if (!stored.ok) return stored;
        }
        void seq;
        return ok(ACCEPTED);
      },
    },
    recordFinished: {
      route: invocationRecordFinished,
      handle(tx, ctx, input) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const summary = checkSummary(input.summary);
        if (!summary.ok) return summary;
        const current = loadInvocation(tx.sql, input.invocation);
        if (!current.ok) return current;
        const applied = applyFinished(current.value, input);
        if (!applied.ok) return applied;
        if (applied.value === null) return ok(ACCEPTED);
        const seq = tx.emit(invocationFinished, input.invocation, {
          status: input.status,
          started_at: applied.value.started_at,
          finished_at: input.finished_at,
          summary: applied.value.summary,
          detail_hash: applied.value.detail_hash,
        });
        const stored = updateInvocation(tx, applied.value);
        if (!stored.ok) return stored;
        void seq;
        return ok(ACCEPTED);
      },
    },
    recordDenied: {
      route: invocationRecordDenied,
      handle(tx, ctx, input) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const summary = checkSummary(input.summary);
        if (!summary.ok) return summary;
        const current = loadInvocation(tx.sql, input.invocation);
        if (!current.ok) return current;
        const applied = applyDenied(current.value, input);
        if (!applied.ok) return applied;
        if (applied.value === null) return ok(ACCEPTED);
        const seq = tx.emit(invocationDenied, input.invocation, {
          finished_at: input.finished_at,
          summary: applied.value.summary,
        });
        if (current.value === null) {
          insertInvocation(tx, applied.value);
        } else {
          const stored = updateInvocation(tx, applied.value);
          if (!stored.ok) return stored;
        }
        void seq;
        return ok(ACCEPTED);
      },
    },
  };
}
