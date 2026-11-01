/**
 * Selftest determinista del limitador true-peak del máster (K3).
 *   cmake --build build-release --config Release --target jaswave-host-selftest
 *   build-release/Release/jaswave-host-selftest.exe
 * Comprueba: seno a +6 dBFS sale <= -0,5 dBTP (detector 8x independiente), señal baja pasa intacta
 * (solo retardada kDelay muestras) y la ganancia vuelve a 1 tras el pico.
 */

#include <cmath>
#include <cstdio>
#include <vector>

#include "master_limiter.h"

namespace {

int gFallos = 0;

void comprobar(bool ok, const char* que, double valor) {
  if (ok) std::printf("  ok   %s (%.4f)\n", que, valor);
  else {
    std::printf("  FALLO %s (%.4f)\n", que, valor);
    ++gFallos;
  }
}

double dbtp(const std::vector<float>& inter, int desdeMuestra) {
  JasWaveDsp::TruePeak8x l, r;
  float pk = 0.f;
  const int n = static_cast<int>(inter.size() / 2);
  for (int i = 0; i < n; ++i) {
    const float a = l.process(inter[static_cast<size_t>(i) * 2]);
    const float b = r.process(inter[static_cast<size_t>(i) * 2 + 1]);
    if (i < desdeMuestra) continue;
    pk = std::max(pk, std::max(a, b));
  }
  return JasWaveDsp::linearToDb(pk);
}

}  // namespace

int main() {
  const double sr = 48000.0;
  const int n = 48000;
  const int bloque = 256;
  jaswave::MasterTruePeakLimiter lim;
  lim.setSampleRate(sr);
  lim.setCeilingDb(-0.5f);

  std::printf("[selftest] seno 997 Hz a +6 dBFS\n");
  const float amp = static_cast<float>(std::pow(10.0, 6.0 / 20.0));
  std::vector<float> seno(static_cast<size_t>(n) * 2);
  for (int i = 0; i < n; ++i) {
    const float v = amp * static_cast<float>(std::sin(2.0 * JasWaveDsp::kPi * 997.0 * i / sr));
    seno[static_cast<size_t>(i) * 2] = v;
    seno[static_cast<size_t>(i) * 2 + 1] = -v;
  }
  for (int i = 0; i < n; i += bloque) lim.process(seno.data() + static_cast<size_t>(i) * 2, std::min(bloque, n - i));
  const double tp = dbtp(seno, 48);
  comprobar(tp <= -0.5, "true-peak de salida <= -0.5 dBTP", tp);
  comprobar(tp > -1.5, "no atenua de mas (> -1.5 dBTP)", tp);
  float picoMuestra = 0.f;
  for (float v : seno) picoMuestra = std::max(picoMuestra, std::fabs(v));
  comprobar(JasWaveDsp::linearToDb(picoMuestra) <= -0.5, "pico de muestra <= -0.5 dBFS", JasWaveDsp::linearToDb(picoMuestra));
  comprobar(lim.lastBlockMinGain() < 0.6f, "reduccion de ganancia activa (~-6.6 dB)", lim.lastBlockMinGain());

  std::printf("[selftest] senal a -12 dBFS pasa intacta (solo retardo)\n");
  lim.reset();
  std::vector<float> baja(static_cast<size_t>(n) * 2);
  std::vector<float> original(static_cast<size_t>(n) * 2);
  for (int i = 0; i < n; ++i) {
    const float v = 0.25f * static_cast<float>(std::sin(2.0 * JasWaveDsp::kPi * 440.0 * i / sr));
    baja[static_cast<size_t>(i) * 2] = v;
    baja[static_cast<size_t>(i) * 2 + 1] = v * 0.5f;
  }
  original = baja;
  for (int i = 0; i < n; i += bloque) lim.process(baja.data() + static_cast<size_t>(i) * 2, std::min(bloque, n - i));
  const int d = lim.latencySamples();
  double maxErr = 0.0;
  for (int i = d; i < n; ++i) {
    maxErr = std::max(maxErr, std::fabs(static_cast<double>(baja[static_cast<size_t>(i) * 2]) - original[static_cast<size_t>(i - d) * 2]));
    maxErr = std::max(maxErr, std::fabs(static_cast<double>(baja[static_cast<size_t>(i) * 2 + 1]) - original[static_cast<size_t>(i - d) * 2 + 1]));
  }
  comprobar(maxErr < 1e-6, "error maximo frente a la entrada retardada", maxErr);
  comprobar(lim.lastBlockMinGain() > 0.999f, "ganancia 1 con senal baja", lim.lastBlockMinGain());

  std::printf("[selftest] release: tras un pico la ganancia vuelve a 1\n");
  lim.reset();
  std::vector<float> rafaga(static_cast<size_t>(n) * 2, 0.f);
  for (int i = 0; i < 4800; ++i) {
    const float v = amp * static_cast<float>(std::sin(2.0 * JasWaveDsp::kPi * 997.0 * i / sr));
    rafaga[static_cast<size_t>(i) * 2] = v;
    rafaga[static_cast<size_t>(i) * 2 + 1] = v;
  }
  for (int i = 0; i < n; i += bloque) lim.process(rafaga.data() + static_cast<size_t>(i) * 2, std::min(bloque, n - i));
  comprobar(lim.lastBlockMinGain() > 0.99f, "ganancia recuperada 0,9 s despues", lim.lastBlockMinGain());

  std::printf(gFallos ? "[selftest] %d fallo(s)\n" : "[selftest] todo en verde\n", gFallos);
  return gFallos ? 1 : 0;
}
