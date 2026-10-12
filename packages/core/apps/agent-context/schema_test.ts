import { assert, assertEquals } from "@std/assert";
import {
  agentContextDeclarationSchema,
  annotationWriteInputSchema,
  appScreenContextSchema,
  screenContextReadInputSchema,
  SUMMARY_MAX_BYTES as CONTRACT_SUMMARY_MAX_BYTES,
} from "../../../protocol/apps/mod.ts";
import {
  isPointer,
  parseReadInput,
  parseWriteInput,
  pointerOf,
  pointerTokens,
  SUMMARY_MAX_BYTES,
} from "./mod.ts";

Deno.test("apps/agent-context#R3: the summary limit is the contract limit", () => {
  assertEquals(SUMMARY_MAX_BYTES, CONTRACT_SUMMARY_MAX_BYTES);
  assertEquals(SUMMARY_MAX_BYTES, 2048);
});

Deno.test("apps/agent-context#R2: read input checks agree with the contract", () => {
  const cases: unknown[] = [
    { screen: "usage", view_session: "view-1" },
    { screen: "usage", view_session: "view-1", detail: true },
    { screen: "usage", view_session: "view-1", detail: "yes" },
    { screen: "", view_session: "view-1" },
    { screen: "usage", view_session: "" },
    { screen: "usage", view_session: "view\n1" },
    { screen: "usage", view_session: "view-1", extra: 1 },
    { view_session: "view-1" },
    null,
    [],
    "text",
  ];
  for (const input of cases) {
    const contract = screenContextReadInputSchema.safeParse(input);
    const ours = parseReadInput(input);
    assertEquals(ours.ok, contract.success, JSON.stringify(input));
    if (ours.ok && contract.success) assertEquals(ours.value, contract.data);
  }
});

Deno.test("apps/agent-context#R5: write input checks agree with the contract and keep business fields", () => {
  const base = {
    screen: "usage",
    view_session: "view-1",
    expected_revision: "rev-1",
    target: "hint",
    text: "try a retry",
  };
  const cases: unknown[] = [
    base,
    { ...base, text: "" },
    { ...base, text: 3 },
    { ...base, expected_revision: "" },
    { ...base, target: "" },
    { ...base, view_session: "a\u0000b" },
    { screen: "usage" },
    null,
  ];
  for (const input of cases) {
    const contract = annotationWriteInputSchema.safeParse(input);
    const ours = parseWriteInput(input);
    assertEquals(ours.ok, contract.success, JSON.stringify(input));
  }
  // 업무별 추가 필드는 command의 InputSchema가 선언하므로 막지 않고 input에 둔다.
  const extended = parseWriteInput({ ...base, severity: "low" });
  assert(extended.ok);
  assertEquals(extended.value.input.severity, "low");
});

Deno.test("apps/agent-context#R4: JSON Pointer checks and tokens agree with the contract", () => {
  const pointers = ["", "/", "/a", "/a/b", "/~0", "/~1", "/~2", "a", "/\ud800"];
  for (const pointer of pointers) {
    assertEquals(
      isPointer(pointer),
      agentContextDeclarationSchema.safeParse({
        screen: "usage",
        read_command: "usage.read",
        sensitive_paths: [pointer],
        annotation_targets: [],
      }).success,
    );
  }
  assertEquals(pointerTokens("/a~1b/~0"), ["a/b", "~"]);
  assertEquals(pointerOf(["a/b", "~"]), "/a~1b/~0");
  assertEquals(pointerTokens(""), []);
});

Deno.test("apps/agent-context#R2: an AppScreenContext in the shape this leaf returns satisfies the contract", () => {
  const context = {
    app: "app_01arz3ndektsv4rrffq69g5fav",
    release: "rel_01arz3ndektsv4rrffq69g5fav",
    screen: "usage",
    view_session: "view-1",
    revision: "rev-1",
    summary: "s",
    data: null,
    redacted: ["/data/private_note"],
  };
  assert(appScreenContextSchema.safeParse(context).success);
});
