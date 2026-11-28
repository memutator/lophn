# multi-computer

한 사람의 여러 컴퓨터와 폰을 하나의 작업 공간으로 잇는 다중 컴퓨터 개요다. 늘 켜 둔 컴퓨터 하나를 Hub로 두어 연결 중계와 오프라인 보관을 맡기고, 앱 데이터와 설정·사용자 파일·원격 클립보드의 흐름을 두 가지 약속("지금 바로" vs "켜지면 도착")으로 정리한다. 세부 메커니즘은 `remote.md`, `folder-sync.md`, `app-sync.md`, `machine-a2a.md`, `settings.md`, `terminal-agent.md`가 각자 맡는다.

## 문제

- 밖에서 폰이나 다른 컴퓨터가 집 컴퓨터에 붙을 때 늘 외부 relay(Fly)를 거쳤고, 늘 켜 둔 개인 VM이나 서버 컴퓨터가 연결을 직접 중계할 수 없었다.
- 대상 컴퓨터가 꺼져 있는 동안 폰에서 고친 앱 데이터는 hub에 맡겨지지 못해 폰에만 남았다.
- agent나 사람이 다른 컴퓨터로 일반 파일·폴더·설정을 보낼 공식 경로가 없었고, 다른 컴퓨터의 앱을 slug로 부를 때 보내는 쪽 로컬 앱 목록에서만 찾아 꺼진 컴퓨터로 call을 보내지 못했다.
- 화면 없는 VM에서는 OS clipboard가 없어 터미널 coding agent에 이미지 붙여넣기, TUI의 OSC 52 복사, `pbcopy`/`xclip` 호출, 원격 Explorer 붙여넣기가 막혔다.
- Settings가 Remote와 Sync로 나뉘어 있고 제어 권한 이름이 "Allow typing in this computer's terminals"로 되어 있어, 실제 권한 범위와 기계별 상태·정책을 한눈에 보기 어려웠다.

## 목표와 비목표

- 목표: 사용자에게 **약속 두 가지**만 보인다 — **지금 바로** (실시간 call 목록·session/agent 조회, 터미널, 원격 Explorer, browser page — 대상 컴퓨터가 켜져 있어야 함)와 **켜지면 도착** (`lophn send` 파일 전달, 5종 설정·workflow 내보내기, 앱 데이터·폰 custody 변경, a2a mail, handoff note — 대상이 꺼져 있으면 온라인 Hub 컴퓨터가 보관했다 켜지면 전달).
- 목표: `remote.hub`를 켠 컴퓨터가 기존 remote port에 `/v1/*` relay를 내장해 Hub 우선·Fly fallback 순으로 연결을 중계하고, 폰·컴퓨터가 재pairing 없이 새 relay 목록을 자동으로 배운다.
- 목표: `@lophn/declaration` 6.0.0부터 앱 데이터는 기본으로 내 컴퓨터들(`"computers"`)에 맞추고 기기 전용 표만 `"local"`로 빼며, 텍스트 충돌 시 `"keep_both"`로 두 버전을 모두 보존한다.
- 목표: Settings › **My computers** 한 화면에서 Hub 역할, 제어 권한("Allow controlling this computer"), 앱별 동기화 정책 덮어쓰기, 수신 파일(inbox), 대기 중인 설정·workflow 검토/적용을 다룬다.
- 비목표: session transcript·대화 전체를 기계 간에 복제하기, Hub가 받은 call을 다른 컴퓨터로 다시 넘기기(권한 혼합 방지), lophn 운영 서버가 사용자 데이터를 보관하기, 수신한 사용자 파일 자동 실행·압축 해제, Hub를 필수로 강제하기(Hub가 없어도 direct·Fly·폰·공유 폴더로 동작).

## 모델

```
[지금 바로]  터미널 · 원격 Explorer · browser page · session/agent 목록 조회
             직접 연결 (LAN/Tailscale) ─▶ Hub 내장 relay (/v1/*) ─▶ Fly relay (fallback)

[켜지면 도착] 사용자 파일 (transfers/*) · 5종 설정/workflow (settings_export/*)
             앱 데이터 (folder-sync / app-sync) · 폰 변경 (app_sync/custody_push) · mail · handoff note
             보내는 기기 ─▶ 대상 온라인이면 즉시 / 오프라인이면 온라인 Hub 보관 ─▶ 대상 켜지면 검증·적용
```

- **Hub 역할 (`remote.hub`).** 사람이 설정에서 직접 켠 컴퓨터(그 컴퓨터의 My computers에서, 또는 터미널 입력을 허락받은 다른 컴퓨터가 그 컴퓨터를 고른 My computers에서)의 core가 기존 remote port에 `/v1/host`, `/v1/phone`, `/v1/data` relay를 함께 연다. Hub relay는 명단의 컴퓨터 key만 host 자리로 받는다(아니면 닫고 `hub_relay_ended{reason: host_not_allowed}`를 남긴다). 낯선 key가 통로로 쓰지 못하므로 공개 relay(Fly)의 대역 한도를 두지 않고, 받는 쪽이 밀리면 짝을 닫지 않고 받는 쪽이 비울 때까지 보내는 쪽 socket에서 읽기를 멈춘다. IP마다 socket·host 수와 열기 timeout은 공개 relay와 같다. Hub 자신이 공유기 안의 컴퓨터에 붙을 때는 자기 relay를 켜진 Hub로 세어 그것을 먼저 고른다(자기와의 link는 없다). Hub는 암호화된 Noise 바이트만 중계하고, 오프라인 컴퓨터로 가는 carry 묶음(파일 전송, staged 설정, 폰 custody, mail, handoff note, 앱 데이터)을 보관했다가 대상이 켜지면 전달한다.
- **자동 relay 전파.** 컴퓨터는 명단의 온라인 Hub relay URL들을 앞에, 설정된 fallback relay(Fly)를 맨 뒤에 둔 정렬 목록을 hello와 기계 기록으로 알린다. 이미 짝지어진 폰과 컴퓨터는 재pairing 없이 이 목록을 받아 저장하고 Hub 우선으로 접속한다.
- **앱 데이터 기본 정책과 `keep_both`.** `@lophn/declaration >= 6.0.0`(및 `5.0.0–5.2.0` phone+computer 앱)은 별도 지정이 없으면 `"computers"`로 맞추고 `"local"`로 opt-out한다. 기존 `<= 5.2.0` computer-only 봉인 번들은 하위 호환을 위해 기본 local을 유지하며, Settings › My computers의 `sync.app_policies`로 사람이 앱마다 덮어쓸 수 있다. 텍스트 컬럼의 동시 수정은 `keep_both` 선언 시 승자 행을 유지하고 패자 텍스트를 결정론적 충돌 사본 행으로 남겨 두 버전을 모두 보존한다.
- **폰 Custody.** 폰은 Ed25519 `signing_key`를 생성해 hello와 join으로 광고하고, 대상 컴퓨터가 오프라인일 때 변경분을 서명해 온라인 Hub의 `app_sync/custody_push`로 맡긴다. Hub는 폰의 공개키로 서명을 검증한 뒤 원문 그대로 carry에 보관하고, 대상 컴퓨터가 켜지면 서명을 다시 검증해 중복 없이 적용한다.
- **사용자 파일 보내기와 `--attach`.** `lophn send`와 `transfers/*`는 파일을 carry로 옮기고, 받는 컴퓨터는 sha256·크기를 검증한 뒤 `<data root>/inbox/<trf>/`에 실행 비트 없는 `0644`로 원자적 배치한다(7일 만료 정리). `call send --on --attach`와 `handoff write --attach`는 같은 전송 묶음을 참조로 붙여 전달한다. 다 내려오면 받는 컴퓨터의 Inbox에 `files_received` 줄(폴더 열기 단추)이 서고, 첨부를 실은 call이 file보다 먼저 닿았으면 받은 메시지 끝에 "아직 오지 않았다"는 줄이 붙고 그 session을 `<data root>/transfers/waiting/<trf>.json`에 적어 두었다가 내려올 때 깨운다. 보낸 쪽 `transfers/status|list`는 대상이 꺼져 있으면 붙은 Hub에 그 transfer의 carry file을 하나씩 물어(`carry/file` 1 byte) `at_hub{held, total}`을 붙인다. 다 들었으면 보낸 컴퓨터를 꺼도 된다(듀얼부트·노트북). 받는 쪽 `transfers/status`는 아직 오는 중이면 `unavailable`과 도착 수를 답한다.
- **5종 설정 내보내기.** `agent`, `skill`, `project_command`, `permission_rules`, `workflow`는 자동 동기화하지 않고 `settings_export/*`로 내보낸다. 받는 쪽은 `<data root>/staged-settings/`에 `pending`으로 두고 사람 검토 후 적용하며, `permission_rules`나 `locked_fields`(agent 정의의 `permission_mode`와 `deployed_skills`)는 사람의 명시적 확인 없이는 적용하지 않는다.
- **원격 클립보드와 Explorer.** 터미널 이미지 붙여넣기·드롭은 `terminals/paste_image`로 대상 core 임시 경로에 쓰고 경로를 입력한다. OSC 52 쓰기는 최대 1 MiB까지 허용하며(`shell.terminal.osc52_clipboard`로 끌 수 있고 읽기 `?`는 계속 차단) 원격 터미널 쓰기 시 toast를 띄운다. 화면 없는 Linux 터미널에는 `pbcopy`/`xclip`/`xsel`/`wl-copy` OSC 52 shim을 PATH 앞에 둔다. 원격 Explorer도 제어 허락이 있으면 `project_files/write_bytes`와 `project_files/copy`로 복사·붙여넣기를 지원한다.

## 지키는 것

1. **명단 서명 권한 분리.** 폰의 Ed25519 `signing_key`는 `app_sync/custody_push` 서명 검증에만 쓰며, 명단 신뢰(`trust`)는 오직 `kind === "computer"` 항목만 인정한다.
2. **사람 확인 경계.** `remote.hub`, `permission_rules`·`locked_fields`가 포함된 staged 설정 적용, 기기별 제어 허락("Allow controlling this computer")은 agent가 임의로 켤 수 없고 사람의 명시적 확인이 필요하다.
3. **경로·실행 격리.** agent의 `transfers/send`는 workspace 밖 경로와 symlink 탈출을 차단한다. 수신한 파일은 실행 비트 없는 `0644`로 inbox에만 두고 절대 자동 실행하거나 풀지 않는다.
4. **기존 저장소 호환.** 전송·custody·staged 설정은 검증된 disk 파일로, 앱별 동기화 덮어쓰기는 `settings.json`으로 관리해 SQLite ledger schema step을 늘리지 않으며, 폰 SQLite native authorizer가 허용하는 기존 `lophn_sync_*` 표만 사용한다.
5. **오류 투명성.** 교차 컴퓨터 앱 slug는 받는 쪽(또는 peer 기록) 기준으로 풀며, `call.send`, `team.spawn`, `session.list`, `agent.list`, `send` 등 교차 컴퓨터 명령의 실패 원인은 공통 문장으로 가리지 않고 오프라인·미발견 원인을 그대로 전한다.

## 경계와 계약

- `remote`, `remote-client`, `relay`: Hub 내장 relay(`/v1/*`), ordered relays 전파, 폰 `signing_key` 등록과 multi-relay dialer.
- `folder`, `app-sync`, `apps`: 공용 receive scheduler, `transfers/*`, `app_sync/custody_*`, `settings_export/*`, `sync.app_policies`, `keep_both` 충돌 보존, `machine/environment` 가시성.
- `coding-agent-cli`, `router`, `agent-workspaces`: `lophn send`, `--attach`, `app take-in <slug>`, `settings export|staged|apply|dismiss`, `remote status`, Two Promises 지침.
- `shell`, `projects`, `design`: Settings › My computers 통합 화면, `terminals/paste_image`, OSC 52 1 MiB + remote toast + Linux headless shim, `project_files/write_bytes|copy` 원격 Explorer.

## 결정

- **Hub 지정은 사람이 직접 고른다.** program이 자동으로 Hub를 켜지 않고 사람이 My computers에서 `remote.hub`를 켠다. 화면 없는 컴퓨터(VPS)가 Hub의 가장 흔한 자리라, 터미널 입력을 허락받은 다른 컴퓨터의 My computers에서도 그 컴퓨터의 Hub를 켠다(사람, 2026-11-27). agent는 여전히 켜지 못한다(`locked`). Hub는 명단에 든 사람의 컴퓨터이므로 보관 데이터는 평문으로 두고, Fly relay는 마지막 fallback으로 유지한다. (사람, 2026-11-26)
- **데이터 정책은 종류로 나눈다.** 앱 데이터는 기본으로 컴퓨터 간 동기화(`"computers"`)하고 기기 전용 표만 `"local"`로 빼며, 환경 의존 설정 5종은 자동 동기화 대신 staging 기반 export로 옮긴다. (사람, 2026-11-26)
- **텍스트 충돌은 `"keep_both"`를 선택지로 둔다.** 동시 편집 시 승자 행은 유지하고 패자 값을 결정론적 충돌 사본 행으로 남겨 데이터 유실을 막고 모든 replica가 같은 상태로 수렴한다. (사람, 2026-11-26)
- **Hub relay는 명단의 컴퓨터만 받고 대역 한도를 두지 않는다.** 공개 relay의 한도(초당 1 MiB, 밀리면 닫기)는 누구나 자리를 잡는 서버를 지키려는 것이라 사람의 Hub에는 맞지 않는다. 그대로 두었을 때 공유기 안의 컴퓨터가 보낸 58 MB `lophn send`가 Hub에서 매번 끊겨 도착하지 않았다. 남용 막기는 "명단의 컴퓨터만 host"가 맡고, 메모리는 짝을 닫지 않고 보내는 쪽을 기다리게 해 지킨다. 사람이 바꾸는 한도 설정은 두지 않는다(전송량이 묶인 VPS 요구가 나오면 그때 더한다). 대가: Hub relay를 다른 사람의 컴퓨터와 나눠 쓰지 못한다. (사람, 2026-11-27)
- **수신 파일은 inbox에만 둔다.** 대상 project 폴더를 바로 덮지 않고 `<data root>/inbox/<trf>/`에 `0644`로 배치해 사람이나 agent가 확인 후 옮긴다. (사람, 2026-11-26)
- **제어 스위치는 "Allow controlling this computer" 하나로 통일한다.** 터미널 입력·원격 Settings·Explorer 쓰기·page 제어를 아우르는 실제 범위에 맞게 이름만 통일하고 스위치를 여러 개로 쪼개지 않는다. (사람, 2026-11-26)
- **OSC 52는 쓰기 1 MiB 허용 + toast 알림 + 설정 스위치, 읽기 `?` 차단으로 정한다.** mouse pointerup 1회 게이트를 없애 TUI 키보드 복사와 headless shim을 지원하되, 몰래 복사되지 않도록 알림과 끄기 스위치를 둔다. (사람, 2026-11-26)
