// 세 질문
// - contract: boundary `kinds`·`problems`·`events`(그릇의 domain 폴더에 처음 쓴 kind 파일의 문서 위반이 kinds worker를 거쳐
//   domain problem으로 열리고, 새 위반이면 `KindViolationFound`가 그 그릇의 Project Manager session을 한 번 연다).
// - 현실적 회귀: watch가 domain 폴더를 못 봐 처음 쓴 `kinds.yaml`을 놓친다, worker launch spec의 읽기 권한에 project 폴더나 kind
//   파일이 빠져 worker가 못 읽는다, dispatcher의 machine 자격이 `problem.sync_domain`을 못 부른다, reaction이 project owner
//   domain의 Project Manager를 못 찾는다, 같은 위반이 sync마다 session을 또 연다.
// - 왜 지금 test로 못 잡나: `kinds-file_test.ts`와 `packages/core/problems/domain/commands_test.ts`는 한 쪽씩만 본다.
//   core watch -> worker process -> machine command -> Reactor -> Router -> Project Manager turn은 process를 건너야 보인다.
//
// 앱이 없는 project 길이라 core 기동뿐이다. fake 대답은 reaction session turn의 text 하나다. 제품은 domain 폴더를 turn 시작 때
// agent runtime이 만들고 Project Manager가 file tool로 `kinds.yaml`을 쓰지만, file tool의 범위는 이 flow의 contract가 아니라서
// 폴더와 파일을 직접 쓴다(순서는 제품과 같다: domain 생성 -> 폴더 -> 처음 쓴 kinds.yaml).
import { assertEquals } from "@std/assert";
import {
  domainCreate,
  domainFolder,
  domainKindsFile,
} from "../../packages/protocol/domains/mod.ts";
import {
  agentSessionList,
  receivedMessageList,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { problemListDomain } from "../../packages/protocol/problems/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  openProject,
  settle,
  until,
  waitTurnEnd,
} from "../support/core/human.ts";
import { runtimePids } from "../support/core/process.ts";
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

// program 메시지로 열린 Project Manager session이다.
async function reactionSessions(core: Core, project: string) {
  const { sessions } = await core.call(agentSessionList, {
    agent: { role: "project_manager", project },
  });
  const found: string[] = [];
  for (const { id } of sessions) {
    const { messages } = await core.call(receivedMessageList, { session: id });
    if (messages[0]?.from.kind === "program") found.push(id);
  }
  return found;
}

Deno.test("E2E domain 폴더에 처음 쓴 kind 파일의 문서 위반은 domain problem이 되어 Project Manager를 한 번 부른다", async (t) => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const c = core;

    await t.step("first-kinds-file-opens-problem", async () => {
      const folder = `${c.run.work}/notes-project`;
      await Deno.mkdir(`${folder}/notes`, { recursive: true });
      await Deno.writeTextFile(`${folder}/notes/a.md`, "---\ntitle: a\n---\n");
      const { project } = await openProject(c, folder, "notes-project");
      fake.script([{ reply: { kind: "text", text: "noted" } }]);

      // active domain 폴더는 runtime child의 권한 폴더라 만들어지면 child가 다시 뜬다. 그 전에 끝낸다.
      const before = await runtimePids(c.run.home);
      const domain = await c.call(domainCreate, {
        name: "notes",
        title: "Notes",
        purpose: "Notes kept in this project",
        owner: { kind: "project", id: project },
      });
      if (before.length > 0) await settle(c, before);
      await Deno.mkdir(domainFolder(c.run.home, domain.id), {
        recursive: true,
      });
      await Deno.writeTextFile(domainKindsFile(c.run.home, domain.id), KINDS);

      const [problem] = await until("domain problem이 열림", async () => {
        const { problems } = await c.call(problemListDomain, {
          domain: domain.id,
          state: "open",
        });
        return problems.length > 0 ? problems : undefined;
      });
      const [session] = await until(
        "Project Manager session이 열림",
        async () => {
          const found = await reactionSessions(c, project);
          return found.length > 0 ? found : undefined;
        },
      );
      await waitTurnEnd(c, session!);

      // ledger: 문구(message)는 단정하지 않는다.
      const { message: _message, ...violation } = problem!.violation;
      assertEquals(violation, {
        source: "document",
        rule: "required",
        kind: "note",
        path: "notes/a.md",
        field: "status",
      });
      // route: turn의 place 정보가 kind.get으로 다시 sync해도 같은 위반이라 둘째 session이 열리지 않는다.
      assertEquals(await reactionSessions(c, project), [session]);
      // fake
      const journal = fake.journal();
      assertEquals(journal.length, 1);
      assertEquals(journal[0]!.mismatch, null);
    });
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
