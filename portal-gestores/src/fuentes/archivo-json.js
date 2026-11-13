'use strict';

const fs = require('fs');

/**
 * Fuente de datos basada en un archivo JSON (por ejemplo, una exportacion
 * periodica del sistema de cartera). Se relee cada vez que el archivo cambia.
 */
function crearFuenteArchivo(ruta) {
  let cache = null;
  let ultimaModificacion = -1;

  return {
    nombre: `archivo:${ruta}`,
    async obtenerCartera() {
      const stat = await fs.promises.stat(ruta);
      if (cache && stat.mtimeMs === ultimaModificacion) return cache;
      const datos = JSON.parse(await fs.promises.readFile(ruta, 'utf8'));
      if (!datos || !Array.isArray(datos.creditos)) {
        throw new Error('El archivo de cartera debe tener una lista "creditos"');
      }
      cache = { ...datos, actualizado: datos.actualizado || stat.mtime.toISOString() };
      ultimaModificacion = stat.mtimeMs;
      return cache;
    }
  };
}

module.exports = { crearFuenteArchivo };
