// 세 질문
// - contract: boundary `secrets`(값은 secrets.json에만 있고 전송 직전에만 붙는다), `models`(ModelCall 기록에는 header·credential이 없다).
// - 현실적 회귀: transport나 log 수정이 header 값을 기록에 흘리는 것, 새 route 출력에 secret 이름 옆 값이 붙는 것,
//   알려진 값 registry가 준비되기 전에 값을 child로 주는 것.
// - 왜 지금 test로 못 잡나: file-store_test·product-redactor_test 등은 저장·가림 함수만 본다. key가 child process에서 실제
//   HTTP header로 나가는 길과 그 뒤 ledger·log에 남은 것은 process를 건너고 disk 전체를 봐야 알 수 있다.
import { assert, assertEquals } from "@std/assert";
import {
  messageBody,
  modelCallList,
  providerList,
  providerRead,
  receivedMessageList,
  toolCallList,
} from "../../packages/protocol/lophn-agent/mod.ts";
import {
  SECRET_FILE_NAME,
  secretStatus,
} from "../../packages/protocol/secrets/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  openSession,
  say,
  waitTurnEnd,
} from "../support/core/human.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";

// 파일 안에 key가 byte로 들어 있는 file의 path 목록. secrets.json은 건너뛴다.
async function filesWith(dir: string, key: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      found.push(...await filesWith(path, key));
    } else if (entry.isFile && entry.name !== SECRET_FILE_NAME) {
      const text = new TextDecoder("latin1").decode(await Deno.readFile(path));
      if (text.includes(key)) found.push(path);
    }
  }
  return found;
}

Deno.test("E2E provider key는 model 요청 header에만 실리고 secrets.json 밖 어디에도 남지 않는다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    const key = `sk-e2e-${core.ids.newId("key").split("_").pop()}`;
    const { provider } = await connectFakeProvider(core, fake, { key });
    const session = await openSession(core, { role: "lophn" });
    fake.script([{ reply: { kind: "text", text: "ok" } }]);
    const sent = await say(core, session, "hello");
    const turn = await waitTurnEnd(core, session);

    // 1. fake가 받은 요청: key는 x-api-key 한 자리에만 있다.
    const [request] = fake.journal();
    assertEquals(request.headers["x-api-key"], key);
    const { "x-api-key": _sent, ...otherHeaders } = request.headers;
    assert(!JSON.stringify(otherHeaders).includes(key));
    assert(!JSON.stringify(request.body).includes(key));

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
    assert(!outputs.includes(key));
    assert(outputs.includes(provider));

    // 2. disk: 양성 대조로 secrets.json에는 있고, 나머지(core.log 포함)에는 없다.
    await core.stop();
    const secrets = `${run.home}/${SECRET_FILE_NAME}`;
    assert((await Deno.readTextFile(secrets)).includes(key));
    assertEquals((await Deno.stat(secrets)).mode! & 0o777, 0o600);
    assertEquals(await filesWith(run.dir, key), []);
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
