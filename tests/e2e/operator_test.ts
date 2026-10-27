// 네 질문(행을 더하는 task는 자기 행의 질문을 아래에 한 줄씩 더한다)
// - contract: boundary `approvals`·`agent-tools`(앱 ∩ release 선언 ∩ 할당만 tool이 되고, 뺀 tool은 요청에 없고 불러도 core에 닿지 않는다),
//   `run-loop`(tool 목록은 session을 시작할 때 고정하고 바뀐 것은 program이 쓴 고정 notice로만 간다),
//   `domains`(domain 하나로 좁힌 Operator는 맡은 domain의 `DOMAIN.md`·tool과 다른 domain의 public tool만 본다),
//   `agents`(Operator를 만드는 tool은 할당을 주지 못하고 묻지 않는다).
// - 현실적 회귀: `removed_tools`가 무시되어 뺀 tool이 요청에 남는 것, 할당 없는 Operator에 앱 tool이 보이는 것,
//   session 도중 할당이 바뀌어 `tools[]`가 달라져 prompt cache가 깨지는 것, notice에 tool 설명(앱 글)이 들어가는 것,
//   child의 domain 거르기가 `resolve.ts`와 갈라지는 것, `operator.create`가 다시 묻거나 입력에 할당·`mcp_servers`·`skip` 칸이 생기는 것.
// - 왜 지금 test로 못 잡나: `app-tools`·`judge`·`turn-prompt`·`tool-lists`의 unit은 입력으로 받은 할당과 목록만 본다.
//   사람의 `SetAgentAssignment` 저장 → agent runtime child의 읽기 → model 요청의 `tools[]` → 호출이 core를 지나 앱 process에서 실행되는 왕복은 process를 건너야 보인다.
// - fake 대답: 앱 activation helper의 App Engineer 대답은 행 몫에 세지 않는다. 행마다 둘 이하다.
//
// 준비: core 하나, 앱 하나를 모든 행이 나눠 쓰고 행마다 새 Operator와 새 session을 쓴다. 앱은 domain이 둘이다(앱 slug와
// 둘째 domain `notes-shelf`). 앱 tool은 비공개라 그 domain을 맡은 agent만 보고, 둘째 domain의 공개 tool 하나는 누구나 본다.
// Operator를 앱 place에 두면(정의에 domains가 없으니) 앱의 domain을 모두 맡는다. pm-creates-operator만 project를
// 따로 열어 Project Manager를 쓴다.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { test } from "node:test";

import {
  appCallTool,
  appInvocations,
} from "../../packages/protocol/apps/mod.ts";
import {
  domainCreate,
  domainDocFile,
  domainFolder,
  domainList,
} from "../../packages/protocol/domains/mod.ts";
import { RESERVED_DOMAIN_NAMES } from "../../packages/protocol/apps/declaration/mod.ts";
import { appTools } from "../../packages/protocol/apps/declaration/read.ts";
import {
  agentAssignmentGet,
  agentAssignmentSet,
  type AssignmentEntry,
} from "../../packages/protocol/approvals/mod.ts";
import {
  agentDefinitionList,
  operatorCreate,
  type Place,
} from "../../packages/protocol/lophn-agent/mod.ts";
import {
  approveActivation,
  deliverRelease,
  startTestApp,
  waitRunning,
} from "../support/app/activate.ts";
import { domainPatch } from "../support/app/patch-domain.ts";
import { appCoreEnv } from "../support/app/deps.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  openProject,
  openSession,
  say,
  waitTurnEnd,
} from "../support/core/human.ts";
import {
  type FakeServer,
  type JournalEntry,
  startFakeServer,
} from "../support/fake-server/mod.ts";
import {
  lastToolResult,
  lastUserText,
  systemText,
  toolNames,
} from "../support/fake-server/probe.ts";

// 행 하나의 준비. 단계 한 개로 센다. entries가 null이면 할당을 한 번도 set하지 않은 Operator다.
async function operatorWith(
  core: Core,
  place: Place,
  name: string,
  entries: AssignmentEntry[] | null,
  domains?: string[],
): Promise<{ session: string; ref: { role: "operator"; agent: string } }> {
  const agent = core.ids.newId("agt");
  await core.call(operatorCreate, {
    id: agent,
    place,
    definition: {
      name,
      body: "use the assigned app",
      ...(domains === undefined ? {} : { domains }),
    },
  });
  const ref = { role: "operator", agent } as const;
  if (entries !== null) {
    // 새 Operator의 revision은 0이다.
    await core.call(agentAssignmentSet, { agent: ref, entries }, {
      revision: 0,
    });
  }
  return { session: await openSession(core, ref), ref };
}

const addItem = (name: string) => (title: string) => ({
  kind: "tool" as const,
  calls: [{
    id: "t1",
    name,
    arguments: JSON.stringify({ title }),
  }],
});

// 요청의 app tool 중 이름이 `_add_item`으로 끝나는 것을 고른다.
const callAddItem = (title: string) => (request: JournalEntry) => {
  const name = toolNames(request).find((item) => item.endsWith("_add_item"));
  if (name === undefined) throw new Error("요청에 add_item tool이 없다");
  return addItem(name)(title);
};

const appToolsOf = (fake: FakeServer, index = 0) =>
  toolNames(fake.journal()[index]).filter((name) =>
    !RESERVED_DOMAIN_NAMES.includes(name.split("_")[0])
  ).sort();

// 앱 화면의 사람이 읽는 list_items 결과를 글로 돌려준다.
async function itemsOf(core: Core, app: string): Promise<string> {
  const called = await core.call(appCallTool, {
    target: { mode: "live", app, release: null },
    tool: "list_items",
    caller: { kind: "person", view_session: "e2e" },
  });
  assert.deepStrictEqual(called.outcome.status, "succeeded");
  return JSON.stringify(called.outcome);
}

const text = { reply: { kind: "text" as const, text: "done" } };

async function sessionWrites(core: Core, app: string, session: string) {
  return (await core.call(appInvocations, { app, session })).invocations;
}

test("E2E Operator: 할당한 앱의 tool만 tool 목록에 오르고, 할당에서 뺀 tool은 요청에 없고 불러도 실행되지 않으며, session 도중 할당이 바뀌면 목록은 그대로이고 notice만 온다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run, { env: await appCoreEnv() });
    await connectFakeProvider(core, fake);
    const folder = `${run.work}/proj`;
    await mkdir(folder, { recursive: true });
    const { project } = await openProject(core, folder);
    // 앱 tool의 domain은 그 앱의 active domain 이름이어야 하므로 둘째 domain은 release 준비 전에 만든다.
    const second = "notes-shelf";
    const app = await startTestApp(core, fake, {
      name: "Notes",
      slug: "notes",
      patch: domainPatch(second),
    });
    const id = app.app;
    const slug = app.slug;
    await core.call(domainCreate, {
      name: second,
      title: "Shelf",
      purpose: "Keep the shelf",
      owner: { kind: "app", id },
    });
    const { release } = await deliverRelease(core, fake, app, {
      goal: "Make the first release of the app",
    });
    await approveActivation(core, app);
    await waitRunning(core, app, release);
    const appPlace = { kind: "app", id } as const;
    const assignAll: AssignmentEntry[] = [{ app: id, removed_tools: [] }];

    // assigned: 앱을 할당하면 선언된 tool이 tool 목록에 오르고, 부르면 core를 지나 앱이 실행하고 기록이 남는다.
    fake.reset();
    fake.script([
      { reply: callAddItem("op-first") },
      text,
    ]);
    const first = await operatorWith(core, appPlace, "Assigned", assignAll);
    await say(core, first.session, "add op-first");
    await waitTurnEnd(core, first.session);
    // fake
    assert.deepStrictEqual(
      appToolsOf(fake),
      [
        "notes-shelf_shelf_count",
        "notes-shelf_shelf_list",
        "notes_add_item",
        "notes_list_items",
      ],
    );
    // ledger
    const written = await sessionWrites(core, id, first.session);
    assert.deepStrictEqual(written.length, 1);
    assert.deepStrictEqual(written[0].effect, "write");
    assert.deepStrictEqual(written[0].status, "succeeded");
    assert.deepStrictEqual(written[0].caller?.kind, "agent");
    assert.ok(written[0].changeset !== null);
    // app state
    assert.ok((await itemsOf(core, id)).includes("op-first"));

    // removed: 할당에서 뺀 tool은 요청에 없고, model이 그래도 부르면 실행되지 않는다.
    fake.reset();
    fake.script([
      {
        reply: addItem(`${slug}_add_item`)("op-removed"),
      },
      text,
    ]);
    const removed = await operatorWith(core, appPlace, "Removed", [{
      app: id,
      removed_tools: ["add_item"],
    }]);
    await say(core, removed.session, "add op-removed");
    await waitTurnEnd(core, removed.session);
    // fake
    assert.deepStrictEqual(
      appToolsOf(fake),
      ["notes-shelf_shelf_count", "notes-shelf_shelf_list", "notes_list_items"],
    );
    assert.ok(lastToolResult(fake.journal()[1], "t1")?.includes("not_found"));
    // ledger
    assert.deepStrictEqual(await sessionWrites(core, id, removed.session), []);
    // app state
    assert.ok(!(await itemsOf(core, id)).includes("op-removed"));

    // domain-narrowed: domain 하나로 좁힌 Operator의 요청에는 그 domain의 `DOMAIN.md`와 tool, 다른 domain의 public tool만 있다.
    const { domains } = await core.call(domainList, {
      owner: { kind: "app", id },
      status: "active",
    });
    const mine = domains.find((item) => item.name === slug)!;
    const other = domains.find((item) => item.name === second)!;
    // 사람이 editor로 저장하는 것처럼 보통 파일로 쓴다.
    for (
      const [domain, rule] of [[mine, "Zebra rule"], [
        other,
        "Quokka rule",
      ]] as const
    ) {
      await mkdir(domainFolder(core.run.home, domain.id), {
        recursive: true,
      });
      await writeFile(
        domainDocFile(core.run.home, domain.id),
        `${rule}: answer in capital letters.\n`,
      );
    }
    fake.reset();
    fake.script([text]);
    const narrowed = await operatorWith(
      core,
      appPlace,
      "Narrowed",
      assignAll,
      [mine.id],
    );
    await say(core, narrowed.session, "hello");
    await waitTurnEnd(core, narrowed.session);
    // fake
    const system = systemText(fake.journal()[0]);
    assert.ok(system.includes("Zebra rule"));
    assert.ok(!system.includes("Quokka rule"));
    assert.deepStrictEqual(
      appToolsOf(fake),
      ["notes-shelf_shelf_count", "notes_add_item", "notes_list_items"],
    );

    // no-assignment: 할당 없이 만든 Operator에는 활성 앱이 있어도 app tool이 하나도 없다.
    fake.reset();
    fake.script([text]);
    const bare = await operatorWith(core, appPlace, "NoAssignment", null);
    await say(core, bare.session, "hello");
    await waitTurnEnd(core, bare.session);
    // fake
    assert.deepStrictEqual(appToolsOf(fake), []);
    // ledger: 할당 줄이 없는 것도 빈 할당(revision 0)으로 읽힌다.
    const bareRead = await core.call(agentAssignmentGet, { agent: bare.ref });
    assert.deepStrictEqual(bareRead.assignment.entries, []);
    assert.deepStrictEqual(bareRead.revision, 0);

    // assignment-added: session 도중 할당을 더해도 tool 목록은 그대로이고, notice는 program이 쓴 문장으로 tool 이름만 말한다.
    fake.reset();
    fake.script([text, text]);
    const added = await operatorWith(core, appPlace, "AssignmentAdded", null);
    await say(core, added.session, "first");
    await waitTurnEnd(core, added.session, 0);
    await core.call(agentAssignmentSet, {
      agent: added.ref,
      entries: assignAll,
    }, {
      revision: 0,
    });
    await say(core, added.session, "second");
    await waitTurnEnd(core, added.session, 1);
    // fake
    const [before, after] = fake.journal();
    assert.deepStrictEqual(
      JSON.stringify((after.body as { tools: unknown }).tools),
      JSON.stringify((before.body as { tools: unknown }).tools),
    );
    const notice = lastUserText(after);
    assert.ok(notice.includes("tools_changed"));
    assert.ok(notice.includes(`${slug}_list_items`));
    assert.ok(notice.includes(`${slug}_add_item`));
    const declaration = await core.call(appTools, { app: id });
    for (const api of declaration.tools) {
      assert.ok(!notice.includes(api.description));
    }
    // ledger
    const addedRead = await core.call(agentAssignmentGet, { agent: added.ref });
    assert.deepStrictEqual(addedRead.assignment.entries, assignAll);
    assert.deepStrictEqual(addedRead.revision, 1);
    assert.deepStrictEqual(await sessionWrites(core, id, added.session), []);

    // pm-creates-operator: PM이 Operator를 만들어도 묻지 않고 할당은 비어 있다.
    fake.reset();
    fake.script([
      {
        reply: {
          kind: "tool",
          calls: [{
            id: "t1",
            name: "operator_create",
            arguments: JSON.stringify({
              place: { project },
              name: "pm-made",
              body: "do the assigned work",
            }),
          }],
        },
      },
      text,
    ]);
    const place = { kind: "project", id: project } as const;
    const manager = await openSession(core, {
      role: "project_manager",
      project,
    });
    await say(core, manager, "make an operator");
    // 물었다면 turn이 기다려 끝나지 않는다.
    await waitTurnEnd(core, manager);
    // ledger
    const list = await core.call(agentDefinitionList, { place });
    const made = list.agents.find((row) => row.name === "pm-made");
    assert.ok(made !== undefined);
    const madeRead = await core.call(agentAssignmentGet, { agent: made.agent });
    assert.deepStrictEqual(madeRead.assignment.entries, []);
    assert.deepStrictEqual(madeRead.revision, 0);
    // fake: operator_create 입력에 할당·mcp_servers·skip 칸이 없다.
    const createTool = (fake.journal()[0].body as {
      tools: { name: string; input_schema: { properties: object } }[];
    }).tools.find((tool) => tool.name === "operator_create");
    assert.ok(createTool !== undefined);
    const keys = Object.keys(createTool.input_schema.properties);
    assert.ok(!keys.includes("mcp_servers") && !keys.includes("skip"));
    assert.deepStrictEqual(
      keys.filter((key) => key.includes("assign") || key.includes("grant")),
      [],
    );
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
