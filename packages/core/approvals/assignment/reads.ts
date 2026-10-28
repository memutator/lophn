import { ok } from "../../../base/mod.ts";
import { assignmentGet } from "../../../protocol/approvals/mod.ts";
import type { ReadDefinition } from "../../../protocol/server/mod.ts";
import { loadAssignmentRow } from "./store.ts";

export const assignmentGetRead: ReadDefinition<typeof assignmentGet> = {
  route: assignmentGet,
  handle(snapshot, _ctx, input) {
    const row = loadAssignmentRow(snapshot.sql, input.agent);
    if (!row.ok) return row;
    return ok({
      ...row.value,
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
  },
};
