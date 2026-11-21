# app file

앱 file은 앱이 사진이나 고른 file 같은 bytes를 두는 자리다. 이름은 내용의 sha256이고 한 번 놓으면 바뀌지 않는다. file은 앱의 data 영역에 있고(컴퓨터에서 도는 앱은 컴퓨터에, 폰에서 도는 앱은 폰에), 화면과 operation과 DB row에는 file을 가리키는 작은 JSON인 손잡이(handle)만 지나간다. 폰의 카메라, 사진·file 선택기, 공유가 이 file을 만들고 쓰고, 컴퓨터의 backend는 SDK로 읽고 쓰며, 화면은 주소로 그린다.

## 문제

- 앱이 bytes를 둘 곳이 없었다. 화면이 operation에 넘길 수 있는 입력은 64 KiB이고, 화면과 host 사이는 JSON뿐이고, 앱의 저장소는 SQLite 하나였다. 그래서 사진 찍기, 사진·file 고르기, file 공유를 앱에 열 수 없었다. "영수증을 찍어 가계부에 넣는 앱"을 만들 수 없었다.
- bytes를 DB에 넣으면(BLOB 칸) 목록 읽기, sync log, rewind의 changeset이 모두 그 bytes를 끌고 다닌다. 호출 하나의 변경에는 8 MiB 상한도 있다.
- 사람이 고른 file이 앱 화면의 자원처럼 돌면(html, script, svg로 내주면) 앱 origin에서 코드가 되고, 폰의 guest가 임의의 `file:`·`content:`를 그릴 수 있으면 다른 앱의 data를 읽는다. 사람이 쓴 글이 아니라 AI가 만든 앱 코드와 인터넷에서 온 것을 막아야 한다.
- 폰에서 만든 사진이 컴퓨터에서 도는 앱의 backend에 닿지 못하면 앱이 그 사진을 저장하지 못한다. 폰에서 도는 앱의 사진은 컴퓨터가 꺼져도 있어야 하고, 컴퓨터에 닿으면 컴퓨터에서도 보여야 한다.

## 목표와 비목표

- 목표: 앱이 file을 두고, 같은 손잡이가 폰과 컴퓨터에서 같은 file을 가리키며, 화면이 그것을 그린다. rewind, activation의 복구본, 폰과 컴퓨터의 맞추기가 file 때문에 새로 할 일이 없다. 앱 file의 길에 lophn의 permission이 따로 없다(앱 자신의 data라서).
- 목표: 컴퓨터에서 도는 앱의 사진·file 기능은 컴퓨터가 받은 뒤에만 손잡이를 낸다. backend가 받은 손잡이는 곧바로 읽힌다.
- 비목표(일부러 하지 않는다):
  - **지우기, 용량 한도, 정리.** file은 앱을 지울 때까지 남는다. 이유는 "결정".
  - **기계 사이로 맞추는 앱(선언의 `sync`가 표를 보내는 앱)의 file을 다른 컴퓨터로 옮기기.** `sync`에 적은 표의 row는 가고 file은 가지 않아 다른 컴퓨터에서는 그림이 비어 보인다. 적지 않은 표의 row는 어차피 이 컴퓨터에 머문다. 폴더 꼴(`folder-sync.md`)에 file을 더하는 일이라 따로 한다.
  - desktop 화면에서 file 넣기(끌어 놓기, 고르기). desktop의 backend는 넣을 수 있다.
  - 영상, 녹음, 사진 보관함에 저장, 클립보드 그림, 앱이 agent나 model에 사진을 넘기기, 폰에서 도는 backend가 bytes를 읽고 쓰기.
  - 사진을 찍는 동안 Android가 폰 앱을 죽였을 때 결과를 되찾기.

## 모델

- **앱 file.** 바뀌지 않는 bytes다. 이름은 sha256(소문자 16진 64자)이다. 같은 bytes는 한 file이다. 한 file은 64 MiB까지다.
- **손잡이.** `{file, type, size, name?, width?, height?}` 하나다. `file`은 sha256, `type`은 content type(127자까지), `size`는 bytes 수, `name`은 255자까지, `width`·`height`는 사진의 양의 정수다. 화면, operation의 입력과 출력, DB row(JSON 글)를 그대로 지나가고 폰과 컴퓨터에서 같은 file을 가리킨다. 손잡이가 type과 name을 싣고 file 자리는 이 둘을 따로 모르는 곳이 있다(폰).
- **file 자리.**
  - 컴퓨터: 앱 data 영역(`<data root>/apps/<앱>/data/`) 안의 `files/`. `files/<sha256 앞 두 글자>/<sha256>`에 bytes, 옆의 `<sha256>.json`에 올 때 적은 `{type, size, name?}`. 이 sidecar가 있어야 있는 file이다. 끝나지 않은 조각과 쓰는 중인 file은 `files/_staging/`에 hash와 겹치지 않는 이름으로 둔다. ledger에는 표도 schema step도 blob 참조도 없다.
  - preview: preview의 일회용 data 영역이 같은 모양의 `files/`를 갖고, 영역을 만들 때 sample file 둘(64x64 한 색 PNG, 짧은 글)을 넣어 둔다. 읽는 쪽에 preview를 따로 다루는 갈래가 없다.
  - 폰, 컴퓨터에서 도는 앱: 컴퓨터와 앱마다 폰의 cache folder(`<두 글자>/<sha256>`과 sidecar, preview는 따로). OS가 거둘 수 있어 그 안의 것은 유일한 사본이 아니다.
  - 폰, 폰에서 도는 앱: 앱 폴더 안 `files/`(같은 모양과 sidecar). 앱의 data라서 앱 폴더와 함께 지워진다. sync 앱은 컴퓨터마다 그 컴퓨터가 가진 file의 기록(`held/<컴퓨터>.json`)을 앱 폴더에 둔다(`app-sync.md`).
- **쓰는 길.** (1) 컴퓨터의 backend가 SDK의 `putAppFile`로 직접. (2) 폰이 `app_files/put`으로 조각을 올려서. 두 쪽이 같은 규칙으로 쓴다: 임시 이름으로 쓰고, 끝나면 sha256과 크기를 확인한 뒤 rename으로 놓고 sidecar를 마지막에 놓는다. 한 번 놓은 file은 다시 쓰지 않는다. 그래서 두 쪽이 같은 file을 같이 받아도 서로 깨지 않는다.
- **읽는 길.** (1) 컴퓨터의 backend가 `readAppFile`. (2) 폰이 `app_files/read`로 범위를 받아서. (3) desktop 화면이 `lophn-app://<앱>/_files/<sha256>`로. (4) 폰 화면이 host에 `lophnApp.files.locate`를 묻고 host가 준 URI로.
- **폰 기능 넷.** `camera.capture`(카메라로 한 장), `photos.pick`(시스템 사진 선택기, 1~10장), `files.pick`(시스템 file 선택기, content type이나 `image/*` 무늬 10개까지, 1~10개), `share.file`(앱 file을 OS 공유 sheet로). 모두 화면 길 전용이고 사람의 손이 든다(deadline 600초). 앞 셋은 취소하면 `cancelled`, 아니면 손잡이를 답한다. bytes는 답하지 않는다. 사진은 JPEG 품질 0.8로 다시 압축해 넣는다. 한 file이 64 MiB를 넘으면 `invalid_input`이다.

## 지키는 것

1. 앱 file은 한 번 놓으면 바뀌지 않고 지워지지 않는다(앱을 지울 때 앱 폴더와 함께 없어지는 것 말고). 그래서 rewind가 되살린 row의 손잡이는 늘 살아 있고, activation의 복구본은 DB만 떠도 되고, 폰과 컴퓨터는 서로 없는 file을 채우기만 하면 같아진다.
2. file은 sha256과 크기가 이름과 맞을 때만 보인다. 올리는 쪽도(컴퓨터가 완성한 file을 확인), 내려받는 쪽도(폰이 확인) 맞지 않으면 쥔 bytes를 버리고 읽히는 file이 남지 않는다.
3. `app_files/put`의 `offset`은 받은 bytes와 정확히 같을 때만 잇는다. 어긋나면 `invalid_input`과 `details.received`로 쥔 bytes를 알리고 보낸 쪽이 거기서 다시 보낸다. 이미 완성한 file의 put은 아무것도 쓰지 않고 `have`다.
4. 앱 file은 그 앱의 것만 읽힌다. 다른 앱의 file은 이 앱의 자리에 없으므로 `not_found`이고, preview 대상은 그 preview의 영역만 읽는다(운영 앱의 file이 preview로 새지 않는다).
5. desktop 화면은 자기 view의 앱 file만 받는다. 앱과 대상(release, preview nonce, 기계)은 shell main이 view에서 정하고 주소에서는 hash만 읽는다. `_files` 밖의 모양은 404다. 화면 key는 `_files`가 될 수 없다.
6. `_files`가 내주는 content type은 이미지, 소리·영상, pdf, 글의 허용 목록에 있을 때만 쓰고 나머지는 `application/octet-stream`이다. html, script, css, xml, svg는 적힌 type이 무엇이든 나가지 않는다(사람이 고른 file이 앱처럼 돌지 않는다). `nosniff`와 CSP는 다른 화면 byte와 같다.
7. 폰의 guest가 닿는 file은 그 guest의 file 자리뿐이다. host가 guest마다 자리의 folder 하나를 sandbox의 이미지 길에 알린다(guest를 mount하기 전에). 이미지 view는 요청을 쥔 controller를 만들기 전에 그 요청 전부(본 요청, 저해상도 요청, 첫 번째로 되는 요청 목록)를 본다: 그 folder 밖의 `file:`(`..`와 symlink를 푼 뒤), 모든 `content:`, 모든 network 주소는 요청을 지우고 실패만 하는 controller를 만든다. 이미지 view들이 builder 하나를 같이 쓰고 Fresco의 `reset()`이 data source supplier는 지우지 않으므로, 실패 controller를 만든 뒤 builder에서 supplier를 다시 치운다(builder는 build마다 supplier 없이 시작하고 끝난다. 그렇지 않으면 다음 이미지의 build가 Fresco의 검사에 걸려 guest가 죽었다). 그래서 Fresco의 bitmap memory cache(process 전체, URI로 찾는다)가 다른 guest나 host가 이미 그린 그림을 대신 내줄 수 없다: controller는 cache key를 요청에서 얻는데 요청이 없다. 알리지 않은 guest는 어떤 `file:`도 그리지 못한다. `data:`는 그려진다. `react-native-svg`의 `Image`는 guest에 없다(view manager를 주지 않고 JS의 `Image`도 빼서 쓰는 화면은 처음부터 실패한다. 그것이 Fresco를 직접 불러 이 검사를 지나지 않기 때문이다).
8. 컴퓨터에서 도는 앱의 사진·file 기능은 컴퓨터가 받은 뒤에만 손잡이를 답한다. 폰 앱이 뒤에 있던 동안 컴퓨터와의 연결은 끊기므로(카메라와 선택기가 그렇다) 올리기 전에 지금의 연결을 60초까지 기다리고, 올리다 끊기면 컴퓨터가 쥔 bytes(`received`)에서 잇는다. 그래도 안 되면 `unavailable`이고 방금 놓은 bytes를 지운다(손잡이도 남는 bytes도 없다). `reason`이 어느 쪽인지 말한다: `no_connection`(60초 안에 연결이 없었다), `transfer_broken`(올리다 끊기기를 되풀이했다), `refused`(컴퓨터가 받지 않았다. 그 말이 message에 든다).
9. 폰에서 도는 sync 앱의 file은 폰에 놓고 손잡이를 바로 답한다. 컴퓨터마다 그 컴퓨터가 가진 file의 기록을 두고(`stored`나 `have`로 답한 것, 영영 거절한 것), 그 컴퓨터에 가야 할 것은 폴더에서 기록을 뺀 것이다. sync에서는 그 컴퓨터에 file이 row보다 먼저 가고, 한 컴퓨터가 받았다고 다른 컴퓨터의 몫이 없어지지 않는다. 설치된 어느 컴퓨터가 file 하나라도 빠뜨리고 있는 앱 폴더는 지우지 않는다(거절한 file은 뺀다).
10. 앱 file route와 폰 기능은 앱 자신의 data를 다루는 길이라 lophn의 permission이 따로 없다. 폰 기능은 앞서처럼 `phone.use`의 기능마다 선언과 동의가 있다.

## 경계와 계약

- boundary: `app-data`(앱 file 자리와 route), `app-runtime`(앱 처리기, preview 영역), `mobile`(폰의 file 자리, 폰 기능 handler, guest의 `locate`), `sdk-api`(`@lophn/cap-store`, `@lophn/cap-phone`, `@lophn/app-ui`, `@lophn/app-ui-native`), `remote-protocol`(기기 route 목록), `shell`(`_files`와 preload의 `lophnApp.files`).
- route(모두 memory, 사람 자격):
  - `app_files/read {target, file, offset, length}` → `{type, size, name?, bytes_base64}`. `target`은 운영 `{mode: live, app, release}`(file은 release에 묶이지 않아 release는 보지 않는다)이거나 preview `{mode: preview, app, process_nonce}`다. `length`는 8 MiB까지. `size`는 file 전체의 크기이고 bytes는 요청한 범위다. 오류: `not_found`(없는 앱, 그 대상의 자리에 없는 file, 멈춘 preview).
  - `app_files/put {app, file, size, type, name?, offset, bytes_base64}` → `{status: stored|partial|have, received}`. 조각은 8 MiB까지(이 route는 JSON body 한도를 기본 256 KiB 대신 조각 상한의 base64만큼으로 키운다. 한도는 body를 읽는 곳이 정하므로 기기 link도 같다). 빈 조각은 묻기다: 아무것도 쓰지 않고 `have`나 `partial`(쥔 bytes)로 답해 보내는 쪽이 이미 있는 file의 bytes를 보내지 않는다. 운영 앱만이다(preview에는 put이 없다). 오류: `invalid_input`(크기 초과, 이어지지 않는 offset, 조각이 size를 넘음, 다 찬 file의 sha256·크기가 맞지 않음), `not_found`(없거나 보관한 앱), `unavailable`(이 컴퓨터에 그 앱의 data 영역이 없다: 폰에서만 도는 앱).
  - 둘 다 기기 route 목록에 있다(`remote.md`). 폰이 부르고, 다른 컴퓨터의 창에 뜬 이 기계의 앱 화면도 `read`를 부른다.
  - 변경 이름(`changes`/`reads`)은 없다: file은 바뀌지 않아 다시 읽을 일이 없다.
- desktop: `lophn-app://<앱 label>/_files/<sha256>`. 화면의 `lophnApp.files.locate(sha256)`는 IPC 없이 `/_files/<sha256>`로 바로 풀고 hash 모양이 아니면 `invalid_input`으로 reject한다. main은 `app_files/read`를 4 MiB 조각으로 불러 전체를 stream으로 낸다. 다른 기계의 앱도 같은 route를 `machines/call`로 부른다: file route와 달리 한 번에 한 조각이라 file 하나가 8 MiB를 넘어도 된다(조각 하나는 base64로 frame 하나에 든다). Range 요청은 받지 않는다.
- 폰 화면: guest의 `locate` 메시지와 `lophnApp.files.locate`(`PHONE_BASE_FORMAT` 5). host가 같은 `reply`로 `{uri}`를 준다. 폰에 file이 없으면 닿는 컴퓨터에서 `app_files/read`로 1 MiB 조각씩 받아(메모리가 file 크기와 상관없이 일정하다) 이름과 맞을 때만 자리에 놓는다(컴퓨터에서 도는 앱은 연결을 60초까지 기다리고 끊기면 받은 bytes에서 잇는다). 컴퓨터가 `not_found`면 `not_found`, 닿는 컴퓨터가 없으면 `unavailable`이다. 폰에서 도는 sync 앱은 그 앱을 아는 어느 컴퓨터에서든 받는다.
- 폰 기능 표와 허락은 `remote.md`, guest와 host는 `phone-screen.md`, 폰의 올리기 목록은 `app-sync.md`.
- SDK: `@lophn/cap-store`의 `putAppFile(bytes, {type, name?})`(손잡이를 돌려준다), `readAppFile(손잡이나 sha256)`(없으면 `not_found`), `hasAppFile`. 폰에서 도는 backend는 세 함수 모두 `unavailable`이다(손잡이를 row에 두고 넘길 뿐). `@lophn/cap-phone`의 `capturePhoto`, `pickPhotos`, `pickFiles`, `shareFile`. 화면은 `@lophn/app-ui`, `@lophn/app-ui-native`의 `useAppFile(손잡이)`(`loading`·`ready{uri}`·`failed{code}`).
- 저장 모양의 의미: sidecar는 `type`, `size`, `name?`뿐이고 읽기는 sidecar가 있는 file만 있는 것으로 본다. 끝나지 않은 조각은 한 시간 뒤 같은 앱의 다음 put이 지운다(timer와 job은 없다).

## 결정

- 앱 file은 blob store가 아니라 앱 data 영역의 file로 둔다. 이유: 앱 file은 앱의 data이고 `app.sqlite` 옆이 그 자리다(앱을 지우면 같이 없어지고 schema step이 없다). blob store는 주인이 ledger row이고 지우기가 erase window와 멈춘 정비에 묶여 있어 앱의 DB row가 가리키는 file에 맞지 않는다. (agent)
- 이름은 내용의 hash다. 이유: 폰과 컴퓨터가 id를 맞출 필요가 없고 나른 것을 받는 쪽이 확인한다. 같은 사진을 두 번 넣어도 하나다. (agent)
- 지우지 않는다. 이유: 지우기가 있으면 rewind가 되살린 row의 그림이 깨지고 폰과 컴퓨터 사이에 "지웠다"를 맞춰야 한다. 지우지 않으면 rewind, backup, sync가 모두 따로 할 일이 없다. 잃는 것은 용량이고, 사람이 앱에서 지운 사진의 bytes도 앱을 지울 때까지 디스크에 남는다. 나중에 정리를 더해도 계약이 바뀌지 않는다(release가 바뀔 때 DB가 가리키지 않는 file을 치우면 rewind와 부딪히지 않는다). (agent)
- 컴퓨터에서 도는 앱의 폰 기능은 올린 뒤에 답한다. 이유: 손잡이를 받은 backend가 바로 읽을 수 있어야 하고, 폰에 "아직 안 올라간 file"의 상태를 두지 않는다. 컴퓨터에 닿지 못하면 `unavailable`이고 file은 버린다(그 앱은 어차피 컴퓨터 없이 저장하지 못한다). 버린 안: 먼저 답하고 나중에 올리기(backend가 없는 file을 읽는다). (agent)
- 폰에서 도는 sync 앱은 먼저 답하고, 컴퓨터마다 그 컴퓨터가 가진 file의 기록을 폰에 둔다. 이유: 그 앱은 컴퓨터 없이 쓰이는 앱이라 올릴 때까지 기다리면 쓸 수 없고, 컴퓨터에 가야 할 것은 "폴더의 file에서 그 컴퓨터가 받았다고 한 것을 뺀 것"이라 따로 쌓아 둔 상태가 없다. 버린 안: 앱 폴더 하나의 "올릴 file 목록"(항목은 한 컴퓨터가 받으면 지워졌다). 이유 넷: (1) 컴퓨터 둘이 같은 앱을 sync하면 둘째는 file을 못 받은 채 그 file을 가리키는 row를 받는다. (2) 목록 file이 깨지면 가짜 항목이 진짜 항목을 가리고 영영 비우지 못해 폴더를 지우지 못한다. (3) 긴 올리기 도중에 더한 file이 그것을 가리키는 row보다 뒤에 갔다. (4) 영영 올라가지 못하는 file 하나가 앱의 sync 전체(pull 포함)를 막았다. 기록은 임시 이름으로 써서 옮기고, 읽지 못하면 아무것도 확인받지 못한 것으로 보아 전부를 다시 내밀며 컴퓨터가 `have`로 답한다. (agent, 2026-11-22)
- 컴퓨터에서 도는 앱의 사진·file은 올리기 전에 지금의 연결을 60초까지 기다리고 끊기면 이어 올린다. 이유: 카메라와 선택기가 열린 동안 폰 앱은 뒤에 있어 컴퓨터와의 연결이 끊기는 것이 설계이고(`remote.md`) 돌아온 순간 연결이 없다고 file을 버리면 사진이 대부분 사라진다. 60초는 돌아와 다시 이어지는 시간을 덮고, 컴퓨터를 꺼 둔 사람이 화면을 보는 동안 알려 줄 만큼 짧다. 버린 안: 연결이 없으면 바로 `unavailable`(처음 모양, 카메라 뒤 대부분 실패했다), 폰에 쌓아 두었다 나중에 올리기(폰에 "아직 안 올라간 file" 상태가 생기고 backend가 없는 file을 읽는다). (agent, 2026-11-22)
- 앱 file의 route `app_files/put`이 body 한도를 route 정의에서 키운다(`body_max_bytes`). 이유: 한도는 body를 읽는 dispatch가 정하므로 handler와 schema만 보는 test는 기기 link가 256 KiB를 넘는 조각을 거절하는 것을 보지 못했고(처음 모양은 190 KB 넘는 file이 모두 실패했다), route가 한도를 갖는 것이 어느 길(HTTP, 기기 link)이든 같게 한다. (agent, 2026-11-22)
- backend의 file API는 `@lophn/cap-store`에 둔다. 이유: 앱 data의 part이고 모든 앱이 이미 쓴다. 새 part를 만들면 앱마다 의존을 더해야 한다. SDK는 protocol과 core를 import하지 못하므로 자리 규칙과 손잡이 모양의 사본을 두고, 두 쪽이 서로의 file을 읽는지와 한도가 같은지 test가 본다. (agent)
- desktop 화면은 `_files` 경로로 그린다. 이유: main이 이미 요청의 view를 알고 CSP의 `'self'`에 든다. 화면에 base64를 넘기는 길은 목록 화면에서 무겁다. 한 요청에서 앱을 고르는 칸이 주소에 없어 다른 앱 file을 부를 길이 없다. (agent)
- guest의 이미지를 file 자리 folder 하나로 좁힌다(guest마다 sandbox view의 prop 하나). 이유: 앱 file을 그리려면 `file:`을 열어야 하는데 sandbox는 `file:`과 `content:`를 막지 않았다. 알리지 않으면 아무 file도 그리지 않는 쪽을 기본으로 했다. 버린 안: file을 `data:` 주소로 주기(큰 사진이 JS 문자열이 된다. 이 patch가 작아서 쓰지 않았고 안 되면 물러설 길이다). (agent)
- 폰 file 자리에 sidecar를 두지 않는다. 이유: 손잡이가 type과 name을 싣고, 내려받을 때 size는 컴퓨터의 답이 알려 주며 sha256은 이름이다. (agent)
- 이번에 여는 폰 기능은 넷이다. 녹음과 재생, 사진 보관함에 저장, 클립보드 그림은 `phone-capability.md`의 단계 3으로 넘긴다. 이유: 녹음은 `RECORD_AUDIO`와 녹음 화면이 따로 들고, 보관함 저장은 저장소 권한을 manifest에 더한다. file 자리가 서면 이것들은 기능 하나씩이다. (agent)
- 폰 기능 2단계(앱 file 자리와 기능 넷)를 진행한다. (사람, 2026-11-22)

## 열린 것

- **확인한 것**(2026-11-22. 폰은 emulator, desktop은 headless Electron). 기기 재확인(emulator)에서 본 것: 190 KB·1 MiB·8 MiB·60 MiB 올리기(2.5·4.1·9.1·49초, 메모리 일정, sha256과 sidecar가 맞고 손잡이는 올린 뒤에만 옴), 다른 activity에 40초 머문 뒤의 촬영과 문서 선택, core를 끈 채 60초 뒤 `no_connection`, 60 MiB 올리기가 core를 다시 켠 뒤 51 MiB에서 이어짐, cache를 먼저 채운 isolation probe(한쪽 5번 중 5번, 다른 쪽 3번 중 3번 거절), 폰에서 도는 sync 앱(file이 row보다 40~95 ms 먼저), 두 preview, 공유 이름, 릴리스 build에서 Kotlin·Java compile. 그 재확인이 찾은 것(막힌 이미지 뒤에 다음 이미지가 mount되면 guest가 죽음, `react-native-svg` 기본 import, 5분 넘게 카메라에 머문 뒤 guest가 새로 뜸)은 고쳤고 기기에서 다시 확인해야 한다. 이전에 본 것: 컴퓨터에서 도는 앱의 사진 찍기 → 컴퓨터의 file이 sha256과 sidecar가 맞게 생김 → desktop 화면의 `<img>`에 보임. 시스템 사진 선택기와 file 선택기. 컴퓨터에서 60 MiB를 내려받기(37초, 메모리 일정)와 desktop `_files`로 60 MiB(0.8초). `_files`의 200, 404, `application/octet-stream` 동작. desktop과 폰의 preview(sample file). 폰에서 도는 앱: 컴퓨터 없이 찍고 나중에 sync, standalone. 카메라와 선택기가 열린 동안 guest가 그대로 남는 것. 그 뒤 이 라운드가 고친 것(큰 조각이 기기 link에서 거절되던 body 한도, 카메라에서 돌아온 뒤의 연결, 이미지 길의 cache 우회와 SVG image)은 이 라운드의 test로 보았고 폰에서 다시 확인해야 한다.
- **확인하지 못한 것:** 실제 폰. 큰 file의 올리기(이 라운드가 body 한도를 고치기 전까지 큰 조각은 기기 link에서 거절되었다). 컴퓨터 둘에 같은 sync 앱을 쓰며 file이 각각 가는 것, 읽지 못하는 기록, 영영 거절하는 file, prune은 기기에서 돌려 보지 않았다(단위 test로만 보았다). 소리·영상. cache를 OS가 거둔 뒤 다시 받기. core를 올리는 도중 멈췄다 켜기.
- 카메라나 선택기가 다른 activity로 나가 있는 동안 Android가 폰 앱을 죽이면 결과를 잃는다(`ImagePicker.getPendingResultAsync`로 되찾는 길은 열지 않았다). 5분 넘게 닿지 않으면 guest가 새로 뜨는 규칙(`phone-screen.md`)이 길게 걸린 선택과 만나는지 본다.
- guest의 `react-native-svg`는 이름 import만 지원한다. 기본 import를 컴포넌트로 만드는 wrapper는 기기에서 `<Svg>`를 깨서(`Element type is invalid ... boolean`, 이름 import도 같이) 되돌렸고, Node에서 실제 라이브러리 source로 돌려 본 harness(기본·이름 import, `"type": "module"` 둘 다)에서는 재현하지 못해 원인을 찾지 못했다. 기본 import는 release 준비가 거절한다.
- `sync`가 표를 보내는 앱의 file은 다른 컴퓨터로 가지 않는다(위 비목표). `sync`에 적은 표의 row가 file 이름을 담으면 다른 컴퓨터 화면은 그림이 비어 보인다.
- desktop의 `_files`는 이미지와 PDF 링크만 확인했다. 소리·영상은 약속하지 않는다: `lophn-app` scheme에 stream 권한이 없고 Range 요청을 받지 않는다. heic와 heif는 허용 목록에 있으나 Chromium이 그리지 못한다.
- 폰의 cache와 임시 file(공유 sheet로 보내려고 이름을 되살려 복사한 것, 선택기가 cache에 둔 것)은 OS가 거둘 때까지 남는다.
- 지우기와 용량 한도, 앱마다의 용량 보기가 없다(비목표). 사진 앱은 디스크를 계속 채운다.
- 사람이 폰에서 고른 file이 컴퓨터에서 도는 앱의 data가 되므로, 사람의 file을 앱이 받는 첫 길이다. 앱이 그 file을 어디로 보내는지는 앱의 network 선언이 가르고 lophn은 file의 내용을 보지 않는다.
