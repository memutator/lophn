import { ok } from "../../../../base/mod.ts";
import {
  problemGet,
  problemList,
  problemSetState,
} from "../../../../protocol/problems/mod.ts";
import { commandOf, readOf } from "../../run-loop/core-call.ts";
import type { ToolDefinition } from "../registry.ts";
import type { ToolInput } from "../domain/input.ts";
import { countSummary, fitted, readBody } from "../domain/result.ts";
import { defineBuiltin } from "./common.ts";

export const PROBLEM_TOOLS: readonly ToolDefinition[] = [
  defineBuiltin({
    name: "problem.list",
    description:
      "List problems, optionally of one app, one state or a period of last occurrence (since, until).",
    effect: "read",
    handler: async (input, ctx) => {
      const read = await readOf(
        ctx.core,
        problemList,
        input as ToolInput<"problem.list">,
      );
      if (!read.ok) return read;
      const { body, more } = readBody(read.value);
      return ok(fitted(
        countSummary("problems", body.problems.length, more),
        body,
        ["problems"],
      ));
    },
  }),
  defineBuiltin({
    name: "problem.get",
    description:
      "Read a problem with its occurrences, first and last release, and the latest occurrence's evidence (error, stack frames, invocation, logs).",
    effect: "read",
    handler: async (input, ctx) => {
      const read = await readOf(
        ctx.core,
        problemGet,
        input as ToolInput<"problem.get">,
      );
      if (!read.ok) return read;
      const { body } = readBody(read.value);
      const summary = `problem ${body.problem.id} is ${body.problem.state}`;
      const whole = fitted(summary, body, ["occurrences"]);
      if (whole.content !== null) return ok(whole);
      // 그래도 크면 가장 큰 근거인 log를 덜어 낸다.
      const slim = {
        ...body,
        latest: body.latest === null ? null : {
          ...body.latest,
          snapshot: { ...body.latest.snapshot, logs: null },
        },
        omitted: { logs: true },
      };
      return ok(fitted(summary, slim, ["occurrences"]));
    },
  }),
  defineBuiltin({
    name: "problem.set_state",
    description: "Mark a problem resolved or ignored.",
    effect: "write",
    handler: async (input, ctx) => {
      const { problem, state } = input as ToolInput<"problem.set_state">;
      const done = await commandOf(
        ctx.core,
        problemSetState,
        { problem, state, key: ctx.tool_call },
        {},
        ctx.tool_call,
      );
      if (!done.ok) return done;
      return ok(fitted(`problem ${problem} is ${state}`, done.value));
    },
  }),
];
