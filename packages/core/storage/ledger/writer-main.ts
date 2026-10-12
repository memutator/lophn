import { serveWriter, unavailableRegistration } from "./writer-loop.ts";

// core entry가 authority를 조립하기 전에는 자격·id·port를 열지 않는다.
serveWriter(
  self as unknown as Parameters<typeof serveWriter>[0],
  unavailableRegistration(),
);
