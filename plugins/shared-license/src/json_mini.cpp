#include "jw_json.h"

#include <cstdlib>
#include <cstring>

namespace JasWaveLicense {

namespace {
constexpr int kMaxDepth = 32;
constexpr size_t kMaxInput = 256 * 1024;

void appendUtf8(std::string& out, uint32_t cp) {
    if (cp < 0x80) out.push_back(static_cast<char>(cp));
    else if (cp < 0x800) { out.push_back(static_cast<char>(0xC0 | (cp >> 6))); out.push_back(static_cast<char>(0x80 | (cp & 0x3F))); }
    else if (cp < 0x10000) {
        out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else {
        out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    }
}
int hexVal(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}
} // namespace

class JsonParser {
public:
    explicit JsonParser(std::string_view s) : s_(s) {}

    bool parseRoot(JsonValue& v) {
        skipWs();
        if (!parseValue(v, 0)) return false;
        skipWs();
        return p_ == s_.size();
    }

private:
    void skipWs() {
        while (p_ < s_.size() && (s_[p_] == ' ' || s_[p_] == '\t' || s_[p_] == '\n' || s_[p_] == '\r')) ++p_;
    }
    bool lit(const char* w) {
        const size_t n = std::strlen(w);
        if (s_.substr(p_, n) != std::string_view(w, n)) return false;
        p_ += n;
        return true;
    }
    bool parseValue(JsonValue& v, int depth) {
        if (depth > kMaxDepth || p_ >= s_.size()) return false;
        const char c = s_[p_];
        if (c == '{') return parseObject(v, depth);
        if (c == '[') return parseArray(v, depth);
        if (c == '"') { v.type_ = JsonValue::Type::String; return parseString(v.str_); }
        if (c == 't') { if (!lit("true")) return false; v.type_ = JsonValue::Type::Bool; v.bool_ = true; return true; }
        if (c == 'f') { if (!lit("false")) return false; v.type_ = JsonValue::Type::Bool; v.bool_ = false; return true; }
        if (c == 'n') { if (!lit("null")) return false; v.type_ = JsonValue::Type::Null; return true; }
        return parseNumber(v);
    }
    bool parseNumber(JsonValue& v) {
        const size_t start = p_;
        if (p_ < s_.size() && s_[p_] == '-') ++p_;
        bool digits = false;
        while (p_ < s_.size() && s_[p_] >= '0' && s_[p_] <= '9') { ++p_; digits = true; }
        if (p_ < s_.size() && s_[p_] == '.') { ++p_; while (p_ < s_.size() && s_[p_] >= '0' && s_[p_] <= '9') { ++p_; digits = true; } }
        if (p_ < s_.size() && (s_[p_] == 'e' || s_[p_] == 'E')) {
            ++p_;
            if (p_ < s_.size() && (s_[p_] == '+' || s_[p_] == '-')) ++p_;
            while (p_ < s_.size() && s_[p_] >= '0' && s_[p_] <= '9') ++p_;
        }
        if (!digits || p_ - start > 64) return false;
        char buf[72];
        std::memcpy(buf, s_.data() + start, p_ - start);
        buf[p_ - start] = 0;
        char* end = nullptr;
        v.num_ = std::strtod(buf, &end);
        if (!end || *end != 0) return false;
        v.type_ = JsonValue::Type::Number;
        return true;
    }
    bool parseString(std::string& out) {
        if (s_[p_] != '"') return false;
        ++p_;
        out.clear();
        while (p_ < s_.size()) {
            const char c = s_[p_++];
            if (c == '"') return true;
            if (static_cast<unsigned char>(c) < 0x20) return false;
            if (c != '\\') { out.push_back(c); continue; }
            if (p_ >= s_.size()) return false;
            const char e = s_[p_++];
            switch (e) {
                case '"': out.push_back('"'); break;
                case '\\': out.push_back('\\'); break;
                case '/': out.push_back('/'); break;
                case 'b': out.push_back('\b'); break;
                case 'f': out.push_back('\f'); break;
                case 'n': out.push_back('\n'); break;
                case 'r': out.push_back('\r'); break;
                case 't': out.push_back('\t'); break;
                case 'u': {
                    uint32_t cp = 0;
                    if (!hex4(cp)) return false;
                    if (cp >= 0xD800 && cp <= 0xDBFF) {
                        uint32_t lo = 0;
                        if (p_ + 1 >= s_.size() || s_[p_] != '\\' || s_[p_ + 1] != 'u') return false;
                        p_ += 2;
                        if (!hex4(lo) || lo < 0xDC00 || lo > 0xDFFF) return false;
                        cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                    } else if (cp >= 0xDC00 && cp <= 0xDFFF) {
                        return false;
                    }
                    appendUtf8(out, cp);
                    break;
                }
                default: return false;
            }
        }
        return false;
    }
    bool hex4(uint32_t& cp) {
        if (p_ + 4 > s_.size()) return false;
        cp = 0;
        for (int i = 0; i < 4; ++i) {
            const int h = hexVal(s_[p_ + static_cast<size_t>(i)]);
            if (h < 0) return false;
            cp = (cp << 4) | static_cast<uint32_t>(h);
        }
        p_ += 4;
        return true;
    }
    bool parseArray(JsonValue& v, int depth) {
        ++p_;
        v.type_ = JsonValue::Type::Array;
        skipWs();
        if (p_ < s_.size() && s_[p_] == ']') { ++p_; return true; }
        while (true) {
            skipWs();
            v.items_.emplace_back();
            if (!parseValue(v.items_.back(), depth + 1)) return false;
            skipWs();
            if (p_ >= s_.size()) return false;
            if (s_[p_] == ',') { ++p_; continue; }
            if (s_[p_] == ']') { ++p_; return true; }
            return false;
        }
    }
    bool parseObject(JsonValue& v, int depth) {
        ++p_;
        v.type_ = JsonValue::Type::Object;
        skipWs();
        if (p_ < s_.size() && s_[p_] == '}') { ++p_; return true; }
        while (true) {
            skipWs();
            if (p_ >= s_.size() || s_[p_] != '"') return false;
            std::string key;
            if (!parseString(key)) return false;
            skipWs();
            if (p_ >= s_.size() || s_[p_] != ':') return false;
            ++p_;
            skipWs();
            v.members_.emplace_back(std::move(key), JsonValue());
            if (!parseValue(v.members_.back().second, depth + 1)) return false;
            skipWs();
            if (p_ >= s_.size()) return false;
            if (s_[p_] == ',') { ++p_; continue; }
            if (s_[p_] == '}') { ++p_; return true; }
            return false;
        }
    }

    std::string_view s_;
    size_t p_{0};
};

bool JsonValue::parse(std::string_view text, JsonValue& out) {
    out = JsonValue();
    if (text.size() > kMaxInput) return false;
    // BOM UTF-8 opcional (config.json editado a mano)
    if (text.size() >= 3 && static_cast<unsigned char>(text[0]) == 0xEF && static_cast<unsigned char>(text[1]) == 0xBB &&
        static_cast<unsigned char>(text[2]) == 0xBF)
        text.remove_prefix(3);
    JsonParser p(text);
    if (!p.parseRoot(out)) { out = JsonValue(); return false; }
    return true;
}

const JsonValue* JsonValue::get(std::string_view key) const {
    if (type_ != Type::Object) return nullptr;
    // Última aparición gana (comportamiento de JSON.parse)
    const JsonValue* found = nullptr;
    for (const auto& m : members_) if (m.first == key) found = &m.second;
    return found;
}

std::string JsonValue::getString(std::string_view key, const std::string& def) const {
    const JsonValue* v = get(key);
    return v && v->isString() ? v->str_ : def;
}

double JsonValue::getNumber(std::string_view key, double def) const {
    const JsonValue* v = get(key);
    return v && v->isNumber() ? v->num_ : def;
}

std::string jsonQuote(std::string_view s) {
    std::string out;
    out.reserve(s.size() + 2);
    out.push_back('"');
    for (const char ch : s) {
        const unsigned char c = static_cast<unsigned char>(ch);
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    static const char* hx = "0123456789abcdef";
                    out += "\\u00";
                    out.push_back(hx[c >> 4]);
                    out.push_back(hx[c & 15]);
                } else {
                    out.push_back(ch);
                }
        }
    }
    out.push_back('"');
    return out;
}

} // namespace JasWaveLicense
