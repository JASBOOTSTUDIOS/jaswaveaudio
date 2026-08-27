#include "piano_plugin.h"
#include "public.sdk/source/vst/vstaudioprocessoralgo.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/ivstparameterchanges.h"
#include "base/source/fstreamer.h"
#include <cstring>

using namespace Steinberg;

JasWavePiano::JasWavePiano () {}

tresult PLUGIN_API JasWavePiano::initialize (FUnknown* context)
{
    tresult r = SingleComponentEffect::initialize (context);
    if (r != kResultOk) return r;
    addAudioOutput (STR16 ("Stereo Out"), Vst::SpeakerArr::kStereo);
    addEventInput (STR16 ("MIDI In"), 1);
    parameters.addParameter (STR16 ("Velocity"), STR16 ("%"), 0, 0.7, Vst::ParameterInfo::kCanAutomate, 0);
    parameters.addParameter (STR16 ("Brightness"), STR16 ("%"), 0, 0.5, Vst::ParameterInfo::kCanAutomate, 1);
    parameters.addParameter (STR16 ("Damping"), STR16 ("%"), 0, 0.45, Vst::ParameterInfo::kCanAutomate, 2);
    parameters.addParameter (STR16 ("Release"), STR16 ("s"), 0, 0.8, Vst::ParameterInfo::kCanAutomate, 3);
    parameters.addParameter (STR16 ("Stereo"), STR16 ("%"), 0, 0.3, Vst::ParameterInfo::kCanAutomate, 4);
    return kResultOk;
}

tresult PLUGIN_API JasWavePiano::terminate () { return SingleComponentEffect::terminate (); }

tresult PLUGIN_API JasWavePiano::setActive (TBool state)
{
    if (state) for (auto& v : voces) v.reset ();
    else for (auto& v : voces) v.reset (); // silence on deactivate / host unload
    return kResultOk;
}

tresult PLUGIN_API JasWavePiano::setProcessing (TBool /*state*/)
{
    return kResultOk;
}

tresult PLUGIN_API JasWavePiano::setupProcessing (Vst::ProcessSetup& setup)
{
    sr = static_cast<Steinberg::int32> (setup.sampleRate);
    return SingleComponentEffect::setupProcessing (setup);
}

tresult PLUGIN_API JasWavePiano::setBusArrangements (Vst::SpeakerArrangement* ins, int32 numIns,
                                                       Vst::SpeakerArrangement* outs, int32 numOuts)
{
    if (numIns == 0 && numOuts == 1 && Vst::SpeakerArr::getChannelCount (outs[0]) == 2)
    {
        if (auto* bus = FCast<Vst::AudioBus> (audioOutputs.at (0)))
        {
            bus->setArrangement (outs[0]);
            bus->setName (STR16 ("Stereo Out"));
            return kResultOk;
        }
    }
    return kResultFalse;
}

tresult PLUGIN_API JasWavePiano::canProcessSampleSize (int32 size)
{
    return (size == Vst::kSample32 || size == Vst::kSample64) ? kResultTrue : kResultFalse;
}

void JasWavePiano::leerParametros (Vst::ProcessData& data)
{
    if (!data.inputParameterChanges) return;
    int32 n = data.inputParameterChanges->getParameterCount ();
    for (int32 i = 0; i < n; i++)
    {
        auto* q = data.inputParameterChanges->getParameterData (i);
        if (!q) continue;
        Vst::ParamValue v; int32 off;
        if (q->getPoint (q->getPointCount () - 1, off, v) != kResultOk) continue;
        switch (q->getParameterId ())
        {
            case 0: pVel = 0.3f + (float)v * 1.7f; break;
            case 1: pBri = (float)v; break;
            case 2: pDamp = 0.85f + (float)v * 0.14f; break;
            case 3: pRel = 0.05f + (float)v * 2.95f; break;
            case 4: pStereo = (float)v; break;
        }
    }
}

VozPiano* JasWavePiano::buscarLibre ()
{
    VozPiano* best = nullptr; int32 maxAge = -1;
    for (auto& v : voces) { if (v.pitch < 0) return &v; if (v.age > maxAge) { maxAge = v.age; best = &v; } }
    return best;
}

VozPiano* JasWavePiano::buscarPorNota (int32 nota)
{
    for (auto& v : voces) if (v.pitch == nota && !v.releasing) return &v;
    return nullptr;
}

void JasWavePiano::procesarMidi (Vst::ProcessData& data)
{
    if (data.processContext)
    {
        const bool playing = (data.processContext->state & Vst::ProcessContext::kPlaying) != 0;
        if (wasPlaying && !playing)
        {
            for (auto& v : voces) v.reset ();
        }
        wasPlaying = playing;
    }
    if (!data.inputEvents) return;
    int32 num = data.inputEvents->getEventCount ();
    for (int32 i = 0; i < num; i++)
    {
        Vst::Event e {};
        if (data.inputEvents->getEvent (i, e) != kResultOk) continue;
        if (e.type == Vst::Event::kNoteOnEvent)
        {
            if (e.noteOn.velocity == 0)
            {
                VozPiano* v = buscarPorNota (e.noteOn.pitch);
                if (v) v->reset ();
                continue;
            }
            VozPiano* v = buscarLibre ();
            if (v) {
                float vn = e.noteOn.velocity;
                if (vn > 1.f) vn = vn / 127.f;
                vn = std::pow (std::max (0.f, vn), 1.f / pVel);
                vn = std::max (0.05f, std::min (1.f, vn));
                v->noteOn (e.noteOn.pitch, vn, pBri, pDamp, sr, rng);
            }
        }
        else if (e.type == Vst::Event::kNoteOffEvent)
        {
            VozPiano* v = buscarPorNota (e.noteOff.pitch);
            if (v) v->noteOff (std::min (pRel, 0.08f), sr);
        }
        else if (e.type == Vst::Event::kLegacyMIDICCOutEvent)
        {
            if (e.midiCCOut.controlNumber == 120 || e.midiCCOut.controlNumber == 123)
            {
                for (auto& v : voces) v.reset ();
            }
        }
    }
}

void JasWavePiano::renderizarAudio (Vst::ProcessData& data)
{
    if (data.numOutputs == 0) return;
    void** obuf = Vst::getChannelBuffersPointer (processSetup, data.outputs[0]);
    float* L = (float*)obuf[0];
    float* R = (data.outputs[0].numChannels >= 2) ? (float*)obuf[1] : L;
    int32 num = data.numSamples;

    float active = 0.f;
    for (const auto& v : voces) if (v.pitch >= 0) active += 1.f;
    float norm = (active > 1.f) ? 1.f / std::sqrt (active) : 1.f;

    for (int32 s = 0; s < num; s++)
    {
        float mL = 0.f, mR = 0.f;
        for (auto& v : voces)
        {
            if (v.pitch < 0) continue;
            float sample = v.tick (pDamp);
            v.age++;
            float bal = 0.5f + pStereo * 0.5f;
            mL += sample * bal;
            mR += sample * (1.f - pStereo * 0.2f);
        }
        L[s] = mL * norm * 7.5f;
        if (L != R) R[s] = mR * norm * 7.5f;
        else L[s] = (mL + mR) * 0.5f * norm * 7.5f;
    }
    data.outputs[0].silenceFlags = 0;
}

tresult PLUGIN_API JasWavePiano::process (Vst::ProcessData& data)
{
    leerParametros (data);
    procesarMidi (data);
    renderizarAudio (data);
    return kResultOk;
}

tresult PLUGIN_API JasWavePiano::setState (IBStream* state)
{
    IBStreamer s (state, kLittleEndian);
    float v, b, d, r, st;
    s.readFloat (v); s.readFloat (b); s.readFloat (d); s.readFloat (r); s.readFloat (st);
    pVel = v; pBri = b; pDamp = d; pRel = r; pStereo = st;
    return kResultOk;
}

tresult PLUGIN_API JasWavePiano::getState (IBStream* state)
{
    IBStreamer s (state, kLittleEndian);
    s.writeFloat (pVel); s.writeFloat (pBri); s.writeFloat (pDamp);
    s.writeFloat (pRel); s.writeFloat (pStereo);
    return kResultOk;
}

tresult PLUGIN_API JasWavePiano::setParamNormalized (Vst::ParamID tag, Vst::ParamValue value)
{
    return SingleComponentEffect::setParamNormalized (tag, value);
}
