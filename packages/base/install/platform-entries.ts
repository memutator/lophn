// 설치 묶음의 platform/ 안에서 esbuild로 묶는 진입점 표.
// 개발·test는 `dist/`가 없어 `source`(.ts)를 그대로 쓰고, 설치본은 `dist/*.mjs`를 우선 쓴다.
// base는 node를 import하지 않아 파일 시스템 함수는 부르는 쪽이 넘긴다.

export const PLATFORM_ENTRIES = {
  daemon: {
    dist: "dist/daemon.mjs",
    source: "packages/core/main/daemon/main.ts",
  },
  cli: {
    dist: "dist/cli.mjs",
    source: "packages/cli/main.ts",
  },
  io: {
    dist: "dist/io-entry.mjs",
    source: "packages/core/main/daemon/io-entry.ts",
  },
  appSupervisor: {
    dist: "dist/app-supervisor.mjs",
    source: "packages/core/main/app-supervisor/main.ts",
  },
  agentRuntime: {
    dist: "dist/agent-runtime.mjs",
    source: "packages/core/main/agent-runtime/main.ts",
  },
  writerWorker: {
    dist: "dist/writer-worker.mjs",
    source: "packages/core/storage/ledger/writer-worker.ts",
  },
  readerWorker: {
    dist: "dist/reader-worker.mjs",
    source: "packages/core/storage/ledger/reader-worker.ts",
  },
  readerRegistration: {
    dist: "dist/reader-registration.mjs",
    source: "packages/core/storage/ledger/reader-registration.ts",
  },
  teamModules: {
    dist: "dist/team-modules.mjs",
    source: "packages/core/main/daemon/team-modules.ts",
  },
  maintenance: {
    dist: "dist/maintenance-entry.mjs",
    source: "packages/core/main/worker/maintenance-entry.ts",
  },
  dataJob: {
    dist: "dist/data-job.mjs",
    source: "packages/core/main/worker/data-job.ts",
  },
  releaseJob: {
    dist: "dist/release-job.mjs",
    source: "packages/core/main/worker/release-job.ts",
  },
  terminalHost: {
    dist: "dist/terminal-host.mjs",
    source: "packages/core/terminals/host/cli.ts",
  },
  searchWorker: {
    dist: "dist/search-worker.mjs",
    source: "packages/core/lophn-agent/tools/file/search-worker.ts",
  },
  localToolRunner: {
    dist: "dist/local-tool-runner.mjs",
    source: "packages/core/lophn-agent/tools/local-tool-runner.ts",
  },
  npmEntry: {
    dist: "dist/npm-entry.mjs",
    source: "packages/core/apps/packages/npm-entry.ts",
  },
  appEntrypoint: {
    dist: "dist/app-entrypoint.mjs",
    source: "packages/core/apps/runtime/entrypoint/main.ts",
  },
  extractChild: {
    dist: "dist/extract-child.mjs",
    source: "packages/core/apps/declaration/extract-child.ts",
  },
  evalDeclaration: {
    dist: "dist/eval-declaration.mjs",
    source: "packages/core/apps/releases/ui-build/eval-declaration.ts",
  },
  appBuild: {
    dist: "dist/app-build.mjs",
    source: "packages/core/apps/releases/ui-build/app-build.ts",
  },
  phoneBackend: {
    dist: "dist/phone-backend.mjs",
    source: "packages/core/apps/releases/phone-backend/main.ts",
  },
  agentNodeFs: {
    dist: "dist/agent-node-fs.mjs",
    source: "packages/core/lophn-agent/agents/adapters/node-fs.ts",
  },
  extensionNodeFs: {
    dist: "dist/extension-node-fs.mjs",
    source: "packages/core/lophn-agent/extensions/adapters/node-fs.ts",
  },
} as const;

export type PlatformEntryName = keyof typeof PLATFORM_ENTRIES;

export type PlatformPathDeps = {
  exists(path: string): boolean;
  dirname(path: string): string;
  join(...parts: string[]): string;
};

// `startDir`에서 위로 올라가며 platform root(개발은 저장소 root, 설치본은 platform/)를 찾는다.
// `packages/core/apps/packages/`와 구분되도록 `package.json`과 `packages/sdk`(또는 `dist/daemon.mjs`)가 함께 있는 자리를 고른다.
export function findPlatformRoot(
  startDir: string,
  deps: PlatformPathDeps,
): string {
  let current = startDir;
  for (let i = 0; i < 12; i += 1) {
    if (
      deps.exists(deps.join(current, "package.json")) &&
      (deps.exists(deps.join(current, "packages", "sdk")) ||
        deps.exists(deps.join(current, "dist", "daemon.mjs")))
    ) {
      return current;
    }
    const parent = deps.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`platform root not found from ${startDir}`);
}

export function resolvePlatformEntry(
  platformRoot: string,
  name: PlatformEntryName,
  deps: Pick<PlatformPathDeps, "exists" | "join">,
): string {
  const entry = PLATFORM_ENTRIES[name];
  const bundled = deps.join(platformRoot, entry.dist);
  return deps.exists(bundled) ? bundled : deps.join(platformRoot, entry.source);
}
