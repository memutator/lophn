---
type: requirements
concerns: [platform/install-and-update]
---
# platform/install-and-update

lophn의 지원 OS·설치 패키지·첫 실행·자체 update와 사람이 찾을 데이터 폴더를 맡는다; 앱 release는 apps/releases, 자료 변환과 복원은 platform/backup-and-migration, 창과 OS 통합은 shell/desktop을 따른다.

## 요구

### 지원과 설치

**[R1]** lophn은 Linux·macOS·Windows 배포를 지원하며 각 OS에서 실제 build·서명과 필요한 공증·OS sandbox·설치·기동·앱 호출·backup restore를 검증하기 전에는 해당 배포를 사용 가능한 완료 상태로 표시하지 않는다.
- 이유: 과거 Linux x64만 빌드한 진행 상태와 지원 OS 약속은 다르며 지원 약속을 구현 진척에 맞춰 축소하지 않는다.
- 확인: Linux·macOS·Windows별 배포 검증 결과와 미완료 항목이 보이고 Linux x64 Ubuntu 24.04 이상에서 .deb의 OS sandbox가 확인되는지 본다.
- 의도: platform#I4

**[R2]** Linux의 권장 설치 방식은 .deb 패키지이며 AppImage는 OS sandbox가 실제로 켜지는 환경을 검증한 경우에만 대체 설치로 안내한다.
- 이유: nosuid AppImage의 제한 때문에 안전 수준이 다른 설치를 동등하게 권장하지 않는다.
- 확인: 새 Ubuntu 환경에서 .deb 설치 후 별도 Deno 설치 없이 기동하고 AppImage 안내에는 sandbox 조건이 표시되는지 본다.
- 의도: platform#I4, platform#I2

**[R3]** .deb 설치는 Chromium sandbox 실행 파일의 소유자를 root로, 권한을 4755로 두어 Ubuntu 24.04 이상의 OS sandbox를 켜며 sandbox를 끄는 옵션을 일반 설치 해결책으로 제공하지 않는다.
- 이유: 배포가 개발 환경의 안전 완화를 이어받아서는 안 된다.
- 확인: 지원 OS 설치에서 소유자·4755와 실제 sandbox 활성화를 점검하고 실패 시 안전한 설치 실패로 안내하는지 본다; 격리 기준은 platform/security를 따른다.
- 의도: platform#I4, platform#I2

**[R4]** 설치 묶음은 Deno binary·플랫폼 source와 고정한 의존성·빌드된 desktop 화면·coding agent skill을 포함하고 플랫폼 시작에 의존성 다운로드를 요구하지 않는다.
- 이유: 오래 쓰는 개인 앱의 시작이 네트워크와 원격 registry의 변화에 묶이지 않아야 한다.
- 확인: 인터넷을 끊은 새 설치에서 cached-only로 플랫폼과 기존 앱이 시작되는지 본다.
- 의도: platform#I6, platform#I4

**[R5]** 설치는 앱 process와 migration을 시작할 실제 Deno binary를 제공하며 플랫폼 자체를 deno compile 단일 실행 파일로 대체하지 않는다.
- 이유: 배포 뒤에도 앱과 migration을 같은 runtime으로 실행할 수 있어야 한다.
- 확인: 설치된 Deno로 앱 process와 migration이 시작되고 system Deno 유무가 결과에 영향을 주지 않는지 본다.
- 의도: platform#I4

**[R6]** 설치는 desktop 실행 이름 lophn-desktop·CLI 이름 lophn·MCP 실행 이름 lophn-mcp를 제공하고 .deb에서는 CLI와 MCP를 /usr/bin에서 찾을 수 있게 한다.
- 이유: 사람과 외부 coding agent가 설치 뒤 사용할 실행 경로를 알아야 한다.
- 확인: 새 shell에서 세 이름이 실행되고 CLI와 MCP가 설치된 같은 플랫폼에 연결되는지 본다; 각 인터페이스는 coding-agent/cli와 coding-agent/mcp-server를 따른다.
- 의도: platform#I4

### 데이터 위치와 첫 실행

**[R7]** Linux의 기본 데이터 폴더는 ~/.lophn이며 LOPHN_HOME 환경 변수로 다른 데이터 폴더를 명시할 수 있고 설정·ledger·blob·앱 실행 자료·SDK·log·backup·자격 보관의 위치를 그 폴더 기준으로 찾을 수 있다.
- 이유: 사용자가 자기 자료를 찾고 backup할 수 있어야 한다.
- 확인: 기본 기동과 지정 폴더 기동에서 현재 데이터 위치를 확인하고 다른 폴더의 자료를 섞어 열지 않는지 본다; secret 값은 platform/secrets, 앱 source 연결은 apps/registration을 따른다.
- 의도: platform#I4, platform#I1

**[R8]** Linux Deno transpile cache의 기본 위치는 ~/.cache/lophn/deno로 두고 cache를 지워도 원본 lophn 데이터가 사라지지 않는다.
- 이유: 재생성 가능한 cache와 보존해야 할 자료를 구별한다.
- 확인: cache 삭제 후 고정 의존성으로 다시 시작하여 기존 문서와 앱 데이터가 유지되는지 본다.
- 의도: platform#I1

**[R9]** Linux 데이터 root·관리 앱 폴더·runtime 제어 폴더는 0700과 소유자·symlink 검사를 적용하고 다른 OS는 동등 ACL을 확인하며 coding token은 파일 없이 platform/identity의 OS keychain과 보호 loader를 쓴다.
- 이유: 관리 파일의 권한과 coding credential 원문 보관을 구별한다.
- 확인: 관리 폴더의 권한·소유자·symlink 오류에 시작이 거절되고 coding token 파일을 만들지 않으며 keychain 잠김은 credential 사용만 unavailable인지 본다.
- 의도: platform#I4, platform#I2

**[R10]** 같은 데이터 폴더에는 플랫폼 instance를 하나만 시작하며 이미 실행 중이면 두 번째 writer를 열지 않고 기존 instance 사용 또는 충돌을 안내한다.
- 이유: 같은 원본에 여러 플랫폼이 쓰는 일을 막는다.
- 확인: 같은 데이터 폴더로 두 번 시작해 writer 하나만 남고 다른 폴더의 독립 자료와는 구별되는지 본다.
- 의도: platform#I1

**[R11]** 첫 실행과 재시작은 단일 instance 확인·설정 검증·ledger 무결성 및 schema 점검·중단 작업 점검·처리 위치 복원·인증된 API 시작·허용된 앱 감독·주기 접수 순서를 지킨다.
- 이유: 저장과 자격이 준비되기 전에 앱과 agent 작업이 시작하면 안 된다.
- 확인: 각 앞 단계 실패 때 뒤 작업이 시작되지 않고 유효하지 않은 agent 설정만 있으면 platform/settings의 부분 사용 정책을 따르며 점검과 복구는 platform/backup-and-migration을 따르는지 본다.
- 의도: platform#I4, platform#I1

**[R12]** 첫 판은 Electron desktop 설치를 전제로 하며 창을 모두 닫는 동작은 플랫폼을 종료하지 않지만 Electron 없는 서버를 별도 지원 설치로 제공하지 않는다.
- 이유: 창 밖의 automation·CLI·MCP 사용과 보호된 사람 결정 경로를 함께 유지한다.
- 확인: 창을 닫아도 기존 앱 automation과 CLI·MCP가 동작하고 승인 필요 작업은 shell/confirmation-window로 이동하며 창 부재를 자동 허락으로 해석하지 않는지 본다.
- 의도: platform#I4, platform#I7

### lophn update

**[R13]** 첫 판의 lophn update는 사람이 새 OS별 설치 패키지를 설치하는 수동 방식으로 제공하고 Linux에서는 .deb를 쓰며 자동 다운로드·자동 설치·사용 중 무단 재시작을 하지 않는다.
- 이유: update가 개인 자료와 진행 작업을 사람 몰래 바꾸지 않게 한다.
- 확인: 새 패키지 설치 전까지 기존 설치가 유지되고 update 안내에 새 version·지원 OS·schema 호환 및 재시작 필요가 보이는지 본다.
- 의도: platform#I4, platform#I5

**[R14]** lophn update는 진행 작업과 플랫폼을 정상 정지한 뒤 설치 파일만 교체하고 데이터 폴더를 초기화하지 않으며 필요한 schema 변경은 platform/backup-and-migration의 검증 backup 뒤 수행한다.
- 이유: 설치 교체와 자료 변환의 실패를 구분하고 기존 데이터를 보존한다.
- 확인: 문서·앱·설정이 있는 설치를 update하여 자료가 남고 실패한 schema 변경은 이전 완료 상태를 보존하며 이전 설치로의 복귀에는 호환 backup을 안내하는지 본다.
- 의도: platform#I4, platform#I1

**[R15]** 첫 판의 기술 기반은 Electron desktop·Deno/TypeScript runtime·SQLite ledger와 로컬 데이터·MCP/CLI 연결로 유지한다.
- 이유: H6 추천안과 이전에 확인한 로컬 플랫폼 기반을 유지한다.
- 확인: 지원 OS 배포에서 해당 runtime과 SQLite 자료를 실제로 사용하고 외부 연결은 coding-agent/connection을 따르는지 본다.
- 의도: platform#I4

## 열린 질문

- platform/install-and-update#Q1 Electron 없는 headless 서버를 지원 설치로 제공할까.
- platform/install-and-update#Q2 Linux·macOS·Windows별 최소 OS version·CPU·설치 형식과 데이터 폴더를 무엇으로 정할까.
- platform/install-and-update#Q3 H6: Electron·Deno/TypeScript·SQLite 기반을 유지할까.
- platform/install-and-update#Q4 자체 update는 수동 .deb 재설치로 둘까, 자동 update를 제공할까.

## 버린 것

- 2026년 9월 lophn 0.3.0의 MVP와 MaHas 검증 진행 상황은 버린다: 과거 개발 상태는 새 제품의 설치 약속이 아니다.
- 0.3.0 이관 뒤 project 표본 200개와 tracking 시작을 고르던 onboarding은 버린다: 처음부터 만드는 첫 실행에 과거 이관 화면을 되살리지 않는다.
- 이관 onboarding의 폭 640px와 과거 이동 목록은 버린다: 과거 이관 전용이고 화면 모양은 shell/desktop의 몫이다.
- 과거 Linux x64만 빌드했고 macOS·Windows build·서명·공증·icon·배포 metadata가 남았다는 진행 상황은 제품 요구로 옮기지 않는다: 세 OS 지원 약속은 유지하되 미검증 배포를 완료로 표시하지 않는다.
- 과거 앱 상태 이름과 놓친 run 자동 catch-up으로 기동하던 절차는 버린다: 현재 앱 상태와 사람·주기만의 agent 계기를 따른다.
