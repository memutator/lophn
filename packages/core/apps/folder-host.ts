// 폴더 take-in과 source 받기의 port(`FolderAppsHost`, core/folder/apps가 정의한다)를 core/apps가 구현한다. 앱·release 행은
// store 함수로 읽고, 등록·source 잇기는 core command를 폴더 take-in 자격(`FOLDER_APPS_CONTEXT`)으로 부르며,
// release 준비는 `appsControl.prepareCommit`으로 이 기계에서 build·봉인·검사·확정한다.
import { stat } from "node:fs/promises";
import {
  err,
  ok,
  type RandomSource,
  type Result,
  sha256Hex,
} from "../../base/mod.ts";
import {
  appConnectSource,
  appCreate,
  type PackageRegisterVersionInput,
} from "../../protocol/apps/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { Sql } from "../../protocol/server/mod.ts";
import type { PrepareCommitResult } from "./control.ts";
import {
  bundleFiles,
  INSTALL_PRINCIPAL,
  type PrepareBlob,
  packageInstallPath,
  prepareBundleBlobs,
  prepareCopyFiles,
  removeInstallCopy,
  sameInstallCopy,
  writeInstallCopy,
} from "./packages/install.ts";
import { dependencyVersions } from "./packages/publish.ts";
import { loadPackage, loadVersionPermissions } from "./packages/store.ts";
import { loadApp, loadApps } from "./registration/mod.ts";
import {
  missingCapPermission,
  missingUserPackagePermission,
} from "./releases/sdk-permissions.ts";
import { loadReleases } from "./releases/store.ts";
import type { FolderAppsHost } from "../folder/apps/deps.ts";

/** core command를 폴더 take-in 자격으로 부른다. 성공이면 command의 result다. */
export type FolderCommand = (envelope: {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
}) => Promise<Result<unknown>>;

// `syncAppSdk`가 낸 실패 글에서 빠진 `@lophn/*` 또는 `@me/*` package를 뽑는다.
const MISSING_SDK_RE = /SDK is not installed: (@(?:lophn|me)\/[^\s@]+@\S+)/;

function failureFromPrepare(
  stage: "build" | "dependencies" | "migration" | "handlers" | "release",
  reason: string,
): Result<never> {
  const missing = MISSING_SDK_RE.exec(reason)?.[1];
  if (missing !== undefined) {
    if (missing.startsWith("@lophn/")) {
      return err({
        code: "conflict",
        message: `this lophn does not have ${missing}; update lophn on this machine`,
        details: { reason: "sdk_missing", packages: [missing] },
      });
    }
    return err({
      code: "conflict",
      message: `${missing} is not published on this machine; publish the same package version here first`,
      details: { reason: "dependency_missing", packages: [missing] },
    });
  }
  const transient =
    reason.startsWith("dependency_install_failed") ||
    reason.startsWith("dependency_prune_failed") ||
    reason === "elapsed_ms" ||
    reason === "staging_failed";
  return err({
    code: transient ? "unavailable" : "invalid_input",
    message: `${stage}: ${reason}`,
  });
}

export function createFolderAppsHost(deps: {
  sql: Sql;
  command: FolderCommand;
  prepareCommit: (input: {
    app: string;
    sourcePath: string;
    commit: string;
    createdBy: string;
  }) => Promise<Result<PrepareCommitResult>>;
  random: RandomSource;
  dataRoot: string;
  /** ledger blob 전체 bytes. 없으면 `not_found`. */
  readBlob: (hash: string) => Promise<Result<Uint8Array>>;
  prepareBlob: PrepareBlob;
  /** `package.register_version`을 machine 자격으로 낸다. */
  registerVersion: (
    input: PackageRegisterVersionInput,
  ) => Promise<Result<unknown>>;
}): FolderAppsHost {
  const { sql } = deps;
  // 지운 앱을 다시 들일 수 있게 key는 부를 때마다 새로 만든다. 같은 앱·commit이 이미 있는지는 부르기 전에 본다.
  const keyOf = (kind: string) => {
    const bytes = new Uint8Array(8);
    deps.random.fill(bytes);
    return `folder-take-in-${kind}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  };
  return {
    app(id) {
      const found = loadApp(sql, id);
      if (!found.ok) return found;
      if (found.value === null) return ok(null);
      const releases = loadReleases(sql, { app: id });
      if (!releases.ok) return releases;
      return ok({
        slug: found.value.slug,
        source_path: found.value.source_path,
        revision: found.value.revision,
        code_commit: releases.value.at(-1)?.code_commit ?? null,
      });
    },
    slugOwner(slug) {
      const apps = loadApps(sql, undefined);
      if (!apps.ok) return apps;
      const owner = apps.value.find((app) => app.slug === slug);
      return ok(owner === undefined ? null : (owner.id as Id<"app">));
    },
    releaseWithCommit(app, codeCommit) {
      const releases = loadReleases(sql, { app });
      if (!releases.ok) return releases;
      const found = releases.value.findLast(
        (release) => release.code_commit === codeCommit,
      );
      return ok(found === undefined ? null : (found.id as Id<"rel">));
    },
    published: (name, version) =>
      loadVersionPermissions(sql, name, version) !== null,
    async carriedPackage(name, version) {
      const found = loadPackage(sql, name);
      if (!found.ok) return found;
      const pkg = found.value;
      const entry = pkg?.versions.find((each) => each.version === version);
      if (pkg === null || entry === undefined || pkg.owner_app === null) {
        return ok(null);
      }
      // 원문 blob이 없는 옛 판은 옮기지 못한다.
      const bundle = await deps.readBlob(entry.bundle_hash);
      const guide = await deps.readBlob(entry.guide_hash);
      for (const read of [bundle, guide]) {
        if (!read.ok && read.error.code !== "not_found") return read;
      }
      if (!bundle.ok || !guide.ok) return ok(null);
      if (
        (await sha256Hex(bundle.value)) !== entry.bundle_hash ||
        (await sha256Hex(guide.value)) !== entry.guide_hash
      ) {
        return ok(null);
      }
      const files = bundleFiles(bundle.value);
      if (!files.ok) return files;
      return ok({
        name,
        version,
        description: pkg.description,
        owner_app: pkg.owner_app as Id<"app">,
        permissions: entry.permissions ?? [],
        requires: dependencyVersions(files.value).filter((dependency) =>
          dependency.name.startsWith("@me/"),
        ),
        bundle: bundle.value,
        guide: guide.value,
      });
    },
    async installPackage(pkg) {
      const files = bundleFiles(pkg.bundle);
      if (!files.ok) return files;
      const copy = prepareCopyFiles(pkg.name, pkg.version, files.value);
      if (!copy.ok) return copy;
      const path = packageInstallPath(pkg.name, pkg.version);
      if (!path.ok) return path;
      // 낸 permission이 내부 `@lophn/cap-*`·`@me/*` 요구를 덮는지 다시 본다(폴더에서 온 메타데이터를 믿지 않는다).
      const dependencies = dependencyVersions(files.value);
      const declared = new Set<string>(pkg.permissions);
      const userPermissions = new Map<string, readonly string[]>();
      const missingSdk: string[] = [];
      for (const need of dependencies) {
        if (need.name.startsWith("@lophn/")) {
          const part = need.name.slice("@lophn/".length);
          try {
            const info = await stat(
              `${deps.dataRoot}/sdk/${part}/${need.version}/package.json`,
            );
            if (!info.isFile()) missingSdk.push(`${need.name}@${need.version}`);
          } catch {
            missingSdk.push(`${need.name}@${need.version}`);
          }
          continue;
        }
        if (!need.name.startsWith("@me/")) continue;
        const key = `${need.name}@${need.version}`;
        const found = loadVersionPermissions(sql, need.name, need.version);
        if (found === null) {
          return err({
            code: "conflict",
            message: `${key} is not published on this machine`,
            details: {
              reason: "dependency_missing",
              packages: [key],
            },
          });
        }
        userPermissions.set(key, found);
      }
      if (missingSdk.length > 0) {
        return err({
          code: "conflict",
          message: `this lophn does not have ${missingSdk.join(", ")}; update lophn on this machine`,
          details: { reason: "sdk_missing", packages: missingSdk },
        });
      }
      const missingPerm =
        missingCapPermission(
          dependencies.map((dependency) => dependency.name),
          declared,
          "package permissions",
        ) ??
        missingUserPackagePermission(
          dependencies,
          userPermissions,
          declared,
          "package permissions",
        );
      if (missingPerm !== undefined) {
        return err({ code: "invalid_input", message: missingPerm.message });
      }
      const prepared = await prepareBundleBlobs(
        pkg.bundle,
        pkg.guide,
        INSTALL_PRINCIPAL,
        deps.prepareBlob,
      );
      if (!prepared.ok) return prepared;
      const registered = await deps.registerVersion({
        name: pkg.name,
        description: pkg.description,
        version: pkg.version,
        owner_app: pkg.owner_app,
        permissions: pkg.permissions,
        bundle_hash: prepared.value.bundleHash,
        guide_hash: prepared.value.guideHash,
        ...(prepared.value.bundleBlob === undefined
          ? {}
          : { bundle_blob: prepared.value.bundleBlob }),
        ...(prepared.value.guideBlob === undefined
          ? {}
          : { guide_blob: prepared.value.guideBlob }),
      });
      if (!registered.ok) return registered;
      const target = `${deps.dataRoot}/${path.value}`;
      if (!(await sameInstallCopy(target, copy.value))) {
        await removeInstallCopy(target);
        const written = await writeInstallCopy(target, copy.value);
        if (!written.ok) return written;
      }
      return ok(undefined);
    },
    async createApp(input) {
      const created = await deps.command({
        command: appCreate.name,
        input,
        idempotency_key: keyOf("app"),
        compare: {},
      });
      if (!created.ok) return created;
      return ok({
        revision: String((created.value as { revision: string }).revision),
      });
    },
    async connectSource(app, revision, sourcePath) {
      const linked = await deps.command({
        command: appConnectSource.name,
        input: { app, source_path: sourcePath },
        idempotency_key: keyOf("source"),
        compare: { base_revision: revision },
      });
      return linked.ok ? ok(undefined) : linked;
    },
    async prepareRelease(input) {
      const prepared = await deps.prepareCommit({
        app: input.app,
        sourcePath: input.sourcePath,
        commit: input.commit,
        createdBy: "machine",
      });
      if (!prepared.ok) return prepared;
      if (prepared.value.status === "failed") {
        return failureFromPrepare(prepared.value.stage, prepared.value.reason);
      }
      return ok(prepared.value.release.id as Id<"rel">);
    },
  };
}
