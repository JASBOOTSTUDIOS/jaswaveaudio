#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

struct JaswaveMidiEvent {
  uint8_t port{0};
  uint8_t status{0};
  uint8_t data1{0};
  uint8_t data2{0};
};

#ifdef _WIN32
bool jaswave_midi_list_json(std::string& jsonOut);
void jaswave_midi_open_all();
void jaswave_midi_close_all();
/** Drena el anillo de audio (WinMM callback → audio thread). Sin I/O. */
size_t jaswave_midi_drain(JaswaveMidiEvent* out, size_t maxCount);
#else
inline bool jaswave_midi_list_json(std::string& jsonOut) {
  jsonOut = "[]";
  return true;
}
inline void jaswave_midi_open_all() {}
inline void jaswave_midi_close_all() {}
inline size_t jaswave_midi_drain(JaswaveMidiEvent*, size_t) { return 0; }
#endif
