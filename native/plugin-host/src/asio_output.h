#pragma once

#include "audio_output.h"

#include <string>
#include <vector>

#ifdef _WIN32

bool jaswave_asio_list_drivers(std::vector<JaswaveAudioDevice>& out);
bool jaswave_asio_start(const std::string& driverName, uint32_t sampleRate, uint32_t bufferSize,
                        std::string& err);
void jaswave_asio_stop();
bool jaswave_asio_running();
uint32_t jaswave_asio_sample_rate();
uint32_t jaswave_asio_buffer_size();
bool jaswave_asio_control_panel(const std::string& driverName, std::string& err);

#endif
