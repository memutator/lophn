// 세 질문
// - contract: boundary `app-data`(changeset은 최신부터 뒤집어 한 transaction이고, 충돌하면 통째로 취소된다. write는 앱마다
//   하나씩 돌아 changeset이 호출마다 따로다)와 `child-supervision-protocol`(뒤집은 changeset 전부가 요청 하나로 bytes
//   frame과 end로 간다), `app-runtime`.
// - 현실적 회귀: rewind 요청이 frame 한도(256KiB)를 못 지나 되돌림이 통째로 막힌 것(두 번 난 일), 일부만 되돌아가 DB가
//   반쯤 되돌아간 채 남는 것, 동시에 부른 write의 changeset이 섞여 rewind 하나가 다른 쪽을 지우는 것, rewind wiring이
//   비어 늘 rejected인 것(연결을 보는 test가 없었다).
// - 왜 지금 test로 못 잡나: 한도 계산은 unit이 있지만 실제 pipe와 앱 process의 한 transaction은 process를 건너야 한다.
//
// fake 대답: 앞 세 행은 앱 activation(`activateTestApp`)의 App Engineer 대답(`release_prepare`·`release_activate`)뿐이라
// 행의 상한(3)에 세지 않는다(`architecture/testing.md` "case 고르는 규칙" 4). `session-rewind-with-app`은 case마다
// agent의 앱 호출과 끝 text, 둘이다.
import { assert, assertEquals } from "@std/assert";
import {
  appCallTool,
  appInvocations,
  appRewind,
  appRewindPlan,
  appRewinds,
  appRuntime,
} from "../../packages/protocol/apps/mod.ts";
import { agentAssignmentSet } from "../../packages/protocol/approvals/mod.ts";
import {
  operatorCreate,
  rewindList,
  sessionRewind,
  sessionRewindPreview,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { activateTestApp, type TestApp } from "../support/app/activate.ts";
import { appCoreEnv } from "../support/app/deps.ts";
import { rewindPatch } from "../support/app/patch-rewind.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  openSession,
  say,
  until,
  waitTurnEnd,
} from "../support/core/human.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";
import { toolNames } from "../support/fake-server/probe.ts";

type Rows<T> = { rows: T[] };

// 앱 tool을 사람이 부른다. 읽기는 invocation 기록이 없어 id가 null이다.
async function call(core: Core, app: TestApp, tool: string, input?: unknown) {
  const done = await core.call(appCallTool, {
    target: { mode: "live", app: app.app, release: null },
    tool,
    ...(input === undefined ? {} : { input: input as never }),
    caller: { kind: "person", view_session: "e2e" },
  });
  assertEquals(
    done.outcome.status,
    "succeeded",
    `${tool}: ${JSON.stringify(done.outcome)}`,
  );
  return done as typeof done & { invocation: string };
}

// 성공한 호출의 result다.
function rowsOf<T>(done: { outcome: unknown }): T[] {
  return (done.outcome as { result: Rows<T> }).result.rows;
}

async function blobs(core: Core, app: TestApp) {
  return rowsOf<{ count: number; touched: number }>(
    await call(core, app, "count_blobs"),
  )[0]!;
}

async function titles(core: Core, app: TestApp): Promise<string[]> {
  return rowsOf<{ title: string }>(await call(core, app, "list_items")).map((
    row,
  ) => row.title).sort();
}

// 한 write가 100KiB라 셋의 changeset 합이 control frame(256KiB)을 넘는다.
async function addBlobs(core: Core, app: TestApp): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    ids.push((await call(core, app, "add_blob", { kb: 100 })).invocation);
  }
  return ids;
}

const rewindOf = async (core: Core, app: TestApp, from: string) =>
  (await core.call(appRewinds, { app: app.app })).rewinds.find((item) =>
    item.from_invocation === from
  );

const addItemTool = (
  title: string,
) => ({
  reply: (request: Parameters<typeof toolNames>[0]) => ({
    kind: "tool" as const,
    calls: [{
      id: "tc_add",
      name: toolNames(request).find((name) => name.endsWith("_add_item")) ??
        "tool_not_offered",
      arguments: JSON.stringify({ title }),
    }],
  }),
});

Deno.test("E2E 여러 write의 앱 data rewind는 한 번에 되돌아가고, 충돌하면 아무것도 바꾸지 않고, 다른 write를 지우지 않는다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run, { env: await appCoreEnv() });
    await connectFakeProvider(core, fake);
    const live = await activateTestApp(core, fake, {
      name: "Blobs",
      slug: "blobs",
      patch: rewindPatch,
    });
    const nonce = (await core.call(appRuntime, { app: live.app })).observation
      ?.process_nonce;
    assert(nonce !== undefined);

    // rewind-many-writes: 합이 frame 한도를 넘는 write 셋이 한 번에 첫 write 이전으로 돌아간다.
    const first = await addBlobs(core, live);
    assertEquals((await blobs(core, live)).count, 3);
    const plan = await core.call(appRewindPlan, {
      app: live.app,
      from_invocation: first[0]!,
    });
    assertEquals(plan.plan.items.length, 3);
    const rewound = await core.call(appRewind, {
      app: live.app,
      from_invocation: first[0]!,
    });
    // app state
    assertEquals((await blobs(core, live)).count, 0);
    // ledger
    assertEquals(rewound.status, "applied");
    assertEquals(
      (await rewindOf(core, live, first[0]!))?.invocations.slice().sort(),
      first.slice().sort(),
    );
    assertEquals(
      (await core.call(appInvocations, { app: live.app, reverted: true }))
        .invocations.length,
      3,
    );
    // process: 같은 앱 process가 살아 있고 결과를 모르는 호출이 없다
    const after = await core.call(appRuntime, { app: live.app });
    assertEquals(after.state.state, "running");
    assertEquals(after.observation?.process_nonce, nonce);
    assertEquals(
      (await core.call(appInvocations, { app: live.app, status: "unknown" }))
        .invocations,
      [],
    );

    // rewind-conflict: 기록 없이 DB가 고쳐지면 뒤집기가 통째로 취소되고, 앞선 둘도 적용된 채 남지 않는다.
    const second = await addBlobs(core, live);
    await call(core, live, "touch_blob");
    await core.tryCall(appRewind, {
      app: live.app,
      from_invocation: second[0]!,
    });
    // app state
    assertEquals(await blobs(core, live), { count: 3, touched: 1 });
    // ledger
    const record = await rewindOf(core, live, second[0]!);
    assertEquals(record?.status, "cancelled");
    assertEquals(record?.reason?.code, "conflict");
    assertEquals(
      (await core.call(appInvocations, { app: live.app, reverted: true }))
        .invocations.length,
      3,
    );
    // process
    const alive = await core.call(appRuntime, { app: live.app });
    assertEquals(alive.state.state, "running");
    assertEquals(alive.observation?.process_nonce, nonce);

    // writes-serialized: 동시에 부른 write는 따로 기록되어 rewind 하나가 다른 쪽을 지우지 않는다.
    const both = await Promise.all(
      ["a", "b"].map((title) => call(core!, live, "add_item", { title })),
    );
    const written = (await core.call(appInvocations, {
      app: live.app,
      effect: "write",
      status: "succeeded",
    })).invocations.filter((item) =>
      both.some((one) => one.invocation === item.id)
    ).sort((x, y) =>
      `${x.started_at}${x.id}`.localeCompare(`${y.started_at}${y.id}`)
    );
    // ledger
    assertEquals(written.length, 2);
    assert(written.every((item) => item.changeset !== null));
    assertEquals(
      new Set(written.map((item) => item.changeset?.hash)).size,
      2,
    );
    const earlier = written[0]!;
    const later = written[1]!;
    // route
    const single = await core.call(appRewindPlan, {
      app: live.app,
      from_invocation: later.id,
    });
    assertEquals(single.plan.items.map((item) => item.invocation), [later.id]);
    await core.call(appRewind, { app: live.app, from_invocation: later.id });
    // app state: 먼저 시작한 호출의 item 하나만 남는다
    const kept_title = ["a", "b"][
      both.findIndex((one) => one.invocation === earlier.id)
    ]!;
    assertEquals(await titles(core, live), [kept_title]);

    // session-rewind-with-app: 앱 place Operator session의 rewind에서 앱을 고르면 그 앱도 되돌아가고, 안 고르면 그대로다.
    // 비공개 tool은 그 domain을 맡은 agent만 보고, 앱 place의 Operator는 앱의 domain을 모두 맡는다.
    const agent = core.ids.newId("agt");
    await core.call(operatorCreate, {
      id: agent,
      place: { kind: "app", id: live.app },
      definition: { name: "Writer", body: "use the app" },
    });
    const operator = { role: "operator", agent } as const;
    // tool 목록은 session을 열 때 고정되므로 열기 전에 할당한다.
    await core.call(agentAssignmentSet, {
      agent: operator,
      entries: [{ app: live.app, removed_tools: [] }],
    }, { revision: 0 });
    for (const choose of [true, false]) {
      const title = choose ? "by-agent-chosen" : "by-agent-skipped";
      fake!.reset();
      fake!.script([addItemTool(title), {
        reply: { kind: "text", text: "added" },
      }]);
      const session = await openSession(core, operator);
      const { message } = await say(core, session, `add ${title}`);
      await waitTurnEnd(core, session);
      assert((await titles(core, live)).includes(title));
      const preview = await core.call(sessionRewindPreview, {
        session,
        checkpoint: message,
        choice: "restore_all",
      });
      assertEquals(preview.app_writes.map((item) => item.app), [live.app]);
      const header = await core.call(sessionRewind, {
        id: core.ids.newId("rwd"),
        session,
        checkpoint: message,
        choice: "restore_all",
        accept_remaining: true,
        preview_hash: preview.preview_hash,
        summary_call: null,
        files: [],
        apps: choose ? [live.app] : [],
      }, { session_state: "open", active_turn: null, applying_rewind: null });
      const revert = (await core.call(rewindList, { session })).reverts.find(
        (item) => item.id === header.id,
      );
      // disk: 파일 복원은 앱 선택과 독립이다. 이 session은 file을 건드리지 않았다.
      assertEquals(revert?.items, []);
      const writes = preview.app_writes[0]!.invocations;
      if (choose) {
        // ledger: 앱 rewind는 대화 rewind가 끝난 뒤 따로 요청된다.
        const record = await until("앱 rewind가 적용됨", async () => {
          const found = await rewindOf(core!, live, writes[0]!);
          return found?.status === "applying" ? undefined : found;
        });
        assertEquals(record.status, "applied");
        assertEquals(
          (await core.call(rewindList, { session })).reverts.find((item) =>
            item.id === header.id
          )?.apps.map((item) => [item.app, item.result]),
          [[live.app, "applied"]],
        );
        // app state
        assert(!(await titles(core, live)).includes(title));
      } else {
        // ledger
        assertEquals(revert?.apps, []);
        assertEquals(await rewindOf(core, live, writes[0]!), undefined);
        // app state
        assert((await titles(core, live)).includes(title));
      }
    }
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
