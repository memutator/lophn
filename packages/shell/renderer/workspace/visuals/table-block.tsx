// 표 블록. design의 DataTable로 그린다. 칸 값은 문자열·숫자로만
// 넘기고 Table이 text node로 그린다. null은 결측이라 빈 칸으로 두고 0으로 바꾸지 않는다.
import { DataTable, type TableColumn } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { Cell, TableContent } from "./registry.ts";

/** 대화 칸에서 한 번에 보이는 행 수. 나머지는 페이지로 넘긴다. */
export const TABLE_PAGE_SIZE = 10;

interface Row {
  readonly index: number;
  readonly cells: Readonly<Record<string, Cell>>;
}

export interface TableBlockProps {
  content: TableContent;
  /** 비었을 때의 다음 행동. 블록 설명이 비어 있는 이유를 말한다. */
  onReadDescription: () => void;
  onRetry: () => void;
  now: Date;
}

function textOf(value: Cell): string | undefined {
  if (value === null) return undefined;
  if (typeof value === "boolean") {
    return value
      ? t("conversation.label.visual-yes")
      : t("conversation.label.visual-no");
  }
  return String(value);
}

function columnsOf(content: TableContent): TableColumn<Row>[] {
  return content.columns.map((column, index): TableColumn<Row> => {
    const base = {
      id: `column-${index}`,
      header: column.label,
      ...(column.unit === null ? {} : { unit: column.unit }),
    };
    if (column.type === "number") {
      return {
        ...base,
        kind: "number",
        value: (row) => {
          const value = row.cells[column.key];
          return typeof value === "number" ? value : undefined;
        },
      };
    }
    return {
      ...base,
      kind: "text",
      value: (row) => textOf(row.cells[column.key] ?? null),
    };
  });
}

export function TableBlock(
  { content, onReadDescription, onRetry, now }: TableBlockProps,
) {
  const rows = content.rows.map((cells, index): Row => ({ index, cells }));
  return (
    <div data-visual-table="">
      <DataTable
        columns={columnsOf(content)}
        rows={rows}
        rowKey={(row) => String(row.index)}
        now={now}
        pageSize={TABLE_PAGE_SIZE}
        density="compact"
        onRetry={onRetry}
        empty={{
          message: t("conversation.empty.visual-no-data"),
          action: {
            label: t("conversation.button.visual-read-description"),
            onSelect: onReadDescription,
          },
        }}
      />
    </div>
  );
}
