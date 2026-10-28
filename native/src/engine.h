
#pragma once

#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>

namespace aurora {


constexpr uint32_t kMaxPeakChannels = 8;


struct DeviceFormat {
  uint32_t sampleRate = 48000;
  uint16_t channels = 2;
  uint16_t bits = 32;       
  bool isFloat = true;      
  bool exclusive = false;   
  uint32_t channelMask = 0;
  uint32_t validBits = 0;   

  uint32_t BytesPerFrame() const { return static_cast<uint32_t>(bits / 8) * channels; }
};

struct EngineStats {
  uint64_t framesAccepted = 0;   
  uint64_t framesRendered = 0;   
  uint64_t framesSilence = 0;    
  uint64_t underrunEvents = 0;   
  uint32_t bufferedFrames = 0;   
  uint32_t capacityFrames = 0;   
  bool paused = false;
  float volume = 1.0f;
  
  
  float peak[kMaxPeakChannels] = {0.0f};
  uint16_t peakChannels = 0;
};


class FloatRingBuffer {
 public:
  void Reset(uint32_t capacityFrames, uint16_t channels);
  uint32_t Write(const float* src, uint32_t frames);
  uint32_t Read(float* dst, uint32_t frames);
  uint32_t AvailableToRead() const;
  uint32_t AvailableToWrite() const;
  void Clear();
  uint32_t CapacityFrames() const { return capacity_; }
  uint16_t Channels() const { return channels_; }

 private:
  std::vector<float> buf_;
  std::atomic<uint32_t> readPos_{0};
  std::atomic<uint32_t> writePos_{0};
  uint32_t capacity_ = 0;
  uint16_t channels_ = 2;
};


class AudioEngine {
 public:
  AudioEngine(uint16_t inputChannels, const DeviceFormat& device, uint32_t capacityFrames);

  
  uint32_t Write(const float* src, uint32_t frames);
  uint32_t Buffered() const { return ring_.AvailableToRead(); }
  uint32_t Capacity() const { return ring_.CapacityFrames(); }
  void Flush();
  void SetVolume(float v);
  float Volume() const { return volume_.load(std::memory_order_relaxed); }
  void SetPaused(bool paused) { paused_.store(paused, std::memory_order_relaxed); }
  bool Paused() const { return paused_.load(std::memory_order_relaxed); }
  EngineStats Stats() const;

  
  void SetInputFormat(uint32_t sampleRate, uint16_t channels);
  uint32_t InputSampleRate() const { return inRate_; }
  uint16_t InputChannels() const { return inputChannels_; }

  const DeviceFormat& Device() const { return dev_; }

  
  void RenderToDevice(uint8_t* dst, uint32_t frames);

 private:
  uint32_t FillPending(uint32_t needFrames);
  void WriteSilence(uint8_t* dst, uint32_t frames) const;
  void WriteFrame(uint8_t* dst, const float* frame, uint32_t outCh) const;

  DeviceFormat dev_;
  FloatRingBuffer ring_;
  uint32_t inRate_ = 48000;
  uint16_t inputChannels_ = 2;

  
  std::vector<float> pend_;
  uint32_t pendFrames_ = 0;   
  uint32_t pendOffset_ = 0;   
  double pos_ = 0.0;          

  
  
  std::mutex renderMutex_;

  std::atomic<float> volume_{1.0f};
  float smoothedVolume_ = 1.0f;
  std::atomic<bool> paused_{false};

  std::atomic<uint64_t> framesAccepted_{0};
  std::atomic<uint64_t> framesRendered_{0};
  std::atomic<uint64_t> framesSilence_{0};
  std::atomic<uint64_t> underrunEvents_{0};
  mutable std::atomic<bool> inUnderrun_{false};
  
  mutable std::atomic<float> peak_[kMaxPeakChannels];
};

}  
