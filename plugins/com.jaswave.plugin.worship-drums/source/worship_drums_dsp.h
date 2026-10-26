#pragma once

#include "jw_dsp.h"
#include "jw_params.h"
#include <vector>
#include <cmath>
#include <algorithm>

namespace JasWaveWorshipDrums {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t {
    kKickTune = 0,
    kSnareSnap = 1,
    kTomsDamp = 2,
    kOverheadAir = 3,
    kRoomBlend = 4,
    kBypass = 5,
    kVolume = 6
};

enum Feature : int {
    kFeatRoom = 0
};

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(linearP(kKickTune, "Kick Tuning", "Hz", 35.0, 90.0, 55.0, 1));
        v.push_back(linearP(kSnareSnap, "Snare Snap", "%", 0.0, 100.0, 65.0, 0));
        v.push_back(linearP(kTomsDamp, "Toms Damping", "%", 0.0, 100.0, 50.0, 0));
        v.push_back(linearP(kOverheadAir, "Overhead Air", "%", 0.0, 100.0, 70.0, 0));
        v.push_back(withFeature(linearP(kRoomBlend, "Room Blend", "%", 0.0, 100.0, 35.0, 0), kFeatRoom));
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kVolume, "Master Volume", "dB", -24.0, 6.0, 0.0, 1, true));
        return v;
    }();
    return defs;
}

struct DrumSettings {
    double kickTuneHz{55.0};
    double snareSnapPct{65.0};
    double tomsDampPct{50.0};
    double overheadAirPct{70.0};
    double roomBlendPct{35.0};
    bool bypass{false};
    double volumeDb{0.0};
};

struct DrumVoice {
    bool active{false};
    int type{0}; // 0: kick, 1: snare, 2: tom, 3: cymbal/hihat
    double vel{0.0};
    double phase{0.0};
    double phase2{0.0};
    double freq{60.0};
    double baseFreq{60.0};
    double pitchEnv{0.0};
    double ampEnv{0.0};
    double ampDecay{0.999};
    double pitchDecay{0.95};
    double noiseAmp{0.0};
    double noiseDecay{0.99};
    double pan{0.0}; // -1 left, +1 right
};

constexpr int kMaxDrumVoices = 16;

class WorshipDrumsEngine {
public:
    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        volSmooth_.prepare(sr_, 20.0);
        volSmooth_.reset(dbToLinear(settings_.volumeDb));
        revL_ = 0.0;
        revR_ = 0.0;
        noiseSeed_ = 1234567;
        reset();
    }

    void reset() {
        for (auto& v : voices_) v.active = false;
        revL_ = 0.0;
        revR_ = 0.0;
    }

    void setSettings(const DrumSettings& s) {
        settings_ = s;
        volSmooth_.setTarget(dbToLinear(s.volumeDb));
    }

    void noteOn(int note, double vel) {
        if (vel <= 0.0) return;
        const double v = std::clamp(vel, 0.05, 1.0);

        DrumVoice* target = nullptr;
        for (int i = 0; i < kMaxDrumVoices; ++i) {
            if (!voices_[i].active) {
                target = &voices_[i];
                break;
            }
        }
        if (!target) target = &voices_[0];

        target->active = true;
        target->vel = v;
        target->phase = 0.0;
        target->phase2 = 0.0;
        target->ampEnv = 1.0;

        // Clasificación General MIDI
        if (note == 35 || note == 36) {
            // Kick
            target->type = 0;
            target->pan = 0.0;
            target->baseFreq = settings_.kickTuneHz;
            target->freq = target->baseFreq * 2.8;
            target->pitchEnv = 1.0;
            target->pitchDecay = std::exp(-1.0 / (0.035 * sr_));
            target->ampDecay = std::exp(-1.0 / (0.35 * sr_));
            target->noiseAmp = 0.3 * v;
            target->noiseDecay = std::exp(-1.0 / (0.012 * sr_));
        } else if (note == 38 || note == 40 || note == 37) {
            // Snare / Rim
            target->type = 1;
            target->pan = -0.1;
            target->baseFreq = 185.0;
            target->freq = 185.0;
            target->pitchEnv = 0.3;
            target->pitchDecay = std::exp(-1.0 / (0.02 * sr_));
            target->ampDecay = std::exp(-1.0 / (0.22 * sr_));
            target->noiseAmp = (0.4 + (settings_.snareSnapPct / 100.0) * 0.6) * v;
            target->noiseDecay = std::exp(-1.0 / ((0.15 + (settings_.snareSnapPct / 100.0) * 0.15) * sr_));
        } else if (note == 41 || note == 43 || note == 45 || note == 47 || note == 48 || note == 50) {
            // Toms
            target->type = 2;
            const double damp = 0.5 + (settings_.tomsDampPct / 100.0) * 1.5;
            if (note <= 43) {
                target->baseFreq = 85.0; target->pan = 0.3;
            } else if (note <= 47) {
                target->baseFreq = 120.0; target->pan = -0.2;
            } else {
                target->baseFreq = 160.0; target->pan = 0.2;
            }
            target->freq = target->baseFreq * 1.4;
            target->pitchEnv = 0.4;
            target->pitchDecay = std::exp(-1.0 / (0.05 * sr_));
            target->ampDecay = std::exp(-1.0 / ((0.4 / damp) * sr_));
            target->noiseAmp = 0.1 * v;
            target->noiseDecay = std::exp(-1.0 / (0.015 * sr_));
        } else {
            // Hi-Hats y Platillos
            target->type = 3;
            const bool isOpen = (note == 46 || note == 49 || note == 51);
            target->pan = (note == 49) ? -0.4 : ((note == 51) ? 0.4 : -0.3);
            target->baseFreq = 3500.0;
            target->freq = 3500.0;
            target->pitchEnv = 0.0;
            target->ampDecay = std::exp(-1.0 / ((isOpen ? 0.75 : 0.08) * sr_));
            const double air = 0.4 + (settings_.overheadAirPct / 100.0) * 0.6;
            target->noiseAmp = air * v;
            target->noiseDecay = target->ampDecay;
        }
    }

    void render(float* outL, float* outR, int numSamples) {
        if (settings_.bypass) {
            std::fill(outL, outL + numSamples, 0.0f);
            std::fill(outR, outR + numSamples, 0.0f);
            return;
        }

        const double room = settings_.roomBlendPct / 100.0;

        for (int s = 0; s < numSamples; ++s) {
            double dryL = 0.0;
            double dryR = 0.0;
            const double masterGain = volSmooth_.next();

            for (int i = 0; i < kMaxDrumVoices; ++i) {
                auto& v = voices_[i];
                if (!v.active) continue;

                // Generador de ruido pseudoaleatorio rápido
                noiseSeed_ = (noiseSeed_ * 196314165 + 907633515) & 0x7FFFFFFF;
                const double whiteNoise = ((noiseSeed_ / static_cast<double>(0x7FFFFFFF)) * 2.0 - 1.0);

                double voiceSample = 0.0;

                if (v.type == 0) {
                    // Kick
                    const double currentF = v.baseFreq + (v.freq - v.baseFreq) * v.pitchEnv;
                    v.phase += (2.0 * M_PI * currentF) / sr_;
                    if (v.phase >= 2.0 * M_PI) v.phase -= 2.0 * M_PI;
                    voiceSample = (std::sin(v.phase) + std::tanh(std::sin(v.phase) * 1.5) * 0.3) * v.ampEnv * v.vel;
                    voiceSample += whiteNoise * v.noiseAmp;

                    v.pitchEnv *= v.pitchDecay;
                    v.ampEnv *= v.ampDecay;
                    v.noiseAmp *= v.noiseDecay;
                } else if (v.type == 1) {
                    // Snare
                    v.phase += (2.0 * M_PI * v.freq) / sr_;
                    if (v.phase >= 2.0 * M_PI) v.phase -= 2.0 * M_PI;
                    const double body = std::sin(v.phase) * v.ampEnv * 0.4;
                    const double snares = whiteNoise * v.noiseAmp;
                    voiceSample = (body + snares) * v.vel;

                    v.ampEnv *= v.ampDecay;
                    v.noiseAmp *= v.noiseDecay;
                } else if (v.type == 2) {
                    // Tom
                    const double currentF = v.baseFreq + (v.freq - v.baseFreq) * v.pitchEnv;
                    v.phase += (2.0 * M_PI * currentF) / sr_;
                    if (v.phase >= 2.0 * M_PI) v.phase -= 2.0 * M_PI;
                    voiceSample = (std::sin(v.phase) * 0.8 + whiteNoise * v.noiseAmp) * v.ampEnv * v.vel;

                    v.pitchEnv *= v.pitchDecay;
                    v.ampEnv *= v.ampDecay;
                    v.noiseAmp *= v.noiseDecay;
                } else {
                    // Cymbals / Hi-hat (ruido filtrado)
                    voiceSample = whiteNoise * v.noiseAmp * v.vel * 0.7;
                    v.noiseAmp *= v.noiseDecay;
                    v.ampEnv *= v.ampDecay;
                }

                if (v.ampEnv < 0.0001 && v.noiseAmp < 0.0001) {
                    v.active = false;
                    continue;
                }

                const double panL = std::cos((v.pan + 1.0) * M_PI * 0.25);
                const double panR = std::sin((v.pan + 1.0) * M_PI * 0.25);

                dryL += voiceSample * panL;
                dryR += voiceSample * panR;
            }

            // Sala worship con difusión estéreo
            revL_ = revL_ * 0.91 + (dryL + dryR * 0.3) * room * 0.2;
            revR_ = revR_ * 0.91 + (dryR + dryL * 0.3) * room * 0.2;

            const double outLeft = (dryL + revL_) * masterGain;
            const double outRight = (dryR + revR_) * masterGain;

            outL[s] = static_cast<float>(std::clamp(outLeft, -1.0, 1.0));
            outR[s] = static_cast<float>(std::clamp(outRight, -1.0, 1.0));
        }
    }

private:
    double sr_{48000.0};
    DrumSettings settings_{};
    SmoothParam volSmooth_{};
    DrumVoice voices_[kMaxDrumVoices]{};
    uint32_t noiseSeed_{1234567};
    double revL_{0.0};
    double revR_{0.0};
};

} // namespace JasWaveWorshipDrums
