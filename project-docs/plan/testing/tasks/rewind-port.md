# rewind-port

daemon에서 `rewind/preview`의 `restore_all`이 `unregistered read port`로 늘 실패하는 bug를 고친다. `appWritesPort`를 preview read와 같은 reader 등록에 붙인다.

- 단위: fix (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/wiring/rewind-registration.ts`
  - `packages/core/lophn-agent/session/rewind/reader.ts`
- 읽을 것:
  - `project-docs/issues/place-session.md`의 "daemon에서 `rewind/preview`의 `restore_all`이 늘 `internal`로 실패한다"
  - `packages/core/storage/ledger/reader-worker.ts`(등록 하나의 port를 그 등록의 reads에만 붙인다), `packages/core/storage/ledger/reads.ts`(`ReaderRegistration`)
  - `packages/core/lophn-agent/session/rewind/{reader,reads,mod}.ts`, `packages/core/main/daemon/wiring/rewind-registration.ts`, `packages/core/main/daemon/rewind-glue.ts`(`appWritesOf`)
  - `packages/core/main/daemon/assembly.ts`의 reader module 목록(읽기만. 고치지 않는다)
  - `project-docs/architecture/layers.md`(lophn-agent는 main을 import하지 않는다)
- 계약:
  - 쓰는 것: `ReaderRegistration`(`{reads, ports}`), `appWritesPort`.
  - 내놓는 것: 없음.

## 지켜야 할 것(계획 공통)

- `~/.lophn`, OS keychain, 사람의 전역 harness 설정을 건드리지 않는다. E2E data root는 `.dev-data/e2e/<run>/home`뿐이다.
- 진짜 model provider는 부르지 않는다.
- 전역 mutable 상태를 두지 않는다. sleep으로 기다리지 않는다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.
- E2E test file(`tests/e2e/*`)은 고치지 않는다. 그 test가 이 bug를 재현한다. test에 맞추려고 제품의 다른 동작을 바꾸지 않는다.

## 정한 것

- reader Worker의 규칙(port는 그 등록의 reads에만 붙는다)은 그대로 둔다. port 이름이 겹쳐 조용히 덮이는 길을 만들지 않는다.
- `appWritesOf`가 main에 있으니 preview read를 `rewind-registration.ts`의 등록으로 옮겨 port와 한 등록에 둔다. lophn-agent의 `reader.ts`는 preview read 정의를 내놓기만 하고 자기 등록에는 넣지 않는다(같은 read가 두 등록에 있으면 reader Worker가 `duplicate read registration`으로 던진다). layer 방향은 main → lophn-agent다.
- `assembly.ts`의 module 목록은 고치지 않는다. `reader.ts`의 등록이 비게 되면 그 사실을 "등록할 것"에 적는다(lead가 목록에서 뺀다).

## 할 일

1. 아래 "E2E로 확인하기"로 고치기 전 실패(`PreviewRewind: internal`)를 본다.
2. 위 "정한 것"대로 옮긴다. reader.ts 머리 주석이 옛 배치를 말하면 고친다.
3. E2E를 10번 연속 돌린다.

## E2E로 확인하기

이 bug를 재현하는 E2E는 아직 merge되지 않은 branch `e2e/e2e-rewind`에 있다. 그 file을 이 worktree에 잠시 가져와 돌리고, 끝나면 지운다(commit하지 않는다).

```sh
git show e2e/e2e-rewind:tests/e2e/rewind_test.ts > tests/e2e/rewind_test.ts
for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/rewind_test.ts || echo FAIL $i; done
rm tests/e2e/rewind_test.ts
```

- 고치기 전에 한 번 돌려 이 bug로 실패하는 것을 보고에 적는다. 고친 뒤 10번 연속 통과한다.
- 끝난 뒤 `ls .dev-data/e2e`가 비어 있고, `pgrep -af core/main/daemon/main.ts`에 이 worktree의 run이 없다(줄마다 `/proc/<pid>/environ`의 `LOPHN_HOME`으로 가린다. 읽기만 하고 pkill·killall은 쓰지 않는다).

## 끝남

- `deno task check:full`이 통과한다. core 기동 두 번이 된다(reader 등록 중복은 기동 때만 드러난다).
- `rewind_test.ts`가 10번 연속 통과한다(위 방법. commit하지 않음).
- 위험 test: 새로 쓰지 않는다(`tests/e2e/rewind_test.ts`가 이 bug의 test다).

## 보고

- 바꾼 file
- 고치기 전 E2E 실패(출력 한 줄)와 고친 뒤 10번 연속 결과
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
