// 같은 Electron 실행 파일의 두 시작. `--app-screen-test`면 앱 화면 검사 host만(shell#T46),
// 아니면 desktop main이다. 검사 host는 desktop main의 데이터 root·core·single instance를 하나도
// 거치지 않아야 해서 bundle을 나눠 이 자리에서 고른다. build가 둘을 같은 dist에 낸다.
// flag는 contracts/shell의 SCREEN_TEST_FLAG와 같다(그 module은 zod를 끌어와 여기서는 글자로 둔다).
import { join } from "node:path";

const SCREEN_TEST_ARG = "--app-screen-test";

require(join(
  __dirname,
  process.argv.includes(SCREEN_TEST_ARG) ? "screen-test.cjs" : "desktop.cjs",
));
