// =====================================================================================
//  JasWave Grand Piano - tabla de afinacion y timbre NOTA A NOTA (88 teclas, MIDI 21..108)
//  Solo datos y logica pura (sin SDK VST3 ni UI): la comparten el motor (grand_piano_dsp.h), el procesador,
//  el controlador, el editor y render_test.
//
//  Cada nota tiene 9 propiedades (unidades planas):
//    gain      volumen            dB       -12..+12     (0 = neutro)
//    tune      afinacion fina     cents    -50..+50
//    tone      brillo/tono        %        -100..+100   (shelf de agudos de +-12 dB / filtro de fieltro del martillo)
//    body      cuerpo             %        -100..+100   (campana en la fundamental y graves de la nota, +-9 dB)
//    decay     escala de caida    %        25..400      (100 = natural; log)
//    release   escala de release  %        25..400      (100 = natural; log)
//    hammer    nivel del martillo %        0..200       (100 = natural; 0 = ataque suavizado)
//    pan       paneo              %        -100..+100   (se suma al paneo por registro)
//    velcurve  curva de velocidad %        -100..+100   (+ = mas dinamico, - = mas plano; gamma = 2^(x/100))
//
//  Acceso por parametros VST3 (las 88xN no caben): Note Select + Note Gain.. Note Vel Curve + Note Preset, y el
//  parametro oculto Note Edit Cmd (una orden (nota, propiedad, valor) de 24 bits exactos en un normalizado) que usa
//  el editor para escribir cualquier nota sin tocar la seleccion.
// =====================================================================================
#pragma once

#include "jw_params.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

namespace JasWaveGrandPiano {

constexpr int kNotaMin = 21, kNotaMax = 108, kNotas = 88;
enum NotaProp : int { kNpGain = 0, kNpTune, kNpTone, kNpBody, kNpDecay, kNpRelease, kNpHammer, kNpPan, kNpVelCurve, kNpCount };

struct NotaPropDef {
    const char* key;      // id del manifiesto (ai.parameters[].id)
    const char* name;     // nombre del parametro VST3
    const char* unit;
    double mn, mx, def;
    int decimals;
    bool log;
};
// El formato de cada fila lo lee la prueba web (grand-piano.test.mjs): no reordenar los campos.
inline const NotaPropDef* notaPropDefs() {
    static const NotaPropDef d[kNpCount] = {
        { "note_gain", "Note Gain", "dB", -12.0, 12.0, 0.0, 1, false },
        { "note_tune", "Note Tune", "cents", -50.0, 50.0, 0.0, 1, false },
        { "note_tone", "Note Tone", "%", -100.0, 100.0, 0.0, 0, false },
        { "note_body", "Note Body", "%", -100.0, 100.0, 0.0, 0, false },
        { "note_decay", "Note Decay", "%", 25.0, 400.0, 100.0, 0, true },
        { "note_release", "Note Release", "%", 25.0, 400.0, 100.0, 0, true },
        { "note_hammer", "Note Hammer", "%", 0.0, 200.0, 100.0, 0, false },
        { "note_pan", "Note Pan", "%", -100.0, 100.0, 0.0, 0, false },
        { "note_vel_curve", "Note Vel Curve", "%", -100.0, 100.0, 0.0, 0, false },
    };
    return d;
}
inline const char* notaPropCorto(int p) {
    static const char* n[kNpCount] = { "VOLUMEN", "AFINACION", "TONO", "CUERPO", "DECAY", "RELEASE", "MARTILLO", "PAN", "VEL" };
    return n[p];
}

// Presets de timbre por nota (indice del parametro Note Preset). El ultimo, "Personalizado", no hace nada: lo marca el
// propio plugin cuando se edita una nota a mano.
constexpr int kNotaPresets = 5, kPresetPersonalizado = 4;
inline const char* const* notaPresetLabels() {
    static const char* const l[kNotaPresets] = { "Concierto", "C\xC3\xA1lido worship", "\xC3\x8D" "ntimo", "Brillante pop", "Personalizado" };
    return l;
}

inline const char* notaNombre(int midi) {
    static char buf[4][8];
    static int k = 0;
    static const char* nm[12] = { "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B" };
    char* b = buf[k++ & 3];
    std::snprintf(b, 8, "%s%d", nm[((midi % 12) + 12) % 12], midi / 12 - 1);
    return b;
}
// Etiquetas de Note Select ("A0 (21)" .. "C8 (108)"), duraderas
inline const char* const* notaSelectLabels() {
    static char txt[kNotas][14];
    static const char* ptr[kNotas];
    static bool listo = false;
    if (!listo) {
        for (int i = 0; i < kNotas; ++i) { std::snprintf(txt[i], 14, "%s (%d)", notaNombre(kNotaMin + i), kNotaMin + i); ptr[i] = txt[i]; }
        listo = true;
    }
    return ptr;
}

inline JasWaveVst::ParamDef notaParamDef(uint32_t id, int p) {
    const NotaPropDef& d = notaPropDefs()[p];
    return d.log ? JasWaveVst::logP(id, d.name, d.unit, d.mn, d.mx, d.def, d.decimals)
                 : JasWaveVst::linearP(id, d.name, d.unit, d.mn, d.mx, d.def, d.decimals, d.mn < 0.0);
}
inline double notaToNorm(int p, double plain) { return JasWaveVst::toNorm(notaParamDef(0, p), plain); }
inline double notaFromNorm(int p, double n) { return JasWaveVst::toPlain(notaParamDef(0, p), n); }
inline double notaClamp(int p, double v) { const NotaPropDef& d = notaPropDefs()[p]; return std::clamp(v, d.mn, d.mx); }

// Orden de edicion: 1 bit valido | 7 bits nota (0..87) | 4 bits propiedad | 12 bits valor, dividido entre 2^24
// (24 bits caben exactos en un float: el parametro sobrevive a hosts que cuantizan a precision simple).
constexpr double kCmdEscala = 16777216.0;
inline double notaCmdCodificar(int nota, int prop, double plain) {
    const int idx = std::clamp(nota - kNotaMin, 0, kNotas - 1);
    const int p = std::clamp(prop, 0, kNpCount - 1);
    const int q = static_cast<int>(std::lround(std::clamp(notaToNorm(p, plain), 0.0, 1.0) * 4095.0));
    const uint32_t n = (1u << 23) | (static_cast<uint32_t>(idx) << 16) | (static_cast<uint32_t>(p) << 12) | static_cast<uint32_t>(q);
    return static_cast<double>(n) / kCmdEscala;
}
inline bool notaCmdDecodificar(double norm, int& nota, int& prop, double& plain) {
    if (!(norm >= 0.5) || norm > 1.0) return false;
    const uint32_t n = static_cast<uint32_t>(std::llround(norm * kCmdEscala));
    if (!(n & (1u << 23))) return false;
    const int idx = static_cast<int>((n >> 16) & 0x7F), p = static_cast<int>((n >> 12) & 0xF), q = static_cast<int>(n & 0xFFF);
    if (idx >= kNotas || p >= kNpCount) return false;
    double nn = q / 4095.0;
    const double dn = notaToNorm(p, notaPropDefs()[p].def);
    nota = kNotaMin + idx; prop = p;
    plain = std::fabs(nn - dn) <= 0.5 / 4095.0 + 1.0e-9 ? notaPropDefs()[p].def : notaFromNorm(p, nn);   // el neutro es exacto
    return true;
}

struct NotaTabla {
    float v[kNotas][kNpCount];

    NotaTabla() { neutro(); }
    void neutro() { for (int i = 0; i < kNotas; ++i) neutroNota(i); }
    void neutroNota(int i) { for (int p = 0; p < kNpCount; ++p) v[i][p] = static_cast<float>(notaPropDefs()[p].def); }
    static int indice(int nota) { return nota - kNotaMin; }
    static bool valida(int nota) { return nota >= kNotaMin && nota <= kNotaMax; }
    double get(int nota, int p) const { return valida(nota) ? v[nota - kNotaMin][p] : notaPropDefs()[p].def; }
    // true si el valor cambio
    bool set(int nota, int p, double plain) {
        if (!valida(nota) || p < 0 || p >= kNpCount) return false;
        const float nv = static_cast<float>(notaClamp(p, plain));
        float& r = v[nota - kNotaMin][p];
        if (r == nv) return false;
        r = nv;
        return true;
    }
    bool esNeutra(int nota) const {
        if (!valida(nota)) return true;
        for (int p = 0; p < kNpCount; ++p) if (v[nota - kNotaMin][p] != static_cast<float>(notaPropDefs()[p].def)) return false;
        return true;
    }
    bool esNeutro() const { for (int n = kNotaMin; n <= kNotaMax; ++n) if (!esNeutra(n)) return false; return true; }
    bool operator==(const NotaTabla& o) const { return std::memcmp(v, o.v, sizeof v) == 0; }
    bool operator!=(const NotaTabla& o) const { return !(*this == o); }

    // Presets de fabrica. Son funciones del registro (x = 0 en A0 .. 1 en C8) sobre la tabla NEUTRA: siempre pisan todo.
    void aplicarPreset(int k) {
        neutro();
        if (k <= 0 || k >= kPresetPersonalizado) return;
        auto rampa = [](double a, double b, double x) { return std::clamp((x - a) / (b - a), 0.0, 1.0); };
        for (int n = kNotaMin; n <= kNotaMax; ++n) {
            const int i = n - kNotaMin;
            const double grave = rampa(60.0, 21.0, n);   // 1 en A0, 0 de C4 hacia arriba
            const double agudo = rampa(60.0, 96.0, n);   // 0 hasta C4, 1 en C7
            float* e = v[i];
            if (k == 1) {            // Calido worship: graves llenos, agudos suavizados, release algo mas largo
                e[kNpBody] = static_cast<float>(10.0 + 60.0 * grave);
                e[kNpGain] = static_cast<float>(1.5 * rampa(55.0, 21.0, n) - 1.0 * rampa(84.0, 108.0, n));
                e[kNpTone] = static_cast<float>(-10.0 - 55.0 * agudo);
                e[kNpRelease] = static_cast<float>(125.0 + 25.0 * grave);
                e[kNpDecay] = 110.0f;
                e[kNpHammer] = 85.0f;
            } else if (k == 2) {     // Intimo: martillo suave, brillo bajo, dinamica comprimida
                e[kNpHammer] = 55.0f;
                e[kNpTone] = static_cast<float>(-35.0 - 20.0 * agudo);
                e[kNpGain] = -1.0f;
                e[kNpVelCurve] = -25.0f;
                e[kNpBody] = static_cast<float>(15.0 + 15.0 * grave);
                e[kNpDecay] = 95.0f;
                e[kNpRelease] = 110.0f;
            } else if (k == 3) {     // Brillante pop: martillo marcado, agudos abiertos, caida mas corta
                e[kNpTone] = static_cast<float>(30.0 + 25.0 * agudo);
                e[kNpHammer] = 135.0f;
                e[kNpBody] = static_cast<float>(10.0 * grave);
                e[kNpDecay] = 90.0f;
                e[kNpRelease] = 85.0f;
                e[kNpVelCurve] = 15.0f;
            }
            for (int p = 0; p < kNpCount; ++p) e[p] = static_cast<float>(notaClamp(p, e[p]));
        }
    }
};

// Valores derivados que consume el motor (se recalculan al cambiar la tabla)
struct NotaForma {
    double gain{1.0};       // lineal
    double cents{0.0};
    double tone{0.0};       // -1..1
    double body{0.0};       // -1..1
    double decay{1.0};      // factor de tiempo (>1 = mas largo)
    double release{1.0};
    double hammer{1.0};     // 0..2
    double pan{0.0};        // -1..1
    double velGamma{1.0};
    bool neutra{true};
};
inline NotaForma notaForma(const float* e) {
    NotaForma f;
    f.gain = std::pow(10.0, e[kNpGain] / 20.0);
    f.cents = e[kNpTune];
    f.tone = e[kNpTone] / 100.0;
    f.body = e[kNpBody] / 100.0;
    f.decay = e[kNpDecay] / 100.0;
    f.release = e[kNpRelease] / 100.0;
    f.hammer = e[kNpHammer] / 100.0;
    f.pan = e[kNpPan] / 100.0;
    f.velGamma = std::pow(2.0, e[kNpVelCurve] / 100.0);
    f.neutra = true;
    for (int p = 0; p < kNpCount; ++p) if (e[p] != static_cast<float>(notaPropDefs()[p].def)) f.neutra = false;
    return f;
}

// ---------------------------------------------------------------------------------------
//  Estado persistente de la tabla: bloque que va DESPUES de los pares (id, normalizado) del estado base de jw_vst3.h.
//    int32 'JWNT' | int32 version(1) | int32 notas(88) | int32 propiedades(9) | notas x propiedades x float32 (planos), LE
//  Un estado antiguo no lo trae (tabla neutra); un lector antiguo se detiene tras los pares y no lo ve.
// ---------------------------------------------------------------------------------------
constexpr uint32_t kTablaMagic = 0x4A574E54;   // 'JWNT'
constexpr uint32_t kTablaVersion = 1;
constexpr size_t kTablaCabecera = 16;

inline void notaSerializar(const NotaTabla& t, std::vector<uint8_t>& out) {
    auto u32 = [&](uint32_t x) { for (int i = 0; i < 4; ++i) out.push_back(static_cast<uint8_t>((x >> (8 * i)) & 0xFF)); };
    u32(kTablaMagic); u32(kTablaVersion); u32(kNotas); u32(kNpCount);
    for (int i = 0; i < kNotas; ++i)
        for (int p = 0; p < kNpCount; ++p) { uint32_t b; std::memcpy(&b, &t.v[i][p], 4); u32(b); }
}
// Cabecera de 16 bytes -> numero de notas y de propiedades que siguen (false si no es un bloque de tabla)
inline bool notaLeerCabecera(const uint8_t* h, int& n, int& np) {
    auto u32 = [&](int o) { return static_cast<uint32_t>(h[o]) | (static_cast<uint32_t>(h[o + 1]) << 8) | (static_cast<uint32_t>(h[o + 2]) << 16) | (static_cast<uint32_t>(h[o + 3]) << 24); };
    if (u32(0) != kTablaMagic || u32(4) < 1) return false;
    const uint32_t a = u32(8), b = u32(12);
    if (a == 0 || a > 256 || b == 0 || b > 64) return false;
    n = static_cast<int>(a); np = static_cast<int>(b);
    return true;
}
// `datos` = los n*np floats (n*np*4 bytes). Los valores no finitos quedan neutros y todo se recorta a su rango.
inline void notaDeserializar(const uint8_t* datos, int n, int np, NotaTabla& out) {
    NotaTabla t;
    for (int i = 0; i < n; ++i)
        for (int p = 0; p < np; ++p) {
            const uint8_t* q = datos + (static_cast<size_t>(i) * np + p) * 4;
            const uint32_t b = static_cast<uint32_t>(q[0]) | (static_cast<uint32_t>(q[1]) << 8) | (static_cast<uint32_t>(q[2]) << 16) | (static_cast<uint32_t>(q[3]) << 24);
            float f; std::memcpy(&f, &b, 4);
            if (i < kNotas && p < kNpCount && std::isfinite(f)) t.v[i][p] = static_cast<float>(notaClamp(p, f));
        }
    out = t;
}

// ---------------------------------------------------------------------------------------
//  Sincronizacion entre los parametros Note * y la tabla (la comparten el procesador y el espejo del controlador, y se
//  prueba sin SDK). Trabaja con valores NORMALIZADOS: el llamador rellena NotaParams desde sus parametros, llama a
//  sincronizar() y vuelca de vuelta lo que cambie. Orden de resolucion de una tanda de cambios:
//    1) Note Preset (si cambio y no es "Personalizado"): pisa la tabla entera con el preset
//    2) Note Select: si cambia sin que cambie ninguna propiedad, los parametros pasan a mostrar la nota nueva; si cambia
//       junto con propiedades, esas propiedades son para la nota NUEVA
//    3) propiedades Note *: escriben en la nota elegida (y el preset pasa a "Personalizado")
//    4) Note Edit Cmd: escribe (nota, propiedad, valor) directamente, sin tocar la seleccion
// ---------------------------------------------------------------------------------------
struct NotaParams {
    double sel{0.0}, pre{0.0}, cmd{0.0};
    double prop[kNpCount]{};
};
inline int notaDeSelect(double norm) { return kNotaMin + std::clamp(static_cast<int>(std::floor(std::clamp(norm, 0.0, 1.0) * (kNotas - 1) + 0.5)), 0, kNotas - 1); }
inline double notaSelectNorm(int nota) { return static_cast<double>(std::clamp(nota, kNotaMin, kNotaMax) - kNotaMin) / (kNotas - 1); }
inline int notaPresetDe(double norm) { return static_cast<int>(std::floor(std::clamp(norm, 0.0, 1.0) * (kNotaPresets - 1) + 0.5)); }
inline double notaPresetNormDe(int k) { return static_cast<double>(std::clamp(k, 0, kNotaPresets - 1)) / (kNotaPresets - 1); }

struct NotaSync {
    NotaTabla tabla;
    int sel{60};
    double lastPre{0.0}, lastCmd{0.0}, lastProp[kNpCount]{};
    bool presetAplicado{false};   // la ultima tanda aplico un preset (el controlador vacia su cola de ordenes)

    // Fija el estado de referencia a los parametros actuales y deja las propiedades mostrando la nota elegida
    void iniciar(NotaParams& np) { sel = notaDeSelect(np.sel); cargarSeleccion(np); referencia(np); }
    void referencia(const NotaParams& np) { lastPre = np.pre; lastCmd = np.cmd; for (int p = 0; p < kNpCount; ++p) lastProp[p] = np.prop[p]; }
    void cargarSeleccion(NotaParams& np) const { for (int p = 0; p < kNpCount; ++p) np.prop[p] = notaToNorm(p, tabla.get(sel, p)); }
    void personalizado(NotaParams& np) { np.pre = notaPresetNormDe(kPresetPersonalizado); lastPre = np.pre; }

    // Escritura directa (UI): true si cambio. Mantiene np coherente.
    bool editar(int nota, int prop, double plain, NotaParams& np) {
        if (!tabla.set(nota, prop, plain)) return false;
        personalizado(np);
        if (nota == sel) { np.prop[prop] = notaToNorm(prop, tabla.get(nota, prop)); lastProp[prop] = np.prop[prop]; }
        return true;
    }

    // true si la tabla cambio
    bool sincronizar(NotaParams& np) {
        bool cambio = false;
        presetAplicado = false;
        if (np.pre != lastPre) {
            lastPre = np.pre;
            const int k = notaPresetDe(np.pre);
            if (k >= 0 && k < kPresetPersonalizado) { tabla.aplicarPreset(k); cambio = presetAplicado = true; }
        }
        const int nuevo = notaDeSelect(np.sel);
        bool ch[kNpCount];
        bool alguno = false;
        for (int p = 0; p < kNpCount; ++p) { ch[p] = np.prop[p] != lastProp[p]; alguno = alguno || ch[p]; }
        const bool cambioSel = nuevo != sel;
        sel = nuevo;
        if (presetAplicado) cargarSeleccion(np);
        else if (alguno) {
            for (int p = 0; p < kNpCount; ++p)
                if (ch[p] && tabla.set(sel, p, notaFromNorm(p, np.prop[p]))) { cambio = true; personalizado(np); }
        } else if (cambioSel) cargarSeleccion(np);
        if (np.cmd != lastCmd) {
            lastCmd = np.cmd;
            int n = 0, p = 0;
            double v = 0.0;
            if (notaCmdDecodificar(np.cmd, n, p, v) && tabla.set(n, p, v)) {
                cambio = true;
                personalizado(np);
                if (n == sel) np.prop[p] = notaToNorm(p, tabla.get(n, p));
            }
        }
        for (int p = 0; p < kNpCount; ++p) lastProp[p] = np.prop[p];
        return cambio;
    }
};

} // namespace JasWaveGrandPiano
