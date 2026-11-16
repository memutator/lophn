cmake_minimum_required(VERSION 3.13)
project(lophnappdb)
set(CMAKE_CXX_STANDARD 20)
find_package(ReactAndroid REQUIRED CONFIG)

# SQLite 3.53.3 amalgamation, unchanged (sqlite/VERSION).
add_library(lophnsqlite STATIC sqlite/sqlite3.c)
target_compile_options(lophnsqlite PRIVATE -fvisibility=hidden -O2)
target_compile_definitions(lophnsqlite PUBLIC
  SQLITE_ENABLE_SESSION=1
  SQLITE_ENABLE_PREUPDATE_HOOK=1
  SQLITE_OMIT_LOAD_EXTENSION=1
  SQLITE_THREADSAFE=1
  SQLITE_DEFAULT_WAL_SYNCHRONOUS=1
  SQLITE_DQS=0)
target_include_directories(lophnsqlite PUBLIC sqlite)

add_library(lophnappdb SHARED AppDb.cpp)
target_compile_options(lophnappdb PRIVATE -fvisibility=hidden -fexceptions -frtti -O2)
target_link_libraries(lophnappdb lophnsqlite ReactAndroid::jsi android log)
# This copy of SQLite stays private to the .so: no other library in the APK can bind to its symbols.
target_link_options(lophnappdb PRIVATE -Wl,--exclude-libs,ALL)
