# hr-token-file

core가 parent pipe의 hello frame에 준 user token을 data root의 run 폴더에 file(0600)로도 써서 CLI가 읽게 한다. `location.json`에는 지금처럼 credential을 두지 않는다.

- 단위: token (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/client/run-metadata.ts`
  - `packages/core/install-and-update/run-metadata.ts`
  - `packages/core/install-and-update/run-metadata_test.ts`
  - `packages/core/main/daemon/parent.ts`
  - `packages/core/main/daemon/core.ts`
- 읽을 것:
  - 계획: `project-docs/plan/headless-run/README.md`의 "정한 것"(CLI 자격: core가 user token을 data root의 file(0600)에 쓰고 CLI가 읽는다. 같은 OS 사용자의 위험은 신경 쓰지 않는다)
  - 제품 결정: `project-docs/products/roadmap/headless-schedule.md`의 "권한"
  - architecture: `project-docs/architecture/layers.md`의 "두지 않는 규칙"(다른 module을 `mod.ts`로만 import하지 않아도 된다), `project-docs/architecture/coding-agent.md`의 "token 원문은 저장하지 않는다"(coding token 규칙이다. 이 task는 그 규칙을 바꾸지 않는다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `child-supervision-protocol`(hello frame), `project-docs/module-catalog.yaml`의 `packages/core/install-and-update`(boundary `core`: data root 해석, 실행 metadata, instance lock)와 `packages/core/main`
  - 코드:
    - `packages/core/main/daemon/parent.ts`의 `greet`(user token 발급 → `runtime.record` → hello frame)
    - `packages/core/main/daemon/core.ts`의 `startCore`(instance lock), `open`의 `shutdown`(metadata 지우기와 lock 풀기), `writeRunMetadata` 호출, `greet` 호출
    - `packages/core/install-and-update/run-metadata.ts`(`writeRunMetadata`, `removeRunMetadata`), `packages/core/install-and-update/data-root.ts`(`run` 폴더는 0700이고 소유자를 확인한다)
    - `packages/core/server/identity/registry.ts`의 `CredentialRegistry`(자격은 메모리에만 있고 user token은 core마다 하나다. 그래서 켤 때 옛 token은 이미 무효다)
    - `packages/base/install/linux-install.ts`의 `cliLauncher`(설치된 `lophn`은 `LOPHN_HOME`을 `${LOPHN_HOME:-$HOME/.lophn}`로 export하고 `$H/run` 읽기를 연다. 이 task는 launcher를 고치지 않는다)
- 계약:
  - 쓰는 것: `greet`의 user token 발급(`packages/core/main/daemon/parent.ts`), data root의 run 폴더(`root.run`, `writeRunMetadata`·`removeRunMetadata`가 쓰는 곳)
  - 내놓는 것(hr-cli-commands가 읽는다):
    - 이름 `USER_TOKEN_FILE_NAME = "user-token"`. `packages/protocol/client/run-metadata.ts`의 `RUN_METADATA_NAME` 옆에 둔다.
    - 경로 `<data root>/run/user-token`. 내용은 token 원문뿐이다(JSON 아님, 끝 newline 없음).
    - mode 0600. 임시 file에 쓰고 rename한다. hello frame의 token과 같은 token이고, 부모 pipe 없이 뜬 core는 쓰지 않는다.
    - 정상 종료 때 `location.json`과 함께 지우고, 켤 때 남은 것도 지운다(옛 token은 이미 무효다). 그래서 file이 없으면 lophn이 꺼져 있다.

## 할 일

brief는 main `e192a9d8c` 기준이다. 앞 계획(`problem-remove`, `approval-simplify`)은 이 다섯 file을 소유하지 않는다. 고칠 곳은 이름으로 찾는다.

1. `packages/protocol/client/run-metadata.ts`
   - `RUN_METADATA_NAME` 옆에 `export const USER_TOKEN_FILE_NAME = "user-token";`을 더한다. 주석에 "왜"를 한 줄 쓴다: run 폴더에서 credential이 든 file은 이것 하나이고, `location.json`과 따로 둔다.
   - `client/mod.ts`가 `export *`로 내므로 등록할 것은 없다.
   - file 끝의 주석 세 줄("H/run의 위치 metadata를 읽는다…")은 가리키는 함수가 없다. 지운다(AGENTS.md "죽은 코드는 지운다").
2. `packages/core/install-and-update/run-metadata.ts`
   - `writeUserToken(runDir: string, token: string): Promise<Result<void>>`를 더한다.
     - `writeRunMetadata`와 같은 꼴이다: `${runDir}/${USER_TOKEN_FILE_NAME}.tmp`에 `Deno.writeTextFile(…, token, { mode: 0o600 })`로 쓰고 `Deno.rename`으로 옮긴다.
     - 내용은 token 원문뿐이다. JSON도 끝 newline도 없다.
     - 실패는 `unavailable`이다. 오류 message와 details에 token을 넣지 않는다.
   - `removeUserToken(runDir: string): Promise<void>`를 더한다. `removeRunMetadata`와 같이 `NotFound`만 삼킨다.
   - file 머리 주석("run 폴더의 인증 없는 위치 metadata. … credential은 없다")을 맞춘다: 위치 metadata에는 credential이 없고, user token은 따로 0600 file에 둔다.
   - `writeRunMetadata`는 고치지 않는다. token을 받지 않고 `runMetadataSchema`(strict)가 칸을 막는다.
3. `packages/core/main/daemon/parent.ts`의 `greet`
   - 인자 `saveToken: (token: string) => Promise<Result<void>>`를 `issue` 바로 뒤에 더한다(`events`가 기본값이 있는 마지막 인자라 그 앞에 둔다).
   - `runtime.record(current.value)`가 성공한 뒤, hello frame을 만들기 전에 `saveToken(issued.value.token)`을 부른다. 실패하면 그 오류를 돌려준다.
   - 함수 위 주석("user token은 여기서 한 번만 준다…")에 "hello frame과 run 폴더의 file에 같은 token을 준다"를 더한다.
4. `packages/core/main/daemon/core.ts`
   - `removeUserToken`, `writeUserToken`을 `../../install-and-update/run-metadata.ts`에서 바로 import한다. `packages/core/install-and-update/mod.ts`는 이 task의 소유가 아니라 고치지 않는다(`layers.md`가 `mod.ts`로만 import하는 규칙을 두지 않는다).
   - `startCore`: `acquireInstanceLock`이 성공한 바로 뒤에 `await removeUserToken(root.value.run)`을 부른다. 주석으로 이유를 쓴다: 앞 core의 token은 이미 무효이고, 남은 file이 있으면 CLI가 lophn이 켜져 있다고 본다.
   - `startCore`의 기동 실패 길(`removeRunMetadata(root.value.run)` 옆)에서도 `removeUserToken`을 부른다.
   - `open`의 `shutdown`: `finally`에서 `removeRunMetadata(root.run)`과 함께 `removeUserToken(root.run)`을 부른다. 한쪽이 던져도 다른 쪽 지우기와 `lock.release()`는 돈다(지금의 `try`/`finally` 사슬에 한 단 더한다). 위의 종료 순서 주석의 "run metadata 지우기"에 user token file을 더한다.
   - `greet(…)` 호출에 `(token) => writeUserToken(root.run, token)`을 넘긴다. `greet`이 실패하면 지금처럼 `core.shutdown()`이 file을 지운다.
5. `packages/core/install-and-update/run-metadata_test.ts`(새 file): 위험 test 하나(아래 "끝남").

정한 것:
- **file을 못 쓰면 기동을 멈춘다.** `writeRunMetadata`가 실패하면 기동을 멈추는 것과 같다. hello frame을 쓰기 전이라 `main.ts`가 부모에게 `start_failed`를 보내는 지금 길을 탄다.
- **켤 때 지우기는 instance lock을 잡은 뒤다.** lock 전에 지우면, lock을 못 잡고 끝날 두 번째 core가 이미 도는 core의 file을 지운다.
- **비정상 종료는 file을 남긴다.** `location.json`과 같다. 그때 CLI는 file을 읽고 core에 닿지 못해 `unavailable`(transport 실패)로 끝나고, 다음 기동이 file을 지운다.
- **user token의 조건 `process: "electron-main"`은 그대로 둔다.** 계약이 "hello frame의 token과 같은 token"이다. target에 `process`를 싣는 route가 없어 CLI가 써도 판정에 걸리지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "user token file은 token 원문만 담고 소유자만 읽고 쓴다(0600)"(`packages/core/install-and-update/run-metadata_test.ts`)
  - 임시 폴더(`Deno.makeTempDir`)를 run 폴더로 쓴다. 먼저 `user-token`을 mode 0644로 만들어 둔 뒤 `writeUserToken`을 부르고, `Deno.stat`의 `mode & 0o777`이 `0o600`이고 내용이 token과 byte로 같은지 본다. 남은 file의 넓은 mode가 이어지지 않는지가 현실적인 회귀다.
  - `location.json`에 token이 없다는 것은 test하지 않는다. `writeRunMetadata`는 token을 받지 않고 `runMetadataSchema`가 strict다(`write-test`: schema가 보장하는 것은 test하지 않는다).
  - 임시 폴더는 `finally`에서 지운다.
- core 기동: `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다. boot.sh는 core를 pipe로 띄우므로 `greet`이 file을 쓰고, stdin이 닫히면 종료가 지운다.
- 남지 않음·겹치지 않음:
  - `grep -rn '"user-token"' packages tools`가 `packages/protocol/client/run-metadata.ts` 한 줄이다(다른 곳은 `USER_TOKEN_FILE_NAME`을 쓴다).
  - `grep -rn "TODO\|FIXME" packages/core/install-and-update packages/core/main/daemon/parent.ts packages/core/main/daemon/core.ts packages/protocol/client/run-metadata.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check(`deno task check:full`, 위험 test 이름, boot.sh 출력)
- 등록할 것: 없을 것이다(`USER_TOKEN_FILE_NAME`은 `packages/protocol/client/mod.ts`의 `export *`로 나간다). 있으면 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약(이름, 경로, 내용, mode, 지우는 때)을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
