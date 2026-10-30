/**
 * Selftest determinista del orden de eventos MIDI y la emulación de sustain del host (midi_sustain.h).
 *   cmake --build build-release --config Release --target jaswave-host-midi-selftest
 *   build-release/Release/jaswave-host-midi-selftest.exe
 * (o, sin CMake: g++ -std=c++17 -I src tests/midi_sustain_test.cpp -o midi_sustain_test)
 */

#include <cstdio>
#include <vector>

#include "midi_sustain.h"

namespace {

int gFallos = 0;
void comprobar(bool ok, const char* que) {
  std::printf("  %s %s\n", ok ? "ok   " : "FALLO", que);
  if (!ok) ++gFallos;
}

using K = Vst3MidiEvent::Kind;

Vst3MidiEvent on(int pitch, int delay, int ch = 0) {
  Vst3MidiEvent e{K::NoteOn, static_cast<int16_t>(pitch), 0.8f, 0, 0, delay, 0, static_cast<int16_t>(ch)};
  e.scheduled = delay > 0;
  return e;
}
Vst3MidiEvent off(int pitch, int delay, int ch = 0) {
  Vst3MidiEvent e{K::NoteOff, static_cast<int16_t>(pitch), 0.f, 0, 0, delay, 0, static_cast<int16_t>(ch)};
  e.scheduled = delay > 0;
  return e;
}
Vst3MidiEvent cc(int num, int val, int delay, bool mapped = false) {
  Vst3MidiEvent e{K::ControlChange, 0, 0.f, static_cast<int16_t>(num), static_cast<int16_t>(val), delay, 0, 0};
  e.scheduled = delay > 0;
  if (mapped) {
    e.hasParam = true;
    e.paramId = 1000 + num;
    e.paramValue = val / 127.0;
  }
  return e;
}

struct R {
  std::vector<Vst3MidiEvent> ev;
  std::vector<ParamAtOffset> pr;
};
R run(SustainState& s, std::vector<Vst3MidiEvent> in) {
  R r;
  midi_sustain::resolveDue(s, in, r.ev, r.pr);
  return r;
}
int count(const R& r, K k, int pitch = -1) {
  int n = 0;
  for (const auto& e : r.ev)
    if (e.kind == k && (pitch < 0 || e.pitch == pitch)) ++n;
  return n;
}

}  // namespace

int main() {
  std::printf("midi_sustain selftest\n");

  {  // 1. El pedal programado DESPUES no retiene una nota que suena antes (antes se evaluaba al encolar).
    SustainState s;
    auto r = run(s, {cc(64, 127, 96000), on(60, 1000), off(60, 20000)});
    comprobar(count(r, K::NoteOff, 60) == 1, "noteOff a 20000 sale (pedal a 96000 aun no sono)");
  }
  {  // 2. Pedal pisado antes: el noteOff se retiene y sale al soltar, en el instante del CC.
    SustainState s;
    auto r = run(s, {cc(64, 127, 100), on(60, 200), off(60, 5000), cc(64, 0, 9000)});
    int offAt = -1;
    for (const auto& e : r.ev) if (e.kind == K::NoteOff && e.pitch == 60) offAt = e.delaySamples;
    comprobar(count(r, K::NoteOff, 60) == 1 && offAt == 9000, "noteOff retenido sale en el instante del CC64=0 (9000)");
  }
  {  // 3. Nota re-tocada con el pedal: noteOff sintetico antes del noteOn, mismo desplazamiento.
    SustainState s;
    auto r = run(s, {cc(64, 127, 10), on(60, 100), off(60, 200), on(60, 300)});
    bool ok = count(r, K::NoteOff, 60) == 1;
    int iOff = -1, iOn2 = -1, n = 0;
    for (size_t i = 0; i < r.ev.size(); ++i) {
      if (r.ev[i].kind == K::NoteOff) iOff = static_cast<int>(i);
      if (r.ev[i].kind == K::NoteOn && ++n == 2) iOn2 = static_cast<int>(i);
    }
    comprobar(ok && iOff >= 0 && iOff < iOn2 && r.ev[static_cast<size_t>(iOff)].delaySamples == 300,
              "re-pulsar una nota retenida apaga la anterior justo antes de redisparar");
  }
  {  // 4. Empate programado (legato de 1 muestra): NoteOff antes que NoteOn aunque llegara despues.
    SustainState s;
    auto r = run(s, {on(60, 5000), off(60, 5000)});
    comprobar(r.ev.size() == 2 && r.ev[0].kind == K::NoteOff && r.ev[1].kind == K::NoteOn,
              "empate programado: NoteOff primero, luego NoteOn");
  }
  {  // 5. En vivo (retardo 0) se conserva el orden de llegada: tap rapido on+off no se invierte.
    SustainState s;
    auto r = run(s, {on(64, 0), off(64, 0)});
    comprobar(r.ev.size() == 2 && r.ev[0].kind == K::NoteOn && r.ev[1].kind == K::NoteOff,
              "en vivo (delay 0) manda el orden de llegada");
  }
  {  // 6. Orden por tiempo aunque se encolen desordenados.
    SustainState s;
    auto r = run(s, {off(60, 8000), on(60, 100), cc(64, 127, 50)});
    bool orden = true;
    for (size_t i = 1; i < r.ev.size(); ++i) if (r.ev[i].delaySamples < r.ev[i - 1].delaySamples) orden = false;
    comprobar(orden, "salida ordenada por delaySamples");
  }
  {  // 7. Parametro mapeado con desplazamiento: sale con el offset del CC, no a 0.
    SustainState s;
    auto r = run(s, {cc(64, 127, 777, true), cc(64, 0, 1500, true)});
    comprobar(r.pr.size() == 2 && r.pr[0].sampleOffset == 777 && r.pr[1].sampleOffset == 1500 &&
                  r.pr[0].value > 0.99 && r.pr[1].value == 0.0,
              "cambio de parametro mapeado lleva su sampleOffset");
  }
  {  // 8. Estado entre bloques: pedal pisado en un bloque retiene el noteOff del siguiente.
    SustainState s;
    run(s, {cc(64, 127, 10), on(62, 20)});
    auto r2 = run(s, {off(62, 5)});
    comprobar(count(r2, K::NoteOff, 62) == 0 && s.sustainDown, "el pedal retiene entre bloques");
    auto r3 = run(s, {cc(64, 0, 7)});
    comprobar(count(r3, K::NoteOff, 62) == 1, "soltar el pedal en otro bloque libera la nota");
  }
  {  // 9. Evento ya resuelto (reencolado por desbordamiento) se entrega tal cual y no se vuelve a retener.
    SustainState s;
    run(s, {cc(64, 127, 0)});
    Vst3MidiEvent o = off(60, 0);
    o.resolved = true;
    auto r = run(s, {o});
    comprobar(count(r, K::NoteOff, 60) == 1, "noteOff resuelto no se retiene de nuevo");
  }
  {  // 10. El note-off retenido sale por el canal del note-on.
    SustainState s;
    auto r = run(s, {cc(64, 127, 0), on(65, 10, 3), off(65, 20, 0), cc(64, 0, 99)});
    int ch = -1;
    for (const auto& e : r.ev) if (e.kind == K::NoteOff) ch = e.channel;
    comprobar(ch == 3, "noteOff retenido usa el canal del noteOn");
  }

  std::printf(gFallos == 0 ? "TODO OK\n" : "FALLOS: %d\n", gFallos);
  return gFallos == 0 ? 0 : 1;
}
