import { assert, assertEquals } from "@std/assert";
import {
  type EffectiveSetting,
  effectiveSettingSchema,
  type SettingDefinitionOutput,
  settingDefinitionSchema,
} from "@lophn/contracts/platform";
import { createBuiltinAssignmentInputSchema } from "@lophn/contracts/lophn-agent";
import { productPresetDefinition } from "../../presets/mod.ts";
import {
  CONTEXT_LOOKUP_TOOL_NAMES,
  CONTEXT_LOOKUP_TOOLS,
  createContextLookupToolHandlers,
  executeTool,
  runOperations,
} from "../../harness/tools/mod.ts";
import { ok } from "../../../base/mod.ts";
import {
  checkOptionAction,
  optionBindingHash,
  protectedSetting,
} from "../../questions/mod.ts";
import {
  answerFromGuides,
  explainSetting,
  type GuideText,
  type PlaceTarget,
  protectedGuidance,
  RECOMMENDATION_LIMIT,
  recommendPlaces,
  settingChangeQuestion,
  supportingEvidence,
} from "./mod.ts";

// roles/lophn의 자리 추천·사용 안내·설정 변경 제안(순수 규칙). 실제 provider와 사람 데이터 root는
// 열지 않는다. 소유 command 적용(ApplyQuestionOption)은 questions 시험이 본다.

const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const APP = "app_01arz3ndektsv4rrffq69g5fav";

function doc(n: number): string {
  return `doc_01arz3ndektsv4rrffq69g5f${"abcdefgh"[n]}v`;
}

function target(n: number, over: Partial<PlaceTarget> = {}): PlaceTarget {
  return {
    document: doc(n),
    title: `Note ${n}`,
    revision: String(10 + n),
    hasPlace: false,
    containing: [],
    candidates: [{
      place: { kind: "project", id: PROJECT },
      name: `note-${n}`,
      label: "the Mahas project",
      reason: "It is about the Mahas launch.",
    }],
    ...over,
  };
}

Deno.test("lophn-agent/roles/lophn#R14: six targets give at most five recommendations and count the skipped one", () => {
  const targets = [0, 1, 2, 3, 4, 5].map((n) => target(n));
  const result = recommendPlaces(targets);
  assertEquals(RECOMMENDATION_LIMIT, 5);
  assertEquals(result.drafts.length, 5);
  assertEquals(result.skipped, 1);
  assertEquals(result.drafts.map((draft) => draft.document), [
    doc(0),
    doc(1),
    doc(2),
    doc(3),
    doc(4),
  ]);
});

const CTX_A = { context: "ctx_01arz3ndektsv4rrffq69g5fav", title: "Launch" };
const CTX_B = { context: "ctx_01arz3ndektsv4rrffq69g5faw", title: "Billing" };

Deno.test("lophn-agent/roles/lophn#R14 [ctx-I58c]: only documents without a place or that no context's sources cover are recommended", () => {
  const result = recommendPlaces([
    target(0, { hasPlace: true, containing: [CTX_A, CTX_B] }),
    target(1, { hasPlace: true, containing: [] }),
    target(2),
    target(3, { hasPlace: true, containing: [CTX_A] }),
  ]);
  assertEquals(result.notTargets, [doc(0), doc(3)]);
  assertEquals(result.drafts.map((draft) => draft.document), [doc(1), doc(2)]);
  assertEquals(result.skipped, 0);
  // 이유는 옛 항목·관점 연결이 아니라 어느 context도 덮지 않는다고 말한다.
  assertEquals(
    result.drafts[0]!.reason,
    '"Note 1" is not covered by any context.',
  );
  assertEquals(result.drafts[1]!.reason, '"Note 2" has no place yet.');
});

Deno.test("lophn-agent/roles/lophn#R14: each recommendation has a one-line reason and a leave option without an action", () => {
  const result = recommendPlaces([
    target(0, {
      candidates: [{
        place: { kind: "app", id: APP },
        name: "memo",
        label: "the Billing app",
        reason: "It describes\nthe billing flow.\n",
      }],
    }),
  ]);
  const draft = result.drafts[0]!;
  assert(!/[\r\n]/.test(draft.recommendation.explanation));
  assert(draft.recommendation.explanation.trim() !== "");
  assertEquals(draft.recommendation.option_key, "move-1");
  const leave = draft.options.find((option) => option.key === "leave-it")!;
  assertEquals(leave.action, null);
  assertEquals(draft.options.length, 2);
});

Deno.test("lophn-agent/roles/lophn#R14: no candidate gives no move option and no question", () => {
  const result = recommendPlaces([
    target(0, { candidates: [] }),
    target(1, {
      candidates: [{
        place: { kind: "project", id: PROJECT },
        name: "x",
        label: "somewhere",
        reason: " \n ",
      }],
    }),
    target(2),
  ]);
  assertEquals(result.noCandidate, [doc(0), doc(1)]);
  assertEquals(result.drafts.map((draft) => draft.document), [doc(2)]);
});

Deno.test("lophn-agent/roles/lophn#R14 questions#R13: every move option fixes the document, place, name and revision as a valid action", () => {
  const result = recommendPlaces([
    target(0, {
      candidates: [
        {
          place: { kind: "project", id: PROJECT },
          name: "plan",
          label: "the Mahas project",
          reason: "It is the plan for Mahas.",
        },
        {
          place: { kind: "app", id: APP },
          name: "plan",
          label: "the Billing app",
          reason: "It could also describe billing.",
        },
      ],
    }),
  ]);
  const draft = result.drafts[0]!;
  const moves = draft.options.filter((option) => option.action !== null);
  assertEquals(moves.length, 2);
  for (const option of moves) {
    const action = option.action!;
    assertEquals(action.command, "document.move");
    assertEquals(action.targets, [doc(0)]);
    assertEquals(action.comparison, { base_revision: "10" });
    assert(checkOptionAction(QUESTION, action).ok);
    const { binding_hash, ...fixed } = action;
    assertEquals(binding_hash, optionBindingHash(fixed));
  }
  assertEquals(
    (moves[1]!.action!.input as unknown as { value: { place: unknown } })
      .value.place,
    { kind: "app", id: APP },
  );
});

Deno.test("lophn-agent/roles/lophn#R15 [ctx-I58c]: a recommendation is supported when two of the three conditions are met", () => {
  const cases: [number, number, number, boolean][] = [
    [0, 0, 0, false],
    [4, 0, 0, false],
    [0, 2, 0, false],
    [0, 0, 2, false],
    [4, 2, 0, true],
    [4, 0, 2, true],
    [0, 2, 2, true],
    [4, 2, 2, true],
  ];
  for (const [days, backrefs, contexts, supported] of cases) {
    const result = supportingEvidence({
      viewed_days_30d: days,
      backrefs,
      containing_contexts: contexts,
    });
    assertEquals(
      result.supported,
      supported,
      `${days}/${backrefs}/${contexts}`,
    );
  }
});

Deno.test("lophn-agent/roles/lophn#R15 [ctx-I58c]: the thresholds are four distinct days, two backrefs and two containing contexts", () => {
  const met = (days: number, backrefs: number, contexts: number) =>
    supportingEvidence({
      viewed_days_30d: days,
      backrefs,
      containing_contexts: contexts,
    }).met;
  assertEquals(met(3, 2, 0), ["backrefs"]);
  assertEquals(met(4, 1, 0), ["viewed_days_30d"]);
  assertEquals(met(0, 1, 2), ["containing_contexts"]);
  // 근거가 충족되면 추천 이유에 인용한다.
  const draft = recommendPlaces([
    target(0, { activity: { viewed_days_30d: 4, backrefs: 2 } }),
  ]).drafts[0]!;
  assert(draft.recommendation.explanation.includes("4 or more different days"));
  assert(draft.recommendation.explanation.includes("linked from 2 or more"));
  // 자료로 잡은 context 수는 넘긴 containing 목록에서 센다. 추천 대상은 목록이 비어 있어 하나만으로는
  // 근거가 되지 않는다.
  const one = recommendPlaces([
    target(0, { activity: { viewed_days_30d: 4, backrefs: 0 } }),
  ]).drafts[0]!;
  assert(!one.recommendation.explanation.includes("different days"));
});

Deno.test("lophn-agent/roles/lophn#R15: the lophn preset and assignment carry no schedule, so dates and views start no run", () => {
  const preset = productPresetDefinition("lophn", "a".repeat(64));
  const words = ["schedule", "occurrence", "cron", "every_ms", "interval"];
  const keys = [
    ...Object.keys(preset),
    ...Object.keys(createBuiltinAssignmentInputSchema.shape),
  ];
  for (const word of words) {
    assert(!keys.some((key) => key.includes(word)), word);
  }
  // 추천은 순수 함수다. 같은 입력은 같은 결과이고 시계를 읽지 않는다.
  const targets = [target(0, {
    activity: { viewed_days_30d: 9, backrefs: 9 },
  })];
  assertEquals(recommendPlaces(targets), recommendPlaces(targets));
});

const GUIDES: GuideText[] = [
  {
    title: "Settings",
    lophn_version: "1.4.0",
    content_hash: "a".repeat(64),
    text:
      "# Settings\n\nIntro.\n\n## What an explanation uses\n\nUses the public definition.\n\n## How a change is applied\n\nYou choose it in a question.\n",
  },
];

Deno.test("lophn-agent/roles/lophn#R17: a question the bundled guide covers is answered from it, the same every time", () => {
  const ask = {
    feature: "settings",
    section: "How a change is applied",
    product_usage: true,
  };
  const first = answerFromGuides({ guides: GUIDES, ask });
  const second = answerFromGuides({ guides: GUIDES, ask });
  assertEquals(first, second);
  assertEquals(first.kind, "existing");
  if (first.kind === "existing") {
    assert(first.text.includes("You choose it in a question."));
    assert(!first.text.includes("Uses the public definition."));
    assertEquals(first.lophn_version, "1.4.0");
  }
});

Deno.test("lophn-agent/roles/lophn#R17: a new guide version is asked for only when no answer is reusable or the guide changed", () => {
  assertEquals(
    answerFromGuides({
      guides: GUIDES,
      ask: { feature: "Billing", product_usage: true },
    }),
    { kind: "needs_new_version", reason: "no_reusable_answer" },
  );
  assertEquals(
    answerFromGuides({
      guides: GUIDES,
      ask: { feature: "Settings", section: "Nope", product_usage: true },
    }),
    { kind: "needs_new_version", reason: "no_reusable_answer" },
  );
  assertEquals(
    answerFromGuides({
      guides: GUIDES,
      ask: { feature: "Settings", product_usage: true },
      prior: { lophn_version: "1.3.0", content_hash: "a".repeat(64) },
    }),
    { kind: "needs_new_version", reason: "changed" },
  );
  assertEquals(
    answerFromGuides({
      guides: GUIDES,
      ask: { feature: "Settings", product_usage: true },
      prior: { lophn_version: "1.4.0", content_hash: "a".repeat(64) },
    }).kind,
    "existing",
  );
});

Deno.test("lophn-agent/roles/lophn#R17: a question that is not about using the product is out of scope", () => {
  assertEquals(
    answerFromGuides({
      guides: GUIDES,
      ask: { feature: "Settings", product_usage: false },
    }),
    { kind: "out_of_scope" },
  );
});

function definition(
  over: Record<string, unknown> = {},
): SettingDefinitionOutput {
  return settingDefinitionSchema.parse({
    key: "shell.reading_width",
    owner: "shell",
    display_name_key: "settings.reading-width.name",
    description: "The width of the reading column.",
    value_meaning_key: "settings.reading-width.value",
    default_meaning_key: "settings.reading-width.default",
    affected_features: ["Documents", "Conversation"],
    risk_key: "settings.reading-width.risk",
    revert_key: "settings.reading-width.revert",
    constraints: { minimum: 40, maximum: 120 },
    required: false,
    layers: ["common"],
    apply_at: "next_run",
    apply_at_key: "settings.reading-width.apply_at",
    machine_local: false,
    value_type: { type: "number" },
    default_present: true,
    default: 72,
    ...over,
  });
}

function effective(over: Record<string, unknown> = {}): EffectiveSetting {
  return effectiveSettingSchema.parse({
    key: "shell.reading_width",
    resolved: true,
    value: 90,
    source_layer: "common",
    choices: [{ layer: "common", key: "shell.reading_width", value: 90 }],
    revision: 4,
    apply_at: "next_run",
    ...over,
  });
}

Deno.test("lophn-agent/roles/lophn#R20: a setting the person changed is explained with its source and apply time", () => {
  const explained = explainSetting({
    definition: definition(),
    effective: effective(),
  });
  assertEquals(explained.differsFromDefault, true);
  assertEquals(explained.source, "common");
  assertEquals(explained.applyAt, "next_run");
  assertEquals(explained.constraints, { minimum: 40, maximum: 120 });
  const builtin = explainSetting({
    definition: definition(),
    effective: effective({
      value: 72,
      source_layer: "builtin",
      choices: [],
    }),
  });
  assertEquals(builtin.differsFromDefault, false);
  assertEquals(builtin.source, "builtin");
});

Deno.test("lophn-agent/roles/lophn#R20: keys that hold a secret are marked so their value is never read or asked", () => {
  for (
    const key of [
      "x.api_key",
      "provider.openai.credential",
      "x.access_token",
      "x.password",
    ]
  ) {
    assertEquals(protectedSetting(key)?.kind, "secret", key);
  }
  assertEquals(protectedSetting("shell.reading_width"), null);
});

Deno.test("lophn-agent/roles/lophn#R21: a setting change is a question with the current value, new value, impact and timing fixed", () => {
  const proposal = settingChangeQuestion({
    question: QUESTION,
    definition: definition(),
    effective: effective(),
    newValue: 100,
    revision: 4,
    defaults_revision: "defaults-1",
    why: "You said lines feel too short.\nA wider column fits them.",
  });
  assertEquals(proposal.kind, "question");
  if (proposal.kind !== "question") return;
  const { draft } = proposal;
  const change = draft.options.find((option) => option.key === "change")!;
  assert(change.description.includes("90"));
  assert(change.description.includes("100"));
  assert(change.description.includes("Documents, Conversation"));
  assert(change.description.includes("next run"));
  assertEquals(draft.recommendation.option_key, "change");
  assert(!/[\r\n]/.test(draft.recommendation.explanation));
  const action = change.action!;
  assertEquals(action.concern, "platform/settings");
  assertEquals(action.comparison, {
    revision: 4,
    defaults_revision: "defaults-1",
  });
  assertEquals(action.targets, [QUESTION]);
  assert(checkOptionAction(QUESTION, action).ok);
  // 바꾸지 않는 선택지와 자유 답에는 action이 없다.
  assertEquals(
    draft.options.find((option) => option.key === "keep")!.action,
    null,
  );
});

Deno.test("lophn-agent/roles/lophn#R21: no change, an unresolved setting and a key mismatch make no question", () => {
  const base = {
    question: QUESTION,
    revision: 4,
    defaults_revision: "defaults-1",
    why: "Because.",
  };
  assertEquals(
    settingChangeQuestion({
      ...base,
      definition: definition(),
      effective: effective(),
      newValue: 90,
    }).kind,
    "no_change",
  );
  assertEquals(
    settingChangeQuestion({
      ...base,
      definition: definition(),
      effective: effective({
        resolved: false,
        value: null,
        source_layer: null,
        choices: [],
      }),
      newValue: 100,
    }).kind,
    "unresolved",
  );
  assertEquals(
    settingChangeQuestion({
      ...base,
      definition: definition(),
      effective: effective({ key: "shell.other" }),
      newValue: 100,
    }).kind,
    "mismatch",
  );
});

Deno.test("lophn-agent/roles/lophn#R22: credential, app permission and MCP server settings are sent to their protected screen with no option", () => {
  const cases: [string, string, string][] = [
    ["provider.openai.api_key", "platform/secrets", "protected secret entry"],
    ["apps.billing.grant_scope", "apps/permissions", "app permissions"],
    [
      "lophn-agent.extensions.mcp_servers",
      "lophn-agent/extensions",
      "extensions",
    ],
  ];
  for (const [key, screen, words] of cases) {
    const def = definition({ key });
    const proposal = settingChangeQuestion({
      question: QUESTION,
      definition: def,
      effective: effective({ key }),
      newValue: "x",
      revision: 4,
      defaults_revision: "defaults-1",
      why: "Because.",
    });
    assertEquals(proposal.kind, "protected", key);
    if (proposal.kind !== "protected") continue;
    assertEquals(proposal.screen, screen);
    assertEquals(proposal.options.length, 0);
    assert(proposal.guidance.includes(words), key);
    assertEquals(protectedGuidance(def)?.screen, screen);
  }
  assertEquals(protectedGuidance(definition()), null);
});

Deno.test("lophn-agent/roles/lophn#R14 [ctx-I58g]: the covering contexts that context.containing reads decide which documents are recommended", async () => {
  // 경로마다 덮는 context가 다른 core다. covered.md만 계약의 Source가 덮는다.
  const handlers = createContextLookupToolHandlers({
    call: (_contract, input) =>
      Promise.resolve(ok({
        contexts: (input as { path: string }).path === "docs/covered.md"
          ? [{ context: CTX_A.context, title: CTX_A.title, types: ["Note"] }]
          : [],
      })),
  }, () => "");
  const credential = {
    run: "run_01arz3ndektsv4rrffq69g5fav",
    targets: new Set<string>(),
    operations: new Set(runOperations(CONTEXT_LOOKUP_TOOLS)),
  };
  const containingOf = async (path: string) => {
    const outcome = await executeTool(
      { listed: CONTEXT_LOOKUP_TOOLS, handlers, credential },
      CONTEXT_LOOKUP_TOOL_NAMES.containing,
      { project: "prj_01arz3ndektsv4rrffq69g5fav", path },
    );
    assertEquals(outcome.outcome.kind, "success");
    return (outcome.result.content as {
      contexts: { context: string; title: string }[];
    }).contexts;
  };
  const covered = await containingOf("docs/covered.md");
  const uncovered = await containingOf("docs/loose.md");
  // 도구 결과가 그대로 자리 추천의 `containing`이 된다.
  const result = recommendPlaces([
    target(0, { hasPlace: true, containing: covered }),
    target(1, { hasPlace: true, containing: uncovered }),
  ]);
  assertEquals(result.notTargets, [doc(0)]);
  assertEquals(result.drafts.map((draft) => draft.document), [doc(1)]);
});
