// =====================================================================================
//  JasWave Ambient Atmos - identificadores y especificacion de parametros (sin SDK VST3)
//  Una sola tabla (Spec) alimenta: paramDefs() (controlador/procesador/UI), el manifiesto y el motor.
//  Los IDs son estables: no reordenar ni reutilizar (proyectos y automatizacion los guardan).
// =====================================================================================
#pragma once

#include "jw_params.h"

#include <vector>

namespace JasWaveAmbientAtmos {

using namespace JasWaveVst;

enum : uint32_t {
    kPreset = 0,        // paso 0..N-1: banco + capa(s) + todos los demas valores (lo aplica el controlador)
    // --- macros del panel frontal ---
    kAttack = 1,        // A: de percusivo a swell de segundos
    kRelease = 2,       // R: hasta colas muy largas
    kFxMacro = 3,       // E/FX: profundidad coherente de eco + espacio + modulacion (50 % = el preset)
    kTune = 4,          // afinacion maestra
    kVolume = 5,
    // --- filtro / movimiento ---
    kCutoff = 6, kResonance = 7, kLfoRate = 8, kLfoDepth = 9, kLowCut = 10,
    // --- cuerpo ---
    kUnisonDetune = 11, kUnisonVoices = 12, kChorus = 13, kDrive = 14, kLayerBlend = 15,
    // --- tape delay ---
    kDelayMix = 16, kDelaySync = 17, kDelayTime = 18, kDelayFb = 19, kDelayTone = 20, kTapeAge = 21,
    // --- reverb / shimmer ---
    kReverbMix = 22, kReverbDecay = 23, kReverbDamp = 24, kReverbMod = 25, kReverbType = 26, kPreDelay = 27,
    kShimmer = 28, kShimmerInterval = 29,
    // --- EQ / salida ---
    kEqLow = 30, kEqLowMid = 31, kEqHighMid = 32, kEqHigh = 33, kComp = 34, kWidth = 35,
    // --- control ---
    kBypass = 36, kSustain = 37, kBend = 38, kModWheel = 39, kAftertouch = 40,
    kParamCount = 41
};

inline const char* const* labelsUnison() { static const char* const l[] = { "1", "2", "3" }; return l; }
inline const char* const* labelsSync() { static const char* const l[] = { "Free", "1/2", "1/4 dotted", "1/4", "1/8 dotted", "1/8" }; return l; }
inline const char* const* labelsRevType() { static const char* const l[] = { "Plate", "Hall" }; return l; }
inline const char* const* labelsShimInt() { static const char* const l[] = { "+12 st", "+7 st", "-12 st" }; return l; }

// Duracion en negras de cada division de sincronia (indice 0 = libre, usa Delay Time)
inline double syncBeats(int i) {
    static const double b[6] = { 0.0, 2.0, 1.5, 1.0, 0.75, 0.5 };
    return b[i < 0 ? 0 : (i > 5 ? 5 : i)];
}

struct Spec {
    uint32_t id;
    const char* name;
    const char* units;
    Map map;
    double mn, mx;
    int steps, dec;
    bool bip;
    const char* const* labels;
};

constexpr int kNumPresets = 40;      // 4 familias x 10 (ver ambient_atmos_presets.h)

inline const std::vector<Spec>& specs() {
    constexpr int numPresets = kNumPresets;
    static std::vector<Spec> v;
    if (!v.empty()) return v;
    auto lin = [&](uint32_t id, const char* n, const char* u, double a, double b, int dec, bool bip = false) {
        v.push_back({ id, n, u, Map::Linear, a, b, 0, dec, bip, nullptr });
    };
    auto lg = [&](uint32_t id, const char* n, const char* u, double a, double b, int dec) {
        v.push_back({ id, n, u, Map::Log, a, b, 0, dec, false, nullptr });
    };
    auto st = [&](uint32_t id, const char* n, int steps, const char* const* lab) {
        v.push_back({ id, n, "", Map::Stepped, 0, static_cast<double>(steps), steps, 0, false, lab });
    };
    v.push_back({ kPreset, "Preset", "", Map::Stepped, 0, static_cast<double>(numPresets - 1), numPresets - 1, 0, false, nullptr });   // etiquetas: ver paramDefs()
    lg(kAttack, "Attack", "s", 0.002, 10.0, 3);
    lg(kRelease, "Release", "s", 0.2, 16.0, 2);
    lin(kFxMacro, "FX Macro", "%", 0.0, 100.0, 0);
    lin(kTune, "Master Tune", "ct", -100.0, 100.0, 1, true);
    lin(kVolume, "Master Volume", "dB", -24.0, 6.0, 1, true);
    lg(kCutoff, "Filter Cutoff", "Hz", 200.0, 20000.0, 0);
    lin(kResonance, "Filter Resonance", "%", 0.0, 90.0, 0);
    lg(kLfoRate, "LFO Rate", "Hz", 0.02, 8.0, 2);
    lin(kLfoDepth, "LFO Depth", "%", 0.0, 100.0, 0);
    lg(kLowCut, "Low Cut", "Hz", 20.0, 400.0, 0);
    lin(kUnisonDetune, "Unison Detune", "%", 0.0, 100.0, 0);
    st(kUnisonVoices, "Unison Voices", 2, labelsUnison());
    lin(kChorus, "Ensemble Chorus", "%", 0.0, 100.0, 0);
    lin(kDrive, "Tape Drive", "%", 0.0, 100.0, 0);
    lin(kLayerBlend, "Layer B Blend", "%", 0.0, 100.0, 0);
    lin(kDelayMix, "Delay Mix", "%", 0.0, 100.0, 0);
    st(kDelaySync, "Delay Sync", 5, labelsSync());
    lg(kDelayTime, "Delay Time", "ms", 80.0, 1500.0, 0);
    lin(kDelayFb, "Delay Feedback", "%", 0.0, 92.0, 0);
    lg(kDelayTone, "Delay Tone", "Hz", 800.0, 9000.0, 0);
    lin(kTapeAge, "Tape Wow Flutter", "%", 0.0, 100.0, 0);
    lin(kReverbMix, "Reverb Mix", "%", 0.0, 100.0, 0);
    lg(kReverbDecay, "Reverb Decay", "s", 0.5, 30.0, 1);
    lin(kReverbDamp, "Reverb Damping", "%", 0.0, 100.0, 0);
    lin(kReverbMod, "Reverb Modulation", "%", 0.0, 100.0, 0);
    st(kReverbType, "Reverb Type", 1, labelsRevType());
    lin(kPreDelay, "Reverb Pre-delay", "ms", 0.0, 150.0, 0);
    lin(kShimmer, "Shimmer Amount", "%", 0.0, 100.0, 0);
    st(kShimmerInterval, "Shimmer Interval", 2, labelsShimInt());
    lin(kEqLow, "EQ Low Shelf 120Hz", "dB", -12.0, 12.0, 1, true);
    lin(kEqLowMid, "EQ Low-Mid 400Hz", "dB", -12.0, 12.0, 1, true);
    lin(kEqHighMid, "EQ High-Mid 3kHz", "dB", -12.0, 12.0, 1, true);
    lin(kEqHigh, "EQ High Shelf 9kHz", "dB", -12.0, 12.0, 1, true);
    lin(kComp, "Soft Compression", "%", 0.0, 100.0, 0);
    lin(kWidth, "Stereo Width", "%", 0.0, 150.0, 0);
    v.push_back({ kBypass, "Bypass", "", Map::Stepped, 0, 1, 1, 0, false, nullptr });   // se completa en paramDefs()
    v.push_back({ kSustain, "Sustain Pedal", "", Map::Stepped, 0, 1, 1, 0, false, nullptr });
    lin(kBend, "Pitch Bend", "st", -2.0, 2.0, 2, true);
    lin(kModWheel, "Mod Wheel", "%", 0.0, 100.0, 0);
    lin(kAftertouch, "Aftertouch", "%", 0.0, 100.0, 0);
    return v;
}

} // namespace JasWaveAmbientAtmos
