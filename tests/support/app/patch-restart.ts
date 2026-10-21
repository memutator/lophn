// 재시작 E2E용 patch다. template 위에 write tool `slow_write {title}`와 read tool `count_slow`를 더한다.
// slow_write는 row를 넣고 live에서만 응답하지 않고 오래 기다린다. preview에서 부르면 바로 답한다.
import { sampleDomain } from "./source.ts";

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
  // 견본 blueprint의 domain이 그 앱의 domain 이름이다.
  const slug = await sampleDomain(dir);
  await replaceOnce(
    `${dir}/blueprint.ts`,
    `      {
        name: "add_item",`,
    `      {
        name: "count_slow",
        title: "Count slow",
        description: "Count the rows slow_write put in.",
        effect: "read",
        inputSchema: null,
        domain: "${slug}",
        public: false,
      },
      {
        name: "slow_write",
        title: "Slow write",
        description: "Put a row in and wait without answering.",
        effect: "write",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
          },
          required: ["title"],
          additionalProperties: false,
        },
        domain: "${slug}",
        public: false,
      },
      {
        name: "add_item",`,
  );
  const api = `${dir}/src/tools.ts`;
  await replaceOnce(
    api,
    `import { readResult, tool, ToolRejection } from "@lophn/cap-tool";`,
    `import {
  tool,
  ToolRejection,
  currentContext,
  readResult,
} from "@lophn/cap-tool";`,
  );
  await replaceOnce(
    api,
    `export function registerTools(deps: Deps = defaults): void {`,
    `const SLOW_WAIT_MS = 600_000;

export function slowWriteHandler(deps: Deps = defaults) {
  return async (input: unknown) => {
    const title = String((input as { title?: unknown } | null)?.title ?? "")
      .trim();
    if (title === "") {
      throw new ToolRejection("invalid_input", "the item title is empty");
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

export function registerTools(deps: Deps = defaults): void {`,
  );
  await replaceOnce(
    api,
    `  tool("add_item", addItemHandler(deps));`,
    `  tool("add_item", addItemHandler(deps));
  tool("slow_write", slowWriteHandler(deps));
  tool("count_slow", () =>
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
