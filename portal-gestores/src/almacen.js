'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Guarda lo que el administrador cambia desde el portal (usuarios, metas,
 * apariencia) en una carpeta con disco persistente.
 *
 * Sin carpeta configurada el almacen es de solo lectura: el portal funciona
 * con lo definido en variables de entorno y rechaza los cambios, en vez de
 * aceptarlos y perderlos en el siguiente reinicio.
 */
function crearAlmacen(dir) {
  const editable = Boolean(dir);
  const archivo = editable ? path.join(dir, 'portal.json') : null;
  let datos = { usuarios: null, metas: {}, ajustes: {} };

  if (editable) {
    fs.mkdirSync(dir, { recursive: true });
    try {
      datos = { ...datos, ...JSON.parse(fs.readFileSync(archivo, 'utf8')) };
    } catch (err) {
      // Un archivo dañado no se sobrescribe en silencio: se detiene el arranque.
      if (err.code !== 'ENOENT') throw new Error(`No se pudo leer ${archivo}: ${err.message}`);
    }
  }

  function guardar() {
    const temporal = `${archivo}.tmp`;
    fs.writeFileSync(temporal, `${JSON.stringify(datos, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporal, archivo);
  }

  return {
    editable,
    dir: editable ? dir : null,
    datos: () => datos,
    /** Valores iniciales (de variables de entorno) que no se escriben hasta el primer cambio. */
    sembrar(inicial) {
      if (datos.usuarios === null && Array.isArray(inicial.usuarios)) datos.usuarios = inicial.usuarios;
    },
    cambiar(modificar) {
      if (!editable) {
        throw Object.assign(new Error('El portal no tiene almacenamiento configurado, así que no puede guardar cambios.'), { estado: 409 });
      }
      modificar(datos);
      guardar();
    }
  };
}

module.exports = { crearAlmacen };
