// 앱의 둘째 domain E2E용 patch다. 둘째 domain에 read tool 둘을 더한다: 하나는 비공개(shelf_list), 하나는 공개(shelf_count).
// 그 domain을 맡지 않은 agent에게 비공개 tool은 가려지고 공개 tool은 보이는지 model 요청의 tool 목록으로 보려는 것이다.
// blueprint 선언과 handler를 같이 더해 platform app test(선언과 등록 handler가 같다)를 통과한다.

import type { AppPatch } from "./source.ts";

async function replaceOnce(
  path: string,
  from: string,
  to: string,
): Promise<void> {
  const text = await Deno.readTextFile(path);
  if (!text.includes(from)) throw new Error(`${path}에 patch 자리가 없다`);
  await Deno.writeTextFile(path, text.replace(from, to));
}

export function domainPatch(domain: string): AppPatch {
  return async (dir: string): Promise<void> => {
    const declare = (name: string, title: string, isPublic: boolean) =>
      `      {
        name: "${name}",
        title: "${title}",
        description: "${title}.",
        effect: "read",
        inputSchema: null,
        domain: "${domain}",
        public: ${isPublic},
      },
`;
    await replaceOnce(
      `${dir}/blueprint.ts`,
      `      {
        name: "add_item",`,
      `${declare("shelf_list", "List shelf", false)}${
        declare("shelf_count", "Count shelf", true)
      }      {
        name: "add_item",`,
    );
    await replaceOnce(
      `${dir}/src/tools.ts`,
      `  tool("add_item", addItemHandler(deps));`,
      `  tool("add_item", addItemHandler(deps));
  tool("shelf_list", () =>
    readResult([], { coverage: "complete", freshness: "fresh" }));
  tool("shelf_count", () =>
    readResult([], { coverage: "complete", freshness: "fresh" }));`,
    );
  };
}
