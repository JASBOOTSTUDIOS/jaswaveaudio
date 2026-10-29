#pragma once
/**
 * Slot VST3 out-of-process (ADR-0011): load + MIDI + process + editor HWND hijo.
 */

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

struct Vst3MidiEvent {
  enum class Kind { NoteOn, NoteOff, ControlChange };
  Kind kind{};
  int16_t pitch{0};
  float velocity{0};
  int16_t cc{0};
  int16_t ccValue{0};
  int32_t delaySamples{0};
  int32_t lengthSamples{0};
};

struct Vst3ParamDesc {
  uint32_t id{0};
  std::string name;
  std::string shortName;
  std::string unit;
  std::string display;
  double normalized{0};
  double defaultNormalized{0};
  int32_t stepCount{0};
  bool automatable{true};
  bool readOnly{false};
  bool hidden{false};
  bool bypass{false};
  bool programChange{false};
};

class Vst3Slot {
public:
  Vst3Slot();
  ~Vst3Slot();

  Vst3Slot(const Vst3Slot&) = delete;
  Vst3Slot& operator=(const Vst3Slot&) = delete;

  bool load(const std::string& path, std::string& err);
  bool prepare(double sampleRate, int32_t blockSize, std::string& err);
  bool reprepare(double sampleRate, int32_t blockSize, std::string& err);
  /** setProcessing/setActive off sin descargar (cambio de driver). */
  void suspendForAudioRestart();
  void unload();

  void noteOn(int pitch, float velocity, int delaySamples = 0, int32_t lengthSamples = 0);
  /** Con el pedal (CC64 ≥ 64) pisado, el note-off se retiene y se entrega al soltar (sustain del lado del host). */
  void noteOff(int pitch, int delaySamples = 0);
  /** CC al plugin (kLegacyMIDICCOutEvent + IMidiMapping). CC64 además gobierna el sustain del host. */
  void midiCc(int cc, int value, int delaySamples = 0);
  /** Sustain off + all notes/sound off + noteOff 0-127. */
  void allNotesOff();
  /**
   * Stop duro: setProcessing(false) → setActive(false/true) → setProcessing(true). El ciclo de activación es
   * la forma estándar de VST3 de vaciar el DSP (voces, reverb, delay); los parámetros y el estado se conservan.
   */
  void flushDsp();
  void setParameterNormalized(uint32_t paramId, double normalized);
  std::vector<Vst3ParamDesc> listParameters(int maxCount = 400);
  void setPlaying(bool playing);
  void setTransport(bool playing, double tempoBpm, double ppqPos = -1.0);

  /** Procesa un bloque. Si inL/inR son null, entrada silenciosa (instrumento). */
  void process(const float* inL, const float* inR, float* outL, float* outR, int frames);
  /** Compat: entrada silenciosa. */
  void process(float* outL, float* outR, int frames) { process(nullptr, nullptr, outL, outR, frames); }

  /** true si el plugin expone bus aux/sidechain de entrada. */
  bool hasSidechainInput() const;
  /** Alimenta el bus sidechain (estéreo) para el próximo process(). */
  void setSidechainInput(const float* l, const float* r, int frames);
  void clearSidechainInput();

  bool openEditor(std::uintptr_t parentHwnd, int x, int y, int w, int h, std::string& err);
  /**
   * Editor "embebido" en el panel del DAW: ventana popup sin borde ni padre/owner (un hijo u owned de
   * otro proceso bloquea con SendMessage), en píxeles físicos de pantalla, que main mantiene alineada
   * con el panel. El view se ajusta al área (proporción del plugin) y se centra.
   */
  bool openEditorEmbedded(int x, int y, int w, int h, std::string& err);
  void setEditorBounds(int x, int y, int w, int h);
  void setEmbeddedBounds(int x, int y, int w, int h, bool visible, bool raise);
  bool editorEmbedded() const;
  void closeEditor();
  bool hasEditor() const;
  /**
   * Pin: la ventana flotante del editor queda siempre visible (HWND_TOPMOST, sin activar ni robar el foco).
   * La marca sobrevive a cerrar/reabrir el editor; el orden entre anclados lo decide main.cpp (por índice).
   */
  void setEditorPinned(bool pinned);
  bool editorPinned() const;
  /** Sube la ventana anclada a la cima de la banda TOPMOST sin activarla. */
  void raiseEditorPinned();
  /** Oculta/muestra la ventana anclada (la app minimizada no deja editores colgados). */
  void setEditorPinVisible(bool visible);
  /** Consulta real WS_EX_TOPMOST del HWND (0/false si no hay ventana). */
  bool editorTopmost() const;
  std::uintptr_t editorHwnd() const;
  /** Título de la ventana flotante del editor (UTF-8), p. ej. «Piano · Sampler». */
  void setEditorTitle(const std::string& utf8) { editorTitle_ = utf8; }

  /** Persistencia IComponent::getState / setState (y controller si aplica). */
  bool getStateChunk(std::vector<uint8_t>& out, std::string& err);
  bool setStateChunk(const uint8_t* data, size_t nbytes, std::string& err);

  const std::string& path() const { return path_; }
  const std::string& slotId() const { return slotId_; }
  void setSlotId(std::string id) { slotId_ = std::move(id); }
  bool isPrepared() const { return prepared_.load(); }
  int latencySamples() const { return latencySamples_; }
  void waitNotProcessing();
  void setMix(float gain, float pan, bool muted);
  void applyMix(float* outL, float* outR, int frames) const;
  void setBypass(bool bypass) { bypass_.store(bypass, std::memory_order_relaxed); }
  bool isBypassed() const { return bypass_.load(std::memory_order_relaxed); }
  uint32_t processExceptions() const { return exceptions_.load(std::memory_order_relaxed); }

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
  std::string path_;
  std::string editorTitle_;
  std::string slotId_;
  std::atomic<bool> prepared_{false};
  std::atomic<bool> inProcess_{false};
  std::atomic<float> mixGain_{1.f};
  std::atomic<float> mixPan_{0.f};
  std::atomic<bool> mixMuted_{false};
  std::atomic<bool> bypass_{false};
  std::atomic<uint32_t> exceptions_{0};   // excepciones SEH/C++ capturadas en process()
  int latencySamples_{0};
  /** Estado capturado en suspendForAudioRestart/reprepare para reaplicarlo tras re-activar el plugin. */
  std::vector<uint8_t> estadoTrasSuspender_;
};

/** Aviso (hilo UI) cuando una ventana de editor anclada se activa: main.cpp reaplica el orden por índice. */
void vst3SetPinActivatedHook(void (*hook)());
