#include "dsp.h"
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

using namespace JasWaveFx::dsp;

static int g_failures = 0;

#define TEST_CHECK(cond, msg)                                                   \
  do {                                                                          \
    if (!(cond)) {                                                              \
      std::printf("FAIL: %s (línea %d)\n", msg, __LINE__);                      \
      ++g_failures;                                                             \
    }                                                                           \
  } while (0)

// Magnitud de respuesta en frecuencia del biquad (coeficientes directos).
static float biquadMagDb(const Biquad& b, float freqHz, float sampleRate) {
  const float w = 2.f * 3.14159265358979323846f * freqHz / sampleRate;
  const float ej = std::cos(w);
  const float ej2 = std::cos(2.f * w);
  // H = (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2)
  float numR = b.b0 + b.b1 * ej + b.b2 * ej2;
  float numI = -(b.b1 * std::sin(w) + b.b2 * std::sin(2.f * w));
  float denR = 1.f + b.a1 * ej + b.a2 * ej2;
  float denI = -(b.a1 * std::sin(w) + b.a2 * std::sin(2.f * w));
  const float numM = std::sqrt(numR * numR + numI * numI);
  const float denM = std::sqrt(denR * denR + denI * denI);
  return 20.f * std::log10f(numM / std::max(1e-9f, denM));
}

int main() {
  const float sr = 48000.f;

  // ── 1. EQ: respuesta en frecuencia ──
  {
    // Low-pass 1 kHz: pasa graves, atenúa agudos.
    Biquad lp;
    lp.setSampleRate(sr);
    lp.setType(BiquadType::LowPass);
    lp.setFreq(1000.f);
    lp.setQ(0.7f);
    const float lpLow = biquadMagDb(lp, 200.f, sr);
    const float lpHigh = biquadMagDb(lp, 12000.f, sr);
    TEST_CHECK(lpLow > -3.f, "LPF pasa banda baja (~0 dB a 200 Hz)");
    TEST_CHECK(lpHigh < -15.f, "LPF atenúa agudos (< -15 dB a 12 kHz)");

    // Peak 1 kHz +12 dB Q=1: refuerza en 1 kHz, plano fuera.
    Biquad pk;
    pk.setSampleRate(sr);
    pk.setType(BiquadType::Peak);
    pk.setFreq(1000.f);
    pk.setGainDb(12.f);
    pk.setQ(1.f);
    const float pkC = biquadMagDb(pk, 1000.f, sr);
    const float pkSide = biquadMagDb(pk, 200.f, sr);
    TEST_CHECK(pkC > 10.f, "Peak +12 dB en 1 kHz (> 10 dB)");
    TEST_CHECK(std::fabs(pkSide) < 3.f, "Peak plano a los lados (~0 dB a 200 Hz)");

    // High-shelf +6 dB: refuerza agudos.
    Biquad hs;
    hs.setSampleRate(sr);
    hs.setType(BiquadType::HighShelf);
    hs.setFreq(2000.f);
    hs.setGainDb(6.f);
    const float hsHi = biquadMagDb(hs, 16000.f, sr);
    TEST_CHECK(hsHi > 4.f, "High-shelf +6 dB refuerza agudos (> 4 dB)");
  }

  // ── 2. Compresor: curva estática ──
  {
    Compressor c;
    c.setSampleRate(sr);
    c.thresholdDb = -20.f;   // dB
    c.ratio = 4.f;           // 4:1
    c.attackMs = 0.1f;       // muy rápido
    c.releaseMs = 0.1f;
    c.kneeDb = 0.f;
    c.makeupDb = 0.f;
    c.mix = 1.f;

    const float inDb = -10.f;            // 10 dB por encima del umbral
    const float inLin = dbToLinear(inDb);
    float out = 0.f;
    // Transitorio del seguidor: suficientes muestras para convergir.
    for (int i = 0; i < 5000; ++i) {
      out = inLin;
      c.process(out, out);
    }
    const float outDb = linearToDb(out);
    // Esperado: input -10 dB, umbral -20 dB, sobre 10 dB → GR = 10*(1-1/4)=7.5 dB
    // salida = -10 - 7.5 = -17.5 dB
    TEST_CHECK(std::fabs(outDb - (-17.5f)) < 1.5f, "Compresor 4:1 → salida ≈ -17.5 dB");

    // Ratio 1:1 → sin reducción.
    Compressor c2;
    c2.setSampleRate(sr);
    c2.thresholdDb = -20.f;
    c2.ratio = 1.f;
    c2.attackMs = 0.1f;
    c2.releaseMs = 0.1f;
    c2.kneeDb = 0.f;
    c2.makeupDb = 0.f;
    c2.mix = 1.f;
    out = inLin;
    c2.process(out, out);
    TEST_CHECK(std::fabs(linearToDb(out) - inDb) < 0.5f, "Compresor 1:1 → sin reducción");
  }

  // ── 3. Limitador: techo con señal que excede (incl. inter-sample pico) ──
  {
    Limiter lim;
    lim.setSampleRate(sr);
    lim.setCeilingDb(-6.f);   // techo ≈ 0.501 lineal
    lim.setInputGainDb(0.f);
    lim.setReleaseMs(5.f);    // seguimiento rápido
    lim.setLookaheadMs(0.f);

    // Señal constante 1.0 lineal → debe recortarse al techo.
    float l = 1.f, r = 1.f;
    float maxOut = 0.f;
    for (int i = 0; i < 4000; ++i) {
      lim.process(l, r);
      maxOut = std::max(maxOut, std::fabs(l));
    }
    const float ceilingLin = dbToLinear(-6.f);
    TEST_CHECK(maxOut <= ceilingLin * 1.08f, "Limitador no supera el techo (-6 dBTP)");
    TEST_CHECK(maxOut >= ceilingLin * 0.92f, "Limitador llega cerca del techo");

    // Inter-sample: pico entre muestras (subida empinada). Con 4× OS debe atenuarse.
    Limiter lim2;
    lim2.setSampleRate(sr);
    lim2.setCeilingDb(-6.f);
    lim2.setInputGainDb(0.f);
    lim2.setReleaseMs(2.f);
    lim2.setLookaheadMs(1.f);
    float peak = 0.f;
    // Seno cerca de Nyquist: los picos reales caen entre muestras.
    for (int i = 0; i < 4800; ++i) {
      const float t = static_cast<float>(i) / sr;
      const float s = std::sin(2.f * 3.14159265358979323846f * 22000.f * t) * 0.9f;
      l = s;
      r = s;
      lim2.process(l, r);
      peak = std::max(peak, std::fabs(l));
    }
    TEST_CHECK(peak <= ceilingLin * 1.15f, "Limitador controla picos inter-sample (~techo)");
  }

  if (g_failures == 0) {
    std::printf("OK: todos los tests de DSP pasaron\n");
    return 0;
  }
  std::printf("FAIL: %d test(s) fallaron\n", g_failures);
  return 1;
}
