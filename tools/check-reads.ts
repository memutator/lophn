// read route의 `reads` 검사. 실행: node tools/check-reads.ts
// read route가 기대는 이름을 `changes`로 내는 route가 하나도 없으면 그 읽기는 영영 다시 읽히지 않는다.
import { readdir } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

import type { Route } from "../packages/protocol/base/route.ts";

// route의 `changes` 밖에서 core가 `StateChanged`로 내는 이름. route 밖에서 내는 곳을 더하면 여기도 더한다.
// app_activity: 앱 호출 ledger가 호출마다 낸다. secrets: 앱 OAuth 완료가 secret 이름으로 낸다.
// settings: 설정 store가 바뀐 key마다 낸다(`settings/update`, file watch, core 안 정리 모두).
// unseen: attention이 못 본 turn 끝이 서고 꺼질 때마다 낸다(turn 끝, presence 보고, `unseen/dismiss`).
const PUBLISHED_OUTSIDE_ROUTES = [
  "app_activity",
  "secrets",
  "settings",
  "unseen",
];

const ROOT = new URL("..", import.meta.url).pathname;
const PROTOCOL = `${ROOT}packages/protocol`;

function isRoute(value: unknown): value is Route {
  const route = value as Partial<Route> | null;
  return (
    typeof route?.kind === "string" &&
    typeof route.resource === "string" &&
    typeof route.method === "string"
  );
}

// route는 export한 값이거나 export한 목록·객체(`PROJECT_API_ROUTES`, `projectApi`) 안에 있다.
function collect(value: unknown, found: Set<Route>, depth: number) {
  if (isRoute(value)) {
    found.add(value);
    return;
  }
  if (depth === 0 || value === null || typeof value !== "object") return;
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
    return;
  }
  for (const child of Object.values(value)) collect(child, found, depth - 1);
}

async function protocolRoutes(): Promise<Route[]> {
  const files = (await readdir(PROTOCOL, { recursive: true }))
    .filter((file) => file.endsWith(".ts") && !file.endsWith("_test.ts"))
    .sort();
  const found = new Set<Route>();
  for (const file of files) {
    const module = await import(pathToFileURL(`${PROTOCOL}/${file}`).href);
    collect(module, found, 3);
  }
  return [...found];
}

const changeName = (item: string | { name: string }) =>
  typeof item === "string" ? item : item.name;

const routes = await protocolRoutes();
const published = new Set<string>(PUBLISHED_OUTSIDE_ROUTES);
for (const route of routes) {
  for (const change of route.changes ?? []) published.add(changeName(change));
}
const problems: string[] = [];
for (const route of routes) {
  if (route.kind !== "read" && route.kind !== "memory") continue;
  for (const item of route.reads ?? []) {
    const name = changeName(item);
    if (!published.has(name)) {
      problems.push(
        `${route.resource}/${route.method}: reads "${name}" but no route changes it`,
      );
    }
  }
}
for (const problem of problems) console.error(problem);
if (problems.length > 0) process.exit(1);
console.log(`reads: ${routes.length} routes ok`);
