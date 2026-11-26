// `lophn handoff write`: agent가 자기 session의 handoff note를 남긴다. route의 actor가 agent뿐이라 binary(사람)에서는 forbidden이다.
// `--attach <path>`는 `transfers/send`로 다른 컴퓨터에 첨부 파일을 올린 뒤 나온 `TransferAttachment`들을 handoff note에 함께 싣는다.
// 언제 쓸지는 지침과 사람이 정한다. note가 쓴 것을 바꾸므로 다시 불러도 같은 결과다.
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import { transfersSend } from "../../protocol/folder/transfers.ts";
import {
  type TransferAttachment,
  transferAttachmentSchema,
} from "../../protocol/lophn-agent/calls.ts";
import { handoffWrite } from "../../protocol/lophn-agent/handoff.ts";
import { machineComputers } from "../../protocol/machine/mod.ts";
import { uploadAttachments } from "./send.ts";
import { defineCommand } from "./types.ts";

const write = defineCommand({
  name: "handoff.write",
  summary: "Leave a handoff note for this session",
  description:
    "Leave a handoff note for this session: where the work stands and what comes next. It replaces this session's earlier note. " +
    "lophn adds this computer, the project's shared id, the git branch and commit and the time, and carries the note to the person's other computers, where the person can continue from it. " +
    "Repeat --attach <path> (with --on <computer> when you have more than one other computer) to upload local files via `transfers/send` and attach them to the handoff note.",
  input: z.strictObject({
    body: z.string().min(1),
    attach: z.array(z.string().min(1)).max(32).default([]),
    attachments: z.array(transferAttachmentSchema).max(32).optional(),
    on: z.string().min(1).optional(),
  }),
  effect: "write",
  routes: [handoffWrite, transfersSend, machineComputers],
  workspaces: ["project"],
  run: async (input, ctx) => {
    const attachments: TransferAttachment[] = [...(input.attachments ?? [])];
    if (input.attach.length > 0) {
      let target = input.on;
      if (target === undefined) {
        const listed = await ctx.core.read(machineComputers, {});
        if (!listed.ok) return listed;
        const others = listed.value.computers.filter((c) => !c.current);
        if (others.length === 0) {
          return err({
            code: "invalid_input",
            message:
              "no other computer is in the device list to send --attach files to",
          });
        }
        if (others.length > 1) {
          return err({
            code: "invalid_input",
            message: `multiple other computers exist (${others.map((c) => c.name).join(", ")}); specify --on <computer> with --attach`,
          });
        }
        target = others[0].id;
      }
      const uploaded = await uploadAttachments(
        target,
        input.attach,
        ctx,
        "handoff attachment",
      );
      if (!uploaded.ok) return uploaded;
      attachments.push(...uploaded.value);
    }
    const written = await ctx.core.read(handoffWrite, {
      text: input.body,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
    if (!written.ok) return written;
    const { branch, commit, written_at } = written.value;
    const attachNote =
      attachments.length === 0
        ? ""
        : `, ${attachments.length} ${attachments.length === 1 ? "attachment" : "attachments"}`;
    return ok({
      summary: `handoff note written at ${written_at}${branch === null ? "" : ` on ${branch}`}${commit === null ? "" : ` (${commit.slice(0, 12)})`}${attachNote}`,
      content: {
        ...written.value,
        ...(attachments.length > 0 ? { attachments } : {}),
      },
    });
  },
});

export const HANDOFF_COMMANDS = [write];
