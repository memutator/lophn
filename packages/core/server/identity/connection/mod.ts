// coding agent connection의 ledger 쪽이다. 표 schema, 저장, command·read, 인증 port, 비밀 참조를 core가 가진다.
export { connectionSchemaSteps } from "./schema.ts";
// core 조립이 시작 때 active connection 목록을 읽는다(platform 인증 색인 복원).
export { listConnections } from "./store.ts";
export {
  assertConnection,
  nextState,
  principalFor,
  scopeColumns,
} from "./model.ts";
export {
  createConnectionCommands,
  requireConfirmation,
  revokeConnection,
} from "./commands.ts";
export { createConnectionReads } from "./reads.ts";
export {
  connectionAuthFromSnapshot,
  connectionAuthFromTx,
  connectionAuthPort,
  connectionAuthSyncFromTx,
  connectionAuthSyncPort,
  lookupConnectionAuth,
} from "./auth.ts";
export {
  CONNECTION_SECRET_OWNER,
  createConnectionSecretRefSource,
} from "./secret-refs.ts";
