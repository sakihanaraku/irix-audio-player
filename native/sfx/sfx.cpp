










#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>      
#include <objbase.h>

#include <string>
#include <vector>

namespace {

const char kMagic[8] = {'A', 'U', 'R', 'O', 'R', 'A', 'S', 'X'};
const wchar_t kAppExe[] = L"iRix Audio Player.exe";
const wchar_t kUnpackDirName[] = L"iRixAudioPlayer";


std::wstring TempDir();
std::wstring JoinPath(const std::wstring& a, const std::wstring& b);

bool g_quiet = false;
std::wstring g_logPath;
std::wstring g_exeDir;
bool g_logResolved = false;


void EnsureLogPath() {
  if (g_logResolved) return;
  g_logResolved = true;
  std::vector<std::wstring> candidates;
  const std::wstring temp = TempDir();
  if (!temp.empty()) candidates.push_back(temp + L"\\iRixAudioPlayer-sfx.log");
  if (!g_exeDir.empty()) candidates.push_back(g_exeDir + L"\\iRixAudioPlayer-sfx.log");
  for (const auto& c : candidates) {
    HANDLE h = CreateFileW(c.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ, nullptr, OPEN_ALWAYS,
                           FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h != INVALID_HANDLE_VALUE) {
      CloseHandle(h);
      g_logPath = c;
      return;
    }
  }
}


void LogLine(const std::wstring& message) {
  EnsureLogPath();
  if (g_logPath.empty()) return;
  HANDLE f = CreateFileW(g_logPath.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ, nullptr,
                         OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (f == INVALID_HANDLE_VALUE) return;
  SYSTEMTIME st;
  GetLocalTime(&st);
  wchar_t stamp[64];
  wsprintfW(stamp, L"[%02d:%02d:%02d.%03d] ", st.wHour, st.wMinute, st.wSecond,
            st.wMilliseconds);
  std::wstring line = std::wstring(stamp) + message + L"\r\n";
  const char* utf8 = nullptr;
  int need = WideCharToMultiByte(CP_UTF8, 0, line.c_str(), -1, nullptr, 0, nullptr, nullptr);
  std::vector<char> buf(need > 0 ? need : 0);
  if (need > 0) {
    WideCharToMultiByte(CP_UTF8, 0, line.c_str(), -1, buf.data(), need, nullptr, nullptr);
    DWORD written = 0;
    WriteFile(f, buf.data(), static_cast<DWORD>(need - 1), &written, nullptr);
  }
  CloseHandle(f);
}

void Fail(const std::wstring& message) {
  LogLine(L"FAIL: " + message);
  if (!g_quiet) {
    MessageBoxW(nullptr, message.c_str(), L"iRix Audio Player Portable", MB_ICONERROR | MB_OK);
  }
  ExitProcess(2);
}

std::wstring OwnPath() {
  std::vector<wchar_t> buf(32768);
  DWORD n = GetModuleFileNameW(nullptr, buf.data(), static_cast<DWORD>(buf.size()));
  std::wstring path(buf.data(), n);
  
  std::vector<wchar_t> longBuf(32768);
  const DWORD ln = GetLongPathNameW(path.c_str(), longBuf.data(),
                                    static_cast<DWORD>(longBuf.size()));
  if (ln > 0 && ln < longBuf.size()) return std::wstring(longBuf.data(), ln);
  return path;
}

std::wstring DirName(const std::wstring& path) {
  const size_t pos = path.find_last_of(L"\\/");
  return pos == std::wstring::npos ? std::wstring() : path.substr(0, pos);
}




std::wstring TempDir() {
  std::vector<wchar_t> buf(32768);
  DWORD n = GetTempPathW(static_cast<DWORD>(buf.size()), buf.data());
  std::wstring dir(buf.data(), n);
  while (!dir.empty() && dir.back() == L'\\') dir.pop_back();
  if (dir.empty()) return dir;

  std::vector<wchar_t> longBuf(32768);
  const DWORD ln = GetLongPathNameW(dir.c_str(), longBuf.data(),
                                    static_cast<DWORD>(longBuf.size()));
  if (ln > 0 && ln < longBuf.size()) {
    std::wstring longDir(longBuf.data(), ln);
    while (!longDir.empty() && longDir.back() == L'\\') longDir.pop_back();
    if (!longDir.empty()) return longDir;
  }
  return dir;
}

bool FileExists(const std::wstring& path) {
  const DWORD attrs = GetFileAttributesW(path.c_str());
  return attrs != INVALID_FILE_ATTRIBUTES && !(attrs & FILE_ATTRIBUTE_DIRECTORY);
}


bool RunAndWait(const std::wstring& cmdline, DWORD* exitCode) {
  std::vector<wchar_t> mutableCmd(cmdline.begin(), cmdline.end());
  mutableCmd.push_back(L'\0');

  STARTUPINFOW si{};
  si.cb = sizeof(si);
  PROCESS_INFORMATION pi{};
  if (!CreateProcessW(nullptr, mutableCmd.data(), nullptr, nullptr, FALSE,
                      CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
    return false;
  }
  WaitForSingleObject(pi.hProcess, INFINITE);
  DWORD code = 1;
  GetExitCodeProcess(pi.hProcess, &code);
  if (exitCode) *exitCode = code;
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  return true;
}

struct Footer {
  unsigned long long offset = 0;
  unsigned long long size = 0;
  bool valid = false;
};

Footer ReadFooter(HANDLE file) {
  Footer f;
  LARGE_INTEGER fileSize{};
  if (!GetFileSizeEx(file, &fileSize)) return f;
  const long long kFooter = 24;
  if (fileSize.QuadPart <= kFooter) return f;

  LARGE_INTEGER pos{};
  pos.QuadPart = fileSize.QuadPart - kFooter;
  if (!SetFilePointerEx(file, pos, nullptr, FILE_BEGIN)) return f;
  unsigned char raw[24] = {0};
  DWORD read = 0;
  if (!ReadFile(file, raw, 24, &read, nullptr) || read != 24) return f;
  if (memcmp(raw + 16, kMagic, 8) != 0) return f;
  memcpy(&f.offset, raw, 8);
  memcpy(&f.size, raw + 8, 8);
  if (f.offset == 0 || f.size == 0) return f;
  if (static_cast<long long>(f.offset + f.size) > fileSize.QuadPart) return f;
  f.valid = true;
  return f;
}


bool IsDirLockedByRunningInstance(const std::wstring& dir) {
  WIN32_FIND_DATAW fd{};
  const std::wstring pattern = dir + L"\\*.exe";
  HANDLE find = FindFirstFileW(pattern.c_str(), &fd);
  if (find == INVALID_HANDLE_VALUE) return false;      
  bool locked = false;
  do {
    if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) continue;
    const std::wstring path = dir + L"\\" + fd.cFileName;
    
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr,
                           OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) {
      const DWORD err = GetLastError();
      if (err == ERROR_SHARING_VIOLATION || err == ERROR_LOCK_VIOLATION) locked = true;
    } else {
      CloseHandle(h);
    }
  } while (!locked && FindNextFileW(find, &fd));
  FindClose(find);
  return locked;
}

bool ExtractPayload(HANDLE self, const Footer& footer, const std::wstring& dir,
                    std::wstring* error) {
  const std::wstring zipPath = dir + L"\\payload.zip";
  HANDLE out = CreateFileW(zipPath.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                           FILE_ATTRIBUTE_NORMAL, nullptr);
  if (out == INVALID_HANDLE_VALUE) {
    *error = L"无法写入临时文件: " + zipPath;
    return false;
  }

  LARGE_INTEGER pos{};
  pos.QuadPart = static_cast<long long>(footer.offset);
  if (!SetFilePointerEx(self, pos, nullptr, FILE_BEGIN)) {
    CloseHandle(out);
    *error = L"无法定位内嵌数据";
    return false;
  }

  std::vector<char> buffer(1 << 20);
  unsigned long long remaining = footer.size;
  while (remaining > 0) {
    const DWORD want = static_cast<DWORD>(remaining > buffer.size() ? buffer.size() : remaining);
    DWORD got = 0;
    if (!ReadFile(self, buffer.data(), want, &got, nullptr) || got == 0) {
      CloseHandle(out);
      *error = L"读取内嵌数据失败";
      return false;
    }
    DWORD written = 0;
    if (!WriteFile(out, buffer.data(), got, &written, nullptr) || written != got) {
      CloseHandle(out);
      *error = L"写入临时压缩包失败（磁盘空间不足？）";
      return false;
    }
    remaining -= got;
  }
  CloseHandle(out);

  DWORD code = 1;
  const std::wstring cmd = L"tar.exe -xf \"" + zipPath + L"\" -C \"" + dir + L"\"";
  if (!RunAndWait(cmd, &code) || code != 0) {
    
    
    
    DeleteFileW(zipPath.c_str());
    *error = IsDirLockedByRunningInstance(dir)
      ? L"解压失败：上一次的 iRix Audio Player 还在运行（文件被占用）。\n"
        L"请先关闭正在运行的窗口（或在任务管理器里结束 iRix Audio Player），然后重新运行本程序。\n"
        L"解压目录: " + dir
      : L"解压失败（tar 返回 " + std::to_wstring(code) + L"）\n解压目录: " + dir;
    return false;
  }
  DeleteFileW(zipPath.c_str());
  return true;
}

std::wstring JoinPath(const std::wstring& a, const std::wstring& b) {
  if (a.empty()) return b;
  if (b.empty()) return a;
  return a.back() == L'\\' ? a + b : a + L"\\" + b;
}





#if defined(SFX_SETUP)
const bool kSetupRole = true;
#else
const bool kSetupRole = false;
#endif
#ifndef SFX_VERSION

#  if defined(__has_include)
#    if __has_include("version.h")
#      include "version.h"
#    endif
#  endif
#endif
#ifndef SFX_VERSION
#define SFX_VERSION L"0.0.0"
#endif
const wchar_t kAppName[] = L"iRix Audio Player";
const wchar_t kUninstallSubKey[] =
    L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\iRixAudioPlayer";

std::wstring EnvVar(const wchar_t* name) {
  std::vector<wchar_t> buf(32768);
  DWORD n = GetEnvironmentVariableW(name, buf.data(), static_cast<DWORD>(buf.size()));
  return n ? std::wstring(buf.data(), n) : std::wstring();
}


bool DirWritable(const std::wstring& dir) {
  CreateDirectoryW(dir.c_str(), nullptr);
  const DWORD attrs = GetFileAttributesW(dir.c_str());
  if (attrs == INVALID_FILE_ATTRIBUTES || !(attrs & FILE_ATTRIBUTE_DIRECTORY)) return false;
  const std::wstring probe = JoinPath(dir, L".write-probe");
  HANDLE h = CreateFileW(probe.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                         FILE_ATTRIBUTE_NORMAL, nullptr);
  if (h == INVALID_HANDLE_VALUE) return false;
  DWORD written = 0;
  WriteFile(h, "x", 1, &written, nullptr);
  CloseHandle(h);
  DeleteFileW(probe.c_str());
  return true;
}


std::wstring PickUnpackDir(const std::wstring& exeDir, const std::wstring& explicitDir) {
  std::vector<std::wstring> candidates;
  if (!explicitDir.empty()) {
    candidates.push_back(explicitDir);
  } else {
    const std::wstring lad = EnvVar(L"LOCALAPPDATA");
    if (!lad.empty()) candidates.push_back(JoinPath(lad, kUnpackDirName));
    const std::wstring temp = TempDir();
    if (!temp.empty()) candidates.push_back(JoinPath(temp, kUnpackDirName));
    if (!exeDir.empty()) candidates.push_back(JoinPath(exeDir, L"iRixAudioPlayer-unpacked"));
  }
  for (const auto& dir : candidates) {
    if (DirWritable(dir)) return dir;
    LogLine(L"释放目录不可写，跳过: " + dir);
  }
  return std::wstring();
}


std::vector<wchar_t> BuildEnvironment(const std::wstring& portableDir,
                                      const std::wstring& portableFile) {
  std::vector<wchar_t> block;
  LPWCH current = GetEnvironmentStringsW();
  if (current) {
    for (LPWCH p = current; *p;) {
      const std::wstring entry(p);
      
      
      if (entry.rfind(L"PORTABLE_EXECUTABLE_DIR=", 0) != 0 &&
          entry.rfind(L"PORTABLE_EXECUTABLE_FILE=", 0) != 0 &&
          entry.rfind(L"ELECTRON_RUN_AS_NODE=", 0) != 0) {
        block.insert(block.end(), entry.begin(), entry.end());
        block.push_back(L'\0');
      }
      p += entry.size() + 1;
    }
    FreeEnvironmentStringsW(current);
  }
  const std::wstring dirVar = L"PORTABLE_EXECUTABLE_DIR=" + portableDir;
  const std::wstring fileVar = L"PORTABLE_EXECUTABLE_FILE=" + portableFile;
  block.insert(block.end(), dirVar.begin(), dirVar.end());
  block.push_back(L'\0');
  block.insert(block.end(), fileVar.begin(), fileVar.end());
  block.push_back(L'\0');
  block.push_back(L'\0');
  return block;
}

std::wstring DefaultInstallDir() {
  std::wstring base = EnvVar(L"LOCALAPPDATA");
  if (base.empty()) base = EnvVar(L"USERPROFILE");
  if (base.empty()) return std::wstring();
  return JoinPath(JoinPath(base, L"Programs"), kAppName);
}


bool RunCmd(const std::wstring& cmd, DWORD* code) {
  return RunAndWait(cmd, code);
}






bool CreateShortcut(const std::wstring& lnkPath, const std::wstring& target,
                    const std::wstring& workDir) {
  const HRESULT hrInit = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  IShellLinkW* link = nullptr;
  HRESULT hr = CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER,
                                IID_IShellLinkW, reinterpret_cast<void**>(&link));
  bool ok = false;
  if (SUCCEEDED(hr) && link) {
    link->SetPath(target.c_str());
    link->SetWorkingDirectory(workDir.c_str());
    link->SetIconLocation(target.c_str(), 0);
    link->SetDescription(kAppName);
    IPersistFile* file = nullptr;
    if (SUCCEEDED(link->QueryInterface(IID_IPersistFile, reinterpret_cast<void**>(&file))) && file) {
      ok = SUCCEEDED(file->Save(lnkPath.c_str(), TRUE));
      file->Release();
    }
    link->Release();
  }
  if (hrInit == S_OK || hrInit == S_FALSE) CoUninitialize();
  LogLine((ok ? L"已建快捷方式: " : L"建快捷方式失败: ") + lnkPath);
  return ok;
}


bool RegAdd(const std::wstring& key, const std::wstring& name, const std::wstring& value) {
  HKEY handle = nullptr;
  if (RegCreateKeyExW(HKEY_CURRENT_USER, key.c_str(), 0, nullptr, 0, KEY_WRITE, nullptr,
                      &handle, nullptr) != ERROR_SUCCESS) {
    LogLine(L"打开注册表键失败: " + key);
    return false;
  }
  const DWORD bytes = static_cast<DWORD>((value.size() + 1) * sizeof(wchar_t));
  const LSTATUS st = RegSetValueExW(handle, name.c_str(), 0, REG_SZ,
                                    reinterpret_cast<const BYTE*>(value.c_str()), bytes);
  RegCloseKey(handle);
  if (st != ERROR_SUCCESS) LogLine(L"写注册表失败: " + name);
  return st == ERROR_SUCCESS;
}


void RegDeleteTree(const std::wstring& key) {
  RegDeleteTreeW(HKEY_CURRENT_USER, key.c_str());
}









std::wstring InstallTo(const std::wstring& dir, const std::wstring& suffix,
                       bool shortcuts, bool silent, unsigned long long payloadSize) {
  if (!DirWritable(dir)) return L"安装目录不可写: " + dir;

  const std::wstring appExe = JoinPath(dir, kAppExe);
  if (!FileExists(appExe)) return L"安装后找不到主程序: " + appExe;

  const std::wstring displayName = suffix.empty()
      ? std::wstring(kAppName) : std::wstring(kAppName) + L" (" + suffix + L")";

  if (shortcuts) {
    const std::wstring appData = EnvVar(L"APPDATA");
    const std::wstring userProfile = EnvVar(L"USERPROFILE");
    if (!appData.empty()) {
      CreateShortcut(JoinPath(JoinPath(JoinPath(JoinPath(appData, L"Microsoft"), L"Windows"),
                             L"Start Menu\\Programs"), displayName + L".lnk"), appExe, dir);
    }
    if (!userProfile.empty()) {
      CreateShortcut(JoinPath(JoinPath(userProfile, L"Desktop"), displayName + L".lnk"), appExe, dir);
    }
  }

  
  const std::wstring key = std::wstring(kUninstallSubKey) +
                           (suffix.empty() ? L"" : L"-" + suffix);
  RegAdd(key, L"DisplayName", displayName);
  RegAdd(key, L"DisplayVersion", SFX_VERSION);
  RegAdd(key, L"Publisher", L"iRix");
  RegAdd(key, L"InstallLocation", dir);
  RegAdd(key, L"DisplayIcon", appExe);
  RegAdd(key, L"UninstallString", L"\"" + appExe + L"\" --uninstall");
  RegAdd(key, L"QuietUninstallString", L"\"" + appExe + L"\" --uninstall --quiet");
  RegAdd(key, L"NoModify", L"1");
  RegAdd(key, L"NoRepair", L"1");
  RegAdd(key, L"EstimatedSize", std::to_wstring(payloadSize / 1024));

  if (!silent) {
    const std::wstring msg = L"安装完成。\n\n安装位置: " + dir +
                             L"\n\n是否立即启动 " + displayName + L"？";
    const int r = MessageBoxW(nullptr, msg.c_str(), L"iRix Audio Player 安装程序",
                              MB_ICONINFORMATION | MB_YESNO);
    if (r == IDYES) return std::wstring();      
    return L"__no_launch__";
  }
  return std::wstring();
}


void Uninstall(const std::wstring& dir, const std::wstring& suffix, bool silent) {
  const std::wstring displayName = suffix.empty()
      ? std::wstring(kAppName) : std::wstring(kAppName) + L" (" + suffix + L")";
  const std::wstring appData = EnvVar(L"APPDATA");
  const std::wstring userProfile = EnvVar(L"USERPROFILE");
  if (!appData.empty()) {
    DeleteFileW(JoinPath(JoinPath(JoinPath(JoinPath(appData, L"Microsoft"), L"Windows"),
                          L"Start Menu\\Programs"), displayName + L".lnk").c_str());
  }
  if (!userProfile.empty()) {
    DeleteFileW(JoinPath(JoinPath(userProfile, L"Desktop"), displayName + L".lnk").c_str());
  }
  RegDeleteTree(std::wstring(kUninstallSubKey) + (suffix.empty() ? L"" : L"-" + suffix));

  if (!silent) {
    MessageBoxW(nullptr, (L"已卸载 " + displayName + L"。\n\n程序文件将在后台删除。").c_str(),
                L"iRix Audio Player", MB_ICONINFORMATION | MB_OK);
  }
  if (!dir.empty()) {
    
    std::wstring cmd = L"cmd.exe /c ping -n 3 127.0.0.1 >nul & rmdir /s /q \"" + dir + L"\"";
    DWORD code = 0;
    RunCmd(cmd, &code);
  }
}



}  

int WINAPI wWinMain(HINSTANCE, HINSTANCE, LPWSTR, int) {
  int argc = 0;
  LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  bool extractOnly = false;
  bool force = false;
  bool clean = false;
  bool install = kSetupRole;          
  bool uninstall = false;
  bool noShortcuts = false;
  bool noLaunch = false;
  std::wstring passthrough;
  std::wstring explicitDir;
  std::wstring suffix;
  for (int i = 1; i < argc; ++i) {
    const std::wstring arg = argv[i];
    if (arg == L"--extract-only") {
      extractOnly = true;
    } else if (arg == L"--install") {
      install = true;
    } else if (arg == L"--uninstall") {
      uninstall = true;
      install = false;
    } else if (arg == L"--no-shortcuts") {
      noShortcuts = true;
    } else if (arg == L"--no-launch") {
      noLaunch = true;
    } else if (arg == L"--force") {
      force = true;
    } else if (arg == L"--clean") {
      clean = true;
    } else if (arg == L"--quiet") {
      g_quiet = true;
      noLaunch = noLaunch || kSetupRole;
    } else if (arg.rfind(L"--suffix=", 0) == 0) {
      suffix = arg.substr(9);
    } else if (arg.rfind(L"--install-dir=", 0) == 0) {
      explicitDir = arg.substr(14);
    } else if (arg == L"--install-dir" && i + 1 < argc) {
      explicitDir = argv[++i];
    } else if (arg.rfind(L"--unpack-dir=", 0) == 0) {
      explicitDir = arg.substr(13);
    } else if (arg == L"--unpack-dir" && i + 1 < argc) {
      explicitDir = argv[++i];
    } else {
      if (!passthrough.empty()) passthrough += L' ';
      passthrough += L"\"" + arg + L"\"";
    }
  }
  if (argv) LocalFree(argv);

  const std::wstring selfPath = OwnPath();
  g_exeDir = DirName(selfPath);
  LogLine(L"---- 启动: " + selfPath +
          (extractOnly ? L" [extract-only]" : L"") + (install ? L" [install]" : L"") +
          (uninstall ? L" [uninstall]" : L""));

  HANDLE self = CreateFileW(selfPath.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr,
                            OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (self == INVALID_HANDLE_VALUE) Fail(L"无法打开自身文件（请把 exe 放在可读目录）");

  const Footer footer = ReadFooter(self);
  if (!footer.valid) {
    CloseHandle(self);
    Fail(L"内嵌数据索引损坏：这个 exe 可能被截断或未按预期方式拼接。");
  }
  LogLine(L"内嵌数据: offset=" + std::to_wstring(footer.offset) + L" size=" +
          std::to_wstring(footer.size));

  
  std::wstring dir;
  if (install) {
    dir = explicitDir.empty() ? DefaultInstallDir() : explicitDir;
  } else {
    dir = PickUnpackDir(g_exeDir, explicitDir);
  }
  if (dir.empty()) {
    CloseHandle(self);
    Fail(L"找不到可写的释放目录（已尝试 %LOCALAPPDATA%、%TEMP% 与 exe 同级目录）。\n"
         L"可以用 --unpack-dir=<目录> 手动指定。");
  }
  
  
  
  const std::wstring marker = JoinPath(dir, L".payload-" + std::to_wstring(footer.size) +
                                            L"-" + std::to_wstring(footer.offset));
  const std::wstring appExe = JoinPath(dir, kAppExe);
  LogLine(L"释放目录: " + dir);

  if (clean) {
    const std::wstring cmd = L"cmd.exe /c rmdir /s /q \"" + dir + L"\"";
    DWORD code = 0;
    RunAndWait(cmd, &code);
    LogLine(L"已清空释放目录");
  }

  if (force || !FileExists(marker)) {
    CreateDirectoryW(dir.c_str(), nullptr);
    LogLine(L"开始解包…");
    std::wstring error;
    if (!ExtractPayload(self, footer, dir, &error)) {
      CloseHandle(self);
      Fail(error + L"\n\n临时目录: " + dir);
    }
    HANDLE m = CreateFileW(marker.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                           FILE_ATTRIBUTE_NORMAL, nullptr);
    if (m != INVALID_HANDLE_VALUE) CloseHandle(m);
    LogLine(L"解包完成");
  } else {
    LogLine(L"使用已存在的释放目录（跳过解包）");
  }
  CloseHandle(self);

  if (!FileExists(appExe)) {
    Fail(L"解包后找不到主程序:\n" + appExe);
  }

  
  if (uninstall) {
    LogLine(L"开始卸载: " + dir);
    Uninstall(dir, suffix, g_quiet);
    return 0;
  }

  if (extractOnly) {
    LogLine(L"--extract-only 完成");
    return 0;
  }

  
  if (install) {
    const std::wstring err = InstallTo(dir, suffix, !noShortcuts, g_quiet, footer.size);
    if (!err.empty() && err != L"__no_launch__") {
      Fail(err);
    }
    LogLine(L"安装完成: " + dir);
    if (err == L"__no_launch__" || noLaunch) return 0;
  }

  
  const std::wstring portableDir = DirName(selfPath);
  std::vector<wchar_t> env = BuildEnvironment(portableDir, selfPath);
  std::wstring cmdline = L"\"" + appExe + L"\"" + (passthrough.empty() ? L"" : L" " + passthrough);
  std::vector<wchar_t> mutableCmd(cmdline.begin(), cmdline.end());
  mutableCmd.push_back(L'\0');

  STARTUPINFOW si{};
  si.cb = sizeof(si);
  PROCESS_INFORMATION pi{};
  if (!CreateProcessW(appExe.c_str(), mutableCmd.data(), nullptr, nullptr, FALSE,
                      CREATE_UNICODE_ENVIRONMENT, env.data(), dir.c_str(), &si, &pi)) {
    Fail(L"启动主程序失败（错误码 " + std::to_wstring(GetLastError()) + L"）\n" + appExe);
  }
  CloseHandle(pi.hThread);
  WaitForSingleObject(pi.hProcess, INFINITE);
  DWORD code = 0;
  GetExitCodeProcess(pi.hProcess, &code);
  CloseHandle(pi.hProcess);
  return static_cast<int>(code);
}
