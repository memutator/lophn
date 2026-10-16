// [Instructions]: 지침 파일(LOPHN.md)의 경로를 알려 준다. 편집기는 이 경로를 일반 파일처럼 열고,
// 파일이 없으면 빈 buffer로 열려 사람의 첫 저장(base_hash null)이 만든다.
// 전역은 data root 바로 아래 LOPHN.md, project는 그 project의 첫 등록 폴더 바로 아래 LOPHN.md다.
// 앱 층은 없다.
import { join } from "node:path";

import type {
  InstructionsApi,
  InstructionsPlace,
} from "../../ipc/instructions.ts";

export const INSTRUCTION_FILE_NAME = "LOPHN.md";

export interface InstructionsOptions {
  /** 이 shell이 core에 준 data root. */
  dataRoot: string;
  /** project의 첫 등록 폴더. 없거나 활성이 아니면 null, core를 못 읽으면 던진다. */
  firstFolder: (project: string) => Promise<string | null>;
}

export interface Instructions {
  open: InstructionsApi["open"];
}

export function createInstructions(options: InstructionsOptions): Instructions {
  async function pathOf(place: InstructionsPlace): Promise<string | null> {
    if (place.layer === "global") {
      return join(options.dataRoot, INSTRUCTION_FILE_NAME);
    }
    if (place.layer === "project") {
      const folder = await options.firstFolder(place.place);
      return folder === null ? null : join(folder, INSTRUCTION_FILE_NAME);
    }
    return null;
  }

  return {
    async open(input) {
      try {
        const path = await pathOf(input.target);
        if (path === null) return { ok: false, code: "not_found" };
        return { ok: true, value: { path, document: null, version: null } };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },
  };
}
