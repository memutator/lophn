import { assertEquals, assertThrows } from "@std/assert";
import { createLogger, type LogLevel, type LogRecord } from "./log.ts";

const AT = "2026-10-04T00:00:00.000Z";
const event = { component: "ledger", event: "CommandRejected" };

Deno.test("platform/diagnostics#R11: default info drops debug", async () => {
  const records: LogRecord[] = [];
  const logger = createLogger({
    now: () => AT,
    sink: (record) => {
      records.push(record);
    },
  });
  logger.debug(event);
  logger.info(event);
  logger.warn(event);
  logger.error(event);
  await logger.flush();
  assertEquals(records.map((record) => record.level), [
    "info",
    "warn",
    "error",
  ]);
  assertEquals(records.some((record) => record.dropped !== undefined), false);
});

Deno.test("platform/diagnostics#R11: explicit level keeps only its level and above", async () => {
  const levels: LogLevel[] = ["debug", "info", "warn", "error"];
  for (const [index, level] of levels.entries()) {
    const records: LogRecord[] = [];
    const logger = createLogger({
      now: () => AT,
      level,
      sink: (record) => {
        records.push(record);
      },
    });
    for (const level of levels) logger.log({ ...event, level });
    await logger.flush();
    assertEquals(records.map((record) => record.level), levels.slice(index));
  }
});

Deno.test("platform/diagnostics#R2: record shape and injected field filter", async () => {
  const records: LogRecord[] = [];
  const logger = createLogger({
    now: () => AT,
    filter: (fields) => ({ code: fields.code }),
    sink: (record) => {
      records.push(record);
    },
  });
  logger.info({
    ...event,
    message: "safe description",
    fields: { code: "conflict", secret: "raw" },
  });
  logger.info(event);
  await logger.flush();
  assertEquals(records, [
    {
      at: AT,
      level: "info",
      ...event,
      message: "safe description",
      fields: { code: "conflict" },
    },
    { at: AT, level: "info", ...event, fields: {} },
  ]);
});

Deno.test("platform/diagnostics#R2: queued fields are a snapshot and filter failure never leaks raw input", async () => {
  const records: LogRecord[] = [];
  const fields = { safe: "original" };
  const logger = createLogger({
    now: () => AT,
    sink: (record) => {
      records.push(record);
    },
  });
  logger.info({ ...event, fields });
  fields.safe = "changed";
  await logger.flush();
  assertEquals(records[0].fields, { safe: "original" });
  const filtered = createLogger({
    now: () => AT,
    filter: (fields) => {
      if (fields.secret) throw new Error("redaction failed");
      return fields;
    },
    sink: (record) => {
      records.push(record);
    },
  });
  filtered.info({ ...event, fields: { secret: "raw" } });
  filtered.info(event);
  await filtered.flush();
  assertEquals(records.length, 2);
  assertEquals(records[1].dropped, 1);
  assertEquals(records[1].fields, {});
});

Deno.test("platform/diagnostics#R3: blocked sink does not block calls and overflow is reported next", async () => {
  const records: LogRecord[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const bytes = new TextEncoder().encode(
    JSON.stringify({ at: AT, level: "info", ...event, fields: {} }),
  ).byteLength;
  const logger = createLogger({
    now: () => AT,
    maxPendingBytes: bytes,
    sink: async (record) => {
      records.push(record);
      if (records.length === 1) await blocked;
    },
  });
  assertEquals(logger.info(event), undefined);
  assertEquals(records.length, 0);
  await Promise.resolve();
  assertEquals(records.length, 1);
  assertEquals(logger.info(event), undefined);
  logger.info(event);
  logger.info(event);
  let flushed = false;
  const firstFlush = logger.flush().then(() => {
    flushed = true;
  });
  const secondFlush = logger.flush();
  await Promise.resolve();
  assertEquals(flushed, false);
  assertEquals(records.length, 1);
  release();
  await Promise.all([firstFlush, secondFlush]);
  assertEquals(records.length, 2);
  assertEquals(records[1].dropped, 2);
  logger.info(event);
  await logger.flush();
  assertEquals(records[2].dropped, undefined);
});

Deno.test("platform/diagnostics#R3: sink failures do not stop draining", async () => {
  const records: LogRecord[] = [];
  let calls = 0;
  const logger = createLogger({
    now: () => AT,
    sink: (record) => {
      if (++calls === 1) throw new Error("sink failed");
      if (calls === 2) return Promise.reject(new Error("sink rejected"));
      records.push(record);
    },
  });
  logger.info(event);
  logger.info(event);
  logger.info(event);
  await logger.flush();
  assertEquals(calls, 3);
  assertEquals(records[0].dropped, 2);
  logger.info(event);
  await logger.flush();
  assertEquals(records[1].dropped, undefined);
});

Deno.test("platform/diagnostics#R3: oversize and invalid fields do not prevent future records", async () => {
  const records: LogRecord[] = [];
  const logger = createLogger({
    now: () => AT,
    maxPendingBytes: 200,
    sink: (record) => {
      records.push(record);
    },
  });
  logger.info({ ...event, fields: { value: "x".repeat(201) } });
  logger.info({ ...event, fields: { value: 1n } });
  logger.info(event);
  await logger.flush();
  assertEquals(records.length, 1);
  assertEquals(records[0].dropped, 2);
  const zero = createLogger({
    now: () => AT,
    maxPendingBytes: 0,
    sink: () => {
      throw new Error("not called");
    },
  });
  zero.info(event);
  await zero.flush();
  for (const maxPendingBytes of [-1, Infinity, NaN]) {
    assertThrows(
      () => createLogger({ now: () => AT, maxPendingBytes, sink: () => {} }),
      TypeError,
    );
  }
});
