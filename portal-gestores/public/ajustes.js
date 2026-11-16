/* global document, window */
'use strict';

/** Pantalla de ajustes del administrador y cambio de clave de cualquier usuario. */
(function () {
  const { $, el, dinero, aplicarMarca } = window.Portal;
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const TEMAS = { azul: 'Azul', verde: 'Verde', morado: 'Morado', grafito: 'Grafito' };

  async function pedir(metodo, ruta, cuerpo, tipo) {
    const opciones = { method: metodo };
    if (cuerpo !== undefined) {
      opciones.headers = { 'Content-Type': tipo || 'application/json' };
      opciones.body = tipo ? cuerpo : JSON.stringify(cuerpo);
    }
    const respuesta = await fetch(ruta, opciones);
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(datos.error || 'No se pudo guardar. Intenta de nuevo.');
    return datos;
  }

  function campo(etiqueta, control) {
    const envoltura = el('label', 'campo', el('span', 'campo__etiqueta', etiqueta), control);
    return envoltura;
  }

  function entrada(atributos) {
    const nodo = document.createElement(atributos.opciones ? 'select' : 'input');
    for (const [clave, valor] of Object.entries(atributos)) {
      if (clave === 'opciones') {
        for (const [v, texto] of valor) {
          const opcion = el('option', null, texto);
          opcion.value = v;
          nodo.append(opcion);
        }
      } else if (valor !== undefined && valor !== null) nodo[clave] = valor;
    }
    return nodo;
  }

  /** Envuelve una accion de guardado: muestra el resultado junto al boton. */
  function conResultado(boton, accion) {
    const mensaje = el('span', 'resultado');
    mensaje.setAttribute('role', 'status');
    boton.addEventListener('click', async () => {
      boton.disabled = true;
      mensaje.className = 'resultado';
      mensaje.textContent = 'Guardando…';
      try {
        mensaje.textContent = (await accion()) || 'Guardado.';
        mensaje.className = 'resultado resultado--bien';
      } catch (err) {
        mensaje.textContent = err.message;
        mensaje.className = 'resultado resultado--error';
      } finally {
        boton.disabled = false;
      }
    });
    return el('div', 'formulario__acciones', boton, mensaje);
  }

  function boton(texto, clase) {
    const nodo = el('button', `boton ${clase || ''}`, texto);
    nodo.type = 'button';
    return nodo;
  }

  function seccionMetas(datos, recargar) {
    const entradas = new Map();
    const lista = el('div', 'campos');
    for (const r of datos.rutas) {
      const definida = r.meta && r.meta.definida;
      const control = entrada({
        type: 'number', min: '1', step: '1', inputMode: 'numeric', disabled: !datos.editable,
        value: definida ? String(r.meta.monto) : '',
        placeholder: r.meta ? `Automática: ${dinero(r.meta.monto)}` : 'Sin meta'
      });
      entradas.set(r.id, control);
      lista.append(campo(r.nombre, control));
    }
    const guardar = boton('Guardar metas');
    guardar.disabled = !datos.editable;
    return el('section', 'tarjeta',
      el('h2', null, `Metas de ${MESES[Number(datos.mes.slice(5, 7)) - 1]} de ${datos.mes.slice(0, 4)}`),
      el('p', 'tarjeta__ayuda', 'Escribe el monto que debe cobrar cada cartera este mes. Si dejas una casilla vacía, el portal calcula la meta automáticamente.'),
      lista,
      conResultado(guardar, async () => {
        const metas = {};
        for (const [id, control] of entradas) metas[id] = control.value.trim() === '' ? null : Number(control.value);
        await pedir('PUT', '/api/admin/metas', { metas });
        await recargar();
        return 'Metas guardadas.';
      }));
  }

  function seccionUsuarios(datos, recargar) {
    const nombreRuta = new Map(datos.rutas.map(r => [r.id, r.nombre]));
    const usuario = entrada({ type: 'text', autocapitalize: 'none', autocomplete: 'off', spellcheck: false, disabled: !datos.editable });
    const nombre = entrada({ type: 'text', autocomplete: 'off', disabled: !datos.editable });
    const rol = entrada({ opciones: [['gestor', 'Gestor'], ['admin', 'Administrador']], disabled: !datos.editable });
    const cartera = entrada({ opciones: datos.rutas.map(r => [r.id, r.nombre]), disabled: !datos.editable });
    const clave = entrada({ type: 'password', autocomplete: 'new-password', disabled: !datos.editable, placeholder: 'Mínimo 8 caracteres' });
    const campoCartera = campo('Cartera', cartera);
    rol.addEventListener('change', () => { campoCartera.hidden = rol.value !== 'gestor'; });
    const titulo = el('h3', 'subtitulo', 'Agregar usuario');

    function editar(u) {
      usuario.value = u.usuario;
      nombre.value = u.nombre || '';
      rol.value = u.rol;
      if (u.gestorId) cartera.value = u.gestorId;
      campoCartera.hidden = u.rol !== 'gestor';
      clave.value = '';
      clave.placeholder = 'Déjala vacía para no cambiarla';
      titulo.textContent = `Editar a ${u.usuario}`;
      usuario.focus();
    }

    const cuerpo = el('tbody');
    for (const u of datos.usuarios) {
      const acciones = el('td', 'num');
      if (datos.editable) {
        const cambiar = boton('Editar', 'boton--discreto boton--chico');
        cambiar.addEventListener('click', () => editar(u));
        const borrar = boton('Borrar', 'boton--discreto boton--chico');
        borrar.addEventListener('click', async () => {
          if (!window.confirm(`¿Borrar el usuario ${u.usuario}? Ya no podrá entrar al portal.`)) return;
          try {
            await pedir('DELETE', `/api/admin/usuarios?usuario=${encodeURIComponent(u.usuario)}`);
            await recargar();
          } catch (err) {
            window.alert(err.message);
          }
        });
        acciones.append(cambiar, ' ', borrar);
      }
      cuerpo.append(el('tr', null,
        el('td', null, el('strong', null, u.usuario), el('div', 'tenue celda-sub', u.nombre || '')),
        el('td', null, u.rol === 'admin' ? 'Administrador' : nombreRuta.get(u.gestorId) || 'Cartera no encontrada'),
        acciones));
    }

    const guardar = boton('Guardar usuario');
    guardar.disabled = !datos.editable;
    return el('section', 'tarjeta',
      el('h2', null, 'Usuarios'),
      el('div', 'tabla-scroll', el('table', null,
        el('thead', null, el('tr', null, el('th', null, 'Usuario'), el('th', null, 'Ve'), el('th', 'num', ''))),
        cuerpo)),
      titulo,
      el('div', 'campos', campo('Usuario', usuario), campo('Nombre', nombre), campo('Rol', rol), campoCartera, campo('Clave', clave)),
      conResultado(guardar, async () => {
        await pedir('POST', '/api/admin/usuarios', {
          usuario: usuario.value, nombre: nombre.value, rol: rol.value, gestorId: cartera.value, clave: clave.value || undefined
        });
        await recargar();
        return 'Usuario guardado.';
      }));
  }

  function seccionApariencia(datos, recargar) {
    const nombre = entrada({ type: 'text', maxLength: 40, value: datos.marca.nombre || '', placeholder: 'Portal de gestores', disabled: !datos.editable });
    const tema = entrada({ opciones: datos.temas.map(t => [t, TEMAS[t] || t]), disabled: !datos.editable });
    tema.value = datos.marca.tema;
    const archivo = entrada({ type: 'file', accept: 'image/png,image/jpeg,image/webp', disabled: !datos.editable });
    const ocultas = new Map();
    const lista = el('div', 'casillas');
    for (const r of datos.rutas) {
      const casilla = entrada({ type: 'checkbox', checked: r.oculta, disabled: !datos.editable });
      ocultas.set(r.id, casilla);
      lista.append(el('label', 'casilla', casilla, r.nombre));
    }
    const guardar = boton('Guardar apariencia');
    guardar.disabled = !datos.editable;
    const quitar = boton('Quitar logo', 'boton--discreto');
    quitar.hidden = !datos.marca.logo || !datos.editable;
    quitar.addEventListener('click', async () => {
      try {
        aplicarMarca((await pedir('DELETE', '/api/admin/logo')).marca);
        await recargar();
      } catch (err) {
        window.alert(err.message);
      }
    });
    return el('section', 'tarjeta',
      el('h2', null, 'Apariencia y carteras visibles'),
      el('div', 'campos',
        campo('Nombre que se muestra', nombre),
        campo('Color', tema),
        campo('Logo (PNG, JPG o WebP, hasta 300 KB)', archivo)),
      quitar,
      el('h3', 'subtitulo', 'Carteras que no quieres ver en tu panel'),
      lista,
      conResultado(guardar, async () => {
        const respuesta = await pedir('PUT', '/api/admin/apariencia', {
          nombre: nombre.value,
          tema: tema.value,
          ocultas: [...ocultas].filter(([, casilla]) => casilla.checked).map(([id]) => id)
        });
        let nueva = respuesta.marca;
        if (archivo.files && archivo.files[0]) {
          nueva = (await pedir('PUT', '/api/admin/logo', archivo.files[0], archivo.files[0].type || 'application/octet-stream')).marca;
        }
        aplicarMarca(nueva);
        await recargar();
        return 'Apariencia guardada.';
      }));
  }

  window.Portal.ajustes = async function (contenedor) {
    const recargar = () => window.Portal.ajustes(contenedor);
    let datos;
    try {
      datos = await pedir('GET', '/api/admin/ajustes');
    } catch (err) {
      contenedor.replaceChildren(el('section', 'tarjeta', el('p', 'vacio', err.message)));
      return;
    }
    const aviso = datos.editable
      ? null
      : el('p', 'aviso aviso--info', 'Estos ajustes están en modo de solo lectura porque el servidor no tiene un disco para guardar cambios. Pídele a quien administra el servidor que lo active.');
    contenedor.replaceChildren(...[aviso, seccionMetas(datos, recargar), seccionUsuarios(datos, recargar), seccionApariencia(datos, recargar)].filter(Boolean));
  };

  /* ---------- Cambio de clave propio ---------- */

  const dialogo = $('dialogo-clave');
  $('abrir-clave').addEventListener('click', () => {
    $('form-clave').reset();
    $('error-clave').hidden = true;
    dialogo.showModal();
  });
  $('cancelar-clave').addEventListener('click', () => dialogo.close());
  $('form-clave').addEventListener('submit', async evento => {
    evento.preventDefault();
    const error = $('error-clave');
    error.hidden = true;
    try {
      if ($('clave-nueva').value !== $('clave-repetir').value) throw new Error('Las dos claves nuevas no coinciden.');
      await pedir('POST', '/api/clave', { actual: $('clave-actual').value, nueva: $('clave-nueva').value });
      dialogo.close();
      window.alert('Tu clave se cambió.');
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
})();
