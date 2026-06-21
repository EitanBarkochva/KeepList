const state = {
  token: localStorage.getItem("keeplist_token") || "",
  user: null,
  data: null,
  loginRole: "admin",
  activeView: "dashboard"
};

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
      <h2>הוספת שומר</h2>
      <form id="guardForm" class="form-grid">
        <label>שם<input name="name" required></label>
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
      ${table(["שם", "טלפון", "אימייל", "קוד", "שעות יעד", "סטטוס"], guardUsers().map((user) => [
        user.name,
        user.phone,
        user.email,
        user.accessCode || "",
        user.targetHours || 0,
        user.isActive ? badge("פעיל", "ok") : badge("לא פעיל", "danger")
      ]))}
    </article>
  `;
  document.getElementById("guardForm").addEventListener("submit", submitGuard);
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
