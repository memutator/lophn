import { currentContext } from "./handlers.ts";

// 되돌리기를 지원하는 write command의 성공 결과를 만든다(apps/blueprint#R21). handler가 이 값을 돌려주면
// runtime entrypoint가 `{result, revert}`를 command 결과로 올린다. 심볼과 모양은
// packages/apps/runtime/entrypoint/invoke.ts의 COMMAND_REVERT와 같다(SDK는 packages/apps를 import하지 않는다).
export const COMMAND_REVERT = Symbol.for("lophn.command-revert");

export type RevertEvidence = {
  // 이 변경 직전 상태를 가리키는 앱 내부 참조다. 값은 앱이 정하고 되돌림 command가 읽는다.
  receipt: string;
  // 변경 직후 앱의 revision(양의 정수 문자열)이다. 되돌림은 지금 revision이 같을 때만 간다.
  revision: string;
};

export type RevertableResult<T> = {
  result: T;
  revert?: { invocation: string; receipt: string; expected_revision: string };
  [COMMAND_REVERT]: true;
};

// invocation이 없는 실행(release 없는 preview·직접 부른 test)은 되돌림 근거를 꾸미지 않고 revert를 뺀다.
export function withRevert<T>(
  result: T,
  evidence: RevertEvidence,
): RevertableResult<T> {
  const invocation = currentContext()?.invocation ?? null;
  return {
    result,
    ...(invocation === null ? {} : {
      revert: {
        invocation,
        receipt: evidence.receipt,
        expected_revision: evidence.revision,
      },
    }),
    [COMMAND_REVERT]: true,
  };
}
