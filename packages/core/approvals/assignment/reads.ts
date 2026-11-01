import { ok } from "../../../base/mod.ts";
import { assignmentGet } from "../../../protocol/approvals/mod.ts";
import type { ReadDefinition } from "../../../protocol/server/mod.ts";
import { assignmentPorts } from "./ports.ts";

export const assignmentGetRead: ReadDefinition<typeof assignmentGet> = {
  route: assignmentGet,
  handle(snapshot, _ctx, input) {
    const state = snapshot.port(assignmentPorts).get(input.agent);
    if (!state.ok) return state;
    return ok({
      ...state.value,
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
  },
};
