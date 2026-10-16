




#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include <alsa/asoundlib.h>

#include "backend.h"
#include "devices.h"
#include "util.h"

namespace aurora {
namespace {

struct CardInfo {
  int index = 0;
  std::string id;      
  std::string name;    
};




std::vector<CardInfo> ReadCards() {
  std::vector<CardInfo> cards;
  std::ifstream in("/proc/asound/cards");
  if (!in) return cards;
  std::string line;
  while (std::getline(in, line)) {
    
    const size_t lb = line.find('[');
    const size_t rb = line.find(']', lb == std::string::npos ? 0 : lb);
    if (lb == std::string::npos || rb == std::string::npos) continue;
    CardInfo card;
    card.index = std::atoi(line.substr(0, lb).c_str());
    card.id = line.substr(lb + 1, rb - lb - 1);
    while (!card.id.empty() && std::isspace(static_cast<unsigned char>(card.id.back()))) card.id.pop_back();
    const size_t dash = line.find(" - ", rb);
    if (dash != std::string::npos) card.name = line.substr(dash + 3);
    if (card.name.empty()) card.name = card.id;
    cards.push_back(card);
  }
  return cards;
}

DeviceDesc MakeDesc(const std::string& id, const std::string& name, bool isDefault) {
  DeviceDesc d;
  d.id = id;
  d.name = name;
  d.backend = backend_id::kAlsa;
  d.isDefault = isDefault;
  d.state = "active";
  d.formFactor = "speakers";
  return d;
}

}  

std::vector<DeviceDesc> EnumerateDevices(const std::string& backend) {
  std::vector<DeviceDesc> out;
  if (backend != backend_id::kAlsa && !backend.empty()) return out;   

  out.push_back(MakeDesc("default", u8"系统默认输出 (ALSA default)", true));

  for (const CardInfo& card : ReadCards()) {
    const std::string base = std::to_string(card.index);
    out.push_back(MakeDesc("plughw:" + base + ",0",
                           card.name + u8" (plughw:" + base + u8",0)", false));
    out.push_back(MakeDesc("hw:" + base + ",0",
                           card.name + u8" (hw:" + base + u8",0 独占)", false));
  }
  return out;
}

std::string DefaultDeviceId(const std::string& backend) {
  const auto devices = EnumerateDevices(backend);
  for (const auto& d : devices) {
    if (d.isDefault) return d.id;
  }
  return devices.empty() ? std::string() : devices.front().id;
}


FormatProbeResult ProbeFormat(const std::string& backend, const std::string& deviceId,
                              uint32_t sampleRate, uint16_t channels, uint16_t bits,
                              bool isFloat, bool ) {
  FormatProbeResult result;
  if (backend != backend_id::kAlsa && !backend.empty()) {
    result.detail = u8"Linux 构建只支持 ALSA 后端";
    return result;
  }
  const std::string dev = deviceId.empty() ? "default" : deviceId;
  const uint32_t rate = sampleRate ? sampleRate : 44100;
  const uint16_t ch = channels ? channels : 2;

  snd_pcm_format_t format = SND_PCM_FORMAT_S16_LE;
  if (bits >= 32 && isFloat) format = SND_PCM_FORMAT_FLOAT_LE;
  else if (bits >= 32) format = SND_PCM_FORMAT_S32_LE;

  snd_pcm_t* pcm = nullptr;
  const int rc = snd_pcm_open(&pcm, dev.c_str(), SND_PCM_STREAM_PLAYBACK, 0);
  if (rc < 0) {
    result.detail = std::string(u8"无法打开设备 ") + dev + u8": " + snd_strerror(rc);
    return result;
  }
  const int prc = snd_pcm_set_params(pcm, format, SND_PCM_ACCESS_RW_INTERLEAVED, ch, rate, 1, 100000);
  if (prc < 0) {
    result.detail = std::string(u8"格式不被接受: ") + snd_strerror(prc);
    snd_pcm_close(pcm);
    return result;
  }
  snd_pcm_uframes_t bufferFrames = 0;
  snd_pcm_uframes_t periodFrames = 0;
  snd_pcm_get_params(pcm, &bufferFrames, &periodFrames);
  snd_pcm_close(pcm);

  result.supported = true;
  result.negotiated.sampleRate = rate;
  result.negotiated.channels = ch;
  result.negotiated.bits = (format == SND_PCM_FORMAT_S16_LE) ? 16 : 32;
  result.negotiated.isFloat = (format == SND_PCM_FORMAT_FLOAT_LE);
  result.negotiated.validBits = result.negotiated.bits;
  result.negotiated.channelMask = 0;
  result.detail = std::string(u8"ALSA 接受该格式（缓冲 ") + std::to_string(bufferFrames) +
                  u8" 帧 / 周期 " + std::to_string(periodFrames) + u8" 帧）";
  return result;
}

std::unique_ptr<IAudioBackend> CreateBackend(const std::string& backendId) {
  (void)backendId;                      
  return CreateAlsaBackend();
}

std::vector<std::string> SupportedBackends() {
  return {backend_id::kAlsa};
}

bool BackendImplemented(const std::string& backend) {
  return backend == backend_id::kAlsa;
}

std::string BackendDescription(const std::string& backend) {
  if (backend == backend_id::kAlsa) {
    return u8"ALSA：Linux 原生输出（默认；WASAPI/DirectSound/MME 是 Windows 专有通道）";
  }
  return u8"未知后端";
}

}  
