import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { errorCode } from "../../../../base/mod.ts";
import {
  recordRewindWrite,
  stageRewindFile,
} from "../../../../protocol/lophn-agent/mod.ts";
import { readOf } from "../../run-loop/core-call.ts";
import type { CoreCall } from "../../run-loop/core-call.ts";
import type { RecorderPorts } from "./record.ts";

// agent runtime child가 file tool의 쓰기 기록을 core에 잇는 길이다. `core`는 이 turn의 agent 자격 loopback이다.
// 쓰기 직전 내용은 core가 직접 읽어 두고(StageRewindFile), 쓴 직후의 hash만 여기서 읽는다.
export function rewindOverCore(core: CoreCall): RecorderPorts {
  return {
    stage: (input) => readOf(core, stageRewindFile, input),
    async read(root, path) {
      try {
        return await readFile(join(root, path));
      } catch (error) {
        if (errorCode(error) === "ENOENT") return null;
        throw error;
      }
    },
    record: (input) => readOf(core, recordRewindWrite, input),
  };
}
