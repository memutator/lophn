import { err, ok, type Result } from "../../../base/mod.ts";
import {
  packageRegisterVersion,
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
import { personalRegistrationRejected } from "./model.ts";
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

export function createSdkCommands(): {
  registerVersion: CommandDefinition<typeof packageRegisterVersion>;
} {
  return {
    registerVersion: {
      route: packageRegisterVersion,
      handle(tx, ctx, input) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        // 개인 Package 등록은 현재 받지 않는다(R6).
        if (personalRegistrationRejected(input.name)) {
          return forbidden("personal package registration is not provided");
        }
        const current = loadPackageRow(tx.sql, input.name);
        if (current === undefined) {
          // 새 Package다. id는 등록 결과다(domain-model apps/sdk Package 표).
          const id = tx.newId("pkg");
          const seq = tx.emit(packageVersionRegistered, id, {
            name: input.name,
            kind: input.kind,
            version: input.version,
            bundle_hash: input.bundle_hash,
            guide_hash: input.guide_hash,
          });
          const packageDesc = input.description;
          tx.sql.run(
            "INSERT INTO packages (id, name, description, kind) VALUES (?, ?, ?, ?)",
            [id, input.name, packageDesc, input.kind],
          );
          tx.sql.run(
            "INSERT INTO package_versions (package, version, bundle_hash, guide_hash) VALUES (?, ?, ?, ?)",
            [id, input.version, input.bundle_hash, input.guide_hash],
          );
          const guide = registerGuide(tx, input, seq);
          if (!guide.ok) return guide;
          return ok({
            package: {
              id,
              name: input.name,
              description: packageDesc,
              kind: input.kind,
              versions: [{
                version: input.version,
                bundle_hash: input.bundle_hash,
                guide_hash: input.guide_hash,
              }],
            },
            version: {
              version: input.version,
              bundle_hash: input.bundle_hash,
              guide_hash: input.guide_hash,
            },
          });
        }
        // 기존 Package다. kind는 바꾸지 않는다(domain-model apps/sdk Package 표).
        if (current["kind"] !== input.kind) {
          return conflict("package kind is immutable");
        }
        const stored = loadStoredVersion(
          tx,
          current["id"] as string,
          input.version,
        );
        if (stored !== undefined) {
          // 같은 name·version은 byte·guide hash를 덮지 않는다(R8). 같은 hash면
          // 같은 사실이므로 그대로 접수하고, 다른 hash면 conflict다.
          const sameBundle = stored["bundle_hash"] === input.bundle_hash;
          const sameGuide = stored["guide_hash"] === input.guide_hash;
          if (sameBundle && sameGuide) {
            const versions = loadVersions(tx.sql, current["id"] as string);
            const description = current["description"] as string;
            const kind = current["kind"] as typeof input.kind;
            return ok({
              package: {
                id: current["id"] as string,
                name: input.name,
                description,
                kind,
                versions,
              },
              version: {
                version: input.version,
                bundle_hash: input.bundle_hash,
                guide_hash: input.guide_hash,
              },
            });
          }
          return conflict("published version bytes are immutable");
        }
        // 새 version을 더한다. 기존 version byte·guide는 그대로다(R8, R11).
        const packageId = current["id"] as string;
        const seq = tx.emit(packageVersionRegistered, packageId, {
          name: input.name,
          kind: input.kind,
          version: input.version,
          bundle_hash: input.bundle_hash,
          guide_hash: input.guide_hash,
        });
        tx.sql.run(
          "INSERT INTO package_versions (package, version, bundle_hash, guide_hash) VALUES (?, ?, ?, ?)",
          [packageId, input.version, input.bundle_hash, input.guide_hash],
        );
        const guide = registerGuide(tx, input, seq);
        if (!guide.ok) return guide;
        const versions = loadVersions(tx.sql, packageId);
        const description = current["description"] as string;
        const kind = current["kind"] as typeof input.kind;
        return ok({
          package: {
            id: packageId,
            name: input.name,
            description,
            kind,
            versions,
          },
          version: {
            version: input.version,
            bundle_hash: input.bundle_hash,
            guide_hash: input.guide_hash,
          },
        });
      },
    },
  };
}
