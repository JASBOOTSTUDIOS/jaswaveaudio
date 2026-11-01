#pragma once

#include "audio_output.h"

#include <string>
#include <vector>

#ifdef _WIN32

/** Re-afirma STA en este hilo si miniaudio/WASAPI dejó COM en MTA o sin apartment. */
void jaswave_com_restore_sta();

void jaswave_asio_set_sys_handle(void* hwnd);

bool jaswave_asio_list_drivers(std::vector<JaswaveAudioDevice>& out);
bool jaswave_asio_start(const std::string& driverName, uint32_t sampleRate, uint32_t bufferSize,
                        std::string& err);
void jaswave_asio_stop();
bool jaswave_asio_running();
uint32_t jaswave_asio_sample_rate();
uint32_t jaswave_asio_buffer_size();
bool jaswave_asio_control_panel(const std::string& driverName, std::string& err);

// U6: el driver ASIO pide reinicio (reset / cambio de buffer / resync).
// Se marca aquí y el host lo reinicializa fuera del callback del driver.
void jaswave_asio_notify_reset();
bool jaswave_asio_reset_pending();
void jaswave_asio_clear_reset_pending();

/** Despierta el hilo principal del host (para procesar avisos del driver). */
void jaswave_host_wake_main_thread();

#endif
