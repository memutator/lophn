import assert from "node:assert/strict";
import { test } from "node:test";
import { appToolName } from "./name.ts";

test("앱 tool 이름은 <domain>_<tool>이고 64자를 넘을 때만 hash가 붙는다", async () => {
  assert.deepStrictEqual(await appToolName("notes", "add"), "notes_add");
  assert.deepStrictEqual(
    await appToolName("calendar", "event.list"),
    "calendar_event_list",
  );
  const long = await appToolName("notes", "x".repeat(80));
  assert.deepStrictEqual(long, await appToolName("notes", "x".repeat(80)));
  assert.deepStrictEqual(long.length, 64);
  assert.deepStrictEqual(
    long === (await appToolName("notes", "x".repeat(81))),
    false,
  );
});
