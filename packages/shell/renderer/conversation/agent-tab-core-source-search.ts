// session popover의 메시지 글 찾기. 본문은 blob이라 core가 최근 메시지부터 읽어 찾는다(route 하나).
import { messageSearch } from "../../../protocol/lophn-agent/message-search.ts";
import type { Env } from "./agent-tab-core-source-env.ts";
import type { SessionSearchMatch, SourceResult } from "./agent-tab-source.ts";

/** 이 agent·이 자리의 session 메시지 글에서 query를 찾는다. 빈 query는 core를 부르지 않는다. */
export async function searchMessages(
  env: Env,
  query: string,
): Promise<SourceResult<readonly SessionSearchMatch[]>> {
  const trimmed = query.trim();
  if (trimmed === "") return { ok: true, value: [] };
  const read = await env.read(messageSearch, {
    agent: env.agent,
    place: env.place,
    query: trimmed,
  });
  return read.ok ? { ok: true, value: read.value.matches } : read;
}
