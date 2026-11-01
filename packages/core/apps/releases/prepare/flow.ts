// release 준비 흐름.
// extract → 상한 → UI build → 선언 extract → seal → blob prepare.
// 준비는 지정한 commit의 object에서 읽으므로 도중에 원본이 바뀌어도 결과가 달라지지 않는다.
// 취소·worker 종료·상한 초과는 부분 bundle을 지우고 확정하지 않는다.
import { rm, stat } from "node:fs/promises";
import { err, ok, type Result, sha256Hex } from "../../../../base/mod.ts";
import {
  type BundleManifest,
  RELEASE_PREPARATION_LIMIT_MS,
} from "../../../../protocol/apps/mod.ts";
import {
  type ExtractSpawner,
  extractDeclaration,
} from "../../declaration/extract.ts";
import { buildManifest } from "../bundle/manifest.ts";
import { bundleCopyPath, writeBundle } from "../bundle/seal.ts";
import { buildScreens } from "../ui-build/build.ts";
import {
  extractCommit,
  type GitRunner,
  gitCommandRunner,
} from "./git-extract.ts";
import { type LimitFailure, usageCounter } from "./limits.ts";

// `app.icon`이 읽는 상한과 같다.
const ICON_MAX_BYTES = 64 * 1024;

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
  declarationSource: string;
  screens: readonly { path: string; bytes: Uint8Array }[];
  // 화면 build가 JS 말고 만든 자원(index.html·CSS·글꼴). 그대로 bundle에 담고 runtime이 screens/ 아래에서 내준다.
  assets?: readonly { path: string; bytes: Uint8Array }[];
  // bundle에 담은 정확한 의존 전부(manifest.dependencies가 된다).
  dependencies: BundleManifest["dependencies"];
  uiDependencies: readonly { name: string; version: string }[];
  // 설치 SDK 사본의 byte(`.lophn/sdk/<이름>/<version>/...`). bundle 안에서 앱 코드가 읽는다.
  sdkCopies?: readonly { path: string; bytes: Uint8Array }[];
  // npm이 앱 폴더에 깐 `node_modules`의 byte(정규 file과 symlink 목록). 운영 process는 bundle 안의
  // 이 사본만 읽는다.
  moduleCopies?: readonly { path: string; bytes: Uint8Array }[];
  // 플랫폼이 만든 진입 파일(`bundle/runtime-entry.ts`). 앱 source에 같은 path가 있으면 거절한다.
  entryFiles?: readonly { path: string; bytes: Uint8Array }[];
};

export type PreparedRelease = {
  bundleHash: string;
  copyPath: string;
  declarationHash: string;
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
): Result<never, PrepareFailure> {
  return err({ code, reason });
}

function fromLimit(limit: LimitFailure): Result<never, PrepareFailure> {
  return fail(limit.reason);
}

async function removePartial(path: string | undefined): Promise<void> {
  if (path === undefined) return;
  try {
    await rm(path, { recursive: true });
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
  // 화면·화면 map·선언이 더해지기 전에 파일 수만 먼저 본다.
  // byte는 아래 bundle 합에서 한 번만 더한다.
  const assets = input.assets ?? [];
  const sdkCopies = input.sdkCopies ?? [];
  const moduleCopies = input.moduleCopies ?? [];
  const entryFiles = input.entryFiles ?? [];
  // 플랫폼이 더하는 파일의 path를 앱 source가 차지하고 있으면 거절한다.
  const reserved = new Set(
    [...sdkCopies, ...moduleCopies, ...entryFiles].map((file) => file.path),
  );
  if (extracted.value.some((file) => reserved.has(file.path))) {
    return fail("entrypoint_reserved");
  }
  const countedFiles = counter.addBundle(
    0,
    input.screens.length * 2 +
      assets.length +
      sdkCopies.length +
      moduleCopies.length +
      entryFiles.length +
      1,
  );
  if (countedFiles) return fromLimit(countedFiles);
  if (deps.cancelled?.()) return fail("cancelled");

  const built = await buildScreens({
    screens: input.screens,
    dependencies: input.uiDependencies,
  });
  if (!built.ok) return fail(built.error.reason, built.error.code);
  const declaration = await extractDeclaration(
    input.declarationSource,
    (value) => {
      if (
        typeof value === "object" &&
        value !== null &&
        "name" in value &&
        typeof (value as { name: unknown }).name === "string"
      ) {
        return { ok: true, value: { name: (value as { name: string }).name } };
      }
      return { ok: false };
    },
    deps.extract,
    Math.min(10_000, limitMs),
  );
  if (!declaration.ok) {
    return fail(declaration.error.reason, declaration.error.code);
  }
  if (now() - started > limitMs) return fail("elapsed_ms");
  if (deps.cancelled?.()) return fail("cancelled");

  const declarationBytes = new TextEncoder().encode(
    declaration.value.canonicalJson,
  );
  const files = [
    ...extracted.value,
    ...built.value.files,
    ...assets,
    ...sdkCopies,
    ...moduleCopies,
    ...entryFiles,
    { path: "declaration.json", bytes: declarationBytes },
  ];
  // 선언한 icon이 bundle에 없거나 `app.icon`의 상한보다 크면 보이지 않으므로 준비에서 알린다.
  const { icon, skills } = JSON.parse(declaration.value.canonicalJson) as {
    icon?: string;
    skills?: { name: string }[];
  };
  if (icon !== undefined) {
    const found = files.find((file) => `/${file.path}` === icon);
    if (found === undefined) {
      return fail(
        `The declared icon ${icon} is not in the committed source. Commit the image at that path.`,
      );
    }
    if (found.bytes.byteLength > ICON_MAX_BYTES) {
      return fail(
        `The declared icon ${icon} is larger than ${ICON_MAX_BYTES / 1024} KiB.`,
      );
    }
  }
  // 선언한 skill의 폴더가 commit에 없으면 shared-skill이 읽을 것이 없다. .gitignore가 .lophn/을 통째로 빼는 것이 흔한 원인이다.
  for (const skill of skills ?? []) {
    const path = `.lophn/skills/${skill.name}/SKILL.md`;
    if (!files.some((file) => file.path === path)) {
      return fail(
        `The declared skill ${skill.name} has no ${path} in the commit. If .gitignore excludes .lophn/, change it to .lophn/sdk/.`,
      );
    }
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
  // 같은 hash의 봉인 사본이 이미 있으면 같은 byte다. 다시 쓰지 않는다. 봉인(0555)이 끝나지 않은 사본은 끊긴
  // 준비가 남긴 것이거나 core가 아직 봉인하지 않은 것이라 지우고 다시 쓴다. 봉인(연결 만들기)은 core가 한다.
  const found = await stat(copy.value).then(
    (info) => info,
    () => null,
  );
  const existing = found !== null && ((found.mode ?? 0) & 0o222) === 0;
  if (found !== null && !existing) await removePartial(copy.value);
  const sealed = existing
    ? { ok: true as const }
    : await writeBundle({
        copyPath: copy.value,
        manifest: manifest.value,
        declarationJson: declarationBytes,
        bundleFiles: files.filter((file) => file.path !== "declaration.json"),
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
    declarationHash: await sha256Hex(declarationBytes),
    manifest: manifest.value,
  });
}
