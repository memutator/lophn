import { assertEquals } from "@std/assert";
import { bundleContentSchema } from "../../../contracts/documents/mod.ts";
import { changed, sampleBundle } from "../validate/sample.ts";
import { appCommandsOf, externalTypesOf } from "./work-environment.ts";

Deno.test("documents/contexts#R14 [ctx-I36]: a context gives other contexts its types in contract order with visibility, key and the name, visibility and value type of each field, and nothing else", () => {
  const bundle = sampleBundle();
  const given = externalTypesOf("eval", bundle);
  assertEquals(
    given.map((type) => [type.context, type.name, type.visibility]),
    bundle.contract.types.map((type) => ["eval", type.name, type.visibility]),
  );
  const experiment = given[0]!;
  assertEquals(experiment.key, bundle.contract.types[0]!.key);
  assertEquals(
    experiment.fields,
    bundle.contract.types[0]!.fields.map((field) => ({
      name: field.name,
      visibility: field.visibility,
      value_type: field.value_type,
    })),
  );
  assertEquals(
    Object.keys(experiment).sort(),
    ["context", "fields", "key", "name", "visibility"],
  );
});

const effects = (app: string, command: string) =>
  app === "calendar"
    ? ({ "events.list": "read", "invites.send": "external" } as const)[
      command as "events.list"
    ]
    : undefined;

Deno.test("documents/contexts#R12 [ctx-I36]: app commands are the app-data sources' (app, command) pairs with the declared effect, once each, in code unit order, and unknown pairs are left out", () => {
  const sample = changed(() => {});
  assertEquals(
    appCommandsOf(sample as unknown as Record<string, unknown>, effects),
    [{ app: "calendar", command: "events.list", effect: "read" }],
  );
  const content = bundleContentSchema.parse(structuredClone(sample));
  const event = content.contract.types.find((type) =>
    type.source.kind === "app-data"
  )!;
  const raw = structuredClone(content) as unknown as {
    contract: { types: unknown[] };
  };
  const copy = (name: string, source: Record<string, unknown>) => ({
    ...structuredClone(event),
    name,
    source,
  });
  raw.contract.types.push(
    copy("Again", {
      kind: "app-data",
      app: "calendar",
      command: "events.list",
      result_path: [],
    }),
    copy("Send", {
      kind: "app-data",
      app: "calendar",
      command: "invites.send",
      result_path: [],
    }),
    copy("Gone", {
      kind: "app-data",
      app: "calendar",
      command: "events.drop",
      result_path: [],
    }),
    copy("Mail", {
      kind: "app-data",
      app: "mail",
      command: "inbox",
      result_path: [],
    }),
  );
  assertEquals(
    appCommandsOf(raw as unknown as Record<string, unknown>, effects),
    [
      { app: "calendar", command: "events.list", effect: "read" },
      { app: "calendar", command: "invites.send", effect: "external" },
    ],
  );
});

Deno.test("documents/contexts#R12 [ctx-I36]: content that is not a bundle, or no app registration, gives no app commands", () => {
  assertEquals(appCommandsOf({ schema: 1 }, effects), []);
  assertEquals(
    appCommandsOf(
      sampleBundle() as unknown as Record<string, unknown>,
      undefined,
    ),
    [],
  );
});
