// `lophn preview start|stop|call`: 앱의 봉인된 release를 fixture data로 띄우고, 부르고, 멈춘다. 앱 workspace의 agent가 쓴다.
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import {
  appCallTool,
  previewsGet,
  previewsStart,
  previewsStop,
  releasesGetRecord,
} from "../../protocol/apps/mod.ts";
import { relativePathSchema } from "../../protocol/projects/values.ts";
import { defineCommand } from "./types.ts";

// launcher의 ready 상한(30초)에 credential과 spawn 여유를 더한 값이다.
const READY_WAIT_MS = 60_000;
const POLL_MS = 500;
// preview/model.ts의 STARTING이다. 명령 file은 feature module 안을 import하지 못한다.
const STARTING = "starting";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}

const start = defineCommand({
  name: "preview.start",
  summary: "Start a preview of a prepared release",
  description:
    "Start a preview of a prepared release of your app: the sealed bundle runs with fixture data and stand-ins for network and secrets. fixture is the path of a sqlite file inside the bundle to start the data from. The previous preview of the app stops. Waits until it is ready or failed.",
  input: z.strictObject({
    release: idSchema("rel"),
    fixture: relativePathSchema.optional(),
  }),
  positional: ["release"],
  effect: "write",
  routes: [releasesGetRecord, previewsStart, previewsGet],
  workspaces: ["app"],
  run: async (input, ctx) => {
    const { release, fixture } = input;
    const read = await ctx.core.read(releasesGetRecord, { release });
    if (!read.ok) return read;
    const record = read.value.release;
    if (record === null) {
      return err({ code: "not_found", message: "release not found" });
    }
    const app = record.app;
    const started = await ctx.core.read(previewsStart, {
      input: {
        app,
        bundle_hash: record.bundle_hash,
        release,
        fixture: fixture ?? null,
      },
    });
    if (!started.ok) return started;
    const nonce = started.value.process_nonce;
    const deadline = ctx.clock.nowMs() + READY_WAIT_MS;
    let observation;
    for (;;) {
      const got = await ctx.core.read(previewsGet, {
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
        ctx.signal.aborted
      )
        break;
      await sleep(POLL_MS, ctx.signal);
    }
    if (observation?.ready === true) {
      return ok({
        summary: `preview of ${app} is ready`,
        content: { app, release, process_nonce: nonce, ready: true },
      });
    }
    const reason =
      observation === null
        ? "the preview process is gone"
        : observation.reason?.code === STARTING
          ? "the preview did not become ready in 60 seconds"
          : `${observation.reason?.code}: ${observation.reason?.summary}`;
    return ok({
      summary: `preview of ${app} is not ready`,
      content: { app, release, process_nonce: nonce, ready: false, reason },
      failed: reason,
    });
  },
});

const stop = defineCommand({
  name: "preview.stop",
  summary: "Stop the running preview of an app",
  description: "Stop your app's running preview.",
  input: z.strictObject({ app: idSchema("app") }),
  positional: ["app"],
  effect: "write",
  routes: [previewsGet, previewsStop],
  workspaces: ["app"],
  run: async (input, ctx) => {
    const { app } = input;
    const current = await ctx.core.read(previewsGet, { app });
    if (!current.ok) return current;
    const observation = current.value.observation;
    if (observation === null) {
      return ok({
        summary: "no preview is running for this app",
        content: { stopped: false },
      });
    }
    const stopped = await ctx.core.read(previewsStop, {
      app,
      process_nonce: observation.process_nonce,
    });
    if (!stopped.ok) return stopped;
    return ok({
      summary: `preview of ${app} stopped`,
      content: { stopped: true },
    });
  },
});

const call = defineCommand({
  name: "preview.call",
  summary: "Call an operation or command of the running preview",
  description:
    "Call an operation (what the app's screens call) or a command (what agents and other apps call) of your app's running preview and return its outcome. Nothing is recorded and live data is never touched. Omit args for one that takes none.",
  input: z.strictObject({
    app: idSchema("app"),
    // 화면이 부르는 operation도 확인할 수 있다. live에서는 agent가 operation을 부르지 못한다.
    kind: z.enum(["operation", "command"]),
    name: z.string().min(1),
    // `input`은 공통 flag `--input`과 겹쳐서 `args`로 받고 route의 input으로 넘긴다.
    args: z.unknown().optional(),
  }),
  positional: ["app", "kind", "name"],
  effect: "write",
  routes: [previewsGet, appCallTool],
  workspaces: ["app"],
  run: async (input, ctx) => {
    const { app, kind, name } = input;
    const current = await ctx.core.read(previewsGet, { app });
    if (!current.ok) return current;
    const observation = current.value.observation;
    if (observation === null) {
      return ok({
        summary:
          "no preview is running for this app; start one with `lophn preview start`",
        content: { running: false },
      });
    }
    const reply = await ctx.core.read(appCallTool, {
      target: {
        mode: "preview",
        app,
        process_nonce: observation.process_nonce,
      },
      kind,
      name,
      ...(input.args === undefined ? {} : { input: input.args }),
      caller:
        ctx.caller === undefined
          ? { kind: "person" }
          : { kind: "agent", ...ctx.caller },
    });
    if (!reply.ok) return reply;
    const { outcome } = reply.value;
    const detail =
      outcome.status === "denied"
        ? ` (${outcome.denial.code})`
        : outcome.status === "failed"
          ? ` (${outcome.error.code})`
          : "";
    return ok({
      summary: `preview call of ${name} ${outcome.status}${detail}`,
      content: { outcome },
    });
  },
});

export const PREVIEW_COMMANDS = [start, stop, call];
