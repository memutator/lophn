# folder-transfers-and-custody

- 단위: folder transfers, phone custody, settings_export, sync override (wave 2)
- 선행: a2a-slug-and-errors, scheduler-and-hub-relay, app-sync-policy-and-keep-both
- 목표: 오프라인 Hub 보관·전달을 포함한 `transfers/*`와 `<dataRoot>/inbox/<trf>/` 0644 수신, `--attach` 첨부 전달, 폰 `app_sync/custody_push|file` 검증·carry 전달·적용, 5종 `settings_export/*` staging·적용(`permission_rules`/locked field 사람 직접 확인), `sync.app_policies` 덮어쓰기와 `machine/environment` 가시성을 구현한다.
- 소유:
  - `packages/core/folder/transfers.ts`
  - `packages/core/folder/custody.ts`
  - `packages/core/folder/settings-export.ts`
  - `packages/core/folder/environment.ts`
  - `packages/core/folder/environment_test.ts`
  - `packages/core/folder/export/`
  - `packages/core/folder/import/`
  - `packages/core/folder/carry-routes.ts`
  - `packages/core/folder/carry-status.ts`
  - `packages/core/folder/replica.ts`
  - `packages/core/folder/folder_test.ts`
  - `packages/core/main/daemon/wiring/folder.ts`
  - `packages/core/router/commands.ts`
  - `packages/core/router/remote-reach.ts`
  - `packages/core/remote/mail-entry.ts`
  - `packages/core/main/daemon/wiring/handoff.ts`
- 참조:
  - `packages/protocol/folder/transfers.ts`
  - `packages/protocol/folder/settings-export.ts`
  - `packages/protocol/folder/status.ts`
  - `packages/protocol/remote/carry.ts`
  - `packages/protocol/remote/roster.ts`
  - `packages/protocol/apps/app-sync.ts`
  - `packages/protocol/apps/declaration/sync-plan.ts`
  - `packages/core/apps/sync/service.ts`
  - `packages/core/config/shell-settings.ts`
  - `project-docs/products/roadmap/computer-hub.md`

## 구현

1. **파일 보내기 & Inbox Materialization (`transfers/*`, carry `transfers`)**:
   - **제약**: SQLite ledger schema step을 추가하지 않는다! 상태·기록은 검증된 disk 파일(`<dataRoot>/transfers/outgoing/`, `<dataRoot>/inbox/<trf>/`, `<dataRoot>/computers/machines/<m>/transfers/`)로 관리한다.
   - `transfers/send`: 대상 컴퓨터(`mch_` 또는 이름) 해석, 파일 크기/개수 검증, agent 호출일 경우 workspace 밖 경로는 차단(`allow_outside_workspace`가 true인 user만 허용), `<dataRoot>/computers/machines/<this>/transfers/<trf>/` (`meta.json` + `files/0000.bin`...) 기록 후 carry kick. 대상이 온라인이면 즉시 전달 상태 추적, 대상이 offline이지만 온라인 hub 컴퓨터가 명단에 있으면 carry/hub 전파 확인 뒤 `state: "held_at_hub"` + `held_by` 반환, 아무 hub도 없으면 `queued`.
   - `folder/import` & `replica`: 다른 컴퓨터의 `transfers/<trf>/`가 도착해 sha256·크기가 manifest와 일치하면(대상이 이 컴퓨터일 때만) `<dataRoot>/inbox/<trf>/`에 원본 파일명으로(충돌 시 안전한 접미사, 실행 비트 제거 `0644`, 절대 실행하지 않음!) atomic write(temp + rename)하고 `acks.json`을 써서 보낸 컴퓨터/hub에 배달 완료를 알린다. `TRANSFER_TTL_MS`(7일) 경과 시 incoming/outgoing carry 파일 GC.
   - Hub 컴퓨터(`remote.hub === true`): 다른 컴퓨터가 보낸 `transfers/<trf>/`를 carry/replica로 들고 있으며 대상 컴퓨터가 켜져 carry해 가면, `acks.json` 도착 시 보관 정리.
   - `transfers/list`, `transfers/status`, `transfers/clear` 실제 handler로 Step 0 stub 교체(`wiring/folder.ts`).

2. **`--attach` 연동 (`call.send`, `handoff.write`, `mail`)**:
   - `packages/core/router/commands.ts`, `remote-reach.ts`, `packages/core/remote/mail-entry.ts`, `packages/core/main/daemon/wiring/handoff.ts`:
     - 첨부 `TransferAttachment[]`가 `calls/send`, `calls/send_remote`, `handoff/write`를 통해 전달되고, 받는 쪽 컴퓨터의 agent가 첨부 파일을 `<dataRoot>/inbox/<trf>/` 아래 경로로 안전하게 찾아 읽을 수 있도록 매핑한다.

3. **폰 앱 데이터 Custody (`app_sync/custody_push`, `app_sync/custody_file`, carry `custody`)**:
   - Hub 컴퓨터에서 `app_sync/custody_push` 요청 시:
     - `body`는 `custodyEnvelopeBodySchema`, `signature`는 roster에서 해당 `from_device`(`body.kind === "phone"`)의 Ed25519 `signing_key`로 `verifyDetached(CUSTODY_SIGN_CONTEXT, canonicalJson(body), signature, signingKey)`를 검증한다(다른 device 사칭·변조 차단).
     - `target` 컴퓨터가 온라인이고 현재 연결 중이면 즉시 전달을 시도하고, offline이면 `<dataRoot>/computers/machines/<hub>/custody/<pcs>.json`에 서명 포함 그대로(Hub가 내용을 해석/변조하지 않음) 저장하고 carry kick! `state: "held"`.
   - `app_sync/custody_file`: 보관 중인 custody payload chunk를 인증된 대상/기기에게 안전하게 읽히도록 구현(Step 0 stub 교체).
   - `folder/import`: 대상 컴퓨터가 켜져 hub의 `custody/<pcs>.json`을 carry로 받으면, 폰의 `signing_key` 서명과 sha256을 다시 검증한 뒤 해당 앱의 sync apply 경로(`app/sync`)로 넘겨 적용하고 `custody/acks.json`에 처리 완료를 남긴다(중복 방지).

4. **5종 설정 & Workflow 내보내기·적용 (`settings_export/*`, carry `staged-settings`)**:
   - `kind`: `"agent" | "skill" | "project_command" | "permission_rules" | "workflow"`.
   - `settings_export/send`: 로컬 설정/파일(또는 `raw_items`)을 `stg_` 배치로 묶어 carry(`staged-settings/<stg>.json`)로 보낸다(대상이 offline이면 hub 경유 `held_at_hub`).
   - `folder/import`: 자기 앞 `stg_` 배치가 오면 `<dataRoot>/staged-settings/<stg>.json`에 `state: "pending"`으로 저장.
   - `settings_export/staged` & `settings_export/dismiss`: 대기 목록 조회 및 닫기.
   - `settings_export/apply`: `actors: ["user"]` 필수. 항목 중 `permission_rules` 또는 `locked_fields`가 들어 있으면 `confirm_permissions === true`가 아닐 때 `"requires_person_confirmation"`을 반환하며 절대 자동 적용하지 않는다! 사람이 직접 확인(`confirm_permissions: true`)한 경우에만 대상 config/폴더에 안전하게 적용한다(Step 0 stub 교체).

5. **Per-app Sync Policy Override & 가시성 (`sync.app_policies`, `environment.ts`)**:
   - `packages/core/folder/export/`, `import/`, `environment.ts`, `wiring/folder.ts`: `settings.json`의 `sync.app_policies` 맵(`{ [appOrSlug]: "default" | "computers" | "local" }`)을 읽어 `syncPlanOf` 결과에 덮어쓴다(`"local"`로 끄면 해당 앱 export/import 중단; `"computers"`로 켜면 `@lophn/declaration <= 5.2.0` legacy 앱도 컴퓨터 간 동기화 참여).
   - `machine/environment`가 `machines[].hub`, `apps[].sync_policy`, `apps[].sync_override`를 채워 돌려준다.

## 완료 기준

- `node --test packages/core/folder/**/*.ts packages/core/router/router_test.ts packages/core/apps/sync/*_test.ts` 통과
- `node tools/check-deps.ts && npm run check` 통과
