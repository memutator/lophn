import assert from "node:assert/strict";
import { test } from "node:test";

import { manualClock } from "../clock.ts";
import { REDACTION_REPLACEMENT } from "../redaction/model.ts";
import { createLogger } from "./log.ts";
import {
  parseTraceparent,
  type SpanContext,
  syncContextStore,
} from "./trace-context.ts";

const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";

test("log 한 줄에 secret 원문이 남지 않고 trace id가 붙는다", () => {
  const lines: string[] = [];
  const context = syncContextStore();
  const logger = createLogger({
    service: "lophn-core",
    clock: manualClock(Date.UTC(2026, 9, 30)),
    level: "info",
    format: "json",
    context,
    write: (line) => lines.push(line),
    redactText: (text) => text.replaceAll("hunter2", REDACTION_REPLACEMENT),
  });
  const span: SpanContext = {
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    sampled: true,
  };
  context.run(span, () =>
    logger.error({
      component: "api",
      event: "provider_failed",
      message: `key ${KEY} rejected`,
      fields: {
        password: "plain-pass",
        nested: { api_key: "abc", note: `user typed hunter2 and ${KEY}` },
        list: [{ Authorization: "Bearer xyz" }],
      },
    }),
  );
  logger.debug({ component: "api", event: "dropped_below_level" });

  assert.equal(lines.length, 1);
  for (const secret of [KEY, "plain-pass", "abc", "hunter2", "xyz"]) {
    assert.ok(!lines[0].includes(secret), `leaked ${secret}`);
  }
  const record = JSON.parse(lines[0]);
  assert.equal(record.timestamp, "2026-10-30T00:00:00.000Z");
  assert.equal(record.level, "error");
  assert.equal(record.service_name, "lophn-core");
  assert.equal(record.trace_id, span.traceId);
  assert.equal(record.span_id, span.spanId);
});

test("traceparent는 맞는 모양만 부모로 잇는다", () => {
  const rows: [string, SpanContext | undefined][] = [
    [
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      {
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
        sampled: true,
      },
    ],
    // 뒤 판은 앞 네 칸만 읽는다.
    [
      "01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00-extra",
      {
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
        sampled: false,
      },
    ],
    ["00-00000000000000000000000000000000-00f067aa0ba902b7-01", undefined],
    ["00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01", undefined],
    ["ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01", undefined],
    ["00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-x", undefined],
    ["00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01", undefined],
    ["garbage", undefined],
  ];
  for (const [header, expected] of rows) {
    assert.deepStrictEqual(parseTraceparent(header), expected, header);
  }
});
