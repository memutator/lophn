import { ok } from "../../../../base/mod.ts";
import {
  publishStateChanged,
  type StateChange,
} from "../../../../protocol/events/changes.ts";
import {
  STATE_CHANGED_TOPIC,
  withAfterCommit,
} from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";

// commit된 command(그 안에서 `tx.call`로 돈 command 포함)가 선언한 `changes`를 `StateChanged` 하나로 Bus에 낸다.
// writer Worker가 commit된 결과에 실어 보낸 것만 온다.
export const stateChangesWiring: WiringFactory = () => ({
  name: "state-changes",
  build(ctx) {
    return ok({
      writer: (inner) =>
        withAfterCommit(
          inner,
          (actions) => {
            const changes = actions.flatMap((action) =>
              action.topic === STATE_CHANGED_TOPIC
                ? (action.data as StateChange[])
                : [],
            );
            publishStateChanged(ctx.bus, ctx.clock.now(), changes);
          },
          ctx.telemetry.logger,
        ),
    });
  },
});
