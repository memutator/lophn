// ContextLedgerDeps의 실제 구현: content blob 읽기, derived index 읽기, 선언 검색 실행, hash. command를 실행하는 writer Worker와 read를 실행하는 reader
// Worker 안에서만 올라온다(contexts-api.ts의 loadContextsRuntime). node:sqlite와 동기 file API를
// 쓰므로 core 본체의 module graph에 들어오면 안 된다.
// 그래서 index 저장소는 packages/core/projects/contexts/mod.ts barrel이 아니라 index/mod.ts를 직접 연다.

// ledger 파일이 있는 폴더가 data root다. reader의 dataRootOf와 같은 근원이다.

// derived index를 읽기 전용으로 연다. coordinator가 아닌 context worker가 유일한 writer고, 파일이
// 교체되면(재생성) 새 파일을 다시 연다. 파일이 없으면 undefined다: 빈 index로 꾸미지 않는다.

// 선언 검색은 순수 함수가 page로 자르므로, 읽기의 page 자르기에 맞게 모든 page를 이어 붙여 전체
// 행을 돌려준다. board는 lane의 행을 lane 순서대로 편다.

