// 모든 Operator 정의 층의 MCP 서버를 ledger snapshot에서 읽는다. runtime child의 권한(lophn-agent-runtime)과
// `mcp.` secret 목적지(secrets)가 같은 목록을 본다. 정의 파일을 읽는 길은 lophn-agent-team이 가진다.
import type { Result } from "../../../../base/mod.ts";
import type { OperatorMcpEntry } from "../../../lophn-agent/extensions/mcp-snapshot.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import { operatorMcpServers } from "./lophn-agent-team.ts";

export function readOperatorMcp(
  ledgerPath: string,
): Promise<Result<readonly OperatorMcpEntry[]>> {
  const read = ledgerSnapshot(
    ledgerPath,
    (lookup) => operatorMcpServers(lookup.sql),
  );
  return Promise.resolve(read.ok ? read.value : read);
}
