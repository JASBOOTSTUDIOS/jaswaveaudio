#pragma once

#include "piano_ids.h"
#include "public.sdk/source/vst/vstsinglecomponenteffect.h"
#include <array>
#include <cmath>
#include <algorithm>

struct CuerdaVirtual {
    std::array<float, 2048> linea {};
    Steinberg::int32 len = 0, rd = 0, wr = 0, excRem = 0;
    float prev = 0.f, lp = 0.f;
    bool on = false;

    void reset () { linea.fill (0); len = rd = wr = 0; prev = lp = 0; excRem = 0; on = false; }
    void start (Steinberg::int32 l, float amp, Steinberg::int32 exc, float bright, uint32_t& rng) {
        len = l; rd = wr = 0; prev = lp = 0; on = true; excRem = exc;
        // Martillo: ruido filtrado (más “piano”, menos buzz de synth).
        const float bri = std::clamp (bright, 0.f, 1.f);
        for (Steinberg::int32 i = 0; i < l; i++) {
            rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
            float n = ((rng & 0x7FFFFFFF) / (float)0x7FFFFFFF * 2.f - 1.f);
            lp = lp * (0.55f - 0.25f * bri) + n * (0.45f + 0.25f * bri);
            float env = 1.f - (float)i / (float)std::max (l, (Steinberg::int32)1);
            linea[i] = lp * amp * env;
        }
    }
    float tick (float damp) {
        if (!on || len < 2) return 0.f;
        float o = linea[rd];
        float avg = (o + prev) * 0.5f; prev = o;
        // Amortiguación + ligera pérdida HF (cuerda).
        float fb = avg * damp * 0.9985f;
        if (excRem > 0) {
            float f = (float)excRem / std::max (excRem, (Steinberg::int32)1);
            fb = fb * (1.f - f * 0.35f) + linea[wr] * f * 0.35f;
            excRem--;
        }
        linea[wr] = fb;
        rd = (rd + 1) % len; wr = (wr + 1) % len;
        return o;
    }
};

struct VozPiano {
    Steinberg::int32 pitch = -1;
    float vel = 0.f;
    bool releasing = false;
    float relEnv = 1.f, relRate = 0.f;
    Steinberg::int32 age = 0;
    std::array<CuerdaVirtual, 3> cuerdas;

    void reset () { pitch = -1; vel = 0; releasing = false; relEnv = 1; relRate = age = 0; for (auto& c : cuerdas) c.reset (); }
    void noteOn (Steinberg::int32 midi, float v, float bright, float damp, Steinberg::int32 sampleRate, uint32_t& rng) {
        pitch = midi; vel = v; releasing = false; relEnv = 1.f; age = 0;
        float freq = 440.f * std::pow (2.f, (midi - 69) / 12.f);
        float baseLen = (float)sampleRate / freq;
        // Excitation más corta en graves, más brillante en agudos.
        Steinberg::int32 excLen = std::max ((Steinberg::int32)2, (Steinberg::int32)(4 + bright * 10 + (midi > 60 ? 2 : 0)));
        const float amps[3] = { 0.85f, 0.42f, 0.22f };
        const float det[3] = { 0.f, 0.0008f, -0.0012f }; // inharmonicidad leve
        for (Steinberg::int32 i = 0; i < 3; i++) {
            float dt = 1.f + det[i];
            Steinberg::int32 l = std::max ((Steinberg::int32)2, (Steinberg::int32)(baseLen * dt));
            float a = v * amps[i] * (0.85f + 0.15f * bright);
            cuerdas[i].start (l, a, excLen, bright, rng);
        }
        (void)damp;
    }
    void noteOff (float relSec, Steinberg::int32 sampleRate) {
        releasing = true; relEnv = 1.f;
        relRate = 1.f / std::max (1.f, relSec * sampleRate);
    }
    float tick (float damp) {
        if (pitch < 0) return 0.f;
        // Damping más fuerte en agudos (como piano acústico).
        float noteDamp = damp - (pitch - 60) * 0.00035f;
        noteDamp = std::clamp (noteDamp, 0.90f, 0.999f);
        float sum = cuerdas[0].tick (noteDamp) + cuerdas[1].tick (noteDamp) + cuerdas[2].tick (noteDamp);
        float o = sum * vel;
        if (releasing) { o *= relEnv; relEnv -= relRate; if (relEnv <= 0.f) { relEnv = 0.f; pitch = -1; } }
        return o;
    }
};

class JasWavePiano : public Steinberg::Vst::SingleComponentEffect
{
public:
    JasWavePiano ();

    static Steinberg::FUnknown* createInstance (void*) {
        return (Steinberg::Vst::IAudioProcessor*)new JasWavePiano;
    }

    // IComponent
    Steinberg::tresult PLUGIN_API initialize (Steinberg::FUnknown* context) override;
    Steinberg::tresult PLUGIN_API terminate () override;
    Steinberg::tresult PLUGIN_API setActive (Steinberg::TBool state) override;
    Steinberg::tresult PLUGIN_API setProcessing (Steinberg::TBool state) override;
    Steinberg::tresult PLUGIN_API process (Steinberg::Vst::ProcessData& data) override;
    Steinberg::tresult PLUGIN_API canProcessSampleSize (Steinberg::int32 symbolicSampleSize) override;
    Steinberg::tresult PLUGIN_API setupProcessing (Steinberg::Vst::ProcessSetup& newSetup) override;
    Steinberg::tresult PLUGIN_API setBusArrangements (
        Steinberg::Vst::SpeakerArrangement* inputs, Steinberg::int32 numIns,
        Steinberg::Vst::SpeakerArrangement* outputs, Steinberg::int32 numOuts) override;
    Steinberg::tresult PLUGIN_API setState (Steinberg::IBStream* state) override;
    Steinberg::tresult PLUGIN_API getState (Steinberg::IBStream* state) override;
    Steinberg::tresult PLUGIN_API setParamNormalized (Steinberg::Vst::ParamID tag, Steinberg::Vst::ParamValue value) override;

private:
    void leerParametros (Steinberg::Vst::ProcessData& data);
    void procesarMidi (Steinberg::Vst::ProcessData& data);
    void renderizarAudio (Steinberg::Vst::ProcessData& data);
    VozPiano* buscarLibre ();
    VozPiano* buscarPorNota (Steinberg::int32 nota);

    float pVel = 0.7f, pBri = 0.5f, pDamp = 0.45f, pRel = 0.8f, pStereo = 0.3f;
    Steinberg::int32 sr = 48000;
    bool wasPlaying = false;
    std::array<VozPiano, 64> voces;
    uint32_t rng = 0xDEADBEEF;
};
