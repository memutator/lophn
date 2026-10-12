// reader Worker가 알려진 secret 값을 아는 방법(platform/redaction#R1, platform/secrets#R1).
// 값은 요청 message가 아니라 core가 pool로 보내는 별도 등록·회수 통로로만 들어오고, 각 reader
// Worker의 보호 메모리 registry에 있다. read handler는 일치 검사만 하는 얼굴(matcher)을
// `snapshot.port(KNOWN_SECRETS)`로 받는다: 값 목록도 개수도 내보내지 않고, 팀 module의 전역
// 상태에 값이 남지 않는다.

import type { Result } from "../../../base/mod.ts";
import { definePort, type PortKey } from "../../../protocol/base/mod.ts";

export type KnownSecretMatch = {
  match(text: string): { index: number; length: number } | undefined;
  // core가 현재 참조의 값을 모두 넣었다고 알린 뒤에만 true다. 처음과 값을 다 읽지 못하는
  // 동안은 false라서, 알려진 값을 모른 채 원문을 내보내려는 redactor가 스스로 막는다.
  readonly ready: boolean;
};

export const KNOWN_SECRETS: PortKey<KnownSecretMatch> = definePort<
  KnownSecretMatch
>("known-secrets");

// core가 reader pool에 알려진 값을 넣고 빼는 통로. 모든 healthy reader가 반영을 확인한 뒤에야
// 이어서 시작하는 read가 새 값을 안다. 값은 JSON·log·오류에 가지 않는다.
export type KnownSecretChannel = {
  register(values: readonly string[]): Promise<Result<void>>;
  revoke(values: readonly string[]): Promise<Result<void>>;
  // 알려진 값이 현재 참조와 같은지. reader는 처음에 false다(fail-closed).
  setReady(ready: boolean): Promise<Result<void>>;
};
