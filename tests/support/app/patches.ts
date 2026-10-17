// template 위에 얹는 patch다. 각 patch는 blueprint 선언과 handler를 같이 더해 platform app test(선언과 등록 handler가
// 같다, 되돌림)를 통과해야 한다. 다른 patch는 쓰는 flow의 task가 이 file에 더한다.

async function replaceOnce(
  path: string,
  from: string,
  to: string,
): Promise<void> {
  const text = await Deno.readTextFile(path);
  if (!text.includes(from)) throw new Error(`${path}에 patch 자리가 없다`);
  await Deno.writeTextFile(path, text.replace(from, to));
}

/** project 범위 read app-api `list_in_project`를 더한다. handler는 호출의 project를 그대로 돌려준다. */
export async function projectScopePatch(dir: string): Promise<void> {
  await replaceOnce(
    `${dir}/blueprint.ts`,
    `      {
        key: "add_item",`,
    `      {
        key: "list_in_project",
        label: "List in project",
        description: "Read the project the call is placed in.",
        effect: "read",
        input: null,
        project_scope: true,
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
    `  appApi("add_item", addItemHandler(deps));`,
    `  appApi("add_item", addItemHandler(deps));
  appApi("list_in_project", () =>
    readResult([{ project: currentContext()?.project ?? null }], {
      coverage: "complete",
      freshness: "fresh",
    }));`,
  );
}
