#pragma once

#include <cstdint>
#include <string>

/** Bus PCM del DAW → mix nativo.
 *  Protocolo pipe (paquetes):
 *    magic u32 LE = 0x4A575354 ('JWST')
 *    trackIndex u16 (0..63 pista, 0xFFFF = bus DAW/metrónomo)
 *    frameCount u16
 *    frameCount * 2 * f32le interleaved
 *  Legacy: bytes sueltos f32 stereo → bus DAW (0xFFFF).
 */
bool jaswave_mix_bus_start(std::string& pipeName, std::string& err);
void jaswave_mix_bus_stop();

/** Antes de pull/add en el callback: lockstep entre stems vivos + PLL de relleno. */
void jaswave_mix_bus_begin_block(uint32_t frames);

/** Suma el bus DAW (metro / legacy) al buffer ya con cadenas de pista. Audio thread. */
void jaswave_mix_bus_add(float* interleavedStereo, uint32_t frames);

/** Extrae stem de una pista (silencio si vacío). Audio thread. */
void jaswave_mix_bus_pull_stem(uint16_t trackIndex, float* interleavedStereo, uint32_t frames);

/** Push directo de stem (mismo formato que el pipe). Bounce offline. */
void jaswave_mix_bus_push_stem(uint16_t trackIndex, const float* interleavedStereo,
                               uint32_t frames);

bool jaswave_mix_bus_running();
void jaswave_mix_bus_set_input_rate(uint32_t hz);
void jaswave_mix_bus_set_output_rate(uint32_t hz);
void jaswave_mix_bus_reset();
/** Modo bounce: begin_block fija budget=frames sin PLL/lockstep en vivo. */
void jaswave_mix_bus_set_offline(bool offline);

constexpr uint16_t JASWAVE_MIX_DAW_BUS = 0xFFFF;
constexpr uint32_t JASWAVE_MIX_MAGIC = 0x4A575354u;  // 'JWST'
constexpr int JASWAVE_MIX_MAX_TRACKS = 64;
