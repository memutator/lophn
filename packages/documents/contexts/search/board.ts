// board 결과: board_by 값마다 lane.
import type {
  Contract,
  ResultView,
  SearchQuery,
} from "../../../contracts/documents/mod.ts";
import type { BoardResult, Row } from "./types.ts";

export function toBoard(
  _rows: readonly Row[],
  _query: SearchQuery,
  _view: ResultView,
  _contract: Contract,
): BoardResult {
  return { kind: "board", lanes: [], total: 0 };
}
