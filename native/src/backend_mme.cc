
#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <thread>
#include <vector>

#include "backend.h"
#include "util.h"
#include "win_common.h"

namespace aurora {
namespace {

constexpr int kBlocks = 4;

class MmeBackend : public IAudioBackend {
 public:
  ~MmeBackend() override { Close(); }

  const char* Name() const override { return backend_id::kMme; }

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
      if (error) *error = u8"打开 MME 设备超时";
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
    LogLine("mme: 打开成功 %uHz/%uch/%ubit 块 %u 帧 x %d", fmt_.sampleRate, fmt_.channels,
            fmt_.bits, blockFrames_, kBlocks);
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
    if (event_) {
      CloseHandle(event_);
      event_ = nullptr;
    }
  }

 private:
  void ThreadMain() {
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

    UINT_PTR deviceId = WAVE_MAPPER;
    if (!params_.deviceId.empty()) {
      const unsigned long long v = std::strtoull(params_.deviceId.c_str(), nullptr, 10);
      deviceId = static_cast<UINT_PTR>(v);
    }

    const MMRESULT mr = waveOutOpen(&hwo_, deviceId, &wfx, reinterpret_cast<DWORD_PTR>(event_), 0,
                                    CALLBACK_EVENT);
    if (mr != MMSYSERR_NOERROR) {
      *error = u8"waveOutOpen 失败: " + Win32ErrorString(mr);
      return false;
    }

    const uint32_t periodMs = params_.periodMs ? params_.periodMs : 20;
    uint32_t frames = want.sampleRate * periodMs / 1000;
    if (frames < 256) frames = 256;
    blockFrames_ = frames;
    blockBytes_ = blockFrames_ * wfx.nBlockAlign;
    fmt_ = want;

    blocks_.assign(kBlocks, WAVEHDR{});
    blockData_.assign(static_cast<size_t>(blockBytes_) * kBlocks, 0);
    for (int i = 0; i < kBlocks; ++i) {
      blocks_[i].lpData = reinterpret_cast<LPSTR>(blockData_.data() + static_cast<size_t>(blockBytes_) * i);
      blocks_[i].dwBufferLength = blockBytes_;
      blocks_[i].dwFlags = 0;
      const MMRESULT pr = waveOutPrepareHeader(hwo_, &blocks_[i], sizeof(WAVEHDR));
      if (pr != MMSYSERR_NOERROR) {
        *error = u8"waveOutPrepareHeader 失败: " + Win32ErrorString(pr);
        return false;
      }
    }

    {
      std::lock_guard<std::mutex> lock(nameMutex_);
      if (deviceId == WAVE_MAPPER) {
        deviceName_ = u8"波形映射器 (系统默认)";
      } else {
        WAVEOUTCAPSW caps;
        ZeroMemory(&caps, sizeof(caps));
        if (waveOutGetDevCapsW(deviceId, &caps, sizeof(caps)) == MMSYSERR_NOERROR) {
          deviceName_ = WcharToUtf8(caps.szPname);
        } else {
          deviceName_ = u8"MME 设备 " + std::to_string(deviceId);
        }
      }
    }
    return true;
  }

  bool StartStream(std::string* error) {
    for (int i = 0; i < kBlocks; ++i) {
      const MMRESULT mr = waveOutWrite(hwo_, &blocks_[i], sizeof(WAVEHDR));
      if (mr != MMSYSERR_NOERROR) {
        *error = u8"waveOutWrite 失败: " + Win32ErrorString(mr);
        return false;
      }
    }
    return true;
  }

  void RenderLoop() {
    const uint32_t bpf = fmt_.BytesPerFrame();
    if (bpf == 0) {
      SetLastError(u8"设备格式无效");
      return;
    }
    while (!stop_) {
      const DWORD wait = WaitForSingleObject(event_, 500);
      if (stop_) break;
      if (wait == WAIT_FAILED) {
        SetLastError(u8"等待 waveOut 事件失败");
        break;
      }
      for (int i = 0; i < kBlocks && !stop_; ++i) {
        WAVEHDR& hdr = blocks_[i];
        if (!(hdr.dwFlags & WHDR_DONE)) continue;
        AudioEngine* eng = engine_.load(std::memory_order_acquire);
        if (eng) {
          eng->RenderToDevice(reinterpret_cast<uint8_t*>(hdr.lpData), hdr.dwBufferLength / bpf);
        } else {
          std::memset(hdr.lpData, 0, hdr.dwBufferLength);
        }
        hdr.dwFlags &= ~WHDR_DONE;
        const MMRESULT mr = waveOutWrite(hwo_, &hdr, sizeof(WAVEHDR));
        if (mr != MMSYSERR_NOERROR) {
          SetLastError(u8"waveOutWrite 失败: " + Win32ErrorString(mr));
          stop_ = true;
          break;
        }
      }
    }
  }

  void Teardown() {
    if (hwo_) {
      waveOutReset(hwo_);
      for (int i = 0; i < static_cast<int>(blocks_.size()); ++i) {
        if (blocks_[i].lpData) waveOutUnprepareHeader(hwo_, &blocks_[i], sizeof(WAVEHDR));
      }
      waveOutClose(hwo_);
      hwo_ = nullptr;
    }
  }

  void SetLastError(const std::string& err) {
    {
      std::lock_guard<std::mutex> lock(errMutex_);
      lastError_ = err;
    }
    LogLine("mme: 错误 %s", err.c_str());
  }

  OpenParams params_;
  std::thread thread_;
  std::mutex mutex_;
  std::condition_variable cv_;
  bool ready_ = false;
  bool startRequested_ = false;
  bool stop_ = false;
  std::string openError_;

  HANDLE event_ = nullptr;
  HWAVEOUT hwo_ = nullptr;
  uint32_t blockFrames_ = 0;
  uint32_t blockBytes_ = 0;
  std::vector<WAVEHDR> blocks_;
  std::vector<uint8_t> blockData_;

  DeviceFormat fmt_;
  std::string deviceName_;
  mutable std::mutex nameMutex_;
  mutable std::mutex errMutex_;
  std::string lastError_;

  std::atomic<AudioEngine*> engine_{nullptr};
};

}  

std::unique_ptr<IAudioBackend> CreateMmeBackend() {
  return std::unique_ptr<IAudioBackend>(new MmeBackend());
}

}  
