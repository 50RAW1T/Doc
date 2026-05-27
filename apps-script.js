const SHEET_NAME = "appointments";
const IMAGE_FOLDER_NAME = "Doctor appointment images";
const HEADERS = [
  "id",
  "date",
  "time",
  "place",
  "department",
  "doctor",
  "status",
  "note",
  "tasks",
  "rawText",
  "imageData",
  "imageFileId",
  "calendarEventId",
  "calendarHtmlLink",
  "createdAt",
  "updatedAt",
];

function doGet(e) {
  return json({ ok: true, appointments: readAppointments() }, e);
}

function doPost(e) {
  const payload = JSON.parse((e.postData && e.postData.contents) || "{}");

  if (payload.action === "replaceAll") {
    const appointments = normalizeAppointments(payload.appointments || []).map(saveImageForAppointment);
    writeAppointments(appointments);
    return json({ ok: true, count: appointments.length }, e);
  }

  if (payload.action === "syncOne") {
    const incoming = saveCalendarForAppointment(saveImageForAppointment(payload.appointment || {}));
    const appointments = upsertAppointment(readAppointments(), incoming);
    writeAppointments(appointments);
    return json({ ok: true, appointment: incoming }, e);
  }

  if (payload.action === "syncAll") {
    const appointments = normalizeAppointments(payload.appointments || [])
      .map(saveImageForAppointment)
      .map(saveCalendarForAppointment);
    writeAppointments(appointments);
    return json({ ok: true, count: appointments.length }, e);
  }

  return json({ ok: false, error: "Unknown action" }, e);
}

function readAppointments() {
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  return values.slice(1)
    .filter((row) => row[0])
    .map((row) => Object.fromEntries(HEADERS.map((header, index) => [header, row[index] || ""])));
}

function writeAppointments(appointments) {
  const sheet = getSheet();
  sheet.clear();
  sheet.appendRow(HEADERS);
  appointments.forEach((item) => {
    sheet.appendRow(HEADERS.map((header) => serializeCell(item[header])));
  });
}

function upsertAppointment(appointments, incoming) {
  const index = appointments.findIndex((item) => item.id === incoming.id);
  if (index >= 0) {
    appointments[index] = { ...appointments[index], ...incoming };
    return appointments;
  }
  return [...appointments, incoming];
}

function normalizeAppointments(appointments) {
  return appointments
    .filter((item) => item && item.id && item.date)
    .map((item) => ({
      ...item,
      updatedAt: new Date().toISOString(),
    }));
}

function saveImageForAppointment(item) {
  const imageData = item.imageData || "";
  if (!imageData || !imageData.startsWith("data:image/")) return item;
  if (item.imageFileId) {
    return {
      ...item,
      imageData: driveViewUrl(item.imageFileId),
    };
  }

  const match = imageData.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return item;

  const mimeType = match[1];
  const extension = mimeType.split("/")[1].replace("jpeg", "jpg");
  const bytes = Utilities.base64Decode(match[2]);
  const filename = `${safeFilename(item.date)}-${safeFilename(item.department || item.place || "appointment")}-${item.id}.${extension}`;
  const blob = Utilities.newBlob(bytes, mimeType, filename);
  const file = getImageFolder().createFile(blob);

  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (error) {
    // Some Google Workspace domains block public sharing. The file still stays in Drive.
  }

  return {
    ...item,
    imageData: driveViewUrl(file.getId()),
    imageFileId: file.getId(),
    updatedAt: new Date().toISOString(),
  };
}

function saveCalendarForAppointment(item) {
  if (!item || !item.id || !item.date) return item;

  const calendar = CalendarApp.getDefaultCalendar();
  const title = buildCalendarTitle(item);
  const description = buildCalendarDescription(item);
  const location = [item.place, item.department].filter(Boolean).join(" ");
  const existing = item.calendarEventId ? calendar.getEventById(item.calendarEventId) : null;
  const hasTime = item.time && item.time !== "00:00";
  const start = hasTime ? dateTime(item.date, item.time) : dateOnly(item.date);
  const end = hasTime ? dateTime(item.date, eventEndTime(item)) : null;
  let event = existing;

  if (event) {
    event.setTitle(title);
    event.setDescription(description);
    event.setLocation(location);
    if (hasTime) {
      event.setTime(start, end);
    } else {
      event.setAllDayDate(start);
    }
  } else if (hasTime) {
    event = calendar.createEvent(title, start, end, { description, location });
  } else {
    event = calendar.createAllDayEvent(title, start, { description, location });
  }

  event.removeAllReminders();
  event.addPopupReminder(60);
  event.addPopupReminder(24 * 60);

  return {
    ...item,
    calendarEventId: event.getId(),
    calendarHtmlLink: event.getGuestList ? "" : "",
    updatedAt: new Date().toISOString(),
  };
}

function buildCalendarTitle(item) {
  const taskNames = parseTasks(item).map((task) => task.department).filter(Boolean);
  const primary = taskNames[0] || item.department || "นัดหมอ";
  const place = item.place ? ` - ${shortPlace(item.place)}` : "";
  return `${primary}${place}`.slice(0, 120);
}

function buildCalendarDescription(item) {
  const lines = [
    "สร้างจาก Doctor Appointment Tracker",
    "",
    item.place && `สถานที่: ${item.place}`,
    item.department && `แผนก/ห้องตรวจ: ${item.department}`,
    item.doctor && `แพทย์: ${item.doctor}`,
    item.note && `หมายเหตุ: ${item.note}`,
    item.imageData && `รูปใบนัด: ${item.imageData}`,
  ].filter(Boolean);

  const tasks = parseTasks(item);
  if (tasks.length) {
    lines.push("", "สิ่งที่ต้องทำ:");
    tasks.forEach((task, index) => {
      lines.push(`${index + 1}. ${[task.time, task.department, task.doctor, task.note].filter(Boolean).join(" - ")}`);
    });
  }

  if (item.rawText) {
    lines.push("", "ข้อความ OCR:", item.rawText);
  }

  return lines.join("\n").slice(0, 7000);
}

function parseTasks(item) {
  if (Array.isArray(item.tasks)) return item.tasks;
  if (typeof item.tasks === "string" && item.tasks.trim()) {
    try {
      const parsed = JSON.parse(item.tasks);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }
  return [];
}

function eventEndTime(item) {
  const candidates = [item.note, ...parseTasks(item).map((task) => task.note)].join(" ");
  const range = candidates.match(/(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})/);
  if (range) return `${range[3].padStart(2, "0")}:${range[4]}`;

  const start = dateTime(item.date, item.time || "00:00");
  start.setMinutes(start.getMinutes() + 60);
  return `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
}

function dateTime(dateValue, timeValue) {
  const parts = dateValue.split("-").map(Number);
  const time = (timeValue || "00:00").split(":").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], time[0] || 0, time[1] || 0);
}

function dateOnly(dateValue) {
  const parts = dateValue.split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function shortPlace(place) {
  return String(place || "")
    .replace("โรงพยาบาล", "รพ.")
    .slice(0, 60);
}

function getSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }
  const firstRow = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), HEADERS.length)).getValues()[0];
  if (firstRow[0] !== "id") {
    sheet.clear();
    sheet.appendRow(HEADERS);
  }
  return sheet;
}

function getImageFolder() {
  const folders = DriveApp.getFoldersByName(IMAGE_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(IMAGE_FOLDER_NAME);
}

function driveViewUrl(id) {
  return `https://drive.google.com/file/d/${id}/view`;
}

function safeFilename(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function serializeCell(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function json(data, e) {
  const callback = e && e.parameter && e.parameter.callback;
  const output = callback ? `${callback}(${JSON.stringify(data)})` : JSON.stringify(data);
  const mimeType = callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON;

  return ContentService
    .createTextOutput(output)
    .setMimeType(mimeType);
}
