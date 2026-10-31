// 대화 log는 stream 전체를 다시 읽지 않게 aria-live="off"다. 대신 새 답의 시작과 도착만 이 hook이 한 줄로
// 모아 화면 낭독기에 알린다. delta마다 알리면 읽을 수 없고, 결정된 message마다 한 번이면 따라갈 수 있다.
import { useEffect, useRef, useState } from "react";
import { t } from "@lophn/i18n";

export interface Announcement {
  readonly text: string;
  readonly id: number;
}

/** 이 대화의 agent 메시지 id. 늘어난 마지막 id가 새 답이다. */
export function agentReplyIds(
  entries: readonly {
    readonly kind: string;
    readonly id: string;
    readonly actor?: string;
  }[],
): readonly string[] {
  return entries.flatMap((entry) =>
    entry.kind === "message" && entry.actor === "agent" ? [entry.id] : [],
  );
}

/**
 * 처음 그린 대화는 알리지 않는다. 그 뒤 새 답이 도착했거나 도는 답이 시작하면 알리고, 같은 글이 연달아 와도
 * 다시 읽히게 id를 올린다.
 */
export function useThreadAnnouncement({
  agent,
  live,
  replies,
}: {
  agent: string;
  /** 쓰는 중인 agent 글이 있다. */
  live: boolean;
  /** 대화의 agent 메시지 id, 시간순. */
  replies: readonly string[];
}): Announcement | null {
  const [said, setSaid] = useState<Announcement | null>(null);
  const count = useRef(0);
  // null은 아직 처음 모습을 읽는 중이라는 뜻이다. 처음 받은 값은 알리지 않고 기억만 한다.
  const seen = useRef<{ live: boolean; replies: Set<string> } | null>(null);
  useEffect(() => {
    const at = { live, replies: new Set(replies) };
    const previous = seen.current;
    seen.current = at;
    if (previous === null) return;
    const newest = replies[replies.length - 1];
    if (newest !== undefined && !previous.replies.has(newest)) {
      count.current += 1;
      setSaid({
        text: t("conversation.announce.replied", { agent }),
        id: count.current,
      });
      return;
    }
    if (live && !previous.live) {
      count.current += 1;
      setSaid({
        text: t("conversation.announce.response-started"),
        id: count.current,
      });
    }
  }, [agent, live, replies]);
  return said;
}
