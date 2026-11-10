import type { SchemaStep } from "../../../protocol/server/mod.ts";

// home의 SDK 업데이트 결정(review, 덧붙이기만 한다)과 그 결정에 달린 고른 기능(feature)이다. 앱은 지워질 수 있으므로 app에 FK를 두지 않고
// 앱을 지울 때 `eraseApp`이 두 표를 지운다. 보관한 앱의 행은 남는다.
// WIRINGS 맨 뒤 wiring(domains-retire)의 schemaStepsAfterTeams에서 잇는다(schema-steps.lock.json 끝).
export const sdkReviewSchemaSteps: readonly SchemaStep[] = [
  {
    id: "apps.sdk-review.tables",
    sql: `
    CREATE TABLE sdk_reviews (
      id TEXT PRIMARY KEY NOT NULL,
      app TEXT NOT NULL,
      session TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('leave', 'update')),
      through TEXT NOT NULL CHECK (json_valid(through)),
      call TEXT,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX sdk_reviews_app ON sdk_reviews(app, created_at, id);
    CREATE TABLE sdk_features (
      id TEXT PRIMARY KEY NOT NULL,
      review TEXT NOT NULL REFERENCES sdk_reviews(id),
      app TEXT NOT NULL,
      title TEXT NOT NULL,
      proposal TEXT NOT NULL,
      note_file TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('open', 'done', 'changed', 'skipped')),
      outcome TEXT,
      state_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX sdk_features_app ON sdk_features(app, review);
  `,
  },
];
