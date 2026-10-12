// shell/desktop#Q18: 화면이 core와 같은 순수 규칙을 contracts에서 값으로 부를 수 있다. renderer의 type check
// 설정(lib ES2023·DOM·deno.ns)에서 import가 되는지와 결과가 맞는지를 한 번씩만 본다. 규칙 자체의 test는
// packages/protocol/lophn-agent의 model-picker·command-filter test가 본다.
import { assertEquals } from "@std/assert";
import { listCommands } from "../../../../protocol/lophn-agent/command-filter.ts";
import {
  fitOptionValues,
  orderPicker,
  toggleFavorite,
} from "../../../../protocol/lophn-agent/model-picker.ts";
import { catalogEntry } from "../../../../protocol/lophn-agent/testing/mod.ts";

Deno.test("shell/desktop#Q18: the renderer calls the picker rules from contracts", () => {
  const sonnet = { provider: "anthropic", model_name: "claude-sonnet-4-5" };
  const opus = { provider: "anthropic", model_name: "claude-opus-4-8" };
  const layout = orderPicker({
    favorites: toggleFavorite([], opus),
    models: [sonnet, opus],
    query: "OPUS",
  });
  assertEquals(layout.favorites, [opus]);
  assertEquals(layout.providers, [{ provider: "anthropic", models: [opus] }]);

  // opus는 Off를 지원하지 않는다. 지원하지 않는 값은 가장 약한 지원 값으로 맞춘다.
  const fitted = fitOptionValues(catalogEntry("anthropic", "claude-opus-4-8"), {
    effort: "off",
  });
  assertEquals(fitted.option_values, { effort: "low" });
  assertEquals(fitted.notices, [{ axis: "effort", from: "off", to: "low" }]);
});

Deno.test("shell/desktop#Q18: the renderer calls the `/` menu filter from contracts", () => {
  const entry = (name: string, source: "builtin" | "skill") => ({
    name,
    title: source === "skill" ? null : name,
    description: `Use ${name}`,
    source,
    skill_origin: null,
    while_running: "run" as const,
    action: source === "skill"
      ? { kind: "skill" as const, skill_name: name }
      : { kind: "builtin" as const, id: "new" as const },
  });
  const groups = listCommands(
    { entries: [entry("new", "builtin"), entry("review", "skill")] },
    "lophn",
    "REV",
  );
  assertEquals(groups.map((group) => [group.title, group.source]), [[
    "Skills",
    "skill",
  ]]);
});
