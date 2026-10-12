// Contexts 탭: 이 프로젝트의 context를 카드로 나열한다. 카드마다 이름·목적·
// 다루는 것의 종류 수·적용된 판과 검사 결과·위반 수·쓰는 Operator 수와 [Open]을 보이고 아래에
// [New context]를 둔다. 구현은 ctx-I40.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.button.tab-new-context
//   contexts.button.tab-open
//   contexts.empty.tab-none
//   contexts.label.tab-kinds
//   contexts.label.tab-no-violations
//   contexts.label.tab-operators
//   contexts.label.tab-version-checking
//   contexts.label.tab-version-failed
//   contexts.label.tab-version-none
//   contexts.label.tab-version-passed
//   contexts.label.tab-violations
//   contexts.note.tab-new-context
//   contexts.title.tab-screen
//   common.error.load-failed
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Skeleton,
} from "@lophn/design/components";
import { lophnSpaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import styles from "./contexts-tab.module.css";
import { type CardData, loadCards } from "./contexts-tab-load.ts";
import { cardRows } from "./contexts-tab-rows.ts";
import type { ContextsSource } from "./source.ts";

export interface ContextsTabProps {
  /** "Contexts in phroner"처럼 제목에 쓰는 프로젝트 이름. */
  readonly projectTitle: string;
  readonly project: string;
  readonly source: ContextsSource;
  /** [Open]. context ID를 넘긴다. */
  readonly onOpenContext: (context: string) => void;
  /** [New context]. 폼을 열지 않고 Context Engineer와의 Agent 탭을 여는 일은 부른 쪽의 몫이다. */
  readonly onNewContext: () => void;
}

type Load =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "loaded"; readonly cards: readonly CardData[] };

export function ContextsTab(
  { projectTitle, project, source, onOpenContext, onNewContext }:
    ContextsTabProps,
): ReactNode {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setLoad({ state: "loading" });
    setAttempt((count) => count + 1);
  }, []);

  useEffect(() => {
    let current = true;
    loadCards(source, project).then(
      (cards) => {
        if (current) {
          setLoad(
            cards === null ? { state: "failed" } : { state: "loaded", cards },
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

  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>
        {t("contexts.title.tab-screen", { project: projectTitle })}
      </h1>
      <Loading
        loading={load.state === "loading"}
        placeholder={<Skeleton lines={4} />}
      >
        {load.state === "failed" && (
          <ErrorState
            target={t("contexts.title.tab-screen", { project: projectTitle })}
            onRetry={retry}
          />
        )}
        {load.state === "loaded" && load.cards.length === 0 && (
          <EmptyState
            icon={lophnSpaceIcons.add}
            message={t("contexts.empty.tab-none")}
            action={{
              label: t("contexts.button.tab-new-context"),
              onSelect: onNewContext,
            }}
          />
        )}
        {load.state === "loaded" && load.cards.length > 0 && (
          <>
            <div className={styles.cards}>
              {load.cards.map((card) => (
                <ContextCard
                  key={card.item.id}
                  card={card}
                  onOpen={onOpenContext}
                />
              ))}
            </div>
            <div className={styles.newContext}>
              <Button
                variant="primary"
                icon={lophnSpaceIcons.add}
                onClick={onNewContext}
              >
                {t("contexts.button.tab-new-context")}
              </Button>
              <p className={styles.note} data-new-context-note>
                {t("contexts.note.tab-new-context")}
              </p>
            </div>
          </>
        )}
      </Loading>
    </div>
  );
}

function ContextCard(
  { card, onOpen }: {
    readonly card: CardData;
    readonly onOpen: (context: string) => void;
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
        </div>
      </div>
    </Card>
  );
}
