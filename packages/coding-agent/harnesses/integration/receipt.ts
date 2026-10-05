// 설치 receipt와 recovery journal이다(coding-agent/harnesses#R7, R9, T29).
// receipt는 lophn이 쓴 resource의 소유 증거이고, journal은 파일은 썼는데
// receipt 저장이 실패한 자리의 복구 근거다. 둘 다 token·설정 원문·transcript를
// 담지 않는다(R12). ledger 정본이 아니라 local metadata다(domain-model).
import type { IntegrationTarget } from "../../../contracts/coding-agent/mod.ts";

// sha256 hex다. contracts의 sha256Schema와 같은 64자리 소문자다.
export type Digest = string;

export const RECEIPT_SCHEMA_VERSION = 1;

// resource 하나의 소유 기록이다(domain-model OwnedResourceReceipt).
export type OwnedResource = {
  // plan이 고른 resource의 안정 이름이다. 경로가 바뀌어도 같다.
  canonical_identity: string;
  // target root 기준 상대 경로다. 절대 경로를 저장하지 않는다.
  path: string;
  // fragment merge의 소유 key다. 파일 전체 소유면 null이다.
  owned_key: string | null;
  // 마지막으로 쓴 파일 전체 hash다(R7).
  last_written_hash: Digest;
  // 소유 조각의 digest다. 파일의 다른 부분이 바뀌어도 이 값이 같으면 소유가
  // 유지된다(R7, 조사 9.7).
  owned_fragment_digest: Digest;
  topology: "file" | "directory";
};

export type Receipt = {
  schema_version: number;
  target: IntegrationTarget;
  // connection 참조만 담는다. token 원문은 없다(connection#R17).
  connection: string | null;
  catalog_revision: string;
  adapter_revision: string;
  distribution_hash: Digest;
  resources: OwnedResource[];
  operation_id: string;
  written_at: string;
};

// receipt 저장이 실패했을 때의 복구 근거다(R9). 다음 갱신은 복구 전에 거절한다.
export type JournalEntry = {
  operation_id: string;
  target: IntegrationTarget;
  // 파일을 쓴 뒤의 hash다. 복구가 이 값과 현재 파일을 다시 비교한다(R9).
  written_hash: Digest;
  path: string;
  reason: "receipt_store_failed";
  written_at: string;
};

export type Journal = { entries: JournalEntry[] };
