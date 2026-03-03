#ifndef LOGGING_H__
#define LOGGING_H__

#include <cstdio>
#include <cstring>
#include <ctime>
#include <chrono>

enum LogLevel { TRACE = 0, DEBUG = 1, INFO = 2, WARN = 3, ERROR = 4 };

// Declared extern so all TUs share one log level.
// Defined in mpcauth_server.cpp.
extern LogLevel g_log_level;

static inline const char* log_level_str(LogLevel l) {
    switch (l) {
        case TRACE: return "TRACE";
        case DEBUG: return "DEBUG";
        case INFO:  return "INFO";
        case WARN:  return "WARN";
        case ERROR: return "ERROR";
    }
    return "???";
}

static inline void log_timestamp(char* buf, size_t len) {
    auto now = std::chrono::system_clock::now();
    auto t = std::chrono::system_clock::to_time_t(now);
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        now.time_since_epoch()) % 1000;
    struct tm tm_buf;
#ifdef _WIN32
    localtime_s(&tm_buf, &t);
#else
    localtime_r(&t, &tm_buf);
#endif
    int n = (int)strftime(buf, len, "%Y-%m-%d %H:%M:%S", &tm_buf);
    snprintf(buf + n, len - n, ".%03d", (int)ms.count());
}

#define LOG(level, fmt, ...) do { \
    if ((level) >= g_log_level) { \
        char _ts[32]; \
        log_timestamp(_ts, sizeof(_ts)); \
        fprintf(stderr, "[%s] %s: " fmt "\n", _ts, log_level_str(level), ##__VA_ARGS__); \
    } \
} while(0)

static inline LogLevel parse_log_level(const char* s) {
    if (!s) return INFO;
    if (strcmp(s, "TRACE") == 0 || strcmp(s, "trace") == 0) return TRACE;
    if (strcmp(s, "DEBUG") == 0 || strcmp(s, "debug") == 0) return DEBUG;
    if (strcmp(s, "INFO")  == 0 || strcmp(s, "info")  == 0) return INFO;
    if (strcmp(s, "WARN")  == 0 || strcmp(s, "warn")  == 0) return WARN;
    if (strcmp(s, "ERROR") == 0 || strcmp(s, "error") == 0) return ERROR;
    return INFO;
}

#endif // LOGGING_H__
