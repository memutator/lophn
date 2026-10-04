// 자식 신원. PID만으로 자식을 판정하지 않는다.
// 시작 시각과 nonce가 모두 같을 때만 같은 자식이다.

export type ChildIdentity = {
  pid: number;
  startedAtMs: number;
  processNonce: string;
};

export function sameChild(
  recorded: ChildIdentity,
  observed: ChildIdentity,
): boolean {
  return recorded.pid === observed.pid &&
    recorded.startedAtMs === observed.startedAtMs &&
    recorded.processNonce === observed.processNonce;
}
