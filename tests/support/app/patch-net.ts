// net·secret 길(cap-net·cap-secret)의 E2E가 쓰는 patch다. template에 external tool `fetch_local`을 더한다.
// blueprint 선언·SDK 의존·import map·handler를 같이 더해 platform app test(선언과 등록 handler가 같다, 의존이 같다)를
// 통과해야 한다.
//
// - fetch_local {}: external. `useSecret`으로 secret을 목적지에 묶은 뒤 같은 목적지로 `netFetch`하고 `{ status, body }`를
//   돌려준다. 값은 앱이 모르고 broker가 `Authorization: Bearer`로 붙인다.
//
// test mode에서 handler 본문은 돌지 않는다. platform app test는 입력이 없는 external api에 입력 계약을 어긴 값만 보내고
// (거절은 handler 앞에서 일어난다) rewind는 write만 부르므로 대역을 끼우지 않는다. 본문은 live에서만 돌고, test mode에서
// broker는 외부에 닿는 요청을 거절한다(`liveOnly`).

async function replaceOnce(
  path: string,
  from: string,
  to: string,
): Promise<void> {
  const text = await Deno.readTextFile(path);
  if (!text.includes(from)) throw new Error(`${path}에 patch 자리가 없다`);
  await Deno.writeTextFile(path, text.replace(from, to));
}

export async function netFetchPatch(
  dir: string,
  options: { port: number; secret: string },
): Promise<void> {
  const { port, secret } = options;
  const blueprint = `${dir}/blueprint.ts`;
  await replaceOnce(
    blueprint,
    `      {
        key: "add_item",`,
    `      {
        key: "fetch_local",
        label: "Fetch local",
        description: "Fetch the local server with the stored token.",
        effect: "external",
        input: null,
        project_scope: false,
      },
      {
        key: "add_item",`,
  );
  await replaceOnce(
    blueprint,
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
    blueprint,
    `      { name: "@lophn/cap-tool", version: "1.0.0" },`,
    `      { name: "@lophn/cap-tool", version: "1.0.0" },
      { name: "@lophn/cap-net", version: "1.0.0" },
      { name: "@lophn/cap-secret", version: "1.0.0" },`,
  );
  await replaceOnce(
    `${dir}/deno.json`,
    `    "@lophn/cap-tool": "lophn-sdk:@lophn/cap-tool@1.0.0/mod.ts",`,
    `    "@lophn/cap-tool": "lophn-sdk:@lophn/cap-tool@1.0.0/mod.ts",
    "@lophn/cap-net": "lophn-sdk:@lophn/cap-net@1.0.0/mod.ts",
    "@lophn/cap-secret": "lophn-sdk:@lophn/cap-secret@1.0.0/mod.ts",`,
  );
  const api = `${dir}/src/tools.ts`;
  await replaceOnce(
    api,
    `import { openStore, type Store } from "@lophn/cap-store";`,
    `import { netFetch } from "@lophn/cap-net";
import { useSecret } from "@lophn/cap-secret";
import { openStore, type Store } from "@lophn/cap-store";`,
  );
  await replaceOnce(
    api,
    `export function registerTools(deps: Deps = defaults): void {`,
    `export function registerTools(deps: Deps = defaults): void {
  tool("fetch_local", async () => {
    const destination = { host: "127.0.0.1", port: ${port} };
    await useSecret({ name: "${secret}", destination });
    return await netFetch({ ...destination, path: "/" });
  });`,
  );
}
