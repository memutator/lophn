import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createIdSource,
  err,
  ok,
  type Result,
  seededRandom,
} from "../../../base/mod.ts";
import {
  connectProvider,
  disconnectProvider,
  type ProviderRecord,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  builtinTarget,
  createKeyConnect,
  createProviderConnect,
  secretAnswerHandler,
} from "./connect-key.ts";
import { withProviderLogin } from "./login.ts";
import { createSecretFileStore } from "../../secrets/file-store.ts";
import { openSecretStore } from "../../secrets/secret-store.ts";
import { createQuestionWaits } from "../tools/questions/wait.ts";
import type { CommandEnvelope, Writer } from "../../storage/ledger/mod.ts";
import type { UploadHandler } from "../../server/mod.ts";

const VALUE = "sk-device-entered-7c41f0";
const DEVICE = {
  principal: "device:phone-1",
  actor: "user" as const,
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "device:phone-1",
};
const CLOCK = {
  nowMs: () => Date.parse("2026-11-18T00:00:00.000Z"),
  now: () => "2026-11-18T00:00:00.000Z",
};

type Mode = "ok" | "conflict" | "throws";

// 임시 폴더의 secret 저장소, 쓰기 앞 처리기(login.ts)를 지난 가짜 writer, 실제 질문 대기열로 두 입구를 한 번 준비한다.
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "lophn-connect-key-"));
  const store = openSecretStore({
    file: createSecretFileStore({ root }),
    channel: {
      register: () => Promise.resolve(ok(undefined)),
      revoke: () => Promise.resolve(ok(undefined)),
      setReady: () => Promise.resolve(ok(undefined)),
    },
    retryMs: 60_000,
  });
  await store.open();
  let mode: Mode = "ok";
  const envelopes: CommandEnvelope[] = [];
  const events: unknown[] = [];
  const inner: Writer = {
    command(_ctx, envelope) {
      envelopes.push(envelope);
      if (mode === "throws") throw new Error("writer worker is gone");
      if (mode === "conflict") {
        return Promise.resolve(
          err({ code: "conflict", message: "provider id already exists" }),
        );
      }
      return Promise.resolve(
        ok({
          result: { provider: { id: (envelope.input as { id: string }).id } },
          replayed: false,
          first_seq: null,
          last_seq: null,
        }),
      );
    },
    readResult: () => Promise.resolve(ok(null)),
    close: () => Promise.resolve(),
  };
  const ids = createIdSource({ clock: CLOCK, random: seededRandom(3) });
  const waits = createQuestionWaits({
    bus: { publish: (event) => events.push(event) },
    clock: CLOCK,
    ids,
  });
  const writer = withProviderLogin(inner, {
    http: () => Promise.reject(new Error("no issuer in this test")),
    openListener: () =>
      Promise.resolve(err({ code: "unavailable", message: "x" })),
    secrets: store,
    newKey: () => "key",
    nowMs: CLOCK.nowMs,
    random: seededRandom(5),
    target: builtinTarget,
    freshId: () => Promise.resolve(ok(ids.newId("pvd"))),
    requests: waits,
    changed: () => {},
    granted: () => true,
  });
  const keyDeps = {
    writer: () => writer,
    secrets: store,
    newKey: () => ids.newId("key"),
    tail: () => ids.newId("stg").slice(4),
  };
  const connect = createProviderConnect({
    ...keyDeps,
    listProviders: () => Promise.resolve(ok([])),
    target: builtinTarget,
    newId: () => ids.newId("pvd"),
  });
  const answer = secretAnswerHandler({
    keys: createKeyConnect(keyDeps),
    secrets: store,
    requests: waits,
  });
  const upload = (
    handler: UploadHandler,
    input: Record<string, unknown>,
    rawValue = VALUE,
  ) => {
    const bytes = new TextEncoder().encode(rawValue);
    return handler(
      DEVICE,
      { ...input, bytes: bytes.byteLength },
      {
        bytes: new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        length: bytes.byteLength,
      },
    );
  };
  // agent가 새 provider key를 청한 열린 요청 하나. view는 secret-slot이 만드는 모양이다.
  const askKey = () => {
    const id = ids.newId("pvd");
    const definition = builtinTarget("openrouter", "api_key");
    assert.ok(definition.ok);
    const asked = waits.askRequest(
      { session: "ses_01h455vb4pex5v6nkc6gd5fd10", turn: "" },
      {
        kind: "secret",
        slot: { provider: "openrouter" },
        name: `provider.${id.slice(4)}`,
        subject: "OpenRouter",
        destinations: [definition.value.endpoint],
        configured: false,
        connect: { id, ...definition.value },
      },
    );
    const opened = events.at(-1) as { payload: { tool_call: string } };
    return { asked, tool_call: opened.payload.tool_call };
  };
  const stored = async (): Promise<Record<string, string>> => {
    try {
      return JSON.parse(await readFile(join(root, "secrets.json"), "utf8"));
    } catch {
      return {};
    }
  };
  const names = async (): Promise<string[]> => Object.keys(await stored());
  return {
    setMode: (next: Mode) => (mode = next),
    envelopes,
    events,
    connect,
    answer,
    upload,
    askKey,
    names,
    stored,
    close: async () => {
      store.stop();
      await rm(root, { recursive: true, force: true });
    },
  };
}

const codeOf = (result: Result<unknown>) =>
  result.ok ? "ok" : result.error.code;

// 남은 임시 key는 쓰이지 않는 secret으로 쌓이고, 새 `provider.<id>`가 남으면 연결되지 않은 provider 이름에 값이 붙는다.
test("provider 연결이 중간에 실패하면 임시 secret도 새 provider 이름도 남지 않는다", async () => {
  const t = await setup();
  try {
    const cases: [Mode, Record<string, unknown>, string][] = [
      ["conflict", { target: { definition: "openrouter" } }, "conflict"],
      ["throws", { target: { definition: "openrouter" } }, "internal"],
      ["ok", { target: { definition: "no-such-provider" } }, "not_found"],
    ];
    for (const [mode, input, code] of cases) {
      t.setMode(mode);
      const result = await t.upload(t.connect.handlers.connectKey, input);
      assert.deepEqual([codeOf(result), await t.names()], [code, []]);
    }

    // agent 요청의 답: 연결이 실패하면 요청은 그 오류로 끝나고 값은 남지 않는다.
    t.setMode("conflict");
    const { asked, tool_call } = t.askKey();
    const answered = await t.upload(t.answer, {
      session: "ses_01h455vb4pex5v6nkc6gd5fd10",
      tool_call,
    });
    const finished = await asked;
    assert.deepEqual(
      [codeOf(answered), codeOf(finished), await t.names()],
      ["ok", "conflict", []],
    );
  } finally {
    await t.close();
  }
});

// 기기에서 넣은 key가 command 기록이나 event에 실리면 ledger와 화면, 다른 기기로 퍼진다.
test("기기에서 넣은 값은 secret 저장소에만 있고 command envelope·event·결과에는 없다", async () => {
  const t = await setup();
  try {
    t.setMode("ok");
    const connected = await t.upload(t.connect.handlers.connectKey, {
      target: {
        custom: {
          key: "my-gateway",
          name: "My gateway",
          base_url: "https://gateway.example.test/v1",
          protocol: "openai-chat-completions",
        },
      },
    });
    const { asked, tool_call } = t.askKey();
    const answered = await t.upload(t.answer, {
      session: "ses_01h455vb4pex5v6nkc6gd5fd10",
      tool_call,
    });
    const finished = await asked;
    assert.deepEqual(
      [codeOf(connected), codeOf(answered), finished],
      ["ok", "ok", ok({ stored: true })],
    );
    // 둘 다 `provider.<crd_id>`로 옮겨졌고 임시 이름은 없다.
    const stored = await t.names();
    assert.equal(stored.length, 2);
    assert.ok(stored.every((name) => /^provider\.crd_[0-9a-z]+$/.test(name)));
    const seen = JSON.stringify([t.envelopes, t.events, connected, answered]);
    assert.equal(t.envelopes.length, 2);
    assert.ok(!seen.includes(VALUE));
  } finally {
    await t.close();
  }
});

test("재기동 뒤 새 connect helper에서 Disconnect → Reconnect해도 같은 provider id를 이어 쓴다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-connect-reuse-"));
  const store = openSecretStore({
    file: createSecretFileStore({ root }),
    channel: {
      register: () => Promise.resolve(ok(undefined)),
      revoke: () => Promise.resolve(ok(undefined)),
      setReady: () => Promise.resolve(ok(undefined)),
    },
    retryMs: 60_000,
  });
  await store.open();
  try {
    // 프로세스 간에 유지되는 ledger 상태를 흉내 낸다.
    const providers = new Map<string, ProviderRecord>();
    const ids = createIdSource({ clock: CLOCK, random: seededRandom(11) });
    const inner: Writer = {
      command(_ctx, envelope) {
        if (envelope.command === connectProvider.name) {
          const input = envelope.input as {
            id: string;
            name: string;
            definition: ProviderRecord["definition"];
            endpoint: string;
            protocol: ProviderRecord["protocol"];
          };
          const record = {
            id: input.id,
            name: input.name,
            definition: input.definition,
            endpoint: input.endpoint,
            protocol: input.protocol,
            credentials: [{ id: `crd_${input.id.slice(4)}` }],
            revision: 1,
          } as unknown as ProviderRecord;
          providers.set(input.id, record);
          return Promise.resolve(
            ok({
              result: { provider: record },
              replayed: false,
              first_seq: null,
              last_seq: null,
            }),
          );
        }
        if (envelope.command === disconnectProvider.name) {
          const { provider } = envelope.input as { provider: string };
          providers.delete(provider);
          return Promise.resolve(
            ok({
              result: { provider },
              replayed: false,
              first_seq: null,
              last_seq: null,
            }),
          );
        }
        throw new Error(`unexpected command ${envelope.command}`);
      },
      readResult: () => Promise.resolve(ok(null)),
      close: () => Promise.resolve(),
    };
    const waits = createQuestionWaits({
      bus: { publish: () => {} },
      clock: CLOCK,
      ids,
    });
    const mount = () => {
      let writer: Writer;
      const connect = createProviderConnect({
        writer: () => writer,
        secrets: store,
        listProviders: () => Promise.resolve(ok([...providers.values()])),
        target: builtinTarget,
        newId: () => ids.newId("pvd"),
        newKey: () => ids.newId("idk"),
        tail: () => ids.newId("stg").slice(4),
      });
      writer = withProviderLogin(inner, {
        http: () => Promise.reject(new Error("no issuer")),
        openListener: () =>
          Promise.resolve(err({ code: "unavailable", message: "x" })),
        secrets: store,
        newKey: () => ids.newId("idk"),
        nowMs: CLOCK.nowMs,
        random: seededRandom(13),
        target: builtinTarget,
        freshId: connect.freshId,
        readProvider: (_who, id) =>
          Promise.resolve(ok(providers.get(id) ?? null)),
        rememberId: connect.remember,
        requests: waits,
        changed: () => {},
        granted: () => true,
      });
      return { connect, writer };
    };
    const connectAnthropic = (
      connect: ReturnType<typeof createProviderConnect>,
    ) => {
      const bytes = new TextEncoder().encode(VALUE);
      return connect.handlers.connectKey(
        DEVICE,
        { target: { definition: "anthropic" }, bytes: bytes.byteLength },
        {
          bytes: new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
          length: bytes.byteLength,
        },
      );
    };

    // 1) 처음 연결해 pvd id를 받는다.
    const firstBoot = mount();
    const first = await connectAnthropic(firstBoot.connect);
    assert.ok(first.ok);
    const firstId = (first.value as { provider: ProviderRecord }).provider.id;

    // 2) core 재기동을 흉내 내어 빈 ids Map을 가진 새 connect/login helper를 만든다.
    const secondBoot = mount();
    const disconnected = await secondBoot.writer.command(DEVICE, {
      command: disconnectProvider.name,
      input: { provider: firstId },
      idempotency_key: ids.newId("idk"),
      compare: { revision: 1 },
      prepared: [],
    });
    assert.ok(disconnected.ok);
    assert.equal(providers.size, 0);

    // 3) 같은 정의(anthropic)를 다시 이으면 새 id가 아니라 firstId를 재사용한다.
    const second = await connectAnthropic(secondBoot.connect);
    assert.ok(second.ok);
    assert.equal(
      (second.value as { provider: ProviderRecord }).provider.id,
      firstId,
    );
  } finally {
    store.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("API key의 앞뒤 공백은 떼고 저장하며 내부 공백·줄바꿈은 invalid_input으로 거절한다", async () => {
  const t = await setup();
  try {
    for (const bad of [
      "   \n\t ",
      "sk-ant-123 word1 word2",
      "sk-ant-123\nfoo",
    ]) {
      const rejected = await t.upload(
        t.connect.handlers.connectKey,
        { target: { definition: "anthropic" } },
        bad,
      );
      assert.ok(!rejected.ok);
      assert.equal(rejected.error.code, "invalid_input");
      assert.deepEqual(await t.names(), []);
    }

    // 앞뒤 공백·줄바꿈은 제거되어 저장된다.
    const trimmed = await t.upload(
      t.connect.handlers.connectKey,
      { target: { definition: "anthropic" } },
      `  ${VALUE}\n`,
    );
    assert.ok(trimmed.ok);
    const values = Object.values(await t.stored());
    assert.deepEqual(values, [VALUE]);

    // agent의 provider secret 요청도 내부 공백은 거절하고 요청을 열린 채 둔다(재시도 가능).
    const { asked, tool_call } = t.askKey();
    const badAnswer = await t.upload(
      t.answer,
      { session: "ses_01h455vb4pex5v6nkc6gd5fd10", tool_call },
      "sk-ant-bad key",
    );
    assert.ok(!badAnswer.ok);
    assert.equal(badAnswer.error.code, "invalid_input");
    assert.match(badAnswer.error.message, /spaces or newlines/);

    const goodAnswer = await t.upload(
      t.answer,
      { session: "ses_01h455vb4pex5v6nkc6gd5fd10", tool_call },
      ` ${VALUE} `,
    );
    assert.ok(goodAnswer.ok);
    assert.deepEqual(await asked, ok({ stored: true }));
    assert.deepEqual(Object.values(await t.stored()), [VALUE, VALUE]);
  } finally {
    await t.close();
  }
});
