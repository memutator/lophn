// SetSecret·RemoveSecret은 참조와 판만 다룬다(platform/secrets#R6).
// OS 준비는 command 밖에서 끝났고, 값은 이 경계에 오지 않는다.

import { err, ok } from "../../base/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import {
  removeSecret,
  type SecretPreparation,
  secretRemoved,
  secretSet,
  setSecret,
} from "../../protocol/secrets/mod.ts";
import { defineSyncCommand } from "../storage/ledger/mod.ts";
import { applyRemove, applySet, type SecretRecord, toStatus } from "./model.ts";

function readSecret(tx: Tx, name: string): SecretRecord | undefined {
  const row = tx.sql.get(
    "select name, sealed_ref, revision from secrets where name = ?",
    [name],
  );
  if (row === undefined) return undefined;
  return {
    name: String(row["name"]),
    sealedRef: String(row["sealed_ref"]),
    revision: Number(row["revision"]),
  };
}

function unknownPreparation(tx: Tx, preparation: SecretPreparation): boolean {
  const known = tx.sql.get(
    "select preparation from secret_preparations where preparation = ? and sealed_ref = ? and purpose = ? and owner = ?",
    [
      preparation.preparation,
      preparation.sealed_ref,
      preparation.purpose,
      preparation.owner,
    ],
  );
  return known === undefined;
}

export const setSecretCommand = defineSyncCommand(
  setSecret,
  (tx, _ctx, input, compare) => {
    if (unknownPreparation(tx, input.preparation)) {
      return err({ code: "forbidden", message: "준비 증거가 없다" });
    }
    const current = readSecret(tx, input.name);
    const applied = applySet(
      current,
      compare,
      input.name,
      input.preparation.sealed_ref,
    );
    if (!applied.ok) return applied;
    const next = applied.value;
    if (current === undefined) {
      tx.sql.run(
        "insert into secrets (name, sealed_ref, revision) values (?, ?, ?)",
        [next.name, next.sealedRef, next.revision],
      );
    } else {
      tx.sql.run(
        "update secrets set sealed_ref = ?, revision = ? where name = ? and sealed_ref = ? and revision = ?",
        [
          next.sealedRef,
          next.revision,
          next.name,
          current.sealedRef,
          current.revision,
        ],
      );
    }
    tx.sql.run("delete from secret_preparations where preparation = ?", [
      input.preparation.preparation,
    ]);
    tx.emit(secretSet, `secret:${next.name}`, { name: next.name });
    return ok(toStatus(next, next.name));
  },
);

export const removeSecretCommand = defineSyncCommand(
  removeSecret,
  (tx, _ctx, input, compare) => {
    const current = readSecret(tx, input.name);
    const applied = applyRemove(current, compare);
    if (!applied.ok) return applied;
    tx.sql.run(
      "delete from secrets where name = ? and sealed_ref = ? and revision = ?",
      [applied.value.name, applied.value.sealedRef, applied.value.revision],
    );
    tx.emit(secretRemoved, `secret:${input.name}`, { name: input.name });
    // 참조 차단만 확정한다. OS 삭제·프로세스 종료는 아직 관측하지 않았다(R7).
    return ok({
      reference_blocked: true,
      os_deleted: false,
      processes_ended: false,
    });
  },
);

export const SECRET_COMMANDS = [setSecretCommand, removeSecretCommand] as const;
