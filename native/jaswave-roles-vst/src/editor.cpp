#include "editor.h"
#include "roles_map.h"

#include "pluginterfaces/base/ustring.h"

#include <algorithm>
#include <cstdio>
#include <cstring>

using namespace Steinberg;
using namespace Steinberg::Vst;

namespace JasWaveRoles {

#ifdef _WIN32
bool RolesEditorView::classRegistered_ = false;

namespace {
constexpr int kW = 360;
constexpr int kH = 280;
constexpr wchar_t kClassName[] = L"JasWaveRolesEditor";

const char* paramLabel(int id) {
  switch (id) {
    case kParamRoleId: return "Role";
    case kParamAttackId: return "Attack";
    case kParamReleaseId: return "Release";
    case kParamCutoffId: return "Cutoff";
    case kParamResonanceId: return "Resonance";
    case kParamGainId: return "Gain";
    case kParamVoicesId: return "Voices";
    default: return "?";
  }
}
} // namespace
#endif

RolesEditorView::RolesEditorView(Controller* controller)
    : CPluginView(nullptr), controller_(controller) {
  rect = ViewRect(0, 0, 360, 280);
}

RolesEditorView::~RolesEditorView() {
  removedFromParent();
}

void RolesEditorView::attachedToParent() {
#ifdef _WIN32
  if (!systemWindow || hwnd_) return;
  if (!classRegistered_) {
    WNDCLASSW wc{};
    wc.lpfnWndProc = WndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = kClassName;
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
    RegisterClassW(&wc);
    classRegistered_ = true;
    INITCOMMONCONTROLSEX icc{sizeof(icc), ICC_BAR_CLASSES};
    InitCommonControlsEx(&icc);
  }
  hwnd_ = CreateWindowExW(0, kClassName, L"JasWave Roles", WS_CHILD | WS_VISIBLE, 0, 0, kW, kH,
                          (HWND)systemWindow, nullptr, GetModuleHandleW(nullptr), this);
  if (!hwnd_) return;
  SetWindowLongPtrW(hwnd_, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(this));

  for (int i = 0; i < 7; ++i) {
    const int y = 12 + i * 36;
    CreateWindowW(L"STATIC", nullptr, WS_CHILD | WS_VISIBLE, 12, y, 80, 20, hwnd_, nullptr,
                  GetModuleHandleW(nullptr), nullptr);
    // label text
    HWND lab = CreateWindowW(L"STATIC", L"", WS_CHILD | WS_VISIBLE, 12, y, 80, 20, hwnd_, nullptr,
                             GetModuleHandleW(nullptr), nullptr);
    wchar_t wlab[32];
    MultiByteToWideChar(CP_UTF8, 0, paramLabel(i), -1, wlab, 32);
    SetWindowTextW(lab, wlab);

    sliders_[i] = CreateWindowW(TRACKBAR_CLASSW, L"", WS_CHILD | WS_VISIBLE | TBS_AUTOTICKS, 100, y,
                                240, 28, hwnd_, reinterpret_cast<HMENU>(static_cast<INT_PTR>(i + 1)),
                                GetModuleHandleW(nullptr), nullptr);
    SendMessageW(sliders_[i], TBM_SETRANGE, TRUE, MAKELONG(0, 1000));
    SendMessageW(sliders_[i], TBM_SETPAGESIZE, 0, 50);
  }
  syncFromController();
#else
  (void)controller_;
#endif
}

void RolesEditorView::removedFromParent() {
#ifdef _WIN32
  if (hwnd_) {
    DestroyWindow(hwnd_);
    hwnd_ = nullptr;
  }
  for (auto& s : sliders_) s = nullptr;
#endif
}

void RolesEditorView::syncFromController() {
#ifdef _WIN32
  if (!controller_) return;
  for (int i = 0; i < 7; ++i) {
    if (!sliders_[i]) continue;
    const double n = controller_->getParamNormalized(static_cast<ParamID>(i));
    SendMessageW(sliders_[i], TBM_SETPOS, TRUE, static_cast<LPARAM>(std::lround(n * 1000.0)));
  }
#endif
}

void RolesEditorView::applySlider(int paramId, int pos0to1000) {
  if (!controller_) return;
  const double n = std::clamp(pos0to1000 / 1000.0, 0.0, 1.0);
  controller_->setParamNormalized(static_cast<ParamID>(paramId), n);
  controller_->performEdit(static_cast<ParamID>(paramId), n);
}

#ifdef _WIN32
LRESULT CALLBACK RolesEditorView::WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  auto* self = reinterpret_cast<RolesEditorView*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (msg == WM_NCCREATE) {
    auto* cs = reinterpret_cast<CREATESTRUCTW*>(lParam);
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(cs->lpCreateParams));
    return DefWindowProcW(hwnd, msg, wParam, lParam);
  }
  if (!self) return DefWindowProcW(hwnd, msg, wParam, lParam);
  if (msg == WM_HSCROLL) {
    HWND track = reinterpret_cast<HWND>(lParam);
    for (int i = 0; i < 7; ++i) {
      if (self->sliders_[i] == track) {
        const int pos = static_cast<int>(SendMessageW(track, TBM_GETPOS, 0, 0));
        self->applySlider(i, pos);
        break;
      }
    }
    return 0;
  }
  return DefWindowProcW(hwnd, msg, wParam, lParam);
}
#endif

} // namespace JasWaveRoles
