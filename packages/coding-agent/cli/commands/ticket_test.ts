// ticket command 표 테스트다(T20, cli#R36, R41). list·show·checks가 소유 read
// route로 연결되는지, `ticket claim`이 route 없는 안내 entry인지(claim을 만들지
// 않는다), renew·release·report가 같은 흐름으로 실행되는지, create·cancel이 사람 전용인지
// 본다. core에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { err, ok, sha256Hex } from "../../../base/mod.ts";
import { runTicketWrite, TICKET_COMMANDS, ticketHumanOnly } from "./ticket.ts";
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
  "coding-agent/cli#R36 #R37: ticket command 9개는 registry 표에 이름 그대로 있고 create·cancel만 route가 없는 사람 전용이다",
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
        "ticket create",
        "ticket cancel",
      ]
    ) {
      assertEquals(names.includes(name), true);
    }
    assertEquals(TICKET_COMMANDS.length, 9);
    assertEquals(entry("ticket create").monoRoute, undefined);
    assertEquals(entry("ticket cancel").monoRoute, undefined);
    // 목표 수정·공개·확인 판정·test result 작성 command는 표에 없다.
    for (
      const name of [
        "ticket update",
        "ticket edit",
        "ticket make-ready",
        "ticket publish",
        "ticket confirm",
        "ticket check",
        "ticket record-checks",
        "ticket test-result",
      ]
    ) {
      assertEquals(names.includes(name), false, name);
    }
  },
);

const TKT = "tkt_01h455vb4pex5v6nkc6gd5fdw1";
const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";

Deno.test(
  "coding-agent/cli#R37: ticket create·cancel은 같은 필수 입력 검사 뒤 결정 화면 링크로 넘기고 확인 창 없이 coding credential에는 거절이다",
  () => {
    const user = { actor: "user", connected: false } as const;
    const created = ticketHumanOnly("ticket create", { app: APP }, user);
    assert(created.ok);
    const data = created.value.data as Record<string, unknown>;
    assertEquals(data.decision_link, `lophn://things-to-confirm/${APP}`);
    assertEquals(data.confirmation_window, false);
    assertEquals(data.applied, false);
    const cancelled = ticketHumanOnly("ticket cancel", {
      ticket: TKT,
      base_revision: "4",
      reason: "더 이상 필요 없다",
    }, user);
    assert(cancelled.ok);
    const cancelData = cancelled.value.data as Record<string, unknown>;
    assertEquals(cancelData.decision_link, `lophn://things-to-confirm/${TKT}`);
    assertEquals(cancelData.reason, "더 이상 필요 없다");
    assertEquals(cancelData.confirmation_window, false);
    // 연결 참조로 시작한 context는 둘 다 실행 전 거절이다(--connection만 있어도 같다).
    for (
      const caller of [
        { actor: "coding_agent", connected: true },
        { actor: "user", connected: true },
      ] as const
    ) {
      for (const name of ["ticket create", "ticket cancel"] as const) {
        const refused = ticketHumanOnly(
          name,
          { app: APP, ticket: TKT },
          caller,
        );
        assert(!refused.ok);
        assertEquals(refused.error.code, "forbidden");
      }
    }
    // 같은 필수 입력 검사와 취소 사유다.
    assertEquals(
      entry("ticket cancel").input.safeParse({
        command: "ticket cancel",
        ticket: TKT,
        base_revision: "4",
      }).success,
      false,
    );
  },
);

type Sent = { method: string; input?: unknown; compare?: unknown };

function fakeDeps(sent: Sent[], failReport = false) {
  return {
    idempotencyKey: () => "key-1",
    client: {
      command(
        route: { method: string },
        body: { input: unknown; compare?: unknown },
      ) {
        sent.push({
          method: route.method,
          input: body.input,
          compare: body.compare,
        });
        if (route.method === "report_completion" && failReport) {
          return Promise.resolve(
            err({
              code: "conflict" as const,
              message: "claim이 유효하지 않다",
            }),
          );
        }
        return Promise.resolve(
          ok(
            route.method === "report_completion"
              ? { ticket: TKT, state: "reported", completion_seq: "9" }
              : { ticket: TKT, state: "open" },
          ),
        );
      },
      read(route: { method: string }, input: unknown) {
        sent.push({ method: route.method, input });
        return Promise.resolve(ok({
          ticket: { state: "reported", conditions: [] },
          checks: [],
        }));
      },
      async upload(
        route: { method: string },
        input: unknown,
        bytes: ReadableStream<Uint8Array>,
      ) {
        sent.push({ method: route.method, input });
        const read = new Uint8Array(await new Response(bytes).arrayBuffer());
        return ok({
          preparation: "prep-1",
          principal: "coding_agent:cac",
          purpose: "ticket_summary",
          hash: await sha256Hex(read),
          size_bytes: read.length,
        });
      },
    },
  };
}

Deno.test(
  "coding-agent/cli#R36: ticket report는 summary를 upload_summary로 올린 뒤 준비 참조로 보고하고 완료 단계를 따로 낸다",
  async () => {
    const sent: Sent[] = [];
    const output = await runTicketWrite("ticket report", {
      command: "ticket report",
      json: true,
      ticket: TKT,
      base_revision: "7",
      claim_seq: "3",
      release: REL,
      summary: "변경 요약",
    }, fakeDeps(sent) as never);
    assertEquals(sent.slice(0, 2).map((item) => item.method), [
      "upload_summary",
      "report_completion",
    ]);
    assertEquals(sent[1].compare, { base_revision: "7" });
    const input = sent[1].input as Record<string, unknown>;
    assertEquals("completion_seq" in input, false);
    const data = output.data as Record<string, Record<string, unknown>>;
    assertEquals(data.completion_claim.completion_seq, "9");
    assertEquals(data.report.accepted, true);
    assertEquals(data.check.state, "pending");
    assertEquals(output.isError, undefined);
  },
);

Deno.test(
  "coding-agent/cli#R36: 만료·취소 뒤 보고는 거절 결과이고 renew·release 호출이 따르지 않는다",
  async () => {
    const sent: Sent[] = [];
    const output = await runTicketWrite("ticket report", {
      ticket: TKT,
      base_revision: "7",
      claim_seq: "3",
      release: REL,
      summary: "변경 요약",
    }, fakeDeps(sent, true) as never);
    assertEquals(output.isError, true);
    assertEquals(
      (output.data as { report: { accepted: boolean } }).report.accepted,
      false,
    );
    assertEquals(sent.map((item) => item.method), [
      "upload_summary",
      "report_completion",
    ]);
    const released = await runTicketWrite("ticket release", {
      command: "ticket release",
      ticket: TKT,
      base_revision: "7",
      claim_seq: "3",
    }, fakeDeps(sent) as never);
    assertEquals(released.isError, undefined);
    assertEquals(sent.at(-1)?.method, "release_claim");
    assertEquals(sent.at(-1)?.input, {
      ticket: TKT,
      base_revision: "7",
      claim_seq: "3",
    });
  },
);
