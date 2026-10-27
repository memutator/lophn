import type { SessionSnapshot } from "../../../packages/protocol/events/mod.ts";

// say로 찾은 root 말고도 다른 role agent(Project Manager 등)를 깨우는 일이 있다. 아는 root 밖의 session을 모두
// 후보로 더하고, t0 뒤 turn이 없는 것은 collect 뒤에 버린다.
export function extraRoots(
  snapshots: Pick<SessionSnapshot, "session" | "agent">[],
  roots: Iterable<string>,
): string[] {
  const known = new Set(roots);
  return snapshots.filter((s) => !known.has(s.session)).map((s) => s.session);
}
