#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

struct JaswaveMidiEvent {
  uint8_t port{0};
  uint8_t status{0};
  uint8_t data1{0};
  uint8_t data2{0};
  /** Instante de llegada (QueryPerformanceCounter en ns), para colocarlo dentro del bloque de audio. */
  int64_t timestampNs{0};
};

#ifdef _WIN32
/** Reloj monotónico de alta resolución (QPC) en ns: el mismo que sella los eventos. */
int64_t jaswave_midi_now_ns();
bool jaswave_midi_list_json(std::string& jsonOut);
void jaswave_midi_open_all();
void jaswave_midi_close_all();
/** Drena el anillo de audio (WinMM callback → audio thread). Sin I/O. */
size_t jaswave_midi_drain(JaswaveMidiEvent* out, size_t maxCount);
#else
inline int64_t jaswave_midi_now_ns() { return 0; }
inline bool jaswave_midi_list_json(std::string& jsonOut) {
  jsonOut = "[]";
  return true;
}
inline void jaswave_midi_open_all() {}
inline void jaswave_midi_close_all() {}
inline size_t jaswave_midi_drain(JaswaveMidiEvent*, size_t) { return 0; }
#endif
