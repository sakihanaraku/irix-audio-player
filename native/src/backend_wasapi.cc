
#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <mutex>
#include <thread>
#include <vector>

#include "backend.h"
#include "util.h"
#include "win_common.h"

namespace aurora {
namespace {

class WasapiBackend : public IAudioBackend {
 public:
  explicit WasapiBackend(bool exclusive) : exclusive_(exclusive) {}
  ~WasapiBackend() override { Close(); }

  const char* Name() const override {
    return exclusive_ ? backend_id::kWasapiExclusive : backend_id::kWasapiShared;
  }

  bool Open(const OpenParams& params, std::string* error) override {
    params_ = params;
    stop_ = false;
    startRequested_ = false;
    ready_ = false;
    openError_.clear();
    event_ = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!event_) {
      if (error) *error = u8"创建音频事件对象失败";
      return false;
    }
    thread_ = std::thread([this] { ThreadMain(); });

    std::unique_lock<std::mutex> lock(mutex_);
    const bool ok = cv_.wait_for(lock, std::chrono::seconds(10), [this] { return ready_; });
    if (!ok) {
      stop_ = true;
      lock.unlock();
      cv_.notify_all();
      SetEvent(event_);
      if (thread_.joinable()) thread_.join();
      CloseHandle(event_);
      event_ = nullptr;
      if (error) *error = u8"打开音频设备超时";
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
    LogLine("wasapi[%s]: 打开成功 %uHz/%uch/%ubit float=%d exclusive=%d buffer=%u frames",
            Name(), fmt_.sampleRate, fmt_.channels, fmt_.bits, fmt_.isFloat ? 1 : 0,
            fmt_.exclusive ? 1 : 0, bufferFrames_);
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

  DeviceFormat Format() const override {
    std::lock_guard<std::mutex> lock(fmtMutex_);
    return fmt_;
  }
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
    if (event_) {
      CloseHandle(event_);
      event_ = nullptr;
    }
  }

 private:
  void ThreadMain() {
    ComApartment com;
    if (!com.usable()) {
      SignalReady(u8"COM 初始化失败");
      return;
    }
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
      SignalReadyIfNot(err);
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
  void SignalReadyIfNot(const std::string& err) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!ready_) {
      openError_ = err;
      ready_ = true;
    }
    cv_.notify_all();
  }

  bool SetupDevice(std::string* error) {
    HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                  IID_PPV_ARGS(enumerator_.Put()));
    if (FAILED(hr)) {
      *error = u8"创建 MMDeviceEnumerator 失败: " + HrToString(hr);
      return false;
    }

    if (params_.deviceId.empty()) {
      hr = enumerator_->GetDefaultAudioEndpoint(eRender, eConsole, device_.Put());
    } else {
      hr = enumerator_->GetDevice(Utf8ToWchar(params_.deviceId).c_str(), device_.Put());
    }
    if (FAILED(hr)) {
      *error = u8"获取声音设备失败: " + HrToString(hr);
      return false;
    }

    {
      ComPtr<IPropertyStore> store;
      if (SUCCEEDED(device_->OpenPropertyStore(STGM_READ, store.Put()))) {
        PROPVARIANT pv;
        PropVariantInit(&pv);
        if (SUCCEEDED(store->GetValue(kPkeyDeviceFriendlyName, &pv)) && pv.vt == VT_LPWSTR &&
            pv.pwszVal) {
          std::lock_guard<std::mutex> lock(nameMutex_);
          deviceName_ = WcharToUtf8(pv.pwszVal);
        }
        PropVariantClear(&pv);

        
        PropVariantInit(&pv);
        if (SUCCEEDED(store->GetValue(kPkeyAudioEngineDeviceFormat, &pv)) && pv.vt == VT_BLOB &&
            pv.blob.pBlobData && pv.blob.cbSize >= sizeof(WAVEFORMATEX)) {
          const auto* wf = reinterpret_cast<const WAVEFORMATEX*>(pv.blob.pBlobData);
          if (pv.blob.cbSize >= sizeof(WAVEFORMATEX) + wf->cbSize) {
            nativeFmt_ = FromWaveFormat(wf, true);
            hasNativeFmt_ = true;
            LogLine("wasapi: 设备原生格式 %uHz/%uch/%ubit", nativeFmt_.sampleRate,
                    nativeFmt_.channels, nativeFmt_.bits);
          }
        }
        PropVariantClear(&pv);
      }
    }

    hr = device_->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
                           reinterpret_cast<void**>(client_.Put()));
    if (FAILED(hr)) {
      *error = u8"激活 IAudioClient 失败: " + HrToString(hr);
      return false;
    }

    DWORD flags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK;
    (void)flags;
    if (exclusive_) {
      if (!InitExclusive(error)) return false;
    } else {
      if (!InitShared(error)) return false;
    }

    hr = client_->GetBufferSize(&bufferFrames_);
    if (FAILED(hr)) {
      *error = u8"GetBufferSize 失败: " + HrToString(hr);
      return false;
    }
    hr = client_->SetEventHandle(event_);
    if (FAILED(hr)) {
      *error = u8"SetEventHandle 失败: " + HrToString(hr);
      return false;
    }
    hr = client_->GetService(IID_PPV_ARGS(render_.Put()));
    if (FAILED(hr)) {
      *error = u8"获取 IAudioRenderClient 失败: " + HrToString(hr);
      return false;
    }

    
    if (!exclusive_) {
      BYTE* data = nullptr;
      if (SUCCEEDED(render_->GetBuffer(bufferFrames_, &data)) && data) {
        render_->ReleaseBuffer(bufferFrames_, AUDCLNT_BUFFERFLAGS_SILENT);
      }
    }
    return true;
  }

  bool InitShared(std::string* error) {
    WAVEFORMATEX* mix = nullptr;
    HRESULT hr = client_->GetMixFormat(&mix);
    if (FAILED(hr) || !mix) {
      *error = u8"GetMixFormat 失败: " + HrToString(hr);
      if (mix) CoTaskMemFree(mix);
      return false;
    }
    const DeviceFormat mixFmt = FromWaveFormat(mix, false);
    REFERENCE_TIME duration =
        static_cast<REFERENCE_TIME>(params_.bufferMs ? params_.bufferMs : 100) * 10000;

    
    DeviceFormat want;
    want.sampleRate = params_.sampleRate ? params_.sampleRate : mixFmt.sampleRate;
    want.channels = params_.channels ? params_.channels : mixFmt.channels;
    want.bits = params_.bits ? params_.bits : mixFmt.bits;
    want.isFloat = params_.isFloat;
    want.validBits = want.bits;
    want.channelMask = ChannelMaskFor(want.channels);

    const bool sameAsMix = want.sampleRate == mixFmt.sampleRate && want.channels == mixFmt.channels &&
                           want.bits == mixFmt.bits && want.isFloat == mixFmt.isFloat;
    if (!sameAsMix) {
      WAVEFORMATEXTENSIBLE wf;
      ToWaveFormat(want, &wf);
      hr = client_->Initialize(AUDCLNT_SHAREMODE_SHARED,
                               AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                                   AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                               duration, 0, reinterpret_cast<WAVEFORMATEX*>(&wf), nullptr);
      if (SUCCEEDED(hr)) {
        std::lock_guard<std::mutex> lock(fmtMutex_);
        fmt_ = want;
        fmt_.exclusive = false;
        CoTaskMemFree(mix);
        LogLine("wasapi-shared: 使用请求格式 %uHz/%uch/%ubit（AUTOCONVERTPCM，混音格式 %uHz/%uch）",
                fmt_.sampleRate, fmt_.channels, fmt_.bits, mixFmt.sampleRate, mixFmt.channels);
        return true;
      }
      LogLine("wasapi-shared: 请求格式失败(%s)，回退到系统混音格式", HrToString(hr).c_str());
      client_.Reset();
      hr = device_->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
                             reinterpret_cast<void**>(client_.Put()));
      if (FAILED(hr)) {
        *error = u8"重新激活 IAudioClient 失败: " + HrToString(hr);
        CoTaskMemFree(mix);
        return false;
      }
    }

    hr = client_->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, duration,
                             0, mix, nullptr);
    if (FAILED(hr)) {
      *error = u8"以共享模式初始化失败: " + HrToString(hr);
      CoTaskMemFree(mix);
      return false;
    }
    {
      std::lock_guard<std::mutex> lock(fmtMutex_);
      fmt_ = mixFmt;
    }
    CoTaskMemFree(mix);
    return true;
  }

  bool InitExclusive(std::string* error) {
    REFERENCE_TIME defaultPeriod = 0, minPeriod = 0;
    if (FAILED(client_->GetDevicePeriod(&defaultPeriod, &minPeriod))) {
      minPeriod = 100000;  
      defaultPeriod = minPeriod;
    }
    if (minPeriod <= 0) minPeriod = defaultPeriod > 0 ? defaultPeriod : 100000;

    REFERENCE_TIME period = static_cast<REFERENCE_TIME>(params_.periodMs ? params_.periodMs : 10) * 10000;
    if (period < minPeriod) period = minPeriod;

    DeviceFormat want;
    want.sampleRate = params_.sampleRate ? params_.sampleRate : 48000;
    want.channels = params_.channels ? params_.channels : 2;
    want.bits = params_.bits ? params_.bits : 32;
    want.isFloat = params_.isFloat;
    want.validBits = want.bits;
    want.channelMask = ChannelMaskFor(want.channels);
    want.exclusive = true;

    
    std::vector<DeviceFormat> candidates;
    candidates.push_back(want);
    if (hasNativeFmt_ && (nativeFmt_.sampleRate != want.sampleRate ||
                          nativeFmt_.channels != want.channels || nativeFmt_.bits != want.bits)) {
      candidates.push_back(nativeFmt_);
    }

    DeviceFormat chosen;
    bool found = false;
    WAVEFORMATEX* closest = nullptr;
    std::string lastError;
    for (const auto& candidate : candidates) {
      WAVEFORMATEXTENSIBLE wf;
      ToWaveFormat(candidate, &wf);
      WAVEFORMATEX* close = nullptr;
      const HRESULT probe =
          client_->IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE,
                                     reinterpret_cast<WAVEFORMATEX*>(&wf), &close);
      if (probe == S_OK) {
        chosen = candidate;
        chosen.exclusive = true;
        found = true;
        if (close) CoTaskMemFree(close);
        break;
      }
      if (probe == S_FALSE && close && !closest) {
        closest = close;
      } else {
        lastError = HrToString(probe);
        if (close) CoTaskMemFree(close);
      }
    }
    if (!found && closest && params_.allowFormatFallback) {
      chosen = FromWaveFormat(closest, true);
      found = true;
      LogLine("wasapi-exclusive: 使用系统给出的最接近格式 %uHz/%uch/%ubit", chosen.sampleRate,
              chosen.channels, chosen.bits);
    }
    if (closest) CoTaskMemFree(closest);
    if (!found) {
      *error = u8"该设备不支持独占模式或所选格式: " + (lastError.empty() ? std::string("未知原因") : lastError) +
               u8"（可在设置里换一个输出设备，或开启格式回退）";
      return false;
    }

    WAVEFORMATEXTENSIBLE wf;
    ToWaveFormat(chosen, &wf);
    HRESULT hr = client_->Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                                    period, period, reinterpret_cast<WAVEFORMATEX*>(&wf), nullptr);
    if (hr == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED) {
      
      UINT32 frames = 0;
      if (SUCCEEDED(client_->GetBufferSize(&frames)) && frames > 0 && period > 0) {
        const REFERENCE_TIME aligned = static_cast<REFERENCE_TIME>(
            (10000.0 * 1000.0 / static_cast<double>(period)) * frames + 0.5);
        client_.Reset();
        hr = device_->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
                               reinterpret_cast<void**>(client_.Put()));
        if (SUCCEEDED(hr)) {
          hr = client_->Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                                   aligned, aligned, reinterpret_cast<WAVEFORMATEX*>(&wf), nullptr);
        }
      }
    }
    if (FAILED(hr)) {
      *error = u8"以独占模式初始化失败: " + HrToString(hr);
      return false;
    }
    {
      std::lock_guard<std::mutex> lock(fmtMutex_);
      fmt_ = chosen;
    }
    LogLine("wasapi-exclusive: 独占格式 %uHz/%uch/%ubit float=%d 周期 %.1fms", chosen.sampleRate,
            chosen.channels, chosen.bits, chosen.isFloat ? 1 : 0,
            static_cast<double>(period) / 10000.0);
    return true;
  }

  bool StartStream(std::string* error) {
    const HRESULT hr = client_->Start();
    if (FAILED(hr)) {
      *error = u8"启动音频流失败: " + HrToString(hr);
      return false;
    }
    started_ = true;
    return true;
  }

  void RenderLoop() {
    const uint32_t bpf = fmt_.BytesPerFrame();
    if (bpf == 0) {
      SetLastError(u8"设备格式无效");
      return;
    }
    while (!stop_) {
      const DWORD wait = WaitForSingleObject(event_, 2000);
      if (stop_) break;
      if (wait == WAIT_TIMEOUT) {
        SetLastError(u8"等待音频事件超时");
        break;
      }
      if (wait != WAIT_OBJECT_0) {
        SetLastError(u8"等待音频事件失败");
        break;
      }
      UINT32 padding = 0;
      HRESULT hr = client_->GetCurrentPadding(&padding);
      if (hr == AUDCLNT_E_DEVICE_INVALIDATED) {
        SetLastError(u8"音频设备已失效（被拔出或被其它程序独占）");
        break;
      }
      if (FAILED(hr)) {
        SetLastError(u8"GetCurrentPadding 失败: " + HrToString(hr));
        break;
      }
      
      UINT32 avail = 0;
      if (exclusive_) {
        avail = padding > bufferFrames_ ? bufferFrames_ : padding;
      } else {
        avail = padding >= bufferFrames_ ? 0 : bufferFrames_ - padding;
      }
      if (avail == 0) continue;
      BYTE* data = nullptr;
      hr = render_->GetBuffer(avail, &data);
      if (hr == AUDCLNT_E_DEVICE_INVALIDATED) {
        SetLastError(u8"音频设备已失效（被拔出或被其它程序独占）");
        break;
      }
      if (FAILED(hr) || !data) {
        SetLastError(u8"获取渲染缓冲失败: " + HrToString(hr));
        break;
      }
      AudioEngine* eng = engine_.load(std::memory_order_acquire);
      if (eng) {
        eng->RenderToDevice(data, avail);
      } else {
        std::memset(data, 0, static_cast<size_t>(avail) * bpf);
      }
      render_->ReleaseBuffer(avail, 0);
    }
  }

  void Teardown() {
    if (client_ && started_) {
      client_->Stop();
      started_ = false;
    }
    if (client_) client_->Reset();
    render_.Reset();
    client_.Reset();
    device_.Reset();
    enumerator_.Reset();
  }

  void SetLastError(const std::string& err) {
    {
      std::lock_guard<std::mutex> lock(errMutex_);
      lastError_ = err;
    }
    LogLine("wasapi[%s]: 错误 %s", Name(), err.c_str());
  }

  const bool exclusive_;
  OpenParams params_;
  std::thread thread_;
  std::mutex mutex_;
  std::condition_variable cv_;
  bool ready_ = false;
  bool startRequested_ = false;
  bool stop_ = false;
  bool started_ = false;
  std::string openError_;

  HANDLE event_ = nullptr;
  UINT32 bufferFrames_ = 0;

  mutable std::mutex fmtMutex_;
  DeviceFormat fmt_;
  DeviceFormat nativeFmt_;
  bool hasNativeFmt_ = false;
  mutable std::mutex nameMutex_;
  std::string deviceName_;
  mutable std::mutex errMutex_;
  std::string lastError_;

  std::atomic<AudioEngine*> engine_{nullptr};

  ComPtr<IMMDeviceEnumerator> enumerator_;
  ComPtr<IMMDevice> device_;
  ComPtr<IAudioClient> client_;
  ComPtr<IAudioRenderClient> render_;
};

}  

std::unique_ptr<IAudioBackend> CreateWasapiBackend(bool exclusive) {
  return std::unique_ptr<IAudioBackend>(new WasapiBackend(exclusive));
}

}  
