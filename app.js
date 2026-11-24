// ==========================================
// 01. SUPABASE VERBINDUNG
// ==========================================

import { createClient } from
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

import {
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
} from "./config.js";

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);


// ==========================================
// 02. GLOBALE VARIABLEN
// ==========================================

const $ = id => document.getElementById(id);

const defaults = {
    hourly_rate: 0,
    currency: "EUR",
    work_days: [5, 6],
    default_break_minutes: 0,
    theme: "system"
};

let currentUser = null;

let settings = { ...defaults };
let entries = [];
let payments = [];

let dashboardMonth = new Date();
let calendarMonth = new Date();
let statisticsYear = new Date().getFullYear();

let selectedDay = null;
let settingsDirty = false;
let busy = false;
let refreshPromise = null;

let messageTimeout;

const monthNames = [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember"
];


// ==========================================
// 03. HILFSFUNKTIONEN
// ==========================================

function formatMoney(value) {

    return Number(value || 0).toLocaleString(
        "de-DE",
        {
            style: "currency",
            currency: "EUR"
        }
    );

}

function formatHours(minutes) {

    const total = Math.round(minutes);

    const hours = Math.floor(total / 60);
    const remaining = total % 60;

    return remaining
        ? `${hours} Std. ${remaining} Min.`
        : `${hours} Std.`;

}

function dateString(date) {

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");

}

function formatDate(value) {

    return new Date(
        value.slice(0, 10) + "T12:00:00"
    ).toLocaleDateString("de-DE");

}

function monthTitle(date) {

    return `${monthNames[date.getMonth()]} ${date.getFullYear()}`;

}

function monthKey(year, month) {

    return `${year}-${String(month).padStart(2, "0")}`;

}

function shiftMonth(date, amount) {

    return new Date(
        date.getFullYear(),
        date.getMonth() + amount,
        1
    );

}

function nextDay(value) {

    const date = new Date(value + "T12:00:00");

    date.setDate(date.getDate() + 1);

    return dateString(date);

}

function wallTime(value) {

    return Date.parse(value.slice(0, 19) + "Z");

}

function calculateMinutes(entry) {

    const start = wallTime(entry.start_time);
    const end = wallTime(entry.end_time);

    const minutes =
        (end - start) / 60000 -
        Number(entry.break_minutes);

    return Math.max(0, minutes);

}

function calculateSalary(entry) {

    const amount =
        calculateMinutes(entry) / 60 *
        Number(entry.hourly_rate);

    return Math.round(
        (amount + Number.EPSILON) * 100
    ) / 100;

}

function summarize(list) {

    return {
        minutes: list.reduce(
            (sum, entry) => sum + calculateMinutes(entry),
            0
        ),

        salary: list.reduce(
            (sum, entry) => sum + calculateSalary(entry),
            0
        ),

        breaks: list.reduce(
            (sum, entry) =>
                sum + Number(entry.break_minutes),
            0
        ),

        days: new Set(
            list.map(entry => entry.work_date)
        ).size
    };

}

function getMonthEntries(year, month) {

    const prefix = monthKey(year, month);

    return entries.filter(
        entry => entry.work_date.startsWith(prefix)
    );

}

function node(tag, className = "", text = "") {

    const element = document.createElement(tag);

    element.className = className;
    element.textContent = text;

    return element;

}

function actionButton(text, className, handler) {

    const button = node("button", className, text);

    button.type = "button";
    button.addEventListener("click", handler);

    return button;

}

function emptyState(container, text) {

    container.replaceChildren(
        node("p", "empty-state", text)
    );

}

async function result(query) {

    const { data, error } = await query;

    if (error) throw error;

    return data;

}

function showMessage(text, type = "success") {

    const element = $("app-message");

    element.textContent = text;
    element.className = type;

    clearTimeout(messageTimeout);

    messageTimeout = setTimeout(() => {
        element.textContent = "";
    }, 7000);

}

function loginMessage(text, type = "error") {

    $("login-message").textContent = text;
    $("login-message").className = type;

}

function updateSync(text, type = "") {

    $("sync-status").textContent = text;
    $("sync-status").className = type;

}


// ==========================================
// 04. ANMELDUNG
// ==========================================

$("login-form").addEventListener(
    "submit",
    async event => {

        event.preventDefault();

        const button = event.currentTarget
            .querySelector('button[type="submit"]');

        button.disabled = true;
        button.textContent = "Anmeldung läuft ...";

        loginMessage("");

        try {

            await result(
                supabase.auth.signInWithPassword({
                    email: $("login-email").value.trim(),
                    password: $("login-password").value
                })
            );

            $("login-password").value = "";

        } catch (error) {

            loginMessage(
                "Anmeldung fehlgeschlagen. " +
                error.message
            );

        } finally {

            button.disabled = false;
            button.textContent = "Anmelden";

        }

    }
);

async function activateUser(user) {

    if (!user) {

        currentUser = null;

        entries = [];
        payments = [];
        settings = { ...defaults };

        selectedDay = null;
        settingsDirty = false;

        $("login-screen").hidden = false;
        $("app").hidden = true;

        $("login-password").value = "";
        $("account-email").textContent = "";
        $("app-message").textContent = "";

        $("recent-entries").replaceChildren();
        $("entries-list").replaceChildren();
        $("payments-list").replaceChildren();
        $("calendar-grid").replaceChildren();
        $("calendar-day-details").replaceChildren();

        $("monthly-salary").textContent = "0,00 €";
        $("yearly-salary").textContent = "0,00 €";

        return;

    }

    if (currentUser?.id === user.id) return;

    currentUser = user;

    entries = [];
    payments = [];
    settings = { ...defaults };
    settingsDirty = false;
    selectedDay = null;

    $("account-email").textContent = user.email || "";

    resetEntryForm();
    renderAll();

    $("login-screen").hidden = true;
    $("app").hidden = false;

    showPage("dashboard");

    await refreshData();

    if (currentUser?.id === user.id) {
        resetEntryForm();
    }

}

supabase.auth.onAuthStateChange(
    (event, session) => {

        setTimeout(() => {

            activateUser(session?.user || null)
                .catch(error => {
                    loginMessage(error.message);
                });

        }, 0);

    }
);

$("logout-button").addEventListener(
    "click",
    async () => {

        if (!confirm("Möchtest du dich abmelden?")) {
            return;
        }

        try {

            await result(
                supabase.auth.signOut({
                    scope: "local"
                })
            );

        } catch (error) {

            showMessage(error.message, "error");

        }

    }
);


// ==========================================
// 05. DATEN LADEN UND SYNCHRONISIEREN
// ==========================================

async function loadAll(table, userId) {

    const rows = [];
    const pageSize = 500;

    for (let offset = 0; ; offset += pageSize) {

        const page = await result(
            supabase
                .from(table)
                .select("*")
                .eq("user_id", userId)
                .order("id")
                .range(offset, offset + pageSize - 1)
        );

        rows.push(...page);

        if (page.length < pageSize) break;

    }

    return rows;

}

async function refreshData(force = false) {

    if (!currentUser) return false;

    if (busy && !force) return false;

    if (refreshPromise) return refreshPromise;

    if (!navigator.onLine) {

        updateSync(
            "Offline – keine Synchronisierung möglich",
            "offline"
        );

        return false;

    }

    const userId = currentUser.id;

    refreshPromise = (async () => {

        try {

            updateSync("Synchronisierung läuft ...");

            const [
                savedSettings,
                savedEntries,
                savedPayments
            ] = await Promise.all([

                result(
                    supabase
                        .from("user_settings")
                        .select("*")
                        .eq("user_id", userId)
                        .maybeSingle()
                ),

                loadAll("work_entries", userId),

                loadAll("payments", userId)

            ]);

            if (currentUser?.id !== userId) {
                return false;
            }

            settings = {
                ...defaults,
                ...(savedSettings || {})
            };

            entries = savedEntries.sort(
                (a, b) =>
                    b.start_time.localeCompare(a.start_time)
            );

            payments = savedPayments;

            renderAll();

            if (
                !$("entry-id").value &&
                !$("entry-hourly-rate").value
            ) {

                $("entry-hourly-rate").value =
                    settings.hourly_rate;

            }

            updateSync(
                "Synchronisiert · " +
                new Date().toLocaleTimeString("de-DE"),
                "connected"
            );

            return true;

        } catch (error) {

            if (currentUser?.id === userId) {

                updateSync(
                    "Synchronisierung fehlgeschlagen",
                    "offline"
                );

                showMessage(error.message, "error");

            }

            return false;

        } finally {

            refreshPromise = null;

        }

    })();

    return refreshPromise;

}

async function saveOperation(operation, message) {

    if (busy || !currentUser) return false;

    if (!navigator.onLine) {

        showMessage(
            "Zum Speichern wird eine Internetverbindung benötigt.",
            "error"
        );

        return false;

    }

    busy = true;

    const userId = currentUser.id;

    try {

        if (refreshPromise) {
            await refreshPromise;
        }

        if (currentUser?.id !== userId) {
            throw new Error("Benutzer nicht mehr angemeldet.");
        }

        await operation(userId);

        if (currentUser?.id === userId) {

            const synchronized = await refreshData(true);

            showMessage(
                synchronized
                    ? message
                    : "Gespeichert, aber Datenabgleich fehlgeschlagen.",
                synchronized ? "success" : "error"
            );

        }

        return true;

    } catch (error) {

        showMessage(error.message, "error");

        return false;

    } finally {

        busy = false;

    }

}

window.addEventListener("online", () => {
    refreshData();
});

window.addEventListener("offline", () => {

    updateSync(
        "Offline – Änderungen können nicht gespeichert werden",
        "offline"
    );

});

document.addEventListener(
    "visibilitychange",
    () => {

        if (!document.hidden) {
            refreshData();
        }

    }
);

window.addEventListener("focus", () => {
    refreshData();
});

setInterval(() => {

    if (!document.hidden && currentUser) {
        refreshData();
    }

}, 30000);


// ==========================================
// 06. NAVIGATION
// ==========================================

function showPage(pageName) {

    document.querySelectorAll(".page")
        .forEach(page => {
            page.hidden = page.id !== pageName;
        });

    document.querySelectorAll(".nav-item")
        .forEach(button => {

            const active =
                button.dataset.page === pageName;

            button.classList.toggle("active", active);

            if (active) {
                button.setAttribute("aria-current", "page");
            } else {
                button.removeAttribute("aria-current");
            }

        });

    window.scrollTo({
        top: 0,
        behavior: "instant"
    });

}

document.querySelectorAll(".nav-item")
    .forEach(button => {

        button.addEventListener("click", () => {
            showPage(button.dataset.page);
        });

    });

$("quick-add-button").addEventListener(
    "click",
    () => {

        resetEntryForm();

        showPage("entries");

    }
);


// ==========================================
// 07. MONATSÜBERSICHT
// ==========================================

function renderDashboard() {

    const year = dashboardMonth.getFullYear();
    const month = dashboardMonth.getMonth() + 1;

    const list = getMonthEntries(year, month);
    const totals = summarize(list);

    $("current-month").textContent =
        monthTitle(dashboardMonth);

    $("monthly-salary").textContent =
        formatMoney(totals.salary);

    $("monthly-hours").textContent =
        formatHours(totals.minutes);

    $("monthly-days").textContent =
        totals.days;

    $("monthly-breaks").textContent =
        `${totals.breaks} Min.`;

    $("current-hourly-rate").textContent =
        formatMoney(settings.hourly_rate);

    const payment = payments.find(
        item => item.year === year &&
                item.month === month
    );

    const status = $("payment-status");

    status.classList.toggle(
        "paid",
        Boolean(payment?.paid)
    );

    status.textContent = payment?.paid

        ? `${formatMoney(payment.amount)} ausgezahlt`

        : "Noch keine Auszahlung erfasst";

    renderEntryList(
        $("recent-entries"),
        list.slice(0, 5),
        false
    );

}

$("previous-month").addEventListener(
    "click",
    () => {

        dashboardMonth = shiftMonth(dashboardMonth, -1);

        renderDashboard();

    }
);

$("next-month").addEventListener(
    "click",
    () => {

        dashboardMonth = shiftMonth(dashboardMonth, 1);

        renderDashboard();

    }
);


// ==========================================
// 08. ARBEITSZEITERFASSUNG
// ==========================================

function resetEntryForm(date = dateString(new Date())) {

    $("entry-form").reset();

    $("entry-id").value = "";
    $("work-date").value = date;

    $("start-time").value = "";
    $("end-time").value = "";

    $("overnight").checked = false;

    $("break-minutes").value =
        settings.default_break_minutes;

    $("entry-hourly-rate").value =
        settings.hourly_rate;

    $("entry-notes").value = "";

    $("entry-form-title").textContent =
        "Neue Arbeitszeit";

    $("cancel-edit").hidden = true;

    updateCalculationPreview();

}

function readEntryForm() {

    const date = $("work-date").value;
    const start = $("start-time").value;
    const end = $("end-time").value;

    const overnight = $("overnight").checked;

    const breakMinutes =
        Number($("break-minutes").value);

    const hourlyRate =
        Number($("entry-hourly-rate").value);

    if (!date || !start || !end) {

        throw new Error(
            "Bitte Datum, Arbeitsbeginn und Arbeitsende eintragen."
        );

    }

    if (
        !Number.isInteger(breakMinutes) ||
        breakMinutes < 0 ||
        !Number.isFinite(hourlyRate) ||
        hourlyRate < 0 ||
        $("break-minutes").value === "" ||
        $("entry-hourly-rate").value === ""
    ) {

        throw new Error(
            "Bitte gültige Pausenzeit und Stundenlohn eingeben."
        );

    }

    const entry = {

        work_date: date,

        start_time: `${date}T${start}:00`,

        end_time:
            `${overnight ? nextDay(date) : date}T${end}:00`,

        break_minutes: breakMinutes,

        hourly_rate: hourlyRate,

        notes: $("entry-notes").value.trim()

    };

    const duration =
        (wallTime(entry.end_time) -
         wallTime(entry.start_time)) / 60000;

    if (
        !Number.isFinite(duration) ||
        duration <= 0
    ) {

        throw new Error(
            "Das Arbeitsende muss nach dem Arbeitsbeginn liegen."
        );

    }

    if (breakMinutes > duration) {

        throw new Error(
            "Die Pause darf nicht länger als die Arbeitszeit sein."
        );

    }

    return entry;

}

function updateCalculationPreview() {

    try {

        const entry = readEntryForm();

        $("calculated-hours").textContent =
            formatHours(calculateMinutes(entry));

        $("calculated-salary").textContent =
            formatMoney(calculateSalary(entry));

    } catch {

        $("calculated-hours").textContent = "–";
        $("calculated-salary").textContent = "–";

    }

}

$("entry-form").addEventListener(
    "input",
    updateCalculationPreview
);

$("entry-form").addEventListener(
    "change",
    updateCalculationPreview
);

$("entry-form").addEventListener(
    "submit",
    async event => {

        event.preventDefault();

        if (busy) return;

        let entry;

        try {

            entry = readEntryForm();

        } catch (error) {

            showMessage(error.message, "error");

            return;

        }

        const id = $("entry-id").value;

        const overlapping = entries.some(item =>

            item.id !== id &&

            wallTime(entry.start_time) <
                wallTime(item.end_time) &&

            wallTime(entry.end_time) >
                wallTime(item.start_time)

        );

        if (overlapping) {

            const confirmed = confirm(
                "Diese Schicht überschneidet sich mit " +
                "einer bereits erfassten Arbeitszeit. " +
                "Trotzdem speichern?"
            );

            if (!confirmed) return;

        }

        const saved = await saveOperation(
            async userId => {

                if (id) {

                    const updated = await result(
                        supabase
                            .from("work_entries")
                            .update(entry)
                            .eq("id", id)
                            .eq("user_id", userId)
                            .select("id")
                    );

                    if (!updated.length) {

                        throw new Error(
                            "Der Eintrag wurde nicht gefunden."
                        );

                    }

                } else {

                    await result(
                        supabase
                            .from("work_entries")
                            .insert({
                                ...entry,
                                user_id: userId
                            })
                    );

                }

            },
            "Arbeitszeit erfolgreich gespeichert."
        );

        if (saved && currentUser) {

            resetEntryForm();

        }

    }
);

function editEntry(id) {

    const entry = entries.find(
        item => item.id === id
    );

    if (!entry) return;

    $("entry-id").value = entry.id;

    $("work-date").value = entry.work_date;

    $("start-time").value =
        entry.start_time.slice(11, 16);

    $("end-time").value =
        entry.end_time.slice(11, 16);

    $("overnight").checked =
        entry.start_time.slice(0, 10) !==
        entry.end_time.slice(0, 10);

    $("break-minutes").value =
        entry.break_minutes;

    $("entry-hourly-rate").value =
        entry.hourly_rate;

    $("entry-notes").value =
        entry.notes || "";

    $("entry-form-title").textContent =
        "Arbeitszeit bearbeiten";

    $("cancel-edit").hidden = false;

    updateCalculationPreview();

    showPage("entries");

}

async function deleteEntry(id) {

    if (!confirm(
        "Möchtest du diese Arbeitszeit wirklich löschen?"
    )) return;

    const saved = await saveOperation(

        async userId => {

            await result(
                supabase
                    .from("work_entries")
                    .delete()
                    .eq("id", id)
                    .eq("user_id", userId)
            );

        },

        "Arbeitszeit gelöscht."

    );

    if (saved && $("entry-id").value === id) {

        resetEntryForm();

    }

}

$("cancel-edit").addEventListener(
    "click",
    () => resetEntryForm()
);


// ==========================================
// 09. ARBEITSZEITLISTEN
// ==========================================

function renderEntryList(
    container,
    list,
    editable = true
) {

    container.replaceChildren();

    if (!list.length) {

        emptyState(
            container,
            "Noch keine Arbeitszeiten erfasst."
        );

        return;

    }

    list.forEach(entry => {

        const date = new Date(
            entry.work_date + "T12:00:00"
        );

        const item = node("div", "entry-item");

        const dateBox = node("div", "entry-date");

        dateBox.append(

            node(
                "span",
                "",
                date.toLocaleDateString(
                    "de-DE",
                    { weekday: "short" }
                )
            ),

            node("strong", "", date.getDate())

        );

        const info = node("div", "entry-info");

        const overnight =
            entry.start_time.slice(0, 10) !==
            entry.end_time.slice(0, 10);

        const time =
            entry.start_time.slice(11, 16) +
            " – " +
            entry.end_time.slice(11, 16) +
            (overnight ? " (+1 Tag)" : "");

        info.append(

            node("h4", "", time),

            node(
                "p",
                "",
                formatDate(entry.work_date) +
                " · " +
                formatHours(calculateMinutes(entry))
            ),

            node(
                "p",
                "",
                `${entry.break_minutes} Min. Pause`
            ),

            node(
                "p",
                "",
                `${formatMoney(entry.hourly_rate)} / Std.`
            )

        );

        if (entry.notes) {

            info.append(
                node("p", "entry-meta", entry.notes)
            );

        }

        const amount = node(
            "div",
            "entry-amount",
            formatMoney(calculateSalary(entry))
        );

        item.append(dateBox, info, amount);

        if (editable) {

            const actions = node(
                "div",
                "entry-actions"
            );

            actions.append(

                actionButton(
                    "Bearbeiten",
                    "",
                    () => editEntry(entry.id)
                ),

                actionButton(
                    "Löschen",
                    "delete-button",
                    () => deleteEntry(entry.id)
                )

            );

            item.append(actions);

        }

        container.append(item);

    });

}

function renderEntries() {

    renderEntryList(
        $("entries-list"),
        entries,
        true
    );

}


// ==========================================
// 10. KALENDER
// ==========================================

function renderCalendar() {

    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();

    const firstDay = new Date(year, month, 1);

    const lastDay = new Date(
        year,
        month + 1,
        0
    ).getDate();

    const offset =
        (firstDay.getDay() + 6) % 7;

    const container = $("calendar-grid");

    container.replaceChildren();

    $("calendar-month").textContent =
        monthTitle(calendarMonth);

    for (let i = 0; i < offset; i++) {

        container.append(
            node("div", "calendar-day empty")
        );

    }

    for (let day = 1; day <= lastDay; day++) {

        const date = new Date(year, month, day);
        const value = dateString(date);

        const weekday = date.getDay() || 7;

        const dayEntries = entries.filter(
            entry => entry.work_date === value
        );

        const button = actionButton(

            String(day),

            "calendar-day",

            () => {

                selectedDay = value;

                renderCalendar();

            }

        );

        button.setAttribute(
            "aria-label",
            formatDate(value)
        );

        if (settings.work_days.includes(weekday)) {

            button.classList.add("workday");

        }

        if (dayEntries.length) {

            button.classList.add("has-entry");

            const minutes =
                summarize(dayEntries).minutes;

            button.append(

                node(
                    "small",
                    "",
                    `${(minutes / 60).toLocaleString(
                        "de-DE",
                        { maximumFractionDigits: 1 }
                    )} h`
                )

            );

        }

        if (value === dateString(new Date())) {

            button.classList.add("today");

        }

        if (value === selectedDay) {

            button.classList.add("selected");

        }

        container.append(button);

    }

    renderCalendarDetails();

}

function renderCalendarDetails() {

    const container = $("calendar-day-details");

    container.replaceChildren();

    if (!selectedDay) {

        emptyState(
            container,
            "Wähle einen Tag im Kalender aus."
        );

        return;

    }

    const list = entries.filter(
        entry => entry.work_date === selectedDay
    );

    container.append(
        node("h3", "", formatDate(selectedDay))
    );

    const details = node("div");

    renderEntryList(details, list, true);

    container.append(details);

    container.append(

        actionButton(

            "+ Arbeitszeit hinzufügen",

            "button primary",

            () => {

                resetEntryForm(selectedDay);

                showPage("entries");

            }

        )

    );

}

$("calendar-previous").addEventListener(
    "click",
    () => {

        calendarMonth = shiftMonth(calendarMonth, -1);

        selectedDay = null;

        renderCalendar();

    }
);

$("calendar-next").addEventListener(
    "click",
    () => {

        calendarMonth = shiftMonth(calendarMonth, 1);

        selectedDay = null;

        renderCalendar();

    }
);


// ==========================================
// 11. JAHRESSTATISTIKEN
// ==========================================

function renderStatistics() {

    const list = entries.filter(
        entry => entry.work_date.startsWith(
            String(statisticsYear) + "-"
        )
    );

    const totals = summarize(list);

    $("statistics-year").textContent =
        statisticsYear;

    $("yearly-salary").textContent =
        formatMoney(totals.salary);

    $("yearly-hours").textContent =
        formatHours(totals.minutes);

    $("yearly-days").textContent =
        totals.days;

    renderMonthlyChart();

    renderPayments();

}

function renderMonthlyChart() {

    const container = $("monthly-chart");

    container.replaceChildren();

    const values = monthNames.map(
        (_, index) => summarize(

            getMonthEntries(
                statisticsYear,
                index + 1
            )

        ).salary
    );

    const maximum = Math.max(1, ...values);

    values.forEach((amount, index) => {

        const row = node("div", "chart-row");

        const label = node(

            "span",

            "chart-label",

            monthNames[index].slice(0, 3)

        );

        const track = node("div", "chart-track");

        const bar = node("div", "chart-bar");

        bar.style.width =
            `${amount / maximum * 100}%`;

        track.append(bar);

        row.append(

            label,

            track,

            node(
                "span",
                "chart-value",
                formatMoney(amount)
            )

        );

        container.append(row);

    });

}

$("previous-year").addEventListener(
    "click",
    () => {

        if (statisticsYear > 2000) {

            statisticsYear--;

            renderStatistics();

        }

    }
);

$("next-year").addEventListener(
    "click",
    () => {

        statisticsYear++;

        renderStatistics();

    }
);


// ==========================================
// 12. LOHNAUSZAHLUNGEN
// ==========================================

function renderPayments() {

    const container = $("payments-list");

    container.replaceChildren();

    monthNames.forEach((name, index) => {

        const month = index + 1;

        const calculated = summarize(

            getMonthEntries(
                statisticsYear,
                month
            )

        ).salary;

        const payment = payments.find(
            item =>
                item.year === statisticsYear &&
                item.month === month
        );

        const row = node("div", "payment-item");

        const info = node("div");

        info.append(

            node("strong", "", name),

            node(
                "p",
                "entry-meta",
                "Berechnet: " + formatMoney(calculated)
            )

        );

        if (payment?.paid) {

            info.append(

                node(
                    "p",
                    "entry-meta",
                    "Ausgezahlt: " +
                    formatMoney(payment.amount)
                )

            );

            if (payment.payment_date) {

                info.append(

                    node(
                        "p",
                        "entry-meta",
                        formatDate(payment.payment_date)
                    )

                );

            }

        }

        const badge = node(

            "span",

            payment?.paid
                ? "payment-badge paid"
                : "payment-badge unpaid",

            payment?.paid
                ? "Ausgezahlt"
                : "Offen"

        );

        const button = actionButton(

            payment?.paid
                ? "Bearbeiten"
                : "Auszahlung erfassen",

            "button secondary",

            () => editPayment(
                statisticsYear,
                month,
                calculated,
                payment
            )

        );

        row.append(info, badge, button);

        container.append(row);

    });

}

async function editPayment(
    year,
    month,
    calculated,
    existing
) {

    const input = prompt(

        "Tatsächlich ausgezahlter Betrag in Euro.\n" +
        "Zum Zurücksetzen der Auszahlung bitte OFFEN eingeben.",

        String(
            existing?.amount ?? calculated.toFixed(2)
        ).replace(".", ",")

    );

    if (input === null) return;

    if (input.trim().toUpperCase() === "OFFEN") {

        if (!existing) return;

        await saveOperation(

            async userId => {

                await result(
                    supabase
                        .from("payments")
                        .update({
                            paid: false,
                            payment_date: null
                        })
                        .eq("id", existing.id)
                        .eq("user_id", userId)
                );

            },

            "Auszahlung zurückgesetzt."

        );

        return;

    }

    const amount = Number(
        input.trim().replace(",", ".")
    );

    if (
        !input.trim() ||
        !Number.isFinite(amount) ||
        amount < 0
    ) {

        showMessage(
            "Bitte einen gültigen Betrag eingeben.",
            "error"
        );

        return;

    }

    const paymentDate = prompt(

        "Auszahlungsdatum (JJJJ-MM-TT)",

        existing?.payment_date ||
        dateString(new Date())

    );

    if (paymentDate === null) return;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {

        showMessage(
            "Bitte ein gültiges Datum eingeben.",
            "error"
        );

        return;

    }

    await saveOperation(

        async userId => {

            await result(

                supabase
                    .from("payments")
                    .upsert({

                        user_id: userId,
                        year,
                        month,
                        amount,
                        paid: true,
                        payment_date: paymentDate

                    }, {

                        onConflict: "user_id,year,month"

                    })

            );

        },

        "Lohnauszahlung gespeichert."

    );

}


// ==========================================
// 13. PERSÖNLICHE EINSTELLUNGEN
// ==========================================

function applyTheme(theme) {

    document.documentElement.dataset.theme = theme;

    const quickTheme = $("quick-theme");
    if (quickTheme) quickTheme.value = theme;

    const dark =
        theme === "dark" ||
        (
            theme === "system" &&
            matchMedia(
                "(prefers-color-scheme: dark)"
            ).matches
        );

    document.querySelector(
        'meta[name="theme-color"]'
    ).content = dark ? "#101012" : "#f2f2f7";

}

function renderSettings() {

    if (settingsDirty) return;

    $("settings-hourly-rate").value =
        settings.hourly_rate;

    $("default-break").value =
        settings.default_break_minutes;

    $("theme-selection").value =
        settings.theme;

    document.querySelectorAll(
        'input[name="work-day"]'
    ).forEach(checkbox => {

        checkbox.checked =
            settings.work_days.includes(
                Number(checkbox.value)
            );

    });

    applyTheme(settings.theme);

}

$("settings-form").addEventListener(
    "input",
    () => {

        settingsDirty = true;

    }
);

$("theme-selection").addEventListener(
    "change",
    event => {

        settingsDirty = true;

        applyTheme(event.target.value);

    }
);

matchMedia(
    "(prefers-color-scheme: dark)"
).addEventListener("change", () => {

    applyTheme(
        document.documentElement.dataset.theme || "system"
    );

});

$("quick-theme")?.addEventListener(
    "change",
    async event => {

        const quickTheme = event.currentTarget;
        const theme = quickTheme.value;
        const previousTheme =
            document.documentElement.dataset.theme || settings.theme;
        const userId = currentUser?.id;

        if (!userId || busy ||
            !["light", "dark", "system"].includes(theme)) {
            applyTheme(previousTheme);
            return;
        }

        const themeSelection = $("theme-selection");
        const previousSelection = themeSelection.value;

        quickTheme.disabled = true;
        themeSelection.disabled = true;
        themeSelection.value = theme;
        applyTheme(theme);

        try {

            const saved = await saveOperation(
                async id => {
                    await result(
                        supabase
                            .from("user_settings")
                            .upsert(
                                { user_id: id, theme },
                                { onConflict: "user_id" }
                            )
                    );
                },
                "Erscheinungsbild gespeichert."
            );

            if (currentUser?.id !== userId) return;

            if (saved) {
                settings.theme = theme;
                themeSelection.value = theme;
                applyTheme(theme);
            } else {
                const restoredTheme = settingsDirty
                    ? previousSelection
                    : settings.theme;
                themeSelection.value = restoredTheme;
                applyTheme(restoredTheme);
            }

        } finally {
            quickTheme.disabled = false;
            themeSelection.disabled = false;
        }

    }
);

$("settings-form").addEventListener(
    "submit",
    async event => {

        event.preventDefault();

        const workDays = Array.from(

            document.querySelectorAll(
                'input[name="work-day"]:checked'
            )

        ).map(checkbox => Number(checkbox.value));

        const newSettings = {

            hourly_rate:
                Number($("settings-hourly-rate").value),

            default_break_minutes:
                Number($("default-break").value),

            work_days: workDays,

            theme: $("theme-selection").value,

            currency: "EUR"

        };

        if (

            !Number.isFinite(newSettings.hourly_rate) ||

            newSettings.hourly_rate < 0 ||

            !Number.isInteger(
                newSettings.default_break_minutes
            ) ||

            newSettings.default_break_minutes < 0

        ) {

            showMessage(
                "Bitte gültige Einstellungen eingeben.",
                "error"
            );

            return;

        }

        const saved = await saveOperation(

            async userId => {

                await result(

                    supabase
                        .from("user_settings")
                        .upsert({

                            ...newSettings,

                            user_id: userId

                        }, {

                            onConflict: "user_id"

                        })

                );

            },

            "Einstellungen gespeichert."

        );

        if (saved && currentUser) {

            settings = {
                ...settings,
                ...newSettings
            };

            settingsDirty = false;

            renderAll();

            if (!$("entry-id").value) {

                $("entry-hourly-rate").value =
                    settings.hourly_rate;

                $("break-minutes").value =
                    settings.default_break_minutes;

                updateCalculationPreview();

            }

        }

    }
);


// ==========================================
// 14. DATEIEN HERUNTERLADEN
// ==========================================

function downloadFile(content, filename, type) {

    const blob = new Blob(
        [content],
        { type }
    );

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.append(link);

    link.click();
    link.remove();

    setTimeout(() => {

        URL.revokeObjectURL(url);

    }, 10000);

}


// ==========================================
// 15. CSV-EXPORT
// ==========================================

function csvCell(value) {

    let text = String(value ?? "");

    // Schutz vor Tabellenkalkulationsformeln.

    if (/^[\s]*[=+\-@]/.test(text)) {

        text = "'" + text;

    }

    return '"' +
        text.replace(/"/g, '""') +
        '"';

}

$("export-csv").addEventListener(
    "click",
    () => {

        const rows = [[

            "Datum",
            "Arbeitsbeginn",
            "Arbeitsende",
            "Pause in Minuten",
            "Arbeitsstunden",
            "Stundenlohn",
            "Bruttolohn",
            "Notizen"

        ]];

        entries.forEach(entry => {

            rows.push([

                formatDate(entry.work_date),

                entry.start_time.replace("T", " "),

                entry.end_time.replace("T", " "),

                entry.break_minutes,

                (calculateMinutes(entry) / 60)
                    .toFixed(4)
                    .replace(".", ","),

                Number(entry.hourly_rate)
                    .toFixed(2)
                    .replace(".", ","),

                calculateSalary(entry)
                    .toFixed(2)
                    .replace(".", ","),

                entry.notes || ""

            ]);

        });

        const content = "\uFEFF" + rows.map(

            row => row.map(csvCell).join(";")

        ).join("\r\n");

        downloadFile(

            content,

            `Arbeitszeiten_${dateString(new Date())}.csv`,

            "text/csv;charset=utf-8"

        );

        showMessage("CSV-Export erstellt.");

    }
);


// ==========================================
// 16. PDF-EXPORT / DRUCKANSICHT
// ==========================================

$("export-pdf").addEventListener(
    "click",
    () => {

        const year = dashboardMonth.getFullYear();
        const month = dashboardMonth.getMonth() + 1;

        const list = getMonthEntries(year, month)
            .sort((a, b) =>

                a.start_time.localeCompare(b.start_time)

            );

        const totals = summarize(list);

        const printWindow = window.open(
            "",
            "_blank"
        );

        if (!printWindow) {

            showMessage(
                "Bitte Pop-ups für die Druckansicht erlauben.",
                "error"
            );

            return;

        }

        const doc = printWindow.document;

        doc.documentElement.lang = "de";

        doc.title =
            "Arbeitszeitnachweis – " +
            monthTitle(dashboardMonth);

        const style = doc.createElement("style");

        style.textContent = `
            body {
                font-family: Arial, sans-serif;
                padding: 25px;
                color: #111;
                background: white;
                font-size: 12px;
            }

            h1 {
                font-size: 25px;
                margin-bottom: 5px;
            }

            table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 25px;
            }

            th, td {
                padding: 10px 6px;
                border-bottom: 1px solid #ddd;
                text-align: left;
            }

            th {
                background: #eee;
            }

            tr {
                break-inside: avoid;
            }

            .summary {
                margin-top: 25px;
                line-height: 1.8;
                font-size: 14px;
            }

            @page {
                size: A4;
                margin: 15mm;
            }

            @media print {
                body {
                    padding: 0;
                }

                button {
                    display: none;
                }
            }
        `;

        doc.head.append(style);

        doc.body.replaceChildren();

        function add(tag, text, parent = doc.body) {

            const element = doc.createElement(tag);

            element.textContent = text;

            parent.append(element);

            return element;

        }

        add("h1", "Arbeitszeitnachweis");

        add("p", monthTitle(dashboardMonth));

        const table = add("table", "");

        const head = add("thead", "", table);
        const header = add("tr", "", head);

        [
            "Datum",
            "Beginn",
            "Ende",
            "Pause",
            "Arbeitszeit",
            "Bruttolohn"
        ].forEach(text => {

            add("th", text, header);

        });

        const tbody = add("tbody", "", table);

        list.forEach(entry => {

            const row = add("tr", "", tbody);

            const overnight =
                entry.start_time.slice(0, 10) !==
                entry.end_time.slice(0, 10);

            [

                formatDate(entry.work_date),

                entry.start_time.slice(11, 16),

                entry.end_time.slice(11, 16) +
                    (overnight ? " (+1)" : ""),

                `${entry.break_minutes} Min.`,

                formatHours(calculateMinutes(entry)),

                formatMoney(calculateSalary(entry))

            ].forEach(text => {

                add("td", text, row);

            });

        });

        const summary = add("div", "");

        summary.className = "summary";

        add(
            "p",
            `Arbeitstage: ${totals.days}`,
            summary
        );

        add(
            "p",
            `Arbeitszeit: ${formatHours(totals.minutes)}`,
            summary
        );

        add(
            "strong",
            `Gesamtbruttolohn: ${formatMoney(totals.salary)}`,
            summary
        );

        const printButton = add(
            "button",
            "Drucken / Als PDF speichern"
        );

        printButton.addEventListener(
            "click",
            () => printWindow.print()
        );

        printWindow.focus();
        printWindow.print();

    }
);


// ==========================================
// 17. DATENSICHERUNG
// ==========================================

$("export-backup").addEventListener(
    "click",
    async () => {

        if (!currentUser) return;

        const synchronized = await refreshData();

        if (!synchronized) {

            showMessage(
                "Datensicherung abgebrochen. " +
                "Bitte zuerst die Daten synchronisieren.",
                "error"
            );

            return;

        }

        const backup = {

            version: 1,

            exported_at: new Date().toISOString(),

            user_id: currentUser.id,

            settings,

            entries,

            payments

        };

        downloadFile(

            JSON.stringify(backup, null, 2),

            `Arbeitszeit_Backup_${dateString(new Date())}.json`,

            "application/json"

        );

        showMessage("Datensicherung erstellt.");

    }
);

$("import-backup").addEventListener(
    "click",
    () => $("backup-file").click()
);

$("backup-file").addEventListener(
    "change",
    async event => {

        const file = event.target.files[0];

        if (!file || !currentUser) return;

        try {

            const backup = JSON.parse(
                await file.text()
            );

            if (

                backup.version !== 1 ||

                backup.user_id !== currentUser.id ||

                !Array.isArray(backup.entries) ||

                !Array.isArray(backup.payments) ||

                !backup.settings

            ) {

                throw new Error(
                    "Diese Datensicherung ist ungültig " +
                    "oder gehört zu einem anderen Benutzerkonto."
                );

            }

            const confirmed = confirm(

                "Datensicherung wiederherstellen?\n\n" +

                `${backup.entries.length} Arbeitszeiten\n` +

                `${backup.payments.length} Auszahlungen\n\n` +

                "Fehlende Einträge werden ergänzt. " +

                "Vorhandene Einträge und Einstellungen " +

                "bleiben erhalten."

            );

            if (!confirmed) return;

            await saveOperation(

                async userId => {

                    const restoredEntries =
                        backup.entries.map(entry => ({

                            id: entry.id,

                            user_id: userId,

                            work_date: entry.work_date,

                            start_time: entry.start_time,

                            end_time: entry.end_time,

                            break_minutes: entry.break_minutes,

                            hourly_rate: entry.hourly_rate,

                            notes: entry.notes

                        }));

                    const restoredPayments =
                        backup.payments.map(payment => ({

                            id: payment.id,

                            user_id: userId,

                            year: payment.year,

                            month: payment.month,

                            amount: payment.amount,

                            paid: payment.paid,

                            payment_date: payment.payment_date,

                            notes: payment.notes

                        }));

                    try {

                        if (restoredEntries.length) {

                            await result(

                                supabase
                                    .from("work_entries")
                                    .upsert(restoredEntries, {

                                        onConflict: "id",

                                        ignoreDuplicates: true

                                    })

                            );

                        }

                        if (restoredPayments.length) {

                            await result(

                                supabase
                                    .from("payments")
                                    .upsert(restoredPayments, {

                                        onConflict:
                                            "user_id,year,month",

                                        ignoreDuplicates: true

                                    })

                            );

                        }

                        await result(

                            supabase
                                .from("user_settings")
                                .upsert({

                                    user_id: userId,

                                    hourly_rate:
                                        backup.settings.hourly_rate,

                                    currency: "EUR",

                                    work_days:
                                        backup.settings.work_days,

                                    default_break_minutes:
                                        backup.settings.default_break_minutes,

                                    theme: backup.settings.theme

                                }, {

                                    onConflict: "user_id",

                                    ignoreDuplicates: true

                                })

                        );

                    } catch (error) {

                        throw new Error(

                            "Wiederherstellung möglicherweise " +

                            "nur teilweise abgeschlossen: " +

                            error.message

                        );

                    }

                },

                "Datensicherung importiert."

            );

            await refreshData();

        } catch (error) {

            showMessage(error.message, "error");

        } finally {

            event.target.value = "";

        }

    }
);


// ==========================================
// 18. GESAMTE OBERFLÄCHE AKTUALISIEREN
// ==========================================

function renderAll() {

    renderDashboard();

    renderEntries();

    renderCalendar();

    renderStatistics();

    renderSettings();

}


// ==========================================
// 19. SERVICE WORKER
// ==========================================

if ("serviceWorker" in navigator) {

    window.addEventListener(
        "load",
        () => {

            navigator.serviceWorker
                .register("./sw.js")
                .catch(error => {

                    console.warn(
                        "Service Worker:",
                        error.message
                    );

                });

        }
    );

}


// ==========================================
// 20. INITIALISIERUNG
// ==========================================

resetEntryForm();

renderAll();

applyTheme("system");
