import process from "node:process";
import {
  nodeShimFolder,
  platformNpmCliPath,
  withNodeShims,
} from "./node-shims.ts";

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

// 앱과 flow의 의존을 받는 npm. 설치본이 도는 기계에는 npm이 없을 수 있어 platform이 가진 npm을 같은
// runtime으로 돌린다.
// npm은 package lifecycle script에서 PATH의 `node`를 부른다. shim 폴더를 PATH 맨 앞에 두지 않으면
// script가 사용자 PATH의 node(없거나 Temporal이 없는 plain node)를 부른다. dataRoot를 주지 않으면
// 이 process의 LOPHN_HOME 아래 shim을 쓰고, 그것도 없으면 받은 PATH를 그대로 넘긴다.
export function npmCommand(
  args: readonly string[],
  dataRoot: string | undefined = process.env["LOPHN_HOME"],
): NodeCommand {
  const launch = nodeCommand(platformNpmCliPath(), args);
  const path = process.env["PATH"];
  if (dataRoot !== undefined && dataRoot !== "") {
    return {
      ...launch,
      env: {
        ...launch.env,
        PATH: withNodeShims(nodeShimFolder(dataRoot), path),
      },
    };
  }
  return path === undefined
    ? launch
    : { ...launch, env: { ...launch.env, PATH: path } };
}
