// 세 질문
// - contract: boundary `agent-tools`(file tool의 scope는 place 폴더 안이고 data root는 닿지 않는다),
//   `run-loop`(runtime Deno 권한은 data root 읽기와 `derived/lophn-agent` 쓰기, 모든 project 폴더 쓰기를 열어 둔다).
//   architecture `place-session.md`의 "place 폴더가 범위".
// - 현실적 회귀: runtime child의 --allow-write에서 place 폴더가 빠져 NotCapable로 쓰기가 실패하는 것(이미 한 번 난 일),
//   scope 검사에서 절대 경로·symlink·`..`가 새는 것, Deno 권한이 넓은 상태에서 scope가 유일한 방어라는 걸 잊고 느슨하게 하는 것.
// - 왜 지금 test로 못 잡나: scope_test는 함수 입력만 본다. Deno 권한은 열렸는데 scope만 막는 경로는
//   runtime 권한 목록과 scope를 함께 보아야 하고, process를 건너야만 보인다.
import { assert, assertEquals } from "@std/assert";
import { agentFilePathOf } from "../../packages/core/agent-roles/place/instruction-rules.ts";
import { toolCallList } from "../../packages/protocol/lophn-agent/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  openProject,
  openSession,
  say,
  waitTurnEnd,
} from "../support/core/human.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";

async function digest(path: string): Promise<string | null> {
  try {
    const bytes = await Deno.readFile(path);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  return await Deno.lstat(path).then(() => true, () => false);
}

type Row = {
  id: string;
  name: "file_read" | "file_write";
  arguments: Record<string, string>;
  expect: "success" | "forbidden";
};

// 쓰기 call이 거절되면 같은 reply의 나머지 call은 시작하지 않는다(tool-batch). 그래서 거절되는 쓰기는 reply마다 하나다.
// 읽기 거절은 뒤 call을 막지 않는다. case 하나의 fake 대답은 3 이하라 거절되는 쓰기 둘씩 case를 나눈다.
async function scope(
  rounds: (paths: Paths) => Row[][],
  expected: { note: boolean },
) {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake, { key: "sk-e2e-secret" });
    const proj = `${run.work}/proj`;
    const other = `${run.work}/other`;
    const outside = `${run.work}/outside`;
    for (const dir of [proj, other, outside]) await Deno.mkdir(dir);
    await Deno.symlink(outside, `${proj}/link`);
    // 둘째 등록 때 runtime이 다시 뜨므로 session은 그 뒤에 연다.
    const { project } = await openProject(core, proj);
    await openProject(core, other);
    const session = await openSession(core, {
      role: "project_manager",
      project,
    });
    const definition = agentFilePathOf(run.home, {
      role: "project_manager",
      operator: null,
      place: { kind: "project", id: project },
    });
    assert(definition !== null);
    const paths = {
      secrets: `${run.home}/secrets.json`,
      settings: `${run.home}/settings.json`,
      derived: `${run.home}/derived/lophn-agent/x`,
      other: `${other}/x.md`,
      definition,
    };
    const guarded = [paths.secrets, paths.settings, paths.definition];
    const before = await Promise.all(guarded.map(digest));
    assert(before[0] !== null && before[1] !== null);

    const table = rounds(paths);
    const calls = table.flat();
    fake.script([
      ...table.map((round) => ({
        reply: {
          kind: "tool" as const,
          calls: round.map((call) => ({
            id: call.id,
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          })),
        },
      })),
      { reply: { kind: "text", text: "done" } },
    ]);
    await say(core, session, "write the note");
    const turn = await waitTurnEnd(core, session);

    // disk
    assertEquals(await Promise.all(guarded.map(digest)), before);
    assertEquals(
      await Promise.all(
        [paths.derived, paths.other, `${outside}/leak.md`, `${proj}/note.md`]
          .map(exists),
      ),
      [false, false, false, expected.note],
    );

    // ledger
    const { tool_calls: recorded } = await core.call(toolCallList, {
      turn: turn.id,
    });
    assertEquals(
      Object.fromEntries(recorded.map((c) => [c.response_key, c.outcome])),
      Object.fromEntries(calls.map((call) => [
        call.id,
        call.expect === "success"
          ? { kind: "success", code: "ok" }
          : { kind: "failure", code: "forbidden" },
      ])),
    );

    // fake가 받은 요청: 마지막 요청에 앞선 round의 결과까지 쌓여 있어, 낸 call id 전부가 tool_result로 돌아왔는지 본다.
    const journal = fake.journal();
    assertEquals(journal.length, table.length + 1);
    const body = journal[journal.length - 1].body as {
      messages: { role: string; content: unknown }[];
    };
    const returned = body.messages.flatMap((message) =>
      Array.isArray(message.content)
        ? message.content.filter((block) => block.type === "tool_result").map((
          block: { tool_use_id: string },
        ) => block.tool_use_id)
        : []
    );
    assertEquals(returned.sort(), calls.map((call) => call.id).sort());
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
}

type Paths = {
  secrets: string;
  settings: string;
  derived: string;
  other: string;
  definition: string;
};

Deno.test("E2E PM은 Deno 권한이 열린 data root의 비밀과 설정을 읽거나 쓰지 못하고, project 폴더에는 쓴다", async () => {
  await scope((p): Row[][] => [
    [
      {
        id: "t-note",
        name: "file_write",
        arguments: { path: "note.md", content: "hello" },
        expect: "success",
      },
      {
        id: "t-secrets-read",
        name: "file_read",
        arguments: { path: p.secrets },
        expect: "forbidden",
      },
      {
        id: "t-definition-read",
        name: "file_read",
        arguments: { path: p.definition },
        expect: "forbidden",
      },
      {
        id: "t-settings-write",
        name: "file_write",
        arguments: { path: p.settings, content: "{}" },
        expect: "forbidden",
      },
    ],
    [{
      id: "t-derived-write",
      name: "file_write",
      arguments: { path: p.derived, content: "x" },
      expect: "forbidden",
    }],
  ], { note: true });
});

Deno.test("E2E PM은 다른 project 폴더와 자기 agent 정의 file에 쓰지 못한다", async () => {
  await scope((p): Row[][] => [
    [{
      id: "t-other-project",
      name: "file_write",
      arguments: { path: p.other, content: "x" },
      expect: "forbidden",
    }],
    [{
      id: "t-definition-write",
      name: "file_write",
      arguments: { path: p.definition, content: "x" },
      expect: "forbidden",
    }],
  ], { note: false });
});

Deno.test("E2E PM은 project 폴더 안 symlink를 따라 밖에 쓰지 못한다", async () => {
  await scope((): Row[][] => [[{
    id: "t-symlink-out",
    name: "file_write",
    arguments: { path: "link/leak.md", content: "x" },
    expect: "forbidden",
  }]], { note: false });
});
