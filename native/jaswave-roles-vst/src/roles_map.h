/**
 * Mapa Role ↔ índice / normalizado — compartido conceptualmente con TS
 * (jas-wave/src/lib/plugin/jaswave-roles.ts).
 */
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>

namespace JasWaveRoles {

enum class Role : int32_t {
  Drums = 0,
  Bass,
  Guitar,
  Piano,
  Keys,
  Pad,
  Strings,
  Choir,
  Lead,
  Brass,
  Synth,
  Percussion,
  Default,
  Count
};

inline constexpr int32_t kParamRoleId = 0;
inline constexpr int32_t kParamAttackId = 1;
inline constexpr int32_t kParamReleaseId = 2;
inline constexpr int32_t kParamCutoffId = 3;
inline constexpr int32_t kParamResonanceId = 4;
inline constexpr int32_t kParamGainId = 5;
inline constexpr int32_t kParamVoicesId = 6;
inline constexpr int32_t kNumRoles = static_cast<int32_t>(Role::Count);
inline constexpr int32_t kMaxVoices = 64;

/** Caps por rol (anti-saturación, port de Soft Pad TS). */
inline int32_t voiceCapForRole(Role r) {
  switch (r) {
    case Role::Drums:
    case Role::Percussion:
      return 8;
    case Role::Bass:
      return 4;
    case Role::Guitar:
      return 6;
    case Role::Piano:
    case Role::Keys:
      return 12;
    case Role::Pad:
    case Role::Strings:
    case Role::Choir:
      return 8;
    case Role::Lead:
    case Role::Brass:
    case Role::Synth:
      return 6;
    default:
      return 8;
  }
}

inline float roleToNormalized(Role r) {
  const int i = static_cast<int>(r);
  if (kNumRoles <= 1) return 0.f;
  return static_cast<float>(i) / static_cast<float>(kNumRoles - 1);
}

inline Role roleFromNormalized(double n) {
  const double c = std::clamp(n, 0.0, 1.0);
  const int idx = static_cast<int>(std::lround(c * (kNumRoles - 1)));
  return static_cast<Role>(std::clamp(idx, 0, kNumRoles - 1));
}

inline Role roleFromName(const char* name) {
  if (!name || !*name) return Role::Default;
  // lowercase compare helpers
  auto eq = [](const char* a, const char* b) {
    while (*a && *b) {
      const char ca = (*a >= 'A' && *a <= 'Z') ? static_cast<char>(*a + 32) : *a;
      const char cb = (*b >= 'A' && *b <= 'Z') ? static_cast<char>(*b + 32) : *b;
      if (ca != cb) return false;
      ++a;
      ++b;
    }
    return *a == 0 && *b == 0;
  };
  auto has = [](const char* hay, const char* needle) {
    // simple substring case-insensitive
    for (const char* p = hay; *p; ++p) {
      const char* h = p;
      const char* n = needle;
      while (*h && *n) {
        const char ch = (*h >= 'A' && *h <= 'Z') ? static_cast<char>(*h + 32) : *h;
        const char cn = (*n >= 'A' && *n <= 'Z') ? static_cast<char>(*n + 32) : *n;
        if (ch != cn) break;
        ++h;
        ++n;
      }
      if (!*n) return true;
    }
    return false;
  };

  if (eq(name, "drums") || eq(name, "drum") || has(name, "bater") || has(name, "drum") ||
      has(name, "kit"))
    return Role::Drums;
  if (eq(name, "percussion")) return Role::Percussion;
  if (eq(name, "bass") || eq(name, "bajo") || has(name, "bass") || has(name, "bajo"))
    return Role::Bass;
  if (eq(name, "guitar") || eq(name, "guitarra") || has(name, "guitar")) return Role::Guitar;
  if (eq(name, "piano") || has(name, "piano")) return Role::Piano;
  if (eq(name, "keys") || eq(name, "organ") || has(name, "keys") || has(name, "teclado") ||
      has(name, "organ"))
    return Role::Keys;
  if (eq(name, "pad") || eq(name, "ambient") || has(name, "pad") || has(name, "ambient"))
    return Role::Pad;
  if (eq(name, "strings") || eq(name, "cuerdas") || has(name, "string") || has(name, "cuerda"))
    return Role::Strings;
  if (eq(name, "choir") || eq(name, "coro") || eq(name, "vocal") || has(name, "choir") ||
      has(name, "coro"))
    return Role::Choir;
  if (eq(name, "lead") || eq(name, "melody") || eq(name, "solo") || has(name, "lead") ||
      has(name, "melody"))
    return Role::Lead;
  if (eq(name, "brass") || eq(name, "metales") || has(name, "brass") || has(name, "metal"))
    return Role::Brass;
  if (eq(name, "synth") || eq(name, "fx") || has(name, "synth") || has(name, "sintet"))
    return Role::Synth;
  return Role::Default;
}

inline const char* roleName(Role r) {
  switch (r) {
    case Role::Drums:
      return "drums";
    case Role::Bass:
      return "bass";
    case Role::Guitar:
      return "guitar";
    case Role::Piano:
      return "piano";
    case Role::Keys:
      return "keys";
    case Role::Pad:
      return "pad";
    case Role::Strings:
      return "strings";
    case Role::Choir:
      return "choir";
    case Role::Lead:
      return "lead";
    case Role::Brass:
      return "brass";
    case Role::Synth:
      return "synth";
    case Role::Percussion:
      return "percussion";
    default:
      return "default";
  }
}

} // namespace JasWaveRoles
