/**
 * Editor HWND simple para JasWave Roles (sliders → setParamNormalized).
 */
#pragma once

#include "controller.h"
#include "public.sdk/source/common/pluginview.h"

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <commctrl.h>
#endif

namespace JasWaveRoles {

class RolesEditorView : public Steinberg::CPluginView {
public:
  explicit RolesEditorView(Controller* controller);
  ~RolesEditorView() override;

  void attachedToParent() override;
  void removedFromParent() override;

#ifdef _WIN32
  static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam);
#endif

private:
  void syncFromController();
  void applySlider(int paramId, int pos0to1000);

  Controller* controller_{nullptr};
#ifdef _WIN32
  HWND hwnd_{nullptr};
  HWND sliders_[7]{};
  static bool classRegistered_;
#endif
};

} // namespace JasWaveRoles
