
#pragma once

#include <string>
#include <vector>

#include "backend.h"

namespace aurora {


std::vector<std::string> SupportedBackends();


bool BackendImplemented(const std::string& backend);


std::string BackendDescription(const std::string& backend);

}  
