// release 준비 흐름(apps/releases#R1–R4, R19, apps/blueprint#R17, apps/sdk#R7, R34).
// extract → 상한 → UI build → blueprint extract → seal → blob prepare.
// 취소·worker 종료·상한 초과는 부분 bundle을 지우고 확정하지 않는다.
import { err, ok, type Result, sha256Hex } from "../../../base/mod.ts";
import { RELEASE_PREPARATION_LIMIT_MS } from "../../../contracts/apps/mod.ts";
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
import {
  gitSourceWatch,
  observationPin,
  observeGitSource,
} from "./source-watch.ts";

export type PrepareFailure = {
  code: "invalid_input" | "unavailable";
  reason: string;
};

export type BlobPrepare = (input: {
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
  sdkDependencies: readonly { name: string; version: string }[];
  uiDependencies: readonly { name: string; version: string }[];
};

export type PreparedRelease = {
  bundleHash: string;
  copyPath: string;
  blueprintHash: string;
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

// 준비 한 번. 상한·취소·source 변경이면 seal 결과를 남기지 않는다.
export async function prepareRelease(
  input: PrepareReleaseInput,
  deps: PrepareDeps = {},
): Promise<Result<PreparedRelease, PrepareFailure>> {
  const git = deps.git ?? gitCommandRunner();
  const now = deps.now ?? Date.now;
  const started = now();
  const counter = usageCounter(started, now);
  const limitMs = deps.limitMs ?? RELEASE_PREPARATION_LIMIT_MS;
  const observed = await observeGitSource(git, input.sourceRoot, input.commit);
  if (observed === undefined) return fail("git_failed", "unavailable");
  const watch = gitSourceWatch(
    git,
    input.sourceRoot,
    input.commit,
    observationPin(observed),
  );
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
  const countedFiles = counter.addBundle(
    0,
    input.screens.length + assets.length + 2,
  );
  if (countedFiles) return fromLimit(countedFiles);
  if (deps.cancelled?.()) return fail("cancelled");
  if (await watch.changedSince()) return fail("source_changed");

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
  if (await watch.changedSince()) return fail("source_changed");

  const blueprintBytes = new TextEncoder().encode(
    blueprint.value.canonicalJson,
  );
  const files = [
    ...extracted.value,
    ...built.value.files,
    ...assets,
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
    sdk_dependencies: input.sdkDependencies,
  });
  if (!manifest.ok) return fail("manifest");
  const bundleHash = await sha256Hex(
    new TextEncoder().encode(JSON.stringify(manifest.value)),
  );
  const copy = bundleCopyPath(input.dataRoot, input.app, bundleHash);
  if (!copy.ok) return fail(copy.error.message);
  const sealed = await sealBundle({
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
  if (
    deps.cancelled?.() || await watch.changedSince() ||
    now() - started > limitMs
  ) {
    await removePartial(copy.value);
    return fail(
      deps.cancelled?.()
        ? "cancelled"
        : now() - started > limitMs
        ? "elapsed_ms"
        : "source_changed",
    );
  }
  if (deps.prepareBlob) {
    const prepared = await deps.prepareBlob({
      principal: "machine:release",
      purpose: "app_bundle",
      bytes: streamOf(new TextEncoder().encode(JSON.stringify(manifest.value))),
    });
    if (!prepared.ok) {
      await removePartial(copy.value);
      return fail("blob_prepare", "unavailable");
    }
  }
  return ok({
    bundleHash,
    copyPath: copy.value,
    blueprintHash: await sha256Hex(blueprintBytes),
  });
}
