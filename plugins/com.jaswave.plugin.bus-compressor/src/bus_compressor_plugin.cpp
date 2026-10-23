#ifndef NOMINMAX
#define NOMINMAX
#endif

#include "bus_compressor_dsp.h"
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

namespace JasWaveBusComp {

static const FUID kProcessorUid(0x4A617357, 0x434F4D50, 0x50726F63, 0x56335431);
static const FUID kControllerUid(0x4A617357, 0x434F4D50, 0x436E7472, 0x56335431);

class BusCompController;

#ifdef _WIN32
class BusCompEditorView : public CPluginView {
public:
    explicit BusCompEditorView(BusCompController* controller);
    ~BusCompEditorView() SMTG_OVERRIDE;

    tresult PLUGIN_API isPlatformTypeSupported(FIDString type) SMTG_OVERRIDE {
        return (strcmp(type, kPlatformTypeHWND) == 0) ? kResultOk : kResultFalse;
    }

    tresult PLUGIN_API canResize() SMTG_OVERRIDE { return kResultTrue; }

    tresult PLUGIN_API checkSizeConstraint(ViewRect* r) SMTG_OVERRIDE {
        if (!r) return kInvalidArgument;
        int w = r->getWidth();
        int h = r->getHeight();
        if (w < 540) r->right = r->left + 540;
        if (h < 400) r->bottom = r->top + 400;
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

    BusCompController* controller_{nullptr};
    HWND hwnd_{nullptr};
    static bool classRegistered_;

    std::vector<JasWaveUI::CyberSlider> sliders_;
    RECT visualizerRc_{0, 0, 0, 0};
    int draggingSliderIdx_{-1};
    float animPhase_{0.0f};

    double threshDb_{-18.0};
    double ratioVal_{4.0};
    double attackMs_{10.0};
    double releaseMs_{200.0};
    double makeupGainDb_{3.0};
    double currentGrDb_{-4.5};
    std::shared_ptr<JasWaveComp::CompBus> bus_;
    JasWaveDsp::ScopeSnapshot scopeSnap_;
};
#endif

class BusCompProcessor : public AudioEffect {
public:
    BusCompProcessor() {
        setControllerClass(kControllerUid);
        bus_ = std::make_shared<JasWaveComp::CompBus>();
        JasWaveDsp::PluginBusHub<JasWaveComp::CompBus>::set(this, bus_);
    }
    ~BusCompProcessor() SMTG_OVERRIDE {
        JasWaveDsp::PluginBusHub<JasWaveComp::CompBus>::remove(this);
    }
    static FUnknown* createInstance(void*) { return (IAudioProcessor*)new BusCompProcessor(); }

    tresult PLUGIN_API initialize(FUnknown* context) SMTG_OVERRIDE {
        tresult result = AudioEffect::initialize(context);
        if (result != kResultOk) return result;
        addAudioInput(STR16("Stereo In"), SpeakerArr::kStereo);
        addAudioOutput(STR16("Stereo Out"), SpeakerArr::kStereo);
        return kResultOk;
    }

    tresult PLUGIN_API setupProcessing(ProcessSetup& newSetup) SMTG_OVERRIDE {
        engine_.prepare(newSetup.sampleRate, newSetup.maxSamplesPerBlock);
        if (bus_) bus_->sampleRate.store(newSetup.sampleRate);
        return AudioEffect::setupProcessing(newSetup);
    }

    tresult PLUGIN_API process(ProcessData& data) SMTG_OVERRIDE {
        if (data.inputParameterChanges) {
            int32 numParams = data.inputParameterChanges->getParameterCount();
            for (int32 i = 0; i < numParams; ++i) {
                IParamValueQueue* queue = data.inputParameterChanges->getParameterData(i);
                if (!queue) continue;
                ParamValue val; int32 sampleOffset;
                if (queue->getPoint(queue->getPointCount() - 1, sampleOffset, val) == kResultOk) {
                    ParamID id = queue->getParameterId();
                    if (id == 0) {
                        settings_.bypass = (val > 0.5);
                    } else if (id == 1) { // Threshold (-40 a 0 dB)
                        settings_.thrDb = -40.0 + val * 40.0;
                    } else if (id == 2) { // Ratio (1:1 a 20:1)
                        settings_.ratio = 1.0 + val * 19.0;
                    } else if (id == 3) { // Attack (0.1 a 100 ms)
                        settings_.attackMs = 0.1 + val * 99.9;
                    } else if (id == 4) { // Release (10 a 1000 ms)
                        settings_.releaseMs = 10.0 + val * 990.0;
                    } else if (id == 6) { // Makeup Gain (0 a 24 dB)
                        settings_.makeupDb = val * 24.0;
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
    JasWaveComp::CompressorEngine engine_;
    JasWaveComp::CompSettings settings_;
    std::shared_ptr<JasWaveComp::CompBus> bus_;
};

class BusCompController : public EditController {
public:
    static FUnknown* createInstance(void*) { return (IEditController*)new BusCompController(); }

    tresult PLUGIN_API initialize(FUnknown* context) SMTG_OVERRIDE {
        tresult result = EditController::initialize(context);
        if (result != kResultOk) return result;
        parameters.addParameter(STR16("Bypass"), nullptr, 1, 0, ParameterInfo::kCanAutomate, 0);
        parameters.addParameter(STR16("Threshold (dB)"), STR16("dB"), 0, 0.55, ParameterInfo::kCanAutomate, 1);
        parameters.addParameter(STR16("Ratio"), STR16(":1"), 0, 0.35, ParameterInfo::kCanAutomate, 2);
        parameters.addParameter(STR16("Attack (ms)"), STR16("ms"), 0, 0.30, ParameterInfo::kCanAutomate, 3);
        parameters.addParameter(STR16("Release (ms)"), STR16("ms"), 0, 0.25, ParameterInfo::kCanAutomate, 4);
        parameters.addParameter(STR16("Makeup Gain (dB)"), STR16("dB"), 0, 0.15, ParameterInfo::kCanAutomate, 6);
        return kResultOk;
    }

    IPlugView* PLUGIN_API createView(FIDString name) SMTG_OVERRIDE {
        if (name && strcmp(name, ViewType::kEditor) == 0) {
#ifdef _WIN32
            return new BusCompEditorView(this);
#endif
        }
        return nullptr;
    }
};

#ifdef _WIN32
bool BusCompEditorView::classRegistered_ = false;

BusCompEditorView::BusCompEditorView(BusCompController* controller)
    : CPluginView(nullptr), controller_(controller) {
    rect = ViewRect(0, 0, 680, 500);
    JasWaveUI::ensureGdiplus();

    sliders_ = {
        { 1, L"THRESHOLD",   L"-18.0 dB", 0.55, {}, JasWaveUI::Colors::neonAmber(), false },
        { 2, L"RATIO",       L"4.0:1",    0.35, {}, JasWaveUI::Colors::neonCyan(), false },
        { 3, L"ATTACK",      L"10.0 ms",  0.30, {}, JasWaveUI::Colors::neonMagenta(), false },
        { 4, L"RELEASE",     L"200 ms",   0.25, {}, JasWaveUI::Colors::neonCyan(), false },
        { 6, L"MAKEUP GAIN", L"+3.0 dB",  0.15, {}, JasWaveUI::Colors::neonGreen(), false }
    };
}

BusCompEditorView::~BusCompEditorView() {
    removedFromParent();
}

void BusCompEditorView::updateLayout() {
    if (!hwnd_) return;
    RECT rc;
    GetClientRect(hwnd_, &rc);
    int w = rc.right - rc.left;
    int h = rc.bottom - rc.top;
    if (w <= 0 || h <= 0) return;

    int padX = 28;
    int visTop = 72;
    int visH = (int)(h * 0.40);
    if (visH < 120) visH = 120;
    visualizerRc_ = { padX, visTop, w - padX, visTop + visH };

    int slidersTop = visualizerRc_.bottom + 20;
    int availableH = h - slidersTop - 24;
    int sliderH = std::max(34, availableH / (int)sliders_.size());

    for (size_t i = 0; i < sliders_.size(); ++i) {
        int sy = slidersTop + (int)i * sliderH;
        sliders_[i].bounds = { padX + 8, sy, w - padX - 8, sy + 30 };
    }
}

void BusCompEditorView::attachedToParent() {
    if (!systemWindow || hwnd_) return;
    const wchar_t kClass[] = L"JasWaveBusCompModernEditor";
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

    RECT parentRc{};
    GetClientRect((HWND)systemWindow, &parentRc);
    int initW = 680;
    int initH = 500;
    if (parentRc.right - parentRc.left > 200) initW = parentRc.right - parentRc.left;
    if (parentRc.bottom - parentRc.top > 200) initH = parentRc.bottom - parentRc.top;
    rect = ViewRect(0, 0, initW, initH);

    hwnd_ = CreateWindowExW(0, kClass, L"JasWave Master Bus Compressor", WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN,
                            0, 0, initW, initH, (HWND)systemWindow, nullptr, GetModuleHandleW(nullptr), this);
    if (!hwnd_) return;
    SetWindowLongPtrW(hwnd_, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(this));

    bus_ = JasWaveDsp::PluginBusHub<JasWaveComp::CompBus>::getLast();
    updateLayout();
    SetTimer(hwnd_, 102, 33, nullptr);
}

void BusCompEditorView::removedFromParent() {
    if (hwnd_) {
        KillTimer(hwnd_, 102);
        DestroyWindow(hwnd_);
        hwnd_ = nullptr;
    }
}

LRESULT CALLBACK BusCompEditorView::WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    auto* self = reinterpret_cast<BusCompEditorView*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
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
            return 1;

        case WM_TIMER: {
            if (self) {
                if (!self->bus_) self->bus_ = JasWaveDsp::PluginBusHub<JasWaveComp::CompBus>::getLast();
                if (self->bus_) {
                    self->bus_->scope.snapshot(self->scopeSnap_);
                    self->currentGrDb_ = self->bus_->grMax.take();
                }
                InvalidateRect(hwnd, &self->visualizerRc_, FALSE);
            }
            return 0;
        }
        case WM_LBUTTONDOWN: {
            if (!self) break;
            int mx = LOWORD(lParam);
            int my = HIWORD(lParam);

            for (size_t i = 0; i < self->sliders_.size(); ++i) {
                auto& s = self->sliders_[i];
                if (mx >= s.bounds.left && mx <= s.bounds.right &&
                    my >= s.bounds.top && my <= s.bounds.bottom) {
                    self->draggingSliderIdx_ = (int)i;
                    s.isDragging = true;
                    SetCapture(hwnd);

                    double norm = (double)(mx - s.bounds.left) / (double)(s.bounds.right - s.bounds.left);
                    norm = std::max(0.0, std::min(1.0, norm));
                    s.normalized = norm;

                    if (s.id == 1) { // Threshold
                        self->threshDb_ = -40.0 + norm * 40.0;
                        std::wstringstream ss; ss << std::fixed << std::setprecision(1) << self->threshDb_ << L" dB";
                        s.valueText = ss.str();
                    } else if (s.id == 2) { // Ratio
                        self->ratioVal_ = 1.0 + norm * 9.0;
                        std::wstringstream ss; ss << std::fixed << std::setprecision(1) << self->ratioVal_ << L":1";
                        s.valueText = ss.str();
                    } else if (s.id == 3) { // Attack
                        self->attackMs_ = 0.1 + norm * 29.9;
                        std::wstringstream ss; ss << std::fixed << std::setprecision(1) << self->attackMs_ << L" ms";
                        s.valueText = ss.str();
                    } else if (s.id == 4) { // Release
                        self->releaseMs_ = 50.0 + norm * 1150.0;
                        s.valueText = std::to_wstring((int)self->releaseMs_) + L" ms";
                    } else if (s.id == 6) { // Makeup
                        self->makeupGainDb_ = norm * 18.0;
                        std::wstringstream ss; ss << std::fixed << std::setprecision(1) << L"+" << self->makeupGainDb_ << L" dB";
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
                self->threshDb_ = -40.0 + norm * 40.0;
                std::wstringstream ss; ss << std::fixed << std::setprecision(1) << self->threshDb_ << L" dB";
                s.valueText = ss.str();
            } else if (s.id == 2) {
                self->ratioVal_ = 1.0 + norm * 9.0;
                std::wstringstream ss; ss << std::fixed << std::setprecision(1) << self->ratioVal_ << L":1";
                s.valueText = ss.str();
            } else if (s.id == 3) {
                self->attackMs_ = 0.1 + norm * 29.9;
                std::wstringstream ss; ss << std::fixed << std::setprecision(1) << self->attackMs_ << L" ms";
                s.valueText = ss.str();
            } else if (s.id == 4) {
                self->releaseMs_ = 50.0 + norm * 1150.0;
                s.valueText = std::to_wstring((int)self->releaseMs_) + L" ms";
            } else if (s.id == 6) {
                self->makeupGainDb_ = norm * 18.0;
                std::wstringstream ss; ss << std::fixed << std::setprecision(1) << L"+" << self->makeupGainDb_ << L" dB";
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
                HDC memDC = CreateCompatibleDC(hdc);
                HBITMAP memBmp = CreateCompatibleBitmap(hdc, w, h);
                HGDIOBJ oldBmp = SelectObject(memDC, memBmp);

                {
                    Gdiplus::Graphics g(memDC);
                    JasWaveUI::drawCyberFrame(g, w, h,
                                             L"JASWAVE MASTER BUS COMPRESSOR",
                                             L"DYNAMIC VCA GLUE & ENVELOPE DYNAMICS",
                                             L"[OPTO/VCA SMART-DETECTOR]");

                    if (self) {
                        JasWaveUI::drawCompressorVisualizer(g, self->visualizerRc_,
                                                           self->threshDb_,
                                                           self->ratioVal_,
                                                           self->currentGrDb_,
                                                           &self->scopeSnap_,
                                                           self->bus_ ? static_cast<double>(self->bus_->detLevelDb.load(std::memory_order_relaxed)) : -100.0,
                                                           self->animPhase_);

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

} // namespace JasWaveBusComp

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveBusComp::kProcessorUid),
               PClassInfo::kManyInstances, kVstAudioEffectClass,
               "JasWave Master Bus Compressor", Vst::kDistributable, "Fx|Dynamics",
               "1.0.0", kVstVersionString, JasWaveBusComp::BusCompProcessor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveBusComp::kControllerUid),
               PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave Master Bus Compressor Controller", 0, "",
               "1.0.0", kVstVersionString, JasWaveBusComp::BusCompController::createInstance)
END_FACTORY
