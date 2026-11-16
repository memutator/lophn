import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNotificationData } from "./target.ts";

test("data in the shape core sends gives where to go", () => {
  assert.deepEqual(
    parseNotificationData({ host: "k1", kind: "session", session: "ses_1" }),
    { kind: "session", host: "k1", session: "ses_1" },
  );
  assert.deepEqual(
    parseNotificationData({ host: "k1", kind: "app", app: "app_1" }),
    { kind: "app", host: "k1", app: "app_1" },
  );
  assert.deepEqual(parseNotificationData({ host: "k1", kind: "inbox" }), {
    kind: "inbox",
    host: "k1",
  });
  // A terminal tab cannot be opened on the phone: the Inbox shows what waits.
  assert.deepEqual(
    parseNotificationData({ host: "k1", kind: "session", session: "term:3" }),
    { kind: "inbox", host: "k1" },
  );
});

test("anything else opens nothing", () => {
  for (const data of [
    undefined,
    null,
    "ses_1",
    42,
    [],
    {},
    // another app's notification
    { url: "https://example.com", screen: "chat" },
    { kind: "inbox" },
    { host: "", kind: "inbox" },
    { host: 7, kind: "inbox" },
    { host: "k1", kind: "settings" },
    { host: "k1", kind: 1 },
    { host: "k1", kind: "session" },
    { host: "k1", kind: "session", session: 5 },
    { host: "k1", kind: "session", app: "app_1" },
    { host: "k1", kind: "app", session: "ses_1" },
    { host: "k1", kind: "app", app: "" },
  ]) {
    assert.equal(parseNotificationData(data), null, JSON.stringify(data));
  }
});
