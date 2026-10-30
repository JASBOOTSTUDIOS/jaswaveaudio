#pragma once
/**
 * Orden de eventos MIDI de un bloque y emulación de sustain del host, sin dependencias del SDK VST3
 * (se prueba solo en tests/midi_sustain_test.cpp y en el arnés del piano).
 *
 * Contrato: los eventos se ENCOLAN en bruto (noteOn / noteOff / CC con su delaySamples) y la emulación de
 * sustain (pedal pisado → note-off retenido → entregado al soltar) se evalúa AL SONAR, es decir, al procesar
 * el bloque en el que vencen, en el orden de su tiempo. Así un CC64 programado 3 s por delante no retiene
 * notas que suenan antes de él, y los cambios de parámetro mapeados llevan su desplazamiento de muestras.
 */

#include <algorithm>
#include <cstdint>
#include <vector>

struct Vst3MidiEvent {
  enum class Kind { NoteOn, NoteOff, ControlChange };
  Kind kind{};
  int16_t pitch{0};
  float velocity{0};
  int16_t cc{0};
  int16_t ccValue{0};
  int32_t delaySamples{0};
  int32_t lengthSamples{0};
  /** Canal MIDI 0-15 (zonas con canal de salida; por defecto 0). */
  int16_t channel{0};
  /** El evento se encoló con retardo > 0 (reproducción por adelantado): en empates manda NoteOff < CC < NoteOn. */
  bool scheduled{false};
  /** Ya pasó por la emulación de sustain (reencolado por desbordamiento del EventList): se entrega tal cual. */
  bool resolved{false};
  /** CC con parámetro VST3 mapeado (IMidiMapping): el cambio se aplica en el desplazamiento del evento. */
  bool hasParam{false};
  uint32_t paramId{0};
  double paramValue{0};
};

struct ParamAtOffset {
  uint32_t id{0};
  double value{0};
  /** Muestra dentro del bloque de process() (0 = al principio). */
  int sampleOffset{0};
};

struct SustainState {
  bool sustainDown{false};
  uint64_t keyDown[2]{0, 0};
  uint64_t latched[2]{0, 0};
  /** Canal del último note-on por tono: el note-off retenido por el pedal sale por el mismo canal. */
  uint8_t noteChannel[128]{};
  static bool bit(const uint64_t* w, int p) { return (w[p >> 6] >> (p & 63)) & 1ull; }
  static void setBit(uint64_t* w, int p, bool on) {
    if (on) w[p >> 6] |= (1ull << (p & 63));
    else w[p >> 6] &= ~(1ull << (p & 63));
  }
  void reset() {
    sustainDown = false;
    keyDown[0] = keyDown[1] = 0;
    latched[0] = latched[1] = 0;
  }
};

namespace midi_sustain {

inline int rank(const Vst3MidiEvent& e) {
  if (!e.scheduled) return 1;  // en vivo: orden de llegada (rango neutro + sort estable)
  switch (e.kind) {
    case Vst3MidiEvent::Kind::NoteOff: return 0;
    case Vst3MidiEvent::Kind::ControlChange: return 1;
    default: return 2;
  }
}

/**
 * Ordena los eventos vencidos del bloque por delaySamples (NoteOff antes que NoteOn en empates programados),
 * aplica la emulación de sustain en ese orden y devuelve los eventos que realmente suenan
 * (`out`, ya ordenados) y los cambios de parámetro con su desplazamiento (`params`).
 */
inline void resolveDue(SustainState& s, std::vector<Vst3MidiEvent>& due, std::vector<Vst3MidiEvent>& out,
                       std::vector<ParamAtOffset>& params) {
  std::stable_sort(due.begin(), due.end(), [](const Vst3MidiEvent& a, const Vst3MidiEvent& b) {
    if (a.delaySamples != b.delaySamples) return a.delaySamples < b.delaySamples;
    return rank(a) < rank(b);
  });
  for (const auto& ev : due) {
    if (ev.resolved) {
      out.push_back(ev);
      continue;
    }
    const bool pitchOk = ev.pitch >= 0 && ev.pitch < 128;
    switch (ev.kind) {
      case Vst3MidiEvent::Kind::NoteOn: {
        if (pitchOk) {
          // Nota retenida solo por el pedal que se vuelve a tocar: se apaga antes para que el plugin la redispare.
          if (SustainState::bit(s.latched, ev.pitch)) {
            SustainState::setBit(s.latched, ev.pitch, false);
            Vst3MidiEvent off{};
            off.kind = Vst3MidiEvent::Kind::NoteOff;
            off.pitch = ev.pitch;
            off.delaySamples = ev.delaySamples;
            off.channel = static_cast<int16_t>(s.noteChannel[ev.pitch]);
            off.resolved = true;
            out.push_back(off);
          }
          SustainState::setBit(s.keyDown, ev.pitch, true);
          s.noteChannel[ev.pitch] = static_cast<uint8_t>(std::clamp<int>(ev.channel, 0, 15));
        }
        Vst3MidiEvent on = ev;
        on.resolved = true;
        out.push_back(on);
        break;
      }
      case Vst3MidiEvent::Kind::NoteOff: {
        Vst3MidiEvent off = ev;
        off.resolved = true;
        if (pitchOk) {
          SustainState::setBit(s.keyDown, ev.pitch, false);
          // El note-off sale por el canal del note-on que sonó.
          off.channel = static_cast<int16_t>(s.noteChannel[ev.pitch]);
          if (s.sustainDown) {
            SustainState::setBit(s.latched, ev.pitch, true);
            break;  // retenido hasta soltar el pedal
          }
        }
        out.push_back(off);
        break;
      }
      case Vst3MidiEvent::Kind::ControlChange: {
        Vst3MidiEvent cc = ev;
        cc.resolved = true;
        out.push_back(cc);
        if (ev.hasParam) params.push_back({ev.paramId, ev.paramValue, ev.delaySamples});
        if (ev.cc == 64) {
          const bool down = ev.ccValue >= 64;
          if (down != s.sustainDown) {
            s.sustainDown = down;
            if (!down) {
              // Al soltar: las notas que solo retenía el pedal se apagan en el mismo instante del CC.
              for (int p = 0; p < 128; ++p) {
                if (!SustainState::bit(s.latched, p)) continue;
                SustainState::setBit(s.latched, p, false);
                if (SustainState::bit(s.keyDown, p)) continue;
                Vst3MidiEvent off{};
                off.kind = Vst3MidiEvent::Kind::NoteOff;
                off.pitch = static_cast<int16_t>(p);
                off.delaySamples = ev.delaySamples;
                off.channel = static_cast<int16_t>(s.noteChannel[p]);
                off.resolved = true;
                out.push_back(off);
              }
            }
          }
        }
        break;
      }
    }
  }
}

}  // namespace midi_sustain
