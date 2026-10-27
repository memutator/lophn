import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import { sampleDomain } from "./source.ts";

// release activation E2E가 template 위에 얹는 patch다. 각 patch는 선언과 handler를 같이 바꿔 release 준비의
// 검사(빈 DB와 active release schema에서 migration, handler 대조)를 지나야 한다. 같은 source에 차례로 얹으므로 앞 patch가
// 만든 자리를 다시 찾지 않는다.

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
 * schema 2 단계를 더한다. release 준비의 migration 검사(빈 DB와 active release의 schema에서 돌린다)는 지나고, 같은 title의
 * row가 둘 이상 있는 운영 DB에서만 activation 때 실패한다. 파일 머리에 `-- loss:` 선언이 없어 사람에게 묻지 않는다.
 */
export async function failingMigrationPatch(dir: string): Promise<void> {
  await writeFile(
    `${dir}/migrations/1-2.sql`,
    `-- Titles become unique.
create unique index item_title on item (title);
`,
  );
}

// 선언만 넓힌다. 앱 code는 그 permission을 쓰지 않는다.
async function addNetFetch(dir: string, host: string): Promise<void> {
  await replaceOnce(
    `${dir}/lophn.ts`,
    `    permissions: [],`,
    `    permissions: [{
      kind: "net.fetch",
      scope: { host: "${host}", port: 443 },
      reason: "Fetch pages from ${host}.",
    }],`,
  );
}

/** 선언에 permission 하나(net.fetch example.com)를 더한다. 활성 앱 grant가 덮지 않으므로 사람에게 묻는다. */
export function widenPatch(dir: string): Promise<void> {
  return addNetFetch(dir, "example.com");
}

/** `widenPatch`와 다른 permission(net.fetch example.org)을 더한다. 둘을 한 source에 같이 얹지 않는다. */
export function widenPatch2(dir: string): Promise<void> {
  return addNetFetch(dir, "example.org");
}

/** handler 파일에 주석 한 줄을 더한다. bundle과 release는 새로 생기고 schema와 선언은 그대로다. 몇 번이든 얹을 수 있다. */
export async function codeOnlyPatch(dir: string): Promise<void> {
  const api = `${dir}/src/tools.ts`;
  const text = await readFile(api, "utf8");
  const count = text.split("// code-only change").length;
  await writeFile(api, `${text}// code-only change ${count}\n`);
}

/** read tool `delay {ms}`를 더한다. 앱 안의 timer로 ms만큼 기다렸다 답한다. */
export async function slowReadPatch(dir: string): Promise<void> {
  // source 폴더 이름은 slug가 아니라 앱 id라, 견본 선언에서 domain을 읽는다.
  const slug = await sampleDomain(dir);
  await replaceOnce(
    `${dir}/lophn.ts`,
    `      {
        name: "add_item",`,
    `      {
        name: "delay",
        title: "Delay",
        description: "Answer after waiting.",
        effect: "read",
        inputSchema: {
          type: "object",
          properties: {
            ms: { type: "integer", minimum: 0, maximum: 10000 },
          },
          required: ["ms"],
          additionalProperties: false,
        },
        domain: "${slug}",
        public: false,
      },
      {
        name: "add_item",`,
  );
  await replaceOnce(
    `${dir}/src/tools.ts`,
    `  tool("add_item", addItemHandler(deps));`,
    `  tool("add_item", addItemHandler(deps));
  tool("delay", async (input: unknown) => {
    const ms = Number((input as { ms?: unknown } | null)?.ms ?? 0);
    await new Promise((resolve) => setTimeout(resolve, ms));
    return readResult([{ waited: ms }], {
      coverage: "complete",
      freshness: "fresh",
    });
  });`,
  );
}

/** `widenPatch`·`widenPatch2`와 다른 permission(net.fetch example.net)을 더한다. */
export function widenPatch3(dir: string): Promise<void> {
  return addNetFetch(dir, "example.net");
}

/** schema 2 단계를 더하는데 data가 있어도 성공한다(title 위의 보통 index). 파일 머리에 `-- loss:`가 없다. */
export async function okMigrationPatch(dir: string): Promise<void> {
  await writeFile(
    `${dir}/migrations/1-2.sql`,
    `-- Titles get an index.
create index item_title on item (title);
`,
  );
}

/** 이전 patch를 지우려고 source를 base commit으로 되돌린다. 사람의 git 설정은 읽지 않는다. */
export async function resetSource(dir: string, commit: string): Promise<void> {
  const child = spawn("git", ["reset", "-q", "--hard", commit], {
    cwd: dir,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const stderr: string[] = [];
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => stderr.push(chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (exitCode) => resolve(exitCode));
  });
  if (code !== 0) {
    throw new Error(`git reset: ${stderr.join("")}`);
  }
}
