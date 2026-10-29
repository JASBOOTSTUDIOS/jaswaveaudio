// Prueba de extremo a extremo del VST3 de Worship Drums a través de la factoría real (sin DAW):
// eventos MIDI con precisión de muestra, 32/64 bit, bloques variables, parámetros, bypass, licencia,
// IMidiMapping (CC4 -> pedal de hi-hat), estado y cola. Sale con código != 0 si algo falla.
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

#include "jw_vst3.h"

#include "public.sdk/source/vst/hosting/eventlist.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/vst/hosting/parameterchanges.h"
#include "pluginterfaces/base/ipluginbase.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace Steinberg;
using namespace Steinberg::Vst;

extern "C" IPluginFactory* PLUGIN_API GetPluginFactory();

static int g_fail = 0;
static void check(bool ok, const char* what, const std::string& d = "") {
    std::printf("  [%s] %s %s\n", ok ? " OK " : "FAIL", what, d.c_str());
    if (!ok) ++g_fail;
}
static std::string f2(const char* f, double a = 0, double b = 0) { char buf[200]; std::snprintf(buf, sizeof buf, f, a, b); return buf; }

struct Ev { int at; int type; int a; float b; };   // type 0 = noteOn(nota a, vel b), 1 = CC (num a, valor b)
struct ParamSet { uint32_t id; double plain; };

struct Host {
    HostApplication host;
    IComponent* comp{nullptr};
    IEditController* ctrl{nullptr};
    IAudioProcessor* proc{nullptr};
    const double sr = 48000.0;

    bool init(bool sample64) {
        IPluginFactory* f = GetPluginFactory();
        TUID pc{}, cc{};
        for (int32 i = 0; i < f->countClasses(); ++i) {
            PClassInfo ci{};
            f->getClassInfo(i, &ci);
            if (std::strcmp(ci.category, kVstAudioEffectClass) == 0) std::memcpy(pc, ci.cid, sizeof(TUID));
            if (std::strcmp(ci.category, kVstComponentControllerClass) == 0) std::memcpy(cc, ci.cid, sizeof(TUID));
        }
        f->createInstance(pc, IComponent::iid, reinterpret_cast<void**>(&comp));
        f->createInstance(cc, IEditController::iid, reinterpret_cast<void**>(&ctrl));
        if (!comp || !ctrl) return false;
        comp->initialize(&host);
        ctrl->initialize(&host);
        comp->queryInterface(IAudioProcessor::iid, reinterpret_cast<void**>(&proc));
        ProcessSetup setup{ kRealtime, sample64 ? kSample64 : kSample32, 4096, sr };
        if (proc->setupProcessing(setup) != kResultOk) return false;
        comp->setActive(true);
        proc->setProcessing(true);
        return true;
    }
    void done() { proc->setProcessing(false); comp->setActive(false); ctrl->terminate(); comp->terminate(); }

    // Renderiza `total` muestras en bloques de `blk`; eventos y cambios de parámetros en la muestra absoluta indicada
    template <class T>
    std::vector<T> run(int total, int blk, const std::vector<Ev>& evs, const std::vector<std::pair<int, ParamSet>>& params, bool sample64) {
        std::vector<T> outL(static_cast<size_t>(total), T(0)), outR(static_cast<size_t>(total), T(0));
        std::vector<T> bl(static_cast<size_t>(blk)), br(static_cast<size_t>(blk));
        T* chans[2] = { bl.data(), br.data() };
        AudioBusBuffers outBus{};
        outBus.numChannels = 2;
        if (sample64) outBus.channelBuffers64 = reinterpret_cast<double**>(chans); else outBus.channelBuffers32 = reinterpret_cast<float**>(chans);
        for (int pos = 0; pos < total; pos += blk) {
            const int n = std::min(blk, total - pos);
            EventList events;
            ParameterChanges changes;
            for (const auto& e : evs) if (e.at >= pos && e.at < pos + n) {
                Event ev{};
                if (e.type == 0) {
                    ev.type = Event::kNoteOnEvent; ev.sampleOffset = e.at - pos;
                    ev.noteOn.pitch = static_cast<int16>(e.a); ev.noteOn.velocity = e.b; ev.noteOn.noteId = -1; ev.noteOn.channel = 0;
                } else {
                    ev.type = Event::kLegacyMIDICCOutEvent; ev.sampleOffset = e.at - pos;
                    ev.midiCCOut.controlNumber = static_cast<uint8>(e.a); ev.midiCCOut.value = static_cast<int8>(e.b); ev.midiCCOut.channel = 0;
                }
                events.addEvent(ev);
            }
            for (const auto& p : params) if (p.first >= pos && p.first < pos + n) {
                const JasWaveVst::ParamDef* d = static_cast<JasWaveVst::JwController*>(ctrl)->table().find(p.second.id);
                int32 qi = 0, pi = 0;
                if (IParamValueQueue* q = changes.addParameterData(p.second.id, qi)) q->addPoint(p.first - pos, JasWaveVst::toNorm(*d, p.second.plain), pi);
            }
            ProcessData data{};
            data.processMode = kRealtime;
            data.symbolicSampleSize = sample64 ? kSample64 : kSample32;
            data.numSamples = n;
            data.numOutputs = 1;
            data.outputs = &outBus;
            data.inputEvents = &events;
            data.inputParameterChanges = &changes;
            if (proc->process(data) != kResultOk) return {};
            for (int i = 0; i < n; ++i) { outL[static_cast<size_t>(pos + i)] = bl[static_cast<size_t>(i)]; outR[static_cast<size_t>(pos + i)] = br[static_cast<size_t>(i)]; }
        }
        return outL;
    }
};

template <class T>
static double peak(const std::vector<T>& v, size_t a = 0, size_t b = SIZE_MAX) {
    double p = 0; for (size_t i = a; i < std::min(b, v.size()); ++i) p = std::max(p, std::fabs(double(v[i]))); return p;
}
template <class T>
static double rms(const std::vector<T>& v, size_t a, size_t b) {
    double s = 0; b = std::min(b, v.size()); for (size_t i = a; i < b; ++i) s += double(v[i]) * v[i]; return std::sqrt(s / std::max<size_t>(1, b - a));
}
static void setLicense(bool on) {
    JasWaveLicense::UiStatus st;
    st.phase = on ? JasWaveLicense::Phase::Active : JasWaveLicense::Phase::Idle;
    st.email = "demo@jaswave.app";
    uint64_t all = 0;
    if (on) { all = JasWaveLicense::StateBits::kLicensed; all |= 1ull << JasWaveLicense::StateBits::kFeatureShift; }
    JasWaveLicense::Manager::instance().testOverride(all, st);
}

int main() {
    std::printf("== VST3 de extremo a extremo (factoria real, ProcessData con eventos y parametros) ==\n");
    Host h;
    if (!h.init(false)) { std::printf("FALLO: no se pudo instanciar\n"); return 1; }
    setLicense(true);
    const int total = 48000 * 2;

    auto a32 = h.run<float>(total, 512, { { 100, 0, 36, 0.9f } }, {}, false);
    size_t first = 0; while (first < a32.size() && std::fabs(a32[first]) < 1e-5f) ++first;
    check(!a32.empty() && peak(a32) > 0.1 && peak(a32) < 0.98, "bombo 36 suena (pico 0.1..0.98)", f2("pico=%.3f", peak(a32)));
    check(first >= 100 && first <= 102, "inicio con precision de muestra (offset 100)", f2("primera muestra=%.0f", double(first)));
    check(a32.size() == size_t(total) && peak(a32, 0, 100) == 0.0, "silencio antes del evento");

    Host hu; hu.init(false);
    auto un = hu.run<float>(24000, 512, { { 10, 0, 60, 1.0f }, { 20, 0, 34, 1.0f }, { 30, 0, 61, 1.0f } }, {}, false);
    check(peak(un) == 0.0, "notas fuera del mapa (60, 34, 61) no suenan");
    hu.done();

    // 64 bit
    Host h64;
    h64.init(true);
    auto a64 = h64.run<double>(total, 512, { { 100, 0, 36, 0.9f } }, {}, true);
    double md = 0; for (size_t i = 0; i < a32.size(); ++i) md = std::max(md, std::fabs(double(a32[i]) - a64[i]));
    check(md < 1e-5, "32 bit == 64 bit", f2("dif max=%.2e", md));
    h64.done();

    // bloques variables
    Host hb; hb.init(false);
    auto b37 = hb.run<float>(total, 37, { { 100, 0, 36, 0.9f } }, {}, false);
    md = 0; for (size_t i = 0; i < a32.size(); ++i) md = std::max(md, std::fabs(double(a32[i]) - b37[i]));
    check(md < 2e-4, "bloques de 37 muestras == bloques de 512", f2("dif max=%.2e", md));
    hb.done();

    // volumen y bypass por parametros
    {
        Host hv; hv.init(false);
        auto quiet = hv.run<float>(total, 512, { { 24100, 0, 38, 0.9f } }, { { 0, { 6, -24.0 } } }, false);
        Host hn; hn.init(false);
        auto normal = hn.run<float>(total, 512, { { 24100, 0, 38, 0.9f } }, {}, false);
        const double ratio = peak(quiet) / std::max(1e-9, peak(normal));
        check(ratio > 0.03 && ratio < 0.12, "volumen -24 dB atenua ~0.063", f2("ratio=%.3f", ratio));
        hv.done(); hn.done();
        Host hy; hy.init(false);
        auto byp = hy.run<float>(total, 512, { { 20000, 0, 38, 0.9f } }, { { 0, { 5, 1.0 } } }, false);
        check(peak(byp, 24000) < 1e-6, "bypass silencia el instrumento", f2("pico=%.2e", peak(byp, 24000)));
        hy.done();
    }
    // sin licencia
    {
        setLicense(false);
        Host hl; hl.init(false);
        auto sil = hl.run<float>(24000, 512, { { 100, 0, 36, 1.0f } }, {}, false);
        check(peak(sil, 2000) < 1e-6, "sin licencia: silencio (tras el fundido)", f2("pico=%.2e", peak(sil, 2000)));
        hl.done();
        setLicense(true);
    }
    // CC4 (pedal) y pitch bend entran sin romper nada; IMidiMapping
    {
        Host hc; hc.init(false);
        auto cc = hc.run<float>(total, 512, { { 50, 1, 4, 0 }, { 60, 0, 42, 0.8f }, { 30000, 1, 4, 127 }, { 30010, 0, 42, 0.8f }, { 60000, 1, 129, 100 }, { 60010, 0, 41, 0.9f } }, {}, false);
        bool fin = true; for (float v : cc) if (!std::isfinite(v)) fin = false;
        check(fin && peak(cc) > 0.02, "eventos CC4 y pitch bend aceptados");
        // el mismo golpe de hi-hat con el pedal arriba (CC4=0) suena mas abierto que con el pedal abajo (CC4=127)
        Host hp0; hp0.init(false);
        auto up = hp0.run<float>(48000, 512, { { 50, 1, 4, 0 }, { 60, 0, 42, 0.8f } }, {}, false);
        Host hp1; hp1.init(false);
        auto down = hp1.run<float>(48000, 512, { { 50, 1, 4, 127 }, { 60, 0, 42, 0.8f } }, {}, false);
        const double open = rms(up, 60 + 4800, 60 + 14400), closed = rms(down, 60 + 4800, 60 + 14400);
        std::printf("    hat 42, cola 100-300 ms: pedal arriba %.1f dB ; pedal abajo %.1f dB\n", 20 * std::log10(open + 1e-12), 20 * std::log10(closed + 1e-12));
        check(open > closed * 2.0, "CC4: pedal arriba deja el hi-hat mas abierto que pedal abajo (>6 dB)");
        hp0.done(); hp1.done();
        auto* jc = dynamic_cast<JasWaveVst::JwController*>(hc.ctrl);
        ParamID id = 999;
        check(jc && jc->getMidiControllerAssignment(0, 0, 4, id) == kResultTrue && id == 10, "IMidiMapping: CC4 -> hat_foot (id 10)");
        check(jc && jc->getMidiControllerAssignment(0, 0, 64, id) != kResultTrue, "IMidiMapping: CC64 sin asignar");
        check(hc.proc->getTailSamples() >= 48000 * 5, "cola >= 5 s", f2("%.0f muestras", double(hc.proc->getTailSamples())));
        hc.done();
    }
    // 40 voces de platos a la vez: sin NaN, pico acotado
    {
        std::vector<Ev> evs;
        const int n[] = { 49, 57, 51, 59, 55, 52, 46, 53 };
        for (int i = 0; i < 100; ++i) evs.push_back({ 200 + i * 7, 0, n[i % 8], 1.0f });
        Host hs; hs.init(false);
        auto st = hs.run<float>(total, 256, evs, {}, false);
        bool fin = true; for (float v : st) if (!std::isfinite(v)) fin = false;
        check(fin && peak(st) < 0.9801, "100 golpes de platos en 14 ms: finito y pico < 0.98", f2("pico=%.3f", peak(st)));
        hs.done();
    }
    h.done();
    std::printf("\n%s (%d fallos)\n", g_fail ? "FALLO" : "TODO OK", g_fail);
    return g_fail ? 1 : 0;
}
