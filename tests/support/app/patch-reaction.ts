// reaction-app flow 전용 patch다. 다른 test에서 쓰지 않는다.

async function replaceOnce(
  path: string,
  from: string,
  to: string,
): Promise<void> {
  const text = await Deno.readTextFile(path);
  if (!text.includes(from)) throw new Error(`${path}에 patch 자리가 없다`);
  await Deno.writeTextFile(path, text.replace(from, to));
}

/**
 * read app-api `crash`를 더한다. handler는 `{ok: true}`를 돌려주고 같은 tick 뒤에 처리되지 않는 오류를 던져
 * 앱 process가 죽는다. blueprint 선언과 handler가 같아 platform app test를 통과한다.
 */
export async function crashPatch(dir: string): Promise<void> {
  await replaceOnce(
    `${dir}/blueprint.ts`,
    `      {
        key: "add_item",`,
    `      {
        key: "crash",
        label: "Crash",
        description: "Reply, then throw an unhandled error.",
        effect: "read",
        input: null,
        project_scope: false,
      },
      {
        key: "add_item",`,
  );
  await replaceOnce(
    `${dir}/src/app-api.ts`,
    `  appApi("add_item", addItemHandler(deps));`,
    `  appApi("add_item", addItemHandler(deps));
  appApi("crash", () => {
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
