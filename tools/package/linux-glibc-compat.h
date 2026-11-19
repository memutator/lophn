/* Pin termios speed setters to baseline glibc symbols so pty.node built on newer
   Linux hosts (e.g. glibc 2.42+) still loads on Ubuntu 22.04 LTS (glibc 2.35) and newer. */
#if defined(__linux__) && defined(__x86_64__)
__asm__(".symver cfsetispeed,cfsetispeed@GLIBC_2.2.5");
__asm__(".symver cfsetospeed,cfsetospeed@GLIBC_2.2.5");
#elif defined(__linux__) && defined(__aarch64__)
__asm__(".symver cfsetispeed,cfsetispeed@GLIBC_2.17");
__asm__(".symver cfsetospeed,cfsetospeed@GLIBC_2.17");
#endif
