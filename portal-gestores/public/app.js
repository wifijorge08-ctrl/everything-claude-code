/* global document, window, EventSource */
'use strict';

(function () {
  const $ = id => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const RITMOS = {
    cumplida: ['Meta cumplida', 'bien'],
    'al-dia': ['Al ritmo', 'bien'],
    atrasado: ['Por debajo del ritmo', 'alerta']
  };
  const ICONOS = {
    bien: [['circle', { cx: 8, cy: 8, r: 6.4, class: 'ico__fondo' }], ['path', { d: 'M5 8.3l2 2 4-4.4', class: 'ico__trazo' }]],
    alerta: [['path', { d: 'M8 2.4 14.2 13.4H1.8z', class: 'ico__fondo' }], ['path', { d: 'M8 6.6v3M8 11.6v.2', class: 'ico__trazo' }]],
    critico: [['circle', { cx: 8, cy: 8, r: 6.4, class: 'ico__fondo' }], ['path', { d: 'M8 4.8v3.8M8 11v.2', class: 'ico__trazo' }]],
    neutro: [['circle', { cx: 8, cy: 8, r: 4, class: 'ico__fondo' }]]
  };
  const SIMBOLOS = { NIO: 'C$', USD: 'US$', MXN: '$', COP: '$' };
  const formatoMonto = new Intl.NumberFormat('es', { maximumFractionDigits: 0, useGrouping: 'always' });
  const formatoPct = new Intl.NumberFormat('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  let simbolo = '$';
  let eventos = null;

  const dinero = n => `${simbolo}${formatoMonto.format(n || 0)}`;
  const sinDato = n => n === null || n === undefined;
  const pct = n => (sinDato(n) ? 'Sin datos' : `${formatoPct.format(n)} %`);
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  const limitar = n => Math.max(0, Math.min(Number(n) || 0, 100));
  const razon = (parte, total) => (total > 0 ? Math.round((parte / total) * 1000) / 10 : null);

  // Todo el contenido se inserta como texto (nunca como HTML).
  function el(etiqueta, clase, ...hijos) {
    const nodo = document.createElement(etiqueta);
    if (clase) nodo.className = clase;
    for (const hijo of hijos) {
      if (hijo !== null && hijo !== undefined) nodo.append(hijo);
    }
    return nodo;
  }

  function icono(tono) {
    const dibujo = document.createElementNS(SVG, 'svg');
    dibujo.setAttribute('viewBox', '0 0 16 16');
    dibujo.setAttribute('class', 'ico');
    dibujo.setAttribute('aria-hidden', 'true');
    for (const [forma, atributos] of ICONOS[tono] || ICONOS.neutro) {
      const nodo = document.createElementNS(SVG, forma);
      for (const [clave, valor] of Object.entries(atributos)) nodo.setAttribute(clave, valor);
      dibujo.append(nodo);
    }
    return dibujo;
  }

  function insignia(texto, tono) {
    return el('span', `insignia insignia--${tono}`, icono(tono), texto);
  }

  // Cifra grande: el signo % va más pequeño para que el número mande.
  function cifra(valor, clase) {
    if (sinDato(valor)) return el('p', `cifra ${clase || ''}`, 'Sin datos');
    return el('p', `cifra ${clase || ''}`, formatoPct.format(valor), el('span', 'cifra__unidad', '%'));
  }

  function medidor(valor, tono, descripcion, opciones = {}) {
    const relleno = el('div', 'medidor__relleno');
    relleno.style.width = `${limitar(valor)}%`;
    const pista = el('div', `medidor medidor--${tono}${opciones.chico ? ' medidor--chico' : ''}`, relleno);
    pista.setAttribute('role', 'img');
    pista.setAttribute('aria-label', descripcion);
    if (!sinDato(opciones.marca)) {
      const marca = el('div', 'medidor__marca');
      marca.style.left = `${limitar(opciones.marca)}%`;
      pista.append(marca);
    }
    return pista;
  }

  function dato(etiqueta, valor) {
    return el('div', 'dato', el('span', 'dato__etiqueta', etiqueta), el('span', 'dato__valor', valor));
  }

  function fila(etiqueta, valor) {
    return el('div', 'fila', el('span', null, etiqueta), el('strong', 'num', valor));
  }

  function estadoMora(indice) {
    if (sinDato(indice)) return ['Sin cartera', 'neutro'];
    if (indice < 5) return ['Controlada', 'bien'];
    return indice < 10 ? ['En observación', 'alerta'] : ['Alta', 'critico'];
  }

  function tramoDe(dias) {
    if (dias <= 30) return 1;
    if (dias <= 60) return 2;
    return dias <= 90 ? 3 : 4;
  }

  /* ---------- Vista del gestor ---------- */

  function tarjetaMeta(r) {
    const m = r.meta;
    if (!m) {
      return el('section', 'tarjeta',
        el('h2', null, 'Meta del mes'),
        el('p', 'vacio', 'Todavía no hay una meta definida para este mes.'));
    }
    const [texto, tono] = RITMOS[m.ritmo];
    const cumplida = m.ritmo === 'cumplida';
    return el('section', 'tarjeta',
      el('div', 'tarjeta__cabecera', el('h2', null, 'Meta del mes'), insignia(texto, tono)),
      cifra(m.cumplimiento, 'cifra--heroe'),
      el('p', 'cifra-sub', `${dinero(m.recaudado)} cobrados de ${dinero(m.monto)}`),
      medidor(m.cumplimiento, tono, `Avance de la meta: ${pct(m.cumplimiento)}. Esperado a hoy: ${pct(m.avanceEsperado)}.`,
        { marca: m.avanceEsperado }),
      el('div', 'medidor__pie',
        el('span', null, `Esperado al día ${r.dia}: ${dinero(m.esperadoAHoy)}`),
        el('span', null, `Día ${r.dia} de ${r.diasDelMes}`)),
      el('div', 'datos',
        dato(cumplida ? 'Por encima de la meta' : 'Falta por cobrar', dinero(cumplida ? m.recaudado - m.monto : m.faltante)),
        dato('Necesario por día', cumplida ? 'Cumplido' : dinero(m.necesarioPorDia)),
        dato('Días restantes', String(m.diasRestantes))),
      m.origen === 'programado'
        ? el('p', 'tarjeta__nota', `Meta calculada: ${m.porcentajeProgramado || 100} % del cobro programado del mes.`)
        : null);
  }

  function tarjetaRecuperacion(r) {
    const rec = r.recuperacion;
    return el('section', 'tarjeta',
      el('h2', null, 'Recuperación'),
      cifra(rec.porcentaje),
      el('p', 'cifra-sub', rec.aLaFecha ? 'De las cuotas del mes que ya vencieron' : 'De lo que debía cobrarse este mes'),
      medidor(rec.porcentaje, 'acento', `Recuperación: ${pct(rec.porcentaje)}`),
      el('div', 'filas',
        fila(rec.aLaFecha ? 'Cobrado de lo programado' : 'Recaudado', dinero(rec.recaudado)),
        fila(rec.aLaFecha ? 'Programado a la fecha' : 'Por cobrar este mes', dinero(rec.porCobrar)),
        rec.pagos === null ? null : fila('Pagos recibidos', String(rec.pagos))));
  }

  function antiguedad(mora) {
    if (!(mora.saldoVencido > 0)) return [el('p', 'vacio', 'Sin saldo vencido. Toda la cartera está al día.')];
    const barra = el('div', 'segmentos');
    const leyenda = el('div', 'leyenda');
    const partes = [];
    mora.tramos.forEach((t, i) => {
      const detalle = `${t.etiqueta} días: ${dinero(t.monto)} (${pct(razon(t.monto, mora.saldoVencido))}), ${plural(t.clientes, 'cliente', 'clientes')}`;
      partes.push(detalle);
      if (t.monto > 0) {
        const segmento = el('div', `segmento tono-${i + 1}`);
        segmento.style.flex = `${t.monto} 1 0`;
        segmento.title = detalle;
        barra.append(segmento);
      }
      leyenda.append(el('div', 'leyenda__fila',
        el('span', 'leyenda__nombre', el('span', `muestra tono-${i + 1}`), `${t.etiqueta} días`),
        el('span', 'leyenda__clientes', plural(t.clientes, 'cliente', 'clientes')),
        el('span', 'leyenda__monto', dinero(t.monto))));
    });
    barra.setAttribute('role', 'img');
    barra.setAttribute('aria-label', `Saldo vencido por antigüedad. ${partes.join('. ')}.`);
    return [barra, leyenda];
  }

  function tarjetaMora(r) {
    const mora = r.mora;
    const [texto, tono] = estadoMora(mora.indice);
    return el('section', 'tarjeta',
      el('div', 'tarjeta__cabecera', el('h2', null, 'Mora'), insignia(texto, tono)),
      cifra(mora.indice),
      el('p', 'cifra-sub', `${dinero(mora.saldoVencido)} vencidos de ${dinero(mora.saldoTotal)} en cartera`),
      el('div', 'filas', fila('Clientes en mora', `${mora.clientesEnMora} de ${mora.clientesTotal}`)),
      ...antiguedad(mora));
  }

  function tablaMorosos(r) {
    const clientes = r.mora.clientes || [];
    if (clientes.length === 0) return null;
    const cuerpo = el('tbody');
    for (const c of clientes) {
      cuerpo.append(el('tr', null,
        el('td', null, c.cliente),
        el('td', 'num', el('span', 'celda-dias', el('span', `muestra tono-${tramoDe(c.diasMora)}`), plural(c.diasMora, 'día', 'días'))),
        el('td', 'num', dinero(c.saldoVencido))));
    }
    return el('section', 'tarjeta',
      el('h2', null, 'Clientes con más días de mora'),
      el('div', 'tabla-scroll', el('table', null,
        el('thead', null, el('tr', null,
          el('th', null, 'Cliente'), el('th', 'num', 'Atraso'), el('th', 'num', 'Vencido'))),
        cuerpo)));
  }

  function vistaGestor(r) {
    return [tarjetaMeta(r), el('div', 'rejilla', tarjetaRecuperacion(r), tarjetaMora(r)), tablaMorosos(r)];
  }

  /* ---------- Vista del administrador ---------- */

  function totales(equipo) {
    const suma = campo => equipo.reduce((s, g) => s + (campo(g) || 0), 0);
    const meta = suma(g => g.meta && g.meta.monto);
    const cobrado = suma(g => (g.meta ? g.meta.recaudado : g.recuperacion.recaudado));
    const esperado = suma(g => g.meta && g.meta.esperadoAHoy);
    const vencido = suma(g => g.mora.saldoVencido);
    const saldo = suma(g => g.mora.saldoTotal);
    return {
      meta,
      cobrado,
      esperado,
      cumplimiento: razon(cobrado, meta),
      avanceEsperado: razon(esperado, meta),
      recuperacion: razon(suma(g => g.recuperacion.recaudado), suma(g => g.recuperacion.porCobrar)),
      mora: razon(vencido, saldo),
      vencido,
      saldo,
      enMora: suma(g => g.mora.clientesEnMora),
      clientes: suma(g => g.mora.clientesTotal)
    };
  }

  function resumenEquipo(t) {
    const alRitmo = t.cumplimiento !== null && t.cumplimiento >= (t.avanceEsperado || 0);
    const [textoMora, tonoMora] = estadoMora(t.mora);
    return [
      el('section', 'tarjeta',
        el('div', 'tarjeta__cabecera',
          el('h2', null, 'Cobrado en el mes'),
          t.meta > 0 ? insignia(alRitmo ? 'Al ritmo' : 'Por debajo del ritmo', alRitmo ? 'bien' : 'alerta') : null),
        el('p', 'cifra cifra--heroe', dinero(t.cobrado)),
        el('p', 'cifra-sub', t.meta > 0 ? `${pct(t.cumplimiento)} de la meta del equipo, ${dinero(t.meta)}` : 'Sin metas definidas'),
        t.meta > 0
          ? medidor(t.cumplimiento, alRitmo ? 'bien' : 'alerta',
            `Avance del equipo: ${pct(t.cumplimiento)}. Esperado a hoy: ${pct(t.avanceEsperado)}.`, { marca: t.avanceEsperado })
          : null,
        t.meta > 0
          ? el('div', 'medidor__pie',
            el('span', null, `Esperado a hoy: ${dinero(t.esperado)}`),
            el('span', null, `Falta ${dinero(Math.max(t.meta - t.cobrado, 0))}`))
          : null),
      el('div', 'rejilla',
        el('section', 'tarjeta',
          el('h2', null, 'Recuperación del equipo'),
          cifra(t.recuperacion),
          el('p', 'cifra-sub', 'De las cuotas del mes que ya vencieron'),
          medidor(t.recuperacion, 'acento', `Recuperación del equipo: ${pct(t.recuperacion)}`)),
        el('section', 'tarjeta',
          el('div', 'tarjeta__cabecera', el('h2', null, 'Mora del equipo'), insignia(textoMora, tonoMora)),
          cifra(t.mora),
          el('p', 'cifra-sub', `${dinero(t.vencido)} vencidos de ${dinero(t.saldo)}`),
          el('div', 'filas', fila('Clientes en mora', `${t.enMora} de ${t.clientes}`))))
    ];
  }

  function metrica(etiqueta, valor, tono, pie) {
    return el('div', 'metrica',
      el('span', 'metrica__etiqueta', etiqueta),
      el('span', 'metrica__valor', pct(valor)),
      medidor(valor, tono, `${etiqueta}: ${pct(valor)}`, { chico: true }),
      el('p', 'metrica__pie', pie));
  }

  function tarjetaGestor(g) {
    const partes = /^(.*?)\s*\((.*)\)$/.exec(g.nombre);
    const [texto, tono] = g.meta ? RITMOS[g.meta.ritmo] : ['Sin meta', 'neutro'];
    return el('article', 'tarjeta gestor',
      el('div', 'tarjeta__cabecera',
        el('div', null,
          el('h3', null, partes ? partes[1] : g.nombre),
          partes ? el('p', 'gestor__cobrador', partes[2]) : null),
        insignia(texto, tono)),
      el('div', 'gestor__metricas',
        metrica('Meta', g.meta ? g.meta.cumplimiento : null, g.meta ? tono : 'neutro',
          g.meta ? `${dinero(g.meta.recaudado)} de ${dinero(g.meta.monto)}` : 'Sin meta definida'),
        metrica('Recuperación', g.recuperacion.porcentaje, 'acento',
          `${dinero(g.recuperacion.recaudado)} de ${dinero(g.recuperacion.porCobrar)}`),
        metrica('Mora', g.mora.indice, estadoMora(g.mora.indice)[1],
          `${dinero(g.mora.saldoVencido)} vencidos · ${g.mora.clientesEnMora} de ${plural(g.mora.clientesTotal, 'cliente', 'clientes')}`)));
  }

  function vistaAdmin(equipo) {
    if (equipo.length === 0) return [el('section', 'tarjeta', el('p', 'vacio', 'Todavía no hay carteras para mostrar.'))];
    return [
      ...resumenEquipo(totales(equipo)),
      el('h2', 'titulo-seccion', `Gestores (${equipo.length})`),
      el('div', 'gestores', ...equipo.map(tarjetaGestor))
    ];
  }

  /* ---------- Estado general ---------- */

  function pintar(vista) {
    simbolo = SIMBOLOS[vista.moneda] || '$';
    const referencia = vista.tipo === 'admin' ? vista.equipo[0] : vista.resumen;
    const partes = [];
    if (referencia) {
      const [anio, mes] = referencia.mes.split('-');
      const nombreMes = MESES[Number(mes) - 1];
      partes.push(`${nombreMes[0].toUpperCase()}${nombreMes.slice(1)} de ${anio}`, `día ${referencia.dia} de ${referencia.diasDelMes}`);
    }
    if (vista.cartera) partes.push(`cartera ${vista.cartera}`);
    $('periodo').textContent = partes.join(' · ');
    $('empresa').textContent = vista.empresa || '';
    $('empresa').hidden = !vista.empresa;
    const nodos = vista.tipo === 'admin' ? vistaAdmin(vista.equipo) : vistaGestor(vista.resumen);
    $('contenido').replaceChildren(...nodos.filter(Boolean));
    const hora = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('pie').textContent = `Datos actualizados a las ${hora}. La pantalla se actualiza sola.`;
    estado('En vivo', 'bien');
  }

  function estado(texto, tono) {
    $('estado').textContent = texto;
    $('estado').className = `estado estado--${tono}`;
  }

  function mostrarCarga() {
    $('contenido').replaceChildren(
      el('div', 'esqueleto esqueleto--alto'),
      el('div', 'rejilla', el('div', 'esqueleto'), el('div', 'esqueleto')));
    $('periodo').textContent = 'Cargando datos…';
    $('pie').textContent = '';
  }

  function mostrarLogin() {
    if (eventos) eventos.close();
    eventos = null;
    $('vista-panel').hidden = true;
    $('vista-login').hidden = false;
    $('clave').value = '';
  }

  function conectar() {
    if (eventos) eventos.close();
    eventos = new EventSource('/api/eventos');
    eventos.addEventListener('vista', e => pintar(JSON.parse(e.data)));
    eventos.addEventListener('aviso', () => estado('Sin datos, reintentando', 'alerta'));
    eventos.addEventListener('sesion', mostrarLogin);
    eventos.onerror = () => {
      estado('Reconectando', 'alerta');
      // Si la sesion vencio, EventSource no lo distingue: se comprueba aparte.
      fetch('/api/yo').then(r => { if (r.status === 401) mostrarLogin(); }).catch(() => {});
    };
  }

  async function iniciar() {
    let respuesta;
    try {
      respuesta = await fetch('/api/yo');
    } catch (_err) {
      mostrarLogin();
      return;
    }
    if (!respuesta.ok) {
      mostrarLogin();
      return;
    }
    const yo = await respuesta.json();
    const nombres = String(yo.nombre || yo.usuario).trim().split(/\s+/);
    $('saludo').textContent = yo.rol === 'admin' ? 'Panel del equipo' : `Hola, ${nombres[0]}`;
    $('avatar').textContent = nombres.slice(0, 2).map(n => n[0].toUpperCase()).join('');
    $('vista-login').hidden = true;
    $('vista-panel').hidden = false;
    estado('Conectando', 'neutro');
    mostrarCarga();
    conectar();
  }

  $('form-login').addEventListener('submit', async evento => {
    evento.preventDefault();
    const error = $('error-login');
    const boton = $('boton-login');
    error.hidden = true;
    boton.disabled = true;
    boton.textContent = 'Ingresando…';
    try {
      const respuesta = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: $('usuario').value, clave: $('clave').value })
      });
      if (respuesta.ok) {
        await iniciar();
        return;
      }
      const cuerpo = await respuesta.json().catch(() => ({}));
      error.textContent = cuerpo.error || 'No se pudo iniciar sesión.';
    } catch (_err) {
      error.textContent = 'Sin conexión con el servidor.';
    } finally {
      boton.disabled = false;
      boton.textContent = 'Ingresar';
    }
    error.hidden = false;
  });

  $('salir').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    mostrarLogin();
  });

  window.addEventListener('pageshow', iniciar);
})();
