// ticket command의 route 표와 실행이다(T20·T25, cli#R36, R37, R41). list·show·checks는 소유
// read route로 core에 닿는다. `ticket claim`은 MCP 연결·지정 ticket 안내로만 끝나고 claim을
// 만들지 않는다(cli#R41 — 외부 세션의 claim은 MCP로 수행한다). renew·release·report는 MCP
// `lophn_ticket`과 같은 소유 route·같은 흐름이다(connection/ticket-ops). report는 summary를
// 올린 준비 참조로 보내고 completion seq를 입력받지 않는다. 표가 기한이나 자동 갱신을 덧붙이지
// 않는다(mcp#R27). create·cancel은 사람 전용이다: CLI는 사람 credential을 읽지 않으므로
// 같은 필수 입력 검사만 하고 결정 화면 링크로 넘긴다(coding-agent 계획 질문 Q1). coding
// credential에는 이 둘도 목표 수정·공개·확인 판정·test result 작성도 없다(cli#R37).
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import {
  cliTicketCancelSchema,
  cliTicketChecksSchema,
  cliTicketClaimSchema,
  cliTicketCreateSchema,
  cliTicketListSchema,
  cliTicketReleaseSchema,
  cliTicketRenewSchema,
  cliTicketReportSchema,
  cliTicketShowSchema,
  decisionLink,
  ticketChecks,
  ticketList,
  ticketReleaseClaim,
  ticketRenewClaim,
  ticketReportCompletion,
  ticketShow,
} from "../../../contracts/coding-agent/mod.ts";
import {
  reportInputOf,
  reportTicket,
  ticketCompare,
  type TicketOpDeps,
  type TicketOpOutput,
} from "../../connection/mod.ts";
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
    monoRoute: ticketRenewClaim,
  },
  {
    name: "ticket release",
    input: cliTicketReleaseSchema,
    monoRoute: ticketReleaseClaim,
  },
  {
    name: "ticket report",
    input: cliTicketReportSchema,
    monoRoute: ticketReportCompletion,
  },
  // 사람 전용이라 route가 없다. 실행하지 않고 결정 화면 링크로 넘긴다(cli#R37).
  { name: "ticket create", input: cliTicketCreateSchema },
  { name: "ticket cancel", input: cliTicketCancelSchema },
];

// 공통 option(출력·연결·daemon·key·입력 source)은 route 입력이 아니다. `base_revision`은 소유
// 입력이라 남는다.
const COMMON_KEYS = new Set([
  "command",
  "json",
  "connection",
  "daemon_url",
  "app",
  "idempotency_key",
  "input",
  "input_file",
]);

function ownInput(input: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && !COMMON_KEYS.has(key)) body[key] = value;
  }
  return body;
}

export type TicketWriteName =
  | "ticket renew"
  | "ticket release"
  | "ticket report";

// renew·release·report의 실행이다. MCP와 같은 route·같은 입력·같은 CAS 비교를 쓴다.
export async function runTicketWrite(
  name: TicketWriteName,
  input: Record<string, unknown>,
  deps: TicketOpDeps,
): Promise<TicketOpOutput> {
  const body = ownInput(input);
  if (name === "ticket report") {
    return await reportTicket(reportInputOf(body), deps);
  }
  const route = name === "ticket renew" ? ticketRenewClaim : ticketReleaseClaim;
  const sent = await deps.client.command(route, {
    input: body,
    idempotency_key: deps.idempotencyKey(),
    compare: ticketCompare(body),
  });
  if (!sent.ok) {
    return {
      summary: sent.error.message,
      data: { code: sent.error.code, details: sent.error.details ?? {} },
      next: ["ticket show로 현재 상태를 다시 읽는다"],
      isError: true,
    };
  }
  const value = sent.value as { ticket?: string; state?: string };
  return {
    summary: name === "ticket renew"
      ? `renew ${value.ticket ?? "ticket"} claim`
      : `release ${value.ticket ?? "ticket"} → ${value.state ?? "open"}`,
    data: sent.value,
    next: ["ticket show로 현재 상태를 읽는다"],
  };
}

export type TicketHumanOnlyOutput = {
  summary: string;
  data: unknown;
  next: string[];
  isError?: true;
};

// 사람 전용 ticket 생성·취소다. coding credential(연결 참조로 시작한 context)은 실행 전 거절이다.
// 사람의 CLI는 core에 쓰지 않는다: 같은 필수 입력 검사를 이미 통과한 입력을 결정 화면 링크로
// 넘기고, 사람이 그 화면에서 누르면 확인 창 없이 적용된다(cli#R37). 이 호출은 아무것도 만들거나
// 취소하지 않았다.
export function ticketHumanOnly(
  name: "ticket create" | "ticket cancel",
  input: Record<string, unknown>,
  caller: { actor: "user" | "coding_agent"; connected: boolean },
): Result<TicketHumanOnlyOutput, LophnError> {
  if (caller.actor !== "user" || caller.connected) {
    return err({
      code: "forbidden",
      message: "이 command는 사람 전용이다",
    });
  }
  const target = String(name === "ticket create" ? input.app : input.ticket);
  const link = decisionLink(target);
  const common = {
    command: name,
    human_only: true,
    decision_link: link,
    confirmation_window: false,
    applied: false,
  };
  return ok({
    ...(name === "ticket create"
      ? {
        summary:
          "ticket 생성은 사람이 lophn 화면에서 한다. 이 호출은 아무것도 만들지 않았다",
        data: { ...common, app: target },
        next: [
          `사람이 ${link}에서 입력을 보고 만든다. 확인 창은 없고 만들면 바로 열린 상태로 읽힌다`,
        ],
      }
      : {
        summary:
          "ticket 취소는 사람이 lophn 화면에서 한다. 이 호출은 아무것도 취소하지 않았다",
        data: {
          ...common,
          ticket: target,
          base_revision: input.base_revision,
          reason: input.reason,
        },
        next: [
          `사람이 ${link}에서 사유를 보고 취소한다. 확인 창은 없다. 취소 뒤 옛 claim의 갱신·보고는 거절된다`,
        ],
      }),
    // 이 호출은 아무것도 적용하지 않았다(connection revoke 안내와 같다).
    isError: true,
  });
}
