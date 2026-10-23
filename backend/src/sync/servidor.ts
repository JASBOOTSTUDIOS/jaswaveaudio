import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { Db } from '../db.js';
import type { VerificadorJwt, Identidad } from '../auth/verificador-jwt.js';
import { CIERRE, mensajeCliente, type MensajeServidor } from './protocolo.js';
import { aplicarComando, comandosDesde, rolEnSala } from './salas.js';
import { ErrorApi } from '../http/errores.js';
import { sincronizarUsuario } from '../license/servicio.js';

export type OpcionesSync = {
  db: Db;
  verificar: VerificadorJwt;
  /** Ruta del WebSocket. */
  ruta?: string;
  /** Intervalo de latido (ping) en ms. Por defecto 15 s. */
  intervaloLatidoMs?: number;
  /** Reloj inyectable para pruebas. */
  ahora?: () => number;
};

type Conexion = {
  ws: WebSocket;
  identidad: Identidad;
  /** Id interno de Usuario (no el sub de Supabase): es el que usan membresías y comandos. */
  usuarioId: string;
  expiraEnMs: number;
  salas: Set<string>;
  vivo: boolean;
  temporizadorExpiracion?: NodeJS.Timeout;
};

function enviar(ws: WebSocket, mensaje: MensajeServidor): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(mensaje));
}

/** Extrae el token de la URL (`?token=`), porque los navegadores no permiten cabeceras en WebSocket. */
function tokenDeUrl(req: IncomingMessage, ruta: string): string | null {
  const url = new URL(req.url ?? '/', 'http://local');
  if (url.pathname !== ruta) return null;
  return url.searchParams.get('token');
}

/** Adjunta el servidor de sincronización a un servidor HTTP existente. */
export function adjuntarSync(servidor: HttpServer, opciones: OpcionesSync): WebSocketServer {
  const ruta = opciones.ruta ?? '/sync';
  const intervalo = opciones.intervaloLatidoMs ?? 15_000;
  const ahora = opciones.ahora ?? Date.now;
  const wss = new WebSocketServer({ noServer: true });
  const conexiones = new Set<Conexion>();
  const conexionDe = new WeakMap<WebSocket, Conexion>();

  servidor.on('upgrade', (req, socket, cabeza) => {
    if (!(req.url ?? '').startsWith(ruta)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, cabeza, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    // Los mensajes pueden llegar mientras se verifica el token: se encolan para no perderlos.
    const encolados: RawData[] = [];
    let listo = false;
    const procesar = (conexion: Conexion, dato: RawData) => {
      manejarMensaje(conexion, dato).catch((err) => {
        if (err instanceof ErrorApi) {
          enviar(ws, { tipo: 'error', codigo: err.codigo, mensaje: err.message });
        } else {
          enviar(ws, { tipo: 'error', codigo: 'interno', mensaje: 'error interno' });
        }
      });
    };
    ws.on('message', (dato: RawData) => {
      if (!listo) encolados.push(dato);
      else procesar(conexionDe.get(ws)!, dato);
    });

    const token = tokenDeUrl(req, ruta);
    let identidad: Identidad;
    let expiraEnMs: number;
    try {
      if (!token) throw new Error('sin token');
      identidad = await opciones.verificar(token);
      expiraEnMs = expiracionDelToken(token);
    } catch {
      ws.close(CIERRE.NO_AUTENTICADO, 'no autenticado');
      return;
    }

    const usuario = await sincronizarUsuario(opciones.db, identidad);
    const conexion: Conexion = { ws, identidad, usuarioId: usuario.id, expiraEnMs, salas: new Set(), vivo: true };
    conexiones.add(conexion);
    conexionDe.set(ws, conexion);
    programarExpiracion(conexion);

    ws.on('pong', () => {
      conexion.vivo = true;
    });

    listo = true;
    for (const dato of encolados.splice(0)) procesar(conexion, dato);

    ws.on('close', () => {
      clearTimeout(conexion.temporizadorExpiracion);
      conexiones.delete(conexion);
      conexionDe.delete(ws);
    });
  });

  const manejarMensaje = async (conexion: Conexion, dato: RawData): Promise<void> => {
    let json: unknown;
    try {
      json = JSON.parse(dato.toString());
    } catch {
      throw new ErrorApi(400, 'json_invalido', 'mensaje no es JSON');
    }
    const parseado = mensajeCliente.safeParse(json);
    if (!parseado.success) throw new ErrorApi(400, 'mensaje_invalido', 'mensaje no válido');
    const m = parseado.data;
    const { ws, identidad, usuarioId } = conexion;

    switch (m.tipo) {
      case 'ping':
        enviar(ws, { tipo: 'pong' });
        return;

      case 'auth.refresh': {
        // Renovación sin desconexión: la identidad debe ser la misma persona.
        const nueva = await opciones.verificar(m.token).catch(() => null);
        if (!nueva || nueva.userId !== identidad.userId) {
          ws.close(CIERRE.NO_AUTENTICADO, 'renovación inválida');
          return;
        }
        conexion.identidad = nueva;
        conexion.expiraEnMs = expiracionDelToken(m.token);
        programarExpiracion(conexion);
        enviar(ws, { tipo: 'auth.renovado', expiraEn: new Date(conexion.expiraEnMs).toISOString() });
        return;
      }

      case 'sala.unirse': {
        const rol = await rolEnSala(opciones.db, m.salaId, usuarioId);
        if (!rol) throw new ErrorApi(403, 'no_miembro', 'no eres miembro de la sala');
        conexion.salas.add(m.salaId);
        const pendientes = await comandosDesde(opciones.db, m.salaId, m.desdeSeq);
        enviar(ws, { tipo: 'sala.unido', salaId: m.salaId, rol, ultimoSeq: pendientes.at(-1)?.seq ?? m.desdeSeq });
        for (const c of pendientes) enviar(ws, { tipo: 'comando.aplicado', ...c });
        return;
      }

      case 'comando': {
        if (!conexion.salas.has(m.salaId)) throw new ErrorApi(409, 'no_unido', 'primero únete a la sala');
        const aplicado = await aplicarComando(opciones.db, usuarioId, m);
        const difusion: MensajeServidor = { tipo: 'comando.aplicado', ...aplicado };
        for (const otra of conexiones) {
          if (otra.salas.has(m.salaId)) enviar(otra.ws, difusion);
        }
        return;
      }
    }
  };

  function programarExpiracion(conexion: Conexion): void {
    clearTimeout(conexion.temporizadorExpiracion);
    const restante = conexion.expiraEnMs - ahora();
    if (restante <= 0) {
      conexion.ws.close(CIERRE.NO_AUTENTICADO, 'token expirado');
      return;
    }
    conexion.temporizadorExpiracion = setTimeout(() => {
      conexion.ws.close(CIERRE.NO_AUTENTICADO, 'token expirado');
    }, restante);
  }

  // Latido: cada `intervalo` se envía ping; si el ciclo anterior no recibió pong, se cierra con SIN_LATIDO.
  const latido = setInterval(() => {
    for (const c of conexiones) {
      if (!c.vivo) {
        c.ws.close(CIERRE.SIN_LATIDO, 'sin latido');
        continue;
      }
      c.vivo = false;
      c.ws.ping();
    }
  }, intervalo);
  latido.unref();

  wss.on('close', () => clearInterval(latido));
  return wss;
}

/** Lee `exp` del JWT sin verificar firma (la firma ya la verificó el verificador). */
export function expiracionDelToken(token: string): number {
  const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number };
  if (typeof payload.exp !== 'number') throw new Error('token sin exp');
  return payload.exp * 1000;
}
