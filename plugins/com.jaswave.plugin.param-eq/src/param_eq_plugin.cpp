#ifndef NOMINMAX
#define NOMINMAX
#endif

#include "param_eq_dsp.h"
#include "../../shared-ui/jaswave_modern_ui.h"

#include "public.sdk/source/vst/vstaudioeffect.h"
#include "public.sdk/source/vst/vsteditcontroller.h"
#include "public.sdk/source/common/pluginview.h"
#include "public.sdk/source/main/pluginfactory.h"
#include "pluginterfaces/vst/ivstparameterchanges.h"

#include <array>
#include <string>
#include <sstream>
#include <iomanip>

using namespace Steinberg;
using namespace Steinberg::Vst;

namespace JasWaveParamEq {

static const FUID kProcessorUid(0x4A617357, 0x46584551, 0x50726F63, 0x56335431);
static const FUID kControllerUid(0x4A617357, 0x46584551, 0x436E7472, 0x56335431);

class ParamEqController;

#ifdef _WIN32
class ParamEqEditorView : public CPluginView {
public:
    explicit ParamEqEditorView(ParamEqController* controller);
    ~ParamEqEditorView() SMTG_OVERRIDE;

    tresult PLUGIN_API isPlatformTypeSupported(FIDString type) SMTG_OVERRIDE {
        return (strcmp(type, kPlatformTypeHWND) == 0) ? kResultOk : kResultFalse;
    }

    tresult PLUGIN_API canResize() SMTG_OVERRIDE { return kResultTrue; }

    tresult PLUGIN_API checkSizeConstraint(ViewRect* r) SMTG_OVERRIDE {
        if (!r) return kInvalidArgument;
        int w = r->getWidth();
        int h = r->getHeight();
        if (w < 540) r->right = r->left + 540;
        if (h < 380) r->bottom = r->top + 380;
        return kResultOk;
    }

    tresult PLUGIN_API onSize(ViewRect* newRect) SMTG_OVERRIDE {
        rect = *newRect;
        if (hwnd_) {
            SetWindowPos(hwnd_, nullptr, 0, 0, newRect->getWidth(), newRect->getHeight(),
                         SWP_NOZORDER | SWP_NOACTIVATE);
            updateLayout();
            InvalidateRect(hwnd_, nullptr, FALSE);
        }
        return kResultOk;
    }

    void attachedToParent() SMTG_OVERRIDE;
    void removedFromParent() SMTG_OVERRIDE;

    void updateLayout();

private:
    static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam);

    ParamEqController* controller_{nullptr};
    HWND hwnd_{nullptr};
    static bool classRegistered_;

    std::vector<JasWaveUI::CyberSlider> sliders_;
    RECT visualizerRc_{0, 0, 0, 0};
    int draggingSliderIdx_{-1};
    float animPhase_{0.0f};

    double lowCutFreq_{80.0};
    double lowShelfGain_{0.0};
    double highShelfGain_{0.0};
    double masterGain_{0.0};
    std::shared_ptr<JasWaveEq::EqBus> bus_;
    JasWaveDsp::SpectrumAnalyzer analyzer_;
    std::vector<float> spectrumCols_;
};
#endif

class ParamEqProcessor : public AudioEffect {
public:
    ParamEqProcessor() {
        setControllerClass(kControllerUid);
        bus_ = std::make_shared<JasWaveEq::EqBus>();
        JasWaveDsp::PluginBusHub<JasWaveEq::EqBus>::set(this, bus_);
    }
    ~ParamEqProcessor() SMTG_OVERRIDE {
        JasWaveDsp::PluginBusHub<JasWaveEq::EqBus>::remove(this);
    }
    static FUnknown* createInstance(void*) { return (IAudioProcessor*)new ParamEqProcessor(); }

    tresult PLUGIN_API initialize(FUnknown* context) SMTG_OVERRIDE {
        tresult result = AudioEffect::initialize(context);
        if (result != kResultOk) return result;
        addAudioInput(STR16("Stereo In"), SpeakerArr::kStereo);
        addAudioOutput(STR16("Stereo Out"), SpeakerArr::kStereo);
        return kResultOk;
    }

    tresult PLUGIN_API setupProcessing(ProcessSetup& newSetup) SMTG_OVERRIDE {
        sampleRate = newSetup.sampleRate;
        engine_.prepare(sampleRate, newSetup.maxSamplesPerBlock);
        if (bus_) bus_->sampleRate.store(sampleRate);
        return kResultOk;
    }

    tresult PLUGIN_API process(ProcessData& data) SMTG_OVERRIDE {
        // 1. Automatización y cambios de parámetros en tiempo real
        if (data.inputParameterChanges) {
            int32 numParams = data.inputParameterChanges->getParameterCount();
            for (int32 i = 0; i < numParams; ++i) {
                IParamValueQueue* queue = data.inputParameterChanges->getParameterData(i);
                if (!queue) continue;
                ParamValue val; int32 sampleOffset;
                if (queue->getPoint(queue->getPointCount() - 1, sampleOffset, val) == kResultOk) {
                    ParamID id = queue->getParameterId();
                    if (id == 0) { // Bypass
                        settings_.bypass = (val > 0.5);
                    } else if (id == 1) { // Low Cut
                        settings_.band[0].on = true;
                        settings_.band[0].freq = 20.0 + val * 480.0;
                    } else if (id == 2) { // Low Shelf
                        settings_.band[1].on = true;
                        settings_.band[1].freq = 110.0;
                        settings_.band[1].gainDb = (val - 0.5) * 24.0;
                    } else if (id == 3) { // High Shelf
                        settings_.band[7].on = true;
                        settings_.band[7].freq = 8000.0;
                        settings_.band[7].gainDb = (val - 0.5) * 24.0;
                    } else if (id == 41) { // Master Output
                        settings_.outGainDb = (val - 0.5) * 24.0;
                    }
                }
            }
            engine_.setSettings(settings_);
        }

        if (data.numInputs == 0 || data.numOutputs == 0) return kResultOk;

        float* inL = data.inputs[0].channelBuffers32[0];
        float* inR = data.inputs[0].channelBuffers32[1];
        float* outL = data.outputs[0].channelBuffers32[0];
        float* outR = data.outputs[0].channelBuffers32[1];

        engine_.process(inL, inR, outL, outR, data.numSamples, bus_.get());
        return kResultOk;
    }

private:
    double sampleRate{48000.0};
    JasWaveEq::EqEngine engine_;
    JasWaveEq::EqSettings settings_;
    std::shared_ptr<JasWaveEq::EqBus> bus_;
};

class ParamEqController : public EditController {
public:
    static FUnknown* createInstance(void*) { return (IEditController*)new ParamEqController(); }

    tresult PLUGIN_API initialize(FUnknown* context) SMTG_OVERRIDE {
        tresult result = EditController::initialize(context);
        if (result != kResultOk) return result;
        parameters.addParameter(STR16("Bypass"), nullptr, 1, 0, ParameterInfo::kCanAutomate, 0);
        parameters.addParameter(STR16("Low Cut (Hz)"), STR16("Hz"), 0, 0.15, ParameterInfo::kCanAutomate, 1);
        parameters.addParameter(STR16("Low Shelf (dB)"), STR16("dB"), 0, 0.50, ParameterInfo::kCanAutomate, 2);
        parameters.addParameter(STR16("High Shelf (dB)"), STR16("dB"), 0, 0.50, ParameterInfo::kCanAutomate, 3);
        parameters.addParameter(STR16("Master Output (dB)"), STR16("dB"), 0, 0.50, ParameterInfo::kCanAutomate, 41);
        return kResultOk;
    }

    IPlugView* PLUGIN_API createView(FIDString name) SMTG_OVERRIDE {
        if (name && strcmp(name, ViewType::kEditor) == 0) {
#ifdef _WIN32
            return new ParamEqEditorView(this);
#endif
        }
        return nullptr;
    }
};

#ifdef _WIN32
bool ParamEqEditorView::classRegistered_ = false;

ParamEqEditorView::ParamEqEditorView(ParamEqController* controller)
    : CPluginView(nullptr), controller_(controller) {
    rect = ViewRect(0, 0, 680, 480);
    JasWaveUI::ensureGdiplus();

    sliders_ = {
        { 1,  L"LOW CUT",    L"80 Hz",   0.15, {}, JasWaveUI::Colors::neonCyan(), false },
        { 2,  L"LOW SHELF",  L"0.0 dB",  0.50, {}, JasWaveUI::Colors::neonAmber(), false },
        { 3,  L"HIGH SHELF", L"0.0 dB",  0.50, {}, JasWaveUI::Colors::neonMagenta(), false },
        { 41, L"MASTER GAIN",L"0.0 dB",  0.50, {}, JasWaveUI::Colors::neonGreen(), false }
    };
}

ParamEqEditorView::~ParamEqEditorView() {
    removedFromParent();
}

void ParamEqEditorView::updateLayout() {
    if (!hwnd_) return;
    RECT rc;
    GetClientRect(hwnd_, &rc);
    int w = rc.right - rc.left;
    int h = rc.bottom - rc.top;
    if (w <= 0 || h <= 0) return;

    // Área del visualizador espectral (ocupa ~45% de la altura)
    int padX = 28;
    int visTop = 72;
    int visH = (int)(h * 0.44);
    if (visH < 120) visH = 120;
    visualizerRc_ = { padX, visTop, w - padX, visTop + visH };

    // Área de controles (cuadrícula de 2 columnas o 4 barras distribuidas)
    int slidersTop = visualizerRc_.bottom + 22;
    int availableH = h - slidersTop - 24;
    int sliderH = std::max(36, availableH / 4);

    for (size_t i = 0; i < sliders_.size(); ++i) {
        int sy = slidersTop + (int)i * sliderH;
        sliders_[i].bounds = { padX + 8, sy, w - padX - 8, sy + 32 };
    }
}

void ParamEqEditorView::attachedToParent() {
    if (!systemWindow || hwnd_) return;
    const wchar_t kClass[] = L"JasWaveParamEqModernEditor";
    if (!classRegistered_) {
        WNDCLASSW wc{};
        wc.lpfnWndProc = WndProc;
        wc.hInstance = GetModuleHandleW(nullptr);
        wc.lpszClassName = kClass;
        wc.hbrBackground = CreateSolidBrush(JasWaveUI::Colors::kBgDeepSpaceRef);
        wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
        RegisterClassW(&wc);
        classRegistered_ = true;
    }

    // Adaptar tamaño inicial a la ventana del host si ya tiene dimensiones
    RECT parentRc{};
    GetClientRect((HWND)systemWindow, &parentRc);
    int initW = 680;
    int initH = 480;
    if (parentRc.right - parentRc.left > 200) initW = parentRc.right - parentRc.left;
    if (parentRc.bottom - parentRc.top > 200) initH = parentRc.bottom - parentRc.top;
    rect = ViewRect(0, 0, initW, initH);

    hwnd_ = CreateWindowExW(0, kClass, L"JasWave EQ Parametric Pro", WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN,
                            0, 0, initW, initH, (HWND)systemWindow, nullptr, GetModuleHandleW(nullptr), this);
    if (!hwnd_) return;
    SetWindowLongPtrW(hwnd_, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(this));

    bus_ = JasWaveDsp::PluginBusHub<JasWaveEq::EqBus>::getLast();
    updateLayout();
    SetTimer(hwnd_, 101, 33, nullptr); // ~30 fps para animación HUD reactiva
}

void ParamEqEditorView::removedFromParent() {
    if (hwnd_) {
        KillTimer(hwnd_, 101);
        DestroyWindow(hwnd_);
        hwnd_ = nullptr;
    }
}

LRESULT CALLBACK ParamEqEditorView::WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    auto* self = reinterpret_cast<ParamEqEditorView*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    switch (msg) {
        case WM_NCCREATE: {
            auto* cs = reinterpret_cast<CREATESTRUCTW*>(lParam);
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(cs->lpCreateParams));
            return DefWindowProcW(hwnd, msg, wParam, lParam);
        }
        case WM_SIZE: {
            if (self) {
                self->updateLayout();
                InvalidateRect(hwnd, nullptr, FALSE);
            }
            return 0;
        }
        case WM_ERASEBKGND:
            return 1; // Evita el parpadeo y fondo blanco

        case WM_TIMER: {
            if (self) {
                if (!self->bus_) self->bus_ = JasWaveDsp::PluginBusHub<JasWaveEq::EqBus>::getLast();
                if (self->bus_) {
                    const double sr = self->bus_->sampleRate.load(std::memory_order_relaxed);
                    self->analyzer_.update(self->bus_->pre, sr);
                    self->analyzer_.columns(self->spectrumCols_, 48, 20.0, 20000.0, -12.0);
                }
                InvalidateRect(hwnd, &self->visualizerRc_, FALSE);
            }
            return 0;
        }
        case WM_LBUTTONDOWN: {
            if (!self) break;
            int mx = LOWORD(lParam);
            int my = HIWORD(lParam);

            // Comprobar clic en sliders
            for (size_t i = 0; i < self->sliders_.size(); ++i) {
                auto& s = self->sliders_[i];
                if (mx >= s.bounds.left && mx <= s.bounds.right &&
                    my >= s.bounds.top && my <= s.bounds.bottom) {
                    self->draggingSliderIdx_ = (int)i;
                    s.isDragging = true;
                    SetCapture(hwnd);

                    // Actualizar valor según posición del ratón
                    double norm = (double)(mx - s.bounds.left) / (double)(s.bounds.right - s.bounds.left);
                    norm = std::max(0.0, std::min(1.0, norm));
                    s.normalized = norm;

                    // Formatear texto
                    if (s.id == 1) {
                        self->lowCutFreq_ = 20.0 + norm * 480.0;
                        s.valueText = std::to_wstring((int)self->lowCutFreq_) + L" Hz";
                    } else if (s.id == 2) {
                        self->lowShelfGain_ = (norm - 0.5) * 24.0;
                        std::wstringstream ss; ss << std::fixed << std::setprecision(1) << (self->lowShelfGain_ >= 0 ? L"+" : L"") << self->lowShelfGain_ << L" dB";
                        s.valueText = ss.str();
                    } else if (s.id == 3) {
                        self->highShelfGain_ = (norm - 0.5) * 24.0;
                        std::wstringstream ss; ss << std::fixed << std::setprecision(1) << (self->highShelfGain_ >= 0 ? L"+" : L"") << self->highShelfGain_ << L" dB";
                        s.valueText = ss.str();
                    } else if (s.id == 41) {
                        self->masterGain_ = (norm - 0.5) * 24.0;
                        std::wstringstream ss; ss << std::fixed << std::setprecision(1) << (self->masterGain_ >= 0 ? L"+" : L"") << self->masterGain_ << L" dB";
                        s.valueText = ss.str();
                    }

                    if (self->controller_) {
                        self->controller_->setParamNormalized(s.id, norm);
                        self->controller_->performEdit(s.id, norm);
                    }
                    InvalidateRect(hwnd, nullptr, FALSE);
                    break;
                }
            }
            return 0;
        }
        case WM_MOUSEMOVE: {
            if (!self || self->draggingSliderIdx_ < 0) break;
            int mx = LOWORD(lParam);
            auto& s = self->sliders_[self->draggingSliderIdx_];
            double norm = (double)(mx - s.bounds.left) / (double)(s.bounds.right - s.bounds.left);
            norm = std::max(0.0, std::min(1.0, norm));
            s.normalized = norm;

            if (s.id == 1) {
                self->lowCutFreq_ = 20.0 + norm * 480.0;
                s.valueText = std::to_wstring((int)self->lowCutFreq_) + L" Hz";
            } else if (s.id == 2) {
                self->lowShelfGain_ = (norm - 0.5) * 24.0;
                std::wstringstream ss; ss << std::fixed << std::setprecision(1) << (self->lowShelfGain_ >= 0 ? L"+" : L"") << self->lowShelfGain_ << L" dB";
                s.valueText = ss.str();
            } else if (s.id == 3) {
                self->highShelfGain_ = (norm - 0.5) * 24.0;
                std::wstringstream ss; ss << std::fixed << std::setprecision(1) << (self->highShelfGain_ >= 0 ? L"+" : L"") << self->highShelfGain_ << L" dB";
                s.valueText = ss.str();
            } else if (s.id == 41) {
                self->masterGain_ = (norm - 0.5) * 24.0;
                std::wstringstream ss; ss << std::fixed << std::setprecision(1) << (self->masterGain_ >= 0 ? L"+" : L"") << self->masterGain_ << L" dB";
                s.valueText = ss.str();
            }

            if (self->controller_) {
                self->controller_->setParamNormalized(s.id, norm);
                self->controller_->performEdit(s.id, norm);
            }
            InvalidateRect(hwnd, nullptr, FALSE);
            return 0;
        }
        case WM_LBUTTONUP: {
            if (self && self->draggingSliderIdx_ >= 0) {
                self->sliders_[self->draggingSliderIdx_].isDragging = false;
                self->draggingSliderIdx_ = -1;
                ReleaseCapture();
            }
            return 0;
        }
        case WM_PAINT: {
            PAINTSTRUCT ps;
            HDC hdc = BeginPaint(hwnd, &ps);
            RECT rc;
            GetClientRect(hwnd, &rc);
            int w = rc.right - rc.left;
            int h = rc.bottom - rc.top;

            if (w > 0 && h > 0) {
                // Doble búfer con memoria compatible para cero parpadeo
                HDC memDC = CreateCompatibleDC(hdc);
                HBITMAP memBmp = CreateCompatibleBitmap(hdc, w, h);
                HGDIOBJ oldBmp = SelectObject(memDC, memBmp);

                {
                    Gdiplus::Graphics g(memDC);
                    // 1. Marco HUD Cyberpunk completo
                    JasWaveUI::drawCyberFrame(g, w, h,
                                             L"JASWAVE EQ PARAMETRIC PRO",
                                             L"SURGICAL 8-BAND SPECTRAL MATRIX",
                                             L"[NEURAL AI ACTIVE]");

                    // 2. Visualizador espectral interactivo y reactivo
                    if (self) {
                        JasWaveUI::drawParametricEqVisualizer(g, self->visualizerRc_,
                                                             self->lowCutFreq_,
                                                             self->lowShelfGain_,
                                                             self->highShelfGain_,
                                                             self->masterGain_,
                                                             &self->spectrumCols_,
                                                             self->animPhase_);

                        // 3. Controles Cyber Sliders
                        for (const auto& s : self->sliders_) {
                            JasWaveUI::drawCyberSlider(g, s);
                        }
                    }
                }

                BitBlt(hdc, 0, 0, w, h, memDC, 0, 0, SRCCOPY);
                SelectObject(memDC, oldBmp);
                DeleteObject(memBmp);
                DeleteDC(memDC);
            }

            EndPaint(hwnd, &ps);
            return 0;
        }
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}
#endif

} // namespace JasWaveParamEq

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveParamEq::kProcessorUid),
               PClassInfo::kManyInstances, kVstAudioEffectClass,
               "JasWave EQ Parametric Pro", Vst::kDistributable, "Fx|EQ",
               "1.0.0", kVstVersionString, JasWaveParamEq::ParamEqProcessor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveParamEq::kControllerUid),
               PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave EQ Parametric Controller", 0, "",
               "1.0.0", kVstVersionString, JasWaveParamEq::ParamEqController::createInstance)
END_FACTORY
