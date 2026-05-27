const STORAGE_KEY = "doctor-appointments";
const SCRIPT_URL_KEY = "doctor-appointments-script-url";
const OCR_DICTIONARY_KEY = "doctor-appointments-ocr-dictionary";

const statusLabels = {
  pending: "รอนัด",
  done: "ไปแล้ว",
  rescheduled: "เลื่อนนัด",
  cancelled: "ยกเลิก",
};

let appointments = loadAppointments();
let editingId = null;
let pendingImageData = "";
let calendarCursor = new Date();
let ocrDictionary = loadOcrDictionary();

const form = document.querySelector("#appointmentForm");
const fields = {
  date: document.querySelector("#dateInput"),
  time: document.querySelector("#timeInput"),
  place: document.querySelector("#placeInput"),
  department: document.querySelector("#departmentInput"),
  doctor: document.querySelector("#doctorInput"),
  status: document.querySelector("#statusInput"),
  note: document.querySelector("#noteInput"),
};

const listEl = document.querySelector("#appointmentList");
const emptyTemplate = document.querySelector("#emptyStateTemplate");
const searchInput = document.querySelector("#searchInput");
const filterInput = document.querySelector("#filterInput");
const syncStatus = document.querySelector("#syncStatus");
const scriptUrlInput = document.querySelector("#scriptUrlInput");
const formTitle = document.querySelector("#formTitle");
const submitBtn = document.querySelector("#submitBtn");
const cancelEditBtn = document.querySelector("#cancelEditBtn");
const ocrText = document.querySelector("#ocrText");
const dateHint = document.querySelector("#dateHint");
const ocrProgress = document.querySelector("#ocrProgress");
const ocrProgressBar = document.querySelector("#ocrProgressBar");
const ocrProgressText = document.querySelector("#ocrProgressText");
const autoSaveOcrInput = document.querySelector("#autoSaveOcrInput");
const ocrCropModeInput = document.querySelector("#ocrCropModeInput");
const calendarTitle = document.querySelector("#calendarTitle");
const calendarGrid = document.querySelector("#calendarGrid");
const imageModal = document.querySelector("#imageModal");
const modalImage = document.querySelector("#modalImage");
const wrongWordInput = document.querySelector("#wrongWordInput");
const correctWordInput = document.querySelector("#correctWordInput");
const dictionaryList = document.querySelector("#dictionaryList");

scriptUrlInput.value = localStorage.getItem(SCRIPT_URL_KEY) || "";
appointments = normalizeLoadedAppointments(appointments);
persist();
setDefaultDate();
renderDictionary();
render();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const item = getFormData();
  learnCorrectionsFromForm(item);

  if (editingId) {
    appointments = appointments.map((appointment) =>
      appointment.id === editingId ? { ...appointment, ...item, updatedAt: new Date().toISOString() } : appointment
    );
  } else {
    appointments.push({
      id: crypto.randomUUID(),
      ...item,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  persist();
  resetForm();
  render();
  await pushToGoogleSheet();
});

document.querySelector("#clearFormBtn").addEventListener("click", resetForm);
cancelEditBtn.addEventListener("click", resetForm);
searchInput.addEventListener("input", renderList);
filterInput.addEventListener("change", renderList);

document.querySelector("#parseOcrBtn").addEventListener("click", () => {
  const text = ocrText.value.trim();
  if (!text) return;
  const parsedItems = parseAppointmentItems(text);
  const parsed = parsedItems[0] || parseAppointmentText(text);
  Object.entries(parsed).forEach(([key, value]) => {
    if (fields[key] && value) fields[key].value = value;
  });
  if (parsedItems.length > 1) {
    setOcrProgress(100, `พบ ${parsedItems.length} รายการในภาพเดียว ถ้าอัปโหลดภาพจะบันทึกแยกให้อัตโนมัติ`);
  }
  updateDateHint();
});

document.querySelector("#ocrImageInput").addEventListener("change", handleOcrImage);
fields.date.addEventListener("change", updateDateHint);

document.querySelector("#saveUrlBtn").addEventListener("click", () => {
  localStorage.setItem(SCRIPT_URL_KEY, scriptUrlInput.value.trim());
  updateSyncStatus();
});
document.querySelector("#syncAllCalendarBtn").addEventListener("click", syncAllAppointmentsToGoogle);

document.querySelector("#refreshBtn").addEventListener("click", async () => {
  repairStoredAppointments();
  if (localStorage.getItem(SCRIPT_URL_KEY)) {
    await pullFromGoogleSheet();
  }
});
document.querySelector("#exportBtn").addEventListener("click", exportJson);
document.querySelector("#importInput").addEventListener("change", importJson);
document.querySelector("#refreshBtn").addEventListener("contextmenu", (event) => {
  event.preventDefault();
  repairStoredAppointments();
});
document.querySelector("#prevMonthBtn").addEventListener("click", () => changeCalendarMonth(-1));
document.querySelector("#nextMonthBtn").addEventListener("click", () => changeCalendarMonth(1));
document.querySelector("#closeImageModalBtn").addEventListener("click", closeImageModal);
document.querySelector("#addCorrectionBtn").addEventListener("click", addCorrectionFromInputs);
imageModal.addEventListener("click", (event) => {
  if (event.target === imageModal) closeImageModal();
});

function getFormData() {
  return {
    date: fields.date.value,
    time: fields.time.value || "00:00",
    place: fields.place.value.trim() || "โรงพยาบาล",
    department: fields.department.value.trim(),
    doctor: fields.doctor.value.trim(),
    status: fields.status.value,
    note: fields.note.value.trim(),
    rawText: ocrText.value.trim(),
    imageData: pendingImageData,
  };
}

function resetForm() {
  editingId = null;
  form.reset();
  setDefaultDate();
  ocrText.value = "";
  pendingImageData = "";
  formTitle.textContent = "เพิ่มนัดใหม่";
  submitBtn.textContent = "บันทึกนัด";
  cancelEditBtn.hidden = true;
  updateDateHint();
}

function setDefaultDate() {
  if (!fields.date.value) {
    fields.date.value = new Date().toISOString().slice(0, 10);
  }
  if (!fields.status.value) {
    fields.status.value = "pending";
  }
}

function render() {
  appointments.sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  renderStats();
  renderCalendar();
  renderList();
  updateSyncStatus();
  updateDateHint();
}

function renderStats() {
  const now = startOfDay(new Date());
  const nextSevenDays = new Date(now);
  nextSevenDays.setDate(now.getDate() + 7);

  document.querySelector("#totalCount").textContent = appointments.length;
  document.querySelector("#pendingCount").textContent = appointments.filter((item) => item.status === "pending").length;
  document.querySelector("#doneCount").textContent = appointments.filter((item) => item.status === "done").length;
  document.querySelector("#soonCount").textContent = appointments.filter((item) => {
    const date = dateFromInput(item.date);
    return item.status === "pending" && date >= now && date <= nextSevenDays;
  }).length;

  const next = appointments.find((item) => item.status === "pending" && dateFromInput(item.date) >= now);
  document.querySelector("#nextAppointment").textContent = next
    ? `นัดถัดไป: ${formatDate(next.date)} ${next.time} ที่ ${next.place}`
    : "ยังไม่มีนัดถัดไป";
}

function renderList() {
  const query = searchInput.value.trim().toLowerCase();
  const status = filterInput.value;
  const filtered = appointments.filter((item) => {
    const haystack = [item.place, item.department, item.doctor, item.note, item.date, item.time].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (status === "all" || item.status === status);
  });

  listEl.replaceChildren();

  if (!filtered.length) {
    listEl.append(emptyTemplate.content.cloneNode(true));
    return;
  }

  const groups = groupAppointmentsByDate(filtered);
  groups.forEach(([date, items]) => {
    const group = document.createElement("section");
    group.className = "date-group";
    group.dataset.dateGroup = date;
    group.innerHTML = `
      <div class="date-group-header">
        <h3>${date === "no-date" ? "ยังไม่ทราบวันที่" : formatDate(date)}</h3>
        <span>${items.length} รายการ</span>
      </div>
    `;
    const groupList = document.createElement("div");
    groupList.className = "date-group-list";
    items.forEach((item) => groupList.append(createAppointmentCard(item)));
    group.append(groupList);
    listEl.append(group);
  });
}

function renderCalendar() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  calendarTitle.textContent = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric" }).format(calendarCursor);
  calendarGrid.replaceChildren();

  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - startOffset);
  const todayKey = toDateKey(new Date());
  const byDate = appointments.reduce((map, item) => {
    if (!item.date) return map;
    if (!map.has(item.date)) map.set(item.date, []);
    map.get(item.date).push(item);
    return map;
  }, new Map());

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const key = toDateKey(date);
    const items = byDate.get(key) || [];
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = [
      "calendar-day",
      date.getMonth() !== month ? "muted-month" : "",
      key === todayKey ? "today-cell" : "",
      items.length ? "has-events" : "",
    ].filter(Boolean).join(" ");
    cell.innerHTML = `
      <span class="day-number">${date.getDate()}</span>
      ${items.length ? `<span class="event-count">${items.length}</span>` : ""}
      <span class="day-events">${calendarEventLabels(items)}</span>
    `;
    cell.addEventListener("click", () => focusDateInList(key));
    calendarGrid.append(cell);
  }
}

function calendarEventLabels(items) {
  return items
    .slice(0, 2)
    .map((item) => escapeHtml(item.department || item.place || "นัด"))
    .join("");
}

function focusDateInList(dateKey) {
  const target = document.querySelector(`[data-date-group="${dateKey}"]`);
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.classList.add("date-group-focus");
    setTimeout(() => target.classList.remove("date-group-focus"), 900);
  }
}

function changeCalendarMonth(delta) {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + delta, 1);
  renderCalendar();
}

function groupAppointmentsByDate(items) {
  const groups = new Map();
  items.forEach((item) => {
    const date = item.date || "no-date";
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(item);
  });
  return [...groups.entries()].sort(([dateA], [dateB]) => dateA.localeCompare(dateB));
}

function createAppointmentCard(item) {
  const card = document.createElement("article");
  card.className = "appointment-card";

  const details = appointmentDetails(item);
  const title = details.department || details.place || "นัดหมอ";
  card.innerHTML = `
    <header>
      <div>
        <h3>${escapeHtml(title)}</h3>
        <div class="meta">
          <span>${formatDate(item.date)}</span>
          <span>${escapeHtml(formatTime(item.time))}</span>
          <span class="day-chip ${dayClass(item.date)}">${escapeHtml(daySummary(item.date))}</span>
        </div>
      </div>
      <span class="badge ${item.status}">${statusLabels[item.status]}</span>
    </header>
    <dl class="detail-grid">
      ${detailRow("สถานที่", details.place)}
      ${detailRow("แผนก/ห้องตรวจ", details.department)}
      ${detailRow("แพทย์", details.doctor)}
      ${detailRow("HN", details.hn)}
      ${detailRow("หมายเหตุ", details.note)}
    </dl>
    ${taskList(item.tasks)}
    ${item.rawText ? `<details class="raw-ocr"><summary>ข้อความ OCR ทั้งหมด</summary><pre>${escapeHtml(item.rawText)}</pre></details>` : ""}
    ${item.imageData ? `<button class="appointment-image" data-action="view-image" type="button"><img src="${escapeHtml(item.imageData)}" alt="รูปใบนัดที่อัปโหลด" loading="lazy" /><span>กดดูรูปใหญ่</span></button>` : ""}
    ${googleSyncInfo(item)}
    <div class="card-actions">
      <button class="secondary-button" data-action="calendar" type="button">ส่ง Calendar</button>
      <button class="secondary-button" data-action="edit" type="button">แก้ไข</button>
      <button class="secondary-button" data-action="done" type="button">ไปแล้ว</button>
      <button class="secondary-button" data-action="delete" type="button">ลบ</button>
    </div>
  `;

  card.querySelector('[data-action="edit"]').addEventListener("click", () => editAppointment(item.id));
  card.querySelector('[data-action="done"]').addEventListener("click", () => updateStatus(item.id, "done"));
  card.querySelector('[data-action="delete"]').addEventListener("click", () => deleteAppointment(item.id));
  card.querySelector('[data-action="calendar"]').addEventListener("click", () => syncAppointmentToGoogle(item.id));
  card.querySelector('[data-action="view-image"]')?.addEventListener("click", () => openImageModal(item.imageData));
  return card;
}

function googleSyncInfo(item) {
  const parts = [];
  if (item.calendarEventId) parts.push("สร้าง Google Calendar แล้ว");
  if (isDriveImageUrl(item.imageData)) parts.push("เก็บรูปใน Google Drive แล้ว");
  if (!parts.length) return "";
  return `<p class="google-sync-info">${parts.map(escapeHtml).join(" | ")}</p>`;
}

function openImageModal(imageData) {
  modalImage.src = imageData;
  imageModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeImageModal() {
  imageModal.hidden = true;
  modalImage.removeAttribute("src");
  document.body.classList.remove("modal-open");
}

function taskList(tasks = []) {
  if (!tasks.length) return "";
  return `
    <section class="task-list">
      <h4>สิ่งที่ต้องทำในใบนี้</h4>
      ${tasks.map((task) => `
        <article class="task-item">
          <strong>${escapeHtml(task.department || "รายการนัด")}</strong>
          <span>${escapeHtml([formatTime(task.time), task.note].filter(Boolean).join(" | "))}</span>
        </article>
      `).join("")}
    </section>
  `;
}

function detailRow(label, value) {
  if (!value) return "";
  const className = label === "หมายเหตุ" ? ' class="wide-detail"' : "";
  return `<div${className}><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function appointmentDetails(item) {
  const raw = [item.place, item.department, item.doctor, item.note, item.rawText].filter(Boolean).join(" ");
  const extracted = extractStructuredDetails(raw);
  return {
    place: readableField(item.place, extracted.place, "โรงพยาบาล"),
    department: readableField(item.department, extracted.department, "นัดหมาย"),
    doctor: readableField(item.doctor, extracted.doctor, ""),
    hn: extracted.hn,
    note: cleanNote(item.note || "", extracted),
  };
}

function readableField(value, fallback, defaultValue = "") {
  const cleaned = cleanValue(value);
  if (!cleaned) return fallback || defaultValue;
  const isNoisy = isNoisyOcrBlob(cleaned);
  if (isNoisy) return fallback || defaultValue;
  return cleaned;
}

function isNoisyOcrBlob(value) {
  return value.length > 60 ||
    /\bHN\s*:|Visit ID|วันที่นัด|สิ่งที่ท่านต้อง|หมายเหตุ|ติดต่อสอบถาม|ทำบัตร|QRCODE|รายการตรวจ|Laboratory|งดอาหาร/i.test(value);
}

function editAppointment(id) {
  const item = appointments.find((appointment) => appointment.id === id);
  if (!item) return;

  editingId = id;
  pendingImageData = item.imageData || "";
  Object.entries(fields).forEach(([key, input]) => {
    input.value = item[key] || "";
  });
  formTitle.textContent = "แก้ไขนัด";
  submitBtn.textContent = "บันทึกการแก้ไข";
  cancelEditBtn.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function updateStatus(id, status) {
  appointments = appointments.map((item) => (item.id === id ? { ...item, status, updatedAt: new Date().toISOString() } : item));
  persist();
  render();
  await pushToGoogleSheet();
}

async function deleteAppointment(id) {
  if (!confirm("ลบนัดนี้ออกจากรายการ?")) return;
  appointments = appointments.filter((item) => item.id !== id);
  persist();
  render();
  await pushToGoogleSheet();
}

function parseAppointmentText(text) {
  return parseAppointmentItems(text)[0] || emptyParsedAppointment(text);
}

function parseAppointmentItems(text) {
  const normalized = extractAppointmentZone(normalizeOcrText(applyOcrDictionary(text)));
  const common = extractStructuredDetails(normalized);
  const multiItems = extractMultipleAppointments(normalized, common);
  if (multiItems.length) return multiItems;

  const hasOnlyHeaderInfo = !hasAppointmentDateSignal(normalized) && !looksLikeAppointmentTable(normalized);
  if (hasOnlyHeaderInfo) return [];

  const preferredDate = extractPreferredDate(normalized);
  const dateMatch = findUsableNumericDate(normalized);
  const thaiDateMatch = normalized.match(/(\d{1,2})\s*(ม\.ค\.|มกราคม|ก\.พ\.|กุมภาพันธ์|มี\.ค\.|มีนาคม|เม\.ย\.|เมษายน|พ\.ค\.|พฤษภาคม|มิ\.ย\.|มิถุนายน|ก\.ค\.|กรกฎาคม|ส\.ค\.|สิงหาคม|ก\.ย\.|กันยายน|ต\.ค\.|ตุลาคม|พ\.ย\.|พฤศจิกายน|ธ\.ค\.|ธันวาคม)\s*(\d{2,4})/i);
  const isoDate = preferredDate || (dateMatch ? normalizeThaiDate(dateMatch) : thaiDateMatch ? normalizeThaiTextDate(thaiDateMatch) : "");
  if (!isoDate || (!hasAppointmentDateSignal(normalized) && !looksLikeAppointmentTable(normalized))) {
    return [];
  }
  const timeMatch = isoDate ? normalized.match(/(\d{1,2})\s*[:.]\s*(\d{2})/) : null;
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const details = extractStructuredDetails(normalized);
  const placeLine = details.place || lines.find((line) => /(โรงพยาบาล|รพ\.|คลินิก|hospital|clinic)/i.test(line));
  const departmentLine =
    details.department || lines.find((line) => /(แผนก|ห้องตรวจ|คลินิก|department|ทันต|ตา|ผิว|หัวใจ|เด็ก|สูติ)/i.test(line));
  const doctorLine = details.doctor || lines.find((line) => /(นพ\.|พญ\.|แพทย์|หมอ|doctor|dr\.)/i.test(line));

  return [{
    date: isoDate,
    time: timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : "",
    place: placeLine || common.place || "",
    department: departmentLine || "",
    doctor: doctorLine || "",
    note: cleanNote(normalized, details),
  }];
}

function emptyParsedAppointment(text) {
  return {
    date: "",
    time: "",
    place: "",
    department: "",
    doctor: "",
    note: normalizeOcrText(text).slice(0, 260),
  };
}

function extractMultipleAppointments(text, common) {
  const compact = extractAppointmentZone(normalizeOcrText(applyOcrDictionary(text))).replace(/\s+/g, " ").trim();
  const items = [];
  const globalDate = extractPreferredDate(compact);
  const doctorLine = extractDoctorVisitLine(compact);
  const labLine = extractLabLine(compact);

  if (doctorLine) {
    const dateMatch = doctorLine.match(/(\d{1,2})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{2,4})/);
    const timeMatch = doctorLine.match(/เวลา\s*(\d{1,2})[.:](\d{2})/i);
    if (dateMatch) {
      items.push(parsedItemFromMatch({
        dateMatch,
        hour: timeMatch ? timeMatch[1] : "00",
        minute: timeMatch ? timeMatch[2] : "00",
        place: common.place,
        department: extractClinicLocation(doctorLine) || common.department,
        doctor: common.doctor,
        note: "พบแพทย์",
      }));
    }
  }

  if (labLine) {
    const dateMatch = labLine.match(/(\d{1,2})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{2,4})/);
    const timeMatch = labLine.match(/เวลา\s*(\d{1,2})[.:](\d{2})/i);
    if (dateMatch) {
      items.push(parsedItemFromMatch({
        dateMatch,
        hour: timeMatch ? timeMatch[1] : "00",
        minute: timeMatch ? timeMatch[2] : "00",
        place: common.place,
        department: extractLabLocation(labLine) || "ห้องปฏิบัติการ",
        doctor: "",
        note: "ตรวจห้องปฏิบัติการ",
      }));
    }
  }

  if (items.length) {
    return dedupeParsedItems(items).filter((item) => item.date || item.time || item.department || item.note);
  }

  const appointmentMatch = compact.match(
    /นัดหมาย\s*[:：]?\s*(?:วันที่\s*)?(\d{1,2})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{2,4})\s*เวลา\s*(\d{1,2})[.:](\d{2})(?:\s*[-–]\s*(\d{1,2})[.:](\d{2}))?\s*(.*?)(?=หมายเหตุ|รายการตรวจ|วันที่นัดตรวจ|$)/i
  );
  if (appointmentMatch) {
    items.push(parsedItemFromMatch({
      dateMatch: appointmentMatch,
      hour: appointmentMatch[4],
      minute: appointmentMatch[5],
      place: common.place,
      department: cleanAppointmentDepartment(appointmentMatch[8]) || common.department,
      doctor: common.doctor,
      note: "พบแพทย์",
    }));
  }

  const labMatch = compact.match(
    /รายการตรวจ(?:ทาง)?ห้องปฏิบัติการ.*?(?:วันที่นัดตรวจ\s*[:：]?\s*)?(\d{1,2})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{2,4})\s*เวลา\s*(\d{1,2})[.:](\d{2})(?:\s*น\.)?\s*(.*?)(?=$)/i
  );
  if (labMatch) {
    items.push(parsedItemFromMatch({
      dateMatch: labMatch,
      hour: labMatch[4],
      minute: labMatch[5],
      place: common.place,
      department: extractLabLocation(compact) || "ห้องปฏิบัติการ",
      doctor: "",
      note: cleanValue(`ตรวจห้องปฏิบัติการ ${labMatch[6] || ""}`),
    }));
  }

  const tableMatch = compact.match(
    /(?:นัด\s*:)?\s*(?:จันทร์|อังคาร|พุธ|พฤหัสบดี|ศุกร์|เสาร์|อาทิตย์)?\s*(\d{1,2})\s*(ม\.ค\.|มกราคม|ก\.พ\.|กุมภาพันธ์|มี\.ค\.|มีนาคม|เม\.ย\.|เมษายน|พ\.ค\.|พฤษภาคม|มิ\.ย\.|มิถุนายน|ก\.ค\.|กรกฎาคม|ส\.ค\.|สิงหาคม|ก\.ย\.|กันยายน|ต\.ค\.|ตุลาคม|พ\.ย\.|พฤศจิกายน|ธ\.ค\.|ธันวาคม)\s*(\d{2,4})(?:\s*(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2}))?(?:\s+(\d{1,2})[.:](\d{2}))?/i
  );
  if (!items.length && tableMatch) {
    const submitTime = tableMatch[8] ? `${tableMatch[8].padStart(2, "0")}:${tableMatch[9]}` : "";
    const visitStart = tableMatch[4] ? `${tableMatch[4].padStart(2, "0")}:${tableMatch[5]}` : "";
    const visitEnd = tableMatch[6] ? `${tableMatch[6].padStart(2, "0")}:${tableMatch[7]}` : "";
    items.push({
      date: normalizeThaiTextDate(tableMatch),
      time: submitTime || visitStart || "00:00",
      place: common.place,
      department: common.department,
      doctor: common.doctor,
      status: "pending",
      note: cleanValue([submitTime && `ยื่นใบนัด ${submitTime}`, visitStart && visitEnd && `ช่วงตรวจ ${visitStart}-${visitEnd}`, cleanNote(compact, common)].filter(Boolean).join(" | ")),
    });
  }

  if (!items.length && globalDate) {
    const taskMatches = [...compact.matchAll(/(?:นัดแล้ว|นัดหมาย|รายการตรวจ|วันที่นัดตรวจ).*?(?=(?:นัดแล้ว|นัดหมาย|รายการตรวจ|วันที่นัดตรวจ)|$)/gi)];
    taskMatches.forEach((match) => {
      const chunk = match[0];
      const timeMatch = chunk.match(/เวลา\s*(\d{1,2})[.:](\d{2})/i) || compact.match(/เวลา\s*(\d{1,2})[.:](\d{2})/i);
      const isLab = /ห้องปฏิบัติการ|Laboratory|เจาะเลือด|Creatinine|Glucose|Cholesterol/i.test(chunk);
      items.push({
        date: globalDate,
        time: timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : "",
        place: common.place,
        department: isLab ? extractLabLocation(chunk) || "ห้องปฏิบัติการ" : common.department,
        doctor: isLab ? "" : common.doctor,
        status: "pending",
        note: cleanValue(isLab ? `ตรวจห้องปฏิบัติการ ${chunk}` : chunk).slice(0, 260),
      });
    });
  }

  return dedupeParsedItems(items).filter((item) => item.date || item.time || item.department || item.note);
}

function extractAppointmentZone(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.replace(/\s*(?:ทำบัตร|ทำบัตรที่|ทำบัตรโดย|วันที่พิมพ์|พิมพ์โดย|QRCODE|SCAN ME|สำรวจความพึงพอใจ).*$/i, ""))
    .filter(Boolean)
    .filter((line) => !/^วันที่ตรวจ\s*[:：]/i.test(line))
    .join("\n");
}

function extractDoctorVisitLine(compact) {
  const match = compact.match(/นัดหมาย\s*[:：]?\s*(?:วันที่\s*)?\d{1,2}\s*[/-]\s*\d{1,2}\s*[/-]\s*\d{2,4}\s*เวลา\s*\d{1,2}[.:]\d{2}(?:\s*[-–]\s*\d{1,2}[.:]\d{2})?.*?(?=หมายเหตุ|รายการตรวจ|วันที่นัดตรวจ|$)/i);
  return match ? match[0] : "";
}

function extractLabLine(compact) {
  const match = compact.match(/รายการตรวจ(?:ทาง)?ห้องปฏิบัติการ.*?(?:วันที่นัดตรวจ\s*[:：]?\s*)?\d{1,2}\s*[/-]\s*\d{1,2}\s*[/-]\s*\d{2,4}\s*เวลา\s*\d{1,2}[.:]\d{2}.*?(?=$)/i);
  return match ? match[0] : "";
}

function extractClinicLocation(text) {
  const match = text.match(/(คลินิก[^,|]*?อาคาร\s*150\s*ปี\s*ชั้น\s*\d+(?:\s*\(OR\))?)/i) ||
    text.match(/(คลินิก[^,|]*?)(?=\s*(?:ไม่ระบุแพทย์|หมายเหตุ|รายการตรวจ|$))/i);
  return match ? cleanValue(match[1]) : "";
}

function parsedItemFromMatch({ dateMatch, hour, minute, place, department, doctor, note }) {
  return {
    date: normalizeThaiDate(dateMatch),
    time: `${hour.padStart(2, "0")}:${minute}`,
    place: cleanValue(place),
    department: cleanValue(department),
    doctor: cleanValue(doctor),
    status: "pending",
    note: cleanValue(note),
  };
}

function cleanAppointmentDepartment(value) {
  return cleanValue(String(value || "")
    .replace(/^คลินิก\s*[:：]\s*/i, "คลินิก")
    .split(/(?:\[\*\*\*|\*\*\*|งดอาหาร|หมายเหตุ|รายการตรวจ)/i)[0]);
}

function extractLabLocation(text) {
  const match = text.match(/(?:ห้องตรวจปฏิบัติการ|ห้องปฏิบัติการ|Laboratory).*?(อาคาร\s*150\s*ปี\s*ชั้น\s*\d+)/i);
  return match ? cleanValue(`ห้องปฏิบัติการ ${match[1]}`) : "";
}

function dedupeParsedItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = [item.date, item.time, item.department, item.note.slice(0, 40)].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractPreferredDate(text) {
  const compact = normalizeOcrText(text).replace(/\s+/g, " ");
  const appointmentLabelled = compact.match(/นัดหมาย\s*[:：]?\s*(?:วันที่\s*)?(\d{1,2})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{2,4})/);
  if (appointmentLabelled) return normalizeThaiDate(appointmentLabelled);

  const labelled = compact.match(/วันที่นัด(?:ตรวจ)?\s*[:：]?\s*(\d{1,2})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{2,4})/);
  if (labelled) return normalizeThaiDate(labelled);

  const compactLabelled = compact.match(/วันที่นัด(?:ตรวจ)?\s*[:：]?\s*(\d{2})(\d{2})[/-](\d{2,4})/);
  if (compactLabelled) return normalizeThaiDate(compactLabelled);

  return "";
}

function findUsableNumericDate(text) {
  const compact = normalizeOcrText(text).replace(/\s+/g, " ");
  const matches = [...compact.matchAll(/(\d{1,2})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{2,4})/g)];
  return matches.find((match) => {
    const before = compact.slice(Math.max(0, match.index - 24), match.index);
    return !/วันที่ตรวจ|วันที่พิมพ์|ทำบัตร/i.test(before);
  }) || null;
}

function hasAppointmentDateSignal(text) {
  return /(นัดหมาย|วันที่นัด|วันที่นัดตรวจ|ยื่นใบนัด|ช่วงเวลา|รายการตรวจ|วัน\s*เวลา)/i.test(text);
}

function looksLikeAppointmentTable(text) {
  return /(คลินิก|ตึก|แพทย์|ช่วงเวลา|ยื่นใบนัด)/i.test(text) &&
    /(\d{1,2})\s*(ม\.ค\.|มกราคม|ก\.พ\.|กุมภาพันธ์|มี\.ค\.|มีนาคม|เม\.ย\.|เมษายน|พ\.ค\.|พฤษภาคม|มิ\.ย\.|มิถุนายน|ก\.ค\.|กรกฎาคม|ส\.ค\.|สิงหาคม|ก\.ย\.|กันยายน|ต\.ค\.|ตุลาคม|พ\.ย\.|พฤศจิกายน|ธ\.ค\.|ธันวาคม)\s*(\d{2,4})/i.test(text);
}

function extractStructuredDetails(text) {
  const compact = normalizeOcrText(text).replace(/\s+/g, " ").trim();
  const hnMatch = compact.match(/\bHN\s*:?\s*([A-Z0-9/-]+)/i);
  const placeMatch = compact.match(/(โรงพยาบาล[^ณ|,]+(?:ณ\s*ศรีราชา\s*สภากาชาดไทย)?|รพ\.[^ณ|,]+)/i);
  const roomMatch =
    compact.match(/(ห้องปฏิบัติการ)/i) ||
    compact.match(/(คลินิกเวชปฏิบัติ\s*อาคาร\s*150\s*ปี\s*ชั้น\s*\d+)/i) ||
    compact.match(/(?:ห้องตรวจ\s*[:：]?\s*)?(คลินิก[^,]*?(?:อาคาร\s*150\s*ปี\s*ชั้น\s*\d+\s*(?:\(OR\))?))/i) ||
    compact.match(/(ตึก\s*อาคาร[^,]*?ชั้น\s*\d+)/i);
  const doctorMatch = compact.match(/(?:แพทย์(?:ผู้ตรวจ|ตรวจ)?\s*[:：]?\s*|หมอ\s*[:：]?\s*|นพ\.|พญ\.|Dr\.?)\s*([^,]+?)(?=\s*(?:ห้องตรวจ|หมายเหตุ|ติดต่อสอบถาม|ทำบัตร|QRCODE|วันที่|HN|$))/i);
  const visitMatch = compact.match(/Visit\s*ID\s*[:：]?\s*([A-Z0-9/-]+)/i);

  return {
    hn: hnMatch ? cleanValue(hnMatch[1]) : "",
    place: placeMatch ? cleanValue(placeMatch[1]) : "",
    department: roomMatch ? cleanValue(roomMatch[1].replace(/^ห้องตรวจ\s*[:：]?\s*/i, "").replace(/^คลินิก\s*[:：]\s*/i, "คลินิก")) : "",
    doctor: doctorMatch ? cleanDoctorName(doctorMatch[1]) : "",
    visitId: visitMatch ? cleanValue(visitMatch[1]) : "",
  };
}

function cleanNote(note, details = {}) {
  const compact = normalizeOcrText(note);
  if (isNoisyOcrBlob(compact) && /รายการตรวจ|Laboratory|งดอาหาร|วันที่นัด|นัดหมาย/i.test(compact)) {
    return summarizeOcrNote(compact);
  }
  const appointmentBlock = extractUsefulAppointmentText(compact);
  if (appointmentBlock) return appointmentBlock;

  const contactMatch = compact.match(/ติดต่อสอบถาม\s*โทร\s*([0-9-]+)\s*ต่อ\s*([0-9]+)/i);
  const submitMatch = compact.match(/ยื่นใบนัด\s*(\d{1,2}[.:]\d{2})/i);
  const visitRangeMatch = compact.match(/(\d{1,2}[.:]\d{2})\s*[-–]\s*(\d{1,2}[.:]\d{2})/);
  const parts = [
    submitMatch && `ยื่นใบนัด ${submitMatch[1].replace(".", ":")}`,
    visitRangeMatch && `ช่วงตรวจ ${visitRangeMatch[1].replace(".", ":")}-${visitRangeMatch[2].replace(".", ":")}`,
    contactMatch && `ติดต่อ ${contactMatch[1]} ต่อ ${contactMatch[2]}`,
  ].filter(Boolean);
  if (parts.length) return parts.join(" | ");

  const lines = compact
    .split(/\r?\n/)
    .map((line) => cleanValue(line))
    .filter(Boolean);
  const useful = lines.filter((line) => {
    if (/^(หมาย|Visit ID|HN\s*:|วันที่นัดตรวจ|แพทย์ตรวจ)/i.test(line)) return false;
    if (details.place && line.includes(details.place)) return false;
    if (details.department && line.includes(details.department)) return false;
    return line.length > 4;
  });
  return useful.slice(0, 3).join(" | ").slice(0, 260);
}

function summarizeOcrNote(text) {
  const parts = [];
  const dateMatch = text.match(/(?:วันที่นัดตรวจ|นัดหมาย|นัดหมาย\s*:?\s*วันที่)\s*[:：]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i);
  const timeMatch = text.match(/เวลา\s*(\d{1,2}[.:]\d{2})(?:\s*[-–]\s*(\d{1,2}[.:]\d{2}))?/i);
  const clinicMatch = text.match(/(คลินิก[^|,]*?อาคาร\s*150\s*ปี\s*ชั้น\s*\d+)/i);
  const labMatch = text.match(/(รายการตรวจ(?:ทาง)?ห้องปฏิบัติการ|Laboratory|ห้องปฏิบัติการ)/i);
  const prepMatch = text.match(/(\*{2,3}[^*]*(?:งดอาหาร|น้ำเปล่า|ยาความดัน)[^*]*\*{0,3})/i);
  const contactMatch = text.match(/โทร\s*([0-9-]+)\s*ต่อ\s*([0-9]+)/i);

  if (dateMatch) parts.push(`วันนัด ${dateMatch[1]}`);
  if (timeMatch) parts.push(`เวลา ${timeMatch[1].replace(".", ":")}${timeMatch[2] ? `-${timeMatch[2].replace(".", ":")}` : ""}`);
  if (clinicMatch) parts.push(cleanValue(clinicMatch[1]));
  if (labMatch) parts.push("ตรวจห้องปฏิบัติการ");
  if (prepMatch) parts.push(cleanValue(prepMatch[1].replace(/\*/g, "")));
  if (contactMatch) parts.push(`ติดต่อ ${contactMatch[1]} ต่อ ${contactMatch[2]}`);
  return [...new Set(parts)].join(" | ").slice(0, 320);
}

function cleanDoctorName(value) {
  return cleanValue(value).replace(/^แพทย์(?:ผู้ตรวจ|ตรวจ)?\s*[:：]?\s*/i, "");
}

function extractUsefulAppointmentText(text) {
  const compact = normalizeOcrText(text).replace(/\s+/g, " ").trim();
  const patterns = [
    /นัดหมาย\s*:?.*?(?=หมายเหตุ|รายการตรวจ|วันที่นัดตรวจ|$)/i,
    /รายการตรวจ(?:ทาง)?ห้องปฏิบัติการ.*?(?=$)/i,
    /คลินิก\s*:?.*?(?=หมายเหตุ|ติดต่อสอบถาม|ทำบัตร|QRCODE|$)/i,
  ];
  const blocks = patterns
    .map((pattern) => compact.match(pattern)?.[0])
    .filter(Boolean)
    .map((block) => cleanValue(block));
  return blocks.join(" | ").slice(0, 420);
}

function cleanValue(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([:,.])/g, "$1")
    .replace(/^[\s:：|-]+|[\s:：|-]+$/g, "")
    .trim();
}

function applyOcrDictionary(text) {
  return ocrDictionary.reduce((result, entry) => {
    if (!entry.wrong) return result;
    return result.split(entry.wrong).join(entry.correct);
  }, String(text || ""));
}

function addCorrectionFromInputs() {
  const wrong = wrongWordInput.value.trim();
  const correct = correctWordInput.value.trim();
  if (!wrong || !correct) return;
  addOcrCorrection(wrong, correct);
  wrongWordInput.value = "";
  correctWordInput.value = "";
}

function addOcrCorrection(wrong, correct) {
  const existing = ocrDictionary.find((entry) => entry.wrong === wrong);
  if (existing) {
    existing.correct = correct;
  } else {
    ocrDictionary.push({ wrong, correct });
  }
  saveOcrDictionary();
  renderDictionary();
}

function removeOcrCorrection(wrong) {
  ocrDictionary = ocrDictionary.filter((entry) => entry.wrong !== wrong);
  saveOcrDictionary();
  renderDictionary();
}

function renderDictionary() {
  dictionaryList.replaceChildren();
  if (!ocrDictionary.length) {
    dictionaryList.innerHTML = `<p class="empty-dictionary">ยังไม่มีคำแก้</p>`;
    return;
  }
  ocrDictionary.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "dictionary-row";
    row.innerHTML = `
      <span><strong>${escapeHtml(entry.wrong)}</strong> → ${escapeHtml(entry.correct)}</span>
      <button class="secondary-button" type="button">ลบ</button>
    `;
    row.querySelector("button").addEventListener("click", () => removeOcrCorrection(entry.wrong));
    dictionaryList.append(row);
  });
}

function learnCorrectionsFromForm(item) {
  if (!item.rawText) return;
  const parsed = parseAppointmentText(item.rawText);
  [
    ["place", item.place, parsed.place],
    ["department", item.department, parsed.department],
    ["doctor", item.doctor, parsed.doctor],
  ].forEach(([, corrected, original]) => {
    const cleanOriginal = cleanValue(original);
    const cleanCorrected = cleanValue(corrected);
    if (!cleanOriginal || !cleanCorrected) return;
    if (cleanOriginal === cleanCorrected) return;
    if (cleanOriginal.length > 80 || cleanCorrected.length > 80) return;
    addOcrCorrection(cleanOriginal, cleanCorrected);
  });
}

async function handleOcrImage(event) {
  const file = event.target.files[0];
  if (!file) return;

  setOcrProgress(4, "กำลังเตรียมอ่านภาพ...");
  try {
    pendingImageData = await imageFileToDataUrl(file);
    setOcrProgress(6, `กำลังครอปภาพ: ${ocrCropModeInput.selectedOptions[0].textContent}`);
    const ocrImage = await prepareImageForOcr(file, ocrCropModeInput.value);
    if (!window.Tesseract) {
      throw new Error("Tesseract is not loaded");
    }

    const result = await window.Tesseract.recognize(ocrImage, "tha+eng", {
      logger: (message) => {
        if (message.status === "loading tesseract core") {
          setOcrProgress(8, "กำลังโหลดตัวอ่านภาพ...");
        }
        if (message.status === "loading language traineddata") {
          setOcrProgress(Math.round((message.progress || 0) * 40) + 10, "กำลังโหลดภาษาไทย...");
        }
        if (message.status === "initializing api") {
          setOcrProgress(55, "กำลังเริ่ม OCR...");
        }
        if (message.status === "recognizing text") {
          setOcrProgress(Math.round((message.progress || 0) * 40) + 58, "กำลังอ่านข้อความจากภาพ...");
        }
      },
    });

    ocrText.value = applyOcrDictionary(result.data.text.trim());
    if (!ocrText.value) {
      setOcrProgress(100, "อ่านภาพแล้ว แต่ไม่พบข้อความ ลองภาพที่ชัดขึ้น");
      return;
    }

    const parsedItems = parseAppointmentItems(ocrText.value).map((item) => ({ ...item, rawText: ocrText.value }));
    fillFormFromParsed(parsedItems[0] || emptyParsedAppointment(ocrText.value));

    if (autoSaveOcrInput.checked && parsedItems.length) {
      const savedCount = await saveParsedAppointments(parsedItems, pendingImageData);
      if (savedCount) {
        setOcrProgress(100, parsedItems.length > 1 ? `อ่านภาพเสร็จแล้ว บันทึกเป็นใบเดียว มี ${parsedItems.length} รายการย่อย` : "อ่านภาพเสร็จแล้ว บันทึกแล้ว");
        setTimeout(() => hideOcrProgress(), 1200);
        return;
      }
      setOcrProgress(100, "อ่านข้อความแล้ว แต่ยังจับรายละเอียดนัดไม่ได้ กรุณาถ่ายใกล้เฉพาะกรอบนัด หรือกรอกเพิ่มแล้วกดบันทึก");
      return;
    }

    setOcrProgress(
      100,
      parsedItems.length > 1
        ? `อ่านภาพเสร็จแล้ว พบ ${parsedItems.length} รายการ`
        : "อ่านข้อความแล้ว ถ้ารายการยังไม่ขึ้น ให้ตรวจวันที่แล้วกดบันทึกนัด"
    );
    setTimeout(() => hideOcrProgress(), 900);
  } catch (error) {
    setOcrProgress(0, "อ่านภาพไม่สำเร็จ ตรวจเน็ตแล้วรีโหลดหน้า หรือวางข้อความเอง");
  } finally {
    event.target.value = "";
  }
}

async function prepareImageForOcr(file, mode) {
  const image = await loadImageFromFile(file);
  const crop = getCropRect(image, mode);
  const maxWidth = 1800;
  const scale = Math.min(1, maxWidth / crop.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(crop.width * scale);
  canvas.height = Math.round(crop.height * scale);

  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.filter = "grayscale(1) contrast(1.35)";
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob || file), "image/png", 0.95);
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Cannot load image"));
    image.src = URL.createObjectURL(file);
  });
}

function getCropRect(image, mode) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const presets = {
    table: { x: 0.02, y: 0.03, width: 0.78, height: 0.50 },
    plan: { x: 0.02, y: 0.02, width: 0.96, height: 0.78 },
    auto: { x: 0.02, y: 0.02, width: 0.96, height: 0.82 },
    full: { x: 0, y: 0, width: 1, height: 1 },
  };
  const preset = presets[mode] || presets.auto;
  return {
    x: Math.round(width * preset.x),
    y: Math.round(height * preset.y),
    width: Math.round(width * preset.width),
    height: Math.round(height * preset.height),
  };
}

function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("Cannot read image")));
    reader.readAsDataURL(file);
  });
}

function fillFormFromParsed(parsed) {
  Object.entries(parsed).forEach(([key, value]) => {
    if (fields[key] && value) fields[key].value = value;
  });
  updateDateHint();
}

async function saveParsedAppointments(parsedItems, imageData = "") {
  const validItems = parsedItems.filter((item) => item.date && (item.time || item.department || item.note));
  if (!validItems.length) return 0;

  const now = new Date().toISOString();
  const primary = validItems[0];
  const newAppointment = {
    id: crypto.randomUUID(),
    date: primary.date,
    time: earliestTime(validItems),
    place: primary.place || "โรงพยาบาล",
    department: combinedDepartments(validItems),
    doctor: primary.doctor || "",
    status: primary.status || "pending",
    note: combinedNotes(validItems),
    rawText: primary.rawText || "",
    tasks: validItems.map((item) => ({
      date: item.date,
      time: item.time || "00:00",
      department: item.department || "นัดหมาย",
      doctor: item.doctor || "",
      note: item.note || "",
    })),
    imageData,
    createdAt: now,
    updatedAt: now,
  };

  appointments.push(newAppointment);
  persist();
  resetForm();
  render();
  await pushToGoogleSheet();
  return 1;
}

function earliestTime(items) {
  const times = items.map((item) => item.time).filter(Boolean).sort();
  return times[0] || "00:00";
}

function combinedDepartments(items) {
  const departments = [...new Set(items.map((item) => cleanValue(item.department)).filter(Boolean))];
  return departments.join(" + ") || "นัดหมาย";
}

function combinedNotes(items) {
  return items
    .map((item) => cleanValue([item.department, item.time && formatTime(item.time), item.note].filter(Boolean).join(" - ")))
    .filter(Boolean)
    .join(" | ")
    .slice(0, 600);
}

function isReadyToSave() {
  return Boolean(fields.date.value && fields.time.value && fields.place.value.trim());
}

function setOcrProgress(percent, text) {
  ocrProgress.hidden = false;
  ocrProgressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  ocrProgressText.textContent = text;
}

function hideOcrProgress() {
  ocrProgress.hidden = true;
  ocrProgressBar.style.width = "0%";
}

function normalizeOcrText(text) {
  return text
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[|]/g, "1")
    .replace(/[—–]/g, "-");
}

function normalizeThaiDate(match) {
  let year = Number(match[3]);
  if (year > 2400) year -= 543;
  if (year < 100) year += 2000;
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function normalizeThaiTextDate(match) {
  const monthMap = {
    "ม.ค.": 1,
    "มกราคม": 1,
    "ก.พ.": 2,
    "กุมภาพันธ์": 2,
    "มี.ค.": 3,
    "มีนาคม": 3,
    "เม.ย.": 4,
    "เมษายน": 4,
    "พ.ค.": 5,
    "พฤษภาคม": 5,
    "มิ.ย.": 6,
    "มิถุนายน": 6,
    "ก.ค.": 7,
    "กรกฎาคม": 7,
    "ส.ค.": 8,
    "สิงหาคม": 8,
    "ก.ย.": 9,
    "กันยายน": 9,
    "ต.ค.": 10,
    "ตุลาคม": 10,
    "พ.ย.": 11,
    "พฤศจิกายน": 11,
    "ธ.ค.": 12,
    "ธันวาคม": 12,
  };
  let year = Number(match[3]);
  if (year > 2400) year -= 543;
  if (year < 100) year += 2000;
  const month = monthMap[match[2]];
  return `${year}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function updateDateHint() {
  dateHint.textContent = fields.date.value
    ? `วันนัด: ${formatDate(fields.date.value)} (${daySummary(fields.date.value)})`
    : "เลือกวันที่แล้วระบบจะคำนวณจำนวนวันให้อัตโนมัติ";
}

function daySummary(value) {
  const days = daysUntil(value);
  if (days === null) return "-";
  if (days === 0) return "วันนี้";
  if (days > 0) return `อีก ${days} วัน`;
  return `เลยมาแล้ว ${Math.abs(days)} วัน`;
}

function dayClass(value) {
  const days = daysUntil(value);
  if (days === 0) return "today";
  if (days !== null && days < 0) return "overdue";
  return "";
}

function daysUntil(value) {
  if (!value) return null;
  const today = startOfDay(new Date());
  const appointmentDate = dateFromInput(value);
  return Math.round((appointmentDate - today) / 86400000);
}

async function pushToGoogleSheet() {
  const url = localStorage.getItem(SCRIPT_URL_KEY);
  if (!url) return;

  syncStatus.textContent = "กำลังซิงก์";
  try {
    await fetch(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "replaceAll", appointments }),
    });
    syncStatus.textContent = "ซิงก์แล้ว";
  } catch (error) {
    syncStatus.textContent = "ซิงก์ไม่สำเร็จ";
  }
}

async function syncAppointmentToGoogle(id) {
  const url = localStorage.getItem(SCRIPT_URL_KEY);
  if (!url) {
    alert("ใส่ Google Apps Script URL ก่อน");
    return;
  }
  const appointment = appointments.find((item) => item.id === id);
  if (!appointment) return;

  syncStatus.textContent = "กำลังส่ง Calendar/Drive";
  try {
    await postToAppsScript(url, { action: "syncOne", appointment });
    await pullFromGoogleSheet();
    syncStatus.textContent = "ส่ง Calendar/Drive แล้ว";
  } catch (error) {
    syncStatus.textContent = "ส่ง Calendar/Drive ไม่สำเร็จ";
  }
}

async function syncAllAppointmentsToGoogle() {
  const url = localStorage.getItem(SCRIPT_URL_KEY);
  if (!url) {
    alert("ใส่ Google Apps Script URL ก่อน");
    return;
  }
  syncStatus.textContent = "กำลังส่งทั้งหมด";
  try {
    await postToAppsScript(url, { action: "syncAll", appointments });
    await pullFromGoogleSheet();
    syncStatus.textContent = "ส่งทั้งหมดแล้ว";
  } catch (error) {
    syncStatus.textContent = "ส่งทั้งหมดไม่สำเร็จ";
  }
}

function postToAppsScript(url, payload) {
  return fetch(url, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
}

async function pullFromGoogleSheet() {
  const url = localStorage.getItem(SCRIPT_URL_KEY);
  if (!url) {
    updateSyncStatus();
    return;
  }

  syncStatus.textContent = "กำลังโหลด";
  try {
    const data = await jsonp(`${url}?action=list`);
    appointments = Array.isArray(data.appointments) ? normalizeLoadedAppointments(data.appointments) : appointments;
    persist();
    render();
    syncStatus.textContent = "โหลดแล้ว";
  } catch (error) {
    syncStatus.textContent = "โหลดไม่สำเร็จ";
  }
}

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `doctorAppointmentsCallback_${Date.now()}`;
    const separator = url.includes("?") ? "&" : "?";
    const script = document.createElement("script");

    window[callbackName] = (data) => {
      delete window[callbackName];
      script.remove();
      resolve(data);
    };

    script.onerror = () => {
      delete window[callbackName];
      script.remove();
      reject(new Error("JSONP request failed"));
    };

    script.src = `${url}${separator}callback=${callbackName}`;
    document.body.append(script);
  });
}

function exportJson() {
  const blob = new Blob([JSON.stringify(appointments, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "doctor-appointments.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

function importJson(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data)) throw new Error("Expected an array");
      appointments = data;
      persist();
      render();
    } catch (error) {
      alert("ไฟล์ JSON ไม่ถูกต้อง");
    }
  });
  reader.readAsText(file);
  event.target.value = "";
}

function updateSyncStatus() {
  syncStatus.textContent = localStorage.getItem(SCRIPT_URL_KEY) ? "พร้อมซิงก์ Sheet" : "เก็บในเครื่อง";
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appointments));
}

function loadAppointments() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (error) {
    return [];
  }
}

function loadOcrDictionary() {
  const defaults = [
    { wrong: "มิถนายน", correct: "มิถุนายน" },
    { wrong: "มิ.ย", correct: "มิ.ย." },
    { wrong: "ปฎิบัติการ", correct: "ปฏิบัติการ" },
    { wrong: "อายูรกรรม", correct: "อายุรกรรม" },
    { wrong: "เวชปฎิบัติ", correct: "เวชปฏิบัติ" },
    { wrong: "ศัลยกรรมกระดูกและข้อ", correct: "ศัลยกรรมกระดูกและข้อ" },
  ];
  try {
    const saved = JSON.parse(localStorage.getItem(OCR_DICTIONARY_KEY)) || [];
    const merged = [...defaults];
    saved.forEach((entry) => {
      if (!merged.some((defaultEntry) => defaultEntry.wrong === entry.wrong)) merged.push(entry);
    });
    return merged;
  } catch (error) {
    return defaults;
  }
}

function saveOcrDictionary() {
  localStorage.setItem(OCR_DICTIONARY_KEY, JSON.stringify(ocrDictionary));
}

function normalizeLoadedAppointments(items) {
  const normalized = [];
  items.forEach((item) => {
    const rawText = [item.place, item.department, item.doctor, item.note, item.rawText].filter(Boolean).join("\n");
    if (isBadGeneratedContactAppointment(item, rawText)) {
      return;
    }
    const looksLikeRawOcr =
      rawText.length > 140 &&
      /(นัดหมาย|วันที่นัดตรวจ|ทำบัตร|รายการตรวจ|คลินิก\s*:|ติดต่อสอบถาม|QRCODE|SCAN ME)/i.test(rawText);
    if (!looksLikeRawOcr) {
      normalized.push(cleanStoredAppointment(item));
      return;
    }

    const parsedItems = parseAppointmentItems(rawText);
    if (!parsedItems.length) {
      normalized.push(cleanStoredAppointment(item));
      return;
    }

    parsedItems.forEach((parsed, index) => {
      normalized.push({
        ...item,
        id: index === 0 ? item.id : crypto.randomUUID(),
        date: parsed.date || item.date,
        time: parsed.time || item.time,
        place: parsed.place || item.place,
        department: parsed.department || item.department,
        doctor: parsed.doctor || item.doctor,
        imageData: item.imageData || "",
        imageFileId: item.imageFileId || "",
        calendarEventId: item.calendarEventId || "",
        calendarHtmlLink: item.calendarHtmlLink || "",
        tasks: normalizeTaskList(item.tasks),
        status: item.status || parsed.status || "pending",
        note: parsed.note || item.note,
        rawText: item.rawText || rawText,
        updatedAt: new Date().toISOString(),
      });
    });
  });
  return mergeAppointmentsFromSameDocument(dedupeAppointments(normalized));
}

function cleanStoredAppointment(item) {
  const rawText = [item.place, item.department, item.doctor, item.note, item.rawText].filter(Boolean).join("\n");
  const details = extractStructuredDetails(rawText);
  const noteSummary = summarizeOcrNote(rawText);
  return {
    ...item,
    tasks: normalizeTaskList(item.tasks),
    place: isNoisyOcrBlob(item.place || "") ? details.place || "โรงพยาบาล" : item.place,
    department: isNoisyOcrBlob(item.department || "") ? details.department || "นัดหมาย" : item.department,
    doctor: isNoisyOcrBlob(item.doctor || "") ? details.doctor || "" : item.doctor,
    note: noteSummary || (isNoisyOcrBlob(item.note || "") ? "" : item.note),
    rawText: item.rawText || (isNoisyOcrBlob(rawText) ? rawText : ""),
  };
}

function normalizeTaskList(tasks) {
  if (Array.isArray(tasks)) return tasks;
  if (typeof tasks === "string" && tasks.trim()) {
    try {
      const parsed = JSON.parse(tasks);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }
  return [];
}

function isBadGeneratedContactAppointment(item, rawText) {
  const isOldCardDate = item.date === "2025-06-17" || item.date === "2568-06-17";
  const hasOnlyContactTime = /ช่วงตรวจ\s*14:00-15:30|ติดต่อ\s*038-320200/i.test(rawText);
  const hasNoRealAppointmentSignal = !/(นัดหมาย|วันที่นัด|วันที่นัดตรวจ|ยื่นใบนัด|รายการตรวจ)/i.test(rawText);
  return isOldCardDate && hasOnlyContactTime && hasNoRealAppointmentSignal;
}

function dedupeAppointments(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = [item.date, item.time, item.place, item.department, item.note].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeAppointmentsFromSameDocument(items) {
  const groups = new Map();
  const loose = [];
  items.forEach((item) => {
    const key = documentKey(item);
    if (!key) {
      loose.push(item);
      return;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  const merged = [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const sorted = [...group].sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
    const first = sorted[0];
    const tasks = sorted.flatMap((item) => item.tasks?.length ? item.tasks : [{
      date: item.date,
      time: item.time,
      department: item.department,
      doctor: item.doctor,
      note: item.note,
    }]);
    return {
      ...first,
      time: earliestTime(tasks),
      department: combinedDepartments(tasks),
      note: combinedNotes(tasks),
      rawText: first.rawText || sorted.find((item) => item.rawText)?.rawText || "",
      imageData: first.imageData || sorted.find((item) => item.imageData)?.imageData || "",
      tasks,
      updatedAt: new Date().toISOString(),
    };
  });

  return [...merged, ...loose].sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
}

function documentKey(item) {
  if (item.imageData) return `image:${item.imageData.slice(0, 120)}`;
  if (item.rawText) return `text:${item.rawText.slice(0, 180)}`;
  return "";
}

function repairStoredAppointments() {
  appointments = normalizeLoadedAppointments(appointments);
  persist();
  render();
  syncStatus.textContent = "จัดระเบียบแล้ว";
}

function dateFromInput(value) {
  const date = new Date(`${value}T00:00:00`);
  return startOfDay(date);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`));
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTime(value) {
  return value && value !== "00:00" ? value : "ไม่ระบุเวลา";
}

function isDriveImageUrl(value) {
  return /^https:\/\/drive\.google\.com\//i.test(String(value || ""));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
