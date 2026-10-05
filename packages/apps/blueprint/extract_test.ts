// TypeScript blueprint 값 추출(apps/blueprint#R17). 권한 없는 Deno 자식에서 최대
// 10초 수행하고 release에는 정규 JSON을 고정한다. 파일·네트워크 접근과 무한 반복을
// 하는 작성형은 거절되거나 10초 안에 중단된다.
import { assert, assertEquals } from "@std/assert";
import {
  type BlueprintValidator,
  EXTRACT_CHILD_LIMIT_MS,
  extractBlueprint,
  validateExtracted,
} from "./extract.ts";

const BLUEPRINT = JSON.stringify({
  name: "Calendar",
  description: "Keeps one calendar",
  screens: [],
  commands: [{
    key: "lookup",
    label: "Lookup",
    description: "Reads one account",
    effect: "read",
    confirm: false,
    input: null,
    revert: { supported: false },
  }],
  automatic_tasks: [],
  permissions: [],
  problem_codes: [],
  documents: [],
  agent_context: [],
  app_connections: [],
  sdk_dependencies: [],
});

const ACCEPTING: BlueprintValidator = (value) =>
  typeof value === "object" && value !== null && "name" in value
    ? { ok: true, value: { name: String((value as { name: unknown }).name) } }
    : { ok: false };

Deno.test("apps/blueprint#R17: 추출 자식 상한은 10초다", () => {
  assertEquals(EXTRACT_CHILD_LIMIT_MS, 10_000);
});

Deno.test("apps/blueprint#R17: 권한 없는 자식의 정규 JSON만 release에 고정한다", async () => {
  const extracted = await extractBlueprint(BLUEPRINT, ACCEPTING);
  assert(extracted.ok, extracted.ok ? "" : extracted.error.reason);
  const parsed = JSON.parse(extracted.value.canonicalJson) as { name: string };
  assertEquals(parsed.name, "Calendar");
  const validated = validateExtracted(ACCEPTING, extracted.value.canonicalJson);
  assert(validated.ok);
  assertEquals(validated.value.blueprintName, "Calendar");
});

Deno.test("apps/blueprint#R17: 파일 접근 작성형은 권한 없는 자식이 거절한다", async () => {
  const refused = await extractBlueprint(
    "read-file",
    ACCEPTING,
    undefined,
    5_000,
  );
  assertEquals(refused.ok, false);
  if (!refused.ok) assertEquals(refused.error.reason, "extract_refused");
});

Deno.test("apps/blueprint#R17: 무한 반복 작성형은 10초 안에 SIGKILL로 끝난다", async () => {
  const started = Date.now();
  const stopped = await extractBlueprint("loop", ACCEPTING, undefined, 500);
  assertEquals(stopped.ok, false);
  if (!stopped.ok) assertEquals(stopped.error.reason, "extract_timeout");
  assert(Date.now() - started < 10_000);
});

Deno.test("apps/blueprint#R17: blueprint가 아닌 값은 거절이다", async () => {
  const refused = await extractBlueprint("{broken", ACCEPTING);
  assertEquals(refused.ok, false);
  const broken = validateExtracted(ACCEPTING, "{broken");
  assertEquals(broken.ok, false);
  if (!broken.ok) assertEquals(broken.error.reason, "not_a_blueprint");
});
