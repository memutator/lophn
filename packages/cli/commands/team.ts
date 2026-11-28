// `lophn team spawn|read|end`: lophn agent가 자기 밑에 session을 열고, 팀(부모·형제·자식)을 읽고, 자기 밑 session을 끝낸다.
// route의 actor가 agent뿐이라 binary(사람)에서는 forbidden이다. 팀 규칙(부모는 자격의 session, 자기 밑만 끝냄)은 core가 건다.
// effect가 read인 것은 call.send와 같은 이유다: 같은 tool call을 다시 불러도 dedup이 같아 session이 하나만 생긴다.
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import { textBlocks } from "../../protocol/lophn-agent/content-block.ts";
import { teamSpawnRemote } from "../../protocol/lophn-agent/mail.ts";
import { idSchema } from "../../protocol/base/ids.ts";
import { callReplySchema } from "../../protocol/lophn-agent/calls.ts";
import {
  teamEnd,
  teamRead,
  teamSpawn,
} from "../../protocol/lophn-agent/team.ts";
import { messageImagePrepare } from "../../protocol/lophn-agent/message-images.ts";
import {
  WORKSPACE_KINDS,
  workspaceNameSchema,
} from "../../protocol/lophn-agent/workspaces.ts";
import { bodyFields, bodyOf } from "./call.ts";
import { defineCommand } from "./types.ts";

const spawn = defineCommand({
  name: "team.spawn",
  summary: "Open a session under you and hand it work",
  description:
    "Open a new session of an agent as your team member and send it the first call; returns the session and call IDs. The session is yours: only you (and the sessions above you) can end it, and it can call only its parent, siblings and its own members. " +
    'agent is the handle (see agent list). workspace is {"project": name} or {"app": name}; without it the member opens in your own workspace. ' +
    "reply: none requires no answer; result (default) asks it to reply; conversation lets both sides continue via call reply. body is text; repeat --image <path> to attach an image file as in call send. " +
    "The team is limited in size and depth (conflict when full). A member in your workspace appears as a tab; --as says what it is to you and the shell places it: peer (default) = a worker splitting the same job as you, in your group; stage = a member that will itself coordinate more members or takes the next step, which starts its own group. " +
    "After you spawn, end your turn: the answers arrive as new input. Do not poll. A member does the work itself; if it is unsure or needs approval, it uses `ask`, which goes to its parent (you). " +
    "Spawn runs in the background (or a project chat tab for built-in coding agents), for one-off work that needs no person. To hand work to a coding agent the person will continue in a terminal, use `lophn tab open --coding <harness> --handoff <text>`. " +
    "--on <computer> opens the member on another computer of the person (machine computers): agent is a handle from agent list --on there, workspace as in call send --on (without it, your own workspace by its cross-computer id). Only text goes. It returns at once even when that computer is off; the member counts in your team here, cannot spawn members itself, and problems there (no such agent, the person there skipped it) come back later as the call failing.",
  input: z.strictObject({
    agent: z.string().min(1),
    workspace: workspaceNameSchema.optional(),
    reply: callReplySchema.default("result"),
    as: z.enum(["peer", "stage"]).optional(),
    worktree: z.union([z.enum(["new", "inherit"]), idSchema("wkt")]).optional(),
    ...bodyFields,
    on: z.string().min(1).optional(),
  }),
  positional: ["agent"],
  effect: "read",
  routes: [teamSpawn, teamSpawnRemote, messageImagePrepare],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    if (input.on !== undefined) {
      if (input.image.length > 0) {
        return err({
          code: "invalid_input",
          message: "only text goes to another computer",
        });
      }
      if (input.worktree !== undefined) {
        return err({
          code: "invalid_input",
          message: "--worktree is not supported with --on",
        });
      }
      const spawned = await ctx.core.read(teamSpawnRemote, {
        agent: input.agent,
        ...(input.workspace === undefined
          ? {}
          : { workspace: input.workspace }),
        machine: input.on,
        reply: input.reply,
        body: textBlocks(input.body),
        dedup: ctx.key,
      });
      if (!spawned.ok) return spawned;
      return ok({
        summary: `member ${spawned.value.session} opening on ${input.on}, call ${spawned.value.call}`,
        content: spawned.value,
      });
    }
    const { on: _on, ...local } = input;
    const body = await bodyOf(local, ctx);
    if (!body.ok) return body;
    const { image: _image, as: relation, ...rest } = local;
    const spawned = await ctx.core.command(
      teamSpawn,
      {
        ...rest,
        ...(relation === undefined ? {} : { relation }),
        body: body.value,
        dedup: ctx.key,
      },
      { key: ctx.key },
    );
    if (!spawned.ok) return spawned;
    return ok({
      summary: `session ${spawned.value.session} opened, call ${spawned.value.call}`,
      content: spawned.value,
    });
  },
});

const read = defineCommand({
  name: "team.read",
  summary: "Read your team: parent, siblings and members",
  description:
    "Read your team: your parent, your siblings (same parent) and the open sessions you spawned, each with session ID, agent handle and name, one-line description, runtime, state (running, waiting for a human, or idle) and open_calls (calls you sent it that it has not answered yet). A member opened on another computer shows that computer and the state pending (not there yet), held (waiting in that computer's Inbox) or running. Empty when you are not in a team. Run it when you are told your team changed.",
  input: z.strictObject({}),
  effect: "read",
  routes: [teamRead],
  workspaces: WORKSPACE_KINDS,
  run: async (_input, ctx) => {
    const team = await ctx.core.read(teamRead, {});
    if (!team.ok) return team;
    const { parent, siblings, children } = team.value;
    return ok({
      summary: `${parent === null ? "no parent" : "1 parent"}, ${siblings.length} siblings, ${children.length} members`,
      content: { parent, siblings, children },
      arrayKeys: ["siblings", "children"],
    });
  },
});

const end = defineCommand({
  name: "team.end",
  summary: "End a member under you and everything under it",
  description:
    "End a session you spawned (or anyone under it) and every open session under it, leaves first, as archiving does; returns the ended session IDs. You cannot end your parent, siblings or yourself (forbidden).",
  input: z.strictObject({ session: idSchema("ses") }),
  positional: ["session"],
  effect: "read",
  routes: [teamEnd],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const done = await ctx.core.command(teamEnd, input, { key: ctx.key });
    if (!done.ok) return done;
    return ok({
      summary: `${done.value.ended.length} sessions ended`,
      content: done.value,
    });
  },
});

export const TEAM_COMMANDS = [spawn, read, end];
