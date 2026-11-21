// 폴더 교환의 수치. 쓰는 쪽과 읽는 쪽이 같은 값을 본다.
const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// 변경 하나. core의 CHANGESET_MAX_BYTES(sync log가 bytes로 담는 한도)와 같은 값이다: 그보다 큰 변경은 sync log가
// '다시 snapshot' 줄로 남기므로 폴더에 올 일이 없다.
export const FOLDER_CHANGE_MAX_BYTES = 8 * MIB;
export const CHANGES_FILE_MAX_COUNT = 1000;
export const CHANGES_PAYLOAD_MAX_BYTES = 16 * MIB;
export const SNAPSHOT_PAYLOAD_MAX_BYTES = GIB;
// 2행(header JSON 한 줄과 끝 \n).
export const HEADER_MAX_BYTES = MIB;
// `record.json`, `app.json`, `source/<n>.json`.
export const RECORD_MAX_BYTES = 256 * KIB;
// 기계 기록이 싣는 git project 목록(`projects`). 두 상한을 곱해도 기록 상한 안에 든다. 넘는 project는 다른 컴퓨터와 자동으로
// 맞춰지지 않는다.
export const SHARED_PROJECTS_MAX = 512;
export const SHARED_PROJECT_KEY_MAX = 256;
export const SOURCE_BUNDLE_MAX_BYTES = 64 * MIB;
// `packages/<part>@<version>.json`. 넘는 package version은 내보내지 않는다. carry 조각(8 MiB)과 같다.
export const PACKAGE_FILE_MAX_BYTES = 8 * MIB;

export const DESTINATIONS_MAX = 16;

// 받는 쪽 시각보다 이만큼 넘게 앞선 clock이 든 file은 미룬다(`clock_ahead`).
export const CLOCK_AHEAD_MAX_MS = 5 * MINUTE;
// 흔적 정리가 모두를 기다리지 않는 한도.
export const TOMBSTONE_HORIZON_MS = 90 * DAY;
// compaction이 지우는 자기 file의 나이.
export const COMPACTION_KEEP_MS = 30 * DAY;

export const EXPORT_DEBOUNCE_MS = 5 * SECOND;
export const EXPORT_TIMER_MS = 5 * MINUTE;
export const IMPORT_DEBOUNCE_MS = 2 * SECOND;
export const IMPORT_TIMER_MS = 2 * MINUTE;
// (앱, destination)·(앱, 출처 기계) 한 번의 쓰기·읽기가 다루는 양.
export const RUN_MAX_BYTES = 64 * MIB;
// 폰이 `carry/put`으로 조각을 넘기다 멈춘 file의 staging을 지우는 나이.
export const CARRY_STAGING_KEEP_MS = HOUR;
// 사람의 폴더에서 scan 한 번에 읽는 명단에 없는 기계의 명단 file 수. 그 폴더는 누구나 쓸 수 있어 지어낸 기계가 끝없을 수
// 있다. 아직 믿지 못하는 컴퓨터(dual boot의 다른 OS)는 몇 scan 안에 차례가 온다.
export const CARRY_UNKNOWN_ROSTER_FILES_MAX = 4;
// 정해진 빼기로 빠진 컴퓨터의 `computers` 하위 폴더를 지우기까지 기다리는 때. 처음 정해진 것을 본 때부터 센다. 도둑의 빼기
// 하나가 정직한 사본을 곧바로 지우지 못하게 하고, 그동안은 받지도 내주지도 읽지도 않는다.
export const CARRY_REMOVED_GRACE_MS = 7 * DAY;
export const BACKOFF_FIRST_MS = MINUTE;
export const BACKOFF_MAX_MS = HOUR;

// 읽기 명령에서 뒤 계획의 section 함수 하나를 기다리는 한도.
export const SECTION_TIMEOUT_MS = 2 * SECOND;

// 출처 하나·앱 하나에서 가장 새 held snapshot 뒤 held changes의 합. 넘을 file은 복사하지 않고 폴더에 둔다(그 출처의
// stream은 이 기계의 release가 바뀌거나 출처가 새 snapshot을 낼 때까지 멈춘다). 한 release의 changeset 합 한도
// `RELEASE_CHANGESET_MAX_BYTES`와 같다: 그보다 많으면 출처의 snapshot 하나가 더 싸다.
export const HELD_MAX_BYTES = 128 * MIB;
