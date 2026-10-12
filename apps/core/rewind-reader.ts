// session 되돌리기 읽기(rewind/preview·checkpoints·list)의 reader Worker 등록이다(lophn-agent/revert).
// preview는 지금의 파일을 읽어 판정하므로 동기 file API가 필요하다. 이 모듈은 core가 정적으로 import하지
// 않는다(createReaderRegistration만 reader Worker가 부른다). 동기 file API는 reader Worker 안에서만
// 쓴다(core_imports_test). core 쪽 route 등록은 lophn-agent.ts의 같은 읽기 정의다.
import {
  createRevertReads,
  latestAppRevision,
} from "../../packages/lophn-agent/revert/mod.ts";
import { observeFiles } from "../../packages/lophn-agent/revert/prepare.ts";
import type { ReaderRegistration } from "../../packages/platform/ledger/mod.ts";
import { projectRootOf } from "./rewind-root.ts";

export function createReaderRegistration(): ReaderRegistration {
  const reads = createRevertReads({
    observe: observeFiles,
    rootOf: projectRootOf,
    appRevision: latestAppRevision,
  });
  return {
    reads: [reads.preview, reads.checkpoints, reads.list],
    ports: new Map(),
  };
}
