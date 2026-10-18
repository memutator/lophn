# fb-eval-dirty

eval의 `captureSource`가 check와 core 기동이 늘 고쳐 두는 `packages/shell/main/desktop/core/deno.lock`까지 보고 모든 run을 `dirty: true`로 남긴다. 그 file을 빼고 본다.

- 단위: fb-eval-dirty (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/versions/source.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/eval.md`의 "run 요약이 늘 dirty로 남는다"
  - architecture: `project-docs/architecture/eval.md`(버전, run 요약)
- 계약:
  - 쓰는 것: `captureSource(deps)`, `SourceInfo`
  - 내놓는 것: 바뀌는 계약 없음

## 할 일

1. `source.ts`의 `git status`와 `git diff`에 넘기는 경로 목록 끝에 `:(exclude)packages/shell/main/desktop/core/deno.lock`을 더한다. 왜 빼는지 한 줄 주석을 단다(commit하지 않는 file이고 check와 core 기동이 고친다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(git 경로 지정 한 줄이다).
- 손 확인: `deno task check`를 한 번 돌린 checkout에서 `captureSource()`가 `dirty: false`를 돌려주는지 본다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 정한 것: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
