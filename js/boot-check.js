// Aviso si el panel no arranca (por ejemplo, si no carga la librería de Supabase desde la CDN
// o no hay internet). Sin esto la pantalla se quedaría en blanco sin explicación.
// Es un script normal (no módulo) a propósito: así corre aunque el módulo principal falle.
(function () {
  setTimeout(function () {
    if (window.__adminLoaded && window.__adminAuthSeen) return;
    var box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.style.cssText = 'max-width:480px;margin:15vh auto;padding:20px 24px;border:1px solid #e8dcd2;'
      + 'border-radius:12px;background:#fff;font-family:system-ui,sans-serif;color:#24140e;line-height:1.5';
    box.innerHTML = '<strong>El panel no pudo iniciar.</strong><br>'
      + 'Revisa tu conexión a internet y recarga la página. '
      + 'Si sigue igual, abre la consola del navegador (F12) para ver el error.'
      + '<br><br><button type="button" style="padding:8px 14px;border-radius:8px;border:0;'
      + 'background:#a81c21;color:#fff;cursor:pointer" onclick="location.reload()">Recargar</button>';
    document.body.appendChild(box);
  }, 8000);
})();
