import { ok } from "../../../base/mod.ts";
import {
  releaseActivate,
  releasePrepare,
  releasesGetRecord,
  releasesListRecords,
} from "../../../protocol/apps/mod.ts";
import {
  commandOf,
  countSummary,
  defineTool,
  fitted,
  notFound,
  readBody,
  readOf,
  type ToolDefinition,
} from "../../lophn-agent/tools/spi.ts";
import { z } from "zod";
import { idSchema } from "../../../protocol/base/ids.ts";

export const RELEASE_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "release.list",
    input: z.strictObject({ app: idSchema("app") }),
    routes: [releasesListRecords],
    description:
      "List the releases of an app with number, status, commit, time and the failure when activation failed.",
    effect: "read",
    handler: async (input, ctx) => {
      const { app } = input;
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
  defineTool({
    name: "release.get",
    input: z.strictObject({ release: idSchema("rel") }),
    routes: [releasesGetRecord],
    description:
      "Read a release: the prepared bundle, the last activation and the failure with its reason.",
    effect: "read",
    handler: async (input, ctx) => {
      const { release } = input;
      const read = await readOf(ctx.core, releasesGetRecord, { release });
      if (!read.ok) return read;
      const record = read.value.release;
      if (record === null) return notFound("release not found");
      return ok(fitted(`release ${record.id} is ${record.status}`, {
        release: record,
      }));
    },
  }),
  defineTool({
    name: "release.prepare",
    input: z.strictObject({ app: idSchema("app") }),
    routes: [releasePrepare],
    description:
      "Prepare a release from the HEAD commit of the app source, so commit first. It builds the bundle, checks the dependencies, runs the migrations on an empty database and from the active release's schema, and starts the bundle once to match its handlers with the declaration (this replaces the app's current preview). Returns the prepared release and the public tools it removes that other domains use, or the failed stage and its reason.",
    effect: "write",
    handler: async (input, ctx) => {
      const { app } = input;
      // 검사에 떨어진 것도 tool 결과다. 오류로 돌리면 이유가 model에 닿지 않는다.
      const done = await commandOf(
        ctx.core,
        releasePrepare,
        { app },
        {},
        ctx.tool_call,
      );
      if (!done.ok) return done;
      const out = done.value;
      if (out.status === "failed") {
        return ok(fitted(
          `release preparation failed at ${out.stage}: ${out.reason}`,
          out,
        ));
      }
      const removed = out.removed_public_tools.length;
      return ok(fitted(
        `prepared release #${out.release.number} (${out.release.id})${
          removed === 0 ? "" : `, removes ${removed} public tools in use`
        }`,
        out,
      ));
    },
  }),
  defineTool({
    name: "release.activate",
    input: z.strictObject({ release: idSchema("rel") }),
    routes: [releaseActivate],
    description:
      "Activate a prepared release of your app and wait for the result: active, or failed with the reason. A first activation, new permissions or a data loss migration need the person's consent: then it returns waiting_consent at once and the person sees the result. If the activation takes longer than two minutes it returns running; check app.status.",
    effect: "write",
    handler: async (input, ctx) => {
      const { release } = input;
      const done = await commandOf(
        ctx.core,
        releaseActivate,
        { release },
        {},
        ctx.tool_call,
      );
      if (!done.ok) return done;
      const out = done.value;
      const summary = out.status === "failed"
        ? `release ${release} failed: ${out.failure.code}: ${out.failure.summary}`
        : `release ${release} is ${out.status}`;
      return ok(fitted(summary, out));
    },
  }),
];
