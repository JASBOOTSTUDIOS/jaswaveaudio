// Renderizador offline de JasWave Roles v2 (solo desarrollo / pruebas de calidad).
//   roles_render <carpeta_salida> [sampleRate=48000]
// Genera un WAV float32 estéreo por rol con una frase de prueba representativa.
#include "../src/roles_engine.h"

#include <chrono>
#include <cstdio>
#include <string>
#include <vector>

using namespace JasWaveRoles;

struct Ev { double t; int pitch; float vel; bool on; };

static void writeWav(const std::string& path, const std::vector<float>& L, const std::vector<float>& R, int sr) {
  FILE* f = std::fopen(path.c_str(), "wb");
  if (!f) { std::fprintf(stderr, "no se pudo escribir %s\n", path.c_str()); return; }
  const uint32_t frames = static_cast<uint32_t>(L.size());
  const uint32_t dataBytes = frames * 2 * 4;
  auto w32 = [&](uint32_t v) { std::fwrite(&v, 4, 1, f); };
  auto w16 = [&](uint16_t v) { std::fwrite(&v, 2, 1, f); };
  std::fwrite("RIFF", 1, 4, f); w32(36 + dataBytes); std::fwrite("WAVEfmt ", 1, 8, f);
  w32(16); w16(3); w16(2); w32(static_cast<uint32_t>(sr)); w32(static_cast<uint32_t>(sr) * 8); w16(8); w16(32);
  std::fwrite("data", 1, 4, f); w32(dataBytes);
  for (uint32_t i = 0; i < frames; ++i) { std::fwrite(&L[i], 4, 1, f); std::fwrite(&R[i], 4, 1, f); }
  std::fclose(f);
}

static void addChord(std::vector<Ev>& e, double t, double dur, std::initializer_list<int> notes, float vel, double strum = 0.0) {
  double k = 0;
  for (int n : notes) { e.push_back({ t + k, n, vel, true }); e.push_back({ t + dur, n, 0.f, false }); k += strum; }
}

int main(int argc, char** argv) {
  if (argc < 2) { std::fprintf(stderr, "uso: roles_render <salida> [sr]\n"); return 1; }
  const std::string out = argv[1];
  const int sr = argc > 2 ? std::atoi(argv[2]) : 48000;
  struct Case { Role role; std::string name; double secs; std::vector<Ev> ev; };
  std::vector<Case> cases;

  { // batería: 2 compases a 72 BPM (0.8333 s por pulso)
    Case c{ Role::Drums, "drums", 9.0, {} };
    const double b = 60.0 / 72.0;
    for (int bar = 0; bar < 2; ++bar) {
      const double t0 = bar * 4 * b;
      addChord(c.ev, t0, 0.2, { 36 }, 0.9f);
      addChord(c.ev, t0 + 1.5 * b, 0.2, { 36 }, 0.75f);
      addChord(c.ev, t0 + 2.0 * b, 0.2, { 36 }, 0.85f);
      addChord(c.ev, t0 + 1 * b, 0.2, { 38 }, 0.95f);
      addChord(c.ev, t0 + 3 * b, 0.2, { 38 }, 0.9f);
      for (int i = 0; i < 8; ++i) addChord(c.ev, t0 + i * 0.5 * b, 0.1, { i == 7 && bar == 0 ? 46 : 42 }, i % 2 ? 0.5f : 0.7f);
    }
    addChord(c.ev, 0.0, 0.2, { 49 }, 0.95f);
    addChord(c.ev, 4 * b * 2 + 0.2, 0.2, { 45 }, 0.8f);
    addChord(c.ev, 4 * b * 2 + 0.2 + 0.3, 0.2, { 43 }, 0.8f);
    addChord(c.ev, 4 * b * 2 + 0.2 + 0.6, 0.2, { 41 }, 0.8f);
    addChord(c.ev, 4 * b * 2 + 1.5, 0.2, { 51 }, 0.8f);
    addChord(c.ev, 4 * b * 2 + 2.0, 0.2, { 39 }, 0.9f);
    addChord(c.ev, 4 * b * 2 + 2.4, 0.2, { 37 }, 0.8f);
    cases.push_back(std::move(c));
  }
  { Case c{ Role::Bass, "bass", 8.0, {} };
    addChord(c.ev, 0.0, 1.6, { 43 }, 0.85f); addChord(c.ev, 1.7, 1.6, { 38 }, 0.8f);
    addChord(c.ev, 3.4, 1.6, { 40 }, 0.85f); addChord(c.ev, 5.1, 1.6, { 36 }, 0.8f);
    addChord(c.ev, 6.8, 0.5, { 28 }, 0.9f); cases.push_back(std::move(c)); }
  { Case c{ Role::Guitar, "guitar", 9.0, {} };
    addChord(c.ev, 0.0, 3.5, { 43, 50, 55, 59, 62, 67 }, 0.8f, 0.03);
    for (int i = 0; i < 8; ++i) addChord(c.ev, 4.0 + i * 0.5, 1.0, { i % 4 == 0 ? 43 : (i % 2 ? 59 : 62) }, 0.7f);
    cases.push_back(std::move(c)); }
  { Case c{ Role::Piano, "piano", 10.0, {} };
    addChord(c.ev, 0.0, 3.0, { 43, 55, 59, 62, 67 }, 0.7f);
    addChord(c.ev, 3.2, 3.0, { 40, 52, 59, 62, 67 }, 0.5f);
    for (int i = 0; i < 8; ++i) addChord(c.ev, 6.4 + i * 0.4, 1.0, { 60 + (i * 4) % 14 + 12 }, 0.45f + 0.05f * i);
    addChord(c.ev, 9.0, 0.5, { 96 }, 0.8f);
    cases.push_back(std::move(c)); }
  { Case c{ Role::Keys, "keys", 7.0, {} }; addChord(c.ev, 0.0, 3.0, { 52, 59, 62, 67 }, 0.7f); addChord(c.ev, 3.5, 3.0, { 48, 55, 62, 64 }, 0.7f); cases.push_back(std::move(c)); }
  { Case c{ Role::Pad, "pad", 14.0, {} }; addChord(c.ev, 0.0, 6.0, { 55, 59, 62 }, 0.7f); addChord(c.ev, 6.5, 6.0, { 52, 59, 62, 67 }, 0.7f); cases.push_back(std::move(c)); }
  { Case c{ Role::Strings, "strings", 12.0, {} }; addChord(c.ev, 0.0, 5.0, { 59, 62, 67 }, 0.7f); addChord(c.ev, 5.5, 5.0, { 64, 67, 72 }, 0.7f); cases.push_back(std::move(c)); }
  { Case c{ Role::Choir, "choir", 10.0, {} }; addChord(c.ev, 0.0, 4.0, { 55, 62, 67 }, 0.7f); addChord(c.ev, 4.5, 4.0, { 52, 59, 64 }, 0.7f); cases.push_back(std::move(c)); }
  { Case c{ Role::Lead, "lead", 9.0, {} };
    const int mel[] = { 74, 71, 74, 76, 74, 69, 71, 67 };
    for (int i = 0; i < 8; ++i) addChord(c.ev, i * 0.95, 0.85, { mel[i] }, 0.8f);
    cases.push_back(std::move(c)); }
  { Case c{ Role::Brass, "brass", 6.0, {} }; addChord(c.ev, 0.0, 1.8, { 55, 59, 62 }, 0.8f); addChord(c.ev, 2.2, 1.8, { 57, 60, 64 }, 0.8f); cases.push_back(std::move(c)); }
  { Case c{ Role::Synth, "synth", 6.0, {} }; addChord(c.ev, 0.0, 1.8, { 55, 59, 62 }, 0.8f); addChord(c.ev, 2.2, 1.8, { 57, 60, 64 }, 0.8f); cases.push_back(std::move(c)); }

  const bool cal = argc > 3 && std::string(argv[3]) == "cal";
  if (cal) {
    cases.clear();
    const int dn[] = { 36, 37, 38, 39, 41, 43, 45, 42, 44, 46, 49, 51, 54, 56 };
    for (int n : dn) {
      Case c{ Role::Drums, "drum_" + std::to_string(n), 3.2, {} };
      addChord(c.ev, 0.05, 0.2, { n }, 0.8f);
      cases.push_back(std::move(c));
    }
  }
  for (auto& c : cases) {
    RolesEngine eng;
    eng.prepare(sr);
    eng.setRole(static_cast<int32_t>(c.role));
    eng.setTempo(72.0);
    const int total = static_cast<int>(c.secs * sr) + sr * 2;
    std::vector<float> L(static_cast<size_t>(total)), R(static_cast<size_t>(total));
    std::sort(c.ev.begin(), c.ev.end(), [](const Ev& a, const Ev& b) { return a.t < b.t; });
    size_t ei = 0;
    int pos = 0;
    const auto t0 = std::chrono::steady_clock::now();
    const int block = 256;
    while (pos < total) {
      const int n = std::min(block, total - pos);
      // eventos con precisión de bloque
      while (ei < c.ev.size() && static_cast<int>(c.ev[ei].t * sr) < pos + n) {
        if (c.ev[ei].on) eng.noteOn(static_cast<int16_t>(c.ev[ei].pitch), c.ev[ei].vel, 0);
        else eng.noteOff(static_cast<int16_t>(c.ev[ei].pitch), 0);
        ++ei;
      }
      eng.render(L.data() + pos, R.data() + pos, n);
      pos += n;
    }
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    std::printf("   cpu %.1f%% (tiempo real x%.0f)\n", 100.0 * wall / (static_cast<double>(total) / sr), (static_cast<double>(total) / sr) / std::max(1e-9, wall));
    for (int i = 0; i < total; ++i) {
      if (!std::isfinite(L[static_cast<size_t>(i)]) || !std::isfinite(R[static_cast<size_t>(i)])) {
        std::fprintf(stderr, "NaN/Inf en %s muestra %d\n", c.name.c_str(), i);
        return 2;
      }
    }
    writeWav(out + "/" + c.name + ".wav", L, R, sr);
    std::printf("ok %s\n", c.name.c_str());
  }
  return 0;
}
