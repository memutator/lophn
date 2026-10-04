import { ok } from "../../base/mod.ts";
import {
  advanceSubscriberCursor,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import { defineSyncCommand } from "./handler.ts";

// 반응 없는 구간의 cursor만 올린다. 줄어들면 conflict이고 event는 없다(R22, domain model).
export const advanceSubscriberCursorCommand = defineSyncCommand(
  advanceSubscriberCursor,
  (tx: Tx, _ctx: RequestContext, input, _compare) => {
    const advanced = tx.advanceSubscriberCursor(
      input.subscriber,
      input.scanned_through_seq,
    );
    if (!advanced.ok) return advanced;
    return ok({ processed_through_seq: input.scanned_through_seq });
  },
);

export const LEDGER_COMMANDS = [advanceSubscriberCursorCommand];
