// =====================================================================================
//  JasWave – JSON mínimo (sin dependencias) para licencias, respuestas HTTP y config.json
//  Árbol pequeño, sin excepciones; límites de profundidad y tamaño para entradas no confiables.
// =====================================================================================
#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace JasWaveLicense {

class JsonValue {
public:
    enum class Type : uint8_t { Null, Bool, Number, String, Array, Object };

    Type type() const { return type_; }
    bool isNull() const { return type_ == Type::Null; }
    bool isString() const { return type_ == Type::String; }
    bool isNumber() const { return type_ == Type::Number; }
    bool isObject() const { return type_ == Type::Object; }
    bool isArray() const { return type_ == Type::Array; }
    bool isBool() const { return type_ == Type::Bool; }

    const std::string& str() const { return str_; }
    double num() const { return num_; }
    bool boolean() const { return bool_; }
    const std::vector<JsonValue>& items() const { return items_; }
    const std::vector<std::pair<std::string, JsonValue>>& members() const { return members_; }

    // Devuelve nullptr si no existe o no es objeto
    const JsonValue* get(std::string_view key) const;
    std::string getString(std::string_view key, const std::string& def = std::string()) const;
    double getNumber(std::string_view key, double def = 0.0) const;

    // Analiza `text`; false si no es JSON válido (o excede límites)
    static bool parse(std::string_view text, JsonValue& out);

private:
    friend class JsonParser;
    Type type_{Type::Null};
    bool bool_{false};
    double num_{0.0};
    std::string str_;
    std::vector<JsonValue> items_;
    std::vector<std::pair<std::string, JsonValue>> members_;
};

// Escapa una cadena UTF-8 como literal JSON (incluye comillas)
std::string jsonQuote(std::string_view s);

} // namespace JasWaveLicense
