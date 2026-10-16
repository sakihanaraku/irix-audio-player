
#pragma once

#include <windows.h>

#ifndef DIRECTSOUND_VERSION
#define DIRECTSOUND_VERSION 0x0800
#endif

#include <audioclient.h>
#include <dsound.h>
#include <mmdeviceapi.h>
#include <mmreg.h>
#include <mmsystem.h>

#include <cstdint>
#include <string>

#include "engine.h"

namespace aurora {



static const PROPERTYKEY kPkeyDeviceFriendlyName = {
    {0xa45c254e, 0xdf1c, 0x4efd, {0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0}}, 14};

static const PROPERTYKEY kPkeyDeviceDesc = {
    {0xa45c254e, 0xdf1c, 0x4efd, {0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0}}, 2};

static const PROPERTYKEY kPkeyDeviceInterfaceFriendlyName = {
    {0xb3f8fa53, 0x0004, 0x438e, {0x90, 0x03, 0x51, 0xa4, 0x6e, 0x13, 0x9b, 0xfc}}, 6};

static const PROPERTYKEY kPkeyAudioEndpointFormFactor = {
    {0x1da5d803, 0xd492, 0x4edd, {0x8c, 0x23, 0xe0, 0xc0, 0xff, 0xee, 0x7f, 0x0e}}, 0};

static const PROPERTYKEY kPkeyAudioEngineDeviceFormat = {
    {0xf19f064d, 0x082c, 0x4e27, {0xbc, 0x73, 0x68, 0x82, 0xa1, 0xbb, 0x8e, 0x4c}}, 0};


static const GUID kSubtypePcm = {
    0x00000001, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71}};
static const GUID kSubtypeIeeeFloat = {
    0x00000003, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71}};


static const GUID kIidDirectSoundBuffer8 = {
    0x6825a449, 0x7524, 0x4d82, {0x92, 0x0f, 0x50, 0xe3, 0x6a, 0xb3, 0xab, 0x1e}};
static const GUID kIidDirectSoundNotify = {
    0xb0210783, 0x89cd, 0x11d0, {0xaf, 0x08, 0x00, 0xa0, 0xc9, 0x25, 0xcd, 0x16}};


class ComApartment {
 public:
  ComApartment() {
    hr_ = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    initialized_ = SUCCEEDED(hr_);
  }
  ~ComApartment() {
    if (initialized_) CoUninitialize();
  }
  ComApartment(const ComApartment&) = delete;
  ComApartment& operator=(const ComApartment&) = delete;

  
  bool usable() const { return initialized_ || hr_ == RPC_E_CHANGED_MODE; }

 private:
  HRESULT hr_ = E_FAIL;
  bool initialized_ = false;
};


inline uint32_t ChannelMaskFor(uint16_t channels) {
  switch (channels) {
    case 1: return SPEAKER_FRONT_CENTER;
    case 2: return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT;
    case 4: return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_BACK_LEFT | SPEAKER_BACK_RIGHT;
    case 6: return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_FRONT_CENTER |
                   SPEAKER_LOW_FREQUENCY | SPEAKER_BACK_LEFT | SPEAKER_BACK_RIGHT;
    case 8: return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_FRONT_CENTER |
                   SPEAKER_LOW_FREQUENCY | SPEAKER_BACK_LEFT | SPEAKER_BACK_RIGHT |
                   SPEAKER_SIDE_LEFT | SPEAKER_SIDE_RIGHT;
    default: return 0;
  }
}


inline DeviceFormat FromWaveFormat(const WAVEFORMATEX* wf, bool exclusive) {
  DeviceFormat fmt;
  if (!wf) return fmt;
  fmt.sampleRate = wf->nSamplesPerSec;
  fmt.channels = static_cast<uint16_t>(wf->nChannels);
  fmt.bits = static_cast<uint16_t>(wf->wBitsPerSample);
  fmt.isFloat = (wf->wFormatTag == WAVE_FORMAT_IEEE_FLOAT);
  fmt.exclusive = exclusive;
  fmt.validBits = fmt.bits;
  fmt.channelMask = ChannelMaskFor(fmt.channels);
  if (wf->wFormatTag == WAVE_FORMAT_EXTENSIBLE && wf->cbSize >= 22) {
    const auto* ext = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(wf);
    fmt.validBits = ext->Samples.wValidBitsPerSample ? ext->Samples.wValidBitsPerSample : fmt.bits;
    fmt.channelMask = ext->dwChannelMask;
    if (IsEqualGUID(ext->SubFormat, kSubtypeIeeeFloat)) {
      fmt.isFloat = true;
    } else if (IsEqualGUID(ext->SubFormat, kSubtypePcm)) {
      fmt.isFloat = false;
    }
  }
  return fmt;
}


inline void ToWaveFormat(const DeviceFormat& fmt, WAVEFORMATEXTENSIBLE* out) {
  ZeroMemory(out, sizeof(*out));
  out->Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
  out->Format.nChannels = fmt.channels;
  out->Format.nSamplesPerSec = fmt.sampleRate;
  out->Format.wBitsPerSample = fmt.bits;
  out->Format.nBlockAlign = static_cast<WORD>(fmt.bits / 8 * fmt.channels);
  out->Format.nAvgBytesPerSec = out->Format.nBlockAlign * fmt.sampleRate;
  out->Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
  out->Samples.wValidBitsPerSample = fmt.validBits ? fmt.validBits : fmt.bits;
  out->dwChannelMask = fmt.channelMask ? fmt.channelMask : ChannelMaskFor(fmt.channels);
  out->SubFormat = fmt.isFloat ? kSubtypeIeeeFloat : kSubtypePcm;
}

inline const char* FormFactorName(EndpointFormFactor f) {
  switch (f) {
    case RemoteNetworkDevice: return "network";
    case Speakers: return "speakers";
    case LineLevel: return "line";
    case Headphones: return "headphones";
    case Microphone: return "microphone";
    case Headset: return "headset";
    case Handset: return "handset";
    case UnknownDigitalPassthrough: return "digital";
    case SPDIF: return "spdif";
    case DigitalAudioDisplayDevice: return "hdmi";
    case UnknownFormFactor: return "unknown";
    default: return "unknown";
  }
}

}  
