import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { sha256Hex } from "@lophn/base";
import {
  bundledGuideSchema,
  guideReferenceSchema,
} from "@lophn/protocol/projects";
import {
  type EffectiveSetting,
  effectiveSettingSchema,
  type SettingDefinitionOutput,
  settingDefinitionSchema,
} from "@lophn/protocol/config";
import { GUIDE_SOURCES, guideSource } from "./guides/catalog.ts";
import { markdownSections, prepareGuideText } from "./model.ts";
import { explainSetting } from "./settings-explanation.ts";
import {
  guideBytesFromFiles,
  type GuideBytesLoader,
  loadProductGuides,
} from "./work.ts";

const PRODUCT_VERSION = "test-fixture";
const GUIDE_DIR = new URL("./guides/", import.meta.url);

const SECRET_VALUE = ["sk", "live", "fixture"].join("-");
const INTERNAL_WORDS = [
  "ledger",
  "handoff",
  "assignment",
  "invocation",
  "credential",
  "redaction",
  "snapshot",
  "blob_hash",
];
const SCREEN_WORDS = ["run", "session"];

function syntheticDefinition(
  overrides: Partial<SettingDefinitionOutput> & { default?: unknown } = {},
): SettingDefinitionOutput {
  const parsed: Record<string, unknown> = {
    key: "fixture.summary_model",
    owner: "lophn-agent/presets",
    display_name_key: "settings.fixture.summary_model.label",
    description: "The model used when a Preset writes a summary.",
    value_meaning_key: "settings.fixture.summary_model.value",
    default_meaning_key: "settings.fixture.summary_model.default",
    affected_features: ["Preset", "For summaries"],
    risk_key: "settings.fixture.summary_model.risk",
    revert_key: "settings.fixture.summary_model.revert",
    constraints: { type: "string", minLength: 1 },
    required: false,
    layers: ["common"],
    apply_at: "next_run",
    apply_at_key: "settings.fixture.summary_model.apply",
    machine_local: true,
    value_type: { type: "string" },
    default_present: true,
    default: "same-as-decisions",
    ...overrides,
  };
  if (parsed.default_present !== true) delete parsed.default;
  return settingDefinitionSchema.parse(parsed);
}

function syntheticEffective(
  overrides: Partial<EffectiveSetting> = {},
): EffectiveSetting {
  return effectiveSettingSchema.parse({
    key: "fixture.summary_model",
    resolved: true,
    value: "summary-model",
    source_layer: "common",
    choices: [{
      layer: "common",
      key: "fixture.summary_model",
      value: "summary-model",
    }],
    revision: 2,
    apply_at: "next_run",
    ...overrides,
  });
}

async function filesFromSources(): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  for (const source of GUIDE_SOURCES) {
    files[source.path] = await Deno.readFile(
      new URL(source.path.split("/").at(-1)!, GUIDE_DIR),
    );
  }
  return files;
}

async function productGuides(version = PRODUCT_VERSION) {
  return await loadProductGuides(
    version,
    guideBytesFromFiles(await filesFromSources()),
  );
}

Deno.test("lophn-agent/roles/lophn#R17 bundled guides answer from feature sections of the supplied product version", async () => {
  const product = await productGuides("2026.10.fixture");
  assertEquals(product.lophnVersion, "2026.10.fixture");
  assertEquals(product.guides.length, GUIDE_SOURCES.length);
  const titles = new Set<string>();
  for (const file of product.files) {
    const guide = product.guides.find((item) =>
      item.title === file.source.title
    );
    assert(guide);
    titles.add(guide.title);
    assertEquals(guide.lophn_version, product.lophnVersion);
    assert(bundledGuideSchema.safeParse(guide).success);
    assert(
      guideReferenceSchema.safeParse({
        lophn_version: guide.lophn_version,
        title: guide.title,
        content_hash: guide.content_hash,
      }).success,
    );
    assertEquals(guide.files.filter((item) => item.primary).length, 1);
    assertEquals(guide.files[0].path, file.source.path);
    assert(!guide.files[0].path.startsWith("/"));
    assertEquals(guide.content_hash, await sha256Hex(file.bytes));
    assertEquals(guide.files[0].blob_hash, guide.content_hash);
    assertEquals(guide.files[0].bytes, file.bytes.byteLength);
    assertEquals(guide.files[0].media_type, "text/markdown");
    assertEquals(
      markdownSections(file.text),
      file.source.sections.map((section) => section.heading),
    );
    assert(file.text.startsWith(`# ${file.source.title}\n`));
    for (const section of file.source.sections) {
      assert(file.text.includes(`## ${section.heading}`));
      for (const feature of section.features) {
        assert(file.text.includes(feature));
      }
    }
    const lower = file.text.toLowerCase();
    for (const word of INTERNAL_WORDS) assert(!lower.includes(word), word);
    for (const word of SCREEN_WORDS) {
      assert(!new RegExp(`\\b${word}\\b`, "i").test(file.text), word);
    }
    assert(!file.text.includes(SECRET_VALUE));
  }
  assertEquals(titles.size, product.guides.length);
  assert(product.files.some((file) => file.text.includes("does not know")));
});

Deno.test("lophn-agent/roles/lophn#R17 guide bytes stay on the root-relative path the installer supplies", async () => {
  const files = await filesFromSources();
  const path = GUIDE_SOURCES[0].path;
  const loader: GuideBytesLoader = (requested) => {
    assertEquals(requested, path);
    assert(!requested.includes(Deno.cwd()));
    return Promise.resolve(files[requested]);
  };
  const first = GUIDE_SOURCES[0];
  const product = await loadProductGuides(
    PRODUCT_VERSION,
    async (requested) => {
      if (requested === first.path) return await loader(requested);
      return files[requested];
    },
  );
  assertEquals(product.guides[0].files[0].path, first.path);
  const missing = guideBytesFromFiles({});
  await assertRejects(
    () => loadProductGuides(PRODUCT_VERSION, missing),
    Error,
    "missing",
  );
  await assertRejects(
    () => loadProductGuides("   ", guideBytesFromFiles(files)),
    Error,
    "lophnVersion",
  );
});

Deno.test("lophn-agent/roles/lophn#R20 synthetic public definition wording-key projection never includes a secret value", async () => {
  const definition = syntheticDefinition();
  const effective = syntheticEffective();
  const chosen = explainSetting({ definition, effective });
  assertEquals(chosen.displayNameKey, definition.display_name_key);
  assertEquals(chosen.valueMeaningKey, definition.value_meaning_key);
  assertEquals(chosen.defaultMeaningKey, definition.default_meaning_key);
  assertEquals(chosen.riskKey, definition.risk_key);
  assertEquals(chosen.revertKey, definition.revert_key);
  assertEquals(chosen.applyAtKey, definition.apply_at_key);
  assertEquals(chosen.description, definition.description);
  assertEquals(chosen.key, "fixture.summary_model");
  assertEquals(chosen.source, "common");
  assertEquals(chosen.resolved, true);
  assertEquals(chosen.differsFromDefault, true);
  assertEquals(chosen.applyAt, "next_run");
  assert(!("label" in chosen));
  assert(!("whenItApplies" in chosen));
  assert(!JSON.stringify(chosen).includes(SECRET_VALUE));
  assert(!JSON.stringify(chosen).includes("summary-model"));
  assert(!JSON.stringify(chosen).includes("same-as-decisions"));

  const builtin = explainSetting({
    definition: syntheticDefinition(),
    effective: syntheticEffective({
      value: "same-as-decisions",
      source_layer: "builtin",
      choices: [],
    }),
  });
  assertEquals(builtin.source, "builtin");
  assertEquals(builtin.differsFromDefault, false);

  const unresolved = explainSetting({
    definition: syntheticDefinition({ default_present: false }),
    effective: syntheticEffective({
      resolved: false,
      value: null,
      source_layer: null,
      choices: [],
    }),
  });
  assertEquals(unresolved.source, "unresolved");
  assertEquals(unresolved.resolved, false);
  assertEquals(unresolved.differsFromDefault, "unknown");

  assertThrows(
    () =>
      explainSetting({
        definition: syntheticDefinition(),
        effective: syntheticEffective({ apply_at: "next_call" }),
      }),
    Error,
    "apply time",
  );

  const settings = (await productGuides()).files.find((file) =>
    file.source.title === "Settings"
  );
  assert(settings);
  assert(guideSource(settings.source.path));
  for (
    const phrase of [
      "public definition",
      "effective setting",
      "built-in default",
      "your choice",
      "the next time work starts",
      "the current check",
      "the next call",
      "does not put the current value",
      "Protected entry",
    ]
  ) {
    assert(settings.text.includes(phrase), phrase);
  }
  assert(!settings.text.includes(SECRET_VALUE));
  assert(!settings.text.toLowerCase().includes("credential"));
});

Deno.test("lophn-agent/roles/lophn#R17 owned guide bytes stay stable when the loader buffer changes", async () => {
  const files = await filesFromSources();
  const path = GUIDE_SOURCES[0].path;
  const original = files[path];
  const loader = guideBytesFromFiles(files);
  original[0] = original[0] ^ 0xff;
  const first = await loader(path);
  const product = await loadProductGuides(
    PRODUCT_VERSION,
    (requested) => {
      if (requested === path) return Promise.resolve(first);
      return Promise.resolve(files[requested]);
    },
  );
  first[0] = first[0] ^ 0xff;
  const guide = product.guides[0];
  assertEquals(guide.content_hash, await sha256Hex(product.files[0].bytes));
  assertEquals(guide.files[0].blob_hash, guide.content_hash);
  const second = await loader(path);
  assert(first !== second);
  assertEquals(Array.from(second), Array.from(product.files[0].bytes));
  product.files[0].bytes[0] = product.files[0].bytes[0] ^ 0xff;
  assertEquals(second[0], product.files[0].bytes[0] ^ 0xff);
});

Deno.test("lophn-agent/roles/lophn#R17 catalog metadata stays frozen", () => {
  const source = GUIDE_SOURCES[0];
  assertThrows(() => {
    (source as { title: string }).title = "Changed";
  }, TypeError);
  assertThrows(() => {
    (source.sections[0] as { heading: string }).heading = "Changed";
  }, TypeError);
  assertEquals(guideSource(source.path), source);
  assertEquals(GUIDE_SOURCES[0].title, "Features and screens");
});

Deno.test("lophn-agent/roles/lophn#R17 a title mismatch rejects the original bytes", async () => {
  const files = await filesFromSources();
  const source = GUIDE_SOURCES[0];
  const bytes = files[source.path];
  const mismatched = {
    ...source,
    title: "Not the packaged title",
    sections: source.sections,
  };
  assertThrows(
    () => prepareGuideText(mismatched, bytes),
    Error,
    "guide title does not match",
  );
  assert(new TextDecoder().decode(bytes).startsWith(`# ${source.title}\n`));
});

Deno.test("lophn-agent/roles/lophn#R17 a section mismatch rejects the original bytes", async () => {
  const files = await filesFromSources();
  const source = GUIDE_SOURCES[0];
  const mismatched = {
    ...source,
    sections: [{ heading: "Missing section", features: ["Help"] as const }],
  };
  assertThrows(
    () => prepareGuideText(mismatched, files[source.path]),
    Error,
    "guide sections do not match",
  );
});

Deno.test("lophn-agent/roles/lophn#R20 synthetic wording-key projection compares JSON values canonically", () => {
  const same = explainSetting({
    definition: syntheticDefinition({ default: { a: 1, b: { c: 2 } } }),
    effective: syntheticEffective({ value: { b: { c: 2 }, a: 1 } }),
  });
  assertEquals(same.differsFromDefault, false);
  assert(!JSON.stringify(same).includes('"a"'));

  const reorderedArray = explainSetting({
    definition: syntheticDefinition({ default: [1, 2] }),
    effective: syntheticEffective({ value: [2, 1] }),
  });
  assertEquals(reorderedArray.differsFromDefault, true);

  const absent = explainSetting({
    definition: syntheticDefinition({ default_present: false }),
    effective: syntheticEffective({ value: null }),
  });
  assertEquals(absent.differsFromDefault, "unknown");

  assertThrows(
    () =>
      explainSetting({
        definition: syntheticDefinition(),
        effective: syntheticEffective({ key: "fixture.other" }),
      }),
    Error,
    "different keys",
  );
  assertThrows(
    () =>
      explainSetting({
        definition: syntheticDefinition({ apply_at: "current_check" }),
        effective: syntheticEffective({ apply_at: "next_call" }),
      }),
    Error,
    "apply time",
  );
});
