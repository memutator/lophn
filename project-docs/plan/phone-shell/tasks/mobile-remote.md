# mobile-remote

remote 화면 bundle을 받아 cache하고, bridge를 연결에 이어 폰에서 remote 화면을 띄운다.

- 단위: mobile (wave 3)
- 선행: mobile-pairing, mobile-webview.
- 소유(이 task만 고친다):
  - `mobile/src/bundle/`, `mobile/src/remote/`, `mobile/src/App.tsx`
- 읽을 것:
  - 계획 README "정한 것"
  - 계획 `phone-remote-web`의 README(bridge, `remote_ui/*` route, base64 답)
- 계약:
  - 쓰는 것: `mobile-pairing`의 `CoreSource` 모양 연결, `mobile-webview`의 component와 bridge, route `remote_ui/manifest`와 `remote_ui/file`
  - 내놓는 것: 없음

## 할 일

1. 붙으면 `remote_ui/manifest`를 읽는다. 그 hash의 폴더가 cache에 없으면 file을 하나씩 받아(`remote_ui/file`, base64) hash를 확인하고 임시 폴더에 쓴 뒤, 다 맞으면 hash 이름의 폴더로 옮긴다. 맞지 않는 file이 있으면 그 bundle을 버린다.
2. 컴퓨터마다 마지막으로 확인된 bundle을 적어 두고 그것으로 WebView를 띄운다. 새 bundle이 확인되면 바꿔 띄운다. 옛 bundle은 하나만 남기고 지운다.
3. bridge의 `call`, `watch`를 연결로 넘기고 답과 event, 연결 상태를 page로 넘긴다.
4. core에 닿지 않으면 마지막 bundle을 띄운 채 연결 상태가 `stale`로 간다. bundle이 하나도 없으면 "컴퓨터에 닿지 않음"을 native 화면으로 보인다.
5. 화면 정보(폭, 높이, DPR)가 pairing 때와 달라졌으면 그대로 둔다(기기 정보 고치기는 이 계획에 없다).

## 끝남

- `mobile/`의 type 검사와 test가 통과한다.
- 위험 test: "hash가 맞지 않는 file은 cache에 들지 않고 화면에 쓰이지 않는다"
- emulator에서 QR 내용으로 pairing한 뒤 session 목록이 보이고, 대화를 열어 보내고, 승인에 답한다(보고에 적는다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
