#include "devices.h"

#include <algorithm>
#include <memory>

#include "util.h"
#include "win_common.h"

namespace aurora {
namespace {

std::string PropVariantToString(const PROPVARIANT& pv) {
  if (pv.vt == VT_LPWSTR && pv.pwszVal) return WcharToUtf8(pv.pwszVal);
  if (pv.vt == VT_BSTR && pv.bstrVal) return WcharToUtf8(pv.bstrVal);
  if (pv.vt == VT_LPSTR && pv.pszVal) return std::string(pv.pszVal);
  return std::string();
}

EndpointFormFactor GetFormFactor(IPropertyStore* store) {
  if (!store) return UnknownFormFactor;
  PROPVARIANT pv;
  PropVariantInit(&pv);
  EndpointFormFactor ff = UnknownFormFactor;
  if (SUCCEEDED(store->GetValue(kPkeyAudioEndpointFormFactor, &pv)) && pv.vt == VT_UI4) {
    ff = static_cast<EndpointFormFactor>(pv.uintVal);
  }
  PropVariantClear(&pv);
  return ff;
}

void FillMixFormat(IMMDevice* device, DeviceDesc* desc) {
  if (!device || !desc) return;
  ComPtr<IAudioClient> client;
  if (FAILED(device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(client.Put())))) {
    return;
  }
  WAVEFORMATEX* mix = nullptr;
  if (SUCCEEDED(client->GetMixFormat(&mix)) && mix) {
    const DeviceFormat f = FromWaveFormat(mix, false);
    desc->mixSampleRate = f.sampleRate;
    desc->mixChannels = f.channels;
    desc->mixBits = f.bits;
    desc->mixFloat = f.isFloat;
    CoTaskMemFree(mix);
  }
}

std::vector<DeviceDesc> EnumerateWasapi() {
  std::vector<DeviceDesc> out;
  ComApartment com;
  if (!com.usable()) {
    LogLine("devices: CoInitializeEx 失败");
    return out;
  }

  ComPtr<IMMDeviceEnumerator> enumerator;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                IID_PPV_ARGS(enumerator.Put()));
  if (FAILED(hr)) {
    LogLine("devices: CoCreateInstance(MMDeviceEnumerator) 失败 %s", HrToString(hr).c_str());
    return out;
  }

  std::wstring defaultId;
  ComPtr<IMMDevice> defaultDevice;
  if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, defaultDevice.Put()))) {
    LPWSTR id = nullptr;
    if (SUCCEEDED(defaultDevice->GetId(&id)) && id) {
      defaultId = id;
      CoTaskMemFree(id);
    }
  }
  std::wstring defaultCommId;
  ComPtr<IMMDevice> defaultCommDevice;
  if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(eRender, eCommunications, defaultCommDevice.Put()))) {
    LPWSTR id = nullptr;
    if (SUCCEEDED(defaultCommDevice->GetId(&id)) && id) {
      defaultCommId = id;
      CoTaskMemFree(id);
    }
  }

  ComPtr<IMMDeviceCollection> collection;
  hr = enumerator->EnumAudioEndpoints(
      eRender, DEVICE_STATE_ACTIVE | DEVICE_STATE_DISABLED | DEVICE_STATE_UNPLUGGED,
      collection.Put());
  if (FAILED(hr)) {
    LogLine("devices: EnumAudioEndpoints 失败 %s", HrToString(hr).c_str());
    return out;
  }

  UINT count = 0;
  collection->GetCount(&count);
  for (UINT i = 0; i < count; ++i) {
    ComPtr<IMMDevice> device;
    if (FAILED(collection->Item(i, device.Put()))) continue;

    LPWSTR idRaw = nullptr;
    if (FAILED(device->GetId(&idRaw)) || !idRaw) continue;
    const std::wstring wid = idRaw;
    CoTaskMemFree(idRaw);

    DeviceDesc desc;
    desc.id = WcharToUtf8(wid);
    desc.backend = backend_id::kWasapiShared;
    desc.isDefault = (!defaultId.empty() && wid == defaultId);
    desc.isDefaultCommunications = (!defaultCommId.empty() && wid == defaultCommId);

    DWORD state = 0;
    if (SUCCEEDED(device->GetState(&state))) {
      if (state & DEVICE_STATE_ACTIVE) desc.state = "active";
      else if (state & DEVICE_STATE_DISABLED) desc.state = "disabled";
      else if (state & DEVICE_STATE_UNPLUGGED) desc.state = "unplugged";
      else if (state & DEVICE_STATE_NOTPRESENT) desc.state = "notpresent";
    }

    ComPtr<IPropertyStore> store;
    if (SUCCEEDED(device->OpenPropertyStore(STGM_READ, store.Put()))) {
      PROPVARIANT pv;
      PropVariantInit(&pv);
      if (SUCCEEDED(store->GetValue(kPkeyDeviceFriendlyName, &pv))) {
        desc.name = PropVariantToString(pv);
      }
      PropVariantClear(&pv);
      if (desc.name.empty()) {
        PropVariantInit(&pv);
        if (SUCCEEDED(store->GetValue(kPkeyDeviceDesc, &pv))) desc.name = PropVariantToString(pv);
        PropVariantClear(&pv);
      }
      if (desc.name.empty()) {
        PropVariantInit(&pv);
        if (SUCCEEDED(store->GetValue(kPkeyDeviceInterfaceFriendlyName, &pv))) {
          desc.name = PropVariantToString(pv);
        }
        PropVariantClear(&pv);
      }
      desc.formFactor = FormFactorName(GetFormFactor(store.Get()));
    }
    if (desc.name.empty()) desc.name = "音频输出设备 " + std::to_string(i);

    FillMixFormat(device.Get(), &desc);
    out.push_back(desc);
  }

  
  std::stable_sort(out.begin(), out.end(), [](const DeviceDesc& a, const DeviceDesc& b) {
    return a.isDefault && !b.isDefault;
  });
  return out;
}

struct DsEnumContext {
  std::vector<DeviceDesc>* out = nullptr;
};

BOOL CALLBACK DsEnumProc(LPGUID guid, LPCWSTR description, LPCWSTR , LPVOID context) {
  auto* ctx = static_cast<DsEnumContext*>(context);
  if (!ctx || !ctx->out) return TRUE;
  DeviceDesc desc;
  desc.backend = backend_id::kDirectSound;
  if (guid) {
    desc.id = GuidToString(*guid);
    desc.name = WcharToUtf8(description);
  } else {
    desc.id = "default";
    desc.name = WcharToUtf8(description);
    if (desc.name.empty()) desc.name = u8"主声音驱动程序 (默认)";
    desc.isDefault = true;
  }
  if (desc.name.empty()) desc.name = "DirectSound 设备";
  ctx->out->push_back(desc);
  return TRUE;
}

std::vector<DeviceDesc> EnumerateDirectSound() {
  std::vector<DeviceDesc> out;
  DsEnumContext ctx;
  ctx.out = &out;
  HRESULT hr = DirectSoundEnumerateW(DsEnumProc, &ctx);
  if (FAILED(hr)) {
    LogLine("devices: DirectSoundEnumerate 失败 %s", HrToString(hr).c_str());
  }
  return out;
}

std::vector<DeviceDesc> EnumerateMme() {
  std::vector<DeviceDesc> out;
  {
    DeviceDesc mapper;
    mapper.backend = backend_id::kMme;
    mapper.id = std::to_string(static_cast<unsigned long long>(WAVE_MAPPER));
    mapper.name = u8"波形映射器 (系统默认, WAVE_MAPPER)";
    mapper.isDefault = true;
    out.push_back(mapper);
  }
  const UINT n = waveOutGetNumDevs();
  for (UINT i = 0; i < n; ++i) {
    WAVEOUTCAPSW caps;
    ZeroMemory(&caps, sizeof(caps));
    if (waveOutGetDevCapsW(static_cast<UINT_PTR>(i), &caps, sizeof(caps)) != MMSYSERR_NOERROR) continue;
    DeviceDesc desc;
    desc.backend = backend_id::kMme;
    desc.id = std::to_string(i);
    desc.name = WcharToUtf8(caps.szPname);
    if (desc.name.empty()) desc.name = "MME 设备 " + std::to_string(i);
    desc.mixChannels = static_cast<uint16_t>(std::min<DWORD>(caps.wChannels, 32));
    out.push_back(desc);
  }
  return out;
}

}  

std::vector<std::string> SupportedBackends() {
  return {backend_id::kWasapiShared, backend_id::kWasapiExclusive, backend_id::kDirectSound,
          backend_id::kMme};
}

bool BackendImplemented(const std::string& backend) {
  for (const auto& b : SupportedBackends()) {
    if (b == backend) return true;
  }
  return false;
}

std::string BackendDescription(const std::string& backend) {
  if (backend == backend_id::kWasapiShared) return u8"WASAPI 共享模式：经系统混音器，可与其它程序同时出声";
  if (backend == backend_id::kWasapiExclusive) return u8"WASAPI 独占模式：绕过系统混音器，直通硬件，其它程序静音";
  if (backend == backend_id::kDirectSound) return u8"DirectSound：DirectX 传统通道，兼容性优先";
  if (backend == backend_id::kMme) return u8"MME (waveOut)：最古老的 WinMM 通道，兼容性最高";
  return u8"未知后端";
}

std::vector<DeviceDesc> EnumerateDevices(const std::string& backend) {
  if (backend == backend_id::kWasapiExclusive) {
    auto devices = EnumerateWasapi();
    for (auto& d : devices) d.backend = backend_id::kWasapiExclusive;
    return devices;
  }
  if (backend == backend_id::kWasapiShared) return EnumerateWasapi();
  if (backend == backend_id::kDirectSound) return EnumerateDirectSound();
  if (backend == backend_id::kMme) return EnumerateMme();
  return {};
}

std::string DefaultDeviceId(const std::string& backend) {
  if (backend == backend_id::kMme) return std::to_string(static_cast<unsigned long long>(WAVE_MAPPER));
  const auto devices = EnumerateDevices(backend);
  for (const auto& d : devices) {
    if (d.isDefault) return d.id;
  }
  return devices.empty() ? std::string() : devices.front().id;
}

FormatProbeResult ProbeFormat(const std::string& backend, const std::string& deviceId,
                              uint32_t sampleRate, uint16_t channels, uint16_t bits, bool isFloat,
                              bool exclusive) {
  FormatProbeResult result;
  if (!BackendImplemented(backend)) {
    result.detail = u8"后端未实现: " + backend;
    return result;
  }

  if (backend == backend_id::kWasapiShared) {
    
    const auto devices = EnumerateDevices(backend);
    for (const auto& d : devices) {
      if (deviceId.empty() ? d.isDefault : d.id == deviceId) {
        result.supported = true;
        result.negotiated.sampleRate = d.mixSampleRate;
        result.negotiated.channels = d.mixChannels;
        result.negotiated.bits = d.mixBits;
        result.negotiated.isFloat = d.mixFloat;
        result.negotiated.exclusive = false;
        result.detail = u8"共享模式：系统混音格式 " + std::to_string(d.mixSampleRate) + "Hz/" +
                        std::to_string(d.mixBits) + "bit";
        return result;
      }
    }
    result.supported = !devices.empty();
    result.detail = devices.empty() ? u8"没有可用于共享模式的声音设备" : u8"设备未找到，将使用默认设备";
    return result;
  }

  if (backend == backend_id::kWasapiExclusive) {
    ComApartment com;
    if (!com.usable()) {
      result.detail = u8"COM 初始化失败";
      return result;
    }
    ComPtr<IMMDeviceEnumerator> enumerator;
    if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                IID_PPV_ARGS(enumerator.Put())))) {
      result.detail = u8"无法创建 MMDeviceEnumerator";
      return result;
    }
    ComPtr<IMMDevice> device;
    HRESULT hr;
    if (deviceId.empty()) {
      hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, device.Put());
    } else {
      hr = enumerator->GetDevice(Utf8ToWchar(deviceId).c_str(), device.Put());
    }
    if (FAILED(hr)) {
      result.detail = u8"打开设备失败: " + HrToString(hr);
      return result;
    }

    
    DeviceFormat nativeFmt;
    bool hasNative = false;
    {
      ComPtr<IPropertyStore> store;
      if (SUCCEEDED(device->OpenPropertyStore(STGM_READ, store.Put()))) {
        PROPVARIANT pv;
        PropVariantInit(&pv);
        if (SUCCEEDED(store->GetValue(kPkeyAudioEngineDeviceFormat, &pv)) && pv.vt == VT_BLOB &&
            pv.blob.pBlobData && pv.blob.cbSize >= sizeof(WAVEFORMATEX)) {
          const auto* wf = reinterpret_cast<const WAVEFORMATEX*>(pv.blob.pBlobData);
          if (pv.blob.cbSize >= sizeof(WAVEFORMATEX) + wf->cbSize) {
            nativeFmt = FromWaveFormat(wf, true);
            hasNative = true;
          }
        }
        PropVariantClear(&pv);
      }
    }

    ComPtr<IAudioClient> client;
    hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
                          reinterpret_cast<void**>(client.Put()));
    if (FAILED(hr)) {
      result.detail = u8"激活 IAudioClient 失败: " + HrToString(hr);
      return result;
    }

    DeviceFormat want;
    want.sampleRate = sampleRate ? sampleRate : 48000;
    want.channels = channels ? channels : 2;
    want.bits = bits ? bits : 32;
    want.isFloat = isFloat;
    want.validBits = want.bits;
    want.channelMask = ChannelMaskFor(want.channels);

    std::vector<DeviceFormat> candidates;
    candidates.push_back(want);
    if (hasNative && (nativeFmt.sampleRate != want.sampleRate || nativeFmt.bits != want.bits ||
                      nativeFmt.channels != want.channels)) {
      candidates.push_back(nativeFmt);
    }

    std::string lastErr;
    WAVEFORMATEX* closest = nullptr;
    for (const auto& candidate : candidates) {
      WAVEFORMATEXTENSIBLE wf;
      ToWaveFormat(candidate, &wf);
      WAVEFORMATEX* close = nullptr;
      hr = client->IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE,
                                     reinterpret_cast<WAVEFORMATEX*>(&wf), &close);
      if (hr == S_OK) {
        result.supported = true;
        result.negotiated = candidate;
        result.negotiated.exclusive = true;
        result.detail = u8"独占模式可用";
        if (close) CoTaskMemFree(close);
        break;
      }
      if (hr == S_FALSE && close && !closest) {
        closest = close;
      } else {
        lastErr = HrToString(hr);
        if (close) CoTaskMemFree(close);
      }
    }
    if (!result.supported && closest) {
      result.supported = true;
      result.negotiated = FromWaveFormat(closest, true);
      result.detail = u8"设备不支持该格式，将回退到 " + std::to_string(result.negotiated.sampleRate) +
                      "Hz/" + std::to_string(result.negotiated.bits) + "bit";
    }
    if (closest) CoTaskMemFree(closest);
    if (!result.supported) {
      result.detail = u8"该设备不支持独占模式: " + (lastErr.empty() ? std::string("未知") : lastErr);
    }
    if (hasNative && result.supported) {
      result.detail += u8"（设备原生格式 " + std::to_string(nativeFmt.sampleRate) + "Hz/" +
                       std::to_string(nativeFmt.bits) + "bit）";
    }
    return result;
  }

  
  if (channels == 0 || channels > 2) {
    result.supported = false;
    result.detail = std::string(backend) + u8" 仅支持单声道/立体声";
    return result;
  }
  result.supported = true;
  result.negotiated.sampleRate = sampleRate ? sampleRate : 44100;
  result.negotiated.channels = channels ? channels : 2;
  result.negotiated.bits = 16;
  result.negotiated.isFloat = false;
  result.negotiated.channelMask = ChannelMaskFor(result.negotiated.channels);
  result.negotiated.validBits = 16;
  result.detail = std::string(backend) + u8" 输出 16bit PCM（由引擎从 float32 转换）";
  (void)exclusive;
  return result;
}

std::unique_ptr<IAudioBackend> CreateBackend(const std::string& backendId) {
  if (backendId == backend_id::kWasapiExclusive) return CreateWasapiBackend(true);
  if (backendId == backend_id::kDirectSound) return CreateDirectSoundBackend();
  if (backendId == backend_id::kMme) return CreateMmeBackend();
  return CreateWasapiBackend(false);
}

}  
