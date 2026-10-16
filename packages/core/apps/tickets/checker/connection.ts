// events의 visibility 장치(apps, problems, credentials)가 아직 읽는 옛 checker 구독자 자격이다.
// 구독자 자체는 없어졌다(보고 검사는 Reactor handler다). events가 visibility 장치를 지울 때
// 이 file도 같이 지운다.
import { ok } from "../../../../base/mod.ts";
import type { EventDefinition } from "../../../../protocol/base/mod.ts";
import type {
  EventVisibilityDefinition,
  RequestContext,
} from "../../../../protocol/server/mod.ts";
import { TICKET_CHECK_FEED_PRINCIPAL } from "./ids.ts";

export function isTicketCheckFeed(ctx: RequestContext): boolean {
  return ctx.actor === "machine" &&
    ctx.principal === TICKET_CHECK_FEED_PRINCIPAL &&
    ctx.credential_ref === TICKET_CHECK_FEED_PRINCIPAL;
}

export function ticketCheckFeedVisibility<D extends EventDefinition>(
  event: D,
): EventVisibilityDefinition<D> {
  return { event, handle: (_snapshot, ctx) => ok(isTicketCheckFeed(ctx)) };
}
