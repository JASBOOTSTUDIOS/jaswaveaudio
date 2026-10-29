#pragma once
/**
 * Limitador true-peak del máster (modo Directo, K3).
 *
 * Detector 4x polifásico de plugins/shared-dsp (JasWaveDsp::TruePeak4x), mínimo deslizante de la ganancia
 * necesaria en una ventana corta (lookahead), ataque exponencial que converge dentro de la ventana, release
 * de ~60 ms y recorte final al techo como red de seguridad. Sin asignaciones en process(): todo son arrays
 * fijos. Lo usa el hilo de audio; los ajustes (techo, activo) llegan por atómicos desde el hilo de control.
 *
 * Retardo total: kDelay muestras (6 del detector + 63 de lookahead ≈ 1,4 ms a 48 kHz).
 */

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>

#include "jw_dsp.h"

namespace jaswave {

class MasterTruePeakLimiter {
public:
  static constexpr int kWindow = 64;
  static constexpr int kDetDelay = JasWaveDsp::TruePeak4x::kDelay;
  static constexpr int kDelay = kWindow + kDetDelay - 1;
  static constexpr int kBuf = 256;
  static_assert(kBuf > kDelay + 1, "ring mayor que el retardo");
  /** Margen interno por debajo del techo pedido: cubre la diferencia entre detectores 4x y 8x. */
  static constexpr float kMarginDb = 0.1f;

  MasterTruePeakLimiter() { reset(); }

  void setSampleRate(double sr) {
    sr_ = sr > 1000.0 ? sr : 48000.0;
    releaseK_ = static_cast<float>(1.0 - std::exp(-1.0 / (0.060 * sr_)));
  }
  /** Techo en dBTP (p. ej. -0.5). */
  void setCeilingDb(float db) {
    const float c = std::clamp(db, -24.f, 0.f) - kMarginDb;
    ceiling_.store(static_cast<float>(std::pow(10.0, c / 20.0)), std::memory_order_relaxed);
  }
  float ceilingLinear() const { return ceiling_.load(std::memory_order_relaxed); }
  int latencySamples() const { return kDelay; }

  void reset() {
    tpL_.reset();
    tpR_.reset();
    for (int i = 0; i < kBuf; ++i) {
      ringL_[i] = 0.f;
      ringR_[i] = 0.f;
    }
    w_ = 0;
    gain_ = 1.f;
    head_ = 0;
    count_ = 0;
    t_ = 0;
    blockMinGain_.store(1.f, std::memory_order_relaxed);
  }

  /** Reducción de ganancia del último bloque (lineal 0..1; 1 = sin actuar). */
  float lastBlockMinGain() const { return blockMinGain_.load(std::memory_order_relaxed); }

  /** Estéreo entrelazado in-place. */
  void process(float* interleaved, int frames) {
    const float ceiling = ceiling_.load(std::memory_order_relaxed);
    const float attackK = attackK_;
    const float releaseK = releaseK_;
    float minGain = 1.f;
    for (int i = 0; i < frames; ++i) {
      const float x = interleaved[i * 2];
      const float y = interleaved[i * 2 + 1];
      ringL_[w_] = x;
      ringR_[w_] = y;
      const float tp = std::max(tpL_.process(x), tpR_.process(y));
      const float need = tp > ceiling ? ceiling / tp : 1.f;
      const float m = pushMin(need);
      if (m < gain_) gain_ = m + (gain_ - m) * attackK;
      else gain_ += (m - gain_) * releaseK;
      if (gain_ < minGain) minGain = gain_;
      const int r = (w_ - kDelay) & (kBuf - 1);
      interleaved[i * 2] = std::clamp(ringL_[r] * gain_, -ceiling, ceiling);
      interleaved[i * 2 + 1] = std::clamp(ringR_[r] * gain_, -ceiling, ceiling);
      w_ = (w_ + 1) & (kBuf - 1);
    }
    blockMinGain_.store(minGain, std::memory_order_relaxed);
  }

private:
  /** Mínimo deslizante O(1) amortizado sobre arrays fijos (deque monótona). */
  float pushMin(float v) {
    while (count_ > 0 && val_[(head_ + count_ - 1) % kCap] >= v) --count_;
    const int pos = (head_ + count_) % kCap;
    idx_[pos] = t_;
    val_[pos] = v;
    ++count_;
    while (count_ > 0 && idx_[head_] <= t_ - kWindow) {
      head_ = (head_ + 1) % kCap;
      --count_;
    }
    ++t_;
    return val_[head_];
  }

  static constexpr int kCap = kWindow + 2;
  JasWaveDsp::TruePeak4x tpL_, tpR_;
  float ringL_[kBuf]{};
  float ringR_[kBuf]{};
  int w_{0};
  float gain_{1.f};
  int64_t idx_[kCap]{};
  float val_[kCap]{};
  int head_{0}, count_{0};
  int64_t t_{0};
  double sr_{48000.0};
  /** Converge al 99,96 % en kWindow-1 muestras: el pico sale ya atenuado. */
  const float attackK_{static_cast<float>(std::exp(-8.0 / kWindow))};
  float releaseK_{static_cast<float>(1.0 - std::exp(-1.0 / (0.060 * 48000.0)))};
  std::atomic<float> ceiling_{static_cast<float>(std::pow(10.0, (-0.5 - kMarginDb) / 20.0))};
  std::atomic<float> blockMinGain_{1.f};
};

}  // namespace jaswave
