// `problems.work` 반응기의 고정 이름. credential 기록(credentials.ts)이 가볍게 import한다.
// feed는 core 안 구독자(깨움)이고, worker는 test-runner kind가 쓰는 machine credential의 principal이다.
export const PROBLEMS_WORK_FEED_PRINCIPAL = "machine:problems-work-feed";
export const PROBLEMS_WORK_PRINCIPAL = "machine:problems-work";
