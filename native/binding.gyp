{
  "targets": [
    {
      "target_name": "aurora_audio",
      "sources": [
        "src/addon.cc",
        "src/engine.cc",
        "src/util.cc"
      ],
      "include_dirs": [ "src" ],
      "defines": [
        "NAPI_VERSION=8",
        "UNICODE",
        "_UNICODE"
      ],
      "conditions": [
        [ "OS=='win'", {
          "sources": [
            "src/devices.cc",
            "src/backend_wasapi.cc",
            "src/backend_dsound.cc",
            "src/backend_mme.cc",
            "src/taskbar_win.cc"
          ],
          "defines": [
            "WIN32_LEAN_AND_MEAN",
            "NOMINMAX",
            "_WIN32_WINNT=0x0A00"
          ],
          "libraries": [
            "-lole32.lib",
            "-loleaut32.lib",
            "-luuid.lib",
            "-lmmdevapi.lib",
            "-ldsound.lib",
            "-lwinmm.lib",
            "-lpropsys.lib",
            "-ladvapi32.lib"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": [ "/std:c++17", "/utf-8", "/MP" ],
              "Optimization": 2,
              "WarningLevel": 3
            }
          }
        } ],
        [ "OS=='linux'", {
          "sources": [
            "src/devices_linux.cc",
            "src/backend_alsa.cc"
          ],
          "libraries": [ "-lasound" ],
          "cflags_cc": [ "-std=c++17", "-O2", "-fexceptions" ],
          "cflags_cc!": [ "-fno-exceptions" ]
        } ]
      ]
    }
  ]
}
