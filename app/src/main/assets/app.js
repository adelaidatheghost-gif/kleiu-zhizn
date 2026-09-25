const app = document.getElementById("app");
const te = new TextEncoder();
const td = new TextDecoder();
const DB = "blackbox-vault-db";
const STORE = "kv";
let key = null;
let vault = [];
let lockTimer = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function getVal(name) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE).objectStore(STORE).get(name);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function setVal(name, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, name);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function clearDb() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
function toB64(buf) {
  const a = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < a.length; i += 32768) s += String.fromCharCode.apply(null, a.subarray(i, i + 32768));
  return btoa(s);
}
function fromB64(s) {
  const b = atob(s);
  const a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a;
}
function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }
async function derive(password, salt) {
  const material = await crypto.subtle.importKey("raw", te.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {name:"PBKDF2", salt:salt, iterations:350000, hash:"SHA-256"},
    material,
    {name:"AES-GCM", length:256},
    false,
    ["encrypt","decrypt"]
  );
}
async function encrypt(text, k) {
  const iv = randomBytes(12);
  const out = await crypto.subtle.encrypt({name:"AES-GCM", iv:iv}, k, te.encode(text));
  return {iv:toB64(iv), data:toB64(out)};
}
async function decrypt(payload, k) {
  const out = await crypto.subtle.decrypt({name:"AES-GCM", iv:fromB64(payload.iv)}, k, fromB64(payload.data));
  return td.decode(out);
}
function esc(v) {
  return String(v || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast("Скопировано")).catch(() => fallbackCopy(text));
  } else fallbackCopy(text);
}
function fallbackCopy(text) {
  const t = document.createElement("textarea");
  t.value = text;
  t.style.position = "fixed";
  t.style.opacity = "0";
  document.body.appendChild(t);
  t.select();
  document.execCommand("copy");
  t.remove();
  toast("Скопировано");
}
function toast(text) {
  const e = document.createElement("div");
  e.className = "toast";
  e.textContent = text;
  document.body.appendChild(e);
  setTimeout(() => e.remove(), 1600);
}
function resetLock() {
  if (!key) return;
  clearTimeout(lockTimer);
  lockTimer = setTimeout(lock, 5 * 60 * 1000);
}
["click","keydown","touchstart"].forEach(n => addEventListener(n, resetLock, {passive:true}));

async function save() {
  await setVal("vault", await encrypt(JSON.stringify(vault), key));
}
async function createVault(password) {
  if (password.length < 10) throw new Error("Минимум 10 символов.");
  const salt = randomBytes(16);
  key = await derive(password, salt);
  const check = await encrypt("blackbox-ok", key);
  await setVal("config", {salt:toB64(salt), check:check});
  vault = [];
  await save();
  renderHome();
}
async function unlock(password) {
  const cfg = await getVal("config");
  if (!cfg) return renderAuth();
  try {
    const candidate = await derive(password, fromB64(cfg.salt));
    if (await decrypt(cfg.check, candidate) !== "blackbox-ok") throw new Error();
    key = candidate;
    const blob = await getVal("vault");
    vault = blob ? JSON.parse(await decrypt(blob, key)) : [];
    renderHome();
  } catch (e) {
    key = null;
    throw new Error("Неверный мастер-пароль.");
  }
}
function lock() {
  key = null;
  vault = [];
  clearTimeout(lockTimer);
  renderAuth();
}

async function renderAuth() {
  const exists = !!(await getVal("config"));
  app.innerHTML =
    '<main class="auth-page"><section class="auth-card">' +
    '<div class="logo">▣</div><div class="eyebrow">BLACKBOX VAULT</div>' +
    '<h1>' + (exists ? "Открыть сейф" : "Создать сейф") + '</h1>' +
    '<p>' + (exists ? "Записи и картинки хранятся локально в зашифрованном виде." : "Придумай мастер-пароль. Без него данные невозможно расшифровать.") + '</p>' +
    '<label>Мастер-пароль</label><input id="master" type="password" placeholder="••••••••••••">' +
    (exists ? "" : '<label>Повтори пароль</label><input id="master2" type="password" placeholder="••••••••••••">') +
    '<button id="go" class="primary">' + (exists ? "Открыть" : "Создать сейф") + '</button>' +
    '<div id="err" class="err"></div></section></main>';
  const submit = async () => {
    const p = document.getElementById("master").value;
    const err = document.getElementById("err");
    err.textContent = "";
    try {
      if (exists) await unlock(p);
      else {
        if (p !== document.getElementById("master2").value) throw new Error("Пароли не совпадают.");
        await createVault(p);
      }
    } catch (e) { err.textContent = e.message || "Ошибка"; }
  };
  document.getElementById("go").onclick = submit;
  document.getElementById("master").onkeydown = e => { if (e.key === "Enter") submit(); };
}
function makePassword(len) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*_-+=?";
  const a = new Uint32Array(len || 20);
  crypto.getRandomValues(a);
  return Array.from(a, n => chars[n % chars.length]).join("");
}
function card(item) {
  const pic = item.images && item.images[0];
  return '<article class="card">' +
    '<div class="card-head">' +
      (pic ? '<img class="thumb" src="' + pic + '">' : '<div class="thumb letter">' + esc(item.title).slice(0,1).toUpperCase() + '</div>') +
      '<div class="card-name"><b>' + esc(item.title) + '</b><span>' + esc(item.username || item.url || "Без логина") + '</span></div>' +
    '</div>' +
    '<div class="dots">••••••••••••</div>' +
    '<div class="actions">' +
      '<button data-copy-user="' + item.id + '">Логин</button>' +
      '<button data-copy-pass="' + item.id + '">Пароль</button>' +
      '<button data-view="' + item.id + '">Открыть</button>' +
    '</div></article>';
}
function bindCards() {
  document.querySelectorAll("[data-copy-user]").forEach(b => b.onclick = () => {
    const x = vault.find(v => v.id === b.dataset.copyUser); copyText(x ? x.username || "" : "");
  });
  document.querySelectorAll("[data-copy-pass]").forEach(b => b.onclick = () => {
    const x = vault.find(v => v.id === b.dataset.copyPass); copyText(x ? x.password || "" : "");
  });
  document.querySelectorAll("[data-view]").forEach(b => b.onclick = () => openViewer(b.dataset.view));
}
function renderHome(query) {
  resetLock();
  const q = (query || "").toLowerCase().trim();
  const items = vault.filter(x => [x.title,x.username,x.url,x.notes].join(" ").toLowerCase().includes(q));
  app.innerHTML =
    '<main class="shell"><header><div><div class="eyebrow">BLACKBOX VAULT</div><h2>Твои пароли</h2></div>' +
    '<div class="header-buttons"><button id="gen">⚡</button><button id="lock">🔒</button></div></header>' +
    '<section class="hero"><div><b>Локальный зашифрованный сейф</b><span>AES-256-GCM • без аккаунта • без облака</span></div><button id="add" class="primary">＋ Добавить</button></section>' +
    '<div class="search-row"><input id="search" placeholder="Поиск..." value="' + esc(query || "") + '"><span>' + vault.length + ' записей</span></div>' +
    '<section class="grid">' + (items.length ? items.map(card).join("") : '<div class="empty">Пока пусто. Добавь первую запись.</div>') + '</section>' +
    '<button id="wipe" class="wipe">Удалить весь сейф</button></main>';
  document.getElementById("add").onclick = () => openEditor();
  document.getElementById("lock").onclick = lock;
  document.getElementById("gen").onclick = () => copyText(makePassword(20));
  document.getElementById("search").oninput = e => renderHome(e.target.value);
  document.getElementById("wipe").onclick = async () => {
    if (confirm("Удалить весь сейф без возможности восстановления?")) { await clearDb(); lock(); }
  };
  bindCards();
}
function readImage(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let w = img.width, h = img.height;
        const m = 1280, s = Math.min(1, m / Math.max(w,h));
        w = Math.round(w*s); h = Math.round(h*s);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img,0,0,w,h);
        resolve(c.toDataURL("image/jpeg",0.8));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
function modal(html) {
  const wrap = document.createElement("div");
  wrap.className = "modal-wrap";
  wrap.innerHTML = '<section class="modal">' + html + '</section>';
  document.body.appendChild(wrap);
  return wrap;
}
function openEditor(id) {
  const old = id ? vault.find(x => x.id === id) : null;
  let images = old && old.images ? old.images.slice() : [];
  const m = modal(
    '<div class="modal-title"><h3>' + (old ? "Изменить" : "Новая запись") + '</h3><button id="close">✕</button></div>' +
    '<label>Название</label><input id="title" value="' + esc(old ? old.title : "") + '" placeholder="Telegram">' +
    '<label>Логин / почта</label><input id="user" value="' + esc(old ? old.username : "") + '">' +
    '<label>Пароль</label><div class="pass-row"><input id="pass" type="password" value="' + esc(old ? old.password : "") + '"><button id="make">Создать</button></div>' +
    '<label>Сайт / приложение</label><input id="url" value="' + esc(old ? old.url : "") + '">' +
    '<label>Заметки</label><textarea id="notes">' + esc(old ? old.notes : "") + '</textarea>' +
    '<label>Картинки</label><input id="files" type="file" accept="image/*" multiple>' +
    '<div id="pics" class="pics"></div>' +
    '<div class="modal-actions">' + (old ? '<button id="del" class="danger">Удалить</button>' : '') +
    '<button id="save" class="primary">Сохранить</button></div>'
  );
  const drawPics = () => {
    const p = m.querySelector("#pics");
    p.innerHTML = images.map((src,i) => '<div class="pic"><img src="' + src + '"><button data-rm="' + i + '">✕</button></div>').join("");
    p.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { images.splice(Number(b.dataset.rm),1); drawPics(); });
  };
  drawPics();
  m.querySelector("#close").onclick = () => m.remove();
  m.querySelector("#make").onclick = () => { const p=m.querySelector("#pass"); p.value=makePassword(20); p.type="text"; };
  m.querySelector("#files").onchange = async e => {
    for (const f of Array.from(e.target.files).slice(0, 8-images.length)) images.push(await readImage(f));
    drawPics();
  };
  m.querySelector("#save").onclick = async () => {
    const title = m.querySelector("#title").value.trim();
    if (!title) return toast("Нужно название");
    const item = {
      id: old ? old.id : crypto.randomUUID(),
      title:title,
      username:m.querySelector("#user").value.trim(),
      password:m.querySelector("#pass").value,
      url:m.querySelector("#url").value.trim(),
      notes:m.querySelector("#notes").value.trim(),
      images:images,
      updatedAt:Date.now()
    };
    vault = old ? vault.map(x => x.id === old.id ? item : x) : [item].concat(vault);
    await save(); m.remove(); renderHome(); toast("Сохранено");
  };
  if (old) m.querySelector("#del").onclick = async () => {
    if (confirm("Удалить эту запись?")) { vault = vault.filter(x => x.id !== old.id); await save(); m.remove(); renderHome(); }
  };
}
function openViewer(id) {
  const x = vault.find(v => v.id === id);
  if (!x) return;
  const m = modal(
    '<div class="modal-title"><h3>' + esc(x.title) + '</h3><button id="close">✕</button></div>' +
    '<div class="detail"><span>Логин</span><b>' + esc(x.username || "—") + '</b></div>' +
    '<div class="detail"><span>Пароль</span><b id="shown">••••••••••••</b></div>' +
    '<div class="viewer-actions"><button id="show">Показать</button><button id="copy">Копировать</button><button id="edit">Изменить</button></div>' +
    (x.url ? '<div class="detail"><span>Сайт</span><b>' + esc(x.url) + '</b></div>' : '') +
    (x.notes ? '<div class="detail notes"><span>Заметки</span><b>' + esc(x.notes) + '</b></div>' : '') +
    '<div class="pics">' + ((x.images || []).map(src => '<div class="pic big"><img src="' + src + '"></div>').join("")) + '</div>'
  );
  m.querySelector("#close").onclick = () => m.remove();
  m.querySelector("#show").onclick = () => { const e=m.querySelector("#shown"); e.textContent = e.textContent.indexOf("•") >= 0 ? x.password : "••••••••••••"; };
  m.querySelector("#copy").onclick = () => copyText(x.password || "");
  m.querySelector("#edit").onclick = () => { m.remove(); openEditor(id); };
}

renderAuth();