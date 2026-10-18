# ec-fix-testdefaults

`lophn app test`에서 `target.bundle_hash`와 `test`를 core가 채운다. 둘 다 그 앱의 마지막으로 끝난 release 준비에서 결정적으로 정해진다(사람의 원칙: 결정적인 것은 program이 한다). 같이 CLI의 입력 오류 글이 무엇이 빠졌고 어떤 꼴이어야 하는지 말하게 한다.

- 단위: ec-fix-testdefaults (wave 6)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/problems/tests.ts`(요청 입력 schema의 `target.bundle_hash`와 `test`)
  - `packages/core/apps/control.ts`(release 준비 handler)
  - `packages/core/main/daemon/wiring/apps.ts`
  - `packages/core/problems/tests/**`
  - `packages/coding-agent/cli/main.ts`(입력 오류 글)
  - `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`, `packages/coding-agent/guides/skills/lophn-repair/SKILL.md`(`app test` 줄만)
  - `tests/support/app/**`(요청 입력을 쓰는 줄만)
- 읽을 것:
  - 앞 task `ec-fix-apptest`의 결론(이 brief의 바탕): 마지막으로 끝난 준비는 app-supervisor 메모리(`createPreparationService`, `request_key`별)에만 있고 ledger에는 release가 확정될 때까지 없다. `test`는 봉인된 bundle file로 `deriveAppTest`가 잰다(async). `RequestTest` handler는 sync tx라, `withReleasePreparation`처럼 writer 앞에 async 단계를 둔다.
  - 추천 길(그 worker의 변경 요청): `releasePreparationHandler`가 `completed`를 돌려줄 때 앱마다 마지막 `bundle_hash`를 기억하고, writer wrapper(`withTestDefaults`)가 `RequestTest`에 빠진 `target.bundle_hash`와 `test`를 채운다(`testOf`는 apps wiring에 있다). 끝난 준비가 없으면 `invalid_input`("먼저 release prepare와 release status")이다.
  - CLI: `packages/coding-agent/cli/main.ts` 176~177줄은 `<칸>: 입력이 맞지 않다`만 찍는다. zod issue에서 빠짐("필요하다")과 기대 꼴(예: sha256 hex 64자)을 함께 찍는다.
- 계약: 요청 입력 schema(protocol)를 바꾼다. 쓰는 쪽을 같은 변경에서 고친다. 호환 길은 두지 않는다.

## 할 일

1. 위 추천 길로 `target.bundle_hash`와 `test`를 선택 칸으로 만들고 core가 채운다. agent가 값을 주면 그것을 쓴다.
2. CLI 입력 오류 글을 고친다(모든 명령에 공통).
3. skill의 `app test` 줄을 새 최소 입력에 맞춘다. 바뀌면 보고에 "다시 설치 필요"를 적는다.

## 끝남

- `deno task check:full`이 통과한다. core가 두 번 뜬다.
- 확인: `tests/e2e/app-activation_test.ts`가 통과한다(activate 길이 최소 입력으로 app test를 부르게 고친 뒤).
- 위험 test: 없음.

## 보고

- 바꾼 file
- 통과한 check
- skill 다시 설치 필요 여부
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
