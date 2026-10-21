# pr-log-writer

app supervisor가 앱 stdout·stderr를 메모리 buffer만이 아니라 앱마다 file(`pr-log-contract`의 자리, 줄 모양, 돌리기)로 남긴다. redaction과 `[inv=...]` 읽기는 지금 log buffer와 같다. 읽기 route가 file로 옮겨 갈 때까지(`pr-log-read`) 메모리 buffer는 그대로 같이 둔다.

- 단위: log (wave 3)
- 선행: pr-log-contract.
- 소유(이 task만 고친다):
  - `packages/core/apps/control.ts`
  - `packages/core/apps/runtime/observations/log-file.ts` (새 file)
  - `packages/core/apps/runtime/observations/log-file_test.ts` (새 file)
  - `packages/core/main/app-supervisor/assembly.ts`
  - `packages/core/main/app-supervisor/main.ts`
- 읽을 것:
  - 제품 결정: `project-docs/plan/problem-remove/README.md` "정한 것"의 "앱 log를 앱마다 file로 남긴다", "잡히지 않은 예외와 화면 오류는 log 줄이 된다"(redaction은 줄마다)와 "뼈대 검토에서 정한 것" 첫 항목(console을 감싸지 않는다. `[inv=...]`는 SDK가 쓰는 줄에만 있다), "preview와 test mode의 오류는 이번에 log에 쓰지 않는다". roadmap `project-docs/products/roadmap/problem-ticket.md`의 "모양"(크기 상한, 재시작 뒤에도 남는다)과 끝의 test 둘
  - 계약: `project-docs/plan/problem-remove/tasks/pr-log-contract.md`의 "내놓는 것"(file 자리, 돌리기, 줄 모양, `text`의 꼴)
  - architecture: `project-docs/architecture/app-call.md` "지키는 것"의 바깥 길 줄(supervisor가 secret 값을 받아 붙이고 앱의 응답·오류·log에 값이 없다, fs grant로 log가 열리지 않는다), `project-docs/architecture/layers.md`("module은 `core/main`을 import하지 않는다"), `project-docs/architecture/testing.md`
  - skill: `.claude/skills/write-test/SKILL.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-runtime`, `child-supervision-protocol`; `project-docs/module-catalog.yaml`의 `packages/core/apps`, `packages/core/main`
  - 코드
    - `packages/core/apps/runtime/observations/log-buffer.ts`(`INVOCATION_MARK`, `addLine`의 "redaction 뒤 자르기", `attach`)
    - `packages/core/apps/runtime/observations/stream-decoder.ts`(`createStreamDecoder`, `drain`, `ByteSource`, 16 KiB 넘는 줄 버리기)
    - `packages/core/main/app-supervisor/log-redact.ts`(`lineRedactor`)
    - `packages/core/main/app-supervisor/assembly.ts`(`SupervisorIo`, `redact`, `bufferOf`, `deps.spawn`의 `log.attach`, `tee`, `secrets`, preview `spawn`)
    - `packages/core/main/app-supervisor/main.ts`(`dataRoot`, `assembleSupervisor` 인자)
    - `packages/core/main/app-supervisor/secret-delivery.ts`(`apps.secret_value`로 받은 값)
    - `packages/core/apps/control.ts`의 `appSupervisorSpec`(supervisor의 Deno 권한)
    - `packages/core/apps/permissions/protected-paths.ts`(앱 fs grant가 data root를 열지 못한다)
    - `packages/base/redaction/mod.ts`(`createKnownSecretRegistry`, `createRedactionStream`), `packages/base/redaction/patterns.ts`(credential pattern)
- 계약:
  - 쓰는 것: `pr-log-contract`의 `appLogFile`, `appLogPreviousFile`, `APP_LOG_FILE_MAX_BYTES`, `appLogLineSchema`, `APP_LOG_TEXT_MAX_CHARS`; `packages/core/main/app-supervisor/log-redact.ts`의 `lineRedactor`; `packages/core/apps/runtime/observations/stream-decoder.ts`의 `ByteSource`
  - 내놓는 것(`log-file.ts`. `pr-log-exception`과 `pr-log-view-error`가 쓴다)
    - `createAppLogFile({ dataRoot, app, redact, now })` → `AppLogFile`
    - `AppLogFile.attach(source: ByteSource): Promise<void>`: stdout·stderr를 줄로 읽어 쓴다. 머리의 `[inv=<id>] `를 떼어 `invocation`에 둔다.
    - `AppLogFile.append(entry: { invocation: string | null; text: string }): void`: 표시 없이 invocation을 아는 줄(예외, 화면 오류)을 쓴다.
    - 두 길 모두 줄마다 redaction한 뒤 `APP_LOG_TEXT_MAX_CHARS`로 자르고, `APP_LOG_FILE_MAX_BYTES`를 넘게 되면 돌린다. 쓰기 실패는 supervisor를 멈추지 않는다.
    - supervisor 조립(`assembly.ts`)이 앱마다 하나를 쥐고 `logFileOf(app)`으로 꺼낸다.

## 할 일

근거: README "앱 log를 앱마다 file로 남긴다", `pr-log-contract`의 계약, `project-docs/architecture/app-call.md`의 secret·fs 줄.

1. `packages/core/apps/runtime/observations/log-file.ts`를 만든다. import는 base, protocol(`packages/protocol/apps/app-storage.ts`, `packages/protocol/apps/app-log.ts`), 같은 폴더의 `stream-decoder.ts`뿐이다. `core/main`을 import하지 않는다(`project-docs/architecture/layers.md`).
   1. `createAppLogFile({ dataRoot, app, redact: (line: string) => string, now: () => string })`. `now`는 `At` 꼴 시각이다(supervisor는 `io.clock.now`를 넘긴다).
   2. 줄 하나 쓰기(두 길이 같이 쓴다): `redact(text)`를 먼저 하고 그 뒤 `APP_LOG_TEXT_MAX_CHARS`로 자른다(이 순서다. 자른 줄에 secret 일부가 남지 않는다. `log-buffer.ts`의 `addLine`과 같다). `{ at: now(), invocation, text }`를 `JSON.stringify` 한 줄과 `\n`으로 `appLogFile`에 더한다.
   3. 돌리기: 처음 쓸 때 `appLogFolder`를 `recursive`로 만들고 `app.log`의 지금 크기를 `stat`으로 읽는다(없으면 0). 이유: file은 supervisor가 다시 떠도 남으므로 0부터 세면 상한을 넘는다. 그 뒤 크기는 메모리에 쥐고 줄마다 `stat`하지 않는다. 더할 줄의 byte 수를 더해 `APP_LOG_FILE_MAX_BYTES`를 넘게 되면 먼저 `app.log`를 `appLogPreviousFile`로 rename하고(앞 `.1`을 덮는다) 크기를 0으로 한 뒤 쓴다.
   4. 쓰기는 동기로 한다(`Deno.writeTextFileSync(path, line, { append: true })`, `Deno.renameSync`, `Deno.statSync`, `Deno.mkdirSync`).
      - 정한 것: stdout, stderr, `append`가 한 file에 같이 쓰므로 동기 쓰기로 줄이 섞이지 않고 돌리기가 한 번에 끝난다. 열린 file handle을 쥐지 않는다(계약에 close가 없고, test의 자원 정리 검사에 걸린다).
   5. 쓰기·rename·stat·mkdir 실패는 잡고 넘어간다(supervisor를 멈추지 않는다). 다음 줄에서 다시 시도한다.
   6. `attach(source)`: `createStreamDecoder`와 `drain`으로 줄을 읽는다. 머리의 `[inv=<id>] `는 `log-buffer.ts`의 `INVOCATION_MARK`와 같은 정규식으로 떼어 `invocation`에 두고, 없으면 `invocation`은 null이다(console을 감싸지 않으므로 보통 줄은 null이다). 정규식은 이 file에 둔다. `log-buffer.ts`는 `pr-log-read`가 지운다.
      - 정한 것: 16 KiB를 넘어 decoder가 버린 줄(`onDropped`)은 쓰지 않고 진단도 새로 내지 않는다. 이유: redaction 전에 자를 수 없는 줄이라 남길 안전한 글이 없다(`stream-decoder.ts` 머리 주석). 지금 buffer의 `app_log_line_loss` 진단은 buffer와 같이 `pr-log-read`가 정리한다.
   7. `append({ invocation, text })`: 2~5와 같은 길로 쓴다. `text` 안의 줄바꿈은 그대로 두고 JSON이 escape한다.
2. `packages/core/main/app-supervisor/assembly.ts`
   1. `SupervisorIo`에 `dataRoot?: string`을 더한다. 앱마다 `AppLogFile` 하나를 Map에 쥐고 `logFileOf(app)`로 꺼낸다(`assembleSupervisor` 안의 함수. `pr-log-exception`, `pr-log-view-error`가 같은 file에서 부른다). `redact`는 지금 buffer가 쓰는 줄 redaction, `now`는 `io.clock.now`다.
      - 정한 것: `dataRoot`가 없으면 `logFileOf`는 undefined이고 file을 쓰지 않는다. 이유: `preparation`·`data`처럼 data root 없는 조립을 지금 그대로 둔다. 부르는 쪽은 `logFileOf(app)?.append(...)`로 쓴다.
   2. 운영 자식(`deps.spawn`)의 stdout과 stderr를 file이 읽는다. stderr는 지금처럼 `tee(spawned.stderr, nonce)`를 지난다.
      - 같은 stream을 두 번 읽을 수 없다. 그래서 file에 넘기는 `ByteSource`가 읽은 byte를 buffer 쪽 decoder(`createStreamDecoder`의 `onLine` → `log.addLine`, `onDropped` → `log.addUnsafeDrop`, EOF에 `finish`)에도 넘긴다. `tee`와 같은 꼴의 작은 함수다. 이 이음은 `pr-log-read`가 buffer와 같이 지운다.
      - buffer의 `collect`가 기다리던 `attach` promise가 없어져 자식이 끝난 직후의 조회가 마지막 20ms flush를 기다리지 않는다. 그 조회를 쓰는 collector는 wave 4에서 없어지므로 그대로 둔다.
   3. preview 자식(`createPreviewLauncher`의 `spawn`)의 출력은 file에 쓰지 않고 지금처럼 `preview:<app>` buffer로 읽는다.
      - 정한 것: README "preview와 test mode의 오류는 이번에 log에 쓰지 않는다". 지금도 `preview:<app>` buffer는 아무도 읽지 않는다(`SUPERVISOR_OPS.logs`는 앱 id만 받는다).
   4. 정한 것: log redaction의 `KnownSecretRegistry`를 하나 두고(지금은 빈 registry를 바로 `lineRedactor`에 넘긴다), `secrets.delivery`의 `core` 호출이 `apps.secret_value`(`appsSecretValue`, `packages/protocol/apps/secret-use.ts`)에 성공하면 받은 값을 그 registry에 등록한다. "알려진 secret 값은 supervisor가 모른다" 주석을 맞춘다.
      - 이유: file은 supervisor 재시작 뒤에도 disk에 남는다(roadmap test "log file에 secret이 redaction 없이 남지 않는다"). 지금 supervisor 쪽 줄 redaction은 credential pattern만 지우고, 알려진 값은 core가 읽을 때 지웠다(`packages/core/apps/runtime/reads.ts` `withRuntimeLogs`의 `sources.redact`). 앱이 바깥 응답에 되돌아온 값을 찍으면 그 값이 file에 그대로 남는다. supervisor는 그 값을 이미 60초 쥐고 붙이는 쪽이라 새로 알게 되는 값이 없다.
3. `packages/core/main/app-supervisor/main.ts`: `dataRoot`(`LOPHN_HOME`)가 있으면 `assembleSupervisor`에 넘긴다.
4. `packages/core/apps/control.ts`의 `appSupervisorSpec`: `allow_write`에 `${input.dataRoot}/apps`를 더하고, 위 주석("쓰기는 앱 socket 폴더뿐이다")을 맞춘다.
   - 이유: supervisor의 Deno 권한은 지금 socket 폴더만 쓸 수 있어, 이것 없이는 file 쓰기가 권한에 막혀 조용히 실패한다(5의 test는 임시 폴더라 못 잡는다). Deno의 `--allow-write`는 glob을 받지 않고 앱은 supervisor가 뜬 뒤에도 생기므로 `apps` 폴더를 연다. 앱 process는 data root를 fs grant로 열 수 없어(`packages/core/apps/permissions/protected-paths.ts`의 `dataRoot`) log는 앱에 닫힌 채다.
   - 이 file은 위 소유 목록에 없다. lead가 소유에 더한 뒤 고친다(wave 3에서 `packages/core/apps/control.ts`를 고치는 다른 task는 없다). 더해지지 않았으면 고치지 말고 보고한다.
5. `packages/core/apps/runtime/observations/log-file_test.ts`에 위험 test 둘을 쓴다(아래 "끝남"). 순수 in-process다: `Deno.makeTempDir`의 임시 data root, 고정 `now`, 배열에서 byte를 내는 `ByteSource`. subprocess와 core를 띄우지 않는다.
   - redactor는 `packages/base/redaction/mod.ts`의 `createKnownSecretRegistry`와 `createRedactionStream`으로 `lineRedactor`와 같은 모양(줄마다 새 stream, `push` + `finish`)을 만든다. test는 `core/main`의 `log-redact.ts`를 import하지 않는다.

읽기 route는 아직 메모리 buffer를 읽는다. file을 읽는 것은 `pr-log-read`다. 이 task 뒤 file이 쓰이기만 하고 읽히지 않는 것은 미완 동작이 아니다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`packages/core/apps/runtime/observations/log-file_test.ts`)
  - "log file에 secret이 redaction 없이 남지 않는다": 준비 한 번(알려진 값 하나를 등록한 redactor)에 표로 돈다. 판정은 끝난 뒤 `app.log`의 byte에 secret 원문이 없는 것이다.
    - `attach`: stdout 줄 안의 credential pattern 값(`packages/base/redaction/patterns.ts`의 꼴, 예: `ghp_` + 영숫자 30자)
    - `attach`: `[inv=<id>] ` 표시가 붙은 줄 안의 알려진 값. 같은 줄의 `invocation`이 그 id다.
    - `append`: 예외 text 안의 알려진 값
    - 290자 뒤에서 시작해 300자 경계를 넘는 알려진 값. file에 그 값의 앞 10자도 없다(redaction을 자르기보다 먼저 한다).
  - "log file은 상한을 넘지 않는다. 넘치면 오래된 줄부터 버린다": 번호를 단 300자 줄을 `append`로 합쳐 16 MiB를 넘게 쓴 뒤
    - `app.log`와 `app.log.1`이 각각 `APP_LOG_FILE_MAX_BYTES` 이하다.
    - 두 file을 `.1`, `app.log` 순으로 이으면 마지막에 쓴 줄로 끝나는 연속 번호이고, 0번 줄은 없다.
    - 같은 자리에 새 `createAppLogFile`(supervisor 재시작)로 이어 써도 `app.log`가 상한을 넘지 않는다.
- core 확인: `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다.
- 남지 않음: `grep -n "알려진 secret 값은 supervisor가 모른다" packages/core/main/app-supervisor/assembly.ts`가 0줄이다. `grep -n "allow_write: \[sockets\]" packages/core/apps/control.ts`가 0줄이다(할 일 4를 했을 때).

## 보고

- 바꾼 file
- 통과한 check와 위험 test 이름
- 등록할 것: lead가 고칠 목록 file. 없음이면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다). 없음이면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것"을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. `packages/core/apps/control.ts`를 고쳤으면 여기에도 적는다
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
