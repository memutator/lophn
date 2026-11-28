// 세 질문
// - contract: boundary `agent-tools`(file tool은 workspace 폴더 안에만 묻지 않고 쓰고, 폴더 밖은 사람이 허락하기 전에는
//   닿지 않으며, data root의 secret·설정·agent 정의는 허락으로도 열리지 않는다), `run-loop`(runtime child는 권한 제한 없이 돌고
//   file tool이 닿는 폴더는 판정이 정한다). architecture `approval.md`의 "바깥 폴더와 민감·자기 보호 경로".
// - 현실적 회귀: 판정에서 절대 경로·symlink·`..`가 새는 것, 폴더 밖 쓰기가 묻지 않고 실행되는 것, 자기 보호 경로가 ask로 내려가는 것.
// - 왜 지금 test로 못 잡나: 판정 test는 함수 입력만 본다. child process를 건너 실제 file tool이 도는 길과 사람의 거절이 turn을
//   다시 흐르게 하는 길은 process를 띄워야 보인다.
import assert from "node:assert/strict";
import { lstat, mkdir, readFile, symlink } from "node:fs/promises";
import { test } from "node:test";
import { errorCode } from "../../packages/base/mod.ts";
import { agentFilePathOf } from "../../packages/core/agent-workspaces/workspace/instruction-rules.ts";
import { toolCallList } from "../../packages/protocol/lophn-agent/mod.ts";
import {
  connectFakeProvider,
  decide,
  openProject,
  openLophnSession,
  say,
  waitPermission,
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
  // denied: 자기 보호 경로라 사람에게 묻지 않고 거부. asked: 폴더 밖이라 사람에게 묻고 test가 reject한다.
  expect: "success" | "denied" | "asked";
};

// 쓰기 call이 거부되면 같은 reply의 나머지 call은 시작하지 않는다(tool-batch). 그래서 묻거나 거부되는 쓰기는 reply마다 하나다.
// 묻는 call은 reply마다 하나이고 그 reply가 끝나기 전에 test가 reject한다. case 하나의 fake 대답은 3 이하다.
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
    // 폴더 연결은 junction으로 만든다. Windows에서 권한이 필요 없고 POSIX는 type을 무시한다.
    await symlink(outside, `${proj}/link`, "junction");
    const { project } = await openProject(core, proj);
    await openProject(core, other);
    const session = await openLophnSession(core, {
      kind: "project",
      id: project,
    });
    const definition = agentFilePathOf(run.home, {
      agent: "lophn_home",
      workspace: null,
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
    for (const round of table) {
      if (!round.some((call) => call.expect === "asked")) continue;
      const { request } = await waitPermission(core, session);
      await decide(core, session, request, "reject");
    }
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
            : {
                kind: "not_executed",
                code: call.expect === "asked" ? "rejected" : "denied",
              },
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

test("E2E project workspace session은 권한 제한 없이 도는 runtime에서도 data root의 비밀을 읽거나 설정을 쓰지 못하고, 폴더 밖 쓰기는 사람이 거절하면 실행되지 않으며, project 폴더에는 묻지 않고 쓴다", async () => {
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
          expect: "denied",
        },
        {
          id: "t-settings-write",
          name: "file_write",
          arguments: { path: p.settings, content: "{}" },
          expect: "denied",
        },
      ],
      [
        {
          id: "t-derived-write",
          name: "file_write",
          arguments: { path: p.derived, content: "x" },
          expect: "asked",
        },
      ],
    ],
    { note: true },
  );
});

test("E2E project workspace session은 다른 project 폴더에는 사람이 거절하면 쓰지 못하고 자기 agent 정의 file에는 묻지도 못한다", async () => {
  await scope(
    (p): Row[][] => [
      [
        {
          id: "t-other-project",
          name: "file_write",
          arguments: { path: p.other, content: "x" },
          expect: "asked",
        },
      ],
      [
        {
          id: "t-definition-write",
          name: "file_write",
          arguments: { path: p.definition, content: "x" },
          expect: "denied",
        },
      ],
    ],
    { note: false },
  );
});

test("E2E project workspace session은 project 폴더 안 symlink를 따라 밖에 쓰려 하면 사람에게 묻고 거절하면 쓰지 못한다", async () => {
  await scope(
    (): Row[][] => [
      [
        {
          id: "t-symlink-out",
          name: "file_write",
          arguments: { path: "link/leak.md", content: "x" },
          expect: "asked",
        },
      ],
    ],
    { note: false },
  );
});
