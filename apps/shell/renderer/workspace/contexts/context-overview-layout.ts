// Overview 그림의 자리 계산: 카드는 한 칸 크기가 같은 격자에 놓이고, 화살표는 카드 가장자리에서
// 가장자리로 잇는다. 같은 줄·같은 칸에서 카드를 건너뛰는 화살표는 바깥으로 휘어 돌아간다.
export const CARD_WIDTH = 240;
export const CARD_HEIGHT = 232;
export const GAP_X = 120;
export const GAP_Y = 100;
export const MARGIN = 56;
const COLUMNS = 3;
const ARROW_LENGTH = 9;
const ARROW_HALF_WIDTH = 5;
const ARC = 60;
const PAD = 4;

export interface Cell {
  readonly column: number;
  readonly row: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Route {
  /** SVG path. */
  readonly line: string;
  /** 화살촉 꼭짓점. */
  readonly head: string;
  readonly label: Point;
}

export interface Grid {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly Cell[];
}

export function layoutGrid(count: number): Grid {
  const columns = Math.min(COLUMNS, Math.max(1, count));
  const rows = Math.max(1, Math.ceil(count / columns));
  return {
    width: columns * CARD_WIDTH + (columns - 1) * GAP_X + MARGIN * 2,
    height: rows * CARD_HEIGHT + (rows - 1) * GAP_Y + MARGIN * 2,
    cells: Array.from({ length: count }, (_, index) => ({
      column: index % columns,
      row: Math.floor(index / columns),
    })),
  };
}

export function cardOrigin(cell: Cell): Point {
  return {
    x: MARGIN + cell.column * (CARD_WIDTH + GAP_X),
    y: MARGIN + cell.row * (CARD_HEIGHT + GAP_Y),
  };
}

const round = (value: number) => Math.round(value * 10) / 10;
const pair = (point: Point) => `${round(point.x)},${round(point.y)}`;

function head(end: Point, direction: Point): string {
  const length = Math.hypot(direction.x, direction.y) || 1;
  const ux = direction.x / length;
  const uy = direction.y / length;
  const base = { x: end.x - ux * ARROW_LENGTH, y: end.y - uy * ARROW_LENGTH };
  return [
    end,
    { x: base.x - uy * ARROW_HALF_WIDTH, y: base.y + ux * ARROW_HALF_WIDTH },
    { x: base.x + uy * ARROW_HALF_WIDTH, y: base.y - ux * ARROW_HALF_WIDTH },
  ].map(pair).join(" ");
}

export function routeEdge(from: Cell, to: Cell): Route {
  const a = cardOrigin(from);
  const b = cardOrigin(to);
  const columnGap = Math.abs(to.column - from.column);
  const rowGap = Math.abs(to.row - from.row);
  if (rowGap === 0 && columnGap > 1) {
    // 같은 줄에서 카드를 건너뛴다: 카드 위로 휘어 돌아간다.
    const start = { x: a.x + CARD_WIDTH / 2, y: a.y - PAD };
    const end = { x: b.x + CARD_WIDTH / 2, y: b.y - PAD };
    return {
      line: `M${pair(start)} C${start.x},${start.y - ARC} ${end.x},${
        end.y - ARC
      } ${pair(end)}`,
      head: head(end, { x: 0, y: 1 }),
      label: { x: (start.x + end.x) / 2, y: start.y - ARC * 0.75 },
    };
  }
  if (columnGap === 0 && rowGap > 1) {
    const start = { x: a.x + CARD_WIDTH + PAD, y: a.y + CARD_HEIGHT / 2 };
    const end = { x: b.x + CARD_WIDTH + PAD, y: b.y + CARD_HEIGHT / 2 };
    return {
      line: `M${pair(start)} C${start.x + ARC},${start.y} ${
        end.x + ARC
      },${end.y} ${pair(end)}`,
      head: head(end, { x: -1, y: 0 }),
      label: { x: start.x + ARC * 0.75, y: (start.y + end.y) / 2 },
    };
  }
  const centerA = { x: a.x + CARD_WIDTH / 2, y: a.y + CARD_HEIGHT / 2 };
  const centerB = { x: b.x + CARD_WIDTH / 2, y: b.y + CARD_HEIGHT / 2 };
  const dx = centerB.x - centerA.x;
  const dy = centerB.y - centerA.y;
  const exit = Math.min(
    dx === 0 ? Infinity : (CARD_WIDTH / 2 + PAD) / Math.abs(dx),
    dy === 0 ? Infinity : (CARD_HEIGHT / 2 + PAD) / Math.abs(dy),
  );
  const start = { x: centerA.x + dx * exit, y: centerA.y + dy * exit };
  const end = { x: centerB.x - dx * exit, y: centerB.y - dy * exit };
  // 대각선 둘이 가운데에서 만나므로 라벨은 보내는 쪽에 가깝게 둔다.
  const along = dx === 0 || dy === 0 ? 0.5 : 0.35;
  return {
    line: `M${pair(start)} L${pair(end)}`,
    head: head(end, { x: dx, y: dy }),
    label: {
      x: start.x + (end.x - start.x) * along,
      y: start.y + (end.y - start.y) * along,
    },
  };
}
