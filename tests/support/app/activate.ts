// test용 앱을 제품의 길로 activate하는 준비다: apps/create → apps/connect_source → App Engineer의 ticket →
// coding agent(CLI)의 claim·release 준비·app test·보고 → ticket.verify → 사람의 activation 허락 → 앱 process.
// data root에 release를 직접 깔지 않는다. coding token은 Gateway `coding_terminal` frame으로만 받는다.
//
// App Engineer의 fake 대답은 session 하나의 줄(lane)로 건다. 줄은 요청의 tool 목록에 `ticket_create`가 있고 본문에
// 이 앱의 사람 메시지(`App <id>:`)가 있는 요청이 받는다. 앱 id만으로 가르면 다른 앱의 id를 싣는 prompt와 섞인다.
import { assertEquals } from "@std/assert";
import { releasesListRecords } from "../../../packages/protocol/apps/activation/activation.ts";
import {
  agentGrantsSet,
  approvalsDecide,
  approvalsPending,
} from "../../../packages/protocol/approvals/mod.ts";
import {
  appConnectSource,
  appCreate,
  appGet,
  appRuntime,
  type RuntimeObservation,
} from "../../../packages/protocol/apps/mod.ts";
import { ticketShow } from "../../../packages/protocol/coding-agent/ticket/mod.ts";
import { codingCli } from "../coding/cli.ts";
import type { Core } from "../core/mod.ts";
import { runtimePids } from "../core/process.ts";
import {
  openSession,
  say,
  settle,
  turnsOf,
  until,
  waitTurnEnd,
} from "../core/human.ts";
import type { FakeServer, JournalEntry } from "../fake-server/mod.ts";
import { idIn, lastToolResult, toolNames } from "../fake-server/probe.ts";
import { connectGateway, type Gateway } from "../gateway/mod.ts";
import {
  answerTerminal,
  exitTerminal,
  reportHarness,
  waitCodingTerminal,
} from "../gateway/shell.ts";
import { type AppPatch, createAppSource } from "./source.ts";

export type TestApp = {
  app: string;
  slug: string;
  name: string;
  source: string;
  commit: string;
  ae: string;
  gateway: Gateway;
};

// 기다리다 실패하면 무엇을 기다렸는지에 더해 그때의 ticket·release·runtime 상태를 담는다.
async function explaining<T>(
  describe: () => Promise<string>,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message} [${await describe().catch(() => "상태를 읽지 못함")}]`,
    );
  }
}

async function stateOf(core: Core, ticket: string): Promise<string> {
  return `ticket ${ticket}: ${
    (await core.call(ticketShow, { ticket })).ticket.state
  }`;
}

async function appStateOf(core: Core, app: string): Promise<string> {
  const releases = await core.call(releasesListRecords, { app });
  const runtime = await core.call(appRuntime, { app });
  return `release: ${
    releases.releases.map((item) => item.status).join(",") || "없음"
  }, runtime: ${runtime.state.state}`;
}

// 앱의 revision은 CAS 값이다.
async function revisionOf(core: Core, app: string): Promise<string> {
  return (await core.call(appGet, { app })).app.revision;
}

export async function startTestApp(
  core: Core,
  _fake: FakeServer,
  options: { name: string; slug: string; patch?: AppPatch },
): Promise<TestApp> {
  const created = await core.call(appCreate, {
    slug: options.slug,
    name: options.name,
    description: `E2E app ${options.slug}`,
  });
  const source = await createAppSource(core, {
    slug: options.slug,
    title: options.name,
    ...(options.patch === undefined ? {} : { patch: options.patch }),
  });
  // source 폴더는 AE의 place 폴더라, 연결하면 core가 1초 polling으로 agent runtime child를 새 권한으로 다시 띄운다.
  // 그 사이 시작한 turn은 끊기므로 새 child가 ready가 될 때까지 기다린다.
  const before = await runtimePids(core.run.home);
  await core.call(
    appConnectSource,
    { app: created.id, source_path: source.dir },
    { base_revision: await revisionOf(core, created.id) },
  );
  if (before.length > 0) await settle(core, before);
  // 이 grant 줄이 없으면 AE의 call이 not_allowed다.
  await core.call(agentGrantsSet, {
    agent: { role: "app_engineer", app: created.id },
    entries: [{
      kind: "agent",
      agent: { role: "coding_agent", app: created.id },
      setting: "never",
    }],
  });
  const gateway = await connectGateway(core);
  await reportHarness(core);
  const ae = await openSession(core, {
    role: "app_engineer",
    app: created.id,
  });
  return {
    app: created.id,
    slug: options.slug,
    name: options.name,
    source: source.dir,
    commit: source.commit,
    ae,
    gateway,
  };
}

export function aeLane(app: TestApp) {
  return {
    name: `ae-${app.app}`,
    match: (request: JournalEntry) =>
      toolNames(request).includes("ticket_create") &&
      JSON.stringify(request.body).includes(`App ${app.app}:`),
  };
}

export const tool = (id: string, name: string, args: unknown) => ({
  kind: "tool" as const,
  calls: [{ id, name, arguments: JSON.stringify(args) }],
});

// 알림 turn의 요청은 앞 tool 결과를 줄여 싣는다. 그래서 ticket id는 앞선 요청의 tool 결과에서 읽는다.
function ticketIn(
  journal: readonly JournalEntry[],
  lane: string,
  createId: string,
): string {
  const ticket = idIn(
    journal.filter((entry) => entry.lane === lane).map((entry) =>
      lastToolResult(entry, createId) ?? ""
    ).join(" "),
    "tkt",
  );
  if (ticket === undefined) {
    throw new Error("ticket_create 결과에 ticket id가 없다");
  }
  return ticket;
}

// AE가 ticket을 만들어 coding agent에게 call하고(①②③) 끝에 `tail`로 이어지는 줄을 건다.
// tool call id는 같은 session의 맡기기마다 달라야 한다(`call`의 dedup과 `ticket_create`의 idempotency key).
function scriptAe(
  fake: FakeServer,
  app: TestApp,
  goal: string,
  tail: "verify" | "text",
  ids: { create: string; call: string } = {
    create: "tc_create",
    call: "tc_call",
  },
): void {
  const made = (request: JournalEntry) => {
    const ticket = idIn(lastToolResult(request) ?? "", "tkt");
    if (ticket === undefined) {
      throw new Error("ticket_create 결과에 ticket id가 없다");
    }
    return ticket;
  };
  fake.script([
    {
      reply: tool(ids.create, "ticket_create", {
        app: app.app,
        goal,
        check: { kind: "text", text: "the work is done" },
      }),
    },
    {
      reply: (request) =>
        tool(ids.call, "call", {
          to: { role: "coding_agent", place: { app: app.name } },
          reply: "none",
          body: goal,
          refs: [{ kind: "ticket", ticket: made(request) }],
          options: { harness: "claude" },
        }),
    },
    { reply: { kind: "text", text: "handed over" } },
    ...(tail === "verify"
      ? [
        {
          reply: (_request: JournalEntry, journal: readonly JournalEntry[]) =>
            tool("tc_verify", "ticket_verify", {
              ticket: ticketIn(journal, aeLane(app).name, ids.create),
              result: "verified",
            }),
        },
        { reply: { kind: "text" as const, text: "verified" } },
      ]
      : [
        { reply: { kind: "text" as const, text: "noted" } },
        { reply: { kind: "text" as const, text: "noted" } },
      ]),
  ], aeLane(app));
}

async function aeHandOff(
  core: Core,
  fake: FakeServer,
  app: TestApp,
  goal: string,
  tail: "verify" | "text",
) {
  scriptAe(fake, app, goal, tail);
  const turn = (await turnsOf(core, app.ae)).length;
  await say(core, app.ae, `App ${app.app}: ${goal}`);
  const opened = await explaining(
    async () =>
      `AE turn ${turn} 상태: ${
        (await turnsOf(core, app.ae))[turn]?.state ?? "없음"
      }, fake 요청 ${fake.journal().length}개, ${await appStateOf(
        core,
        app.app,
      )}`,
    async () => {
      const found = await waitCodingTerminal(app.gateway);
      await answerTerminal(core, found.request);
      await waitTurnEnd(core, app.ae, turn);
      return found;
    },
  );
  const lane = aeLane(app).name;
  const call = idIn(
    fake.journal().filter((entry) => entry.lane === lane).map((entry) =>
      lastToolResult(entry, "tc_call") ?? ""
    ).join(" "),
    "cal",
  );
  const token = opened.plan.env["LOPHN_CODING_TOKEN"];
  if (call === undefined || token === undefined) {
    throw new Error("call id나 coding token을 찾지 못했다");
  }
  return {
    turn,
    ticket: opened.plan.ticket,
    call,
    token,
    terminal: opened.plan.session,
  };
}

export async function handOff(
  core: Core,
  fake: FakeServer,
  app: TestApp,
  options: { goal?: string } = {},
): Promise<{ ticket: string; call: string; token: string; terminal: string }> {
  const { turn: _, ...handed } = await aeHandOff(
    core,
    fake,
    app,
    options.goal ?? "Add a short note to the app",
    "text",
  );
  return handed;
}

type CliResult = { code: number; value: unknown; stderr: string };

// CLI 실패를 단계 이름과 함께 던진다.
function must(step: string, result: CliResult): Record<string, unknown> {
  if (result.code !== 0) {
    throw new Error(
      `${step}: 종료 코드 ${result.code} ${
        JSON.stringify(result.value)
      } ${result.stderr}`,
    );
  }
  return result.value as Record<string, unknown>;
}

export async function deliverRelease(
  core: Core,
  fake: FakeServer,
  app: TestApp,
  options: { goal: string; verify?: boolean },
): Promise<{ ticket: string; release: string }> {
  const verify = options.verify ?? true;
  const handed = await aeHandOff(
    core,
    fake,
    app,
    options.goal,
    verify ? "verify" : "text",
  );
  const { ticket } = handed;
  const release = await explaining(
    async () =>
      `${await stateOf(core, ticket)}, ${await appStateOf(core, app.app)}`,
    async () => {
      const cli = codingCli(core, handed.token);

      const shown = must(
        "ticket show",
        await cli.run("ticket show", { ticket }),
      );
      const claimed = must(
        "ticket claim",
        await cli.run("ticket claim", {
          ticket,
          base_revision: (shown.ticket as { revision: string }).revision,
        }),
      ) as { claim_seq: string };
      const source = { ticket, claim_seq: claimed.claim_seq };

      const prepareKey = core.ids.newId("key");
      must(
        "release prepare",
        await cli.run("release prepare", {
          app: app.app,
          commit: app.commit,
          request_key: prepareKey,
          ticket_source: source,
        }),
      );
      const status = async () =>
        must(
          "release status",
          await cli.run("release status", {
            app: app.app,
            request_key: prepareKey,
          }),
        ) as {
          status: string;
          bundle_hash: string | null;
          release: string | null;
          test: string | null;
        };
      const prepared = await until(
        "release 준비가 끝남",
        async () => {
          const now = await status();
          if (now.status === "preparing") return undefined;
          if (now.status !== "completed" || now.test === null) {
            throw new Error(`release 준비가 ${now.status}로 끝났다`);
          }
          return now as typeof now & { bundle_hash: string; test: string };
        },
        300_000,
      );

      const testKey = core.ids.newId("key");
      must(
        "app test",
        await cli.run("app test", {
          request_key: testKey,
          kind: "app_test",
          app: app.app,
          target: { bundle_hash: prepared.bundle_hash, release: null },
          ticket: null,
          test: prepared.test,
        }),
      );
      const verification = await until("app test 결과가 정해짐", async () => {
        const request = (must(
          "app test status",
          await cli.run("app test status", { request_key: testKey }),
        ) as {
          request: {
            preparation_failed: boolean;
            start_unknown: boolean;
            result_ref: string | null;
            reason: string;
          };
        }).request;
        if (request.preparation_failed || request.start_unknown) {
          throw new Error(`app test 요청이 실패했다: ${request.reason}`);
        }
        return request.result_ref ?? undefined;
      }, 300_000);
      const result = (must(
        "app test result",
        await cli.run("app test result", { verification, detail: false }),
      ) as { verification: { result: string; reason: string } }).verification;
      if (result.result !== "pass") {
        throw new Error(`app test가 ${result.result}: ${result.reason}`);
      }

      const release = await until("release가 확정됨", async () => {
        return (await status()).release ?? undefined;
      });

      const reported = must(
        "ticket show",
        await cli.run("ticket show", { ticket }),
      ) as { ticket: { revision: string } };
      must(
        "ticket report",
        await cli.run("ticket report", {
          ticket,
          base_revision: reported.ticket.revision,
          claim_seq: claimed.claim_seq,
          release,
          summary: "done",
          verifications: [verification],
        }),
      );
      // coding session을 끝내 token을 회수한다. 앱 하나에 coding session은 한 번에 하나다.
      await exitTerminal(core, handed.terminal);

      await waitTurnEnd(core, app.ae, handed.turn + 1);
      if (verify) {
        const done = await core.call(ticketShow, { ticket });
        assertEquals(done.ticket.state, "verified");
      }
      return release;
    },
  );
  return { ticket, release };
}

// `verify: false`로 멈춘 release의 ticket을 AE가 확인하게 한다.
export async function verifyTicket(
  core: Core,
  fake: FakeServer,
  app: TestApp,
  ticket: string,
): Promise<void> {
  fake.script([
    {
      reply: tool("tc_verify", "ticket_verify", {
        ticket,
        result: "verified",
      }),
    },
    { reply: { kind: "text", text: "verified" } },
  ], aeLane(app));
  const turn = (await turnsOf(core, app.ae)).length;
  await say(core, app.ae, `App ${app.app}: verify ticket ${ticket}`);
  await explaining(
    () => stateOf(core, ticket),
    () => waitTurnEnd(core, app.ae, turn),
  );
  assertEquals(
    (await core.call(ticketShow, { ticket })).ticket.state,
    "verified",
  );
}

// 첫 activation은 항상 사람에게 묻는다. 요청이 오지 않으면 제한 시간 뒤 실패한다.
export async function approveActivation(
  core: Core,
  app: TestApp,
  choice: "allow" | "reject" = "allow",
): Promise<{ request: string }> {
  const request = await explaining(
    () => appStateOf(core, app.app),
    () =>
      until("activation 요청이 옴", async () => {
        const { requests } = await core.call(approvalsPending, {});
        return requests.find((item) =>
          item.intent.target.kind === "activation" &&
          item.intent.target.app === app.app
        );
      }),
  );
  await core.call(approvalsDecide, {
    request: request.id,
    choice: { kind: choice },
  });
  return { request: request.id };
}

export async function waitRunning(
  core: Core,
  app: TestApp,
  release?: string,
): Promise<RuntimeObservation> {
  return await explaining(
    () => appStateOf(core, app.app),
    () =>
      until("앱 process가 running·ready·accepting이 됨", async () => {
        const now = await core.call(appRuntime, { app: app.app });
        const seen = now.observation;
        return now.state.state === "running" && seen !== null && seen.ready &&
            seen.accepting &&
            (release === undefined || seen.release === release)
          ? seen
          : undefined;
      }),
  );
}

export async function activateTestApp(
  core: Core,
  fake: FakeServer,
  options: { name: string; slug: string; patch?: AppPatch },
): Promise<TestApp> {
  const app = await startTestApp(core, fake, options);
  const { release } = await deliverRelease(core, fake, app, {
    goal: "Make the first release of the app",
  });
  await approveActivation(core, app, "allow");
  await waitRunning(core, app, release);
  return app;
}
