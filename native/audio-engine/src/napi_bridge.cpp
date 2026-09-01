#include <napi.h>
#include "jaswave_audio.hpp"

#include <memory>
#include <string>
#include <vector>

namespace {

jaswave::AudioEngine& engine() {
  static jaswave::AudioEngine instance;
  return instance;
}

Napi::Value Initialize(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  jaswave::AudioConfig cfg;
  if (info.Length() >= 1 && info[0].IsObject()) {
    auto o = info[0].As<Napi::Object>();
    if (o.Has("sampleRate")) cfg.sampleRate = o.Get("sampleRate").ToNumber().Int32Value();
    if (o.Has("bufferSize")) cfg.bufferSize = o.Get("bufferSize").ToNumber().Int32Value();
    if (o.Has("channels")) cfg.channels = o.Get("channels").ToNumber().Int32Value();
  }
  engine().initialize(cfg);
  return env.Undefined();
}

Napi::Value Shutdown(const Napi::CallbackInfo& info) {
  engine().shutdown();
  return info.Env().Undefined();
}

Napi::Value LoadBuffer(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4 || !info[0].IsString() || !info[1].IsTypedArray()) {
    Napi::TypeError::New(env, "loadBuffer(id, Float32Array, sampleRate, channels)").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string id = info[0].As<Napi::String>().Utf8Value();
  auto arr = info[1].As<Napi::Float32Array>();
  int sr = info[2].ToNumber().Int32Value();
  int ch = info[3].ToNumber().Int32Value();
  engine().loadBuffer(id, arr.Data(), arr.ElementLength(), sr, ch);
  return env.Undefined();
}

Napi::Value UnloadBuffer(const Napi::CallbackInfo& info) {
  if (info.Length() >= 1 && info[0].IsString()) {
    engine().unloadBuffer(info[0].As<Napi::String>().Utf8Value());
  }
  return info.Env().Undefined();
}

Napi::Value SetGraph(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "setGraph({ tracks, clips })").ThrowAsJavaScriptException();
    return env.Null();
  }
  auto root = info[0].As<Napi::Object>();
  jaswave::GraphSnapshot snap;

  if (root.Has("tracks") && root.Get("tracks").IsArray()) {
    auto tracks = root.Get("tracks").As<Napi::Array>();
    for (uint32_t i = 0; i < tracks.Length(); ++i) {
      auto t = tracks.Get(i).As<Napi::Object>();
      jaswave::PlaybackTrack tr;
      if (t.Has("id")) tr.id = t.Get("id").ToString().Utf8Value();
      if (t.Has("volume")) tr.volume = t.Get("volume").ToNumber().FloatValue();
      if (t.Has("pan")) tr.pan = t.Get("pan").ToNumber().FloatValue();
      if (t.Has("muted")) tr.muted = t.Get("muted").ToBoolean().Value();
      if (t.Has("solo")) tr.solo = t.Get("solo").ToBoolean().Value();
      snap.tracks.push_back(std::move(tr));
    }
  }

  if (root.Has("clips") && root.Get("clips").IsArray()) {
    auto clips = root.Get("clips").As<Napi::Array>();
    for (uint32_t i = 0; i < clips.Length(); ++i) {
      auto c = clips.Get(i).As<Napi::Object>();
      jaswave::PlaybackClip cl;
      if (c.Has("id")) cl.id = c.Get("id").ToString().Utf8Value();
      if (c.Has("trackId")) cl.trackId = c.Get("trackId").ToString().Utf8Value();
      if (c.Has("bufferId")) cl.bufferId = c.Get("bufferId").ToString().Utf8Value();
      if (c.Has("startSec")) cl.startSec = c.Get("startSec").ToNumber().DoubleValue();
      if (c.Has("durationSec")) cl.durationSec = c.Get("durationSec").ToNumber().DoubleValue();
      if (c.Has("bufferOffsetSec")) cl.bufferOffsetSec = c.Get("bufferOffsetSec").ToNumber().DoubleValue();
      snap.clips.push_back(std::move(cl));
    }
  }

  engine().setGraph(std::move(snap));
  return env.Undefined();
}

Napi::Value TransportPlay(const Napi::CallbackInfo& info) {
  engine().transportPlay();
  return info.Env().Undefined();
}
Napi::Value TransportPause(const Napi::CallbackInfo& info) {
  engine().transportPause();
  return info.Env().Undefined();
}
Napi::Value TransportStop(const Napi::CallbackInfo& info) {
  engine().transportStop();
  return info.Env().Undefined();
}
Napi::Value TransportSeek(const Napi::CallbackInfo& info) {
  if (info.Length() >= 1) engine().transportSeek(info[0].ToNumber().DoubleValue());
  return info.Env().Undefined();
}
Napi::Value GetPlayheadSeconds(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), engine().playheadSeconds());
}
Napi::Value IsPlaying(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), engine().isPlaying());
}
Napi::Value GetMeterPeak(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), engine().meterPeak());
}

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  exports.Set("initialize", Napi::Function::New(env, Initialize));
  exports.Set("shutdown", Napi::Function::New(env, Shutdown));
  exports.Set("loadBuffer", Napi::Function::New(env, LoadBuffer));
  exports.Set("unloadBuffer", Napi::Function::New(env, UnloadBuffer));
  exports.Set("setGraph", Napi::Function::New(env, SetGraph));
  exports.Set("transportPlay", Napi::Function::New(env, TransportPlay));
  exports.Set("transportPause", Napi::Function::New(env, TransportPause));
  exports.Set("transportStop", Napi::Function::New(env, TransportStop));
  exports.Set("transportSeek", Napi::Function::New(env, TransportSeek));
  exports.Set("getPlayheadSeconds", Napi::Function::New(env, GetPlayheadSeconds));
  exports.Set("isPlaying", Napi::Function::New(env, IsPlaying));
  exports.Set("getMeterPeak", Napi::Function::New(env, GetMeterPeak));
  return exports;
}

}  // namespace

NODE_API_MODULE(jaswave_audio, InitAll)
