#include "engine.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace aurora {
namespace {
constexpr uint32_t kMaxChannels = 64;
inline float Clamp1(float v) { return v < -1.0f ? -1.0f : (v > 1.0f ? 1.0f : v); }
}  




void FloatRingBuffer::Reset(uint32_t capacityFrames, uint16_t channels) {
  channels_ = channels ? channels : 2;
  capacity_ = capacityFrames ? capacityFrames : 1024;
  buf_.assign(static_cast<size_t>(capacity_ + 1) * channels_, 0.0f);
  readPos_.store(0, std::memory_order_relaxed);
  writePos_.store(0, std::memory_order_relaxed);
}

uint32_t FloatRingBuffer::AvailableToRead() const {
  const uint32_t slots = capacity_ + 1;
  const uint32_t w = writePos_.load(std::memory_order_acquire);
  const uint32_t r = readPos_.load(std::memory_order_acquire);
  return (w + slots - r) % slots;
}

uint32_t FloatRingBuffer::AvailableToWrite() const { return capacity_ - AvailableToRead(); }

uint32_t FloatRingBuffer::Write(const float* src, uint32_t frames) {
  if (!src || frames == 0) return 0;
  const uint32_t slots = capacity_ + 1;
  const uint32_t space = AvailableToWrite();
  const uint32_t n = std::min(frames, space);
  if (n == 0) return 0;
  const uint32_t w = writePos_.load(std::memory_order_relaxed);
  const uint32_t first = std::min(n, slots - w);
  std::memcpy(&buf_[static_cast<size_t>(w) * channels_], src,
              static_cast<size_t>(first) * channels_ * sizeof(float));
  if (n > first) {
    std::memcpy(&buf_[0], src + static_cast<size_t>(first) * channels_,
                static_cast<size_t>(n - first) * channels_ * sizeof(float));
  }
  writePos_.store((w + n) % slots, std::memory_order_release);
  return n;
}

uint32_t FloatRingBuffer::Read(float* dst, uint32_t frames) {
  if (!dst || frames == 0) return 0;
  const uint32_t slots = capacity_ + 1;
  const uint32_t avail = AvailableToRead();
  const uint32_t n = std::min(frames, avail);
  if (n == 0) return 0;
  const uint32_t r = readPos_.load(std::memory_order_relaxed);
  const uint32_t first = std::min(n, slots - r);
  std::memcpy(dst, &buf_[static_cast<size_t>(r) * channels_],
              static_cast<size_t>(first) * channels_ * sizeof(float));
  if (n > first) {
    std::memcpy(dst + static_cast<size_t>(first) * channels_, &buf_[0],
                static_cast<size_t>(n - first) * channels_ * sizeof(float));
  }
  readPos_.store((r + n) % slots, std::memory_order_release);
  return n;
}

void FloatRingBuffer::Clear() {
  readPos_.store(0, std::memory_order_release);
  writePos_.store(0, std::memory_order_release);
}




AudioEngine::AudioEngine(uint16_t inputChannels, const DeviceFormat& device, uint32_t capacityFrames)
    : dev_(device) {
  inputChannels_ = inputChannels ? inputChannels : device.channels;
  if (inputChannels_ > kMaxChannels) inputChannels_ = kMaxChannels;
  inRate_ = device.sampleRate ? device.sampleRate : 48000;
  const uint32_t cap = capacityFrames ? capacityFrames : (inRate_ ? inRate_ : 48000);
  ring_.Reset(cap, inputChannels_);
  pend_.assign(static_cast<size_t>(2048) * inputChannels_, 0.0f);
  for (uint32_t c = 0; c < kMaxPeakChannels; ++c) peak_[c].store(0.0f, std::memory_order_relaxed);
}

void AudioEngine::SetInputFormat(uint32_t sampleRate, uint16_t channels) {
  if (channels) inputChannels_ = std::min<uint16_t>(channels, kMaxChannels);
  if (sampleRate) inRate_ = sampleRate;
  ring_.Reset(ring_.CapacityFrames(), inputChannels_);
  pend_.assign(static_cast<size_t>(2048) * inputChannels_, 0.0f);
  pendFrames_ = 0;
  pendOffset_ = 0;
  pos_ = 0.0;
}

uint32_t AudioEngine::Write(const float* src, uint32_t frames) {
  const uint32_t n = ring_.Write(src, frames);
  if (n) {
    framesAccepted_.fetch_add(n, std::memory_order_relaxed);

    
    
    const uint32_t ch = std::min<uint32_t>(inputChannels_, kMaxPeakChannels);
    float maxv[kMaxPeakChannels] = {0.0f};
    for (uint32_t i = 0; i < n; ++i) {
      const float* frame = src + static_cast<size_t>(i) * inputChannels_;
      for (uint32_t c = 0; c < ch; ++c) {
        const float a = std::fabs(frame[c]);
        if (a > maxv[c]) maxv[c] = a;
      }
    }
    for (uint32_t c = 0; c < ch; ++c) {
      if (maxv[c] <= 0.0f) continue;
      float prev = peak_[c].load(std::memory_order_relaxed);
      while (maxv[c] > prev &&
             !peak_[c].compare_exchange_weak(prev, maxv[c], std::memory_order_relaxed)) {
        
      }
    }
  }
  return n;
}

void AudioEngine::Flush() {
  ring_.Clear();
  pendFrames_ = 0;
  pendOffset_ = 0;
  pos_ = 0.0;
  inUnderrun_.store(false, std::memory_order_relaxed);
}

void AudioEngine::SetVolume(float v) {
  if (v < 0.0f) v = 0.0f;
  if (v > 1.0f) v = 1.0f;
  volume_.store(v, std::memory_order_relaxed);
}

EngineStats AudioEngine::Stats() const {
  EngineStats s;
  s.framesAccepted = framesAccepted_.load(std::memory_order_relaxed);
  s.framesRendered = framesRendered_.load(std::memory_order_relaxed);
  s.framesSilence = framesSilence_.load(std::memory_order_relaxed);
  s.underrunEvents = underrunEvents_.load(std::memory_order_relaxed);
  s.bufferedFrames = ring_.AvailableToRead();
  s.capacityFrames = ring_.CapacityFrames();
  s.paused = paused_.load(std::memory_order_relaxed);
  s.volume = volume_.load(std::memory_order_relaxed);
  
  const uint16_t peakCh = static_cast<uint16_t>(
      std::min<uint32_t>(kMaxPeakChannels, inputChannels_ ? inputChannels_ : 1));
  s.peakChannels = peakCh;
  for (uint16_t c = 0; c < peakCh; ++c) {
    s.peak[c] = peak_[c].exchange(0.0f, std::memory_order_relaxed);
  }
  return s;
}

uint32_t AudioEngine::FillPending(uint32_t needFrames) {
  uint32_t have = pendFrames_ - pendOffset_;
  if (have >= needFrames) return have;
  if (pendOffset_ > 0) {
    std::memmove(pend_.data(), pend_.data() + static_cast<size_t>(pendOffset_) * inputChannels_,
                 static_cast<size_t>(have) * inputChannels_ * sizeof(float));
    pendFrames_ = have;
    pendOffset_ = 0;
  }
  const uint32_t want = needFrames - have;
  const size_t needSamples = static_cast<size_t>(pendFrames_ + want) * inputChannels_;
  if (pend_.size() < needSamples) pend_.resize(needSamples);
  const uint32_t got =
      ring_.Read(pend_.data() + static_cast<size_t>(pendFrames_) * inputChannels_, want);
  pendFrames_ += got;
  return have + got;
}

void AudioEngine::RenderToDevice(uint8_t* dst, uint32_t frames) {
  if (!dst || frames == 0) return;
  const uint32_t outCh = dev_.channels;
  const uint32_t bpf = dev_.BytesPerFrame();
  if (outCh == 0 || bpf == 0) {
    std::memset(dst, 0, static_cast<size_t>(frames) * (bpf ? bpf : 4));
    return;
  }

  const float targetVol = volume_.load(std::memory_order_relaxed);
  if (paused_.load(std::memory_order_relaxed)) {
    std::memset(dst, 0, static_cast<size_t>(frames) * bpf);
    smoothedVolume_ = targetVol;
    return;
  }

  
  const float volCoeff = 1.0f - std::exp(-1.0f / (0.010f * static_cast<float>(dev_.sampleRate)));
  const double ratio = static_cast<double>(inRate_) / static_cast<double>(dev_.sampleRate);
  const bool unitRatio = std::fabs(ratio - 1.0) < 1e-9;

  const uint32_t needed =
      unitRatio ? frames : static_cast<uint32_t>(std::ceil(static_cast<double>(frames) * ratio)) + 4;
  FillPending(needed);

  uint32_t consumed = 0;
  uint32_t silenceFrames = 0;
  const uint32_t mappedCh = std::min<uint32_t>(outCh, kMaxChannels);
  float mapped[kMaxChannels];

  for (uint32_t i = 0; i < frames; ++i) {
    bool haveData = false;
    const uint32_t avail = pendFrames_ - pendOffset_;

    if (unitRatio) {
      if (consumed < avail) {
        const float* s = pend_.data() + static_cast<size_t>(pendOffset_ + consumed) * inputChannels_;
        for (uint32_t c = 0; c < inputChannels_; ++c) {
          if (c < kMaxChannels) mapped[c] = s[c];
        }
        consumed++;
        haveData = true;
      }
    } else {
      const uint32_t idx = static_cast<uint32_t>(pos_);
      const double frac = pos_ - static_cast<double>(idx);
      if (idx + 1 < avail) {
        const float* a = pend_.data() + static_cast<size_t>(pendOffset_ + idx) * inputChannels_;
        const float* b = a + inputChannels_;
        for (uint32_t c = 0; c < inputChannels_ && c < kMaxChannels; ++c) {
          mapped[c] = static_cast<float>(a[c] * (1.0 - frac) + b[c] * frac);
        }
        pos_ += ratio;
        const uint32_t adv = static_cast<uint32_t>(pos_);
        if (adv > 0) {
          pendOffset_ += adv;
          pos_ -= static_cast<double>(adv);
        }
        haveData = true;
      }
    }

    if (!haveData) {
      
      for (uint32_t c = 0; c < mappedCh; ++c) mapped[c] = 0.0f;
      ++silenceFrames;
      pos_ = 0.0;
      if (framesAccepted_.load(std::memory_order_relaxed) > 0) {
        if (!inUnderrun_.exchange(true, std::memory_order_relaxed)) {
          underrunEvents_.fetch_add(1, std::memory_order_relaxed);
        }
      }
    } else {
      inUnderrun_.store(false, std::memory_order_relaxed);
    }

    
    smoothedVolume_ += (targetVol - smoothedVolume_) * volCoeff;
    const float gain = smoothedVolume_;

    
    float frame[kMaxChannels];
    if (outCh == inputChannels_) {
      for (uint32_t c = 0; c < mappedCh; ++c) frame[c] = mapped[c] * gain;
    } else if (outCh == 1) {
      float sum = 0.0f;
      for (uint32_t c = 0; c < inputChannels_ && c < kMaxChannels; ++c) sum += mapped[c];
      frame[0] = (sum / static_cast<float>(inputChannels_)) * gain;
    } else if (inputChannels_ == 1) {
      for (uint32_t c = 0; c < mappedCh; ++c) frame[c] = mapped[0] * gain;
    } else {
      for (uint32_t c = 0; c < mappedCh; ++c) {
        frame[c] = (c < inputChannels_ ? mapped[c] : 0.0f) * gain;
      }
    }

    
    uint8_t* out = dst + static_cast<size_t>(i) * bpf;    if (dev_.isFloat && dev_.bits == 32) {
      float* f = reinterpret_cast<float*>(out);
      for (uint32_t c = 0; c < outCh; ++c) f[c] = frame[c];
    } else if (dev_.bits == 16) {
      int16_t* s = reinterpret_cast<int16_t*>(out);
      for (uint32_t c = 0; c < outCh; ++c) {
        s[c] = static_cast<int16_t>(std::lrint(Clamp1(frame[c]) * 32767.0f));
      }
    } else if (dev_.bits == 24) {
      for (uint32_t c = 0; c < outCh; ++c) {
        const int32_t v = static_cast<int32_t>(std::lrint(Clamp1(frame[c]) * 8388607.0f));
        const uint32_t u = static_cast<uint32_t>(v) & 0x00FFFFFFu;
        out[c * 3 + 0] = static_cast<uint8_t>(u & 0xFF);
        out[c * 3 + 1] = static_cast<uint8_t>((u >> 8) & 0xFF);
        out[c * 3 + 2] = static_cast<uint8_t>((u >> 16) & 0xFF);
      }
    } else if (dev_.bits == 32) {
      int32_t* s = reinterpret_cast<int32_t*>(out);
      for (uint32_t c = 0; c < outCh; ++c) {
        s[c] = static_cast<int32_t>(std::llrint(static_cast<double>(Clamp1(frame[c])) * 2147483647.0));
      }
    } else if (dev_.bits == 8) {
      uint8_t* s = out;
      for (uint32_t c = 0; c < outCh; ++c) {
        s[c] = static_cast<uint8_t>(Clamp1(frame[c]) * 127.0f + 128.0f);
      }
    }
  }

  if (unitRatio) {
    pendOffset_ += consumed;
  }
  if (pendOffset_ >= pendFrames_) {
    pendOffset_ = 0;
    pendFrames_ = 0;
  }

  framesRendered_.fetch_add(frames - silenceFrames, std::memory_order_relaxed);
  if (silenceFrames && framesAccepted_.load(std::memory_order_relaxed) > 0) {
    framesSilence_.fetch_add(silenceFrames, std::memory_order_relaxed);
  }
}

}  
