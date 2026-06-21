const state = {
  token: localStorage.getItem("keeplist_token") || "",
  user: null,
  data: null,
  loginRole: "admin",
  activeView: "dashboard"
};

const staticMode = location.hostname.endsWith("github.io");

const views = {
  admin: [
    ["dashboard", "דשבורד"],
    ["guards", "שומרים"],
    ["settings", "הגדרות"],
    ["constraints", "אילוצים"],
    ["schedule", "סידור"],
    ["swaps", "החלפות"]
  ],
  guard: [
    ["guardHome", "המשמרות שלי"],
    ["swaps", "החלפות"]
  ]
};

document.addEventListener("DOMContentLoaded", () => {
  bindLogin();
  document.getElementById("logoutBtn").addEventListener("click", logout);
  if (state.token) bootstrap();
});

function bindLogin() {
  document.querySelectorAll("[data-login-role]").forEach((button) => {
    button.addEventListener("click", () => {
      state.loginRole = button.dataset.loginRole;
      document.querySelectorAll("[data-login-role]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      const label = document.getElementById("loginLabel");
      const secret = document.getElementById("loginSecret");
      label.textContent = state.loginRole === "admin" ? "סיסמת רבש\"צ" : "קוד שומר";
      secret.type = state.loginRole === "admin" ? "password" : "text";
      secret.value = state.loginRole === "admin" ? "1234" : "DAVID1";
    });
  });

  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const secret = document.getElementById("loginSecret").value.trim();
    const payload = state.loginRole === "admin"
      ? { role: "admin", password: secret }
      : { role: "guard", accessCode: secret };
    try {
      const result = await api("/api/login", { method: "POST", body: payload, auth: false });
      state.token = result.token;
      state.user = result.user;
      localStorage.setItem("keeplist_token", state.token);
      document.getElementById("loginError").textContent = "";
      await bootstrap();
    } catch (error) {
      document.getElementById("loginError").textContent = error.message;
    }
  });
}

async function bootstrap() {
  try {
    state.data = await api("/api/bootstrap");
    state.user = state.data.currentUser;
    state.activeView = state.user.role === "admin" ? "dashboard" : "guardHome";
    document.getElementById("loginView").classList.add("hidden");
    document.getElementById("appView").classList.remove("hidden");
    document.getElementById("currentUserName").textContent = state.user.name;
    renderNav();
    render();
  } catch (error) {
    logout();
  }
}

function logout() {
  localStorage.removeItem("keeplist_token");
  state.token = "";
  state.user = null;
  state.data = null;
  document.getElementById("appView").classList.add("hidden");
  document.getElementById("loginView").classList.remove("hidden");
}

function renderNav() {
  const roleViews = views[state.user.role];
  document.getElementById("navTabs").innerHTML = roleViews.map(([id, label]) => (
    `<button type="button" class="${state.activeView === id ? "active" : ""}" data-view="${id}">${label}</button>`
  )).join("");
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      render();
    });
  });
}

function render() {
  document.querySelectorAll(".view-grid").forEach((view) => view.classList.add("hidden"));
  const title = views[state.user.role].find(([id]) => id === state.activeView)?.[1] || "KeepList";
  document.getElementById("pageTitle").textContent = title;
  renderNav();

  if (state.activeView === "dashboard") renderDashboard();
  if (state.activeView === "guards") renderGuards();
  if (state.activeView === "settings") renderSettings();
  if (state.activeView === "constraints") renderConstraints();
  if (state.activeView === "schedule") renderSchedule();
  if (state.activeView === "swaps") renderSwaps();
  if (state.activeView === "guardHome") renderGuardHome();
}

function renderDashboard() {
  const el = showView("adminDashboard");
  const guards = guardUsers();
  const openSwaps = state.data.swaps.filter((swap) => swap.status === "open" || swap.status === "accepted_by_target");
  const unassigned = state.data.shifts.filter((shift) => !shift.assignedUserId);
  el.innerHTML = `
    <article class="panel">
      <h2>תמונת מצב</h2>
      <div class="stats-grid">
        ${stat("שומרים פעילים", guards.filter((user) => user.isActive).length)}
        ${stat("משמרות", state.data.shifts.length)}
        ${stat("בקשות החלפה", openSwaps.length)}
        ${stat("לא משובצות", unassigned.length)}
      </div>
    </article>
    <article class="panel half">
      <h2>שוויוניות</h2>
      ${renderFairness()}
    </article>
    <article class="panel half">
      <h2>תזכורות מתוכננות</h2>
      <div class="stats-grid">
        ${stat("מייל", state.data.notifications.filter((item) => item.channel === "email").length)}
        ${stat("SMS", state.data.notifications.filter((item) => item.channel === "sms").length)}
        ${stat("WhatsApp", state.data.notifications.filter((item) => item.channel === "whatsapp").length)}
      </div>
    </article>
  `;
}

function renderGuards() {
  const el = showView("guardsView");
  el.innerHTML = `
    <article class="panel">
      <h2>ייבוא שומרים מאקסל</h2>
      <div class="import-grid">
        <div>
          <label>קובץ CSV/TSV מאקסל<input id="guardImportFile" type="file" accept=".csv,.tsv,.txt"></label>
          <p class="hint">אפשר גם להעתיק טבלה מאקסל ולהדביק בתיבה. העמודות הנתמכות: מספר שומר, שם מלא, תפקיד, טלפון, אימייל.</p>
        </div>
        <label>הדבקה מטבלת אקסל<textarea id="guardImportText" placeholder="מספר שומר	שם מלא	תפקיד	טלפון	אימייל"></textarea></label>
        <div class="row-actions">
          <button id="importGuardsBtn" class="primary" type="button">ייבוא שומרים</button>
          <button id="clearImportBtn" class="secondary" type="button">ניקוי</button>
          <span id="importResult" class="hint"></span>
        </div>
      </div>
    </article>
    <article class="panel">
      <h2>הוספת שומר</h2>
      <form id="guardForm" class="form-grid">
        <label>מספר שומר<input name="guardNumber"></label>
        <label>שם<input name="name" required></label>
        <label>תפקיד<input name="roleTitle"></label>
        <label>טלפון<input name="phone"></label>
        <label>אימייל<input name="email" type="email"></label>
        <label>מכסת שעות רצויה<input name="targetHours" type="number" min="0" value="8"></label>
        <label>קוד כניסה<input name="accessCode" placeholder="נוצר אוטומטית אם ריק"></label>
        <label>פעיל<select name="isActive"><option value="true">כן</option><option value="false">לא</option></select></label>
        <label>הערות<textarea name="notes"></textarea></label>
        <button class="primary" type="submit">הוספה</button>
      </form>
    </article>
    <article class="panel">
      <h2>שומרים</h2>
      ${table(["מספר", "שם", "תפקיד", "טלפון", "אימייל", "קוד", "שעות יעד", "סטטוס"], guardUsers().map((user) => [
        user.guardNumber || "",
        user.name,
        user.roleTitle || "",
        user.phone,
        user.email,
        user.accessCode || "",
        user.targetHours || 0,
        user.isActive ? badge("פעיל", "ok") : badge("לא פעיל", "danger")
      ]))}
    </article>
  `;
  document.getElementById("guardForm").addEventListener("submit", submitGuard);
  bindGuardImport();
}

function renderSettings() {
  const el = showView("settingsView");
  const settings = state.data.settings;
  el.innerHTML = `
    <article class="panel">
      <h2>הגדרות יצירת סידור</h2>
      <form id="settingsForm" class="form-grid">
        <label>טווח<select name="periodType">
          <option value="week" ${settings.periodType === "week" ? "selected" : ""}>שבוע</option>
          <option value="month" ${settings.periodType === "month" ? "selected" : ""}>חודש</option>
          <option value="custom" ${settings.periodType === "custom" ? "selected" : ""}>מותאם</option>
        </select></label>
        <label>מתאריך<input name="startDate" type="date" value="${settings.startDate}" required></label>
        <label>עד תאריך<input name="endDate" type="date" value="${settings.endDate}" required></label>
        <label>משעה<input name="dayStartTime" type="time" value="${settings.dayStartTime}" required></label>
        <label>עד שעה<input name="dayEndTime" type="time" value="${settings.dayEndTime}" required></label>
        <label>אורך משמרת בשעות<input name="shiftHours" type="number" min="1" max="12" value="${settings.shiftHours}" required></label>
        <label>מספר עמדות<input name="positionsCount" type="number" min="1" max="12" value="${settings.positionsCount}" required></label>
        <button class="primary" type="submit">שמירת הגדרות</button>
      </form>
    </article>
  `;
  document.getElementById("settingsForm").addEventListener("submit", submitSettings);
}

function renderConstraints() {
  const el = showView("constraintsView");
  el.innerHTML = `
    <article class="panel">
      <h2>הוספת אילוץ / בלק ליסט</h2>
      <form id="constraintForm" class="form-grid">
        <label>שומר<select name="userId">${guardUsers().map((user) => `<option value="${user.id}">${user.name}</option>`).join("")}</select></label>
        <label>סוג<select name="type">
          <option value="date_block">לא שומר בתאריך</option>
          <option value="time_block">לא שומר בשעות</option>
          <option value="full_block">לא שומר בכלל</option>
        </select></label>
        <label>תאריך<input name="date" type="date"></label>
        <label>משעה<input name="startTime" type="time"></label>
        <label>עד שעה<input name="endTime" type="time"></label>
        <label>סיבה<input name="reason"></label>
        <button class="primary" type="submit">הוספת אילוץ</button>
      </form>
    </article>
    <article class="panel">
      <h2>אילוצים קיימים</h2>
      ${table(["שומר", "סוג", "תאריך", "שעות", "סיבה", "פעולות"], state.data.constraints.map((item) => [
        userName(item.userId),
        constraintLabel(item.type),
        item.date || "-",
        item.startTime ? `${item.startTime}-${item.endTime}` : "-",
        item.reason || "",
        `<button class="danger" type="button" data-delete-constraint="${item.id}">מחיקה</button>`
      ]))}
    </article>
  `;
  document.getElementById("constraintForm").addEventListener("submit", submitConstraint);
  document.querySelectorAll("[data-delete-constraint]").forEach((button) => {
    button.addEventListener("click", () => deleteConstraint(button.dataset.deleteConstraint));
  });
}

function renderSchedule() {
  const el = showView("scheduleView");
  el.innerHTML = `
    <article class="panel">
      <h2>יצירת רשימת שמירה</h2>
      <div class="row-actions">
        <button id="generateBtn" class="primary" type="button">יצירה אוטומטית</button>
        <span class="badge">פער שוויוניות: ${state.data.metrics?.maxGap || 0} שעות</span>
      </div>
    </article>
    <article class="panel">
      <h2>משמרות</h2>
      ${renderShiftTable(state.data.shifts, true)}
    </article>
  `;
  document.getElementById("generateBtn").addEventListener("click", generateSchedule);
  bindShiftEditors();
}

function renderGuardHome() {
  const el = showView("guardHomeView");
  el.innerHTML = `
    <article class="panel">
      <h2>המשמרות שלי</h2>
      ${renderShiftTable(state.data.shifts, false)}
    </article>
  `;
  bindSwapButtons();
}

function renderSwaps() {
  const el = showView("swapsView");
  el.innerHTML = `
    <article class="panel">
      <h2>בקשות החלפה</h2>
      ${table(["משמרת", "מבקש", "מחליף", "סטטוס", "פעולות"], state.data.swaps.map((swap) => {
        const shift = allShifts().find((item) => item.id === swap.shiftId);
        return [
          shift ? `${shift.date} ${shift.startTime} ${positionName(shift.positionId)}` : swap.shiftId,
          userName(swap.requesterId),
          swap.targetUserId ? userName(swap.targetUserId) : "פתוח",
          swapStatus(swap.status),
          swapActions(swap)
        ];
      }))}
    </article>
  `;
  bindSwapActions();
}

function renderShiftTable(shifts, editable) {
  return table(["תאריך", "שעות", "עמדה", "שומר", "סטטוס", "פעולות"], shifts.map((shift) => [
    shift.date,
    `${shift.startTime}-${shift.endTime}`,
    positionName(shift.positionId),
    editable ? guardSelect(shift) : userName(shift.assignedUserId),
    shift.assignedUserId ? badge(shift.status, shift.status === "swap_pending" ? "warn" : "ok") : badge("לא משובץ", "danger"),
    editable
      ? `<button class="secondary" type="button" data-save-shift="${shift.id}">שמירה</button>`
      : `<button class="secondary" type="button" data-request-swap="${shift.id}">בקשת החלפה</button>`
  ]));
}

function guardSelect(shift) {
  return `<select data-shift-user="${shift.id}">
    <option value="">לא משובץ</option>
    ${guardUsers().map((user) => `<option value="${user.id}" ${shift.assignedUserId === user.id ? "selected" : ""}>${user.name}</option>`).join("")}
  </select>`;
}

function renderFairness() {
  const rows = state.data.metrics?.fairness || [];
  if (!rows.length) return emptyState();
  return table(["שומר", "שעות", "פער מהממוצע"], rows.map((row) => [row.name, row.hours, row.deltaFromAverage]));
}

async function submitGuard(event) {
  event.preventDefault();
  const body = formData(event.target);
  body.isActive = body.isActive === "true";
  body.targetHours = Number(body.targetHours || 0);
  await api("/api/users", { method: "POST", body });
  await refresh("guards");
}

function bindGuardImport() {
  const fileInput = document.getElementById("guardImportFile");
  const textInput = document.getElementById("guardImportText");
  const result = document.getElementById("importResult");

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    textInput.value = await file.text();
    result.textContent = `${file.name} נטען ומוכן לייבוא`;
  });

  document.getElementById("clearImportBtn").addEventListener("click", () => {
    fileInput.value = "";
    textInput.value = "";
    result.textContent = "";
  });

  document.getElementById("importGuardsBtn").addEventListener("click", async () => {
    const rows = parseTabularGuards(textInput.value);
    if (!rows.length) {
      result.textContent = "לא נמצאו שורות לייבוא";
      return;
    }
    const response = await api("/api/users/import", { method: "POST", body: { users: rows } });
    result.textContent = `יובאו ${response.summary.imported}, עודכנו ${response.summary.updated}, דולגו ${response.summary.skipped}`;
    await refresh("guards");
  });
}

function parseTabularGuards(rawText) {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const rows = lines.map((line) => splitDelimitedLine(line, delimiter));
  const header = rows[0].map(normalizeHeader);
  const hasHeader = header.some((cell) => ["guardNumber", "name", "roleTitle", "phone", "email"].includes(cell));
  const defaultHeader = ["guardNumber", "name", "roleTitle", "phone", "email"];
  const keys = hasHeader ? header : defaultHeader;
  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows
    .map((cells) => Object.fromEntries(keys.map((key, index) => [key, cells[index] || ""])))
    .filter((row) => row.name || row.fullName || row["שם מלא"]);
}

function splitDelimitedLine(line, delimiter) {
  if (delimiter === "\t") return line.split("\t").map((cell) => cell.trim());
  const cells = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === "\"") quoted = !quoted;
    else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value) {
  const text = String(value || "").trim().toLowerCase();
  const map = {
    "מספר שומר": "guardNumber",
    "מספר": "guardNumber",
    "guard number": "guardNumber",
    "number": "guardNumber",
    "שם מלא": "name",
    "שם": "name",
    "full name": "name",
    "name": "name",
    "תפקיד": "roleTitle",
    "role": "roleTitle",
    "position": "roleTitle",
    "טלפון": "phone",
    "נייד": "phone",
    "phone": "phone",
    "אימייל": "email",
    "מייל": "email",
    "email": "email",
    "mail": "email"
  };
  return map[text] || text;
}

async function submitSettings(event) {
  event.preventDefault();
  const body = formData(event.target);
  body.shiftHours = Number(body.shiftHours);
  body.positionsCount = Number(body.positionsCount);
  await api("/api/settings", { method: "PUT", body });
  await refresh("settings");
}

async function submitConstraint(event) {
  event.preventDefault();
  await api("/api/constraints", { method: "POST", body: formData(event.target) });
  await refresh("constraints");
}

async function deleteConstraint(id) {
  await api(`/api/constraints/${id}`, { method: "DELETE" });
  await refresh("constraints");
}

async function generateSchedule() {
  await api("/api/schedule/generate", { method: "POST", body: {} });
  await refresh("schedule");
}

function bindShiftEditors() {
  document.querySelectorAll("[data-save-shift]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.saveShift;
      const assignedUserId = document.querySelector(`[data-shift-user="${id}"]`).value || null;
      await api(`/api/shifts/${id}`, { method: "PUT", body: { assignedUserId, status: "published" } });
      await refresh("schedule");
    });
  });
}

function bindSwapButtons() {
  document.querySelectorAll("[data-request-swap]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api("/api/swaps", { method: "POST", body: { shiftId: button.dataset.requestSwap } });
      await refresh("guardHome");
    });
  });
}

function bindSwapActions() {
  document.querySelectorAll("[data-accept-swap]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/swaps/${button.dataset.acceptSwap}/accept`, { method: "POST", body: {} });
      await refresh("swaps");
    });
  });
  document.querySelectorAll("[data-approve-swap]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/swaps/${button.dataset.approveSwap}/approve`, { method: "POST", body: {} });
      await refresh("swaps");
    });
  });
  document.querySelectorAll("[data-reject-swap]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/swaps/${button.dataset.rejectSwap}/reject`, { method: "POST", body: {} });
      await refresh("swaps");
    });
  });
}

function swapActions(swap) {
  const actions = [];
  if (state.user.role === "guard" && swap.requesterId !== state.user.id && swap.status === "open") {
    actions.push(`<button class="secondary" type="button" data-accept-swap="${swap.id}">אני מחליף</button>`);
  }
  if (state.user.role === "admin" && swap.status === "accepted_by_target") {
    actions.push(`<button class="primary" type="button" data-approve-swap="${swap.id}">אישור רבש"צ</button>`);
  }
  if (swap.status === "open" || swap.status === "accepted_by_target") {
    actions.push(`<button class="danger" type="button" data-reject-swap="${swap.id}">דחייה</button>`);
  }
  return `<div class="row-actions">${actions.join("") || "-"}</div>`;
}

async function refresh(view = state.activeView) {
  state.data = await api("/api/bootstrap");
  state.activeView = view;
  render();
}

async function api(path, options = {}) {
  if (staticMode) return localApi(path, options);
  const headers = { "Content-Type": "application/json" };
  if (options.auth !== false && state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || "שגיאה בפעולה");
  }
  if (response.status === 204) return {};
  return response.json();
}

async function localApi(path, options = {}) {
  const db = readLocalDb();
  const method = options.method || "GET";
  const body = options.body || {};
  const currentUser = getLocalCurrentUser(db);

  if (method === "POST" && path === "/api/login") {
    const user = db.users.find((item) => {
      if (body.role === "admin") return item.role === "admin" && body.password === db.adminPassword;
      return item.role === "guard" && item.accessCode === body.accessCode && item.isActive;
    });
    if (!user) throw new Error("פרטי הכניסה אינם תקינים");
    const token = `local_${Date.now()}`;
    db.session = { token, userId: user.id };
    writeLocalDb(db);
    return { token, user: sanitizeLocalUser(user) };
  }

  if (!currentUser) throw new Error("נדרשת כניסה למערכת");
  const isAdmin = currentUser.role === "admin";

  if (method === "GET" && path === "/api/bootstrap") {
    return buildLocalBootstrap(db, currentUser);
  }

  if (path === "/api/users" && method === "POST") {
    requireLocalAdmin(isAdmin);
    const user = normalizeLocalUser(body);
    user.id = localId("u");
    db.users.push(user);
    writeLocalDb(db);
    return sanitizeLocalUser(user);
  }

  if (path === "/api/users/import" && method === "POST") {
    requireLocalAdmin(isAdmin);
    const result = importLocalGuards(db, body.users || []);
    writeLocalDb(db);
    return result;
  }

  if (path === "/api/settings" && (method === "PUT" || method === "POST")) {
    requireLocalAdmin(isAdmin);
    db.settings = {
      id: "settings_1",
      periodType: body.periodType || "week",
      startDate: body.startDate,
      endDate: body.endDate,
      dayStartTime: body.dayStartTime || "18:00",
      dayEndTime: body.dayEndTime || "06:00",
      shiftHours: Number(body.shiftHours || 4),
      positionsCount: Number(body.positionsCount || 1)
    };
    db.positions = Array.from({ length: db.settings.positionsCount }, (_, index) => (
      db.positions[index] || { id: `p_${index + 1}`, name: `עמדה ${index + 1}`, isActive: true }
    ));
    writeLocalDb(db);
    return db.settings;
  }

  if (path === "/api/constraints" && method === "POST") {
    requireLocalAdmin(isAdmin);
    const constraint = { id: localId("c"), ...body };
    db.constraints.push(constraint);
    writeLocalDb(db);
    return constraint;
  }

  if (path.startsWith("/api/constraints/") && method === "DELETE") {
    requireLocalAdmin(isAdmin);
    const id = path.split("/").pop();
    db.constraints = db.constraints.filter((item) => item.id !== id);
    writeLocalDb(db);
    return {};
  }

  if (path === "/api/schedule/generate" && method === "POST") {
    requireLocalAdmin(isAdmin);
    const generated = generateLocalSchedule(db);
    db.shifts = generated.shifts;
    db.metrics = generated.metrics;
    db.notifications = createLocalNotifications(db.shifts);
    db.swaps = [];
    writeLocalDb(db);
    return { ...generated, notifications: db.notifications };
  }

  if (path.startsWith("/api/shifts/") && method === "PUT") {
    requireLocalAdmin(isAdmin);
    const id = path.split("/").pop();
    const shift = db.shifts.find((item) => item.id === id);
    if (!shift) throw new Error("משמרת לא נמצאה");
    shift.assignedUserId = body.assignedUserId || null;
    shift.status = body.status || "published";
    writeLocalDb(db);
    return shift;
  }

  if (path === "/api/swaps" && method === "POST") {
    const shift = db.shifts.find((item) => item.id === body.shiftId);
    if (!shift || shift.assignedUserId !== currentUser.id) throw new Error("אפשר לבקש החלפה רק למשמרת שלך");
    const swap = {
      id: localId("swap"),
      shiftId: body.shiftId,
      requesterId: currentUser.id,
      targetUserId: null,
      status: "open",
      createdAt: new Date().toISOString()
    };
    shift.status = "swap_pending";
    db.swaps.push(swap);
    writeLocalDb(db);
    return swap;
  }

  if (path.match(/^\/api\/swaps\/[^/]+\/accept$/) && method === "POST") {
    const id = path.split("/")[3];
    const swap = db.swaps.find((item) => item.id === id);
    if (!swap) throw new Error("בקשה לא נמצאה");
    swap.targetUserId = currentUser.id;
    swap.status = "accepted_by_target";
    writeLocalDb(db);
    return swap;
  }

  if (path.match(/^\/api\/swaps\/[^/]+\/approve$/) && method === "POST") {
    requireLocalAdmin(isAdmin);
    const id = path.split("/")[3];
    const swap = db.swaps.find((item) => item.id === id);
    if (!swap || swap.status !== "accepted_by_target") throw new Error("אפשר לאשר רק החלפה ששני הצדדים אישרו");
    const shift = db.shifts.find((item) => item.id === swap.shiftId);
    shift.assignedUserId = swap.targetUserId;
    shift.status = "published";
    swap.status = "approved";
    writeLocalDb(db);
    return swap;
  }

  if (path.match(/^\/api\/swaps\/[^/]+\/reject$/) && method === "POST") {
    const id = path.split("/")[3];
    const swap = db.swaps.find((item) => item.id === id);
    if (!swap) throw new Error("בקשה לא נמצאה");
    swap.status = "rejected";
    writeLocalDb(db);
    return swap;
  }

  throw new Error("פעולה לא נתמכת בגרסת GitHub Pages");
}

function readLocalDb() {
  const raw = localStorage.getItem("keeplist_static_db");
  if (raw) return JSON.parse(raw);
  const db = createLocalDefaultDb();
  writeLocalDb(db);
  return db;
}

function writeLocalDb(db) {
  localStorage.setItem("keeplist_static_db", JSON.stringify(db));
}

function getLocalCurrentUser(db) {
  const token = localStorage.getItem("keeplist_token");
  if (!token || db.session?.token !== token) return null;
  return db.users.find((user) => user.id === db.session.userId) || null;
}

function createLocalDefaultDb() {
  const today = new Date();
  const startDate = today.toISOString().slice(0, 10);
  const endDate = new Date(today.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    adminPassword: "1234",
    users: [
      { id: "u_admin", name: "רבש\"צ", phone: "", email: "admin@example.com", role: "admin", accessCode: "ADMIN", isActive: true, targetHours: 0, notes: "" },
      { id: "u_1", guardNumber: "1", name: "דוד כהן", roleTitle: "שומר", phone: "0501111111", email: "david@example.com", role: "guard", accessCode: "DAVID1", isActive: true, targetHours: 8, notes: "" },
      { id: "u_2", guardNumber: "2", name: "משה לוי", roleTitle: "שומר", phone: "0502222222", email: "moshe@example.com", role: "guard", accessCode: "MOSHE2", isActive: true, targetHours: 8, notes: "" },
      { id: "u_3", guardNumber: "3", name: "יוסי ישראלי", roleTitle: "שומר", phone: "0503333333", email: "yossi@example.com", role: "guard", accessCode: "YOSSI3", isActive: true, targetHours: 8, notes: "" }
    ],
    settings: {
      id: "settings_1",
      periodType: "week",
      startDate,
      endDate,
      dayStartTime: "18:00",
      dayEndTime: "06:00",
      shiftHours: 4,
      positionsCount: 1
    },
    constraints: [],
    positions: [{ id: "p_1", name: "שער ראשי", isActive: true }],
    shifts: [],
    swaps: [],
    notifications: [],
    metrics: {},
    session: null
  };
}

function buildLocalBootstrap(db, currentUser) {
  return {
    currentUser: sanitizeLocalUser(currentUser),
    users: db.users.map(sanitizeLocalUser),
    settings: db.settings,
    constraints: db.constraints,
    positions: db.positions,
    shifts: currentUser.role === "admin" ? db.shifts : db.shifts.filter((shift) => shift.assignedUserId === currentUser.id),
    swaps: currentUser.role === "admin" ? db.swaps : db.swaps.filter((swap) => swap.requesterId === currentUser.id || !swap.targetUserId || swap.targetUserId === currentUser.id),
    notifications: currentUser.role === "admin" ? db.notifications : [],
    metrics: db.metrics || {}
  };
}

function sanitizeLocalUser(user) {
  return { ...user };
}

function requireLocalAdmin(isAdmin) {
  if (!isAdmin) throw new Error("פעולה לרבש\"צ בלבד");
}

function normalizeLocalUser(body) {
  return {
    guardNumber: String(body.guardNumber || "").trim(),
    name: String(body.name || "").trim(),
    roleTitle: String(body.roleTitle || "").trim(),
    phone: String(body.phone || "").trim(),
    email: String(body.email || "").trim(),
    role: "guard",
    accessCode: body.accessCode || Math.random().toString(36).slice(2, 8).toUpperCase(),
    isActive: body.isActive !== false,
    targetHours: Number(body.targetHours || 0),
    notes: String(body.notes || "").trim()
  };
}

function importLocalGuards(db, rows) {
  const imported = [];
  const updated = [];
  const skipped = [];
  for (const [index, row] of rows.entries()) {
    const guard = normalizeLocalImportedGuard(row);
    if (!guard.name) {
      skipped.push({ row: index + 1, reason: "missing_name" });
      continue;
    }
    const existing = db.users.find((user) => user.role === "guard" && (
      (guard.guardNumber && user.guardNumber === guard.guardNumber) ||
      (guard.email && user.email?.toLowerCase() === guard.email.toLowerCase()) ||
      (guard.phone && compactLocalPhone(user.phone) === compactLocalPhone(guard.phone))
    ));
    if (existing) {
      Object.assign(existing, guard, { accessCode: guard.accessCode || existing.accessCode, isActive: true });
      updated.push(sanitizeLocalUser(existing));
    } else {
      const created = { id: localId("u"), ...guard, accessCode: guard.accessCode || Math.random().toString(36).slice(2, 8).toUpperCase() };
      db.users.push(created);
      imported.push(sanitizeLocalUser(created));
    }
  }
  return { imported, updated, skipped, summary: { imported: imported.length, updated: updated.length, skipped: skipped.length } };
}

function normalizeLocalImportedGuard(row) {
  const guardNumber = row.guardNumber || row["מספר שומר"] || row["מספר"] || "";
  return {
    guardNumber: String(guardNumber).trim(),
    name: String(row.name || row["שם מלא"] || row["שם"] || "").trim(),
    roleTitle: String(row.roleTitle || row["תפקיד"] || "").trim(),
    phone: String(row.phone || row["טלפון"] || row["נייד"] || "").trim(),
    email: String(row.email || row["אימייל"] || row["מייל"] || "").trim(),
    role: "guard",
    accessCode: String(guardNumber).trim() || undefined,
    isActive: true,
    targetHours: Number(row.targetHours || row["שעות יעד"] || 0),
    notes: String(row.notes || row["הערות"] || "").trim()
  };
}

function compactLocalPhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function generateLocalSchedule(db) {
  const settings = db.settings;
  const guards = db.users.filter((user) => user.role === "guard" && user.isActive);
  const positions = db.positions.filter((position) => position.isActive).slice(0, settings.positionsCount);
  const shifts = [];
  const hoursByUser = Object.fromEntries(guards.map((guard) => [guard.id, 0]));
  let cursor = localAtTime(settings.startDate, settings.dayStartTime);
  const end = localAtTime(settings.endDate, settings.dayEndTime);
  if (end <= cursor) end.setDate(end.getDate() + 1);

  while (cursor < end) {
    const shiftEnd = new Date(cursor.getTime() + settings.shiftHours * 60 * 60 * 1000);
    const date = cursor.toISOString().slice(0, 10);
    const startTime = cursor.toTimeString().slice(0, 5);
    const endTime = shiftEnd.toTimeString().slice(0, 5);
    for (const position of positions) {
      const selected = guards
        .filter((guard) => !localBlocked(guard.id, db.constraints, date, startTime, endTime))
        .sort((a, b) => (hoursByUser[a.id] || 0) - (hoursByUser[b.id] || 0))[0] || null;
      if (selected) hoursByUser[selected.id] += settings.shiftHours;
      shifts.push({
        id: `shift_${date}_${startTime.replace(":", "")}_${position.id}`,
        date,
        startTime,
        endTime,
        positionId: position.id,
        assignedUserId: selected ? selected.id : null,
        status: selected ? "published" : "draft"
      });
    }
    cursor = shiftEnd;
  }
  return { shifts, metrics: buildLocalMetrics(guards, hoursByUser) };
}

function buildLocalMetrics(guards, hoursByUser) {
  const values = Object.values(hoursByUser);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    averageHours: Number(average.toFixed(2)),
    maxGap: values.length ? Math.max(...values) - Math.min(...values) : 0,
    fairness: guards.map((guard) => ({
      userId: guard.id,
      name: guard.name,
      hours: hoursByUser[guard.id] || 0,
      deltaFromAverage: Number(((hoursByUser[guard.id] || 0) - average).toFixed(2))
    })),
    warnings: shiftsWithoutUsersWarning(values)
  };
}

function shiftsWithoutUsersWarning(values) {
  return values.length ? [] : ["לא קיימים שומרים פעילים"];
}

function localBlocked(userId, constraints, date, startTime, endTime) {
  return constraints.some((constraint) => {
    if (constraint.userId !== userId) return false;
    if (constraint.type === "full_block") return true;
    if (constraint.date && constraint.date !== date) return false;
    if (constraint.type === "date_block") return true;
    if (constraint.type === "time_block") return localOverlaps(startTime, endTime, constraint.startTime, constraint.endTime);
    return false;
  });
}

function localOverlaps(startA, endA, startB, endB) {
  const aStart = localMinutes(startA);
  const aEnd = localMinutes(endA);
  const bStart = localMinutes(startB);
  const bEnd = localMinutes(endB);
  return aStart < bEnd && bStart < aEnd;
}

function createLocalNotifications(shifts) {
  const notifications = [];
  for (const shift of shifts) {
    if (!shift.assignedUserId) continue;
    const start = localAtTime(shift.date, shift.startTime);
    notifications.push({ id: `mail_${shift.id}`, shiftId: shift.id, userId: shift.assignedUserId, channel: "email", sendAt: new Date(start.getTime() - 24 * 60 * 60 * 1000).toISOString(), status: "planned" });
    notifications.push({ id: `sms_${shift.id}`, shiftId: shift.id, userId: shift.assignedUserId, channel: "sms", sendAt: new Date(start.getTime() - 5 * 60 * 60 * 1000).toISOString(), status: "planned" });
    notifications.push({ id: `whatsapp_${shift.id}`, shiftId: shift.id, userId: shift.assignedUserId, channel: "whatsapp", sendAt: new Date(start.getTime() - 5 * 60 * 60 * 1000).toISOString(), status: "planned" });
  }
  return notifications;
}

function localAtTime(date, time) {
  const [hours, minutesValue] = time.split(":").map(Number);
  const value = new Date(`${date}T00:00:00`);
  value.setHours(hours, minutesValue, 0, 0);
  return value;
}

function localMinutes(time) {
  const [hours, minutesValue] = time.split(":").map(Number);
  return hours * 60 + minutesValue;
}

function localId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function showView(id) {
  const el = document.getElementById(id);
  el.classList.remove("hidden");
  return el;
}

function stat(label, value) {
  return `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`;
}

function table(headers, rows) {
  if (!rows.length) return emptyState();
  return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function badge(text, type = "") {
  return `<span class="badge ${type}">${text}</span>`;
}

function emptyState() {
  return document.getElementById("emptyStateTemplate").innerHTML;
}

function guardUsers() {
  return state.data.users.filter((user) => user.role === "guard");
}

function allShifts() {
  return state.data.shifts;
}

function userName(id) {
  return state.data.users.find((user) => user.id === id)?.name || "לא משובץ";
}

function positionName(id) {
  return state.data.positions.find((position) => position.id === id)?.name || id;
}

function constraintLabel(type) {
  return {
    full_block: "לא שומר בכלל",
    date_block: "לא שומר בתאריך",
    time_block: "לא שומר בשעות"
  }[type] || type;
}

function swapStatus(status) {
  return {
    open: badge("פתוח", "warn"),
    accepted_by_target: badge("המחליף אישר", "ok"),
    approved: badge("בוצע", "ok"),
    rejected: badge("נדחה", "danger"),
    cancelled: badge("בוטל", "danger")
  }[status] || status;
}
