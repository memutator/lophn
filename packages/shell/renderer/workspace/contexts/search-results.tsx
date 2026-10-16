// 선언된 검색의 결과: 선언이 정한 대로 표 또는 board, 결과 개수와 지금 보는
// 범위("1–5 of 14"), 이전·다음과 page 번호. 개체 이름(F-009, exp-008)은 링크이고 누르면 그
// 문서 탭을 연다.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.button.results-next
//   contexts.button.results-prev
//   contexts.empty.results-none
//   contexts.label.results-count
//   contexts.label.results-pager
//   contexts.label.results-range
import { Fragment, type ReactNode, useMemo } from "react";
import {
  Button,
  Card,
  DataTable,
  type TableColumn,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { DeclaredSearch, SearchRow } from "./source.ts";
import type { OpenDocument } from "./shared.ts";
import {
  boardLanes,
  capitalize,
  documentPath,
  isObjectColumn,
  metaPiece,
  nouns,
  pageCount,
  pageNumbers,
  type ResultColumn,
  rowKey,
  valueOf,
  visibleRange,
} from "./search-results-model.ts";
import styles from "./search-results.module.css";

interface SearchResultsProps {
  readonly search: DeclaredSearch;
  /** 지금 page의 줄. */
  readonly rows: readonly SearchRow[];
  /** 0부터. */
  readonly page: number;
  readonly pageSize: number;
  /** 결과 전체 개수. */
  readonly total: number;
  readonly onPage: (page: number) => void;
  readonly onOpenDocument: OpenDocument;
}

const OPEN_MARK = "data-open-document" as const;

export function SearchResults(props: SearchResultsProps): ReactNode {
  const { search, rows, page, pageSize, total, onPage, onOpenDocument } = props;
  const { singular, plural } = nouns(search);
  if (total === 0 && rows.length === 0) {
    return <p className={styles.empty}>{t("contexts.empty.results-none")}</p>;
  }
  const { result } = search;
  return (
    <div className={styles.root}>
      <p className={styles.count} data-result-count>
        {t("contexts.label.results-count", { count: total, singular, plural })}
      </p>
      {result.kind === "board" && result.board_by !== undefined
        ? (
          <Board
            columns={result.columns}
            boardBy={result.board_by}
            rows={rows}
            onOpenDocument={onOpenDocument}
          />
        )
        : (
          <Table
            columns={result.columns}
            rows={rows}
            onOpenDocument={onOpenDocument}
            onBack={() => onPage(Math.max(0, page - 1))}
          />
        )}
      {total > pageSize && (
        <Pager
          page={page}
          pageSize={pageSize}
          count={rows.length}
          total={total}
          onPage={onPage}
        />
      )}
    </div>
  );
}

function Table(
  { columns, rows, onOpenDocument, onBack }: {
    columns: readonly ResultColumn[];
    rows: readonly SearchRow[];
    onOpenDocument: OpenDocument;
    /** 이 page에 줄이 없을 때 앞 page로 간다. */
    onBack: () => void;
  },
) {
  const now = useMemo(() => new Date(), []);
  const tableColumns = useMemo(
    () =>
      columns.map((column, index): TableColumn<SearchRow> => {
        const base = { id: `${index}:${column.path}`, header: column.label };
        if (!isObjectColumn(column)) {
          return {
            ...base,
            kind: "text",
            value: (row) => valueOf(row, column.path),
          };
        }
        return {
          ...base,
          kind: "link",
          dataAttributes: { [OPEN_MARK]: "" },
          value: (row) => valueOf(row, column.path),
          onOpen: (row) => {
            const path = documentPath(row, column);
            if (path !== undefined) onOpenDocument(path);
          },
        };
      }),
    [columns, onOpenDocument],
  );
  return (
    <DataTable
      columns={tableColumns}
      rows={rows}
      rowKey={(row) => rowKey(row)}
      now={now}
      onRetry={onBack}
      empty={{
        message: t("contexts.empty.results-none"),
        action: {
          label: t("contexts.button.results-prev"),
          onSelect: onBack,
        },
      }}
    />
  );
}

function Board(
  { columns, boardBy, rows, onOpenDocument }: {
    columns: readonly ResultColumn[];
    boardBy: string;
    rows: readonly SearchRow[];
    onOpenDocument: OpenDocument;
  },
) {
  // 카드 머리 줄은 개체 링크 뒤에 첫 열 값, 아래 줄은 나머지 열 값이다. 줄 자신의 이름 열은 링크가 이미 보인다.
  const shown = columns.filter((column) => column.path !== "key");
  const [first, ...rest] = shown;
  return (
    <div className={styles.board}>
      {boardLanes(rows, boardBy).map((lane) => (
        <section
          key={lane.value}
          className={styles.lane}
          data-board-column={lane.value}
        >
          <h2 className={styles.laneHead}>
            <span data-board-title>{capitalize(lane.value)}</span>
            <span className={styles.laneCount} data-board-count>
              {lane.rows.length}
            </span>
          </h2>
          {lane.rows.map((row) => {
            const title = first === undefined ? "" : valueOf(row, first.path);
            const meta = rest.map((column) => metaPiece(row, column)).filter((
              piece,
            ) => piece !== "");
            return (
              <Card key={rowKey(row)}>
                <div data-board-card>
                  <p className={styles.cardTitle} data-board-title-line>
                    <button
                      type="button"
                      className={styles.link}
                      data-open-document
                      onClick={() => onOpenDocument(row.ref.path)}
                    >
                      {row.ref.key}
                    </button>
                    {title !== "" && <Fragment>{` · ${title}`}</Fragment>}
                  </p>
                  {meta.length > 0 && (
                    <p className={styles.cardMeta} data-board-meta>
                      {meta.join(" · ")}
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function Pager(
  { page, pageSize, count, total, onPage }: {
    page: number;
    pageSize: number;
    count: number;
    total: number;
    onPage: (page: number) => void;
  },
) {
  const pages = pageCount(total, pageSize);
  const range = visibleRange(page, pageSize, count, total);
  return (
    <nav
      className={styles.pager}
      aria-label={t("contexts.label.results-pager")}
      data-pager
    >
      {range !== null && (
        <span className={styles.range} data-range>
          {t("contexts.label.results-range", { ...range, total })}
        </span>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={page <= 0}
        onClick={() => onPage(page - 1)}
      >
        {t("contexts.button.results-prev")}
      </Button>
      {pageNumbers(page, pages).map((at, index) =>
        at === null
          ? (
            <span
              key={`gap-${index}`}
              className={styles.gap}
              aria-hidden="true"
            >
              …
            </span>
          )
          : (
            <Button
              key={at}
              size="sm"
              variant={at === page ? "secondary" : "ghost"}
              aria-current={at === page ? "page" : undefined}
              onClick={() => onPage(at)}
            >
              {String(at + 1)}
            </Button>
          )
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={page >= pages - 1}
        onClick={() => onPage(page + 1)}
      >
        {t("contexts.button.results-next")}
      </Button>
    </nav>
  );
}
