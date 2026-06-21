const fs = require("fs");
const path = require("path");

const today = new Date();
const isoDate = today.toISOString().slice(0, 10);
const nextWeek = new Date(today.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function createDefaultDb() {
  return {
    adminPassword: "1234",
    users: [
      {
        id: "u_admin",
        name: "רבש\"צ",
        phone: "",
        email: "admin@example.com",
        role: "admin",
        accessCode: "ADMIN",
        isActive: true,
        targetHours: 0,
        notes: ""
      },
      {
        id: "u_1",
        name: "דוד כהן",
        phone: "0501111111",
        email: "david@example.com",
        role: "guard",
        accessCode: "DAVID1",
        isActive: true,
        targetHours: 8,
        notes: ""
      },
      {
        id: "u_2",
        name: "משה לוי",
        phone: "0502222222",
        email: "moshe@example.com",
        role: "guard",
        accessCode: "MOSHE2",
        isActive: true,
        targetHours: 8,
        notes: ""
      },
      {
        id: "u_3",
        name: "יוסי ישראלי",
        phone: "0503333333",
        email: "yossi@example.com",
        role: "guard",
        accessCode: "YOSSI3",
        isActive: true,
        targetHours: 8,
        notes: ""
      }
    ],
    guardSettings: {
      id: "settings_1",
      periodType: "week",
      startDate: isoDate,
      endDate: nextWeek,
      dayStartTime: "18:00",
      dayEndTime: "06:00",
      shiftHours: 4,
      positionsCount: 1
    },
    constraints: [],
    positions: [{ id: "p_1", name: "שער ראשי", isActive: true }],
    shifts: [],
    swapRequests: [],
    notifications: [],
    auditLog: [],
    sessions: [],
    metrics: {}
  };
}

function createStore(filePath) {
  function ensureFile() {
    if (!fs.existsSync(path.dirname(filePath))) fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) write(createDefaultDb());
  }

  function read() {
    ensureFile();
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  function write(db) {
    fs.writeFileSync(filePath, JSON.stringify(db, null, 2));
  }

  function update(mutator) {
    const db = read();
    mutator(db);
    write(db);
    return db;
  }

  function nextId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  return {
    read,
    update,
    insert(collection, entity) {
      const prefix = collection.replace(/[A-Z].*/, "").slice(0, 3) || "id";
      const created = { id: entity.id || nextId(prefix), ...entity };
      update((db) => db[collection].push(created));
      return created;
    },
    updateById(collection, id, patch) {
      let updated = null;
      update((db) => {
        const index = db[collection].findIndex((item) => item.id === id);
        if (index === -1) return;
        db[collection][index] = { ...db[collection][index], ...patch, id };
        updated = db[collection][index];
      });
      return updated;
    },
    removeById(collection, id) {
      update((db) => {
        db[collection] = db[collection].filter((item) => item.id !== id);
      });
    },
    setSettings(settings) {
      update((db) => {
        db.guardSettings = settings;
        db.positions = Array.from({ length: settings.positionsCount }, (_, index) => (
          db.positions[index] || { id: `p_${index + 1}`, name: `עמדה ${index + 1}`, isActive: true }
        ));
      });
      return settings;
    },
    replaceSchedule(shifts, metrics) {
      update((db) => {
        db.shifts = shifts;
        db.metrics = metrics;
        db.swapRequests = [];
      });
    },
    replaceNotifications(notifications) {
      update((db) => {
        db.notifications = notifications;
      });
    },
    audit(actorId, action, entityType, entityId) {
      update((db) => {
        db.auditLog.push({
          id: nextId("audit"),
          actorId,
          action,
          entityType,
          entityId,
          createdAt: new Date().toISOString()
        });
      });
    }
  };
}

module.exports = { createStore, createDefaultDb };
