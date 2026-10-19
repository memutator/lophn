import type { SessionSnapshot } from "../../../packages/protocol/events/mod.ts";

// say·deliver로 찾은 root 말고도 callApi 같은 step이 깨운 role agent(Project Manager 등)가 일한다. coding이 아닌 session을 모두
// 후보로 더하고, t0 뒤 turn이 없는 것은 collect 뒤에 버린다. 단 deliver의 fake lophn session(`fake`)은 뺀다. 그 fake model call이
// Metrics와 seenComponents에 섞이면 안 된다.
export function extraRoots(
  snapshots: Pick<SessionSnapshot, "session" | "agent">[],
  roots: Iterable<string>,
  fake: ReadonlySet<string>,
): string[] {
  const known = new Set(roots);
  return snapshots
    .filter((s) =>
      s.agent.role !== "coding_agent" && !known.has(s.session) &&
      !fake.has(s.session)
    )
    .map((s) => s.session);
}
