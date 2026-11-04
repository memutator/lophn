// 앱 process를 죽이는 patch. crash loop e2e(`app-restart_test.ts`)가 쓴다.
import { readFile, writeFile } from "node:fs/promises";

async function replaceOnce(
  path: string,
  from: string,
  to: string,
): Promise<void> {
  const text = await readFile(path, "utf8");
  if (!text.includes(from)) throw new Error(`${path}에 patch 자리가 없다`);
  await writeFile(path, text.replace(from, to));
}

/**
 * read command `crash`를 더한다. handler는 `{ok: true}`를 돌려주고 같은 tick 뒤에 처리되지 않는 오류를 던져
 * 앱 process가 죽는다. 선언과 handler가 같아 release 준비의 handler 검사를 통과한다.
 */
export async function crashPatch(dir: string): Promise<void> {
  await replaceOnce(
    `${dir}/lophn.ts`,
    `    {
      name: "add_item",`,
    `    {
      name: "crash",
      description: "Reply, then throw an unhandled error.",
      effect: "read",
      inputSchema: null,
      public: false,
    },
    {
      name: "add_item",`,
  );
  await replaceOnce(
    `${dir}/src/handlers.ts`,
    `  handle("add_item", addItemHandler(deps));`,
    `  handle("add_item", addItemHandler(deps));
  handle("crash", () => {
    setTimeout(() => {
      throw new Error("e2e crash");
    }, 0);
    return readResult([{ ok: true }], {
      coverage: "complete",
      freshness: "fresh",
    });
  });`,
  );
}
