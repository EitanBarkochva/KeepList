function generateSchedule(db) {
  const settings = db.guardSettings;
  const guards = db.users.filter((user) => user.role === "guard" && user.isActive);
  const positions = db.positions.filter((position) => position.isActive).slice(0, settings.positionsCount);
  const shifts = [];
  const hoursByUser = Object.fromEntries(guards.map((guard) => [guard.id, 0]));
  const lastShiftStartByUser = {};
  const warnings = [];
  let cursor = atTime(settings.startDate, settings.dayStartTime);
  const end = atTime(settings.endDate, settings.dayEndTime);
  if (end <= cursor) end.setDate(end.getDate() + 1);

  while (cursor < end) {
    const shiftEnd = new Date(cursor.getTime() + settings.shiftHours * 60 * 60 * 1000);
    const date = toDate(cursor);
    const startTime = toTime(cursor);
    const endTime = toTime(shiftEnd);

    for (const position of positions) {
      const candidates = guards
        .filter((guard) => !isBlocked(guard.id, db.constraints, date, startTime, endTime))
        .sort((a, b) => {
          const hoursScore = hoursByUser[a.id] - hoursByUser[b.id];
          if (hoursScore !== 0) return hoursScore;
          const aGap = gapHours(lastShiftStartByUser[a.id], cursor);
          const bGap = gapHours(lastShiftStartByUser[b.id], cursor);
          return bGap - aGap;
        });

      const selected = candidates[0] || null;
      if (!selected) warnings.push(`לא נמצא שומר עבור ${date} ${startTime} בעמדה ${position.name}`);

      if (selected) {
        hoursByUser[selected.id] += settings.shiftHours;
        lastShiftStartByUser[selected.id] = cursor.toISOString();
      }

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

  return { shifts, metrics: buildMetrics(guards, hoursByUser, warnings) };
}

function createNotifications(shifts) {
  const notifications = [];
  for (const shift of shifts) {
    if (!shift.assignedUserId) continue;
    const shiftStart = atTime(shift.date, shift.startTime);
    notifications.push({
      id: `mail_${shift.id}`,
      shiftId: shift.id,
      userId: shift.assignedUserId,
      channel: "email",
      sendAt: new Date(shiftStart.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      status: "planned"
    });
    for (const channel of ["sms", "whatsapp"]) {
      notifications.push({
        id: `${channel}_${shift.id}`,
        shiftId: shift.id,
        userId: shift.assignedUserId,
        channel,
        sendAt: new Date(shiftStart.getTime() - 5 * 60 * 60 * 1000).toISOString(),
        status: "planned"
      });
    }
  }
  return notifications;
}

function buildMetrics(guards, hoursByUser, warnings) {
  const activeHours = Object.values(hoursByUser);
  const average = activeHours.length ? activeHours.reduce((sum, hours) => sum + hours, 0) / activeHours.length : 0;
  const fairness = guards.map((guard) => ({
    userId: guard.id,
    name: guard.name,
    hours: hoursByUser[guard.id] || 0,
    deltaFromAverage: Number(((hoursByUser[guard.id] || 0) - average).toFixed(2))
  }));
  return {
    averageHours: Number(average.toFixed(2)),
    maxGap: activeHours.length ? Math.max(...activeHours) - Math.min(...activeHours) : 0,
    fairness,
    warnings
  };
}

function isBlocked(userId, constraints, date, startTime, endTime) {
  return constraints.some((constraint) => {
    if (constraint.userId !== userId) return false;
    if (constraint.type === "full_block") return true;
    if (constraint.date && constraint.date !== date) return false;
    if (constraint.type === "date_block") return true;
    if (constraint.type === "time_block") return overlaps(startTime, endTime, constraint.startTime, constraint.endTime);
    return false;
  });
}

function overlaps(startA, endA, startB, endB) {
  const aStart = minutes(startA);
  const aEnd = minutes(endA);
  const bStart = minutes(startB);
  const bEnd = minutes(endB);
  return aStart < bEnd && bStart < aEnd;
}

function atTime(date, time) {
  const [hours, minutesValue] = time.split(":").map(Number);
  const value = new Date(`${date}T00:00:00`);
  value.setHours(hours, minutesValue, 0, 0);
  return value;
}

function toDate(date) {
  return date.toISOString().slice(0, 10);
}

function toTime(date) {
  return date.toTimeString().slice(0, 5);
}

function minutes(time) {
  const [hours, minutesValue] = time.split(":").map(Number);
  return hours * 60 + minutesValue;
}

function gapHours(previousIso, currentDate) {
  if (!previousIso) return Number.POSITIVE_INFINITY;
  return (currentDate.getTime() - new Date(previousIso).getTime()) / 36e5;
}

module.exports = { generateSchedule, createNotifications, isBlocked };
