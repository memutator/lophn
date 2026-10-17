// session rewind 읽기(rewind/preview·checkpoints·list)의 reader Worker 쪽 정의다(lophn-agent/revert).
// preview는 지금의 파일을 읽어 판정하므로 동기 file API가 필요하다. 이 모듈은 core가 정적으로 import하지
// 않는다(reader Worker만 부른다). 동기 file API는 reader Worker 안에서만 쓴다(core_imports_test).
// core 쪽 route 등록은 register.ts의 같은 읽기 정의다. reader Worker는 port를 그 등록의 reads에만 붙이므로
// preview는 자기 등록(createReaderRegistration)에 넣지 않는다. 고른 시점 뒤 앱 write 목록의 AppWrites port와
// 같은 등록에 두려고 앱 조립(wiring/rewind-registration.ts)이 createRewindReads().preview를 등록한다.
import { createSessionRewindReads } from "./mod.ts";
import { observeFiles } from "./prepare.ts";
import type { ReaderRegistration } from "../../../storage/ledger/mod.ts";
import type { FileStat } from "./judge.ts";

export function createRewindReads() {
  return createSessionRewindReads({
    observe(files) {
      const byRoot = new Map<string, string[]>();
      for (const file of files) {
        byRoot.set(file.root, [...byRoot.get(file.root) ?? [], file.path]);
      }
      const seen = new Map<string, FileStat>();
      for (const [root, paths] of byRoot) {
        for (const [path, stat] of observeFiles(root, paths)) {
          seen.set(path, stat);
        }
      }
      return seen;
    },
  });
}

export function createReaderRegistration(): ReaderRegistration {
  const reads = createRewindReads();
  return { reads: [reads.checkpoints, reads.list], ports: new Map() };
}
