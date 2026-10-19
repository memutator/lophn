// 세 질문
// - contract: boundary `app-tickets`·`coding-agent-cli-interface`(coding token은 앱 하나 범위이고 session이 끝나면 회수된다),
//   `external-coding-agent`(coding agent는 token + CLI로만 닿는다).
// - 현실적 회귀: 다른 앱의 ticket이나 앱을 token으로 읽거나 claim하는 것(앱 하나가 곧 격리 단위다), session이 끝났는데
//   token이 살아 있어 끝난 터미널이 계속 core를 쓰는 것, CLI 표가 바뀌어 token 범위가 어긋나는 것.
// - 왜 지금 test가 못 잡나: `tickets_test`·`coding_test`는 token 없이 actor 문자열을 직접 만들고, token 발급·회수는
//   Gateway frame -> shell 역할 -> CLI -> 서버 인증을 지나야 한다.
//
// 이 file의 `report-needs-claim-and-release` 행(coding-report-needs-release)은 거절 쪽만 본다.
// - contract: boundary `app-tickets`(완료 보고는 현재 유효한 claim과 그 claim으로 준비된 release가 있어야 접수한다), `coding-agent-cli-interface`.
// - 현실적 회귀: claim 없이 보고해 ticket이 `reported`가 되는 것, 준비한 적 없는 release id로 보고가 접수되는 것, 거절된 보고가 claim을 지워 일이 사라지는 것.
// - 왜 못 잡나: `tickets_test`는 command를 직접 불러 CLI의 summary upload -> `report_completion` 순서와 claim을 쥔 token의 경로를 지나지 않는다.
// 접수되는 쪽은 여기서 돌리지 않는다: release가 있으려면 준비(build)와 app test를 지나야 해서 `app-release`가 맡는다.
//
// `unclaimed-end`·`claimed-end` 행(coding-end-without-report)은 완료 보고 없이 터미널 process가 끝나는 두 길을 본다.
// - contract: boundary `app-tickets`·`router`(끝나는 길마다 call은 한 번만 닫히고 맡긴 Project Manager는 같은 사실을 한 번만 받는다),
//   `external-coding-agent`(session의 끝은 터미널 process의 exit으로만 안다).
// - 현실적 회귀: 보고 없이 끝난 session의 call이 `accepted`로 영영 남아 ticket이 잠기는 것, 같은 끝을 Project Manager가 두 번 받아
//   두 번 반응하는 것(Router와 Reactor가 모두 알리는 경우), claim이 반납되지 않아 같은 ticket을 다시 맡길 수 없는 것.
// - 왜 못 잡나: `apps/tickets/coding` 단위 test는 event와 command를 직접 부르고, shell 역할의 `exited`에서 Reactor, Router,
//   Project Manager의 새 turn까지 process를 건너는 흐름은 E2E에 없다.
//
// `open-session`·`closed-session` 행(coding-message-to-ae)은 coding agent의 막힘이 맡긴 Project Manager에게 가는 두 길을 본다.
// - contract: boundary `router`·`app-tickets`·`coding-agent-cli-interface`(coding agent의 막힘은 맡긴 Project Manager에게 가고,
//   닫혀 있으면 그 앱의 새 session이 받는다), `agent-sessions`.
// - 현실적 회귀: archive된 session이 메시지를 삼켜 막힘이 아무에게도 안 가는 것, 새 session을 열지 않고 오류로 끝나는 것,
//   메시지가 맡긴 call을 닫아 대화가 끊기는 것.
// - 왜 못 잡나: `apps/tickets/coding` 단위 test와 Router unit은 `open_session_or_new`의 풀기를 따로 본다. CLI token ->
//   `send_message` route -> Router -> 새 Project Manager session의 turn까지 이어지는 길은 process를 건너야 한다.
//
// `queue-then-open` 행(coding-one-per-app)은 같은 앱의 둘째 맡기기가 줄에 섰다가 앞 session이 끝나면 열리는 것을 본다.
// - contract: boundary `app-tickets`·`router`(앱 하나에 coding session은 하나이고 나머지는 줄에 선다), `external-coding-agent`.
// - 현실적 회귀: 같은 source 폴더에 coding session 둘이 동시에 뜨는 것(서로 부딪친다), 줄에 선 call이 앞 session이 끝나도
//   열리지 않아 영영 `accepted`로 남는 것, 줄에서 열린 session이 앞 session의 token을 물려받는 것.
// - 왜 못 잡나: `apps/tickets/coding` 단위 test는 transport를 직접 부르고, 두 session의 token과 터미널 요청(Gateway frame)이
//   서로 다른지는 shell 역할과 CLI를 지나야 보인다.
//
// `cancel-claimed` 행(coding-cancel-keeps-ticket)은 사람이 맡긴 call을 cancel하는 길을 본다.
// - contract: boundary `app-tickets`·`router`(call cancel은 session을 멈추고 token을 회수하되 ticket은 열어 둔다),
//   `external-coding-agent`(멈춤은 shell main에 터미널 요청으로 간다).
// - 현실적 회귀: call cancel이 ticket까지 닫아 사람이 다시 맡길 수 없게 되는 것, cancel 뒤에도 token이 살아 있어 멈추는 중인
//   터미널이 core를 계속 쓰는 것, 멈춘 session의 claim이 풀리지 않아 ticket이 `claimed`로 잠기는 것(1시간 뒤에야 만료).
// - 왜 못 잡나: `apps/tickets/coding`과 Router 단위 test는 transport와 Router를 따로 본다. cancel -> `stop` frame ->
//   shell 역할의 끝 알림 -> claim 반납까지 이어지는 길은 process를 건너야 한다.
//
// 마지막 단계(coding-token-not-stored)는 행이 아니라 모든 행이 끝난 뒤 core를 정상 종료하고 data root와 log를 훑는다.
// - contract: boundary `app-tickets`·`external-coding-agent`·`secrets`(token 원문은 저장하지 않는다. 새면 그 앱 하나가 열린다).
// - 현실적 회귀: 디버깅하려고 plan이나 오류에 token을 넣어 ledger·log에 남는 것, session 행에 env를 통째로 저장하는 것,
//   오류 본문에 요청 header가 되울리는 것.
// - 왜 못 잡나: unit은 그 module이 만든 값만 본다. token은 registry 메모리에만 있어서, 실제 core가 돈 뒤 SQLite·WAL·blob·log를
//   byte로 훑는 이 단계가 유일한 방어다.
//
// fake 대답: Project Manager의 ticket_create·call 대답은 맡기기 helper(`handOff`·`createTicket`)가 거는 것이라 행의 fake
// 대답 상한(3)에 세지 않는다(README 정한 것 11).
//
// 이 file은 coding 길 E2E 전체의 틀이다: core 하나에 ROWS table의 행이 차례로 돈다. 행은 앱을 새로 만든다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  agentSessionList,
  agentSessionRead,
  archiveSession,
  callCancel,
  callRead,
  receivedMessageList,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { CODING_TOKEN_ENV } from "../../packages/protocol/coding-agent/mod.ts";
import { ticketShow } from "../../packages/protocol/coding-agent/ticket/mod.ts";
import {
  aeLane,
  handOff,
  startTestApp,
  type TestApp,
} from "../support/app/activate.ts";
import { codingCli } from "../support/coding/cli.ts";
import { createTicket, handOffQueued } from "../support/coding/hand-off.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  until,
  waitTurnEnd,
} from "../support/core/human.ts";
import {
  type FakeServer,
  startFakeServer,
} from "../support/fake-server/mod.ts";
import { lastUserText } from "../support/fake-server/probe.ts";
import { answerTerminal, exitTerminal } from "../support/gateway/shell.ts";

type Ctx = {
  core: Core;
  fake: FakeServer;
  /** 맡기기로 받은 coding token 전부. `coding-token-not-stored`가 마지막에 쓴다. */
  tokens: string[];
  app(name: string): Promise<TestApp>;
  handOff(app: TestApp, options?: { goal?: string }): Promise<
    Awaited<ReturnType<typeof handOff>> & { cli: ReturnType<typeof codingCli> }
  >;
};

type Row = { name: string; run(ctx: Ctx): Promise<void> };

function includesBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  const first = needle[0];
  for (
    let at = haystack.indexOf(first);
    at !== -1 && at + needle.length <= haystack.length;
    at = haystack.indexOf(first, at + 1)
  ) {
    let i = 1;
    while (i < needle.length && haystack[at + i] === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}

// token 원문이 든 일반 file의 "경로: token 앞 6글자"만 모은다. 원문은 실패 메시지에도 쓰지 않는다.
async function tokenLeaks(
  roots: string[],
  tokens: string[],
): Promise<{ leaks: string[]; files: number }> {
  const needles = tokens.map((token) => ({
    head: token.slice(0, 6),
    bytes: new TextEncoder().encode(token),
  }));
  const leaks: string[] = [];
  let files = 0;
  async function visit(path: string): Promise<void> {
    const info = await Deno.lstat(path);
    if (info.isDirectory) {
      for await (const entry of Deno.readDir(path)) {
        await visit(`${path}/${entry.name}`);
      }
    } else if (info.isFile) {
      files++;
      const data = await Deno.readFile(path);
      for (const needle of needles) {
        if (includesBytes(data, needle.bytes)) {
          leaks.push(`${path}: ${needle.head}...`);
        }
      }
    }
  }
  for (const root of roots) await visit(root);
  return { leaks, files };
}

function errorCode(result: { value: unknown }): unknown {
  return (result.value as { error?: { code?: unknown } } | undefined)?.error
    ?.code;
}

// 보고 없이 끝난 뒤의 세 곳: call은 receiver_ended로 닫히고, 맡긴 AE는 program 입력을 정확히 하나 받고, ticket은 반납되어 열려 있다.
async function expectEndedUnreported(
  core: Core,
  app: TestApp,
  started: { ticket: string; call: string },
  refs: Record<string, unknown>[],
): Promise<void> {
  // route(user): ledger
  const call = (await core.call(callRead, { call: started.call })).call;
  assertEquals(call.state, "failed");
  assertEquals(call.fail_reason, "receiver_ended");
  // route(user): inbox. 같은 끝을 한 번만 알렸다.
  const programs = (await core.call(receivedMessageList, { session: app.ae }))
    .messages.filter((message) => message.from.kind === "program");
  assertEquals(programs.length, 1);
  for (const want of refs) {
    assert(
      programs[0].refs.some((ref) =>
        Object.entries(want).every(([key, value]) =>
          (ref as Record<string, unknown>)[key] === value
        )
      ),
    );
  }
  // route(user): ticket
  const ticket = (await core.call(ticketShow, { ticket: started.ticket }))
    .ticket;
  assertEquals(ticket.state, "open");
  assertEquals(ticket.claim, null);
}

// coding agent가 보낸 입력만 모은다.
async function fromCoding(core: Core, session: string) {
  return (await core.call(receivedMessageList, { session })).messages
    .filter((message) => message.from.kind === "coding_agent");
}

const ROWS: Row[] = [
  {
    name: "other-app",
    async run(ctx) {
      const { core, fake } = ctx;
      const a = await ctx.app("scope-a");
      const b = await ctx.app("scope-b");
      const goal = "Secret goal of the other app";
      const other = await createTicket(core, fake, b, { goal });
      const { cli, ticket } = await ctx.handOff(a);

      const shown = await core.call(ticketShow, { ticket: other });
      const denied = [
        await cli.run("ticket show", { ticket: other }),
        await cli.run("ticket claim", {
          ticket: other,
          base_revision: shown.ticket.revision,
        }),
        await cli.run("app show", { app: b.app }),
      ];
      // CLI: 다른 앱은 읽을 수도 claim할 수도 없다.
      for (const result of denied) {
        assertNotEquals(result.code, 0);
        assert(
          ["forbidden", "not_found"].includes(errorCode(result) as string),
          JSON.stringify(result.value),
        );
        assert(!JSON.stringify(result.value).includes(goal));
      }
      // CLI: 같은 token의 자기 앱 ticket은 읽힌다(위 실패가 token이 통하지 않아서가 아니다).
      assertEquals((await cli.run("ticket show", { ticket })).code, 0);
      // route(user): B의 ticket은 그대로 열려 있다.
      const after = (await core.call(ticketShow, { ticket: other })).ticket;
      assertEquals(after.state, "open");
      assertEquals(after.claim, null);
    },
  },
  {
    name: "after-exit",
    async run(ctx) {
      const { core } = ctx;
      const a = await ctx.app("scope-exit");
      const { cli, ticket, terminal } = await ctx.handOff(a);
      // CLI: 끝내기 전에는 통한다.
      assertEquals((await cli.run("ticket list")).code, 0);

      // session을 끝내면 call이 닫히며 Project Manager에게 reaction turn이 하나 더 돈다(맡기기 helper가 건 대답이 받는다).
      await exitTerminal(core, terminal);
      await waitTurnEnd(core, a.ae, 1);

      // CLI: 끝난 뒤 같은 token의 호출은 모두 unauthorized다.
      for (
        const result of [
          await cli.run("ticket list"),
          await cli.run("ticket show", { ticket }),
        ]
      ) {
        assertEquals(errorCode(result), "unauthorized");
        assertEquals(result.code, 3);
      }
    },
  },
  {
    name: "report-needs-claim-and-release",
    async run(ctx) {
      const { core } = ctx;
      const app = await ctx.app("report-gate");
      const { cli, ticket } = await ctx.handOff(app);
      const shown = await cli.run("ticket show", { ticket });
      const base = (shown.value as { ticket: { revision: string } }).ticket
        .revision;
      const release = core.ids.newId("rel");
      const report = (revision: string, claimSeq: string) =>
        cli.run("ticket report", {
          ticket,
          base_revision: revision,
          claim_seq: claimSeq,
          release,
          summary: "done",
        });

      // CLI: claim 없는 보고는 거절된다.
      assertEquals(errorCode(await report(base, "1")), "conflict");
      // CLI: claim이 있어도 준비된 적 없는 release면 거절된다.
      const claimed = await cli.run("ticket claim", {
        ticket,
        base_revision: base,
      });
      const seq = (claimed.value as { claim_seq: string }).claim_seq;
      assertEquals(errorCode(await report(seq, seq)), "not_found");
      // route(user): 거절된 보고는 claim도 ticket도 건드리지 않았다.
      const after = (await core.call(ticketShow, { ticket })).ticket;
      assertEquals(after.state, "claimed");
      assertEquals(after.completion, null);
      assertNotEquals(after.claim, null);
    },
  },
  {
    // claim이 없으면 endSession이 같은 tx에서 call을 닫고 알린다.
    name: "unclaimed-end",
    async run(ctx) {
      const { core, fake } = ctx;
      const app = await ctx.app("end-unclaimed");
      const started = await ctx.handOff(app);
      fake.script([{ reply: { kind: "text", text: "noted" } }], aeLane(app));

      await exitTerminal(core, started.terminal);
      await waitTurnEnd(core, app.ae, 1);
      // 같은 끝을 shell이 한 번 더 알려도 알림은 늘지 않는다.
      await exitTerminal(core, started.terminal);
      await expectEndedUnreported(core, app, started, [
        { kind: "ticket", ticket: started.ticket },
      ]);
    },
  },
  {
    // claim이 있으면 settle이 CodingSessionEndedUnreported를 내고 Reactor가 나중에 닫는다.
    name: "claimed-end",
    async run(ctx) {
      const { core, fake } = ctx;
      const app = await ctx.app("end-claimed");
      const started = await ctx.handOff(app);
      const { cli, ticket } = started;
      const shown = await cli.run("ticket show", { ticket });
      const base = (shown.value as { ticket: { revision: string } }).ticket
        .revision;
      assertEquals(
        (await cli.run("ticket claim", { ticket, base_revision: base })).code,
        0,
      );
      fake.script([{ reply: { kind: "text", text: "noted" } }], aeLane(app));

      await exitTerminal(core, started.terminal);
      await waitTurnEnd(core, app.ae, 1);
      await expectEndedUnreported(core, app, started, [
        { kind: "ticket", ticket },
        { kind: "session", session: started.terminal },
      ]);
    },
  },
  {
    // 메시지는 맡긴 call을 닫지 않고 열린 Project Manager session의 입력이 된다.
    name: "open-session",
    async run(ctx) {
      const { core, fake } = ctx;
      const app = await ctx.app("message-open");
      const { cli, call, ticket, terminal } = await ctx.handOff(app);
      fake.script([{ reply: { kind: "text", text: "noted" } }], aeLane(app));

      const sent = await cli.run("message send", {
        body: "BLUEPRINT-MARK needs a new field",
      });
      assertEquals(sent.code, 0, JSON.stringify(sent.value));
      await waitTurnEnd(core, app.ae, 1);

      // fake: 둘째 turn이 메시지를 받았다.
      const last = fake.journal().filter((entry) =>
        entry.lane === aeLane(app).name
      ).at(-1)!;
      assert(lastUserText(last).includes("BLUEPRINT-MARK"));
      // route(user): inbox
      const received = await fromCoding(core, app.ae);
      assertEquals(received.length, 1);
      assertEquals(
        (received[0].from as { session?: string }).session,
        terminal,
      );
      assert(
        received[0].refs.some((ref) =>
          (ref as { kind: string; ticket?: string }).kind === "ticket" &&
          (ref as { ticket?: string }).ticket === ticket
        ),
      );
      // route(user): ledger
      assertEquals(
        (await core.call(callRead, { call })).call.state,
        "accepted",
      );
    },
  },
  {
    // 맡긴 session이 archive되어 있으면 그 앱의 새 Project Manager session이 받는다.
    name: "closed-session",
    async run(ctx) {
      const { core, fake } = ctx;
      const app = await ctx.app("message-closed");
      const { cli } = await ctx.handOff(app);
      const { session } = await core.call(agentSessionRead, {
        session: app.ae,
      });
      await core.call(archiveSession, { session: app.ae }, {
        state_seq: session.state_seq,
      });
      // 새 session의 요청에는 맡긴 때의 `App <id>:` 글이 없어 aeLane에 안 맞고 fallback 줄로 간다.
      fake.script([{ reply: { kind: "text", text: "noted" } }]);

      const sent = await cli.run("message send", {
        body: "BLUEPRINT-MARK needs a new field",
      });
      assertEquals(sent.code, 0, JSON.stringify(sent.value));
      const open = await until(
        "새 Project Manager session이 열림",
        async () => {
          const { sessions } = await core.call(agentSessionList, {
            agent: {
              role: "app_engineer",
              app: app.app,
            },
          });
          return sessions.length > 0 ? sessions : undefined;
        },
      );
      // route(user): 열린 session은 하나이고 옛 session은 archive에 남았다.
      assertEquals(open.length, 1);
      assertNotEquals(open[0].id, app.ae);
      assertEquals(open[0].lifecycle, "open");
      await waitTurnEnd(core, open[0].id, 0);

      // route(user): inbox
      assertEquals((await fromCoding(core, open[0].id)).length, 1);
      assertEquals((await fromCoding(core, app.ae)).length, 0);
      // fake: 새 session의 turn이 메시지를 받았다.
      assert(lastUserText(fake.journal().at(-1)!).includes("BLUEPRINT-MARK"));
    },
  },
  {
    // 앞 session이 도는 동안 둘째 맡기기는 받는 session 없이 줄에 서고, 앞 session의 끝이 줄 맨 앞을 새 session으로 연다.
    name: "queue-then-open",
    async run(ctx) {
      const { core, fake } = ctx;
      const app = await ctx.app("one-per-app");
      const first = await ctx.handOff(app);
      const queued = await handOffQueued(core, fake, app);
      assertNotEquals(queued.call, first.call);

      // route(user): ledger. 줄에 선 call은 받는 session이 없고 터미널 요청도 나가지 않았다.
      const waiting = (await core.call(callRead, { call: queued.call })).call;
      assertEquals(waiting.state, "accepted");
      assertEquals(waiting.receiver_session, null);
      assertEquals(
        app.gateway.frames().filter((frame) =>
          frame.type === "coding_terminal" && frame.request.kind === "open"
        ).length,
        1,
      );

      // 앞 session을 끝내면 그 call이 닫히며 Project Manager에게 reaction turn이 하나 더 돈다.
      fake.script([{ reply: { kind: "text", text: "noted" } }], aeLane(app));
      await exitTerminal(core, first.terminal);
      const frame = await app.gateway.next(
        "coding_terminal",
        (item) =>
          item.request.kind === "open" &&
          item.request.plan.ticket === queued.ticket,
      );
      if (frame.request.kind !== "open") throw new Error("open 요청이 아니다");
      const plan = frame.request.plan;
      await answerTerminal(core, frame.request.request);
      await waitTurnEnd(core, app.ae, 2);

      // gateway: 새 session, 새 token, 둘째 ticket을 가리키는 첫 prompt. 줄에 섰던 call이 그 session을 받는다.
      assertNotEquals(plan.session, first.terminal);
      assertNotEquals(plan.env[CODING_TOKEN_ENV], first.token);
      assert(plan.first_prompt.includes(queued.ticket));
      assertEquals(
        (await core.call(callRead, { call: queued.call })).call
          .receiver_session,
        plan.session,
      );
      // CLI: 앞 token은 회수되었고 새 token은 둘째 ticket을 읽는다.
      const second = codingCli(core, plan.env[CODING_TOKEN_ENV]);
      ctx.tokens.push(plan.env[CODING_TOKEN_ENV]);
      assertEquals(
        errorCode(
          await first.cli.run("ticket show", { ticket: queued.ticket }),
        ),
        "unauthorized",
      );
      assertEquals(
        (await second.run("ticket show", { ticket: queued.ticket })).code,
        0,
      );
    },
  },
  {
    // call cancel은 session을 멈추고(stop 요청) token을 회수하며, 끝이 알려지면 claim이 풀려 ticket은 열려 있다.
    name: "cancel-claimed",
    async run(ctx) {
      const { core } = ctx;
      const app = await ctx.app("cancel-claimed");
      const { cli, call, ticket, terminal } = await ctx.handOff(app);
      const shown = await cli.run("ticket show", { ticket });
      const base = (shown.value as { ticket: { revision: string } }).ticket
        .revision;
      assertEquals(
        (await cli.run("ticket claim", { ticket, base_revision: base })).code,
        0,
      );

      assertEquals(
        (await core.call(callCancel, { call })).state,
        "cancelled",
      );
      // CLI: 회수는 cancel과 같은 commit이라 응답 직후 같은 token은 통하지 않는다.
      assertEquals(
        errorCode(await cli.run("ticket show", { ticket })),
        "unauthorized",
      );
      // gateway: 그 session의 stop 요청이 shell로 간다.
      await app.gateway.next(
        "coding_terminal",
        (frame) =>
          frame.request.kind === "stop" && frame.request.session === terminal,
      );

      // shell이 process를 죽이고 끝을 알린다. claim은 이때 반납된다.
      await exitTerminal(core, terminal, "killed");
      // route(user): ledger. ticket은 다시 맡길 수 있게 열려 있고 call은 failed가 아니라 cancelled다.
      const after = (await core.call(ticketShow, { ticket })).ticket;
      assertEquals(after.state, "open");
      assertEquals(after.claim, null);
      assertEquals(
        (await core.call(callRead, { call })).call.state,
        "cancelled",
      );
    },
  },
];

Deno.test("E2E coding token은 앱 하나 범위이고 session이 끝나면 회수된다", async (t) => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  const apps: TestApp[] = [];
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const booted = core;
    const tokens: string[] = [];
    const ctx: Ctx = {
      core: booted,
      fake,
      tokens,
      async app(name) {
        const app = await startTestApp(booted, fake, { name, slug: name });
        apps.push(app);
        return app;
      },
      async handOff(app, options) {
        const handed = await handOff(booted, fake, app, options);
        tokens.push(handed.token);
        return { ...handed, cli: codingCli(booted, handed.token) };
      },
    };
    // event 연결은 principal당 4개라 행이 끝나면 그 행의 앱 gateway를 닫는다.
    for (const row of ROWS) {
      const from = apps.length;
      await t.step(row.name, async () => {
        try {
          await row.run(ctx);
        } finally {
          for (const app of apps.slice(from)) await app.gateway.close();
        }
      });
    }

    // 마지막 단계: 정상 종료로 WAL이 본 file에 접힌 뒤 data root 전체와 log에서 token 원문을 찾는다.
    await t.step("token-not-stored", async () => {
      await booted.stop();
      // guard: 빈 훑기로 통과하지 않게
      assert(tokens.length >= 2);
      assertEquals(new Set(tokens).size, tokens.length);
      // disk: data root 전체와 core.log
      const { leaks, files } = await tokenLeaks(
        [run.home, booted.logPath],
        tokens,
      );
      assert(files > 1);
      assertEquals(leaks, []);
    });
  } finally {
    for (const app of apps) await app.gateway.close();
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
