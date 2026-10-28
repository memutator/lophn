import { err, ok } from "../../../base/mod.ts";
import { assignmentSet } from "../../../protocol/approvals/mod.ts";
import type { CommandDefinition } from "../../../protocol/server/mod.ts";
import { loadAssignmentRow, saveAssignment } from "./store.ts";

// agent와 앱은 자기 할당을 넓히지 못한다. route의 actors가 같은 경계를 먼저 막고, 여기서 한 번 더 본다.
export const assignmentSetCommand: CommandDefinition<typeof assignmentSet> = {
  route: assignmentSet,
  handle(tx, ctx, input, compare) {
    if (ctx.actor !== "user") {
      return err({
        code: "forbidden",
        message: "only the user changes an agent assignment",
      });
    }
    const current = loadAssignmentRow(tx.sql, input.agent);
    if (!current.ok) return current;
    if (current.value.revision !== compare.revision) {
      return err({
        code: "conflict",
        message: "agent assignment revision changed",
      });
    }
    const revision = current.value.revision + 1;
    saveAssignment(tx, input.agent, input.entries, revision);
    return ok({
      assignment: { agent: input.agent, entries: input.entries },
      revision,
    });
  },
};
