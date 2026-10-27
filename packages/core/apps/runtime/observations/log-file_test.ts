import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createKnownSecretRegistry,
  createRedactionStream,
} from "../../../../base/redaction/mod.ts";
import {
  APP_LOG_FILE_MAX_BYTES,
  APP_LOG_TEXT_MAX_CHARS,
  appLogLineSchema,
} from "../../../../protocol/apps/app-log.ts";
import {
  appLogFile,
  appLogPreviousFile,
} from "../../../../protocol/apps/app-storage.ts";
import { createAppLogFile } from "./log-file.ts";
import type { ByteSource } from "./stream-decoder.ts";

const APP = "app_0aaaaaaaaaaaaaaaaaaaaaaaaa";
const INV = "inv_0123456789abcdefghjkmnpqrs";
const NOW = "2026-01-01T00:00:00.000Z";

// log-redact.ts의 lineRedactor와 같은 모양이다(core/main은 import하지 못한다).
function redactorOf(known: string): (line: string) => string {
  const registry = createKnownSecretRegistry();
  registry.register([known]);
  return (line) => {
    const stream = createRedactionStream(registry);
    return stream.push(line) + stream.finish();
  };
}

function sourceOf(text: string): ByteSource {
  const bytes = [new TextEncoder().encode(text)];
  return {
    read(buffer) {
      const next = bytes.shift();
      if (next === undefined) return Promise.resolve(null);
      buffer.set(next);
      return Promise.resolve(next.length);
    },
  };
}

function linesOf(path: string) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => appLogLineSchema.parse(JSON.parse(line)));
}

test("log file에 secret이 redaction 없이 남지 않는다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "lophn-app-log-"));
  try {
    const known = "KNOWN-secret-value-0123456789-abcdefghij";
    const token = "ghp_" + "a1B2c3D4e5".repeat(3);
    const log = createAppLogFile({
      dataRoot,
      app: APP,
      redact: redactorOf(known),
      now: () => NOW,
    });
    await log.attach(sourceOf(`token is ${token} ok\n`));
    await log.attach(sourceOf(`[inv=${INV}] echoed ${known} back\n`));
    log.append({ invocation: null, text: `exception Error: bad ${known}` });
    // 값이 300자 경계를 넘는다. 자르기 전에 redaction을 해야 앞 조각도 남지 않는다.
    log.append({
      invocation: null,
      text: "x".repeat(APP_LOG_TEXT_MAX_CHARS - 10) + known,
    });

    const raw = readFileSync(appLogFile(dataRoot, APP), "utf8");
    assert.ok(!raw.includes(known));
    assert.ok(!raw.includes(known.slice(0, 10)));
    assert.ok(!raw.includes(token));
    const lines = linesOf(appLogFile(dataRoot, APP));
    assert.deepStrictEqual(lines.length, 4);
    assert.deepStrictEqual(
      lines.map((line) => line.invocation),
      [null, INV, null, null],
    );
  } finally {
    await rm(dataRoot, { recursive: true });
  }
});

test("log file은 상한을 넘지 않는다. 넘치면 오래된 줄부터 버린다", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "lophn-app-log-"));
  try {
    const open = () =>
      createAppLogFile({
        dataRoot,
        app: APP,
        redact: (line) => line,
        now: () => NOW,
      });
    const numbered = (n: number) =>
      `${String(n).padStart(8, "0")} `.padEnd(APP_LOG_TEXT_MAX_CHARS, "x");
    const sizeOf = (path: string) => statSync(path).size;
    const current = appLogFile(dataRoot, APP);
    const previous = appLogPreviousFile(dataRoot, APP);

    // 한 줄이 JSON까지 380 byte쯤이라 16 MiB를 넘게 쓰려면 5만 줄이 넘어야 한다.
    const first = 50_000;
    let log = open();
    for (let n = 0; n < first; n++) {
      log.append({ invocation: null, text: numbered(n) });
    }
    assert.ok(sizeOf(current) <= APP_LOG_FILE_MAX_BYTES);
    assert.ok(sizeOf(previous) <= APP_LOG_FILE_MAX_BYTES);
    const numbers = [...linesOf(previous), ...linesOf(current)].map((line) =>
      Number(line.text.slice(0, 8)),
    );
    assert.deepStrictEqual(numbers.at(-1), first - 1);
    assert.ok(numbers[0] > 0);
    for (let i = 1; i < numbers.length; i++) {
      assert.deepStrictEqual(numbers[i], numbers[i - 1] + 1);
    }

    // supervisor가 다시 떠도 file에 남은 크기부터 센다.
    log = open();
    for (let n = first; n < first + 30_000; n++) {
      log.append({ invocation: null, text: numbered(n) });
    }
    assert.ok(sizeOf(current) <= APP_LOG_FILE_MAX_BYTES);
    assert.ok(sizeOf(previous) <= APP_LOG_FILE_MAX_BYTES);
  } finally {
    await rm(dataRoot, { recursive: true });
  }
});
