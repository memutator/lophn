// 세 질문
// - contract: boundary `secrets`(값은 secrets.json에만 있고 전송 직전에만 붙으며 ledger·event·log·오류·model 입력에 없다),
//   `models`(ModelCall 기록에는 header·credential이 없고 오류는 고정 문장), `run-loop`(child가 보낼 글을 core의 redaction 길로 지운다).
// - 현실적 회귀: transport나 log 수정이 header 값을 기록에 흘리는 것, tool 결과나 provider 오류 본문이 key를 되울려 blob·ledger에 남는 것,
//   바꾼 key가 옛 key로 전송되는 것, 지운 key로 인증 없는 요청이 나가는 것, 알려진 값 registry가 준비되기 전에 값을 child로 주는 것.
// - 왜 지금 test로 못 잡나: file-store_test·product-redactor_test·secret-refs_test 등은 저장·가림 함수만 본다. key가 child process에서
//   실제 HTTP header로 나가는 길, redaction 길(child -> 감독 pipe -> core), 바꾸기·지우기, 그 뒤 ledger·log에 남은 것은 process를
//   건너고 disk 전체를 봐야 알 수 있다.
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { test } from "node:test";
import {
  workspaceSessionRead,
  messageBody,
  modelCallList,
  providerList,
  providerRead,
  receivedMessageList,
  toolCallList,
  turnBodyView,
  turnRead,
  LOPHN_AGENT_ID,
} from "../../packages/protocol/lophn-agent/mod.ts";
import {
  SECRET_FILE_NAME,
  secretDelete,
  secretStatus,
} from "../../packages/protocol/secrets/mod.ts";
import {
  connectFakeProvider,
  openProject,
  openWorkspaceSession,
  say,
  waitTurnEnd,
} from "../support/core/human.ts";
import {
  bootCore,
  type Core,
  createRun,
  type Run,
} from "../support/core/mod.ts";
import {
  type FakeServer,
  startFakeServer,
} from "../support/fake-server/mod.ts";

// 파일 안에 key가 byte로 들어 있는 file의 path 목록. secrets.json은 건너뛴다.
async function filesWith(dir: string, key: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...(await filesWith(path, key)));
    } else if (entry.isFile() && entry.name !== SECRET_FILE_NAME) {
      const text = new TextDecoder("latin1").decode(await readFile(path));
      if (text.includes(key)) found.push(path);
    }
  }
  return found;
}

type Keyed = {
  run: Run;
  fake: FakeServer;
  core: Core;
  provider: string;
  /** 첫 key. 마지막 단정(secrets.json 밖 어디에도 없다)이 keys 모두를 본다. */
  key: string;
  keys: string[];
  /** 사람이 project 폴더에 직접 둔 file. disk 검사에서 뺀다. */
  planted: string[];
};

// core를 띄우고 key 있는 fake provider를 붙인 채 body를 돈 뒤, core를 멈추고 secrets.json 밖에 key가 없음을 본다.
// secrets.json에 대한 단정은 core가 멈춘 뒤 afterStop이 한다.
async function withKeyedCore(
  body: (ctx: Keyed) => Promise<void>,
  afterStop: (secretsText: string, ctx: Keyed) => void | Promise<void>,
): Promise<void> {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    const key = `sk-e2e-${core.ids.newId("key").split("_").pop()}`;
    const { provider } = await connectFakeProvider(core, fake, { key });
    const ctx: Keyed = {
      run,
      fake,
      core,
      provider,
      key,
      keys: [key],
      planted: [],
    };
    await body(ctx);
    await core.stop();
    const secrets = `${run.home}/${SECRET_FILE_NAME}`;
    await afterStop(await readFile(secrets, "utf8"), ctx);
    assert.deepStrictEqual((await stat(secrets)).mode! & 0o777, 0o600);
    for (const each of ctx.keys) {
      assert.deepStrictEqual(
        (await filesWith(run.dir, each)).filter(
          (path) => !ctx.planted.includes(path),
        ),
        [],
      );
    }
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
}

// turn의 ledger 읽기 출력 모음. tool 입력·결과 blob은 사람 화면이 여는 길(body-view)로 읽는다.
async function ledgerText(
  core: Core,
  session: string,
  turn: string,
): Promise<string> {
  const { tool_calls: calls } = await core.call(toolCallList, { turn });
  const bodies = [];
  for (const call of calls) {
    bodies.push(
      await core.call(turnBodyView, { kind: "tool_call_input", id: call.id }),
    );
    if (call.output !== null) {
      bodies.push(
        await core.call(turnBodyView, {
          kind: "tool_call_output",
          id: call.id,
        }),
      );
    }
  }
  return JSON.stringify([
    calls,
    bodies,
    await core.call(modelCallList, { session }),
    await core.call(receivedMessageList, { session }),
    await core.call(workspaceSessionRead, { session }),
    await core.call(turnRead, { turn }),
  ]);
}

test("E2E provider key는 model 요청 header에만 실리고 secrets.json 밖 어디에도 남지 않는다", async () => {
  await withKeyedCore(
    async ({ core, fake, provider, key }) => {
      const session = await openWorkspaceSession(core, LOPHN_AGENT_ID);
      fake.script([{ reply: { kind: "text", text: "ok" } }]);
      const sent = await say(core, session, "hello");
      const turn = await waitTurnEnd(core, session);

      // 1. fake가 받은 요청: key는 x-api-key 한 자리에만 있다.
      const [request] = fake.journal();
      assert.deepStrictEqual(request.headers["x-api-key"], key);
      const { "x-api-key": _sent, ...otherHeaders } = request.headers;
      assert.ok(!JSON.stringify(otherHeaders).includes(key));
      assert.ok(!JSON.stringify(request.body).includes(key));

      // 3. route 출력(꺼내기 전에 core를 살려 둔다).
      const outputs = JSON.stringify([
        await core.call(providerRead, { provider }),
        await core.call(providerList, {}),
        await core.call(modelCallList, { session }),
        // messages/list는 runtime(machine)만 부른다. 사람이 읽는 길은 이 둘이다.
        await core.call(receivedMessageList, { session }),
        await core.call(messageBody, { message: sent.message }),
        await core.call(toolCallList, { turn: turn.id }),
        await core.call(secretStatus, {}),
      ]);
      assert.ok(!outputs.includes(key));
      assert.ok(outputs.includes(provider));
    },
    (secrets, { key }) => {
      // 2. disk: 양성 대조로 secrets.json에는 있다. 나머지(core.log 포함)에 없음은 helper가 본다.
      assert.ok(secrets.includes(key));
    },
  );
});

test("E2E tool 결과에 key가 들어 있어도 model 요청·ledger·disk에서 지워진다", async () => {
  await withKeyedCore(
    async ({ run, core, fake, key, planted }) => {
      const folder = `${run.work}/proj`;
      await mkdir(folder);
      await writeFile(`${folder}/.env`, `API_KEY=${key}\n`);
      planted.push(`${folder}/.env`);
      const { project } = await openProject(core, folder);
      const session = await openWorkspaceSession(core, LOPHN_AGENT_ID, {
        kind: "project",
        id: project,
      });
      fake.script([
        {
          reply: {
            kind: "tool",
            calls: [
              {
                id: "t1",
                name: "file_read",
                arguments: JSON.stringify({ path: ".env" }),
              },
              {
                id: "t2",
                name: "shell_run",
                arguments: JSON.stringify({
                  command: `cat ${run.home}/${SECRET_FILE_NAME}; env`,
                }),
              },
            ],
          },
        },
        { reply: { kind: "text", text: "done" } },
      ]);
      await say(core, session, "read the env file");
      const turn = await waitTurnEnd(core, session);

      // fake: 둘째 요청에 key도, LOPHN_ 환경 변수도, user token도 없다. 첫 요청 header에는 key가 있다.
      const [first, second] = fake.journal();
      assert.deepStrictEqual(first.headers["x-api-key"], key);
      const sent = JSON.stringify(second.body);
      assert.ok(
        sent.includes("API_KEY="),
        "tool 결과가 둘째 요청에 실려야 한다",
      );
      assert.ok(!sent.includes(key));
      assert.ok(!sent.includes("LOPHN_"));
      assert.ok(!sent.includes(core.token));

      // ledger: tool 결과 blob까지.
      assert.ok(!(await ledgerText(core, session, turn.id)).includes(key));
    },
    () => {},
  );
});

test("E2E key를 바꾸면 다음 turn은 새 key를 쓰고 옛 key는 어디에도 없다", async () => {
  await withKeyedCore(
    async (ctx) => {
      const { core, fake, provider, key: first } = ctx;
      const second = `sk-e2e-${core.ids.newId("key").split("_").pop()}`;
      ctx.keys.push(second);
      const session = await openWorkspaceSession(core, LOPHN_AGENT_ID);
      fake.script([
        { reply: { kind: "text", text: "one" } },
        { reply: { kind: "text", text: "two" } },
      ]);
      await say(core, session, "hello");
      await waitTurnEnd(core, session);
      const put = await core.upload(
        `provider.${provider.slice("pvd_".length)}`,
        new TextEncoder().encode(second),
      );
      assert.ok(put.ok);
      await say(core, session, "again");
      await waitTurnEnd(core, session, 1);

      const [one, two] = fake.journal();
      assert.deepStrictEqual(one.headers["x-api-key"], first);
      assert.deepStrictEqual(two.headers["x-api-key"], second);
      const outputs = JSON.stringify([
        await core.call(providerRead, { provider }),
        await core.call(modelCallList, { session }),
      ]);
      assert.ok(!outputs.includes(first) && !outputs.includes(second));
    },
    (secrets, { keys: [first, second] }) => {
      assert.ok(secrets.includes(second));
      assert.ok(!secrets.includes(first));
    },
  );
});

test("E2E key를 지우면 다음 turn은 요청을 보내지 않고 실패한다", async () => {
  await withKeyedCore(
    async ({ core, fake, provider }) => {
      const session = await openWorkspaceSession(core, LOPHN_AGENT_ID);
      fake.script([{ reply: { kind: "text", text: "one" } }]);
      await say(core, session, "hello");
      await waitTurnEnd(core, session);
      await core.call(secretDelete, {
        name: `provider.${provider.slice("pvd_".length)}`,
      });
      await say(core, session, "again");
      const turn = await waitTurnEnd(core, session, 1);

      assert.deepStrictEqual(fake.journal().length, 1);
      assert.deepStrictEqual(turn.outcome, {
        kind: "failed",
        reason: "configuration_unavailable",
      });
    },
    (secrets, { key }) => {
      assert.ok(!secrets.includes(key));
    },
  );
});

test("E2E provider 오류 본문이 key를 되울려도 ledger·log에 남지 않는다", async () => {
  await withKeyedCore(
    async ({ core, fake, key }) => {
      const session = await openWorkspaceSession(core, LOPHN_AGENT_ID);
      fake.script([
        {
          reply: {
            kind: "error",
            status: 401,
            body: JSON.stringify({
              type: "error",
              error: {
                type: "authentication_error",
                message: `invalid x-api-key: ${key}`,
              },
            }),
          },
        },
      ]);
      await say(core, session, "hello");
      const turn = await waitTurnEnd(core, session);

      assert.deepStrictEqual(fake.journal().length, 1);
      assert.deepStrictEqual(turn.outcome?.kind, "failed");
      assert.ok(!(await ledgerText(core, session, turn.id)).includes(key));
    },
    () => {},
  );
});
