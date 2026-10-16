import { ok } from "../../../../base/mod.ts";
import {
  releasesGetRecord,
  releasesListRecords,
} from "../../../../protocol/apps/mod.ts";
import { getVerification } from "../../../../protocol/problems/mod.ts";
import { readOf } from "../../run-loop/core-call.ts";
import type { ToolDefinition } from "../registry.ts";
import type { ToolInput } from "../domain/input.ts";
import { countSummary, fitted, notFound, readBody } from "../domain/result.ts";
import { defineBuiltin } from "./common.ts";

export const RELEASE_TOOLS: readonly ToolDefinition[] = [
  defineBuiltin({
    name: "release.list",
    description:
      "List the releases of an app with number, status, commit, time and the failure when activation failed.",
    effect: "read",
    handler: async (input, ctx) => {
      const { app } = input as ToolInput<"release.list">;
      const read = await readOf(ctx.core, releasesListRecords, { app });
      if (!read.ok) return read;
      const { body, more } = readBody(read.value);
      const releases = body.releases.map((release) => ({
        id: release.id,
        number: release.number,
        status: release.status,
        code_commit: release.code_commit,
        created_at: release.created_at,
        activated_at: release.activated_at,
        failure: release.failure,
      }));
      return ok(fitted(
        countSummary("releases", releases.length, more),
        { releases },
        ["releases"],
      ));
    },
  }),
  defineBuiltin({
    name: "release.get",
    description:
      "Read a release: the prepared bundle, the results of its tests, the last activation and the failure with its reason.",
    effect: "read",
    handler: async (input, ctx) => {
      const { release } = input as ToolInput<"release.get">;
      const read = await readOf(ctx.core, releasesGetRecord, { release });
      if (!read.ok) return read;
      const record = read.value.release;
      if (record === null) return notFound("release not found");
      const tests = [];
      for (const id of record.tests) {
        const verification = await readOf(ctx.core, getVerification, {
          verification: id,
          detail: false,
        });
        if (!verification.ok) return verification;
        const { kind, result, reason } = verification.value.verification;
        tests.push({ id, kind, result, reason });
      }
      return ok(fitted(`release ${record.id} is ${record.status}`, {
        release: record,
        tests,
      }, ["tests"]));
    },
  }),
];
