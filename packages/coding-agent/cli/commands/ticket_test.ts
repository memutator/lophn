// ticket command 표 테스트다(T20, cli#R36, R41). list·show·checks가 소유 read
// route로 연결되는지, `ticket claim`이 route 없는 안내 entry인지(claim을 만들지
// 않는다), renew·release·report가 대응 contract 입력을 쓰는지 본다. core에 닿지
// 않는다.
import { assertEquals } from "@std/assert";
import { TICKET_COMMANDS } from "./ticket.ts";
import { COMMANDS, findCommand } from "../registry.ts";

function entry(name: string) {
  const found = findCommand(name);
  if (!found) throw new Error(name);
  return found;
}

Deno.test(
  "coding-agent/cli#R36: ticket list·show·checks는 소유 read route로 등록한다",
  () => {
    const list = entry("ticket list");
    assertEquals(list.monoRoute?.resource, "tickets");
    assertEquals(list.monoRoute?.method, "list");
    assertEquals(list.monoRoute?.name, "ListTickets");
    const show = entry("ticket show");
    assertEquals(show.monoRoute?.method, "show");
    assertEquals(show.monoRoute?.name, "ShowTicket");
    const checks = entry("ticket checks");
    assertEquals(checks.monoRoute?.method, "checks");
    assertEquals(checks.monoRoute?.name, "TicketChecks");
    // 세 read는 모두 읽기 route다(dispatch는 POST만 상관 없다).
    for (const read of [list, show, checks]) {
      assertEquals((read.monoRoute as { kind: string }).kind, "read");
    }
  },
);

Deno.test(
  "coding-agent/cli#R41: ticket claim은 route가 없고 claim을 만들지 않는다",
  () => {
    const claim = entry("ticket claim");
    // route가 없다. claim을 만들지 않고 MCP 연결·지정 ticket 안내로 끝난다.
    assertEquals(claim.monoRoute, undefined);
    assertEquals(claim.opRoutes, undefined);
    // 입력은 ticket 하나뿐이다. base_revision 등 쓰기 입력을 받지 않는다.
    const checked = claim.input.safeParse({
      command: "ticket claim",
      ticket: "tkt_01h455vb4pex5v6nkc6gd5fdw1",
      json: true,
    });
    assertEquals(checked.success, true);
    const extra = claim.input.safeParse({
      command: "ticket claim",
      ticket: "tkt_01h455vb4pex5v6nkc6gd5fdw1",
      base_revision: "12",
    });
    assertEquals(extra.success, false);
  },
);

Deno.test(
  "coding-agent/cli#R36: ticket 7개 command는 registry 표에 이름 그대로 있다",
  () => {
    const names = COMMANDS.map((command) => command.name);
    for (
      const name of [
        "ticket list",
        "ticket show",
        "ticket checks",
        "ticket claim",
        "ticket renew",
        "ticket release",
        "ticket report",
      ]
    ) {
      assertEquals(names.includes(name), true);
    }
    // create·cancel은 사람 전용 통로다(cli#R37).
    assertEquals(names.includes("ticket create"), false);
    assertEquals(names.includes("ticket cancel"), false);
    assertEquals(TICKET_COMMANDS.length, 7);
  },
);
