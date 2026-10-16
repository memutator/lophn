# platform-secrets

secret 저장을 OS keychain과 `sealed_ref` 모델에서 `<data root>/secrets.json`(0600) 파일 하나로 바꾼다. core가 이 파일을 직접 읽고 쓴다. 값을 넣는 길(secret 보호 입력 창 → `secrets/put` upload), 이름·설정 여부 조회, 삭제, 전송 부착, 알려진 값(redaction) 등록을 새 모양으로 짓는다. I/O worker의 `secret.prepare`·`secret.send`·`secret.store-refresh` pipe, 준비 증거, ledger `secrets` 표, keychain adapter를 걷는다.

- 단위: platform (wave 3)
- 선행: 계약 고정(contract-platform, contract-shell), core-wiring(wave 0의 core-wiring-split), remove-platform(wave 1의 remove-platform-install이 `secrets/export.ts`·`exchange.ts`·export·import op를, remove-platform-backup이 `io.ts`의 backup tick을 지운다)
- 소유(이 task만 고친다):
  - `packages/core/secrets/` 전체
  - `packages/core/main/daemon/wiring/secrets.ts` (core-wiring-split이 만든다. 지금 보호 입력 relay와 `secretInputHandler` upload route, `SECRET_SCHEMA_STEPS`가 놓인 file이다)
  - `packages/core/main/worker/io.ts` (I/O worker entry. secrets·settings·diagnostics pipe 배선을 이 task가 모두 정리한다. 이 file은 지금 releases-problems 소유로 적혀 있어 소유 바꾸기가 필요하다)
- 읽을 것:
  - inventory(lead가 맞추며 더함): `I2.11#10`, `I2.11#11`
  - spec: 없음. 계약 모양은 `packages/protocol/secrets/secret-file.ts`(contract-platform)가 정한다
  - inventory: `I1.11#8`, `I1.11#9`, `I2.11#6`, `I2.11#7`, `I2.11#8`
    - 같이 볼 줄(배정이 다른 단위인 것): `I3.11#1`(secret 파일 저장소. 배정은 places-sessions로 잘못 붙어 있다. 이 task가 한다), `I2.11#9`(알려진 secret 값 등록. 배정은 remove-documents. `core/secrets/store.ts` 부분은 이 task가 한다), `I1.11#3`(export·import 삭제는 remove-platform이 했는지 확인), `I1.6#8`(coding token의 keychain 보관. 배정은 remove-platform이다. 이 task는 `core/secrets/coding-credential.ts`를 아래 6번 규칙으로 다룬다)
  - 결정: `../README.md` 3장 #9(secret 파일은 core가 직접 읽고 쓴다)
  - 본보기(화면): `tools/wireframes/frames/compositions/waiting/secret-input.tsx`(보호 입력 창. 이 task는 창을 만들지 않는다)
  - 지금 코드: `packages/core/secrets/*`(`store.ts` 330줄, `attach.ts`, `model.ts`, `refresh.ts`, `reads.ts`, `commands.ts`, `input-relay.ts`, `work.ts`, `worker/pipe.ts`, `adapters/*`), `packages/core/storage/ledger/known-secrets.ts`(reader pool의 알려진 값 통로. 바꾸지 않고 쓴다), `packages/base/redaction/registry.ts`
- 계약:
  - 쓰는 것: `protocol/secrets/secret-file.ts`의 `SECRET_FILE_NAME`, `secretFileStatusSchema`, `secretStatus`, `secretPut`, `secretDelete`, `secretFileUseSchema`, `secretFileSendInputSchema`, `SecretAttachPort`, `SecretStorePort`(contract-platform). 알려진 값 통로 `KnownSecretChannel`(`core/storage/ledger/known-secrets.ts`).
  - 내놓는 것
    - `core/secrets/mod.ts`: `openSecretStore`, `createSecretFileStore`, `createSecretAttach`, `secretStatusHandler`, `secretDeleteHandler`, `secretPutHandler`. `createSecretAttach({ file, allowance, processes, destinations })`의 `destinations.allowed(name)`은 owner concern(provider·MCP·앱)이 그 secret을 보낼 수 있는 목적지를 답하는 port다(redirect로 목적지가 바뀌었는지 보려고 쓴다).
    - `wiring/secrets.ts`: `Wiring`을 내놓는다. `start`에서 파일을 열고 알려진 값을 reader pool에 올리고, `build`에서 `Built.memory`에 `secrets/status`·`secrets/delete`, `Built.uploads`에 `secrets/put` handler를 낸다. `closeIntake`에서 `store.stop()`을 부른다. `WiringContext`의 `knownSecrets` 칸(이미 있다)은 새 store의 `known`으로 채운다. 다른 module이 쓸 `SecretStorePort`와 `SecretAttachPort`는 `WiringContext`의 `secretStore`·`secretAttach` 칸으로 낸다(칸을 더하는 일은 lead).

## 할 일

1. **파일 저장소** `core/secrets/file-store.ts` (새 file) — `I3.11#1`, `I2.11#6`
   - `<data root>/secrets.json`: 이름 → 값(문자열)의 평평한 JSON 객체. 값은 UTF-8 1바이트 이상 64KiB 이하.
   - `put(name, value)`와 `delete(name)`은 파일 전체를 같은 폴더의 임시 파일에 0600으로 만들어 쓰고 fsync한 뒤 rename한다. 실패하면 임시 파일을 지우고 이전 파일이 그대로 남는다. 교체나 삭제가 끝난 뒤 새로 시작하는 사용은 이전 값을 쓰지 않는다. 지우면 사본(파일 값과 이름)이 한 번에 사라진다.
   - 시작할 때 파일의 mode가 0600보다 넓으면 0600으로 고치고(고치지 못하면 그 사실만 `unavailable` 이유로 남긴다) 값 없는 안전한 log를 남긴다. 읽거나 쓸 수 없으면 secret이 필요한 기능만 이유(경로·값 없는 고정 문장)와 함께 `unavailable`이다. 환경 변수·다른 파일 fallback은 없다.
   - fs 접근은 주입한다(test에서 쓰기 실패를 끼운다). 시각과 id는 필요 없다.
2. **알려진 값 등록** `core/secrets/store.ts` 다시 짜기 — `I2.11#9`
   - `openSecretStore({ file, channel })`: 시작할 때와 `put`·`delete` 뒤에 파일의 모든 값을 읽어 core 보호 메모리의 `createKnownSecretRegistry`와 reader pool 통로(`KnownSecretChannel.register/revoke/setReady`)에 맞춘다. 값을 읽지 못하는 동안 `ready`는 false이고 redactor가 막는다(fail-closed, 지금 규칙 그대로). 긴 값 먼저, 겹침, 65개 넘음 규칙은 `base/redaction`이 그대로 맡는다.
   - `sources`(다른 concern의 ledger `secretRefs`), `reclaim`, `sweep`, keychain backoff를 지운다. 값이 한 파일에 있으므로 고아 쓸기가 없다.
3. **조회·삭제·넣기 handler** `core/secrets/routes.ts` (새 file) — `I2.11#7`
   - `secretStatus`: 이름과 설정 여부만. 권한 밖 이름과 없는 이름이 구별되지 않는 응답은 지금 `secretsListRead`의 규칙을 그대로 옮긴다.
   - `secretDelete`: 파일에서 지우고 알려진 값을 회수한다. 없는 이름은 `not_found`가 아니라 `configured: false`다.
   - `secretPut`(upload): body를 읽어 UTF-8 문자열로 바꿔 `put`하고 byte 배열을 0으로 덮는다. header의 `bytes`와 body 길이가 다르거나 상한을 넘으면 `invalid_input`. 값은 응답·오류·log 어디에도 넣지 않는다.
4. **전송 부착** `core/secrets/attach.ts` 다시 짜기 — `I2.11#8`
   - `SecretAttachPort.send(input, transmit)`: 지금 순서를 그대로 지킨다(machine context 확인 → process 확인 → allowance(grant) 확인 → 허용 목적지 비교 → 값 읽기 → `transmit(value)`). 값 읽기만 keychain에서 파일 값으로 바뀐다. `sealed_ref`·`revision` 비교(`conflict`)는 없어지고, 목적지는 `destinations.allowed(name)`과 `use.destination`을 `sameDestination`으로 비교한다. 이름이 파일에 없으면 `unavailable`이 아니라 `not_found`다.
   - `model.ts`에는 `destinationHost`·`sameDestination`·`attachAllowed`(이름으로 줄인 것)만 남긴다. `compareMatches`·`nextRevision`·`applySet`·`applyRemove`·`toStatus`·`cleanupResult`는 지운다.
5. **OAuth 갱신** `core/secrets/refresh.ts`: `SecretStorePort.put`을 쓰는 얇은 함수로 줄인다. provider·MCP의 token 갱신은 owner concern이 `SecretStorePort.put`을 부르면 된다. `SecretRefresh`의 준비 증거 모양은 지운다.
6. **지울 것** — `I1.11#8`, `I1.11#9`
   - `adapters/keychain.ts`, `adapters/linux-secret-service.ts`, `adapters/product.ts`, `input-relay.ts`(`/v1/secrets/input` upload 중계), `work.ts`(준비 증거 store), `worker/pipe.ts`, `preparations.ts`, `refs.ts`, `commands.ts`(`SetSecret`·`RemoveSecret` command), `schema.ts`(ledger `secrets`·`secret_preparations` 표), `reads.ts`의 옛 `secretsListRead`, `secrets.cleanup` read와 `cleanupResult`(secret 삭제 완료 표시).
   - `core/main/worker/io.ts`에서 secret pipe(`createSecretPipe`, `createSecretWork`, `productKeychain(SECRET_TOOL_PATHS)`, `respondSecretPrepare`)와 settings pipe(`createSettingsPipe`, `SETTINGS_IMPORT_OP`·`SETTINGS_EXPORT_OP` 분기)를 걷는다. diagnostics pipe(`createDiagnosticIngress`) 배선은 건드리지 않는다.
   - I/O worker가 더는 secret-tool을 실행하지 않으므로 `wiring/supervision.ts`의 `platformIoSpec`에서 `allow_run: [...SECRET_TOOL_PATHS]`와 `DBUS_SESSION_BUS_ADDRESS` env 허락, `sessionBusEnv()`(platform I/O용)를 걷는 일은 platform-runtime이 이 task 뒤에 한다(그 file이 platform-runtime 소유다). 이 task는 core process가 `<data root>/secrets.json`을 읽고 쓰는 Deno 권한(`allow_read`·`allow_write`)이 이미 data root를 덮는지만 확인하고, 덮지 않으면 보고에 적는다.
   - `coding-credential.ts`(coding 연결 token을 keychain에 두는 것)는 coding 연결이 환경 변수 token으로 바뀌므로(`../README.md` #66·67) coding-agent 단위가 쓰는 곳을 걷는다. 쓰는 곳이 아직 있으면(`core/server/identity/coding-credential-assembly.ts`) 지우지 않고 보고에 적는다.
   - 규칙: 소유 밖에 쓰는 곳이 있는 옛 export는 지우지 않는다. 이미 알려진 쓰는 곳은 `core/storage/ledger/writer-assembly.ts`·`writer-worker.ts`(`SECRET_COMMANDS`, `recordSecretPreparation`), `core/server/identity/connection/secret-refs.ts`(`SecretRefSource`), `core/lophn-agent/{providers,extensions,run-loop}/*secret*`, `core/main/daemon/{core,runtime,registration}.ts`다. 그 목록을 보고에 적고, 쓰는 단위가 옮긴 뒤 cleanup이 지운다.
7. (lead가 맞추며 더함 (`I2.11#10`, `I2.11#11`)) redaction 실패 때 원문 차단 / redaction의 남는 규칙. secret 경계라 이 task가 한다

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "secret file은 0600이고, log와 오류에 값이 없다" — `core/secrets/file-store_test.ts`. 임시 data root와 가짜 fs를 쓴다.
  - put·교체·삭제 뒤 파일 mode가 0600이다(넓은 mode로 미리 만든 파일도 시작 때 0600이 된다).
  - 쓰기나 rename이 실패하면 이전 값이 그대로 남고 임시 파일이 남지 않는다.
  - 표로 돈다: 값에 표지 문자열을 넣고 성공·상한 초과·쓰기 실패·읽기 실패 경로의 반환 오류, log sink, `secretStatus` 응답, 알려진 값 registry의 외부 표면에 그 문자열이 없다.
- 남지 않음: `grep -rn "sealed_ref\|SECRET_TOOL_PATHS\|secret-tool\|KeychainAdapter" packages/core/secrets`가 0줄이다(소유 밖 쓰는 곳 때문에 남긴 export는 보고에 적고, 그 줄은 예외다).

## 보고

- 바꾼 file
- 등록할 것: `assembly.ts`의 `WIRINGS`에 secrets wiring, `wiring/context.ts`에 `secretStore`·`secretAttach` 칸, `ALL_ROUTES`에 `SECRET_FILE_ROUTES`(contract-platform의 등록할 것), renderer가 부르는 memory route(`secrets/status`, `secrets/delete`)의 allowlist(platform-desktop), 루트 `deno.json`의 `hash-wasm` 의존 지우기(lead. 쓰는 곳이 `exchange.ts` 하나였다)
- 안 쓰게 된 export: 위 규칙으로 남긴 옛 export 목록과 그것을 쓰는 file
- 정한 것: 문서에 답이 없어 정한 것(파일 이름·mode 복구 방식, 없는 이름의 delete 결과, `destinations` port 모양)
- 계약 바꾸기 요청: `SecretAttachPort`나 `secretPut`의 모양에 모자란 것이 있을 때

- (lead가 더함, agent-definition-extensions가 넘긴 것) project·agent 층 MCP 서버의 credential은 `extensions/secret-refs.ts`가 전역 setting만 읽어 `lookupMcpSecretUse`가 허용하지 않는다. 그런 서버는 secret 전송이 막히고 runtime `--allow-run`·`--allow-net` snapshot에도 안 든다. 층 합친 서버(`mergeMcpLayers`)를 읽게 맞춘다(추가 소유, lead 승인: `secret-refs.ts`).
