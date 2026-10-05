import { useCallback, useEffect, useState } from "react";
import { confirmIcons, IconButton, Tooltip } from "@lophn/design/components";
import { t } from "@lophn/wording";

import {
  intervalTicks,
  useRequests,
} from "../../desktop/lophn-space/things-to-confirm/context.tsx";
import {
  currentIndex,
  stripOrder,
} from "../../desktop/lophn-space/things-to-confirm/model.ts";
import type { Request } from "../../desktop/lophn-space/things-to-confirm/source.ts";
import { RequestCard } from "./request-card.tsx";
import styles from "./question-strip.module.css";

export interface QuestionStripProps {
  /** 지금 도크의 세션. 없으면 칸을 두지 않는다. */
  session: string | null;
  /** 연결이 끊기면 보내기를 막는다. */
  offline: boolean;
}

// 대화 입력 위의 질문·approval 칸. 하나만 보이고 run을 멈춘 요청이 먼저, 나머지는 접수 순이며
// 현재 번호/전체와 앞뒤로 오간다(shell/desktop#R6). 세션 없는 요청은 things-to-confirm에서 연다.
export function QuestionStrip({ session, offline }: QuestionStripProps) {
  const deps = useRequests();
  const [requests, setRequests] = useState<readonly Request[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    if (deps === null || session === null) return;
    const read = await deps.source.pending(session);
    // 읽지 못하면 마지막 칸을 그대로 둔다(desktop#R7).
    if (read.ok) setRequests(read.value);
  }, [deps, session]);

  useEffect(() => {
    setRequests([]);
    void refresh();
  }, [refresh]);

  const ticks = deps?.ticks ?? intervalTicks;
  useEffect(
    () =>
      ticks(() => {
        if (!offline) void refresh();
      }),
    [ticks, refresh, offline],
  );

  if (deps === null || session === null) return null;
  const ordered = stripOrder(requests);
  const index = currentIndex(ordered, chosen);
  const current = ordered[index];
  if (current === undefined) return null;

  const go = (step: number) => {
    const next = ordered[index + step];
    if (next) setChosen(next.id);
  };

  return (
    <section
      className={styles.strip}
      data-question-strip=""
      aria-label={t("conversation.label.requests")}
    >
      <div className={styles.head}>
        <span className={styles.label}>
          {t("conversation.label.requests")}
        </span>
        <span className={styles.nav}>
          <span className={styles.position} data-position="">
            {t("conversation.label.request-position", {
              current: index + 1,
              total: ordered.length,
            })}
          </span>
          <Tooltip content={t("conversation.button.previous-request")}>
            <IconButton
              icon={confirmIcons.previous}
              label={t("conversation.button.previous-request")}
              size="sm"
              data-previous-request=""
              disabled={index === 0}
              onClick={() => go(-1)}
            />
          </Tooltip>
          <Tooltip content={t("conversation.button.next-request")}>
            <IconButton
              icon={confirmIcons.next}
              label={t("conversation.button.next-request")}
              size="sm"
              data-next-request=""
              disabled={index === ordered.length - 1}
              onClick={() => go(1)}
            />
          </Tooltip>
        </span>
      </div>
      <RequestCard
        key={current.id}
        request={current}
        source={deps.source}
        draft={deps.drafts.get(current.id)}
        onDraft={(patch) => {
          deps.drafts.save(current.id, patch);
          setVersion((value) => value + 1);
        }}
        onChanged={() => {
          deps.drafts.drop(current.id);
          void refresh();
        }}
        offline={offline}
        now={deps.now}
      />
    </section>
  );
}
