(function () {
    'use strict';
    var input = document.getElementById('coupon-image-input');
    var imageButton = document.getElementById('coupon-image-button');
    var cameraButton = document.getElementById('coupon-camera-button');
    var preview = document.getElementById('coupon-preview');
    var video = document.getElementById('coupon-video');
    var codeInput = document.getElementById('coupon-code');
    var result = document.getElementById('coupon-result');
    var message = document.getElementById('coupon-message');
    var redeemButton = document.getElementById('coupon-redeem-button');
    var stream = null;
    var cameraSession = 0;
    var scanBusy = false;
    var currentCoupon = null;

    function csrf() { return document.querySelector('meta[name="csrf-token"]').content; }
    function showMessage(text, kind) { message.textContent = text || ''; message.className = 'coupon-message ' + (kind || ''); }
    function setControls(disabled) { imageButton.disabled = disabled; cameraButton.disabled = disabled; }
    function stopCamera() {
        cameraSession += 1;
        if (stream) { stream.getTracks().forEach(function (track) { track.stop(); }); stream = null; }
        video.pause(); video.srcObject = null; video.hidden = true;
        cameraButton.textContent = 'Cámara';
    }
    function displayCoupon(coupon) {
        currentCoupon = coupon;
        result.hidden = false;
        result.querySelector('[data-field="codigo"]').textContent = coupon.codigo;
        result.querySelector('[data-field="monto"]').textContent = 'S/ ' + coupon.monto;
        result.querySelector('[data-field="fecha_vencimiento"]').textContent = coupon.fecha_vencimiento;
        result.querySelector('[data-field="estado"]').textContent = coupon.estado.replace(/_/g, ' ');
        result.querySelector('[data-field="utilizado_por"]').textContent = coupon.utilizado_por || '—';
        result.querySelector('[data-field="utilizado_en"]').textContent = coupon.utilizado_en || '—';
        result.querySelector('[data-used-details]').hidden = coupon.estado !== 'utilizado';
        redeemButton.hidden = coupon.estado !== 'disponible';
    }
    function lookup(code) {
        code = (code || '').trim();
        if (!code) { showMessage('Escribe un código para consultar.', 'error'); return; }
        showMessage('Consultando cupón…', 'loading');
        fetch('/api/cupon/' + encodeURIComponent(code), { credentials: 'same-origin' })
            .then(function (response) { return response.json().then(function (body) { return { ok: response.ok, body: body }; }); })
            .then(function (response) {
                if (!response.ok) { result.hidden = true; showMessage(response.body.message || 'Cupón no registrado.', 'error'); return; }
                displayCoupon(response.body.coupon); showMessage('Cupón consultado.', 'success');
            }).catch(function () { showMessage('Conexión interrumpida. Inténtalo nuevamente.', 'error'); });
    }
    function scanImage(file) {
        if (!file) return;
        stopCamera(); setControls(true); showMessage('Analizando imagen…', 'loading');
        var objectUrl = URL.createObjectURL(file);
        preview.innerHTML = '';
        var image = document.createElement('img'); image.src = objectUrl; image.alt = 'Imagen seleccionada para lectura'; preview.appendChild(image);
        var form = new FormData(); form.append('imagen', file);
        fetch('/api/escanear', { method: 'POST', headers: { 'X-CSRFToken': csrf() }, body: form, credentials: 'same-origin' })
            .then(function (response) { return response.json().then(function (body) { return { ok: response.ok, body: body }; }); })
            .then(function (response) {
                if (!response.ok) { showMessage(response.body.message || 'No se pudo leer la imagen.', 'error'); return; }
                codeInput.value = response.body.codigo; lookup(response.body.codigo);
            }).catch(function () { showMessage('Conexión interrumpida. Inténtalo nuevamente.', 'error'); })
            .finally(function () { URL.revokeObjectURL(objectUrl); setControls(false); input.value = ''; });
    }
    function scanFrame(sessionId) {
        if (!stream || sessionId !== cameraSession || scanBusy) return;
        scanBusy = true;
        var canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        canvas.toBlob(function (blob) {
            if (!blob || sessionId !== cameraSession) { scanBusy = false; return; }
            var form = new FormData(); form.append('imagen', blob, 'camara.jpg');
            fetch('/api/escanear', { method: 'POST', headers: { 'X-CSRFToken': csrf() }, body: form, credentials: 'same-origin' })
                .then(function (response) { return response.json().then(function (body) { return { ok: response.ok, body: body }; }); })
                .then(function (response) {
                    if (sessionId !== cameraSession) return;
                    if (response.ok) { stopCamera(); codeInput.value = response.body.codigo; lookup(response.body.codigo); }
                }).catch(function () {}).finally(function () {
                    scanBusy = false;
                    if (stream && sessionId === cameraSession) window.setTimeout(function () { scanFrame(sessionId); }, 900);
                });
        }, 'image/jpeg', 0.95);
    }
    imageButton.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () { scanImage(input.files[0]); });
    cameraButton.addEventListener('click', function () {
        if (stream) { stopCamera(); return; }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { showMessage('La cámara requiere HTTPS o localhost. Puedes cargar una imagen.', 'error'); return; }
        navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } })
            .then(function (mediaStream) {
                stream = mediaStream; video.srcObject = stream; video.hidden = false; preview.textContent = 'Apunta al código CODE128…'; cameraButton.textContent = 'Cerrar cámara'; showMessage('Cámara activa. La lectura es automática.', 'loading'); return video.play();
            }).then(function () { scanFrame(cameraSession); })
            .catch(function () { stopCamera(); showMessage('No se pudo acceder a la cámara. Puedes continuar con Cargar imagen.', 'error'); });
    });
    document.getElementById('coupon-lookup-form').addEventListener('submit', function (event) { event.preventDefault(); lookup(codeInput.value); });
    redeemButton.addEventListener('click', function () {
        if (!currentCoupon || currentCoupon.estado !== 'disponible') return;
        if (!window.confirm('El cupón ' + currentCoupon.codigo + ' por S/ ' + currentCoupon.monto + ' quedará utilizado de forma irreversible. ¿Confirmar?')) return;
        redeemButton.disabled = true;
        fetch('/api/canjear', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() }, body: JSON.stringify({ codigo: currentCoupon.codigo }), credentials: 'same-origin' })
            .then(function (response) { return response.json().then(function (body) { return { ok: response.ok, body: body }; }); })
            .then(function (response) { if (!response.ok) { showMessage(response.body.message, 'error'); if (response.body.coupon) displayCoupon(response.body.coupon); return; } displayCoupon(response.body.coupon); showMessage('Canje confirmado.', 'success'); })
            .catch(function () { showMessage('Conexión interrumpida. El estado no fue confirmado.', 'error'); })
            .finally(function () { redeemButton.disabled = false; });
    });
    document.querySelectorAll('.coupon-tabs button').forEach(function (tab) {
        tab.addEventListener('click', function () {
            document.querySelectorAll('.coupon-tabs button').forEach(function (item) { item.classList.toggle('is-active', item === tab); });
            document.querySelectorAll('[data-panel]').forEach(function (panel) { panel.hidden = panel.dataset.panel !== tab.dataset.tab; });
        });
    });
    function submitAdminForm(form, endpoint) {
        form.addEventListener('submit', function (event) {
            event.preventDefault(); var data = Object.fromEntries(new FormData(form).entries());
            fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() }, body: JSON.stringify(data), credentials: 'same-origin' })
                .then(function (response) { return response.json().then(function (body) { return { ok: response.ok, body: body }; }); })
                .then(function (response) {
                    if (!response.ok) { showMessage(response.body.message || 'No se pudo completar la operación.', 'error'); return; }
                    showMessage('Operación completada.', 'success');
                    if (response.body.cupones) {
                        var output = document.getElementById('coupon-generated'); output.innerHTML = '';
                        response.body.cupones.forEach(function (item) { var row = document.createElement('div'); row.className = 'generated-coupon'; row.innerHTML = '<strong></strong><svg></svg><button type="button">Descargar PNG</button>'; row.querySelector('strong').textContent = item.codigo; output.appendChild(row); if (window.JsBarcode) window.JsBarcode(row.querySelector('svg'), item.codigo, { format: 'CODE128', width: 2, height: 64, margin: 10, displayValue: true }); row.querySelector('button').addEventListener('click', function () { var svg = row.querySelector('svg'); var data = new XMLSerializer().serializeToString(svg); var svgBlob = new Blob([data], { type: 'image/svg+xml' }); var url = URL.createObjectURL(svgBlob); var image = new Image(); image.onload = function () { var canvas = document.createElement('canvas'); canvas.width = image.width * 3; canvas.height = image.height * 3; var context = canvas.getContext('2d'); context.scale(3, 3); context.drawImage(image, 0, 0); URL.revokeObjectURL(url); var link = document.createElement('a'); link.href = canvas.toDataURL('image/png'); link.download = item.codigo + '.png'; link.click(); }; image.src = url; }); });
                        var downloadAll = document.createElement('button'); downloadAll.type = 'button'; downloadAll.textContent = 'Descargar todos PNG'; downloadAll.addEventListener('click', function () { output.querySelectorAll('.generated-coupon button').forEach(function (button, index) { window.setTimeout(function () { button.click(); }, index * 250); }); }); output.appendChild(downloadAll);
                        var printButton = document.createElement('button'); printButton.type = 'button'; printButton.textContent = 'Imprimir códigos'; printButton.addEventListener('click', function () { window.print(); }); output.appendChild(printButton);
                    }
                    form.reset();
                }).catch(function () { showMessage('Conexión interrumpida.', 'error'); });
        });
    }
    submitAdminForm(document.getElementById('coupon-generate-form'), '/api/crear');
    submitAdminForm(document.getElementById('coupon-register-form'), '/api/registrar');
    document.addEventListener('visibilitychange', function () { if (document.hidden) stopCamera(); });
    window.addEventListener('pagehide', stopCamera);
})();
