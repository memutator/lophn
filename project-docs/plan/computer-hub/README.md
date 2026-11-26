# computer-hub

Roadmap: `project-docs/products/roadmap/computer-hub.md` (다중 컴퓨터 연결·Hub Relay·데이터 정책·파일 전달·원격 클립보드·Explorer·설정 통합).

## 작업 구성

- **Step 0** (lead): 공통 protocol 계약(`trf`/`pcs`/`stg` ID, `calls`/`mail`/`handoff`/`take-in` slug·첨부, `transfers/*`, `settings_export/*`, `relay-room`, phone `signing_key`, `app_sync/custody_*`, `terminals/paste_image`, `TerminalClipboardWritten`, `project_files/write_bytes|copy`, settings, flow 항목, 임시 stub) 선반영.
- **Wave 1**:
  - `a2a-slug-and-errors` — 앱 slug 교차 해석, `carriesReason` 오류 전달, agent 안내/skill 문서
  - `scheduler-and-hub-relay` — shared receive scheduler 통합, embedded hub relay (`/v1/*` on `remote.port`), relay 목록 전파, phone `signing_key` 등록
  - `terminal-clipboard-and-explorer` — 터미널 이미지 붙여넣기, OSC 52 한도 확장+remote toast+설정 스위치, Linux headless PATH clipboard shim, remote Explorer copy/paste
  - `app-sync-policy-and-keep-both` — `@lophn/declaration` 6.0.0 기본 `"computers"`/`"local"`(기존 `<= 5.2.0` 호환 유지), `keep_both` 텍스트 충돌 보존, SDK/migrate-sdk
- **Wave 2**:
  - `folder-transfers-and-custody` — `transfers/*` 오프라인 hub 전달과 `<dataRoot>/inbox/<trf>/` 0644 수신, `--attach`, phone custody 보관·전달, 5종 `settings_export/*` staging/적용, `sync.app_policies` 가시성·덮어쓰기
  - `cli-send-and-commands` — `lophn send`, `--attach`, `app take-in <slug>`, `settings export|staged|apply|dismiss`, `remote` 제어 문구
  - `mobile-hub-and-custody` — ordered multi-relay dialer, relay 목록 자동 갱신, phone Ed25519 `signing_key` 서명과 offline 대상 `app_sync/custody_push`
- **Wave 3**:
  - `shell-my-computers-ui` — `Allow controlling this computer` 이름 바꾸기, Settings › My computers 통합 화면·wireframe, 첨부 표시, offline workflow/settings 내보내기
- **Wrap-up** (lead): `architecture/multi-computer.md` 및 관련 문서/카탈로그/flow/change-log 갱신, 전체 검증 및 `land.sh computer-hub`.
