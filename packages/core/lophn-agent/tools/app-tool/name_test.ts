import { assertEquals } from "@std/assert";
import { appToolName } from "./name.ts";

Deno.test("앱 tool 이름은 <domain>_<tool>이고 64자를 넘을 때만 hash가 붙는다", async () => {
  assertEquals(await appToolName("notes", "add"), "notes_add");
  assertEquals(
    await appToolName("calendar", "event.list"),
    "calendar_event_list",
  );
  const long = await appToolName("notes", "x".repeat(80));
  assertEquals(long, await appToolName("notes", "x".repeat(80)));
  assertEquals(long.length, 64);
  assertEquals(long === await appToolName("notes", "x".repeat(81)), false);
});
