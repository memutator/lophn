import { assert, assertEquals } from "@std/assert";
import { canonicalize } from "../../base/mod.ts";
import {
  appScreenContextSchema,
  screenContextReadInputSchema,
} from "./agent-context.ts";

const APP = "app_01aryz6s41s4z4k7p41s4z4k7p";
const RELEASE = "rel_01aryz6s41s4z4k7p41s4z4k7p";

Deno.test("apps/agent-context#R3: summary over 2048 UTF-8 bytes is rejected", () => {
  const context = {
    app: APP,
    release: RELEASE,
    screen: "home",
    view_session: "view-1",
    revision: "rev-1",
    summary: "a".repeat(2048),
    redacted: ["/secret"],
  };
  assert(appScreenContextSchema.safeParse(context).success);
  assert(appScreenContextSchema.safeParse({ ...context, data: null }).success);
  assert(
    appScreenContextSchema.safeParse({
      ...context,
      data: { attempt: 1 },
      later: true,
    }).success,
  );
  const long = appScreenContextSchema.safeParse({
    ...context,
    summary: "가".repeat(1025),
  });
  assert(!long.success);
});

Deno.test("apps/agent-context#R2: JSON detail retains own and nested keys without silent deletion", () => {
  const data = JSON.parse(
    '{"__proto__":{"attempt":"current"},"nested":{"__proto__":{"fixed":true}},"constructor":{"prototype":false}}',
  );
  const context = {
    app: APP,
    release: RELEASE,
    screen: "home",
    view_session: "view-1",
    revision: "rev-1",
    summary: "",
    data,
    redacted: [],
  };
  const before = canonicalize(data);
  const parsed = appScreenContextSchema.parse(context);
  assertEquals(canonicalize(parsed.data), before);
  assertEquals(Object.keys(parsed.data!).sort(), Object.keys(data).sort());
  assertEquals(Object.getPrototypeOf(parsed.data), Object.prototype);
  assertEquals(canonicalize(data), before);
  for (
    const invalid of [
      [],
      { item: undefined },
      { item: Infinity },
      { item: 1n },
      new Date(),
    ]
  ) {
    assert(
      !appScreenContextSchema.safeParse({ ...context, data: invalid }).success,
    );
  }
});

Deno.test("apps/agent-context#R2: detail defaults false on a strict read input", () => {
  const parsed = screenContextReadInputSchema.parse({
    screen: "home",
    view_session: "view-1",
  });
  assertEquals(parsed.detail, false);
  assert(
    screenContextReadInputSchema.safeParse({
      screen: "home",
      view_session: "view-1",
      extra: true,
    }).success === false,
  );
});
