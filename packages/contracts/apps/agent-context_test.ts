import { assert, assertEquals } from "@std/assert";
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
