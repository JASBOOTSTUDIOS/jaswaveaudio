// =====================================================================================
//  JasWave – pegamento VST3 compartido por todos los plugins independientes
//   - JwParameter : Parameter con mapeo lineal / logarítmico / escalonado y textos reales
//   - JwProcessor : buses, 32/64 bit, cambios de parámetros, estado versionado (+legado),
//                   licencia (lectura atómica por bloque), telemetría al controlador
//   - JwController: tabla de parámetros, estado, bus de telemetría, IMidiMapping, editor
//  Ningún método del hilo de audio asigna memoria ni toma locks.
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_params.h"
#include "jw_license.h"

#include "public.sdk/source/vst/vstaudioeffect.h"
#include "public.sdk/source/vst/vsteditcontroller.h"
#include "public.sdk/source/vst/vstparameters.h"
#include "base/source/fstreamer.h"
#include "pluginterfaces/base/ibstream.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/ivstmessage.h"
#include "pluginterfaces/vst/ivstmidicontrollers.h"
#include "pluginterfaces/vst/ivstparameterchanges.h"

#include <cctype>
#include <functional>
#include <memory>
#include <mutex>
#include <unordered_map>

namespace JasWaveUI { class PluginEditor; }

namespace JasWaveVst {

using namespace Steinberg;
using namespace Steinberg::Vst;

constexpr int32 kStateMagic = 0x4A575354; // 'JWST'
constexpr int32 kExtraMagic = 0x4A575845; // 'JWXE': bloque de estado extra opcional tras los pares
constexpr int32 kStateVersion = 2;        // v2: pares (id, normalizado); v1: valores en orden de tabla

// ---- Descriptor de producto (manifiesto V5 ⇄ código) ----
struct FeatureDef {
    const char* key;     // license.features[].key
    const char* label;   // texto corto para la UI
};

struct PluginDescriptor {
    const char* productId;            // = manifiesto.id = productId de licencia
    const char* displayName;          // nombre comercial
    const wchar_t* uiTitle;           // título en la cabecera del editor
    const FeatureDef* features;
    int featureCount;
    bool instrument;
    // Efecto MIDI: audio estéreo de paso + bus de eventos de entrada y de salida (el plugin reescribe el MIDI
    // en processEvents()). Compatible con la inicialización agregada de los plugins existentes.
    bool midiFx = false;
};

inline void configureLicense(const PluginDescriptor& d) {
    const char* keys[24] = {};
    const int n = d.featureCount < 24 ? d.featureCount : 24;
    for (int i = 0; i < n; ++i) keys[i] = d.features[i].key;   // el Manager copia las cadenas
    JasWaveLicense::Manager::instance().configure({ d.productId, keys, n });
}

inline void asciiToTChar(const char* src, TChar* dst, int cap) {
    // UTF-8 -> UTF-16 (BMP) para títulos con acentos
    int i = 0, o = 0;
    while (src && src[i] && o < cap - 1) {
        const unsigned char c = static_cast<unsigned char>(src[i]);
        uint32_t cp = c;
        if (c >= 0xE0 && src[i + 1] && src[i + 2]) { cp = ((c & 0x0F) << 12) | ((src[i + 1] & 0x3F) << 6) | (src[i + 2] & 0x3F); i += 3; }
        else if (c >= 0xC0 && src[i + 1]) { cp = ((c & 0x1F) << 6) | (src[i + 1] & 0x3F); i += 2; }
        else { ++i; }
        dst[o++] = static_cast<TChar>(cp);
    }
    dst[o] = 0;
}
inline std::string tcharToAscii(const TChar* s) {
    std::string out;
    for (int i = 0; s && s[i] && i < 128; ++i) out.push_back(s[i] < 128 ? static_cast<char>(s[i]) : '?');
    return out;
}
inline bool iequals(const std::string& a, const char* b) {
    const size_t n = std::strlen(b);
    if (a.size() != n) return false;
    for (size_t i = 0; i < n; ++i)
        if (std::tolower(static_cast<unsigned char>(a[i])) != std::tolower(static_cast<unsigned char>(b[i]))) return false;
    return true;
}

// ---- Registro de buses de telemetría (resuelve id -> bus dentro del mismo módulo) ----
class BusRegistry {
public:
    static BusRegistry& get() { static BusRegistry r; return r; }
    uint64_t add(const std::shared_ptr<JasWaveDsp::MeterBusBase>& b) {
        std::lock_guard<std::mutex> lk(m_);
        const uint64_t id = ++next_;
        map_[id] = b;
        return id;
    }
    void remove(uint64_t id) { std::lock_guard<std::mutex> lk(m_); map_.erase(id); }
    std::shared_ptr<JasWaveDsp::MeterBusBase> find(uint64_t id) {
        std::lock_guard<std::mutex> lk(m_);
        auto it = map_.find(id);
        return it == map_.end() ? nullptr : it->second.lock();
    }
private:
    std::mutex m_;
    uint64_t next_{0};
    std::unordered_map<uint64_t, std::weak_ptr<JasWaveDsp::MeterBusBase>> map_;
};

// ---- Parámetro con mapeo propio ----
class JwParameter : public Parameter {
public:
    explicit JwParameter(const ParamDef& d) : Parameter(makeInfo(d)), def_(d) { precision = d.decimals; }

    void toString(ParamValue n, String128 s) const SMTG_OVERRIDE {
        asciiToTChar(formatValue(def_, JasWaveVst::toPlain(def_, n), false).c_str(), s, 128);
    }
    bool fromString(const TChar* s, ParamValue& n) const SMTG_OVERRIDE {
        const std::string a = tcharToAscii(s);
        if (a.empty()) return false;
        if (def_.map == Map::Stepped && def_.labels) {
            for (int i = 0; i <= def_.steps; ++i)
                if (iequals(a, def_.labels[i])) { n = JasWaveVst::toNorm(def_, i); return true; }
        }
        char* end = nullptr;
        double v = std::strtod(a.c_str(), &end);
        if (end == a.c_str()) return false;
        while (*end == ' ') ++end;
        if ((*end == 'k' || *end == 'K') && def_.units && std::strcmp(def_.units, "Hz") == 0) v *= 1000.0;
        n = JasWaveVst::toNorm(def_, v);
        return true;
    }
    ParamValue toPlain(ParamValue n) const SMTG_OVERRIDE { return JasWaveVst::toPlain(def_, n); }
    ParamValue toNormalized(ParamValue p) const SMTG_OVERRIDE { return JasWaveVst::toNorm(def_, p); }
    const ParamDef& def() const { return def_; }

private:
    static ParameterInfo makeInfo(const ParamDef& d) {
        ParameterInfo i{};
        i.id = d.id;
        asciiToTChar(d.name, i.title, 128);
        asciiToTChar(d.name, i.shortTitle, 128);
        asciiToTChar(d.units ? d.units : "", i.units, 128);
        i.stepCount = d.map == Map::Stepped ? d.steps : 0;
        i.defaultNormalizedValue = defaultNorm(d);
        i.unitId = kRootUnitId;
        if (d.readOnly) i.flags = ParameterInfo::kIsReadOnly;
        else i.flags = ParameterInfo::kCanAutomate;
        if (d.bypass) i.flags |= ParameterInfo::kIsBypass;
        if (d.map == Map::Stepped && d.steps >= 1 && d.labels) i.flags |= ParameterInfo::kIsList;
        return i;
    }
    ParamDef def_;
};

// ---- Estado: escritura v2 y lectura v1/v2/legado (compartido Processor/Controller) ----
using LegacyStateFn = std::function<bool(IBStream*, const ParamTable&, std::vector<double>&)>;

inline bool readStateInto(IBStream* state, const ParamTable& table, std::vector<double>& norm, const LegacyStateFn& legacy) {
    if (!state) return false;
    int64 start = 0;
    state->tell(&start);
    IBStreamer s(state, kLittleEndian);
    int32 magic = 0;
    if (!s.readInt32(magic) || magic != kStateMagic) {
        if (!legacy) return false;
        state->seek(start, IBStream::kIBSeekSet, nullptr);
        return legacy(state, table, norm);
    }
    int32 ver = 0, n = 0;
    if (!s.readInt32(ver) || !s.readInt32(n) || n < 0 || n > 4096) return false;
    for (int32 i = 0; i < n; ++i) {
        if (ver >= 2) {
            int32 id = 0;
            double v = 0.0;
            if (!s.readInt32(id) || !s.readDouble(v)) break;
            const int idx = table.index(static_cast<uint32_t>(id));
            if (idx >= 0 && !table.at(idx).readOnly && std::isfinite(v)) norm[static_cast<size_t>(idx)] = clamp01(v);
        } else {
            double v = 0.0;
            if (!s.readDouble(v)) break;
            if (i < table.count() && std::isfinite(v)) norm[static_cast<size_t>(i)] = clamp01(v);
        }
    }
    return true;
}

inline void writeState(IBStream* state, const ParamTable& table, const std::vector<double>& norm) {
    IBStreamer s(state, kLittleEndian);
    int32 n = 0;
    for (int i = 0; i < table.count(); ++i) if (!table.at(i).readOnly) ++n;
    s.writeInt32(kStateMagic);
    s.writeInt32(kStateVersion);
    s.writeInt32(n);
    for (int i = 0; i < table.count(); ++i) {
        if (table.at(i).readOnly) continue;
        s.writeInt32(static_cast<int32>(table.at(i).id));
        s.writeDouble(norm[static_cast<size_t>(i)]);
    }
}

// Ayuda para estados legados del bundle JasWaveFx: lista de doubles normalizados en orden de id
// (0..count-1). `convert(id, legacyNorm)` devuelve el normalizado nuevo (o <0 para ignorar).
inline bool readLegacyDoubles(IBStream* state, const ParamTable& table, std::vector<double>& norm, int count,
                              const std::function<double(uint32_t, double)>& convert) {
    IBStreamer s(state, kLittleEndian);
    bool any = false;
    for (int i = 0; i < count; ++i) {
        double v = 0.0;
        if (!s.readDouble(v)) break;
        if (!std::isfinite(v)) continue;
        const double nv = convert ? convert(static_cast<uint32_t>(i), clamp01(v)) : clamp01(v);
        const int idx = table.index(static_cast<uint32_t>(i));
        if (idx >= 0 && nv >= 0.0 && !table.at(idx).readOnly) { norm[static_cast<size_t>(idx)] = clamp01(nv); any = true; }
    }
    return any;
}

// Lista de eventos del bloque = notas del teclado del editor (offset 0) seguidas de las del host.
// Vive en el procesador: sin asignaciones en el hilo de audio.
class EventosConTeclado : public IEventList {
public:
    static constexpr int32 kMax = 32;
    void reset(IEventList* host) { host_ = host; n_ = 0; }
    void add(int nota, float velocidad) {
        if (n_ >= kMax) return;
        Event& e = ui_[static_cast<size_t>(n_++)];
        e = Event{};
        e.busIndex = 0;
        e.sampleOffset = 0;
        if (velocidad > 0.0f) {
            e.type = Event::kNoteOnEvent;
            e.noteOn.channel = 0;
            e.noteOn.pitch = static_cast<int16>(nota);
            e.noteOn.velocity = velocidad;
            e.noteOn.noteId = -1;
        } else {
            e.type = Event::kNoteOffEvent;
            e.noteOff.channel = 0;
            e.noteOff.pitch = static_cast<int16>(nota);
            e.noteOff.velocity = 0.0f;
            e.noteOff.noteId = -1;
        }
    }
    int32 count() const { return n_; }
    int32 PLUGIN_API getEventCount() SMTG_OVERRIDE { return n_ + (host_ ? host_->getEventCount() : 0); }
    tresult PLUGIN_API getEvent(int32 index, Event& e) SMTG_OVERRIDE {
        if (index < 0) return kInvalidArgument;
        if (index < n_) { e = ui_[static_cast<size_t>(index)]; return kResultOk; }
        return host_ ? host_->getEvent(index - n_, e) : kInvalidArgument;
    }
    tresult PLUGIN_API addEvent(Event&) SMTG_OVERRIDE { return kResultFalse; }
    tresult PLUGIN_API queryInterface(const TUID, void** obj) SMTG_OVERRIDE { if (obj) *obj = nullptr; return kNoInterface; }
    uint32 PLUGIN_API addRef() SMTG_OVERRIDE { return 1; }
    uint32 PLUGIN_API release() SMTG_OVERRIDE { return 1; }
private:
    IEventList* host_{nullptr};
    std::array<Event, kMax> ui_{};
    int32 n_{0};
};

// ---- Procesador base ----
class JwProcessor : public AudioEffect {
public:
    JwProcessor(const PluginDescriptor& desc, const std::vector<ParamDef>& defs, const FUID& controllerUid)
        : desc_(desc), table_(defs) {
        setControllerClass(controllerUid);
        norm_.resize(static_cast<size_t>(table_.count()));
        for (int i = 0; i < table_.count(); ++i) norm_[static_cast<size_t>(i)] = defaultNorm(table_.at(i));
        scratchL32_.assign(static_cast<size_t>(maxBlock_), 0.0f);
        scratchR32_.assign(static_cast<size_t>(maxBlock_), 0.0f);
        scratchL64_.assign(static_cast<size_t>(maxBlock_), 0.0);
        scratchR64_.assign(static_cast<size_t>(maxBlock_), 0.0);
        configureLicense(desc_);
    }
    ~JwProcessor() SMTG_OVERRIDE {
        if (busId_) BusRegistry::get().remove(busId_);
        if (licAcquired_) JasWaveLicense::Manager::instance().release();
    }

    tresult PLUGIN_API initialize(FUnknown* context) SMTG_OVERRIDE {
        const tresult r = AudioEffect::initialize(context);
        if (r != kResultOk) return r;
        if (desc_.instrument) {
            addEventInput(STR16("MIDI In"), 16);
        } else {
            addAudioInput(STR16("Stereo In"), SpeakerArr::kStereo);
            if (desc_.midiFx) {
                addEventInput(STR16("MIDI In"), 16);
                addEventOutput(STR16("MIDI Out"), 16);
            }
        }
        addAudioOutput(STR16("Stereo Out"), SpeakerArr::kStereo);
        if (!licAcquired_) { JasWaveLicense::Manager::instance().acquire(); licAcquired_ = true; }
        return kResultOk;
    }
    tresult PLUGIN_API terminate() SMTG_OVERRIDE {
        if (licAcquired_) { JasWaveLicense::Manager::instance().release(); licAcquired_ = false; }
        return AudioEffect::terminate();
    }

    tresult PLUGIN_API canProcessSampleSize(int32 s) SMTG_OVERRIDE {
        return (s == kSample32 || s == kSample64) ? kResultTrue : kResultFalse;
    }

    tresult PLUGIN_API setBusArrangements(SpeakerArrangement* inputs, int32 numIns, SpeakerArrangement* outputs, int32 numOuts) SMTG_OVERRIDE {
        if (desc_.instrument) {
            if (numIns != 0 || numOuts != 1) return kResultFalse;
            if (outputs[0] != SpeakerArr::kStereo && outputs[0] != SpeakerArr::kMono) return kResultFalse;
            return AudioEffect::setBusArrangements(inputs, numIns, outputs, numOuts);
        }
        if (numIns != 1 || numOuts != 1) return kResultFalse;
        if (inputs[0] != outputs[0]) return kResultFalse;
        if (inputs[0] != SpeakerArr::kStereo && inputs[0] != SpeakerArr::kMono) return kResultFalse;
        return AudioEffect::setBusArrangements(inputs, numIns, outputs, numOuts);
    }

    tresult PLUGIN_API setupProcessing(ProcessSetup& setup) SMTG_OVERRIDE {
        const tresult r = AudioEffect::setupProcessing(setup);
        sr_ = setup.sampleRate > 0 ? setup.sampleRate : 48000.0;
        maxBlock_ = setup.maxSamplesPerBlock > 0 ? setup.maxSamplesPerBlock : 4096;
        scratchL32_.assign(static_cast<size_t>(maxBlock_), 0.0f);
        scratchR32_.assign(static_cast<size_t>(maxBlock_), 0.0f);
        scratchL64_.assign(static_cast<size_t>(maxBlock_), 0.0);
        scratchR64_.assign(static_cast<size_t>(maxBlock_), 0.0);
        if (bus_) bus_->sampleRate.store(sr_);
        prepare(sr_, maxBlock_);
        paramsDirty_ = true;
        return r;
    }

    tresult PLUGIN_API setActive(TBool state) SMTG_OVERRIDE {
        if (state) { resetDsp(); paramsDirty_ = true; }
        return AudioEffect::setActive(state);
    }
    tresult PLUGIN_API setProcessing(TBool) SMTG_OVERRIDE { return kResultOk; }

    tresult PLUGIN_API setState(IBStream* state) SMTG_OVERRIDE {
        std::vector<double> n = norm_;
        if (!readStateInto(state, table_, n, legacyState())) return kResultFalse;
        // Estado extra opcional (cadena propia del plugin tras los pares id/valor; los plugins que no lo usan no escriben nada)
        {
            IBStreamer s(state, kLittleEndian);
            int32 m = 0, len = 0;
            if (s.readInt32(m) && m == kExtraMagic && s.readInt32(len) && len > 0 && len < 65536) {
                std::string ex(static_cast<size_t>(len), '\0');
                int32 got = 0;
                if (state->read(&ex[0], len, &got) == kResultOk && got == len) loadExtraState(ex);
            }
        }
        // Se aplica en el siguiente process() (el host serializa setState con process)
        norm_ = n;
        paramsDirty_ = true;
        return kResultOk;
    }
    tresult PLUGIN_API getState(IBStream* state) SMTG_OVERRIDE {
        if (!state) return kResultFalse;
        writeState(state, table_, norm_);
        const std::string ex = saveExtraState();
        if (!ex.empty() && ex.size() < 65536) {
            IBStreamer s(state, kLittleEndian);
            s.writeInt32(kExtraMagic);
            s.writeInt32(static_cast<int32>(ex.size()));
            int32 w = 0;
            state->write(const_cast<char*>(ex.data()), static_cast<int32>(ex.size()), &w);
        }
        return kResultOk;
    }

    tresult PLUGIN_API connect(IConnectionPoint* other) SMTG_OVERRIDE {
        const tresult r = AudioEffect::connect(other);
        sendBusMessage();
        return r;
    }

    uint32 PLUGIN_API getLatencySamples() SMTG_OVERRIDE { return latencySamples(); }
    uint32 PLUGIN_API getTailSamples() SMTG_OVERRIDE { return tailSamples(); }

    tresult PLUGIN_API process(ProcessData& data) SMTG_OVERRIDE {
        JasWaveDsp::ScopedNoDenormals noDenormals;
        const bool changed = applyParamChanges(data);
        lic_ = JasWaveLicense::Manager::instance().state();   // atómico, sin bloqueo
        if (changed || lic_ != lastLic_) { updateParams(); lastLic_ = lic_; }
        if (data.numSamples <= 0) return kResultOk;            // flush de parámetros
        // Efectos MIDI: los eventos se procesan aunque el host no conecte audio (p. ej. pista MIDI sin entrada)
        if (desc_.midiFx) processEvents(data);
        if (data.numOutputs < 1 || !data.outputs || data.outputs[0].numChannels < 1) return kResultOk;
        const int32 outCh = data.outputs[0].numChannels;
        if (!desc_.instrument && (data.numInputs < 1 || !data.inputs || data.inputs[0].numChannels < 1)) return kResultOk;

        // Instrumentos: las teclas pulsadas con el ratón en el editor suenan como MIDI de entrada
        IEventList* const eventosHost = data.inputEvents;
        if (desc_.instrument && bus_) {
            eventosTeclado_.reset(eventosHost);
            bus_->notasUi.drenar([this](int nota, float vel) { eventosTeclado_.add(nota, vel); }, EventosConTeclado::kMax);
            if (eventosTeclado_.count() > 0) data.inputEvents = &eventosTeclado_;
        }

        int32 done = 0;
        while (done < data.numSamples) {
            const int32 n = std::min<int32>(data.numSamples - done, maxBlock_);
            if (data.symbolicSampleSize == kSample64) runChunk<double>(data, done, n, outCh);
            else runChunk<float>(data, done, n, outCh);
            done += n;
        }
        data.inputEvents = eventosHost;
        data.outputs[0].silenceFlags = 0;
        writeOutputParams(data);
        return kResultOk;
    }

    const ParamTable& table() const { return table_; }

protected:
    // ---- a implementar por cada plugin ----
    virtual void prepare(double sampleRate, int maxBlock) = 0;
    virtual void resetDsp() = 0;
    virtual void updateParams() = 0;   // leer plainOf()/licensed()/feature() y pasar a los motores
    // Procesa n muestras estéreo (in* nulos en instrumentos). Las salidas pueden ser alias de las entradas.
    virtual void render(const float* inL, const float* inR, float* outL, float* outR, int n, int offset, ProcessData& data) = 0;
    virtual void render(const double* inL, const double* inR, double* outL, double* outR, int n, int offset, ProcessData& data) = 0;
    virtual uint32 latencySamples() { return 0; }
    virtual uint32 tailSamples() { return static_cast<uint32>(sr_ * 0.25); }
    virtual LegacyStateFn legacyState() { return nullptr; }
    // Estado extra opcional (p. ej. el kit de la bateria por nombre): se guarda tras los pares id/valor; vacio = no escribe nada
    virtual std::string saveExtraState() { return {}; }
    virtual void loadExtraState(const std::string&) {}
    virtual void writeOutputParams(ProcessData&) {}
    // Efectos MIDI (PluginDescriptor::midiFx): reescribir data.inputEvents / inputParameterChanges en data.outputEvents.
    // Se llama una vez por bloque, antes del audio, con los offsets de muestra del bloque completo.
    virtual void processEvents(ProcessData&) {}

    // ---- utilidades ----
    bool licensed() const { return JasWaveLicense::isLicensed(lic_); }
    bool feature(int idx) const { return JasWaveLicense::hasFeature(lic_, idx); }
    double plainOf(ParamID id) const {
        const int i = table_.index(id);
        if (i < 0) return 0.0;
        const ParamDef& d = table_.at(i);
        // feature no concedida => valor por defecto (función desactivada en DSP)
        if (d.feature >= 0 && !feature(d.feature)) return d.defV;
        return JasWaveVst::toPlain(d, norm_[static_cast<size_t>(i)]);
    }
    bool boolOf(ParamID id) const { return plainOf(id) >= 0.5; }
    int intOf(ParamID id) const { return static_cast<int>(std::lround(plainOf(id))); }

    void registerBus(std::shared_ptr<JasWaveDsp::MeterBusBase> bus) {
        bus_ = std::move(bus);
        busId_ = BusRegistry::get().add(bus_);
    }
    void writeOutputParam(ProcessData& data, ParamID id, double normalized) {
        if (!data.outputParameterChanges) return;
        int32 qi = 0;
        if (IParamValueQueue* q = data.outputParameterChanges->addParameterData(id, qi)) {
            int32 pi = 0;
            q->addPoint(0, clamp01(normalized), pi);
        }
    }

    const PluginDescriptor& desc_;
    ParamTable table_;
    std::vector<double> norm_;
    double sr_{48000.0};
    int32 maxBlock_{4096};
    uint64_t lic_{0};
    std::shared_ptr<JasWaveDsp::MeterBusBase> bus_;

private:
    EventosConTeclado eventosTeclado_;   // notas del teclado del editor + MIDI del host (instrumentos)

    template <class T>
    std::vector<T>& scratchL();
    template <class T>
    std::vector<T>& scratchR();

    template <class T>
    void runChunk(ProcessData& data, int32 off, int32 n, int32 outCh) {
        T** outs = reinterpret_cast<T**>(data.symbolicSampleSize == kSample64 ? static_cast<void*>(data.outputs[0].channelBuffers64)
                                                                              : static_cast<void*>(data.outputs[0].channelBuffers32));
        if (!outs || !outs[0]) return;
        T* oL = outs[0] + off;
        T* oR = outCh >= 2 && outs[1] ? outs[1] + off : scratchR<T>().data();
        const T* iL = nullptr;
        const T* iR = nullptr;
        if (!desc_.instrument) {
            T** ins = reinterpret_cast<T**>(data.symbolicSampleSize == kSample64 ? static_cast<void*>(data.inputs[0].channelBuffers64)
                                                                                 : static_cast<void*>(data.inputs[0].channelBuffers32));
            if (!ins || !ins[0]) { for (int32 c = 0; c < outCh; ++c) if (outs[c]) std::fill(outs[c] + off, outs[c] + off + n, T(0)); return; }
            const int32 inCh = data.inputs[0].numChannels;
            iL = ins[0] + off;
            if (inCh >= 2 && ins[1]) iR = ins[1] + off;
            else {
                // mono: duplicamos la entrada para que la salida R (descartada) no pise L
                std::copy(iL, iL + n, scratchL<T>().data());
                iR = scratchL<T>().data();
            }
        }
        render(iL, iR, oL, oR, n, off, data);
        for (int32 c = 2; c < outCh; ++c) if (outs[c]) std::fill(outs[c] + off, outs[c] + off + n, T(0));
    }

    bool applyParamChanges(ProcessData& data) {
        bool changed = paramsDirty_;
        paramsDirty_ = false;
        if (IParameterChanges* ch = data.inputParameterChanges) {
            const int32 n = ch->getParameterCount();
            for (int32 i = 0; i < n; ++i) {
                IParamValueQueue* q = ch->getParameterData(i);
                if (!q) continue;
                const int idx = table_.index(q->getParameterId());
                const int32 pts = q->getPointCount();
                if (idx < 0 || pts <= 0 || table_.at(idx).readOnly) continue;
                int32 off = 0;
                ParamValue v = 0.0;
                if (q->getPoint(pts - 1, off, v) == kResultTrue && std::isfinite(v)) {
                    norm_[static_cast<size_t>(idx)] = clamp01(v);
                    changed = true;
                }
            }
        }
        return changed;
    }
    void sendBusMessage() {
        if (!busId_) return;
        if (IMessage* m = allocateMessage()) {
            m->setMessageID("JwBus");
            m->getAttributes()->setInt("JwBusId", static_cast<int64>(busId_));
            sendMessage(m);
            m->release();
        }
    }

    bool paramsDirty_{true};
    bool licAcquired_{false};
    uint64_t lastLic_{~0ull};
    uint64_t busId_{0};
    std::vector<float> scratchL32_, scratchR32_;
    std::vector<double> scratchL64_, scratchR64_;
};

template <> inline std::vector<float>& JwProcessor::scratchL<float>() { return scratchL32_; }
template <> inline std::vector<float>& JwProcessor::scratchR<float>() { return scratchR32_; }
template <> inline std::vector<double>& JwProcessor::scratchL<double>() { return scratchL64_; }
template <> inline std::vector<double>& JwProcessor::scratchR<double>() { return scratchR64_; }

// ---- Controlador base ----
class JwController : public EditController, public IMidiMapping {
public:
    JwController(const PluginDescriptor& desc, const std::vector<ParamDef>& defs) : desc_(desc), table_(defs) { configureLicense(desc_); }
    ~JwController() SMTG_OVERRIDE { if (licAcquired_) JasWaveLicense::Manager::instance().release(); }

    tresult PLUGIN_API initialize(FUnknown* context) SMTG_OVERRIDE {
        const tresult r = EditController::initialize(context);
        if (r != kResultOk) return r;
        for (const auto& d : table_.defs()) parameters.addParameter(new JwParameter(d));
        if (!licAcquired_) { JasWaveLicense::Manager::instance().acquire(); licAcquired_ = true; }
        return kResultOk;
    }
    tresult PLUGIN_API terminate() SMTG_OVERRIDE {
        if (licAcquired_) { JasWaveLicense::Manager::instance().release(); licAcquired_ = false; }
        {
            std::lock_guard<std::mutex> lk(busMutex_);
            bus_.reset();
        }
        return EditController::terminate();
    }

    tresult PLUGIN_API setComponentState(IBStream* state) SMTG_OVERRIDE {
        std::vector<double> n(static_cast<size_t>(table_.count()));
        for (int i = 0; i < table_.count(); ++i) n[static_cast<size_t>(i)] = defaultNorm(table_.at(i));
        if (!readStateInto(state, table_, n, legacyState())) return kResultFalse;
        for (int i = 0; i < table_.count(); ++i)
            if (!table_.at(i).readOnly) setParamNormalized(table_.at(i).id, n[static_cast<size_t>(i)]);
        return kResultOk;
    }

    tresult PLUGIN_API notify(IMessage* message) SMTG_OVERRIDE {
        if (message && message->getMessageID() && std::strcmp(message->getMessageID(), "JwBus") == 0) {
            int64 id = 0;
            if (message->getAttributes() && message->getAttributes()->getInt("JwBusId", id) == kResultOk) {
                std::lock_guard<std::mutex> lk(busMutex_);
                bus_ = BusRegistry::get().find(static_cast<uint64_t>(id));
            }
            return kResultOk;
        }
        return EditController::notify(message);
    }

    // IMidiMapping
    tresult PLUGIN_API getMidiControllerAssignment(int32 busIndex, int16 /*channel*/, CtrlNumber cc, ParamID& id) SMTG_OVERRIDE {
        if (busIndex != 0) return kResultFalse;
        const int p = midiCcParam(cc);
        if (p < 0) return kResultFalse;
        id = static_cast<ParamID>(p);
        return kResultTrue;
    }

    IPlugView* PLUGIN_API createView(FIDString name) SMTG_OVERRIDE;   // jw_ui_view.cpp

    std::shared_ptr<JasWaveDsp::MeterBusBase> bus() const {
        std::lock_guard<std::mutex> lk(busMutex_);
        return bus_;
    }
    const ParamTable& table() const { return table_; }
    const PluginDescriptor& descriptor() const { return desc_; }
    double plain(ParamID id) const {
        const ParamDef* d = table_.find(id);
        return d ? JasWaveVst::toPlain(*d, const_cast<JwController*>(this)->getParamNormalized(id)) : 0.0;
    }
    // Modo del editor [ BÁSICO | AVANZADO ] de esta instancia (1 = Avanzado, por defecto). Se guarda en el estado del
    // controlador (getState/setState), así cada instancia del plugin reabre su editor en el último modo usado.
    int modoEditor() const { return modoEditor_; }
    void setModoEditor(int modo) {
        const int m = modo == 0 ? 0 : 1;
        if (m == modoEditor_) return;
        modoEditor_ = m;
        if (componentHandler) {
            IComponentHandler2* h2 = nullptr;
            if (componentHandler->queryInterface(IComponentHandler2::iid, reinterpret_cast<void**>(&h2)) == kResultOk && h2) {
                h2->setDirty(true);
                h2->release();
            }
        }
    }
    tresult PLUGIN_API setState(IBStream* state) SMTG_OVERRIDE {
        if (!state) return kResultFalse;
        IBStreamer s(state, kLittleEndian);
        int32 magic = 0, version = 0, modo = 1;
        if (s.readInt32(magic) && magic == kUiStateMagic && s.readInt32(version) && version >= 1 && s.readInt32(modo)) modoEditor_ = modo == 0 ? 0 : 1;
        return kResultOk;
    }
    tresult PLUGIN_API getState(IBStream* state) SMTG_OVERRIDE {
        if (!state) return kResultFalse;
        IBStreamer s(state, kLittleEndian);
        s.writeInt32(kUiStateMagic);
        s.writeInt32(1);
        s.writeInt32(modoEditor_);
        return kResultOk;
    }

    // Editor específico de cada plugin
    virtual std::unique_ptr<JasWaveUI::PluginEditor> createEditor() = 0;
    // Solo herramienta de capturas: ajustes de demostración (valores planos) y tipo de señal
    struct DemoParam { uint32_t id; double plain; };
    virtual std::vector<DemoParam> demoPreset() const { return {}; }
    enum class DemoSignal { Music, Vocal, Midi };
    virtual DemoSignal demoSignal() const { return desc_.instrument ? DemoSignal::Midi : DemoSignal::Music; }

    OBJ_METHODS(JwController, EditController)
    DEFINE_INTERFACES
        DEF_INTERFACE(IMidiMapping)
    END_DEFINE_INTERFACES(EditController)
    REFCOUNT_METHODS(EditController)

protected:
    virtual int midiCcParam(int /*cc*/) const { return -1; }
    virtual LegacyStateFn legacyState() { return nullptr; }

    const PluginDescriptor& desc_;
    ParamTable table_;
    mutable std::mutex busMutex_;
    std::shared_ptr<JasWaveDsp::MeterBusBase> bus_;
    bool licAcquired_{false};
    static constexpr int32 kUiStateMagic = 0x4A575549;   // 'JWUI': estado del controlador (solo UI)
    int modoEditor_{1};
};

} // namespace JasWaveVst
