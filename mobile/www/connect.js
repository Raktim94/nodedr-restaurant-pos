(function () {
  'use strict';
  var C = window.Capacitor;
  var native = !!(C && C.isNativePlatform && C.isNativePlatform());
  var P = (C && C.Plugins) || {};
  var KEY = 'orderrestro.recent';
  var form = document.getElementById('f');
  var inLocal = document.getElementById('local');
  var inOnline = document.getElementById('online');
  var warned = '';
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
  function normalize(raw, kind) {
    var v = (raw || '').trim().replace(/\s+/g, '');
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) {
      var host = v.split('/')[0].split(':')[0];
      var privateHost = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || /\.(local|lan)$/i.test(host) || host.indexOf('.') === -1;
      // A public domain is https, even when typed in the Local field.
      var lan = kind === 'online' ? false : privateHost;
      v = (lan ? 'http://' : 'https://') + v;
      if (lan && !/^https?:\/\/[^/]+:\d+/.test(v)) v = v.replace(/^(http:\/\/[^/]+)/, '$1:1995');
    }
    return v.replace(/\/+$/, '');
  }

  function recent() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '[]').map(function (x) { return typeof x === 'string' ? { l: isLocal(x) ? x : '', o: isLocal(x) ? '' : x } : x; });
    } catch (e) { return []; }
  }
  function remember(l, o) {
    var all = [{ l: l, o: o }].concat(recent().filter(function (x) { return x.l !== l || x.o !== o; })).slice(0, 4);
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {}
  }
  function drawRecent() {
    var all = recent();
    list.innerHTML = '';
    if (!all.length) { list.hidden = true; return; }
    list.hidden = false;
    var h = document.createElement('h2'); h.textContent = 'Recent'; list.appendChild(h);
    all.forEach(function (x) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = [x.l, x.o].filter(Boolean).join('  +  ');
      b.addEventListener('click', function () { inLocal.value = x.l; inOnline.value = x.o; form.requestSubmit(); });
      list.appendChild(b);
    });
  }

  /** Is this really an OrderRestro server? Uses the native HTTP client, so no CORS. */
  async function check(url) {
    var http = P.CapacitorHttp || (C && C.Plugins && C.Plugins.CapacitorHttp);
    var get = http
      ? function (u) { return http.get({ url: u, connectTimeout: 6000, readTimeout: 6000 }); }
      : function (u) { return fetch(u).then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); }); };
    var r = await get(url + '/api/v1/auth/setup-status');
    if (r.status !== 200 || !r.data || typeof r.data.isSetup !== 'boolean') throw new Error('not-orderrestro');
    return r.data;
  }

  function probe(url) {
    if (!url) return Promise.resolve(null);
    return check(url).then(function (s) { return { ok: true, setup: s.isSetup }; }, function () { return { ok: false }; });
  }

  /** Save one or two addresses of the same restaurant. At least one must answer from here. */
  async function connect(localUrl, onlineUrl) {
    btn.disabled = true; say('', '');
    try {
      var res = await Promise.all([probe(localUrl), probe(onlineUrl)]);
      var l = res[0], o = res[1];
      var reachable = (l && l.ok) || (o && o.ok);
      if (!reachable) {
        say('bad', "Couldn't reach an OrderRestro server at " + [localUrl, onlineUrl].filter(Boolean).join(' or ') + '. Check the address, and that this phone is on the restaurant WiFi (or the server has an https address).');
        return;
      }
      var seen = res.filter(function (x) { return x && x.ok; });
      if (seen.some(function (x) { return !x.setup; })) { say('bad', 'This server has no restaurant yet. Finish setup in a browser first.'); return; }
      // An address that does not answer from here may just be the other network. Warn once, then save.
      var key = localUrl + '|' + onlineUrl;
      var missing = [];
      if (l && !l.ok) missing.push(['local', localUrl]);
      if (o && !o.ok) missing.push(['online', onlineUrl]);
      if (missing.length && warned !== key) {
        warned = key;
        say('bad', "The " + missing[0][0] + " address " + missing[0][1] + " doesn't answer from here. That is fine if it only works on the other network. Check it for typos, then press Connect again to save both.");
        return;
      }
      remember(localUrl, onlineUrl);
      var pick = localUrl && l && l.ok ? localUrl : onlineUrl && o && o.ok ? onlineUrl : localUrl || onlineUrl;
      if (native && P.ServerLink) { await P.ServerLink.connect({ localUrl: localUrl || '', externalUrl: onlineUrl || '' }); }
      else { location.href = pick; }
    } catch (e) {
      say('bad', 'Could not connect. Check the addresses and try again.');
    } finally { btn.disabled = false; }
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var l = normalize(inLocal.value, 'local');
    var o = normalize(inOnline.value, 'online');
    if (!l && !o) { say('bad', 'Enter the server address, for example 192.168.1.20'); inLocal.focus(); return; }
    inLocal.value = l; inOnline.value = o;
    connect(l, o);
  });

  /** An address is local when it only works on the restaurant network. */
  function isLocal(u) {
    var h = (u.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0] || '').toLowerCase();
    return /^(10|127)\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /\.(local|lan)$/.test(h) || h.indexOf('.') === -1;
  }

  // Scan the QR code shown in the app: Settings > Mobile app.
  if (native && P.BarcodeScanner) {
    scan.hidden = false;
    scan.addEventListener('click', async function () {
      try {
        var perm = await P.BarcodeScanner.requestPermissions();
        if (perm.camera !== 'granted' && perm.camera !== 'limited') { say('bad', 'Camera permission is needed to scan. You can type the address instead.'); return; }
        var r = await P.BarcodeScanner.scan({ formats: ['QR_CODE'] });
        var code = r.barcodes && r.barcodes[0] && r.barcodes[0].rawValue;
        if (code) { var u = normalize(code, isLocal(code) ? 'local' : 'online'); if (isLocal(u)) inLocal.value = u; else inOnline.value = u; form.requestSubmit(); }
      } catch (e) { say('bad', 'Could not scan. You can type the address instead.'); }
    });
  }

  drawRecent();
  if (native && P.ServerLink) {
    P.ServerLink.current().then(function (r) {
      // The phone was left in standalone mode: go straight back to the POS.
      if (r.startMode === 'standalone' && !/[?&]stay=1/.test(location.search)) { location.replace('pos/index.html'); return; } document.getElementById('ver').textContent = 'Version ' + r.version; if (r.localUrl && !inLocal.value) inLocal.value = r.localUrl; if (r.externalUrl && !inOnline.value) inOnline.value = r.externalUrl; }).catch(function () {});
  }
  var sa = document.getElementById('standalone');
  if (sa && native && P.ServerLink) {
    sa.hidden = false;
    sa.addEventListener('click', function () { P.ServerLink.setMode({ mode: 'standalone' }); });
  }
  var qs = new URLSearchParams(location.search);
  if (qs.get('server')) { var q = qs.get('server'); if (isLocal(q)) inLocal.value = q; else inOnline.value = q; }
})();
