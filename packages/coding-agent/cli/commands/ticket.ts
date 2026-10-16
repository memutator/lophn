// `lophn ticket`: 맡은 ticket을 읽고 claim하고 갱신하고 완료를 보고한다. 근거 annotation(메모, component,
// source 위치, release, screenshot 파일 경로)은 `ticket show`의 route 출력 그대로 보인다.
import { err } from "../../../base/mod.ts";
import { reportTicket } from "../../connection/mod.ts";
import { type CommandEntry, entryOf, noToken } from "./types.ts";

export const TICKET_COMMANDS: readonly CommandEntry[] = [
  entryOf("ticket list", "이 앱의 ticket 목록을 읽는다"),
  entryOf("ticket show", "ticket 하나를 근거 annotation과 함께 읽는다"),
  entryOf(
    "ticket claim",
    "ticket을 claim한다(base_revision은 show의 revision)",
  ),
  entryOf("ticket renew", "claim 기한을 늘린다"),
  entryOf("ticket report", "summary 본문을 올리고 완료를 보고한다", {
    run: (input, ctx) =>
      ctx.client === undefined
        ? Promise.resolve(err(noToken()))
        : reportTicket(ctx.client, input, ctx.idempotencyKey),
  }),
];
