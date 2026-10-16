#include "util.h"

#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <mutex>
#include <string>

namespace aurora {
namespace {

std::mutex g_logMutex;
FILE* g_logFile = nullptr;
bool g_logTried = false;

}  

#if defined(_WIN32)

std::string WcharToUtf8(const wchar_t* w, int len) {
  if (!w) return std::string();
  int need = WideCharToMultiByte(CP_UTF8, 0, w, len, nullptr, 0, nullptr, nullptr);
  if (need <= 0) return std::string();
  std::string out(static_cast<size_t>(need), '\0');
  WideCharToMultiByte(CP_UTF8, 0, w, len, &out[0], need, nullptr, nullptr);
  if (len < 0 && !out.empty() && out.back() == '\0') out.pop_back();
  return out;
}

std::string WcharToUtf8(const std::wstring& w) {
  return WcharToUtf8(w.c_str(), static_cast<int>(w.size()));
}

std::wstring Utf8ToWchar(const std::string& s) {
  if (s.empty()) return std::wstring();
  int need = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), static_cast<int>(s.size()), nullptr, 0);
  if (need <= 0) return std::wstring();
  std::wstring out(static_cast<size_t>(need), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.c_str(), static_cast<int>(s.size()), &out[0], need);
  return out;
}

std::string Hex32(uint32_t v) {
  char buf[16];
  std::snprintf(buf, sizeof(buf), "0x%08X", v);
  return std::string(buf);
}

std::string HrToString(HRESULT hr) {
  char buf[32];
  std::snprintf(buf, sizeof(buf), "0x%08X", static_cast<unsigned>(hr));
  std::string out(buf);
  switch (static_cast<unsigned>(hr)) {
    case 0x88890001: out += " (AUDCLNT_E_NOT_INITIALIZED)"; break;
    case 0x88890002: out += " (AUDCLNT_E_ALREADY_INITIALIZED)"; break;
    case 0x88890003: out += " (AUDCLNT_E_WRONG_ENDPOINT_TYPE)"; break;
    case 0x88890004: out += " (AUDCLNT_E_DEVICE_INVALIDATED)"; break;
    case 0x88890005: out += " (AUDCLNT_E_NOT_STOPPED)"; break;
    case 0x88890006: out += " (AUDCLNT_E_BUFFER_TOO_LARGE)"; break;
    case 0x88890007: out += " (AUDCLNT_E_OUT_OF_ORDER)"; break;
    case 0x88890008: out += " (AUDCLNT_E_UNSUPPORTED_FORMAT)"; break;
    case 0x88890009: out += " (AUDCLNT_E_INVALID_SIZE)"; break;
    case 0x8889000A: out += " (AUDCLNT_E_DEVICE_IN_USE)"; break;
    case 0x8889000B: out += " (AUDCLNT_E_BUFFER_OPERATION_PENDING)"; break;
    case 0x8889000C: out += " (AUDCLNT_E_THREAD_NOT_REGISTERED)"; break;
    case 0x8889000E: out += " (AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED)"; break;
    case 0x8889000F: out += " (AUDCLNT_E_ENDPOINT_CREATE_FAILED)"; break;
    case 0x88890010: out += " (AUDCLNT_E_SERVICE_NOT_RUNNING)"; break;
    case 0x88890011: out += " (AUDCLNT_E_EVENTHANDLE_NOT_EXPECTED)"; break;
    case 0x88890012: out += " (AUDCLNT_E_EXCLUSIVE_MODE_ONLY)"; break;
    case 0x88890013: out += " (AUDCLNT_E_BUFDURATION_PERIOD_NOT_EQUAL)"; break;
    case 0x88890014: out += " (AUDCLNT_E_EVENTHANDLE_NOT_SET)"; break;
    case 0x88890015: out += " (AUDCLNT_E_INCORRECT_BUFFER_SIZE)"; break;
    case 0x88890016: out += " (AUDCLNT_E_BUFFER_SIZE_ERROR)"; break;
    case 0x88890017: out += " (AUDCLNT_E_CPUUSAGE_EXCEEDED)"; break;
    case 0x88890018: out += " (AUDCLNT_E_BUFFER_ERROR)"; break;
    case 0x88890019: out += " (AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED)"; break;
    case 0x88890020: out += " (AUDCLNT_E_INVALID_DEVICE_PERIOD)"; break;
    case 0x88890021: out += " (AUDCLNT_E_INVALID_STREAM_FLAG)"; break;
    case 0x88890022: out += " (AUDCLNT_E_ENDPOINT_OFFLOAD_NOT_CAPABLE)"; break;
    case 0x80070005: out += " (E_ACCESSDENIED)"; break;
    case 0x8007000E: out += " (E_OUTOFMEMORY)"; break;
    case 0x80070057: out += " (E_INVALIDARG)"; break;
    case 0x80004005: out += " (E_FAIL)"; break;
    case 0x80040154: out += " (REGDB_E_CLASSNOTREG)"; break;
    default: break;
  }
  return out;
}

std::string Win32ErrorString(DWORD code) {
  LPWSTR buffer = nullptr;
  DWORD n = FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
                               FORMAT_MESSAGE_IGNORE_INSERTS,
                           nullptr, code, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
                           reinterpret_cast<LPWSTR>(&buffer), 0, nullptr);
  std::string out = "Win32 error " + std::to_string(code);
  if (n && buffer) {
    std::wstring w(buffer, n);
    while (!w.empty() && (w.back() == L'\r' || w.back() == L'\n' || w.back() == L' ')) w.pop_back();
    out += " (" + WcharToUtf8(w) + ")";
  }
  if (buffer) LocalFree(buffer);
  return out;
}

std::string GuidToString(const GUID& g) {
  wchar_t buf[64];
  StringFromGUID2(g, buf, 64);
  return WcharToUtf8(buf);
}

bool GuidFromString(const std::string& s, GUID* out) {
  if (!out) return false;
  std::wstring w = Utf8ToWchar(s);
  if (w.empty()) return false;
  
  std::wstring withBrace = (w.front() == L'{') ? w : (L"{" + w + L"}");
  return SUCCEEDED(CLSIDFromString(withBrace.c_str(), out));
}

#endif  

void LogInitFromEnv() {
  if (g_logTried) return;
  g_logTried = true;
  const char* path = std::getenv("AURORA_LOG");
  if (!path || !*path) return;
  
  
#if defined(_WIN32)
  fopen_s(&g_logFile, path, "a");
#else
  g_logFile = std::fopen(path, "a");
#endif
}

void LogLine(const char* fmt, ...) {
  LogInitFromEnv();
  if (!g_logFile) return;
  std::lock_guard<std::mutex> lock(g_logMutex);
#if defined(_WIN32)
  SYSTEMTIME st;
  GetLocalTime(&st);
  std::fprintf(g_logFile, "[%02d:%02d:%02d.%03d] ", st.wHour, st.wMinute, st.wSecond, st.wMilliseconds);
#else
  
  std::time_t now = std::time(nullptr);
  std::tm tmv{};
  localtime_r(&now, &tmv);
  std::fprintf(g_logFile, "[%02d:%02d:%02d.000] ", tmv.tm_hour, tmv.tm_min, tmv.tm_sec);
#endif
  va_list args;
  va_start(args, fmt);
  std::vfprintf(g_logFile, fmt, args);
  va_end(args);
  std::fputc('\n', g_logFile);
  std::fflush(g_logFile);
}

}  
