// Fork: 같은 agent의 새 session으로 이력을 복사하고 만든 session을 부르는 쪽이 새 탭에 연다. 새 session을 열지 않는
// source(harness)는 같은 탭의 상태가 바뀌므로 열 것이 없다. header의 ⋯ menu와 `/fork`가 같은 길을 쓴다.
import { newId } from "../../prefixed-id.ts";
import type { AgentTabSource, SourceResult } from "../agent-tab-source.ts";

/** `through`가 null이면 마지막 확정 메시지까지 복사한다. 새 session이 생겼으면 `openForked`로 연다. */
export async function forkAndOpen(
  source: Pick<AgentTabSource, "act">,
  session: string,
  through: string | null,
  openForked: (session: string) => void,
  now: number = Date.now(),
): Promise<SourceResult<void>> {
  const result = await source.act(session, {
    type: "fork",
    session,
    key: newId("fork", now),
    message: through,
  });
  if (!result.ok) return result;
  if (result.value.session !== undefined) openForked(result.value.session);
  return { ok: true, value: undefined };
}
