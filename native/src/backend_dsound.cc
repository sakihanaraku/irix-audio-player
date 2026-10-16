
#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <thread>

#include "backend.h"
#include "util.h"
#include "win_common.h"

namespace aurora {
namespace {

constexpr int kNotifyPoints = 4;

class DirectSoundBackend : public IAudioBackend {
 public:
  ~DirectSoundBackend() override { Close(); }

  const char* Name() const override { return backend_id::kDirectSound; }

  bool Open(const OpenParams& params, std::string* error) override {
    params_ = params;
    stop_ = false;
    startRequested_ = false;
    ready_ = false;
    openError_.clear();
    event_ = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!event_) {
      if (error) *error = u8"创建事件对象失败";
      return false;
    }
    thread_ = std::thread([this] { ThreadMain(); });

    std::unique_lock<std::mutex> lock(mutex_);
    if (!cv_.wait_for(lock, std::chrono::seconds(10), [this] { return ready_; })) {
      stop_ = true;
      lock.unlock();
      cv_.notify_all();
      SetEvent(event_);
      if (thread_.joinable()) thread_.join();
      CloseHandle(event_);
      event_ = nullptr;
      if (error) *error = u8"打开 DirectSound 设备超时";
      return false;
    }
    if (!openError_.empty()) {
      const std::string err = openError_;
      lock.unlock();
      if (thread_.joinable()) thread_.join();
      CloseHandle(event_);
      event_ = nullptr;
      if (error) *error = err;
      return false;
    }
    lock.unlock();
    LogLine("directsound: 打开成功 %uHz/%uch/%ubit 缓冲 %u 字节", fmt_.sampleRate, fmt_.channels,
            fmt_.bits, bufferBytes_);
    return true;
  }

  void Start() override {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      startRequested_ = true;
    }
    cv_.notify_all();
  }

  void SetPaused(bool paused) override {
    AudioEngine* eng = engine_.load(std::memory_order_acquire);
    if (eng) eng->SetPaused(paused);
  }
  bool IsPaused() const override {
    AudioEngine* eng = engine_.load(std::memory_order_acquire);
    return eng && eng->Paused();
  }
  DeviceFormat Format() const override { return fmt_; }
  std::string DeviceName() const override {
    std::lock_guard<std::mutex> lock(nameMutex_);
    return deviceName_;
  }
  std::string LastError() const override {
    std::lock_guard<std::mutex> lock(errMutex_);
    return lastError_;
  }
  AudioEngine* Engine() override { return engine_.load(std::memory_order_acquire); }
  void SetEngine(AudioEngine* engine) override { engine_.store(engine, std::memory_order_release); }

  void Close() override {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      stop_ = true;
    }
    cv_.notify_all();
    if (event_) SetEvent(event_);
    if (thread_.joinable()) thread_.join();
    for (int i = 0; i < kNotifyPoints; ++i) {
      if (notifyEvents_[i]) {
        CloseHandle(notifyEvents_[i]);
        notifyEvents_[i] = nullptr;
      }
    }
    if (event_) {
      CloseHandle(event_);
      event_ = nullptr;
    }
  }

 private:
  void ThreadMain() {
    ComApartment com;
    com.usable();  
    std::string err;
    if (!SetupDevice(&err)) {
      SignalReady(err);
      return;
    }
    {
      std::unique_lock<std::mutex> lock(mutex_);
      ready_ = true;
      cv_.notify_all();
      cv_.wait(lock, [this] { return startRequested_ || stop_; });
      if (stop_) {
        Teardown();
        return;
      }
    }
    if (!StartStream(&err)) {
      SetLastError(err);
      Teardown();
      return;
    }
    RenderLoop();
    Teardown();
  }

  void SignalReady(const std::string& err) {
    std::lock_guard<std::mutex> lock(mutex_);
    openError_ = err;
    ready_ = true;
    cv_.notify_all();
  }

  bool SetupDevice(std::string* error) {
    GUID guid;
    GUID* guidPtr = nullptr;
    if (!params_.deviceId.empty() && params_.deviceId != "default") {
      if (!GuidFromString(params_.deviceId, &guid)) {
        *error = u8"DirectSound 设备 ID 无效: " + params_.deviceId;
        return false;
      }
      guidPtr = &guid;
    }

    HRESULT hr = DirectSoundCreate8(guidPtr, ds8_.Put(), nullptr);
    if (FAILED(hr)) {
      *error = u8"DirectSoundCreate8 失败: " + HrToString(hr);
      return false;
    }

    HWND hwnd = GetDesktopWindow();
    if (!params_.hwndHex.empty()) {
      hwnd = reinterpret_cast<HWND>(static_cast<uintptr_t>(std::strtoull(params_.hwndHex.c_str(), nullptr, 16)));
      if (!hwnd) hwnd = GetDesktopWindow();
    }
    hr = ds8_->SetCooperativeLevel(hwnd, DSSCL_PRIORITY);
    if (FAILED(hr)) {
      *error = u8"SetCooperativeLevel 失败: " + HrToString(hr);
      return false;
    }

    
    DeviceFormat want;
    want.sampleRate = params_.sampleRate ? params_.sampleRate : 44100;
    want.channels = params_.channels ? params_.channels : 2;
    if (want.channels > 2) want.channels = 2;
    want.bits = 16;
    want.isFloat = false;
    want.validBits = 16;
    want.channelMask = ChannelMaskFor(want.channels);

    WAVEFORMATEX wfx;
    ZeroMemory(&wfx, sizeof(wfx));
    wfx.wFormatTag = WAVE_FORMAT_PCM;
    wfx.nChannels = want.channels;
    wfx.nSamplesPerSec = want.sampleRate;
    wfx.wBitsPerSample = 16;
    wfx.nBlockAlign = static_cast<WORD>(wfx.nChannels * 2);
    wfx.nAvgBytesPerSec = wfx.nBlockAlign * wfx.nSamplesPerSec;
    wfx.cbSize = 0;

    const uint32_t bufferMs = params_.bufferMs ? params_.bufferMs : 200;
    bufferBytes_ = want.sampleRate * wfx.nBlockAlign * bufferMs / 1000;
    const uint32_t minBytes = wfx.nBlockAlign * 256;
    if (bufferBytes_ < minBytes) bufferBytes_ = minBytes;
    bufferBytes_ -= bufferBytes_ % wfx.nBlockAlign;
    
    bufferBytes_ -= bufferBytes_ % (wfx.nBlockAlign * kNotifyPoints);

    DSBUFFERDESC desc;
    ZeroMemory(&desc, sizeof(desc));
    desc.dwSize = sizeof(desc);
    desc.dwFlags = DSBCAPS_CTRLPOSITIONNOTIFY | DSBCAPS_GETCURRENTPOSITION2 | DSBCAPS_GLOBALFOCUS;
    desc.dwBufferBytes = bufferBytes_;
    desc.lpwfxFormat = &wfx;
    desc.guid3DAlgorithm = DS3DALG_DEFAULT;

    ComPtr<IDirectSoundBuffer> buffer;
    hr = ds8_->CreateSoundBuffer(&desc, buffer.Put(), nullptr);
    if (FAILED(hr)) {
      *error = u8"CreateSoundBuffer 失败: " + HrToString(hr);
      return false;
    }
    hr = buffer->QueryInterface(kIidDirectSoundBuffer8, reinterpret_cast<void**>(buffer8_.Put()));
    if (FAILED(hr)) {
      *error = u8"获取 IDirectSoundBuffer8 失败: " + HrToString(hr);
      return false;
    }

    ComPtr<IDirectSoundNotify> notify;
    hr = buffer8_->QueryInterface(kIidDirectSoundNotify, reinterpret_cast<void**>(notify.Put()));
    if (FAILED(hr)) {
      *error = u8"获取 IDirectSoundNotify 失败: " + HrToString(hr);
      return false;
    }
    DSBPOSITIONNOTIFY positions[kNotifyPoints];
    for (int i = 0; i < kNotifyPoints; ++i) {
      notifyEvents_[i] = CreateEventW(nullptr, FALSE, FALSE, nullptr);
      positions[i].dwOffset = bufferBytes_ / kNotifyPoints * i;
      positions[i].hEventNotify = notifyEvents_[i];
    }
    hr = notify->SetNotificationPositions(kNotifyPoints, positions);
    if (FAILED(hr)) {
      *error = u8"SetNotificationPositions 失败: " + HrToString(hr);
      return false;
    }

    
    void* p1 = nullptr;
    void* p2 = nullptr;
    DWORD n1 = 0, n2 = 0;
    if (SUCCEEDED(buffer8_->Lock(0, bufferBytes_, &p1, &n1, &p2, &n2, 0))) {
      if (p1) std::memset(p1, 0, n1);
      if (p2) std::memset(p2, 0, n2);
      buffer8_->Unlock(p1, n1, p2, n2);
    }

    fmt_ = want;
    writePos_ = 0;
    {
      std::lock_guard<std::mutex> lock(nameMutex_);
      if (!params_.deviceId.empty() && params_.deviceId != "default") {
        deviceName_ = u8"DirectSound 设备 " + params_.deviceId;
      } else {
        deviceName_ = u8"主声音驱动程序 (DirectSound 默认)";
      }
    }
    return true;
  }

  bool StartStream(std::string* error) {
    const HRESULT hr = buffer8_->Play(0, 0, DSBPLAY_LOOPING);
    if (FAILED(hr)) {
      *error = u8"DirectSound Play 失败: " + HrToString(hr);
      return false;
    }
    playing_ = true;
    return true;
  }

  void RenderLoop() {
    const uint32_t bpf = fmt_.BytesPerFrame();
    if (bpf == 0) {
      SetLastError(u8"设备格式无效");
      return;
    }
    HANDLE handles[kNotifyPoints + 1];
    handles[0] = event_;
    for (int i = 0; i < kNotifyPoints; ++i) handles[i + 1] = notifyEvents_[i];

    while (!stop_) {
      const DWORD wait = WaitForMultipleObjects(kNotifyPoints + 1, handles, FALSE, 500);
      if (stop_) break;
      if (wait == WAIT_OBJECT_0) continue;  
      if (wait == WAIT_TIMEOUT) continue;
      if (wait == WAIT_FAILED) {
        SetLastError(u8"等待 DirectSound 通知失败");
        break;
      }
      Fill();
    }
  }

  void Fill() {
    const uint32_t bpf = fmt_.BytesPerFrame();
    DWORD play = 0, writeCursor = 0;
    if (FAILED(buffer8_->GetCurrentPosition(&play, &writeCursor))) {
      SetLastError(u8"GetCurrentPosition 失败");
      stop_ = true;
      return;
    }
    const uint32_t space = (play + bufferBytes_ - writePos_) % bufferBytes_;
    uint32_t chunk = std::min<uint32_t>(space, bufferBytes_ / kNotifyPoints);
    chunk -= chunk % bpf;
    if (chunk == 0) return;

    void* p1 = nullptr;
    void* p2 = nullptr;
    DWORD n1 = 0, n2 = 0;
    const HRESULT hr = buffer8_->Lock(writePos_, chunk, &p1, &n1, &p2, &n2, 0);
    if (FAILED(hr)) {
      SetLastError(u8"Lock 缓冲失败");
      return;
    }
    AudioEngine* eng = engine_.load(std::memory_order_acquire);
    if (p1 && n1) {
      if (eng) {
        eng->RenderToDevice(static_cast<uint8_t*>(p1), n1 / bpf);
      } else {
        std::memset(p1, 0, n1);
      }
    }
    if (p2 && n2) {
      if (eng) {
        eng->RenderToDevice(static_cast<uint8_t*>(p2), n2 / bpf);
      } else {
        std::memset(p2, 0, n2);
      }
    }
    buffer8_->Unlock(p1, n1, p2, n2);
    writePos_ = (writePos_ + chunk) % bufferBytes_;
  }

  void Teardown() {
    if (buffer8_ && playing_) {
      buffer8_->Stop();
      playing_ = false;
    }
    buffer8_.Reset();
    ds8_.Reset();
  }

  void SetLastError(const std::string& err) {
    {
      std::lock_guard<std::mutex> lock(errMutex_);
      lastError_ = err;
    }
    LogLine("directsound: 错误 %s", err.c_str());
  }

  OpenParams params_;
  std::thread thread_;
  std::mutex mutex_;
  std::condition_variable cv_;
  bool ready_ = false;
  bool startRequested_ = false;
  bool stop_ = false;
  bool playing_ = false;
  std::string openError_;

  HANDLE event_ = nullptr;
  HANDLE notifyEvents_[kNotifyPoints] = {nullptr, nullptr, nullptr, nullptr};
  uint32_t bufferBytes_ = 0;
  uint32_t writePos_ = 0;

  DeviceFormat fmt_;
  std::string deviceName_;
  mutable std::mutex nameMutex_;
  mutable std::mutex errMutex_;
  std::string lastError_;

  std::atomic<AudioEngine*> engine_{nullptr};

  ComPtr<IDirectSound8> ds8_;
  ComPtr<IDirectSoundBuffer8> buffer8_;
};

}  

std::unique_ptr<IAudioBackend> CreateDirectSoundBackend() {
  return std::unique_ptr<IAudioBackend>(new DirectSoundBackend());
}

}  
