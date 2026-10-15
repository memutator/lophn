import { ok } from "../../base/mod.ts";
import { approvalsPending } from "../../protocol/approvals/mod.ts";
import type { ReadDefinition } from "../../protocol/server/mod.ts";
import { REQUEST_COLUMNS, requestOf } from "./rows.ts";
import { approvalsUnapplied } from "./routes.ts";

export const approvalsPendingRead: ReadDefinition<typeof approvalsPending> = {
  route: approvalsPending,
  handle(snapshot) {
    const rows = snapshot.sql.all(
      `select ${REQUEST_COLUMNS} from approval_requests
        where status = 'pending' order by created_seq, id`,
      [],
    );
    const requests = [];
    for (const row of rows) {
      const request = requestOf(row);
      if (!request.ok) return request;
      requests.push(request.value);
    }
    return ok({
      requests,
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
  },
};

export const approvalsUnappliedRead: ReadDefinition<typeof approvalsUnapplied> =
  {
    route: approvalsUnapplied,
    handle(snapshot) {
      const rows = snapshot.sql.all(
        `select ${REQUEST_COLUMNS} from approval_requests
          where status = 'allow' and applied is null order by decided_seq, id`,
        [],
      );
      const requests = [];
      for (const row of rows) {
        const request = requestOf(row);
        if (!request.ok) return request;
        requests.push(request.value);
      }
      return ok({
        requests,
        as_of_seq: snapshot.as_of_seq,
        next_cursor: null,
      });
    },
  };
