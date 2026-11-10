// `lophn app read|tools|create|link-source|status|sdk-status|sdk-decide|sdk-feature|logs|invocations|event-publications`, `lophn declaration check`: 앱을 찾고 만들고 진단하는 명령이다.
// 다른 앱의 비공개 command를 숨기는 일은 `app.tool_index` route가 부른 쪽 credential을 보고 한다. 여기서는 부르기만 한다.
import { resolve } from "node:path";
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import {
  appConnectSource,
  appCreate,
  appEventPublications,
  appGet,
  appInvocations,
  appInvocationsInputSchema,
  appList,
  appLogs,
  appLogsReadInputSchema,
  appRuntime,
  appSdkDecide,
  appSdkFeature,
  appSdkStatus,
  appSlugOf,
  declarationCheck,
} from "../../protocol/apps/mod.ts";
import { appToolIndex } from "../../protocol/apps/declaration/read.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import { appIdSchema } from "../../protocol/projects/values.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { defineCommand } from "./types.ts";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});

// 읽기 route 출력에서 읽기 공통 칸을 걷는다. 다음 page가 있는지만 따로 돌려준다.
export function readBody<T extends { next_cursor?: string | null }>(
  value: T,
): { body: Omit<T, "as_of_seq" | "next_cursor" | "omitted">; more: boolean } {
  const {
    as_of_seq: _seq,
    next_cursor,
    omitted: _omitted,
    ...body
  } = value as T & { as_of_seq?: unknown; omitted?: unknown };
  return {
    body: body as Omit<T, "as_of_seq" | "next_cursor" | "omitted">,
    more: (next_cursor ?? null) !== null,
  };
}

// 목록 명령 입력에는 cursor가 없다. 더 있으면 조건을 좁히라고 알린다.
export function countSummary(noun: string, count: number, more: boolean) {
  return more
    ? `${count} ${noun} (more exist; narrow the filter)`
    : `${count} ${noun}`;
}

const read = defineCommand({
  name: "app.read",
  summary: "List apps or read one",
  description:
    "List the registered apps, or read one app (name, description, status, active release and source folder) when you give its ID.",
  input: z.strictObject({ app: idSchema("app").optional() }),
  positional: ["app"],
  effect: "read",
  routes: [appList, appGet],
  workspaces: WORKSPACE_KINDS,
  // 목록과 상세는 같은 읽기 범위다. 지정한 앱이 없거나 범위 밖이면 그 route의 오류이고 목록으로 바꾸지 않는다.
  run: async (input, ctx) => {
    if (input.app !== undefined) {
      const one = await ctx.core.read(appGet, { app: input.app });
      if (!one.ok) return one;
      return ok({
        summary: `app ${one.value.app.name}`,
        content: { app: one.value.app },
      });
    }
    const listed = await ctx.core.read(appList, {});
    if (!listed.ok) return listed;
    const { body, more } = readBody(listed.value);
    return ok({
      summary: countSummary("apps", body.apps.length, more),
      content: body,
      arrayKeys: ["apps"],
    });
  },
});

const tools = defineCommand({
  name: "app.tools",
  summary: "List apps with their commands",
  description:
    "List the apps with their commands, or read one app: name, description, effect and public of the active release's commands (and inputSchema when you give an app). Commands of other apps show only when public. An app's operations (what its screens call) are not listed. Use it to see what apps already do and to get exact command names for `app_connections` in the app's declaration.",
  input: z.strictObject({ app: idSchema("app").optional() }),
  positional: ["app"],
  effect: "read",
  routes: [appToolIndex],
  workspaces: ["home", "app"],
  run: async (input, ctx) => {
    const index = await ctx.core.read(appToolIndex, input);
    if (!index.ok) return index;
    const { body } = readBody(index.value);
    return ok({
      summary: countSummary("apps", body.apps.length, false),
      content: body,
      arrayKeys: ["apps"],
    });
  },
});

const create = defineCommand({
  name: "app.create",
  summary: "Register a new app",
  description:
    "Register a new app with a name and a one line purpose. Work on the app is done in a conversation at the app's workspace. A git repository started from the app template becomes the source folder of the app. If source_path in the result is null, the folder could not be made: connect a git folder with `lophn app link-source`.",
  input: z.strictObject({ name: nonblank, purpose: nonblank }),
  positional: ["name", "purpose"],
  effect: "write",
  routes: [appCreate],
  workspaces: ["home"],
  run: async (input, ctx) => {
    const made = await ctx.core.command(
      appCreate,
      {
        slug: appSlugOf(
          input.name,
          ctx.key
            .slice(-8)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, ""),
        ),
        name: input.name,
        description: input.purpose.trim().replace(/\s*[\r\n]+\s*/g, " "),
      },
      { key: ctx.key },
    );
    if (!made.ok) return made;
    return ok({
      summary: `registered app ${made.value.id}`,
      content: made.value,
    });
  },
});

const linkSource = defineCommand({
  name: "app.link_source",
  summary: "Connect a git folder as an app's source",
  description:
    "Connect a git folder as the source of an app. The folder must be the top of a git repository and have at least one commit. A relative path starts at the workspace's first folder (the current folder for the binary).",
  input: z.strictObject({ app: idSchema("app"), path: z.string().min(1) }),
  positional: ["app", "path"],
  effect: "write",
  routes: [appGet, appConnectSource],
  workspaces: ["app"],
  run: async (input, ctx) => {
    const found = await ctx.core.read(appGet, { app: input.app });
    if (!found.ok) return found;
    const linked = await ctx.core.command(
      appConnectSource,
      {
        app: input.app,
        source_path:
          ctx.cwd === undefined ? input.path : resolve(ctx.cwd, input.path),
      },
      { key: ctx.key, compare: { base_revision: found.value.app.revision } },
    );
    if (!linked.ok) return linked;
    return ok({
      summary: `linked the source of app ${input.app}`,
      content: linked.value,
    });
  },
});

const check = defineCommand({
  name: "declaration.check",
  summary: "Check an app's declaration",
  description:
    "Check the declaration of an app and return errors, warnings and the permission review separately. The declaration is `lophn.ts` in the app's source, sealed with each release; edit it with the file tools.",
  input: z.strictObject({ app: idSchema("app") }),
  positional: ["app"],
  effect: "read",
  routes: [declarationCheck],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const checked = await ctx.core.read(declarationCheck, input);
    if (!checked.ok) return checked;
    const { errors, warnings, permission_review } = checked.value;
    return ok({
      summary:
        errors.length === 0
          ? `declaration of app ${input.app} has no errors`
          : `declaration of app ${input.app} has ${errors.length} errors`,
      content: { errors, warnings, permission_review },
    });
  },
});

const status = defineCommand({
  name: "app.status",
  summary: "Read whether an app is running",
  description:
    "Read whether an app is running: its state (and the reason when it is unavailable) and the latest supervisor observation.",
  input: z.strictObject({ app: appIdSchema }),
  positional: ["app"],
  effect: "read",
  routes: [appRuntime],
  workspaces: ["home", "app"],
  run: async (input, ctx) => {
    const runtime = await ctx.core.read(appRuntime, input);
    if (!runtime.ok) return runtime;
    const { body } = readBody(runtime.value);
    const reason =
      body.state.reason === undefined
        ? ""
        : ` (${body.state.reason.code}: ${body.state.reason.summary})`;
    return ok({
      summary: `app ${input.app} is ${body.state.state}${reason}`,
      content: body,
    });
  },
});

const sdkStatus = defineCommand({
  name: "app.sdk_status",
  summary: "Read which SDK versions an app uses and which are out of date",
  description:
    'For each app (or the one you name) with a live release: every lophn SDK package it pins with the pinned version, the version lophn has now, the oldest version lophn still runs (supported_from), a level and the note files to read. level "required": the pinned version is older than supported_from, so the app does not start or soon will not; "available": it still runs and only lacks newer features; "current". notes are the `migrate-sdk` skill note files after the pinned version up to the current one, oldest first (read each with `skill.read {name: "migrate-sdk", path}`). unreviewed is the part of notes lophn at Home has not yet decided on (after the version of its last decision for this app). review is the last decision for the app: decision leave or update, time, through (the versions that decision covered), migrated (for update: whether the app now pins those versions), and the features it chose with their state (open until lophn at the app reports a result). Archived apps are not listed.',
  input: z.strictObject({ app: appIdSchema.optional() }),
  positional: ["app"],
  effect: "read",
  routes: [appSdkStatus],
  workspaces: ["home", "app"],
  run: async (input, ctx) => {
    const read = await ctx.core.read(appSdkStatus, input);
    if (!read.ok) return read;
    return ok({
      summary: countSummary("apps", read.value.apps.length, false),
      content: read.value,
      arrayKeys: ["apps"],
    });
  },
});

const sdkDecide = defineCommand({
  name: "app.sdk_decide",
  summary: "Decide what to do about an app's SDK update",
  description:
    "Lophn at Home records its decision for one app and, for update, hands the work to lophn at that app in the same action. decision leave: keep the app as is (not allowed when an SDK of the app is required). decision update: move the app to the current SDK versions and, optionally, build the features the person chose. features is a JSON array of {title, proposal, note}: title in the person's words, proposal for lophn at the app (what the person asked for and why it fits the app), note the migrate-sdk note file that adds the capability (from sdk-status notes or unreviewed). Lophn writes the versions, the note files and the migrate-sdk instruction itself; do not send a call for this. The decision covers the versions lophn has now: a later SDK version comes back as unreviewed. If the handoff is refused nothing is recorded and the refusal is returned (tell the person to open the app and ask lophn there to follow the migrate-sdk skill). Running update again for an app sends the handoff again.",
  input: appSdkDecide.input,
  positional: ["app"],
  effect: "write",
  routes: [appSdkDecide],
  workspaces: ["home"],
  run: async (input, ctx) => {
    const done = await ctx.core.command(appSdkDecide, input, { key: ctx.key });
    if (!done.ok) return done;
    return ok({
      summary:
        input.decision === "update"
          ? `update recorded and handed to lophn at the app (call ${done.value.call})`
          : "leave recorded",
      content: done.value,
    });
  },
});

const sdkFeature = defineCommand({
  name: "app.sdk_feature",
  summary: "Report the result of a chosen SDK feature",
  description:
    "Lophn at an app reports what became of one feature Home handed over (its ID is in the handoff): done, changed (built differently after talking to the person) or skipped, with a one-line note. Only this app's features can be reported.",
  input: appSdkFeature.input,
  positional: ["feature"],
  effect: "write",
  routes: [appSdkFeature],
  workspaces: ["app"],
  run: async (input, ctx) => {
    const done = await ctx.core.command(appSdkFeature, input, { key: ctx.key });
    if (!done.ok) return done;
    return ok({
      summary: `feature ${input.feature} is ${done.value.state}`,
      content: done.value,
    });
  },
});

const logs = defineCommand({
  name: "app.logs",
  summary: "Read an app's log lines",
  description:
    "Read app output, reported problems, exceptions, screen errors and process exits; newest lines last. Filter by invocation, since (inclusive), until (exclusive) and limit.",
  input: appLogsReadInputSchema,
  positional: ["app"],
  effect: "read",
  routes: [appLogs],
  workspaces: ["home", "app"],
  run: async (input, ctx) => {
    const read = await ctx.core.read(appLogs, input);
    if (!read.ok) return read;
    const { body } = readBody(read.value);
    const count = `${body.lines.length} lines`;
    return ok({
      summary: body.truncated
        ? `${count} (older lines exist; narrow with since, until or invocation)`
        : count,
      content: body,
      arrayKeys: ["lines"],
    });
  },
});

const invocations = defineCommand({
  name: "app.invocations",
  summary: "List an app's calls",
  description:
    "List an app's calls (operations and commands) with their caller, effect, status and times, newest first. Successful reads are not recorded; failed reads, writes and denied calls are. Filter by status, effect, release, mode, session or turn.",
  input: appInvocationsInputSchema.omit({ cursor: true }).extend({
    app: appIdSchema,
  }),
  positional: ["app"],
  effect: "read",
  routes: [appInvocations],
  workspaces: ["home", "app"],
  run: async (input, ctx) => {
    const read = await ctx.core.read(appInvocations, input);
    if (!read.ok) return read;
    const { body, more } = readBody(read.value);
    return ok({
      summary: countSummary("invocations", body.invocations.length, more),
      content: body,
      arrayKeys: ["invocations"],
    });
  },
});

const eventPublications = defineCommand({
  name: "app.event_publications",
  summary: "List the events an app published",
  description:
    "List the events an app published, newest first: which event, when, how many subscribers were running (reachable), how many could not be reached because they were not running (unreachable) and how many of the reachable ones were not handed the event because it would loop back to an app already in the chain (refused; a later denial or failure of a handed call is not counted, see `lophn app invocations`), and the trace_id the publication shares with the calls it caused (see `lophn app invocations`: those calls have an event caller). The payload is not kept. Only the most recent 200 per app are kept. Filter by event.",
  input: appEventPublications.input.omit({ cursor: true }),
  positional: ["app"],
  effect: "read",
  routes: [appEventPublications],
  workspaces: ["home", "app"],
  run: async (input, ctx) => {
    const read = await ctx.core.read(appEventPublications, input);
    if (!read.ok) return read;
    const { body, more } = readBody(read.value);
    return ok({
      summary: countSummary("publications", body.publications.length, more),
      content: body,
      arrayKeys: ["publications"],
    });
  },
});

export const APP_COMMANDS = [
  read,
  tools,
  create,
  linkSource,
  check,
  status,
  sdkStatus,
  sdkDecide,
  sdkFeature,
  logs,
  invocations,
  eventPublications,
];
