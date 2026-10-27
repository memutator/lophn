// 세 질문
// - contract: boundary `kinds`·`events`·`event-stream`(kind 파일이 가리키는 문서에 새 위반이 생기면 kinds worker의 sync 답을
//   dispatcher가 앞 sync와 메모리에서 견주어 남지 않는 `KindViolationFound {domain, count}`를 Bus로 한 번 내고 Gateway가
//   받는다. session은 열리지 않는다. 켠 뒤 그 domain의 첫 sync는 기준만 둔다).
// - 현실적 회귀: worker launch spec의 읽기 권한에 project 폴더나 kind 파일이 빠진다, dispatcher가 Bus에 못 내거나 Gateway가
//   남지 않는 event를 거르지 못한다, 켠 뒤 첫 sync가 있던 위반을 모두 새것으로 알린다, 같은 위반을 sync마다 다시 알린다,
//   위반이 다시 session을 연다.
// - 왜 지금 test로 못 잡나: dispatcher의 비교를 보는 unit이 없고(`packages/core/projects/kinds/host`에는 `handlers_test.ts`뿐이다),
//   kind route -> dispatcher -> worker process -> Bus -> Gateway WebSocket은 process를 건너야 보인다.
//
// fake 대답은 없다. 앱이 없는 project 길이라 `appCoreEnv` 없이 `bootCore(run)`이다. 폴더와 파일은 사람이 editor로 저장하듯
// 직접 쓴다.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { test } from "node:test";
import {
  domainCreate,
  domainFolder,
  domainKindsFile,
} from "../../packages/protocol/domains/mod.ts";
import { agentSessionList } from "../../packages/protocol/lophn-agent/mod.ts";
import { kindCheck } from "../../packages/protocol/projects/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  openProject,
  until,
} from "../support/core/human.ts";
import { connectGateway, type Gateway } from "../support/gateway/mod.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";

const KINDS = `kinds:
  - name: note
    summary: a note
    files: [notes/*.md]
    key: file
    fields:
      status:
        type: string
        required: true
`;

const INVALID_NOTE = "---\ntitle: a\n---\n";

const found = (frame: { event: { type: string } }) =>
  frame.event.type === "KindViolationFound";

test("E2E kind 파일이 가리키는 문서에 새 위반이 생기면 Gateway가 KindViolationFound 하나를 받고 session은 열리지 않으며, 켠 뒤 첫 sync가 본 위반은 알리지 않는다", async (t) => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  let gateway: Gateway | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const c = core;
    const folder = `${c.run.work}/notes-project`;
    await mkdir(`${folder}/notes`, { recursive: true });
    await writeFile(`${folder}/notes/a.md`, INVALID_NOTE);
    const { project } = await openProject(c, folder, "notes-project");
    const g = (gateway = await connectGateway(c, {
      conditions: [{ types: ["KindViolationFound"] }],
    }));
    const domain = c.ids.newId("dom");
    const total = async () =>
      (await c.call(kindCheck, { domain, query: {} })).total;

    await t.test("first-sync-is-baseline", async () => {
      // domain을 만들면 감시가 바로 sync해 기준을 잡는다. 파일을 먼저 둬야 위반이 있는 domain을 처음 sync하는 처지가 된다.
      await mkdir(domainFolder(c.run.home, domain), { recursive: true });
      await writeFile(domainKindsFile(c.run.home, domain), KINDS);
      await c.call(domainCreate, {
        id: domain,
        name: "notes",
        title: "Notes",
        purpose: "Notes kept in this project",
        owner: { kind: "project", id: project },
      });
      await until("kind 파일이 적용됨", async () =>
        (await total()) === 1 ? true : undefined,
      );
      // 그 전에 Bus가 낸 event frame은 이 ready보다 먼저 와 있다.
      await g.watch([{ types: ["KindViolationFound"] }]);

      // route: 문구(message)는 단정하지 않는다.
      const { violations } = await c.call(kindCheck, { domain, query: {} });
      const { message: _message, ...violation } = violations[0]!;
      assert.deepStrictEqual(violation, {
        source: "document",
        rule: "required",
        kind: "note",
        path: "notes/a.md",
        field: "status",
      });
      // event
      assert.deepStrictEqual(
        g.frames().filter((frame) => frame.type === "event" && found(frame)),
        [],
      );
    });

    await t.test("new-violation-notifies-once", async () => {
      await writeFile(`${folder}/notes/b.md`, INVALID_NOTE);
      // 감시에만 기대지 않는다. 감시는 힌트이고 놓쳐도 읽기 앞 sync가 따라잡는 것이 계약이다.
      await until("새 위반이 보임", async () =>
        (await total()) === 2 ? true : undefined,
      );
      const frame = await g.next("event", found);
      await g.watch([{ types: ["KindViolationFound"] }]);

      // event
      const { event } = frame;
      if (event.type !== "KindViolationFound") throw new Error("다른 event");
      assert.deepStrictEqual(event.subject, domain);
      assert.deepStrictEqual(event.payload, { domain, count: 1 });
      assert.deepStrictEqual(
        g.frames().filter((item) => item.type === "event" && found(item))
          .length,
        1,
      );
      // ledger: session이 열리지 않는다.
      const { sessions } = await c.call(agentSessionList, {
        agent: { role: "project_manager", project },
      });
      assert.deepStrictEqual(sessions, []);
      // fake: 어떤 turn도 model을 부르지 않았다.
      assert.deepStrictEqual(fake.journal().length, 0);
    });
  } finally {
    await gateway?.close().catch(() => {});
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
