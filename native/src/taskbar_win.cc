








#if defined(_WIN32)

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#define _WIN32_WINNT 0x0A00

#include "taskbar.h"

#include <windows.h>
#include <objbase.h>
#include <shobjidl.h>

#include <cstring>
#include <memory>

namespace aurora {
namespace {

struct TaskbarState {
  HWND hwnd = nullptr;
  WNDPROC old_proc = nullptr;
  ITaskbarList3* taskbar = nullptr;
  UINT taskbar_created_msg = 0;
  bool added = false;
  bool installed = false;
  bool playing = false;
  bool com_initialized = false;
  bool com_should_uninit = false;
  HICON icons[4] = {nullptr, nullptr, nullptr, nullptr};  
  napi_threadsafe_function tsfn = nullptr;
};

TaskbarState g;


HICON CreateIconFromBgra(const TaskbarIconBitmap& src) {
  if (src.width == 0 || src.height == 0) return nullptr;
  const size_t need = static_cast<size_t>(src.width) * src.height * 4;
  if (src.bgra.size() < need) return nullptr;

  BITMAPV5HEADER bi{};
  bi.bV5Size = sizeof(bi);
  bi.bV5Width = static_cast<LONG>(src.width);
  bi.bV5Height = -static_cast<LONG>(src.height);  
  bi.bV5Planes = 1;
  bi.bV5BitCount = 32;
  bi.bV5Compression = BI_BITFIELDS;
  bi.bV5RedMask = 0x00FF0000;
  bi.bV5GreenMask = 0x0000FF00;
  bi.bV5BlueMask = 0x000000FF;
  bi.bV5AlphaMask = 0xFF000000;

  HDC screen = GetDC(nullptr);
  if (!screen) return nullptr;
  void* bits = nullptr;
  HBITMAP color = CreateDIBSection(screen, reinterpret_cast<BITMAPINFO*>(&bi), DIB_RGB_COLORS,
                                   &bits, nullptr, 0);
  ReleaseDC(nullptr, screen);
  if (!color || !bits) {
    if (color) DeleteObject(color);
    return nullptr;
  }
  std::memcpy(bits, src.bgra.data(), need);

  
  const size_t mask_stride = ((src.width + 15) / 16) * 2;
  std::vector<uint8_t> mask_bits(mask_stride * src.height, 0);
  HBITMAP mask = CreateBitmap(static_cast<int>(src.width), static_cast<int>(src.height), 1, 1,
                              mask_bits.data());

  ICONINFO ii{};
  ii.fIcon = TRUE;
  ii.hbmMask = mask;
  ii.hbmColor = color;
  HICON icon = CreateIconIndirect(&ii);

  if (mask) DeleteObject(mask);
  DeleteObject(color);
  return icon;
}

void DestroyIcons() {
  for (auto& icon : g.icons) {
    if (icon) {
      DestroyIcon(icon);
      icon = nullptr;
    }
  }
}

void EnsureComInitialized() {
  if (g.com_initialized) return;
  const HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  
  
  g.com_initialized = SUCCEEDED(hr) || hr == RPC_E_CHANGED_MODE;
  g.com_should_uninit = (hr == S_OK || hr == S_FALSE);
}

bool EnsureTaskbarList() {
  if (g.taskbar) return true;
  EnsureComInitialized();
  HRESULT hr = CoCreateInstance(CLSID_TaskbarList, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(&g.taskbar));
  if (FAILED(hr) || !g.taskbar) {
    g.taskbar = nullptr;
    return false;
  }
  hr = g.taskbar->HrInit();
  if (FAILED(hr)) {
    g.taskbar->Release();
    g.taskbar = nullptr;
    return false;
  }
  return true;
}

void BuildButtons(THUMBBUTTON out[3]) {
  std::memset(out, 0, sizeof(THUMBBUTTON) * 3);
  const HICON middle = g.playing ? g.icons[2] : g.icons[1];
  const HICON button_icons[3] = {g.icons[0], middle, g.icons[3]};
  const wchar_t* tips[3] = {L"上一首", L"播放/暂停", L"下一首"};
  for (int i = 0; i < 3; ++i) {
    out[i].dwMask = THB_ICON | THB_TOOLTIP | THB_FLAGS;
    out[i].iId = static_cast<UINT>(i);
    out[i].hIcon = button_icons[i];
    out[i].dwFlags = THBF_ENABLED;
    wcsncpy_s(out[i].szTip, tips[i], _TRUNCATE);
  }
}

bool AddButtons() {
  if (!g.hwnd || g.added) return g.added;
  if (!EnsureTaskbarList()) return false;
  THUMBBUTTON buttons[3];
  BuildButtons(buttons);
  const HRESULT hr = g.taskbar->ThumbBarAddButtons(g.hwnd, 3, buttons);
  g.added = SUCCEEDED(hr);
  return g.added;
}

bool UpdateButtons() {
  if (!g.added) return AddButtons();
  if (!g.taskbar) return false;
  THUMBBUTTON buttons[3];
  BuildButtons(buttons);
  const HRESULT hr = g.taskbar->ThumbBarUpdateButtons(g.hwnd, 3, buttons);
  return SUCCEEDED(hr);
}

void PostCommand(const char* command) {
  if (!g.tsfn) return;
  auto* payload = new std::string(command);
  const napi_status status = napi_call_threadsafe_function(g.tsfn, payload, napi_tsfn_nonblocking);
  if (status != napi_ok) delete payload;
}


void DispatchCommand(int id) {
  if (id == 0) {
    PostCommand("prev");
  } else if (id == 1) {
    PostCommand(g.playing ? "pause" : "play");
  } else if (id == 2) {
    PostCommand("next");
  }
}

LRESULT CALLBACK SubclassProc(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam) {
  if (msg == g.taskbar_created_msg && msg != 0) {
    
    g.added = false;
    if (EnsureTaskbarList()) AddButtons();
    return 0;
  }
  if (msg == WM_COMMAND && HIWORD(wparam) == THBN_CLICKED) {
    DispatchCommand(static_cast<int>(LOWORD(wparam)));
    return 0;
  }
  if (msg == WM_NCDESTROY) {
    
    WNDPROC old_proc = g.old_proc;
    if (old_proc) SetWindowLongPtrW(hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(old_proc));
    g.hwnd = nullptr;
    g.old_proc = nullptr;
    g.added = false;
    if (old_proc) return CallWindowProcW(old_proc, hwnd, msg, wparam, lparam);
    return 0;
  }
  return CallWindowProcW(g.old_proc, hwnd, msg, wparam, lparam);
}

void CallJs(napi_env env, napi_value js_callback, void* , void* data) {
  std::unique_ptr<std::string> payload(static_cast<std::string*>(data));
  if (!env || !js_callback || !payload) return;
  napi_value command = nullptr;
  napi_value global = nullptr;
  napi_get_global(env, &global);
  napi_create_string_utf8(env, payload->c_str(), NAPI_AUTO_LENGTH, &command);
  napi_call_function(env, global, js_callback, 1, &command, nullptr);
}

}  

bool TaskbarInstall(void* hwnd_ptr, const TaskbarIcons& icons, napi_env env,
                    napi_value on_command, std::string* error) {
  if (!hwnd_ptr) {
    if (error) *error = "窗口句柄为空";
    return false;
  }
  HWND hwnd = reinterpret_cast<HWND>(hwnd_ptr);
  if (!IsWindow(hwnd)) {
    if (error) *error = "窗口句柄无效";
    return false;
  }

  
  if (!g.installed) {
    const TaskbarIconBitmap* sources[4] = {&icons.prev, &icons.play, &icons.pause, &icons.next};
    for (int i = 0; i < 4; ++i) {
      g.icons[i] = CreateIconFromBgra(*sources[i]);
      if (!g.icons[i]) {
        if (error) *error = "任务栏图标创建失败（位图数据无效）";
        DestroyIcons();
        return false;
      }
    }

    g.old_proc = reinterpret_cast<WNDPROC>(SetWindowLongPtrW(
        hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(SubclassProc)));
    if (!g.old_proc) {
      if (error) *error = "窗口子类化失败";
      DestroyIcons();
      return false;
    }

    g.taskbar_created_msg = RegisterWindowMessageW(L"TaskbarButtonCreated");
    g.hwnd = hwnd;

    
    ChangeWindowMessageFilterEx(hwnd, WM_COMMAND, MSGFLT_ALLOW, nullptr);

    napi_value resource_name = nullptr;
    napi_create_string_utf8(env, "aurora_taskbar_command", NAPI_AUTO_LENGTH, &resource_name);
    const napi_status status =
        napi_create_threadsafe_function(env, on_command, nullptr, resource_name, 0, 1, nullptr,
                                        nullptr, nullptr, CallJs, &g.tsfn);
    if (status != napi_ok) {
      if (error) *error = "任务栏点击回调创建失败";
      SetWindowLongPtrW(hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(g.old_proc));
      g.old_proc = nullptr;
      g.hwnd = nullptr;
      DestroyIcons();
      return false;
    }
    g.installed = true;
  }

  EnsureComInitialized();
  AddButtons();  
  return true;
}

bool TaskbarUpdate(bool playing) {
  if (!g.installed) return false;
  const bool changed = (g.playing != playing);
  g.playing = playing;
  if (!g.added) return AddButtons();
  if (!changed) return true;
  return UpdateButtons();
}

void TaskbarDispose() {
  if (g.tsfn) {
    napi_release_threadsafe_function(g.tsfn, napi_tsfn_release);
    g.tsfn = nullptr;
  }
  if (g.hwnd && g.old_proc && IsWindow(g.hwnd)) {
    SetWindowLongPtrW(g.hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(g.old_proc));
  }
  g.hwnd = nullptr;
  g.old_proc = nullptr;
  g.added = false;
  g.installed = false;
  g.playing = false;
  DestroyIcons();
  if (g.taskbar) {
    g.taskbar->Release();
    g.taskbar = nullptr;
  }
  if (g.com_initialized) {
    if (g.com_should_uninit) CoUninitialize();
    g.com_initialized = false;
    g.com_should_uninit = false;
  }
}

}  

#endif  
