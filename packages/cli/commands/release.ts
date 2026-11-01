// `lophn release list|get|prepare|activate`: 앱의 release를 읽고, HEAD에서 준비하고, 올린다.
// prepare·activate는 앱 place의 agent만 부른다(route가 actor와 앱을 가른다). 검사에 떨어진 준비와 실패한 activation도
// 명령은 끝난 것이라 오류가 아니라 `failed` 결과다: 오류로 돌리면 이유가 model에 닿지 않는다.
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import {
  releaseActivate,
  releasePrepare,
  releasesGetRecord,
  releasesListRecords,
} from "../../protocol/apps/mod.ts";
import { PLACE_KINDS } from "../../protocol/lophn-agent/places.ts";
import { defineCommand } from "./types.ts";

const app = idSchema("app");
const release = idSchema("rel");

const list = defineCommand({
  name: "release.list",
  summary: "List the releases of an app",
  description:
    "List the releases of an app with number, status, commit, time and the failure when activation failed.",
  input: z.strictObject({ app }),
  positional: ["app"],
  effect: "read",
  routes: [releasesListRecords],
  places: PLACE_KINDS,
  run: async (input, ctx) => {
    let cursor: string | undefined;
    const releases: unknown[] = [];
    for (;;) {
      const read = await ctx.core.read(releasesListRecords, {
        app: input.app,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!read.ok) return read;
      for (const item of read.value.releases) {
        releases.push({
          id: item.id,
          number: item.number,
          status: item.status,
          code_commit: item.code_commit,
          created_at: item.created_at,
          activated_at: item.activated_at,
          failure: item.failure,
        });
      }
      if (read.value.next_cursor === null) break;
      cursor = read.value.next_cursor;
    }
    return ok({
      summary: `${releases.length} releases`,
      content: { releases },
      arrayKeys: ["releases"],
    });
  },
});

const get = defineCommand({
  name: "release.get",
  summary: "Read a release",
  description:
    "Read a release: the prepared bundle, the last activation and the failure with its reason.",
  input: z.strictObject({ release }),
  positional: ["release"],
  effect: "read",
  routes: [releasesGetRecord],
  places: PLACE_KINDS,
  run: async (input, ctx) => {
    const read = await ctx.core.read(releasesGetRecord, input);
    if (!read.ok) return read;
    const record = read.value.release;
    if (record === null) {
      return err({ code: "not_found", message: "release not found" });
    }
    return ok({
      summary: `release ${record.id} is ${record.status}`,
      content: { release: record },
    });
  },
});

const prepare = defineCommand({
  name: "release.prepare",
  summary: "Prepare a release from the HEAD commit",
  description:
    "Prepare a release from the HEAD commit of the app source, so commit first. It builds the bundle, checks the dependencies, runs the migrations on an empty database and from the active release's schema, and starts the bundle once to match its handlers with the declaration (this replaces the app's current preview). Returns the prepared release and the public commands it removes that other domains use, or the failed stage and its reason.",
  input: z.strictObject({ app }),
  positional: ["app"],
  effect: "write",
  routes: [releasePrepare],
  places: ["app"],
  run: async (input, ctx) => {
    const done = await ctx.core.command(releasePrepare, input, {
      key: ctx.key,
    });
    if (!done.ok) return done;
    const out = done.value;
    if (out.status === "failed") {
      const summary = `release preparation failed at ${out.stage}`;
      return ok({ summary, content: out, failed: out.reason });
    }
    const removed = out.removed_public_tools.length;
    return ok({
      summary: `prepared release #${out.release.number} (${out.release.id})${
        removed === 0 ? "" : `, removes ${removed} public commands in use`
      }`,
      content: out,
    });
  },
});

const activate = defineCommand({
  name: "release.activate",
  summary: "Activate a prepared release",
  description:
    "Activate a prepared release of your app and wait for the result: active, or failed with the reason. A first activation, new permissions or a data loss migration need the person's consent: then it returns waiting_consent at once, and the result comes to this session later as a notice. If the activation takes longer than two minutes it returns running, and the result also comes as a notice.",
  input: z.strictObject({ release }),
  positional: ["release"],
  effect: "write",
  routes: [releaseActivate],
  places: ["app"],
  run: async (input, ctx) => {
    const done = await ctx.core.command(releaseActivate, input, {
      key: ctx.key,
    });
    if (!done.ok) return done;
    const out = done.value;
    if (out.status === "failed") {
      return ok({
        summary: `release ${input.release} failed`,
        content: out,
        failed: `${out.failure.code}: ${out.failure.summary}`,
      });
    }
    return ok({
      summary: `release ${input.release} is ${out.status}`,
      content: out,
    });
  },
});

export const RELEASE_COMMANDS = [list, get, prepare, activate];
