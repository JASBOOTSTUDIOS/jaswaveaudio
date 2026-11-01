// =====================================================================================
//  JasWave Ambient Atmos - presets de fabrica (40, en 4 familias de 10) y paramDefs()
//  Cada preset fija banco/capa(s) + el valor de TODOS los parametros (el controlador los aplica al elegirlo).
//  Los nombres son propios (no proceden de ninguna libreria comercial). El preset 0 es el valor por defecto del
//  plugin: sin tocar nada suena ambiental, ancho, calido y bonito.
// =====================================================================================
#pragma once

#include "ambient_atmos_params.h"
#include "jw_fxrack.h"

#include <array>
#include <cstring>

namespace JasWaveAmbientAtmos {

enum Family : int { kFamGuitar = 0, kFamPads = 1, kFamTextures = 2, kFamDesign = 3 };

// Capas de cada banco (grupo de zona en el .jws):
//   guitar   : 0 dreamy | 1 octava sutil | 2 quinta+octava | 3 rasgada saturada
//   pads     : 0 coro vocal | 1 new age | 2 barrido | 3 arco | 4 cuerdas etereas
//   textures : 0 aire | 1 viento | 2 presion | 3 dron de cuerdas | 4 olas | 5 nube armonica
//              6 riser | 7 downlifter | 8 shimmer cloud | 9 guitarra inversa    (familia "Sound design")
inline const char* bankSlug(int family) {
    switch (family) {
        case kFamGuitar: return "ambient-atmos-guitar";
        case kFamPads: return "ambient-atmos-pads";
        default: return "ambient-atmos-textures";
    }
}
inline int bankIndex(int family) { return family == kFamGuitar ? 0 : (family == kFamPads ? 1 : 2); }
inline const char* familyName(int family) {
    static const char* const n[4] = { "Guitarras cinematicas", "Pads evolutivos", "Texturas y atmosferas", "Sound design" };
    return n[family < 0 ? 0 : (family > 3 ? 3 : family)];
}

struct Preset {
    const char* name;
    int family, layerA, layerB;       // layerB < 0: sin segunda capa
    double p[kParamCount];            // valores planos de todos los parametros (kPreset y control se ignoran)
};

struct PB {
    Preset pr;
    PB(const char* name, int fam, int a, int b = -1) {
        pr.name = name; pr.family = fam; pr.layerA = a; pr.layerB = b;
        double* p = pr.p;
        for (int i = 0; i < kParamCount; ++i) p[i] = 0.0;
        p[kAttack] = 1.5; p[kRelease] = 6.0; p[kFxMacro] = 50.0; p[kTune] = 0.0; p[kVolume] = 0.0;
        p[kCutoff] = 8000.0; p[kResonance] = 8.0; p[kLfoRate] = 0.12; p[kLfoDepth] = 18.0; p[kLowCut] = 70.0;
        p[kUnisonDetune] = 35.0; p[kUnisonVoices] = 1; p[kChorus] = 30.0; p[kDrive] = 15.0; p[kLayerBlend] = b >= 0 ? 35.0 : 0.0;
        p[kDelayMix] = 24.0; p[kDelaySync] = 2; p[kDelayTime] = 520.0; p[kDelayFb] = 45.0; p[kDelayTone] = 3600.0; p[kTapeAge] = 25.0;
        p[kReverbMix] = 38.0; p[kReverbDecay] = 8.0; p[kReverbDamp] = 60.0; p[kReverbMod] = 40.0; p[kReverbType] = 1; p[kPreDelay] = 25.0;
        p[kShimmer] = 18.0; p[kShimmerInterval] = 0;
        p[kEqLow] = 0.0; p[kEqLowMid] = 0.0; p[kEqHighMid] = 0.0; p[kEqHigh] = 0.0; p[kComp] = 30.0; p[kWidth] = 115.0;
        p[kBypass] = 0; p[kSustain] = 0; p[kBend] = 0.0; p[kModWheel] = 0.0; p[kAftertouch] = 0.0; p[kPreset] = 0.0;
    }
    PB& s(uint32_t id, double v) { pr.p[id] = v; return *this; }
};

// Sync: 0 libre, 1 1/2, 2 1/4 con puntillo, 3 1/4, 4 1/8 con puntillo, 5 1/8. Tipo reverb: 0 plate, 1 hall.
inline const std::array<Preset, kNumPresets>& presets() {
    static const std::array<Preset, kNumPresets> list = [] {
        std::array<Preset, kNumPresets> a{};
        int i = 0;
        auto add = [&](const PB& b) { a[static_cast<size_t>(i++)] = b.pr; };

        // ---------------- Guitarras cinematicas (banco guitar) ----------------
        add(PB("Luz de Madrugada", kFamGuitar, 1).s(kAttack, 1.8).s(kRelease, 7.0).s(kUnisonVoices, 1).s(kDelayMix, 32).s(kDelaySync, 4).s(kDelayFb, 52)
              .s(kReverbMix, 40).s(kReverbDecay, 9.0).s(kShimmer, 24).s(kCutoff, 7500));
        add(PB("Dream Tide", kFamGuitar, 0).s(kAttack, 0.9).s(kRelease, 6.0).s(kDelayMix, 38).s(kDelaySync, 2).s(kDelayFb, 56)
              .s(kReverbType, 0).s(kReverbDecay, 6.0).s(kReverbMix, 36).s(kShimmer, 10).s(kChorus, 40));
        add(PB("Ceniza y Cielo", kFamGuitar, 2).s(kAttack, 3.0).s(kRelease, 10.0).s(kDelayMix, 26).s(kDelaySync, 3).s(kDelayFb, 48)
              .s(kReverbDecay, 12.0).s(kReverbMix, 44).s(kShimmer, 28).s(kEqHigh, -1.5));
        add(PB("Amber Drift", kFamGuitar, 0, 1).s(kAttack, 1.4).s(kRelease, 6.5).s(kCutoff, 4200).s(kDrive, 32).s(kTapeAge, 55).s(kDelayMix, 30)
              .s(kDelaySync, 4).s(kDelayTone, 2600).s(kReverbMix, 32).s(kShimmer, 8).s(kEqLowMid, 1.5).s(kEqHigh, -3.0));
        add(PB("Marea Alta", kFamGuitar, 3).s(kAttack, 0.5).s(kRelease, 5.0).s(kUnisonVoices, 1).s(kChorus, 55).s(kDrive, 45).s(kCutoff, 6000)
              .s(kDelayMix, 34).s(kDelaySync, 4).s(kDelayFb, 42).s(kReverbType, 0).s(kReverbDecay, 5.5).s(kReverbMix, 34).s(kShimmer, 12));
        add(PB("Velvet Horizon", kFamGuitar, 1).s(kAttack, 0.7).s(kRelease, 4.5).s(kDelayMix, 28).s(kDelaySync, 5).s(kDelayFb, 46)
              .s(kReverbDecay, 7.0).s(kReverbMix, 34).s(kShimmer, 15).s(kEqLow, 1.0));
        add(PB("Eco de Cristal", kFamGuitar, 0).s(kAttack, 1.2).s(kRelease, 8.0).s(kShimmer, 58).s(kShimmerInterval, 0).s(kDelayMix, 40).s(kDelaySync, 4)
              .s(kDelayFb, 58).s(kReverbDecay, 14.0).s(kReverbMix, 48).s(kCutoff, 10000).s(kEqHighMid, 1.0));
        add(PB("Paper Lanterns", kFamGuitar, 0, 2).s(kAttack, 0.35).s(kRelease, 4.0).s(kLayerBlend, 30).s(kDelayMix, 36).s(kDelaySync, 4).s(kDelayFb, 55)
              .s(kReverbType, 0).s(kReverbDecay, 6.5).s(kReverbMix, 32).s(kShimmer, 20));
        add(PB("Tormenta Lenta", kFamGuitar, 3, 2).s(kAttack, 4.5).s(kRelease, 11.0).s(kLayerBlend, 40).s(kDrive, 55).s(kChorus, 45).s(kDelayMix, 30)
              .s(kDelaySync, 3).s(kDelayFb, 60).s(kReverbDecay, 15.0).s(kReverbMix, 46).s(kShimmer, 30).s(kCutoff, 5200).s(kComp, 45));
        add(PB("Oro Tenue", kFamGuitar, 2).s(kAttack, 2.2).s(kRelease, 8.0).s(kCutoff, 6500).s(kDelayMix, 35).s(kDelaySync, 3).s(kDelayFb, 50)
              .s(kReverbDecay, 10.0).s(kReverbMix, 42).s(kShimmer, 22).s(kEqLowMid, 1.0).s(kEqHigh, -1.0));

        // ---------------- Pads evolutivos (banco pads) ----------------
        add(PB("Coro de Neblina", kFamPads, 0, 4).s(kAttack, 3.0).s(kRelease, 9.0).s(kLayerBlend, 35).s(kUnisonVoices, 1).s(kDelayMix, 14).s(kDelaySync, 2)
              .s(kReverbDecay, 11.0).s(kReverbMix, 46).s(kShimmer, 26).s(kCutoff, 6500));
        add(PB("Santuario", kFamPads, 1, 4).s(kAttack, 2.5).s(kRelease, 9.0).s(kLayerBlend, 40).s(kDelayMix, 12).s(kReverbDecay, 13.0).s(kReverbMix, 48)
              .s(kShimmer, 30).s(kChorus, 38).s(kCutoff, 5200));
        add(PB("Barrido Boreal", kFamPads, 2).s(kAttack, 3.5).s(kRelease, 10.0).s(kLfoRate, 0.07).s(kLfoDepth, 48).s(kResonance, 24).s(kCutoff, 3200)
              .s(kDelayMix, 16).s(kReverbDecay, 12.0).s(kReverbMix, 44).s(kShimmer, 28));
        add(PB("Aurora Liquida", kFamPads, 2, 0).s(kAttack, 4.0).s(kRelease, 11.0).s(kLayerBlend, 45).s(kLfoRate, 0.09).s(kLfoDepth, 36).s(kCutoff, 4200)
              .s(kDelayMix, 18).s(kDelaySync, 4).s(kReverbDecay, 14.0).s(kReverbMix, 50).s(kShimmer, 34));
        add(PB("Respiro Dorado", kFamPads, 3, 1).s(kAttack, 2.8).s(kRelease, 8.5).s(kLayerBlend, 42).s(kCutoff, 4800).s(kDrive, 20).s(kTapeAge, 40)
              .s(kDelayMix, 10).s(kReverbDecay, 10.0).s(kReverbMix, 42).s(kShimmer, 18).s(kEqLowMid, 1.0));
        add(PB("Velo de Seda", kFamPads, 4).s(kAttack, 3.8).s(kRelease, 10.0).s(kCutoff, 7000).s(kUnisonVoices, 1).s(kChorus, 35).s(kDelayMix, 8)
              .s(kReverbDecay, 12.0).s(kReverbMix, 44).s(kShimmer, 24).s(kComp, 25));
        add(PB("Nube Calida", kFamPads, 1).s(kAttack, 2.0).s(kRelease, 7.0).s(kCutoff, 2600).s(kDrive, 26).s(kTapeAge, 45).s(kComp, 42).s(kDelayMix, 14)
              .s(kDelayTone, 2400).s(kReverbDecay, 8.0).s(kReverbMix, 36).s(kShimmer, 10).s(kEqHigh, -3.0));
        add(PB("Glass Cathedral", kFamPads, 0, 2).s(kAttack, 3.2).s(kRelease, 13.0).s(kLayerBlend, 38).s(kShimmer, 64).s(kShimmerInterval, 0)
              .s(kReverbDecay, 20.0).s(kReverbMix, 56).s(kReverbDamp, 45).s(kDelayMix, 14).s(kCutoff, 9000));
        add(PB("Bruma del Valle", kFamPads, 3).s(kAttack, 4.2).s(kRelease, 12.0).s(kCutoff, 3800).s(kLfoDepth, 28).s(kLfoRate, 0.06).s(kDelayMix, 12)
              .s(kReverbDecay, 11.0).s(kReverbMix, 46).s(kShimmer, 16).s(kWidth, 125));
        add(PB("Altar Pad", kFamPads, 1, 3).s(kAttack, 2.4).s(kRelease, 8.0).s(kLayerBlend, 45).s(kCutoff, 5600).s(kDelayMix, 20).s(kDelaySync, 3)
              .s(kDelayFb, 42).s(kReverbDecay, 10.0).s(kReverbMix, 42).s(kShimmer, 36).s(kShimmerInterval, 1));

        // ---------------- Texturas y atmosferas (banco textures, capas 0..5) ----------------
        add(PB("Aire Fino", kFamTextures, 0).s(kAttack, 3.0).s(kRelease, 9.0).s(kCutoff, 12000).s(kUnisonVoices, 1).s(kChorus, 20).s(kDrive, 5)
              .s(kDelayMix, 14).s(kDelayFb, 40).s(kReverbDecay, 12.0).s(kReverbMix, 45).s(kShimmer, 30).s(kLowCut, 150));
        add(PB("Viento Alto", kFamTextures, 1).s(kAttack, 3.5).s(kRelease, 10.0).s(kCutoff, 6000).s(kLfoDepth, 30).s(kLfoRate, 0.08).s(kDelayMix, 16)
              .s(kReverbDecay, 10.0).s(kReverbMix, 42).s(kShimmer, 18).s(kWidth, 130));
        add(PB("Presion Profunda", kFamTextures, 2).s(kAttack, 4.0).s(kRelease, 12.0).s(kCutoff, 2200).s(kLowCut, 28).s(kDrive, 22).s(kDelayMix, 8)
              .s(kReverbDecay, 14.0).s(kReverbMix, 36).s(kShimmer, 8).s(kEqLow, 2.0).s(kComp, 45));
        add(PB("Dron de Cuerdas", kFamTextures, 3).s(kAttack, 4.5).s(kRelease, 12.0).s(kCutoff, 4200).s(kDelayMix, 10).s(kReverbDecay, 15.0).s(kReverbMix, 44)
              .s(kShimmer, 20).s(kChorus, 36));
        add(PB("Olas Lentas", kFamTextures, 4).s(kAttack, 2.5).s(kRelease, 9.0).s(kCutoff, 9000).s(kDelayMix, 12).s(kReverbType, 0).s(kReverbDecay, 7.0)
              .s(kReverbMix, 36).s(kShimmer, 12).s(kWidth, 135));
        add(PB("Nube Armonica", kFamTextures, 5).s(kAttack, 3.5).s(kRelease, 11.0).s(kCutoff, 9500).s(kDelayMix, 18).s(kDelaySync, 4).s(kReverbDecay, 16.0)
              .s(kReverbMix, 48).s(kShimmer, 44).s(kChorus, 40));
        add(PB("Costa Brumosa", kFamTextures, 4, 0).s(kAttack, 3.0).s(kRelease, 10.0).s(kLayerBlend, 40).s(kCutoff, 8000).s(kDelayMix, 16)
              .s(kReverbDecay, 11.0).s(kReverbMix, 42).s(kShimmer, 18).s(kWidth, 135));
        add(PB("Monte Silente", kFamTextures, 1, 2).s(kAttack, 4.0).s(kRelease, 12.0).s(kLayerBlend, 45).s(kCutoff, 3400).s(kLfoDepth, 26).s(kDelayMix, 10)
              .s(kReverbDecay, 13.0).s(kReverbMix, 40).s(kShimmer, 12));
        add(PB("Cielo de Cristal", kFamTextures, 5, 0).s(kAttack, 3.2).s(kRelease, 12.0).s(kLayerBlend, 35).s(kCutoff, 11000).s(kShimmer, 54)
              .s(kReverbDecay, 18.0).s(kReverbMix, 52).s(kDelayMix, 16).s(kDelaySync, 4));
        add(PB("Hondo Oceano", kFamTextures, 3, 4).s(kAttack, 4.0).s(kRelease, 13.0).s(kLayerBlend, 45).s(kCutoff, 3600).s(kDelayMix, 10)
              .s(kReverbDecay, 16.0).s(kReverbMix, 46).s(kShimmer, 16).s(kEqLow, 1.5));

        // ---------------- Sound design (banco textures, capas 6..9) ----------------
        add(PB("Ascenso", kFamDesign, 6).s(kAttack, 0.05).s(kRelease, 2.0).s(kCutoff, 14000).s(kUnisonVoices, 0).s(kChorus, 10).s(kDelayMix, 10)
              .s(kDelayFb, 35).s(kReverbDecay, 6.0).s(kReverbMix, 30).s(kShimmer, 20).s(kLowCut, 90));
        add(PB("Caida Lenta", kFamDesign, 7).s(kAttack, 0.05).s(kRelease, 3.0).s(kCutoff, 12000).s(kUnisonVoices, 0).s(kDelayMix, 12).s(kReverbDecay, 9.0)
              .s(kReverbMix, 38).s(kShimmer, 14));
        add(PB("Brillo Infinito", kFamDesign, 8).s(kAttack, 2.5).s(kRelease, 12.0).s(kCutoff, 14000).s(kShimmer, 70).s(kShimmerInterval, 0).s(kReverbDecay, 22.0)
              .s(kReverbMix, 55).s(kDelayMix, 18).s(kDelaySync, 4).s(kChorus, 40));
        add(PB("Guitarra Inversa", kFamDesign, 9).s(kAttack, 0.02).s(kRelease, 4.0).s(kCutoff, 9000).s(kUnisonVoices, 0).s(kDelayMix, 30).s(kDelaySync, 4)
              .s(kDelayFb, 55).s(kReverbDecay, 10.0).s(kReverbMix, 42).s(kShimmer, 24));
        add(PB("Umbral", kFamDesign, 6, 8).s(kAttack, 0.05).s(kRelease, 6.0).s(kLayerBlend, 40).s(kCutoff, 13000).s(kDelayMix, 14).s(kReverbDecay, 12.0)
              .s(kReverbMix, 45).s(kShimmer, 40));
        add(PB("Descenso Celeste", kFamDesign, 7, 8).s(kAttack, 0.05).s(kRelease, 7.0).s(kLayerBlend, 45).s(kCutoff, 12000).s(kDelayMix, 14)
              .s(kReverbDecay, 14.0).s(kReverbMix, 48).s(kShimmer, 36));
        add(PB("Latido de Luz", kFamDesign, 8).s(kAttack, 1.2).s(kRelease, 8.0).s(kLfoRate, 1.6).s(kLfoDepth, 55).s(kCutoff, 6500).s(kResonance, 30)
              .s(kDelayMix, 34).s(kDelaySync, 5).s(kDelayFb, 55).s(kReverbDecay, 9.0).s(kReverbMix, 40).s(kShimmer, 30));
        add(PB("Puerta del Cielo", kFamDesign, 9, 6).s(kAttack, 0.03).s(kRelease, 5.0).s(kLayerBlend, 35).s(kCutoff, 10000).s(kDelayMix, 26).s(kDelaySync, 4)
              .s(kDelayFb, 50).s(kReverbDecay, 13.0).s(kReverbMix, 46).s(kShimmer, 32));
        add(PB("Estela", kFamDesign, 8).s(kAttack, 0.6).s(kRelease, 10.0).s(kCutoff, 9000).s(kDelayMix, 52).s(kDelaySync, 2).s(kDelayFb, 72).s(kTapeAge, 55)
              .s(kReverbDecay, 12.0).s(kReverbMix, 44).s(kShimmer, 26).s(kFxMacro, 55));
        add(PB("Silencio Antes", kFamDesign, 7, 9).s(kAttack, 0.04).s(kRelease, 8.0).s(kLayerBlend, 45).s(kCutoff, 7000).s(kDelayMix, 20).s(kDelaySync, 3)
              .s(kReverbDecay, 15.0).s(kReverbMix, 50).s(kShimmer, 20).s(kComp, 40));
        return a;
    }();
    return list;
}

// Compensacion de nivel por preset (dB), calibrada con `AmbientAtmos_rendertest --samples --calibrar`: iguala la sonoridad
// (RMS de un acorde de 3 notas a velocidad 0.7) entre los 40 presets. Solo la usa el motor nativo (la replica web ya iguala niveles).
inline const std::array<double, kNumPresets>& presetTrimDb() {
    static const std::array<double, kNumPresets> t = { {
        -0.5, 1.0, -1.0, 0.5, 1.0, -0.5, 0.5, -0.5, 2.0, -1.5,
        -1.0, -0.5, -1.0, -0.5, -1.0, -1.0, 0.0, -0.5, -0.5, 0.0,
        0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.5, 0.5, 1.0, 0.0,
        1.5, 1.5, 1.5, 1.0, 1.5, 1.5, 0.0, 1.5, 0.5, 1.5
    } };
    return t;
}

// Estado por defecto = preset 0.  Etiquetas de kPreset = nombres de fabrica.
inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        static std::vector<std::string> nombres;                 // vive todo el proceso (los punteros de etiquetas)
        static std::vector<const char*> etiquetas;
        for (const auto& p : presets()) nombres.push_back(p.name);
        for (const auto& n : nombres) etiquetas.push_back(n.c_str());
        const Preset& d = presets()[0];
        std::vector<ParamDef> v;
        for (const Spec& s : specs()) {
            double def = s.id == kPreset ? 0.0 : d.p[s.id];
            if (s.id == kFxMacro) def = d.p[kFxMacro];
            switch (s.map) {
                case Map::Linear: v.push_back(linearP(s.id, s.name, s.units, s.mn, s.mx, def, s.dec, s.bip)); break;
                case Map::Log: v.push_back(logP(s.id, s.name, s.units, s.mn, s.mx, def, s.dec)); break;
                default:
                    if (s.id == kBypass) v.push_back(toggleP(s.id, s.name, 0, true));
                    else if (s.id == kSustain) v.push_back(toggleP(s.id, s.name, 0));
                    else v.push_back(stepP(s.id, s.name, s.steps, static_cast<int>(def), s.id == kPreset ? etiquetas.data() : s.labels));
            }
        }
        marcarBasicos(v, { kBypass, kPreset, kAttack, kRelease, kFxMacro, kVolume });   // modo Básico del editor
        JW_FXRACK_REGISTRAR(v);   // FX Rack comun (ids 100..): lo ultimo de la lista; los presets NO lo tocan (el rack es del usuario)
        return v;
    }();
    return defs;
}

} // namespace JasWaveAmbientAtmos
