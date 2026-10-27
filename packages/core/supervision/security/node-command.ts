import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";

// lophn 자신의 `.ts` entry는 지금 이 process를 돌리는 runtime(Electron의 Node)으로 띄운다.
// 설치본·dev·test가 같은 판을 쓰고, plain node에는 없는 Temporal을 core가 쓴다.
export type NodeCommand = {
  command: string;
  args: string[];
  // ELECTRON_RUN_AS_NODE가 없으면 Electron binary가 Node가 아니라 앱으로 뜬다.
  env: Record<string, string>;
};

// credential·token은 이 argv에 절대 넣지 않는다. hello frame이 한 번 전달한다.
export function nodeCommand(
  entry: string,
  args: readonly string[] = [],
): NodeCommand {
  return {
    command: process.execPath,
    args: [entry, ...args],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
}

// 앱과 flow는 wave 3까지 Deno로 돈다. 설치본과 dev는 LOPHN_DENO로 절대 경로를 넘기고,
// 없으면 PATH에서 찾는다.
export function denoBinary(): string {
  return process.env["LOPHN_DENO"] ?? "deno";
}

// 앱과 flow의 의존을 받는 npm. 설치본이 도는 기계에는 npm이 없을 수 있어 platform이 가진 npm을 같은
// runtime으로 돌린다.
export function npmCommand(args: readonly string[]): NodeCommand {
  // npm의 exports는 bin을 내보내지 않아 package.json 옆에서 찾는다.
  const manifest = createRequire(import.meta.url).resolve("npm/package.json");
  return nodeCommand(join(dirname(manifest), "bin", "npm-cli.js"), args);
}
