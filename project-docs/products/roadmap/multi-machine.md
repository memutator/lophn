# multi-machine: 한 사람의 lophn 여럿

상태: **계획 여섯으로 열었다(2026-11-16).** `project-docs/plan/{machine-identity,desktop-remote,app-folder-sync,project-identity,always-on,machine-update}/`. 계획 사이의 경계와 정한 정책은 `reports/multi-machine/program.md`에 있다. 2026-11-15 사람이 방향을 냈고, 2026-11-16 사람과 planner가 대화로 모양을 잡았다. 같은 날 다른 harness 21개를 조사했다(아래 "조사"). 바탕인 relay(계획 `remote-relay`), 폰에서 도는 sync 앱(`mobile-local-apps`), 폰 앱(`mobile-app`)은 main에 있다. "정한 것"에 적지 않은 것은 planner의 추천이고 결정이 아니다.

배경 문서: `project-docs/products/roadmap/{mobile,standalone-core}.md`, `project-docs/architecture/{remote,app-sync,phone-screen,platform}.md`.

## 사람의 말 (원문)

2026-11-15:

> 그럼 우리가 multi device 능력을 확대해서 사용자가 개인 서버 , 미니 피시 같은 게 서버 역할 하도록 이전시키는 것도 가능할려나

> 거기서도 자체적으로 lophn을 깐다는 전제 하에

2026-11-16:

> 미니 피시, 그냥 집, 직장이거나 듀올뷰팅이거나 아니면 사용자가 대여한 vm이던가 이걸 다 아우르는 게 어려워?

> 대화 세션을 다른 머신에서 resume하는 건 안 할거임 하더라도 지금처럼 리모트로 하든가하지

> 데이터 동기화나 그런 멀티 디바이스 api 따위를 sdk에 등록해서 lophn agent가 알아서 해줬으면 좋겠음 왜냐하면 일반 사용자는 relay니 뭐니 모르잖아

> a로 하는 게 맞는 거 같은데 (…) 앱마다 달라야되는 게 일단 왜냐하면 비즈니스 로직이 앱마다 다른데 데이터의 성격이라든가 그리고 구글 드라이브와 연결을 우리 기능으로 고정해두는 게 아니라 api처럼 lophn agnet가 좀 해주면 좋을 거 같은데 연결부는 사용자마다 다양할테니까

> 난 rclone하고 연결 시킬라 했는데 우리가 제공하면 rclone을 끼우기가 쉽지 않잖아 우리가 멀티 디바이스, 라운드로빈 그런 거 다 구현하기도 좀 그런데

> workspace는 같은 의미를 가지면 좋을 거 같아 내 lophn 프로젝트는 메인 머신에서도 맥북 머신에서도 같은 의미여야돼 코드야 git으로 알아서 하겠지만 그리고 앱도 git으로 하겠지만 이걸 lophn agent가 좀 더 적극적으로 할 수 있으면 좋을 거 같은데

> 업계 표준과 전혀 다르더라도 우리가 데이터도 다룰 수 밖에 없는 이유는 사용자 개인 앱을 다루는 게 lophn만의 차별점이고 이걸 하는 애들이 아무도 없어서 그런거임 이 부분에 대해서는 우리가 정할 수 밖에 없음

## 무엇인가

한 사람이 lophn을 기계 여럿에 깔고 쓴다: 집 PC와 회사 PC, 늘 켜 둔 미니 PC, 빌린 VM, dual boot의 두 OS, 그리고 폰. 세 가지가 된다.

1. 어느 기계에서든 다른 기계의 lophn을 본다(session, 대화, 승인). 다른 기계의 앱 화면은 띄우지 않는다.
2. 사람의 앱이 가진 data가 기계 사이에 맞는다. desktop을 끄고 나가도, 두 기계가 동시에 켜진 적이 없어도.
3. project가 기계마다 같은 것으로 보인다.

## 원칙

- **기계마다 lophn이 통째로 있다.** 각자 core, ledger, data root를 갖는다. 원본을 한 곳으로 모으지 않고, data root를 공유 저장소에 두지 않는다.
- **session과 대화는 옮기지 않는다.** 그 기계의 project 폴더 위에서 일어난 일이다. 다른 기계의 것은 remote로 본다.
- **사용자 data를 기계 사이에 다루는 부분은 lophn이 스스로 정한다.** 사람이 자기 앱을 갖는 것이 lophn만의 차별점이고, 조사한 제품 가운데 그것을 하는 곳이 없다. 선례가 없다는 것은 하지 말라는 근거가 아니라 빌릴 답이 없다는 뜻이다.
- **사람마다 다른 부분은 제품에 박지 않고 agent에게 둔다.** 보관소 연결, 폴더를 옮기는 도구, 그 기계의 git 로그인은 사람마다 다르다. lophn은 좁은 약속(폴더, 읽을 수 있는 환경 정보)만 내고 agent가 그 위에서 맞춘다.
- **자격은 기계를 넘지 않는다.** provider key, secret, git token을 기계 사이에 복사하거나 맞추지 않는다.

## 모양

### 1. 기계와 이름

- 기계마다 설치 id가 하나 있다. id는 그 기계를 떠나지 않는다: backup, 내보내기, sync 폴더 어디에도 넣지 않는다. data root를 복사해 생긴 두 번째 기계는 알아채고 새 id를 받는다.
- 이름은 그 기계가 갖고, 붙는 쪽에 알려 준다. 기본값은 hostname이고 사람이 바꾼다. 사람이 한 번 바꾼 뒤에는 hostname을 따라가지 않는다. 폰도 이름을 갖는다. 보는 쪽이 따로 붙이는 별명은 첫 판에 두지 않는다.
- "main" 하나를 두지 않는다. 기계마다 "늘 켜 둠" 표시(켜면 그 기계의 lophn이 부팅 때 스스로 뜬다)와, 보는 쪽마다의 기본 기계(켤 때 마지막에 쓴 기계를 열지 정해 둔 기계를 열지)로 나눈다.
- 기계를 넘는 모든 기록은 절대적인 기계 id를 싣는다. "local"처럼 보는 사람에 따라 뜻이 달라지는 값을 저장하지 않는다.

### 2. 다른 기계 보기 (remote)

- desktop 앱이 다른 기계의 core에 기기로 pairing해 그 기계의 lophn을 연다. 폰 앱이 하는 것과 같은 길(Noise 연결, direct와 relay)이고, desktop에도 기계 고르기가 생긴다.
- 권한은 폰과 같다: 보기, 말하기, 답하기(승인, 질문, 동의), 앱 쓰기. 다른 기계의 secret 넣기, 기기 등록 같은 관리는 하지 않는다.
- 각 기계의 처음 설정(provider, key, remote 켜기)은 그 기계의 화면에서 한다. 미니 PC와 VM도 화면이 있으면 같다(모니터, 원격 desktop).
- 꺼진 기계 하나가 화면 전체를 막지 않는다. 꺼진 기계에 맡겨 두는 범용 queue는 만들지 않는다.
- 기계끼리 판이 달라도 붙는다. 정확히 같은 build를 요구하지 않고 protocol 범위와 capability로 판단한다.

### 3. 앱 data 맞추기

- 합치는 엔진은 lophn 것 하나다: 지금 폰 sync가 쓰는 SQLite changeset과 column별 last-write-wins(`architecture/app-sync.md`).
- lophn과 바깥의 약속은 **폴더**다. sync 앱의 변경을 정해진 폴더에 file로 내놓고, 다른 기계가 내놓은 file을 읽어 적용한다. 기계마다 자기 하위 폴더에만 쓴다(같은 file을 둘이 고치는 일이 없다). 읽을 때는 전부 검사한 뒤 한 번에 적용한다.
- 폴더를 다른 기계나 cloud로 옮기는 일은 lophn 밖이다(rclone, Syncthing, Google Drive for desktop, NAS 공유 폴더 등). lophn은 그 도구들을 모른다: code에도 의존성에도 설정에도 없다.
- **정책은 앱마다 다르다.** 앱 선언에 이 앱의 data가 어느 폴더(보관소)로 가는지, 또는 내보내지 않는지를 적는다. 앱을 만드는 agent가 사람의 환경과 memory를 보고 정한다.
- 폰은 폴더에 직접 닿지 못한다. 폰은 지금처럼 pairing한 컴퓨터와 맞추고, 그 컴퓨터가 폴더로 내보낸다.
- 앱의 release도 같은 폴더로 간다(다른 기계가 같은 앱을 갖는다). 앱 source는 기계마다 자기 하위 폴더에 내놓는 git bundle(앞의 것 뒤로 덧붙는 조각)로 옮겨 git host와 로그인이 필요 없다. 폴더 안에 bare 저장소를 두지 않는다: file을 하나씩 옮기는 도구 아래에서 두 기계가 같은 저장소 file을 고치면 깨진다.
- 기계 목록도 폴더로 간다: 기계마다 자기 기록(id, 이름, 늘 켜 둠, 닿는 주소)을 자기 하위 폴더에 내놓아, 계정 서버 없이도 기계들이 서로의 이름과 상태를 안다. pairing은 여전히 사람이 한다.
- cloud 보관소에 올릴 때의 암호화는 옮기는 도구의 몫이다(rclone `crypt` 등). agent 지침이 암호화 없이 cloud에 올리지 않게 한다.

### 4. project의 신분

- project는 두 겹의 id를 갖는다: 기계별 id(지금의 것)와 기계를 넘는 신분.
- 기계를 넘는 신분은 저장소 안의 file에 둔다(무작위 id 하나. 이름은 넣지 않고 기계마다 둔다. commit되어 git을 타고 간다). git remote 주소는 힌트로만 쓴다. remote로 식별하면 fork가 한 project로 합쳐지고 origin을 바꾸면 신분이 바뀐다.
- 기계마다 그 project의 상태가 있다: 폴더가 있다, 이 기계에는 없다. 없으면 agent가 clone을 돕는다.
- project에 딸린 지침과 설정을 저장소 file로 두어 git을 타게 할지는 정하지 않았다(아래 "사람이 정할 것").

### 5. git과 자격

- lophn은 git 로그인을 만들지 않고 token을 저장하지 않는다. 그 기계에 있는 것(`gh` 로그인, credential helper, SSH key)을 쓴다. 조사한 제품 모두가 같다.
- agent가 띄운 git은 암호를 기다리며 멈추지 않고 바로 실패하고, 무엇을 실행하면 되는지 알려 준다(`gh auth login` 등).
- lophn이 만든 앱의 source는 sync 폴더 안의 저장소로 옮기는 것이 기본이라 로그인이 필요 없다.

### 6. agent

- agent는 환경을 읽는다: 기계 목록(이름, 늘 켜 둠, 지금 닿는지), 폰, 폴더와 마지막으로 내놓고 읽은 시각. system prompt에 싣지 않고 도구로 읽는다.
- agent는 연결을 짓는다: 폴더를 옮길 도구를 설치·설정하고 주기 job을 건다. 방법은 지침(skill)에 있고 제품 code에 없다.
- 기기 pairing, 기계 연결, 보관소 연결의 시작은 사람이 승인한다.
- agent가 다른 기계에 일을 보내는 것은 첫 판에 넣지 않는다.

## 되는 것과 한계

되는 것:

- desktop을 끄고 나가도 늘 켜 둔 기계가 있으면 폰의 앱 data가 계속 맞는다.
- 집과 회사가 동시에 켜진 적이 없어도 보관소(폴더를 옮기는 도구)를 거쳐 맞는다. dual boot도 같다.
- 회사에서 집 PC의 session을 열어 이어서 일한다(집 PC가 켜져 있을 때).
- 사람마다 다른 보관소를 agent가 붙인다. 앱마다 정책이 다르다.
- 같은 저장소는 어느 기계에서 열어도 같은 project다.

한계:

- session과 대화는 옮기지 않는다. 그 기계가 꺼져 있으면 못 본다.
- project 폴더 자체는 맞추지 않는다(git이 한다).
- 폰이 쓴 것은 컴퓨터 한 대라도 켜져 있어야 다른 기계로 퍼진다.
- 맞는 속도는 폴더를 옮기는 도구에 달렸다. 실시간이 아니다.
- 화면을 띄울 수 없는 server는 첫 판에서 설정할 길이 없다.
- agent 정의, skill, 설정, provider key는 기계마다 따로다.
- remote는 다른 기계를 관리하지 못한다.
- ~~두 기계가 같은 앱의 다른 release를 돌릴 때의 처리는 설계가 필요하다.~~ 계획 `machine-update`로 정했다(`architecture/folder-sync-releases.md`, `architecture/activation.md`, change-log `machine-update`): 그 앱을 들인 기계가 새 release를 git 조상 순서로 스스로 따라가고 권한이 늘면 그 기계에서 묻는다. 새 release의 변경은 그 기계가 올라올 때까지 두었다가 차례로 적용하고, 옛 release의 변경은 그 기계가 올라온 뒤의 snapshot으로 온다. 갈라진 release는 앱 agent가 합쳐 새 release를 내야 풀린다.

## 정한 것

| 무엇 | 누가, 언제 |
|---|---|
| 기계마다 lophn을 통째로 깐다 | 사람, 2026-11-15·16 |
| session을 다른 기계에서 resume하지 않는다. 필요하면 remote로 본다 | 사람, 2026-11-16 |
| data의 길은 앱마다 고른다(사람 설정 한 번이 아니다). agent가 환경과 memory를 보고 정한다 | 사람, 2026-11-16 |
| 보관소 연결을 lophn 기능으로 고정하지 않는다. rclone 같은 바깥 도구를 agent가 붙인다 | 사람, 2026-11-16 |
| 기계 사이 중계(round robin 등)를 lophn이 구현하지 않는다 | 사람, 2026-11-16 |
| project는 기계가 달라도 같은 의미다. code와 앱 source는 git으로 옮기고 agent가 더 적극적으로 한다 | 사람, 2026-11-16 |
| 사용자 data를 다루는 부분은 선례와 달라도 lophn이 정한다 | 사람, 2026-11-16 |
| 기계와 폰에 이름을 짓는다 | 사람, 2026-11-16 |
| Google Drive API를 lophn이 직접 부르는 길은 보류한다 | 사람, 2026-11-16 |
| 합치는 엔진은 lophn 것 하나로 고정하고 앱마다 다른 것은 정책뿐이다 | planner 추천 |
| lophn과 바깥의 약속은 폴더다 | planner 추천(사람의 rclone 방향에서) |
| remote의 첫 판은 폰과 같은 권한이고 처음 설정은 그 기계의 화면에서 한다 | planner 추천 |
| "main" 대신 늘 켜 둠 표시와 보는 쪽마다의 기본 기계 | planner 추천 |
| project 신분은 저장소 안 file, 두 겹 id | planner 추천 |
| git 로그인을 만들지 않고 그 기계의 것을 쓴다 | planner 추천 |

## 조사에서 가져온 규칙

`../harness-lab/_report/multi-device/`(2026-11-16, harness 21개를 문서 13개로). 설계에 불변으로 넣는다.

- 기계 id는 backup, 내보내기, sync 폴더에 넣지 않고, 복제된 data root를 알아챈다. 조사한 제품 여섯이 이 문제를 갖고 있다(data 폴더를 복사하면 두 기계가 하나가 된다).
- 이름은 그 기계가 갖는다. 대부분의 제품이 이름을 보는 쪽에만 두어, 폰과 desktop이 같은 기계를 다르게 부른다.
- 같은 기계를 두 주소(LAN, relay)로 알게 되면 id로 하나로 접는다. 붙는 쪽은 자격을 보내기 전에 상대의 id가 저장해 둔 것과 같은지 확인한다(주소는 같은데 다른 기계가 답하는 경우).
- 누군가의 기본으로 지정된 기계는 지우기 전에 알린다.
- data root를 공유 저장소에 두지 않는다(그렇게 한 제품은 DB 설정을 바꾸고 모든 기계를 세운 채 이전했다).
- 자격 file을 기계 사이에 복사하지 않는다(한쪽이 token을 갱신하면 다른 쪽이 깨진다).
- 폴더에서 읽은 것은 전부 검사한 뒤 적용한다. 반만 만들어진 묶음은 실패로 끝내 주기 job이 성공으로 보고하지 않게 한다.
- last-write-wins에서: 미래 시각이 찍힌 변경은 고치지 않고 적용을 미루며 어느 기계의 시계가 앞서 있는지 보인다(받은 시각을 받는 쪽 시계로 자르면 기계마다 사본이 달라진다). 시계가 뒤로 가도 판 번호는 올라간다. 지운 것의 흔적은 아는 기계가 모두 지나갔거나 90일이 지난 것만 정리하고, 그보다 오래 떨어져 있던 기계의 변경은 버리지 않고 그 기계에 맡아 두어 사람이나 agent가 정리한다.
- 한 벌만 있는 것(앱 release 등)을 보관소에 쓸 때: 시작 때의 판을 적어 두고, 판이 바뀌었으면 자기 변경만 합치고, 바꾼 것이 없거나 판을 읽지 못하면 쓰지 않는다.
- 기계를 넘어 가는 예약 작업은 주인 기계를 싣고 멈춘 채 도착한다(주인이 없으면 모든 기계가 같은 job을 돌린다).
- 여러 기계의 session을 한 목록에 보일 때: 갱신은 전체 목록으로 받아 한 번에 적용하고, 읽기에 실패하면 아무것도 지우지 않는다.
- 두 기기가 같은 session에 쓸 때: 보는 쪽이 아직 못 본 메시지가 있으면 보내기를 거절하고 알린다. 합치지 않는다.
- 화면 없는 기계를 뒤에 열 때의 재료: SSH로 원격을 살펴 capability로 맞는지 보고, 설치는 보는 쪽에서만 묻고, 받은 file을 hash로 검사하고, 뒤에서 다시 붙을 때는 설치나 재시작을 하지 않고 확인을 기다리며, 로그인 주소는 사람이 앉은 기계의 브라우저에서 연다.

## 하지 않는 것

- session과 대화를 기계 사이에 옮기거나 합치기.
- desktop에서 다른 기계의 앱 화면을 띄우기(사람, 2026-11-16: 필요 없다).
- core를 한 기계로 옮기고 나머지가 client로 붙기.
- lophn의 relay나 서버가 사용자 data를 맡아 두기.
- 기계 사이 중계와 순번을 lophn이 구현하기.
- 보관소 연결부(Drive, Dropbox 등)를 제품 기능으로 고정하기.
- provider key, secret, git token을 기계 사이에 맞추기.
- project 폴더(code)를 lophn이 맞추기.

## 보류

- lophn이 Google Drive API를 직접 부르는 길(사람, 2026-11-16 보류). 얻는 것은 폰이 컴퓨터 없이 보관소에 닿는 것이다. 여는 때는 그 필요가 실제로 클 때다. 변경 file의 모양을 "폴더에 놓든 API로 올리든 같은 file"로 두어 나중에 붙일 수 있게 한다.
- 화면을 띄울 수 없는 server의 설정과 관리(다른 기계에서 붙어 관리하기, CLI만으로 설정하기).
- remote의 관리 권한("이 기기는 관리까지 할 수 있다").
- agent가 다른 기계에 일을 보내기.

## 사람이 정할 것

1. **agent 정의, skill, 설정을 기계 사이에 맞추나.** 지금 안은 맞추지 않는다. 맞춘다면 무엇을(이름으로 좁힌 목록), 값이 기계마다 다를 때 어떻게 보이나("Mixed" 표시). 다른 제품은 설정 몇 개를 붙어 있는 기계에 뿌리는 정도다.
2. **project에 딸린 지침과 설정을 저장소 file로 두나.** 두면 git을 타고 모든 기계에 간다(개인 값은 그 기계에, 공유 값은 저장소 file에, "공유" 단추가 개인 값을 file에 쓴다). 안 두면 기계마다 다시 정한다.
3. **앱마다 정책의 범위.** 정해진 것은 "어느 폴더로 가는가, 또는 내보내지 않는가"다. 더 필요한가: 특정 기계를 빼기, 폰을 빼기, 보관 기간, 맞추지 않고 그 기계에만 두는 column(예: 이 기계의 창 위치), 예약 작업의 주인 기계.
4. **늘 켜 둠 표시가 하는 일.** 추천: 표시하면 그 기계의 lophn이 부팅 때 스스로 뜨고(OS 서비스 등록), agent가 주기 job과 폴더 옮기기를 그 기계에 건다.
5. **폰의 틈.** 컴퓨터가 전부 꺼져 있으면 폰이 쓴 것이 퍼지지 않는다. 그대로 두나, 보류한 Drive API를 여나.

## 순서

서로 기대지 않는 두 줄과 그 앞의 작은 바탕이다.

0. ~~**바탕**: 기계 id와 이름(폰에 이름이 주소 대신 보인다), 복제된 data root 알아채기(추천: 새 기계로 다룬다), 붙기 전에 판·capability·id를 알려 주는 공개 상태. 지금 폰 remote에도 바로 쓰인다.~~ 계획 `machine-identity`로 했다(`architecture/machine.md`, change-log `machine-identity`).
1. ~~**줄 1, 다른 기계 보기**: desktop이 다른 기계의 core에 기기로 pairing해 연다. 기계 고르기, 보는 쪽마다의 기본 기계.~~ 계획 `desktop-remote`로 했다(`architecture/remote.md`의 "desktop에서 다른 기계 보기", change-log `desktop-remote`). 다른 기계의 앱 화면은 띄우지 않는다(사람, 2026-11-16: 미룬 것이 아니라 하지 않는다).
2. ~~**줄 2, 앱 data 맞추기**: 변경을 폴더로 내놓고 읽어 들이기, 앱 선언의 정책, agent가 읽는 환경 정보와 폴더 옮기기 지침. 앱 release와 source를 폴더로.~~ 계획 `app-folder-sync`로 했다(`architecture/folder-sync.md`, change-log `app-folder-sync`).
3. ~~**project 신분**: 저장소 안 file, 두 겹 id, "이 기계에는 없음" 상태.~~ 계획 `project-identity`로 했다(`architecture/project-identity.md`, change-log `project-identity`, `project-identity-remote-view`). 다른 기계를 보는 창에서 같은 id의 project를 묶어 보이기와 [Clone here]도 그 계획의 마지막 task로 했다.
4. **늘 켜 둠**: OS 서비스 등록과 job의 주인 기계. (계획 `always-on`, 2026-11-16 끝남)
5. ~~**판이 다른 기계**: lophn 판과 앱 release가 기계마다 달라도 잃지 않고 말없이 틀리지 않기. 범위 밖이면 누가 올려야 하는지 보이기.~~ 계획 `machine-update`로 했다(`architecture/folder-sync-releases.md`, `architecture/activation.md`의 따라가기, `architecture/remote.md`의 hello, change-log `machine-update`).

미니 PC를 실제로 쓰려면 줄 1이 먼저다. 계획을 열기 전에 지금 code의 사실(sync가 "아무 기계끼리"를 어디까지 받치는지, remote client가 desktop에서 도는지, 기기 gate, project 표)을 조사한다.

## 조사

- `../harness-lab/_report/multi-device/README.md`: 조사 개요, 판정 표.
- `../harness-lab/_report/multi-device/comparison.md`: 주제별 비교와 권고.
- 하네스별 문서: happy, orca, t3code, paseo, emdash, herdr, hermes, mixdog, claude-code, codex, open-code, omp, others(dsh, pi, GooeyPi, BrowserOS, Antigravity, Nanobrowser, Skyvern, Stagehand, browser-use).

가까운 것: 다른 기계 보기는 Paseo와 mixdog, 이름과 기본 기계는 Hermes와 Orca, project 신분은 mixdog(저장소 안 file)과 Paseo·T3 Code(두 겹 id), git 자격은 Emdash(credential helper)와 Codex(git bundle로 넘기기). 앱 data를 맞추는 제품은 없다.
