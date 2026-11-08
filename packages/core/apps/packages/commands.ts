import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type Package,
  packageRegisterVersion,
  type PackageVersion,
  packageVersionRegistered,
} from "../../../protocol/apps/mod.ts";
import type { PreparedBlob } from "../../../protocol/storage/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import {
  PACKAGE_BUNDLE_BLOB_FIELD_NAME,
  PACKAGE_BUNDLE_BLOB_PURPOSE,
  PACKAGE_GUIDE_BLOB_FIELD_NAME,
  PACKAGE_GUIDE_BLOB_OWNER_KIND,
  PACKAGE_GUIDE_BLOB_PURPOSE,
  packageGuideOwnerKey,
} from "./blobs.ts";
import { loadPackageRow, loadStoredVersion, loadVersions } from "./store.ts";

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function forbidden(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

// machine 통보만 받는다. route actors가 이미 걸러도 여기서 한 번 더 본다.
function requireMachine(ctx: RequestContext): Result<void> {
  return ctx.actor.startsWith("machine")
    ? ok(undefined)
    : forbidden("package versions are registered by the install machine only");
}

type BlobSpec = {
  blob: PreparedBlob | undefined;
  hash: string;
  purpose: string;
  field: string;
  what: string;
};

// byte를 준비한 blob이 있으면 그 참조를 같은 transaction에서 등록한다. 실제로 보존한 byte의 hash만
// *_hash로 둘 수 있다: 준비한 blob의 hash·purpose가 다르면 이 command 전체가 거절이다.
// missingOnly는 이미 잡힌 version의 재시도용이다: 참조가 이미 있으면 그대로 두고, 없을 때만(옛 판을 되살리는
// 마이그레이션이나 참조 등록 전에 끊긴 재시도) 붙인다.
function registerBlob(
  tx: Parameters<CommandDefinition<typeof packageRegisterVersion>["handle"]>[0],
  input: Parameters<
    CommandDefinition<typeof packageRegisterVersion>["handle"]
  >[2],
  seq: string,
  spec: BlobSpec,
  missingOnly: boolean,
): Result<void> {
  const blob = spec.blob;
  if (blob === undefined) return ok(undefined);
  if (blob.hash !== spec.hash || blob.purpose !== spec.purpose) {
    return err({
      code: "invalid_input",
      message: `${spec.what} hash is not the preserved ${spec.what} blob`,
    });
  }
  const ownerKey = packageGuideOwnerKey(input.name, input.version);
  if (
    missingOnly &&
    tx.sql.get(
      "SELECT 1 AS found FROM blob_refs WHERE owner_kind = ? AND owner_key = ? AND field = ?",
      [PACKAGE_GUIDE_BLOB_OWNER_KIND, ownerKey, spec.field],
    ) !== undefined
  ) {
    return ok(undefined);
  }
  const registered = tx.registerBlobRef({
    owner_kind: PACKAGE_GUIDE_BLOB_OWNER_KIND,
    owner_key: ownerKey,
    field: spec.field,
    registered_seq: seq,
    source: { kind: "prepared", blob: { ...blob } },
  });
  if (registered.ok) return ok(undefined);
  const code = registered.error.code;
  return code === "conflict"
    ? registered
    : err({
        code: "invalid_input",
        message: `${spec.what} blob is not a prepared blob of this caller`,
      });
}

function registerBlobs(
  tx: Parameters<CommandDefinition<typeof packageRegisterVersion>["handle"]>[0],
  input: Parameters<
    CommandDefinition<typeof packageRegisterVersion>["handle"]
  >[2],
  seq: string,
  missingOnly = false,
): Result<void> {
  const guide = registerBlob(
    tx,
    input,
    seq,
    {
      blob: input.guide_blob,
      hash: input.guide_hash,
      purpose: PACKAGE_GUIDE_BLOB_PURPOSE,
      field: PACKAGE_GUIDE_BLOB_FIELD_NAME,
      what: "guide",
    },
    missingOnly,
  );
  if (!guide.ok) return guide;
  return registerBlob(
    tx,
    input,
    seq,
    {
      blob: input.bundle_blob,
      hash: input.bundle_hash,
      purpose: PACKAGE_BUNDLE_BLOB_PURPOSE,
      field: PACKAGE_BUNDLE_BLOB_FIELD_NAME,
      what: "bundle",
    },
    missingOnly,
  );
}

// 재시도에는 새 event가 없어 참조 등록 시각을 지금의 ledger 끝으로 둔다.
function headSeq(
  tx: Parameters<CommandDefinition<typeof packageRegisterVersion>["handle"]>[0],
): string {
  const row = tx.sql.get(
    "SELECT COALESCE(MAX(seq), 0) AS head FROM events",
    [],
  );
  return String(row?.["head"] ?? 0);
}

type RegisterInput = Parameters<
  CommandDefinition<typeof packageRegisterVersion>["handle"]
>[2];

// 새 package의 첫 version이든 기존 package의 새 version이든 같은 event를 낸다.
function emitRegistered(
  tx: Parameters<CommandDefinition<typeof packageRegisterVersion>["handle"]>[0],
  packageId: string,
  input: RegisterInput,
): string {
  return tx.emit(packageVersionRegistered, packageId, {
    name: input.name,
    version: input.version,
    permissions: input.permissions ?? [],
    bundle_hash: input.bundle_hash,
    guide_hash: input.guide_hash,
  });
}

function insertVersion(
  tx: Parameters<CommandDefinition<typeof packageRegisterVersion>["handle"]>[0],
  packageId: string,
  input: RegisterInput,
): void {
  tx.sql.run(
    "INSERT INTO package_versions (package, version, bundle_hash, guide_hash, permissions) VALUES (?, ?, ?, ?, ?)",
    [
      packageId,
      input.version,
      input.bundle_hash,
      input.guide_hash,
      JSON.stringify(input.permissions ?? []),
    ],
  );
}

function registered(
  tx: Parameters<CommandDefinition<typeof packageRegisterVersion>["handle"]>[0],
  packageId: string,
  name: string,
  description: string,
  owner: Package["owner_app"],
  version: string,
): Result<{ package: Package; version: PackageVersion }> {
  const versions = loadVersions(tx.sql, packageId);
  const published = versions.find((item) => item.version === version);
  if (published === undefined) {
    return err({ code: "internal", message: "registered version is missing" });
  }
  return ok({
    package: {
      id: packageId,
      name,
      description,
      owner_app: owner,
      versions,
    },
    version: published,
  });
}

export function createSdkCommands(): {
  registerVersion: CommandDefinition<typeof packageRegisterVersion>;
} {
  return {
    registerVersion: {
      route: packageRegisterVersion,
      handle(tx, ctx, input) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const current = loadPackageRow(tx.sql, input.name);
        if (current === undefined) {
          // 새 Package다. id는 등록 결과다.
          const id = tx.newId("pkg");
          const seq = emitRegistered(tx, id, input);
          tx.sql.run(
            "INSERT INTO packages (id, name, description, owner_app) VALUES (?, ?, ?, ?)",
            [id, input.name, input.description, input.owner_app],
          );
          insertVersion(tx, id, input);
          const blobs = registerBlobs(tx, input, seq);
          if (!blobs.ok) return blobs;
          return registered(
            tx,
            id,
            input.name,
            input.description,
            input.owner_app,
            input.version,
          );
        }
        const packageId = current["id"] as string;
        const description = current["description"] as string;
        // 주인이 없는 package는 지금 publish하는 앱이 주인이 된다.
        const owner =
          (current["owner_app"] as Package["owner_app"]) ?? input.owner_app;
        if (owner !== input.owner_app) {
          return forbidden("a package is versioned by its owner app");
        }
        if (current["owner_app"] === null) {
          tx.sql.run("UPDATE packages SET owner_app = ? WHERE id = ?", [
            owner,
            packageId,
          ]);
        }
        const stored = loadStoredVersion(tx, packageId, input.version);
        if (stored !== undefined) {
          // 같은 name·version은 byte·guide hash·permission을 덮지 않는다. 모두 같으면
          // 같은 사실이므로 그대로 접수하고(재시도), 하나라도 다르면 conflict다.
          const same =
            stored["bundle_hash"] === input.bundle_hash &&
            stored["guide_hash"] === input.guide_hash &&
            stored["permissions"] === JSON.stringify(input.permissions ?? []);
          if (!same) return conflict("published version bytes are immutable");
          const blobs = registerBlobs(tx, input, headSeq(tx), true);
          if (!blobs.ok) return blobs;
          return registered(
            tx,
            packageId,
            input.name,
            description,
            owner,
            input.version,
          );
        }
        // 새 version을 더한다. 기존 version byte·guide는 그대로다.
        const seq = emitRegistered(tx, packageId, input);
        insertVersion(tx, packageId, input);
        // 설명은 가장 새로 낸 판을 따른다. 이미 있는 판의 재시도(위 분기)는 옛 설명으로 되돌리지 못한다.
        tx.sql.run("UPDATE packages SET description = ? WHERE id = ?", [
          input.description,
          packageId,
        ]);
        const blobs = registerBlobs(tx, input, seq);
        if (!blobs.ok) return blobs;
        return registered(
          tx,
          packageId,
          input.name,
          input.description,
          owner,
          input.version,
        );
      },
    },
  };
}
