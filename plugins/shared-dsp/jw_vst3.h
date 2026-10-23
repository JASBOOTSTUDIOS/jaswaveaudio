// =====================================================================================
//  JasWave – pegamento VST3 compartido
//   - JwParameter : Parameter con mapeo lineal / logarítmico / escalonado y strings reales
//   - JwController: registra la tabla, restaura estado, recibe el bus de telemetría
//   - JwProcessor : aplica cambios de parámetros, guarda/restaura estado, expone el bus al
//                   controlador mediante IConnectionPoint (sin tocar el hilo de audio)
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_params.h"

#include "public.sdk/source/vst/vstaudioeffect.h"
#include "public.sdk/source/vst/vsteditcontroller.h"
#include "public.sdk/source/vst/vstparameters.h"
#include "base/source/fstreamer.h"
#include "pluginterfaces/vst/ivstparameterchanges.h"
#include "pluginterfaces/vst/ivstmessage.h"

#include <memory>
#include <mutex>
#include <unordered_map>

namespace JasWaveVst {

using namespace Steinberg;
using namespace Steinberg::Vst;

constexpr int32 kStateMagic = 0x4A575354; // 'JWST'
constexpr int32 kStateVersion = 1;

inline void asciiToTChar(const char* src, TChar* dst, int cap) {
    int i = 0;
    for (; src && src[i] && i < cap - 1; ++i) dst[i] = static_cast<TChar>(static_cast<unsigned char>(src[i]));
    dst[i] = 0;
}
inline std::string tcharToAscii(const TChar* s) {
    std::string out;
    for (int i = 0; s && s[i] && i < 128; ++i) out.push_back(s[i] < 128 ? static_cast<char>(s[i]) : '?');
    return out;
}
inline bool iequals(const std::string& a, const char* b) {
    size_t n = std::strlen(b);
    if (a.size() != n) return false;
    for (size_t i = 0; i < n; ++i) if (std::tolower(static_cast<unsigned char>(a[i])) != std::tolower(static_cast<unsigned char>(b[i]))) return false;
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
            for (int i = 0; i <= def_.steps; ++i) if (iequals(a, def_.labels[i])) { n = JasWaveVst::toNorm(def_, i); return true; }
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
        i.flags = ParameterInfo::kCanAutomate;
        if (d.bypass) i.flags |= ParameterInfo::kIsBypass;
        if (d.map == Map::Stepped && d.steps > 1 && d.labels) i.flags |= ParameterInfo::kIsList;
        return i;
    }
    ParamDef def_;
};

// ---- Controlador base ----
class JwController : public EditController {
public:
    explicit JwController(const std::vector<ParamDef>& defs) : table_(defs) {}

    tresult PLUGIN_API initialize(FUnknown* context) SMTG_OVERRIDE {
        const tresult r = EditController::initialize(context);
        if (r != kResultOk) return r;
        for (const auto& d : table_.defs()) parameters.addParameter(new JwParameter(d));
        return kResultOk;
    }

    tresult PLUGIN_API setComponentState(IBStream* state) SMTG_OVERRIDE {
        if (!state) return kResultFalse;
        IBStreamer s(state, kLittleEndian);
        int32 magic = 0, ver = 0, n = 0;
        if (!s.readInt32(magic) || magic != kStateMagic) return kResultFalse;
        s.readInt32(ver);
        s.readInt32(n);
        for (int32 i = 0; i < n; ++i) {
            double v = 0.0;
            if (!s.readDouble(v)) break;
            if (i < table_.count()) setParamNormalized(table_.at(i).id, v);
        }
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

    std::shared_ptr<JasWaveDsp::MeterBusBase> bus() const {
        std::lock_guard<std::mutex> lk(busMutex_);
        return bus_;
    }
    void setBus(std::shared_ptr<JasWaveDsp::MeterBusBase> b) {   // usado por tests / vista previa
        std::lock_guard<std::mutex> lk(busMutex_);
        bus_ = std::move(b);
    }

    const ParamTable& table() const { return table_; }
    double plain(ParamID id) const {
        const ParamDef* d = table_.find(id);
        return d ? JasWaveVst::toPlain(*d, getParamNormalized(id)) : 0.0;
    }

protected:
    ParamTable table_;
    mutable std::mutex busMutex_;
    std::shared_ptr<JasWaveDsp::MeterBusBase> bus_;
};

// ---- Procesador base ----
class JwProcessor : public AudioEffect {
public:
    JwProcessor(const std::vector<ParamDef>& defs, const FUID& controllerUid) : table_(defs) {
        setControllerClass(controllerUid);
        norm_.resize(static_cast<size_t>(table_.count()));
        for (int i = 0; i < table_.count(); ++i) norm_[static_cast<size_t>(i)] = defaultNorm(table_.at(i));
    }
    ~JwProcessor() SMTG_OVERRIDE { if (busId_) BusRegistry::get().remove(busId_); }

    tresult PLUGIN_API canProcessSampleSize(int32 s) SMTG_OVERRIDE {
        return (s == kSample32 || s == kSample64) ? kResultTrue : kResultFalse;
    }

    tresult PLUGIN_API setBusArrangements(SpeakerArrangement* inputs, int32 numIns,
                                          SpeakerArrangement* outputs, int32 numOuts) SMTG_OVERRIDE {
        if (numIns != 1 || numOuts != 1) return kResultFalse;
        if (inputs[0] != outputs[0]) return kResultFalse;
        if (inputs[0] != SpeakerArr::kStereo && inputs[0] != SpeakerArr::kMono) return kResultFalse;
        removeAudioBusses();
        addAudioInput(STR16("Input"), inputs[0]);
        addAudioOutput(STR16("Output"), outputs[0]);
        return kResultTrue;
    }

    tresult PLUGIN_API setState(IBStream* state) SMTG_OVERRIDE {
        if (!state) return kResultFalse;
        IBStreamer s(state, kLittleEndian);
        int32 magic = 0, ver = 0, n = 0;
        if (!s.readInt32(magic) || magic != kStateMagic) return kResultFalse;
        s.readInt32(ver);
        s.readInt32(n);
        for (int32 i = 0; i < n && i < table_.count(); ++i) {
            double v = 0.0;
            if (!s.readDouble(v)) break;
            norm_[static_cast<size_t>(i)] = clamp01(v);
        }
        paramsDirty_ = true;
        return kResultOk;
    }
    tresult PLUGIN_API getState(IBStream* state) SMTG_OVERRIDE {
        if (!state) return kResultFalse;
        IBStreamer s(state, kLittleEndian);
        s.writeInt32(kStateMagic);
        s.writeInt32(kStateVersion);
        s.writeInt32(table_.count());
        for (int i = 0; i < table_.count(); ++i) s.writeDouble(norm_[static_cast<size_t>(i)]);
        return kResultOk;
    }

    tresult PLUGIN_API connect(IConnectionPoint* other) SMTG_OVERRIDE {
        const tresult r = AudioEffect::connect(other);
        sendBusMessage();
        return r;
    }

protected:
    void registerBus(std::shared_ptr<JasWaveDsp::MeterBusBase> bus) {
        bus_ = std::move(bus);
        busId_ = BusRegistry::get().add(bus_);
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
    // Último valor de cada cola del bloque (suavizado en DSP -> sin zipper noise)
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
                if (idx < 0 || pts <= 0) continue;
                int32 off = 0; ParamValue v = 0.0;
                if (q->getPoint(pts - 1, off, v) == kResultTrue) { norm_[static_cast<size_t>(idx)] = clamp01(v); changed = true; }
            }
        }
        return changed;
    }
    double plainOf(ParamID id) const {
        const int i = table_.index(id);
        return i < 0 ? 0.0 : JasWaveVst::toPlain(table_.at(i), norm_[static_cast<size_t>(i)]);
    }

    ParamTable table_;
    std::vector<double> norm_;
    bool paramsDirty_{true};
    std::shared_ptr<JasWaveDsp::MeterBusBase> bus_;
    uint64_t busId_{0};
};

} // namespace JasWaveVst
