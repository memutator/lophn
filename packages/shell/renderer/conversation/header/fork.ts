// Fork: 같은 agent의 새 session `id`로 이력을 복사하고 만든 session을 부르는 쪽이 새 탭에 연다.
// header의 ⋯ menu와 `/fork`가 같은 길을 쓴다.
import { newId } from "../../desktop/lophn-space/model.ts";
import type { AgentTabSource, SourceResult } from "../agent-tab-source.ts";

/** 마지막 확정 메시지까지 복사한다. 성공하면 만든 session을 `openForked`로 연다. */
export async function forkAndOpen(
  source: Pick<AgentTabSource, "forkSession">,
  session: string,
  openForked: (session: string) => void,
): Promise<SourceResult<void>> {
  const id = newId("ses");
  const result = await source.forkSession({ id, session, through: null });
  if (result.ok) openForked(id);
  return result;
}
