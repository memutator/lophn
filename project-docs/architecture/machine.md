# machine

lophn 설치 하나가 "어느 기계인가"를 아는 길이다. 설치마다 기계 id가 하나 있고, data root를 다른 기계로 복사해 생긴 두 번째 설치는 기동 때 그것을 알아채 새 기계가 된다. 컴퓨터는 자기 이름(기본은 hostname)을 갖고, 그 이름이 내 기기 명단에서 그 컴퓨터의 이름이다. 연결(hello)과 명단은 `remote.md`, 기동 순서는 `platform.md`가 맡는다.

## 문제

- 컴퓨터에는 이름이 없었다. 폰은 컴퓨터를 pairing한 주소("192.168.0.3")로 불렀고, 사람이 컴퓨터마다 이름을 손으로 붙여야 했다. 한 사람이 컴퓨터를 여럿 쓰면 폰과 desktop이 같은 기계를 같은 기본 이름으로 불러야 한다.
- 기계를 가리킬 id가 없었다. 붙는 쪽은 core의 공개 key만 알았다. data root를 복사하면 key까지 복사되므로 두 기계가 같은 key로 답하고, 붙는 쪽은 어느 쪽에 자격(pair code, call)을 보내는지 모른다.
- 복사된 data root는 원래 기계의 상태를 그대로 들고 온다: remote key, 내 기기 명단과 그 안의 자기 항목, push token, sync 앱의 node. 같은 신분 둘이 돌면 서로의 변경과 push를 덮는다.
- 같은 기계인지 알 수 없는 경우가 있다(OS를 다시 깔고 복원, VM image 복제, OS 값을 못 읽음). 이때 틀린 쪽으로 판정하면 폰 pairing을 잃거나 같은 신분 둘이 남는다.

## 목표와 비목표

- 목표: 설치마다 기계 id 하나. 복사된 data root는 새 기계로 바꾸고, 기계에 묶인 상태는 각자 자기 표지로 다른 기계의 것인지 안다. 컴퓨터의 자기 이름을 사람이 바꿀 수 있고 명단과 연결로 모든 기기에 간다. 사람의 `~/.lophn`과 이미 pairing한 폰은 다시 pairing하지 않고 이어진다.
- 비목표: "main" 기계. 기계 목록과 이름의 유일성 검사(기계 목록을 만드는 계획이 한다). data root가 공유 저장소 위에 있는지 검사하기. 판이 다른 기계 사이의 안내 화면. (agent는 사람의 컴퓨터 목록을 `lophn machine computers`로 읽는다. `machine-a2a.md`) 기계 사이에 agent 정의·skill·설정·자격 맞추기.

## 모델

### 기계 기록

`<data root>/machine.json` 하나가 이 설치의 기계 신분이다. 0600이고 temp에 쓰고 sync한 뒤 rename한다(반쯤 쓴 file이 신분이 되지 않는다).

| 칸 | 뜻 |
|---|---|
| `id` | `mch_<ULID>`. 처음 기동 때 한 번 만든다 |
| `name` | 사람이 지은 이름(1~64자). null이면 hostname을 따른다 |
| `binding` | OS의 기계 값을 key로 `id`를 HMAC-SHA256한 64 hex. OS 값을 못 읽었으면 null |
| `created_at` | 이 id를 만든 때 |
| `cloned_from`, `cloned_at` | 복제로 알아채 새 id가 되었으면 옛 id와 그때. 아니면 null |

OS의 기계 값은 Linux `/etc/machine-id`(없으면 `/var/lib/dbus/machine-id`), macOS `IOPlatformUUID`, Windows `MachineGuid`다. 꼴이 틀리거나 5초 안에 읽지 못하면 값이 없는 것으로 본다. 값 자체는 binding을 만드는 데만 쓰고 file에도 log에도 남기지 않는다(systemd가 machine-id를 비밀로 다루라고 한다).

### 기동 때의 판정

기동마다 ledger schema step 뒤, data step과 wiring 조립 앞에서 한 번 돈다. 실패하면 기동이 실패한다.

```
machine.json 없음 ─────────────▶ 새 id, binding(OS 값이 없으면 null)          created
file을 못 읽음·꼴이 틀림 ───────▶ 덮지 않고 기동 거절(unavailable)
OS 값 없음 ────────────────────▶ 그대로(경고 log)                             같은 기계
binding null, OS 값 있음 ──────▶ binding만 채움, id 그대로                    같은 기계
binding 맞음 ──────────────────▶ 그대로                                       같은 기계
binding 다름 ──────────────────▶ 새 id, name null, 새 binding, cloned_from    복제
```

- 거절 문구는 file path와 "지우면 이 컴퓨터는 새 기계가 되고 폰을 다시 pairing해야 한다"를 말한다. 지울지는 사람이 고른다.
- 복제의 새 id는 file만 바꾼다. remote key와 명단, sync node는 이 판정이 모르고 아래 표지 규칙으로 각자 맞춘다.
- 앱 supervisor와 앱 process도 이 id를 읽는다. supervisor는 기동이 이미 만든 file을 읽고, 없거나 못 읽으면 뜨지 않는다. 앱 process의 시작 줄에 `machine`(id)이 실린다.

### 기계에 묶인 상태의 표지

기계에 묶인 상태는 만든 기계의 id를 같이 적는다. 읽을 때 지금 id와 다르면 다른 기계의 것으로 보고 버리거나 새로 만든다. 그래서 복제 판정이 소비자 목록을 몰라도 된다.

| 상태 | 표지 | 다를 때 |
|---|---|---|
| remote key 둘 `remote/host-key.json`, `remote/signing-key.json` | 칸 `machine` | 둘 다 지우고 명단과 기기 행을 모두 버린다. 둘 가운데 하나만 읽혀도 같다. 다음에 remote를 열 때 새 key 둘과 새 자기 항목(새 id)을 만든다(`remote.md`) |
| sync 앱 DB의 `lophn_sync_state` | key `machine` | 앱 process가 열 때 node를 새것으로 바꾼다. data와 clock 표는 그대로다(`app-sync.md`) |

표지가 없는 상태(이 판 전에 만든 것)는 이 기계에서 만든 것으로 보고 지금 id를 찍기만 한다. host key는 data step `remote.host-key.machine`이 찍고, 서명 key가 없는 host key에는 data step `remote.signing-key`가 지금 id를 찍은 서명 key를 더한다. sync DB는 앱 process가 열 때 찍는다(앱 DB는 앱 process만 열 수 있다).

host key와 서명 key는 같이 만들고 같이 지운다. 서명 key만 새로 만들면 다른 컴퓨터가 모두 이 컴퓨터를 서명 key 충돌로 빼고, 같은 host key로는 다시 들지 못한다.

명단에서 빠진 컴퓨터도 같은 길이다. 다른 컴퓨터가 이 컴퓨터를 뺀 것을 자기 root로 확인하면 복사된 data root처럼 key 둘을 지우고 명단을 버리며, remote가 켜져 있으면 새 key와 새 자기 항목으로 다시 선다. 기계 id와 `machine.json`은 그대로다.

### 이름

- **자기 이름은 그 기계에 산다.** 컴퓨터는 `machine.json`의 `name`이고, 없으면 hostname에서 끝의 `.local`을 떼고 64자로 자른 것(비면 `lophn`)이다. 사람이 Settings › Remote의 "This computer"에서 바꾸면 고정되고, 비우면(`machine/rename`에 null) 다시 hostname을 따른다. 폰은 폰 앱의 이름이다(Settings › This phone, 기본은 기기 model, 40자).
- **기계 이름과 명단의 이름은 한 값이다.** 컴퓨터의 명단 항목 이름은 기계 이름이다. `machine/rename`이 되면 core가 바로 자기 항목을 새 rev로 서명해 모든 기기에 퍼뜨린다(꺼진 동안 hostname이 바뀌었으면 다음 기동이 같은 일을 한다). 다른 컴퓨터가 이 컴퓨터의 이름을 바꾼 rev(`roster/rename`)를 받으면 그 이름을 기계 이름으로 삼는다. 이 컴퓨터 자신은 `roster/rename`으로 바꾸지 않는다(`invalid_input`).
- **연결마다 알린다.** 컴퓨터는 hello의 `machine.name`, 붙는 쪽은 client hello의 `name`으로 보낸다. 명단이 이름을 들기 전(처음 들어올 때)에는 이것이 보인다. 폰은 이름을 바꾸면 연결을 다시 열어 바로 보내고, 컴퓨터는 폰이 알린 이름이 바뀌었을 때 명단 이름을 새 rev로 서명한다.
- **별명.** 컴퓨터가 기기에 붙이는 별명은 없다. 폰은 컴퓨터마다 이 폰에서만 쓰는 별명("Shown as")을 둘 수 있고, 연결과 명단은 그것을 건드리지 않는다(`remote.md`).

## 지키는 것

1. `machine.json`은 어디로도 내보내지 않는다. ledger만 담는 recovery 복구본에 실리지 않고, backup·export·폴더로 내보내는 길에 들지 않는다. 다른 기계로 가는 기록은 id 값을 출처로만 싣는다(폴더의 하위 폴더 이름 `machines/<id>/`, manifest, event file, mail, handoff note의 `machine`).
2. 깨지거나 읽지 못하는 `machine.json`은 덮지 않고 기동을 거절한다. 새 id로 덮으면 remote key 표지가 어긋나 명단과 key가 모두 버려진다.
3. 같은 기계인지 알 수 없으면 같은 기계다. OS 값을 못 읽거나 binding이 없으면 id를 그대로 둔다. 복제는 OS 값이 binding과 맞지 않을 때만이다.
4. data root의 path와 hostname은 판정에 들지 않는다. 같은 기계에서 data root를 옮기거나 hostname을 바꿔도 id가 그대로다.
5. 알아챈 복제는 새 id이고 옛 기계의 명단, remote key 둘, sync node를 이어받지 않는다. 같은 id 둘이 남지 않는다. 명단에서 빠진 컴퓨터도 명단과 key 둘을 버린다.
6. 컴퓨터의 기계 이름과 명단 항목의 이름은 한 값이다. 어느 쪽이 바뀌어도 다른 쪽이 따라가고, 다음 기동이 한쪽을 다른 쪽으로 되돌리지 않는다. host key와 서명 key는 같이 만들고 같이 지운다.
7. OS의 기계 값은 file과 log에 남지 않는다.

## 경계와 계약

- boundary `machine`(기계 기록, 판정, 이름). 기록은 이 module만 읽고 쓴다. 다른 module은 core가 기동 때 낸 기계 신분이나 id 읽기로만 본다.
- 저장: `<data root>/machine.json`(위 표). 기계에 묶인 상태의 표지: `remote/host-key.json`과 `remote/signing-key.json`의 `machine`, sync 앱 DB `lophn_sync_state`의 key `machine`.
- route: `machine/status`(memory, actor user, 출력 `{id, name, name_source: hostname|person, hostname, cloned_from, cloned_at}`), `machine/rename`(memory, actor user, 입력 `{name: 1~64자 trim | null}`, 출력은 status. file을 쓰지 못하면 `unavailable`이고 메모리 값도 그대로다. 되면 `StateChanged{remote_devices}`를 내 명단의 자기 항목을 다시 서명하게 한다). desktop renderer만 부른다. 기기 route 목록에는 없다.
- 앱 process 시작 줄의 `machine`(id).
- 기계 id는 폴더 교환에서 기계가 쓰는 하위 폴더의 이름이고 그 기계가 서명하는 manifest의 `machine`이다. manifest는 그 기계의 명단 서명 key(명단 항목의 `signing_key`)로 서명하고, 받는 쪽은 자기 명단 view에서 `machine`이 그 id인 컴퓨터 항목이 하나뿐일 때만 그 key로 검증한다(`folder-sync.md`). 기계 id만으로는 폴더에 쓰거나 서명할 권한이 생기지 않는다.
- hello의 `machine {id, name}`과 client `name`, 명단 항목의 `machine`과 이름은 `remote.md`의 계약이다.

## 결정

- 기계 id는 ledger 밖 `<data root>/machine.json`에 둔다. 이유: ledger만 담는 복구본과 다른 기계로 가는 기록에 실리지 않아야 하고, 앱 supervisor처럼 ledger를 열지 않는 process도 읽는다. (planner)
- 복제는 OS의 기계 값으로 id를 HMAC한 binding으로 알아챈다. data root path와 hostname은 넣지 않는다. 이유: 같은 기계에서 새 disk로 옮기거나 hostname을 바꿔도 복제가 아니어야 한다. (planner)
- 알아챈 복제는 새 기계다(새 id, 이름은 hostname으로, 새 host key와 서명 key, 명단·relay 등록과 sync node를 이어받지 않는다). 이유: 같은 id 둘은 서로의 변경과 push를 덮는다. 폰을 다시 pairing하는 비용이 같은 신분 둘보다 싸다. (planner)
- 알 수 없는 경우는 알 수 있는 쪽으로만 판정한다. OS 값이 바뀌면(OS를 다시 깔고 복원 포함) 새 기계, OS 값이 같거나 binding이 없으면 같은 기계다. (planner)
- 기계에 묶인 상태는 만든 기계의 id를 같이 적고 읽을 때 대조한다. 이유: 복제 판정 한 곳이 소비자 목록을 알 필요가 없다. 새로 생기는 기계별 상태도 같은 규칙을 쓴다. (planner)
- 깨진 `machine.json`은 덮지 않고 기동을 거절한다. (planner)
- "main" 기계를 두지 않는다. 기본 보기는 보는 쪽마다, 늘 켜 둠은 기계마다다. (사람)
- 기계와 폰에 이름을 짓는다. (사람, 2026-11-16)
- 자기 이름은 그 기계에 산다. (planner)
- 컴퓨터의 기계 이름과 명단의 이름은 한 값이다: 다른 컴퓨터가 준 이름을 기계 이름으로 받고, 자기 이름을 바꾸면 바로 자기 항목을 다시 서명한다. 이유: 두 값이면 다음 기동이 한쪽을 다른 쪽으로 되돌리고, 명단 하나를 모든 기계가 같이 들므로 기계마다 다른 별명은 같은 기기를 기계마다 다르게 부르게 한다. 버린 안: 보는 쪽마다 알린 이름과 별명을 따로 두고 별명이 이기기(앞의 판, 사람 2026-11-16). 옮길 때 컴퓨터가 폰에 붙였던 별명이 명단의 이름이 되었다. (agent)
- 명단에서 빠진 컴퓨터는 복사된 data root와 같은 길로 명단과 key 둘을 버린다. 이유: 빠진 key는 다시 들지 못하므로 새 key로 새 기기가 되어야 다시 초대받는다. (agent)

## 열린 것

- 이 판 전에 다른 기계로 복사한 data root는 알아채지 못한다. 두 쪽 모두 처음 기동 때 `machine.json`이 없어 각자 새 id를 만들고, 각자 remote key와 sync DB에 자기 id를 찍는다. 그래서 두 기계가 같은 remote key와 명단, 같은 sync node를 쥔다. 폰은 처음 붙은 쪽의 id를 배워 다른 쪽을 받아들이지 않는다.
- OS 값을 읽지 못하던 때 만든 기록(binding null)을 그 상태로 복사하면, 복사본이 자기 OS 값으로 binding을 채워 같은 id 둘이 된다. OS 값을 읽지 못하는 곳(machine-id가 없는 container)에서는 복제를 알아채지 못한다.
- VM image를 복제해 OS 값까지 같으면 복제를 알아채지 못한다.
- data root를 공유 저장소(동기 폴더, network disk)에 두고 두 기계가 번갈아 쓰면 기동마다 상대의 기록을 복제로 보고 새 id를 만들며 명단과 remote key를 버린다(`platform.md`). 공유 저장소 검사는 sync 폴더(destination)와 data root가 서로 안에 있으면 거절하는 것뿐이다(`folder-sync.md`). 그 밖은 지침이 막는다.
- 기계 이름이 겹치는지 보지 않는다. 겹친 이름은 폴더 교환의 읽기 명령 `machine.environment`만 `이름 (id 끝 6자)`로 가린다(`folder-sync.md`).
