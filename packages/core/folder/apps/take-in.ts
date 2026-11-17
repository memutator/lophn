// 다른 기계가 폴더에 내놓은 앱을 이 기계에 들인다. 같은 app id로 등록하고(이미 있으면 앱 행을 건드리지 않는다) release
// 폴더를 전부 검사한 뒤 봉인 사본으로 쓰고 지금 준비가 쓰는 `release.record`로 `prepared`에 적는다.
// grant, 동의, secret, OAuth, invocation 기록, 앱 data는 옮기지 않는다: 활성화는 이 기계에서 사람에게 묻는다.
import { stat } from "node:fs/promises";
import { err, ok, type Result, sha256Hex } from "../../../base/mod.ts";
import { bundleManifestSchema } from "../../../protocol/apps/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { validateDeclaration } from "../../../protocol/apps/declaration/mod.ts";
import { RELEASE_BUNDLE_MAX_BYTES } from "../../../protocol/apps/mod.ts";
import {
  decodeRecord,
  RELEASE_RECORD_MAX_BYTES,
  type ReleaseRecord,
  releaseFilePath,
  releaseRecordPath,
  releaseRecordSchema,
} from "../../../protocol/folder/mod.ts";
import type {
  TakeInInput,
  TakeInOutput,
} from "../../../protocol/folder/take-in.ts";
import { createFolderReader, type FolderReader } from "../fs.ts";
import type {
  FolderAppRecordCopy,
  FolderAppsDeps,
  FolderAppsHost,
} from "./deps.ts";
import { DECLARATION_FILE, MANIFEST_FILE } from "./releases.ts";
import { createRepository } from "./source.ts";
import { setSourceRead } from "./state.ts";

const incomplete = (message: string): Result<never> =>
  err({
    code: "invalid_input",
    message,
    details: { reason: "release_incomplete" },
  });

const conflict = (
  message: string,
  details: Record<string, unknown>,
): Result<never> => err({ code: "conflict", message, details });

/** 앱마다 기록이 가장 최근인 기계의 것. `from`이 있으면 그 기계의 것. */
export function pickRecord(
  copies: readonly FolderAppRecordCopy[],
  app: Id<"app">,
  from?: Id<"mch">,
): FolderAppRecordCopy | null {
  let best: FolderAppRecordCopy | null = null;
  for (const copy of copies) {
    if (copy.record.app !== app) continue;
    if (from !== undefined && copy.origin !== from) continue;
    if (best === null || copy.record.updated_at > best.record.updated_at) {
      best = copy;
    }
  }
  return best;
}

type CheckedRelease = {
  record: ReleaseRecord;
  manifest: ReturnType<typeof bundleManifestSchema.parse>;
  files: { path: string; bytes: Uint8Array }[];
};

// release 폴더 전부: `release.json` schema와 이름, 모든 file의 크기와 sha256, manifest의 sha256이 폴더 이름의 hash와 같음,
// manifest가 싣는 file이 목록과 같음. 하나라도 어기면 아무것도 쓰지 않고 `release_incomplete`다.
async function checkRelease(
  reader: FolderReader,
  origin: Id<"mch">,
  app: Id<"app">,
  bundleHash: string,
): Promise<Result<CheckedRelease>> {
  const read = await reader.read(
    releaseRecordPath(origin, app, bundleHash),
    RELEASE_RECORD_MAX_BYTES,
  );
  if (!read.ok) return incomplete(`release.json: ${read.error.message}`);
  const decoded = decodeRecord(
    releaseRecordSchema,
    read.value,
    RELEASE_RECORD_MAX_BYTES,
  );
  if (!decoded.ok) return incomplete(`release.json: ${decoded.error.message}`);
  const record = decoded.value;
  if (
    record.machine !== origin ||
    record.app !== app ||
    record.bundle_hash !== bundleHash
  ) {
    return incomplete("release.json names another machine, app or bundle");
  }
  // manifest.json 말고는 bundle file이다. 한도 밖이면 읽지 않는다(file을 다 읽어 메모리에 둔다).
  const total = record.files
    .filter((file) => file.path !== MANIFEST_FILE)
    .reduce((sum, file) => sum + file.size, 0);
  if (total > RELEASE_BUNDLE_MAX_BYTES) {
    return incomplete("the release is larger than a bundle can be");
  }
  const files: { path: string; bytes: Uint8Array }[] = [];
  const listed = new Map<string, string>();
  for (const file of record.files) {
    if (listed.has(file.path))
      return incomplete(`${file.path} is listed twice`);
    listed.set(file.path, file.sha256);
    const bytes = await reader.read(
      releaseFilePath(origin, app, bundleHash, file.path),
      file.size,
    );
    if (!bytes.ok) return incomplete(`${file.path}: ${bytes.error.message}`);
    if (
      bytes.value.byteLength !== file.size ||
      (await sha256Hex(bytes.value)) !== file.sha256
    ) {
      return incomplete(`${file.path} does not match its size or hash`);
    }
    files.push({ path: file.path, bytes: bytes.value });
  }
  const manifestBytes = files.find((file) => file.path === MANIFEST_FILE);
  if (manifestBytes === undefined) return incomplete("no manifest.json");
  if ((await sha256Hex(manifestBytes.bytes)) !== bundleHash) {
    return incomplete("manifest.json does not match the bundle hash");
  }
  let manifest: CheckedRelease["manifest"];
  try {
    const parsed = bundleManifestSchema.safeParse(
      JSON.parse(new TextDecoder().decode(manifestBytes.bytes)),
    );
    if (!parsed.success) return incomplete("manifest.json is not a manifest");
    manifest = parsed.data;
  } catch {
    return incomplete("manifest.json is not JSON");
  }
  if (
    manifest.files.length + 1 !== listed.size ||
    manifest.files.some((file) => listed.get(file.path) !== file.hash)
  ) {
    return incomplete("the files differ from the manifest");
  }
  if (!manifest.files.some((file) => file.path === DECLARATION_FILE)) {
    return incomplete("the bundle has no declaration.json");
  }
  return ok({ record, manifest, files });
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

// 고정한 `@lophn/*` 판은 이 기계의 설치 사본에, `@me/*` 판은 이 기계의 catalog에 있어야 한다.
async function checkDependencies(
  manifest: CheckedRelease["manifest"],
  dataRoot: string,
  host: FolderAppsHost,
): Promise<Result<void>> {
  const pinned = new Map<string, string>();
  for (const dependency of [
    ...manifest.sdk_dependencies,
    ...manifest.dependencies.filter(
      (item) => item.source === "sdk" || item.source === "package",
    ),
  ]) {
    pinned.set(dependency.name, dependency.version);
  }
  const sdk: string[] = [];
  const mine: string[] = [];
  for (const [name, version] of [...pinned].sort()) {
    if (name.startsWith("@lophn/")) {
      const part = name.slice("@lophn/".length);
      if (!(await isDirectory(`${dataRoot}/sdk/${part}/${version}`))) {
        sdk.push(`${name}@${version}`);
      }
    } else if (name.startsWith("@me/") && !host.published(name, version)) {
      mine.push(`${name}@${version}`);
    }
  }
  if (sdk.length > 0) {
    return conflict(
      `this lophn does not have ${sdk.join(", ")}; update lophn on this machine`,
      { reason: "sdk_missing", packages: sdk },
    );
  }
  if (mine.length > 0) {
    return conflict(
      `${mine.join(", ")} is not published on this machine; publish the same package version here first`,
      { reason: "dependency_missing", packages: mine },
    );
  }
  return ok(undefined);
}

export async function takeIn(
  deps: FolderAppsDeps,
  host: FolderAppsHost,
  input: TakeInInput,
): Promise<Result<TakeInOutput>> {
  const me = deps.machine();
  const app = input.app as Id<"app">;
  const copies = deps.records().filter((copy) => copy.origin !== me);
  const found = pickRecord(copies, app, input.from as Id<"mch"> | undefined);
  if (found === null) {
    return err({
      code: "not_found",
      message: "the app is not in a sync folder",
    });
  }
  const { origin, record } = found;
  const bundleHash = input.release ?? record.active_release?.bundle_hash;
  if (bundleHash === undefined || !record.releases.includes(bundleHash)) {
    return err({
      code: "not_found",
      message: "the release is not in the sync folder",
    });
  }
  const local = host.app(app);
  if (!local.ok) return local;
  if (local.value !== null) {
    const existing = host.releaseWith(app, bundleHash);
    if (!existing.ok) return existing;
    if (existing.value !== null) {
      return ok({
        app: app,
        release: existing.value,
        source_path: local.value.source_path,
        installed: "existing",
      });
    }
  }
  const destination = deps.destinations.resolve(found.destination);
  if (destination === null) {
    return err({
      code: "not_found",
      message: `the sync folder "${found.destination}" is not set on this machine`,
    });
  }
  const reader = createFolderReader(destination.path);
  const checked = await checkRelease(reader, origin, app, bundleHash);
  if (!checked.ok) return checked;
  const { manifest, files } = checked.value;
  const release = checked.value.record;
  const dependencies = await checkDependencies(manifest, deps.dataRoot, host);
  if (!dependencies.ok) return dependencies;
  const slug = local.value?.slug ?? record.slug;
  if (local.value === null) {
    const owner = host.slugOwner(record.slug);
    if (!owner.ok) return owner;
    if (owner.value !== null) {
      return conflict(`the slug ${record.slug} is used by another app here`, {
        reason: "slug_in_use",
        app: owner.value,
      });
    }
  }
  // release.record가 같은 검사를 다시 한다. 앱을 만든 뒤에 떨어지지 않게 먼저 본다.
  let raw: unknown;
  try {
    raw = JSON.parse(
      new TextDecoder().decode(
        files.find((file) => file.path === DECLARATION_FILE)!.bytes,
      ),
    );
  } catch {
    return incomplete("declaration.json is not JSON");
  }
  const declaration = validateDeclaration(raw, { app: app, slug });
  if (!declaration.ok) {
    return err({ code: "invalid_input", message: declaration.error.message });
  }

  const installed = await host.installBundle(app, bundleHash, manifest, files);
  if (!installed.ok) return installed;
  let sourcePath = local.value?.source_path ?? null;
  if (local.value === null) {
    const repo = await createRepository({
      dataRoot: deps.dataRoot,
      app: app,
      origin,
      reader,
      head: record.source.head,
      commit: release.code_commit,
      random: deps.random,
    });
    if (!repo.ok) return repo;
    const created = await host.createApp({
      id: app,
      slug: record.slug,
      name: record.name,
      description: record.description,
    });
    if (!created.ok) return created;
    if (repo.value !== null) {
      const linked = await host.connectSource(
        app,
        created.value.revision,
        repo.value.path,
      );
      if (!linked.ok) return linked;
      sourcePath = repo.value.path;
      setSourceRead(
        deps.sql,
        { machine: me, app: app, origin },
        { cursor: repo.value.cursor, at: deps.clock.now() },
      );
    }
  }
  const recorded = await host.recordRelease({
    app: app,
    commit: release.code_commit,
    bundle_hash: bundleHash,
    declaration_hash: release.declaration_hash,
    installed: installed.value,
  });
  if (!recorded.ok) {
    // 앱 등록과 release 기록은 따로 commit된다. 앱만 남았으면 다시 take-in이 release만 설치해 고친다.
    if (local.value !== null) return recorded;
    return err({
      ...recorded.error,
      message: `${recorded.error.message}. The app was added without a release; take it in again to install only the release.`,
    });
  }
  return ok({
    app: app,
    release: recorded.value,
    source_path: sourcePath,
    installed: local.value === null ? "app_and_release" : "release",
  });
}

export type AvailableApp = {
  app: Id<"app">;
  name: string;
  slug: string;
  machine: Id<"mch">;
  release: {
    bundle_hash: string;
    data_schema: number;
    created_at: string;
  } | null;
};

/**
 * 다른 기계가 내놓았고 이 기계에 아직 없는 앱. 앱마다 기록이 가장 최근인 기계의 것 하나. take-in이 앱을 만든 뒤 release
 * 기록에 실패해 release가 하나도 없는 앱도 든다: 다시 take-in하면 release만 설치한다.
 */
export function available(
  deps: FolderAppsDeps,
  host: FolderAppsHost,
): Result<AvailableApp[]> {
  const me = deps.machine();
  const copies = deps.records().filter((copy) => copy.origin !== me);
  const out: AvailableApp[] = [];
  for (const app of new Set(
    copies.map((copy) => copy.record.app as Id<"app">),
  )) {
    const local = host.app(app);
    if (!local.ok) return local;
    if (local.value !== null && local.value.code_commit !== null) continue;
    const { origin, record } = pickRecord(copies, app)!;
    out.push({
      app,
      name: record.name,
      slug: record.slug,
      machine: origin,
      release:
        record.active_release === null
          ? null
          : {
              bundle_hash: record.active_release.bundle_hash,
              data_schema: record.active_release.data_schema,
              created_at: record.active_release.created_at,
            },
    });
  }
  return ok(out.sort((a, b) => (a.app < b.app ? -1 : 1)));
}
