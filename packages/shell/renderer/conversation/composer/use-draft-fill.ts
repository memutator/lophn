import { useEffect, useRef } from "react";

import { blocksText } from "../../../../protocol/lophn-agent/content-block.ts";
import type { ThreadView } from "../agent-tab-source.ts";

/**
 * source가 composer에 채우라고 한 글(`draft`, OpenCode `/undo`가 되돌린 사람 글)을 새 `key`를 볼 때 한 번 채운다.
 * 화면을 처음 읽을 때 이미 있던 key는 지난 일이라 채우지 않는다. 사람이 이미 친 글이 있으면 `fill`이 덮지 않는다.
 */
export function useDraftFill(
  thread: ThreadView | null,
  fill: (text: string) => void,
): void {
  const seen = useRef<string | null | undefined>(undefined);
  const draft = thread?.draft ?? null;
  useEffect(() => {
    if (thread === null) return;
    const before = seen.current;
    seen.current = draft?.key ?? null;
    if (before === undefined || draft === null || draft.key === before) return;
    const text = blocksText(draft.content);
    if (text !== "") fill(text);
  }, [thread === null, draft?.key]);
}
