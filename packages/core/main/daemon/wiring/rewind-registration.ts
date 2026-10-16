// reader Worker가 팀 등록 file로 import한다. session rewind의 PreviewRewind가 읽을 때마다 그 snapshot으로
// AppWrites(고른 시점 뒤 이 session의 앱 write)를 만든다.
import { appWritesPort } from "../../../lophn-agent/session/rewind/mod.ts";
import {
  type ReaderRegistration,
  snapshotPort,
} from "../../../storage/ledger/mod.ts";
import { appWritesOf } from "../rewind-glue.ts";

export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [],
    ports: new Map<unknown, unknown>([
      [appWritesPort, snapshotPort((snapshot) => appWritesOf(snapshot))],
    ]),
  };
}
