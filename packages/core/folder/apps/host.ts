// take-in과 source 받기가 core/apps에 기대는 면 하나. 앱·release 행은 core/apps의 store 함수로 읽고, 봉인 사본은
// release 준비와 같은 writeBundle·sealCopy로 쓰고, 등록과 release 적기는 core command(machine 자격)로 한다.
// folder는 바닥 module이라 feature module을 import하지 못한다. 이 file만 예외로 둔다(tools/check-deps.ts):
// core/apps가 이 면을 구현해 넘기게 되면(FolderApply처럼) 그쪽으로 옮기고 예외를 지운다.
import { readFile } from "node:fs/promises";
import { err, ok, type RandomSource, type Result } from "../../../base/mod.ts";
import {
  appConnectSource,
  appCreate,
  type BundleManifest,
  type DataChange,
  releaseRecord,
} from "../../../protocol/apps/mod.ts";
import { bundleFileStore } from "../../../protocol/apps/app-storage.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  AuthenticatedContext,
  Sql,
} from "../../../protocol/server/mod.ts";
import { loadVersionPermissions } from "../../apps/packages/store.ts";
import { loadApp, loadApps } from "../../apps/registration/mod.ts";
import {
  dataChangesOf,
  readBundleCopy,
} from "../../apps/releases/activation/desired.ts";
import {
  bundleCopyPath,
  clearUnsealedCopy,
  DECLARATION_COPY_NAME,
  sealCopy,
  writeBundle,
} from "../../apps/releases/bundle/seal.ts";
import { loadReleases } from "../../apps/releases/store.ts";
import type { FolderCommand } from "./deps.ts";

export const FOLDER_APPS_PRINCIPAL = "machine:folder-apps";
// take-in이 앱을 같은 id로 등록하고 source를 잇고 release를 적는 core 안 machine 자격. 조립이 records와 operation 상한에 둔다.
export const FOLDER_APPS_CONTEXT: AuthenticatedContext = {
  principal: FOLDER_APPS_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [appCreate.name, appConnectSource.name, releaseRecord.name],
    targets: {},
  },
  conditions: {},
  credential_ref: FOLDER_APPS_PRINCIPAL,
};

export type LocalApp = {
  slug: string;
  source_path: string | null;
  revision: string;
  // 이 기계에서 가장 늦게 넣은 release의 commit. 처음 만드는 source 저장소의 main이 된다.
  code_commit: string | null;
};

export type InstalledBundle = {
  declaration: Record<string, unknown>;
  manifest: BundleManifest;
  data_schema: number;
  data_changes: DataChange[];
};

export type FolderAppsHost = {
  app(id: Id<"app">): Result<LocalApp | null>;
  slugOwner(slug: string): Result<Id<"app"> | null>;
  releaseWith(app: Id<"app">, bundleHash: string): Result<Id<"rel"> | null>;
  published(name: string, version: string): boolean;
  /** 검사를 마친 bundle file(manifest.json과 declaration.json 포함)을 봉인 사본으로 쓴다. 이미 봉인된 사본은 그대로 둔다. */
  installBundle(
    app: Id<"app">,
    bundleHash: string,
    manifest: BundleManifest,
    files: readonly { path: string; bytes: Uint8Array }[],
  ): Promise<Result<InstalledBundle>>;
  createApp(input: {
    id: Id<"app">;
    slug: string;
    name: string;
    description: string;
  }): Promise<Result<{ revision: string }>>;
  connectSource(
    app: Id<"app">,
    revision: string,
    sourcePath: string,
  ): Promise<Result<void>>;
  recordRelease(input: {
    app: Id<"app">;
    commit: string;
    bundle_hash: string;
    declaration_hash: string;
    installed: InstalledBundle;
  }): Promise<Result<Id<"rel">>>;
};

export function createFolderAppsHost(deps: {
  sql: Sql;
  dataRoot: string;
  command: FolderCommand;
  random: RandomSource;
}): FolderAppsHost {
  const { sql } = deps;
  // 지운 앱을 다시 들일 수 있게 key는 부를 때마다 새로 만든다. 같은 앱·release가 이미 있는지는 부르기 전에 본다.
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
    releaseWith(app, bundleHash) {
      const releases = loadReleases(sql, { app });
      if (!releases.ok) return releases;
      const found = releases.value.find(
        (release) => release.bundle_hash === bundleHash,
      );
      return ok(found === undefined ? null : (found.id as Id<"rel">));
    },
    published: (name, version) =>
      loadVersionPermissions(sql, name, version) !== null,
    async installBundle(app, bundleHash, manifest, files) {
      const copy = bundleCopyPath(deps.dataRoot, app, bundleHash);
      if (!copy.ok) return copy;
      const cleared = await clearUnsealedCopy(copy.value);
      if (!cleared.ok) return cleared;
      const declarationJson = files.find(
        (file) => file.path === DECLARATION_COPY_NAME,
      );
      if (declarationJson === undefined) {
        return err({ code: "invalid_input", message: "no declaration.json" });
      }
      // false면 이미 봉인된 사본이 있다(같은 hash는 같은 bytes다).
      if (cleared.value) {
        // manifest.json과 declaration.json도 받은 bytes 그대로 쓴다(같은 이름은 먼저 넘긴 것이 이긴다).
        const writtenCopy = await writeBundle({
          copyPath: copy.value,
          manifest,
          declarationJson: declarationJson.bytes,
          bundleFiles: files,
        });
        if (!writtenCopy.ok) return writtenCopy;
        const sealed = await sealCopy(
          copy.value,
          bundleFileStore(deps.dataRoot),
        );
        if (!sealed.ok) return sealed;
      }
      const parts = await readBundleCopy(deps.dataRoot, app, bundleHash);
      if (!parts.ok) return parts;
      if (parts.value === undefined) {
        return err({ code: "unavailable", message: "bundle copy is missing" });
      }
      const changes = await dataChangesOf(parts.value);
      if (!changes.ok) return changes;
      let declaration: Record<string, unknown>;
      try {
        declaration = JSON.parse(
          await readFile(
            `${parts.value.root}/${DECLARATION_COPY_NAME}`,
            "utf8",
          ),
        );
      } catch {
        return err({
          code: "unavailable",
          message: "bundle declaration cannot be read",
        });
      }
      return ok({
        declaration,
        manifest: parts.value.manifest,
        data_schema: parts.value.dataSchema,
        data_changes: changes.value,
      });
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
    async recordRelease(input) {
      const key = keyOf("release");
      const recorded = await deps.command({
        command: releaseRecord.name,
        input: {
          app: input.app,
          commit: input.commit,
          bundle_hash: input.bundle_hash,
          declaration_hash: input.declaration_hash,
          declaration: input.installed.declaration,
          manifest: input.installed.manifest,
          data_schema: input.installed.data_schema,
          data_changes: input.installed.data_changes,
          // 출처 기계는 release 행이 아니라 bundle hash와 폴더가 안다. actor 꼴에 기계 id 자리가 없다.
          created_by: "machine",
          key,
        },
        idempotency_key: key,
        compare: {},
      });
      if (!recorded.ok) return recorded;
      return ok((recorded.value as { release: { id: Id<"rel"> } }).release.id);
    },
  };
}
