import assert from "node:assert/strict";
import { test } from "node:test";

import { cryptoRandom, manualClock } from "../../base/mod.ts";
import { createLogRecorder } from "./record.ts";
import { relayChildLine } from "./relay.ts";
import { createTelemetry } from "./telemetry.ts";

const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN = "00f067aa0ba902b7";

function setup() {
  const written: string[] = [];
  const recorder = createLogRecorder();
  recorder.attach({
    write: (bytes) => {
      written.push(new TextDecoder().decode(bytes));
      return Promise.resolve();
    },
  });
  const telemetry = createTelemetry({
    service: "lophn-core",
    clock: manualClock(Date.UTC(2026, 10, 9)),
    random: cryptoRandom,
    config: { mode: "off", level: "info", format: "json" },
    write: () => {},
    recorder,
  });
  const lines = async () => {
    await recorder.flush();
    return written
      .join("")
      .split("\n")
      .filter((line) => line !== "");
  };
  return { telemetry, lines };
}

// log file은 비밀을 읽는 사람이 열 수 있는 자리다. child가 stderr로 낸 글도 core의 redaction을 거친 뒤에만 file에 간다.
test("a child log line is redacted before it reaches the core log file and keeps its structure", async () => {
  const { telemetry, lines } = setup();
  telemetry.setTrace(true);
  const child = {
    timestamp: "2026-11-09T00:00:00.000Z",
    level: "debug",
    service_name: "lophn-agent-runtime",
    trace_id: TRACE,
    span_id: SPAN,
    component: "trace",
    event: "HTTP GET",
    message: `key ${KEY} rejected`,
    fields: { note: `typed ${KEY}`, api_key: "plain", duration_ms: 12 },
  };
  relayChildLine(telemetry.logger, "agent-runtime", JSON.stringify(child));
  // JSON이 아닌 줄(crash 글)도 같은 길이다.
  relayChildLine(telemetry.logger, "agent-runtime", `boom ${KEY}`);

  const written = await lines();
  assert.equal(written.length, 2);
  assert.ok(written.every((line) => !line.includes("abcdefghijklmnop")));
  assert.ok(written.every((line) => !line.includes("plain")));
  const record = JSON.parse(written[0]);
  assert.equal(record.service_name, "lophn-agent-runtime");
  assert.equal(record.trace_id, TRACE);
  assert.equal(record.span_id, SPAN);
  assert.equal(record.level, "debug");
  assert.equal(record.event, "HTTP GET");
  assert.equal(record.fields.duration_ms, 12);
  assert.equal(JSON.parse(written[1]).event, "child_stderr");
});

test("debug lines reach the log file only while trace is on", async () => {
  const { telemetry, lines } = setup();
  telemetry.logger.debug({ component: "x", event: "off" });
  telemetry.setTrace(true);
  telemetry.logger.debug({ component: "x", event: "on" });
  telemetry.setTrace(false);
  telemetry.logger.debug({ component: "x", event: "off_again" });
  telemetry.logger.info({ component: "x", event: "info" });
  assert.deepEqual(
    (await lines()).map((line) => JSON.parse(line).event),
    ["on", "info"],
  );
});
