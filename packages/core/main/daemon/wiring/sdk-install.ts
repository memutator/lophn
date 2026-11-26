import { fileURLToPath } from "node:url";
import { err, ok, type Result } from "../../../../base/mod.ts";
import { PACKAGE_GUIDE_BLOB_OWNER_KIND } from "../../../apps/packages/blobs.ts";
import { PACKAGE_PUBLISH_CONTEXT } from "../../../apps/control.ts";
import {
  INSTALL_PRINCIPAL,
  installSdkCopies,
  prepareBundleBlob,
  registerVersionEnvelope,
} from "../../../apps/packages/install.ts";
import {
  type MeVersion,
  reconcileMeCopies,
} from "../../../apps/packages/restore.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import { installBuiltinTemplate } from "../../../apps/packages/template/install.ts";
import { installNodeShims } from "../../../supervision/security/node-shims.ts";
import type { WiringContext, WiringFactory } from "./context.ts";

// 이 file 위치에서 본 repo의 `packages/`. 계산은 여기 한 곳에서만 한다.
const PACKAGES_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

// catalog의 @me version과 bundle blob 등록 여부. blob이 있는지는 ref 행으로 본다.
function readMeVersions(ctx: WiringContext): Result<MeVersion[]> {
  const opened = openConnection(ctx.ledgerPath);
  if (!opened.ok) return opened;
  try {
    const rows = opened.value.sql.all(
      `SELECT p.name AS name, p.description AS description, p.owner_app AS owner_app,
              v.version AS version, v.permissions AS permissions,
              v.bundle_hash AS bundle_hash, v.guide_hash AS guide_hash,
              EXISTS (SELECT 1 FROM blob_refs r
                      WHERE r.owner_kind = ? AND r.owner_key = p.name || '@' || v.version
                        AND r.field = 'bundle') AS has_blob
       FROM packages p JOIN package_versions v ON v.package = p.id
       WHERE p.name GLOB '@me/*' ORDER BY p.name, v.version`,
      [PACKAGE_GUIDE_BLOB_OWNER_KIND],
    );
    return ok(
      rows.map((row) => ({
        name: row["name"] as string,
        description: row["description"] as string,
        version: row["version"] as string,
        ownerApp: row["owner_app"] as string | null,
        permissions: JSON.parse(row["permissions"] as string) as string[],
        bundleHash: row["bundle_hash"] as string,
        guideHash: row["guide_hash"] as string,
        hasBundleBlob: Number(row["has_blob"]) === 1,
      })),
    );
  } catch {
    return err({ code: "internal", message: "cannot read the @me catalog" });
  } finally {
    opened.value.close();
  }
}

// build에서 깐다. prepare는 동기이고 runtime 앞이며, start는 API가 열린 뒤라 그 사이 release 준비 요청이 들어올 수 있다.
// build는 runtime이 열린 뒤 API 앞이고 err를 돌려 기동을 멈출 수 있다.
// node·npm shim도 여기서 쓴다. agent·앱 child가 뜨기 전에 data root에 있어야 shell과 npm script가 쓴다.
export const sdkInstallWiring: WiringFactory = () => ({
  name: "sdk-install",
  async build(ctx) {
    const [shims, sdk, template] = await Promise.all([
      installNodeShims(ctx.root.path),
      installSdkCopies({
        dataRoot: ctx.root.path,
        packagesRoot: PACKAGES_ROOT,
      }),
      installBuiltinTemplate({ dataRoot: ctx.root.path }),
    ]);
    if (!shims.ok) return shims;
    if (!sdk.ok) return sdk;
    if (!template.ok) return template;
    return ok({});
  },
  // @me 설치 사본은 ledger의 bundle blob에서 되살린다. blob을 읽으려면 I/O worker가 떠 있어야 해서 start다.
  // 사본 하나를 못 되살려도 core는 뜬다(그 판을 쓰는 앱의 sync만 not_found). 건너뛴 판은 로그로 남긴다.
  async start(ctx) {
    const versions = readMeVersions(ctx);
    if (!versions.ok) return versions;
    const result = await reconcileMeCopies({
      dataRoot: ctx.root.path,
      versions: versions.value,
      read: (hash, offset, length) =>
        ctx.blobRelay.readBytes(hash, offset, length),
      attachBundle: async (version, bundle) => {
        // 주인 앱이 없는 package는 이 command로 주인을 바꾸게 되므로 붙이지 않는다.
        if (version.ownerApp === null) {
          return err({ code: "conflict", message: "the package has no owner" });
        }
        const prepared = await prepareBundleBlob(
          bundle,
          INSTALL_PRINCIPAL,
          (call) => ctx.blobRelay.prepare(call),
        );
        if (!prepared.ok) return prepared;
        const done = await ctx.writer.command(
          PACKAGE_PUBLISH_CONTEXT as never,
          (await registerVersionEnvelope({
            name: version.name,
            description: version.description,
            version: version.version,
            owner_app: version.ownerApp as never,
            permissions: version.permissions,
            bundle_hash: version.bundleHash,
            guide_hash: version.guideHash,
            ...(prepared.value.bundleBlob === undefined
              ? {}
              : { bundle_blob: prepared.value.bundleBlob }),
          })) as never,
        );
        return done.ok ? ok(undefined) : done;
      },
    });
    for (const skipped of result.skipped) {
      ctx.telemetry.logger.warn({
        component: "apps/packages",
        event: "me_copy_skipped",
        fields: skipped,
      });
    }
    return ok(undefined);
  },
});
