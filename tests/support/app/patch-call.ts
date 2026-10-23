// tool 호출 길(call)의 E2E가 쓰는 patch다. template에 tool 둘을 더한다. 선언과 handler를 같이 더해 release 준비의
// handler 검사(봉인한 bundle을 preview로 한 번 띄워 선언과 등록 handler를 대조한다)를 지나야 한다.
//
// - big_write {kb}: write. `kb` KiB 글을 한 row에 넣고 표의 row 수를 돌려준다.
// - put_text {text}: write. 길이 제한이 없는 글 하나를 저장하고 row 수를 돌려준다.

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

export async function callPatch(dir: string): Promise<void> {
  const slug = await sampleDomain(dir);
  // 같은 첫 단계에 표를 더한다. 이 release가 처음이라 공개한 단계를 고치는 것이 아니다.
  await replaceOnce(
    `${dir}/migrations/0-1.sql`,
    `create index item_created on item (created_at desc, id desc);`,
    `create index item_created on item (created_at desc, id desc);
create table note (
  id integer primary key,
  text text not null
);`,
  );
  await replaceOnce(
    `${dir}/lophn.ts`,
    `      {
        name: "add_item",`,
    `      {
        name: "big_write",
        title: "Big write",
        description: "Write a text of the given size in KiB as one row.",
        effect: "write",
        inputSchema: {
          type: "object",
          properties: {
            kb: { type: "integer", minimum: 1, maximum: 1024 },
          },
          required: ["kb"],
          additionalProperties: false,
        },
        domain: "${slug}",
        public: false,
      },
      {
        name: "put_text",
        title: "Put text",
        description: "Store a text of any length as one row.",
        effect: "write",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string", minLength: 1 } },
          required: ["text"],
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
    `export function registerTools(deps: Deps = defaults): void {`,
    `function putNote(store: Store, text: string): { rows: number } {
  store.db.prepare("insert into note (text) values (?)").run(text);
  const row = store.db.prepare("select count(*) as total from note").get() as {
    total: number;
  };
  return { rows: row.total };
}

export function registerTools(deps: Deps = defaults): void {
  tool("big_write", async (input: unknown) => {
    const kb = Number((input as { kb?: unknown } | null)?.kb);
    return await withStore(
      deps,
      "big_write",
      (store) => putNote(store, "x".repeat(kb * 1024)),
    );
  });
  tool("put_text", async (input: unknown) => {
    const text = String((input as { text?: unknown } | null)?.text ?? "");
    return await withStore(deps, "put_text", (store) => putNote(store, text));
  });`,
  );
}
