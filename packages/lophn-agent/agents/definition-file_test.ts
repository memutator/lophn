import { assert, assertEquals } from "@std/assert";
import type {
  AgentDefinition,
  AgentIssue,
  AgentSettings,
} from "../../protocol/lophn-agent/mod.ts";
import {
  type AgentFileTarget,
  parseAgentFile,
  parseSettingsFile,
  serializeAgentFile,
  serializeSettingsFile,
} from "./definition-file.ts";

const DATA = new URL("./testdata/", import.meta.url);
const PROJECT = "projects/prj_01arz3ndektsv4rrffq69g5fa1/agents/";
const APP = "apps/app_01arz3ndektsv4rrffq69g5fa2/agents/";

function text(path: string): string {
  return Deno.readTextFileSync(new URL(path, DATA));
}

function json<T>(path: string): T {
  return JSON.parse(text(path)) as T;
}

function sorted(issues: readonly AgentIssue[]): AgentIssue[] {
  return [...issues].sort((a, b) =>
    a.field === b.field
      ? a.code.localeCompare(b.code)
      : a.field < b.field
      ? -1
      : 1
  );
}

const lophn: AgentFileTarget = { role: "lophn", place: "project" };
const operator: AgentFileTarget = { role: "operator", place: "project" };

const VALID: { file: string; target: AgentFileTarget }[] = [
  { file: `${PROJECT}lophn.md`, target: lophn },
  {
    file: `${PROJECT}context-engineer.md`,
    target: { role: "context_engineer", place: "project" },
  },
  { file: `${PROJECT}asg_01arz3ndektsv4rrffq69g5fa6.md`, target: operator },
  { file: `${PROJECT}asg_01arz3ndektsv4rrffq69g5fa7.md`, target: operator },
  {
    file: `${APP}app-engineer.md`,
    target: { role: "app_engineer", place: "app" },
  },
  {
    file: `${APP}asg_01arz3ndektsv4rrffq69g5fa8.md`,
    target: { role: "operator", place: "app" },
  },
];

function parsed(file: string, target: AgentFileTarget): AgentDefinition {
  const result = parseAgentFile(text(file), target);
  assert(result.ok, `${file} should parse`);
  return result.value;
}

function written(
  definition: AgentDefinition,
  target: AgentFileTarget = operator,
): string {
  const result = serializeAgentFile(definition, target);
  assert(result.ok, "definition should serialize");
  return result.value;
}

Deno.test("lophn-agent/agents#R4 [agent-I1]: a definition file reads into its frontmatter fields and body, and writing then reading gives the same value", () => {
  for (const { file, target } of VALID) {
    const definition = parsed(file, target);
    assertEquals(
      definition,
      json(file.replace(/\.md$/, ".json")),
      file,
    );
    const again = parseAgentFile(written(definition, target), target);
    assert(again.ok, file);
    assertEquals(again.value, definition, file);
  }
});

Deno.test("lophn-agent/agents#R4 [agent-I1]: the same value always writes the same text whatever order its fields were built in", () => {
  const model = {
    provider: "pvd_01arz3ndektsv4rrffq69g5fc1",
    model_name: "gpt-5",
    option_values: { effort: "high" },
  };
  const one = written({ name: "Same", model, body: "Text." });
  const two = written({ body: "Text.", model, name: "Same" });
  assertEquals(one, two);
  assertEquals(written({ name: "Same", model, body: "Text." }), one);
});

Deno.test("lophn-agent/agents#R11 [agent-I1]: only the fields that were set are written, so an emptied field is absent from the file", () => {
  const reviewer = parsed(
    `${PROJECT}asg_01arz3ndektsv4rrffq69g5fa6.md`,
    operator,
  );
  const { model: _model, ...withoutModel } = reviewer;
  const file = written(withoutModel);
  assert(!file.includes("model"), "no model key and no model value");
  assert(file.includes("contexts:"));
  assert(file.includes("permissions:"));
  assertEquals(parseAgentFile(file, operator), {
    ok: true,
    value: withoutModel,
  });

  const scribe = parsed(
    `${PROJECT}asg_01arz3ndektsv4rrffq69g5fa7.md`,
    operator,
  );
  const added = { ...scribe, permissions: { tools: ["document.list"] } };
  const grown = parseAgentFile(written(added), operator);
  assert(grown.ok);
  assertEquals(Object.keys(grown.value).sort(), [
    "body",
    "name",
    "permissions",
  ]);
});

Deno.test("lophn-agent/agents#R11 [agent-I1]: a definition with no field is only its body, and empty default lists are not written", () => {
  assertEquals(written({ body: "Be brief." }, lophn), "Be brief.\n");
  assertEquals(written({ body: "" }, lophn), "");
  assertEquals(
    written({
      skills_off: [],
      mcp_off: [],
      safe_tools: [],
      body: "Be brief.",
    }, lophn),
    "Be brief.\n",
  );
  const scribe = written({ name: "Scribe", contexts: [], body: "Write." });
  assert(!scribe.includes("contexts"));
  assertEquals(
    parseAgentFile(scribe, operator),
    { ok: true, value: { name: "Scribe", body: "Write." } },
  );
  assertEquals(parseAgentFile("", lophn), { ok: true, value: { body: "" } });
});

Deno.test("lophn-agent/agents#R11 [agent-I1]: a set field that equals no default is kept, such as an empty tool list and an empty option map", () => {
  const definition: AgentDefinition = {
    model: {
      provider: "pvd_01arz3ndektsv4rrffq69g5fc1",
      model_name: "gpt-5",
      option_values: {},
    },
    permissions: { tools: [] },
    body: "",
  };
  const again = parseAgentFile(written(definition, lophn), lophn);
  assertEquals(again, { ok: true, value: definition });
});

Deno.test("lophn-agent/agents#R6 [agent-I1]: the body stays Markdown, including thematic breaks, and surrounding blank lines are not part of it", () => {
  const body = [
    "# Role",
    "",
    "- read the terms",
    "- leave comments",
    "",
    "---",
    "",
    "```yaml",
    "---",
    "name: not frontmatter",
    "---",
    "```",
  ].join("\n");
  const file = written({ name: "Doc", body });
  const again = parseAgentFile(file, operator);
  assertEquals(again, { ok: true, value: { name: "Doc", body } });

  const padded = parseAgentFile(
    "---\nname: Doc\n---\n\n\n# Role\n\ntext  \n\n\n",
    operator,
  );
  assertEquals(padded, {
    ok: true,
    value: { name: "Doc", body: "# Role\n\ntext" },
  });
});

Deno.test("lophn-agent/agents#R4 [agent-I1]: strings that look like other YAML values read back as the same strings", () => {
  const names = ["123", "true", "null", "~", "a: b", "# not a comment", "- x"];
  for (const name of [...names, "검토자"]) {
    const again = parseAgentFile(written({ name, body: "x" }), operator);
    assertEquals(again, { ok: true, value: { name, body: "x" } }, name);
  }
  const model = {
    provider: "pvd_01arz3ndektsv4rrffq69g5fc1",
    model_name: "gpt-5",
    option_values: { budget: "8192", thinking: "true", speed: "1.5" },
  };
  const again = parseAgentFile(
    written({ name: "Budget", model, body: "x" }),
    operator,
  );
  assertEquals(again, {
    ok: true,
    value: { name: "Budget", model, body: "x" },
  });
});

type InvalidCase = {
  file: string;
  target: AgentFileTarget | "settings";
  issues: AgentIssue[];
};

Deno.test("lophn-agent/agents#R24 [agent-I1]: a wrong file is refused whole and every wrong field is named with its reason code", () => {
  const cases = json<InvalidCase[]>("invalid/expected.json");
  assert(cases.length >= 10);
  for (const { file, target, issues } of cases) {
    const source = text(`invalid/${file}`);
    const result = target === "settings"
      ? parseSettingsFile(source)
      : parseAgentFile(source, target);
    assert(!result.ok, `${file} should be refused`);
    assertEquals(result.error.code, "invalid_input", file);
    assertEquals(sorted(result.error.details.issues), sorted(issues), file);
  }
});

Deno.test("lophn-agent/agents#R5 [agent-I1]: an Operator needs a name and a body, and built-in names are taken in any case", () => {
  const refuse = (
    definition: AgentDefinition,
    target: AgentFileTarget = operator,
  ) => {
    const result = serializeAgentFile(definition, target);
    assert(!result.ok);
    return sorted(result.error.details.issues);
  };
  assertEquals(refuse({ body: "x" }), [{ field: "name", code: "required" }]);
  assertEquals(refuse({ name: "Ok", body: "  \n " }), [
    { field: "body", code: "required" },
  ]);
  for (
    const name of [
      "lophn",
      "LOPHN",
      "Context Engineer",
      "app engineer",
      " App Engineer ",
    ]
  ) {
    assertEquals(
      refuse({ name, body: "x" }),
      [{ field: "name", code: "reserved_name" }],
      name,
    );
  }
  assert(serializeAgentFile({ name: "Lophn Helper", body: "x" }, operator).ok);
  assertEquals(refuse({ name: "Renamed", body: "" }, lophn), [
    { field: "name", code: "not_allowed" },
  ]);
});

Deno.test("lophn-agent/agents#R5 [agent-I1]: a built-in body may be empty", () => {
  assert(serializeAgentFile({ body: "" }, lophn).ok);
  assert(parseAgentFile("", { role: "app_engineer", place: "app" }).ok);
});

Deno.test("lophn-agent/agents#R15 lophn-agent/agents#R17 [agent-I1]: contexts belong to project Operators and app reads to app Operators only", () => {
  const ctx = "ctx_01arz3ndektsv4rrffq69g5fb1";
  const read = { app: "app_01arz3ndektsv4rrffq69g5fa2", command: "status" };
  const issues = (
    definition: AgentDefinition,
    target: AgentFileTarget,
  ): AgentIssue[] => {
    const result = serializeAgentFile(definition, target);
    return result.ok ? [] : sorted(result.error.details.issues);
  };
  assertEquals(issues({ name: "A", contexts: [ctx], body: "x" }, operator), []);
  assertEquals(
    issues({ name: "A", app_reads: [read], body: "x" }, operator),
    [{ field: "app_reads", code: "not_allowed" }],
  );
  const inApp: AgentFileTarget = { role: "operator", place: "app" };
  assertEquals(issues({ name: "A", app_reads: [read], body: "x" }, inApp), []);
  assertEquals(
    issues({ name: "A", contexts: [ctx], body: "x" }, inApp),
    [{ field: "contexts", code: "not_allowed" }],
  );
});

Deno.test("lophn-agent/agents#R24 [agent-I1]: the body limit counts UTF-8 bytes", () => {
  const refuse = (body: string) => {
    const result = serializeAgentFile({ name: "Big", body }, operator);
    return result.ok ? [] : sorted(result.error.details.issues);
  };
  assertEquals(refuse("x".repeat(32_768)), []);
  assertEquals(refuse("x".repeat(32_769)), [{
    field: "body",
    code: "too_large",
  }]);
  assertEquals(refuse("한".repeat(10_922)), []);
  assertEquals(refuse("한".repeat(10_923)), [{
    field: "body",
    code: "too_large",
  }]);
  const file = `---\nname: Big\n---\n${"x".repeat(32_769)}\n`;
  const result = parseAgentFile(file, operator);
  assert(!result.ok);
  assertEquals(sorted(result.error.details.issues), [
    { field: "body", code: "too_large" },
  ]);
});

Deno.test("lophn-agent/agents#R14 lophn-agent/agents#R22 [agent-I1]: writing refuses a credential next to a model and a wildcard permission", () => {
  const leaky = {
    name: "Leaky",
    model: {
      provider: "pvd_01arz3ndektsv4rrffq69g5fc1",
      model_name: "gpt-5",
      option_values: {},
      api_key: "sk-do-not-store",
    },
    body: "x",
  } as unknown as AgentDefinition;
  const credential = serializeAgentFile(leaky, operator);
  assert(!credential.ok);
  assertEquals(sorted(credential.error.details.issues), [
    { field: "model.api_key", code: "unknown_field" },
  ]);
  const wildcard = serializeAgentFile(
    { name: "Wide", permissions: { tools: ["document.*"] }, body: "x" },
    operator,
  );
  assert(!wildcard.ok);
  assertEquals(sorted(wildcard.error.details.issues), [
    { field: "permissions.tools.0", code: "invalid_value" },
  ]);
});

Deno.test("lophn-agent/agents#R10 [agent-I1]: a place settings file holds only models and permissions and has no body", () => {
  for (const file of [`${PROJECT}settings.md`, `${APP}settings.md`]) {
    const settings = parseSettingsFile(text(file));
    assert(settings.ok, file);
    assertEquals(settings.value, json(file.replace(/\.md$/, ".json")), file);
    const again = serializeSettingsFile(settings.value);
    assert(again.ok);
    assertEquals(parseSettingsFile(again.value), settings, file);
  }
  const empty = serializeSettingsFile({});
  assertEquals(empty, { ok: true, value: "" });
  assertEquals(parseSettingsFile(""), { ok: true, value: {} });
  const onlyPermissions: AgentSettings = {
    permissions: { tools: ["document.list"] },
  };
  const file = serializeSettingsFile(onlyPermissions);
  assert(file.ok);
  assert(!file.value.includes("models"));
  assertEquals(parseSettingsFile(file.value), {
    ok: true,
    value: onlyPermissions,
  });
  const refused = serializeSettingsFile(
    { contexts: [] } as unknown as AgentSettings,
  );
  assert(!refused.ok);
  assertEquals(sorted(refused.error.details.issues), [
    { field: "contexts", code: "unknown_field" },
  ]);
});
