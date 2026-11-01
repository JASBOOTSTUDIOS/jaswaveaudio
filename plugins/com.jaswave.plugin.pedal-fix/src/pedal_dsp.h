// =====================================================================================
//  JasWave Pedal Fix – efecto MIDI (sin SDK, sin asignaciones en process)
//   Problema que resuelve: teclados con voz principal + dual + split (Yamaha PSR-E373 y familia) mandan
//   cada pisada del pedal por varios canales a la vez — B0 40 7F · B1 40 7F · B2 40 00 en el mismo
//   milisegundo. Un instrumento omni aplica los mensajes en orden y se queda con el último («suelto»):
//   el sustain nunca se oye. Aquí:
//     - Unificar canales: valor efectivo de cada pedal (CC64/66/67/69) = máximo entre los 16 canales;
//       solo se reenvía cuando cambia (una pisada → un 127; soltar → un 0).
//     - Polaridad: pedales/footswitch invertidos (127 en reposo).
//     - Forzar sustain: mientras el pedal fuente esté pisado, los note-off se retienen y se entregan al
//       soltar (vale para instrumentos que ignoran CC64). Redisparo opcional de notas retenidas.
//     - Canal de salida fijo, transposición y escala de velocidad.
//   Todo el estado cabe en la clase: process() no asigna memoria.
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_params.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>

namespace JasWavePedal {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t {
    kBypass = 0, kUmbral = 1, kTransponer = 2, kVelocidad = 3, kFuente = 4, kCanal = 5,
    kPolaridad = 6, kForzar = 7, kUnificar = 8, kRetrigger = 9
};

constexpr int kNumPedales = 4;
constexpr int kPedalCc[kNumPedales] = { 64, 66, 67, 69 };
// Parámetros ocultos por los que el host entrega los CC del pedal (IMidiMapping): base + pedal·16 + canal
constexpr uint32_t kCcParamBase = 1000;
constexpr uint32_t kCcParamCount = kNumPedales * 16;

inline int indicePedal(int cc) {
    for (int i = 0; i < kNumPedales; ++i) if (kPedalCc[i] == cc) return i;
    return -1;
}
inline uint32_t ccParamId(int pedal, int canal) { return kCcParamBase + static_cast<uint32_t>(pedal * 16 + canal); }
inline bool esCcParam(uint32_t id) { return id >= kCcParamBase && id < kCcParamBase + kCcParamCount; }

inline const char* const* labelsFuente() { static const char* const l[] = { "CC64 Sustain", "CC66 Sostenuto", "CC67 Soft", "CC69 Hold 2" }; return l; }
inline const char* const* labelsPolaridad() { static const char* const l[] = { "Normal", "Inverted" }; return l; }
inline const char* const* labelsCanal() {
    static const char* const l[] = { "Original", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16" };
    return l;
}

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kUmbral, "Pedal Threshold", "", 1.0, 127.0, 64.0, 0));
        v.push_back(linearP(kTransponer, "Transpose", "st", -24.0, 24.0, 0.0, 0, true));
        v.push_back(linearP(kVelocidad, "Velocity Scale", "%", 0.0, 200.0, 100.0, 0));
        v.push_back(stepP(kFuente, "Pedal Source", kNumPedales - 1, 0, labelsFuente()));
        v.push_back(stepP(kCanal, "Output Channel", 16, 0, labelsCanal()));
        v.push_back(stepP(kPolaridad, "Pedal Polarity", 1, 0, labelsPolaridad()));
        v.push_back(toggleP(kForzar, "Force Sustain", 1));
        v.push_back(toggleP(kUnificar, "Merge Channels", 1));
        v.push_back(toggleP(kRetrigger, "Retrigger Held Notes", 1));
        marcarBasicos(v, { kBypass, kFuente, kPolaridad, kForzar, kUnificar, kCanal });
        return v;
    }();
    return defs;
}

struct PedalSettings {
    bool bypass{false};
    int umbral{64};          // valor a partir del cual el pedal cuenta como pisado
    int transponer{0};       // semitonos
    double velocidad{1.0};   // escala de velocidad (1 = sin cambio)
    int fuente{0};           // índice en kPedalCc del pedal que gobierna el sustain
    int canalSalida{-1};     // -1 = conservar el canal de entrada
    bool invertir{false};
    bool forzar{true};
    bool unificar{true};
    bool retrigger{true};
};

// Telemetría hacia el editor (atómicos, sin locks)
struct PedalBus : MeterBusBase {
    PeakMeter inPk[2], outPk[2];
    std::atomic<uint16_t> canalesPedal{0};      // canales con el pedal fuente pisado (tras polaridad)
    std::atomic<int> pedalSalida{0};             // valor efectivo emitido del pedal fuente (0..127)
    std::atomic<int> notasRetenidas{0};          // notas que solo sostiene el pedal
    std::atomic<int> notasPulsadas{0};           // teclas físicamente pulsadas
    std::atomic<uint32_t> ultimoCc{0};           // 0x80000000 | cc<<16 | canal<<8 | valor
    std::atomic<uint16_t> canalesNotas{0};       // canales que han mandado notas (la UI lo decae)
    std::atomic<uint64_t> eventosEntrada{0}, eventosSalida{0}, duplicadosFiltrados{0};
    std::atomic<uint64_t> teclas[2]{};           // notas sonando hacia la salida (pulsadas o retenidas)
};

// Evento de salida, independiente del SDK (el procesador lo traduce a Steinberg::Vst::Event)
struct PedalOut {
    enum Tipo : uint8_t { NoteOn, NoteOff, Cc };
    Tipo tipo;
    int8_t canal;
    int16_t nota;
    float velocidad;
    int16_t cc;
    int16_t valor;
    int32_t offset;
    int32_t noteId;
};

class PedalEngine {
public:
    void reset() {
        for (auto& c : porCanal_) c.fill(0);
        emitido_.fill(-1);
        for (auto& c : emitidoCanal_) c.fill(-1);
        for (auto& k : keyDown_) k = { 0, 0 };
        for (auto& l : latched_) l = { 0, 0 };
        pedalAbajo_ = 0;
        canalesNotas_ = 0;
        ultimoCc_ = 0;
        dupFiltrados_ = 0;
        eventosIn_ = eventosOut_ = 0;
    }

    void setSettings(const PedalSettings& s) {
        // Desactivar «forzar» o entrar en bypass con notas retenidas: se liberan en el siguiente bloque
        if ((s_.forzar && !s.forzar) || (!s_.bypass && s.bypass)) liberarPendiente_ = true;
        s_ = s;
    }
    const PedalSettings& settings() const { return s_; }
    bool liberarPendiente() const { return liberarPendiente_; }

    // ---- eventos de entrada (en orden de offset dentro del bloque) ----
    template <class Emit>
    void noteOn(int ch, int pitch, float vel, int noteId, int offset, Emit&& emit) {
        ++eventosIn_;
        ch = canalValido(ch);
        if (pitch < 0 || pitch > 127) return;
        canalesNotas_ |= static_cast<uint16_t>(1u << ch);
        const int outPitch = std::clamp(pitch + s_.transponer, 0, 127);
        salidaDe_[static_cast<size_t>(ch)][static_cast<size_t>(pitch)] = static_cast<uint8_t>(outPitch);
        if (s_.forzar && bit(latched_[static_cast<size_t>(ch)], pitch)) {
            setBit(latched_[static_cast<size_t>(ch)], pitch, false);
            if (s_.retrigger) emitir(emit, PedalOut{ PedalOut::NoteOff, static_cast<int8_t>(canalSalida(ch)), static_cast<int16_t>(outPitch), 0.0f, 0, 0, offset, noteId });
        }
        setBit(keyDown_[static_cast<size_t>(ch)], pitch, true);
        const float v = static_cast<float>(std::clamp(vel * s_.velocidad, 1.0 / 127.0, 1.0));
        emitir(emit, PedalOut{ PedalOut::NoteOn, static_cast<int8_t>(canalSalida(ch)), static_cast<int16_t>(outPitch), v, 0, 0, offset, noteId });
    }

    template <class Emit>
    void noteOff(int ch, int pitch, float vel, int noteId, int offset, Emit&& emit) {
        ++eventosIn_;
        ch = canalValido(ch);
        if (pitch < 0 || pitch > 127) return;
        setBit(keyDown_[static_cast<size_t>(ch)], pitch, false);
        if (s_.forzar && pedalAbajo(ch)) {
            setBit(latched_[static_cast<size_t>(ch)], pitch, true);   // la suelta la entrega el pedal
            return;
        }
        emitir(emit, PedalOut{ PedalOut::NoteOff, static_cast<int8_t>(canalSalida(ch)), static_cast<int16_t>(salidaDe_[static_cast<size_t>(ch)][static_cast<size_t>(pitch)]), vel, 0, 0, offset, noteId });
    }

    // CC de entrada (0..127). Los pedales conmutados se unifican/deduplican; el resto pasa tal cual.
    template <class Emit>
    void cc(int ch, int cc, int value, int offset, Emit&& emit) {
        ++eventosIn_;
        ch = canalValido(ch);
        value = std::clamp(value, 0, 127);
        const int idx = indicePedal(cc);
        if (idx < 0) {
            emitir(emit, PedalOut{ PedalOut::Cc, static_cast<int8_t>(canalSalida(ch)), 0, 0.0f, static_cast<int16_t>(cc), static_cast<int16_t>(value), offset, -1 });
            return;
        }
        const bool esFuente = idx == s_.fuente;
        const int v = (esFuente && s_.invertir) ? 127 - value : value;
        ultimoCc_ = 0x80000000u | (static_cast<uint32_t>(cc) << 16) | (static_cast<uint32_t>(ch) << 8) | static_cast<uint32_t>(v);
        porCanal_[static_cast<size_t>(idx)][static_cast<size_t>(ch)] = static_cast<uint8_t>(v);
        if (s_.unificar) {
            int mx = 0;
            for (int c = 0; c < 16; ++c) mx = std::max(mx, static_cast<int>(porCanal_[static_cast<size_t>(idx)][static_cast<size_t>(c)]));
            if (mx == emitido_[static_cast<size_t>(idx)]) { ++dupFiltrados_; return; }
            emitido_[static_cast<size_t>(idx)] = mx;
            emitir(emit, PedalOut{ PedalOut::Cc, static_cast<int8_t>(canalSalida(ch)), 0, 0.0f, static_cast<int16_t>(cc), static_cast<int16_t>(mx), offset, -1 });
            if (esFuente) actualizarPedal(mx >= s_.umbral ? 0xFFFFu : 0u, offset, emit);
        } else {
            if (emitidoCanal_[static_cast<size_t>(idx)][static_cast<size_t>(ch)] == v) { ++dupFiltrados_; return; }
            emitidoCanal_[static_cast<size_t>(idx)][static_cast<size_t>(ch)] = v;
            emitir(emit, PedalOut{ PedalOut::Cc, static_cast<int8_t>(canalSalida(ch)), 0, 0.0f, static_cast<int16_t>(cc), static_cast<int16_t>(v), offset, -1 });
            if (esFuente) {
                const uint16_t m = static_cast<uint16_t>(1u << ch);
                actualizarPedal(v >= s_.umbral ? (pedalAbajo_ | m) : (pedalAbajo_ & ~m), offset, emit);
            }
        }
    }

    // Suelta todas las notas retenidas (cambio de ajustes, bypass, stop del host)
    template <class Emit>
    void soltarTodo(int offset, Emit&& emit) {
        liberarPendiente_ = false;
        for (int ch = 0; ch < 16; ++ch) liberarCanal(ch, offset, emit);
    }

    bool pedalAbajo(int ch) const { return (pedalAbajo_ >> canalValido(ch)) & 1u; }
    int valorPedalFuente() const { const int e = emitido_[static_cast<size_t>(s_.fuente)]; return e < 0 ? 0 : e; }
    int notasRetenidas() const { int n = 0; for (const auto& l : latched_) n += popcount(l[0]) + popcount(l[1]); return n; }
    int notasPulsadas() const { int n = 0; for (const auto& k : keyDown_) n += popcount(k[0]) + popcount(k[1]); return n; }
    uint64_t eventosEntrada() const { return eventosIn_; }
    uint64_t eventosSalida() const { return eventosOut_; }
    uint64_t duplicadosFiltrados() const { return dupFiltrados_; }

    void publicar(PedalBus* bus) {
        if (!bus) return;
        bus->canalesPedal.store(pedalAbajo_, std::memory_order_relaxed);
        bus->pedalSalida.store(valorPedalFuente(), std::memory_order_relaxed);
        bus->notasRetenidas.store(notasRetenidas(), std::memory_order_relaxed);
        bus->notasPulsadas.store(notasPulsadas(), std::memory_order_relaxed);
        bus->ultimoCc.store(ultimoCc_, std::memory_order_relaxed);
        if (canalesNotas_) bus->canalesNotas.fetch_or(canalesNotas_, std::memory_order_relaxed);
        canalesNotas_ = 0;
        bus->eventosEntrada.store(eventosIn_, std::memory_order_relaxed);
        bus->eventosSalida.store(eventosOut_, std::memory_order_relaxed);
        bus->duplicadosFiltrados.store(dupFiltrados_, std::memory_order_relaxed);
        uint64_t t0 = 0, t1 = 0;
        for (int ch = 0; ch < 16; ++ch) {
            // teclas hacia la salida: pulsadas o retenidas, en el tono de salida
            for (int p = 0; p < 128; ++p) {
                if (!bit(keyDown_[static_cast<size_t>(ch)], p) && !bit(latched_[static_cast<size_t>(ch)], p)) continue;
                const int o = salidaDe_[static_cast<size_t>(ch)][static_cast<size_t>(p)];
                if (o < 64) t0 |= 1ull << o; else t1 |= 1ull << (o - 64);
            }
        }
        bus->teclas[0].store(t0, std::memory_order_relaxed);
        bus->teclas[1].store(t1, std::memory_order_relaxed);
    }

private:
    using Bits = std::array<uint64_t, 2>;
    static bool bit(const Bits& w, int p) { return (w[static_cast<size_t>(p >> 6)] >> (p & 63)) & 1ull; }
    static void setBit(Bits& w, int p, bool on) {
        if (on) w[static_cast<size_t>(p >> 6)] |= 1ull << (p & 63);
        else w[static_cast<size_t>(p >> 6)] &= ~(1ull << (p & 63));
    }
    static int popcount(uint64_t x) { int n = 0; while (x) { x &= x - 1; ++n; } return n; }
    static int canalValido(int ch) { return ch < 0 ? 0 : (ch > 15 ? 15 : ch); }
    int canalSalida(int ch) const { return s_.canalSalida >= 0 ? s_.canalSalida : ch; }

    template <class Emit>
    void emitir(Emit& emit, const PedalOut& o) { ++eventosOut_; emit(o); }

    template <class Emit>
    void liberarCanal(int ch, int offset, Emit& emit) {
        Bits& l = latched_[static_cast<size_t>(ch)];
        if (!l[0] && !l[1]) return;
        for (int p = 0; p < 128; ++p) {
            if (!bit(l, p)) continue;
            setBit(l, p, false);
            if (bit(keyDown_[static_cast<size_t>(ch)], p)) continue;   // sigue pulsada: la suelta la tecla
            emitir(emit, PedalOut{ PedalOut::NoteOff, static_cast<int8_t>(canalSalida(ch)), static_cast<int16_t>(salidaDe_[static_cast<size_t>(ch)][static_cast<size_t>(p)]), 0.0f, 0, 0, offset, -1 });
        }
    }

    // Nuevo mapa de canales con el pedal pisado: los que pasan de pisado a suelto liberan sus notas retenidas
    template <class Emit>
    void actualizarPedal(uint16_t nuevo, int offset, Emit& emit) {
        const uint16_t soltados = static_cast<uint16_t>(pedalAbajo_ & ~nuevo);
        pedalAbajo_ = nuevo;
        if (!soltados) return;
        for (int ch = 0; ch < 16; ++ch) if ((soltados >> ch) & 1u) liberarCanal(ch, offset, emit);
    }

    PedalSettings s_;
    std::array<std::array<uint8_t, 16>, kNumPedales> porCanal_{};
    std::array<int, kNumPedales> emitido_{ { -1, -1, -1, -1 } };
    std::array<std::array<int, 16>, kNumPedales> emitidoCanal_{};
    std::array<Bits, 16> keyDown_{};
    std::array<Bits, 16> latched_{};
    std::array<std::array<uint8_t, 128>, 16> salidaDe_{};
    uint16_t pedalAbajo_{0};
    uint16_t canalesNotas_{0};
    uint32_t ultimoCc_{0};
    uint64_t eventosIn_{0}, eventosOut_{0}, dupFiltrados_{0};
    bool liberarPendiente_{false};

public:
    PedalEngine() { reset(); }
};

} // namespace JasWavePedal
