// 다른 컴퓨터의 App details source. 읽기는 그 컴퓨터의 core 범위(reads.ts)가 하고, 쓰기는 사람이 그 컴퓨터에서 한다:
// 쓰는 route가 기기의 목록에 없고(이름, 보관, 실행, grant 거두기, secret, rewind), OS 선택기와 보호 입력 창은 이 컴퓨터의 것이다.
import type { AppDetailSource, SourceResult } from "./source.ts";

const unavailable = <T>(): Promise<SourceResult<T>> =>
  Promise.resolve({ ok: false, code: "unavailable" });

export const readOnlyAppDetailSource: AppDetailSource = {
  readOnly: true,
  rename: unavailable,
  archive: unavailable,
  setRun: unavailable,
  setIcon: unavailable,
  addFolder: unavailable,
  removeFolder: unavailable,
  rollback: unavailable,
  revoke: unavailable,
  setSecretValue: unavailable,
  removeSecretValue: unavailable,
  setOAuthClientId: unavailable,
  setOAuthClientSecret: unavailable,
  signIn: unavailable,
  cancelSignIn: unavailable,
  signOut: unavailable,
  rewind: unavailable,
};
