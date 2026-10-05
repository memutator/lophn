// ticket command의 route 표다(T20, cli#R36, R41). list·show·checks는 소유
// read route로 core에 닿는다. `ticket claim`은 MCP 연결·지정 ticket 안내로만
// 끝나고 claim을 만들지 않는다(cli#R41 — 외부 세션의 claim은 MCP로 수행한다).
// renew·release·report는 대응 contract 입력을 그대로 쓴다. connection·claim_seq는
// caller가 명시해야 하며 표가 기한이나 자동 갱신을 덧붙이지 않는다(mcp#R27).
// create·cancel은 사람 전용 통로로 이 표에 없다(cli#R37).
import {
  cliTicketChecksSchema,
  cliTicketClaimSchema,
  cliTicketListSchema,
  cliTicketReleaseSchema,
  cliTicketRenewSchema,
  cliTicketReportSchema,
  cliTicketShowSchema,
} from "../../../contracts/coding-agent/mod.ts";
import {
  ticketChecks,
  ticketList,
  ticketShow,
} from "../../../contracts/coding-agent/mod.ts";
import type { CommandEntry } from "./types.ts";

export const TICKET_COMMANDS: readonly CommandEntry[] = [
  {
    name: "ticket list",
    input: cliTicketListSchema,
    monoRoute: ticketList,
  },
  {
    name: "ticket show",
    input: cliTicketShowSchema,
    monoRoute: ticketShow,
  },
  {
    name: "ticket checks",
    input: cliTicketChecksSchema,
    monoRoute: ticketChecks,
  },
  {
    // claim은 실행하지 않는다. MCP 연결·지정 ticket 안내로 끝난다(cli#R41).
    // route가 없으므로 표 밖 op와 같은 실행 전 거절이다(types.ts).
    name: "ticket claim",
    input: cliTicketClaimSchema,
  },
  {
    name: "ticket renew",
    input: cliTicketRenewSchema,
  },
  {
    name: "ticket release",
    input: cliTicketReleaseSchema,
  },
  {
    name: "ticket report",
    input: cliTicketReportSchema,
  },
];
