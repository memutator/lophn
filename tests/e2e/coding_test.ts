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
// fake 대답: App Engineer의 ticket_create·call 대답은 맡기기 helper(`handOff`·`createTicket`)가 거는 것이라 행의 fake
// 대답 상한(3)에 세지 않는다(README 정한 것 11).
//
// 이 file은 coding 길 E2E 전체의 틀이다: core 하나에 ROWS table의 행이 차례로 돈다. 행은 앱을 새로 만든다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { ticketShow } from "../../packages/protocol/coding-agent/ticket/mod.ts";
import {
  handOff,
  startTestApp,
  type TestApp,
} from "../support/app/activate.ts";
import { codingCli } from "../support/coding/cli.ts";
import { createTicket } from "../support/coding/hand-off.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import { connectFakeProvider, waitTurnEnd } from "../support/core/human.ts";
import {
  type FakeServer,
  startFakeServer,
} from "../support/fake-server/mod.ts";
import { exitTerminal } from "../support/gateway/shell.ts";

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

function errorCode(result: { value: unknown }): unknown {
  return (result.value as { error?: { code?: unknown } } | undefined)?.error
    ?.code;
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

      // session을 끝내면 call이 닫히며 App Engineer에게 reaction turn이 하나 더 돈다(맡기기 helper가 건 대답이 받는다).
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
    for (const row of ROWS) await t.step(row.name, () => row.run(ctx));
  } finally {
    for (const app of apps) await app.gateway.close();
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
