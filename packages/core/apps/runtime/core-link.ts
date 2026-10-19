// supervisor가 core를 부르는 자리. 구현은 core/main/app-supervisor entry가 조립한다.
// 여기 모듈은 그 모양만 정한다.
import type { Result } from "../../../base/mod.ts";

export type RuntimeRecord =
  | {
    method: "record_started";
    app: string;
    process_nonce: string;
    started_at: string;
    attestation: {
      release: string | null;
      bundle_hash: string;
      tools: string[];
      data_schema: number;
      process_nonce: string;
      connection_ok: true;
    };
    // 앱 시작이 DB를 바꿨을 때 앱 process가 ready로 보낸 changeset(base64).
    start_changeset?: string;
  }
  | {
    method: "record_stopped";
    app: string;
    release: string;
    process_nonce: string;
    started_at: string;
  }
  | {
    method: "record_unavailable";
    app: string;
    release: string;
    process_nonce?: string;
    started_at?: string;
    reason: { code: string; summary: string };
  };

export type CoreLink = {
  // machine credential로 /apps/<method>를 부른다. run_enabled는 건드리지 않는다.
  record(record: RuntimeRecord): Promise<Result<{ state: string }>>;
};
