// 재시작 E2E용 patch다. template 위에 write app-api `slow_write {title}`와 read app-api `count_slow`를 더한다.
// slow_write는 row를 넣고 live에서는 응답하지 않고 오래 기다린다. platform app test(mode "test")의 rewind 검사는 write
// app-api를 불러 돌아오기를 기다리므로 test에서는 기다리지 않는다.

async function replaceOnce(
  path: string,
  from: string,
  to: string,
): Promise<void> {
  const text = await Deno.readTextFile(path);
  if (!text.includes(from)) throw new Error(`${path}에 patch 자리가 없다`);
  await Deno.writeTextFile(path, text.replace(from, to));
}

export async function slowPatch(dir: string): Promise<void> {
  await replaceOnce(
    `${dir}/blueprint.ts`,
    `      {
        key: "add_item",`,
    `      {
        key: "count_slow",
        label: "Count slow",
        description: "Count the rows slow_write put in.",
        effect: "read",
        input: null,
        project_scope: false,
      },
      {
        key: "slow_write",
        label: "Slow write",
        description: "Put a row in and wait without answering.",
        effect: "write",
        input: {
          type: "object",
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
          },
          required: ["title"],
          additionalProperties: false,
        },
        project_scope: false,
      },
      {
        key: "add_item",`,
  );
  const api = `${dir}/src/app-api.ts`;
  await replaceOnce(
    api,
    `import { appApi, AppApiRejection, readResult } from "@lophn/cap-app-api";`,
    `import {
  appApi,
  AppApiRejection,
  currentContext,
  readResult,
} from "@lophn/cap-app-api";`,
  );
  await replaceOnce(
    api,
    `export function registerAppApis(deps: Deps = defaults): void {`,
    `const SLOW_WAIT_MS = 600_000;

export function slowWriteHandler(deps: Deps = defaults) {
  return async (input: unknown) => {
    const title = String((input as { title?: unknown } | null)?.title ?? "")
      .trim();
    if (title === "") {
      throw new AppApiRejection("invalid_input", "the item title is empty");
    }
    const item = await withStore(
      deps,
      "slow_write",
      (store) => addItem(store, title, deps.now()),
    );
    if (currentContext()?.mode === "live") {
      await new Promise((resolve) => setTimeout(resolve, SLOW_WAIT_MS));
    }
    return item;
  };
}

export function registerAppApis(deps: Deps = defaults): void {`,
  );
  await replaceOnce(
    api,
    `  appApi("add_item", addItemHandler(deps));`,
    `  appApi("add_item", addItemHandler(deps));
  appApi("slow_write", slowWriteHandler(deps));
  appApi("count_slow", () =>
    withStore(
      deps,
      "count_slow",
      (store) =>
        readResult([{
          count: (store.db.prepare("select count(*) as n from item")
            .get() as { n: number }).n,
        }], { coverage: "complete", freshness: "fresh" }),
    ));`,
  );
}
