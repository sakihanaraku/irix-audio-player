
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "engine.h"

namespace aurora {


namespace backend_id {
constexpr const char* kWasapiShared = "wasapi-shared";
constexpr const char* kWasapiExclusive = "wasapi-exclusive";
constexpr const char* kDirectSound = "directsound";
constexpr const char* kMme = "mme";
constexpr const char* kAlsa = "alsa";          
}  

struct OpenParams {
  std::string backend = backend_id::kWasapiShared;
  std::string deviceId;            
  uint32_t sampleRate = 48000;     
  uint16_t channels = 2;           
  uint16_t bits = 32;              
  bool isFloat = true;             
  bool exclusive = false;          
  uint32_t periodMs = 10;          
  uint32_t bufferMs = 100;         
  uint32_t ringMs = 800;           
  bool allowFormatFallback = true; 
  std::string hwndHex;             
};

struct DeviceDesc {
  std::string id;
  std::string name;
  std::string backend;
  bool isDefault = false;
  bool isDefaultCommunications = false;
  std::string state;      
  std::string formFactor; 
  
  uint32_t mixSampleRate = 0;
  uint16_t mixChannels = 0;
  uint16_t mixBits = 0;
  bool mixFloat = false;
};


class IAudioBackend {
 public:
  virtual ~IAudioBackend() = default;
  virtual const char* Name() const = 0;
  virtual bool Open(const OpenParams& params, std::string* error) = 0;
  virtual void Start() = 0;
  virtual void SetPaused(bool paused) = 0;
  virtual bool IsPaused() const = 0;
  virtual DeviceFormat Format() const = 0;
  virtual std::string DeviceName() const = 0;
  virtual std::string LastError() const = 0;
  virtual AudioEngine* Engine() = 0;
  virtual void SetEngine(AudioEngine* engine) = 0;
  virtual void Close() = 0;
};


std::vector<DeviceDesc> EnumerateDevices(const std::string& backend);
std::string DefaultDeviceId(const std::string& backend);


struct FormatProbeResult {
  bool supported = false;
  std::string detail;
  DeviceFormat negotiated;  
};
FormatProbeResult ProbeFormat(const std::string& backend, const std::string& deviceId,
                              uint32_t sampleRate, uint16_t channels, uint16_t bits, bool isFloat,
                              bool exclusive);


std::unique_ptr<IAudioBackend> CreateBackend(const std::string& backendId);
std::unique_ptr<IAudioBackend> CreateWasapiBackend(bool exclusive);
std::unique_ptr<IAudioBackend> CreateDirectSoundBackend();
std::unique_ptr<IAudioBackend> CreateMmeBackend();
#if defined(__linux__)
std::unique_ptr<IAudioBackend> CreateAlsaBackend();
#endif

}  
