// release 준비 흐름.
// extract → 상한 → UI build → blueprint extract → seal → blob prepare.
// 준비는 지정한 commit의 object에서 읽으므로 도중에 원본이 바뀌어도 결과가 달라지지 않는다.
// 취소·worker 종료·상한 초과는 부분 bundle을 지우고 확정하지 않는다.
import { err, ok, type Result, sha256Hex } from "../../../../base/mod.ts";
import {
  type BundleManifest,
  RELEASE_PREPARATION_LIMIT_MS,
} from "../../../../protocol/apps/mod.ts";
import {
  extractBlueprint,
  type ExtractSpawner,
} from "../../blueprint/extract.ts";
import { buildManifest } from "../bundle/manifest.ts";
import { bundleCopyPath, sealBundle } from "../bundle/seal.ts";
import { buildScreens } from "../ui-build/build.ts";
import {
  extractCommit,
  gitCommandRunner,
  type GitRunner,
} from "./git-extract.ts";
import { type LimitFailure, usageCounter } from "./limits.ts";

export type PrepareFailure = {
  code: "invalid_input" | "unavailable";
  reason: string;
};

type BlobPrepare = (input: {
  principal: string;
  purpose: string;
  bytes: ReadableStream<Uint8Array>;
}) => Promise<Result<{ hash: string; size_bytes: number }>>;

export type PrepareReleaseInput = {
  dataRoot: string;
  app: string;
  sourceRoot: string;
  commit: string;
  entrypoint: string;
  blueprintSource: string;
  screens: readonly { path: string; bytes: Uint8Array }[];
  // 화면 build가 JS 말고 만든 자원(index.html·CSS·글꼴). 그대로 bundle에 담고 runtime이 screens/ 아래에서 내준다.
  assets?: readonly { path: string; bytes: Uint8Array }[];
  // bundle에 담은 정확한 의존 전부(manifest.dependencies가 된다).
  dependencies: BundleManifest["dependencies"];
  uiDependencies: readonly { name: string; version: string }[];
  // 설치 SDK 사본의 byte(`sdk/<이름>/<version>/...`). bundle 안에서 앱 코드가 읽는다.
  sdkCopies?: readonly { path: string; bytes: Uint8Array }[];
  // bundle 안 상대 경로로 잠근 앱 import map. 있으면 `import-map.json`으로 bundle에 담는다.
  lockedImports?: Readonly<Record<string, string>>;
  // 준비가 받아 둔 npm·jsr 사본(`vendor/`, `node_modules/`). 운영 process는 이것만 읽는다.
  vendorCopies?: readonly { path: string; bytes: Uint8Array }[];
  // 플랫폼이 만든 진입 파일(`bundle/runtime-entry.ts`). 앱 source에 같은 path가 있으면 거절한다.
  entryFiles?: readonly { path: string; bytes: Uint8Array }[];
};

export type PreparedRelease = {
  bundleHash: string;
  copyPath: string;
  blueprintHash: string;
  manifest: BundleManifest;
};

export type PrepareDeps = {
  git?: GitRunner;
  now?: () => number;
  limitMs?: number;
  extract?: ExtractSpawner;
  prepareBlob?: BlobPrepare;
  // 준비 도중 true면 부분 사본을 지우고 확정하지 않는다.
  cancelled?: () => boolean;
};

function fail(
  reason: string,
  code: PrepareFailure["code"] = "invalid_input",
): Result<
  never,
  PrepareFailure
> {
  return err({ code, reason });
}

function fromLimit(limit: LimitFailure): Result<never, PrepareFailure> {
  return fail(limit.reason);
}

async function removePartial(path: string | undefined): Promise<void> {
  if (path === undefined) return;
  try {
    await Deno.remove(path, { recursive: true });
  } catch {
    // 아직 쓰지 않은 사본.
  }
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

// 준비 한 번. 상한·취소면 seal 결과를 남기지 않는다.
export async function prepareRelease(
  input: PrepareReleaseInput,
  deps: PrepareDeps = {},
): Promise<Result<PreparedRelease, PrepareFailure>> {
  const git = deps.git ?? gitCommandRunner();
  const now = deps.now ?? Date.now;
  const started = now();
  const counter = usageCounter(started, now);
  const limitMs = deps.limitMs ?? RELEASE_PREPARATION_LIMIT_MS;
  const extracted = await extractCommit(git, {
    sourceRoot: input.sourceRoot,
    commit: input.commit,
  });
  if (!extracted.ok) return fail(extracted.error.reason);
  let sourceBytes = 0;
  for (const file of extracted.value) sourceBytes += file.bytes.byteLength;
  const sourceLimit = counter.addSource(sourceBytes, extracted.value.length);
  if (sourceLimit) return fromLimit(sourceLimit);
  // 화면·blueprint·source map이 더해지기 전에 파일 수만 먼저 본다.
  // byte는 아래 bundle 합에서 한 번만 더한다.
  const assets = input.assets ?? [];
  const sdkCopies = input.sdkCopies ?? [];
  const vendorCopies = input.vendorCopies ?? [];
  const entryFiles = input.entryFiles ?? [];
  const lockedMap = input.lockedImports === undefined ? [] : [{
    path: "import-map.json",
    bytes: new TextEncoder().encode(
      JSON.stringify({ imports: input.lockedImports }),
    ),
  }];
  // 플랫폼이 더하는 파일의 path를 앱 source가 차지하고 있으면 거절한다.
  const reserved = new Set(
    [...sdkCopies, ...vendorCopies, ...entryFiles, ...lockedMap].map((file) =>
      file.path
    ),
  );
  if (extracted.value.some((file) => reserved.has(file.path))) {
    return fail("entrypoint_reserved");
  }
  const countedFiles = counter.addBundle(
    0,
    input.screens.length + assets.length + sdkCopies.length +
      vendorCopies.length + lockedMap.length + entryFiles.length + 2,
  );
  if (countedFiles) return fromLimit(countedFiles);
  if (deps.cancelled?.()) return fail("cancelled");

  const built = await buildScreens({
    screens: input.screens,
    dependencies: input.uiDependencies,
  });
  if (!built.ok) return fail(built.error.reason, built.error.code);
  const blueprint = await extractBlueprint(
    input.blueprintSource,
    (value) => {
      if (
        typeof value === "object" && value !== null && "name" in value &&
        typeof (value as { name: unknown }).name === "string"
      ) {
        return { ok: true, value: { name: (value as { name: string }).name } };
      }
      return { ok: false };
    },
    deps.extract,
    Math.min(10_000, limitMs),
  );
  if (!blueprint.ok) return fail(blueprint.error.reason, blueprint.error.code);
  if (now() - started > limitMs) return fail("elapsed_ms");
  if (deps.cancelled?.()) return fail("cancelled");

  const blueprintBytes = new TextEncoder().encode(
    blueprint.value.canonicalJson,
  );
  const files = [
    ...extracted.value,
    ...built.value.files,
    ...assets,
    ...sdkCopies,
    ...vendorCopies,
    ...entryFiles,
    ...lockedMap,
    { path: "blueprint.json", bytes: blueprintBytes },
  ];
  if (
    !files.some((file) => file.path === built.value.sourceMap.path)
  ) {
    files.push({
      path: built.value.sourceMap.path,
      bytes: built.value.sourceMap.bytes,
    });
  }
  let bundleBytes = 0;
  const hashed: { path: string; hash: string }[] = [];
  for (const file of files) {
    bundleBytes += file.bytes.byteLength;
    hashed.push({ path: file.path, hash: await sha256Hex(file.bytes) });
  }
  const bundleLimit = counter.addBundle(bundleBytes, 0);
  if (bundleLimit) return fromLimit(bundleLimit);
  const elapsed = counter.elapsed(now() - started);
  if (elapsed) return fromLimit(elapsed);

  const manifest = buildManifest({
    entrypoint: input.entrypoint,
    files: hashed,
    dependencies: input.dependencies,
  });
  if (!manifest.ok) return fail("manifest");
  const bundleHash = await sha256Hex(
    new TextEncoder().encode(JSON.stringify(manifest.value)),
  );
  const copy = bundleCopyPath(input.dataRoot, input.app, bundleHash);
  if (!copy.ok) return fail(copy.error.message);
  // 같은 hash의 봉인 사본이 이미 있으면 같은 byte다. 다시 쓰지 않는다. 봉인(0555)이 끝나지 않은
  // 사본은 끊긴 준비가 남긴 것이라 지우고 다시 쓴다.
  const found = await Deno.stat(copy.value).then((info) => info, () => null);
  const existing = found !== null && ((found.mode ?? 0) & 0o222) === 0;
  if (found !== null && !existing) await removePartial(copy.value);
  const sealed = existing ? { ok: true as const } : await sealBundle({
    copyPath: copy.value,
    manifest: manifest.value,
    blueprintJson: blueprintBytes,
    bundleFiles: files.filter((file) => file.path !== "blueprint.json"),
    sourceMap: built.value.sourceMap,
  });
  if (!sealed.ok) {
    await removePartial(copy.value);
    return fail(sealed.error.message, sealed.error.code);
  }
  if (deps.cancelled?.() || now() - started > limitMs) {
    if (!existing) await removePartial(copy.value);
    return fail(deps.cancelled?.() ? "cancelled" : "elapsed_ms");
  }
  if (deps.prepareBlob) {
    const prepared = await deps.prepareBlob({
      principal: "machine:release",
      purpose: "app_bundle",
      bytes: streamOf(new TextEncoder().encode(JSON.stringify(manifest.value))),
    });
    if (!prepared.ok) {
      if (!existing) await removePartial(copy.value);
      return fail("blob_prepare", "unavailable");
    }
  }
  return ok({
    bundleHash,
    copyPath: copy.value,
    blueprintHash: await sha256Hex(blueprintBytes),
    manifest: manifest.value,
  });
}
