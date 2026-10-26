#pragma once

#include "jw_dsp.h"
#include "jw_params.h"
#include <vector>
#include <cmath>
#include <algorithm>

namespace JasWaveGrandPiano {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t {
    kAttack = 0,
    kDecay = 1,
    kRelease = 2,
    kVelocityCurve = 3,
    kBrightness = 4,
    kReverbSend = 5,
    kBypass = 6,
    kVolume = 7
};

enum Feature : int {
    kFeatPolyphony = 0,
    kFeatReverb = 1
};

constexpr int kMaxVoices = 64;
constexpr int kBasicVoices = 16;
constexpr int kMaxPartials = 16;

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(linearP(kAttack, "Hammer Attack", "ms", 0.5, 50.0, 2.0, 1));
        v.push_back(linearP(kDecay, "Harmonic Decay", "%", 0.0, 100.0, 70.0, 0));
        v.push_back(linearP(kRelease, "Damper Release", "s", 0.05, 5.0, 0.6, 2));
        v.push_back(linearP(kVelocityCurve, "Velocity Response", "%", 0.0, 100.0, 70.0, 0));
        v.push_back(linearP(kBrightness, "String Brightness", "%", 0.0, 100.0, 60.0, 0));
        v.push_back(withFeature(linearP(kReverbSend, "Hall Reverb Send", "%", 0.0, 100.0, 25.0, 0), kFeatReverb));
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kVolume, "Master Volume", "dB", -24.0, 6.0, 0.0, 1, true));
        return v;
    }();
    return defs;
}

struct GrandPianoSettings {
    double attackMs{2.0};
    double decayPct{70.0};
    double releaseS{0.6};
    double velCurvePct{70.0};
    double brightnessPct{60.0};
    double reverbSendPct{25.0};
    bool bypass{false};
    double volumeDb{0.0};
    int maxVoices{kMaxVoices};
};

struct PianoVoice {
    bool active{false};
    int note{0};
    double vel{0.0};
    double f0{440.0};
    double phase[kMaxPartials]{};
    double amp[kMaxPartials]{};
    double decayCoeff[kMaxPartials]{};
    double env{0.0};
    double envAttackRate{0.01};
    double envReleaseRate{0.005};
    bool released{false};
    int age{0};
};

class GrandPianoEngine {
public:
    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        volSmooth_.prepare(sr_, 20.0);
        volSmooth_.reset(dbToLinear(settings_.volumeDb));
        revL_ = 0.0;
        revR_ = 0.0;
        reset();
    }

    void reset() {
        for (auto& v : voices_) {
            v.active = false;
        }
        noteAge_ = 0;
    }

    void setSettings(const GrandPianoSettings& s) {
        settings_ = s;
        volSmooth_.setTarget(dbToLinear(s.volumeDb));
    }

    void noteOn(int note, double vel) {
        if (vel <= 0.0) {
            noteOff(note);
            return;
        }

        PianoVoice* target = nullptr;
        int maxAge = -1;
        int activeCount = 0;

        for (int i = 0; i < settings_.maxVoices && i < kMaxVoices; ++i) {
            if (!voices_[i].active) {
                target = &voices_[i];
                break;
            }
            activeCount++;
            if (voices_[i].released && voices_[i].age > maxAge) {
                maxAge = voices_[i].age;
                target = &voices_[i];
            }
        }

        if (!target && activeCount > 0) {
            // Robo de voz más antigua
            int oldestAge = -1;
            for (int i = 0; i < settings_.maxVoices && i < kMaxVoices; ++i) {
                if (voices_[i].age > oldestAge) {
                    oldestAge = voices_[i].age;
                    target = &voices_[i];
                }
            }
        }

        if (!target) return;

        target->active = true;
        target->released = false;
        target->note = note;
        target->age = ++noteAge_;

        // Curva de velocidad no lineal
        const double vNorm = std::clamp(vel, 0.01, 1.0);
        const double vExponent = 1.0 + (settings_.velCurvePct / 100.0) * 1.5;
        target->vel = std::pow(vNorm, vExponent);

        // Frecuencia fundamental afinada en A440
        target->f0 = 440.0 * std::pow(2.0, (note - 69.0) / 12.0);

        // Ataque y relajación
        const double attackSec = std::max(0.0005, settings_.attackMs * 0.001);
        target->envAttackRate = 1.0 / (attackSec * sr_);
        const double releaseSec = std::max(0.02, settings_.releaseS);
        target->envReleaseRate = 1.0 / (releaseSec * sr_);
        target->env = 0.0;

        // Cálculo de parciales armónicos con inarmonicidad de piano B=0.0004
        const double B = 0.0004;
        const double decayScale = 0.2 + (settings_.decayPct / 100.0) * 1.8;
        const double brightScale = 0.3 + (settings_.brightnessPct / 100.0) * 1.2;

        for (int p = 0; p < kMaxPartials; ++p) {
            const double k = p + 1;
            const double partialFreq = k * target->f0 * std::sqrt((1.0 + B * k * k) / (1.0 + B));
            if (partialFreq > sr_ * 0.48) {
                target->amp[p] = 0.0;
                continue;
            }
            target->phase[p] = 0.0;

            // Amplitud espectral dependiente del brillo y martillo
            const double harmonicFalloff = 1.0 / std::pow(k, 1.15);
            const double brightBoost = std::pow(brightScale, k * 0.25);
            target->amp[p] = target->vel * harmonicFalloff * brightBoost;

            // Decaimiento natural: los armónicos agudos se amortiguan más rápido
            const double t60 = (12.0 / std::sqrt(target->f0)) * (1.0 / (1.0 + k * 0.35)) * decayScale;
            target->decayCoeff[p] = std::exp(-6.91 / (std::max(0.05, t60) * sr_));
        }
    }

    void noteOff(int note) {
        for (int i = 0; i < settings_.maxVoices && i < kMaxVoices; ++i) {
            if (voices_[i].active && voices_[i].note == note && !voices_[i].released) {
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

        const double revSend = settings_.reverbSendPct / 100.0;
        const double revFeedback = 0.85;

        for (int s = 0; s < numSamples; ++s) {
            double sampleAcc = 0.0;
            const double masterGain = volSmooth_.next();

            for (int i = 0; i < settings_.maxVoices && i < kMaxVoices; ++i) {
                auto& v = voices_[i];
                if (!v.active) continue;

                // Envolvente general
                if (!v.released) {
                    v.env = std::min(1.0, v.env + v.envAttackRate);
                } else {
                    v.env = std::max(0.0, v.env - v.envReleaseRate);
                    if (v.env <= 0.0001) {
                        v.active = false;
                        continue;
                    }
                }

                double voiceSum = 0.0;
                for (int p = 0; p < kMaxPartials; ++p) {
                    if (v.amp[p] <= 0.00001) continue;
                    voiceSum += std::sin(v.phase[p]) * v.amp[p];

                    const double k = p + 1;
                    const double B = 0.0004;
                    const double f = k * v.f0 * std::sqrt((1.0 + B * k * k) / (1.0 + B));
                    v.phase[p] += (2.0 * M_PI * f) / sr_;
                    if (v.phase[p] >= 2.0 * M_PI) v.phase[p] -= 2.0 * M_PI;

                    v.amp[p] *= v.decayCoeff[p];
                }

                sampleAcc += voiceSum * v.env;
            }

            // Reverberación hall simple con filtro en retroalimentación
            revL_ = revL_ * revFeedback + sampleAcc * revSend * 0.3;
            revR_ = revR_ * revFeedback + sampleAcc * revSend * 0.28;

            const double outLeft = (sampleAcc * 0.2 + revL_) * masterGain;
            const double outRight = (sampleAcc * 0.2 + revR_) * masterGain;

            outL[s] = static_cast<float>(std::clamp(outLeft, -1.0, 1.0));
            outR[s] = static_cast<float>(std::clamp(outRight, -1.0, 1.0));
        }
    }

private:
    double sr_{48000.0};
    GrandPianoSettings settings_{};
    SmoothParam volSmooth_{};
    PianoVoice voices_[kMaxVoices]{};
    int noteAge_{0};
    double revL_{0.0};
    double revR_{0.0};
};

} // namespace JasWaveGrandPiano
