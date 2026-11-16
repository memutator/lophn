# liblophnappdb.so binds its JNI functions by class and method name; R8 must not rename or strip them.
-keep class dev.lophn.appdb.** { *; }
