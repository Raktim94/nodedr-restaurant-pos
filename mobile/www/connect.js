(function () {
  'use strict';
  var C = window.Capacitor;
  var native = !!(C && C.isNativePlatform && C.isNativePlatform());
  var P = (C && C.Plugins) || {};
  var KEY = 'orderrestro.recent';
  var form = document.getElementById('f');
  var input = document.getElementById('addr');
  var btn = document.getElementById('go');
  var scan = document.getElementById('scan');
  var msg = document.getElementById('msg');
  var list = document.getElementById('recent');

  function say(kind, text) {
    msg.className = 'msg ' + kind;
    msg.textContent = text;
    msg.hidden = !text;
  }

  /** "192.168.1.20" -> http://192.168.1.20:1995 ; "pos.example.com" -> https://pos.example.com */
  function normalize(raw) {
    var v = (raw || '').trim().replace(/\s+/g, '');
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) {
      var host = v.split('/')[0].split(':')[0];
      var lan = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || /\.local$/i.test(host) || host.indexOf('.') === -1;
      v = (lan ? 'http://' : 'https://') + v;
      if (lan && !/^https?:\/\/[^/]+:\d+/.test(v)) v = v.replace(/^(http:\/\/[^/]+)/, '$1:1995');
    }
    return v.replace(/\/+$/, '');
  }

  function recent() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
  }
  function remember(url) {
    var all = [url].concat(recent().filter(function (u) { return u !== url; })).slice(0, 4);
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
  }
  function drawRecent() {
    var all = recent();
    list.innerHTML = '';
    if (!all.length) { list.hidden = true; return; }
    list.hidden = false;
    var h = document.createElement('h2'); h.textContent = 'Recent'; list.appendChild(h);
    all.forEach(function (u) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = u;
      b.addEventListener('click', function () { input.value = u; form.requestSubmit(); });
      list.appendChild(b);
    });
  }

  /** Is this really an OrderRestro server? Uses the native HTTP client, so no CORS. */
  async function check(url) {
    var http = P.CapacitorHttp || (C && C.Plugins && C.Plugins.CapacitorHttp);
    var get = http
      ? function (u) { return http.get({ url: u, connectTimeout: 8000, readTimeout: 8000 }); }
      : function (u) { return fetch(u).then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); }); };
    var r = await get(url + '/api/v1/auth/setup-status');
    if (r.status !== 200 || !r.data || typeof r.data.isSetup !== 'boolean') throw new Error('not-orderrestro');
    return r.data;
  }

  async function connect(url) {
    btn.disabled = true; say('', '');
    try {
      var s = await check(url);
      if (!s.isSetup) { say('bad', 'This server has no restaurant yet. Finish setup in a browser first.'); return; }
      remember(url);
      if (native && P.ServerLink) { await P.ServerLink.connect({ url: url }); }
      else { location.href = url; }
    } catch (e) {
      say('bad', "Couldn't reach an OrderRestro server at " + url + '. Check the address, and that this phone is on the restaurant WiFi (or the server has an https address).');
    } finally { btn.disabled = false; }
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var url = normalize(input.value);
    if (!url) { say('bad', 'Enter the server address, for example 192.168.1.20'); input.focus(); return; }
    input.value = url;
    connect(url);
  });

  // Scan the QR code shown in the app: Settings > Mobile app.
  if (native && P.BarcodeScanner) {
    scan.hidden = false;
    scan.addEventListener('click', async function () {
      try {
        var perm = await P.BarcodeScanner.requestPermissions();
        if (perm.camera !== 'granted' && perm.camera !== 'limited') { say('bad', 'Camera permission is needed to scan. You can type the address instead.'); return; }
        var r = await P.BarcodeScanner.scan({ formats: ['QR_CODE'] });
        var code = r.barcodes && r.barcodes[0] && r.barcodes[0].rawValue;
        if (code) { input.value = normalize(code); connect(input.value); }
      } catch (e) { say('bad', 'Could not scan. You can type the address instead.'); }
    });
  }

  drawRecent();
  if (native && P.ServerLink) {
    P.ServerLink.current().then(function (r) { document.getElementById('ver').textContent = 'Version ' + r.version; }).catch(function () {});
  }
  var qs = new URLSearchParams(location.search);
  if (qs.get('server')) { input.value = qs.get('server'); }
})();
