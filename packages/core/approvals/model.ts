// request의 순수 규칙. IO가 없다. 시각과 id는 인자로 받는다.
import { createHash } from "node:crypto";
import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import {
  type Intent,
  type RequestChoice,
} from "../../protocol/approvals/mod.ts";

// 같은 intent는 같은 지문이다. 허락이 쓰이기 직전에 같은 intent인지 비교할 때 쓴다.
// 호출 쪽이 동기라 동기 hash를 쓴다.
export function intentFingerprint(intent: Intent): string {
  return createHash("sha256").update(canonicalize(intent), "utf8").digest(
    "hex",
  );
}

// 결정의 choice는 request가 낸 선택지 안에 있어야 한다.
export function choiceOffered(
  choices: readonly RequestChoice[],
  choice: RequestChoice,
): Result<void> {
  if (choices.includes(choice)) return ok(undefined);
  return err({
    code: "invalid_input",
    message: "the choice is not offered by this request",
  });
}
