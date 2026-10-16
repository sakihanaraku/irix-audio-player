







#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include <alsa/asoundlib.h>

#include "backend.h"
#include "util.h"

namespace aurora {
namespace {


uint32_t AlsaChannelMask(uint16_t channels) {
  switch (channels) {
    case 1: return 0x4;                       
    case 2: return 0x3;                       
    case 4: return 0x33;                      
    case 6: return 0x3F;                      
    case 8: return 0x63F;                     
    default: return 0;
  }
}

class AlsaBackend : public IAudioBackend {
 public:
  ~AlsaBackend() override { Close(); }

  const char* Name() const override { return backend_id::kAlsa; }

  bool Open(const OpenParams& params, std::string* error) override {
    params_ = params;
    stop_ = false;
    startRequested_ = false;
    ready_ = false;
    openError_.clear();
    thread_ = std::thread([this] { ThreadMain(); });

    std::unique_lock<std::mutex> lock(mutex_);
    if (!cv_.wait_for(lock, std::chrono::seconds(10), [this] { return ready_; })) {
      stop_ = true;
      lock.unlock();
      cv_.notify_all();
      if (thread_.joinable()) thread_.join();
      if (error) *error = u8"打开 ALSA 设备超时";
      return false;
    }
    if (!openError_.empty()) {
      const std::string err = openError_;
      lock.unlock();
      if (thread_.joinable()) thread_.join();
      if (error) *error = err;
      return false;
    }
    lock.unlock();
    LogLine("alsa: 打开成功 %uHz/%uch/%ubit 周期 %u 帧 x %u",
            fmt_.sampleRate, fmt_.channels, fmt_.bits, periodFrames_, periods_);
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
    if (thread_.joinable()) thread_.join();
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

  
  static snd_pcm_format_t PickFormat(const OpenParams& p, uint16_t* bits, bool* isFloat) {
    if (p.bits >= 32 && p.isFloat) { *bits = 32; *isFloat = true; return SND_PCM_FORMAT_FLOAT_LE; }
    if (p.bits >= 32) { *bits = 32; *isFloat = false; return SND_PCM_FORMAT_S32_LE; }
    *bits = 16;
    *isFloat = false;
    return SND_PCM_FORMAT_S16_LE;
  }

  bool SetupDevice(std::string* error) {
    const std::string dev = params_.deviceId.empty() ? "default" : params_.deviceId;
    const uint32_t rate = params_.sampleRate ? params_.sampleRate : 44100;
    uint16_t channels = params_.channels ? params_.channels : 2;
    if (channels < 1) channels = 1;

    uint16_t bits = 32;
    bool isFloat = true;
    snd_pcm_format_t format = PickFormat(params_, &bits, &isFloat);

    const int rc = snd_pcm_open(&pcm_, dev.c_str(), SND_PCM_STREAM_PLAYBACK, 0);
    if (rc < 0) {
      *error = std::string(u8"snd_pcm_open 失败: ") + snd_strerror(rc) + u8"（设备 " + dev + u8"）";
      return false;
    }

    const uint32_t latencyMs = params_.bufferMs ? params_.bufferMs : 100;
    const int prc = snd_pcm_set_params(pcm_, format, SND_PCM_ACCESS_RW_INTERLEAVED,
                                       channels, rate, 1 , latencyMs * 1000);
    if (prc < 0) {
      *error = std::string(u8"snd_pcm_set_params 失败: ") + snd_strerror(prc) +
               u8"（" + std::to_string(rate) + u8"Hz/" + std::to_string(channels) + u8"ch）";
      snd_pcm_close(pcm_);
      pcm_ = nullptr;
      return false;
    }

    
    snd_pcm_uframes_t bufferFrames = 0;
    snd_pcm_uframes_t periodFrames = 0;
    snd_pcm_get_params(pcm_, &bufferFrames, &periodFrames);
    if (periodFrames == 0) periodFrames = rate / 50;          
    if (bufferFrames == 0) bufferFrames = periodFrames * 4;
    periodFrames_ = static_cast<uint32_t>(periodFrames);
    periods_ = static_cast<uint32_t>(std::max<snd_pcm_uframes_t>(1, bufferFrames / periodFrames));

    fmt_.sampleRate = rate;
    fmt_.channels = channels;
    fmt_.bits = bits;
    fmt_.isFloat = isFloat;
    fmt_.validBits = bits;
    fmt_.exclusive = false;
    fmt_.channelMask = AlsaChannelMask(channels);

    {
      std::lock_guard<std::mutex> lock(nameMutex_);
      snd_pcm_info_t* info = nullptr;
      std::string cardName;
      if (snd_pcm_info_malloc(&info) == 0) {
        if (snd_pcm_info(pcm_, info) == 0) cardName = snd_pcm_info_get_name(info);
        snd_pcm_info_free(info);
      }
      deviceName_ = cardName.empty() ? (u8"ALSA " + dev)
                                     : (cardName + u8" (" + dev + u8")");
    }
    scratch_.assign(static_cast<size_t>(periodFrames_) * channels * (bits / 8), 0);
    return true;
  }

  bool StartStream(std::string* error) {
    const int rc = snd_pcm_prepare(pcm_);
    if (rc < 0) {
      *error = std::string(u8"snd_pcm_prepare 失败: ") + snd_strerror(rc);
      return false;
    }
    running_ = true;
    return true;
  }

  void RenderLoop() {
    AudioEngine* eng = engine_.load(std::memory_order_acquire);
    while (!stop_) {
      
      const int wrc = snd_pcm_wait(pcm_, 500);
      if (stop_) break;
      if (wrc < 0) {
        if (!Recover(wrc, u8"等待可写" )) break;
        continue;
      }
      if (wrc == 0) continue;                       

      if (eng) {
        eng->RenderToDevice(scratch_.data(), periodFrames_);
      } else {
        std::memset(scratch_.data(), 0, scratch_.size());
      }

      snd_pcm_sframes_t written = snd_pcm_writei(pcm_, scratch_.data(), periodFrames_);
      if (written < 0) {
        if (!Recover(static_cast<int>(written), u8"写入")) break;
        continue;
      }
      if (written < static_cast<snd_pcm_sframes_t>(periodFrames_)) {
        
        const size_t frameBytes = static_cast<size_t>(fmt_.channels) * (fmt_.bits / 8);
        size_t offset = static_cast<size_t>(written) * frameBytes;
        while (offset < scratch_.size() && !stop_) {
          snd_pcm_sframes_t n = snd_pcm_writei(
              pcm_, scratch_.data() + offset, (scratch_.size() - offset) / frameBytes);
          if (n < 0) break;
          offset += static_cast<size_t>(n) * frameBytes;
        }
      }
    }
    running_ = false;
  }

  
  bool Recover(int err, const char* what) {
    if (err == -EPIPE) {
      LogLine("alsa: %s 时缓冲欠载，恢复中", what);
      const int rc = snd_pcm_prepare(pcm_);
      if (rc < 0) {
        SetLastError(std::string(u8"欠载后 snd_pcm_prepare 失败: ") + snd_strerror(rc));
        return false;
      }
      return true;
    }
    if (err == -ESTRPIPE) {
      LogLine("alsa: 设备被挂起，等待恢复");
      for (int i = 0; i < 50 && !stop_; ++i) {
        const int rc = snd_pcm_resume(pcm_);
        if (rc != -EAGAIN) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
      }
      const int rc = snd_pcm_prepare(pcm_);
      if (rc < 0) {
        SetLastError(std::string(u8"挂起恢复失败: ") + snd_strerror(rc));
        return false;
      }
      return true;
    }
    SetLastError(std::string(what) + u8"失败: " + snd_strerror(err));
    return false;
  }

  void Teardown() {
    if (pcm_) {
      snd_pcm_drop(pcm_);          
      snd_pcm_close(pcm_);
      pcm_ = nullptr;
    }
    running_ = false;
  }

  void SetLastError(const std::string& err) {
    {
      std::lock_guard<std::mutex> lock(errMutex_);
      lastError_ = err;
    }
    LogLine("alsa: 错误 %s", err.c_str());
  }

  OpenParams params_;
  std::thread thread_;
  std::mutex mutex_;
  std::condition_variable cv_;
  bool ready_ = false;
  bool startRequested_ = false;
  bool stop_ = false;
  std::string openError_;

  snd_pcm_t* pcm_ = nullptr;
  uint32_t periodFrames_ = 0;
  uint32_t periods_ = 0;
  std::vector<uint8_t> scratch_;
  bool running_ = false;

  DeviceFormat fmt_;
  std::string deviceName_;
  mutable std::mutex nameMutex_;
  mutable std::mutex errMutex_;
  std::string lastError_;

  std::atomic<AudioEngine*> engine_{nullptr};
};

}  

std::unique_ptr<IAudioBackend> CreateAlsaBackend() {
  return std::unique_ptr<IAudioBackend>(new AlsaBackend());
}

}  
