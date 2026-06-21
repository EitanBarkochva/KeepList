const http = require("http");
const fs = require("fs");
const path = require("path");
const { createStore } = require("./src/dataStore");
const { importGuards } = require("./src/guardImport");
const { generateSchedule, createNotifications } = require("./src/scheduler");

const PORT = Number(process.env.KEEPLIST_PORT || (process.env.NODE_ENV === "production" ? process.env.PORT : "") || 3000);
const publicDir = path.join(__dirname, "public");
const store = createStore(path.join(__dirname, "data", "db.json"));

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const safePath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(publicDir, safePath));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream"
    });
    res.end(content);
  });
}

function requireAdmin(req, db) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const session = db.sessions.find((item) => item.token === token);
  return session && db.users.some((user) => user.id === session.userId && user.role === "admin");
}

function requireSession(req, db) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const session = db.sessions.find((item) => item.token === token);
  if (!session) return null;
  return db.users.find((user) => user.id === session.userId) || null;
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;

  try {
    const db = store.read();

    if (method === "POST" && url.pathname === "/api/login") {
      const body = await readBody(req);
      const user = db.users.find((item) => {
        if (body.role === "admin") return item.role === "admin" && body.password === db.adminPassword;
        return item.role === "guard" && item.accessCode === body.accessCode && item.isActive;
      });

      if (!user) return sendJson(res, 401, { error: "פרטי הכניסה אינם תקינים" });
      const token = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      store.update((draft) => {
        draft.sessions = draft.sessions.filter((item) => item.userId !== user.id);
        draft.sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
      });
      return sendJson(res, 200, { token, user: sanitizeUser(user) });
    }

    const currentUser = requireSession(req, db);
    if (!currentUser) return sendJson(res, 401, { error: "נדרשת כניסה למערכת" });
    const isAdmin = currentUser.role === "admin";

    if (method === "GET" && url.pathname === "/api/bootstrap") {
      const freshDb = store.read();
      return sendJson(res, 200, buildBootstrap(freshDb, currentUser));
    }

    if (url.pathname === "/api/users") {
      if (!isAdmin) return sendJson(res, 403, { error: "פעולה לרבש\"צ בלבד" });
      if (method === "GET") return sendJson(res, 200, store.read().users.map(sanitizeUser));
      if (method === "POST") {
        const body = await readBody(req);
        const user = store.insert("users", normalizeUser(body));
        store.audit(currentUser.id, "create_user", "users", user.id);
        return sendJson(res, 201, sanitizeUser(user));
      }
    }

    if (method === "PUT" && url.pathname.startsWith("/api/users/")) {
      if (!isAdmin) return sendJson(res, 403, { error: "פעולה לרבש\"צ בלבד" });
      const id = url.pathname.split("/").pop();
      const body = await readBody(req);
      const user = store.updateById("users", id, normalizeUser(body));
      if (!user) return sendJson(res, 404, { error: "שומר לא נמצא" });
      store.audit(currentUser.id, "update_user", "users", id);
      return sendJson(res, 200, sanitizeUser(user));
    }

    if (method === "POST" && url.pathname === "/api/users/import") {
      if (!isAdmin) return sendJson(res, 403, { error: "פעולה לרבש\"צ בלבד" });
      const body = await readBody(req);
      if (!Array.isArray(body.users)) return sendJson(res, 400, { error: "נדרש מערך שומרים לייבוא" });

      let result;
      store.update((draft) => {
        result = importGuards(draft, body.users, { updateExisting: body.updateExisting !== false });
      });
      store.audit(currentUser.id, "import_users", "users", "bulk");
      return sendJson(res, 200, {
        ...result,
        imported: result.imported.map(sanitizeUser),
        updated: result.updated.map(sanitizeUser)
      });
    }

    if (url.pathname === "/api/settings") {
      if (!isAdmin) return sendJson(res, 403, { error: "פעולה לרבש\"צ בלבד" });
      if (method === "GET") return sendJson(res, 200, store.read().guardSettings);
      if (method === "PUT" || method === "POST") {
        const body = await readBody(req);
        const settings = store.setSettings(normalizeSettings(body));
        store.audit(currentUser.id, "update_settings", "guard_settings", settings.id);
        return sendJson(res, 200, settings);
      }
    }

    if (url.pathname === "/api/constraints") {
      if (!isAdmin) return sendJson(res, 403, { error: "פעולה לרבש\"צ בלבד" });
      if (method === "GET") return sendJson(res, 200, store.read().constraints);
      if (method === "POST") {
        const body = await readBody(req);
        const constraint = store.insert("constraints", normalizeConstraint(body));
        store.audit(currentUser.id, "create_constraint", "constraints", constraint.id);
        return sendJson(res, 201, constraint);
      }
    }

    if (method === "DELETE" && url.pathname.startsWith("/api/constraints/")) {
      if (!isAdmin) return sendJson(res, 403, { error: "פעולה לרבש\"צ בלבד" });
      const id = url.pathname.split("/").pop();
      store.removeById("constraints", id);
      store.audit(currentUser.id, "delete_constraint", "constraints", id);
      return sendJson(res, 204, {});
    }

    if (url.pathname === "/api/positions") {
      if (!isAdmin) return sendJson(res, 403, { error: "פעולה לרבש\"צ בלבד" });
      if (method === "GET") return sendJson(res, 200, store.read().positions);
      if (method === "POST") {
        const body = await readBody(req);
        const position = store.insert("positions", { name: body.name || "עמדה", isActive: body.isActive !== false });
        return sendJson(res, 201, position);
      }
    }

    if (method === "POST" && url.pathname === "/api/schedule/generate") {
      if (!isAdmin) return sendJson(res, 403, { error: "פעולה לרבש\"צ בלבד" });
      const generated = generateSchedule(store.read());
      store.replaceSchedule(generated.shifts, generated.metrics);
      const notifications = createNotifications(store.read().shifts);
      store.replaceNotifications(notifications);
      store.audit(currentUser.id, "generate_schedule", "shifts", "bulk");
      return sendJson(res, 200, { ...generated, notifications });
    }

    if (method === "GET" && url.pathname === "/api/shifts") {
      const freshDb = store.read();
      const shifts = isAdmin
        ? freshDb.shifts
        : freshDb.shifts.filter((shift) => shift.assignedUserId === currentUser.id);
      return sendJson(res, 200, shifts);
    }

    if (method === "PUT" && url.pathname.startsWith("/api/shifts/")) {
      if (!isAdmin) return sendJson(res, 403, { error: "פעולה לרבש\"צ בלבד" });
      const id = url.pathname.split("/").pop();
      const body = await readBody(req);
      const shift = store.updateById("shifts", id, {
        assignedUserId: body.assignedUserId || null,
        status: body.status || "published"
      });
      if (!shift) return sendJson(res, 404, { error: "משמרת לא נמצאה" });
      return sendJson(res, 200, shift);
    }

    if (method === "POST" && url.pathname === "/api/swaps") {
      const body = await readBody(req);
      const freshDb = store.read();
      const shift = freshDb.shifts.find((item) => item.id === body.shiftId);
      if (!shift || shift.assignedUserId !== currentUser.id) {
        return sendJson(res, 400, { error: "אפשר לבקש החלפה רק למשמרת שלך" });
      }
      const swap = store.insert("swapRequests", {
        shiftId: body.shiftId,
        requesterId: currentUser.id,
        targetUserId: body.targetUserId || null,
        status: "open",
        createdAt: new Date().toISOString()
      });
      store.updateById("shifts", body.shiftId, { status: "swap_pending" });
      return sendJson(res, 201, swap);
    }

    if (method === "POST" && url.pathname.match(/^\/api\/swaps\/[^/]+\/accept$/)) {
      const id = url.pathname.split("/")[3];
      const freshDb = store.read();
      const swap = freshDb.swapRequests.find((item) => item.id === id);
      if (!swap || (swap.targetUserId && swap.targetUserId !== currentUser.id)) {
        return sendJson(res, 404, { error: "בקשה לא נמצאה" });
      }
      const updated = store.updateById("swapRequests", id, {
        targetUserId: currentUser.id,
        status: "accepted_by_target"
      });
      return sendJson(res, 200, updated);
    }

    if (method === "POST" && url.pathname.match(/^\/api\/swaps\/[^/]+\/approve$/)) {
      if (!isAdmin) return sendJson(res, 403, { error: "פעולה לרבש\"צ בלבד" });
      const id = url.pathname.split("/")[3];
      const freshDb = store.read();
      const swap = freshDb.swapRequests.find((item) => item.id === id);
      if (!swap || swap.status !== "accepted_by_target" || !swap.targetUserId) {
        return sendJson(res, 400, { error: "אפשר לאשר רק החלפה ששני הצדדים אישרו" });
      }
      store.updateById("shifts", swap.shiftId, {
        assignedUserId: swap.targetUserId,
        status: "published"
      });
      const updated = store.updateById("swapRequests", id, { status: "approved" });
      return sendJson(res, 200, updated);
    }

    if (method === "POST" && url.pathname.match(/^\/api\/swaps\/[^/]+\/reject$/)) {
      const id = url.pathname.split("/")[3];
      const updated = store.updateById("swapRequests", id, { status: "rejected" });
      if (!updated) return sendJson(res, 404, { error: "בקשה לא נמצאה" });
      return sendJson(res, 200, updated);
    }

    if (method === "GET" && url.pathname === "/api/swaps") {
      const freshDb = store.read();
      const swaps = isAdmin
        ? freshDb.swapRequests
        : freshDb.swapRequests.filter((swap) => swap.requesterId === currentUser.id || !swap.targetUserId || swap.targetUserId === currentUser.id);
      return sendJson(res, 200, swaps);
    }

    if (method === "GET" && url.pathname === "/api/notifications") {
      if (!isAdmin) return sendJson(res, 403, { error: "פעולה לרבש\"צ בלבד" });
      return sendJson(res, 200, store.read().notifications);
    }

    sendJson(res, 404, { error: "Endpoint not found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

function sanitizeUser(user) {
  const { accessCode, ...safeUser } = user;
  if (user.role === "guard") safeUser.accessCode = accessCode;
  return safeUser;
}

function normalizeUser(body) {
  return {
    guardNumber: String(body.guardNumber || "").trim(),
    name: String(body.name || "").trim(),
    roleTitle: String(body.roleTitle || "").trim(),
    phone: String(body.phone || "").trim(),
    email: String(body.email || "").trim(),
    role: body.role === "admin" ? "admin" : "guard",
    accessCode: body.accessCode || Math.random().toString(36).slice(2, 8).toUpperCase(),
    isActive: body.isActive !== false,
    targetHours: Number(body.targetHours || 0),
    notes: String(body.notes || "").trim()
  };
}

function normalizeSettings(body) {
  return {
    id: "settings_1",
    periodType: body.periodType || "week",
    startDate: body.startDate,
    endDate: body.endDate,
    dayStartTime: body.dayStartTime || "18:00",
    dayEndTime: body.dayEndTime || "06:00",
    shiftHours: Number(body.shiftHours || 4),
    positionsCount: Number(body.positionsCount || 1)
  };
}

function normalizeConstraint(body) {
  return {
    userId: body.userId,
    type: body.type || "date_block",
    date: body.date || "",
    startTime: body.startTime || "",
    endTime: body.endTime || "",
    reason: body.reason || ""
  };
}

function buildBootstrap(db, currentUser) {
  const users = db.users.map(sanitizeUser);
  return {
    currentUser: sanitizeUser(currentUser),
    users,
    settings: db.guardSettings,
    constraints: db.constraints,
    positions: db.positions,
    shifts: currentUser.role === "admin" ? db.shifts : db.shifts.filter((shift) => shift.assignedUserId === currentUser.id),
    swaps: currentUser.role === "admin"
      ? db.swapRequests
      : db.swapRequests.filter((swap) => swap.requesterId === currentUser.id || !swap.targetUserId || swap.targetUserId === currentUser.id),
    notifications: currentUser.role === "admin" ? db.notifications : [],
    metrics: db.metrics || {}
  };
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) return handleApi(req, res);
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`KeepList is running at http://localhost:${PORT}`);
});
