// `lophn handoff write`: agent가 자기 session의 handoff note를 남긴다. route의 actor가 agent뿐이라 binary(사람)에서는 forbidden이다.
// 언제 쓸지는 지침과 사람이 정한다. note가 쓴 것을 바꾸므로 다시 불러도 같은 결과다.
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import { handoffWrite } from "../../protocol/lophn-agent/handoff.ts";
import { defineCommand } from "./types.ts";

const write = defineCommand({
  name: "handoff.write",
  summary: "Leave a handoff note for this session",
  description:
    "Leave a handoff note for this session: where the work stands and what comes next. It replaces this session's earlier note. lophn adds this computer, the project's shared id, the git branch and commit and the time, and carries the note to the person's other computers, where the person can continue from it.",
  input: z.strictObject({ body: z.string().min(1) }),
  effect: "write",
  routes: [handoffWrite],
  workspaces: ["project"],
  run: async (input, ctx) => {
    const written = await ctx.core.read(handoffWrite, { text: input.body });
    if (!written.ok) return written;
    const { branch, commit, written_at } = written.value;
    return ok({
      summary: `handoff note written at ${written_at}${branch === null ? "" : ` on ${branch}`}${commit === null ? "" : ` (${commit.slice(0, 12)})`}`,
      content: written.value,
    });
  },
});

export const HANDOFF_COMMANDS = [write];
