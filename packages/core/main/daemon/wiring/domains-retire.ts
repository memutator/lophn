// domain을 걷어낸 뒤 옛 data root에 남은 것을 거두는 wiring이다.
// - `domains.tables`는 이미 적용한 ledger가 이 id를 기록하고 있어 목록에서 뺄 수 없다(빼면 기동을 거절한다).
//   새 data root에는 data step이 돌지 않아 빈 표가 남는다. 쓰는 곳은 없다.
// - `domains.retire`는 `domains` 표를 읽는 data step(`artifacts.container`, `domains.place-data`)이 다 돈 뒤에 도는
//   마지막 step이다(assembly.ts의 WIRINGS 순서). 표와 `derived/kinds.sqlite`를 지우고, `domains/` 폴더는 file이 남지 않았을 때만 지운다.
import { annotationPreviewBundleSchemaSteps } from "../../../apps/annotations/mod.ts";
import { readdir, rm } from "node:fs/promises";
import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import type { SchemaStep } from "../../../../protocol/server/mod.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";
import type { WiringFactory } from "./context.ts";

export const domainsSchemaSteps: readonly SchemaStep[] = [
  {
    id: "domains.tables",
    sql: `
    CREATE TABLE domains (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL CHECK (length(title) > 0),
      purpose TEXT NOT NULL,
      owner_kind TEXT NOT NULL CHECK (owner_kind IN ('project', 'app')),
      owner_id TEXT NOT NULL CHECK (length(owner_id) > 0),
      revision TEXT NOT NULL CHECK (
        length(revision) > 0 AND substr(revision, 1, 1) BETWEEN '1' AND '9'
        AND revision NOT GLOB '*[^0-9]*'
        AND (length(revision) < 19 OR
          (length(revision) = 19 AND revision <= '9223372036854775807'))
      ),
      status TEXT NOT NULL CHECK (status IN ('active', 'archived'))
    ) STRICT;
    CREATE INDEX domains_owner ON domains(owner_kind, owner_id, status);
    CREATE TRIGGER domains_no_identity_change
    BEFORE UPDATE OF id, name, owner_kind, owner_id ON domains
    WHEN NEW.id <> OLD.id OR NEW.name <> OLD.name
      OR NEW.owner_kind <> OLD.owner_kind OR NEW.owner_id <> OLD.owner_id
    BEGIN SELECT RAISE(ABORT, 'domain identity is immutable'); END;
    CREATE TRIGGER domains_no_delete BEFORE DELETE ON domains
    BEGIN SELECT RAISE(ABORT, 'domains are archived, not deleted'); END;
  `,
  },
];

// 옮기지 못한 artifact와 skill은 제자리에 남는다. file이 하나라도 있으면 폴더를 지우지 않는다.
async function hasFile(folder: string): Promise<boolean> {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (!entry.isDirectory() || (await hasFile(`${folder}/${entry.name}`))) {
      return true;
    }
  }
  return false;
}

export const domainsRetireStep: DataStep = {
  id: "domains.retire",
  async run(root): Promise<Result<void>> {
    const opened = openConnection(`${root}/lophn.db`);
    if (!opened.ok) return opened;
    const connection = opened.value;
    try {
      try {
        connection.exec("drop table if exists domains");
      } finally {
        connection.close();
      }
      for (const suffix of ["", "-wal", "-shm"]) {
        await rm(`${root}/derived/kinds.sqlite${suffix}`, { force: true });
      }
      const folder = `${root}/domains`;
      try {
        if (!(await hasFile(folder))) await rm(folder, { recursive: true });
      } catch (thrown) {
        if (errorCode(thrown) !== "ENOENT") throw thrown;
      }
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message: "the old domains folder could not be removed",
      });
    }
  },
};

export const domainsRetireWiring: WiringFactory = () => ({
  name: "domains-retire",
  schemaSteps: domainsSchemaSteps,
  // 낸 ledger step은 목록 끝에만 붙는다(schema-steps.lock.json). 이 wiring이 WIRINGS의 맨 뒤라 `lophn.split-per-workspace` 뒤에 낸 step이 여기 온다.
  schemaStepsAfterTeams: annotationPreviewBundleSchemaSteps,
  dataSteps: [domainsRetireStep],
});
