// session 저장소(lophn-agent/revert "저장"). pre-image와 redo용 복원 직전 내용을 platform/blob-store가
// 아니라 data root 아래 session 단위 디렉터리(`<dataRoot>/rewind/<session>/`)에 sha256으로 주소를
// 매겨 둔다. 같은 내용은 하나다. 쓰기는 임시 파일 → hash 확인 → 원자 설치다.
// 구현은 agent-RW3a가 채운다.

export type StoredBlob = {
  // 내용의 sha256(hex). 파일 이름이자 FileState.blob의 key다.
  key: string;
  size: number;
  // 이번 호출이 새로 설치했으면 true, 이미 같은 내용이 있었으면 false.
  created: boolean;
};

export type RewindStore = {
  put(session: string, content: Uint8Array): Promise<StoredBlob>;
  // 없거나 내용 hash가 key와 다르면 던진다.
  read(session: string, key: string): Promise<Uint8Array>;
  has(session: string, key: string): Promise<boolean>;
  // session 안 서로 다른 저장물의 크기 합(byte). 임시 파일은 세지 않는다.
  totalBytes(session: string): Promise<number>;
  // live에 없는 저장물(고아)과 남은 임시 파일을 지운다. 지운 저장물의 key를 돌려준다.
  sweep(session: string, live: ReadonlySet<string>): Promise<string[]>;
  // session 디렉터리 전체를 지운다. 없어도 성공이다.
  removeSession(session: string): Promise<void>;
};

export function createRewindStore(dataRoot: string): RewindStore {
  void dataRoot;
  throw new Error("not implemented: agent-RW3a");
}
