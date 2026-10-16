
#include <node_api.h>

#include <memory>
#include <string>
#include <vector>

#include "backend.h"
#include "devices.h"
#include "engine.h"
#include "util.h"

namespace aurora {
namespace {


void Throw(napi_env env, const std::string& message) {
  napi_throw_error(env, nullptr, message.c_str());
}

bool IsOk(napi_env env, napi_status status) {
  if (status != napi_ok) {
    bool pending = false;
    napi_is_exception_pending(env, &pending);
    if (!pending) Throw(env, "N-API 调用失败");
    return false;
  }
  return true;
}

std::string GetUtf8(napi_env env, napi_value value) {
  size_t len = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &len) != napi_ok) return std::string();
  std::vector<char> buf(len + 1, '\0');
  if (napi_get_value_string_utf8(env, value, buf.data(), buf.size(), &len) != napi_ok) {
    return std::string();
  }
  return std::string(buf.data(), len);
}

bool HasProperty(napi_env env, napi_value obj, const char* key) {
  bool has = false;
  napi_has_named_property(env, obj, key, &has);
  return has;
}

std::string GetStringProp(napi_env env, napi_value obj, const char* key, const std::string& def) {
  if (!HasProperty(env, obj, key)) return def;
  napi_value v;
  if (napi_get_named_property(env, obj, key, &v) != napi_ok) return def;
  napi_valuetype type;
  if (napi_typeof(env, v, &type) != napi_ok) return def;
  if (type == napi_string) return GetUtf8(env, v);
  return def;
}

double GetNumberProp(napi_env env, napi_value obj, const char* key, double def) {
  if (!HasProperty(env, obj, key)) return def;
  napi_value v;
  if (napi_get_named_property(env, obj, key, &v) != napi_ok) return def;
  double d = def;
  if (napi_get_value_double(env, v, &d) != napi_ok) return def;
  return d;
}

bool GetBoolProp(napi_env env, napi_value obj, const char* key, bool def) {
  if (!HasProperty(env, obj, key)) return def;
  napi_value v;
  if (napi_get_named_property(env, obj, key, &v) != napi_ok) return def;
  bool b = def;
  if (napi_get_value_bool(env, v, &b) != napi_ok) return def;
  return b;
}

void SetString(napi_env env, napi_value obj, const char* key, const std::string& value) {
  napi_value v;
  if (napi_create_string_utf8(env, value.c_str(), value.size(), &v) == napi_ok) {
    napi_set_named_property(env, obj, key, v);
  }
}

void SetNumber(napi_env env, napi_value obj, const char* key, double value) {
  napi_value v;
  if (napi_create_double(env, value, &v) == napi_ok) {
    napi_set_named_property(env, obj, key, v);
  }
}

void SetBool(napi_env env, napi_value obj, const char* key, bool value) {
  napi_value v;
  if (napi_get_boolean(env, value, &v) == napi_ok) {
    napi_set_named_property(env, obj, key, v);
  }
}

napi_value DeviceToJs(napi_env env, const DeviceDesc& d) {
  napi_value obj;
  napi_create_object(env, &obj);
  SetString(env, obj, "id", d.id);
  SetString(env, obj, "name", d.name);
  SetString(env, obj, "backend", d.backend);
  SetBool(env, obj, "isDefault", d.isDefault);
  SetBool(env, obj, "isDefaultCommunications", d.isDefaultCommunications);
  SetString(env, obj, "state", d.state);
  SetString(env, obj, "formFactor", d.formFactor);
  SetNumber(env, obj, "mixSampleRate", d.mixSampleRate);
  SetNumber(env, obj, "mixChannels", d.mixChannels);
  SetNumber(env, obj, "mixBits", d.mixBits);
  SetBool(env, obj, "mixFloat", d.mixFloat);
  return obj;
}


napi_value ListDevices(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  std::string backend = backend_id::kWasapiShared;
  if (argc > 0) {
    napi_valuetype type;
    napi_typeof(env, args[0], &type);
    if (type == napi_string) backend = GetUtf8(env, args[0]);
  }
  const auto devices = EnumerateDevices(backend);
  napi_value arr;
  napi_create_array_with_length(env, devices.size(), &arr);
  for (size_t i = 0; i < devices.size(); ++i) {
    napi_set_element(env, arr, static_cast<uint32_t>(i), DeviceToJs(env, devices[i]));
  }
  return arr;
}

napi_value DefaultDeviceIdJs(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  std::string backend = backend_id::kWasapiShared;
  if (argc > 0) backend = GetUtf8(env, args[0]);
  napi_value out;
  const std::string id = DefaultDeviceId(backend);
  napi_create_string_utf8(env, id.c_str(), id.size(), &out);
  return out;
}

napi_value ProbeFormatJs(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  std::string backend = backend_id::kWasapiShared;
  std::string deviceId;
  uint32_t sampleRate = 48000;
  uint16_t channels = 2;
  uint16_t bits = 32;
  bool isFloat = true;
  bool exclusive = false;
  if (argc > 0) {
    napi_valuetype type;
    napi_typeof(env, args[0], &type);
    if (type == napi_object) {
      backend = GetStringProp(env, args[0], "backend", backend);
      deviceId = GetStringProp(env, args[0], "deviceId", deviceId);
      sampleRate = static_cast<uint32_t>(GetNumberProp(env, args[0], "sampleRate", sampleRate));
      channels = static_cast<uint16_t>(GetNumberProp(env, args[0], "channels", channels));
      bits = static_cast<uint16_t>(GetNumberProp(env, args[0], "bits", bits));
      isFloat = GetBoolProp(env, args[0], "isFloat", isFloat);
      exclusive = GetBoolProp(env, args[0], "exclusive", exclusive);
    }
  }
  const FormatProbeResult r =
      ProbeFormat(backend, deviceId, sampleRate, channels, bits, isFloat, exclusive);
  napi_value obj;
  napi_create_object(env, &obj);
  SetBool(env, obj, "supported", r.supported);
  SetString(env, obj, "detail", r.detail);
  napi_value f;
  napi_create_object(env, &f);
  SetNumber(env, f, "sampleRate", r.negotiated.sampleRate);
  SetNumber(env, f, "channels", r.negotiated.channels);
  SetNumber(env, f, "bits", r.negotiated.bits);
  SetBool(env, f, "isFloat", r.negotiated.isFloat);
  SetBool(env, f, "exclusive", r.negotiated.exclusive);
  napi_set_named_property(env, obj, "format", f);
  return obj;
}

napi_value BackendsJs(napi_env env, napi_callback_info info) {
  const auto ids = SupportedBackends();
  napi_value arr;
  napi_create_array_with_length(env, ids.size(), &arr);
  for (size_t i = 0; i < ids.size(); ++i) {
    napi_value obj;
    napi_create_object(env, &obj);
    SetString(env, obj, "id", ids[i]);
    SetString(env, obj, "description", BackendDescription(ids[i]));
    SetBool(env, obj, "implemented", BackendImplemented(ids[i]));
    napi_set_element(env, arr, static_cast<uint32_t>(i), obj);
  }
  return arr;
}

napi_value VersionJs(napi_env env, napi_callback_info info) {
  napi_value obj;
  napi_create_object(env, &obj);
  SetString(env, obj, "engine", "aurora-audio");
  SetString(env, obj, "version", "1.0.0");
  SetNumber(env, obj, "napiVersion", NAPI_VERSION);
  SetString(env, obj, "platform", "windows");
  return obj;
}


struct OutputWrap {
  std::unique_ptr<IAudioBackend> backend;
  std::unique_ptr<AudioEngine> engine;
  OpenParams params;
  bool closed = false;
};

void OutputFinalize(napi_env env, void* data, void* hint) {
  auto* wrap = static_cast<OutputWrap*>(data);
  if (wrap) {
    if (wrap->backend) wrap->backend->Close();
    wrap->engine.reset();
    wrap->backend.reset();
    delete wrap;
  }
}

OutputWrap* Unwrap(napi_env env, napi_callback_info info, size_t* argc, napi_value* args,
                   napi_value* jsthis) {
  napi_get_cb_info(env, info, argc, args, jsthis, nullptr);
  void* data = nullptr;
  if (napi_unwrap(env, *jsthis, &data) != napi_ok || !data) {
    Throw(env, u8"AudioOutput 已失效");
    return nullptr;
  }
  return static_cast<OutputWrap*>(data);
}

napi_value OutputCtor(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_value jsthis;
  napi_get_cb_info(env, info, &argc, args, &jsthis, nullptr);

  auto* wrap = new OutputWrap();
  OpenParams& p = wrap->params;
  uint32_t inputRate = 0;
  uint32_t inputChannels = 0;
  if (argc > 0) {
    napi_valuetype type;
    napi_typeof(env, args[0], &type);
    if (type == napi_object) {
      p.backend = GetStringProp(env, args[0], "backend", p.backend);
      p.deviceId = GetStringProp(env, args[0], "deviceId", p.deviceId);
      p.sampleRate = static_cast<uint32_t>(GetNumberProp(env, args[0], "sampleRate", p.sampleRate));
      p.channels = static_cast<uint16_t>(GetNumberProp(env, args[0], "channels", p.channels));
      p.bits = static_cast<uint16_t>(GetNumberProp(env, args[0], "bits", p.bits));
      p.isFloat = GetBoolProp(env, args[0], "isFloat", p.isFloat);
      p.exclusive = GetBoolProp(env, args[0], "exclusive", p.exclusive);
      p.periodMs = static_cast<uint32_t>(GetNumberProp(env, args[0], "periodMs", p.periodMs));
      p.bufferMs = static_cast<uint32_t>(GetNumberProp(env, args[0], "bufferMs", p.bufferMs));
      p.ringMs = static_cast<uint32_t>(GetNumberProp(env, args[0], "ringMs", p.ringMs));
      p.allowFormatFallback =
          GetBoolProp(env, args[0], "allowFormatFallback", p.allowFormatFallback);
      p.hwndHex = GetStringProp(env, args[0], "hwndHex", p.hwndHex);
      inputRate = static_cast<uint32_t>(GetNumberProp(env, args[0], "inputSampleRate", 0));
      inputChannels = static_cast<uint32_t>(GetNumberProp(env, args[0], "inputChannels", 0));
      if (p.backend == backend_id::kWasapiExclusive) p.exclusive = true;
    }
  }

  if (!BackendImplemented(p.backend)) {
    delete wrap;
    Throw(env, u8"不支持的音频后端: " + p.backend);
    return nullptr;
  }

  wrap->backend = CreateBackend(p.backend);
  if (!wrap->backend) {
    delete wrap;
    Throw(env, u8"创建音频后端失败");
    return nullptr;
  }

  std::string err;
  if (!wrap->backend->Open(p, &err)) {
    wrap->backend->Close();
    delete wrap;
    Throw(env, err.empty() ? std::string(u8"打开音频设备失败") : err);
    return nullptr;
  }

  const DeviceFormat fmt = wrap->backend->Format();
  const uint32_t ringMs = p.ringMs ? p.ringMs : 800;
  const uint32_t ringFrames = std::max<uint32_t>(2048, fmt.sampleRate * ringMs / 1000);
  wrap->engine.reset(new AudioEngine(fmt.channels, fmt, ringFrames));

  if ((inputRate && inputRate != fmt.sampleRate) ||
      (inputChannels && inputChannels != fmt.channels)) {
    wrap->engine->SetInputFormat(inputRate ? inputRate : fmt.sampleRate,
                                 static_cast<uint16_t>(inputChannels ? inputChannels : fmt.channels));
  }

  wrap->backend->SetEngine(wrap->engine.get());
  wrap->backend->Start();

  if (!IsOk(env, napi_wrap(env, jsthis, wrap, OutputFinalize, nullptr, nullptr))) {
    delete wrap;
    return nullptr;
  }
  return jsthis;
}

napi_value OutputWrite(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_value jsthis;
  OutputWrap* wrap = Unwrap(env, info, &argc, args, &jsthis);
  if (!wrap) return nullptr;
  if (argc < 1) {
    Throw(env, u8"write(buffer) 需要 Buffer 参数");
    return nullptr;
  }
  void* data = nullptr;
  size_t length = 0;
  if (napi_get_buffer_info(env, args[0], &data, &length) != napi_ok || !data) {
    Throw(env, u8"write() 只接受 Buffer");
    return nullptr;
  }
  const uint32_t bytesPerFrame = 4u * wrap->engine->InputChannels();
  const uint32_t frames = static_cast<uint32_t>(length / bytesPerFrame);
  const uint32_t accepted =
      wrap->engine->Write(static_cast<const float*>(data), frames);
  napi_value out;
  napi_create_uint32(env, accepted, &out);
  return out;
}

napi_value OutputFlush(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value jsthis;
  OutputWrap* wrap = Unwrap(env, info, &argc, nullptr, &jsthis);
  if (!wrap) return nullptr;
  wrap->engine->Flush();
  return nullptr;
}

napi_value OutputPause(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value jsthis;
  OutputWrap* wrap = Unwrap(env, info, &argc, nullptr, &jsthis);
  if (!wrap) return nullptr;
  wrap->backend->SetPaused(true);
  return nullptr;
}

napi_value OutputResume(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value jsthis;
  OutputWrap* wrap = Unwrap(env, info, &argc, nullptr, &jsthis);
  if (!wrap) return nullptr;
  wrap->backend->SetPaused(false);
  return nullptr;
}

napi_value OutputSetVolume(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_value jsthis;
  OutputWrap* wrap = Unwrap(env, info, &argc, args, &jsthis);
  if (!wrap) return nullptr;
  double v = 1.0;
  if (argc > 0) napi_get_value_double(env, args[0], &v);
  wrap->engine->SetVolume(static_cast<float>(v));
  return nullptr;
}

napi_value OutputStats(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value jsthis;
  OutputWrap* wrap = Unwrap(env, info, &argc, nullptr, &jsthis);
  if (!wrap) return nullptr;
  const EngineStats s = wrap->engine->Stats();
  napi_value obj;
  napi_create_object(env, &obj);
  SetNumber(env, obj, "framesAccepted", static_cast<double>(s.framesAccepted));
  SetNumber(env, obj, "framesRendered", static_cast<double>(s.framesRendered));
  SetNumber(env, obj, "framesSilence", static_cast<double>(s.framesSilence));
  SetNumber(env, obj, "underrunEvents", static_cast<double>(s.underrunEvents));
  SetNumber(env, obj, "bufferedFrames", s.bufferedFrames);
  SetNumber(env, obj, "capacityFrames", s.capacityFrames);
  SetBool(env, obj, "paused", s.paused);
  SetNumber(env, obj, "volume", s.volume);
  
  napi_value peaks;
  napi_create_array_with_length(env, s.peakChannels, &peaks);
  for (uint16_t c = 0; c < s.peakChannels; ++c) {
    napi_value v;
    napi_create_double(env, s.peak[c], &v);
    napi_set_element(env, peaks, c, v);
  }
  napi_set_named_property(env, obj, "peaks", peaks);
  SetNumber(env, obj, "peakChannels", s.peakChannels);
  SetString(env, obj, "lastError", wrap->backend->LastError());
  return obj;
}

napi_value OutputClose(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value jsthis;
  OutputWrap* wrap = Unwrap(env, info, &argc, nullptr, &jsthis);
  if (!wrap) return nullptr;
  if (!wrap->closed) {
    wrap->backend->Close();
    wrap->closed = true;
  }
  return nullptr;
}

napi_value OutputGetBuffered(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value jsthis;
  OutputWrap* wrap = Unwrap(env, info, &argc, nullptr, &jsthis);
  if (!wrap) return nullptr;
  napi_value out;
  napi_create_uint32(env, wrap->engine->Buffered(), &out);
  return out;
}

napi_value OutputGetCapacity(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value jsthis;
  OutputWrap* wrap = Unwrap(env, info, &argc, nullptr, &jsthis);
  if (!wrap) return nullptr;
  napi_value out;
  napi_create_uint32(env, wrap->engine->Capacity(), &out);
  return out;
}

napi_value OutputGetFormat(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value jsthis;
  OutputWrap* wrap = Unwrap(env, info, &argc, nullptr, &jsthis);
  if (!wrap) return nullptr;
  const DeviceFormat f = wrap->backend->Format();
  napi_value obj;
  napi_create_object(env, &obj);
  SetNumber(env, obj, "sampleRate", f.sampleRate);
  SetNumber(env, obj, "channels", f.channels);
  SetNumber(env, obj, "bits", f.bits);
  SetBool(env, obj, "isFloat", f.isFloat);
  SetBool(env, obj, "exclusive", f.exclusive);
  SetNumber(env, obj, "bytesPerFrame", f.BytesPerFrame());
  SetNumber(env, obj, "inputSampleRate", wrap->engine->InputSampleRate());
  SetNumber(env, obj, "inputChannels", wrap->engine->InputChannels());
  SetString(env, obj, "backend", wrap->backend->Name());
  return obj;
}

napi_value OutputGetDeviceName(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value jsthis;
  OutputWrap* wrap = Unwrap(env, info, &argc, nullptr, &jsthis);
  if (!wrap) return nullptr;
  napi_value out;
  const std::string name = wrap->backend->DeviceName();
  napi_create_string_utf8(env, name.c_str(), name.size(), &out);
  return out;
}

napi_value OutputGetBackend(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value jsthis;
  OutputWrap* wrap = Unwrap(env, info, &argc, nullptr, &jsthis);
  if (!wrap) return nullptr;
  napi_value out;
  const std::string name = wrap->backend->Name();
  napi_create_string_utf8(env, name.c_str(), name.size(), &out);
  return out;
}

napi_value OutputGetLastError(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_value jsthis;
  OutputWrap* wrap = Unwrap(env, info, &argc, nullptr, &jsthis);
  if (!wrap) return nullptr;
  napi_value out;
  const std::string err = wrap->backend->LastError();
  napi_create_string_utf8(env, err.c_str(), err.size(), &out);
  return out;
}

}  
}  

NAPI_MODULE_INIT() {
  using namespace aurora;

  napi_property_descriptor props[] = {
      {"write", nullptr, OutputWrite, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"flush", nullptr, OutputFlush, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"pause", nullptr, OutputPause, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"resume", nullptr, OutputResume, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setVolume", nullptr, OutputSetVolume, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"stats", nullptr, OutputStats, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"close", nullptr, OutputClose, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"buffered", nullptr, OutputGetBuffered, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"capacity", nullptr, OutputGetCapacity, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"format", nullptr, nullptr, OutputGetFormat, nullptr, nullptr,
       static_cast<napi_property_attributes>(napi_default | napi_enumerable), nullptr},
      {"deviceName", nullptr, nullptr, OutputGetDeviceName, nullptr, nullptr,
       static_cast<napi_property_attributes>(napi_default | napi_enumerable), nullptr},
      {"backend", nullptr, nullptr, OutputGetBackend, nullptr, nullptr,
       static_cast<napi_property_attributes>(napi_default | napi_enumerable), nullptr},
      {"lastError", nullptr, nullptr, OutputGetLastError, nullptr, nullptr,
       static_cast<napi_property_attributes>(napi_default | napi_enumerable), nullptr},
  };

  napi_value ctor = nullptr;
  napi_status status =
      napi_define_class(env, "AudioOutput", NAPI_AUTO_LENGTH, OutputCtor, nullptr,
                        sizeof(props) / sizeof(props[0]), props, &ctor);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "定义 AudioOutput 类失败");
    return exports;
  }
  napi_set_named_property(env, exports, "AudioOutput", ctor);

  napi_property_descriptor fns[] = {
      {"listDevices", nullptr, ListDevices, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"defaultDeviceId", nullptr, DefaultDeviceIdJs, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"probeFormat", nullptr, ProbeFormatJs, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"backends", nullptr, BackendsJs, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"version", nullptr, VersionJs, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  for (const auto& fn : fns) {
    napi_value f = nullptr;
    if (napi_create_function(env, fn.utf8name, NAPI_AUTO_LENGTH, fn.method, nullptr, &f) == napi_ok) {
      napi_set_named_property(env, exports, fn.utf8name, f);
    }
  }
  return exports;
}
