// =====================================================================================
//  JasWave – definición declarativa de parámetros (sin dependencia del SDK VST3)
//  Una única tabla alimenta: Controller (RangeParameter propio), Processor (mapeo
//  normalizado -> plano), estado persistente y UI (formato de valores).
// =====================================================================================
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace JasWaveVst {

enum class Map : uint8_t { Linear, Log, Stepped };

struct ParamDef {
    uint32_t id;
    const char* name;
    const char* units;
    Map map;
    double minV, maxV, defV;     // valores planos (en Stepped: índice 0..steps)
    int steps;                   // sólo Stepped: nº de pasos (count-1)
    int decimals;
    bool bipolar;                // dibujar el arco desde el centro
    bool bypass;                 // marca ParameterInfo::kIsBypass
    const char* const* labels;   // etiquetas para Stepped (opcional)
};

inline const char* const* labelsOnOff() { static const char* const l[] = { "Off", "On" }; return l; }
inline const char* const* labelsBypass() { static const char* const l[] = { "Active", "Bypass" }; return l; }

inline ParamDef linearP(uint32_t id, const char* name, const char* units, double mn, double mx, double df, int dec, bool bip = false) {
    return { id, name, units, Map::Linear, mn, mx, df, 0, dec, bip, false, nullptr };
}
inline ParamDef logP(uint32_t id, const char* name, const char* units, double mn, double mx, double df, int dec) {
    return { id, name, units, Map::Log, mn, mx, df, 0, dec, false, false, nullptr };
}
inline ParamDef stepP(uint32_t id, const char* name, int steps, int df, const char* const* labels) {
    return { id, name, "", Map::Stepped, 0.0, static_cast<double>(steps), static_cast<double>(df), steps, 0, false, false, labels };
}
inline ParamDef toggleP(uint32_t id, const char* name, int df, bool isBypass = false) {
    return { id, name, "", Map::Stepped, 0.0, 1.0, static_cast<double>(df), 1, 0, false, isBypass, isBypass ? labelsBypass() : labelsOnOff() };
}

inline double clamp01(double v) { return v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v); }

inline double toPlain(const ParamDef& d, double n) {
    n = clamp01(n);
    switch (d.map) {
        case Map::Stepped: return std::floor(n * d.steps + 0.5);
        case Map::Log:     return d.minV * std::pow(d.maxV / d.minV, n);
        default:           return d.minV + (d.maxV - d.minV) * n;
    }
}
inline double toNorm(const ParamDef& d, double p) {
    switch (d.map) {
        case Map::Stepped: return d.steps > 0 ? clamp01(std::floor(p + 0.5) / d.steps) : 0.0;
        case Map::Log:     return clamp01(std::log(std::max(p, d.minV) / d.minV) / std::log(d.maxV / d.minV));
        default:           return clamp01((p - d.minV) / (d.maxV - d.minV));
    }
}
inline double defaultNorm(const ParamDef& d) { return toNorm(d, d.defV); }

// Texto para UI / host
inline std::string formatValue(const ParamDef& d, double plain, bool withUnit = true) {
    char buf[96];
    if (d.map == Map::Stepped) {
        const int i = std::max(0, std::min(d.steps, static_cast<int>(std::lround(plain))));
        if (d.labels) return d.labels[i];
        std::snprintf(buf, sizeof buf, "%d", i);
        return buf;
    }
    const bool hz = d.units && std::strcmp(d.units, "Hz") == 0;
    const bool ms = d.units && std::strcmp(d.units, "ms") == 0;
    if (!withUnit && (hz || ms)) { std::snprintf(buf, sizeof buf, "%.*f", plain >= 100.0 ? 1 : 2, plain); return buf; }
    if (hz) {
        if (plain >= 1000.0) std::snprintf(buf, sizeof buf, "%.2f kHz", plain / 1000.0);
        else if (plain >= 100.0) std::snprintf(buf, sizeof buf, "%.0f Hz", plain);
        else std::snprintf(buf, sizeof buf, "%.1f Hz", plain);
        return buf;
    }
    if (ms && plain >= 1000.0) { std::snprintf(buf, sizeof buf, "%.2f s", plain / 1000.0); return buf; }
    const char* sign = (d.bipolar && plain > 0.0004) ? "+" : "";
    if (withUnit && d.units && d.units[0]) std::snprintf(buf, sizeof buf, "%s%.*f %s", sign, d.decimals, plain, d.units);
    else std::snprintf(buf, sizeof buf, "%s%.*f", sign, d.decimals, plain);
    return buf;
}

// Tabla id -> índice
class ParamTable {
public:
    ParamTable() = default;
    explicit ParamTable(const std::vector<ParamDef>& defs) { assign(defs); }
    void assign(const std::vector<ParamDef>& defs) {
        defs_ = defs;
        uint32_t maxId = 0;
        for (const auto& d : defs_) maxId = std::max(maxId, d.id);
        lut_.assign(static_cast<size_t>(maxId) + 1, -1);
        for (size_t i = 0; i < defs_.size(); ++i) lut_[defs_[i].id] = static_cast<int16_t>(i);
    }
    int count() const { return static_cast<int>(defs_.size()); }
    int index(uint32_t id) const { return id < lut_.size() ? lut_[id] : -1; }
    const ParamDef& at(int i) const { return defs_[static_cast<size_t>(i)]; }
    const ParamDef* find(uint32_t id) const { const int i = index(id); return i >= 0 ? &defs_[static_cast<size_t>(i)] : nullptr; }
    const std::vector<ParamDef>& defs() const { return defs_; }
private:
    std::vector<ParamDef> defs_;
    std::vector<int16_t> lut_;
};

} // namespace JasWaveVst
