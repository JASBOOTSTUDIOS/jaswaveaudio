#pragma once

#include "jw_dsp.h"
#include "jw_params.h"
#include <vector>
#include <cmath>
#include <algorithm>

namespace JasWaveStringsSection {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t {
    kExpression = 0,
    kVibratoDepth = 1,
    kAttackTime = 2,
    kReleaseTime = 3,
    kHallSize = 4,
    kBypass = 5,
    kVolume = 6
};

enum Feature : int {
    kFeatHall = 0
};

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(linearP(kExpression, "Expression Dynamics", "%", 0.0, 100.0, 75.0, 0));
        v.push_back(linearP(kVibratoDepth, "Vibrato Depth", "%", 0.0, 100.0, 35.0, 0));
        v.push_back(linearP(kAttackTime, "Bow Attack Time", "ms", 20.0, 1500.0, 180.0, 0));
        v.push_back(linearP(kReleaseTime, "Bow Release Time", "ms", 50.0, 3000.0, 500.0, 0));
        v.push_back(withFeature(linearP(kHallSize, "Concert Hall Size", "%", 0.0, 100.0, 65.0, 0), kFeatHall));
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kVolume, "Master Volume", "dB", -24.0, 6.0, 0.0, 1, true));
        return v;
    }();
    return defs;
}

struct StringsSettings {
    double expressionPct{75.0};
    double vibratoDepthPct{35.0};
    double attackMs{180.0};
    double releaseMs{500.0};
    double hallSizePct{65.0};
    bool bypass{false};
    double volumeDb{0.0};
};

struct StringVoice {
    bool active{false};
    int note{0};
    double vel{0.0};
    double f0{440.0};
    double phaseA{0.0};
    double phaseB{0.0};
    double vibratoPhase{0.0};
    double env{0.0};
    bool released{false};
    double filterState{0.0};
};

constexpr int kMaxStringVoices = 16;

class StringsSectionEngine {
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
        for (auto& v : voices_) v.active = false;
        revL_ = 0.0;
        revR_ = 0.0;
    }

    void setSettings(const StringsSettings& s) {
        settings_ = s;
        volSmooth_.setTarget(dbToLinear(s.volumeDb));
    }

    void noteOn(int note, double vel) {
        if (vel <= 0.0) {
            noteOff(note);
            return;
        }

        StringVoice* target = nullptr;
        for (int i = 0; i < kMaxStringVoices; ++i) {
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
        target->f0 = 440.0 * std::pow(2.0, (note - 69.0) / 12.0);
        target->phaseA = 0.0;
        target->phaseB = 0.0;
        target->vibratoPhase = (rand() % 100) * 0.0628;
        target->env = 0.0;
        target->filterState = 0.0;
    }

    void noteOff(int note) {
        for (int i = 0; i < kMaxStringVoices; ++i) {
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

        const double expr = 0.2 + (settings_.expressionPct / 100.0) * 0.8;
        const double vibDepth = (settings_.vibratoDepthPct / 100.0) * 0.02; // hasta 2% pitch mod
        const double attackRate = 1.0 / (std::max(0.02, settings_.attackMs * 0.001) * sr_);
        const double releaseRate = 1.0 / (std::max(0.05, settings_.releaseMs * 0.001) * sr_);
        const double hall = settings_.hallSizePct / 100.0;

        for (int s = 0; s < numSamples; ++s) {
            double dryL = 0.0;
            double dryR = 0.0;
            const double masterGain = volSmooth_.next();

            for (int i = 0; i < kMaxStringVoices; ++i) {
                auto& v = voices_[i];
                if (!v.active) continue;

                if (!v.released) {
                    v.env = std::min(1.0, v.env + attackRate);
                } else {
                    v.env = std::max(0.0, v.env - releaseRate);
                    if (v.env <= 0.0001) {
                        v.active = false;
                        continue;
                    }
                }

                // Vibrato natural a 5.3 Hz
                v.vibratoPhase += (2.0 * M_PI * 5.3) / sr_;
                if (v.vibratoPhase >= 2.0 * M_PI) v.vibratoPhase -= 2.0 * M_PI;
                const double pitchMod = 1.0 + std::sin(v.vibratoPhase) * vibDepth * v.env;

                // Ensamble unísono dual desfasado ligeramente
                const double curF_A = v.f0 * pitchMod * 0.9985;
                const double curF_B = v.f0 * pitchMod * 1.0015;

                v.phaseA += (2.0 * M_PI * curF_A) / sr_;
                if (v.phaseA >= 2.0 * M_PI) v.phaseA -= 2.0 * M_PI;
                v.phaseB += (2.0 * M_PI * curF_B) / sr_;
                if (v.phaseB >= 2.0 * M_PI) v.phaseB -= 2.0 * M_PI;

                const double sawA = (1.0 - (v.phaseA / M_PI));
                const double sawB = (1.0 - (v.phaseB / M_PI));

                // Caja de resonancia del instrumento frotado
                const double rawSignal = (sawA * 0.5 + sawB * 0.5);
                v.filterState = v.filterState * 0.65 + rawSignal * 0.35;

                const double voiceOut = v.filterState * v.env * v.vel * expr;
                dryL += voiceOut * 0.7;
                dryR += voiceOut * 0.75;
            }

            // Sala sinfónica (Hall reverb)
            revL_ = revL_ * 0.93 + dryL * hall * 0.25;
            revR_ = revR_ * 0.93 + dryR * hall * 0.25;

            const double outLeft = (dryL + revL_) * masterGain;
            const double outRight = (dryR + revR_) * masterGain;

            outL[s] = static_cast<float>(std::clamp(outLeft, -1.0, 1.0));
            outR[s] = static_cast<float>(std::clamp(outRight, -1.0, 1.0));
        }
    }

private:
    double sr_{48000.0};
    StringsSettings settings_{};
    SmoothParam volSmooth_{};
    StringVoice voices_[kMaxStringVoices]{};
    double revL_{0.0};
    double revR_{0.0};
};

} // namespace JasWaveStringsSection
