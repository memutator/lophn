// 거절 억제(platform/approvals#R16)가 쓰는 run 계보 판정 port. platform은 run을 직접 읽지 않는다.
// lophn-agent가 같은 Tx에서 run의 source로 채운다(runs/read의 source.message 또는 handoff의
// original_message와 같은 값). origin이 같으면 같은 원래 사람 요청에서 이어진 run이다.
import { definePort } from "../../contracts/platform/mod.ts";

export type ApprovalRunLineage = {
  // 사람 요청에서 시작한 run은 그 요청(message)의 id, handoff run은 original_message다.
  // 주기 회차처럼 사람 요청에 이어지지 않거나 모르는 run은 null이다. 이때는 같은 run만 같은 계보다.
  origin(run: string): string | null;
};

export const approvalRunLineage = definePort<ApprovalRunLineage>(
  "platform.approval-run-lineage",
);
