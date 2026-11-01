// Renderizador offline del JasWave Sampler (solo desarrollo): sampler_render <instrumento.jwi> <salida.wav> <patron> [sr]
// Patrones: piano | drums | bass | guitar | keys | chord
#include "../src/sampler_engine.h"
#include <cstdio>
#include <chrono>
using namespace JasWaveSampler;
struct Ev { double t; int p; float v; bool on; };
static void add(std::vector<Ev>& e, double t, double d, std::initializer_list<int> n, float v, double strum = 0) {
  double k = 0; for (int p : n) { e.push_back({ t + k, p, v, true }); e.push_back({ t + d + k, p, 0, false }); k += strum; }
}
static void writeWav(const char* path, const std::vector<float>& L, const std::vector<float>& R, int sr) {
  FILE* f = std::fopen(path, "wb"); if (!f) return;
  const uint32_t frames = static_cast<uint32_t>(L.size()), db = frames * 8;
  auto w32 = [&](uint32_t v) { std::fwrite(&v, 4, 1, f); }; auto w16 = [&](uint16_t v) { std::fwrite(&v, 2, 1, f); };
  std::fwrite("RIFF", 1, 4, f); w32(36 + db); std::fwrite("WAVEfmt ", 1, 8, f); w32(16); w16(3); w16(2); w32(sr); w32(sr * 8); w16(8); w16(32);
  std::fwrite("data", 1, 4, f); w32(db);
  for (uint32_t i = 0; i < frames; ++i) { std::fwrite(&L[i], 4, 1, f); std::fwrite(&R[i], 4, 1, f); }
  std::fclose(f);
}
int main(int argc, char** argv) {
  if (argc < 4) { std::fprintf(stderr, "uso: sampler_render <jwi> <wav> <patron> [sr]\n"); return 1; }
  const int sr = argc > 4 ? std::atoi(argv[4]) : 48000;
  const std::string pat = argv[3];
  SamplerEngine eng;
  eng.setPaths({ argv[1] });
  eng.prepare(sr);
  eng.setInstrumentIndex(0);
  eng.setHumanize(0.4f);
  eng.setReverb(0.15f, 2.4f, 0.45f, 18.f);
  const auto t0 = std::chrono::steady_clock::now();
  while (eng.loadState() != 2 && eng.loadState() != 3) std::this_thread::sleep_for(std::chrono::milliseconds(50));
  std::printf("carga: estado %d en %.1f s\n", eng.loadState(), std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count());
  if (eng.loadState() != 2) return 2;
  std::vector<Ev> ev;
  double secs = 10;
  if (pat == "piano") { add(ev, 0, 3, { 43, 55, 59, 62, 67 }, 0.7f); add(ev, 3.2, 3, { 40, 52, 59, 62, 67 }, 0.45f); for (int i = 0; i < 8; ++i) add(ev, 6.4 + i * 0.4, 1.0, { 72 + (i * 2) % 9 }, 0.4f + 0.05f * i); secs = 11; }
  else if (pat == "drums") { const double b = 60.0 / 72; for (int bar = 0; bar < 2; ++bar) { const double t0b = bar * 4 * b; add(ev, t0b, .2, { 36 }, .9f); add(ev, t0b + 1.5 * b, .2, { 36 }, .7f); add(ev, t0b + 2 * b, .2, { 36 }, .85f); add(ev, t0b + b, .2, { 38 }, .9f); add(ev, t0b + 3 * b, .2, { 38 }, .85f); for (int i = 0; i < 8; ++i) add(ev, t0b + i * .5 * b, .1, { 42 }, i % 2 ? .45f : .7f); } add(ev, 0, .2, { 49 }, .9f); add(ev, 6.7, .2, { 45 }, .8f); add(ev, 7.0, .2, { 43 }, .8f); add(ev, 7.3, .2, { 47 }, .8f); secs = 10; }
  else if (pat == "bass") { add(ev, 0, 1.6, { 43 }, .85f); add(ev, 1.7, 1.6, { 38 }, .8f); add(ev, 3.4, 1.6, { 40 }, .85f); add(ev, 5.1, 1.6, { 36 }, .8f); secs = 8; }
  else if (pat == "guitar") { add(ev, 0, 3.5, { 43, 50, 55, 59, 62, 67 }, .8f, 0.03); for (int i = 0; i < 8; ++i) add(ev, 4 + i * .5, 1.0, { i % 4 == 0 ? 43 : (i % 2 ? 59 : 62) }, .7f); secs = 9; }
  else { add(ev, 0, 3, { 52, 59, 62, 67 }, .7f); add(ev, 3.5, 3, { 48, 55, 62, 64 }, .7f); secs = 8; }
  std::sort(ev.begin(), ev.end(), [](const Ev& a, const Ev& b) { return a.t < b.t; });
  const int total = static_cast<int>(secs * sr) + sr * 3;
  std::vector<float> L(static_cast<size_t>(total)), R(static_cast<size_t>(total));
  size_t ei = 0; int pos = 0;
  const auto r0 = std::chrono::steady_clock::now();
  while (pos < total) {
    const int n = std::min(256, total - pos);
    while (ei < ev.size() && static_cast<int>(ev[ei].t * sr) < pos + n) { if (ev[ei].on) eng.noteOn(ev[ei].p, ev[ei].v, 0); else eng.noteOff(ev[ei].p, 0); ++ei; }
    eng.render(L.data() + pos, R.data() + pos, n); pos += n;
  }
  const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - r0).count();
  std::printf("render: %.1f s de audio en %.2f s (cpu %.1f%%)\n", total / double(sr), wall, 100 * wall / (total / double(sr)));
  writeWav(argv[2], L, R, sr);
  return 0;
}
