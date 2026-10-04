import { CodingAgentConnectionAuth } from "../../contracts/coding-agent/mod.ts";
import type {
  CodingAgentConnectionAuthPort,
  CodingAgentConnectionAuthResult,
} from "../../contracts/coding-agent/mod.ts";
import type { ReadSnapshot, Tx } from "../../contracts/platform/mod.ts";
import { loadByPrincipal } from "./store.ts";

// principal → connection·state·scope·token_digest·revision.
// digest는 이 port 출력에만 있다. 없는 principal은 undefined다.
export function lookupConnectionAuth(
  sql: Pick<Tx["sql"], "get" | "all">,
  principal: string,
): CodingAgentConnectionAuthResult | undefined {
  const loaded = loadByPrincipal(sql, principal);
  if (!loaded.ok || loaded.value === null) return undefined;
  return {
    connection: loaded.value.connection.id,
    state: loaded.value.connection.state,
    scope: loaded.value.connection.scope,
    token_digest: loaded.value.token_hash,
    revision: loaded.value.connection.revision,
  };
}

export function connectionAuthFromTx(tx: Tx): CodingAgentConnectionAuthPort {
  return (principal) =>
    Promise.resolve(lookupConnectionAuth(tx.sql, principal));
}

export function connectionAuthFromSnapshot(
  snapshot: ReadSnapshot,
): CodingAgentConnectionAuthPort {
  return (principal) =>
    Promise.resolve(lookupConnectionAuth(snapshot.sql, principal));
}

export const connectionAuthPort = CodingAgentConnectionAuth;
