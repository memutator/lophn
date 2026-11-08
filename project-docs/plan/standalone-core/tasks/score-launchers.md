# score-launchers

남은 launcher와 test support를 standalone core에 붙인다. 정상 종료는 control stop, crash는 자기 pid의 SIGKILL이며 test의 data root 격리는 그대로다.

- 단위: launchers (wave 5)
- 선행: score-cli
- 소유(이 task만 고친다):
  - `tests/support/core/`
  - `tests/e2e/boot_test.ts`
  - `tests/eval/experiment/variant/`
  - `tools/dev.ts`
  - `tools/ci/boot-core.ts`
  - `tools/verify-linux-install.ts`
  - `tools/doctor/`
- 읽을 것:
  - `project-docs/plan/standalone-core/README.md`, `project-docs/products/roadmap/standalone-core.md`
  - architecture: `project-docs/architecture/{testing,platform,run,job}.md`
  - boundary: `project-docs/boundary-catalog.yaml`의 `core`, `supervision`, `server`, `storage`; module: `project-docs/module-catalog.yaml`의 `tools`, `packages/core/install-and-update`
  - `tests/support/core/{process,mod,try-boot}.ts`, `tests/e2e/boot_test.ts`
  - `tools/dev.ts:151-212`, `tools/ci/boot-core.ts:28-57`, `tools/verify-linux-install.ts:165-188`, `tools/doctor/checks.ts:88-103,169-203,802-850`
  - `tests/eval/experiment/variant/mod.ts:29-40`, `packages/shell/main/desktop/paths.ts`, score-control의 실제 공용 client export
- 계약:
  - 쓰는 것: stdout JSON 첫 줄의 `ready`/`start_failed`, 일반 identify·connect·stop. test helper는 shell capability가 아니라 CLI와 같은 user credential을 쓴다.
  - 내놓는 것: `spawnCore` 결과는 자기 core pid·시작 실패 reason·exited·정상 stop·signal이다. `hello`·`closeStdin`은 없앤다. `Core.stop()`은 control stop과 exit·child 소멸을 기다리고 `Core.kill()`은 자기 core pid에 SIGKILL한 뒤 같은 확인을 한다.
  - 내놓는 것: `bootCore`는 **항상 새 core 시작을 시도**한다. ensure로 이미 도는 core에 합류시키지 않는다. 둘째 instance 거절 검증과 `tryBootCore`의 시작 실패 결과가 필요해서다. `repo`, `env`, `keep`의 뜻은 유지한다.

## 할 일

1. `process.ts:133-265`에서 FrameDecoder·MainHello 대신 startup 첫 줄을 읽고 ready 뒤 control identify·connect로 API 주소·token을 얻는다. detached spawn 뒤 parent stdin은 유지하지 않는다. stderr는 자기 log file에 이어 core가 launcher의 읽기 pipe에 묶이지 않게 한다. ready를 읽는 pipe는 첫 줄 뒤 놓으며 로그 실패·timeout에도 자기 child를 회수한다.
2. `process.ts:100-123`의 FIXED_ENV와 비운 HOME/USERPROFILE, DBUS·keychain 격리를 유지한다. caller가 LOPHN_HOME·HOME·PATH·USERPROFILE을 덮지 못하게 한다. `mod.ts`의 `end`는 stop 완료 뒤 `waitGone(home, keep)`를 확인한다. detached core도 pid는 test가 직접 spawn해 알고 있으므로 pid file·이름 grep은 필요 없다.
3. `windowsCores`의 시작 pid와 ParentProcessId tree 추적, POSIX의 정확한 LOPHN_HOME 추적은 남긴다. `keep`에 든 기존 core·child는 죽이지 않는다. 단순히 parent가 없어졌다는 이유로 남은 child 확인을 생략하지 않는다. macOS에 `/proc`이 없는 것은 기존 helper의 한계다. 이를 이번 변경에서 모든 OS 검증 완료로 보고하지 않는다.
4. `tests/e2e/boot_test.ts`에서 hello·location metadata를 contract로 지키는 낡은 행은 지운다. data root 격리, 둘째 core가 첫째 data를 건드리지 않음, 열린 model 요청을 정상 종료가 끊음, SIGKILL 뒤 child 정리, 손상 ledger 원본 보존의 독립된 위험 검사는 지우지 않는다. 새 설계의 process/socket E2E를 다시 쓰는 것은 아래 사람 확인 전에는 하지 않는다. helper 변경만으로 계속 유효한 기존 행과 새로 만드는 행을 보고에서 구분한다.
5. `tools/dev.ts`의 fake provider 심기는 여전히 제품 `providers/connect`와 test용 data root를 쓰되 hello token에 기대지 않는다. core-only 개발 실행에도 CLI가 identify·connect로 붙는다. `npm run dev`를 다시 켤 때 이전 실행의 standalone core가 `.dev-data` ledger를 열고 있으면 먼저 해당 control로 종료·lock 해제를 확인한 뒤 data root를 지운다. live core가 잡은 data를 `removeDataRoot`로 먼저 지우지 않는다. fake server 종료와 해당 dev core 종료의 순서를 맞추고 사람의 `~/.lophn`은 쓰지 않는다.
6. `tools/ci/boot-core.ts`는 같은 새 data root를 두 번 직접 시작해 ready→control stop→exit 0을 본다. stdout 첫 data event가 왔다고 stdin을 닫는 구현은 지운다. 시작 실패와 timeout을 구별하며 timeout 정리는 이 도구가 띄운 pid만 대상으로 한다.
7. `tools/verify-linux-install.ts`는 shell supervisor의 spawnCore import를 끊고 공용 client와 설치본 경로로 직접 시작·connect·stop한다. 빈 PATH·다운로드 없음·동일 ledger-id 재시작 확인은 유지한다. 첫째 core가 끝났는지 확인한 뒤 둘째를 시작한다.
8. doctor의 `readLocation`·metadata/unauthorized 추정은 identify로 바꾼다. doctor는 진단할 뿐 ensure로 core를 띄우거나 판 교체하지 않는다. 자격을 얻는 read 검증이 필요하면 일반 connect로 얻고 출력에는 내지 않는다. doctor의 ctx adapter·가짜 IO는 같은 변경에서 맞춘다.
9. eval variant는 이미 `bootCore(run, {...options, repo})`를 쓴다. repo가 variant core entry와 제품 판·control protocol을 고르게 유지한다. 이전 checkout에 parent pipe로 fallback하는 호환 경로는 만들지 않는다. protocol이 맞지 않으면 기존 explainBreak처럼 원인을 드러낸다. 실제 model eval은 돌리지 않는다.

## 끝남

- `npm run check`가 통과한다. support를 쓰는 test/eval의 type check가 모두 맞는다.
- 위험 test: 이번 task는 기존 data root 격리·instance lock·손상 원본·child 정리 검사를 보존하고, test 실행을 위해 새 권한·secret 우회 flag를 넣지 않는다. source를 글로 읽는 test는 쓰지 않는다.
- 사람에게 물을 것: 낡은 boot 행을 대신할 새 control socket/subprocess E2E, launcher 종료 뒤 core 생존과 detached child 소멸을 보는 새 test, 새 server·Worker를 띄우는 test 전부. 허락 전에는 새 case를 만들지 않고 기존 유효 행과 순수 IO adapter check만 유지한다.
- 남지 않음: 이 task 소유에서 `MainHello`, `coreToMainMessageSchema`, `closeStdin`, `run/user-token`·`run/location.json` 읽기, shell supervisor import.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 보고 꼴을 따른다. 지운 낡은 행과 남긴 위험 검사, 사람에게 승인이 필요한 새 E2E, OS별 실제 확인 범위, cleanup이 지울 마지막 소비자를 적는다.
