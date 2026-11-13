#!/usr/bin/env node
'use strict';

/**
 * Lista las rutas de Controla+ con su cobrador y el identificador que se usa
 * como --gestor al crear cada usuario del portal.
 *
 *   CONTROLA_USUARIO=... CONTROLA_CLAVE=... node bin/listar-rutas.js
 */

const { crearFuenteControlaPlus } = require('../src/fuentes/controla-plus');

async function main() {
  const fuente = crearFuenteControlaPlus({
    usuario: process.env.CONTROLA_USUARIO,
    clave: process.env.CONTROLA_CLAVE,
    sucursal: process.env.CONTROLA_SUCURSAL
  });
  const cartera = await fuente.obtenerCartera();
  for (const g of cartera.gestores) {
    const prestamos = cartera.creditos.filter(c => c.gestorId === g.id).length;
    console.log(`${g.id}  ${g.nombre}  (${prestamos} prestamos activos)`);
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
