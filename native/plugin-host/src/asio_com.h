#pragma once

#ifdef _WIN32

#ifdef __cplusplus
extern "C" {
#endif

/** CoCreateInstance envuelto en SEH (JUCE/REAPER: el driver puede AV al abrirse). */
int jaswave_com_create(const void* clsid, const void* iid, void** out);

/** IClassFactory::CreateInstance envuelto en SEH. */
int jaswave_com_factory_create(void* factory, const void* iid, void** out);

/** Llama IASIO::getDriverName vía vtable y comprueba texto imprimible. 1 = ok. */
int jaswave_asio_probe_name(void* drv, char* name, int nameBytes);

/** IASIO::init vía vtable + SEH. Devuelve el ASIOBool del driver, o <0 si crasheó. */
int jaswave_asio_seh_init(void* drv, void* hwnd);

/** IASIO::outputReady vía vtable + SEH (el callback ASIO no puede permitirse un AV). */
int jaswave_asio_seh_output_ready(void* drv);

#ifdef __cplusplus
}
#endif

#endif
