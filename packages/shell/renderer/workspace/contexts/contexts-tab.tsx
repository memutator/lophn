// Contexts 탭: 이 프로젝트의 context를 카드로 나열한다. 카드마다 이름·목적·다루는 것의 종류 수·
// 적용된 판과 검사 결과·위반 수와 [Open]·[Archive]를 보인다. 보관한 context는 접힌 "Archived" 묶음에 두고
// [Unarchive]로 되돌린다(보관한 context는 검색과 위반 목록에서 빠진다).
// context는 Project Manager가 대화에서 만들므로 만드는 단추가 없다. 열 때 읽고 열려 있는 동안 다시 읽지 않는다.
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Button,
  Card,
  ErrorState,
  Loading,
  Skeleton,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import styles from "./contexts-tab.module.css";
import { type CardData, loadContexts } from "./contexts-tab-load.ts";
import { cardRows } from "./contexts-tab-rows.ts";
import { errorReason } from "./error-reason.ts";
import type { ContextListItem, ContextsSource } from "./source.ts";

interface ContextsTabProps {
  /** "Contexts in phroner"처럼 제목에 쓰는 프로젝트 이름. */
  readonly projectTitle: string;
  readonly project: string;
  readonly source: ContextsSource;
  /** [Open]. context ID를 넘긴다. */
  readonly onOpenContext: (context: string) => void;
  /** 보관하거나 풀었다. 작업대가 가진 context 목록을 다시 읽게 한다. */
  readonly onChanged?: () => void;
}

type Load =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | {
    readonly state: "loaded";
    readonly cards: readonly CardData[];
    readonly archived: readonly ContextListItem[];
  };

export function ContextsTab(
  { projectTitle, project, source, onOpenContext, onChanged }: ContextsTabProps,
): ReactNode {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const retry = useCallback(() => {
    setLoad({ state: "loading" });
    setAttempt((count) => count + 1);
  }, []);

  useEffect(() => {
    let current = true;
    loadContexts(source, project).then(
      (read) => {
        if (current) {
          setLoad(
            read === null ? { state: "failed" } : {
              state: "loaded",
              ...read,
            },
          );
        }
      },
      () => {
        if (current) setLoad({ state: "failed" });
      },
    );
    return () => {
      current = false;
    };
  }, [source, project, attempt]);

  const change = async (
    item: ContextListItem,
    run: ContextsSource["archive"],
  ) => {
    setBusy(true);
    const result = await run({ context: item.id, revision: item.revision });
    setBusy(false);
    setFailure(result.ok ? null : errorReason(result.message));
    if (result.ok) onChanged?.();
    // 실패(다른 곳에서 바뀜)도 목록을 다시 읽어 지금 모양을 보인다.
    setAttempt((count) => count + 1);
  };

  const title = t("contexts.title.tab-screen", { project: projectTitle });
  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>{title}</h1>
      <Loading
        loading={load.state === "loading"}
        placeholder={<Skeleton lines={4} />}
      >
        {load.state === "failed" && (
          <ErrorState target={title} onRetry={retry} />
        )}
        {failure !== null && (
          <p className={styles.failure} role="alert" data-failure>
            {t("contexts.error.archive-failed")} {failure}
          </p>
        )}
        {load.state === "loaded" && load.cards.length === 0 && (
          <p className={styles.note} data-empty>
            {t("contexts.empty.tab-none")}
          </p>
        )}
        {load.state === "loaded" && load.cards.length > 0 && (
          <div className={styles.cards}>
            {load.cards.map((card) => (
              <ContextCard
                key={card.item.id}
                card={card}
                busy={busy}
                onOpen={onOpenContext}
                onArchive={() => void change(card.item, source.archive)}
              />
            ))}
          </div>
        )}
        {load.state === "loaded" && load.archived.length > 0 && (
          <div data-archived="">
            <div className={styles.archivedHead}>
              <h2>
                {t("contexts.heading.tab-archived", {
                  count: String(load.archived.length),
                })}
              </h2>
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={shown}
                onClick={() => setShown(!shown)}
              >
                {shown
                  ? t("contexts.button.tab-archived-hide")
                  : t("contexts.button.tab-archived-show")}
              </Button>
            </div>
            {shown && (
              <>
                <p className={styles.note}>
                  {t("contexts.note.tab-archived")}
                </p>
                {load.archived.map((item) => (
                  <div
                    key={item.id}
                    className={styles.archivedRow}
                    data-archived-context={item.id}
                  >
                    <p>
                      <span className={styles.mono}>{item.title}</span>{" "}
                      <span className={styles.muted}>· {item.purpose}</span>
                    </p>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void change(item, source.unarchive)}
                    >
                      {t("contexts.button.tab-unarchive")}
                    </Button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </Loading>
    </div>
  );
}

function ContextCard(
  { card, busy, onOpen, onArchive }: {
    readonly card: CardData;
    readonly busy: boolean;
    readonly onOpen: (context: string) => void;
    readonly onArchive: () => void;
  },
): ReactNode {
  const { item } = card;
  return (
    <Card>
      <div data-context-card={item.id} className={styles.card}>
        <h3 className={styles.name}>{item.title}</h3>
        <p className={styles.purpose} data-purpose>{item.purpose}</p>
        <ul className={styles.rows}>
          {cardRows(card).map((row) => (
            <li
              key={row.key}
              className={row.warn ? styles.warn : undefined}
              data-violations={row.key === "violations" ? "" : undefined}
              data-warn={row.warn ? "true" : undefined}
            >
              {row.text}
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          <Button onClick={() => onOpen(item.id)}>
            {t("contexts.button.tab-open")}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onArchive}>
            {t("contexts.button.tab-archive")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
