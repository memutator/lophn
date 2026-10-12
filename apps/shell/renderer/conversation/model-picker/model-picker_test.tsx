// agent-I23: composer의 model 단추와 picker. 값은 모두 props(model catalog가 계산한 결과)에서 오고 화면은
// 받은 순서대로 그린다. 정렬·거르기·값 맞춤 규칙 자체는 contracts/lophn-agent의 model-picker test가 본다.
import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  one,
  render,
  settle,
  unmountSettled,
} from "../../../../../packages/design/components/testing.ts";

import { ModelPicker, type ModelPickerProps } from "./model-picker.tsx";
import {
  ANTHROPIC,
  FITTED_NOTICE,
  HAIKU,
  LAYOUT_NO_FAVORITES,
  LAYOUT_NONE,
  LAYOUT_SO,
  OPENAI,
  OPUS,
  pickerCalls,
  pickerProps,
  ref,
  SONNET,
  SONNET_AFTER_SOL,
  XAI,
} from "../testdata/model-picker.ts";

function content(): HTMLElement {
  return one(document, "[data-model-picker]");
}

function sections(root: ParentNode): string[] {
  return [...root.querySelectorAll("[data-picker-section]")].map((element) =>
    element.getAttribute("data-picker-section")!
  );
}

function models(section: ParentNode): string[] {
  return [...section.querySelectorAll("[role=option]")].map((element) =>
    element.getAttribute("data-model")!
  );
}

function section(name: string, provider?: string): HTMLElement {
  const suffix = provider === undefined ? "" : `[data-provider="${provider}"]`;
  return one(content(), `[data-picker-section="${name}"]${suffix}`);
}

function labels(root: ParentNode): string[] {
  return [...root.querySelectorAll("button")].map((button) =>
    button.textContent!.trim()
  );
}

function write(input: HTMLElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function open(props: ModelPickerProps) {
  const view = render(<ModelPicker {...props} />);
  await settle();
  return view;
}

Deno.test("shell/desktop#R44 [agent-I23]: the model button joins the model name with the chosen option values", () => {
  using view = render(
    <ModelPicker {...pickerProps({ open: false, scenario: SONNET })} />,
  );
  assert(
    one(view.container, "[data-model-button]").textContent!.trim()
      .startsWith("Sonnet 5.5 · Medium"),
  );
  view.rerender(
    <ModelPicker {...pickerProps({ open: false, scenario: OPUS })} />,
  );
  assert(
    one(view.container, "[data-model-button]").textContent!.trim()
      .startsWith("Opus 5.5 · High · Fast"),
    "values follow the axis order the catalog gave",
  );
  view.rerender(
    <ModelPicker {...pickerProps({ open: false, scenario: HAIKU })} />,
  );
  assert(
    one(view.container, "[data-model-button]").textContent!.trim()
      .startsWith("Haiku 5.5"),
  );
  assert(
    !one(view.container, "[data-model-button]").textContent!.includes("·"),
  );
});

Deno.test("shell/desktop#R44 [agent-I23]: pressing the model button asks to open the picker and a closed picker shows nothing else", async () => {
  const calls = pickerCalls();
  const view = render(
    <ModelPicker {...pickerProps({ open: false }, calls)} />,
  );
  await settle();
  assertEquals(document.querySelector("[data-model-picker]"), null);
  click(one(view.container, "[data-model-button]"));
  await settle();
  assertEquals(calls.opened, [true]);
  await unmountSettled(view);
});

Deno.test("shell/desktop#R44 [agent-I23]: the picker stacks search, Favorites, provider groups, the model's axes, the session note and Change defaults from top to bottom", async () => {
  const view = await open(pickerProps());
  assertEquals(sections(content()), [
    "search",
    "favorites",
    "provider",
    "provider",
    "provider",
    "axes",
    "scope",
    "defaults",
  ]);
  assertEquals(
    one(content(), "input[aria-label='Search models']").getAttribute(
      "placeholder",
    ),
    "Search models",
  );
  assertEquals(
    section("favorites").querySelector("h3,p,[role=heading]")!
      .textContent,
    "Favorites",
  );
  const providers = [
    ...content().querySelectorAll(
      '[data-picker-section="provider"]',
    ),
  ];
  assertEquals(
    providers.map((group) => group.getAttribute("data-provider")),
    [ANTHROPIC, OPENAI, XAI],
  );
  assertEquals(
    providers.map((group) =>
      group.querySelector("h3,p,[role=heading]")!.textContent
    ),
    ["Anthropic", "OpenAI", "xAI"],
  );
  await unmountSettled(view);
});

Deno.test("lophn-agent/harness/model#R26 [agent-I23]: Favorites keep the starred order and the same models also stay in their provider groups", async () => {
  const view = await open(pickerProps());
  assertEquals(models(section("favorites")), ["GPT-6.1 Sol", "Sonnet 5.5"]);
  assertEquals(models(section("provider", ANTHROPIC)), [
    "Opus 5.5",
    "Sonnet 5.5",
    "Haiku 5.5",
  ]);
  assertEquals(models(section("provider", OPENAI)), [
    "GPT-6.1 Sol",
    "GPT-6.1 Mini",
  ]);
  assertEquals(models(section("provider", XAI)), ["Grok 4.7"]);
  // 별은 줄마다 있고 켜진 줄만 눌린 상태다.
  const stars = (root: ParentNode) =>
    [...root.querySelectorAll("[role=option]")].map((option) =>
      one(option, "button[aria-pressed]").getAttribute("aria-pressed")
    );
  assertEquals(stars(section("favorites")), ["true", "true"]);
  assertEquals(stars(section("provider", ANTHROPIC)), [
    "false",
    "true",
    "false",
  ]);
  assertEquals(stars(section("provider", OPENAI)), ["true", "false"]);
  // 줄에 provider 이름이 붙는 곳은 Favorites뿐이다. provider 묶음 안에서는 머리가 말해 준다.
  assert(section("favorites").textContent!.includes("OpenAI"));
  assert(section("favorites").textContent!.includes("Anthropic"));
  await unmountSettled(view);
});

Deno.test("shell/desktop#R44 [agent-I23]: the current model is marked in every row it appears in", async () => {
  const view = await open(pickerProps({ scenario: SONNET }));
  const selected = [...content().querySelectorAll("[role=option]")]
    .filter((option) => option.getAttribute("aria-selected") === "true")
    .map((option) =>
      option.closest("[data-picker-section]")!
        .getAttribute("data-picker-section")
    );
  assertEquals(selected, ["favorites", "provider"]);
  for (const option of content().querySelectorAll("[role=option]")) {
    if (option.getAttribute("data-model") !== "Sonnet 5.5") {
      assertEquals(option.getAttribute("aria-selected"), "false");
    }
  }
  await unmountSettled(view);
});

Deno.test("shell/desktop#R44 [agent-I23]: pressing a row picks the model and pressing its star toggles the favorite without picking", async () => {
  const calls = pickerCalls();
  const view = await open(pickerProps({}, calls));
  click(one(section("provider", XAI), "[role=option]"));
  assertEquals(calls.picked, [{ provider: XAI, modelName: "Grok 4.7" }]);
  assertEquals(calls.starred, []);

  const sol = one(
    section("favorites"),
    "[role=option][data-model='GPT-6.1 Sol']",
  );
  click(one(sol, "button[aria-pressed]"));
  assertEquals(calls.starred, [
    ref({ provider: OPENAI, modelName: "GPT-6.1 Sol" }),
  ]);
  assertEquals(calls.picked.length, 1, "the star is not a pick");

  const mini = one(
    section("provider", OPENAI),
    "[role=option][data-model='GPT-6.1 Mini']",
  );
  click(one(mini, "button[aria-pressed]"));
  assertEquals(calls.starred[1], {
    provider: OPENAI,
    modelName: "GPT-6.1 Mini",
  });
  await unmountSettled(view);
});

Deno.test("lophn-agent/harness/model#R26 [agent-I23]: typing in the search box asks for the filtered list and the matching favorites stay first", async () => {
  const calls = pickerCalls();
  const view = await open(pickerProps({}, calls));
  write(one(content(), "input[aria-label='Search models']"), "so");
  assertEquals(calls.queries, ["so"]);

  view.rerender(
    <ModelPicker {...pickerProps({ query: "so", layout: LAYOUT_SO }, calls)} />,
  );
  assertEquals(
    (one(content(), "input[aria-label='Search models']") as HTMLInputElement)
      .value,
    "so",
  );
  assertEquals(sections(content()).slice(0, 4), [
    "search",
    "favorites",
    "provider",
    "provider",
  ]);
  assertEquals(models(section("favorites")), ["GPT-6.1 Sol", "Sonnet 5.5"]);
  assertEquals(models(section("provider", ANTHROPIC)), ["Sonnet 5.5"]);
  assertEquals(models(section("provider", OPENAI)), ["GPT-6.1 Sol"]);
  assert(!content().textContent!.includes("Opus 5.5"));
  await unmountSettled(view);
});

Deno.test("shell/desktop#R44 [agent-I23]: with no favorites the Favorites group is absent and with no match the picker says so", async () => {
  const view = await open(pickerProps({ layout: LAYOUT_NO_FAVORITES }));
  assert(!sections(content()).includes("favorites"));
  assertEquals(models(section("provider", OPENAI)), [
    "GPT-6.1 Sol",
    "GPT-6.1 Mini",
  ]);
  view.rerender(
    <ModelPicker {...pickerProps({ query: "zzz", layout: LAYOUT_NONE })} />,
  );
  assertEquals(sections(content()).includes("provider"), false);
  assertEquals(sections(content()).includes("favorites"), false);
  assert(content().textContent!.includes("No models match."));
  await unmountSettled(view);
});

Deno.test("lophn-agent/harness/model#R21 [agent-I23]: only the chosen model's axes show, in the catalog's order, and pressing a value reports the axis and value", async () => {
  const calls = pickerCalls();
  const view = await open(pickerProps({ scenario: OPUS }, calls));
  const axes = section("axes");
  const groups = [...axes.querySelectorAll("[role=group]")];
  assertEquals(
    groups.map((group) => group.getAttribute("aria-label")),
    ["Effort", "Speed"],
  );
  assertEquals(labels(groups[0]), ["Low", "Medium", "High", "Max"]);
  assertEquals(labels(groups[1]), ["Standard", "Fast"]);
  const pressed = groups.map((group) =>
    [...group.querySelectorAll("button[aria-pressed=true]")].map((button) =>
      button.textContent!.trim()
    )
  );
  assertEquals(pressed, [["High"], ["Fast"]]);

  const max = [...groups[0].querySelectorAll("button")].find((button) =>
    button.textContent!.trim() === "Max"
  )!;
  click(max);
  assertEquals(calls.options, [["effort", "maximum"]]);
  click(one(groups[1], "button[aria-pressed=false]"));
  assertEquals(calls.options[1], ["speed", "standard"]);
  await unmountSettled(view);
});

Deno.test("lophn-agent/harness/model#R15 [agent-I23]: XHigh and Max are shown as given and a model without options says so", async () => {
  const view = await open(pickerProps({
    scenario: {
      ...SONNET,
      axes: [{
        id: "effort",
        label: "Effort",
        values: [
          { value: "high", label: "High" },
          { value: "very_high", label: "XHigh" },
          { value: "maximum", label: "Max" },
        ],
      }],
    },
  }));
  assertEquals(
    labels(one(section("axes"), "[role=group][aria-label='Effort']")),
    ["High", "XHigh", "Max"],
  );
  view.rerender(<ModelPicker {...pickerProps({ scenario: HAIKU })} />);
  assertEquals(section("axes").querySelectorAll("[role=group]").length, 0);
  assert(section("axes").textContent!.includes("No options for this model."));
  await unmountSettled(view);
});

Deno.test("lophn-agent/harness/model#R21 [agent-I23]: model names, providers and option values come from props only", async () => {
  const view = await open(pickerProps({
    scenario: {
      current: {
        provider: "pvd_01arz3ndektsv4rrffq69g5fb9",
        modelName: "Zeta 9",
      },
      currentLabel: "Zeta 9",
      axes: [{
        id: "depth",
        label: "Depth",
        values: [
          { value: "shallow", label: "Shallow" },
          { value: "deep", label: "Deep" },
        ],
      }],
      optionValues: { depth: "deep" },
    },
    layout: {
      favorites: [],
      providers: [{
        provider: "pvd_01arz3ndektsv4rrffq69g5fb9",
        label: "Nowhere Labs",
        models: [{
          provider: "pvd_01arz3ndektsv4rrffq69g5fb9",
          providerLabel: "Nowhere Labs",
          modelName: "Zeta 9",
          starred: false,
        }],
      }],
    },
  }));
  assertEquals(models(content()), ["Zeta 9"]);
  assert(content().textContent!.includes("Nowhere Labs"));
  assertEquals(
    labels(one(section("axes"), "[role=group][aria-label='Depth']")),
    ["Shallow", "Deep"],
  );
  for (const other of ["Sonnet", "Opus", "GPT", "Anthropic", "Effort"]) {
    assert(!content().textContent!.includes(other), other);
  }
  await unmountSettled(view);
});

Deno.test("lophn-agent/harness/model#R25 [agent-I23]: a value that was fitted to the new model is announced in one line and no notice means no line", async () => {
  const view = await open(pickerProps({ scenario: SONNET_AFTER_SOL }));
  assertEquals(content().querySelectorAll("[role=status]").length, 0);
  view.rerender(
    <ModelPicker
      {...pickerProps({ scenario: SONNET_AFTER_SOL, notices: [FITTED_NOTICE] })}
    />,
  );
  const notices = [...content().querySelectorAll("[role=status]")];
  assertEquals(notices.map((notice) => notice.textContent!.trim()), [
    "Effort set to High. XHigh isn't available for Sonnet 5.5.",
  ]);
  // 알림은 option 축 아래, session 설명 위에 있다.
  const order = [
    ...content().querySelectorAll(
      "[data-picker-section='axes'],[role=status],[data-picker-section='scope']",
    ),
  ].map((element) => element.getAttribute("data-picker-section") ?? "status");
  assertEquals(order, ["axes", "status", "scope"]);
  await unmountSettled(view);
});

Deno.test("shell/desktop#R44 [agent-I23]: the picker says the choice is only for this session and Change defaults goes to Settings", async () => {
  const calls = pickerCalls();
  const view = await open(pickerProps({}, calls));
  assertEquals(
    section("scope").textContent!.trim(),
    "Only this session. Default comes from the agent.",
  );
  const defaults = one(section("defaults"), "button");
  assertEquals(defaults.textContent!.trim(), "Change defaults…");
  click(defaults);
  assertEquals(calls.defaults, 1);
  await unmountSettled(view);
});
