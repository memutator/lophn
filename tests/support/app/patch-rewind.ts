// 앱 data rewind E2E용 patch다. 한 write의 changeset은 한도 안(add_blob {kb: 100}은 약 100KiB)이고 셋을 합치면 control
// frame 한도(256KiB)를 넘는다. 선언과 handler를 같이 더해 release 준비의 handler 검사(선언과
// 등록 handler가 같다)를 통과한다.
//
// touch_blob은 read로 선언했지만 실제로는 가장 앞선 blob row를 고친다(changeset이 안 남는다). 선언과 동작이 다른 앱
// code의 실수를 흉내 내, 뒤집은 changeset이 충돌하게 만든다. 가장 앞선 row를 고쳐야 최신부터 뒤집는 중에 마지막에야
// 충돌한다: 앞선 둘이 이미 적용된 채 남으면 통째로 취소가 깨진 것이 보인다.
import { readFile, writeFile } from "node:fs/promises";

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

export async function rewindPatch(dir: string): Promise<void> {
  // 견본 선언의 domain이 그 앱의 domain 이름이다.
  const slug = await sampleDomain(dir);
  await replaceOnce(
    `${dir}/lophn.ts`,
    `      {
        name: "add_item",`,
    `      {
        name: "add_blob",
        description: "Store a row holding kb KiB of text.",
        effect: "write",
        inputSchema: {
          type: "object",
          properties: {
            kb: {
              type: "integer",
              description: "Size of the text in KiB.",
              minimum: 1,
              maximum: 200,
            },
          },
          required: ["kb"],
          additionalProperties: false,
        },
        domain: "${slug}",
        public: false,
      },
      {
        name: "count_blobs",
        description: "Count the stored blob rows.",
        effect: "read",
        inputSchema: null,
        domain: "${slug}",
        public: false,
      },
      {
        name: "touch_blob",
        description: "Read the oldest blob row.",
        effect: "read",
        inputSchema: null,
        domain: "${slug}",
        public: false,
      },
      {
        name: "add_item",`,
  );
  const sql = `${dir}/migrations/0-1.sql`;
  await writeFile(
    sql,
    `${await readFile(sql, "utf8")}create table blob (
  id integer primary key,
  body text not null
);
`,
  );
  await replaceOnce(
    `${dir}/src/handlers.ts`,
    `  handle("add_item", addItemHandler(deps));`,
    `  handle("add_item", addItemHandler(deps));
  handle("add_blob", (input) =>
    withStore(deps, "add_blob", (store) => {
      const kb = (input as { kb?: unknown } | null)?.kb;
      if (!Number.isInteger(kb) || (kb as number) < 1 || (kb as number) > 200) {
        throw new HandlerRejection("invalid_input", "kb is out of range");
      }
      store.db.prepare("insert into blob (body) values (?)").run(
        "x".repeat((kb as number) * 1024),
      );
      return { kb };
    }));
  // touched는 touch_blob이 고친 row(길이가 KiB의 배수가 아니다)의 수다.
  handle("count_blobs", () =>
    withStore(deps, "count_blobs", (store) =>
      readResult([
        store.db.prepare(
          "select count(*) as count, coalesce(sum(length(body) % 1024 != 0), 0) as touched from blob",
        ).get() as { count: number; touched: number },
      ], { coverage: "complete", freshness: "fresh" })));
  handle("touch_blob", () =>
    withStore(deps, "touch_blob", (store) => {
      store.db.prepare(
        "update blob set body = body || 'y' where id = (select min(id) from blob)",
      ).run();
      return readResult([], { coverage: "complete", freshness: "fresh" });
    }));`,
  );
}
