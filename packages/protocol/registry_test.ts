import { assertEquals } from "@std/assert";
import { ID_PREFIXES } from "./base/ids.ts";
import { ALL_EVENTS, ALL_ROUTES } from "./mod.ts";

const TOP_LEVEL = /^protocol\/([^/]+)/;

Deno.test("contracts#T8: (resource, method)가 유일하다", () => {
  const seen = new Map<string, number>();
  for (const route of ALL_ROUTES) {
    const key = `${route.resource}/${route.method}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const duplicated = [...seen].filter(([, count]) => count > 1);
  assertEquals(duplicated, []);
});

Deno.test("contracts#T8: route name이 유일하다", () => {
  const seen = new Map<string, number>();
  for (const route of ALL_ROUTES) {
    seen.set(route.name, (seen.get(route.name) ?? 0) + 1);
  }
  const duplicated = [...seen].filter(([, count]) => count > 1);
  assertEquals(duplicated, []);
});

Deno.test("contracts#T8: event type이 유일하다", () => {
  const seen = new Map<string, number>();
  for (const event of ALL_EVENTS) {
    seen.set(event.type, (seen.get(event.type) ?? 0) + 1);
  }
  const duplicated = [...seen].filter(([, count]) => count > 1);
  assertEquals(duplicated, []);
});

Deno.test("contracts#T8: ID 접두사가 유일하다", () => {
  const prefixes = Object.keys(ID_PREFIXES);
  assertEquals(new Set(prefixes).size, prefixes.length);
});

// 파일의 상대 import를 읽어 contracts/<최상위> 사이 그래프를 만든다.
function topLevelOf(path: string): string | undefined {
  return path.match(TOP_LEVEL)?.[1];
}

async function relativeImports(path: string): Promise<string[]> {
  const text = await Deno.readTextFile(path);
  const specs = text.matchAll(/from\s+"(\.[^"]+)"/g);
  const dir = path.slice(0, path.lastIndexOf("/"));
  const resolved: string[] = [];
  for (const [, spec] of specs) {
    const parts = `${dir}/${spec}`.split("/");
    const stack: string[] = [];
    for (const part of parts) {
      if (part === "." || part === "") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    resolved.push(stack.join("/"));
  }
  return resolved;
}

async function contractFiles(): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string) => {
    for await (const entry of Deno.readDir(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) await walk(path);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith("_test.ts")) {
        files.push(path);
      }
    }
  };
  await walk("packages/protocol");
  return files;
}

Deno.test("contracts#T8: contracts/<최상위> 사이 import 순환이 없다", async () => {
  const files = await contractFiles();
  const edges = new Map<string, Set<string>>();
  for (const file of files) {
    const from = topLevelOf(file);
    if (from === undefined) continue;
    for (const imported of await relativeImports(file)) {
      const to = topLevelOf(imported);
      if (to !== undefined && to !== from) {
        const set = edges.get(from) ?? new Set();
        set.add(to);
        edges.set(from, set);
      }
    }
  }

  const cycles: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (node: string) => {
    if (visiting.has(node)) {
      cycles.push([...stack.slice(stack.indexOf(node)), node].join(" -> "));
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const next of edges.get(node) ?? []) visit(next);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of edges.keys()) visit(node);
  assertEquals(cycles, []);
});
