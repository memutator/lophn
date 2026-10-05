import { assertEquals } from "@std/assert";

import type { CoreCall } from "../../ipc/core.ts";
import type { CoreReply } from "../../ipc/core-api.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import {
  coreSettingsPort,
  READING_WIDTH_KEY,
  readingWidthStore,
  type SettingsPort,
} from "./reading-width.ts";

/** platform settings 하나를 흉내 낸다. 판 CAS와 저장값을 지킨다. */
function settingsCore(initial: unknown = null) {
  let value = initial;
  let revision = 4;
  const calls: CoreCall[] = [];
  const core: CoreSource = {
    subscribe: () => () => {},
    call(input): Promise<CoreReply> {
      calls.push(input);
      if (input.resource !== "settings") {
        return Promise.resolve({
          ok: false,
          error: { code: "not_found", message: "" },
        });
      }
      if (input.method === "get") {
        return Promise.resolve({
          ok: true,
          value: {
            settings: [{ key: READING_WIDTH_KEY, value }],
            revision,
          },
        });
      }
      const body = input.body as {
        input: { changes: { value: unknown }[] };
        compare: { revision: number };
      };
      if (body.compare.revision !== revision) {
        return Promise.resolve({
          ok: false,
          error: { code: "conflict", message: "" },
        });
      }
      value = body.input.changes[0]!.value;
      revision += 1;
      return Promise.resolve({
        ok: true,
        value: { result: { revision, changed: true, applied: [] } },
      });
    },
  };
  return {
    core,
    calls,
    stored: () => value,
    bump: () => {
      revision += 1;
    },
  };
}

async function settled(): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

Deno.test("shell/design-system#R23: 읽기 폭 선택은 platform settings의 전역 선택으로 저장한다", async () => {
  const fake = settingsCore("default");
  const store = readingWidthStore(coreSettingsPort(fake.core, () => "key-1"));
  await store.load();
  store.write("wide");
  assertEquals(store.read(), "wide");
  await settled();
  assertEquals(fake.stored(), "wide");
  const apply = fake.calls.find((call) => call.method === "apply")!;
  assertEquals(apply, {
    kind: "command",
    resource: "settings",
    method: "apply",
    body: {
      input: {
        changes: [{
          layer: "common",
          key: READING_WIDTH_KEY,
          action: "set",
          value: "wide",
        }],
      },
      idempotency_key: "key-1",
      compare: { revision: 4 },
      prepared: [],
    },
  });
});

Deno.test("shell/design-system#R23: 다른 문서와 재시작 뒤 같은 저장 폭을 읽고 모르는 값은 기본 폭이다", async () => {
  const fake = settingsCore("narrow");
  // 재시작은 같은 settings를 새 store로 다시 읽는 것이다.
  const restarted = readingWidthStore(coreSettingsPort(fake.core, () => "k"));
  await restarted.load();
  assertEquals(restarted.read(), "narrow");
  const unknown = readingWidthStore(
    coreSettingsPort(settingsCore("huge").core, () => "k"),
  );
  await unknown.load();
  assertEquals(unknown.read(), "default");
  const missing = readingWidthStore(
    coreSettingsPort(settingsCore(null).core, () => "k"),
  );
  await missing.load();
  assertEquals(missing.read(), "default");
});

Deno.test("shell/design-system#R23: 다른 창이 먼저 바꾼 판은 다시 읽고 한 번 더 저장한다", async () => {
  const fake = settingsCore("default");
  const store = readingWidthStore(coreSettingsPort(fake.core, () => "k"));
  await store.load();
  fake.bump();
  store.write("narrow");
  await settled();
  assertEquals(fake.stored(), "narrow");
  assertEquals(store.failed(), false);
});

Deno.test("shell/design-system#R23: 저장하지 못하면 앞의 폭으로 돌아가고 실패를 알린다", async () => {
  const port: SettingsPort = {
    get: () => Promise.resolve({ value: "default", revision: 1 }),
    apply: () => Promise.resolve({ ok: false, conflict: false }),
  };
  const store = readingWidthStore(port);
  await store.load();
  let notified = 0;
  store.subscribe(() => notified++);
  store.write("wide");
  assertEquals(store.read(), "wide");
  await settled();
  assertEquals(store.read(), "default");
  assertEquals(store.failed(), true);
  assertEquals(notified, 2);
});
