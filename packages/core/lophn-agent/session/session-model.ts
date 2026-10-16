import { err, ok, type Result } from "../../../base/mod.ts";
import type { ModelChoice } from "../../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import {
  snapshotCatalogEntry,
  snapshotModelListed,
  validateOptionValues,
} from "../models/mod.ts";

// 세션에 저장하기 전 model 선택 검사다. 기본값 저장과 같은 규칙이다.
// - provider 기록이 없으면 not_found.
// - provider의 현재 목록에 없는 이름은 거절하고, 목록을 확인하지 못했으면(동봉 catalog에 그 provider 정의가
//   없으면) 미확인으로 저장한다.
// - 고른 option 값은 그 model이 선언한 축과 값 안에 있어야 한다. catalog에 없어 축을 모르는 model에는 값을
//   고를 수 없다. 다른 값으로 조용히 바꾸지 않는다.
// 호출 때의 한계 검사와 첫 성공 호출의 확인 표시 해제는 turn 준비와 호출 기록의 몫이다.
export function checkSessionModel(
  tx: Tx,
  choice: ModelChoice,
): Result<void> {
  const row = tx.sql.get(
    "select definition_key from providers where id = ?",
    [choice.provider],
  );
  const definition = row === undefined ? undefined : row["definition_key"];
  if (typeof definition !== "string" || definition.length === 0) {
    return err({ code: "not_found", message: "the provider is not found" });
  }
  if (snapshotModelListed(definition, choice.model_name) === false) {
    return err({
      code: "invalid_input",
      message: "the model name is not in the provider's list",
    });
  }
  const entry = snapshotCatalogEntry(definition, choice.model_name);
  if (entry === undefined) {
    return Object.keys(choice.option_values).length === 0
      ? ok(undefined)
      : err({
        code: "invalid_input",
        message: "an option value cannot be chosen for a model whose options " +
          "are unknown",
      });
  }
  const checked = validateOptionValues(entry, choice.option_values);
  return checked.ok ? ok(undefined) : checked;
}
