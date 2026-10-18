# ec-fix-roots

runner가 기록을 모을 시작점(`roots`)에 t0 뒤에 시작한 role agent session을 모두 넣는다. 지금은 `say`가 연 session과 `deliver`의 받는 session뿐이라, `callApi`로 시작하는 시나리오(calendar-diagnose: problem이 App Engineer의 입력이 된다)는 일한 App Engineer session이 기록에 없다. 첫 진짜 run에서 diagnose의 `sessions`가 비어 `read-problem` 등이 기록 없이 떨어졌다.

- 단위: ec-fix-roots (wave 5)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/runner/**`
- 읽을 것:
  - `tests/eval/runner/trial.ts`(`roots`, `collectSessions` 호출), `steps.ts`(`roots`를 쌓는 곳), `idle.ts`(`readSnapshot`이 이미 `sessionSnapshotsList`를 읽는다)
  - `tests/eval/collect/read.ts`(`collectSessions(core, roots, since)`: root에서 call을 따라가고 t0 전에 시작한 turn을 버린다. coding session은 건너뛴다)
  - `project-docs/architecture/eval.md`의 "되살리기의 흔적은 기록에 섞이지 않는다", "fake lophn session은 collect의 root가 아니다"(`deliver`의 fake lophn session은 roots에 넣지 않는다. 그 fake model call이 `Metrics`와 `seenComponents`에 섞이면 안 된다)
- 계약:
  - 쓰는 것: `collectSessions`, `sessionSnapshotsList`(고정).
  - 내놓는 것: 없음(runner 안의 동작).

## 할 일

1. step이 다 끝난 뒤(collect 직전) `sessionSnapshotsList`에서 coding이 아닌 session 가운데 t0 뒤에 turn이 있는 것을 roots에 더한다. 단 `deliver`가 연 fake lophn session은 뺀다(steps.ts가 그 session id를 알면 넘긴다. 모르면 `role: "lophn"`이고 그 trial에서 진짜 model이 붙지 않은 session을 뺀다. 고른 규칙을 주석 한 줄로 남긴다).
2. 이미 있는 roots와 겹치면 한 번만 넣는다. `collectSessions`가 call을 따라가 다시 만나는 session이 두 번 세지지 않는지 본다(지금 동작을 읽고 필요하면 중복 제거).

## 끝남

- `deno task check`가 통과한다. `ANTHROPIC_API_KEY= deno run --allow-all tests/eval/run.ts --all`이 0으로 끝난다.
- 위험 test: 없음(core를 읽는 길이다. 고른 규칙이 순수 함수로 떨어지면 그것만 test 하나).

## 보고

- 바꾼 file
- 통과한 check
- 정한 것(fake lophn session을 빼는 규칙)
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
