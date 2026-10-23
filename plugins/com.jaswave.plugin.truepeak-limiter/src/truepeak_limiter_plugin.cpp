#ifndef NOMINMAX
#define NOMINMAX
#endif

#include "truepeak_limiter_dsp.h"
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

namespace JasWaveTruePeak {

static const FUID kProcessorUid(0x4A617357, 0x4C494D49, 0x50726F63, 0x56335431);
static const FUID kControllerUid(0x4A617357, 0x4C494D49, 0x436E7472, 0x56335431);

class TruePeakController;

#ifdef _WIN32
class TruePeakEditorView : public CPluginView {
public:
    explicit TruePeakEditorView(TruePeakController* controller);
    ~TruePeakEditorView() SMTG_OVERRIDE;

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

    TruePeakController* controller_{nullptr};
    HWND hwnd_{nullptr};
    static bool classRegistered_;

    std::vector<JasWaveUI::CyberSlider> sliders_;
    RECT visualizerRc_{0, 0, 0, 0};
    int draggingSliderIdx_{-1};
    float animPhase_{0.0f};

    double ceilingDb_{-0.3};
    double driveDb_{0.0};
    double releaseMs_{50.0};
    double peakDb_{-0.3};
    std::shared_ptr<JasWaveLimiter::LimiterBus> bus_;
    JasWaveDsp::ScopeSnapshot scopeSnap_;
    float lufsM_{-120.0f}, lufsI_{-120.0f}, tpOut_{0.0f};
};
#endif

class TruePeakProcessor : public AudioEffect {
public:
    TruePeakProcessor() {
        setControllerClass(kControllerUid);
        bus_ = std::make_shared<JasWaveLimiter::LimiterBus>();
        JasWaveDsp::PluginBusHub<JasWaveLimiter::LimiterBus>::set(this, bus_);
    }
    ~TruePeakProcessor() SMTG_OVERRIDE {
        JasWaveDsp::PluginBusHub<JasWaveLimiter::LimiterBus>::remove(this);
    }
    static FUnknown* createInstance(void*) { return (IAudioProcessor*)new TruePeakProcessor(); }

    tresult PLUGIN_API initialize(FUnknown* context) SMTG_OVERRIDE {
        tresult result = AudioEffect::initialize(context);
        if (result != kResultOk) return result;
        addAudioInput(STR16("Stereo In"), SpeakerArr::kStereo);
        addAudioOutput(STR16("Stereo Out"), SpeakerArr::kStereo);
        return kResultOk;
    }

    tresult PLUGIN_API setupProcessing(ProcessSetup& newSetup) SMTG_OVERRIDE {
        engine_.prepare(newSetup.sampleRate, newSetup.maxSamplesPerBlock);
        if (bus_) {
            bus_->sampleRate.store(newSetup.sampleRate);
            bus_->loudness.prepare(newSetup.sampleRate);
        }
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
                    } else if (id == 1) { // Ceiling (-3.0 to 0.0 dBTP)
                        settings_.ceilingDb = -3.0 + val * 3.0;
                    } else if (id == 2) { // Drive (0 to 12 dB)
                        settings_.gainDb = val * 12.0;
                    } else if (id == 3) { // Release (5 to 500 ms)
                        settings_.releaseMs = 5.0 + val * 495.0;
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
    JasWaveLimiter::LimiterEngine engine_;
    JasWaveLimiter::LimiterSettings settings_;
    std::shared_ptr<JasWaveLimiter::LimiterBus> bus_;
};

class TruePeakController : public EditController {
public:
    static FUnknown* createInstance(void*) { return (IEditController*)new TruePeakController(); }

    tresult PLUGIN_API initialize(FUnknown* context) SMTG_OVERRIDE {
        tresult result = EditController::initialize(context);
        if (result != kResultOk) return result;
        parameters.addParameter(STR16("Bypass"), nullptr, 1, 0, ParameterInfo::kCanAutomate, 0);
        parameters.addParameter(STR16("Ceiling (dBTP)"), STR16("dBTP"), 0, 0.90, ParameterInfo::kCanAutomate, 1);
        parameters.addParameter(STR16("Input Drive (dB)"), STR16("dB"), 0, 0.00, ParameterInfo::kCanAutomate, 2);
        parameters.addParameter(STR16("Release (ms)"), STR16("ms"), 0, 0.20, ParameterInfo::kCanAutomate, 3);
        return kResultOk;
    }

    IPlugView* PLUGIN_API createView(FIDString name) SMTG_OVERRIDE {
        if (name && strcmp(name, ViewType::kEditor) == 0) {
#ifdef _WIN32
            return new TruePeakEditorView(this);
#endif
        }
        return nullptr;
    }
};

#ifdef _WIN32
bool TruePeakEditorView::classRegistered_ = false;

TruePeakEditorView::TruePeakEditorView(TruePeakController* controller)
    : CPluginView(nullptr), controller_(controller) {
    rect = ViewRect(0, 0, 680, 480);
    JasWaveUI::ensureGdiplus();

    sliders_ = {
        { 1, L"CEILING (dBTP)", L"-0.3 dBTP", 0.90, {}, JasWaveUI::Colors::neonMagenta(), false },
        { 2, L"INPUT DRIVE",   L"+0.0 dB",   0.00, {}, JasWaveUI::Colors::neonCyan(), false },
        { 3, L"RELEASE TIME",  L"50.0 ms",   0.20, {}, JasWaveUI::Colors::neonAmber(), false }
    };
}

TruePeakEditorView::~TruePeakEditorView() {
    removedFromParent();
}

void TruePeakEditorView::updateLayout() {
    if (!hwnd_) return;
    RECT rc;
    GetClientRect(hwnd_, &rc);
    int w = rc.right - rc.left;
    int h = rc.bottom - rc.top;
    if (w <= 0 || h <= 0) return;

    int padX = 28;
    int visTop = 72;
    int visH = (int)(h * 0.44);
    if (visH < 120) visH = 120;
    visualizerRc_ = { padX, visTop, w - padX, visTop + visH };

    int slidersTop = visualizerRc_.bottom + 22;
    int availableH = h - slidersTop - 24;
    int sliderH = std::max(36, availableH / (int)sliders_.size());

    for (size_t i = 0; i < sliders_.size(); ++i) {
        int sy = slidersTop + (int)i * sliderH;
        sliders_[i].bounds = { padX + 8, sy, w - padX - 8, sy + 32 };
    }
}

void TruePeakEditorView::attachedToParent() {
    if (!systemWindow || hwnd_) return;
    const wchar_t kClass[] = L"JasWaveTruePeakModernEditor";
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
    int initH = 480;
    if (parentRc.right - parentRc.left > 200) initW = parentRc.right - parentRc.left;
    if (parentRc.bottom - parentRc.top > 200) initH = parentRc.bottom - parentRc.top;
    rect = ViewRect(0, 0, initW, initH);

    hwnd_ = CreateWindowExW(0, kClass, L"JasWave TruePeak Brickwall Limiter", WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN,
                            0, 0, initW, initH, (HWND)systemWindow, nullptr, GetModuleHandleW(nullptr), this);
    if (!hwnd_) return;
    SetWindowLongPtrW(hwnd_, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(this));

    bus_ = JasWaveDsp::PluginBusHub<JasWaveLimiter::LimiterBus>::getLast();
    updateLayout();
    SetTimer(hwnd_, 103, 33, nullptr);
}

void TruePeakEditorView::removedFromParent() {
    if (hwnd_) {
        KillTimer(hwnd_, 103);
        DestroyWindow(hwnd_);
        hwnd_ = nullptr;
    }
}

LRESULT CALLBACK TruePeakEditorView::WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    auto* self = reinterpret_cast<TruePeakEditorView*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
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
                if (!self->bus_) self->bus_ = JasWaveDsp::PluginBusHub<JasWaveLimiter::LimiterBus>::getLast();
                if (self->bus_) {
                    self->bus_->scope.snapshot(self->scopeSnap_);
                    self->lufsM_ = self->bus_->loudness.momentary.load(std::memory_order_relaxed);
                    self->lufsI_ = self->bus_->loudness.integrated.load(std::memory_order_relaxed);
                    self->tpOut_ = self->bus_->tpOut.take();
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

                    if (s.id == 1) { // Ceiling (-3.0 to 0.0 dBTP)
                        self->ceilingDb_ = -3.0 + norm * 3.0;
                        std::wstringstream ss; ss << std::fixed << std::setprecision(2) << self->ceilingDb_ << L" dBTP";
                        s.valueText = ss.str();
                    } else if (s.id == 2) { // Drive (0 to 12 dB)
                        self->driveDb_ = norm * 12.0;
                        std::wstringstream ss; ss << std::fixed << std::setprecision(1) << L"+" << self->driveDb_ << L" dB";
                        s.valueText = ss.str();
                    } else if (s.id == 3) { // Release (5 to 500 ms)
                        self->releaseMs_ = 5.0 + norm * 495.0;
                        std::wstringstream ss; ss << std::fixed << std::setprecision(1) << self->releaseMs_ << L" ms";
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
                self->ceilingDb_ = -3.0 + norm * 3.0;
                std::wstringstream ss; ss << std::fixed << std::setprecision(2) << self->ceilingDb_ << L" dBTP";
                s.valueText = ss.str();
            } else if (s.id == 2) {
                self->driveDb_ = norm * 12.0;
                std::wstringstream ss; ss << std::fixed << std::setprecision(1) << L"+" << self->driveDb_ << L" dB";
                s.valueText = ss.str();
            } else if (s.id == 3) {
                self->releaseMs_ = 5.0 + norm * 495.0;
                std::wstringstream ss; ss << std::fixed << std::setprecision(1) << self->releaseMs_ << L" ms";
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
                                             L"JASWAVE TRUEPEAK BRICKWALL LIMITER",
                                             L"ITU-R BS.1770-4 MASTERING LOOKAHEAD ENVELOPE",
                                             L"[MASTERING-AI ACTIVE]");

                    if (self) {
                        JasWaveUI::drawLimiterVisualizer(g, self->visualizerRc_,
                                                        self->ceilingDb_,
                                                        self->driveDb_,
                                                        self->peakDb_,
                                                        &self->scopeSnap_,
                                                        self->lufsM_,
                                                        self->lufsI_,
                                                        self->tpOut_,
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

} // namespace JasWaveTruePeak

bool InitModule() { return true; }
bool DeinitModule() { return true; }

BEGIN_FACTORY_DEF("JasWave Audio", "https://jaswave.app", "mailto:dev@jaswave.app")
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveTruePeak::kProcessorUid),
               PClassInfo::kManyInstances, kVstAudioEffectClass,
               "JasWave TruePeak Brickwall Limiter", Vst::kDistributable, "Fx|Mastering",
               "1.0.0", kVstVersionString, JasWaveTruePeak::TruePeakProcessor::createInstance)
    DEF_CLASS2(INLINE_UID_FROM_FUID(JasWaveTruePeak::kControllerUid),
               PClassInfo::kManyInstances, kVstComponentControllerClass,
               "JasWave TruePeak Brickwall Limiter Controller", 0, "",
               "1.0.0", kVstVersionString, JasWaveTruePeak::TruePeakController::createInstance)
END_FACTORY
