// run ledger 테스트 fixture.
// 제품 코드와 mod.ts는 import하지 않는다. 실제 provider를 부르지 않는다.

let counter = 0;

export function envelope(
  command: string,
  input: unknown,
  compare: unknown = {},
) {
  counter++;
  return {
    command,
    input,
    compare,
    idempotency_key: `run-k-${counter}`,
    prepared: [] as string[],
  };
}
