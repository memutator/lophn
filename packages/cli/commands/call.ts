// `lophn call send|reply|cancel`: lophn agent가 다른 session에 일을 맡기고, 받은 call에 답하고, 보낸 call을 취소한다.
// call.send·call.reply route는 actor가 agent뿐이라 binary(사람)에서는 forbidden이다. 보낸 turn의 unattended 표시는 core가
// agent credential의 turn mode에서 찍으므로 여기서 다루지 않는다.
// effect가 read인 것은 run-loop가 실패한 read를 같은 tool call로 다시 부를 때 key가 같아서 call이 하나만 생기기 때문이다.
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import {
  agentCallSend,
  callCancel,
  callRefSchema,
  callReply,
} from "../../protocol/lophn-agent/calls.ts";
import {
  type ContentBlock,
  textBlocks,
} from "../../protocol/lophn-agent/content-block.ts";
import { transfersSend } from "../../protocol/folder/transfers.ts";
import { callSendRemote } from "../../protocol/lophn-agent/mail.ts";
import {
  MESSAGE_IMAGE_CALL_MAX_BYTES,
  messageImagePrepare,
} from "../../protocol/lophn-agent/message-images.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { uploadAttachments } from "./send.ts";
import { defineCommand, type CommandContext } from "./types.ts";

// 본문은 글 하나다. `--image <path>`는 file을 image block으로 더한다: 받는 쪽에 읽기 허락을 주지 않고 값을 싣는다.
export const bodyFields = {
  body: z.string().min(1),
  image: z.array(z.string().min(1)).default([]),
};

function fail(code: LophnError["code"], message: string): Result<never> {
  return err({ code, message });
}

// lophn tool로 부르면 그 session이 읽을 수 있는 file만 싣는다(file tool과 같은 검사). binary는 process cwd 기준이고 막지 않는다.
async function imageBlock(
  path: string,
  ctx: CommandContext,
): Promise<Result<ContentBlock>> {
  let real: string;
  if (ctx.resolveRead !== undefined) {
    const allowed = await ctx.resolveRead(path);
    if (!allowed.ok) return allowed;
    real = allowed.value;
  } else {
    try {
      real = await realpath(resolve(ctx.cwd ?? ".", path));
    } catch {
      return fail("not_found", `image not found: ${path}`);
    }
  }
  const info = await stat(real).catch(() => null);
  if (info === null) return fail("not_found", `image not found: ${path}`);
  if (!info.isFile()) return fail("invalid_input", `not a file: ${path}`);
  if (info.size > MESSAGE_IMAGE_CALL_MAX_BYTES) {
    return fail(
      "invalid_input",
      `image is larger than ${MESSAGE_IMAGE_CALL_MAX_BYTES} bytes: ${path}`,
    );
  }
  const prepared = await ctx.core.read(messageImagePrepare, {
    data_base64: (await readFile(real)).toString("base64"),
  });
  return prepared.ok
    ? ok({
        type: "image",
        mimeType: prepared.value.mimeType,
        blob: prepared.value.blob,
      })
    : prepared;
}

export async function bodyOf(
  input: { body: string; image: string[] },
  ctx: CommandContext,
): Promise<Result<ContentBlock[]>> {
  const blocks = textBlocks(input.body);
  for (const path of input.image) {
    const block = await imageBlock(path, ctx);
    if (!block.ok) return block;
    blocks.push(block.value);
  }
  return ok(blocks);
}

const send = defineCommand({
  name: "call.send",
  summary: "Hand work to an agent asynchronously",
  description:
    "Hand work to an agent asynchronously; returns a call ID. to.session uses an open session (session list); to.agent/workspace opens a new one using exact names (no workspace means home). " +
    'Supply both with fallback:"new" to open a replacement when the session is closed. Closed sessions stay closed. ' +
    "reply: none requires no answer; result asks the receiver to reply; conversation lets both sides continue via call reply. " +
    "body is text. Repeat --image <path> to attach an image file (png, jpeg, gif or webp, under 180 KB) from a folder this session can read; the receiver gets the image itself and no read access to the file. " +
    "To hand work to a coding agent the person will continue in a terminal, open its TUI with `lophn tab open --coding <harness> --handoff <text>` instead. " +
    "--on <computer> sends it to an agent on another computer of the person (machine computers): to.session is a session listed by session list --on, to.workspace a project by its cross-computer id (pri_…, from lophn project identity on that computer or agent list --on; a project name works only when the project is also on this computer), an app slug or home there. Repeat --attach <path> with --on <computer> to upload local files via `transfers/send` and attach them to the remote call; images and refs are local-only. When the work needs files, send them in the same call with --attach instead of a separate `lophn send`: the receiver gets their exact paths and is woken again when they arrive. Hand one piece of work to one receiver, and ask for --reply result when you need to know how it went.",
  input: agentCallSend.input.omit({ dedup: true, body: true }).extend({
    ...bodyFields,
    refs: z.array(callRefSchema).default([]),
    attach: z.array(z.string().min(1)).max(32).default([]),
    on: z.string().min(1).optional(),
  }),
  effect: "read",
  routes: [agentCallSend, callSendRemote, messageImagePrepare, transfersSend],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const { image: _image, attach, on, ...rest } = input;
    // 같은 tool call을 다시 보내도 같은 dedup이라 call과 session이 하나만 생긴다.
    let sent;
    if (on !== undefined) {
      if (input.image.length > 0 || input.refs.length > 0) {
        return fail(
          "invalid_input",
          "only text and --attach files go to another computer (no --image or --refs)",
        );
      }
      const attachments = [...(rest.attachments ?? [])];
      if (attach.length > 0) {
        const uploaded = await uploadAttachments(on, attach, ctx);
        if (!uploaded.ok) return uploaded;
        attachments.push(...uploaded.value);
      }
      sent = await ctx.core.read(callSendRemote, {
        to: { ...rest.to, machine: on },
        reply: rest.reply,
        body: textBlocks(rest.body),
        ...(attachments.length > 0 ? { attachments } : {}),
        dedup: ctx.key,
      });
    } else {
      if (attach.length > 0) {
        return fail(
          "invalid_input",
          "--attach uploads files to another computer and requires --on <computer>; on this computer pass file paths via --refs or --image",
        );
      }
      const body = await bodyOf(input, ctx);
      if (!body.ok) return body;
      sent = await ctx.core.command(
        agentCallSend,
        { ...rest, body: body.value, dedup: ctx.key },
        { key: ctx.key },
      );
    }
    if (!sent.ok) return sent;
    const { call, state, fail_reason } = sent.value;
    return ok({
      summary:
        fail_reason === null
          ? `call ${call} is ${state}`
          : `call ${call} failed: ${fail_reason}`,
      content: {
        call,
        state,
        fail_reason,
        ...(fail_reason === "closed"
          ? {
              // 닫힌 session이 다른 컴퓨터에 연 팀원이었는지는 답에 없다(이 컴퓨터에 그 session의 대화가 없다).
              hint: "that session is closed; call its agent and workspace to open a new session, or if it was a team member on another computer, open a new one with `team spawn <handle> --on <computer>`",
            }
          : {}),
      },
    });
  },
});

const reply = defineCommand({
  name: "call.reply",
  summary: "Answer a call you received",
  description:
    "Answer a call you received, with call (its ID), body (text), optional --image <path> files and refs. If you will not take the work, reply with the reason. closed: true means the call already ended and the reply was not delivered. " +
    "A call from a team member that needs approval to run something is answered with --allow or --reject (--body is the reason for a reject); any other call takes --body.",
  input: callReply.input.omit({ body: true, decision: true }).extend({
    ...bodyFields,
    body: z.string().optional(),
    allow: z.boolean().optional(),
    reject: z.boolean().optional(),
    refs: z.array(callRefSchema).default([]),
  }),
  positional: ["call"],
  effect: "read",
  routes: [callReply, messageImagePrepare],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    if (input.allow === true && input.reject === true) {
      return fail("invalid_input", "use either --allow or --reject");
    }
    const decision =
      input.allow === true
        ? "allow"
        : input.reject === true
          ? "reject"
          : undefined;
    // 결정만 보내는 답은 글이 없어도 된다(reject의 이유는 선택).
    if (decision === undefined && (input.body ?? "") === "") {
      return fail("invalid_input", "body is required");
    }
    const body = await bodyOf({ ...input, body: input.body ?? "" }, ctx);
    if (!body.ok) return body;
    const { image: _image, allow: _allow, reject: _reject, ...rest } = input;
    const sent = await ctx.core.command(
      callReply,
      {
        ...rest,
        body: body.value,
        ...(decision === undefined ? {} : { decision }),
      },
      { key: ctx.key },
    );
    if (!sent.ok) return sent;
    return ok({
      summary: sent.value.closed ? "the call is closed" : "reply delivered",
      content: sent.value,
    });
  },
});

const cancel = defineCommand({
  name: "call.cancel",
  summary: "Cancel a call you sent",
  description:
    "Cancel a call you sent that has not ended, with call (its ID) and a one-line reason.",
  input: callCancel.input.required({ reason: true }),
  positional: ["call"],
  effect: "read",
  routes: [callCancel],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const done = await ctx.core.command(callCancel, input, { key: ctx.key });
    if (!done.ok) return done;
    return ok({
      summary: `call ${done.value.call} is ${done.value.state}`,
      content: done.value,
    });
  },
});

export const CALL_COMMANDS = [send, reply, cancel];
