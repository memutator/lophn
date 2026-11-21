# app file: 앱이 사진과 file을 둔다

상태: `feat/app-file` branch에 지었다(2026-11-22. 설계는 `architecture/app-file.md`, change-log `app-file`). 컴퓨터 쪽(protocol, core 저장, route, desktop `_files`, SDK)과 폰 쪽(file 자리, 사진·file 기능 넷, guest의 `locate`와 file 제한)을 모두 지었고 emulator와 headless Electron에서 보았다(2026-11-22: 컴퓨터에서 도는 앱의 사진이 desktop 화면에 보임, 선택기, 60 MiB 내려받기, preview, 폰에서 도는 앱의 offline 사용과 sync). 그 확인과 독립 review가 찾은 결함을 고쳤다(큰 조각이 기기 link에서 거절됨, 카메라 뒤 연결, 이미지 길의 cache 우회와 SVG image, 올릴 file 목록을 컴퓨터마다의 기록으로 바꿈). 고친 뒤의 폰 재확인과 실제 폰은 아직이다(아래 "확인하지 않은 것"). 이 문서의 나머지는 2026-11-22 사람이 폰 기능 단계 2를 진행하라고 한 뒤 planner가 쓴 로드맵이다. `(agent)`로 적은 것은 planner가 근거를 적어 정한 것이라 검수에서 뒤집을 수 있다.
배경 문서: `project-docs/products/roadmap/phone-capability.md`(단계 2), `project-docs/architecture/{app-call,app-sync,phone-screen,remote,folder-sync,activation}.md`.
조사: worker의 코드 조사(2026-11-22, main 0.23.120).

## 사람의 말 (원문)

2026-11-21(`phone-capability.md`):

> 그래서 제약없이 사용자의 니즈에 맞는 앱을 만들기 위한 가장 좋은 방향이 뭐라는건데

2026-11-22:

> 2단계 고쳐봐

## 왜

- 앱이 bytes를 둘 곳이 없다. 화면이 operation에 넘길 수 있는 입력은 64 KiB이고, 화면과 host 사이는 JSON뿐이고, 앱의 저장소는 SQLite 하나다. 그래서 사진 찍기, 사진·file 고르기, file 공유를 열 수 없다.
- "영수증을 찍어 가계부에 넣는 앱"이 지금은 만들 수 없는 앱이다.

## 지금 코드

- **앱 data.** 컴퓨터의 앱 data는 `<data root>/apps/<app>/data/`이고 든 것은 `app.sqlite`, lock, backup뿐이다(`packages/protocol/apps/app-storage.ts`의 `appDataFolder`). 앱만 쓰는 file 자리는 없다. `@lophn/cap-fs`는 사람의 file을 OS가 허락하는 대로 읽고 쓰는 것이고 폰 구현이 없다.
- **rewind와 backup은 DB row만 본다.** rewind는 호출마다 뜬 SQLite changeset을 거꾸로 적용한다(release를 건너지 않는다). activation의 backup은 `app.sqlite`만 뜬다. `data/` 안의 다른 file은 어느 쪽도 다루지 않는다.
- **큰 내용의 저장소는 blob store 하나다**(`packages/core/storage/blobs/`, 표 `blob_refs`). sha256으로 가리키고 1 GiB까지 받는다. 주인은 ledger row이고 지우기는 session 지우기와 `app.delete`의 erase window에서만 된다. 실제로 file을 지우는 GC는 core를 멈춘 정비 때만 돈다. 앱의 DB row가 blob을 가리키는 길은 없다.
- **입력과 기록.** `callOperation` 입력은 세 길(desktop view, 폰 guest, 폰의 local 호출) 모두 64 KiB이고 JSON 값이 손대지 않고 지나간다. invocation은 입력을 적지 않고 hash만 적는다. DB에 쓴 값은 changeset(8 MiB까지)에 든다.
- **desktop 화면.** `lophn-app://<앱 label>/<screen>/<asset>`만 열리고 bundle file만 내준다(`packages/shell/main/app-frame/app-protocol.ts`). main은 요청이 어느 view의 것인지 webContents로 안다. CSP는 `img-src 'self' data: blob:`, `media-src 'self' blob:`다. 내주는 content type은 목록(`SAFE_MEDIA_TYPES`)에 든 것뿐이고 pdf가 없다.
- **폰 화면.** guest의 그림은 network URI만 막는다(`packages/mobile/patches/@callstack+react-native-sandbox+0.7.0.patch`의 `GuestImageControllerBuilder`). `file:`과 `content:`는 막는 code가 없다. host가 guest마다 무엇을 묶어 주는 본보기는 `LophnAppDb`다(origin마다 DB file 하나를 `bind`한다).
- **폰의 저장.** 폰에서 도는 앱은 `Paths.document/apps/<app>/`(DB, release, `installed.json`)를 갖고, 컴퓨터에서 도는 앱은 화면 bundle cache만 갖는다. sync 앱의 폴더는 outbox가 비었을 때만 지운다(`packages/mobile/src/apps/local/prune.ts`).
- **폰과 컴퓨터 사이로 bytes가 가는 길.** 올리는 route는 모두 frame 하나에 5 MiB 이하다(`message-images/upload` 등). 조각(8 MiB)으로 나르고 이어 보내는 것은 `carry/put`인데 서명한 manifest에 든 폴더 file만 받는다. 내려받는 것은 file 하나 8 MiB(`REMOTE_FILE_MAX_BYTES`)이거나 `app_sync/snapshot_file`의 조각이다. 폰이 컴퓨터에 닿을 때까지 bytes를 쥐고 있는 장치는 SQLite outbox뿐이다.
- **폰의 native.** `expo-image-picker` 58.0.10이 있고 대화의 사진 붙이기가 쓴다(카메라와 시스템 사진 선택기, `quality: 0.8`, 결과는 앱 cache의 file). 문서 고르기(`expo-document-picker` 58.0.5), file 공유(`expo-sharing` 58.0.23)는 없다. `RECORD_AUDIO`는 `app.json`의 plugin 설정 둘이 막고 있다.
- **agent.** 앱의 backend는 agent나 model에 그림을 넘기지 못하고, 앱 화면은 그림 block에 쓸 blob을 올릴 길이 없다.

## 무엇을 만드나

### 앱 file과 손잡이

- 앱 file은 바뀌지 않는 bytes다. 이름은 내용의 sha256이다.
- 손잡이는 작은 JSON이다: `{file: <sha256>, type, size, name?, width?, height?}`. 화면, operation 입력과 출력, DB row를 그대로 지나간다. 같은 손잡이가 폰과 컴퓨터에서 같은 file을 가리킨다.
- 앱 file은 앱의 data다. 컴퓨터에서는 앱 data 폴더 안(`data/files/`)에, 폰에서 도는 앱은 폰의 앱 폴더 안에 둔다. 앱을 지우면 같이 지워진다. 앱만 쓰는 자리라 permission이 없다.
- 앱 file은 지우지 않는다(앱을 지울 때까지 남는다). 그래서 rewind가 되살린 row의 손잡이가 늘 살아 있고, backup은 DB만 떠도 되고, 폰과 컴퓨터의 file은 서로 없는 것을 채우기만 하면 같아진다.
- file 하나는 64 MiB까지다.

### 읽고 쓰는 곳

| 어디 | 무엇 |
|---|---|
| 컴퓨터의 backend | `@lophn/cap-store`가 file을 넣고(`bytes` → 손잡이) 읽는다. 자기 data 폴더를 직접 읽고 쓴다 |
| 폰에서 도는 backend | 손잡이를 받아 row에 둔다. bytes는 읽고 쓰지 못한다 |
| desktop 화면 | `lophn-app://<앱 label>/_files/<sha256>`로 그린다. main이 그 view의 앱 것만 core에서 받아 내주고, type은 넣을 때 적어 둔 것만 쓰고 html·script·svg로는 내주지 않는다 |
| 폰 화면 | 화면이 host에 손잡이를 주면 host가 그 file을 폰에 두고(없으면 컴퓨터에서 받는다) guest가 그릴 URI를 준다. guest는 자기 앱의 file 폴더 밖의 `file:`과 `content:`를 그리지 못한다 |

### 폰과 컴퓨터 사이

- 새 route 둘: 폰이 조각(8 MiB)으로 올리고 이어 보내는 것, 범위로 내려받는 것. 받는 쪽이 크기와 sha256을 확인한다.
- **컴퓨터에서 도는 앱.** 폰 기능이 file을 만들면 host가 컴퓨터에 올린 뒤 손잡이를 답한다. 컴퓨터에 닿지 않으면 `unavailable`이고 file은 버린다(그 앱은 어차피 컴퓨터 없이 저장하지 못한다). 폰에는 cache만 남는다.
- **폰에서 도는 앱.** file은 폰의 앱 폴더에 남고 손잡이는 바로 나온다. 컴퓨터에도 도는 앱이면 올릴 file의 목록을 폰에 두고 닿을 때 올린다(row의 변경보다 먼저). 그 목록이 비지 않은 앱의 폴더는 지우지 않는다. 폰에서만 도는 앱의 file은 폰에만 있다(그 앱의 DB와 같다).

### 여는 폰 기능 (모두 화면 길, 사람의 손이 든다)

| 기능 | 답 |
|---|---|
| `camera.capture` | 찍은 사진의 손잡이 하나, 또는 취소 |
| `photos.pick` | 고른 사진의 손잡이들(10개까지), 또는 취소. 시스템 사진 선택기라 OS 권한이 없다 |
| `files.pick` | 고른 file의 손잡이들, 또는 취소 |
| `share.file` | 손잡이의 file을 OS 공유 sheet로 보낸다 |

- 사진은 `quality: 0.8`로 다시 압축해 넣는다(대화의 사진 붙이기와 같다).
- preview는 stand-in이다: 고정된 sample 그림과 sample 글 file의 손잡이를 답하고, 그 둘은 어느 쪽에서 읽어도 내준다.

## 정한 것

- 폰 기능 단계 2를 진행한다. (사람, 2026-11-22)
- 앱 file은 blob store가 아니라 앱 data 폴더의 file로 둔다. 이유: 앱 file은 앱의 data이고 `app.sqlite` 옆이 그 자리다(앱을 지우면 같이 없어지고 schema step이 없다). blob store는 주인이 ledger row이고 지우기가 erase window와 멈춘 정비에 묶여 있어 앱의 DB row가 가리키는 file에 맞지 않는다. (agent)
- 이름은 내용의 hash다. 이유: 폰과 컴퓨터가 id를 맞출 필요가 없고 나른 것을 받는 쪽이 확인한다. (agent)
- 지우지 않는다. 이유: 지우기가 있으면 rewind가 되살린 row의 그림이 깨지고, 폰과 컴퓨터 사이에 "지웠다"를 맞춰야 한다. 지우지 않으면 셋(rewind, backup, sync)이 모두 따로 할 일이 없다. 잃는 것은 용량이고, 사람이 앱에서 지운 사진의 bytes도 앱을 지울 때까지 디스크에 남는다. 나중에 정리를 더해도 계약이 바뀌지 않는다(release가 바뀔 때 DB가 가리키지 않는 file을 치우면 rewind와 부딪히지 않는다. rewind는 release를 건너지 않는다). (agent)
- 컴퓨터에서 도는 앱의 폰 기능은 올린 뒤에 답한다. 이유: 손잡이를 받은 backend가 바로 읽을 수 있어야 하고, 폰에 "아직 안 올라간 file"의 상태를 두지 않는다. 버린 안: 먼저 답하고 나중에 올리기(backend가 없는 file을 읽는다). (agent)
- backend의 file API는 `@lophn/cap-store`에 둔다. 이유: 앱 data의 part이고 모든 앱이 이미 쓴다. 새 part를 만들면 앱마다 의존을 더해야 한다. (agent)
- desktop 화면은 `_files` path로 그린다. 이유: main이 이미 요청의 view를 알고 CSP의 `'self'`에 든다. 화면에 base64를 넘기는 길은 목록 화면에서 무겁다. (agent)
- guest에 file을 그리게 하면서 guest의 `file:`과 `content:`를 자기 앱의 폴더로 좁힌다. 이유: 지금은 막는 code가 없다. (agent)
- 이번에 여는 것은 넷이다(위 표). 녹음과 재생, 사진 보관함에 저장, 클립보드 그림은 `phone-capability.md`의 단계 3으로 넘긴다. 이유: 녹음은 `RECORD_AUDIO`와 녹음 화면이 따로 들고, 보관함 저장은 저장소 권한을 manifest에 더한다. file 자리가 서면 이것들은 기능 하나씩이다. (agent)

- 폰에서 도는 sync 앱의 file은 컴퓨터마다 그 컴퓨터가 가진 file의 기록을 폰에 두고, 컴퓨터에 가야 할 것은 폴더에서 그 기록을 뺀 것이다. 이유: 처음 모양(앱 폴더 하나의 "올릴 file 목록"과 한 컴퓨터가 받으면 항목을 지움)은 컴퓨터 둘이면 둘째가 file을 못 받은 채 그것을 가리키는 row를 받고, 목록 file이 깨지면 가짜 항목이 진짜를 가려 폴더를 영영 못 지우며, 긴 올리기 중에 더한 file이 row보다 뒤에 가고, 영영 못 올리는 file 하나가 sync 전체를 막았다. (agent, 2026-11-22, review)
- 컴퓨터에서 도는 앱의 사진은 올리기 전에 지금의 연결을 60초까지 기다리고 끊기면 이어 올린다. 이유: 카메라와 선택기가 열린 동안 폰 앱은 뒤에 있어 연결이 끊기는 것이 설계라 돌아온 순간의 "연결 없음"으로 file을 버리면 대부분 사라진다(emulator에서 본 실패). (agent, 2026-11-22, 장치 확인)
- guest의 이미지는 요청을 쥔 controller를 만들기 전에 검사하고 SVG의 image는 guest에 주지 않는다. 이유: Fresco의 bitmap cache는 process 전체이고 URI로 찾으며 controller는 data source보다 cache를 먼저 보므로 data source 쪽 검사는 다른 guest가 이미 그린 file을 막지 못했고, `react-native-svg`의 image는 Fresco를 직접 불러 검사를 지나지 않는다. (agent, 2026-11-22, review)

## 단계

1. 폰 화면이 뒤로 갔다 와도 남게 한다(이슈 `phone-guest-remounts-after-background`). 카메라와 고르기는 다른 activity로 나갔다 오므로 이것이 먼저다.
2. 앱 file 자리와 기능 넷. 한 줄로 한다: protocol의 손잡이와 route, core의 저장, shell의 `_files`, 폰 host, SDK가 서로 기댄다.

## 하지 않는 것

- 지우기와 용량 한도, 앱마다의 용량 보기.
- 기계 사이로 맞추는 앱(선언의 `sync`가 표를 보내는 앱)의 file을 다른 컴퓨터로 옮기는 것. `sync`에 적은 표의 row는 가고 file은 가지 않아 다른 컴퓨터에서는 그림이 비어 보인다. 폴더 꼴(`folder-sync.md`)에 file을 더하는 일이라 따로 한다.
- desktop 화면에서 file을 넣는 것(끌어 놓기, 고르기). desktop의 backend는 넣을 수 있다.
- 앱이 agent나 model에 사진을 넘기는 것. "영수증을 읽는 agent"는 이 길이 있어야 한다. 다음 후보다.
- 영상, 녹음, 폰에서 도는 backend가 bytes를 읽는 것.
- 사진을 찍는 동안 Android가 폰 앱을 죽였을 때 결과를 되찾는 것(`ImagePicker.getPendingResultAsync`).
- background, 배포 형식, iOS(`phone-capability.md`와 같다).

## 확인하지 않은 것

지은 뒤 상태(2026-11-22). 위는 짓기 전의 물음이고, 지은 뒤에는 이렇다.

- 지었고 emulator release APK에서 build되어 돌았다(2026-11-22): guest의 이미지 길을 sandbox patch의 prop 하나(`imageFolder`)로 좁혔다. 이 라운드는 controller의 검사를 요청을 쥔 `build()` 앞으로 옮기고(Fresco 3.7.0에 대해 compile만 확인) SVG image를 guest에서 뺐다. `expo-document-picker` 58.0.5와 `expo-sharing` 58.0.23은 Android manifest에 sharing의 FileProvider와 queries만 더한다(plugin은 더하지 않았다).
- 폰에서 다시 확인할 것(`architecture/app-file.md`의 열린 것): 큰 file의 올리기(고친 body 한도), 카메라에서 돌아온 뒤의 올리기, 문서 선택, core를 올리는 도중 멈췄다 켜기, 다른 guest가 이미 그린 file을 다른 앱이 그리지 못하는 것(cache), SVG image의 file·https·content, 컴퓨터가 꺼진 동안 "아직 안 맞춘 것" 수, 컴퓨터 둘.
- 여전히 모르는 것: 큰 file(수십 MiB)의 조각 올리기·내려받기의 시간과 메모리, relay를 거칠 때의 속도, desktop의 `_files`가 큰 media를 Range 없이 내줘도 쓸 만한지, 카메라 activity 동안 Android가 폰 앱을 죽이면 결과를 잃는 일의 빈도.

아래는 짓기 전에 적은 물음이다.

- guest의 그림 길에 origin마다의 폴더를 묶는 native 변경(sandbox patch)이 얼마나 드는지. `LophnAppDb`의 `bind`가 본보기다.
- `expo-document-picker`와 `expo-sharing`이 Android manifest에 더하는 것과 실제 동작. 조사는 설치하지 않고 registry의 설명만 보았다.
- 큰 file(수십 MiB)을 폰이 조각으로 읽어 올릴 때의 memory와 시간, relay를 거칠 때의 속도.
- desktop의 `_files`가 큰 media(음악, pdf)를 Range 없이 내줘도 쓸 만한지.
- 실제 폰.
