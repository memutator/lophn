import { ok } from "../../base/mod.ts";
import {
  problemGet,
  problemGetOccurrence,
  problemList,
  problemListDomain,
  problemSetState,
  reportBody,
} from "../../protocol/problems/mod.ts";
import {
  commandOf,
  countSummary,
  defineTool,
  fitted,
  invalid,
  readBody,
  readOf,
  type ToolDefinition,
} from "../lophn-agent/tools/spi.ts";
import { z } from "zod";
import { idSchema } from "../../protocol/base/ids.ts";
import { atSchema } from "../../protocol/base/values.ts";
import { problemStateSchema } from "../../protocol/problems/problem-record.ts";

// 한 번에 읽는 본문 길이다. tool 결과 상한(24 KiB)에 JSON escape가 늘려도 들어가게 잡는다.
const BODY_READ_BYTES = 16 * 1024;

export const PROBLEMS_AGENT_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "problem.list",
    input: z.strictObject({
      app: idSchema("app").optional(),
      domain: idSchema("dom").optional(),
      state: problemStateSchema.optional(),
      since: atSchema.optional(),
      until: atSchema.optional(),
    }),
    routes: [problemList, problemListDomain],
    description:
      "List problems, optionally of one app, one state or a period of last occurrence (since, until). Pass `domain` to list the kind violations of a domain instead of app problems (only `state` can go with it; its states are open and resolved).",
    effect: "read",
    handler: async (input, ctx) => {
      const { domain: given, ...appFilter } = input;
      if (given !== undefined) {
        if (Object.keys(appFilter).some((k) => k !== "state")) {
          return invalid("domain can only be combined with state");
        }
        const state = appFilter.state;
        if (state === "ignored") {
          return invalid("domain problems are open or resolved");
        }
        // 생략하면 앱 problem이다. domain은 이 agent의 `ctx.domains` 안이어야 하고, 아니면 core를 부르지 않는다.
        if (!ctx.domains.includes(given)) {
          return invalid(
            `domain is not yours; your domains: ${ctx.domains.join(", ")}`,
          );
        }
        const listed = await readOf(ctx.core, problemListDomain, {
          domain: given,
          ...(state === undefined ? {} : { state }),
        });
        if (!listed.ok) return listed;
        const { body, more } = readBody(listed.value);
        return ok(fitted(
          countSummary("problems", body.problems.length, more),
          body,
          ["problems"],
        ));
      }
      const read = await readOf(
        ctx.core,
        problemList,
        appFilter,
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
  defineTool({
    name: "problem.get",
    input: z.strictObject({ problem: idSchema("prb") }),
    routes: [problemGet, problemGetOccurrence],
    description:
      "Read a problem: its recent occurrences, first and last release, and the latest occurrence's evidence: error name and source frames, the invocation, a summary of the logs (line count, no text), a preview of the report message (first 2,000 characters) and the hash of its details. Read the full message, details and log text with `problem.body`.",
    effect: "read",
    handler: async (input, ctx) => {
      const read = await readOf(
        ctx.core,
        problemGet,
        input,
      );
      if (!read.ok) return read;
      const { body: got } = readBody(read.value);
      // problemGet은 pool의 동기 읽기라 blob 글을 못 읽는다. 앞부분은 get_occurrence가 이미 읽으므로 tool에서 합친다.
      let latest = null;
      if (got.latest !== null) {
        const occurrence = await readOf(ctx.core, problemGetOccurrence, {
          report: got.latest.occurrence.report,
        });
        if (!occurrence.ok) return occurrence;
        const { message, details_hash } = occurrence.value;
        latest = { ...got.latest, message, details_hash };
      }
      const body = { ...got, latest };
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
  defineTool({
    name: "problem.body",
    input: z.strictObject({
      report: idSchema("rpt"),
      field: z.enum(["report_text", "report_details", "snapshot_logs"]),
      offset_bytes: z.number().int().min(0).optional(),
    }),
    routes: [problemGetOccurrence, reportBody],
    description:
      "Read the text of a report: the message the app wrote (report_text), its details (report_details) or the logs captured with it (snapshot_logs). Find the report ID in the problem's occurrences. Long text is read in parts: pass next_offset_bytes as offset_bytes (it is offset_bytes plus the byte length of the returned text, so it can be a little off where redaction changed the text length).",
    effect: "read",
    handler: async (input, ctx) => {
      const { report, field } = input;
      const offset = input.offset_bytes ?? 0;
      const read = await readOf(ctx.core, reportBody, {
        report,
        field,
        offset_bytes: offset,
        length_bytes: BODY_READ_BYTES,
      });
      if (!read.ok) return read;
      const { value } = read;
      if (value.status === "unavailable") {
        return ok(fitted(`${field} of ${report} is unavailable`, {
          report,
          field,
          status: "unavailable",
          reason: value.reason,
        }));
      }
      const next = offset + new TextEncoder().encode(value.text).byteLength;
      return ok(fitted(`${field} of ${report}`, {
        report,
        field,
        status: "available",
        text: value.text,
        truncated: value.truncated,
        next_offset_bytes: value.truncated ? next : null,
      }));
    },
  }),
  defineTool({
    name: "problem.set_state",
    input: z.strictObject({
      problem: idSchema("prb"),
      state: z.enum(["resolved", "ignored"]),
    }),
    routes: [problemSetState],
    description:
      "Mark a problem resolved or ignored. Resolve only after the release that fixes it is active: the program refuses to resolve while the active release was not activated after the release of the last occurrence (conflict). If the problem is fixed without a release, ask the person with `ask`.",
    effect: "write",
    handler: async (input, ctx) => {
      const { problem, state } = input;
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
