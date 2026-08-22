"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const ai_gateway_1 = require("./ai-gateway");
let mainWindow = null;
/** Icono de app (ventana / taskbar). */
function resolveAppIconPath() {
    const fileName = 'jaswave-icono-con-frecuencia.png';
    const candidates = [
        // Dev: build/electron/electron → ../../../public
        path.join(__dirname, '..', '..', '..', 'public', fileName),
        // Prod: dist (Vite copia public/)
        path.join(__dirname, '..', '..', '..', 'dist', fileName),
        path.join(__dirname, '..', 'dist', fileName),
        path.join(process.resourcesPath || '', fileName),
    ];
    for (const candidate of candidates) {
        try {
            if (candidate && fsSync.existsSync(candidate))
                return candidate;
        }
        catch (_a) {
            /* ignore */
        }
    }
    return undefined;
}
function sendMenuAction(id) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('menu-action', id);
    }
}
function buildAppMenu() {
    const template = [
        {
            label: 'Archivo',
            submenu: [
                { label: 'Nuevo proyecto', accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction('proyecto.nuevo') },
                { label: 'Abrir…', accelerator: 'CmdOrCtrl+O', click: () => sendMenuAction('proyecto.abrir') },
                { type: 'separator' },
                { label: 'Guardar', accelerator: 'CmdOrCtrl+S', click: () => sendMenuAction('proyecto.guardar') },
                { label: 'Guardar como…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenuAction('proyecto.guardarComo') },
                { type: 'separator' },
                { label: 'Cerrar proyecto', click: () => sendMenuAction('proyecto.cerrar') },
                { role: 'quit', label: 'Salir' },
            ],
        },
        {
            label: 'Editar',
            submenu: [
                { label: 'Deshacer', accelerator: 'CmdOrCtrl+Z', click: () => sendMenuAction('edicion.deshacer') },
                { label: 'Rehacer', accelerator: 'CmdOrCtrl+Y', click: () => sendMenuAction('edicion.rehacer') },
                { type: 'separator' },
                { label: 'Cortar', accelerator: 'CmdOrCtrl+X', click: () => sendMenuAction('edicion.cortar') },
                { label: 'Copiar', accelerator: 'CmdOrCtrl+C', click: () => sendMenuAction('edicion.copiar') },
                { label: 'Pegar', accelerator: 'CmdOrCtrl+V', click: () => sendMenuAction('edicion.pegar') },
                { label: 'Duplicar', accelerator: 'CmdOrCtrl+D', click: () => sendMenuAction('edicion.duplicar') },
                { label: 'Eliminar', accelerator: 'Delete', click: () => sendMenuAction('edicion.eliminar') },
                { type: 'separator' },
                { label: 'Seleccionar todo', accelerator: 'CmdOrCtrl+A', click: () => sendMenuAction('edicion.seleccionarTodo') },
            ],
        },
        {
            label: 'Ver',
            submenu: [
                { label: 'Acercar', accelerator: 'CmdOrCtrl+=', click: () => sendMenuAction('vista.zoomIn') },
                { label: 'Alejar', accelerator: 'CmdOrCtrl+-', click: () => sendMenuAction('vista.zoomOut') },
                { label: 'Zoom predeterminado', click: () => sendMenuAction('vista.zoomTodo') },
                { type: 'separator' },
                { label: 'Panel izquierdo', click: () => sendMenuAction('ventana.barraLateral') },
                { label: 'Panel derecho', click: () => sendMenuAction('ventana.panelDerecho') },
                { label: 'Panel inferior', click: () => sendMenuAction('ventana.panelInferior') },
                { type: 'separator' },
                { label: 'Paleta de comandos', accelerator: 'CmdOrCtrl+Shift+P', click: () => sendMenuAction('ventana.paletaComandos') },
                { label: 'Atajos de teclado…', click: () => sendMenuAction('ventana.atajos') },
            ],
        },
        {
            label: 'Transporte',
            submenu: [
                { label: 'Reproducir / Pausar', click: () => sendMenuAction('transporte.reproducir') },
                { label: 'Detener', click: () => sendMenuAction('transporte.detener') },
                { label: 'Grabar', accelerator: 'CmdOrCtrl+R', click: () => sendMenuAction('transporte.grabar') },
                { type: 'separator' },
                { label: 'Ir al inicio', click: () => sendMenuAction('transporte.inicio') },
                { label: 'Bucle', click: () => sendMenuAction('transporte.loop') },
                { label: 'Metrónomo', click: () => sendMenuAction('transporte.metronomo') },
            ],
        },
        {
            label: 'Acciones',
            submenu: [
                { label: 'Nueva pista de audio', click: () => sendMenuAction('pista.nueva') },
                { label: 'Nueva pista MIDI', click: () => sendMenuAction('pista.nuevaMidi') },
                { type: 'separator' },
                { label: 'Ajustes del proyecto…', click: () => sendMenuAction('ventana.ajustes') },
            ],
        },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function createWindow() {
    const icon = resolveAppIconPath();
    mainWindow = new BrowserWindow(Object.assign(Object.assign({ width: 1400, height: 900, minWidth: 1000, minHeight: 600, frame: false, backgroundColor: '#0b0d10' }, (icon ? { icon } : {})), { webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        } }));
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
app.whenReady().then(() => {
    if (process.platform === 'win32') {
        app.setAppUserModelId('com.jaswave.app');
    }
    buildAppMenu();
    createWindow();
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
app.on('before-quit', () => {
    try {
        require('./plugin-host-bridge').stopPluginHost();
    }
    catch (_a) {
        /* ignore */
    }
});
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('window-minimize', () => {
    if (mainWindow)
        mainWindow.minimize();
});
ipcMain.handle('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        }
        else {
            mainWindow.maximize();
        }
    }
});
ipcMain.handle('window-close', () => {
    if (mainWindow)
        mainWindow.close();
});
ipcMain.handle('window-is-maximized', () => {
    if (mainWindow)
        return mainWindow.isMaximized();
    return false;
});
ipcMain.handle('file-save', (_event, ruta, contenido) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield fs.writeFile(ruta, contenido, 'utf-8');
        return { success: true };
    }
    catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
}));
ipcMain.handle('file-read', (_event, ruta) => __awaiter(void 0, void 0, void 0, function* () {
    const contenido = yield fs.readFile(ruta, 'utf-8');
    return contenido;
}));
ipcMain.handle('file-exists', (_event, ruta) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield fs.access(ruta);
        return true;
    }
    catch (_a) {
        return false;
    }
}));
ipcMain.handle('file-size', (_event, ruta) => __awaiter(void 0, void 0, void 0, function* () {
    const stat = yield fs.stat(ruta);
    return stat.size;
}));
ipcMain.handle('dialog-save', () => __awaiter(void 0, void 0, void 0, function* () {
    if (!mainWindow)
        return { canceled: true };
    const result = yield dialog.showSaveDialog(mainWindow, {
        filters: [{ name: 'JasWave Project', extensions: ['jaswave'] }],
        properties: ['createPanel'],
    });
    return result;
}));
ipcMain.handle('dialog-open', () => __awaiter(void 0, void 0, void 0, function* () {
    if (!mainWindow)
        return { canceled: true };
    const result = yield dialog.showOpenDialog(mainWindow, {
        filters: [{ name: 'JasWave Project', extensions: ['jaswave'] }],
        properties: ['openFile'],
    });
    return result;
}));
ipcMain.handle('dialog-open-directory', () => __awaiter(void 0, void 0, void 0, function* () {
    if (!mainWindow)
        return { canceled: true, filePaths: [] };
    const result = yield dialog.showOpenDialog(mainWindow, {
        title: 'Carpeta de plugins VST3',
        properties: ['openDirectory'],
    });
    return result;
}));
ipcMain.handle('project-save', (_event, _projectId, data) => __awaiter(void 0, void 0, void 0, function* () {
    if (!mainWindow)
        return { success: false, error: 'No window' };
    try {
        const proyecto = data === null || data === void 0 ? void 0 : data.project;
        let ruta = proyecto === null || proyecto === void 0 ? void 0 : proyecto.ruta;
        if (!ruta) {
            const dialogResult = yield dialog.showSaveDialog(mainWindow, {
                filters: [{ name: 'JasWave Project', extensions: ['jaswave'] }],
                defaultPath: `${(proyecto === null || proyecto === void 0 ? void 0 : proyecto.nombre) || 'proyecto'}.jaswave`,
            });
            if (dialogResult.canceled || !dialogResult.filePath) {
                return { success: false, canceled: true };
            }
            ruta = dialogResult.filePath.endsWith('.jaswave')
                ? dialogResult.filePath
                : `${dialogResult.filePath}.jaswave`;
        }
        const json = JSON.stringify(data);
        yield fs.writeFile(ruta, json, 'utf-8');
        const stat = yield fs.stat(ruta);
        return { success: true, path: ruta, size: stat.size };
    }
    catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
}));
ipcMain.handle('project-load', (_event, projectId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const ruta = projectId.endsWith('.jaswave') ? projectId : `${projectId}.jaswave`;
        const contenido = yield fs.readFile(ruta, 'utf-8');
        return { success: true, data: JSON.parse(contenido), path: ruta };
    }
    catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
}));
ipcMain.handle('project-save-as', (_event, projectId, data) => __awaiter(void 0, void 0, void 0, function* () {
    if (!mainWindow)
        return { success: false, canceled: true };
    const result = yield dialog.showSaveDialog(mainWindow, {
        filters: [{ name: 'JasWave Project', extensions: ['jaswave'] }],
        properties: ['createPanel'],
    });
    if (result.canceled || !result.filePath)
        return { success: false, canceled: true };
    try {
        yield fs.writeFile(result.filePath, JSON.stringify(data), 'utf-8');
        return { success: true, path: result.filePath, size: 0 };
    }
    catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
}));
ipcMain.handle('project-open-dialog', () => __awaiter(void 0, void 0, void 0, function* () {
    if (!mainWindow)
        return { success: false, canceled: true };
    const result = yield dialog.showOpenDialog(mainWindow, {
        filters: [{ name: 'JasWave Project', extensions: ['jaswave'] }],
        properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0)
        return { success: false, canceled: true };
    // Solo devolvemos la ruta; project.load + FileService leen el archivo
    return { success: true, path: result.filePaths[0] };
}));
ipcMain.handle('project-list', () => __awaiter(void 0, void 0, void 0, function* () {
    return { success: true, projects: [] };
}));
ipcMain.handle('ai-chat', (_event, payload, model, baseUrl, temperature) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    // Nuevo: objeto AiChatRequest. Legacy: (messages[], model, baseUrl, temperature)
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'messages' in payload && 'kind' in payload) {
        return (0, ai_gateway_1.aiChat)(payload);
    }
    return (0, ai_gateway_1.aiChat)((0, ai_gateway_1.legacyChatArgsToRequest)((_a = payload) !== null && _a !== void 0 ? _a : [], model, baseUrl, temperature));
}));
ipcMain.handle('ai-health', (_event, payload) => __awaiter(void 0, void 0, void 0, function* () {
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'kind' in payload) {
        return (0, ai_gateway_1.aiHealth)(payload);
    }
    // Legacy: solo baseUrl string
    const baseUrl = typeof payload === 'string' ? payload : undefined;
    return (0, ai_gateway_1.aiHealth)({
        kind: 'ollama',
        baseUrl: baseUrl || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
    });
}));
ipcMain.handle('dialog-message', (_event, type, title, message) => __awaiter(void 0, void 0, void 0, function* () {
    if (!mainWindow)
        return 0;
    const result = yield dialog.showMessageBox(mainWindow, {
        type: type,
        title,
        message,
        buttons: ['OK'],
    });
    return result.response;
}));
ipcMain.handle('shell-open-external', (_event, url) => __awaiter(void 0, void 0, void 0, function* () {
    const { shell } = require('electron');
    yield shell.openExternal(url);
}));
/** Ventanas flotantes de herramientas (multi-monitor) */
const toolWindows = new Map();
ipcMain.handle('tool-window-open', (_event, toolId, title) => __awaiter(void 0, void 0, void 0, function* () {
    const existing = toolWindows.get(toolId);
    if (existing && !existing.isDestroyed()) {
        existing.focus();
        return { success: true, focused: true };
    }
    const icon = resolveAppIconPath();
    const win = new BrowserWindow(Object.assign(Object.assign({ width: 960, height: 640, minWidth: 480, minHeight: 320, title: `JasWave — ${title}`, backgroundColor: '#0b0d10', show: false }, (icon ? { icon } : {})), { webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        } }));
    toolWindows.set(toolId, win);
    win.once('ready-to-show', () => {
        if (!win.isDestroyed())
            win.show();
    });
    // Fallback: no quedar oculto si ready-to-show tarda
    setTimeout(() => {
        if (!win.isDestroyed() && !win.isVisible())
            win.show();
    }, 400);
    win.on('closed', () => {
        toolWindows.delete(toolId);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tool-window-closed', toolId);
        }
    });
    const query = `?undock=${encodeURIComponent(toolId)}`;
    if (process.env.VITE_DEV_SERVER_URL) {
        yield win.loadURL(`${process.env.VITE_DEV_SERVER_URL}${query}`);
    }
    else {
        yield win.loadFile(path.join(__dirname, '../dist/index.html'), {
            query: { undock: toolId },
        });
    }
    return { success: true };
}));
ipcMain.handle('tool-window-close', (_event, toolId) => __awaiter(void 0, void 0, void 0, function* () {
    const win = toolWindows.get(toolId);
    if (win && !win.isDestroyed())
        win.close();
    toolWindows.delete(toolId);
}));
// ── Native C++ audio bridge (ADR-0009) ──────────────────────────────────────
const { getNativeAudio, nativeAudioAvailable } = require('./native-audio');
ipcMain.handle('native-audio-available', () => nativeAudioAvailable());
ipcMain.handle('native-audio-initialize', (_e, config) => {
    var _a;
    (_a = getNativeAudio()) === null || _a === void 0 ? void 0 : _a.initialize(config);
});
ipcMain.handle('native-audio-shutdown', () => {
    var _a;
    (_a = getNativeAudio()) === null || _a === void 0 ? void 0 : _a.shutdown();
});
ipcMain.handle('native-audio-load-buffer', (_e, id, samples, sampleRate, channels) => {
    var _a;
    (_a = getNativeAudio()) === null || _a === void 0 ? void 0 : _a.loadBuffer(id, samples, sampleRate, channels);
});
ipcMain.handle('native-audio-unload-buffer', (_e, id) => {
    var _a;
    (_a = getNativeAudio()) === null || _a === void 0 ? void 0 : _a.unloadBuffer(id);
});
ipcMain.handle('native-audio-set-graph', (_e, graph) => {
    var _a;
    (_a = getNativeAudio()) === null || _a === void 0 ? void 0 : _a.setGraph(graph);
});
ipcMain.handle('native-audio-play', () => {
    var _a;
    (_a = getNativeAudio()) === null || _a === void 0 ? void 0 : _a.transportPlay();
});
ipcMain.handle('native-audio-pause', () => {
    var _a;
    (_a = getNativeAudio()) === null || _a === void 0 ? void 0 : _a.transportPause();
});
ipcMain.handle('native-audio-stop', () => {
    var _a;
    (_a = getNativeAudio()) === null || _a === void 0 ? void 0 : _a.transportStop();
});
ipcMain.handle('native-audio-seek', (_e, seconds) => {
    var _a;
    (_a = getNativeAudio()) === null || _a === void 0 ? void 0 : _a.transportSeek(seconds);
});
ipcMain.handle('native-audio-playhead', () => { var _a, _b; return (_b = (_a = getNativeAudio()) === null || _a === void 0 ? void 0 : _a.getPlayheadSeconds()) !== null && _b !== void 0 ? _b : 0; });
ipcMain.handle('native-audio-is-playing', () => { var _a, _b; return (_b = (_a = getNativeAudio()) === null || _a === void 0 ? void 0 : _a.isPlaying()) !== null && _b !== void 0 ? _b : false; });
ipcMain.handle('native-audio-meter', () => { var _a, _b; return (_b = (_a = getNativeAudio()) === null || _a === void 0 ? void 0 : _a.getMeterPeak()) !== null && _b !== void 0 ? _b : 0; });
// Plugin host híbrido (ADR-0011 C)
const { ensurePluginHostStarted, getPluginHostStatus, sendPluginHostCommand, stopPluginHost, } = require('./plugin-host-bridge');
ipcMain.handle('plugin-host-status', () => __awaiter(void 0, void 0, void 0, function* () {
    yield ensurePluginHostStarted();
    return getPluginHostStatus();
}));
ipcMain.handle('plugin-host-ensure', () => __awaiter(void 0, void 0, void 0, function* () {
    const ok = yield ensurePluginHostStarted();
    return Object.assign({ ok }, getPluginHostStatus());
}));
ipcMain.handle('plugin-host-send', (e, cmd) => __awaiter(void 0, void 0, void 0, function* () {
    const record = (cmd && typeof cmd === 'object' ? cmd : {});
    const type = typeof record.type === 'string' ? record.type : '';
    yield ensurePluginHostStarted();
    if (type === 'openEditor' || type === 'setEditorBounds') {
        const win = BrowserWindow.fromWebContents(e.sender);
        if (win && !win.isDestroyed()) {
            try {
                const buf = win.getNativeWindowHandle();
                const hwnd = buf.length >= 8 ? buf.readBigUInt64LE(0).toString() : String(buf.readUInt32LE(0));
                if (!record.parentHwnd)
                    record.parentHwnd = hwnd;
                // x/y vienen de getBoundingClientRect (client del webContents).
                // El host nativo hace ClientToScreen(owner) — no sumar frame aquí.
            }
            catch (_a) {
                /* ignore */
            }
        }
    }
    return sendPluginHostCommand(record);
}));
ipcMain.handle('plugin-host-stop', () => {
    stopPluginHost();
    return { ok: true };
});
