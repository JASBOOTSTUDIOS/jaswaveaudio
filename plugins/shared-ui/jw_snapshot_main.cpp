// Herramienta de capturas / volcado de parámetros (solo pruebas; enlaza jw_license_testing).
//   <Plugin>_snapshot --out <dir> --name <base> [--width 1100] [--height 620]
//   <Plugin>_snapshot --dump-params <archivo.json>
//   <Plugin>_snapshot --dump-layout <ui-layout.json>
// Instancia el plugin con su propia factoría, procesa ~3 s de señal de prueba (audio o MIDI)
// con el procesador y el controlador conectados, y renderiza el editor real a PNG con
// Direct2D/WIC en cinco estados de licencia: completa, por vencer, básica (sin features),
// sin licencia y activando. --dump-layout vuelca el layout del editor (réplica web, V4).
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

#include "jw_ui.h"
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

namespace {

constexpr double kSr = 48000.0;
constexpr int kBlock = 256;

struct Rng {
    uint32_t s{0x1234567u};
    float next() { s = s * 1664525u + 1013904223u; return static_cast<float>((s >> 8) & 0xFFFF) / 32768.0f - 1.0f; }
};

// Señal "música": bombo, caja, hi-hat, bajo y acorde con algo de estéreo
void genMusic(std::vector<float>& L, std::vector<float>& R, int n0, int n, Rng& rng) {
    for (int i = 0; i < n; ++i) {
        const double t = (n0 + i) / kSr;
        const double beat = std::fmod(t, 0.5);
        const double kick = std::exp(-beat * 18.0) * std::sin(2.0 * 3.14159265 * (50.0 + 120.0 * std::exp(-beat * 40.0)) * beat);
        const double sn = std::fmod(t + 0.25, 1.0);
        const double snare = (sn < 0.2 ? std::exp(-sn * 25.0) : 0.0) * rng.next() * 0.5;
        const double hh = std::fmod(t, 0.125);
        const double hat = std::exp(-hh * 120.0) * rng.next() * 0.18;
        double chord = 0.0;
        const double f[4] = { 110.0, 220.0 * 1.2599, 220.0 * 1.4983, 440.0 };
        for (int k = 0; k < 4; ++k)
            for (int h = 1; h <= 6; ++h) chord += std::sin(2.0 * 3.14159265 * f[k] * h * t + k) / (h * 9.0);
        const double sib = std::fmod(t, 1.7) < 0.12 ? rng.next() * 0.22 * std::sin(2.0 * 3.14159265 * 7000.0 * t) : 0.0;
        const double m = 0.9 * kick + snare + hat + 0.35 * chord + sib;
        L[static_cast<size_t>(i)] = static_cast<float>(0.8 * m + 0.05 * std::sin(2.0 * 3.14159265 * 330.0 * t));
        R[static_cast<size_t>(i)] = static_cast<float>(0.8 * m - 0.05 * std::sin(2.0 * 3.14159265 * 330.0 * t + 0.7));
    }
}

// Señal "voz": vocal sintética (armónicos con formantes) + sibilantes periódicas
void genVocal(std::vector<float>& L, std::vector<float>& R, int n0, int n, Rng& rng) {
    static double lp = 0.0, hp = 0.0, prev = 0.0;
    for (int i = 0; i < n; ++i) {
        const double t = (n0 + i) / kSr;
        double v = 0.0;
        for (int h = 1; h <= 20; ++h) {
            const double fh = 160.0 * h;
            const double formant = std::exp(-std::pow((fh - 700.0) / 300.0, 2)) + 0.6 * std::exp(-std::pow((fh - 1200.0) / 400.0, 2)) +
                                   0.3 * std::exp(-std::pow((fh - 2600.0) / 500.0, 2));
            v += formant * std::sin(2.0 * 3.14159265 * fh * t) / h;
        }
        const double ph = std::fmod(t, 0.8);
        const double env = ph < 0.55 ? 1.0 : 0.0;
        const double sEnv = (ph > 0.58 && ph < 0.75) ? std::sin((ph - 0.58) / 0.17 * 3.14159265) : 0.0;
        const double x = rng.next();
        hp = 0.85 * (hp + x - prev);   // ruido agudo
        prev = x;
        lp += 0.5 * (hp - lp);
        const double s = 0.75 * env * v + 0.55 * sEnv * lp;
        L[static_cast<size_t>(i)] = static_cast<float>(s);
        R[static_cast<size_t>(i)] = static_cast<float>(s * 0.96);
    }
}

std::wstring widen(const std::string& s) {
    const int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring w(static_cast<size_t>(std::max(0, n)), L'\0');
    if (n > 0) MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), &w[0], n);
    return w;
}

std::string jsonEsc(const char* s) {
    std::string o;
    for (; s && *s; ++s) {
        if (*s == '"' || *s == '\\') o.push_back('\\');
        o.push_back(*s);
    }
    return o;
}

} // namespace

int wmain(int argc, wchar_t** argv) {
    std::wstring outDir = L".", base = L"plugin", dump, dumpLayout;
    UINT W = 1100, H = 620;
    for (int i = 1; i < argc; ++i) {
        const std::wstring a = argv[i];
        if (a == L"--out" && i + 1 < argc) outDir = argv[++i];
        else if (a == L"--name" && i + 1 < argc) base = argv[++i];
        else if (a == L"--width" && i + 1 < argc) W = static_cast<UINT>(_wtoi(argv[++i]));
        else if (a == L"--height" && i + 1 < argc) H = static_cast<UINT>(_wtoi(argv[++i]));
        else if (a == L"--dump-params" && i + 1 < argc) dump = argv[++i];
        else if (a == L"--dump-layout" && i + 1 < argc) dumpLayout = argv[++i];
    }

    IPluginFactory* f = GetPluginFactory();
    if (!f) { std::fprintf(stderr, "sin factoría\n"); return 1; }
    TUID procCid{}, ctrlCid{};
    bool haveProc = false, haveCtrl = false;
    for (int32 i = 0; i < f->countClasses(); ++i) {
        PClassInfo ci{};
        f->getClassInfo(i, &ci);
        if (std::strcmp(ci.category, kVstAudioEffectClass) == 0) { std::memcpy(procCid, ci.cid, sizeof(TUID)); haveProc = true; }
        if (std::strcmp(ci.category, kVstComponentControllerClass) == 0) { std::memcpy(ctrlCid, ci.cid, sizeof(TUID)); haveCtrl = true; }
    }
    if (!haveProc || !haveCtrl) { std::fprintf(stderr, "clases no encontradas\n"); return 1; }

    HostApplication host;
    IComponent* comp = nullptr;
    IEditController* ctrlIface = nullptr;
    f->createInstance(procCid, IComponent::iid, reinterpret_cast<void**>(&comp));
    f->createInstance(ctrlCid, IEditController::iid, reinterpret_cast<void**>(&ctrlIface));
    if (!comp || !ctrlIface) { std::fprintf(stderr, "no se pudo instanciar\n"); return 1; }
    comp->initialize(&host);
    ctrlIface->initialize(&host);
    auto* ctl = dynamic_cast<JasWaveVst::JwController*>(ctrlIface);
    if (!ctl) { std::fprintf(stderr, "el controlador no es JwController\n"); return 1; }

    if (!dump.empty()) {
        // Volcado de la tabla de parámetros (fuente de verdad para ai.parameters del manifiesto)
        FILE* fp = _wfopen(dump.c_str(), L"wb");
        if (!fp) return 1;
        const auto& d = ctl->descriptor();
        std::fprintf(fp, "{\n  \"productId\": \"%s\",\n  \"features\": [", d.productId);
        for (int i = 0; i < d.featureCount; ++i)
            std::fprintf(fp, "%s{\"key\":\"%s\",\"label\":\"%s\"}", i ? "," : "", d.features[i].key, jsonEsc(d.features[i].label).c_str());
        std::fprintf(fp, "],\n  \"parameters\": [\n");
        const auto& t = ctl->table();
        for (int i = 0; i < t.count(); ++i) {
            const auto& p = t.at(i);
            std::string labels;
            if (p.labels) for (int k = 0; k <= p.steps; ++k) labels += std::string(k ? "," : "") + "\"" + jsonEsc(p.labels[k]) + "\"";
            std::fprintf(fp,
                         "    {\"vstParamId\":%u,\"name\":\"%s\",\"units\":\"%s\",\"map\":\"%s\",\"min\":%.10g,\"max\":%.10g,\"default\":%.10g,"
                         "\"steps\":%d,\"feature\":%s,\"readOnly\":%s,\"bypass\":%s,\"labels\":[%s]}%s\n",
                         p.id, jsonEsc(p.name).c_str(), jsonEsc(p.units).c_str(),
                         p.map == JasWaveVst::Map::Log ? "log" : p.map == JasWaveVst::Map::Stepped ? "stepped" : "linear", p.minV, p.maxV, p.defV, p.steps,
                         p.feature >= 0 ? ("\"" + std::string(d.features[p.feature].key) + "\"").c_str() : "null", p.readOnly ? "true" : "false",
                         p.bypass ? "true" : "false", labels.c_str(), i + 1 < t.count() ? "," : "");
        }
        std::fprintf(fp, "  ]\n}\n");
        std::fclose(fp);
        comp->terminate();
        ctrlIface->terminate();
        return 0;
    }

    if (!dumpLayout.empty()) {
        const bool ok = JasWaveUI::dumpEditorLayout(ctl, dumpLayout.c_str());
        std::wprintf(L"%ls %ls\n", ok ? L"OK   " : L"FALLO", dumpLayout.c_str());
        comp->terminate();
        ctrlIface->terminate();
        return ok ? 0 : 1;
    }

    // Conexión procesador <-> controlador (telemetría)
    Vst::IConnectionPoint* cpP = nullptr;
    Vst::IConnectionPoint* cpC = nullptr;
    comp->queryInterface(Vst::IConnectionPoint::iid, reinterpret_cast<void**>(&cpP));
    ctrlIface->queryInterface(Vst::IConnectionPoint::iid, reinterpret_cast<void**>(&cpC));
    if (cpP && cpC) { cpC->connect(cpP); cpP->connect(cpC); }

    IAudioProcessor* proc = nullptr;
    comp->queryInterface(IAudioProcessor::iid, reinterpret_cast<void**>(&proc));
    ProcessSetup setup{ kRealtime, kSample32, kBlock, kSr };
    proc->setupProcessing(setup);
    comp->setActive(true);
    proc->setProcessing(true);
    // El editor "está abierto" durante la captura: el procesador alimenta los taps del espectro
    std::shared_ptr<JasWaveDsp::MeterBusBase> bus = ctl->bus();
    if (bus) bus->editoresAbiertos.fetch_add(1);

    // Estado de licencia completo para los visualizadores
    const auto& desc = ctl->descriptor();
    uint64_t all = JasWaveLicense::StateBits::kLicensed;
    for (int i = 0; i < desc.featureCount; ++i) all |= 1ull << (JasWaveLicense::StateBits::kFeatureShift + i);
    JasWaveLicense::UiStatus st;
    st.phase = JasWaveLicense::Phase::Active;
    st.email = "demo@jaswave.app";
    JasWaveLicense::Manager::instance().testOverride(all, st);

    // Preajuste de demostración
    ParameterChanges changes;
    for (const auto& dp : ctl->demoPreset()) {
        Parameter* p = ctl->getParameterObject(dp.id);
        if (!p) continue;
        const double n = p->toNormalized(dp.plain);
        ctl->setParamNormalized(dp.id, n);
        int32 qi = 0, pi = 0;
        if (IParamValueQueue* q = changes.addParameterData(dp.id, qi)) q->addPoint(0, n, pi);
    }

    std::vector<float> inL(kBlock), inR(kBlock), outL(kBlock), outR(kBlock);
    float* ins[2] = { inL.data(), inR.data() };
    float* outs[2] = { outL.data(), outR.data() };
    AudioBusBuffers inBus{}, outBus{};
    inBus.numChannels = 2; inBus.channelBuffers32 = ins;
    outBus.numChannels = 2; outBus.channelBuffers32 = outs;
    EventList events;
    Rng rng;
    const auto sig = ctl->demoSignal();
    // Alimenta `seconds` de señal de prueba; en los instrumentos, el acorde se dispara al inicio de cada tramo
    int pos = 0;
    auto feed = [&](double seconds) {
        const int from = pos, end = pos + static_cast<int>(kSr * seconds);
        for (; pos < end; pos += kBlock) {
            ProcessData data{};
            data.processMode = kRealtime;
            data.symbolicSampleSize = kSample32;
            data.numSamples = kBlock;
            data.numOutputs = 1;
            data.outputs = &outBus;
            data.inputParameterChanges = pos == 0 ? &changes : nullptr;
            events.clear();
            if (sig == JasWaveVst::JwController::DemoSignal::Midi) {
                data.numInputs = 0;
                // acorde sostenido + arpegio; al empezar un tramo nuevo se apagan las notas del anterior
                const int notes[] = { 48, 55, 60, 64, 67, 72, 76 };
                if (pos == from && from > 0)
                    for (const int nt : notes) {
                        Event e{};
                        e.type = Event::kNoteOffEvent;
                        e.noteOff.pitch = static_cast<int16>(nt);
                        e.noteOff.noteId = -1;
                        events.addEvent(e);
                    }
                for (int k = 0; k < 7; ++k) {
                    const int onAt = from + static_cast<int>(k * 0.18 * kSr);
                    if (onAt >= pos && onAt < pos + kBlock) {
                        Event e{};
                        e.type = Event::kNoteOnEvent;
                        e.sampleOffset = onAt - pos;
                        e.noteOn.pitch = static_cast<int16>(notes[k]);
                        e.noteOn.velocity = 0.55f + 0.06f * k;
                        e.noteOn.noteId = -1;
                        events.addEvent(e);
                    }
                }
                data.inputEvents = &events;
            } else {
                data.numInputs = 1;
                data.inputs = &inBus;
                if (sig == JasWaveVst::JwController::DemoSignal::Vocal) genVocal(inL, inR, pos, kBlock, rng);
                else genMusic(inL, inR, pos, kBlock, rng);
            }
            proc->process(data);
        }
    };
    feed(3.2);

    CreateDirectoryW(outDir.c_str(), nullptr);
    auto shot = [&](const std::wstring& suffix) {
        if (!suffix.empty()) feed(0.8);   // cada estado se captura con medidores vivos
        const std::wstring path = outDir + L"\\" + base + suffix + L".png";
        const bool ok = JasWaveUI::renderEditorToPng(ctl, path.c_str(), W, H, 40);
        std::wprintf(L"%ls %ls\n", ok ? L"OK   " : L"FALLO", path.c_str());
        return ok;
    };
    bool ok = shot(L"");
    // Licencia completa a punto de vencer: aviso en la cabecera
    JasWaveLicense::Manager::instance().testOverride(all | JasWaveLicense::StateBits::kExpiringSoon, st);
    ok = shot(L"-por-vencer") && ok;
    // Licencia básica: controles de features con candado
    JasWaveLicense::Manager::instance().testOverride(JasWaveLicense::StateBits::kLicensed, st);
    ok = shot(L"-basica") && ok;
    // Sin licencia: overlay de activación
    JasWaveLicense::UiStatus none;
    none.phase = JasWaveLicense::Phase::Idle;
    JasWaveLicense::Manager::instance().testOverride(0, none);
    ok = shot(L"-sin-licencia") && ok;
    JasWaveLicense::UiStatus wait;
    wait.phase = JasWaveLicense::Phase::WaitingApproval;
    wait.userCode = "ABCD-EF23";
    wait.message = "Esperando aprobación…";
    JasWaveLicense::Manager::instance().testOverride(0, wait);
    ok = shot(L"-activando") && ok;

    if (bus) bus->editoresAbiertos.fetch_sub(1);
    proc->setProcessing(false);
    comp->setActive(false);
    if (cpP && cpC) { cpP->disconnect(cpC); cpC->disconnect(cpP); }
    if (cpP) cpP->release();
    if (cpC) cpC->release();
    proc->release();
    comp->terminate();
    ctrlIface->terminate();
    comp->release();
    ctrlIface->release();
    return ok ? 0 : 1;
}
