import type { ProblemsPart } from "../register.ts";
import { ok } from "../../../base/mod.ts";
import type { EventDefinition } from "../../../protocol/base/mod.ts";
import type { EventVisibilityDefinition } from "../../../protocol/server/mod.ts";
import { isTicketCheckFeed } from "../../apps/tickets/checker/connection.ts";
import { isProblemsClosing } from "../closing/connection.ts";
import { setProblemStateCommand } from "./commands.ts";
import { problemGetRead, problemListRead } from "./reads.ts";

// ticket checker 구독자(machine:ticket-check-feed)도 깨움 신호로 보는 event다.
// `problems.closing` 반응기도 문제 상태·활성 release를 다시 읽는 신호로 본다.
// 그 밖의 자격은 owner 정책이 그대로 판단한다.
export function visibleToChecker<D extends EventDefinition>(
  owner: EventVisibilityDefinition<D>,
): EventVisibilityDefinition<D> {
  return {
    event: owner.event,
    handle: (snapshot, ctx, event) =>
      isTicketCheckFeed(ctx) || isProblemsClosing(ctx)
        ? ok(true)
        : owner.handle(snapshot, ctx, event),
  };
}

export const groupingPart = {
  commands: [setProblemStateCommand],
  reads: [problemListRead, problemGetRead],
  readerReads: [problemListRead, problemGetRead],
} satisfies ProblemsPart;
