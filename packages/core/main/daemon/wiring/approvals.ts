import { ok } from "../../../../base/mod.ts";
import {
  createApprovalTextPreparer,
  withApprovalText,
} from "../../../approvals/text-prepare.ts";
import { observeApprovals } from "../../../approvals/mod.ts";
import { messageBodyEnvironment } from "../../../lophn-agent/session/message-body.ts";
import type { WiringFactory } from "./context.ts";

export const approvalsWiring: WiringFactory = () => ({
  name: "approvals",
  restartOwners: [observeApprovals],
  // ReadApprovalText는 ledger snapshot에서 참조를 판정하고 blob 바이트를 읽는 통로를 쓴다.
  environment: (ctx) => ({
    approvalText: messageBodyEnvironment({
      ledgerPath: ctx.ledgerPath,
      read: (hash, offset, length) =>
        ctx.blobRead.deps.read(hash, offset, length),
    }),
  }),
  build(ctx) {
    return ok({
      // approval 설명 글(이유·변경·외부 영향·되돌림)은 writer 앞에서 redaction해 blob으로 준비한다.
      writer: (inner) =>
        withApprovalText(
          inner,
          createApprovalTextPreparer({
            relay: () => ctx.bodyPrepare,
            known: () => ctx.knownSecrets,
          }),
        ),
    });
  },
});
