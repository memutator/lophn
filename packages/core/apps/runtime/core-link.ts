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
      // 앱 시작이 DB를 바꿨을 때 앱 process가 ready로 보낸 changeset(base64)과 sync 앱이면 그 clock.
      start_changeset?: string;
      start_hlc?: string;
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
    }
  | {
      method: "record_preview";
      app: string;
      process_nonce: string;
      state: "ready" | "exited";
      reason?: { code: string; summary: string };
    };

export type CoreLink = {
  // machine credential로 /apps/<method>를 부른다. run_enabled는 건드리지 않는다. record_preview는 memory route라
  // 입력만 보내고 state는 보낸 state다.
  record(record: RuntimeRecord): Promise<Result<{ state: string }>>;
};
