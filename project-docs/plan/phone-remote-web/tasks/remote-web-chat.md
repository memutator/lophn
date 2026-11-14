# remote-web-chat

폰의 대화 화면을 만든다. `AgentView`를 폰 host로 쓰고 desktop 전용 코드를 끊는다.

- 단위: web (wave 3)
- 선행: remote-web-base.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/remote/chat/`(새 폴더)
  - `packages/shell/renderer/conversation/`
- 읽을 것:
  - 계획 README "정한 것"
  - `packages/shell/renderer/conversation/{agent-view.tsx,agent-tab-source.ts,agent-tab-core-source.ts}`, `tools/wireframes/pages/screens/conversation.tsx`
  - architecture: `project-docs/architecture/{agent-chat,acp}.md`
- 계약:
  - 쓰는 것: `remote-web-base`의 화면 틀과 대화 자리 props, `coreAgentTabSourceFactory`
  - 내놓는 것: 없음

## 할 일

1. `AgentViewHost`의 폰 구현: `openPermissions`, `openAgentSettings`, `showUsage`는 폰에 없는 화면이라 그 항목을 숨긴다(host의 member를 선택으로 바꾸고 없으면 menu에서 뺀다). `openForked`와 `openSession`은 폰의 대화로 간다. `closeTab`은 목록으로 돌아간다. `openFile`, `runCommand`, `artifacts`는 주지 않는다.
2. desktop 전용 코드가 remote bundle에 들지 않게 import를 끊는다: `editor/`의 `ViewBar`와 `conflict/compare`, `workspace/`의 `visuals/block-frame`, `drag`, `kinds/host`, `shell/card-head.tsx`, `desktop/settings/core-call.ts`. 대화가 쓰는 조각만 `conversation/`이나 공통 자리로 옮기거나 host로 넘겨 받게 한다. desktop의 동작은 바뀌지 않는다.
3. 폰에서 숨기는 것: file 끌어 넣기와 OS path, 찾기 bar, bookmark와 thread index, 단축키 안내. secret 입력 요청 card는 "컴퓨터에서 넣는다"는 글만 보인다.
4. 사진: 폰의 사진 고르기(`<input type="file" accept="image/*">`)로 붙이고 `message-images/upload`(base64)로 올린다. 대화의 이미지는 `message-images/read`로 읽어 보인다.
5. 가상 keyboard가 올라와도 입력 칸이 보이게 한다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음
- `dist/remote`에 xterm, editor, mermaid가 아닌 대화에 필요한 chunk만 든다(보고에 `dist/remote`의 크기를 적는다).
- 개발 build에서 실제 core의 session을 열어 읽고, 보내고, 멈추고, 승인과 질문에 답한다(보고에 확인한 것을 적는다. 실제 model provider 호출은 사람에게 묻고, 없으면 `npm run dev`의 fake로 본다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
