// 폴더 take-in과 source 받기의 port(`FolderAppsHost`, core/folder/apps가 정의한다)를 core/apps가 구현한다. 앱·release 행은
// store 함수로 읽고, 봉인 사본은 release 준비와 같은 writeBundle·sealCopy로 쓰고, 등록·source 잇기·release 적기는
// core command를 폴더 take-in 자격(`FOLDER_APPS_CONTEXT`)으로 부른다. 조립이 `command`를 그 자격의 writer에 묶어 넘긴다.
import { readFile } from "node:fs/promises";
import { err, ok, type RandomSource, type Result } from "../../base/mod.ts";
import {
  appConnectSource,
  appCreate,
  releaseRecord,
} from "../../protocol/apps/mod.ts";
import { bundleFileStore } from "../../protocol/apps/app-storage.ts";
import type { Id } from "../../protocol/base/ids.ts";
import type { Sql } from "../../protocol/server/mod.ts";
import { loadVersionPermissions } from "./packages/store.ts";
import { loadApp, loadApps } from "./registration/mod.ts";
import {
  dataChangesOf,
  readBundleCopy,
} from "./releases/activation/desired.ts";
import {
  bundleCopyPath,
  clearUnsealedCopy,
  DECLARATION_COPY_NAME,
  sealCopy,
  writeBundle,
} from "./releases/bundle/seal.ts";
import { loadReleases } from "./releases/store.ts";
import type { FolderAppsHost, InstalledBundle } from "../folder/apps/deps.ts";

/** core command를 폴더 take-in 자격으로 부른다. 성공이면 command의 result다. */
export type FolderCommand = (envelope: {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
}) => Promise<Result<unknown>>;

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
