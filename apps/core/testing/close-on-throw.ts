/**
 * test-only. core를 띄운 뒤 준비(credential 등록·seed·assert)가 던지면, 띄운 core를 닫고 데이터 root를
 * 지운다. 닫지 않으면 서버·worker child가 test process를 붙들어 실패가 멈춤으로 바뀌고 child가 남는다.
 *
 * 쓰는 법: startCore가 성공한 바로 뒤에 `await using guard = closeUnlessKept(cleanup)`을 두고, 준비가
 * 끝나 호출자에게 core를 넘기기 직전에 `guard.keep()`을 부른다. 그 전에 던지면 scope를 나갈 때
 * `cleanup`(시험이 평소 끝에 하는 정리: core.shutdown과 폴더 삭제)이 돌고, 처음 오류는 그대로
 * 올라간다. 정리가 던져도 처음 오류를 가리지 않는다.
 */
export type CleanupGuard = {
  // 준비가 끝났다. 이제 정리는 호출자의 몫이다.
  keep(): void;
  [Symbol.asyncDispose](): Promise<void>;
};

export function closeUnlessKept(cleanup: () => Promise<unknown>): CleanupGuard {
  let kept = false;
  return {
    keep() {
      kept = true;
    },
    async [Symbol.asyncDispose]() {
      if (kept) return;
      await cleanup().catch(() => {});
    },
  };
}
