import { assertEquals } from "@std/assert";
import { CATALOG_OPTIONS, catalogEntry } from "./catalog-options.ts";

Deno.test("lophn-agent/harness/model#R21: the option fixture is a valid catalog of three providers and six models", () => {
  assertEquals(
    CATALOG_OPTIONS.map((row) =>
      `${row.provider_definition}/${row.model_name}`
    ),
    [
      "anthropic/claude-sonnet-4-5",
      "anthropic/claude-opus-4-8",
      "openai/gpt-5-5",
      "openai/gpt-4-1",
      "xai/grok-3-mini",
      "xai/grok-4",
    ],
  );
});

Deno.test("lophn-agent/harness/model#R21: the fixture axes differ by model", () => {
  const axes = (provider: string, model: string) =>
    catalogEntry(provider, model).options?.map((axis) =>
      `${axis.id}:${axis.values.map((value) => value.value).join(",")}`
    );
  assertEquals(axes("anthropic", "claude-sonnet-4-5"), [
    "effort:off,low,medium,high,maximum",
  ]);
  assertEquals(axes("anthropic", "claude-opus-4-8"), [
    "effort:low,medium,high,very_high,maximum",
  ]);
  assertEquals(axes("openai", "gpt-5-5"), [
    "effort:minimal,low,medium,high,very_high",
    "speed:standard,fast",
  ]);
  assertEquals(axes("openai", "gpt-4-1"), []);
  assertEquals(axes("xai", "grok-3-mini"), ["effort:low,high"]);
  assertEquals(axes("xai", "grok-4"), ["speed:standard,fast"]);
});
