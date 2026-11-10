// 세 질문
// - contract: boundary `sdk`·`app-runtime`(`app.sdk_decide`는 home lophn의 결정을 review로 남기고 update면 같은 동작으로 그 앱의
//   lophn에게 handoff call을 보낸다. `app.sdk_feature`는 앱 lophn이 자기 앱의 기능 결과만 낸다).
// - 현실적 회귀: 거절된 handoff 뒤에 review가 남아 다음 round가 맡긴 일이 있다고 믿는 것, handoff 글에 판·메모·기능 ID가 빠지는 것,
//   private 앱의 고정 예외가 막히는 것, 앱 lophn이 남의 앱 기능 결과를 쓰는 것, 그대로 두기로 한 앱의 `unreviewed`가 남는 것.
// - 왜 지금 test로 못 잡나: sdk-status의 unit은 fake router와 sqlite만 본다. 메인 스레드 handler가 설치 사본과 메모 file을 읽고, 쓰기 앞
//   처리기와 machine 자격, call 본문 준비, Router(call 정책)를 지나 받는 앱 session의 첫 입력이 되는 길은 process를 건너야 보인다.
//
// 앱은 셋이다: Masup(update, 기능 하나), Mahas(leave, 이어서 call 정책이 막은 update), Secret(private, update). 앞서 깐 설치 사본의
// 지금 판을 지원 하한 판 이름으로 복사해 세 앱이 그 판을 고정한다(하한 아래면 required라 하한이 가장 옛 `available`이다).
import assert from "node:assert/strict";
import { chmod, cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  createIdSource,
  cryptoRandom,
  systemClock,
} from "../../packages/base/mod.ts";
import { appSdkStatus } from "../../packages/protocol/apps/sdk-status.ts";
import {
  lophnIdOf,
  workspaceSessionList,
} from "../../packages/protocol/lophn-agent/mod.ts";
import {
  approveActivation,
  deliverRelease,
  startTestApp,
  type TestApp,
  waitRunning,
} from "../support/app/activate.ts";
import { appCoreEnv } from "../support/app/deps.ts";
import {
  connectFakeProvider,
  openLophnSession,
  say,
  until,
  waitTurnEnd,
} from "../support/core/human.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  type JournalEntry,
  startFakeServer,
  type Step,
} from "../support/fake-server/mod.ts";
import { lophnCall, lophnCommands } from "../support/fake-server/lophn.ts";
import { idIn, lastToolResult } from "../support/fake-server/probe.ts";

const ids = createIdSource({ clock: systemClock, random: cryptoRandom });
// call 정책은 기동 전 설정이라 둘의 id를 미리 정한다.
const SECRET = ids.newId("app");
const MAHAS = ids.newId("app");

// 설치된 `@lophn/agent`의 지금 판과 지원 하한이다. 앱은 하한 판을 고정하고 지금 판의 메모가 `unreviewed`로 나온다.
async function agentVersions(core: Core) {
  const root = `${core.run.home}/sdk/agent`;
  const current = (await readdir(root))
    .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .at(-1)!;
  const manifest = JSON.parse(
    await readFile(`${root}/${current}/package.json`, "utf8"),
  );
  return { root, current, pinned: manifest.lophn.supported_from as string };
}

// 설치 사본은 지금 판 하나뿐이라, 앱이 하한 판을 고정할 수 있게 같은 bytes를 하한 판 이름으로 복사한다.
async function installOldCopy(core: Core) {
  const { root, current, pinned } = await agentVersions(core);
  const to = `${root}/${pinned}`;
  await cp(`${root}/${current}`, to, { recursive: true });
  await chmod(to, 0o755);
  const manifest = `${to}/package.json`;
  await chmod(manifest, 0o644);
  await writeFile(
    manifest,
    (await readFile(manifest, "utf8")).replace(`"${current}"`, `"${pinned}"`),
  );
  return { current, pinned };
}

const pinTo = (current: string, pinned: string) => async (dir: string) => {
  // lock이 지금 판을 가리키면 준비의 `npm ci`가 거절한다. 없으면 `npm install`이 새로 만든다.
  await rm(`${dir}/package-lock.json`, { force: true });
  for (const [file, from, to] of [
    ["package.json", `agent/${current}"`, `agent/${pinned}"`],
    [
      "lophn.ts",
      `"@lophn/agent", version: "${current}"`,
      `"@lophn/agent", version: "${pinned}"`,
    ],
  ] as const) {
    const text = await readFile(`${dir}/${file}`, "utf8");
    if (!text.includes(from)) throw new Error(`${file}에 patch 자리가 없다`);
    await writeFile(`${dir}/${file}`, text.replace(from, to));
  }
};

async function activate(
  core: Core,
  fake: Awaited<ReturnType<typeof startFakeServer>>,
  options: { name: string; slug: string; id?: string },
  patch: (dir: string) => Promise<void>,
): Promise<TestApp> {
  const app = await startTestApp(core, fake, { ...options, patch });
  const { release } = await deliverRelease(core, fake, app, {
    goal: "Make the first release of the app",
  });
  await approveActivation(core, app, "allow");
  await waitRunning(core, app, release);
  return app;
}

const tool = (id: string, line: string, input?: unknown): Step => ({
  reply: { kind: "tool", calls: [lophnCall(id, line, input)] },
});

// 그 tool call의 결과(tool_result 글의 JSON)다. 뒤 요청의 history에 실려 있다.
function resultOf(entries: JournalEntry[], id: string) {
  for (const entry of entries.toReversed()) {
    const raw = lastToolResult(entry, id);
    if (raw !== undefined) {
      return JSON.parse(raw) as {
        status: string;
        code: string;
        content: { call: string | null };
      };
    }
  }
  throw new Error(`tool call ${id}의 결과가 없다`);
}

test("E2E home lophn의 SDK 결정은 review로 남고 update는 그 앱의 lophn에게 같은 동작으로 맡겨지며, 거절된 handoff는 아무것도 남기지 않고 앱 lophn은 자기 앱의 기능 결과만 낸다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run, {
      env: await appCoreEnv(),
      settings: {
        "lophn-agent.call_policy": {
          private: [{ kind: "app", id: SECRET }],
          workspaces: [],
          // 쌍 규칙은 private 예외보다 앞서고, Mahas는 public이라 이 규칙만이 handoff를 막는다.
          agents: [{ from: "lophn_home", to: `lophn_${MAHAS}`, allow: false }],
        },
      },
    });
    const c = core;
    await connectFakeProvider(c, fake);
    const { current, pinned } = await installOldCopy(c);
    const patch = pinTo(current, pinned);
    const masup = await activate(
      c,
      fake,
      { name: "Masup", slug: "masup" },
      patch,
    );
    const mahas = await activate(
      c,
      fake,
      { name: "Mahas", slug: "mahas", id: MAHAS },
      patch,
    );
    const secret = await activate(
      c,
      fake,
      { name: "Secret", slug: "secret", id: SECRET },
      patch,
    );
    fake.reset();

    const ledger = () =>
      new DatabaseSync(`${run.home}/lophn.db`, { readOnly: true });
    const rows = (sql: string) => {
      const db = ledger();
      try {
        return db.prepare(sql).all() as Record<string, unknown>[];
      } finally {
        db.close();
      }
    };
    const status = async () =>
      new Map(
        (await c.call(appSdkStatus, {})).apps.map((app) => [app.app, app]),
      );
    const note = `agent-${current}.md`;
    const feature = [
      {
        title: "Daily total in tray",
        proposal: "Show today's total from the tray popup.",
        note,
      },
    ];

    // 처음에는 어느 앱도 결정이 없고 지금 판의 메모가 모두 `unreviewed`다.
    for (const app of [masup, mahas, secret]) {
      const first = (await status()).get(app.app)!;
      assert.strictEqual(first.review, null);
      const agent = first.sdks.find((sdk) => sdk.sdk === "@lophn/agent")!;
      assert.deepStrictEqual(
        [agent.level, agent.pinned, agent.current, agent.unreviewed.at(-1)],
        ["available", pinned, current, note],
      );
      assert.deepStrictEqual(agent.unreviewed, agent.notes);
    }

    // 받는 앱 lophn의 session은 handoff call이 연다. 첫 입력에 program이 짠 글이 있는 요청이 그 앱의 줄이다.
    const handoffLane = (app: TestApp) => ({
      name: `handoff-${app.slug}`,
      match: (request: JournalEntry) => {
        const body = JSON.stringify(request.body);
        return (
          lophnCommands(request).includes("app sdk-feature") &&
          body.includes("SDK update for this app") &&
          body.includes(app.app)
        );
      },
    });
    fake.script(
      [{ reply: { kind: "text", text: "noted" } }],
      handoffLane(secret),
    );
    fake.script(
      [
        {
          reply: (request) => ({
            kind: "tool" as const,
            calls: [
              lophnCall(
                "own",
                `app sdk-feature ${idIn(JSON.stringify(request.body), "sdf")} --state done --note built`,
              ),
            ],
          }),
        },
        {
          // Home이 Secret을 먼저 결정했으므로 Secret의 기능 ID는 이미 ledger에 있다.
          reply: () => ({
            kind: "tool" as const,
            calls: [
              lophnCall(
                "foreign",
                `app sdk-feature ${rows(`select id from sdk_features where app = '${secret.app}'`)[0]!.id} --state done`,
              ),
            ],
          }),
        },
        tool(
          "made-up",
          "app sdk-feature sdf_0zzzzzzzzzzzzzzzzzzzzzzzzz --state done",
        ),
        { reply: { kind: "text", text: "reported" } },
      ],
      handoffLane(masup),
    );
    const home = {
      name: "home",
      match: (request: JournalEntry) =>
        lophnCommands(request).includes("app sdk-decide"),
    };
    fake.script(
      [
        tool("secret", "app sdk-decide", {
          app: secret.app,
          decision: "update",
          features: feature,
        }),
        tool("mahas-leave", "app sdk-decide", {
          app: mahas.app,
          decision: "leave",
        }),
        tool("mahas-update", "app sdk-decide", {
          app: mahas.app,
          decision: "update",
          features: feature,
        }),
        tool("masup", "app sdk-decide", {
          app: masup.app,
          decision: "update",
          features: feature,
        }),
        { reply: { kind: "text", text: "decided" } },
      ],
      home,
    );
    const homeSession = await openLophnSession(c);
    await say(c, homeSession, "decide the SDK updates");
    await waitTurnEnd(c, homeSession, 0);

    const homeResults = fake.journal().filter((entry) => entry.lane === "home");
    const results = Object.fromEntries(
      ["secret", "mahas-leave", "mahas-update", "masup"].map((id) => [
        id,
        resultOf(homeResults, id),
      ]),
    );
    // private 앱은 고정 예외로 받고, 쌍 규칙이 막은 update는 거절이며 leave는 call이 없다.
    assert.deepStrictEqual(
      [
        results.secret.status,
        results.masup.status,
        results["mahas-leave"].status,
        results["mahas-leave"].content.call,
        results["mahas-update"].code,
      ],
      ["success", "success", "success", null, "forbidden"],
    );

    // ledger: 거절된 update의 review·기능·call은 없다. 결정은 앱마다 마지막 한 줄씩이다.
    const reviews = rows(
      "select app, decision, call, through from sdk_reviews",
    );
    assert.deepStrictEqual(
      reviews.map((row) => [row.app, row.decision]).sort(),
      [
        [masup.app, "update"],
        [mahas.app, "leave"],
        [secret.app, "update"],
      ].sort(),
    );
    const through = JSON.parse(String(reviews[0]!.through));
    assert.strictEqual(through["@lophn/agent"], current);
    assert.deepStrictEqual(
      rows("select app, state from sdk_features order by app").map(
        (row) => row.state,
      ),
      ["open", "open"],
    );
    assert.strictEqual(rows("select call from agent_calls").length, 2);

    // fake: 받은 앱 lophn의 첫 입력에 program이 채운 판, 메모 file, 기능 ID가 있다.
    for (const app of [masup, secret]) {
      await until("handoff session", async () =>
        fake.journal().find((entry) => entry.lane === `handoff-${app.slug}`),
      );
      const id = rows(
        `select id from sdk_features where app = '${app.app}'`,
      )[0]!.id;
      const first = JSON.stringify(
        fake.journal().find((entry) => entry.lane === `handoff-${app.slug}`)!
          .body,
      );
      for (const part of [
        `@lophn/agent: ${pinned} -> ${current}`,
        note,
        String(id),
      ]) {
        assert.ok(
          first.includes(part),
          `${app.slug}의 handoff 글에 ${part}가 없다`,
        );
      }
    }
    const sessions = await c.call(workspaceSessionList, {
      agent: lophnIdOf({ kind: "app", id: masup.app }),
      workspace: { kind: "app", id: masup.app },
    });
    const received = sessions.sessions
      .map((s) => s.id)
      .find((id) => id !== masup.lophn)!;
    await waitTurnEnd(c, received, 0);

    // 앱 lophn은 자기 앱의 기능 결과만 낸다. 남의 앱 기능과 없는 ID는 없는 것과 같은 답이다.
    const reports = fake
      .journal()
      .filter((entry) => entry.lane === "handoff-masup");
    assert.deepStrictEqual(
      ["own", "foreign", "made-up"].map((id) => resultOf(reports, id).code),
      ["ok", "not_found", "not_found"],
    );

    const after = await status();
    assert.deepStrictEqual(
      [
        after.get(masup.app)!.review!.features[0]!.state,
        after.get(secret.app)!.review!.features[0]!.state,
      ],
      ["done", "open"],
    );
    // 그대로 두기로 한 앱은 새 메모가 없다. 판 올리기가 끝나지 않은 update는 migrated가 false다.
    assert.deepStrictEqual(
      after.get(mahas.app)!.sdks.map((sdk) => sdk.unreviewed),
      after.get(mahas.app)!.sdks.map(() => []),
    );
    assert.strictEqual(after.get(masup.app)!.review!.migrated, false);
    assert.deepStrictEqual(
      fake
        .journal()
        .filter((entry) => entry.mismatch !== null)
        .map((entry) => entry.mismatch),
      [],
    );
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
