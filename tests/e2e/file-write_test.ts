// 세 질문
// - contract: boundary `agent-tools`(file tool의 scope는 place 폴더 안이고 data root는 닿지 않는다),
//   `run-loop`(runtime child는 권한 제한 없이 돌고 file tool이 닿는 폴더는 scope가 정한다).
//   architecture `place-session.md`의 "place 폴더가 범위".
// - 현실적 회귀: scope 검사에서 절대 경로·symlink·`..`가 새는 것. 권한 제한이 없으므로 scope가 유일한 방어라는
//   걸 잊고 느슨하게 하는 것.
// - 왜 지금 test로 못 잡나: scope_test는 함수 입력만 본다. child process를 건너 실제 file tool이 도는 길은
//   process를 띄워야 보인다.
import assert from "node:assert/strict";
import { lstat, mkdir, readFile, symlink } from "node:fs/promises";
import { test } from "node:test";
import { errorCode } from "../../packages/base/mod.ts";
import { agentFilePathOf } from "../../packages/core/agent-places/place/instruction-rules.ts";
import {
  toolCallList,
  LOPHN_AGENT_ID,
} from "../../packages/protocol/lophn-agent/mod.ts";
import {
  connectFakeProvider,
  openProject,
  openPlaceSession,
  say,
  waitTurnEnd,
} from "../support/core/human.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";

async function digest(path: string): Promise<string | null> {
  try {
    const bytes = new Uint8Array(await readFile(path));
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  return await lstat(path).then(
    () => true,
    () => false,
  );
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
    for (const dir of [proj, other, outside]) await mkdir(dir);
    await symlink(outside, `${proj}/link`);
    const { project } = await openProject(core, proj);
    await openProject(core, other);
    const session = await openPlaceSession(core, LOPHN_AGENT_ID, {
      kind: "project",
      id: project,
    });
    const definition = agentFilePathOf(run.home, {
      agent: "lophn",
      place: null,
    });
    assert.ok(definition !== null);
    const paths = {
      secrets: `${run.home}/secrets.json`,
      settings: `${run.home}/settings.json`,
      derived: `${run.home}/derived/lophn-agent/x`,
      other: `${other}/x.md`,
      definition,
    };
    const guarded = [paths.secrets, paths.settings, paths.definition];
    const before = await Promise.all(guarded.map(digest));
    assert.ok(before[0] !== null && before[1] !== null);

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
    assert.deepStrictEqual(await Promise.all(guarded.map(digest)), before);
    assert.deepStrictEqual(
      await Promise.all(
        [
          paths.derived,
          paths.other,
          `${outside}/leak.md`,
          `${proj}/note.md`,
        ].map(exists),
      ),
      [false, false, false, expected.note],
    );

    // ledger
    const { tool_calls: recorded } = await core.call(toolCallList, {
      turn: turn.id,
    });
    assert.deepStrictEqual(
      Object.fromEntries(recorded.map((c) => [c.response_key, c.outcome])),
      Object.fromEntries(
        calls.map((call) => [
          call.id,
          call.expect === "success"
            ? { kind: "success", code: "ok" }
            : { kind: "failure", code: "forbidden" },
        ]),
      ),
    );

    // fake가 받은 요청: 마지막 요청에 앞선 round의 결과까지 쌓여 있어, 낸 call id 전부가 tool_result로 돌아왔는지 본다.
    const journal = fake.journal();
    assert.deepStrictEqual(journal.length, table.length + 1);
    const body = journal[journal.length - 1].body as {
      messages: { role: string; content: unknown }[];
    };
    const returned = body.messages.flatMap((message) =>
      Array.isArray(message.content)
        ? message.content
            .filter((block) => block.type === "tool_result")
            .map((block: { tool_use_id: string }) => block.tool_use_id)
        : [],
    );
    assert.deepStrictEqual(
      returned.sort(),
      calls.map((call) => call.id).sort(),
    );
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

test("E2E project place session은 권한 제한 없이 도는 runtime에서도 data root의 비밀과 설정을 읽거나 쓰지 못하고, project 폴더에는 쓴다", async () => {
  await scope(
    (p): Row[][] => [
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
      [
        {
          id: "t-derived-write",
          name: "file_write",
          arguments: { path: p.derived, content: "x" },
          expect: "forbidden",
        },
      ],
    ],
    { note: true },
  );
});

test("E2E project place session은 다른 project 폴더와 자기 agent 정의 file에 쓰지 못한다", async () => {
  await scope(
    (p): Row[][] => [
      [
        {
          id: "t-other-project",
          name: "file_write",
          arguments: { path: p.other, content: "x" },
          expect: "forbidden",
        },
      ],
      [
        {
          id: "t-definition-write",
          name: "file_write",
          arguments: { path: p.definition, content: "x" },
          expect: "forbidden",
        },
      ],
    ],
    { note: false },
  );
});

test("E2E project place session은 project 폴더 안 symlink를 따라 밖에 쓰지 못한다", async () => {
  await scope(
    (): Row[][] => [
      [
        {
          id: "t-symlink-out",
          name: "file_write",
          arguments: { path: "link/leak.md", content: "x" },
          expect: "forbidden",
        },
      ],
    ],
    { note: false },
  );
});
