import type { Result } from "../../../base/mod.ts";
import type {
  OperatorDirectory,
  OperatorInfo,
} from "../../lophn-agent/places/ports.ts";
import {
  type AgentContext,
  listOperators,
  loadAgent,
  type Loaded,
  nameOf,
  operatorIdOf,
  type ReadSql,
} from "../../lophn-agent/agents/mod.ts";
import { ROLE_TABLE } from "./role-table.ts";

// Operator 조회. session을 열 때와 Router의 session 목록이 읽는다. 정의를 여는 길(openAgents)은 harness가
// 내놓고 wiring이 넘긴다.
export function createOperatorDirectory(
  openAgents: (sql: ReadSql) => Result<AgentContext>,
): (sql: ReadSql) => OperatorDirectory {
  return (sql) => {
    const opened = openAgents(sql);
    const toInfo = (loaded: Loaded): OperatorInfo | null =>
      ROLE_TABLE.isOperator(loaded.role) && loaded.place !== null
        ? {
          id: operatorIdOf(loaded.ref) as OperatorInfo["id"],
          name: nameOf(ROLE_TABLE, loaded),
          place: loaded.place,
          domains: loaded.definition !== null && "domains" in loaded.definition
            ? loaded.definition.domains ?? []
            : [],
          skip: loaded.definition !== null && "skip" in loaded.definition &&
            loaded.definition.skip === true,
        }
        : null;
    return {
      operator(id) {
        if (!opened.ok) return null;
        const loaded = loadAgent(opened.value, ROLE_TABLE.operatorRef(id));
        return loaded.ok && loaded.value !== null ? toInfo(loaded.value) : null;
      },
      operators() {
        if (!opened.ok) return [];
        const listed = listOperators(opened.value);
        return listed.ok
          ? listed.value.flatMap((loaded) => toInfo(loaded) ?? [])
          : [];
      },
    };
  };
}
