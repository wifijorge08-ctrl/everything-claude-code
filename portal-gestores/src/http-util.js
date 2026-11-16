'use strict';

const LIMITE_JSON = 10 * 1024;

const CABECERAS_SEGURIDAD = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY'
};

function errorHttp(estado, mensaje) {
  return Object.assign(new Error(mensaje), { estado });
}

function leerCookie(req, nombre) {
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const [clave, ...resto] = parte.trim().split('=');
    if (clave === nombre) return resto.join('=');
  }
  return null;
}

function responderJson(res, estado, cuerpo, cabeceras = {}) {
  res.writeHead(estado, {
    ...CABECERAS_SEGURIDAD,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...cabeceras
  });
  res.end(JSON.stringify(cuerpo));
}

function leerCuerpo(req, limite) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const trozos = [];
    req.on('data', trozo => {
      total += trozo.length;
      if (total > limite) {
        reject(errorHttp(413, 'El contenido es demasiado grande.'));
        req.destroy();
        return;
      }
      trozos.push(trozo);
    });
    req.on('end', () => resolve(Buffer.concat(trozos)));
    req.on('error', reject);
  });
}

async function leerCuerpoJson(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    throw errorHttp(415, 'Se esperaba JSON');
  }
  const cuerpo = await leerCuerpo(req, LIMITE_JSON);
  try {
    return JSON.parse(cuerpo.toString('utf8') || '{}');
  } catch (_err) {
    throw errorHttp(400, 'JSON invalido');
  }
}

module.exports = { CABECERAS_SEGURIDAD, errorHttp, leerCookie, responderJson, leerCuerpo, leerCuerpoJson };
