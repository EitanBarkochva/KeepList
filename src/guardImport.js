function normalizeImportedGuard(row) {
  const guardNumber = pick(row, ["guardNumber", "number", "מספר שומר", "מספר", "מס׳ שומר"]);
  const name = pick(row, ["name", "fullName", "שם מלא", "שם"]);
  const roleTitle = pick(row, ["roleTitle", "position", "תפקיד"]);
  const phone = pick(row, ["phone", "טלפון", "נייד"]);
  const email = pick(row, ["email", "mail", "אימייל", "מייל"]);

  return {
    guardNumber,
    name,
    roleTitle,
    phone,
    email,
    role: "guard",
    accessCode: String(guardNumber || row.accessCode || "").trim() || undefined,
    isActive: row.isActive !== false,
    targetHours: Number(row.targetHours || row["שעות יעד"] || 0),
    notes: String(row.notes || row["הערות"] || "").trim()
  };
}

function importGuards(db, rows, options = {}) {
  const imported = [];
  const updated = [];
  const skipped = [];
  const existingGuards = db.users.filter((user) => user.role === "guard");

  for (const [index, row] of rows.entries()) {
    const guard = normalizeImportedGuard(row);
    if (!guard.name) {
      skipped.push({ row: index + 1, reason: "missing_name" });
      continue;
    }

    const duplicate = findExistingGuard(existingGuards, guard);
    if (duplicate) {
      if (options.updateExisting === false) {
        skipped.push({ row: index + 1, reason: "duplicate", userId: duplicate.id });
        continue;
      }

      Object.assign(duplicate, {
        ...duplicate,
        ...guard,
        accessCode: guard.accessCode || duplicate.accessCode,
        isActive: true
      });
      updated.push(duplicate);
      continue;
    }

    const created = {
      id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ...guard,
      accessCode: guard.accessCode || Math.random().toString(36).slice(2, 8).toUpperCase()
    };
    db.users.push(created);
    existingGuards.push(created);
    imported.push(created);
  }

  return {
    imported,
    updated,
    skipped,
    summary: {
      imported: imported.length,
      updated: updated.length,
      skipped: skipped.length
    }
  };
}

function findExistingGuard(users, guard) {
  return users.find((user) => {
    if (guard.guardNumber && user.guardNumber && String(user.guardNumber) === String(guard.guardNumber)) return true;
    if (guard.email && user.email && normalize(user.email) === normalize(guard.email)) return true;
    if (guard.phone && user.phone && compactPhone(user.phone) === compactPhone(guard.phone)) return true;
    return false;
  });
}

function pick(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function compactPhone(value) {
  return String(value || "").replace(/\D/g, "");
}

module.exports = { importGuards, normalizeImportedGuard };
