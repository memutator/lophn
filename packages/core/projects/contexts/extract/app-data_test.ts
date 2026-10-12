import { assertEquals } from "@std/assert";
import { appDataKind } from "./app-data.ts";
import {
  inlineFiles,
  kindContext,
  loadAppData,
  loadContract,
  noAppData,
  typeOf,
  typeWith,
} from "./testing.ts";
import type { AppDataReader } from "./types.ts";

const none = inlineFiles({});

Deno.test("documents/contexts#R12 [ctx-I11]: each item of the result array is one entity at app:<app>/<command>, in result order", () => {
  const result = appDataKind(
    typeOf(loadContract("eval-project"), "Event", "app-data"),
    kindContext(none, { appData: loadAppData("eval-project") }),
  );
  assertEquals(result, {
    anchors: [
      {
        type: "Event",
        path: "app:calendar/events.list",
        section: null,
        captures: {},
        scope: { kind: "item", item: { id: "ev-1", summary: "Standup" } },
      },
      {
        type: "Event",
        path: "app:calendar/events.list",
        section: null,
        captures: {},
        scope: { kind: "item", item: { id: "ev-2", summary: "Review" } },
      },
    ],
    violations: [],
  });
});

const source = (result_path: string[]) => ({
  kind: "app-data" as const,
  app: "calendar",
  command: "events.list",
  result_path,
});
const items = (reader: AppDataReader, result_path: string[]) =>
  appDataKind(
    typeWith("Event", source(result_path)),
    kindContext(none, {
      appData: reader,
    }),
  ).anchors.map((anchor) => anchor.scope);

Deno.test("documents/contexts#R12 [ctx-I11]: an empty result_path means the result itself is the array", () => {
  assertEquals(items(() => [{ id: 1 }, { id: 2 }], []), [
    { kind: "item", item: { id: 1 } },
    { kind: "item", item: { id: 2 } },
  ]);
});

Deno.test("documents/contexts#R12 [ctx-I11]: result_path follows keys down to the array", () => {
  const reader: AppDataReader = () => ({ data: { rows: [{ id: "x" }] } });
  assertEquals(items(reader, ["data", "rows"]), [
    { kind: "item", item: { id: "x" } },
  ]);
});

Deno.test("documents/contexts#R12 [ctx-I11]: no result, a missing key or a non-array gives no entities and no violation", () => {
  const reader: AppDataReader = () => ({ data: { rows: "nope" } });
  const found = appDataKind(
    typeWith("Event", source([])),
    kindContext(none, { appData: () => [{ id: 1 }] }),
  );
  assertEquals(found.anchors.length, 1);
  for (
    const [read, path] of [
      [noAppData(), []],
      [reader, ["data", "missing"]],
      [reader, ["data", "rows"]],
    ] as const
  ) {
    assertEquals(items(read, [...path]), []);
  }
});

Deno.test("documents/contexts#R12 [ctx-I11]: the reader is called with the declared app and command", () => {
  const calls: [string, string][] = [];
  const result = appDataKind(
    typeWith("Event", source(["items"])),
    kindContext(none, {
      appData: (app, command) => {
        calls.push([app, command]);
        return { items: [{ id: 1 }] };
      },
    }),
  );
  assertEquals(result.anchors.length, 1);
  assertEquals(calls, [["calendar", "events.list"]]);
});
