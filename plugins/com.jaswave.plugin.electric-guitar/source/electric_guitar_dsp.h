#pragma once

#include "jw_dsp.h"
#include "jw_params.h"
#include <vector>
#include <cmath>
#include <algorithm>

namespace JasWaveElectricGuitar {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t {
    kAmpGain = 0,
    kCabSim = 1,
    kTone = 2,
    kDelayFeedback = 3,
    kChorusMix = 4,
    kBypass = 5,
    kVolume = 6
};

enum Feature : int {
    kFeatCab = 0
};

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(linearP(kAmpGain, "Amp Gain", "%", 0.0, 100.0, 45.0, 0));
        v.push_back(withFeature(linearP(kCabSim, "4x12 Cab Sim", "%", 0.0, 100.0, 60.0, 0), kFeatCab));
        v.push_back(linearP(kTone, "Tone Presence", "%", 0.0, 100.0, 55.0, 0));
        v.push_back(linearP(kDelayFeedback, "Delay Feedback", "%", 0.0, 95.0, 30.0, 0));
        v.push_back(linearP(kChorusMix, "Chorus Mix", "%", 0.0, 100.0, 25.0, 0));
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kVolume, "Master Volume", "dB", -24.0, 6.0, 0.0, 1, true));
        return v;
    }();
    return defs;
}

struct GuitarSettings {
    double ampGainPct{45.0};
    double cabSimPct{60.0};
    double tonePct{55.0};
    double delayFbPct{30.0};
    double chorusMixPct{25.0};
    bool bypass{false};
    double volumeDb{0.0};
};

constexpr int kMaxGuitarDelay = 4096;
constexpr int kMaxFxDelay = 48000;

struct GuitarVoice {
    bool active{false};
    int note{0};
    double vel{0.0};
    double f0{110.0};
    int delayLength{200};
    int writeIndex{0};
    float ringBuffer[kMaxGuitarDelay]{};
    double filterState{0.0};
    double releaseEnv{1.0};
    bool released{false};
};

constexpr int kMaxGuitarVoices = 6;

class ElectricGuitarEngine {
public:
    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        volSmooth_.prepare(sr_, 20.0);
        volSmooth_.reset(dbToLinear(settings_.volumeDb));
        delayIndex_ = 0;
        chorusPhase_ = 0.0;
        cabFilterState_ = 0.0;
        reset();
    }

    void reset() {
        for (auto& v : voices_) {
            v.active = false;
            std::fill(v.ringBuffer, v.ringBuffer + kMaxGuitarDelay, 0.0f);
        }
        std::fill(delayBufferL_, delayBufferL_ + kMaxFxDelay, 0.0f);
        std::fill(delayBufferR_, delayBufferR_ + kMaxFxDelay, 0.0f);
        delayIndex_ = 0;
    }

    void setSettings(const GuitarSettings& s) {
        settings_ = s;
        volSmooth_.setTarget(dbToLinear(s.volumeDb));
    }

    void noteOn(int note, double vel) {
        if (vel <= 0.0) {
            noteOff(note);
            return;
        }

        GuitarVoice* target = nullptr;
        for (int i = 0; i < kMaxGuitarVoices; ++i) {
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
        target->releaseEnv = 1.0;
        target->filterState = 0.0;

        target->f0 = 440.0 * std::pow(2.0, (note - 69.0) / 12.0);
        int dLen = static_cast<int>(sr_ / target->f0);
        if (dLen < 6) dLen = 6;
        if (dLen >= kMaxGuitarDelay) dLen = kMaxGuitarDelay - 1;
        target->delayLength = dLen;
        target->writeIndex = 0;

        // Pulso de púa de guitarra con armónicos
        for (int i = 0; i < dLen; ++i) {
            const double phase = (2.0 * M_PI * i) / dLen;
            const double sawWave = (1.0 - (2.0 * i) / static_cast<double>(dLen));
            const double noise = (((rand() % 1000) / 500.0) - 1.0) * 0.4;
            target->ringBuffer[i] = static_cast<float>((sawWave * 0.6 + noise * 0.4) * target->vel);
        }
    }

    void noteOff(int note) {
        for (int i = 0; i < kMaxGuitarVoices; ++i) {
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

        const double gainMultiplier = 1.0 + (settings_.ampGainPct / 100.0) * 8.0;
        const double toneCoeff = 0.2 + (settings_.tonePct / 100.0) * 0.75;
        const double cabBlend = settings_.cabSimPct / 100.0;
        const double delayFb = (settings_.delayFeedbackPct / 100.0) * 0.85;
        const double chorusMix = settings_.chorusMixPct / 100.0;
        const int delayOffset = static_cast<int>(0.35 * sr_); // Delay 350 ms

        for (int s = 0; s < numSamples; ++s) {
            double rawGuitar = 0.0;
            const double masterGain = volSmooth_.next();

            for (int i = 0; i < kMaxGuitarVoices; ++i) {
                auto& v = voices_[i];
                if (!v.active) continue;

                const double currentSample = v.ringBuffer[v.writeIndex];

                // Filtro pasa-bajos de amortiguación
                v.filterState = v.filterState * 0.5 + currentSample * 0.5;
                const double loopSample = v.filterState * 0.995;

                v.ringBuffer[v.writeIndex] = static_cast<float>(loopSample);
                v.writeIndex = (v.writeIndex + 1) % v.delayLength;

                if (v.released) {
                    v.releaseEnv *= 0.9988;
                    if (v.releaseEnv < 0.001) {
                        v.active = false;
                        continue;
                    }
                }

                rawGuitar += currentSample * v.releaseEnv;
            }

            // Distorsión del amplificador de guitarra
            double driven = std::tanh(rawGuitar * gainMultiplier);

            // Simulación de pantalla (Cab sim: filtro pasa-bajos a 4.5 kHz para evitar agudos duros)
            cabFilterState_ = cabFilterState_ * (1.0 - toneCoeff * 0.8) + driven * (toneCoeff * 0.8);
            double cabOutput = driven * (1.0 - cabBlend) + cabFilterState_ * cabBlend;

            // Chorus LFO
            chorusPhase_ += (2.0 * M_PI * 1.5) / sr_; // 1.5 Hz LFO
            if (chorusPhase_ >= 2.0 * M_PI) chorusPhase_ -= 2.0 * M_PI;
            const double modOffset = (std::sin(chorusPhase_) * 0.5 + 0.5) * 0.005 * sr_; // 0 a 5 ms

            // Delay estéreo
            const int readPos = (delayIndex_ - delayOffset + kMaxFxDelay) % kMaxFxDelay;
            const double delayedL = delayBufferL_[readPos];
            const double delayedR = delayBufferR_[readPos];

            delayBufferL_[delayIndex_] = static_cast<float>(cabOutput + delayedL * delayFb);
            delayBufferR_[delayIndex_] = static_cast<float>(cabOutput + delayedR * delayFb * 0.95);
            delayIndex_ = (delayIndex_ + 1) % kMaxFxDelay;

            // Salida estéreo con chorus y delay
            const double outLeft = (cabOutput * (1.0 - chorusMix * 0.5) + delayedL * 0.4) * masterGain;
            const double outRight = (cabOutput * (1.0 - chorusMix * 0.5) + delayedR * 0.4 + std::sin(chorusPhase_) * cabOutput * chorusMix * 0.5) * masterGain;

            outL[s] = static_cast<float>(std::clamp(outLeft, -1.0, 1.0));
            outR[s] = static_cast<float>(std::clamp(outRight, -1.0, 1.0));
        }
    }

private:
    double sr_{48000.0};
    GuitarSettings settings_{};
    SmoothParam volSmooth_{};
    GuitarVoice voices_[kMaxGuitarVoices]{};
    float delayBufferL_[kMaxFxDelay]{};
    float delayBufferR_[kMaxFxDelay]{};
    int delayIndex_{0};
    double chorusPhase_{0.0};
    double cabFilterState_{0.0};
};

} // namespace JasWaveElectricGuitar
