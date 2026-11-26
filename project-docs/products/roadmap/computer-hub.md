# computer-hub: 늘 켜 둔 컴퓨터가 중계하고 맡아 두고, 무엇이 어디로 가는지는 lophn이 정한다

상태: 로드맵. 2026-11-26 사람이 방향을 내고 planner가 이번 조사(아래 "지금")로 정리했다. 사람이 정할 것은 모두 정했다(아래 "사람이 정한 것"). 다음은 "순서" 1부터 계획으로 연다.
배경 문서: `project-docs/architecture/{remote,machine,folder-sync,app-sync,machine-a2a,browser-tab,workflow,platform}.md`, `project-docs/products/roadmap/{multi-device,multi-machine,a2a-multi-device}.md`. 조사한 session: `ses_01m88y4k9q8m6jd6bc1y2a15js`(VM을 서버로), `ses_01m86gfqsdh2awcay4qg64nd3w`(VM으로 file 보내기).

## 사람의 말 (원문)

> vm을 서버처럼 쓸 수 있게 하는 거
> - vm이 중계자가 될 수 있어야함
> - 캘린더 앱을 화면 없는 vm에다 둘 필요는 없잖아 vm의 lophn은 해당 앱을 모르더라도 데이터를 중계해줄 수 있었으면 좋겠음
> - 핸드오프를 vm이 보관하고 있다가 해당 컴퓨터 lophn이 켜지면 전달해주고 이것도 가능하잖어

> 데이터마다 그런 정책들을 좀 프로그램이랑 lophn agent가 휴리스틱하게 알아서 잘 정해지면 좋을 거 같음
> lophn program이 끝낼 수 있는 것들은 로픈이 알아서하고 lophn agent가 판단해서 해야하는 부분들은 lophn agent가 설정하고
> 지금도 app에서는 lophn agent가 알아서 설정하는 것처럼

> 우리 lophn이 모르는 종류의 대상 사용자 필요에 의한 데이터들 같은 것들도 쉽게 전달되는 경로를 마련해줬음 좋겠음
> 예를 들어서 handoff 할 때도 프롬프트만 전달되는 게 아니라 파일 업로드 같은거나
> handoff가 아닌 상황에서도 […] 머신끼리 필요한 데이터 공유할려고 하는데 잘 안 되더라고

> (평가 중) 기술적 완성도 이외에도 사용자가 얼마나 쓰기 쉽게 ux적으로 추상화가 잘 되어 있는 지도 핵심 포인트야

## 지금 (2026-11-26 조사)

사람의 기계: MainHome(Linux)과 Window(같은 PC의 dual boot로 보인다, 같은 내부 주소), vmi3768829(VPS, 공인 주소, 늘 켜 둠), 폰.

**이미 되는 것**
- 꺼진 컴퓨터로 가는 것 가운데 `computers` 폴더의 file(앱 data, 앱 source, `@me/*` package, 명단, a2a mail, handoff note, event file)은 늘 켜 둔 컴퓨터가 저절로 가운데가 된다: 각 core가 link로 상대가 든 **다른 기계의 file까지** 받고, 자기에게 없는 앱의 file도 받는다(`folder-sync.md` "옮기는 길 셋"). 실제로 Window→MainHome mail(`mal_01m8b52p…`)이 MainHome이 꺼진 사이 보내져 켜진 지 3초 뒤 한 번 적용되었다.
- browser vault(profile, 저장 login)도 늘 켜 둔 컴퓨터를 거쳐 퍼진다(link만, `browser-tab.md` 83).
- MainHome↔VM link는 relay 없이 직접 붙는다(VM 공인 주소의 7432).

**안 되는 것**
- **VM이 연결을 중계하지 못한다.** 밖(LTE)의 폰→MainHome은 늘 lophn relay(Fly)다. core는 받은 call을 다시 넘기지 않는다(`remote.md`, 권한이 "직접 붙은 기기"로 정해지기 때문). relay 프로그램(`packages/relay`)을 VM에 띄우고 각 컴퓨터의 `remote.relay`를 사람이 바꾸면 되지만, 설정은 기계마다 하나뿐이고(`core/config/shell-settings.ts` `remoteRelaySetting`, 문자열 하나) 폰은 relay 주소를 초대장으로만 배워 다시 pairing해야 한다(hello에 relay가 없다).
- **폰이 쓴 변경은 hub에 맡겨지지 않는다.** 폰 앱 사본은 `app_sync/push`로 그 앱을 돌리는 컴퓨터에만 가고(받는 컴퓨터가 invocation으로 적용), 폰 앱이 앞에 있는 동안만 돈다. calendar는 `runs_on: ["computer","phone"]`이고 `sync`가 없어 컴퓨터 사이로 안 가며 VM에는 설치되어 있지 않다. 그래서 MainHome이 꺼진 동안 폰에서 고친 일정은 폰에만 있다. 폰은 서명 key가 없어 폴더 file을 쓰지 못한다.
- **사용자 file을 보낼 길이 없다.** mail과 handoff는 설계상 글만이다(`machine-a2a.md` 비목표). `ses_01m86gfq…`에서 MainHome과 VM이 둘 다 켜져 직접 이어져 있었는데도 agent는 Google Drive(평문), lophn 폴더의 내부 자리 `machines/<MainHome>/files/`(lophn이 읽지 않는 자리), GitHub(VM 로그인에 기댐)를 차례로 돌았고 VM에 닿았는지 확인할 길이 없었다. 그 file(약 480 MB tar 등)은 아직 `~/GoogleDrive/lophn/machines/<MainHome>/files/harness-lab/`에 있다.
- **무엇이 맞춰지는지 대상마다 다르다.** memo data는 간다(선언 `sync: {memo: "computers"}`), calendar data는 컴퓨터 사이로 안 간다, 저장 login은 두 기계가 같이 켜져야 간다, workflow 정의는 손으로 Export(대상이 켜져 있고 터미널 입력 허락이 있어야, file 200개·8 MiB, `protocol/workflows/routes.ts`), agent·skill·설정은 안 간다(`multi-machine.md` 정할 것 1, planner 정책 13).
- **맞추는 장치가 대상마다 따로다.** merge 모델 넷(앱 data 칸 단위 HLC LWW `protocol/apps/sync/`, vault 칸 stamp `core/secrets/vault-merge.ts`, 명단 합집합, mail 멱등), 운반 길 셋. 받기 scheduler는 `core/remote/carry.ts`와 `core/secrets/vault-sync.ts`에 복사되어 있고 이미 갈라졌다(vault-sync는 물러나는 동안 온 계기를 `deferred`로 두고, carry는 버린다).
- **사람도 내장 agent도 모델을 틀렸다**(`ses_01m88y4k…`): VM 주소를 MainHome의 Addresses에 넣음, `locked`를 "아무도 못 바꾼다"로 읽고 "relay를 끌 수 없다"고 답함(`locked`는 "사람만 바꾼다"이고 빈 값이면 relay가 꺼진다), "MainHome이 꺼지면 calendar 변경은 VM에 맡겨진다"고 답함(틀림).
- **권한 이름이 뜻과 다르다.** "Allow typing in this computer's terminals" 하나가 터미널 입력, 다른 기계의 Settings 관리, workflow 가져오기, project file 쓰기, browser page 다루기를 연다.
- 실제 환경 검증이 비어 있다: folder-sync를 실제 도구와 두 기계로 돌린 적이 없고(`multi-machine.md` 남은 것), a2a는 한 기계의 개발 core 둘로만 확인했고(`a2a-multi-device.md`), relay의 IP별 한도는 Fly에서 보지 않았다(`platform.md` 열린 것).

## 원칙

`multi-device.md`의 원칙을 그대로 잇는다(환경을 요구하지 않는다, 될 수 있는 것이 먼저, 길은 lophn이 고르고 사람에게 보인다, 중심 기계를 "둔다/안 둔다"로 정하지 않는다). 여기에 둘을 더한다.

- **사용자에게는 약속 두 가지만 보인다.** "지금 바로"(그 기계에 닿아야 한다)와 "켜지면 도착"(맡겨 두었다 늦게라도 간다). 모든 기능은 둘 중 하나로 돌고 화면은 그 약속과 지금 상태(보관 중 @VM, 도착, 실패)를 보인다. 길(직접, relay, hub, 폰, 폴더)은 상태의 한 줄일 뿐이다.
- **정하는 주체를 하나의 기준으로 나눈다.**

| 누가 | 언제 | 예 |
|---|---|---|
| program | 답이 사실에서 나온다 | 지금 닿는 길, 누가 늘 켜져 있고 모두에게 닿나, 크기, 묶기, 재시도, 검증 |
| lophn agent | data의 뜻을 알아야 한다 | 이 표는 기기 cache인가 사람의 기록인가, 이 칸은 글이라 충돌 때 둘 다 남겨야 하나, 무엇을 보내고 뺄까(`node_modules`), 받은 설정을 이 기계에 맞게 고치기 |
| 사람 | 되돌리기 어렵거나 신뢰 경계를 넘는다 | secret이 기계를 떠남, 평문으로 cloud 폴더·VPS에 둠, 기계를 명단에서 뺌 |

  안전 규칙(data를 잃지 않는다, secret은 폴더로 가지 않는다, 사람이 끈 허락은 켜지지 않는다)은 program이 강제하고 agent가 풀 수 없다. agent가 정한 정책은 이유와 함께 한 곳(`machine.environment`를 키운 것)에 보이고 사람이 덮어쓴다.

## 무엇을 만드나

### A. hub: 늘 켜 둔 컴퓨터의 역할

hub는 따로 깔 것이 아니라 명단의 컴퓨터 하나가 맡는 역할이다. 앱을 들일 필요가 없다.

| hub가 하는 일 | 지금 | 만들 것 |
|---|---|---|
| 밖에서 오는 연결의 relay(bytes만, Noise 그대로) | 따로 띄우고 기계마다 설정 | hub의 core가 relay endpoint를 연다. 각 기계의 relay는 목록(hub 먼저, 그다음 Fly). relay 주소를 hello로 알려 폰이 다시 pairing하지 않는다 |
| 꺼진 컴퓨터로 가는 file·mail·note를 맡았다 전달 | 됨(부수 효과) | 상태로 보이기("보관 중 @VM"), 실제 기계로 검증 |
| 폰이 쓴 변경을 맡았다 전달 | 없음 | 폰이 쓴 변경 묶음을 닿는 컴퓨터(hub)에 받을 컴퓨터를 적어 맡긴다. 받는 컴퓨터는 폰이 직접 push한 것과 같이 적용한다. 폰에 서명 key(Ed25519)를 더해 hub가 위조하지 못하게 한다 |
| call을 받아 다른 기계에 다시 보내기 | 막힘 | 그대로 막는다(받는 쪽이 요청자를 hub로 보게 되어 권한이 섞인다) |

### B. data마다의 정책

data는 종류로 나눈다(사람, 2026-11-26).

| 종류 | 예 | 길 |
|---|---|---|
| 사람의 기록 | 앱 data(메모, 일정) | 맞춘다. 기본이 내 컴퓨터들이고, 앱 agent가 기기 cache 같은 표만 "이 기계 전용"으로 뺀다 |
| 환경에 따라 달라지는 설정 | agent 정의, skill, project command, 권한 규칙, workflow 정의 | 맞추지 않는다. 필요할 때 export로 보낸다 |

- **앱 data.** 지금은 선언에 `sync`를 적은 표만 가고 적지 않으면 그 컴퓨터를 떠나지 않는다(calendar가 그렇다). 바꾼 뒤에는 적지 않은 표도 기본으로 내 컴퓨터들에 가고, 앱 agent가 뺄 표를 적는다. 충돌은 선택지 둘(나중 것 | 둘 다 남김, 정한 것 5). 길은 program이 고른다.
- **설정의 export.** 지금은 workflow 하나만 되고(`workflows/export`→`import`), 대상이 켜져 있어야 하고, 터미널 입력 허락이 든다. 바꾼 뒤에는 설정 종류 모두가 같은 export 하나를 쓰고, 그 export는 C의 보내기 위에 선다: 대상이 꺼져 있으면 hub가 맡는다. 받는 쪽은 곧바로 적용하지 않고 "가져올 설정"으로 둔다. 사람이나 그 기계의 lophn agent가 그 기계의 환경에 맞춰(경로, 그 기계에 없는 도구) 고쳐 들인다. 권한 규칙은 지금처럼 사람만 들인다(`settings.md` locked).
- 장치: 받기 scheduler(lane, debounce, timer, backoff) 하나를 carry·vault-sync가 같이 쓴다. 앱 data(SQLite changeset)와 명단(신뢰 계산), mail(배달)의 합치기는 성격이 달라 합치지 않는다. 설정은 맞추지 않으므로 replicated document 모델을 새로 꺼낼 일이 없다.

### C. 사용자 file 보내기

lophn이 뜻을 모르는 file·폴더를 내 다른 컴퓨터로 보낸다. 새 길이 아니라 `computers` 폴더의 운반(서명한 manifest, 8 MiB 조각, sha256, link·hub·폰·공유 폴더)에 "사용자 file 묶음" 종류 하나를 더한다.

```
보내기(path들, 받는 컴퓨터, 메모) ─ program: 작은 file이 많으면 묶기, 조각, 길 고르기
  ─▶ 지금 닿으면 link로 바로 / 아니면 hub에 맡김 / 크기 안이면 폰도 나름
  ─▶ 받는 쪽: 크기·sha256 검사 → 받은 자리(inbox)에 둠 → 알림, agent에게 path
보낸 쪽은 상태를 본다: 보관 중 @VM / 도착 / 받는 쪽에서 엶
```

- handoff note와 a2a mail은 글에 전송 묶음을 참조로 단다("글만"을 "글 + 단 file"로 넓힌다).
- agent 명령: `lophn send <path…> --on <컴퓨터> [--note]`와 상태 읽기. agent는 무엇을 보낼지와 뺄 것을 정하고, git project면 file 대신 그 기계의 `project.clone`이 맞는지 본다.
- 받는 쪽은 file을 실행하거나 풀지 않는다.

### D. 보이기와 이름

- Settings에 "내 컴퓨터들" 한 곳: 기계마다 역할(hub 여부), 닿는 길, 맡아 둔 것, 대상마다 정책(이유와 누가 정했나).
- "Allow typing in this computer's terminals"를 "이 컴퓨터를 다루게 허락"의 뜻으로 바꾼다(아래 정한 것 6).
- 개요 문서 한 장(`architecture/`의 첫 장)과 내장 agent의 skill(`lophn-agent`, `connect-computers`)을 같은 그림으로 고친다. 같은 실수가 두 번 나왔으므로 skill에 "약속 두 가지"와 "hub가 하지 않는 것"을 적는다.

## 옛 결정과 부딪히는 것

| 옛 결정 | 어디 | 이번 요구 |
|---|---|---|
| 기계 사이 중계(round robin 등)를 lophn이 구현하지 않는다 (사람, 2026-11-16) | `multi-machine.md` 정한 것 | A의 relay와 맡아 두기는 중계다. 다만 round robin 같은 분산이 아니라 사람이 가진 늘 켜 둔 기계 하나의 역할이다 |
| agent 정의, skill, 설정을 기계 사이에 맞추지 않는다 (planner 정책 13) | `multi-machine.md` 정할 것 1 | 그대로 둔다(사람, 2026-11-26). B는 맞추기 대신 export를 넓힌다 |
| 앱 data의 길은 앱마다 고른다. agent가 환경을 보고 정한다 (사람, 2026-11-16) | `multi-machine.md` 정한 것 | 기본이 바뀐다: 적지 않으면 로컬 → 적지 않으면 내 컴퓨터들. 앱 agent가 고르는 것은 그대로다 |
| 폰은 폴더를 쓰지 않고 pairing한 컴퓨터를 거친다 (planner 정책 15) | `multi-machine.md` 정할 것 5 | A의 "폰이 쓴 변경 맡기기"가 바꾼다(폰은 폴더를 쓰지 않고 hub에 맡길 뿐이다) |
| mail·handoff는 글만 간다 | `machine-a2a.md` 비목표 | C가 단 file을 더한다(transcript는 여전히 옮기지 않는다) |

"lophn의 relay나 서버가 사용자 data를 맡아 두지 않는다"(`multi-machine.md` 하지 않는 것)와는 부딪히지 않는다: hub는 lophn의 서버가 아니라 사람의 명단에 든 사람의 컴퓨터다.

## 사람이 정한 것 (2026-11-26)

planner가 선택지와 추천을 보이고 사람이 골랐다.

1. **무엇을 맞추나.** 종류로 나눈다: 앱 data는 기본으로 맞추고, 환경에 따라 달라지는 설정(agent 정의, skill, project command, 권한, workflow)은 맞추지 않고 export로 보낸다. 위 B.
2. **hub를 누가 정하나.** 사람이 고른다. program이 저절로 hub를 정하지 않는다. 버린 안: program이 후보를 찾고 사람이 동의(planner 추천), 완전 자동.
   - lophn agent도 켤 수 있다. 다만 사람의 허락을 받는다(사람 승인 설정, `settings.md`의 `approval: "person"`. 카드가 바뀜을 사람의 말로 보인다).
   - 지침을 보강해 지난번 같은 오해를 막는다(위 D와 순서 1): 어느 기계의 설정인지, `locked`의 뜻, hub가 하는 일과 하지 않는 일(연결 bytes 중계와 맡아 두기는 하고, call을 넘기거나 그 기계에 없는 폰 앱의 변경을 받는 일은 이 roadmap 전에는 하지 않는다).
3. **hub가 맡은 것을 읽을 수 있나.** 평문이다. hub는 사람의 명단에 든 사람의 컴퓨터다. 잃는 것으로 받아들인 것: VPS 회사의 디스크와 backup에 data가 평문으로 있다. 버린 안: 받는 컴퓨터만 열게 암호화.
4. **Fly relay.** hub를 먼저 쓰고 Fly는 fallback으로 남긴다. 버린 안: hub만.
5. **글 칸의 충돌.** 앱 선언에 "둘 다 남김"을 두고 앱 agent가 글 칸에 고른다. 충돌하면 사본 하나를 더 남기고 앱 화면이 보인다. 지금은 memo 본문을 두 기계에서 고치면 나중 것만 남고, 지우기와 고치기가 엇갈리면 지우기가 이긴다(`protocol/apps/sync/apply.ts`).
6. **"터미널 입력" 허락.** 이름만 "이 컴퓨터를 다루게 허락"으로 바꾼다. 스위치는 하나 그대로다. 버린 안: 둘로 나누기.
7. **받은 file을 어디에 두나.** 받는 컴퓨터의 inbox 폴더. 받는 쪽 폴더를 덮지 않고 사람이나 agent가 옮긴다. 버린 안: 같은 project 안에 바로.

## planner가 정한 것

- call 중계는 하지 않는다. hub의 relay는 bytes만 넘긴다. 근거: `remote.md` "받은 call은 다시 넘기지 않는다"의 권한 이유는 hub에도 그대로다.
- 사용자 file은 `computers` 폴더 운반 위에 종류 하나로 얹는다. 근거: 서명·검증·조각·hub 보관·폰 운반이 이미 있다. 새 길은 같은 보안 모델을 다시 짓는 것이다.
- 받기 scheduler는 하나로 합친다. 근거: 이미 두 벌이 갈라졌고 세 번째 대상이 생긴다.
- workflow 정의는 설정 쪽(export)이다. 근거: 참가 agent와 flow code가 그 기계의 agent·도구에 기댄다.
- 설정의 export는 C의 보내기 위에 서고, 받는 쪽은 "가져올 설정"으로 두어 사람이나 그 기계의 agent가 고쳐 들인다. 근거: 설정은 환경에 따라 달라 그대로 덮으면 깨진다. 받는 쪽이 꺼져 있어도 가야 한다.
- 폰의 서명 key는 기기 key와 같이 만들고 같이 버린다(컴퓨터의 host key·서명 key 규칙과 같다).
- hub 표시는 hub가 될 컴퓨터 자신의 설정(사람 승인)이고 그 컴퓨터가 hello와 기계 기록으로 다른 기계에 알린다. 다른 기계는 따로 설정하지 않고 relay 목록 맨 앞에 그 hub를 둔다. 근거: "이 컴퓨터에 내 data를 맡긴다"는 그 컴퓨터에 대한 동의이고, 기계마다 hub를 적게 하면 지난번처럼 엉뚱한 기계에 넣는다. 다른 컴퓨터의 agent는 그 컴퓨터의 agent에게 call로 맡기고, 승인 카드는 그 컴퓨터의 Home에 서며 다른 기계의 창에서도 보인다(지금 `remote.addresses`와 같은 길).

## 하지 않는 것

- session transcript와 대화를 옮기기(`multi-device.md` 그대로).
- 받은 call을 다른 기계로 넘기기.
- lophn이 운영하는 서버가 사용자 data를 맡기.
- hub를 필수로 만들기. hub가 없으면 지금 길(직접, relay, 폰, 공유 폴더)로 간다.
- 받은 file을 받는 쪽이 실행하거나 자동으로 풀기.

## 순서

1. **검증과 지침 바로잡기**: 지금 세 기계와 폰으로 늘 켜 둔 VM의 보관(mail, note, memo data)을 실제로 돌려 본다. 내장 agent의 지침(`lophn-agent`, `connect-computers`)을 정한 것 2대로 보강한다. scheduler를 합친다.
2. **C 사용자 file 보내기**(정한 것 7): inbox, `lophn send`, 상태, handoff·mail에 단 file. 가장 크게 막혔던 일이다.
3. **A hub**(정한 것 2·3·4): hub 설정(사람 승인), hub core의 relay endpoint, relay 목록(hub 먼저, Fly fallback)과 hello, 상태 보이기, 폰 서명 key와 폰 변경 맡기기.
4. **B 정책**(정한 것 1·5): 앱 data 기본 범위(적지 않으면 내 컴퓨터들)와 그 data migration, 글 칸 "둘 다 남김", 설정 종류 모두의 export(2의 보내기 위), 정책 보이는 곳.
5. **D**(정한 것 6): 허락 이름, Settings "내 컴퓨터들", 개요 문서. 각 단계의 화면은 그 단계에서 같이 고치고 여기서는 묶음과 이름만 한다.

## 같이 정리할 것

- `~/GoogleDrive/lophn/machines/<MainHome>/files/harness-lab/`의 평문 file(약 480 MB tar 등). 사람의 Drive라 사람이 정한다.
- 이슈 후보: scheduler 갈라짐(carry가 물러나는 동안 온 계기를 버림), 내장 agent가 lophn 폴더의 내부 자리(`machines/<id>/`)에 사용자 file을 씀.
