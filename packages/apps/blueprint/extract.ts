// TypeScript blueprint 값 추출(apps/blueprint#R17). core·supervisor 밖 권한 없는
// Deno 자식에서 최대 10초 수행한다. release에는 정규 JSON을 고정한다.
import { err, ok, type Result } from "../../base/mod.ts";
import { BLUEPRINT_EXTRACT_LIMIT_MS } from "../../contracts/apps/mod.ts";

export type ExtractChildFailure = {
  code: "invalid_input" | "unavailable";
  reason:
    | "source_unreadable"
    | "not_a_blueprint"
    | "extract_timeout"
    | "extract_failed";
};

export type ExtractedBlueprint = {
  // 정규 JSON(RFC 8785) 문자열. release의 blueprint blob 내용이다.
  canonicalJson: string;
  hashInput: string;
};

export type ExtractLauncher = {
  // 권한 없는 Deno 자식을 띄워 source를 노린다. launcher는 자식 기한을 10초로 좁힌다.
  run(sourcePath: string): Promise<Result<{ stdout: string }>>;
};

// 추출 자식 상한. 자식 launcher가 이 안에 끝내지 못하면 중단이다(R17).
export { BLUEPRINT_EXTRACT_LIMIT_MS as EXTRACT_CHILD_LIMIT_MS };

// blueprint 판정 결과의 검사기 모양. wrapper(mod.ts)가 다시 내보내는 contracts
// ValidationResult와 같은 모양이다(blueprint/extract는 leaf helper이므로 contract
// 진입점을 직접 쓰지 않는다, contracts#T63 예외 규칙).
export type BlueprintValidator = (
  value: unknown,
) => { ok: boolean; value?: { name: string } };

// 정규 JSON 문자열을 blueprint 정본으로 검사한다. 검사기는 caller가 주입한다.
export function validateExtracted(
  validate: BlueprintValidator,
  canonicalJson: string,
): Result<{ blueprintName: string }, ExtractChildFailure> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonicalJson);
  } catch {
    return err({ code: "invalid_input", reason: "not_a_blueprint" });
  }
  const validated = validate(parsed);
  if (!validated.ok || validated.value === undefined) {
    return err({ code: "invalid_input", reason: "not_a_blueprint" });
  }
  return ok({ blueprintName: validated.value.name });
}

// 권한 없는 자식이 낸 stdout 정규 JSON만 받는다. 자식이 실패했으면 unavailable이다.
export async function extractBlueprint(
  launcher: ExtractLauncher,
  sourcePath: string,
  validate: BlueprintValidator,
): Promise<Result<ExtractedBlueprint, ExtractChildFailure>> {
  const run = await launcher.run(sourcePath);
  if (!run.ok) {
    return err({ code: "unavailable", reason: "extract_timeout" });
  }
  const stdout = run.value.stdout.trim();
  const validated = validateExtracted(validate, stdout);
  if (!validated.ok) {
    return err({ code: "invalid_input", reason: "extract_failed" });
  }
  return ok({ canonicalJson: stdout, hashInput: stdout });
}
