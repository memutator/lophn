// TypeScript blueprint 값 추출(apps/blueprint#R17). 권한 없는 Deno 자식에서 최대
// 10초 수행하고 release에는 정규 JSON을 고정한다. 파일·네트워크 접근과 무한 반복을
// 하는 작성형은 거절되거나 10초 안에 중단된다.
import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  type BlueprintValidator,
  EXTRACT_CHILD_LIMIT_MS,
  extractBlueprint,
  type ExtractLauncher,
  validateExtracted,
} from "./extract.ts";

const CANONICAL = JSON.stringify({
  name: "sample-app",
  description: "sample",
  screens: [],
  commands: [],
  automatic_tasks: [],
  permissions: [],
  problem_codes: [],
  documents: [],
  agent_context: [],
  app_connections: [],
  sdk_dependencies: [],
});

// wrapper(mod.ts)가 다시 내보내는 contracts 검증기와 같은 모양의 주입 검사기.
const ACCEPTING: BlueprintValidator = (value) =>
  typeof value === "object" && value !== null && "name" in value
    ? { ok: true, value: { name: String((value as { name: unknown }).name) } }
    : { ok: false };

function launcherOf(
  run: (sourcePath: string) => Promise<Result<{ stdout: string }>>,
): ExtractLauncher {
  return { run };
}

Deno.test("apps/blueprint#R17: 추출 자식 상한은 10초다", () => {
  // 권한 없는 자식은 최대 10초까지만 산다(R17). 값은 contracts 상수 하나다.
  assertEquals(EXTRACT_CHILD_LIMIT_MS, 10_000);
});

Deno.test("apps/blueprint#R17: 권한 없는 자식의 정규 JSON만 release에 고정한다", async () => {
  const launcher = launcherOf(() => Promise.resolve(ok({ stdout: CANONICAL })));
  const extracted = await extractBlueprint(
    launcher,
    "anywhere/blueprint.ts",
    ACCEPTING,
  );
  assert(extracted.ok, extracted.ok ? "" : extracted.error.reason);
  assertEquals(extracted.value.canonicalJson, CANONICAL);
  // 정규 JSON은 주입 검사기를 통과한다.
  const validated = validateExtracted(ACCEPTING, CANONICAL);
  assert(validated.ok);
  assertEquals(validated.value.blueprintName, "sample-app");
});

Deno.test("apps/blueprint#R17: 10초를 넘은 자식은 중단으로 unavailable이다", async () => {
  // launcher가 기한 안에 끝내지 못하고 중단했다. 실패 이유는 extract_timeout이다.
  const launcher = launcherOf(() =>
    Promise.resolve(err({ code: "invalid_input", message: "killed" }))
  );
  const extracted = await extractBlueprint(
    launcher,
    "anywhere/blueprint.ts",
    ACCEPTING,
  );
  assertEquals(extracted.ok, false);
  if (!extracted.ok) {
    assertEquals(extracted.error.code, "unavailable");
    assertEquals(extracted.error.reason, "extract_timeout");
  }
});

Deno.test("apps/blueprint#R17: blueprint가 아닌 값과 깨진 JSON은 거절이다", async () => {
  // 파일을 읽는 대신 자식이 blueprint가 아닌 값을 냈다.
  const notBlueprint = launcherOf(() =>
    Promise.resolve(ok({ stdout: "just a string" }))
  );
  const refused = await extractBlueprint(
    notBlueprint,
    "anywhere/blueprint.ts",
    ACCEPTING,
  );
  assertEquals(refused.ok, false);
  if (!refused.ok) {
    assertEquals(refused.error.code, "invalid_input");
    assertEquals(refused.error.reason, "extract_failed");
  }
  // 검사기를 통과하지 못하는 값도 거절이다.
  const rejecting = validateExtracted(() => ({ ok: false }), CANONICAL);
  assertEquals(rejecting.ok, false);
  // 깨진 JSON은 not_a_blueprint다.
  const broken = validateExtracted(ACCEPTING, "{broken");
  assertEquals(broken.ok, false);
  if (!broken.ok) assertEquals(broken.error.reason, "not_a_blueprint");
});

Deno.test("apps/blueprint#R17: 무한 반복 작성형은 10초 안에 끝나지 않으면 중단이다", async () => {
  // 권한 없는 자식은 무한 반복을 해도 launcher 기한 안에 중단된다. 여기서는
  // launcher가 10초 안에 중단 결과를 냈다고 본다.
  let attempts = 0;
  const launcher = launcherOf((sourcePath) => {
    attempts += 1;
    if (sourcePath.includes("infinite")) {
      return Promise.resolve(err({ code: "invalid_input", message: "killed" }));
    }
    return Promise.resolve(ok({ stdout: CANONICAL }));
  });
  const stopped = await extractBlueprint(launcher, "infinite.ts", ACCEPTING);
  assertEquals(stopped.ok, false);
  const done = await extractBlueprint(launcher, "normal.ts", ACCEPTING);
  assert(done.ok);
  assertEquals(attempts, 2);
});
