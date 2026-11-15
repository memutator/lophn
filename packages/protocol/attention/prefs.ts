import { z } from "zod";

// 기기마다 어떤 일에 push를 받을지. 폰이 정하고 core가 사본을 가진다(`devices/set_push`).
export const pushPrefsSchema = z.strictObject({
  // 승인·질문·터미널 대기처럼 사람이 가야 풀리는 일.
  needs_you: z.boolean(),
  // 오래 돈 turn이 끝났을 때.
  long_finish: z.boolean(),
  // 앱 동의·공유 요청과 사람이 알아야 하는 program 기록.
  app_update: z.boolean(),
  // job의 놓친 차례가 [Start now]를 기다릴 때.
  job_missed: z.boolean(),
  // 앱이 notify()로 한 알림.
  app_notify: z.boolean(),
  // desktop 앞에 사람이 있으면 보내지 않는다.
  quiet_when_present: z.boolean(),
  // 글에 session 제목과 agent 이름을 싣는다. 끄면 고정 문장만 간다.
  show_names: z.boolean(),
});
export type PushPrefs = z.infer<typeof pushPrefsSchema>;
