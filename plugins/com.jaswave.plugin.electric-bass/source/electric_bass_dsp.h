#pragma once

#include "jw_dsp.h"
#include "jw_params.h"
#include <vector>
#include <cmath>
#include <algorithm>

namespace JasWaveElectricBass {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t {
    kTone = 0,
    kFingerAttack = 1,
    kDrive = 2,
    kLowBoost = 3,
    kCompressorMix = 4,
    kBypass = 5,
    kVolume = 6
};

enum Feature : int {
    kFeatDrive = 0
};

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(linearP(kTone, "Tone Cutoff", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(linearP(kFingerAttack, "Finger Attack", "%", 0.0, 100.0, 60.0, 0));
        v.push_back(withFeature(linearP(kDrive, "Tube Drive", "%", 0.0, 100.0, 20.0, 0), kFeatDrive));
        v.push_back(linearP(kLowBoost, "Sub Low Boost", "dB", 0.0, 12.0, 3.0, 1));
        v.push_back(linearP(kCompressorMix, "VCA Comp Mix", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kVolume, "Master Volume", "dB", -24.0, 6.0, 0.0, 1, true));
        return v;
    }();
    return defs;
}

struct BassSettings {
    double tonePct{50.0};
    double fingerAttackPct{60.0};
    double drivePct{20.0};
    double lowBoostDb{3.0};
    double compMixPct{50.0};
    bool bypass{false};
    double volumeDb{0.0};
};

constexpr int kMaxDelay = 8192;

struct BassVoice {
    bool active{false};
    int note{0};
    double vel{0.0};
    double f0{41.2};
    int delayLength{200};
    int writeIndex{0};
    float ringBuffer[kMaxDelay]{};
    double filterState{0.0};
    double releaseEnv{1.0};
    bool released{false};
};

constexpr int kMaxBassVoices = 8;

class ElectricBassEngine {
public:
    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        volSmooth_.prepare(sr_, 20.0);
        volSmooth_.reset(dbToLinear(settings_.volumeDb));
        compEnv_ = 0.0;
        reset();
    }

    void reset() {
        for (auto& v : voices_) {
            v.active = false;
            std::fill(v.ringBuffer, v.ringBuffer + kMaxDelay, 0.0f);
        }
    }

    void setSettings(const BassSettings& s) {
        settings_ = s;
        volSmooth_.setTarget(dbToLinear(s.volumeDb));
    }

    void noteOn(int note, double vel) {
        if (vel <= 0.0) {
            noteOff(note);
            return;
        }

        BassVoice* target = nullptr;
        for (int i = 0; i < kMaxBassVoices; ++i) {
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

        // Frecuencia fundamental del bajo (ej: E1 = 41.2 Hz)
        target->f0 = 440.0 * std::pow(2.0, (note - 69.0) / 12.0);
        int dLen = static_cast<int>(sr_ / target->f0);
        if (dLen < 8) dLen = 8;
        if (dLen >= kMaxDelay) dLen = kMaxDelay - 1;
        target->delayLength = dLen;
        target->writeIndex = 0;

        // Inicialización de la cuerda pulsada (ruido con ataque de dedo + impulso)
        const double attackBurst = 0.5 + (settings_.fingerAttackPct / 100.0) * 1.5;
        for (int i = 0; i < dLen; ++i) {
            const double phase = (2.0 * M_PI * i) / dLen;
            const double fundamental = std::sin(phase);
            const double noise = (((rand() % 1000) / 500.0) - 1.0) * 0.3 * attackBurst;
            target->ringBuffer[i] = static_cast<float>((fundamental + noise) * target->vel * 0.8);
        }
    }

    void noteOff(int note) {
        for (int i = 0; i < kMaxBassVoices; ++i) {
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

        const double toneCutoff = 0.1 + (settings_.tonePct / 100.0) * 0.85; // Coeficiente filtro pasa-bajos
        const double driveGain = 1.0 + (settings_.drivePct / 100.0) * 3.5;
        const double lowBoost = dbToLinear(settings_.lowBoostDb);
        const double compMix = settings_.compMixPct / 100.0;

        for (int s = 0; s < numSamples; ++s) {
            double sampleAcc = 0.0;
            const double masterGain = volSmooth_.next();

            for (int i = 0; i < kMaxBassVoices; ++i) {
                auto& v = voices_[i];
                if (!v.active) continue;

                // Lectura del retardo Karplus-Strong
                const int readIdx = v.writeIndex;
                const double currentSample = v.ringBuffer[readIdx];

                // Filtro pasa-bajos en el lazo de realimentación (amortiguación de cuerda)
                v.filterState = v.filterState * (1.0 - toneCutoff) + currentSample * toneCutoff;
                const double loopSample = v.filterState * 0.994;

                v.ringBuffer[v.writeIndex] = static_cast<float>(loopSample);
                v.writeIndex = (v.writeIndex + 1) % v.delayLength;

                if (v.released) {
                    v.releaseEnv *= 0.9992;
                    if (v.releaseEnv < 0.001) {
                        v.active = false;
                        continue;
                    }
                }

                sampleAcc += currentSample * v.releaseEnv;
            }

            // Realce de graves (Sub boost)
            sampleAcc *= lowBoost;

            // Saturación valvular tipo drive
            double driven = std::tanh(sampleAcc * driveGain);

            // Compresión VCA
            const double absVal = std::abs(driven);
            compEnv_ = compEnv_ * 0.998 + absVal * 0.002;
            double gr = 1.0;
            if (compEnv_ > 0.25) {
                gr = 1.0 / (1.0 + (compEnv_ - 0.25) * 2.0);
            }
            const double compressed = driven * gr;
            const double finalSample = (driven * (1.0 - compMix) + compressed * compMix) * masterGain;

            outL[s] = static_cast<float>(std::clamp(finalSample, -1.0, 1.0));
            outR[s] = static_cast<float>(std::clamp(finalSample, -1.0, 1.0));
        }
    }

private:
    double sr_{48000.0};
    BassSettings settings_{};
    SmoothParam volSmooth_{};
    BassVoice voices_[kMaxBassVoices]{};
    double compEnv_{0.0};
};

} // namespace JasWaveElectricBass
