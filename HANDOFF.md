# Handoff: `computer-hub` 구현 이어받기

다른 머신에서 `computer-hub` 구현 작업을 **Wave 1 실행 직전(Step 0 완료 상태)** 부터 바로 이어서 진행하기 위한 핸드오프 문서다.

---

## 1. Git / 브랜치 상태 (보존 완료)

- **`main`** (원격 `origin/main`에 푸시됨):
  - `8f3ca65ce` — `docs(roadmap): fold remote clipboard and cross-computer send fixes into computer-hub` (로드맵 갱신 + `CLIPBOARD-REMOTE.md` 삭제 완료)
  - 이후 다른 세션의 커밋(`3a9a0891e` `Release 0.23.180: feat/workflow-oneoff-override` 등)이 `main`에 올라가 있음.
- **`plan/computer-hub`** (원격 `origin/plan/computer-hub`에 푸시됨):
  - `68b44eb7b` — `feat(protocol): add computer-hub step 0 contracts and plan briefs` (`8f3ca65ce` 기준 1커밋, 50개 파일, +1707/-310)
  - Wave 1 워커 4개는 생성 직후 API quota(429)로 편집 없이 종료되었고, 빈 워커 worktree/브랜치와 `status.md`의 `running` 표시는 깨끗하게 정리해 두었음.

> **참고**: `plan/computer-hub`는 `8f3ca65ce`에서 분기되어 있다. 작업 시작 전 또는 최종 `land.sh` 시 `main`(`3a9a0891e` 이후) 위로 rebase하면 된다.

---

## 2. Step 0 완료 및 검증 내역 (`68b44eb7b`)

Wave 1~3 워커들이 중앙 레지스트리에서 충돌하지 않도록 모든 공통 프로토콜 계약, 임시 stub, 초기 flow 항목, 8개 워커 브리프를 `plan/computer-hub`에 선반영했다.

### 반영된 계약·코드
- **ID 접두사** (`packages/protocol/base/ids.ts`): `trf` (`Transfer`), `pcs` (`PhoneCustody`), `stg` (`StagedSettings`) 추가.
- **교차 컴퓨터 슬러그 & 첨부** (`packages/protocol/lophn-agent/{calls.ts,mail.ts,handoff.ts}`, `packages/protocol/folder/take-in.ts`):
  - `remoteWorkspaceSchema`와 `takeInInputSchema`의 `app`을 `z.string().min(1)`로 열어 `app_` ID와 slug 모두 수용.
  - `transferAttachmentSchema` 추가 및 `agentCallSend`, `mailSchema`(`call`/`reply`), `callSendRemote`, `handoffFileSchema`, `handoffWrite`, `handoffNoteSchema`에 선택 `attachments` 추가.
- **폴더 전송·설정 내보내기 계약** (`packages/protocol/folder/{transfers.ts,settings-export.ts,records.ts,status.ts,mod.ts}`):
  - `transfers/*` (`send`, `list`, `status`, `clear`), `settings_export/*` (`send`, `staged`, `apply`, `dismiss` — 5종: `agent`, `skill`, `project_command`, `permission_rules`, `workflow`) 정의 및 `FOLDER_ROUTES` 등록.
  - `records.ts`(`hub`, `addresses.relays`), `status.ts`(`machines[].hub`, `apps[].sync_policy`, `apps[].sync_override`) 확장.
- **Hub Relay & 폰 Custody Key** (`packages/protocol/remote/{relay-room.ts,frames.ts,roster.ts,routes.ts,client.ts,mod.ts,carry.ts,allowlist.ts}`, `packages/relay/relay.ts`, `packages/protocol/apps/app-sync.ts`):
  - `packages/relay/relay.ts`의 순수 `createRelay` 구현을 `packages/protocol/remote/relay-room.ts`로 이동(`node:crypto` 제거, 상수 시간 XOR 비교로 `portable-import` 준수)하고 `packages/relay/relay.ts`에서 re-export.
  - `serverHello.machine`에 `hub`, `relays` 추가; `clientHello`와 `rosterJoin`에 폰용 선택 `signing_key` 추가(기존 페어링 폰의 재페어링 없는 등록 지원).
  - `roster.ts`: `phone` 엔트리의 `signing_key`를 허용하되 **`trust()`는 `body.kind === "computer" && body.signing_key !== null`만 신뢰**하도록 보안 경계 고정. `signDetached`/`verifyDetached` export.
  - `carry.ts`: `transfers/`, `custody/`, `staged-settings/` 경로와 `manifestBodySchema` 선택 필드 지원.
  - `app-sync.ts`: `CUSTODY_SIGN_CONTEXT`, `custodyEnvelopeBodySchema`, `appSyncCustodyPush`, `appSyncCustodyFile` 추가.
- **터미널 이미지 붙여넣기 & 원격 Explorer** (`packages/protocol/coding-agent/terminals.ts`, `packages/protocol/events/transient.ts`, `packages/protocol/projects/project-files.ts`, `packages/shell/**`):
  - `terminals/paste_image` (`shell_capability` 포함), `TerminalClipboardWritten` transient event, `project_files/write_bytes`, `project_files/copy` 계약 추가.
  - Shell IPC(`shell:terminal-paste-image`), preload(`window.lophnTerminal.pasteImage`), `connection.ts`(`terminalCall` union 확장), `machine-deps.ts`, `fake-terminal.ts`, renderer allowlist 반영.
- **설정·임시 stub·flow**:
  - `packages/core/config/shell-settings.ts`: `remote.hub`(`locked: true`), `shell.terminal.osc52_clipboard`(기본 `true`), `sync.app_policies` 추가.
  - `packages/core/main/daemon/wiring/{folder,terminals,projects}.ts` 및 `packages/core/projects/files/mod.ts`에 Step 0 임시 `unavailable` stub 배치.
  - `project-docs/flows/areas/{app-runtime,projects,harness,ipc}.yaml`에 초기 flow 항목 반영.
- **계획·워커 브리프** (`project-docs/plan/computer-hub/`):
  - `README.md`, `status.md` 및 `tasks/*.md` 8개 작성 완료.

### Step 0 검증 결과 (`68b44eb7b` 기준 전부 통과)
- `setsid -w npm run check`: `fmt`, `lint`, `deps`, `source`, `modules`, `docs`, `flows`, `records`, `sdk notes`, `reads`, `skill size`, 전체 `tsc`, `style`, `kit`, `shell main`, `shell main test`, 전체 `test`(20.0s) 모두 통과.
- `setsid -w project-docs/plan/tools/lead/boot.sh`: `routes 479, duplicates 0 []`, `boot 1 exit 0`, `boot 2 exit 0`.
- `node packages/shell/renderer/build.ts`: 성공.
- `node --test packages/relay/relay_test.ts`: 3/3 통과.

---

## 3. 남은 작업 구성 (Wave 1 → Wave 2 → Wave 3 → Wrap-up)

상세 요구사항과 소유 경로는 `plan/computer-hub` 브랜치의 `project-docs/plan/computer-hub/tasks/*.md`에 모두 적혀 있다.

### Wave 1 (병렬 4개 — 즉시 실행 가능)
1. `a2a-slug-and-errors` — 교차 컴퓨터 앱 slug 해석(`remoteWorkspaceOf`, `a2a/agents`, `app take-in`), `carriesReason` 오류 마스킹 해제, `lophn-agent`/`connect-computers`/`home.md` Two Promises·hub·send 안내 갱신.
2. `scheduler-and-hub-relay` — `carry` + `vault-sync` receive scheduler 통합(`createReceiveScheduler`, backoff 중 trigger 유실 수정), `remote.hub === true` 시 `remote.port`에 `/v1/*` relay 내장, ordered relays 전파, `clientHello.signing_key` 서명 반영.
3. `terminal-clipboard-and-explorer` — `terminals/paste_image` 구현 + 붙여넣기/드롭 + non-mac `Ctrl+V` 힌트, OSC 52 1 MiB(`pointerup` 게이트 제거, 읽기 `?`는 계속 차단) + `shell.terminal.osc52_clipboard` + 원격 `TerminalClipboardWritten` 토스트, Linux headless PATH clipboard shim, 원격 Explorer `write_bytes`/`copy` + `isLocal` 제한 해제.
4. `app-sync-policy-and-keep-both` — `@lophn/declaration >= 6.0.0`(및 `5.0.0–5.2.0` phone+computer) 기본 `"computers"` + `"local"` opt-out(기존 `<= 5.2.0` computer-only 번들은 local 유지), 기존 `lophn_sync_*` 표만 쓴 `keep_both` 텍스트 충돌 보존(결정론적 `dupPk`), SDK 3종(`declaration` 6.0.0, `app-ui` 2.26.0, `app-ui-native` 1.12.0) 및 `migrate-sdk` 노트.

### Wave 2 (병렬 3개 — Wave 1 병합·검증 후)
5. `folder-transfers-and-custody` — `transfers/*` 오프라인 Hub 보관(`Held at @Hub`) + `<dataRoot>/inbox/<trf>/` 0644 원자적 수신 + 7일 GC, `--attach` 연동, 폰 `app_sync/custody_push|file` 검증·carry 전달·적용, 5종 `settings_export/*` staging·적용(`permission_rules`/locked field는 `confirm_permissions: true` 사람 확인 필수), `sync.app_policies` 덮어쓰기 및 `machine/environment` 가시성.
6. `cli-send-and-commands` — `lophn send`, `call send --attach`, `handoff write --attach`, `app take-in <slug>`, `settings export|staged|apply|dismiss`, `remote` 제어 문구 정리 (+ `project-docs/flows/areas/cli.yaml` 갱신).
7. `mobile-hub-and-custody` — `remote-client` ordered multi-relay dialer(Hub 우선, Fly fallback) & 재페어링 없는 relay 자동 갱신, 모바일 Ed25519 `signing_key` 생성·`clientHello` 광고, 오프라인 컴퓨터 대상 서명 `app_sync/custody_push`.

### Wave 3 (단독 1개 — Wave 2 병합·검증 후)
8. `shell-my-computers-ui` — `"Allow typing in this computer's terminals"` → `"Allow controlling this computer"` 문구 통일, Settings › Remote + Sync 통합 **"My computers"** 화면(Hub 토글, `지금 바로` vs `켜지면 도착` 배지, `sync.app_policies`, 수신 파일·staged 설정 검토/적용, wireframe), `CallBlock`/`HandoffRow` 첨부 표시, `settings_export/send` 기반 오프라인 `export-workflow-dialog.tsx`.

### Wrap-up (Lead)
- 미사용 standalone `workflows/export|import` 정리 여부 확인.
- `project-docs/architecture/multi-computer.md` 신설 및 `remote.md`, `folder-sync.md`, `app-sync.md`, `machine-a2a.md`, `settings.md`, `boundary-catalog.yaml`, `module-catalog.yaml`, `project-docs/flows/areas/*.yaml`(Step 0 stub 문구 최종본으로 교체), `project-docs/products/change-log/0.23/computer-hub.yaml` 갱신.
- `project-docs/plan/computer-hub/` 및 `project-docs/products/roadmap/computer-hub.md` 삭제.
- 전체 검증 후 `setsid -w project-docs/plan/tools/lead/land.sh computer-hub`로 `main` 반영.

---

## 4. 다른 머신에서 바로 이어서 시작하는 명령

```bash
git fetch origin
# 1) Lead worktree 열기 (원격 plan/computer-hub 체크아웃)
git worktree add .claude/worktrees/plan-computer-hub -b plan/computer-hub origin/plan/computer-hub
cd .claude/worktrees/plan-computer-hub
npm ci && node tools/worktree-prep.ts .

# (선택) 최신 main 위로 rebase
git rebase main

# 2) Wave 1 worktree 4개 띄우기
setsid -w project-docs/plan/tools/lead/launch.sh computer-hub \
  a2a-slug-and-errors \
  scheduler-and-hub-relay \
  terminal-clipboard-and-explorer \
  app-sync-policy-and-keep-both

# 3) 워커 프롬프트 생성 예시
python3 -I project-docs/plan/tools/lead/prompt.py computer-hub a2a-slug-and-errors router/a2a-slug-and-errors "<notes>"
```

---

## 5. 작업 중 반드시 지켜야 할 제약·함정 (이미 확인된 사항)

1. **`setsid -w` 필수 (PTY `SIGTTOU` hang 방지)**:
   - 에이전트 셸(PTY 환경)에서 `boot.sh`(GNU `timeout` without `--foreground`)나 `person-env` login-shell 테스트를 그대로 돌리면 백그라운드 프로세스 그룹이 `SIGTTOU`로 멈춘다.
   - `npm run check`, `npm run check:full`, `boot.sh`, `merge.sh`, `land.sh`, `electron --test`는 **반드시 `setsid -w`를 붙여 실행**한다(`setsid` 단독은 fork 후 즉시 exit 0하므로 `-w` 필수).
2. **SQLite ledger schema step 추가 금지**:
   - `packages/core/storage/migration/schema-steps.lock.json`은 건드리지 않는다. Transfer, phone custody, staged settings는 검증된 disk 파일로, per-app sync override는 `settings.json`으로 처리한다.
3. **Android C++ authorizer 제약**:
   - `packages/mobile/modules/lophn-app-db` C++/Kotlin 코드는 수정하지 않는다. `keep_both` 충돌 보존은 기존 `lophn_sync_row`, `lophn_sync_col`, `lophn_sync_kept` 3개 표만 사용한다.
4. **Remote allowlist 중복 금지**:
   - `packages/core/remote/call.ts`가 `[...REMOTE_ALLOWED_ROUTES, ...REMOTE_PERSON_ROUTES, ...REMOTE_COMPUTER_CORE_ROUTES]`를 합쳐 credential `scope.operations`로 발급하고 `packages/protocol/server/identity.ts`가 중복 operation을 거절한다. 두 목록은 반드시 서로소(disjoint)여야 한다.
5. **보안·호환 불변식**:
   - `packages/protocol/remote/roster.ts`의 `trust()`는 `body.kind === "computer"`만 신뢰한다(폰 `signing_key`에 명단 서명 권한 부여 금지).
   - `packages/protocol/apps/declaration/`은 외부 의존성 없는 pure TS(`checkDeclarationGraph`), `packages/protocol/remote/*`·`packages/protocol/apps/sync/*`·`packages/remote-client/*`는 `node:*` import 금지(`portable-import`).
   - 봉인된 `<= 5.2.0` computer-only 앱 번들(`mafia`, `holdem`, `omok`, `agent-monitor`, `masup`, `mahas`)은 기본 local 유지.
   - `~/.lophn`, 실제 `wss://lophn-relay.fly.dev`, 실제 모델 provider 호출 금지. 모바일 수정 시 `cd packages/mobile && npm ci && npm run typecheck && npm test` 별도 실행.
