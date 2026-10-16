
#pragma once

#include <cstdarg>
#include <cstdint>
#include <string>


#if defined(_WIN32)
#include <windows.h>
#include <objbase.h>
#endif

namespace aurora {

#if defined(_WIN32)
std::string WcharToUtf8(const wchar_t* w, int len = -1);
std::string WcharToUtf8(const std::wstring& w);
std::wstring Utf8ToWchar(const std::string& s);

std::string HrToString(HRESULT hr);
std::string Win32ErrorString(DWORD code);
std::string GuidToString(const GUID& g);
bool GuidFromString(const std::string& s, GUID* out);
#endif

std::string Hex32(uint32_t v);


void LogInitFromEnv();
void LogLine(const char* fmt, ...);


inline uint32_t FourCC(const char* s) {
  return (static_cast<uint32_t>(static_cast<unsigned char>(s[0]))) |
         (static_cast<uint32_t>(static_cast<unsigned char>(s[1])) << 8) |
         (static_cast<uint32_t>(static_cast<unsigned char>(s[2])) << 16) |
         (static_cast<uint32_t>(static_cast<unsigned char>(s[3])) << 24);
}


template <typename T>
class ComPtr {
 public:
  ComPtr() = default;
  ~ComPtr() { Reset(); }
  ComPtr(const ComPtr&) = delete;
  ComPtr& operator=(const ComPtr&) = delete;

  T* Get() const { return ptr_; }
  T** Put() {
    Reset();
    return &ptr_;
  }
  T* operator->() const { return ptr_; }
  explicit operator bool() const { return ptr_ != nullptr; }

  void Attach(T* p) {
    Reset();
    ptr_ = p;
  }
  void Reset() {
    if (ptr_) {
      ptr_->Release();
      ptr_ = nullptr;
    }
  }

 private:
  T* ptr_ = nullptr;
};

}  
