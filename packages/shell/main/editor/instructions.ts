// [Instructions]: 지침 파일의 경로를 알려 준다. 편집기는 이 경로를 일반 파일처럼 열고,
// 파일이 없으면 빈 buffer로 열려 사람의 첫 저장(base_hash null)이 만든다.
// 전역은 data root 바로 아래 LOPHN.md, Home은 `<data root>/home/LOPHN.md`, project는 그 project의 첫 등록 폴더 바로 아래
// LOPHN.md다. 폴더가 없는 project는 `<data root>/projects/<prj>/LOPHN.md`다(core가 읽는 곳과 같다). 앱은 source 폴더의
// AGENTS.md다(source가 없으면 열 파일이 없다).
import { join } from "node:path";

import type {
  InstructionsApi,
  InstructionsWorkspace,
} from "../../ipc/instructions.ts";

const INSTRUCTION_FILE_NAME = "LOPHN.md";
const APP_INSTRUCTION_FILE_NAME = "AGENTS.md";

interface InstructionsOptions {
  /** 이 shell이 core에 준 data root. */
  dataRoot: string;
  /** project의 첫 등록 폴더. 없거나 활성이 아니면 null, core를 못 읽으면 던진다. */
  firstFolder: (project: string) => Promise<string | null>;
  /** 앱의 source 폴더. 앱이 없거나 source가 없으면 null, core를 못 읽으면 던진다. */
  appSource: (app: string) => Promise<string | null>;
  /** data root 아래 project·Home 폴더를 만든다. 편집기의 첫 저장은 부모 폴더를 만들지 않는다. */
  makeDir: (path: string) => Promise<void>;
}

export interface Instructions {
  open: InstructionsApi["open"];
}

export function createInstructions(options: InstructionsOptions): Instructions {
  async function pathOf(workspace: InstructionsWorkspace): Promise<string> {
    if (workspace.layer === "global") {
      return join(options.dataRoot, INSTRUCTION_FILE_NAME);
    }
    if (workspace.layer === "home") {
      const own = join(options.dataRoot, "home");
      await options.makeDir(own);
      return join(own, INSTRUCTION_FILE_NAME);
    }
    if (workspace.layer === "app") {
      const source = await options.appSource(workspace.workspace);
      if (source === null) throw new Error("the app has no source folder");
      return join(source, APP_INSTRUCTION_FILE_NAME);
    }
    const folder = await options.firstFolder(workspace.workspace);
    if (folder !== null) return join(folder, INSTRUCTION_FILE_NAME);
    const own = join(options.dataRoot, "projects", workspace.workspace);
    await options.makeDir(own);
    return join(own, INSTRUCTION_FILE_NAME);
  }

  return {
    async open(input) {
      try {
        const path = await pathOf(input.target);
        return { ok: true, value: { path, document: null, version: null } };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },
  };
}
