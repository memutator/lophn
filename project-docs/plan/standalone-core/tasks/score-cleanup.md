# score-cleanup

옛 소비자가 모두 옮겨진 뒤 parent pipe와 runtime metadata 계약을 지운다. core↔child 감독 protocol은 그대로 남긴다.

- 단위: cleanup (wave 6)
- 선행: score-launchers
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/{main,core,parent,runtime,control}.ts`
  - `packages/core/install-and-update/run-metadata.ts`
  - `packages/core/install-and-update/run-metadata_test.ts`
  - `packages/protocol/client/`
  - `packages/protocol/supervision/supervision.ts`
  - `packages/shell/main/desktop/core/supervise.ts`
- 읽을 것:
  - `project-docs/plan/standalone-core/README.md`, 모든 앞 task의 보고와 남은 export
  - architecture: `project-docs/architecture/{job,coding-agent,platform,event,run,testing,approval}.md`
  - boundary: `project-docs/boundary-catalog.yaml`의 `child-supervision-protocol`, `coding-agent-cli-interface`, `core-api`; module: `project-docs/module-catalog.yaml`의 `packages/core/main`, `packages/core/install-and-update`, `packages/protocol`
  - `packages/core/main/daemon/core.ts:252-311,397-407,440-491`, `packages/core/main/daemon/parent.ts`
  - `packages/protocol/supervision/supervision.ts:409-476`, `packages/protocol/client/run-metadata.ts`
  - `packages/core/install-and-update/{instance-lock,run-metadata,data-root}.ts`
- 계약:
  - 쓰는 것: 앞 task의 control·ensure·idle, 옮겨진 모든 소비자. protocol을 지우기 전에 직접 import와 문자열 소비자를 모두 찾는다.
  - 내놓는 것: core는 stdin EOF나 shell exit로 끝나지 않는다. 정상 stop·idle·signal은 같은 shutdown barrier를 쓰고 `done`은 실제 종료 완료를 뜻한다. stdout에는 시작 결과 한 줄만 있고 token이 없다.
  - 내놓는 것: main↔core의 hello/stop/diagnostic/confirmation pipe union만 사라진다. agent runtime·앱·worker의 `parentMessageSchema`, `childMessageSchema`, frame·stop·ready·diagnostic은 계속 쓴다.

## 할 일

1. packages·tools·tests에서 `ParentPipe`, `watchParent`, `writeParent`, `greet`, `MainHello`, `mainToCoreMessageSchema`, `coreToMainMessageSchema`, `runMetadataSchema`, `USER_TOKEN_FILE_NAME`, `RUN_METADATA_NAME`, `writeRunMetadata`, `writeUserToken`, `closeStdin`을 찾는다. 앞 task 소유에 소비자가 남았으면 그 task로 돌려 먼저 고치고 정의를 지운다. 이름이 같은 다른 메커니즘까지 전역 replace하지 않는다.
2. `parent.ts`의 user credential 발급과 안전 진단은 이미 control로 옮겨져 있어야 한다. `shellViewLog`와 shell-main crash의 component/location 재지정이 남았는지 확인한 뒤 `parent.ts`를 삭제한다. parent용 frame writer와 stdin/stdout 변환 import를 main/core에서 지운다. stdout `start_failed`의 안전 reason은 새 startup 계약으로 유지한다.
3. `core.ts`에서 parent option·greet·watchParent와 metadata writer를 지우고, `main.ts`는 stdin이 TTY인지로 수명을 정하지 않는다. 초기 작업용 standalone/legacy wiring·표식과 이를 쓰던 client spawn 인자도 전부 지운다. 옛 판과 새 판을 고르는 fallback은 남기지 않는다.
4. 정상 종료와 기동 실패의 control listener·socket 정리, runtime close, lock release를 확인한다. `done`은 shutdown 완료와 연결하고 중복 signal·stop은 같은 barrier를 기다린다. core 자식의 EOF·감독 종료는 건드리지 않는다. shell 단절은 해당 shell handle·relay를 정리할 뿐 core shutdown을 부르지 않는다.
5. `run-metadata.ts`와 그 token file mode test를 지운다. 이 file test를 새 경로 test로 다시 쓰지 않는다. credential 경계는 score-control이 지킨다. `run/`은 runtime이라 data migration이 필요 없고, 기존 ledger step SQL·dataSteps는 고치지 않는다. 이전 실행의 token/location 잔여 file은 lock을 잡은 뒤에만 한정해서 제거한다. 이 제거 외에 옛 이름을 읽거나 old token을 복원하는 길은 없다. `instance.lock`은 지우지 않는다.
6. protocol supervision에서 main 전용 hello와 두 union·type, metadata schema만 지운다. `ready`, `stop`, worker request·response·diagnostic schema와 `START_FAILURE_REASONS`는 다른 소비자가 쓰면 남긴다. confirmation schema는 base에 계속 있고 control이 쓴다. 안 쓰는 export·import와 shell supervisor의 옛 spawnCore export도 마지막으로 지운다.
7. lead에게 `packages/protocol/client/mod.ts`, `packages/protocol/supervision/mod.ts`, `packages/core/install-and-update/mod.ts` 등의 등록 줄 제거를 넘긴다. architecture·catalog·roadmap 갱신은 README의 lead 목록과 대조하되 이 task에서 project-docs를 고치지 않는다.

## 끝남

- `npm run check`가 통과하고 lead가 최종 `check:full`·renderer build·core boot를 확인한다.
- 위험 test: score-control의 credential 경계, score-idle의 일 있는 동안 종료 금지, 기존 instance lock·data root·child 정리 검사가 남아 통과한다. cleanup 자체의 "옛 이름 없음" source-text test는 만들지 않는다.
- 사람에게 물을 것: stdin을 닫아도 core가 남고 control stop으로만 정상 종료되는 새 subprocess test/E2E, Linux·macOS·Windows의 실제 detached 생존·socket 권한 확인. 허락 전에는 새 test를 추가하지 않는다.
- 남지 않음: `rg 'ParentPipe|watchParent|writeParent|MainHello|mainToCoreMessageSchema|coreToMainMessageSchema|runMetadataSchema|USER_TOKEN_FILE_NAME|RUN_METADATA_NAME|writeRunMetadata|writeUserToken|closeStdin' packages tools tests`가 0줄이다.
- 남지 않음: user-token/location 파일의 읽기·쓰기·판정, `--tray`, hello의 `user_token` stdout, shell 종료→core 종료, 임시 legacy 전환. 잔여 runtime file을 지우는 두 literal은 예외로 보고에 위치를 적는다. API connect 결과의 `user_token`과 core↔child의 hello/frame은 삭제 대상이 아니다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 보고 꼴을 따른다. 최종 grep 결과, 남겨야 하는 child protocol, 한정된 runtime 잔여 file 제거 위치, lead 문서 목록과 실제로 못 확인한 OS를 적는다.
