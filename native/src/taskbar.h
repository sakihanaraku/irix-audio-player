




#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include <node_api.h>

namespace aurora {

struct TaskbarIconBitmap {
  uint32_t width = 0;
  uint32_t height = 0;
  std::vector<uint8_t> bgra;
};

struct TaskbarIcons {
  TaskbarIconBitmap prev, play, pause, next;
};



bool TaskbarInstall(void* hwnd, const TaskbarIcons& icons, napi_env env, napi_value on_command,
                    std::string* error);
bool TaskbarUpdate(bool playing);
void TaskbarDispose();

}  
