// problem body 읽기 flow 전용 patch다. 다른 test에서 쓰지 않는다.

async function replaceOnce(
  path: string,
  from: string,
  to: string,
): Promise<void> {
  const text = await Deno.readTextFile(path);
  if (!text.includes(from)) throw new Error(`${path}에 patch 자리가 없다`);
  await Deno.writeTextFile(path, text.replace(from, to));
}

/** 보고 글의 표지다. test가 agent가 읽어 온 본문에서 이 글을 찾는다. */
export const REPORT_MARKER = "e2e-report-body-marker";

/**
 * read app-api `report`를 더한다. handler는 `reportProblem`으로 message를 남기고 보고가 끝나길 기다린다.
 * blueprint 선언과 handler가 같아 platform app test를 통과한다.
 */
export async function reportPatch(dir: string): Promise<void> {
  await replaceOnce(
    `${dir}/blueprint.ts`,
    `      {
        key: "add_item",`,
    `      {
        key: "report",
        label: "Report",
        description: "Report a problem with a message.",
        effect: "read",
        input: null,
        project_scope: false,
      },
      {
        key: "add_item",`,
  );
  const api = `${dir}/src/app-api.ts`;
  await replaceOnce(
    api,
    `  appApi("add_item", addItemHandler(deps));`,
    `  appApi("add_item", addItemHandler(deps));
  appApi("report", async () => {
    await reportProblem(
      "e2e_report",
      "${REPORT_MARKER}: the sync step failed twice",
    ).completion;
    return readResult([{ ok: true }], {
      coverage: "complete",
      freshness: "fresh",
    });
  });`,
  );
}
