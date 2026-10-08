/* Linux-only launcher. No provider credentials or user code run before confinement.
 * Staged prototype: not wired into the managed runtime until integration review.
 * Filesystem contents/mutations are restricted; Landlock does not hide metadata.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif
#ifndef __NR_fchmodat2
#define __NR_fchmodat2 452
#endif
#define ROOT "/Volumes/MOTHERSHIP"
#define RO (LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR | LANDLOCK_ACCESS_FS_EXECUTE)
#define RW ((1ULL << 15) - 1)
static void fail(void) { fputs("agent_sandbox_rejected\n", stderr); exit(78); }

/* Open each component without following links. Rule descriptors pin the actual
 * inode, not a path that can be swapped between validation and rule creation. */
static int directory(const char *path) {
    if (!path || path[0] != '/' || strlen(path) > 4096) fail();
    int fd = open("/", O_PATH | O_DIRECTORY | O_CLOEXEC);
    if (fd < 0) fail();
    char *copy = strdup(path + 1), *part = copy;
    if (!copy) fail();
    while (*part) {
        char *slash = strchr(part, '/');
        if (slash) *slash = 0;
        if (!*part || !strcmp(part, ".") || !strcmp(part, "..")) fail();
        int next = openat(fd, part, O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        close(fd);
        if (next < 0) fail();
        fd = next;
        if (!slash) break;
        part = slash + 1;
        if (!*part) fail();
    }
    free(copy);
    return fd;
}
static void rule(int ruleset, int fd, uint64_t access) {
    struct stat st;
    if (fstat(fd, &st)) fail();
    if (!S_ISDIR(st.st_mode)) access &= LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_TRUNCATE;
    struct landlock_path_beneath_attr r = { .allowed_access = access, .parent_fd = fd };
    if (syscall(__NR_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &r, 0)) fail();
    close(fd);
}
static void system_rule(int ruleset, const char *path, uint64_t access) {
    int fd = open(path, O_PATH | O_CLOEXEC);
    if (fd < 0) fail();
    rule(ruleset, fd, access);
}

/* Landlock ABI 3/4 does not mediate chmod/chown/utime/xattr or Unix socket
 * connects. Deny these globally, including io_uring paths around seccomp.
 * This intentionally limits tools that require explicit metadata changes.
 * No existing open data descriptors may be inherited beyond stdin/out/err. */
#define DENY(n) BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (n), 0, 1), BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM)
static void filter(void) {
#if defined(__x86_64__)
#define ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define ARCH AUDIT_ARCH_AARCH64
#else
#error unsupported sandbox architecture
#endif
    struct sock_filter code[] = {
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, ARCH, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
#if defined(__x86_64__)
        BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, 0x40000000, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
        DENY(__NR_chmod), DENY(__NR_chown), DENY(__NR_lchown),
        DENY(__NR_utime), DENY(__NR_utimes), DENY(__NR_futimesat),
#endif
        DENY(__NR_fchmod), DENY(__NR_fchmodat), DENY(__NR_fchmodat2),
        DENY(__NR_fchown), DENY(__NR_fchownat), DENY(__NR_utimensat),
        DENY(__NR_setxattr), DENY(__NR_lsetxattr), DENY(__NR_fsetxattr),
        DENY(__NR_removexattr), DENY(__NR_lremovexattr), DENY(__NR_fremovexattr),
        DENY(__NR_io_uring_setup),
        /* libuv needs descriptor-local nonblocking I/O, not filesystem ioctls. */
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_ioctl, 0, 5),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, FIONBIO, 2, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, FIONREAD, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
        DENY(__NR_ptrace), DENY(__NR_process_vm_writev), DENY(__NR_process_vm_readv),
        DENY(__NR_open_by_handle_at), DENY(__NR_name_to_handle_at),
        /* Anonymous socketpairs remain usable for stdio/subprocess IPC. */
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_socket, 0, 3),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AF_UNIX, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    };
    struct sock_fprog program = { .len = sizeof(code) / sizeof(code[0]), .filter = code };
    if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) fail();
}
int main(int argc, char **argv) {
    int abi = syscall(__NR_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
    if (argc == 2 && !strcmp(argv[1], "--probe")) {
        if (abi < 3) fail();
        printf("{\"landlockAbi\":%d,\"prototype\":true}\n", abi);
        return 0;
    }
    if (abi < 3 || getuid() != 1000 || geteuid() != 1000 || getgid() != 1000 || getegid() != 1000) fail();
    gid_t groups[16];
    int ngroups = getgroups(16, groups);
    if (ngroups < 0) fail();
    for (int g = 0; g < ngroups; g++) if (groups[g] != 1000) fail();
    for (int n = 0; n < 3; n++) {
        struct stat st;
        if (fstat(n, &st) || S_ISREG(st.st_mode) || S_ISDIR(st.st_mode)) fail();
    }
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) fail();
    /* No pre-opened bypass descriptors, including inherited directory handles. */
    if (syscall(__NR_close_range, 3U, ~0U, 0)) fail();
    struct landlock_ruleset_attr attr = { .handled_access_fs = RW };
    int ruleset = syscall(__NR_landlock_create_ruleset, &attr, sizeof(attr), 0);
    if (ruleset < 0) fail();
    const char *reads[] = {"/usr", "/app", "/etc", "/proc", NULL};
    const char *writes[] = {"/state", "/workspace", "/tmp", NULL};
    for (int i = 0; reads[i]; i++) system_rule(ruleset, reads[i], RO);
    for (int i = 0; writes[i]; i++) system_rule(ruleset, writes[i], RW);
    system_rule(ruleset, "/dev/null", LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_WRITE_FILE);
    system_rule(ruleset, "/dev/urandom", LANDLOCK_ACCESS_FS_READ_FILE);
    int i = 1, count = 0;
    const char *paths[8];
    int writable[8];
    for (; i < argc && strcmp(argv[i], "--"); i += 2) {
        if (++count > 8 || i + 1 >= argc || (strcmp(argv[i], "--read") && strcmp(argv[i], "--write"))) fail();
        const char *path = argv[i + 1];
        size_t len = strlen(ROOT);
        if (strlen(path) > 1024 || strncmp(path, ROOT, len) || (path[len] && path[len] != '/')) fail();
        for (const unsigned char *p = (const unsigned char *)path; *p; p++) if (*p < 32 || *p == 127) fail();
        int write = !strcmp(argv[i], "--write");
        for (int j = 0; j < count - 1; j++) {
            size_t oldlen = strlen(paths[j]), newlen = strlen(path);
            if (!strcmp(paths[j], path)) fail();
            if (!write && writable[j] && !strncmp(paths[j], path, oldlen) && path[oldlen] == '/') fail();
            if (write && !writable[j] && !strncmp(path, paths[j], newlen) && paths[j][newlen] == '/') fail();
        }
        paths[count - 1] = path;
        writable[count - 1] = write;
        rule(ruleset, directory(path), write ? RW : RO);
    }
    if (i + 1 >= argc || strcmp(argv[i], "--")) fail();
    if (syscall(__NR_landlock_restrict_self, ruleset, 0)) fail();
    close(ruleset);
    filter();
    execv(argv[i + 1], &argv[i + 1]);
    fail();
}
