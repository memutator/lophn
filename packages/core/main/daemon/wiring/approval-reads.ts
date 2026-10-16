// activation이 approvals 표를 읽는 두 가지다. `Approvals` port에 읽기가 없어 조립이 ledger를 직접 읽는다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { PendingApproval } from "../../../../protocol/approvals/mod.ts";
import {
  loadRequest,
  REQUEST_COLUMNS,
  requestOf,
} from "../../../approvals/rows.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";

export function approvalLedgerRead(ledgerPath: string) {
  function read<T>(
    run: (sql: Sql) => Result<T>,
  ): Result<T> {
    const opened = openConnection(ledgerPath);
    if (!opened.ok) {
      return err({ code: "unavailable", message: "ledger is unavailable" });
    }
    try {
      return run(opened.value.sql);
    } catch {
      return err({ code: "unavailable", message: "ledger is unavailable" });
    } finally {
      opened.value.close();
    }
  }
  return {
    request: (id: string): Result<PendingApproval | null> =>
      read((sql) => loadRequest(sql, id)),
    pending: (): Result<PendingApproval[]> =>
      read((sql) => {
        const requests: PendingApproval[] = [];
        for (
          const row of sql.all(
            `select ${REQUEST_COLUMNS} from approval_requests
              where status = 'pending' order by created_seq, id`,
            [],
          )
        ) {
          const request = requestOf(row);
          if (!request.ok) return request;
          requests.push(request.value);
        }
        return ok(requests);
      }),
  };
}
