/**
 * Instanciación ASIO a prueba de crashes.
 * Los drivers ASIO no son COM “de verdad” (el IID es el CLSID) y varios (UMC, wrappers)
 * AV o devuelven E_NOINTERFACE. REAPER/JUCE envuelven CoCreateInstance en SEH.
 */

#ifdef _WIN32

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <objbase.h>
#include <string.h>

#include "asio_com.h"

int jaswave_com_create(const void* clsid, const void* iid, void** out) {
  if (out) *out = NULL;
  if (!clsid || !iid || !out) return (int)E_POINTER;
  __try {
    return (int)CoCreateInstance((REFCLSID)clsid, NULL, CLSCTX_INPROC_SERVER, (REFIID)iid, out);
  } __except (EXCEPTION_EXECUTE_HANDLER) {
    return (int)GetExceptionCode();
  }
}

int jaswave_com_factory_create(void* factory, const void* iid, void** out) {
  if (out) *out = NULL;
  if (!factory || !iid || !out) return (int)E_POINTER;
  __try {
    void** vt = *(void***)factory;
    typedef HRESULT(STDMETHODCALLTYPE * CreateFn)(void*, void*, const IID*, void**);
    CreateFn create = (CreateFn)vt[3];
    return (int)create(factory, NULL, (const IID*)iid, out);
  } __except (EXCEPTION_EXECUTE_HANDLER) {
    return (int)GetExceptionCode();
  }
}

int jaswave_asio_probe_name(void* drv, char* name, int nameBytes) {
  if (!drv || !name || nameBytes < 8) return 0;
  memset(name, 0, (size_t)nameBytes);
  __try {
    void** vt = *(void***)drv;
    if (!vt || !vt[4]) return 0;
    typedef void (*GetNameFn)(void* thisPtr, char* outName);
    ((GetNameFn)vt[4])(drv, name);
    name[nameBytes - 1] = 0;
    int printable = 0;
    int i;
    for (i = 0; i < nameBytes && name[i]; ++i) {
      unsigned char c = (unsigned char)name[i];
      if (c < 32) return 0;
      ++printable;
    }
    return printable >= 3 ? 1 : 0;
  } __except (EXCEPTION_EXECUTE_HANDLER) {
    if (name && nameBytes > 0) name[0] = 0;
    return 0;
  }
}

int jaswave_asio_seh_init(void* drv, void* hwnd) {
  if (!drv) return 0;
  __try {
    void** vt = *(void***)drv;
    if (!vt || !vt[3]) return 0;
    typedef long (*InitFn)(void* thisPtr, void* sysHandle);
    return (int)((InitFn)vt[3])(drv, hwnd);
  } __except (EXCEPTION_EXECUTE_HANDLER) {
    return (int)0x80000000;
  }
}

int jaswave_asio_seh_output_ready(void* drv) {
  if (!drv) return (int)E_POINTER;
  __try {
    void** vt = *(void***)drv;
    /* IUnknown(3) + init..future(20) → outputReady = 23 */
    if (!vt || !vt[23]) return (int)E_FAIL;
    typedef long (*ReadyFn)(void* thisPtr);
    return (int)((ReadyFn)vt[23])(drv);
  } __except (EXCEPTION_EXECUTE_HANDLER) {
    return (int)GetExceptionCode();
  }
}

#endif
