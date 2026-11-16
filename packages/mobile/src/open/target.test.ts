import assert from "node:assert/strict";
import { test } from "node:test";
import { type OpenTarget, openUrl, parseOpenTarget } from "./target.ts";

const paired = new Set(["k1", "k 2/+="]);

test("data and URLs in the shape lophn makes give where to go", () => {
  assert.deepEqual(
    parseOpenTarget({ host: "k1", kind: "session", session: "ses_1" }, paired),
    { kind: "session", host: "k1", session: "ses_1" },
  );
  assert.deepEqual(
    parseOpenTarget({ host: "k1", kind: "app", app: "app_1" }, paired),
    { kind: "app", host: "k1", app: "app_1" },
  );
  assert.deepEqual(parseOpenTarget({ host: "k1", kind: "inbox" }, paired), {
    kind: "inbox",
    host: "k1",
  });
  // What openUrl writes comes back the same, keys with URL characters included.
  for (const target of [
    { kind: "session", host: "k 2/+=", session: "ses_1" },
    { kind: "app", host: "k1", app: "app_1" },
    { kind: "app", host: "k1", app: "app_1", screen: "a&b=c" },
    { kind: "inbox", host: "k1" },
    { kind: "widget_bind", widget: 7 },
    { kind: "widget_bind", widget: 12, configure: true },
  ] satisfies OpenTarget[]) {
    assert.deepEqual(parseOpenTarget(openUrl(target), paired), target);
  }
});

test("anything else opens nothing", () => {
  for (const value of [
    undefined,
    null,
    42,
    [],
    {},
    "ses_1",
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
    { host: "k1", kind: "app", app: "app_1", screen: 3 },
    // a computer this phone is not paired with
    { host: "k9", kind: "inbox" },
    // URLs that are not lophn's
    "https://example.com/open?host=k1&kind=inbox",
    "lophn://other?host=k1&kind=inbox",
    "lophn://open?host=k1",
    "lophn://open?host=k1&kind=session",
    "lophn://open?host=%E0%A4%A&kind=inbox",
    "lophn://open?host=k9&kind=inbox",
    "lophn://widget/bind",
    "lophn://widget/bind?id=",
    "lophn://widget/bind?id=0",
    "lophn://widget/bind?id=x",
    "lophn://widget/bind?id=-3",
    "lophn://widget/bind?id=1.5",
    "lophn://widget/bind?host=k1",
  ]) {
    assert.equal(parseOpenTarget(value, paired), null, JSON.stringify(value));
  }
});
