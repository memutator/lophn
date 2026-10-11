// 시작 type의 개체로 행을 만들고 follow로 별칭 개체를 붙인다(inner join).
import type {
  Contract,
  SearchQuery,
} from "../../../contracts/documents/mod.ts";
import type { InputValues, Row, SearchEntity } from "./types.ts";

export function expandFollows(
  _query: SearchQuery,
  _contract: Contract,
  _entities: readonly SearchEntity[],
  _inputs: InputValues,
): Row[] {
  return [];
}
