#pragma once

#include "jw_dsp.h"
#include "jw_params.h"
#include <vector>
#include <cmath>
#include <algorithm>

namespace JasWaveShimmerPad {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t {
    kCutoff = 0,
    kResonance = 1,
    kShimmerOctave = 2,
    kShimmerDecay = 3,
    kLfoRate = 4,
    kBypass = 5,
    kVolume = 6
};

enum Feature : int {
    kFeatShimmer = 0
};

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(logP(kCutoff, "Filter Cutoff", "Hz", 100.0, 12000.0, 2500.0, 0));
        v.push_back(linearP(kResonance, "Filter Resonance", "%", 0.0, 100.0, 20.0, 0));
        v.push_back(withFeature(linearP(kShimmerOctave, "Shimmer +12st", "%", 0.0, 100.0, 40.0, 0), kFeatShimmer));
        v.push_back(linearP(kShimmerDecay, "Shimmer Decay", "s", 0.5, 20.0, 4.5, 1));
        v.push_back(linearP(kLfoRate, "LFO Rate", "Hz", 0.1, 10.0, 1.2, 1));
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kVolume, "Master Volume", "dB", -24.0, 6.0, 0.0, 1, true));
        return v;
    }();
    return defs;
}

struct PadSettings {
    double cutoffHz{2500.0};
    double resonancePct{20.0};
    double shimmerOctavePct{40.0};
    double shimmerDecayS{4.5};
    double lfoRateHz{1.2};
    bool bypass{false};
    double volumeDb{0.0};
};

struct PadVoice {
    bool active{false};
    int note{0};
    double vel{0.0};
    double phase1{0.0};
    double phase2{0.0};
    double f1{440.0};
    double f2{441.5}; // Desafinación para ensanchar
    double env{0.0};
    bool released{false};
};

constexpr int kMaxPadVoices = 16;
constexpr int kShimmerBufLen = 32768;

class ShimmerPadEngine {
public:
    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        volSmooth_.prepare(sr_, 20.0);
        volSmooth_.reset(dbToLinear(settings_.volumeDb));
        lfoPhase_ = 0.0;
        filtLowL_ = 0.0;
        filtBandL_ = 0.0;
        filtLowR_ = 0.0;
        filtBandR_ = 0.0;
        shimmerWrite_ = 0;
        shimmerRead_ = 0.0;
        reset();
    }

    void reset() {
        for (auto& v : voices_) v.active = false;
        std::fill(shimmerBuf_, shimmerBuf_ + kShimmerBufLen, 0.0f);
        shimmerWrite_ = 0;
        shimmerRead_ = 0.0;
    }

    void setSettings(const PadSettings& s) {
        settings_ = s;
        volSmooth_.setTarget(dbToLinear(s.volumeDb));
    }

    void noteOn(int note, double vel) {
        if (vel <= 0.0) {
            noteOff(note);
            return;
        }

        PadVoice* target = nullptr;
        for (int i = 0; i < kMaxPadVoices; ++i) {
            if (!voices_[i].active) {
                target = &voices_[i];
                break;
            }
        }
        if (!target) target = &voices_[0];

        target->active = true;
        target->released = false;
        target->note = note;
        target->vel = std::clamp(vel, 0.1, 1.0);
        target->env = 0.0;

        const double baseF = 440.0 * std::pow(2.0, (note - 69.0) / 12.0);
        target->f1 = baseF * 0.998;
        target->f2 = baseF * 1.002;
    }

    void noteOff(int note) {
        for (int i = 0; i < kMaxPadVoices; ++i) {
            if (voices_[i].active && voices_[i].note == note) {
                voices_[i].released = true;
            }
        }
    }

    void render(float* outL, float* outR, int numSamples) {
        if (settings_.bypass) {
            std::fill(outL, outL + numSamples, 0.0f);
            std::fill(outR, outR + numSamples, 0.0f);
            return;
        }

        const double q = 0.5 + (settings_.resonancePct / 100.0) * 3.5;
        const double shimmerGain = settings_.shimmerOctavePct / 100.0;
        const double shimmerFb = std::clamp(std::exp(-1.0 / (settings_.shimmerDecayS * sr_ * 0.1)), 0.6, 0.96);

        for (int s = 0; s < numSamples; ++s) {
            // LFO
            lfoPhase_ += (2.0 * M_PI * settings_.lfoRateHz) / sr_;
            if (lfoPhase_ >= 2.0 * M_PI) lfoPhase_ -= 2.0 * M_PI;
            const double lfo = std::sin(lfoPhase_);

            // Frecuencia de corte modulada
            double curCutoff = settings_.cutoffHz * (1.0 + lfo * 0.25);
            curCutoff = std::clamp(curCutoff, 50.0, sr_ * 0.45);
            const double f = 2.0 * std::sin(M_PI * curCutoff / sr_);

            double voiceSumL = 0.0;
            double voiceSumR = 0.0;
            const double masterGain = volSmooth_.next();

            for (int i = 0; i < kMaxPadVoices; ++i) {
                auto& v = voices_[i];
                if (!v.active) continue;

                // Envolvente de pad suave (ataque 150 ms, release 800 ms)
                if (!v.released) {
                    v.env = std::min(1.0, v.env + (1.0 / (0.15 * sr_)));
                } else {
                    v.env = std::max(0.0, v.env - (1.0 / (0.80 * sr_)));
                    if (v.env <= 0.0001) {
                        v.active = false;
                        continue;
                    }
                }

                // Oscilador dual Sawtooth
                v.phase1 += (2.0 * M_PI * v.f1) / sr_;
                if (v.phase1 >= 2.0 * M_PI) v.phase1 -= 2.0 * M_PI;
                v.phase2 += (2.0 * M_PI * v.f2) / sr_;
                if (v.phase2 >= 2.0 * M_PI) v.phase2 -= 2.0 * M_PI;

                const double saw1 = (1.0 - (v.phase1 / M_PI));
                const double saw2 = (1.0 - (v.phase2 / M_PI));

                const double voiceSig = (saw1 * 0.5 + saw2 * 0.5) * v.env * v.vel;
                voiceSumL += voiceSig * 0.8;
                voiceSumR += voiceSig * 0.8;
            }

            // Filtro SVF pasa-bajos estéreo
            filtLowL_ += f * filtBandL_;
            const double highL = voiceSumL - filtLowL_ - (1.0 / q) * filtBandL_;
            filtBandL_ += f * highL;

            filtLowR_ += f * filtBandR_;
            const double highR = voiceSumR - filtLowR_ - (1.0 / q) * filtBandR_;
            filtBandR_ += f * highR;

            // Motor Shimmer (lectura a doble velocidad = +1 octava)
            shimmerRead_ += 2.0;
            if (shimmerRead_ >= kShimmerBufLen) shimmerRead_ -= kShimmerBufLen;
            const int readIdx = static_cast<int>(shimmerRead_);
            const double shimmerSample = shimmerBuf_[readIdx];

            const double monoInput = (filtLowL_ + filtLowR_) * 0.5;
            shimmerBuf_[shimmerWrite_] = static_cast<float>(monoInput + shimmerSample * shimmerFb);
            shimmerWrite_ = (shimmerWrite_ + 1) % kShimmerBufLen;

            const double outLeft = (filtLowL_ + shimmerSample * shimmerGain * 0.5) * masterGain;
            const double outRight = (filtLowR_ + shimmerSample * shimmerGain * 0.5) * masterGain;

            outL[s] = static_cast<float>(std::clamp(outLeft, -1.0, 1.0));
            outR[s] = static_cast<float>(std::clamp(outRight, -1.0, 1.0));
        }
    }

private:
    double sr_{48000.0};
    PadSettings settings_{};
    SmoothParam volSmooth_{};
    PadVoice voices_[kMaxPadVoices]{};
    double lfoPhase_{0.0};
    double filtLowL_{0.0};
    double filtBandL_{0.0};
    double filtLowR_{0.0};
    double filtBandR_{0.0};
    float shimmerBuf_[kShimmerBufLen]{};
    int shimmerWrite_{0};
    double shimmerRead_{0.0};
};

} // namespace JasWaveShimmerPad
