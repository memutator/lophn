import { ok } from "../../../base/mod.ts";
import {
  appCallTool,
  previewsGet,
  previewsStart,
  previewsStop,
  releasesGetRecord,
} from "../../../protocol/apps/mod.ts";
import { idSchema } from "../../../protocol/base/ids.ts";
import { relativePathSchema } from "../../../protocol/projects/values.ts";
import {
  defineTool,
  fitted,
  notFound,
  readOf,
  type ToolContext,
  type ToolDefinition,
} from "../../lophn-agent/tools/spi.ts";
import { z } from "zod";

// launcher의 ready 상한(30초)에 credential과 spawn 여유를 더한 값이다.
const PREVIEW_READY_WAIT_MS = 60_000;
const PREVIEW_POLL_MS = 500;
// preview/model.ts의 STARTING다. tool 정의 file은 feature module 안을 import하지 못한다.
const STARTING = "starting";

const NO_PREVIEW = "no preview is running for this app";

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done);
  });
}

function currentOf(ctx: ToolContext, app: string) {
  return readOf(ctx.core, previewsGet, { app });
}

export const PREVIEW_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "preview.start",
    input: z.strictObject({
      release: idSchema("rel"),
      fixture: relativePathSchema.optional(),
    }),
    routes: [releasesGetRecord, previewsStart, previewsGet],
    description:
      "Start a preview of a prepared release of your app: the sealed bundle runs with fixture data and stand-ins for network and secrets. fixture is the path of a sqlite file inside the bundle to start the data from. The previous preview of the app stops. Waits until it is ready or failed.",
    effect: "write",
    handler: async (input, ctx) => {
      const { release, fixture } = input;
      const read = await readOf(ctx.core, releasesGetRecord, { release });
      if (!read.ok) return read;
      const record = read.value.release;
      if (record === null) return notFound("release not found");
      const app = record.app;
      const started = await readOf(ctx.core, previewsStart, {
        input: {
          app,
          bundle_hash: record.bundle_hash,
          release,
          fixture: fixture ?? null,
        },
      });
      if (!started.ok) return started;
      const nonce = started.value.process_nonce;
      const deadline = ctx.clock.nowMs() + PREVIEW_READY_WAIT_MS;
      let observation;
      for (;;) {
        const got = await readOf(ctx.core, previewsGet, {
          app,
          process_nonce: nonce,
        });
        if (!got.ok) return got;
        observation = got.value.observation;
        if (
          observation === null ||
          observation.ready ||
          observation.reason?.code !== STARTING ||
          ctx.clock.nowMs() >= deadline ||
          ctx.signal?.aborted
        )
          break;
        await sleep(PREVIEW_POLL_MS, ctx.signal);
      }
      const ready = observation?.ready === true;
      const reason = ready
        ? undefined
        : observation === null
          ? "the preview process is gone"
          : observation.reason?.code === STARTING
            ? "the preview did not become ready in 60 seconds"
            : `${observation.reason?.code}: ${observation.reason?.summary}`;
      return ok(
        fitted(
          ready
            ? `preview of ${app} is ready`
            : `preview of ${app} is not ready`,
          {
            app,
            release,
            process_nonce: nonce,
            ready,
            ...(reason === undefined ? {} : { reason }),
          },
        ),
      );
    },
  }),
  defineTool({
    name: "preview.call",
    input: z.strictObject({
      app: idSchema("app"),
      tool: z.string().min(1),
      input: z.unknown().optional(),
    }),
    routes: [previewsGet, appCallTool],
    description:
      "Call a tool of your app's running preview and return its outcome. Nothing is recorded and live data is never touched. Omit input for a tool that takes none.",
    effect: "write",
    handler: async (input, ctx) => {
      const { app, tool } = input;
      const current = await currentOf(ctx, app);
      if (!current.ok) return current;
      const observation = current.value.observation;
      if (observation === null) {
        return ok(
          fitted(`${NO_PREVIEW}; start one with preview.start`, {
            running: false,
          }),
        );
      }
      const reply = await readOf(ctx.core, appCallTool, {
        target: {
          mode: "preview",
          app,
          process_nonce: observation.process_nonce,
        },
        tool,
        ...(input.input === undefined ? {} : { input: input.input }),
        caller: {
          kind: "agent",
          session: ctx.session,
          turn: ctx.turn,
          tool_call: ctx.tool_call,
        },
      });
      if (!reply.ok) return reply;
      const { outcome } = reply.value;
      const detail =
        outcome.status === "denied"
          ? ` (${outcome.denial.code})`
          : outcome.status === "failed"
            ? ` (${outcome.error.code})`
            : "";
      return ok(
        fitted(`preview call of ${tool} ${outcome.status}${detail}`, {
          outcome,
        }),
      );
    },
  }),
  defineTool({
    name: "preview.stop",
    input: z.strictObject({ app: idSchema("app") }),
    routes: [previewsGet, previewsStop],
    description: "Stop your app's running preview.",
    effect: "write",
    handler: async (input, ctx) => {
      const { app } = input;
      const current = await currentOf(ctx, app);
      if (!current.ok) return current;
      const observation = current.value.observation;
      if (observation === null) {
        return ok(fitted(NO_PREVIEW, { stopped: false }));
      }
      const stopped = await readOf(ctx.core, previewsStop, {
        app,
        process_nonce: observation.process_nonce,
      });
      if (!stopped.ok) return stopped;
      return ok(fitted(`preview of ${app} stopped`, { stopped: true }));
    },
  }),
];
