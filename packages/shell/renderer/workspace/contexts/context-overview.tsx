// Overview: context가 다루는 것마다 카드(이름·한 줄 뜻·개수·가진 것·예시 문서·"See all"), 카드 사이
// 사람 말 화살표, 아래에 ContextComposition. 계약 말(kind·public·검색 함수)은
// 쓰지 않는다. 개체가 둘 이하면 그림 없이 카드만 둔다.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.button.overview-see-all
//   contexts.label.overview-diagram
//   contexts.label.overview-from
//   contexts.label.overview-has
//   contexts.note.overview-example
//   common.error.load-failed
import { type ReactNode, useEffect, useState } from "react";
import { Button, Card, ErrorState } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { ContextComposition } from "./context-composition.tsx";
import {
  buildOverviewModel,
  type EntityCard,
  type OverviewModel,
} from "./context-overview-data.ts";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  cardOrigin,
  layoutGrid,
  routeEdge,
} from "./context-overview-layout.ts";
import type { ContextsSource } from "./source.ts";
import type { OpenDocument } from "./shared.ts";
import styles from "./context-overview.module.css";

interface ContextOverviewProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
  /** 예시 문서 이름을 누르면. */
  readonly onOpenDocument: OpenDocument;
  /** "See all 13 →". 개체 종류 이름을 넘긴다. */
  readonly onSeeAll: (type: string) => void;
}

type Load =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly model: OverviewModel };

export function ContextOverview(props: ContextOverviewProps): ReactNode {
  const { source, context } = props;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setLoad({ state: "loading" });
    Promise.all([source.overview(context), source.contract(context)]).then(
      ([overview, contract]) => {
        if (!current) return;
        setLoad(
          overview.ok && contract.ok
            ? {
              state: "ready",
              model: buildOverviewModel(contract.value.content, overview.value),
            }
            : { state: "failed" },
        );
      },
      () => {
        if (current) setLoad({ state: "failed" });
      },
    );
    return () => {
      current = false;
    };
  }, [source, context, attempt]);

  if (load.state === "failed") {
    return (
      <ErrorState
        target={t("contexts.label.target-focus")}
        onRetry={() => setAttempt((count) => count + 1)}
      />
    );
  }
  if (load.state === "loading") return null;
  return (
    <div className={styles.overview}>
      <Diagram
        model={load.model}
        onOpenDocument={props.onOpenDocument}
        onSeeAll={props.onSeeAll}
      />
      <ContextComposition source={source} context={context} />
    </div>
  );
}

function Diagram(
  { model, onOpenDocument, onSeeAll }: {
    model: OverviewModel;
    onOpenDocument: OpenDocument;
    onSeeAll: (type: string) => void;
  },
): ReactNode {
  if (model.cards.length === 0) return null;
  // 개체가 둘 이하면 그릴 관계가 거의 없어 그림 없이 카드만 나란히 둔다.
  if (model.cards.length <= 2) {
    return (
      <div className={styles.plain} data-plain-cards="">
        {model.cards.map((card) => (
          <div key={card.name} className={styles.plainEntity}>
            <Entity
              card={card}
              onOpenDocument={onOpenDocument}
              onSeeAll={onSeeAll}
            />
          </div>
        ))}
      </div>
    );
  }
  const grid = layoutGrid(model.cards.length);
  const cellOf = new Map(
    model.cards.map((card, index) => [card.name, grid.cells[index]!]),
  );
  return (
    <div className={styles.scroll}>
      <div
        className={styles.diagram}
        role="group"
        aria-label={t("contexts.label.overview-diagram")}
        style={{ width: grid.width, height: grid.height }}
      >
        {model.edges.map((edge, index) => {
          const from = cellOf.get(edge.from);
          const to = cellOf.get(edge.to);
          if (!from || !to || edge.from === edge.to) return null;
          const route = routeEdge(from, to);
          return (
            <div
              key={index}
              className={styles.edge}
              data-edge
              data-from={edge.from}
              data-to={edge.to}
            >
              <svg
                className={styles.arrow}
                width={grid.width}
                height={grid.height}
                aria-hidden="true"
              >
                <path d={route.line} className={styles.line} />
                <polygon points={route.head} className={styles.arrowHead} />
              </svg>
              <span
                className={styles.edgeLabel}
                data-edge-label
                style={{ left: route.label.x, top: route.label.y }}
              >
                {edge.label}
              </span>
            </div>
          );
        })}
        {model.cards.map((card, index) => {
          const origin = cardOrigin(grid.cells[index]!);
          return (
            <div
              key={card.name}
              className={card.from === null
                ? styles.entity
                : `${styles.entity} ${styles.outer}`}
              data-entity={card.name}
              style={{
                left: origin.x,
                top: origin.y,
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
              }}
            >
              <Entity
                card={card}
                onOpenDocument={onOpenDocument}
                onSeeAll={onSeeAll}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Entity(
  { card, onOpenDocument, onSeeAll }: {
    card: EntityCard;
    onOpenDocument: OpenDocument;
    onSeeAll: (type: string) => void;
  },
): ReactNode {
  return (
    <Card>
      <div className={styles.head}>
        <h3>{card.name}</h3>
        {card.from === null
          ? card.count === null
            ? null
            : (
              <span className={styles.count} data-entity-count>
                {card.count}
              </span>
            )
          : (
            <span className={styles.from} data-entity-from>
              {t("contexts.label.overview-from", { context: card.from })}
            </span>
          )}
      </div>
      {card.meaning === ""
        ? null
        : <p className={styles.meaning} data-entity-meaning>{card.meaning}</p>}
      {card.has.length === 0 ? null : (
        <p className={styles.has} data-entity-has>
          {t("contexts.label.overview-has", { fields: card.has.join(", ") })}
        </p>
      )}
      {card.example === null
        ? null
        : (
          <p className={styles.example} data-entity-example>
            {t("contexts.note.overview-example")}{" "}
            <button
              type="button"
              className={styles.document}
              data-open-document
              onClick={() => onOpenDocument(card.example!.path)}
            >
              {card.example.key}
            </button>
          </p>
        )}
      {card.count === null ? null : (
        <div className={styles.more}>
          <Button
            variant="ghost"
            size="sm"
            data-see-all
            onClick={() => onSeeAll(card.name)}
          >
            {t("contexts.button.overview-see-all", {
              count: String(card.count),
            })}
          </Button>
        </div>
      )}
    </Card>
  );
}
