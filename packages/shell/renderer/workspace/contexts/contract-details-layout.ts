// Contract 그림의 자리 계산: 개체 상자를 세 칸 격자에 놓고, 화살표는 상자 가장자리에서 가장자리로 잇는다.
// 같은 줄·같은 칸에서 상자를 건너뛰는 화살표는 바깥으로 휘어 돌아가고, 자기 자신을 가리키는 화살표는 위로 돈다.
// context-overview-layout.ts와 원리는 같지만 상자가 글 한 줄 크기라서 따로 둔다.
export const NODE_WIDTH = 176;
export const NODE_HEIGHT = 40;
const GAP_X = 96;
const GAP_Y = 72;
const MARGIN = 48;
const COLUMNS = 3;
const ARROW_LENGTH = 8;
const ARROW_HALF_WIDTH = 4;
const ARC = 56;
const PAD = 4;

interface Cell {
  readonly column: number;
  readonly row: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Route {
  /** SVG path. */
  readonly line: string;
  /** 화살촉 꼭짓점 세 개를 이은 points 글. */
  readonly head: string;
  /** 관계 label을 놓을 자리(선의 가운데 또는 휜 선의 꼭대기). */
  readonly label: Point;
}

interface Grid {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly Cell[];
}

export function layoutGrid(count: number): Grid {
  const columns = Math.min(COLUMNS, Math.max(1, count));
  const rows = Math.max(1, Math.ceil(count / columns));
  return {
    width: columns * NODE_WIDTH + (columns - 1) * GAP_X + MARGIN * 2,
    height: rows * NODE_HEIGHT + (rows - 1) * GAP_Y + MARGIN * 2,
    cells: Array.from({ length: count }, (_, index) => ({
      column: index % columns,
      row: Math.floor(index / columns),
    })),
  };
}

export function nodeOrigin(cell: Cell): Point {
  return {
    x: MARGIN + cell.column * (NODE_WIDTH + GAP_X),
    y: MARGIN + cell.row * (NODE_HEIGHT + GAP_Y),
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
  const a = nodeOrigin(from);
  const b = nodeOrigin(to);
  const columnGap = Math.abs(to.column - from.column);
  const rowGap = Math.abs(to.row - from.row);
  if (rowGap === 0 && columnGap === 0) {
    // 자기 자신: 위쪽으로 돌아 아래를 향해 들어온다.
    const start = { x: a.x + NODE_WIDTH * 0.75, y: a.y };
    const end = { x: a.x + NODE_WIDTH * 0.25, y: a.y };
    return {
      line: `M${pair(start)} C${start.x},${start.y - ARC} ${end.x},${
        end.y - ARC
      } ${pair(end)}`,
      head: head(end, { x: 0, y: 1 }),
      label: { x: a.x + NODE_WIDTH / 2, y: a.y - ARC * 0.75 },
    };
  }
  if (rowGap === 0 && columnGap > 1) {
    // 같은 줄에서 상자를 건너뛴다: 상자 위로 휘어 돌아간다.
    const start = { x: a.x + NODE_WIDTH / 2, y: a.y - PAD };
    const end = { x: b.x + NODE_WIDTH / 2, y: b.y - PAD };
    return {
      line: `M${pair(start)} C${start.x},${start.y - ARC} ${end.x},${
        end.y - ARC
      } ${pair(end)}`,
      head: head(end, { x: 0, y: 1 }),
      label: {
        x: (start.x + end.x) / 2,
        y: start.y - ARC * 0.75,
      },
    };
  }
  if (columnGap === 0 && rowGap > 1) {
    // 같은 칸에서 상자를 건너뛴다: 오른쪽으로 휘어 돌아간다.
    const start = { x: a.x + NODE_WIDTH + PAD, y: a.y + NODE_HEIGHT / 2 };
    const end = { x: b.x + NODE_WIDTH + PAD, y: b.y + NODE_HEIGHT / 2 };
    return {
      line: `M${pair(start)} C${start.x + ARC},${start.y} ${
        end.x + ARC
      },${end.y} ${pair(end)}`,
      head: head(end, { x: -1, y: 0 }),
      label: {
        x: start.x + ARC * 0.75,
        y: (start.y + end.y) / 2,
      },
    };
  }
  const centerA = { x: a.x + NODE_WIDTH / 2, y: a.y + NODE_HEIGHT / 2 };
  const centerB = { x: b.x + NODE_WIDTH / 2, y: b.y + NODE_HEIGHT / 2 };
  const dx = centerB.x - centerA.x;
  const dy = centerB.y - centerA.y;
  const exit = Math.min(
    dx === 0 ? Infinity : (NODE_WIDTH / 2 + PAD) / Math.abs(dx),
    dy === 0 ? Infinity : (NODE_HEIGHT / 2 + PAD) / Math.abs(dy),
  );
  const start = { x: centerA.x + dx * exit, y: centerA.y + dy * exit };
  const end = { x: centerB.x - dx * exit, y: centerB.y - dy * exit };
  const along = dx === 0 || dy === 0 ? 0.5 : 0.35;
  return {
    line: `M${pair(start)} L${pair(end)}`,
    head: head(end, { x: dx, y: dy }),
    // 대각선 둘이 가운데에서 만나므로 라벨은 보내는 쪽에 가깝게 둔다.
    label: {
      x: start.x + (end.x - start.x) * along,
      y: start.y + (end.y - start.y) * along,
    },
  };
}
