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
  for (let i = 0; i < a.length; i += 32768) {
    s += String.fromCharCode.apply(null, a.subarray(i, i + 32768));
  }
  return btoa(s);
}
function fromB64(s) {
  const b = atob(s);
  const a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a;
}
function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}
async function derive(password, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    te.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 350000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function encrypt(text, k) {
  const iv = randomBytes(12);
  const out = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    k,
    te.encode(text)
  );
  return { iv: toB64(iv), data: toB64(out) };
}
async function decrypt(payload, k) {
  const out = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(payload.iv) },
    k,
    fromB64(payload.data)
  );
  return td.decode(out);
}
function esc(v) {
  return String(v || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[c]));
}
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => toast("Скопировано"))
      .catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
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
  setTimeout(() => e.remove(), 1650);
}
function resetLock() {
  if (!key) return;
  clearTimeout(lockTimer);
  lockTimer = setTimeout(lock, 5 * 60 * 1000);
}
["click", "keydown", "touchstart"].forEach(n =>
  addEventListener(n, resetLock, { passive: true })
);

async function save() {
  await setVal("vault", await encrypt(JSON.stringify(vault), key));
}
async function createVault(password) {
  if (password.length < 10) throw new Error("Минимум 10 символов.");
  const salt = randomBytes(16);
  key = await derive(password, salt);
  const check = await encrypt("blackbox-ok", key);
  await setVal("config", { salt: toB64(salt), check });
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
  } catch {
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
function appMark() {
  return '<div class="app-mark"><span></span><span></span><span></span><span></span></div>';
}
async function renderAuth() {
  const exists = !!(await getVal("config"));
  app.innerHTML =
    '<main class="auth-page">' +
      '<section class="auth-shell">' +
        '<div class="auth-brand">' +
          appMark() +
          '<div><div class="brand-word">BLACKBOX</div><div class="brand-sub">PRIVATE VAULT</div></div>' +
        '</div>' +
        '<div class="auth-copy">' +
          '<div class="micro-label">' + (exists ? "ЗАЩИЩЕНО" : "ПЕРВЫЙ ЗАПУСК") + '</div>' +
          '<h1>' + (exists ? "Открыть сейф" : "Создать сейф") + '</h1>' +
          '<p>' + (exists
            ? "Мастер-пароль расшифрует данные только на этом устройстве."
            : "Один мастер-пароль защищает логины, пароли, заметки и картинки.") + '</p>' +
        '</div>' +
        '<div class="auth-form">' +
          '<label>Мастер-пароль</label>' +
          '<input id="master" type="password" autocomplete="current-password" placeholder="Введите пароль">' +
          (exists ? "" :
            '<label>Повтори пароль</label>' +
            '<input id="master2" type="password" autocomplete="new-password" placeholder="Ещё раз">') +
          '<button id="go" class="primary wide">' + (exists ? "Открыть" : "Создать сейф") + '</button>' +
          '<div id="err" class="err"></div>' +
        '</div>' +
        '<div class="auth-foot"><i></i><span>AES-256-GCM · локальное хранение</span></div>' +
      '</section>' +
    '</main>';

  const submit = async () => {
    const p = document.getElementById("master").value;
    const err = document.getElementById("err");
    err.textContent = "";
    try {
      if (exists) {
        await unlock(p);
      } else {
        if (p !== document.getElementById("master2").value) {
          throw new Error("Пароли не совпадают.");
        }
        await createVault(p);
      }
    } catch (e) {
      err.textContent = e.message || "Ошибка";
    }
  };

  document.getElementById("go").onclick = submit;
  document.getElementById("master").onkeydown = e => {
    if (e.key === "Enter") submit();
  };
}
function makePassword(len) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*_-+=?";
  const a = new Uint32Array(len || 20);
  crypto.getRandomValues(a);
  return Array.from(a, n => chars[n % chars.length]).join("");
}
function itemIcon(item) {
  const pic = item.images && item.images[0];
  if (pic) return '<img class="entry-icon" src="' + pic + '">';
  return '<div class="entry-icon fallback">' +
    '<span>' + esc(item.title).slice(0, 1).toUpperCase() + '</span>' +
  '</div>';
}
function entryRow(item) {
  return '<article class="entry-row" data-view="' + item.id + '">' +
    '<div class="entry-main">' +
      itemIcon(item) +
      '<div class="entry-copy">' +
        '<b>' + esc(item.title) + '</b>' +
        '<span>' + esc(item.username || item.url || "Без логина") + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="entry-tools">' +
      '<button class="mini-tool" data-copy-user="' + item.id + '" aria-label="Копировать логин">ID</button>' +
      '<button class="mini-tool key-tool" data-copy-pass="' + item.id + '" aria-label="Копировать пароль">••</button>' +
      '<button class="more-tool" data-open="' + item.id + '" aria-label="Открыть">›</button>' +
    '</div>' +
  '</article>';
}
function bindRows() {
  document.querySelectorAll("[data-copy-user]").forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      const x = vault.find(v => v.id === b.dataset.copyUser);
      copyText(x ? x.username || "" : "");
    };
  });
  document.querySelectorAll("[data-copy-pass]").forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      const x = vault.find(v => v.id === b.dataset.copyPass);
      copyText(x ? x.password || "" : "");
    };
  });
  document.querySelectorAll("[data-open]").forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      openViewer(b.dataset.open);
    };
  });
  document.querySelectorAll(".entry-row[data-view]").forEach(row => {
    row.onclick = () => openViewer(row.dataset.view);
  });
}
function renderHome(query) {
  resetLock();
  const q = (query || "").toLowerCase().trim();
  const items = vault.filter(x =>
    [x.title, x.username, x.url, x.notes].join(" ").toLowerCase().includes(q)
  );

  app.innerHTML =
    '<main class="vault-page">' +
      '<header class="topbar">' +
        '<div class="topbrand">' +
          appMark() +
          '<div><div class="brand-word">BLACKBOX</div><div class="brand-sub">' + vault.length + ' ' + pluralRecords(vault.length) + '</div></div>' +
        '</div>' +
        '<button id="lock" class="icon-btn" aria-label="Заблокировать">⌁</button>' +
      '</header>' +

      '<section class="section-head">' +
        '<div><div class="micro-label">СЕЙФ</div><h2>Пароли</h2></div>' +
        '<button id="addTop" class="add-round" aria-label="Добавить">＋</button>' +
      '</section>' +

      '<div class="search-box">' +
        '<span>⌕</span><input id="search" placeholder="Поиск по названию, логину, заметкам" value="' + esc(query || "") + '">' +
      '</div>' +

      '<div class="status-strip">' +
        '<span><i class="status-dot"></i>Зашифровано локально</span>' +
        '<span>автоблокировка 5 мин</span>' +
      '</div>' +

      '<section class="entry-list">' +
        (items.length
          ? items.map(entryRow).join("")
          : '<div class="empty-state">' +
              '<div class="empty-glyph">＋</div>' +
              '<b>' + (q ? "Ничего не найдено" : "Сейф пока пуст") + '</b>' +
              '<span>' + (q ? "Попробуй другой запрос." : "Добавь первую учётную запись.") + '</span>' +
            '</div>') +
      '</section>' +

      '<section class="danger-zone">' +
        '<button id="wipe" class="text-danger">Удалить весь сейф</button>' +
      '</section>' +

      '<nav class="bottom-bar">' +
        '<button id="add" class="nav-action"><span>＋</span><small>Добавить</small></button>' +
        '<button id="gen" class="nav-action"><span>✦</span><small>Пароль</small></button>' +
        '<button id="export" class="nav-action"><span>⇧</span><small>Экспорт</small></button>' +
        '<button id="lockBottom" class="nav-action"><span>⌁</span><small>Закрыть</small></button>' +
      '</nav>' +
    '</main>';

  document.getElementById("add").onclick = () => openEditor();
  document.getElementById("addTop").onclick = () => openEditor();
  document.getElementById("lock").onclick = lock;
  document.getElementById("lockBottom").onclick = lock;
  document.getElementById("gen").onclick = () => {
    const p = makePassword(20);
    copyText(p);
    toast("Новый пароль скопирован");
  };
  document.getElementById("export").onclick = openExport;
  document.getElementById("search").oninput = e => renderHome(e.target.value);
  document.getElementById("wipe").onclick = async () => {
    if (confirm("Удалить весь сейф без возможности восстановления?")) {
      await clearDb();
      lock();
    }
  };
  bindRows();
}
function pluralRecords(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "запись";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "записи";
  return "записей";
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
        const max = 1280;
        const scale = Math.min(1, max / Math.max(w, h));
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.8));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
function modal(html, extraClass) {
  const wrap = document.createElement("div");
  wrap.className = "modal-wrap";
  wrap.innerHTML = '<section class="modal ' + (extraClass || "") + '">' + html + '</section>';
  document.body.appendChild(wrap);
  return wrap;
}
function openEditor(id) {
  const old = id ? vault.find(x => x.id === id) : null;
  let images = old && old.images ? old.images.slice() : [];
  const m = modal(
    '<div class="modal-handle"></div>' +
    '<div class="modal-title"><div><div class="micro-label">' + (old ? "РЕДАКТИРОВАНИЕ" : "НОВАЯ ЗАПИСЬ") + '</div><h3>' + (old ? esc(old.title) : "Добавить пароль") + '</h3></div><button id="close">✕</button></div>' +
    '<label>Название</label><input id="title" value="' + esc(old ? old.title : "") + '" placeholder="Например, Telegram">' +
    '<label>Логин / почта</label><input id="user" value="' + esc(old ? old.username : "") + '" placeholder="name@example.com">' +
    '<label>Пароль</label><div class="pass-row"><input id="pass" type="password" value="' + esc(old ? old.password : "") + '"><button id="make">Создать</button></div>' +
    '<label>Сайт / приложение</label><input id="url" value="' + esc(old ? old.url : "") + '" placeholder="example.com">' +
    '<label>Заметки</label><textarea id="notes" placeholder="Любая дополнительная информация">' + esc(old ? old.notes : "") + '</textarea>' +
    '<div class="field-head"><label>Картинки</label><span>до 8</span></div>' +
    '<input id="files" class="file-input" type="file" accept="image/*" multiple>' +
    '<div id="pics" class="pics"></div>' +
    '<div class="modal-actions">' +
      (old ? '<button id="del" class="danger">Удалить</button>' : '<span></span>') +
      '<button id="save" class="primary">Сохранить</button>' +
    '</div>'
  );

  const drawPics = () => {
    const p = m.querySelector("#pics");
    p.innerHTML = images.map((src, i) =>
      '<div class="pic"><img src="' + src + '"><button data-rm="' + i + '">✕</button></div>'
    ).join("");
    p.querySelectorAll("[data-rm]").forEach(b => {
      b.onclick = () => {
        images.splice(Number(b.dataset.rm), 1);
        drawPics();
      };
    });
  };

  drawPics();
  m.querySelector("#close").onclick = () => m.remove();
  m.querySelector("#make").onclick = () => {
    const p = m.querySelector("#pass");
    p.value = makePassword(20);
    p.type = "text";
  };
  m.querySelector("#files").onchange = async e => {
    for (const f of Array.from(e.target.files).slice(0, 8 - images.length)) {
      images.push(await readImage(f));
    }
    drawPics();
  };
  m.querySelector("#save").onclick = async () => {
    const title = m.querySelector("#title").value.trim();
    if (!title) return toast("Нужно название");
    const item = {
      id: old ? old.id : crypto.randomUUID(),
      title,
      username: m.querySelector("#user").value.trim(),
      password: m.querySelector("#pass").value,
      url: m.querySelector("#url").value.trim(),
      notes: m.querySelector("#notes").value.trim(),
      images,
      updatedAt: Date.now()
    };
    vault = old
      ? vault.map(x => x.id === old.id ? item : x)
      : [item].concat(vault);
    await save();
    m.remove();
    renderHome();
    toast("Сохранено");
  };
  if (old) {
    m.querySelector("#del").onclick = async () => {
      if (confirm("Удалить эту запись?")) {
        vault = vault.filter(x => x.id !== old.id);
        await save();
        m.remove();
        renderHome();
      }
    };
  }
}
function openViewer(id) {
  const x = vault.find(v => v.id === id);
  if (!x) return;
  const m = modal(
    '<div class="modal-handle"></div>' +
    '<div class="viewer-head">' +
      itemIcon(x) +
      '<div><div class="micro-label">ЗАПИСЬ</div><h3>' + esc(x.title) + '</h3><span>' + esc(x.username || x.url || "Без логина") + '</span></div>' +
      '<button id="close" class="close-btn">✕</button>' +
    '</div>' +
    '<div class="detail-grid">' +
      '<div class="detail-card"><span>ЛОГИН</span><b>' + esc(x.username || "—") + '</b><button id="copyUser">Копировать</button></div>' +
      '<div class="detail-card"><span>ПАРОЛЬ</span><b id="shown">••••••••••••</b><div><button id="show">Показать</button><button id="copy">Копировать</button></div></div>' +
    '</div>' +
    (x.url ? '<div class="wide-detail"><span>САЙТ / ПРИЛОЖЕНИЕ</span><b>' + esc(x.url) + '</b></div>' : '') +
    (x.notes ? '<div class="wide-detail"><span>ЗАМЕТКИ</span><b class="pre">' + esc(x.notes) + '</b></div>' : '') +
    ((x.images || []).length
      ? '<div class="gallery-title">Картинки</div><div class="pics viewer-pics">' +
          x.images.map(src => '<div class="pic big"><img src="' + src + '"></div>').join("") +
        '</div>'
      : '') +
    '<div class="viewer-actions"><button id="edit" class="primary wide">Изменить запись</button></div>'
  , "viewer-modal");

  m.querySelector("#close").onclick = () => m.remove();
  m.querySelector("#show").onclick = () => {
    const e = m.querySelector("#shown");
    e.textContent = e.textContent.includes("•") ? (x.password || "—") : "••••••••••••";
  };
  m.querySelector("#copy").onclick = () => copyText(x.password || "");
  m.querySelector("#copyUser").onclick = () => copyText(x.username || "");
  m.querySelector("#edit").onclick = () => {
    m.remove();
    openEditor(id);
  };
}
function csvCell(value) {
  const s = String(value == null ? "" : value).replace(/\r?\n/g, " ");
  return '"' + s.replace(/"/g, '""') + '"';
}
function dateStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function saveFile(fileName, mimeType, text) {
  try {
    if (window.AndroidVault && typeof window.AndroidVault.saveBase64File === "function") {
      window.AndroidVault.saveBase64File(fileName, mimeType, toB64(te.encode(text)));
      return true;
    }
  } catch (e) {
    console.error(e);
  }
  try {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    toast("Не удалось открыть сохранение файла");
    return false;
  }
}
async function exportEncryptedBackup() {
  const config = await getVal("config");
  const encryptedVault = await getVal("vault");
  const payload = {
    format: "blackbox-vault-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    config,
    vault: encryptedVault
  };
  saveFile(
    "Blackbox-Vault-backup-" + dateStamp() + ".bbv",
    "application/json",
    JSON.stringify(payload)
  );
}
function exportCsv() {
  const header = ["Название", "Логин", "Пароль", "Сайт/приложение", "Заметки"];
  const rows = vault.map(x => [
    x.title,
    x.username,
    x.password,
    x.url,
    x.notes
  ]);
  const csv = "\uFEFF" + [header].concat(rows)
    .map(row => row.map(csvCell).join(","))
    .join("\r\n");
  saveFile(
    "Blackbox-Passwords-" + dateStamp() + ".csv",
    "text/csv",
    csv
  );
}
function openExport() {
  const m = modal(
    '<div class="modal-handle"></div>' +
    '<div class="modal-title"><div><div class="micro-label">ВЫГРУЗКА</div><h3>Экспорт сейфа</h3></div><button id="close">✕</button></div>' +
    '<button id="secureExport" class="export-option">' +
      '<span class="export-icon secure">▣</span>' +
      '<div><b>Зашифрованная копия</b><small>.bbv · пароли + заметки + картинки</small></div>' +
      '<i>›</i>' +
    '</button>' +
    '<button id="csvExport" class="export-option danger-export">' +
      '<span class="export-icon plain">TXT</span>' +
      '<div><b>Читаемый список паролей</b><small>.csv · открывается в таблицах и редакторах</small></div>' +
      '<i>›</i>' +
    '</button>' +
    '<div class="export-note"><b>Важно</b><span>CSV не зашифрован. Любой, у кого окажется этот файл, сможет прочитать пароли.</span></div>'
  , "export-modal");

  m.querySelector("#close").onclick = () => m.remove();
  m.querySelector("#secureExport").onclick = async () => {
    await exportEncryptedBackup();
    m.remove();
  };
  m.querySelector("#csvExport").onclick = () => {
    if (confirm("Сохранить все пароли открытым текстом в CSV? Файл не будет зашифрован.")) {
      exportCsv();
      m.remove();
    }
  };
}

renderAuth();