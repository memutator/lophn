import { assert, assertEquals } from "@std/assert";
import {
  APP_LOG_STATES,
  appLogsInputSchema,
  appLogsOutputSchema,
  appLogStateSchema,
} from "./mod.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const INV = "inv_01h455vb4pex5v6nkc6gd5fdw1";
const AT = "2026-10-04T00:00:00.000Z";
const meta = { as_of_seq: "19", next_cursor: null };

Deno.test("apps/runtime#R26, apps/runtime#R27: snapshot log의 줄·byte 예산 입력은 positive safe integer다", () => {
  const sample = { app: APP, invocation: INV, limit: 30, max_bytes: 65536 };
  assertEquals(appLogsInputSchema.parse(sample), sample);
  appLogsInputSchema.parse({
    app: APP,
    limit: 30,
    max_bytes: Number.MAX_SAFE_INTEGER,
  });
  for (
    const max_bytes of [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Infinity,
      NaN,
      "65536",
      null,
    ]
  ) {
    assert(!appLogsInputSchema.safeParse({ ...sample, max_bytes }).success);
  }
  assert(!appLogsInputSchema.safeParse({ ...sample, unknown: true }).success);
});

Deno.test("apps/runtime#R26, apps/runtime#R27: log는 source 없음·수집 꺼짐·timeout·성공을 구별한다", () => {
  assertEquals(APP_LOG_STATES, ["none", "off", "timeout", "ok"]);
  for (const state of APP_LOG_STATES) {
    assertEquals(appLogStateSchema.parse(state), state);
    const page = appLogsOutputSchema.parse({
      ...meta,
      state,
      lines: [],
      collected_at: state === "ok" ? AT : null,
      truncated: false,
    });
    assertEquals(page.state, state);
    assertEquals(page.lines, []);
  }
  const partial = appLogsOutputSchema.parse({
    ...meta,
    state: "timeout",
    lines: ["partial log"],
    collected_at: AT,
    truncated: true,
  });
  assertEquals(partial.lines, ["partial log"]);
  assertEquals(partial.truncated, true);
  const capped = appLogsOutputSchema.parse({
    ...meta,
    state: "ok",
    lines: ["capped log"],
    collected_at: AT,
    truncated: true,
  });
  assertEquals(capped.truncated, true);
  assert(
    !appLogsOutputSchema.safeParse({
      ...meta,
      state: "failed",
      lines: [],
      collected_at: null,
      truncated: false,
    }).success,
  );
  assert(
    !appLogsOutputSchema.safeParse({
      ...meta,
      lines: [],
      collected_at: null,
      truncated: false,
    }).success,
  );
});

Deno.test("coding-agent/cli#R24, apps/runtime#R27: log는 앞선 응답의 next_cursor로 이어 읽는다", () => {
  assertEquals(
    appLogsInputSchema.parse({ app: APP, limit: 10, cursor: "42" }).cursor,
    "42",
  );
  appLogsInputSchema.parse({ app: APP });
  for (const cursor of ["", "-1", "1.5", "abc", "1e3", 42, null]) {
    assert(!appLogsInputSchema.safeParse({ app: APP, cursor }).success);
  }
});
