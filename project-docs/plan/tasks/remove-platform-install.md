# remove-platform-install

install-and-update에서 update 안내 계산(update package metadata, sandbox 파일 검사, lock 비교)과 설치 계약의 update·설치 type을 지우고, secret 머신 이전 export·import(암호 파일)를 지운다. 단일 instance lock, data root 검사, run metadata는 남긴다. coding token을 keychain으로 넘기던 credential channel·helper 세 file도 남긴다(coding-agent 단위가 환경 변수 token으로 바꿀 때 지운다).

- 단위: remove-platform (wave 1)
- 선행: remove-platform-backup, core-wiring
- 소유(이 task만 고친다):
  - `packages/core/install-and-update/`
  - `packages/protocol/install-and-update/`
  - `packages/core/secrets/export.ts`
  - `packages/core/secrets/exchange.ts`
- 추가 소유(lead 승인, 2026-10-16. 소유와 같이 고친다. 지운 것을 가리키는 줄만 고친다. core·shell 조립이 wiring file로 쪼개졌으면 그 줄이 옮겨 간 wiring file이 대신한다. "등록 file(lead)"도 지운 것을 가리키는 줄만 뺀다. 모두 지운 file을 쓰던 곳이다):
  - secrets: `packages/core/secrets/mod.ts`, `packages/core/secrets/worker/pipe.ts`(`SECRET_EXPORT_OP`·`SECRET_IMPORT_OP` 처리), `packages/protocol/secrets/exchange.ts`, `packages/protocol/secrets/mod.ts`
  - worker·조립: `packages/core/main/worker/io.ts`(export·import 분기), `packages/core/main/daemon/{core.ts, main.ts}`(`updateNotice`, `UpdateNotice` import. core-wiring이 쪼갠 뒤라면 `packages/core/main/daemon/wiring/` 아래 해당 file)
  - protocol: `packages/protocol/client/daemon.ts`(`InstanceState` import 경로)
  - 도구: `tools/package-linux.ts`(`checkStagedLock`), `tools/verify-linux-install.ts`(sandbox 검사와 format runner wasm 검사)
- 읽을 것:
  - spec: 없음. 삭제 목록 — `/home/pyosechang/projects/lophn/project-docs/tmp/notes/removed.md` 1장("Secrets export·import"), 2장(install-and-update 보류)
  - inventory: `I1.11#3`, `I1.11#13` (`../assignment.md`에서 이 task가 맡은 줄 전부)
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `code-map.md`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 줄어든 `protocol/install-and-update`: `INSTANCE_STATES`, `instanceStateSchema`, `InstanceState`만 남는다(`protocol/client/daemon.ts`가 쓴다)

## 할 일

1. `core/install-and-update/`에서 지운다. (I1.11#13)
   - `update.ts`(`readUpdatePackage`, `updateNotice`, `UpdateNotice`, `UpdatePackage`), `sandbox-check.ts`(`checkSandboxFile`, `checkRunningSandbox`, `linuxProcReader`), `lock-check.ts`(`checkStagedLock`)
   - `mod.ts`에서 그 export를 뺀다. 남는 것: `resolveDataRoot`·`DataRoot`, `acquireInstanceLock`·`INSTANCE_LOCK_NAME`·`InstanceLock`(base에서 다시 내보낸 것), `writeRunMetadata`·`removeRunMetadata`, credential channel·helper 세 file의 export, `base/install/linux-install.ts`에서 다시 내보낸 것
   - `credential-channel.ts`, `credential-helper.ts`, `credential-helper-main.ts`는 지우지 않는다. 이 keychain 전달 계통은 coding-agent가 환경 변수 token으로 바꿀 때 지운다(다른 단위 몫).
2. `protocol/install-and-update/install.ts`를 `INSTANCE_STATES`·`instanceStateSchema`·`InstanceState`만 남기고 줄인다. 설치 방법·release·schema 호환·정상 종료 단계·`updateNoticeSchema` 등은 쓰는 곳이 없다(grep으로 확인한 뒤 지운다). (I1.11#13)
3. secret 머신 이전을 지운다. (I1.11#3)
   - `core/secrets/export.ts`(`createSecretTransfer`), `exchange.ts`(`sealExchange`, `openExchange`, argon2id)
   - `core/secrets/mod.ts`의 export, `worker/pipe.ts`의 export·import 처리와 `rejectForeignSecretPath`의 두 op, `protocol/secrets/exchange.ts`(`secretExport`, `secretImport`, `SECRET_EXPORT_OP`, `SECRET_IMPORT_OP`와 schema)와 `protocol/secrets/mod.ts`의 export, `main/worker/io.ts`의 해당 분기
   - `hash-wasm`은 `exchange.ts`가 마지막 사용처다(grep으로 확인). root `deno.json`에서 빼는 일은 lead가 한다.
   - 이 secret 창을 열던 UI는 `remove-platform-renderer`가 지웠다. 남았으면 보고한다.
4. 조립: `core.ts`의 `updateNotice` 두 곳(`Core` type과 구현), `main.ts`의 import를 걷는다. `protocol/client/daemon.ts`의 import는 줄어든 `install.ts`를 그대로 가리킨다.
5. 도구 두 개를 고친다(추가 소유가 승인됐으면). 지운 검사를 부르던 곳만 걷는다.
   - `tools/package-linux.ts`: `checkStagedLock` import와 staged lock 비교 블록.
   - `tools/verify-linux-install.ts`: `checkSandboxFile`·`checkRunningSandbox`·`linuxProcReader`를 쓰는 sandbox 검사 단계. `remove-documents-core`가 지울 `projects/formats/guest/contract.ts`를 가리키는 `checkFormatRunnerWasm`도 같이 걷는다. 문자열 path라 check가 못 잡는다.
6. `deno task check`를 돈다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(지우기만 한다)
- 남지 않음: `grep -rn "updateNotice\|readUpdatePackage\|checkStagedLock\|checkRunningSandbox\|checkSandboxFile\|createSecretTransfer\|sealExchange\|openExchange\|SECRET_EXPORT_OP\|SECRET_IMPORT_OP\|hash-wasm" packages tools`가 0줄이다(`deno.json`·`deno.lock` 제외).

## 보고

- 바꾼 file
- 등록할 것: root `deno.json`의 `hash-wasm` 의존 제거와 `deno.lock`. core 조립에서 뺀 항목
- 안 쓰게 된 export: `base/install/linux-install.ts`의 `lophn-mcp`·`lophn-credential` launcher 이름(coding-agent 몫), `core/config/shell-settings.ts`(platform)
- 정한 것: `protocol/install-and-update`에 남긴 것과 지운 것의 목록
- 걱정: 두 도구에서 sandbox·lock 검사가 빠진다. 설치 묶음 검증이 약해진다. 설치는 보류 주제라 plan이 지우라고 했다. lead가 다르게 정하면 `sandbox-check.ts`·`lock-check.ts`는 남긴다
- 계약 바꾸기 요청: 없음
