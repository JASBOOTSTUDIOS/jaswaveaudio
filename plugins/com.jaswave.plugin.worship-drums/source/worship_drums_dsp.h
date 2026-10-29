// =====================================================================================
//  JasWave Worship Drums – batería acústica de worship moderno por síntesis física (sin muestras)
//
//  Mapa GM (el resto de notas se IGNORAN: nunca suenan como plato):
//    35/36 bombo (35 algo más grave y suave)        37 cross-stick (aro)
//    38 caja (ghost por velocidad baja, rim-crack     40 rimshot (parche + aro, siempre con crack)
//       progresivo por encima de vel 0.8)
//    41/43/45/47/48/50 toms (floor grave -> alto)
//    42 hi-hat cerrado  44 hi-hat de pedal  46 hi-hat abierto  (42/44 cortan el 46, 44 corta también el 42)
//    49 crash 1  57 crash 2  55 splash  52 china  51 ride (arco)  59 ride 2  53 campana de ride
//
//  Síntesis
//   - Bombo: oscilador con barrido de tono + saturación por velocidad + resonancia de parche (modos) +
//     click de pedal y "slap" (ruido filtrado).
//   - Caja: parche circular (8 modos con razones de las raíces de Bessel) + tick de baqueta + bordonos
//     (ruido con resonancia) cuya amplitud sigue a la vibración del parche + crack de aro.
//   - Toms: fundamental con caída de tono + 5 modos + baqueta; amortiguación (toms_damp) acorta T60.
//   - Platos / hi-hat: 24..40 modos inarmónicos con T60 dependiente de la frecuencia + ruido filtrado en
//     bandas con "swell" (crecida del wash); hi-hat con apertura continua (velocidad + CC4 pedal);
//     crash/splash/china se ahogan al repetir; la china tiene flutter de AM.
//   - Cada golpe es distinto (round-robin orgánico): microafinación, fase de los modos, ruido, T60 y
//     peso de cada modo salen de un PRNG por golpe; el timbre cambia con la velocidad (brillo, ataque,
//     afinación, cuerpo), no solo el volumen.
//   - Simpatía: la señal directa excita 6 resonadores de toms y los bordonos de la caja.
//   - Micrófonos: directo (pan por elemento) + overheads (pan + retardo interaural por posición, aire)
//     + sala (reflexiones tempranas + FDN de 8 líneas con matriz de Hadamard y amortiguación,
//     compresión suave de sala).
//   - Polifonía 40 (+24 huecos para voces que se desvanecen), robo de la voz más antigua con
//     fundido de 5 ms; salida con soft-clip y sin DC.
// =====================================================================================
#pragma once

#include "jw_dsp.h"
#include "jw_params.h"
#include "jw_sampler.h"
#include "jw_fxrack.h"
#include "worship_drums_kits.h"

#if defined(_M_X64) || defined(__SSE2__)
#include <emmintrin.h>
#define JW_DRUMS_SSE2 1
#endif

namespace JasWaveWorshipDrums {

using namespace JasWaveDsp;
using namespace JasWaveVst;

enum : uint32_t {
    kKickTune = 0, kSnareSnap = 1, kTomsDamp = 2, kOverheadAir = 3, kRoomBlend = 4, kBypass = 5, kVolume = 6,
    kRoomComp = 7, kShellsLevel = 8, kCymbalLevel = 9, kHatFoot = 10,
    // Bloques de mezcla añadidos (ids nuevos al final: la automatización existente no cambia)
    kBusComp = 11, kTape = 12, kRoomWarm = 13, kSmooth = 14,
    // v2 (batería acústica multimicrófono): ids nuevos al final
    kCloseLevel = 15, kAmbLevel = 16,
    // v3 (cuerpo y pegada de caja y toms): ids nuevos al final
    kShellBody = 17, kShellPunch = 18, kSnareBody = 19, kTomsBody = 20, kSnareTune = 21, kTomsTune = 22,
    // v4 (kits de batería y percusión auxiliar): ids nuevos al final
    kKit = 23, kPercLevel = 24
};
enum Feature : int { kFeatRoom = 0 };

constexpr int kVoiceSlots = 64;     // huecos de voz (incluye las que se desvanecen)
constexpr int kPolyphony = 40;      // voces simultáneas sin fundido
constexpr int kMaxModes = 44;
constexpr int kMaxBands = 4;
constexpr int kChunk = 128;
constexpr int kElementCap = 6;
// v3: valores por defecto de cuerpo/pegada (ajustados con las medidas de render_test.cpp) y fundamentales medidas del banco
constexpr double kDefShellBody = 65.0, kDefShellPunch = 65.0;
constexpr double kSnareBodyHz = 165.0;   // hueco de la caja del banco: casi nada bajo 160 Hz (125 Hz esta 25 dB bajo el pico de 215 Hz)
constexpr int kNumToms = 6;
constexpr int kTomNote[kNumToms] = { 41, 43, 45, 47, 48, 50 };
// Fundamental sostenida (Hz) de cada tom del banco (pico espectral 50-500 ms de las muestras, capas 45..115, con la afinacion de su zona): 41..50
constexpr double kTomFundHz[kNumToms] = { 61.0, 68.5, 88.0, 98.0, 121.0, 136.0 };
// Cuerpo y pegada: cantidades maximas por pieza (a 100 % de Shell Body / Shell Punch) y capas sinteticas
constexpr int kBodySn = 8, kBodyTm = 12;
constexpr int kSnEq = 3, kTmEq = 3;   // filtros de EQ por pieza (caja: cuerpo, recorte, presencia; toms: fundamental, ataque, baqueta)
constexpr double kTmResGain = 0.9;   // ganancia del resonador de la fundamental de cada tom al 100 % de Toms Body
constexpr double kTomTrimDb[kNumToms] = { -1.5, -1.6, -5.9, -5.4, -5.1, -5.1 };   // nivel por tom (dB) tras la curva de velocidad: las capas de cada tom saltan en velocidades distintas
constexpr double kSnBodyDb = 3.0, kSnBoxDb = -2.5, kSnPresDb = 9.0;   // caja: campana 180 Hz, recorte de la caja de carton 450 Hz, presencia 3,8 kHz (el hueco bajo 160 Hz lo llena la capa sintetizada)
constexpr double kTmFundDb = 3.0, kTmAtkDb = 9.0, kTmStickDb = 4.0;   // toms: fundamental (ademas del resonador), ataque 4,8 kHz, cuerpo de baqueta 2,2 kHz
constexpr double kSnShapeDb = 5.0, kTmShapeDb = 6.0;                                     // realce de transitorio al 100 %
constexpr double kSnParMix = 0.20, kTmParMix = 0.12;                                     // mezcla de la compresion/saturacion paralela al 100 % de punch
constexpr double kParThrDb = -28.0, kParRatio = 6.0, kParMakeupDb = 8.0;                 // compresor paralelo por pieza (unidades del bus)
constexpr double kSnBodyAmp = 0.70, kSnNoiseAmp = 0.12, kTmTickAmp = 0.12, kSnBodyT60 = 0.26;
constexpr double kShellSideDb = -2.0;   // recorte del canal lateral (overheads + sala de la muestra) de caja y toms: mas directos
constexpr double kVelLiftSn = 0.9, kVelLiftTm = 0.9;   // generosidad de la curva de velocidad al 100 % de Shell Punch (v' = v + k v (1 - v))
// Fundamental propia (Hz) del bombo del banco (pico espectral 40-130 Hz, 30-200 ms, de la mezcla KdrumR+KdrumL de la nota 36 (la 35 usa el bombo grave, ~46 Hz)). kick_tune = este valor -> 0 cents.
constexpr double kKickRefHz = 76.0;
// Nota interna (fuera del mapa GM) del hi-hat semiabierto del banco (posiciones intermedias del pedal)
constexpr int kHatSemiNote = 100;      // golpes simultáneos por elemento antes de desvanecer el más viejo

inline const std::vector<ParamDef>& paramDefs() {
    static const std::vector<ParamDef> defs = [] {
        std::vector<ParamDef> v;
        // Afinación natural: el valor por defecto es la fundamental propia de la muestra del bombo (0 cents de transposición)
        v.push_back(linearP(kKickTune, "Kick Tuning", "Hz", 35.0, 100.0, kKickRefHz, 1));
        v.push_back(linearP(kSnareSnap, "Snare Snap", "%", 0.0, 100.0, 65.0, 0));
        v.push_back(linearP(kTomsDamp, "Toms Damping", "%", 0.0, 100.0, 25.0, 0));
        v.push_back(linearP(kOverheadAir, "Overhead Air", "%", 0.0, 100.0, 55.0, 0));
        v.push_back(withFeature(linearP(kRoomBlend, "Room Blend", "%", 0.0, 100.0, 45.0, 0), kFeatRoom));
        v.push_back(toggleP(kBypass, "Bypass", 0, true));
        v.push_back(linearP(kVolume, "Master Volume", "dB", -24.0, 6.0, 0.0, 1, true));
        v.push_back(linearP(kRoomComp, "Room Compression", "%", 0.0, 100.0, 30.0, 0));
        v.push_back(linearP(kShellsLevel, "Shells Level", "dB", -12.0, 6.0, 0.0, 1, true));
        v.push_back(linearP(kCymbalLevel, "Cymbals Level", "dB", -12.0, 6.0, 0.0, 1, true));
        v.push_back(linearP(kHatFoot, "Hi-Hat Pedal (CC4)", "%", 0.0, 100.0, 100.0, 0));
        v.push_back(linearP(kBusComp, "Parallel Compression", "%", 0.0, 100.0, 15.0, 0));
        v.push_back(linearP(kTape, "Tape Saturation", "%", 0.0, 100.0, 6.0, 0));
        v.push_back(withFeature(linearP(kRoomWarm, "Room Warmth", "%", 0.0, 100.0, 60.0, 0), kFeatRoom));
        v.push_back(linearP(kSmooth, "Cymbal Smoothing", "%", 0.0, 100.0, 40.0, 0));
        v.push_back(linearP(kCloseLevel, "Close Mic Level", "dB", -12.0, 6.0, 0.0, 1, true));          // centro de la mezcla de cada pieza (micros cercanos)
        v.push_back(linearP(kAmbLevel, "Overhead & Room Mic Level", "dB", -12.0, 6.0, 0.0, 1, true));   // lados (overheads + ambiente real del kit)
        // v3: cuerpo y pegada de caja y toms (el kit de muestras es una mezcla lejana con poco directo: ver medidas en render_test.cpp)
        v.push_back(linearP(kShellBody, "Shell Body", "%", 0.0, 100.0, kDefShellBody, 0));            // cuerpo de caja y toms: EQ de fundamental + capa sintetizada (0 % = muestra original)
        v.push_back(linearP(kShellPunch, "Shell Punch", "%", 0.0, 100.0, kDefShellPunch, 0));         // pegada: transitorio, presencia, curva de velocidad y compresion/saturacion paralela por pieza
        v.push_back(linearP(kSnareBody, "Snare Body", "%", 0.0, 150.0, 100.0, 0));                    // ajuste fino del cuerpo de la caja (100 % = el de Shell Body)
        v.push_back(linearP(kTomsBody, "Toms Body", "%", 0.0, 150.0, 100.0, 0));                      // ajuste fino del cuerpo de los toms
        v.push_back(linearP(kSnareTune, "Snare Body Tuning", "Hz", 110.0, 260.0, kSnareBodyHz, 1));   // afinacion de la capa sintetizada de la caja (la muestra suena a ~215 Hz y no tiene nada bajo 160 Hz)
        v.push_back(linearP(kTomsTune, "Toms Body Tuning", "ct", -300.0, 300.0, 0.0, 0, true));       // desplaza la fundamental de los toms (EQ y capa sintetizada)
        // v4: kit de batería (lista de los kits instalados; sus nombres salen de kit.json y se publican en kitLabels()) y nivel de la percusión auxiliar
        v.push_back(stepP(kKit, "Drum Kit", kMaxKits - 1, 0, kitLabels().ptr));
        v.push_back(linearP(kPercLevel, "Percusion Level", "dB", -24.0, 6.0, 0.0, 1, true));
        marcarBasicos(v, { kBypass, kVolume, kKickTune, kSnareSnap, kTomsDamp, kRoomBlend, kShellsLevel, kCymbalLevel, kKit });   // modo Básico
        JW_FXRACK_REGISTRAR(v);   // FX Rack comun (ids 100..): EQ de 6 bandas, compresor, saturacion, chorus, delay, reverb, anchura (tras toda la cadena propia)
        return v;
    }();
    return defs;
}

struct DrumSettings {
    double kickTuneHz{kKickRefHz}, snareSnap{0.65}, tomsDamp{0.25}, air{0.55}, roomBlend{0.45}, roomComp{0.30};
    double busComp{0.15}, tape{0.06}, roomWarm{0.60}, smooth{0.40};
    double shellsDb{0.0}, cymbalDb{0.0}, hatFoot{1.0}, volumeDb{0.0};
    double closeDb{0.0}, ambDb{0.0};
    double shellBody{kDefShellBody / 100.0}, shellPunch{kDefShellPunch / 100.0}, snareBody{1.0}, tomsBody{1.0};
    double snareTuneHz{kSnareBodyHz}, tomsTuneCents{0.0};
    double percDb{0.0};      // nivel de la percusión auxiliar (dB)
    int kitIndex{0};         // kit elegido (posición en la lista de kits instalados)
    bool bypass{false};
};

// Elementos del kit
enum El : int {
    kElKick = 0, kElSnare, kElRim, kElSide,
    kElTom0, kElTom1, kElTom2, kElTom3, kElTom4, kElTom5,   // 41,43,45,47,48,50
    kElHatC, kElHatP, kElHatO, kElRide, kElRide2, kElBell, kElCrash1, kElCrash2, kElSplash, kElChina,
    kNumEl
};
inline int elementForNote(int note) {
    switch (note) {
        case 35: case 36: return kElKick;
        case 37: return kElSide;
        case 38: return kElSnare;
        case 40: return kElRim;
        case 41: return kElTom0; case 43: return kElTom1; case 45: return kElTom2;
        case 47: return kElTom3; case 48: return kElTom4; case 50: return kElTom5;
        case 42: return kElHatC; case 44: return kElHatP; case 46: return kElHatO;
        case 49: return kElCrash1; case 57: return kElCrash2; case 55: return kElSplash; case 52: return kElChina;
        case 51: return kElRide; case 59: return kElRide2; case 53: return kElBell;
        case 78: return kElBell;   // campana de crash: muestra real si el kit o el banco de percusión la traen; si no, el modelo de campana (más grave y larga)
        default: return -1;
    }
}
// ---------------------------------------------------------------------------------
//  Modo híbrido: banco de muestras `worship-drums.jws` (MuldjordKit, CC BY 4.0, Lars Muldjord / FreePats; ver
//  plugins/samples/tools/muldjord_kit2jws.py). Si el banco está cargado y tiene zona para la nota, el golpe suena
//  con muestras reales (mapa GM remapeado al convertir); si no (banco ausente, nota sin muestra como el
//  cross-stick 37), suena el motor modelado de siempre.
//  Un Sampler por familia -> bus propio con nivel, envíos (directo / overheads / sala) y parámetros propios:
//    kBusKick  36/35         kick_tune = afinación (cents) de las muestras
//    kBusSnare 38/40         snare_snap = shelf de agudos + ganancia (transitorio)
//    kBusToms  41..50        toms_damp = tiempo hasta el apagado del parche (note-off interno + release)
//    kBusHats  42/44/46      choke por grupos del banco (cerrado/pedal cortan al abierto)
//    kBusCym   49/57/55/52/51/59/53   colas naturales completas; overhead_air actúa por el camino de overheads
//
//  v3 – cuerpo y pegada de caja y toms (parámetros 17..22: Shell Body, Shell Punch, Snare Body, Toms Body, Snare Body Tuning, Toms Body Tuning).
//  Diagnóstico medido del banco: la caja no tiene nada bajo 160 Hz (el tercio de 125 Hz está ~28 dB bajo su pico de 215 Hz), su presencia de 2,5-4 kHz está ~17 dB
//  bajo ese pico y los toms 41/43/48/50 tienen el ataque de baqueta 25-28 dB bajo su fundamental; las capas de velocidad medias (50-100) son 6-11 dB más suaves que
//  la capa máxima. Los paso-altos por pieza NO eran la causa (la caja no tiene energía bajo 80 Hz y el tom más grave suena a 61 Hz: -0,4 dB con el paso-alto de 30 Hz).
//  Por pieza y a partir de las muestras: curva de velocidad generosa (v' = v + k v (1 - v), solo caja y toms), EQ (caja: campana 180 Hz, recorte 450 Hz,
//  presencia 3,8 kHz; toms: campana en la fundamental de cada tom, 2,2 y 4,8 kHz), realce de transitorio, compresión + saturación paralela, capa de cuerpo
//  sintetizada (caja: seno con caída de afinación + segundo modo + ruido en banda; toms: resonador modal en la fundamental de cada tom, excitado por la propia muestra
//  para que sume en fase, + tic de baqueta), menos lado (overheads/sala) y compensación de nivel (kBusTrimDb / kTomTrimDb) para conservar la relación con el bombo.
//  Con Shell Body = Shell Punch = 0 la caja y los toms suenan como el banco original (el bombo sube +2,5 dB en cualquier caso).
// ---------------------------------------------------------------------------------
enum Bus : int { kBusKick = 0, kBusSnare, kBusToms, kBusHats, kBusCym, kBusPerc, kNumBus };
inline int busForNote(int note) {
    switch (note) {
        case 35: case 36: return kBusKick;
        case 38: case 40: return kBusSnare;
        case 41: case 43: case 45: case 47: case 48: case 50: return kBusToms;
        case 42: case 44: case 46: return kBusHats;
        case 49: case 57: case 55: case 52: case 51: case 59: case 53: case 78: return kBusCym;
        default: return -1;
    }
}
constexpr const char* kBankSlug = "worship-drums";
// Envíos por bus {directo, overheads, sala} y ajuste fino de nivel (dB) medido con el banco convertido
constexpr double kBusRoute[kNumBus][3] = {
    // v2: las muestras ya son mezclas estéreo con overheads y ambiente reales -> el directo lleva casi todo, el camino de
    // overheads solo añade el "aire" (shelf) y la reverb propia es un refuerzo de la sala real, no su sustituto
    { 1.00, 0.10, 0.90 },   // bombo
    { 1.00, 0.15, 0.90 },   // caja
    { 1.00, 0.15, 0.85 },   // toms
    { 0.85, 0.25, 0.60 },   // hi-hat
    { 0.45, 0.70, 0.60 },   // platos
    { 0.85, 0.40, 0.60 },   // percusión auxiliar (palmas, pandereta, cencerro, congas...): igual que el resto de piezas, con envío a overheads y sala
};
// v3: la caja compensa el realce (EQ, transitorio, paralelo, curva de velocidad, capa de cuerpo: +5 dB de nivel propio) y el bombo sube +2,5 dB para que la
// caja a 0,7 de velocidad siga 3-4 dB por debajo del bombo (RMS 0-300 ms) con mas cuerpo; los toms se compensan por tom (kTomTrimDb)
constexpr double kBusTrimDb[kNumBus] = { 2.5, -5.4, 0.0, 0.0, 0.0, 0.0 };

// Grupo de pad para la UI (14 pads)
inline int padForElement(int el) {
    if (el == kElKick) return 0;
    if (el <= kElSide) return 1;
    if (el <= kElTom5) return 2 + (el - kElTom0);
    if (el <= kElHatO) return 8;
    if (el <= kElBell) return 9;
    if (el == kElCrash1) return 10;
    if (el == kElCrash2) return 11;
    if (el == kElSplash) return 12;
    return 13;
}
constexpr int kNumPads = 14;

struct DrumBus : MeterBusBase {
    PeakMeter outPk[2];
    std::atomic<int> activeVoices{0};
    std::atomic<int> maxVoices{kPolyphony};
    std::atomic<float> pad[kNumPads]{};   // velocidad del último golpe por pad (la UI lo consume con exchange)
    // v4: kits (el motor publica aquí el catálogo y el estado para el editor; nada de esto toca el hilo de audio salvo átomos)
    std::shared_ptr<const KitList> kits;  // acceso con std::atomic_load/store
    std::atomic<int> kitActivo{-1};       // posición del kit cargado (-1 = ninguno: suena el motor modelado)
    std::atomic<int> kitEstado{0};        // KitService::Estado
    std::atomic<uint64_t> maskKit[2]{}, maskPerc[2]{};   // notas GM con muestras (kit cargado / banco de percusión)
};

// ---------------------------------------------------------------------------------
//  Utilidades
// ---------------------------------------------------------------------------------
struct Rng {
    uint32_t s{0x9E3779B9u};
    inline uint32_t next() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s; }
    inline double u() { return (next() >> 8) * (1.0 / 16777216.0); }                 // [0,1)
    inline double bi() { return static_cast<double>(static_cast<int32_t>(next())) * (1.0 / 2147483648.0); }   // [-1,1)
    inline double jit(double amount) { return bi() * amount; }
    void seed(uint32_t a) { s = a ? a : 0x1234567u; for (int i = 0; i < 4; ++i) next(); }
};
inline double velAmp(double v) { return std::max(0.02, std::pow(v, 1.25)); }
inline double smooth01(double x) { x = clampT(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }

struct Mode { double c{0}, r2{0}, y1{0}, y2{0}; };
struct Band {
    double b0{0}, b1{0}, b2{0}, a1{0}, a2{0}, z1{0}, z2{0};
    double amp{0}, ed{1}, dd{1}, ea{0}, da{0};   // salida = filtro(ruido) * amp * ed * (1 - ea)
    bool on{false};
    uint32_t rng{1};   // ruido propio: podar una banda no altera el ruido de las demás
};

// ---------------------------------------------------------------------------------
//  v3: capa de cuerpo sintetizada bajo la muestra (caja y toms)
//   - caja: sinusoide con caida de afinacion (thump del casco, que la muestra no tiene bajo 160 Hz) + segundo modo del parche
//           + banda de ruido (bordonas / crack) con caida rapida
//   - toms: "thump" corto con caida de afinacion hacia la fundamental del tom + tic de baqueta (ruido en banda)
//  La parte coherente en fase con la muestra (fundamental sostenida de cada tom) la hacen los resonadores/EQ de cada tom.
// ---------------------------------------------------------------------------------
inline double fastSinTurns(double p) {   // seno de p vueltas (error < 5e-6)
    p -= std::floor(p);
    if (p > 0.5) p -= 1.0;
    if (p > 0.25) p = 0.5 - p; else if (p < -0.25) p = -0.5 - p;
    const double x = p * 6.283185307179586, x2 = x * x;
    return x * (1.0 + x2 * (-1.0 / 6.0 + x2 * (1.0 / 120.0 + x2 * (-1.0 / 5040.0 + x2 * (1.0 / 362880.0)))));
}
struct BodyVoice {
    bool active{false};
    int64_t order{0};
    double invSr{1.0 / 48000.0};
    double ph1{0}, ph2{0}, f1{100}, df{0}, pe{1}, pDec{0.99}, ratio2{1.594};
    double a1{0}, d1{0.999}, a2{0}, d2{0.999};
    double nAmp{0}, nDec{0.99};
    double ramp{0}, rampInc{0.01};
    double stealMul{1.0};
    uint32_t rng{1};
    BiquadCoefs nc;
    BiquadState ns;
    inline double tick() {
        const double f = f1 + df * pe;
        pe *= pDec;
        ph1 += f * invSr; if (ph1 >= 1.0) ph1 -= 1.0;
        double y = a1 * fastSinTurns(ph1);
        a1 *= d1;
        if (a2 > 1.0e-6) {
            ph2 += f * ratio2 * invSr; if (ph2 >= 1.0) ph2 -= 1.0;
            y += a2 * fastSinTurns(ph2);
            a2 *= d2;
        }
        if (nAmp > 1.0e-6) {
            rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
            y += biquadProcess(nc, ns, static_cast<double>(static_cast<int32_t>(rng)) * (1.0 / 2147483648.0)) * nAmp;
            nAmp *= nDec;
        }
        if (ramp < 1.0) { ramp += rampInc; y *= ramp; }
        if (stealMul != 1.0) { a1 *= stealMul; a2 *= stealMul; nAmp *= stealMul; }
        if (a1 < 1.0e-5 && a2 < 1.0e-5 && nAmp < 1.0e-5) active = false;
        return y;
    }
};

// Especificación de platos
struct CymSpec {
    int n; double fmin, fmax, t60lo, t60hi, tilt, pingF, pingA; uint32_t seed;
    double modeLevel;
    int b1type; double b1f, b1q, b1a, b1t, b1swell;     // type 0 = paso banda, 1 = paso alto
    int b2type; double b2f, b2q, b2a, b2t, b2swell;
    double tickF, tickQ, tickA, tickT;
    double flutterDepth, flutterHz;
    double lowF, lowQ, lowA, lowT, lowSwell;            // "wash" grave: ruido continuo que rellena entre los modos graves
};
// 0 hat, 1 ride, 2 bell, 3 crash1, 4 crash2, 5 splash, 6 china
inline const CymSpec& cymSpec(int i) {
    static const CymSpec S[7] = {
        { 24, 2400, 13800, 0.14, 0.05, 0.25, 0, 0, 11, 0.55, 1, 6500, 0.7, 0.55, 0.065, 0.0, 0, 9500, 1.2, 0.35, 0.09, 0.0, 6200, 1.0, 0.45, 0.0012, 0, 0,  3500, 0.8, 0.12, 0.06, 0.0 },
        { 34, 400, 12500, 3.6, 1.1, 0.20, 3300, 2.0, 23, 0.40, 0, 5800, 0.8, 0.28, 1.5, 0.004, 1, 9000, 0.7, 0.14, 0.9, 0.0, 5200, 1.4, 0.55, 0.003, 0, 0,  1800, 0.9, 0.22, 2.2, 0.006 },
        { 14, 620, 9500, 3.0, 1.2, 0.10, 1900, 4.0, 31, 0.55, 0, 3800, 1.0, 0.12, 0.8, 0.0, 0, 3800, 1.0, 0.0, 0.1, 0.0, 4500, 2.0, 0.50, 0.002, 0, 0,  1500, 1.2, 0.05, 1.5, 0.0 },
        { 40, 330, 14000, 3.8, 1.6, 0.18, 0, 0, 47, 0.38, 0, 3600, 0.55, 0.65, 3.2, 0.020, 1, 8000, 0.7, 0.42, 2.2, 0.012, 4800, 0.8, 0.50, 0.004, 0, 0,  1300, 0.7, 0.55, 3.0, 0.030 },
        { 36, 380, 14500, 3.2, 1.4, 0.18, 0, 0, 53, 0.38, 0, 3900, 0.55, 0.65, 2.6, 0.016, 1, 8500, 0.7, 0.42, 1.8, 0.010, 5200, 0.8, 0.50, 0.0035, 0, 0, 1500, 0.7, 0.50, 2.5, 0.025 },
        { 26, 900, 15000, 1.1, 0.4, 0.20, 0, 0, 61, 0.45, 1, 9000, 0.7, 0.50, 0.6, 0.004, 0, 6000, 0.8, 0.34, 0.7, 0.0, 7000, 1.0, 0.50, 0.002, 0, 0,  2600, 0.8, 0.22, 0.6, 0.004 },
        { 38, 420, 13500, 2.4, 1.2, 0.10, 0, 0, 71, 0.40, 0, 4200, 0.6, 0.70, 1.9, 0.010, 1, 7000, 0.7, 0.46, 1.3, 0.0, 4000, 0.8, 0.60, 0.004, 0.28, 13.0,  1500, 0.7, 0.50, 1.8, 0.015 },
    };
    return S[i];
}
struct CymTable { int n{0}; double f[kMaxModes]{}; double a[kMaxModes]{}; };

// ---------------------------------------------------------------------------------
//  Voz: un golpe de un elemento
// ---------------------------------------------------------------------------------
struct Voice {
    bool active{false}, fading{false};
    int el{0};
    int64_t order{0}, life{0};
    double gain{1.0}, fadeMul{1.0};
    double dryL{0}, dryR{0}, ohL{0}, ohR{0}, room{0};
    int dL{0}, dR{0};
    uint32_t rng{1};
    // modos
    int nModes{0};
    alignas(16) double mc[kMaxModes]{}, mr2[kMaxModes]{}, my1[kMaxModes]{}, my2[kMaxModes]{};   // resonadores (SoA para SSE2)
    int64_t modeDie[kMaxModes]{};   // muestra (desde el golpe) en que cada modo baja de -100 dB
    int64_t age{0};
    // oscilador con barrido (bombo / toms)
    bool osc{false};
    double ph{0}, fEnd{50}, dF{0}, pe{1}, pDec{0.999}, ampO{0}, eO{1}, oDec{0.9999}, eA{0}, aDec{0.99}, drive{0}, driveNorm{1};
    // bandas de ruido
    Band b[kMaxBands];
    // bordonos
    bool wiresOn{false};
    Band wires;                    // biquad + componente directa (amp, ed, dd)
    double fol{0}, folGain{1}, folA{0.1}, folR{0.001};
    // flutter
    double lfoPh{0}, lfoInc{0}, lfoDepth{0};

    inline uint32_t seedNext() { rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5; return rng | 1u; }
    static inline double nz(Band& k) { k.rng ^= k.rng << 13; k.rng ^= k.rng >> 17; k.rng ^= k.rng << 5; return static_cast<double>(static_cast<int32_t>(k.rng)) * (1.0 / 2147483648.0); }
    static inline double bq(Band& k, double x) {
        const double y = k.b0 * x + k.z1;
        k.z1 = k.b1 * x - k.a1 * y + k.z2;
        k.z2 = k.b2 * x - k.a2 * y;
        return y;
    }

    inline double tick() {
        double y = 0.0;
#ifdef JW_DRUMS_SSE2
        {
            __m128d acc = _mm_setzero_pd();
            const int n2 = (nModes + 1) & ~1;       // la entrada de relleno está a cero
            for (int k = 0; k < n2; k += 2) {
                const __m128d c = _mm_load_pd(mc + k), r2 = _mm_load_pd(mr2 + k), y1 = _mm_load_pd(my1 + k), y2 = _mm_load_pd(my2 + k);
                const __m128d o = _mm_sub_pd(_mm_mul_pd(c, y1), _mm_mul_pd(r2, y2));
                _mm_store_pd(my2 + k, y1);
                _mm_store_pd(my1 + k, o);
                acc = _mm_add_pd(acc, o);
            }
            double t[2];
            _mm_storeu_pd(t, acc);
            y = t[0] + t[1];
        }
#else
        for (int k = 0; k < nModes; ++k) {
            const double o = mc[k] * my1[k] - mr2[k] * my2[k];
            my2[k] = my1[k]; my1[k] = o;
            y += o;
        }
#endif
        if (osc) {
            const double f = fEnd + dF * pe;
            pe *= pDec;
            ph += f * invSr;
            if (ph >= 1.0) ph -= 1.0;
            double s = std::sin(6.283185307179586 * ph);
            if (drive > 0.01) s = std::tanh(drive * s) * driveNorm;
            y += s * ampO * eO * (1.0 - eA);
            eO *= oDec; eA *= aDec;
        }
        const double head = y;
        for (int i = 0; i < kMaxBands; ++i) {
            Band& k = b[i];
            if (!k.on) continue;
            y += bq(k, nz(k)) * k.amp * k.ed * (1.0 - k.ea);
            k.ed *= k.dd; k.ea *= k.da;
        }
        if (wiresOn) {
            const double tgt = std::fabs(head) * folGain;
            fol += (tgt - fol) * (tgt > fol ? folA : folR);
            const double direct = wires.amp * wires.ed;
            wires.ed *= wires.dd;
            y += bq(wires, nz(wires)) * (direct + fol);
        }
        if (lfoDepth > 0.0) {
            lfoPh += lfoInc; if (lfoPh >= 1.0) lfoPh -= 1.0;
            y *= 1.0 + lfoDepth * std::sin(6.283185307179586 * lfoPh);
        }
        return y;
    }
    double invSr{1.0 / 48000.0};
};

// ---------------------------------------------------------------------------------
//  Sala: reflexiones tempranas + FDN de 8 líneas (Hadamard) + difusores de entrada
// ---------------------------------------------------------------------------------
class RoomFdn {
public:
    void prepare(double sr) {
        sr_ = sr;
        static const double ms[8] = { 23.3, 29.9, 34.7, 40.3, 47.9, 55.1, 63.7, 71.3 };
        for (int i = 0; i < 8; ++i) {
            int d = static_cast<int>(std::lround(ms[i] * 0.001 * sr)) | 1;
            len_[i] = std::max(8, d);
            buf_[i].assign(static_cast<size_t>(len_[i]), 0.0);
            g_[i] = std::pow(10.0, -3.0 * len_[i] / (sr * rt60_));   // < 1 siempre
        }
        static const double apMs[4] = { 3.2, 2.4, 8.6, 6.3 };
        for (int i = 0; i < 4; ++i) { apLen_[i] = std::max(4, static_cast<int>(std::lround(apMs[i] * 0.001 * sr)) | 1); ap_[i].assign(static_cast<size_t>(apLen_[i]), 0.0); }
        erLen_ = static_cast<int>(0.060 * sr) + 8;
        er_.assign(static_cast<size_t>(erLen_), 0.0);
        static const double erMs[8] = { 5.9, 9.4, 13.7, 18.9, 24.6, 31.3, 38.2, 46.1 };
        static const double erG[8] = { 0.60, 0.52, 0.44, 0.38, 0.32, 0.26, 0.2, 0.16 };
        for (int i = 0; i < 8; ++i) { erD_[i] = static_cast<int>(std::lround(erMs[i] * 0.001 * sr)); erGain_[i] = erG[i]; }
        damp_ = std::exp(-2.0 * kPi * 5500.0 / sr);
        const BiquadCoefs hp = BiquadCoefs::design(FilterType::HighPass, sr, 110.0, 0.0, 0.707);
        const BiquadCoefs lp = BiquadCoefs::design(FilterType::LowPass, sr, 8500.0, 0.0, 0.707);
        hp_ = hp; lp_ = lp;
        reset();
    }
    void reset() {
        for (auto& b : buf_) std::fill(b.begin(), b.end(), 0.0);
        for (auto& b : ap_) std::fill(b.begin(), b.end(), 0.0);
        std::fill(er_.begin(), er_.end(), 0.0);
        for (int i = 0; i < 8; ++i) { p_[i] = 0; lp1_[i] = 0.0; }
        for (int i = 0; i < 4; ++i) apP_[i] = 0;
        erP_ = 0;
        shp_.reset(); slp_.reset();
    }
    // Una muestra mono -> L/R de sala
    inline void process(double in, double& outL, double& outR) {
        double x = biquadProcess(lp_, slp_, biquadProcess(hp_, shp_, in));
        // reflexiones tempranas
        er_[static_cast<size_t>(erP_)] = x;
        double eL = 0.0, eR = 0.0;
        for (int i = 0; i < 8; ++i) {
            int idx = erP_ - erD_[i];
            if (idx < 0) idx += erLen_;
            const double v = er_[static_cast<size_t>(idx)] * erGain_[i];
            if (i & 1) eR += v; else eL += v;
        }
        if (++erP_ >= erLen_) erP_ = 0;
        // difusión de entrada (Schroeder)
        for (int i = 0; i < 4; ++i) {
            double& d = ap_[i][static_cast<size_t>(apP_[i])];
            const double w = x + 0.6 * d;
            const double y = -0.6 * w + d;
            d = w;
            if (++apP_[i] >= apLen_[i]) apP_[i] = 0;
            x = y;
        }
        // FDN
        double o[8], fb[8];
        for (int i = 0; i < 8; ++i) {
            o[i] = buf_[i][static_cast<size_t>(p_[i])];
            const double dm = (1.0 - damp_) * o[i] + damp_ * lp1_[i];
            lp1_[i] = dm;
            fb[i] = g_[i] * dm;
        }
        // Hadamard 8x8 ortonormal (butterfly)
        for (int h = 1; h < 8; h <<= 1)
            for (int i = 0; i < 8; i += h << 1)
                for (int j = i; j < i + h; ++j) { const double a = fb[j], c = fb[j + h]; fb[j] = a + c; fb[j + h] = a - c; }
        constexpr double kNorm = 0.35355339059327373;   // 1/sqrt(8)
        static const double inSign[8] = { 1, -1, 1, 1, -1, 1, -1, -1 };
        for (int i = 0; i < 8; ++i) {
            buf_[i][static_cast<size_t>(p_[i])] = fb[i] * kNorm + x * inSign[i] * 0.30;
            if (++p_[i] >= len_[i]) p_[i] = 0;
        }
        outL = eL * 0.5 + 0.32 * (o[0] + o[1] - o[2] - o[3] + o[4] - o[5] + o[6] - o[7]);
        outR = eR * 0.5 + 0.32 * (o[0] - o[1] + o[2] - o[3] - o[4] + o[5] + o[6] - o[7]);
    }
    double rt60() const { return rt60_; }
    // Ganancia de lazo máxima (para la prueba de estabilidad): < 1 por construcción
    double maxLoopGain() const { double m = 0.0; for (int i = 0; i < 8; ++i) m = std::max(m, g_[i]); return m; }
private:
    double sr_{48000.0}, rt60_{1.9}, damp_{0.5};
    int len_[8]{}, p_[8]{}, apLen_[4]{}, apP_[4]{}, erLen_{1}, erP_{0}, erD_[8]{};
    double g_[8]{}, lp1_[8]{}, erGain_[8]{};
    std::vector<double> buf_[8], ap_[4], er_;
    BiquadCoefs hp_, lp_;
    BiquadState shp_, slp_;
};

// ---------------------------------------------------------------------------------
//  Motor
// ---------------------------------------------------------------------------------
// tanh racional (Pade 3/2, error < 2e-2 en |x| < 3, saturado a +-1): suficiente para el camino paralelo y sin llamar a libm
inline double fastTanh(double x) {
    if (x > 3.0) return 1.0;
    if (x < -3.0) return -1.0;
    const double x2 = x * x;
    return x * (27.0 + x2) / (27.0 + 9.0 * x2);
}
// Biquad estereo (L/R en paralelo con SSE2): coeficientes y estado alineados a 16 bytes
struct SEq {
    alignas(16) double b0[2], b1[2], b2[2], a1[2], a2[2];
    void set(const BiquadCoefs& c) { for (int i = 0; i < 2; ++i) { b0[i] = c.b0; b1[i] = c.b1; b2[i] = c.b2; a1[i] = c.a1; a2[i] = c.a2; } }
};
struct SZ {
    alignas(16) double z1[2]{ 0.0, 0.0 }, z2[2]{ 0.0, 0.0 };
    void reset() { z1[0] = z1[1] = z2[0] = z2[1] = 0.0; }
};
inline void seqProcess(const SEq& c, SZ& z, double& l, double& r) {
#ifdef JW_DRUMS_SSE2
    const __m128d x = _mm_set_pd(r, l);
    const __m128d y = _mm_add_pd(_mm_mul_pd(_mm_load_pd(c.b0), x), _mm_load_pd(z.z1));
    _mm_store_pd(z.z1, _mm_add_pd(_mm_sub_pd(_mm_mul_pd(_mm_load_pd(c.b1), x), _mm_mul_pd(_mm_load_pd(c.a1), y)), _mm_load_pd(z.z2)));
    _mm_store_pd(z.z2, _mm_sub_pd(_mm_mul_pd(_mm_load_pd(c.b2), x), _mm_mul_pd(_mm_load_pd(c.a2), y)));
    double t[2];
    _mm_storeu_pd(t, y);
    l = t[0]; r = t[1];
#else
    const double yl = c.b0[0] * l + z.z1[0], yr = c.b0[1] * r + z.z1[1];
    z.z1[0] = c.b1[0] * l - c.a1[0] * yl + z.z2[0]; z.z1[1] = c.b1[1] * r - c.a1[1] * yr + z.z2[1];
    z.z2[0] = c.b2[0] * l - c.a2[0] * yl; z.z2[1] = c.b2[1] * r - c.a2[1] * yr;
    l = yl; r = yr;
#endif
}
struct ShellFx { double sf{0}, ss{0}, penv{0}, pgain{1}, ptgt{1}; int pctr{0}; };                          // estado del transitorio y del compresor paralelo de una pieza

class WorshipDrumsEngine {
public:
    WorshipDrumsEngine() { buildTables(); }

    void prepare(double sr, int /*maxBlock*/) {
        sr_ = sr > 0 ? sr : 48000.0;
        primed_ = false;
        vol_.prepare(sr_, 20.0); wet_.prepare(sr_, 8.0); air_.prepare(sr_, 40.0); roomG_.prepare(sr_, 30.0);
        vol_.reset(dbToLinear(s_.volumeDb)); wet_.reset(s_.bypass ? 0.0 : 1.0);
        air_.reset(airDb(s_.air)); roomG_.reset(roomGain(s_.roomBlend));
        ohMax_ = std::min(100, std::max(1, static_cast<int>(std::lround(0.0005 * sr_))));
        std::fill(ohRingL_.begin(), ohRingL_.end(), 0.0);
        std::fill(ohRingR_.begin(), ohRingR_.end(), 0.0);
        ohPos_ = 0;
        room_.prepare(sr_);
        fx_.prepare(sr_);
        dcR_ = 1.0 - 2.0 * kPi * 15.0 / sr_;
        designBuses(true);
        designSympathy();
        reset();
        for (auto& v : voices_) v.invSr = 1.0 / sr_;
        // muestras: un Sampler por familia (los toms y el rimshot, uno propio cada uno para poder dar EQ por pieza);
        // el banco se carga una sola vez en un hilo aparte (cache compartida)
        JwSampler::Humanize hum;
        hum.gainDb = 0.8f; hum.detuneCents = 3.0f; hum.timingMs = 0.0f; hum.velCurve = 0.15f;
        forEachAll([&](JwSampler::Sampler& s) { s.prepare(sr_); s.setHumanize(hum); });
        // el servicio de kits (hilo de carga persistente) escanea la carpeta de samples, carga el kit elegido y el banco de percusion
        // y los publica en los samplers con un intercambio atomico; el hilo de audio nunca hace E/S
        if (!samLoadStarted_) {
            samLoadStarted_ = true;
            kit_.start([this](const std::shared_ptr<JwSampler::Bank>& b, bool perc) {
                if (perc) auxPerc_.setBank(b);
                else forEachSampler([&](JwSampler::Sampler& s) { s.setBank(b); });
            });
        }
        for (auto& b : bodySn_) b.invSr = 1.0 / sr_;
        for (auto& b : bodyTm_) b.invSr = 1.0 / sr_;
        designSamples(true);
        designMaster();
    }
    // FX Rack comun (jw_fxrack.h): master de la bateria, DESPUES de toda la cadena propia (samplers, buses, sala, EQ por pieza, compresion paralela, cinta, suavizado)
    void setFx(const JasWaveFx::FxParams& p) { fx_.setParams(p); }
    void setTempo(double bpm) { fx_.setTempo(bpm); }
    JasWaveFx::FxRack& fx() { return fx_; }
    /// ¿Hay banco de muestras cargado? (el resto de notas sin zona siguen sonando con el motor modelado)
    bool samplerReady() const { bool ok = true; forEachSamplerC([&](const JwSampler::Sampler& s) { if (!s.ready()) ok = false; }); return ok; }
    bool samplerLoading() const { return kit_.loading(); }
    /// El cuerpo/pegada de caja y toms (calibrados con el MuldjordKit) esta activo? Con otros kits se apaga.
    bool shellCalibrated() const { return kitMd_; }
    // ---- kits (v4) ----
    KitService& kits() { return kit_; }
    const KitService& kits() const { return kit_; }
    /// Kit guardado en el estado del plugin (slug): tiene prioridad sobre el indice del parametro hasta que el usuario lo cambie.
    void setKitSlug(const std::string& slug) { if (slug.empty()) return; slugPend_.store(true); kit_.selectSlug(slug); }
    std::string kitSlug() const { return kit_.slugGuardable(); }
    /// La nota tiene muestra real (kit cargado o banco de percusion)?
    bool noteHasSample(int note) const {
        if (note < 0 || note > 127) return false;
        if (isAuxNote(note) && note != 78) return sam_[kBusPerc].hasZone(note, 0.5f) || auxPerc_.hasZone(note, 0.5f);
        return noteIsSampled(note) || auxPerc_.hasZone(note, 0.5f);
    }
    /// Notas de la percusion auxiliar (palmas 39, pandereta 54, cencerro 56, vibraslap 58, 60..87; la campana de crash 78 va ademas por los platos)
    static bool isAuxNote(int n) { return n == 39 || n == 54 || n == 56 || n == 58 || (n >= 60 && n <= 87); }
    /// ¿Esta nota suena con muestras (banco cargado y con zona)? Si no, suena el motor modelado.
    bool noteIsSampled(int note) const { const JwSampler::Sampler* s = samplerForNote(note); return s && s->hasZone(note, 0.5f); }
    void reset() {
        forEachAll([](JwSampler::Sampler& s) { s.panic(); });
        for (auto& b : bodySn_) b.active = false;
        for (auto& b : bodyTm_) b.active = false;
        resetShells();
        for (auto& t : tomHold_) t = 0;
        hum_.seed(0xC0FFEE11u); for (auto& h : handR_) h = false;
        snShL_.reset(); snShR_.reset(); smShL_.reset(); smShR_.reset(); warmL_ = warmR_ = 0.0; parEnv_ = 0.0;
        for (int b = 0; b < kNumBus; ++b) { busHpL_[b].reset(); busHpR_[b].reset(); busShL_[b].reset(); busShR_[b].reset(); }
        for (auto& v : voices_) v.active = false;
        room_.reset();
        std::fill(ohRingL_.begin(), ohRingL_.end(), 0.0);
        std::fill(ohRingR_.begin(), ohRingR_.end(), 0.0);
        ohHpL_.reset(); ohHpR_.reset(); ohShL_.reset(); ohShR_.reset();
        for (int i = 0; i < 6; ++i) symY1_[i] = symY2_[i] = 0.0;
        symLp_ = symFol_ = 0.0; symW_.z1 = symW_.z2 = 0.0;
        dcX_[0] = dcX_[1] = dcY_[0] = dcY_[1] = 0.0;
        fx_.reset();
        compEnv_ = 0.0;
        bend_ = 0.0; bendMul_ = 1.0;
        hitCount_ = 0; orderCtr_ = 0;
        for (auto& h : hit_) h = 0.0f;
    }
    void setSettings(const DrumSettings& s) {
        const bool dampChanged = std::fabs(s.tomsDamp - s_.tomsDamp) > 1e-9;
        s_ = s;
        const bool first = !primed_;
        primed_ = true;
        vol_.setTarget(dbToLinear(s.volumeDb));
        wet_.setTarget(s.bypass ? 0.0 : 1.0);
        air_.setTarget(airDb(s.air));
        roomG_.setTarget(roomGain(s.roomBlend));
        shellsLin_ = dbToLinear(s.shellsDb);
        cymLin_ = dbToLinear(s.cymbalDb);
        percLin_ = dbToLinear(s.percDb);
        // kit: el parametro manda salvo justo despues de cargar un estado con slug (entonces manda el slug, que no depende del orden de la lista)
        if (kitSlugJust()) lastKitIdx_ = s.kitIndex;
        else if (s.kitIndex != lastKitIdx_) { lastKitIdx_ = s.kitIndex; kit_.selectIndex(s.kitIndex); }
        compThr_ = -30.0 - 0.18 * s.roomComp * 100.0;                // dB
        compThrLin_ = dbToLinear(compThr_);
        compRatio_ = 1.5 + 4.0 * s.roomComp;
        compMakeup_ = dbToLinear(6.0 * s.roomComp);
        if (dampChanged) designSympathy();
        designSamples(first);
        designMaster();
        if (first) {   // primera configuración tras prepare(): sin rampa (una instancia sin licencia no filtra los primeros ms)
            vol_.reset(dbToLinear(s.volumeDb)); wet_.reset(s.bypass ? 0.0 : 1.0); air_.reset(airDb(s.air)); roomG_.reset(roomGain(s.roomBlend));
            designBuses(true);
        }
    }
    void setBend(double semitones) {
        bend_ = clampT(semitones, -12.0, 12.0); bendMul_ = std::pow(2.0, bend_ / 12.0);
        forEachAll([&](JwSampler::Sampler& s) { s.setBend(static_cast<float>(bend_)); });
    }
    void setHatFoot(double f01) { s_.hatFoot = clampT(f01, 0.0, 1.0); }
    void noteOff(int) {}   // percusión: un golpe no depende del note-off

    void allNotesOff() {
        for (auto& v : voices_) if (v.active && !v.fading) fade(v, 0.030, 80.0);
        forEachAll([](JwSampler::Sampler& s) { s.allNotesOff(); });
    }

    void noteOn(int note, float velIn) {
        if (note < 0 || note > 127) return;
        const int el = elementForNote(note);
        if (velIn <= 0.0f) return;
        const double vel = clampT(static_cast<double>(velIn), 0.0, 1.0);
        if (el < 0) {   // percusion auxiliar (palmas, pandereta, cencerro, congas...): solo suena con muestras; fuera del mapa se ignora
            if (isAuxNote(note)) auxNoteOn(note, vel);
            return;
        }
        // banco de muestras: si hay zona para la nota, suena el kit real (el choke del hi-hat lo hacen los grupos del banco)
        if (sampleNoteOn(note, vel)) {
            if (el == kElHatC || el == kElHatP)   // por si queda algún hi-hat modelado sonando (carga tardía del banco)
                for (auto& v : voices_) if (v.active && !v.fading && v.el == kElHatO) fade(v, 0.012, 80.0);
            const int pad = padForElement(el);
            hit_[pad] = std::max(hit_[pad], static_cast<float>(vel));
            return;
        }
        // campana de crash (78) en el banco de percusion; si tampoco esta, suena el modelo de campana
        if (note == 78 && auxNoteOn(78, vel)) { hit_[10] = std::max(hit_[10], static_cast<float>(vel)); return; }
        // grupos de choke
        if (el == kElHatC || el == kElHatP) {
            for (auto& v : voices_) if (v.active && !v.fading) {
                if (v.el == kElHatO) fade(v, 0.012, 80.0);
                else if (el == kElHatP && v.el == kElHatC) fade(v, 0.015, 80.0);
            }
        }
        double chokeRing = 1.0;
        if (el == kElHatO || el == kElCrash1 || el == kElCrash2 || el == kElSplash || el == kElChina) {
            const double fs = el == kElHatO ? 0.090 : (el == kElSplash ? 0.120 : 0.220);
            for (auto& v : voices_) if (v.active && !v.fading && v.el == el) {
                if (el != kElHatO && v.life > 0) chokeRing = 0.78;   // plato todavía sonando: golpe "ahogado"
                fade(v, fs, 80.0);
            }
        }
        // límite por elemento y polifonía global
        int perEl = 0, total = 0;
        Voice* oldestEl = nullptr; Voice* oldestAll = nullptr;
        for (auto& v : voices_) {
            if (!v.active || v.fading) continue;
            ++total;
            if (v.el == el) { ++perEl; if (!oldestEl || v.order < oldestEl->order) oldestEl = &v; }
            if (!oldestAll || v.order < oldestAll->order) oldestAll = &v;
        }
        if (perEl >= kElementCap && oldestEl) { fade(*oldestEl, 0.060, 80.0); --total; }
        else if (total >= kPolyphony && oldestAll) { fade(*oldestAll, 0.005, 80.0); --total; }
        Voice* slot = nullptr;
        for (auto& v : voices_) if (!v.active) { slot = &v; break; }
        if (!slot) {   // todos los huecos ocupados (extremo): se recicla el que más fundido lleva
            double best = 1e30;
            for (auto& v : voices_) if (v.fading && v.gain < best) { best = v.gain; slot = &v; }
            if (!slot) slot = &voices_[0];
        }
        start(*slot, el, note, vel, chokeRing);
        const int pad = padForElement(el);
        hit_[pad] = std::max(hit_[pad], static_cast<float>(vel));
    }

    template <class T>
    void render(T* outL, T* outR, int n, DrumBus* bus) {
        for (int off = 0; off < n; off += kChunk) renderChunk(outL + off, outR + off, std::min(kChunk, n - off));
        fx_.process(outL, outR, n, bus);   // FX Rack: tras toda la cadena propia y antes de medir/publicar (apagado: no toca el buffer)
        if (bus) {
            bus->salida(outL, outR, n);
            float pk[2] = { 0, 0 };
            for (int i = 0; i < n; ++i) {
                pk[0] = std::max(pk[0], static_cast<float>(std::fabs(static_cast<double>(outL[i]))));
                pk[1] = std::max(pk[1], static_cast<float>(std::fabs(static_cast<double>(outR[i]))));
            }
            bus->outPk[0].update(pk[0]); bus->outPk[1].update(pk[1]);
            bus->activeVoices.store(activeVoices(), std::memory_order_relaxed);
            bus->maxVoices.store(kPolyphony, std::memory_order_relaxed);
            publishKits(bus);
            for (int p = 0; p < kNumPads; ++p) if (hit_[p] > 0.0f) { bus->pad[p].store(hit_[p], std::memory_order_relaxed); }
        }
        for (auto& h : hit_) h = 0.0f;
    }

    /// Publica en el bus (para el editor) el catalogo y el estado de kits; el catalogo solo cuando cambia.
    void publishKits(DrumBus* bus) {
        const uint32_t sq = kit_.listSeq();
        if (sq != listPub_) { listPub_ = sq; std::atomic_store(&bus->kits, kit_.list()); }
        bus->kitActivo.store(kit_.activeIndex(), std::memory_order_relaxed);
        bus->kitEstado.store(static_cast<int>(kit_.estado()), std::memory_order_relaxed);
        for (int w = 0; w < 2; ++w) { bus->maskKit[w].store(kit_.maskKit(w), std::memory_order_relaxed); bus->maskPerc[w].store(kit_.maskPerc(w), std::memory_order_relaxed); }
    }

    int activeVoices() const {
        int a = 0;
        for (const auto& v : voices_) a += v.active ? 1 : 0;
        forEachSamplerC([&](const JwSampler::Sampler& s) { a += s.activeVoices(); });
        a += auxPerc_.activeVoices();
        return a;
    }
    double sampleRate() const { return sr_; }
    const RoomFdn& room() const { return room_; }
    double lastCompGrDb() const { return compGr_; }

private:
    // ---------------- muestras ----------------
    template <class F> void forEachSampler(F&& f) { for (auto& s : sam_) f(s); for (auto& s : tomSam_) f(s); f(rimSam_); }   // samplers que reciben el banco del kit
    template <class F> void forEachAll(F&& f) { forEachSampler(f); f(auxPerc_); }                                          // + el de la percusion auxiliar
    bool kitSlugJust() { return slugPend_.exchange(false); }
    static float auxPan(int n) {
        switch (n) {
            case 39: return 0.0f;   case 54: return 0.40f;  case 56: return -0.30f; case 58: return 0.30f;
            case 60: return -0.30f; case 61: return -0.45f; case 62: return 0.30f;  case 63: return 0.42f;  case 64: return 0.55f;
            case 65: return -0.55f; case 66: return -0.40f; case 67: return 0.20f;  case 68: return 0.10f;
            case 69: return -0.50f; case 70: return 0.50f;  case 73: return 0.25f;  case 74: return 0.30f;
            case 75: return -0.20f; case 76: return -0.35f; case 77: return -0.25f; case 78: return -0.40f;
            case 80: return 0.45f;  case 81: return 0.50f;  case 82: return 0.50f;
            default: return 0.0f;
        }
    }
    /// Golpe de percusion auxiliar: primero el banco del kit (si trae esa pieza, p. ej. el cencerro de un kit indie); si no, el banco de percusion.
    bool auxNoteOn(int note, double vel) {
        JwSampler::Sampler* s = nullptr;
        const float fv = static_cast<float>(vel);
        if (sam_[kBusPerc].hasZone(note, fv)) s = &sam_[kBusPerc];
        else if (auxPerc_.hasZone(note, fv)) s = &auxPerc_;
        if (!s) return false;
        JwSampler::NoteShape sh;
        sh.pan = auxPan(note);
        const double v = clampT(vel * (1.0 + 0.02 * hum_.bi()), 0.01, 1.0);
        s->noteOnShaped(note, static_cast<float>(v), sh);
        return true;
    }
    template <class F> void forEachSamplerC(F&& f) const { for (const auto& s : sam_) f(s); for (const auto& s : tomSam_) f(s); f(rimSam_); }
    static int tomIndex(int note) { for (int i = 0; i < kNumToms; ++i) if (kTomNote[i] == note) return i; return -1; }
    // Sampler de una nota: los toms (uno cada uno) y el rimshot tienen el suyo para poder darles EQ por pieza
    const JwSampler::Sampler* samplerForNote(int note) const {
        const int b = busForNote(note);
        if (b < 0) return nullptr;
        if (b == kBusToms) { const int t = tomIndex(note); return t >= 0 ? &tomSam_[t] : nullptr; }
        if (note == 40) return &rimSam_;
        return &sam_[b];
    }
    JwSampler::Sampler* samplerForNote(int note) { return const_cast<JwSampler::Sampler*>(static_cast<const WorshipDrumsEngine*>(this)->samplerForNote(note)); }

    bool sampleNoteOn(int note, double vel) {
        const int b = busForNote(note);
        if (b < 0) return false;
        JwSampler::Sampler* sp = samplerForNote(note);
        if (!sp) return false;
        JwSampler::Sampler& s = *sp;
        if (!s.hasZone(note, static_cast<float>(vel))) return false;
        // humanización por golpe: velocidad (±2 %) y, en caja/toms, alternancia de manos (la débil, algo más suave y
        // unos cents más grave) para que un redoble no suene a ametralladora aunque cicle las mismas muestras
        double v = vel * (1.0 + 0.02 * hum_.bi());
        if (b == kBusSnare || b == kBusToms) {
            handR_[b] = !handR_[b];
            v *= handR_[b] ? 1.0 : 0.975;
            s.setTuneCents(static_cast<float>((handR_[b] ? 3.0 : -3.0) + hum_.bi() * 2.0));
        }
        v = clampT(v, 0.01, 1.0);
        // curva de velocidad generosa (caja y toms): las velocidades medias (50-100) saltan a capas mas fuertes sin tocar el techo ni las fantasma
        if (note == 38) v = clampT(v + velLiftSn_ * v * (1.0 - v), 0.01, 1.0);
        else if (b == kBusToms) v = clampT(v + velLift_ * v * (1.0 - v), 0.01, 1.0);
        if (note == 42) {   // hi-hat cerrado con el pedal a medias (CC4): cerrado + cola de abierto; pedal casi arriba = abierto
            const double open = 1.0 - s_.hatFoot;
            if (open > 0.9 && s.hasZone(46, static_cast<float>(v))) { s.noteOn(46, static_cast<float>(v)); return true; }
            s.noteOn(note, static_cast<float>(v));
            if (open > 0.1 && s.hasZone(kHatSemiNote, 0.5f)) s.noteOn(kHatSemiNote, static_cast<float>(clampT(v * (0.3 + 0.7 * open), 0.01, 1.0)));
            return true;
        }
        s.noteOn(note, static_cast<float>(v));
        if (b == kBusToms) tomHold_[note] = std::max(1, static_cast<int>(tomHoldSec_ * sr_));   // apagado del parche (toms_damp)
        if (note == 38) startSnareBody(v);
        else if (b == kBusToms) startTomBody(tomIndex(note), v);
        return true;
    }

    // ---------------- capa de cuerpo sintetizada ----------------
    inline double bodyJit(double a) { bodyRng_ ^= bodyRng_ << 13; bodyRng_ ^= bodyRng_ >> 17; bodyRng_ ^= bodyRng_ << 5; return static_cast<double>(static_cast<int32_t>(bodyRng_)) * (1.0 / 2147483648.0) * a; }
    inline uint32_t bodyU32() { bodyRng_ ^= bodyRng_ << 13; bodyRng_ ^= bodyRng_ >> 17; bodyRng_ ^= bodyRng_ << 5; return bodyRng_ | 1u; }
    BodyVoice* allocBody(BodyVoice* pool, int count) {
        BodyVoice* best = nullptr;
        for (int i = 0; i < count; ++i) if (!pool[i].active) { best = &pool[i]; break; }
        if (!best) {   // extremo: se recicla la mas silenciosa
            double q = 1e30;
            for (int i = 0; i < count; ++i) { const double e = pool[i].a1 + pool[i].a2 + pool[i].nAmp; if (e < q) { q = e; best = &pool[i]; } }
        }
        return best;
    }
    static double velGainDb(double v, double dynDb) { return std::pow(10.0, -dynDb * (1.0 - std::pow(clampT(v, 0.0, 1.0), 0.7)) / 20.0); }   // misma curva que normalizar_capa del conversor
    void startSnareBody(double v) {
        const double bs = bodySnare_;
        if (bs < 0.005) return;
        BodyVoice* bv = allocBody(bodySn_, kBodySn);
        const double invSr = 1.0 / sr_;
        *bv = BodyVoice{};
        bv->invSr = invSr; bv->active = true; bv->order = ++bodyOrder_;
        const double fEnd = s_.snareTuneHz * bendMul_ * (1.0 + bodyJit(0.004));
        bv->f1 = fEnd; bv->df = fEnd * 0.55; bv->pDec = std::exp(-1.0 / (0.012 * sr_));
        const double vg = velGainDb(v, 28.0) * (1.0 + bodyJit(0.08));
        const double A = kSnBodyAmp * bs * vg;
        bv->a1 = A; bv->d1 = t60ToDecay(kSnBodyT60, sr_);
        bv->ratio2 = 0.76; bv->a2 = 0.70 * A; bv->d2 = t60ToDecay(kSnBodyT60 * 0.9, sr_);   // segundo modo por debajo (~125 Hz): el banco tiene 28 dB menos ahi
        // bordonas / crack: ruido en banda que cae rapido (mas con snare_snap)
        bv->nc = BiquadCoefs::design(FilterType::BandPass, sr_, 3800.0 * (1.0 + bodyJit(0.03)), 0.0, 0.6);
        bv->rng = bodyU32();
        bv->nAmp = kSnNoiseAmp * (0.5 + s_.snareSnap) * shellPunchK_ * vg;
        bv->nDec = t60ToDecay(0.085, sr_);
        bv->rampInc = 1.0 / std::max(8.0, 0.0006 * sr_);
    }
    void startTomBody(int idx, double v) {
        if (idx < 0) return;
        if (shellPunchK_ < 0.005) return;   // en los toms la capa sintetizada es solo el tic de baqueta (el cuerpo lo da el resonador coherente)
        BodyVoice* bv = allocBody(bodyTm_, kBodyTm);
        *bv = BodyVoice{};
        bv->invSr = 1.0 / sr_; bv->active = true; bv->order = ++bodyOrder_;
        const double fEnd = kTomFundHz[idx] * std::pow(2.0, s_.tomsTuneCents / 1200.0) * bendMul_ * (1.0 + bodyJit(0.004));
        bv->f1 = fEnd; bv->df = fEnd * 0.9; bv->pDec = std::exp(-1.0 / (0.007 * sr_));
        const double vg = velGainDb(v, 24.0) * (1.0 + bodyJit(0.08));
        bv->a1 = 0.0;   // (sin thump libre: ver resonador coherente en renderSamples)
        bv->d1 = t60ToDecay(0.22 * std::pow(0.25, s_.tomsDamp), sr_);
        bv->a2 = 0.0;
        bv->nc = BiquadCoefs::design(FilterType::BandPass, sr_, 4800.0 * (1.0 + bodyJit(0.05)), 0.0, 0.8);
        bv->rng = bodyU32();
        bv->nAmp = kTmTickAmp * shellPunchK_ * vg;
        bv->nDec = t60ToDecay(0.014, sr_);
        bv->rampInc = 1.0 / std::max(8.0, 0.0006 * sr_);
    }
    bool bodyActive(const BodyVoice* pool, int count) const { for (int i = 0; i < count; ++i) if (pool[i].active) return true; return false; }
    void renderBody(BodyVoice* pool, int count, int n, double* out) {
        for (int i = 0; i < n; ++i) out[i] = 0.0;
        for (int k = 0; k < count; ++k) {
            BodyVoice& v = pool[k];
            if (!v.active) continue;
            for (int i = 0; i < n && v.active; ++i) out[i] += v.tick();
        }
    }

    // Parámetros del plugin -> muestras (afinación, snap, damping, niveles de bus)
    void designSamples(bool force) {
        designShells(force);
        const double cents = clampT(1200.0 * std::log2(std::max(20.0, s_.kickTuneHz) / kKickRefHz), -900.0, 700.0);   // kKickRefHz = fundamental del banco (0 cents)
        sam_[kBusKick].setTuneCents(static_cast<float>(cents));
        tomHoldSec_ = 6.0 * std::pow(0.04, s_.tomsDamp);               // 0 % -> 6 s (cola natural completa), 25 % -> 2,7 s, 50 % -> 1,2 s, 100 % -> 0,24 s
        const double snapDb = (s_.snareSnap - 0.65) * 14.0;            // shelf de agudos (3,5 kHz) alrededor del valor por defecto
        if (force || std::fabs(snapDb - lastSnapDb_) > 1.0e-4) {
            lastSnapDb_ = snapDb;
            snareSh_ = BiquadCoefs::design(FilterType::HighShelf, sr_, 3500.0, snapDb, 0.7);
        }
        const double snapGain = dbToLinear((s_.snareSnap - 0.65) * 3.0);
        for (int b = 0; b < kNumBus; ++b) {
            const double lvl = b <= kBusToms ? shellsLin_ : (b == kBusPerc ? percLin_ : cymLin_);
            samGainTgt_[b] = lvl * dbToLinear(b == kBusSnare ? kBusTrimDb[b] * snareEngage_ : kBusTrimDb[b]) * (b == kBusSnare ? snapGain : 1.0);
            if (force) samGainCur_[b] = samGainTgt_[b];
        }
    }
    // v3: EQ por pieza, transitorio, compresión/saturación paralela y capa de cuerpo de caja y toms (se rediseña solo si cambian los parámetros)
    void designShells(bool force) {
        const double key[10] = { s_.shellBody, s_.shellPunch, s_.snareBody, s_.tomsBody, s_.snareTuneHz, s_.tomsTuneCents, s_.busComp, s_.tape, s_.snareSnap, s_.tomsDamp };
        bool same = !force;
        for (int i = 0; i < 10; ++i) if (key[i] != shellKey_[i]) same = false;
        if (same) return;
        for (int i = 0; i < 10; ++i) shellKey_[i] = key[i];
        // El cuerpo y la pegada (EQ, capa sintetizada, curva de velocidad) estan calibrados con las medidas del MuldjordKit: con otro kit se apagan (suena el banco tal cual)
        const double kk = kitMd_ ? 1.0 : 0.0;
        const double b = s_.shellBody * kk, p = s_.shellPunch * kk;
        const double bs = clampT(b * s_.snareBody, 0.0, 2.25), bt = clampT(b * s_.tomsBody, 0.0, 2.25);
        bodySnare_ = bs; bodyToms_ = bt; shellPunchK_ = p;
        // la compensacion de nivel (trim) solo actua en la medida en que actua el procesado: con Shell Body = Shell Punch = 0 la muestra suena como el banco
        snareSideK_ = dbToLinear(kShellSideDb * clampT((bs + p) / ((kDefShellBody + kDefShellPunch) / 100.0), 0.0, 1.5));
        tomsSideK_ = dbToLinear(kShellSideDb * clampT((bt + p) / ((kDefShellBody + kDefShellPunch) / 100.0), 0.0, 1.5));
        rimComp_ = dbToLinear(-kBusTrimDb[kBusSnare] * clampT((bs + p) / ((kDefShellBody + kDefShellPunch) / 100.0), 0.0, 1.5));   // el rimshot (ya trae su crack) conserva el nivel del banco
        snareEngage_ = clampT((bs + p) / ((kDefShellBody + kDefShellPunch) / 100.0), 0.0, 1.5);
        tomsEngage_ = clampT((bt + p) / ((kDefShellBody + kDefShellPunch) / 100.0), 0.0, 1.5);
        velLift_ = kVelLiftTm * p; velLiftSn_ = kVelLiftSn * p;
        // caja: lo que le falta al banco: 100-160 Hz (cuerpo), 175 Hz (fundamental), presencia 3-5 kHz
        snC_[0] = BiquadCoefs::design(FilterType::Bell, sr_, 180.0, kSnBodyDb * bs, 0.9);
        snC_[1] = BiquadCoefs::design(FilterType::Bell, sr_, 450.0, kSnBoxDb * bs, 1.1);   // recorte de la "caja de carton" (400-630 Hz estan 5-9 dB sobre lo natural)
        snC_[2] = BiquadCoefs::design(FilterType::Bell, sr_, 3800.0, kSnPresDb * p, 0.9);
        for (int k = 0; k < kSnEq; ++k) snQ_[k].set(snC_[k]);
        // toms: fundamental de cada tom (resonancia coherente con la muestra), primer sobretono, ataque de baqueta
        const double tune = std::pow(2.0, s_.tomsTuneCents / 1200.0);
        for (int i = 0; i < kNumToms; ++i) {
            const double f = kTomFundHz[i] * tune;
            tmC_[i][0] = BiquadCoefs::design(FilterType::Bell, sr_, f, kTmFundDb * bt, 1.4);
            tmC_[i][1] = BiquadCoefs::design(FilterType::Bell, sr_, 4800.0, kTmAtkDb * p, 0.8);
            tmC_[i][2] = BiquadCoefs::design(FilterType::Bell, sr_, 2200.0, kTmStickDb * p, 0.9);
            // resonador modal de la fundamental de este tom, excitado por la propia muestra (coherente en fase: la polaridad del primer pico grave del banco
            // varia entre capas, un seno libre restaria la mitad de las veces); su T60 sigue a toms_damp
            const double t60 = 0.30 * std::pow(0.15, s_.tomsDamp);
            for (int k = 0; k < kTmEq; ++k) tmQ_[i][k].set(tmC_[i][k]);
            tmRes_[i] = BiquadCoefs::design(FilterType::BandPass, sr_, f, 0.0, clampT(kPi * f * (t60 / 6.907755278982137), 1.5, 40.0));
        }
        tomResGain_ = kTmResGain * bt;
        for (int i = 0; i < kNumToms; ++i) tomTrimLin_[i] = dbToLinear(kTomTrimDb[i] * tomsEngage_);
        shapeSn_ = dbToLinear(kSnShapeDb * p) - 1.0;
        shapeTm_ = dbToLinear(kTmShapeDb * p) - 1.0;
        const double busK = 0.6 + 2.0 * s_.busComp;
        parMixSn_ = (kSnParMix * p + 0.10 * std::min(bs, 1.5)) * busK;
        parMixTm_ = (kTmParMix * p + 0.10 * std::min(bt, 1.5)) * busK;
        parDrive_ = 1.3 + 3.0 * s_.tape;
        parMk_ = kParMakeupDb; parThr_ = kParThrDb;
        shaperAF_ = 1.0 - std::exp(-1.0 / (0.0003 * sr_)); shaperRF_ = 1.0 - std::exp(-1.0 / (0.010 * sr_));
        shaperAS_ = 1.0 - std::exp(-1.0 / (0.020 * sr_)); shaperRS_ = 1.0 - std::exp(-1.0 / (0.060 * sr_));
        parAtk_ = 1.0 - std::exp(-1.0 / (0.001 * sr_)); parRel_ = 1.0 - std::exp(-1.0 / (0.090 * sr_));
    }
    void resetShells() {
        for (auto& s : snS_) s.reset();
        for (auto& t : tmS_) for (auto& s : t) s.reset();
        for (auto& s : tmHp_) s.reset();
        for (auto& s : tmResS_) s.reset();
        snHp_.reset(); rimHp_.reset();
        shSn_ = ShellFx{}; shTm_ = ShellFx{};
        for (auto& q : quiet_) q = 0;
    }
    // Bloques de mezcla: calidez de sala, suavizado de agudos, saturación de cinta, compresión paralela
    void designMaster() {
        warmA_ = std::exp(-2.0 * kPi * (9000.0 * std::pow(0.28, s_.roomWarm)) / sr_);   // 0 % = 9 kHz, 60 % = ~4,2 kHz, 100 % = 2,5 kHz
        smoothSh_ = BiquadCoefs::design(FilterType::HighShelf, sr_, std::min(12500.0, 0.42 * sr_), -10.0 * s_.smooth, 0.7);   // solo doma el "chillido" > 12 kHz
        tapeDrive_ = 1.0 + 1.5 * s_.tape;
        parMix_ = 0.9 * s_.busComp;
        parA_ = std::exp(-1.0 / (0.010 * sr_)); parR_ = std::exp(-1.0 / (0.140 * sr_));
        // EQ por pieza de las muestras: paso-altos (bombo 28 Hz, caja 55, toms 30, hi-hat 160, platos 120) y recorte de agudos en hat/platos.
        // Medido: no recortan nada util (la caja del banco no tiene nada bajo 80 Hz y el tom mas grave suena a 66 Hz: -0,4 dB con el paso-alto a 30 Hz)
        static const double hp[kNumBus] = { 28.0, 55.0, 30.0, 160.0, 120.0, 70.0 };
        for (int b = 0; b < kNumBus; ++b) busHp_[b] = BiquadCoefs::design(FilterType::HighPass, sr_, hp[b], 0.0, 0.707);
        busSh_ = BiquadCoefs::design(FilterType::HighShelf, sr_, std::min(10500.0, 0.42 * sr_), -1.5, 0.7);
        hpSnQ_.set(busHp_[kBusSnare]); hpTmQ_.set(busHp_[kBusToms]);
        closeG_ = dbToLinear(s_.closeDb); ambG_ = dbToLinear(s_.ambDb);
    }

    // Transitorio (realce diferencial de envolventes rapida/lenta) + compresión y saturación paralela de una pieza
    inline void shellDynamics(ShellFx& fx, double& l, double& r, double shape, double parMix) {
        const double det = 0.5 * (std::fabs(l) + std::fabs(r));
        fx.sf += (det - fx.sf) * (det > fx.sf ? shaperAF_ : shaperRF_);
        fx.ss += (det - fx.ss) * (det > fx.ss ? shaperAS_ : shaperRS_);
        double frac = (fx.sf - fx.ss) / (fx.sf + 1.0e-6);
        frac = frac < 0.0 ? 0.0 : (frac > 1.0 ? 1.0 : frac);
        const double gate = fx.sf * 300.0;
        const double g = 1.0 + shape * frac * (gate > 1.0 ? 1.0 : gate);
        l *= g; r *= g;
        const double pk = std::max(std::fabs(l), std::fabs(r));
        fx.penv += (pk - fx.penv) * (pk > fx.penv ? parAtk_ : parRel_);
        if ((++fx.pctr & 7) == 0) {   // el calculo de la reduccion (log/pow) cada 8 muestras; la ganancia se suaviza muestra a muestra
            const double lv = linearToDb(fx.penv);
            const double gr = lv > parThr_ ? (lv - parThr_) * (1.0 - 1.0 / kParRatio) : 0.0;
            fx.ptgt = dbToLinear(parMk_ - gr);
        }
        fx.pgain += (fx.ptgt - fx.pgain) * 0.15;
        const double inv = 1.0 / parDrive_;
        l += parMix * fastTanh(parDrive_ * l * fx.pgain) * inv;
        r += parMix * fastTanh(parDrive_ * r * fx.pgain) * inv;
    }
    static inline void stEq(const SEq& c, SZ& s, double& l, double& r) { seqProcess(c, s, l, r); }

    // Suma el audio de los samplers en sdL_/sdR_ (directo), anillo de overheads y envío a sala
    void renderSamples(int n) {
        const int mask = kRing - 1;
        if (const bool md = kit_.activeIsMuldjord(); md != kitMd_) { kitMd_ = md; designShells(true); designSamples(false); }   // cambio de kit: se recalibra la caja/toms (solo coeficientes, sin reservas)
        for (int i = 0; i < n; ++i) { sdL_[static_cast<size_t>(i)] = 0.0; sdR_[static_cast<size_t>(i)] = 0.0; }
        // apagado de los toms: note-off interno cuando vence el tiempo de damping
        for (int t = 0; t < kNumToms; ++t) {
            const int note = kTomNote[t];
            if (tomHold_[note] > 0 && (tomHold_[note] -= n) <= 0) { tomHold_[note] = 0; tomSam_[t].noteOff(note); }
        }
        const int tail = static_cast<int>(0.2 * sr_);
        for (int b = 0; b < kNumBus; ++b) {
            const bool snare = b == kBusSnare, toms = b == kBusToms;
            int act = 0;
            if (toms) { for (const auto& s : tomSam_) act += s.activeVoices(); }
            else if (snare) act = sam_[b].activeVoices() + rimSam_.activeVoices();
            else if (b == kBusPerc) act = sam_[b].activeVoices() + auxPerc_.activeVoices();
            else act = sam_[b].activeVoices();
            const bool bodyOn = snare ? bodyActive(bodySn_, kBodySn) : (toms ? bodyActive(bodyTm_, kBodyTm) : false);
            if (act > 0 || bodyOn) quiet_[b] = tail; else quiet_[b] -= n;
            if (quiet_[b] <= 0) { samGainCur_[b] = samGainTgt_[b]; if (act == 0 && !bodyOn) { quiet_[b] = 0; continue; } }
            // 1) señal de la familia (L/R en bL_/bR_), con la EQ de cada pieza
            for (int i = 0; i < n; ++i) { bL_[static_cast<size_t>(i)] = 0.0; bR_[static_cast<size_t>(i)] = 0.0; }
            if (toms) {
                for (int t = 0; t < kNumToms; ++t) {
                    if (tomSam_[t].activeVoices() == 0) continue;
                    std::fill(tmpL_.begin(), tmpL_.begin() + n, 0.0f);
                    std::fill(tmpR_.begin(), tmpR_.begin() + n, 0.0f);
                    tomSam_[t].render(tmpL_.data(), tmpR_.data(), n);
                    for (int i = 0; i < n; ++i) {
                        double l = tmpL_[static_cast<size_t>(i)], r = tmpR_[static_cast<size_t>(i)];
                        stEq(hpTmQ_, tmHp_[t], l, r);
                        const double res = biquadProcess(tmRes_[t], tmResS_[t], 0.5 * (l + r)) * tomResGain_;
                        for (int k = 0; k < kTmEq; ++k) stEq(tmQ_[t][k], tmS_[t][k], l, r);
                        l += res; r += res;
                        bL_[static_cast<size_t>(i)] += l * tomTrimLin_[t]; bR_[static_cast<size_t>(i)] += r * tomTrimLin_[t];
                    }
                }
                for (int i = 0; i < n; ++i) shellDynamics(shTm_, bL_[static_cast<size_t>(i)], bR_[static_cast<size_t>(i)], shapeTm_, parMixTm_);
                renderBody(bodyTm_, kBodyTm, n, bodyBuf_.data());
            } else {
                std::fill(tmpL_.begin(), tmpL_.begin() + n, 0.0f);
                std::fill(tmpR_.begin(), tmpR_.begin() + n, 0.0f);
                if (sam_[b].activeVoices() > 0) sam_[b].render(tmpL_.data(), tmpR_.data(), n);
                if (b == kBusPerc && auxPerc_.activeVoices() > 0) auxPerc_.render(tmpL_.data(), tmpR_.data(), n);
                for (int i = 0; i < n; ++i) {
                    double l = tmpL_[static_cast<size_t>(i)], r = tmpR_[static_cast<size_t>(i)];
                    if (snare) {
                        l = biquadProcess(snareSh_, snShL_, l); r = biquadProcess(snareSh_, snShR_, r);
                        stEq(hpSnQ_, snHp_, l, r);
                        for (int k = 0; k < kSnEq; ++k) stEq(snQ_[k], snS_[k], l, r);
                        shellDynamics(shSn_, l, r, shapeSn_, parMixSn_);
                    } else {
                        l = biquadProcess(busHp_[b], busHpL_[b], l); r = biquadProcess(busHp_[b], busHpR_[b], r);
                        if (b >= kBusHats) { l = biquadProcess(busSh_, busShL_[b], l); r = biquadProcess(busSh_, busShR_[b], r); }
                    }
                    bL_[static_cast<size_t>(i)] = l; bR_[static_cast<size_t>(i)] = r;
                }
                if (snare) {
                    // rimshot: ya trae el crack del aro, se mezcla despues de la EQ/dinamica de la caja
                    if (rimSam_.activeVoices() > 0) {
                        std::fill(tmpL_.begin(), tmpL_.begin() + n, 0.0f);
                        std::fill(tmpR_.begin(), tmpR_.begin() + n, 0.0f);
                        rimSam_.render(tmpL_.data(), tmpR_.data(), n);
                        for (int i = 0; i < n; ++i) {
                            double l = tmpL_[static_cast<size_t>(i)], r = tmpR_[static_cast<size_t>(i)];
                            stEq(hpSnQ_, rimHp_, l, r);
                            bL_[static_cast<size_t>(i)] += l * rimComp_; bR_[static_cast<size_t>(i)] += r * rimComp_;
                        }
                    }
                    renderBody(bodySn_, kBodySn, n, bodyBuf_.data());
                }
            }
            // 2) mezcla de micrófonos, nivel de bus y envíos
            const double g0 = samGainCur_[b], g1 = samGainTgt_[b];
            samGainCur_[b] = g1;
            const double dry = kBusRoute[b][0], oh = kBusRoute[b][1], rm = kBusRoute[b][2];
            const bool body = snare || toms;
            const double sideK = snare ? snareSideK_ : (toms ? tomsSideK_ : 1.0);   // caja y toms mas directos: el banco trae el lado (overheads + sala) 4-8 dB bajo el centro
            for (int i = 0; i < n; ++i) {
                double l = bL_[static_cast<size_t>(i)], r = bR_[static_cast<size_t>(i)];
                // micrófonos: centro = cercanos (+ overhead central), lados = overheads + ambiente real de la muestra estéreo
                { const double m = 0.5 * (l + r) * closeG_, sd = 0.5 * (l - r) * ambG_ * sideK; l = m + sd; r = m - sd; }
                if (body) { const double bd = bodyBuf_[static_cast<size_t>(i)] * closeG_; l += bd; r += bd; }
                const double g = g0 + (g1 - g0) * static_cast<double>(i + 1) / n;
                l *= g; r *= g;
                sdL_[static_cast<size_t>(i)] += l * dry;
                sdR_[static_cast<size_t>(i)] += r * dry;
                const size_t ri = static_cast<size_t>((ohPos_ + i) & mask);
                ohRingL_[ri] += l * oh;
                ohRingR_[ri] += r * oh;
                roomIn_[static_cast<size_t>(i)] += 0.5 * (l + r) * rm;
            }
        }
    }

    // ---------------- utilidades ----------------
    static double airDb(double a01) { return -2.0 + 8.0 * a01; }
    static double roomGain(double b01) { return 1.25 * std::pow(b01, 1.3); }
    double fadeMulFor(double sec, double db) const { return std::exp(std::log(std::pow(10.0, -db / 20.0)) / (std::max(1.0e-4, sec) * sr_)); }
    void fade(Voice& v, double sec, double db) {
        const double mul = fadeMulFor(sec, db);
        if (!v.fading || mul < v.fadeMul) v.fadeMul = mul;
        v.fading = true;
    }
    static double t60ToDecay(double t60, double sr) { return std::exp(-6.907755278982137 / (std::max(1.0e-4, t60) * sr)); }

    // Añade un modo (resonador de 2 polos con T60 propio y fase inicial). Descarta los inaudibles.
    void setMode(Voice& v, int /*k*/, double f, double a, double t60, double phase) const {
        if (v.nModes >= kMaxModes || f >= 0.45 * sr_ || f <= 5.0 || std::fabs(a) < 1.0e-4) return;
        t60 = std::max(1.0e-3, t60);
        const double r = std::pow(10.0, -3.0 / (t60 * sr_));
        const double w = 2.0 * kPi * f / sr_;
        const int k = v.nModes;
        v.mc[k] = 2.0 * r * std::cos(w);
        v.mr2[k] = r * r;
        v.my1[k] = a * std::sin(phase - w) / r;
        v.my2[k] = a * std::sin(phase - 2.0 * w) / (r * r);
        v.modeDie[v.nModes] = static_cast<int64_t>(std::log(std::fabs(a) / 1.0e-4) * t60 * sr_ / 6.907755278982137) + 1;
        ++v.nModes;
    }
    // Ordena por muerte descendente: los modos que caen antes quedan al final y se descartan del bucle
    static void sortModes(Voice& v) {
        for (int i = 1; i < v.nModes; ++i) {
            const double c = v.mc[i], r2 = v.mr2[i], y1 = v.my1[i], y2 = v.my2[i]; const int64_t dk = v.modeDie[i];
            int j = i - 1;
            while (j >= 0 && v.modeDie[j] < dk) {
                v.mc[j + 1] = v.mc[j]; v.mr2[j + 1] = v.mr2[j]; v.my1[j + 1] = v.my1[j]; v.my2[j + 1] = v.my2[j]; v.modeDie[j + 1] = v.modeDie[j]; --j;
            }
            v.mc[j + 1] = c; v.mr2[j + 1] = r2; v.my1[j + 1] = y1; v.my2[j + 1] = y2; v.modeDie[j + 1] = dk;
        }
    }
    void setBand(Voice& v, int i, int type, double f, double q, double amp, double tau, double swell) const {
        Band& b = v.b[i];
        const BiquadCoefs c = BiquadCoefs::design(type == 1 ? FilterType::HighPass : FilterType::BandPass, sr_, f, 0.0, q);
        b.b0 = c.b0; b.b1 = c.b1; b.b2 = c.b2; b.a1 = c.a1; b.a2 = c.a2; b.z1 = b.z2 = 0.0;
        b.amp = amp; b.ed = 1.0; b.dd = std::exp(-1.0 / (std::max(1.0e-4, tau) * sr_));
        if (swell > 0.0) { b.ea = 1.0; b.da = std::exp(-1.0 / (swell * sr_)); } else { b.ea = 0.0; b.da = 0.0; }
        b.on = amp > 1.0e-6;
        b.rng = v.seedNext();
    }
    // Registra la duración de un componente (segundos hasta -100 dB)
    static void upLife(double& maxT, double t100) { maxT = std::max(maxT, t100); }

    void routeVoice(Voice& v, int el, double level) const {
        struct R { double dry, dryPan, oh, ohPan, room; };
        static const R tab[kNumEl] = {
            { 0.95, 0.00, 0.22, 0.00, 0.90 },      // bombo
            { 0.90, -0.06, 0.45, -0.10, 0.85 },    // caja
            { 0.90, -0.06, 0.50, -0.10, 0.90 },    // rimshot
            { 0.85, -0.06, 0.40, -0.10, 0.80 },    // cross-stick
            { 0.80, 0.60, 0.50, 0.55, 0.80 },      // tom 41
            { 0.80, 0.45, 0.50, 0.40, 0.80 },      // tom 43
            { 0.80, 0.20, 0.50, 0.18, 0.80 },      // tom 45
            { 0.80, -0.05, 0.50, -0.05, 0.80 },    // tom 47
            { 0.80, -0.30, 0.50, -0.28, 0.80 },    // tom 48
            { 0.80, -0.50, 0.50, -0.45, 0.80 },    // tom 50
            { 0.28, -0.50, 0.55, -0.55, 0.50 },    // hi-hat cerrado
            { 0.24, -0.50, 0.50, -0.55, 0.45 },    // hi-hat pedal
            { 0.30, -0.50, 0.60, -0.55, 0.55 },    // hi-hat abierto
            { 0.25, 0.45, 0.80, 0.60, 0.60 },      // ride
            { 0.25, 0.50, 0.80, 0.65, 0.60 },      // ride 2
            { 0.25, 0.45, 0.80, 0.60, 0.60 },      // campana
            { 0.18, -0.40, 0.85, -0.55, 0.70 },    // crash 1
            { 0.18, 0.35, 0.85, 0.50, 0.70 },      // crash 2
            { 0.18, -0.20, 0.80, -0.25, 0.60 },    // splash
            { 0.18, 0.65, 0.80, 0.70, 0.65 },      // china
        };
        static const double trimDb[kNumEl] = { 0.0, -12.0, -12.6, -3.0, -5.0, -5.5, -4.0, -2.8, -4.9, -4.5, -15.3, -12.9, -16.1, -15.2, -15.7, -15.7, -17.4, -17.4, -19.5, -18.9 };
        level *= std::pow(10.0, trimDb[el] / 20.0);
        const R& r = tab[el];
        const double a = (r.dryPan + 1.0) * kPi * 0.25;
        v.dryL = std::cos(a) * r.dry * level; v.dryR = std::sin(a) * r.dry * level;
        const double b = (r.ohPan + 1.0) * kPi * 0.25;
        v.ohL = std::cos(b) * r.oh * level; v.ohR = std::sin(b) * r.oh * level;
        v.dL = static_cast<int>(std::lround((1.0 + r.ohPan) * 0.5 * ohMax_));    // el micro izq está más lejos de lo que suena a la derecha
        v.dR = static_cast<int>(std::lround((1.0 - r.ohPan) * 0.5 * ohMax_));
        v.room = r.room * level;
    }

    // ---------------- inicio de cada elemento ----------------
    void start(Voice& v, int el, int note, double vel, double chokeRing) {
        v = Voice{};
        v.invSr = 1.0 / sr_;
        v.active = true; v.el = el; v.order = orderCtr_++;
        Rng r;
        r.seed(0x9E3779B9u ^ (static_cast<uint32_t>(note) * 7919u) ^ (static_cast<uint32_t>(vel * 1000.0) * 104729u) ^ (hitCount_++ * 2654435761u));
        v.rng = r.next() | 1u;
        double maxT = 0.05;
        const bool shell = el <= kElTom5;
        const double lvl = shell ? shellsLin_ : cymLin_;
        routeVoice(v, el, 1.0);
        v.gain = lvl;
        if (el == kElKick) startKick(v, r, vel, note == 35, maxT);
        else if (el == kElSnare || el == kElRim) startSnare(v, r, vel, el == kElRim, maxT);
        else if (el == kElSide) startSide(v, r, vel, maxT);
        else if (el <= kElTom5) startTom(v, r, vel, el - kElTom0, maxT);
        else startCymbal(v, r, el, vel, chokeRing, maxT, note);
        sortModes(v);
        v.life = static_cast<int64_t>(std::min(10.0, maxT) * sr_);
    }

    void startKick(Voice& v, Rng& r, double vel, bool ac35, double& maxT) {
        const double va = velAmp(vel);
        const double fEnd = s_.kickTuneHz * bendMul_ * (1.0 + r.jit(0.004)) * (ac35 ? 0.96 : 1.0);
        const double fStart = fEnd * (1.9 + 1.7 * vel);
        const double pTau = (0.020 + 0.008 * (1.0 - vel)) * (1.0 + r.jit(0.1));
        const double oTau = 0.125 * std::pow(55.0 / fEnd, 0.4) * (0.8 + 0.3 * vel) * (1.0 + r.jit(0.08)) * (ac35 ? 1.1 : 1.0);
        v.osc = true; v.ph = 0.0; v.fEnd = fEnd; v.dF = fStart - fEnd; v.pe = 1.0;
        v.pDec = std::exp(-1.0 / (pTau * sr_));
        v.eO = 1.0; v.oDec = std::exp(-1.0 / (oTau * sr_));
        v.eA = 1.0; v.aDec = std::exp(-1.0 / (0.0010 * sr_));
        v.ampO = 0.78 * va;
        v.drive = 0.4 + 2.2 * vel; v.driveNorm = 1.0 / std::tanh(v.drive);
        upLife(maxT, oTau * 11.5);
        // resonancia de parche y caja
        const double ratios[3] = { 1.0, 2.03, 4.65 }, amps[3] = { 0.16, 0.08, 0.05 }, t60[3] = { 0.55, 0.20, 0.07 };
        for (int k = 0; k < 3; ++k) {
            const double t = t60[k] * (1.0 + r.jit(0.08));
            const double jf = r.jit(0.003), ja = r.jit(0.12), jp = r.u();   // orden de sorteo explícito (idéntico en la versión web)
            setMode(v, k, fEnd * ratios[k] * (1.0 + jf), amps[k] * va * std::exp(ja), t, jp * 0.4);
            upLife(maxT, t * 1.67);
        }
        // click de pedal y slap
        const double jc1 = r.jit(0.06), jc2 = r.jit(0.1);
        setBand(v, 0, 0, (2200.0 + 2800.0 * vel) * (1.0 + jc1), 1.1, va * (0.02 + 0.45 * std::pow(vel, 1.6)) * (ac35 ? 0.7 : 1.0), 0.0028 * (1.0 + jc2), 0.0);
        setBand(v, 1, 0, 900.0, 0.9, va * 0.09 * vel, 0.009, 0.0);
    }

    void startSnare(Voice& v, Rng& r, double vel, bool rim, double& maxT) {
        const double va = velAmp(vel);
        static const double ratio[8] = { 1.0, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501 };
        const double f0 = 185.0 * bendMul_ * (1.0 + r.jit(0.004)) * (1.0 + 0.012 * vel);
        const double ghost = 0.55 + 0.45 * smooth01(vel / 0.4);
        const double t601 = (0.16 + 0.12 * vel) * ghost;
        const double tilt = (1.7 - 1.0 * vel) + r.jit(0.12);
        for (int k = 0; k < 8; ++k) {
            const double a = std::pow(ratio[k], -tilt) * std::exp(r.jit(0.25)) * 0.85 * va;
            const double t = t601 / (1.0 + 0.8 * (ratio[k] - 1.0)) * (1.0 + r.jit(0.08));
            const double jf = r.jit(0.0025), jp = r.u();
            setMode(v, k, f0 * ratio[k] * (1.0 + jf), a, t, jp * 0.5);
            upLife(maxT, t * 1.67);
        }
        // baqueta
        const double js1 = r.jit(0.06), js2 = r.jit(0.1);
        setBand(v, 0, 1, (1800.0 + 4200.0 * vel) * (1.0 + js1), 0.7, va * (0.04 + 0.34 * std::pow(vel, 1.2)), 0.0022 * (1.0 + js2), 0.0);
        // aro (rimshot / crack progresivo)
        const double rimAmt = rim ? 1.0 : 0.55 * smooth01((vel - 0.80) / 0.20);
        if (rimAmt > 0.01) {
            const double jr1 = r.jit(0.01), pr1 = r.u();
            setMode(v, 8, 1020.0 * (1.0 + jr1), 0.30 * rimAmt * va, 0.03, pr1 * 0.5);
            const double jr2 = r.jit(0.01), pr2 = r.u();
            setMode(v, 9, 2380.0 * (1.0 + jr2), 0.20 * rimAmt * va, 0.02, pr2 * 0.5);
            setBand(v, 1, 0, 3100.0 * (1.0 + r.jit(0.04)), 3.0, 0.5 * rimAmt * va, 0.004, 0.0);
        }
        // bordonos
        const double snap = s_.snareSnap;
        const double wd = 0.13 + 0.06 * vel;
        const BiquadCoefs c = BiquadCoefs::design(FilterType::BandPass, sr_, 4300.0 * (1.0 + r.jit(0.03)), 0.0, 0.5);
        v.wiresOn = true;
        v.wires.rng = v.seedNext();
        v.wires.b0 = c.b0; v.wires.b1 = c.b1; v.wires.b2 = c.b2; v.wires.a1 = c.a1; v.wires.a2 = c.a2;
        v.wires.amp = va * (0.08 + 0.28 * snap) * 0.5; v.wires.ed = 1.0; v.wires.dd = std::exp(-1.0 / (wd * sr_));
        v.folGain = (0.15 + 0.55 * snap) * (0.45 + 0.65 * vel);
        v.folA = 1.0 - std::exp(-1.0 / (0.0003 * sr_)); v.folR = 1.0 - std::exp(-1.0 / (0.025 * sr_));
        upLife(maxT, t601 * 1.67 + 0.1);
        upLife(maxT, wd * 11.5);
    }

    void startSide(Voice& v, Rng& r, double vel, double& maxT) {
        const double va = velAmp(vel) * 0.8;
        const double fq[4] = { 410.0, 780.0, 1260.0, 185.0 }, am[4] = { 0.5, 0.35, 0.25, 0.18 }, t6[4] = { 0.07, 0.05, 0.035, 0.12 };
        for (int k = 0; k < 4; ++k) {
            const double t = t6[k] * (1.0 + r.jit(0.1));
            const double jf = r.jit(0.01), ja = r.jit(0.15), jp = r.u();
            setMode(v, k, fq[k] * bendMul_ * (1.0 + jf), am[k] * va * std::exp(ja), t, jp * 0.6);
            upLife(maxT, t * 1.67);
        }
        setBand(v, 0, 0, 2000.0 * (1.0 + r.jit(0.05)), 2.0, 0.35 * va, 0.0018, 0.0);
    }

    void startTom(Voice& v, Rng& r, double vel, int idx, double& maxT) {
        static const double base[6] = { 78.0, 92.0, 108.0, 128.0, 152.0, 180.0 };
        const double va = velAmp(vel);
        const double f = base[idx] * bendMul_ * (1.0 + r.jit(0.004)) * (1.0 + 0.02 * vel);
        const double damp = s_.tomsDamp;
        const double t60 = 1.5 * std::pow(0.12, damp) * (0.8 + 0.4 * vel) * (1.0 + r.jit(0.08));
        v.osc = true; v.ph = 0.0; v.fEnd = f; v.dF = f * (0.12 + 0.14 * vel); v.pe = 1.0;
        v.pDec = std::exp(-1.0 / (0.05 * sr_));
        v.eO = 1.0; v.oDec = t60ToDecay(t60, sr_);
        v.eA = 1.0; v.aDec = std::exp(-1.0 / (0.0009 * sr_));
        v.ampO = 0.7 * va; v.drive = 0.6 * vel; v.driveNorm = v.drive > 0.01 ? 1.0 / std::tanh(v.drive) : 1.0;
        upLife(maxT, t60 * 1.67);
        static const double rat[5] = { 1.59, 2.14, 2.65, 3.16, 3.65 }, amp[5] = { 0.30, 0.20, 0.14, 0.10, 0.07 }, tf[5] = { 0.55, 0.40, 0.32, 0.26, 0.20 };
        for (int k = 0; k < 5; ++k) {
            const double jf = r.jit(0.003), ja = r.jit(0.2), jp = r.u();
            setMode(v, k, f * rat[k] * (1.0 + jf), amp[k] * va * std::pow(rat[k], -(0.4 - 0.4 * vel)) * std::exp(ja), t60 * tf[k], jp * 0.6);
        }
        setBand(v, 0, 1, (1400.0 + 3200.0 * vel) * (1.0 + r.jit(0.06)), 0.7, va * (0.02 + 0.30 * std::pow(vel, 1.5)), 0.0025, 0.0);
        setBand(v, 1, 0, 2.2 * f, 2.0, va * 0.12, 0.02, 0.0);
    }

    void startCymbal(Voice& v, Rng& r, int el, double vel, double chokeRing, double& maxT, int note = 0) {
        const double va = velAmp(vel);
        int si = 0;
        double fscale = 1.0, tscale = 1.0, amp = 1.0, openness = 0.0;
        switch (el) {
            case kElHatC: case kElHatP: case kElHatO: si = 0; break;
            case kElRide: si = 1; break;
            case kElRide2: si = 1; fscale = 0.93; tscale = 0.85; amp = 0.95; break;
            case kElBell: si = 2; if (note == 78) { fscale = 0.84; tscale = 1.7; amp = 0.9; } break;   // campana de crash: mas grave y mas larga que la del ride
            case kElCrash1: si = 3; break;
            case kElCrash2: si = 4; break;
            case kElSplash: si = 5; break;
            default: si = 6; break;
        }
        const CymSpec& sp = cymSpec(si);
        const CymTable& tb = tab_[si];
        double hatMult = 1.0;
        if (si == 0) {
            if (el == kElHatO) openness = 1.0;
            else if (el == kElHatC) openness = clampT((1.0 - s_.hatFoot) * 0.8 + 0.08 * vel, 0.0, 0.9);
            else { openness = 0.0; amp = 0.55; }
            hatMult = 1.0 + 14.0 * openness;
            tscale = hatMult * (0.85 + 0.3 * vel);
        } else {
            tscale *= (0.8 + 0.4 * vel) * chokeRing;
        }
        // modos
        double sumsq = 0.0;
        double ak[kMaxModes], fk[kMaxModes];
        int nk = 0;
        for (int k = 0; k < tb.n; ++k) {
            const double f = tb.f[k] * fscale * (1.0 + r.jit(0.0025));
            fk[k] = f;
            if (f >= 0.45 * sr_) { ak[k] = 0.0; continue; }
            const double a = tb.a[k] * std::pow(f / 2000.0, (si == 0 ? 1.3 : 0.5) * (vel - 0.4)) * std::exp(r.jit(0.3));
            ak[k] = a; sumsq += a * a; nk = k + 1;
        }
        const double norm = amp * sp.modeLevel * va / std::sqrt(std::max(sumsq, 1.0e-9)) * 2.2;
        for (int k = 0; k < nk; ++k) {
            if (ak[k] == 0.0) continue;
            const double f = fk[k];
            const double pos = std::log(tb.f[k] / sp.fmin) / std::log(sp.fmax / sp.fmin);
            const double t60 = sp.t60lo * std::pow(sp.t60hi / sp.t60lo, clampT(pos, 0.0, 1.0)) * tscale * (1.0 + r.jit(0.1));
            setMode(v, k, f, ak[k] * norm, t60, r.u() * 6.283185307179586);
            upLife(maxT, t60 * 1.67);
        }
        // ruido en bandas (el continuo del wash domina en crash/china/splash; el ride conserva más "ping" tonal)
        static const double noiseMul[7] = { 1.5, 3.0, 1.0, 2.8, 2.8, 3.6, 2.6 };
        const double nm = noiseMul[si];
        const double ts = si == 0 ? std::pow(hatMult, 0.9) : tscale;
        const double b1t = sp.b1t * ts / 6.9, b2t = sp.b2t * ts / 6.9;
        setBand(v, 0, sp.b1type, sp.b1f * (1.0 + r.jit(0.03)), sp.b1q, sp.b1a * nm * va * amp * (0.7 + 0.6 * vel), b1t, sp.b1swell);
        setBand(v, 1, sp.b2type, sp.b2f * (1.0 + r.jit(0.03)), sp.b2q, sp.b2a * nm * va * amp * (0.7 + 0.6 * vel), b2t, sp.b2swell);
        const double jt1 = r.jit(0.05), jt2 = r.jit(0.1);
        setBand(v, 2, 0, sp.tickF * (1.0 + jt1), sp.tickQ, sp.tickA * va * amp * (0.4 + 0.8 * vel), sp.tickT * (1.0 + jt2), 0.0);
        if (sp.lowA > 0.0) {
            const double lt = sp.lowT * ts / 6.9;
            setBand(v, 3, 0, sp.lowF * (1.0 + r.jit(0.04)), sp.lowQ, sp.lowA * nm * va * amp * (0.7 + 0.6 * vel), lt, sp.lowSwell);
            upLife(maxT, lt * 11.5 + sp.lowSwell);
        }
        upLife(maxT, b1t * 11.5 + sp.b1swell);
        upLife(maxT, b2t * 11.5 + sp.b2swell);
        if (el == kElHatP) {   // golpe seco del pedal
            // sustituye el tick por un thud grave de goma
            setBand(v, 2, 0, 700.0, 1.0, 0.35 * va, 0.012, 0.0);
        }
        if (sp.flutterDepth > 0.0) {
            v.lfoDepth = sp.flutterDepth; v.lfoInc = sp.flutterHz * (1.0 + r.jit(0.15)) / sr_; v.lfoPh = r.u();
        }
    }

    // ---------------- tablas de platos ----------------
    void buildTables() {
        for (int s = 0; s < 7; ++s) {
            const CymSpec& sp = cymSpec(s);
            Rng r; r.seed(sp.seed * 2654435761u + 17u);
            CymTable& t = tab_[s];
            t.n = sp.n;
            for (int k = 0; k < sp.n; ++k) {
                const double u = r.u();
                const double pos = (k + 0.15 + 0.7 * u) / sp.n;
                const double f = sp.fmin * std::pow(sp.fmax / sp.fmin, pos);
                double a = std::pow(f / sp.fmin, -sp.tilt) * (0.35 + 1.2 * r.u());
                if (sp.pingA > 0.0) { const double q = std::log(f / sp.pingF) / 0.35; a *= 1.0 + sp.pingA * std::exp(-q * q); }
                t.f[k] = f; t.a[k] = a;
            }
        }
    }

    // ---------------- buses ----------------
    void designBuses(bool force) {
        const double a = air_.current();
        if (!force && std::fabs(a - lastAir_) < 1.0e-4) return;
        lastAir_ = a;
        const BiquadCoefs hp = BiquadCoefs::design(FilterType::HighPass, sr_, 80.0, 0.0, 0.707);
        const BiquadCoefs sh = BiquadCoefs::design(FilterType::HighShelf, sr_, 7500.0, a, 0.6);
        ohHp_ = hp; ohSh_ = sh;
    }
    void designSympathy() {
        static const double base[6] = { 78.0, 92.0, 108.0, 128.0, 152.0, 180.0 };
        const double t60 = 1.2 * std::pow(0.12, s_.tomsDamp) + 0.05;
        const double rr = std::pow(10.0, -3.0 / (t60 * sr_));
        for (int i = 0; i < 6; ++i) {
            const double w = 2.0 * kPi * base[i] / sr_;
            symC_[i] = 2.0 * rr * std::cos(w); symR2_ = rr * rr; symG_[i] = (1.0 - rr) * 2.0 * std::sin(w) * kSymTom;   // ganancia de pico en resonancia = kSymTom
        }
        symLpA_ = 1.0 - std::exp(-2.0 * kPi * 300.0 / sr_);
        symFolA_ = 1.0 - std::exp(-1.0 / (0.002 * sr_));
        symFolR_ = 1.0 - std::exp(-1.0 / (0.150 * sr_));
        const BiquadCoefs c = BiquadCoefs::design(FilterType::BandPass, sr_, 4300.0, 0.0, 0.5);
        symWc_ = c;
        compA_ = std::exp(-1.0 / (0.002 * sr_)); compR_ = std::exp(-1.0 / (0.140 * sr_));
    }

    static inline double softClip(double x) {
        const double a = std::fabs(x);
        if (a <= 0.7) return x;
        const double y = 0.7 + 0.28 * std::tanh((a - 0.7) / 0.28);   // asíntota 0.98: nunca llega a 1
        return x < 0 ? -y : y;
    }

    template <class T>
    void renderChunk(T* outL, T* outR, int n) {
        std::fill(dryL_.begin(), dryL_.begin() + n, 0.0);
        std::fill(dryR_.begin(), dryR_.begin() + n, 0.0);
        std::fill(roomIn_.begin(), roomIn_.begin() + n, 0.0);
        const int mask = kRing - 1;
        for (auto& v : voices_) {
            if (!v.active) continue;
            for (int i = 0; i < n; ++i) {
                double s = v.tick();
                if (v.fading) {
                    v.gain *= v.fadeMul;
                    if (v.gain < 1.0e-5) { v.active = false; break; }
                }
                s *= v.gain;
                dryL_[static_cast<size_t>(i)] += s * v.dryL;
                dryR_[static_cast<size_t>(i)] += s * v.dryR;
                ohRingL_[static_cast<size_t>((ohPos_ + i + v.dL) & mask)] += s * v.ohL;
                ohRingR_[static_cast<size_t>((ohPos_ + i + v.dR) & mask)] += s * v.ohR;
                roomIn_[static_cast<size_t>(i)] += s * v.room;
            }
            v.life -= n;
            v.age += n;
            while (v.nModes > 0 && v.modeDie[v.nModes - 1] <= v.age) { --v.nModes; v.mc[v.nModes] = v.mr2[v.nModes] = v.my1[v.nModes] = v.my2[v.nModes] = 0.0; }
            for (int bi = 0; bi < kMaxBands; ++bi) if (v.b[bi].on && v.b[bi].amp * v.b[bi].ed < 1.0e-6) v.b[bi].on = false;
            if (v.life <= 0) v.active = false;
        }
        renderSamples(n);
        // parámetros suavizados por chunk
        air_.advance(n);
        designBuses(false);
        const double rg0 = roomG_.current(), rg1 = roomG_.advance(n);
        const double vg0 = vol_.current(), vg1 = vol_.advance(n), w0 = wet_.current(), w1 = wet_.advance(n);
        for (int i = 0; i < n; ++i) {
            const size_t ri = static_cast<size_t>((ohPos_ + i) & mask);
            double oL = ohRingL_[ri], oR = ohRingR_[ri];
            ohRingL_[ri] = 0.0; ohRingR_[ri] = 0.0;
            oL = biquadProcess(ohSh_, ohShL_, biquadProcess(ohHp_, ohHpL_, oL));
            oR = biquadProcess(ohSh_, ohShR_, biquadProcess(ohHp_, ohHpR_, oR));
            double dl = dryL_[static_cast<size_t>(i)], dr = dryR_[static_cast<size_t>(i)];
            // simpatía: la señal directa excita los toms y los bordonos
            const double x = 0.5 * (dl + dr);
            double sym = 0.0;
            for (int k = 0; k < 6; ++k) {
                const double o = symC_[k] * symY1_[k] - symR2_ * symY2_[k] + symG_[k] * x;
                symY2_[k] = symY1_[k]; symY1_[k] = o;
                sym += o;
            }
            symLp_ += symLpA_ * (x - symLp_);
            const double ax = std::fabs(symLp_);
            symFol_ += (ax - symFol_) * (ax > symFol_ ? symFolA_ : symFolR_);
            const double wn = biquadProcess(symWc_, symW_, symNoise());
            sym += wn * symFol_ * kSymWires;
            dl += sym; dr += sym;
            // sala
            double rl = 0.0, rr = 0.0;
            room_.process(roomIn_[static_cast<size_t>(i)] * 0.5, rl, rr);
            // compresión suave de sala (enlazada)
            const double det = std::max(std::fabs(rl), std::fabs(rr));
            compEnv_ = det > compEnv_ ? det + compA_ * (compEnv_ - det) : det + compR_ * (compEnv_ - det);
            if (((sampleCtr_ + i) & 3) == 0) {
                double grDb = 0.0;
                if (compEnv_ > compThrLin_) grDb = (linearToDb(compEnv_) - compThr_) * (1.0 - 1.0 / compRatio_);
                compGr_ = grDb;
                compGain_ = (grDb > 0.0 ? dbToLinear(-grDb) : 1.0) * compMakeup_;
            }
            rl = warmL_ = (1.0 - warmA_) * rl + warmA_ * warmL_;
            rr = warmR_ = (1.0 - warmA_) * rr + warmA_ * warmR_;
            const double cg = compGain_;
            const double t = static_cast<double>(i + 1) / n;
            const double rgain = rg0 + (rg1 - rg0) * t;
            double L = dl + sdL_[static_cast<size_t>(i)] + oL * ohMaster + rl * cg * rgain;
            double R = dr + sdR_[static_cast<size_t>(i)] + oR * ohMaster + rr * cg * rgain;
            // saturación de cinta sutil (ganancia unitaria en pequeña señal), compresión paralela y suavizado de agudos
            L = std::tanh(L * tapeDrive_) / tapeDrive_; R = std::tanh(R * tapeDrive_) / tapeDrive_;
            const double pk = std::max(std::fabs(L), std::fabs(R));
            parEnv_ = pk > parEnv_ ? pk + parA_ * (parEnv_ - pk) : pk + parR_ * (parEnv_ - pk);
            if ((++parCtr_ & 3) == 0) {
                const double dbE = linearToDb(std::max(parEnv_, 1.0e-6));
                parGain_ = dbE > -30.0 ? dbToLinear(-(dbE + 30.0) * 0.8 + 6.0) : dbToLinear(6.0);   // umbral -30 dB, ratio 5:1, +6 dB de maquillaje
            }
            L += parMix_ * parGain_ * L * 0.5; R += parMix_ * parGain_ * R * 0.5;
            L = biquadProcess(smoothSh_, smShL_, L); R = biquadProcess(smoothSh_, smShR_, R);
            const double g = (vg0 + (vg1 - vg0) * t) * (w0 + (w1 - w0) * t);
            L *= g; R *= g;
            // bloqueo de DC (15 Hz) y soft-clip
            const double yl = L - dcX_[0] + dcR_ * dcY_[0]; dcX_[0] = L; dcY_[0] = yl;
            const double yr = R - dcX_[1] + dcR_ * dcY_[1]; dcX_[1] = R; dcY_[1] = yr;
            outL[i] = static_cast<T>(softClip(yl));
            outR[i] = static_cast<T>(softClip(yr));
        }
        ohPos_ = (ohPos_ + n) & mask;
        sampleCtr_ += n;
    }
    inline double symNoise() { symRng_ ^= symRng_ << 13; symRng_ ^= symRng_ >> 17; symRng_ ^= symRng_ << 5; return static_cast<double>(static_cast<int32_t>(symRng_)) * (1.0 / 2147483648.0); }

    static constexpr int kRing = 256;
    static constexpr double ohMaster = 0.9;
    static constexpr double kSymTom = 0.12;
    static constexpr double kSymWires = 0.05;

    double sr_{48000.0};
    DrumSettings s_;
    std::array<Voice, kVoiceSlots> voices_;
    CymTable tab_[7];
    Smoother vol_, wet_, air_, roomG_;
    double shellsLin_{1.0}, cymLin_{1.0}, percLin_{1.0};
    double lastAir_{-99.0};
    int ohMax_{24}, ohPos_{0};
    int64_t sampleCtr_{0};
    bool primed_{false};
    std::array<double, kRing> ohRingL_{}, ohRingR_{};
    std::array<double, kChunk> dryL_{}, dryR_{}, roomIn_{};
    // muestras
    JwSampler::Sampler sam_[kNumBus];   // (el hueco kBusToms no se usa: los toms tienen un sampler cada uno)
    JwSampler::Sampler tomSam_[kNumToms], rimSam_;
    JwSampler::Sampler auxPerc_;           // banco de percusion auxiliar (drum-kits/percusion), cargado en paralelo al kit
    int lastKitIdx_{-1};
    bool kitMd_{true};     // el kit activo es el MuldjordKit (calibracion de cuerpo y pegada de caja y toms)
    std::atomic<bool> slugPend_{false};
    // v3: cuerpo y pegada de caja y toms
    BiquadCoefs snC_[kSnEq], tmC_[kNumToms][kTmEq], tmRes_[kNumToms];
    SEq snQ_[kSnEq], tmQ_[kNumToms][kTmEq], hpSnQ_, hpTmQ_;
    BiquadState tmResS_[kNumToms];
    double tomResGain_{0.0};
    SZ snS_[kSnEq], tmS_[kNumToms][kTmEq], tmHp_[kNumToms], snHp_, rimHp_;
    ShellFx shSn_, shTm_;
    double shellKey_[10]{ -1, -1, -1, -1, -1, -1, -1, -1, -1, -1 };
    double bodySnare_{0}, bodyToms_{0}, shellPunchK_{0}, velLift_{0}, velLiftSn_{0}, shapeSn_{0}, shapeTm_{0}, parMixSn_{0}, parMixTm_{0}, parDrive_{1.5};
    double snareEngage_{1.0}, tomsEngage_{1.0}, rimComp_{1.0}, snareSideK_{1.0}, tomsSideK_{1.0};
    double parMk_{8.0}, parThr_{-28.0}, tomTrimLin_[kNumToms]{ 1, 1, 1, 1, 1, 1 };
    double shaperAF_{0.1}, shaperRF_{0.01}, shaperAS_{0.01}, shaperRS_{0.003}, parAtk_{0.02}, parRel_{0.0002};
    BodyVoice bodySn_[kBodySn], bodyTm_[kBodyTm];
    int64_t bodyOrder_{0};
    uint32_t bodyRng_{0x2545F491u};
    std::array<double, kChunk> bL_{}, bR_{}, bodyBuf_{};
    int quiet_[kNumBus]{};
    bool samLoadStarted_{false};
    std::array<float, kChunk> tmpL_{}, tmpR_{};
    std::array<double, kChunk> sdL_{}, sdR_{};
    double samGainCur_[kNumBus]{ 1, 1, 1, 1, 1, 1 }, samGainTgt_[kNumBus]{ 1, 1, 1, 1, 1, 1 };
    double tomHoldSec_{1.0}, lastSnapDb_{-99.0};
    int tomHold_[128]{};
    Rng hum_;
    bool handR_[kNumBus]{};
    double closeG_{1.0}, ambG_{1.0};
    BiquadCoefs snareSh_, busHp_[kNumBus], busSh_, smoothSh_;
    BiquadState busHpL_[kNumBus], busHpR_[kNumBus], busShL_[kNumBus], busShR_[kNumBus], smShL_, smShR_;
    double warmA_{0.5}, tapeDrive_{1.3}, parMix_{0.27}, parA_{0.99}, parR_{0.999}, parEnv_{0.0}, parGain_{1.0}, warmL_{0}, warmR_{0};
    int64_t parCtr_{0};
    BiquadState snShL_, snShR_;
    BiquadCoefs ohHp_, ohSh_;
    BiquadState ohHpL_, ohHpR_, ohShL_, ohShR_;
    RoomFdn room_;
    JasWaveFx::FxRack fx_;   // FX Rack comun del master
    double compThrLin_{0.0158}, compGain_{1.0}, compThr_{-36.0}, compRatio_{2.9}, compMakeup_{1.0}, compA_{0.99}, compR_{0.999}, compEnv_{0.0}, compGr_{0.0};
    // simpatía
    double symC_[6]{}, symG_[6]{}, symY1_[6]{}, symY2_[6]{}, symR2_{0.0};
    double symLp_{0}, symLpA_{0.05}, symFol_{0}, symFolA_{0.01}, symFolR_{0.001};
    BiquadCoefs symWc_;
    BiquadState symW_;
    uint32_t symRng_{0xA5A5A5A5u};
    double dcR_{0.998}, dcX_[2]{}, dcY_[2]{};
    double bend_{0.0}, bendMul_{1.0};
    uint32_t hitCount_{0};
    int64_t orderCtr_{0};
    float hit_[kNumPads]{};
    uint32_t listPub_{0};
    KitService kit_;   // ULTIMO miembro: se destruye primero, su hilo deja de tocar los samplers antes de que desaparezcan
};

} // namespace JasWaveWorshipDrums
