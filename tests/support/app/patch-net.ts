// net·secret 길(cap-net·cap-secret)의 E2E가 쓰는 patch다. template에 external command `fetch_local`을 더한다.
// 선언·package.json의 SDK 의존·handler를 같이 더해 release 준비의 handler 검사(선언과 등록 handler를 대조한다)를
// 지나야 한다.
//
// - fetch_local {}: external. `useSecret`으로 secret을 목적지에 묶은 뒤 같은 목적지로 `netFetch`하고 `{ status, body }`를
//   돌려준다. 값은 앱이 모르고 broker가 `Authorization: Bearer`로 붙인다.
//
// release 준비의 handler 검사와 preview 자식은 handler 본문을 부르지 않거나 broker가 바깥 요청을 거절한다(`liveOnly`,
// `packages/core/apps/permissions/broker/net-fetch.ts`). 본문은 live에서만 돈다.

import { readFile, rm, writeFile } from "node:fs/promises";

import { packageInstallPath } from "../../../packages/core/apps/packages/install.ts";
import { appSdkDependency } from "../../../packages/core/apps/packages/sdk-sync.ts";
import { sampleDomain } from "./source.ts";

async function replaceOnce(
  path: string,
  from: string,
  to: string,
): Promise<void> {
  const text = await readFile(path, "utf8");
  if (!text.includes(from)) throw new Error(`${path}에 patch 자리가 없다`);
  await writeFile(path, text.replace(from, to));
}

// 앱 package.json에 거는 SDK 의존 값. release 준비는 정확한 판과 `file:.lophn/sdk/...` 값을 요구한다.
function sdkDependency(name: string): { name: string; value: string } {
  const path = packageInstallPath(name, "1.0.0");
  if (!path.ok) throw new Error(`SDK 설치 경로: ${path.error.message}`);
  return { name, value: appSdkDependency(path.value) };
}

export async function netFetchPatch(
  dir: string,
  options: { port: number; secret: string },
): Promise<void> {
  const { port, secret } = options;
  const slug = await sampleDomain(dir);
  const declaration = `${dir}/lophn.ts`;
  await replaceOnce(
    declaration,
    `      {
        name: "add_item",`,
    `      {
        name: "fetch_local",
        description: "Fetch the local server with the stored token.",
        effect: "external",
        inputSchema: null,
        domain: "${slug}",
        public: false,
      },
      {
        name: "add_item",`,
  );
  await replaceOnce(
    declaration,
    `    permissions: [],`,
    `    permissions: [
      {
        kind: "net.fetch",
        scope: { host: "127.0.0.1", port: ${port} },
        reason: "Fetch the local test server.",
      },
      {
        kind: "secret.use",
        scope: { name: "${secret}" },
        reason: "Send the token to the local test server.",
      },
    ],`,
  );
  await replaceOnce(
    declaration,
    `      { name: "@lophn/cap-tool", version: "2.0.0" },`,
    `      { name: "@lophn/cap-tool", version: "2.0.0" },
      { name: "@lophn/cap-net", version: "1.0.0" },
      { name: "@lophn/cap-secret", version: "1.0.0" },`,
  );
  const manifest = `${dir}/package.json`;
  const parsed = JSON.parse(await readFile(manifest, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const dependencies = parsed.dependencies ?? {};
  for (const dependency of [
    sdkDependency("@lophn/cap-net"),
    sdkDependency("@lophn/cap-secret"),
  ]) {
    dependencies[dependency.name] = dependency.value;
  }
  parsed.dependencies = dependencies;
  await writeFile(manifest, `${JSON.stringify(parsed, null, 2)}\n`);
  // SDK 의존이 늘면 기존 lock은 package.json과 어긋나고 release 준비의 npm ci가 거절한다. lock이 없으면
  // release 준비가 npm install로 새로 푼다.
  await rm(`${dir}/package-lock.json`, { force: true });

  const api = `${dir}/src/handlers.ts`;
  await replaceOnce(
    api,
    `import { openStore, type Store } from "@lophn/cap-store";`,
    `import { netFetch } from "@lophn/cap-net";
import { useSecret } from "@lophn/cap-secret";
import { openStore, type Store } from "@lophn/cap-store";`,
  );
  await replaceOnce(
    api,
    `export function registerHandlers(deps: Deps = defaults): void {`,
    `export function registerHandlers(deps: Deps = defaults): void {
  handle("fetch_local", async () => {
    const destination = { host: "127.0.0.1", port: ${port} };
    await useSecret({ name: "${secret}", destination });
    return await netFetch({ ...destination, path: "/" });
  });`,
  );
}
