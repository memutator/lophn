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
  const upload = (handler: UploadHandler, input: Record<string, unknown>) => {
    const bytes = new TextEncoder().encode(VALUE);
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
  const names = async (): Promise<string[]> => {
    try {
      return Object.keys(
        JSON.parse(await readFile(join(root, "secrets.json"), "utf8")),
      );
    } catch {
      return [];
    }
  };
  return {
    setMode: (next: Mode) => (mode = next),
    envelopes,
    events,
    connect,
    answer,
    upload,
    askKey,
    names,
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
    // 둘 다 `provider.<id>`로 옮겨졌고 임시 이름은 없다.
    const stored = await t.names();
    assert.equal(stored.length, 2);
    assert.ok(stored.every((name) => /^provider\.[0-9a-z]+$/.test(name)));
    const seen = JSON.stringify([t.envelopes, t.events, connected, answered]);
    assert.equal(t.envelopes.length, 2);
    assert.ok(!seen.includes(VALUE));
  } finally {
    await t.close();
  }
});
