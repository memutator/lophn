import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type Package,
  packageRegisterVersion,
  type PackageVersion,
  packageVersionRegistered,
} from "../../../protocol/apps/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import {
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

// 안내 byte를 준비한 blob이 있으면 그 참조를 같은 transaction에서 등록한다. 실제로 보존한 byte의 hash만
// guide_hash로 둘 수 있다: 준비한 blob의 hash·purpose가 다르면 이 command 전체가 거절이다.
function registerGuide(
  tx: Parameters<CommandDefinition<typeof packageRegisterVersion>["handle"]>[0],
  input: Parameters<
    CommandDefinition<typeof packageRegisterVersion>["handle"]
  >[2],
  seq: string,
): Result<void> {
  const blob = input.guide_blob;
  if (blob === undefined) return ok(undefined);
  if (
    blob.hash !== input.guide_hash ||
    blob.purpose !== PACKAGE_GUIDE_BLOB_PURPOSE
  ) {
    return err({
      code: "invalid_input",
      message: "guide hash is not the preserved guide blob",
    });
  }
  const registered = tx.registerBlobRef({
    owner_kind: PACKAGE_GUIDE_BLOB_OWNER_KIND,
    owner_key: packageGuideOwnerKey(input.name, input.version),
    field: PACKAGE_GUIDE_BLOB_FIELD_NAME,
    registered_seq: seq,
    source: { kind: "prepared", blob: { ...blob } },
  });
  if (registered.ok) return ok(undefined);
  const code = registered.error.code;
  return code === "conflict" ? registered : err({
    code: "invalid_input",
    message: "guide blob is not a prepared blob of this caller",
  });
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
    kind: null,
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
  owner: Package["owner_project"],
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
      owner_project: owner,
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
            "INSERT INTO packages (id, name, description, owner_project) VALUES (?, ?, ?, ?)",
            [id, input.name, input.description, input.owner_project],
          );
          insertVersion(tx, id, input);
          const guide = registerGuide(tx, input, seq);
          if (!guide.ok) return guide;
          return registered(
            tx,
            id,
            input.name,
            input.description,
            input.owner_project,
            input.version,
          );
        }
        const packageId = current["id"] as string;
        const description = current["description"] as string;
        // 주인이 없는 옛 package는 지금 publish하는 project가 주인이 된다.
        const owner = (current["owner_project"] as Package["owner_project"]) ??
          input.owner_project;
        if (owner !== input.owner_project) {
          return forbidden("a package is versioned by its owner project");
        }
        if (current["owner_project"] === null) {
          tx.sql.run("UPDATE packages SET owner_project = ? WHERE id = ?", [
            owner,
            packageId,
          ]);
        }
        const stored = loadStoredVersion(tx, packageId, input.version);
        if (stored !== undefined) {
          // 같은 name·version은 byte·guide hash·permission을 덮지 않는다. 모두 같으면
          // 같은 사실이므로 그대로 접수하고(재시도), 하나라도 다르면 conflict다.
          const same = stored["bundle_hash"] === input.bundle_hash &&
            stored["guide_hash"] === input.guide_hash &&
            stored["permissions"] === JSON.stringify(input.permissions ?? []);
          if (!same) return conflict("published version bytes are immutable");
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
        const guide = registerGuide(tx, input, seq);
        if (!guide.ok) return guide;
        return registered(
          tx,
          packageId,
          input.name,
          description,
          owner,
          input.version,
        );
      },
    },
  };
}
