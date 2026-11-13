'use strict';

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const LARGO_LLAVE = 64;
const COSTO = 16384;

async function hashClave(clave) {
  const sal = crypto.randomBytes(16);
  const llave = await scrypt(String(clave), sal, LARGO_LLAVE, { N: COSTO });
  return `scrypt$${COSTO}$${sal.toString('base64')}$${llave.toString('base64')}`;
}

async function verificarClave(clave, guardada) {
  const partes = String(guardada || '').split('$');
  if (partes.length !== 4 || partes[0] !== 'scrypt') return false;
  const costo = Number(partes[1]);
  const esperada = Buffer.from(partes[3], 'base64');
  if (!Number.isInteger(costo) || costo < 1024 || costo > 1048576 || esperada.length === 0) return false;
  try {
    const llave = await scrypt(String(clave), Buffer.from(partes[2], 'base64'), esperada.length, { N: costo });
    return crypto.timingSafeEqual(llave, esperada);
  } catch (_err) {
    return false;
  }
}

/** Sesiones en memoria: el token es aleatorio y solo viaja en una cookie HttpOnly. */
class Sesiones {
  constructor({ duracionMs = 12 * 60 * 60 * 1000, reloj = Date.now } = {}) {
    this.duracionMs = duracionMs;
    this.reloj = reloj;
    this.mapa = new Map();
  }

  crear(datos) {
    this.limpiarVencidas();
    const token = crypto.randomBytes(32).toString('base64url');
    this.mapa.set(token, { ...datos, vence: this.reloj() + this.duracionMs });
    return token;
  }

  obtener(token) {
    if (!token) return null;
    const sesion = this.mapa.get(token);
    if (!sesion) return null;
    if (sesion.vence <= this.reloj()) {
      this.mapa.delete(token);
      return null;
    }
    return sesion;
  }

  eliminar(token) {
    this.mapa.delete(token);
  }

  limpiarVencidas() {
    const ahora = this.reloj();
    for (const [token, sesion] of this.mapa) {
      if (sesion.vence <= ahora) this.mapa.delete(token);
    }
  }
}

/** Bloquea temporalmente tras varios intentos fallidos de inicio de sesion. */
class Limitador {
  constructor({ maxFallos = 5, bloqueoMs = 15 * 60 * 1000, reloj = Date.now } = {}) {
    this.maxFallos = maxFallos;
    this.bloqueoMs = bloqueoMs;
    this.reloj = reloj;
    this.mapa = new Map();
  }

  bloqueado(llave) {
    const registro = this.mapa.get(llave);
    if (!registro) return false;
    if (registro.hasta && registro.hasta > this.reloj()) return true;
    if (registro.hasta) this.mapa.delete(llave);
    return false;
  }

  fallo(llave) {
    const registro = this.mapa.get(llave) || { fallos: 0, hasta: 0 };
    registro.fallos += 1;
    if (registro.fallos >= this.maxFallos) registro.hasta = this.reloj() + this.bloqueoMs;
    this.mapa.set(llave, registro);
    if (this.mapa.size > 10000) this.mapa.delete(this.mapa.keys().next().value);
  }

  limpiar(llave) {
    this.mapa.delete(llave);
  }
}

module.exports = { hashClave, verificarClave, Sesiones, Limitador };
