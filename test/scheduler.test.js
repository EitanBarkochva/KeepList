const test = require("node:test");
const assert = require("node:assert/strict");
const { createDefaultDb } = require("../src/dataStore");
const { generateSchedule, createNotifications } = require("../src/scheduler");

test("generates balanced weekly shifts", () => {
  const db = createDefaultDb();
  db.guardSettings = {
    id: "settings_1",
    periodType: "week",
    startDate: "2026-06-21",
    endDate: "2026-06-22",
    dayStartTime: "18:00",
    dayEndTime: "06:00",
    shiftHours: 4,
    positionsCount: 1
  };

  const result = generateSchedule(db);

  assert.equal(result.shifts.length, 3);
  assert.equal(result.metrics.maxGap <= 4, true);
  assert.equal(result.metrics.warnings.length, 0);
});

test("does not assign blocked guard", () => {
  const db = createDefaultDb();
  db.guardSettings = {
    id: "settings_1",
    periodType: "week",
    startDate: "2026-06-21",
    endDate: "2026-06-21",
    dayStartTime: "18:00",
    dayEndTime: "22:00",
    shiftHours: 4,
    positionsCount: 1
  };
  db.constraints.push({
    id: "c_1",
    userId: "u_1",
    type: "date_block",
    date: "2026-06-21",
    startTime: "",
    endTime: "",
    reason: "לא זמין"
  });

  const result = generateSchedule(db);

  assert.notEqual(result.shifts[0].assignedUserId, "u_1");
});

test("creates email, sms and whatsapp reminders", () => {
  const notifications = createNotifications([
    {
      id: "shift_1",
      date: "2026-06-21",
      startTime: "18:00",
      endTime: "22:00",
      assignedUserId: "u_1"
    }
  ]);

  assert.equal(notifications.length, 3);
  assert.deepEqual(notifications.map((item) => item.channel).sort(), ["email", "sms", "whatsapp"]);
});
