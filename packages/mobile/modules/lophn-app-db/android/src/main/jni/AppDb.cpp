// Synchronous SQLite (with the session extension) as JSI objects, for the phone host runtime and for app guest
// runtimes. Both use this one copy of SQLite, so a file shared by host and guest has one lock implementation.
// A guest gets one connection to the file the host bound to its origin. It cannot name a path, ATTACH (which also
// covers VACUUM INTO), load extensions, touch the host's lophn_sync_* tables, or end the call transaction itself.
#include <android/log.h>
#include <jni.h>
#include <jsi/jsi.h>
#include <sqlite3.h>
#include <stdlib.h>
#include <strings.h>

#include <atomic>
#include <chrono>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <vector>

namespace jsi = facebook::jsi;

namespace {

using Clock = std::chrono::steady_clock;

constexpr int kBusyMs = 5000;
constexpr auto kStatementLimit = std::chrono::seconds(5);
constexpr int kMaxLength = 64 * 1024 * 1024;
constexpr size_t kMaxRandom = 65536;

const char* kOutboxInsert =
    "insert into lophn_sync_outbox (id, operation, started_at, changeset) values (?, ?, ?, ?)";

struct Bytes : jsi::MutableBuffer {
  std::vector<uint8_t> v;
  Bytes(const void* p, size_t n) : v((const uint8_t*)p, (const uint8_t*)p + n) {}
  size_t size() const override { return v.size(); }
  uint8_t* data() override { return v.data(); }
};

struct Conn {
  // Guest calls run on the guest's JS thread; unbind closes the connection from the host's JS thread.
  std::mutex mu;
  sqlite3* db = nullptr;
  std::map<std::string, sqlite3_stmt*> stmts;
  std::set<sqlite3_session*> sessions;
  bool guest = false;
  bool record = false;
  // Set only around the module's own statements (outbox insert, BEGIN/COMMIT/ROLLBACK of a call).
  bool trusted = false;
  bool inCall = false;
  sqlite3_session* call = nullptr;
  Clock::time_point deadline = Clock::time_point::max();

  void close() {
    for (auto* s : sessions) sqlite3session_delete(s);
    sessions.clear();
    call = nullptr;
    inCall = false;
    for (auto& [_, s] : stmts) sqlite3_finalize(s);
    stmts.clear();
    if (db) sqlite3_close_v2(db);
    db = nullptr;
  }
  ~Conn() { close(); }
};

// origin -> the guest connection opened for it, so unbind can close it.
std::mutex gGuestsMu;
std::map<std::string, std::weak_ptr<Conn>> gGuests;

struct Error {
  std::string message;
};

[[noreturn]] void fail(sqlite3* db, const std::string& what) {
  throw Error{what + ": " + (db ? sqlite3_errmsg(db) : "database is closed")};
}

bool hidden(const char* name) { return name && strncasecmp(name, "lophn_sync_", 11) == 0; }

int guestAuthorizer(void* p, int action, const char* a1, const char* a2, const char*, const char*) {
  auto* c = static_cast<Conn*>(p);
  if (c->trusted) return SQLITE_OK;
  // VACUUM INTO attaches its target, so this covers it too.
  if (action == SQLITE_ATTACH || action == SQLITE_DETACH) return SQLITE_DENY;
  // A trigger also runs inside the host's writes (sync apply), where no authorizer looks at its body.
  if (action == SQLITE_CREATE_TRIGGER || action == SQLITE_CREATE_TEMP_TRIGGER) return SQLITE_DENY;
  // Inside a call the module owns the transaction: a COMMIT from guest SQL would commit writes without their outbox row.
  if (action == SQLITE_TRANSACTION && c->inCall) return SQLITE_DENY;
  // Clocks, outbox and sync state share the file but belong to the host (also pragma table_info(lophn_sync_...)).
  if (hidden(a1) || hidden(a2)) return SQLITE_DENY;
  return SQLITE_OK;
}

int stopLongStatement(void* p) {
  auto* c = static_cast<Conn*>(p);
  return Clock::now() > c->deadline ? 1 : 0;
}

int userTables(void*, const char* table) {
  return strncasecmp(table, "lophn_", 6) != 0 && strncasecmp(table, "sqlite_", 7) != 0;
}

// Runs one call into the connection: holds the lock, arms the statement time limit, and turns errors into JS errors.
struct Deadline {
  Conn& c;
  explicit Deadline(Conn& c) : c(c) { c.deadline = Clock::now() + kStatementLimit; }
  ~Deadline() { c.deadline = Clock::time_point::max(); }
};

template <typename F>
jsi::Value guarded(jsi::Runtime& rt, const std::shared_ptr<Conn>& c, F&& f) {
  std::lock_guard<std::mutex> lock(c->mu);
  if (!c->db) throw jsi::JSError(rt, "database is closed");
  Deadline d(*c);
  try {
    return f();
  } catch (const Error& e) {
    throw jsi::JSError(rt, e.message);
  }
}

void execTrusted(Conn& c, const char* sql) {
  c.trusted = true;
  int rc = sqlite3_exec(c.db, sql, nullptr, nullptr, nullptr);
  c.trusted = false;
  if (rc != SQLITE_OK) fail(c.db, sql);
}

jsi::Value uint8(jsi::Runtime& rt, const void* p, size_t n) {
  jsi::ArrayBuffer ab(rt, std::make_shared<Bytes>(p, n));
  return rt.global().getPropertyAsFunction(rt, "Uint8Array").callAsConstructor(rt, ab);
}

void bindAll(jsi::Runtime& rt, sqlite3* db, sqlite3_stmt* st, const jsi::Value* params) {
  sqlite3_reset(st);
  sqlite3_clear_bindings(st);
  if (!params || params->isUndefined() || params->isNull()) return;
  if (!params->isObject() || !params->getObject(rt).isArray(rt)) throw Error{"bind: params must be an array"};
  auto arr = params->getObject(rt).getArray(rt);
  size_t n = arr.size(rt);
  for (size_t i = 0; i < n; i++) {
    int k = (int)i + 1;
    jsi::Value v = arr.getValueAtIndex(rt, i);
    int rc;
    if (v.isNull() || v.isUndefined()) rc = sqlite3_bind_null(st, k);
    else if (v.isBool()) rc = sqlite3_bind_int(st, k, v.getBool() ? 1 : 0);
    else if (v.isNumber()) rc = sqlite3_bind_double(st, k, v.getNumber());  // as node:sqlite does
    else if (v.isBigInt()) {
      auto b = v.getBigInt(rt);
      if (!b.isInt64(rt)) throw Error{"bind: bigint out of 64-bit range"};
      rc = sqlite3_bind_int64(st, k, b.getInt64(rt));
    } else if (v.isString()) {
      std::string s = v.getString(rt).utf8(rt);
      rc = sqlite3_bind_text(st, k, s.data(), (int)s.size(), SQLITE_TRANSIENT);
    } else {
      auto o = v.getObject(rt);
      jsi::Value buffer = o.getProperty(rt, "buffer");
      if (!buffer.isObject() || !buffer.getObject(rt).isArrayBuffer(rt))
        throw Error{"bind: parameter " + std::to_string(k) + " is not a number, bigint, string, Uint8Array or null"};
      auto ab = buffer.getObject(rt).getArrayBuffer(rt);
      size_t off = (size_t)o.getProperty(rt, "byteOffset").asNumber();
      size_t len = (size_t)o.getProperty(rt, "byteLength").asNumber();
      // An empty Uint8Array has no data pointer, and sqlite3_bind_blob(NULL) binds NULL instead of X''.
      rc = len == 0 ? sqlite3_bind_zeroblob(st, k, 0)
                    : sqlite3_bind_blob(st, k, ab.data(rt) + off, (int)len, SQLITE_TRANSIENT);
    }
    if (rc != SQLITE_OK) fail(db, "bind");
  }
}

jsi::Value column(jsi::Runtime& rt, sqlite3_stmt* st, int i) {
  switch (sqlite3_column_type(st, i)) {
    case SQLITE_INTEGER: {
      sqlite3_int64 x = sqlite3_column_int64(st, i);
      if (x > 9007199254740991LL || x < -9007199254740991LL) return jsi::BigInt::fromInt64(rt, x);
      return jsi::Value((double)x);
    }
    case SQLITE_FLOAT: return jsi::Value(sqlite3_column_double(st, i));
    case SQLITE_TEXT:
      return jsi::String::createFromUtf8(rt, sqlite3_column_text(st, i), (size_t)sqlite3_column_bytes(st, i));
    case SQLITE_BLOB: return uint8(rt, sqlite3_column_blob(st, i), (size_t)sqlite3_column_bytes(st, i));
    default: return jsi::Value::null();
  }
}

jsi::Object row(jsi::Runtime& rt, sqlite3_stmt* st) {
  jsi::Object o(rt);
  int cols = sqlite3_column_count(st);
  for (int i = 0; i < cols; i++)
    o.setProperty(rt, jsi::PropNameID::forUtf8(rt, sqlite3_column_name(st, i)), column(rt, st, i));
  return o;
}

jsi::Function fn(jsi::Runtime& rt, const char* name, unsigned n, jsi::HostFunctionType f) {
  return jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, name), n, std::move(f));
}

const jsi::Value* arg(const jsi::Value* a, size_t n, size_t i) { return i < n ? &a[i] : nullptr; }

std::string sqlArg(jsi::Runtime& rt, const jsi::Value* a, size_t n) {
  if (n < 1 || !a[0].isString()) throw jsi::JSError(rt, "sql must be a string");
  return a[0].getString(rt).utf8(rt);
}

sqlite3_stmt* statement(Conn& c, const std::string& sql) {
  auto it = c.stmts.find(sql);
  if (it != c.stmts.end()) return it->second;
  sqlite3_stmt* st = nullptr;
  if (sqlite3_prepare_v3(c.db, sql.c_str(), (int)sql.size(), SQLITE_PREPARE_PERSISTENT, &st, nullptr) != SQLITE_OK)
    fail(c.db, "prepare");
  if (!st) throw Error{"prepare: no statement in the SQL"};
  c.stmts[sql] = st;
  return st;
}

jsi::Object makeStatement(jsi::Runtime& rt, const std::shared_ptr<Conn>& c, const std::string& sql) {
  // Prepare now so a bad statement fails at prepare(), as node:sqlite does.
  guarded(rt, c, [&] {
    statement(*c, sql);
    return jsi::Value::undefined();
  });
  jsi::Object o(rt);
  o.setProperty(rt, "all", fn(rt, "all", 1, [c, sql](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t n) {
    return guarded(rt, c, [&] {
      sqlite3_stmt* st = statement(*c, sql);
      bindAll(rt, c->db, st, arg(a, n, 0));
      std::vector<jsi::Value> out;
      int rc;
      while ((rc = sqlite3_step(st)) == SQLITE_ROW) out.emplace_back(row(rt, st));
      sqlite3_reset(st);
      if (rc != SQLITE_DONE) fail(c->db, "step");
      jsi::Array arr(rt, out.size());
      for (size_t i = 0; i < out.size(); i++) arr.setValueAtIndex(rt, i, std::move(out[i]));
      return jsi::Value(std::move(arr));
    });
  }));
  o.setProperty(rt, "get", fn(rt, "get", 1, [c, sql](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t n) {
    return guarded(rt, c, [&] {
      sqlite3_stmt* st = statement(*c, sql);
      bindAll(rt, c->db, st, arg(a, n, 0));
      int rc = sqlite3_step(st);
      jsi::Value out = rc == SQLITE_ROW ? jsi::Value(row(rt, st)) : jsi::Value::undefined();
      sqlite3_reset(st);
      if (rc != SQLITE_ROW && rc != SQLITE_DONE) fail(c->db, "step");
      return out;
    });
  }));
  o.setProperty(rt, "run", fn(rt, "run", 1, [c, sql](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t n) {
    return guarded(rt, c, [&] {
      sqlite3_stmt* st = statement(*c, sql);
      bindAll(rt, c->db, st, arg(a, n, 0));
      int rc;
      while ((rc = sqlite3_step(st)) == SQLITE_ROW) {
      }
      sqlite3_reset(st);
      if (rc != SQLITE_DONE) fail(c->db, "run");
      jsi::Object r(rt);
      r.setProperty(rt, "changes", (double)sqlite3_changes64(c->db));
      sqlite3_int64 id = sqlite3_last_insert_rowid(c->db);
      r.setProperty(rt, "lastInsertRowid",
                    id > 9007199254740991LL || id < -9007199254740991LL ? jsi::Value(jsi::BigInt::fromInt64(rt, id))
                                                                         : jsi::Value((double)id));
      return jsi::Value(std::move(r));
    });
  }));
  return o;
}

sqlite3_session* newSession(Conn& c) {
  sqlite3_session* s = nullptr;
  if (sqlite3session_create(c.db, "main", &s) != SQLITE_OK) fail(c.db, "session");
  sqlite3session_table_filter(s, userTables, nullptr);
  if (sqlite3session_attach(s, nullptr) != SQLITE_OK) {
    sqlite3session_delete(s);
    fail(c.db, "session");
  }
  c.sessions.insert(s);
  return s;
}

void dropSession(Conn& c, sqlite3_session* s) {
  if (c.sessions.erase(s)) sqlite3session_delete(s);
}

jsi::Value changeset(jsi::Runtime& rt, Conn& c, sqlite3_session* s) {
  int n = 0;
  void* p = nullptr;
  if (sqlite3session_changeset(s, &n, &p) != SQLITE_OK) fail(c.db, "changeset");
  jsi::Value out = uint8(rt, p, (size_t)n);
  sqlite3_free(p);
  return out;
}

std::shared_ptr<Conn> open(const std::string& path, bool guest, bool record) {
  auto c = std::make_shared<Conn>();
  c->guest = guest;
  c->record = record;
  // The guest never creates the file: the host made and migrated it before binding.
  int flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX | (guest ? 0 : SQLITE_OPEN_CREATE);
  if (sqlite3_open_v2(path.c_str(), &c->db, flags, nullptr) != SQLITE_OK) {
    std::string m = c->db ? sqlite3_errmsg(c->db) : "out of memory";
    c->close();
    throw Error{"open: " + m};
  }
  sqlite3_busy_timeout(c->db, kBusyMs);
  sqlite3_db_config(c->db, SQLITE_DBCONFIG_DEFENSIVE, 1, (int*)nullptr);
  // node:sqlite (the computer's app runtime) opens with foreign keys on; the phone matches it.
  if (sqlite3_exec(c->db, "pragma journal_mode = wal; pragma foreign_keys = on", nullptr, nullptr, nullptr) != SQLITE_OK)
    fail(c->db, "open");
  if (guest) {
    sqlite3_limit(c->db, SQLITE_LIMIT_ATTACHED, 0);
    sqlite3_limit(c->db, SQLITE_LIMIT_LENGTH, kMaxLength);
    sqlite3_set_authorizer(c->db, guestAuthorizer, c.get());
    sqlite3_progress_handler(c->db, 1000, stopLongStatement, c.get());
  }
  return c;
}

jsi::Object connection(jsi::Runtime& rt, const std::shared_ptr<Conn>& c) {
  jsi::Object o(rt);
  o.setProperty(rt, "exec", fn(rt, "exec", 1, [c](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t n) {
    std::string sql = sqlArg(rt, a, n);
    return guarded(rt, c, [&] {
      char* err = nullptr;
      if (sqlite3_exec(c->db, sql.c_str(), nullptr, nullptr, &err) != SQLITE_OK) {
        std::string m = err ? err : sqlite3_errmsg(c->db);
        sqlite3_free(err);
        throw Error{"exec: " + m};
      }
      return jsi::Value::undefined();
    });
  }));
  o.setProperty(rt, "prepare", fn(rt, "prepare", 1, [c](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t n) {
    return jsi::Value(makeStatement(rt, c, sqlArg(rt, a, n)));
  }));
  if (!c->guest) {
    o.setProperty(rt, "session", fn(rt, "session", 0, [c](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) {
      sqlite3_session* s = nullptr;
      guarded(rt, c, [&] {
        s = newSession(*c);
        return jsi::Value::undefined();
      });
      jsi::Object so(rt);
      so.setProperty(rt, "changeset", fn(rt, "changeset", 0, [c, s](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) {
        return guarded(rt, c, [&] {
          if (!c->sessions.count(s)) throw Error{"changeset: session is closed"};
          return changeset(rt, *c, s);
        });
      }));
      so.setProperty(rt, "close", fn(rt, "close", 0, [c, s](jsi::Runtime&, const jsi::Value&, const jsi::Value*, size_t) {
        std::lock_guard<std::mutex> lock(c->mu);
        dropSession(*c, s);
        return jsi::Value::undefined();
      }));
      return jsi::Value(std::move(so));
    }));
    o.setProperty(rt, "close", fn(rt, "close", 0, [c](jsi::Runtime&, const jsi::Value&, const jsi::Value*, size_t) {
      std::lock_guard<std::mutex> lock(c->mu);
      c->close();
      return jsi::Value::undefined();
    }));
    return o;
  }
  // Guest only: one guest call is one transaction, and its changeset goes to the outbox before that transaction commits.
  o.setProperty(rt, "beginCall", fn(rt, "beginCall", 0, [c](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) {
    return guarded(rt, c, [&] {
      if (c->inCall) throw Error{"beginCall: a call is already open"};
      execTrusted(*c, "begin immediate");
      try {
        c->call = newSession(*c);
      } catch (...) {
        execTrusted(*c, "rollback");
        throw;
      }
      c->inCall = true;
      return jsi::Value::undefined();
    });
  }));
  o.setProperty(rt, "endCall", fn(rt, "endCall", 1, [c](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t n) {
    if (n < 1 || !a[0].isObject()) throw jsi::JSError(rt, "endCall: expected {id, operation, started_at}");
    auto meta = a[0].getObject(rt);
    auto text = [&](const char* k) {
      jsi::Value v = meta.getProperty(rt, k);
      if (!v.isString()) throw jsi::JSError(rt, std::string("endCall: ") + k + " must be a string");
      return v.getString(rt).utf8(rt);
    };
    std::string id = text("id"), operation = text("operation"), startedAt = text("started_at");
    return guarded(rt, c, [&] {
      if (!c->inCall) throw Error{"endCall: no call is open"};
      int size = 0;
      void* bytes = nullptr;
      int rc = sqlite3session_changeset(c->call, &size, &bytes);
      dropSession(*c, c->call);
      c->call = nullptr;
      c->inCall = false;
      try {
        if (rc != SQLITE_OK) fail(c->db, "changeset");
        if (size > 0 && c->record) {
          sqlite3_stmt* st = nullptr;
          c->trusted = true;
          rc = sqlite3_prepare_v2(c->db, kOutboxInsert, -1, &st, nullptr);
          if (rc == SQLITE_OK) {
            sqlite3_bind_text(st, 1, id.data(), (int)id.size(), SQLITE_TRANSIENT);
            sqlite3_bind_text(st, 2, operation.data(), (int)operation.size(), SQLITE_TRANSIENT);
            sqlite3_bind_text(st, 3, startedAt.data(), (int)startedAt.size(), SQLITE_TRANSIENT);
            sqlite3_bind_blob(st, 4, bytes, size, SQLITE_STATIC);
            rc = sqlite3_step(st);
          }
          sqlite3_finalize(st);
          c->trusted = false;
          if (rc != SQLITE_DONE) fail(c->db, "outbox");
        }
        execTrusted(*c, "commit");
      } catch (...) {
        sqlite3_free(bytes);
        c->trusted = false;
        if (!sqlite3_get_autocommit(c->db)) execTrusted(*c, "rollback");
        throw;
      }
      sqlite3_free(bytes);
      jsi::Object r(rt);
      r.setProperty(rt, "bytes", (double)size);
      return jsi::Value(std::move(r));
    });
  }));
  o.setProperty(rt, "abortCall", fn(rt, "abortCall", 0, [c](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) {
    return guarded(rt, c, [&] {
      if (c->call) dropSession(*c, c->call);
      c->call = nullptr;
      c->inCall = false;
      if (!sqlite3_get_autocommit(c->db)) execTrusted(*c, "rollback");
      return jsi::Value::undefined();
    });
  }));
  o.setProperty(rt, "randomBytes", fn(rt, "randomBytes", 1, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t n) {
    if (n < 1 || !a[0].isNumber() || a[0].getNumber() < 0 || a[0].getNumber() > (double)kMaxRandom)
      throw jsi::JSError(rt, "randomBytes: n must be 0.." + std::to_string(kMaxRandom));
    std::vector<uint8_t> buf((size_t)a[0].getNumber());
    arc4random_buf(buf.data(), buf.size());
    return uint8(rt, buf.data(), buf.size());
  }));
  return o;
}

std::string str(JNIEnv* env, jstring s) {
  const char* p = env->GetStringUTFChars(s, nullptr);
  std::string out(p);
  env->ReleaseStringUTFChars(s, p);
  return out;
}

jstring err(JNIEnv* env, const std::string& m) { return env->NewStringUTF(m.c_str()); }

}  // namespace

// The JNI functions run on the calling runtime's JS thread (from synchronous module methods). They return null or
// an error message, which the Kotlin module throws.
extern "C" JNIEXPORT jstring JNICALL Java_dev_lophn_appdb_LophnAppDbModule_nativeInstallHost(JNIEnv* env, jclass, jlong ptr) {
  auto& rt = *reinterpret_cast<jsi::Runtime*>(ptr);
  try {
    jsi::Object h(rt);
    h.setProperty(rt, "openHost", fn(rt, "openHost", 1, [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* a, size_t n) {
      if (n < 1 || !a[0].isString()) throw jsi::JSError(rt, "openHost: path must be a string");
      try {
        return jsi::Value(connection(rt, open(a[0].getString(rt).utf8(rt), false, false)));
      } catch (const Error& e) {
        throw jsi::JSError(rt, e.message);
      }
    }));
    h.setProperty(rt, "version", jsi::String::createFromUtf8(rt, sqlite3_libversion()));
    rt.global().setProperty(rt, "__lophnAppDbHost", h);
    return nullptr;
  } catch (const std::exception& e) {
    return err(env, e.what());
  }
}

extern "C" JNIEXPORT jstring JNICALL Java_dev_lophn_appdb_LophnAppDbModule_nativeInstallGuest(
    JNIEnv* env, jclass, jlong ptr, jstring jorigin, jstring jpath, jboolean record) {
  auto& rt = *reinterpret_cast<jsi::Runtime*>(ptr);
  std::string origin = str(env, jorigin);
  try {
    auto c = open(str(env, jpath), true, record);
    rt.global().setProperty(rt, "__lophnAppDb", connection(rt, c));
    std::lock_guard<std::mutex> lock(gGuestsMu);
    gGuests[origin] = c;
    return nullptr;
  } catch (const Error& e) {
    return err(env, e.message);
  } catch (const std::exception& e) {
    return err(env, e.what());
  }
}

extern "C" JNIEXPORT void JNICALL Java_dev_lophn_appdb_LophnAppDbModule_nativeUnbind(JNIEnv* env, jclass, jstring jorigin) {
  std::string origin = str(env, jorigin);
  std::shared_ptr<Conn> c;
  {
    std::lock_guard<std::mutex> lock(gGuestsMu);
    auto it = gGuests.find(origin);
    if (it == gGuests.end()) return;
    c = it->second.lock();
    gGuests.erase(it);
  }
  if (!c) return;
  // A running guest statement holds the lock; interrupt it instead of waiting for its time limit.
  if (c->db) sqlite3_interrupt(c->db);
  std::lock_guard<std::mutex> lock(c->mu);
  c->close();
}
