/**
 * Cabeceras VST2 mínimas (API histórica Steinberg VST 2.4).
 *
 * Licencia / compliance: Steinberg ya no licencia VST2. Este set se usa solo
 * para hosting OOP de plugins existentes del usuario. Ver docs/decisiones
 * nota VST2 en ESTADO-MEZCLA-MASTERIZACION.md.
 */
#pragma once

#include <cstdint>

#ifndef VSTCALLBACK
#if defined(_WIN32) && !defined(_WIN64)
#define VSTCALLBACK __cdecl
#else
#define VSTCALLBACK
#endif
#endif

enum VstAEffectFlags {
  effFlagsHasEditor = 1 << 0,
  effFlagsCanReplacing = 1 << 4,
  effFlagsProgramChunks = 1 << 5,
  effFlagsIsSynth = 1 << 8,
  effFlagsCanDoubleReplacing = 1 << 12,
};

enum VstOpcodesToEffect {
  effOpen = 0,
  effClose = 1,
  effSetProgram = 2,
  effGetProgram = 3,
  effSetSampleRate = 10,
  effSetBlockSize = 11,
  effMainsChanged = 12,
  effEditGetRect = 13,
  effEditOpen = 14,
  effEditClose = 15,
  effEditIdle = 19,
  effGetChunk = 23,
  effSetChunk = 24,
  effProcessEvents = 25,
  effCanBeAutomated = 26,
  effGetProgramNameIndexed = 29,
  effGetParamName = 8,
  effGetParamLabel = 6,
  effGetParamDisplay = 7,
  effGetVu = 9,
  effIdentify = 22,
  effGetPlugCategory = 35,
  effGetEffectName = 45,
  effGetVendorString = 47,
  effGetProductString = 48,
  effGetVendorVersion = 49,
  effCanDo = 51,
  effIdle = 53,
  effGetVstVersion = 58,
  effBeginSetProgram = 67,
  effEndSetProgram = 68,
  effStartProcess = 71,
  effStopProcess = 72,
  effSetProcessPrecision = 77,
};

enum VstOpcodesToHost {
  audioMasterAutomate = 0,
  audioMasterVersion = 1,
  audioMasterCurrentId = 2,
  audioMasterIdle = 3,
  audioMasterWantMidi = 6,
  audioMasterGetTime = 7,
  audioMasterProcessEvents = 8,
  audioMasterTempoAt = 10,
  audioMasterSizeWindow = 15,
  audioMasterGetSampleRate = 16,
  audioMasterGetBlockSize = 17,
  audioMasterGetInputLatency = 18,
  audioMasterGetOutputLatency = 19,
  audioMasterGetCurrentProcessLevel = 23,
  audioMasterGetVendorString = 32,
  audioMasterGetProductString = 33,
  audioMasterGetVendorVersion = 34,
  audioMasterCanDo = 37,
  audioMasterGetLanguage = 38,
  audioMasterGetDirectory = 41,
  audioMasterUpdateDisplay = 42,
  audioMasterBeginEdit = 43,
  audioMasterEndEdit = 44,
  audioMasterOpenFileSelector = 45,
  audioMasterCloseFileSelector = 46,
};

enum VstEventTypes {
  kVstMidiType = 1,
};

enum VstProcessLevels {
  kVstProcessLevelUnknown = 0,
  kVstProcessLevelUser = 1,
  kVstProcessLevelRealtime = 2,
  kVstProcessLevelPrefetch = 3,
  kVstProcessLevelOffline = 4,
};

#pragma pack(push, 8)

struct ERect {
  int16_t top;
  int16_t left;
  int16_t bottom;
  int16_t right;
};

struct VstEvent {
  int32_t type;
  int32_t byteSize;
  int32_t deltaFrames;
  int32_t flags;
  char data[16];
};

struct VstMidiEvent {
  int32_t type;
  int32_t byteSize;
  int32_t deltaFrames;
  int32_t flags;
  int32_t noteLength;
  int32_t noteOffset;
  char midiData[4];
  char detune;
  char noteOffVelocity;
  char reserved1;
  char reserved2;
};

struct VstEvents {
  int32_t numEvents;
  intptr_t reserved;
  VstEvent* events[2];
};

struct VstTimeInfo {
  double samplePos;
  double sampleRate;
  double nanoSeconds;
  double ppqPos;
  double tempo;
  double barStartPos;
  double cycleStartPos;
  double cycleEndPos;
  int32_t timeSigNumerator;
  int32_t timeSigDenominator;
  int32_t smpteOffset;
  int32_t smpteFrameRate;
  int32_t samplesToNextClock;
  int32_t flags;
};

enum VstTimeInfoFlags {
  kVstTransportChanged = 1,
  kVstTransportPlaying = 1 << 1,
  kVstTransportCycleActive = 1 << 2,
  kVstTransportRecording = 1 << 3,
  kVstNanosValid = 1 << 8,
  kVstPpqPosValid = 1 << 9,
  kVstTempoValid = 1 << 10,
  kVstBarsValid = 1 << 11,
  kVstCyclePosValid = 1 << 12,
  kVstTimeSigValid = 1 << 13,
  kVstSmpteValid = 1 << 14,
  kVstClockValid = 1 << 15,
};

struct AEffect;

typedef intptr_t(VSTCALLBACK* AEffectDispatcherProc)(AEffect* effect, int32_t opcode, int32_t index,
                                                       intptr_t value, void* ptr, float opt);
typedef void(VSTCALLBACK* AEffectProcessProc)(AEffect* effect, float** inputs, float** outputs,
                                              int32_t sampleFrames);
typedef void(VSTCALLBACK* AEffectProcessDoubleProc)(AEffect* effect, double** inputs, double** outputs,
                                                    int32_t sampleFrames);
typedef void(VSTCALLBACK* AEffectSetParameterProc)(AEffect* effect, int32_t index, float parameter);
typedef float(VSTCALLBACK* AEffectGetParameterProc)(AEffect* effect, int32_t index);

struct AEffect {
  int32_t magic;
  AEffectDispatcherProc dispatcher;
  AEffectProcessProc process;
  AEffectSetParameterProc setParameter;
  AEffectGetParameterProc getParameter;
  int32_t numPrograms;
  int32_t numParams;
  int32_t numInputs;
  int32_t numOutputs;
  int32_t flags;
  intptr_t resvd1;
  intptr_t resvd2;
  int32_t initialDelay;
  int32_t realQualities;
  int32_t offQualities;
  float ioRatio;
  void* object;
  void* user;
  int32_t uniqueID;
  int32_t version;
  AEffectProcessProc processReplacing;
  AEffectProcessDoubleProc processDoubleReplacing;
  char future[56];
};

#pragma pack(pop)

constexpr int32_t kEffectMagic = 0x56737450;  // 'VstP'
typedef intptr_t(VSTCALLBACK* audioMasterCallback)(AEffect* effect, int32_t opcode, int32_t index,
                                                   intptr_t value, void* ptr, float opt);
typedef AEffect*(VSTCALLBACK* PluginEntryProc)(audioMasterCallback audioMaster);
