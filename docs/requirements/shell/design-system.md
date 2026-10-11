---
type: requirements
concerns: [shell/design-system]
---
# shell/design-system

shell과 앱에서 함께 쓰는 색·글꼴·간격·크기·컴포넌트·loading·empty·error 상태의 시각 및 조작 규칙을 맡는다; 화면에 넣을 사실은 해당 concern을 따르고 개별 창·앱 frame·편집기 배치는 shell/desktop·shell/app-frame·shell/editor를 가리킨다.

## 요구

### 디자인 값과 공통 컴포넌트

**[R1]** 첫 조회는 300ms 전 loading 장식을 보이지 않고 이후 실제 자리를 유지한 skeleton으로 표시하며 empty는 한 문장·다음 행동 하나, error는 실패 대상·다시 불러오기로 구별한다.
- 이유: 짧은 조회에는 깜박임을 줄이고 긴 조회에는 실제 배치를 예고한다.
- 확인: 200ms 응답에는 loading이 없고 500ms에는 skeleton이 있으며 empty와 error를 혼동하지 않는다.
- 의도: shell#I1

**[R2]** 닫은 레이어의 focus는 연 자리로 돌아가고 상태·diff는 색뿐 아니라 글·표지로도 구별한다.
- 이유: 레이어를 닫아도 하던 자리를 잃지 않고 색 없이도 상태를 읽게 한다.
- 확인: 레이어를 닫으면 focus가 연 자리로 돌아가고 색 없이 상태·추가·삭제를 읽는다.
- 의도: shell#I3

**[R3]** 모든 shell·앱 컴포넌트는 공통 디자인 token만 쓰고 light·dark 값을 함께 제공하며 검증을 통과한 사람의 전역 값 override를 모든 앱에 적용한다.
- 이유: 앱마다 임의 표현을 만들지 않고 전역 모양 선택을 지원한다.
- 확인: 앱마다 임의 색·간격을 넣지 못하고 동일한 override가 shell과 앱에 반영된다.
- 의도: shell#I3

**[R4]** 사용자 theme은 token 값만 바꾸고 이름 추가·삭제는 금지하며 검증에 실패한 값만 기본값으로 되돌린다.
- 이유: 불완전한 theme 하나가 전체 UI를 깨지 않게 한다.
- 확인: 잘못된 값 하나를 지정해도 다른 유효 값은 적용되고 실패 값만 fallback된다.
- 의도: shell#I3

**[R5]** 콘텐츠를 크롬보다 먼저 보이게 하고 위계는 크기보다 무게·색·간격으로 구별하며 화면마다 primary와 강조는 하나·영역 구분은 테두리·배경·간격 중 하나로 제한한다.
- 이유: 작은 화면에서도 실제 내용과 주 행동을 먼저 찾게 한다.
- 확인: 정상·loading·empty·error 상태 모두 같은 위계이며 크롬이 데이터를 압도하지 않는다.
- 의도: shell#I1

**[R6]** 그라데이션·glass·neon·emoji 아이콘·중첩 카드·카드 그림자·중앙 hero·거대한 제목·700 이상 굵기·대문자 남발·장식 아이콘·임의 값·가짜 데이터·전면 spinner·무의미 움직임·AI 반짝임·값의 색 글자를 금지한다.
- 이유: 장식과 임의 값이 개인 도구의 읽기 밀도를 해치지 않게 한다.
- 확인: 실제 화면의 E2E에서 금지 목록에 해당하는 표현이 없는지 검사한다.
- 의도: shell#I1

**[R7]** 본문 텍스트는 primary·secondary·muted 세 단계의 중립색을 쓰며 disabled 색은 비활성 표시 외 정보 전달에 쓰지 않는다.
- 이유: 중립 위계로 작은 본문을 읽게 한다.
- 확인: light·dark에서 세 단계가 구별되고 muted 배경 위 작은 muted 글자는 피한다.
- 의도: shell#I3

**[R8]** light/dark 기본색은 바닥 #f9f9f7/#0d0d0d·표면 #ffffff/#161615·subtle #f3f2ef/#1d1d1b·muted #ebeae6/#252523·테두리 subtle #e8e7e2/#232321·기본 #e1e0d9/#2c2c2a·strong #c3c2b7/#44443f·글자 primary #1a1a18/#f3f3f0·secondary #52514e/#c3c2b7·muted #6b6a65/#96958d·disabled #a3a29c/#5f5e59로 둔다.
- 이유: theme별 바닥·표면·경계·글자의 관계를 고정한다.
- 확인: 모든 기본 표면과 글자가 정한 두 theme 값을 사용한다.
- 의도: shell#I3

**[R9]** primary는 잉크 배경과 반전 글자로 강조하고 blue는 링크·focus·선택에만 써서 link #1f66c1/#6da7ec·focus #2a78d6/#3987e5·선택 배경 #e7f0fb/#16263b로 둔다.
- 이유: 주 행동과 링크·focus·선택의 의미를 색만으로 뒤섞지 않는다.
- 확인: link·focus가 정한 용도에만 쓰인다.
- 의도: shell#I3

**[R10]** 상태 표식은 good #0ca30c·warning #fab219·serious #ec835a·critical #d03b3b·neutral #898781에 각각 circle-check·triangle-alert·octagon-alert·circle-x·circle-dashed와 라벨을 함께 쓰며 badge 라벨은 중립색으로 둔다.
- 이유: 색각·theme이 달라도 상태의 이름과 표지를 읽을 수 있게 한다.
- 확인: 색을 제거해도 상태가 구별되며 상태 글자가 필요한 곳은 light/dark good #006300/#0ca30c·warning #8a5a00/#fab219·serious #a4461f/#ec835a·critical #b93232/#e66767·neutral은 secondary를 쓴다.
- 의도: shell#I3

**[R11]** 차트 계열 색은 blue #2a78d6/#3987e5·orange #eb6834/#d95926·aqua #1baf7a/#199e70·yellow #eda100/#c98500·magenta #e87ba4/#d55181·green #008300/#008300·violet #4a3aa7/#9085e9·red #e34948/#e66767 순으로 배정하고 9번째부터 기타 회색 #a3a29c/#6b6a65로 묶으며 light aqua·yellow·magenta에는 직접 라벨 또는 표 보기를 제공한다.
- 이유: 계열 수와 낮은 대비를 명시하여 차트 색을 자의적으로 늘리지 않는다.
- 확인: light #ffffff·dark #161615 표면에서 palette validator를 실행하고 낮은 대비 슬롯의 보조 표현을 확인한다.
- 의도: shell#I3

**[R12]** 차트 색은 엔티티에 고정해 filter 후에도 유지하고 순환하지 않으며 모든 쌍이 맞닿는 차트는 3계열 이하·이중 축은 금지·크기는 blue 명도·양극은 blue/red와 gray 중간값으로 표현한다.
- 이유: filter와 표현 방식이 수치의 의미와 엔티티 색을 바꾸지 않게 한다.
- 확인: filter가 남은 계열을 다시 칠하지 않고 서로 다른 두 축이 없다.
- 의도: shell#I3

**[R13]** 차트는 선 2px·막대 끝 radius 4px·채움 사이 2px 표면 간격·subtle 격자를 쓰고 선/영역은 십자선 tooltip·막대/점은 항목 tooltip을 기본 제공한다.
- 이유: 가는 marks와 hover 설명으로 값과 관계를 읽을 수 있게 한다.
- 확인: marks가 정한 치수이고 각 데이터의 값을 hover로 읽을 수 있다.
- 의도: shell#I3

**[R14]** diff는 추가 줄 #e6f4e4/#15261a·추가 단어 #bfe3b9/#1f4a28·삭제 줄 #fbe9e7/#2d1817·삭제 단어 #f4c4bf/#5c2622에 +/− 기호를 함께 쓰고 primary 글자만 단어 배경 위에 두며 muted는 줄 배경 위에서만 쓴다.
- 이유: 추가·삭제의 범위는 낮은 채도와 기호로 표현하되 글자 가독성을 유지한다.
- 확인: 색 없이 차이를 읽는다.
- 의도: shell#I3

**[R15]** Pretendard Variable을 기본으로 system-ui를 fallback하고 JetBrains Mono를 코드·주소·식별·hash에 사용하여 글꼴을 로컬 bundle로 제공하며 굵기는 400·500·600만·표 숫자와 축은 tabular 숫자로 둔다.
- 이유: 네트워크와 OS 기본 글꼴 차이가 글의 형태를 바꾸지 않게 한다.
- 확인: 인터넷 없이 같은 글꼴을 표시하고 외부 font CDN 요청이 없다.
- 의도: shell#I3

**[R16]** 글자 크기/줄높이는 caption 12/16·small 13/20·body 14/22·reading 16/28·작은 제목 16/24·페이지 제목 20/28·단독 수치 28/36px이며 한 화면은 4단계 이하·제목 이상 자간 -0.01em·나머지 0으로 둔다.
- 이유: 본문·제목·수치의 위계를 적은 크기 단계로 유지한다.
- 확인: 거대한 제목 없이 정한 크기와 자간이 측정된다.
- 의도: shell#I3

**[R17]** 간격은 0·2·4·6·8·12·16·20·24·32·40·48·64px만 쓰고 요소 안 4~8·같은 무리 8~12·무리 16~24·섹션 32~48·머리/본문 24px 리듬과 안 여백≤바깥 간격·왼쪽 기준선 2~3개를 지킨다.
- 이유: 가까운 관계와 먼 관계를 간격만으로도 읽을 수 있게 한다.
- 확인: 임의 간격이 없으며 가까운 관계보다 먼 관계의 간격이 넓다.
- 의도: shell#I3

**[R18]** radius는 4·6·8·12·9999px, 테두리는 1px·focus는 2px에 offset 2px로 제한하고 그림자는 떠 있는 popover·dialog에만 쓰며 dark에서는 밝은 표면과 테두리로 층을 구별한다.
- 이유: 표면과 focus의 경계를 과도한 테두리·그림자 없이 드러낸다.
- 확인: 카드에 그림자가 없고 focus와 레이어 경계가 두 theme에서 보인다.
- 의도: shell#I3

**[R19]** 움직임은 120·180·240ms와 cubic-bezier(0.2,0,0,1)·fade 120ms·이동 4px·skeleton pulse 1,600ms로 통일한다.
- 이유: 움직임의 길이와 방식을 화면마다 다르게 두지 않는다.
- 확인: 전이 길이가 정한 세 값이고 pulse가 1,600ms이다.
- 의도: shell#I3

**[R20]** 쌓임 순서는 base 0·sticky 10·shell 20·sheet 50·backdrop 200·dialog 210·palette 220·popover 230·toast 300·tooltip 400으로 통일하고 레이어는 sibling으로 쌓으며 modal 밖 popup은 focus 이동 때 닫는다.
- 이유: 서로 다른 기능의 popup이 잘못된 레이어 뒤로 숨지 않게 한다.
- 확인: dialog 안 menu가 dialog 위에 보이고 바깥 popup은 남지 않으며 native view 규칙은 shell/app-frame을 따른다.
- 의도: shell#I3

**[R21]** 페이지 틀은 읽기 본문 600/680/800px와 목차 220px·dashboard 최대 1440px/12열/간격16px·목록 360px+상세·전체 폭 표·폼 640px의 5종만 사용하고 최대폭 기둥은 가용 영역 가운데 둔다.
- 이유: 실제 콘텐츠 유형에 맞는 제한된 폭과 배치 틀을 재사용한다.
- 확인: 목록과 표는 전체 폭이고 나머지는 좌우 여백이 균등하다.
- 의도: shell#I3

**[R22]** 런처 최대폭은 1040px·프로젝트 개요는 800px로 두고 최대폭 기둥의 가운데 배치를 800·1280·1920px 화면에서 검증한다.
- 이유: 넓은 창에서도 읽기 기둥이 한쪽으로 치우치지 않게 한다.
- 확인: 세 폭에서 콘텐츠 기둥이 가운데 있고 왼쪽 정렬 본문을 유지한다.
- 의도: shell#I3

**[R23]** 읽기 폭은 전역 선택을 기억하여 문서 메뉴로 바꾸고 목차는 내부 container 폭 868·948·1068px에서 각 600·680·800px 본문 오른쪽에 48px 간격으로 붙이며 부족하면 머리 dropdown으로 바꾸고 별도 메타 패널은 두지 않는다.
- 이유: 문서 읽기 폭을 선택해도 목차가 좁은 칸을 밀어내지 않게 한다.
- 확인: viewport가 아니라 칸 폭을 바꾸면 목차가 알맞게 전환된다.
- 의도: shell#I1

**[R24]** 반응형 경계는 640·1024·1280px이고 640px 미만은 sidebar 숨김·640~1023px는 기본 접힘 및 목록/상세 한 화면씩이며 칸 여백은 칸 640px 미만 16px·이상 32px, sidebar drag 범위는 200~400px·접힘 56px로 둔다.
- 이유: 반응형 기본값과 사람이 조절한 칸 폭을 구별한다.
- 확인: 기본 반응형과 사용자가 조절한 sidebar를 구별하고 사용자가 고른 폭을 자동 재접지 않는다.
- 의도: shell#I3

**[R25]** 정보 패널은 붙인 뒤 본문 720px 이상이 남을 때만 dock하고 분할 중에는 두 칸 최소 480px와 경계 1px를 남길 때만 dock하며 폭 부족은 분할 상태를 보존한 한 칸 보기·패널 overlay로 전환한다.
- 이유: 정보 패널이 최소 본문·분할 폭을 침범하지 않게 한다.
- 확인: 960·1024px에서는 overlay이고 넓혀 돌아오면 앞의 분할 상태가 복원된다.
- 의도: shell#I3

**[R26]** 컨트롤 sm/md/lg는 높이 28/32/36px·좌우 여백 8/12/14px·아이콘 14/16/16px·라벨 간격 6px이며 같은 크기의 버튼·입력·선택·탭은 높이와 기준선을 맞춘다.
- 이유: 같은 줄의 조작 요소를 고른 높이와 기준선으로 제공한다.
- 확인: 한 줄에 섞은 컨트롤의 기준선과 높이가 같다.
- 의도: shell#I3

**[R27]** 버튼은 잉크 primary·테두리 secondary·무배경 ghost·위험색 danger로 구별하고 내용 너비만 사용하여 폼 전체폭 버튼을 만들지 않으며 오른쪽 끝에 주 행동을 두고 위험 결정은 해당 concern의 확인 경로를 연다.
- 이유: 주 행동과 위험 결정을 모양으로 구별하되 확인 의미는 소유 concern에 둔다.
- 확인: 한 화면 primary가 하나이고 danger가 결정 확인을 우회하지 않는다.
- 의도: shell#I3

**[R28]** 입력은 표면 배경·strong 테두리·focus 링, 라벨은 위 6px·13px/500 secondary, 도움말·오류는 아래 6px·12px와 오류 아이콘으로 두며 placeholder를 라벨 대신 쓰지 않는다.
- 이유: 빈 입력에서도 목적과 문제를 라벨로 읽을 수 있게 한다.
- 확인: 빈 입력도 라벨이 있고 오류를 색 없이 구별한다.
- 의도: shell#I3

**[R29]** 일반 탭은 활성 primary 글자와 2px 밑줄·비활성 secondary·본문 간격 24px를 쓰며 작업대 문서 탭만 shell/editor의 별도 모양을 적용하고 이름은 documents/terms와 앱 screen 계약을 따른다.
- 이유: 일반 탭과 문서 작업대의 조작 위계를 혼동하지 않게 한다.
- 확인: 앱 screen과 일반 상세가 문서 탭 모양을 남용하지 않는다.
- 의도: shell#I3

**[R30]** 표는 행 36/44px·셀 좌우12px/첫끝16px·sticky 머리·1px subtle 구분선·줄무늬 없음·숫자 오른쪽/tabular·글자 왼쪽/말줄임 tooltip·개발자 diagnostics에서만 ID 앞8자/복사·상대 시각/절대 시각 tooltip·1,000행 초과 가상 스크롤로 통일한다.
- 이유: 많은 행에서도 숫자·글자·시각을 일정하게 비교할 수 있게 한다.
- 확인: 큰 표에서 가상 스크롤이 동작하고 단위는 머리에 한 번만 표시된다.
- 의도: shell#I1

**[R31]** 독립 객체만 카드로 surface·기본 border·radius8px·안 여백16px·그림자 없음으로 묶고 수치 타일은 라벨→4px→28px 값→4px→변화량과 방향 아이콘·한 줄 최대4개로 둔다.
- 이유: 묶을 필요가 있는 객체와 수치를 중첩 장식 없이 구별한다.
- 확인: 중첩 카드가 없고 값 글자는 계열색이 아닌 텍스트색이다.
- 의도: shell#I3

**[R32]** 트리는 행28px·깊이당 들여쓰기12px/8단부터 추가 들임 없음·현재 왼쪽2px 표시·키보드 안쪽2px focus·다중선택 배경을 쓰고 목록은 제목/메타 사이2px·항목 세로 여백8px로 둔다.
- 이유: 깊은 트리에서도 현재 항목과 focus를 읽을 수 있게 한다.
- 확인: 깊은 파일 트리가 무한히 좁아지지 않고 색 없이 현재 focus가 보인다.
- 의도: shell#I3

**[R33]** tooltip은 400ms 지연, popover·menu 행32px, dialog 폭480/640px·안여백24px, toast 폭360px·5초/짧은 조작2초/hover·focus 일시정지/행동 최대2개/error 유지, palette 폭640px·위20%로 둔다.
- 이유: 떠 있는 조작과 안내의 크기·시간 제한을 예측 가능하게 한다.
- 확인: error toast는 저절로 사라지지 않고 키보드 focus 중 시간 제한이 멈춘다.
- 의도: shell#I3

**[R34]** empty는 아이콘20px·한 문장·행동 하나를 내용 자리 가운데에 모으고 삽화 없음, error는 영향과 다음 행동, stale는 마지막 갱신 나이, agent가 쓴 내용은 작은 작성자 표식으로 표현한다.
- 이유: 데이터 없음·실패·오래된 값·agent 작성 사실을 구별한다.
- 확인: 각 데이터의 상태는 소유 concern을 따르되 실제 화면의 E2E에서 네 상태와 작성자를 구별한다.
- 의도: shell#I1

**[R35]** 사람의 답이 필요한 chip은 폭360px 하나에 나머지 개수를 붙이고 자동으로 사라지지 않으며 보기 또는 닫기를 제공한다.
- 이유: 사람의 답을 기다리는 안내가 저절로 사라지거나 여러 칸을 차지하지 않게 한다.
- 확인: 3건에서 하나와 외2건이 보이고 계기·중복 억제는 platform/notifications, 도크 질문 배치는 shell/desktop을 따른다.
- 의도: shell#I1

**[R36]** 디자인 token 원본 하나에서 CSS 변수·TypeScript 타입·문서값을 생성하고 token-only lint 및 palette 변경 시 재검증을 필수로 한다.
- 이유: token 원본과 실제 스타일·문서 값의 불일치를 자동으로 막는다.
- 확인: 수동 복사값 불일치와 token 밖 스타일이 검사에서 실패한다.
- 의도: shell#I3

**[R38]** floating 표면은 light #ffffff/dark #1d1d1b·hover #f3f2ef/#2a2a28, backdrop rgba(13,13,13,0.4)/rgba(0,0,0,0.6), 잉크 hover #32322f/#d9d8d2를 쓰며 checkbox·switch 선택은 잉크·badge 글자는 중립색으로 둔다.
- 이유: theme별 floating 표면과 선택 컨트롤의 의미를 고정한다.
- 확인: light·dark에서 레이어가 구별되고 선택 컨트롤이 blue primary를 만들지 않는다.
- 의도: shell#I3

**[R39]** Markdown 제목은 1단20px·2단16px/600/위40px·3단16px/600/secondary·4단14px, palette 항목은 36px로 둔다.
- 이유: 읽기 제목과 팔레트 항목의 위계를 같은 치수로 유지한다.
- 확인: 읽기 렌더러의 제목 위계와 palette 행이 정한 값을 따른다.
- 의도: shell#I3

**[R40]** 스타일 검사는 token 밖 색·길이·시간·굵기·쌓임 순서·breakpoint와 존재하지 않는 token 참조를 거절한다.
- 이유: 스타일 예외가 쌓여 공통 디자인 규칙을 우회하지 않게 한다.
- 확인: 임의 hex·px·ms와 없는 token을 넣으면 검사에서 실패한다.
- 의도: shell#I3

**[R41]** 차트는 기타 회색·막대 최대폭24px·끝radius4px·간격2px·점radius4px를 쓰고 여러 행 tooltip은 popover 표면·축10만 이상은 en compact number format·날짜 Sep 26·tooltip 날짜 Sep 26, 2026 (Sat)처럼 표시하며 숫자와 날짜 format은 locale을 따른다.
- 이유: 차트 mark는 고정하고 숫자·날짜 표기는 en에서 시작하여 locale에 맞게 바꿀 수 있게 한다.
- 확인: 큰 수와 날짜가 en locale의 형식이고 tooltip 값의 글자는 중립색이며 locale을 바꿔도 mark의 치수는 같다.
- 의도: shell#I3

### 검토 뒤 적용한 선택

**[R42]** 1280px 창의 약 520px 분할 칸은 16px 양쪽 여백을 적용하여 읽기 폭 488px를 사용한다.
- 이유: 같은 문서의 여백 규칙과 계산이 일치해야 한다.
- 확인: 520−16×2=488px로 측정되며 1px 분할 경계의 반 칸 계산은 layout에 반영한다.
- 의도: shell#I3

**[R43]** 초기 UI 동작 재료는 CSS Modules·Radix Primitives·Lucide를 사용하여 아이콘 기본 크기16/20px·선 굵기1.5로 통일하되 별도로 정한14px 아이콘 치수는 유지한다.
- 이유: 같은 동작을 검증된 primitive와 한 icon 벌로 유지한다.
- 확인: 실제 화면의 E2E에서 menu·dialog·tab의 키보드 조작과 한 아이콘 스타일이 검증된다.
- 의도: shell#I3

**[R44]** 기본 글꼴은 Pretendard·밀도 선택은 표에서만 제공하고 사용자 강조색 값은 R4의 검증을 통과한 전역 token override로만 받는다.
- 이유: 첫 판은 공통 읽기 경험을 유지하면서 안전하게 선택을 늘린다.
- 확인: global compact가 다른 편집기 크기를 바꾸지 않고 부적합 강조색은 fallback된다.
- 의도: shell#I3

### 떠 있는 표면

**[R45]** popover 그림자는 light에서 0 4px 16px rgba(26,26,24,0.08)과 0 0 0 1px rgba(26,26,24,0.06), dark에서 0 4px 16px rgba(0,0,0,0.32)와 0 0 0 1px #2c2c2a를 쓰고 dialog는 light에서 0 16px 48px rgba(26,26,24,0.16)과 같은 light 테두리, dark에서 0 16px 48px rgba(0,0,0,0.48)와 같은 dark 테두리를 쓴다.
- 이유: 떠 있는 표면의 깊이와 경계를 theme별로 일관되게 드러낸다.
- 확인: menu·tooltip은 popover, dialog·palette는 dialog 그림자를 쓰고 카드에는 그림자가 없다.
- 의도: shell#I3

## 열린 질문

## 버린 것

- gallery 등록·여섯 경우 screenshot 회귀·사람 baseline 채택 요구(R37) — 사람이 gallery와 screenshot 작업을 취소했다. 화면 확인은 Playwright E2E 동작 검사로만 한다.
- 읽기 메타 패널 — 원문의 뒤 결정으로 폐기되었다.
- UI customization의 slot·fork — 초기에는 token override만 두고 slot·fork 계약은 실제 두 번째 소비자와 앱 SDK 사례 뒤로 미루기로 정했다(R3, R4).
- 1280px 분할 칸의 읽기 폭 456px — 16px 양쪽 여백을 적용한 488px로 정했다(R42).
- 입력 경계의 WCAG 비텍스트 3:1 대비 강화 검사 — 접근성은 범위 밖이라 대비 강화 검사를 두지 않는다.
- 모든 조작을 키보드만으로 제공·screen reader 의미 유지·reduced-motion 대응 — 접근성은 범위 밖이라 두지 않는다. shortcut과 focus 복귀는 남긴다(R2).
- system font 기본 선택과 global compact — 기본 글꼴은 Pretendard, 밀도 선택은 표에서만 두기로 정했다(R44).
