// ==========================================
// 01. SUPABASE VERBINDUNG
// ==========================================

import { createClient } from
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm";

import {
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
} from "./config.js";

const appUrl = new URL("./", import.meta.url);
const callbackUrl = new URL(window.location.href);
const callbackParams = new URLSearchParams(callbackUrl.hash.slice(1));
const recoveryRoute = callbackUrl.searchParams.get("recovery") === "1" ||
    callbackParams.get("type") === "recovery" ||
    ["otp_expired", "access_denied"].includes(callbackParams.get("error_code"));

let recoveryCredentials = null;
if (recoveryRoute) {
    if (callbackParams.get("type") === "recovery" &&
        !callbackParams.has("error") && !callbackParams.has("error_code") &&
        callbackParams.get("access_token") && callbackParams.get("refresh_token")) {
        recoveryCredentials = {
            access_token: callbackParams.get("access_token"),
            refresh_token: callbackParams.get("refresh_token")
        };
    }
    const cleanUrl = new URL(appUrl);
    cleanUrl.searchParams.set("recovery", "1");
    history.replaceState(null, "", cleanUrl);
    callbackUrl.hash = "";
    callbackUrl.search = "";
    for (const key of [...callbackParams.keys()]) callbackParams.delete(key);
}

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    recoveryRoute ? {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storageKey: "arbeitszeit-recovery"
        }
    } : { auth: { flowType: "implicit" } }
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
    theme: "system",
    glass_style: "solid",
    glass_intensity: 50,
    first_name: "",
    last_name: "",
    avatar_path: null
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
let pendingGlassStyle = null;
let pendingGlassIntensity = null;
let profileDirty = false;
let accountEpoch = 0;
let loginBusy = false;
let passkeyBusy = false;
let passwordBusy = false;
let avatarObjectUrl = null;
let avatarLoadedPath = null;
let avatarRequest = null;
let passkeyListRequest = null;
let entryFormBaseline = null;

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

// ==========================================
// ZENTRALE FEHLERMELDUNGEN
// ==========================================

class AppError extends Error {}

function errorText(error, fallback = "Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es erneut.", context = "") {
    if (error instanceof AppError) return error.message;

    const code = String(error?.code ?? "").toLowerCase();
    const name = String(error?.name ?? "");
    const message = String(error?.message ?? "").toLowerCase();
    const status = Number(error?.status ?? error?.statusCode ?? 0);

    // Keine Zugangsdaten, Fehlerobjekte oder Datenbankinhalte protokollieren.
    console.warn("Anwendungsfehler:", { code, name, status });

    if (code === "same_password" || message.includes("new password should be different")) {
        return "Das neue Passwort muss sich vom bisherigen Passwort unterscheiden.";
    }
    if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
        return context === "password"
            ? "Das aktuelle Passwort ist falsch."
            : "Die E-Mail-Adresse oder das Passwort ist falsch.";
    }
    if (context === "login" && ["user_not_found", "email_not_confirmed", "user_banned"].includes(code)) {
        return "Die E-Mail-Adresse oder das Passwort ist falsch.";
    }
    
    if (code === "current_password_required") {
        return "Bitte gib dein aktuelles Passwort ein.";
    }

    if (
        code === "current_password_mismatch" ||
        code === "current_password_invalid" ||
        (context === "password" &&
            message.includes("current password") &&
            /incorrect|invalid|wrong|does not match/.test(message))
    ) {
        return "Das aktuelle Passwort ist falsch.";
    }

    const messages = {
        weak_password: "Das neue Passwort erfüllt die Sicherheitsanforderungen nicht.",
        email_not_confirmed: "Die E-Mail-Adresse wurde noch nicht bestätigt.",
        email_address_invalid: "Bitte eine gültige E-Mail-Adresse eingeben.",
        signup_disabled: "Die öffentliche Registrierung ist deaktiviert.",
        session_expired: "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.",
        session_not_found: "Deine Sitzung ist nicht mehr gültig. Bitte melde dich erneut an.",
        refresh_token_not_found: "Bitte melde dich erneut an.",
        refresh_token_already_used: "Bitte melde dich erneut an.",
        bad_jwt: "Bitte melde dich erneut an.",
        invalidjwt: "Bitte melde dich erneut an.",
        pgrst301: "Bitte melde dich erneut an.",
        reauthentication_needed: "Bitte melde dich erneut an und versuche es noch einmal.",
        reauthentication_not_valid: "Die erneute Sicherheitsbestätigung ist fehlgeschlagen.",
        over_request_rate_limit: "Zu viele Anfragen. Bitte versuche es in einigen Minuten erneut.",
        request_timeout: "Die Anfrage hat zu lange gedauert. Bitte versuche es erneut.",
        databasetimeout: "Der Server antwortet zu langsam. Bitte versuche es erneut.",
        database_timeout: "Der Server antwortet zu langsam. Bitte versuche es erneut.",
        "42501": "Du hast keine Berechtigung für diese Aktion.",
        accessdenied: "Du hast keine Berechtigung für diese Aktion.",
        unauthorized: "Du hast keine Berechtigung für diese Aktion.",
        "23505": "Ein entsprechender Eintrag ist bereits vorhanden.",
        "23503": "Der zugehörige Datensatz fehlt oder wird noch benötigt.",
        "23514": "Die eingegebenen Werte sind ungültig.",
        "23502": "Eine erforderliche Angabe fehlt.",
        "22p02": "Eine Eingabe hat ein ungültiges Format.",
        "22007": "Das Datums- oder Zeitformat ist ungültig.",
        "22008": "Das Datum oder die Uhrzeit ist ungültig.",
        nosuchkey: "Die Datei wurde nicht gefunden oder ist nicht zugänglich.",
        nosuchbucket: "Der Dateispeicher ist nicht verfügbar oder nicht zugänglich.",
        not_found: "Die Datei oder der Eintrag wurde nicht gefunden oder ist nicht zugänglich.",
        entitytoolarge: "Die Datei ist zu groß.",
        invalidmimetype: "Dieses Dateiformat wird nicht unterstützt.",
        resourcealreadyexists: "Die Datei ist bereits vorhanden.",
        keyalreadyexists: "Die Datei ist bereits vorhanden.",
        already_exists: "Die Datei ist bereits vorhanden."
    };
    if (Object.hasOwn(messages, code)) return messages[code];

    if (name === "NotAllowedError" || name === "AbortError") {
        return "Der Vorgang wurde abgebrochen, nicht erlaubt oder hat zu lange gedauert.";
    }
    if (name === "InvalidStateError") return "Der Vorgang ist im aktuellen Zustand nicht möglich.";
    if (name === "NotSupportedError") return "Diese Funktion wird auf diesem Gerät oder Browser nicht unterstützt.";
    if (name === "SecurityError") return "Der Browser hat die Aktion aus Sicherheitsgründen blockiert.";
    if (name === "AuthSessionMissingError") return "Bitte melde dich erneut an.";
    if (name === "AuthWeakPasswordError") return "Das Passwort erfüllt die Sicherheitsanforderungen nicht.";
    if (name === "SyntaxError" && context === "backup") return "Die Datensicherung enthält ungültiges JSON.";
    if ((typeof navigator !== "undefined" && navigator.onLine === false) ||
        /failed to fetch|networkerror|network request failed|load failed|fetch failed/.test(message)) {
        return "Keine Verbindung zum Server möglich. Bitte überprüfe deine Internetverbindung.";
    }
    if (status === 429) return "Zu viele Anfragen. Bitte versuche es in einigen Minuten erneut.";
    if (status === 401) return context === "login" ? fallback : "Bitte melde dich erneut an.";
    if (status === 403) return "Du hast keine Berechtigung für diese Aktion.";
    if (status === 413) return "Die Datei ist zu groß.";
    if (status >= 500) return "Der Server ist momentan nicht erreichbar oder meldet einen Fehler. Bitte versuche es später erneut.";

    return fallback;
}

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

function supportsPasskeys() {
    return window.isSecureContext &&
        typeof window.PublicKeyCredential === "function" &&
        Boolean(navigator.credentials) &&
        typeof supabase.auth.signInWithPasskey === "function" &&
        typeof supabase.auth.registerPasskey === "function" &&
        typeof supabase.auth.passkey?.list === "function";
}

function setLoginBusy(value) {
    loginBusy = value;
    const button = $("login-form").querySelector('button[type="submit"]');
    button.disabled = value;
    button.textContent = value ? "Anmeldung läuft ..." : "Anmelden";
    $("passkey-login-button").disabled = value || !supportsPasskeys();
    $("forgot-password-button").disabled = value;
    const toggle = $("login-form").querySelector(".password-toggle");
    if (toggle) toggle.disabled = value;
    if (value) hidePasswordFields($("login-form"));
}

$("login-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (loginBusy || recoveryRoute || $("login-form").hidden) return;
    setLoginBusy(true);
    loginMessage("");
    try {
        await result(supabase.auth.signInWithPassword({
            email: $("login-email").value.trim(),
            password: $("login-password").value
        }));
        $("login-password").value = "";
    } catch (error) {
        loginMessage(errorText(error, "Anmeldung fehlgeschlagen. Bitte versuche es erneut.", "login"));
    } finally {
        setLoginBusy(false);
    }
});

$("passkey-login-button").addEventListener("click", async () => {
    if (loginBusy || recoveryRoute || $("login-form").hidden || !supportsPasskeys()) return;
    setLoginBusy(true);
    loginMessage("");
    try {
        await result(supabase.auth.signInWithPasskey());
        $("login-password").value = "";
    } catch (error) {
        loginMessage(errorText(error, "Passkey-Anmeldung fehlgeschlagen.") +
            " Du kannst dich weiterhin mit deinem Passwort anmelden.");
    } finally {
        setLoginBusy(false);
    }
});

function isActiveAccount(userId, epoch) {
    return Boolean(userId) && currentUser?.id === userId && accountEpoch === epoch;
}

async function activateUser(user) {
    if (user && currentUser?.id === user.id) {
        currentUser = user;
        $("account-email").textContent = user.email || "";
        return;
    }

    // Bei jedem Kontowechsel alte Daten und laufende Anzeigefunktionen invalidieren.
    accountEpoch++;
    const epoch = accountEpoch;
    currentUser = user || null;
    refreshPromise = null;
    entries = [];
    payments = [];
    settings = { ...defaults };
    selectedDay = null;
    settingsDirty = false;
    pendingGlassStyle = null;
    pendingGlassIntensity = null;
    profileDirty = false;
    dashboardMonth = new Date();
    calendarMonth = new Date();
    statisticsYear = new Date().getFullYear();

    $("app").hidden = true;
    $("floating-add-button").hidden = true;
    $("login-password").value = "";
    hidePasswordFields();
    if (!user) $("login-email").value = "";
    $("app-message").textContent = "";
    clearTimeout(messageTimeout);
    resetAccountUI();
    $("account-email").textContent = user?.email || "";
    applyTheme(defaults.theme);
    applyGlassStyle(defaults.glass_style);
    applyGlassIntensity(defaults.glass_intensity);
    resetEntryForm();
    renderAll();
    updateSync(user ? "Synchronisierung läuft ..." : "Nicht verbunden");

    $("login-screen").hidden = Boolean(user);
    if (!user) return;

    $("app").hidden = false;
    $("floating-add-button").hidden = false;
    showPage("dashboard");
    await refreshData(true);
    if (isActiveAccount(user.id, epoch) && !entryFormHasChanges()) {
        resetEntryForm();
    }
}

supabase.auth.onAuthStateChange(
    (event, session) => {
        if (recoveryRoute) return;

        setTimeout(() => {
            if (session?.user || currentUser) showAuthView("login");
            activateUser(session?.user || null)
                .catch(error => {
                    loginMessage(errorText(error, "Benutzerkonto konnte nicht geladen werden."));
                });
        }, 0);
    }
);

$("logout-button").addEventListener(
    "click",
    async () => {

        if (busy || passkeyBusy || passwordBusy) {
            showMessage("Bitte den laufenden Vorgang abschließen.", "error");
            return;
        }
        if (!confirm("Möchtest du dich abmelden?")) return;

        try {

            await result(
                supabase.auth.signOut({
                    scope: "local"
                })
            );

        } catch (error) {

            showMessage(errorText(error, "Abmeldung fehlgeschlagen. Bitte versuche es erneut."), "error");

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
    const epoch = accountEpoch;

    const request = Promise.resolve().then(async () => {

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

            if (!isActiveAccount(userId, epoch)) {
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

            if (isActiveAccount(userId, epoch)) {

                updateSync(
                    "Synchronisierung fehlgeschlagen",
                    "offline"
                );

                showMessage(errorText(error, "Synchronisierung fehlgeschlagen. Bitte versuche es erneut."), "error");

            }

            return false;

        } finally {

            if (refreshPromise === request) refreshPromise = null;

        }

    });

    refreshPromise = request;
    return request;

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
    const epoch = accountEpoch;

    try {

        if (refreshPromise) {
            await refreshPromise;
        }

        if (!isActiveAccount(userId, epoch)) {
            throw new AppError("Benutzer nicht mehr angemeldet.");
        }

        await operation(userId);

        if (!isActiveAccount(userId, epoch)) return false;
        const synchronized = await refreshData(true);
        if (!isActiveAccount(userId, epoch)) return false;
        showMessage(
            synchronized ? message : "Gespeichert, aber Datenabgleich fehlgeschlagen.",
            synchronized ? "success" : "error"
        );
        return true;

    } catch (error) {

        if (isActiveAccount(userId, epoch)) showMessage(errorText(error, "Speichern fehlgeschlagen. Bitte versuche es erneut."), "error");

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

function entryFormSnapshot() {
    return JSON.stringify([
        $("entry-id").value, $("work-date").value,
        $("start-time").value, $("end-time").value,
        $("overnight").checked, $("break-minutes").value,
        $("entry-hourly-rate").value, $("entry-notes").value
    ]);
}

function entryFormHasChanges() {
    return entryFormBaseline !== null && entryFormSnapshot() !== entryFormBaseline;
}

function confirmEntryDiscard() {
    return !entryFormHasChanges() || confirm("Ungespeicherte Arbeitszeit verwerfen?");
}

function openNewEntry(date = dateString(new Date())) {
    if (!currentUser || busy || !confirmEntryDiscard()) return;
    resetEntryForm(date);
    showPage("entries");
    $("work-date").focus({ preventScroll: true });
}

$("quick-add-button").addEventListener("click", () => openNewEntry());
$("floating-add-button").addEventListener("click", () => openNewEntry());

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
    entryFormBaseline = entryFormSnapshot();

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

        throw new AppError(
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

        throw new AppError(
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

        throw new AppError(
            "Das Arbeitsende muss nach dem Arbeitsbeginn liegen."
        );

    }

    if (breakMinutes > duration) {

        throw new AppError(
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

            showMessage(errorText(error), "error");

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

                        throw new AppError(
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

    if (!entry || busy || !confirmEntryDiscard()) return;

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
    entryFormBaseline = entryFormSnapshot();

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
    () => { if (!busy && confirmEntryDiscard()) resetEntryForm(); }
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

            () => openNewEntry(selectedDay)

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
    const dark = theme === "dark" ||
        (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);

    const quickTheme = $("quick-theme");
    if (quickTheme) {
        quickTheme.value = theme;
        const label = dark ? "Zum Hellmodus wechseln" : "Zum Dunkelmodus wechseln";
        quickTheme.setAttribute("aria-label", label);
        quickTheme.title = label;
    }

    document.querySelector('meta[name="theme-color"]').content =
        dark ? "#101012" : "#f2f2f7";
}

function applyGlassStyle(value) {
    const glassStyle = value === "glass" ? "glass" : "solid";
    document.documentElement.dataset.glassStyle = glassStyle;
    document.querySelectorAll('input[name="glass-style"]').forEach(radio => {
        radio.checked = radio.value === glassStyle;
    });
    updateGlassIntensityAvailability();
}

function renderSettings() {

    applyGlassStyle(
        pendingGlassStyle?.userId === currentUser?.id && pendingGlassStyle
            ? pendingGlassStyle.value
            : settings.glass_style
    );

    applyGlassIntensity(pendingGlassIntensity?.userId === currentUser?.id && pendingGlassIntensity
        ? pendingGlassIntensity.value : settings.glass_intensity);
    renderAccountProfile();
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

$("quick-theme")?.addEventListener("click", async event => {
    const quickTheme = event.currentTarget;
    const userId = currentUser?.id;
    const epoch = accountEpoch;
    if (!userId || busy || quickTheme.disabled) return;

    const previousTheme = document.documentElement.dataset.theme || settings.theme;
    const currentlyDark = previousTheme === "dark" ||
        (previousTheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    const theme = currentlyDark ? "light" : "dark";
    const themeSelection = $("theme-selection");
    const previousSelection = themeSelection.value;

    quickTheme.disabled = true;
    themeSelection.disabled = true;
    themeSelection.value = theme;
    applyTheme(theme);

    try {
        const saved = await saveOperation(
            id => updateUserSettings(id, { theme }),
            "Erscheinungsbild gespeichert."
        );

        if (!isActiveAccount(userId, epoch)) return;

        if (saved) {
            settings.theme = theme;
            themeSelection.value = theme;
            applyTheme(theme);
        } else {
            const restoredTheme = settingsDirty ? previousSelection : settings.theme;
            themeSelection.value = restoredTheme;
            applyTheme(restoredTheme);
        }
    } finally {
        quickTheme.disabled = false;
        themeSelection.disabled = false;
    }
});

// OBERFLÄCHENDESIGN AUTOMATISCH SPEICHERN

document.querySelectorAll('input[name="glass-style"]')
    .forEach(radio => {

        radio.addEventListener("change", async event => {

            const glassStyle = event.currentTarget.value;
            const userId = currentUser?.id;

            if (!userId || busy ||
                !["solid", "glass"].includes(glassStyle)) {
                applyGlassStyle(settings.glass_style);
                return;
            }

            const options = document.querySelectorAll(
                'input[name="glass-style"]'
            );

            pendingGlassStyle = { userId, value: glassStyle };
            options.forEach(option => option.disabled = true);
            applyGlassStyle(glassStyle);

            try {

                const saved = await saveOperation(
                    async id => {
                        await result(
                            supabase
                                .from("user_settings")
                                .upsert(
                                    { user_id: id, glass_style: glassStyle },
                                    { onConflict: "user_id" }
                                )
                        );
                    },
                    "Oberflächendesign gespeichert."
                );

                if (saved && currentUser?.id === userId) {
                    settings.glass_style = glassStyle;
                }

            } finally {
                if (pendingGlassStyle?.userId === userId) pendingGlassStyle = null;
                options.forEach(option => option.disabled = false);
                applyGlassStyle(settings.glass_style);
            }

        });

    });

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

            if (!$("entry-id").value && !entryFormHasChanges()) {

                $("entry-hourly-rate").value =
                    settings.hourly_rate;

                $("break-minutes").value =
                    settings.default_break_minutes;

                updateCalculationPreview();
                entryFormBaseline = entryFormSnapshot();

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
        const userId = currentUser.id;
        const epoch = accountEpoch;

        const synchronized = await refreshData();

        if (!isActiveAccount(userId, epoch)) return;
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

            // Profilbild-Datei und Zugangsdaten sind nicht Teil des JSON-Backups.
            settings: Object.fromEntries(Object.entries(settings)
                .filter(([key]) => key !== "avatar_path")),

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
        const userId = currentUser.id;
        const epoch = accountEpoch;

        try {

            const backup = JSON.parse(
                await file.text()
            );

            if (!isActiveAccount(userId, epoch)) return;
            if (

                backup.version !== 1 ||

                backup.user_id !== currentUser.id ||

                !Array.isArray(backup.entries) ||

                !Array.isArray(backup.payments) ||

                !backup.settings

            ) {

                throw new AppError(
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

                                    theme: backup.settings.theme,

                                    glass_style:
                                        backup.settings.glass_style === "glass"
                                            ? "glass"
                                            : "solid",
                                    glass_intensity: normalizeGlassIntensity(backup.settings.glass_intensity),
                                    first_name: normalizeProfileName(backup.settings.first_name),
                                    last_name: normalizeProfileName(backup.settings.last_name)

                                }, {

                                    onConflict: "user_id",

                                    ignoreDuplicates: true

                                })

                        );

                    } catch (error) {

                        throw new AppError(

                            "Wiederherstellung möglicherweise " +

                            "nur teilweise abgeschlossen: " +

                            errorText(error, "Bitte prüfe die vorhandenen Daten und versuche es erneut.")

                        );

                    }

                },

                "Datensicherung importiert."

            );

            await refreshData();

        } catch (error) {

            showMessage(errorText(error, "Datensicherung konnte nicht verarbeitet werden.", "backup"), "error");

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
// 20. GLASINTENSITÄT
// ==========================================

function normalizeGlassIntensity(value) {
    if (value === null || value === undefined || value === "") return 50;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 50;
}

function applyGlassIntensity(value) {
    const intensity = normalizeGlassIntensity(value);
    document.documentElement.style.setProperty("--glass-level", String(intensity / 100));
    $("glass-intensity").value = String(intensity);
    $("glass-intensity-value").textContent = `${intensity} %`;
    updateGlassIntensityAvailability();
}

function updateGlassIntensityAvailability() {
    $("glass-intensity").disabled = !currentUser ||
        document.documentElement.dataset.glassStyle !== "glass" ||
        Boolean(pendingGlassStyle) || Boolean(pendingGlassIntensity?.saving) ||
        matchMedia("(prefers-reduced-transparency: reduce)").matches ||
        !CSS.supports("color", "color-mix(in srgb, white, transparent)");
}

matchMedia("(prefers-reduced-transparency: reduce)")
    .addEventListener("change", updateGlassIntensityAvailability);

$("glass-intensity").addEventListener("input", event => {
    if (!currentUser) return;
    const value = normalizeGlassIntensity(event.currentTarget.value);
    pendingGlassIntensity = { userId: currentUser.id, value, saving: false };
    applyGlassIntensity(value);
});

$("glass-intensity").addEventListener("change", async event => {
    const userId = currentUser?.id;
    const epoch = accountEpoch;
    const value = normalizeGlassIntensity(event.currentTarget.value);
    if (!userId || pendingGlassIntensity?.saving) return;
    if (busy || value === normalizeGlassIntensity(settings.glass_intensity)) {
        pendingGlassIntensity = null;
        applyGlassIntensity(settings.glass_intensity);
        if (busy) showMessage("Bitte den laufenden Vorgang abschließen und erneut versuchen.", "error");
        return;
    }
    const pending = { userId, value, saving: true };
    pendingGlassIntensity = pending;
    applyGlassIntensity(value);
    try {
        const saved = await saveOperation(id => updateUserSettings(id, { glass_intensity: value }),
            "Glasintensität gespeichert.");
        if (saved && isActiveAccount(userId, epoch)) settings.glass_intensity = value;
    } finally {
        if (pendingGlassIntensity === pending) pendingGlassIntensity = null;
        if (isActiveAccount(userId, epoch)) applyGlassIntensity(settings.glass_intensity);
    }
});

async function updateUserSettings(userId, fields) {
    await result(supabase.from("user_settings").upsert(
        { user_id: userId, ...fields }, { onConflict: "user_id", defaultToNull: false }
    ));
}

// ==========================================
// 21. BENUTZERKONTO UND SICHERHEIT
// ==========================================

function accountMessage(id, text = "", type = "success") {
    const element = $(id);
    element.textContent = text;
    element.className = type;
    element.hidden = !text;
}

function normalizeProfileName(value) {
    return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

function ownedAvatarPath(path, userId) {
    return typeof path === "string" && Boolean(userId) &&
        path.startsWith(`${userId}/`) && /^[^/]+\/[a-zA-Z0-9_-]+\.jpg$/.test(path);
}

function clearAvatar() {
    avatarRequest = null;
    avatarLoadedPath = null;
    $("account-avatar-image").hidden = true;
    $("account-avatar-image").removeAttribute("src");
    $("account-initials").hidden = false;
    if (avatarObjectUrl) URL.revokeObjectURL(avatarObjectUrl);
    avatarObjectUrl = null;
}

function resetAccountUI() {
    clearAvatar();
    profileDirty = false;
    passkeyListRequest = null;
    for (const id of ["profile-form", "password-form"]) $(id).reset();
    for (const id of ["profile-details", "passkey-details", "password-details"]) $(id).open = false;
    for (const id of ["profile-message", "passkey-message", "password-message"]) accountMessage(id);
    $("passkey-list").replaceChildren();
    $("avatar-file").value = "";
    $("avatar-remove-button").hidden = true;
    $("account-name").textContent = "Name noch nicht hinterlegt";
    $("account-initials").textContent = "?";
    $("passkey-register-button").disabled = !supportsPasskeys() || !currentUser;
}

function renderAccountProfile() {
    const first = normalizeProfileName(settings.first_name);
    const last = normalizeProfileName(settings.last_name);
    const name = [first, last].filter(Boolean).join(" ");
    $("account-name").textContent = name || "Name noch nicht hinterlegt";
    $("account-email").textContent = currentUser?.email || "";
    $("account-initials").textContent = ([first, last].filter(Boolean)
        .map(part => Array.from(part)[0]).join("") ||
        Array.from(currentUser?.email || "?")[0]).toUpperCase();
    if (!profileDirty) {
        $("profile-first-name").value = first;
        $("profile-last-name").value = last;
    }
    const userId = currentUser?.id;
    const path = ownedAvatarPath(settings.avatar_path, userId) ? settings.avatar_path : null;
    $("avatar-remove-button").hidden = !path;
    if (!path) {
        clearAvatar();
    } else if (avatarLoadedPath !== path && avatarRequest?.path !== path) {
        loadAvatar(path, userId, accountEpoch);
    }
}

async function loadAvatar(path, userId, epoch) {
    clearAvatar();
    const request = { path, userId, epoch };
    avatarRequest = request;
    try {
        const blob = await result(supabase.storage.from("avatars").download(path));
        if (avatarRequest !== request || !isActiveAccount(userId, epoch) || settings.avatar_path !== path) return;
        avatarObjectUrl = URL.createObjectURL(blob);
        avatarLoadedPath = path;
        $("account-avatar-image").src = avatarObjectUrl;
        $("account-avatar-image").hidden = false;
        $("account-initials").hidden = true;
    } catch (error) {
        if (avatarRequest === request && isActiveAccount(userId, epoch)) {
            accountMessage("profile-message", "Profilbild konnte nicht geladen werden. " + errorText(error, "Bitte versuche es erneut."), "error");
        }
    } finally {
        if (avatarRequest === request) avatarRequest = null;
    }
}

$("account-avatar-image").addEventListener("error", () => {
    clearAvatar();
});

$("profile-form").addEventListener("input", () => { profileDirty = true; });

$("profile-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!currentUser || busy) return;
    const userId = currentUser.id;
    const epoch = accountEpoch;
    const first_name = normalizeProfileName($("profile-first-name").value);
    const last_name = normalizeProfileName($("profile-last-name").value);
    if (!first_name || !last_name) {
        accountMessage("profile-message", "Bitte Vor- und Nachnamen eingeben.", "error");
        return;
    }
    const form = event.currentTarget;
    const controls = Array.from(form.elements);
    controls.forEach(control => control.disabled = true);
    accountMessage("profile-message");
    try {
        const saved = await saveOperation(id => updateUserSettings(id, { first_name, last_name }), "Profil gespeichert.");
        if (!isActiveAccount(userId, epoch)) return;
        if (saved) {
            settings = { ...settings, first_name, last_name };
            profileDirty = false;
            renderAccountProfile();
            $("profile-details").open = false;
            accountMessage("profile-message", "Profil gespeichert.");
        } else {
            accountMessage("profile-message", "Profil konnte nicht gespeichert werden.", "error");
        }
    } finally {
        controls.forEach(control => control.disabled = false);
    }
});

async function resizeAvatar(file) {
    if (file.size > 25 * 1024 * 1024) throw new AppError("Bitte ein Bild unter 25 MB auswählen.");
    if (file.type && !file.type.startsWith("image/")) throw new AppError("Bitte eine Bilddatei auswählen.");
    const url = URL.createObjectURL(file);
    const image = new Image();
    try {
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new AppError("Bildformat nicht lesbar. Bitte JPEG, PNG oder WebP verwenden."));
            image.src = url;
        });
        const size = Math.min(image.naturalWidth, image.naturalHeight);
        if (!size) throw new AppError("Ungültige Bilddatei.");
        const dimension = Math.min(size, 512);
        const canvas = document.createElement("canvas");
        canvas.width = dimension;
        canvas.height = dimension;
        const context = canvas.getContext("2d");
        if (!context) throw new AppError("Bildverarbeitung nicht verfügbar.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, dimension, dimension);
        context.drawImage(image, (image.naturalWidth - size) / 2,
            (image.naturalHeight - size) / 2, size, size, 0, 0, dimension, dimension);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
        if (!blob || blob.type !== "image/jpeg" || blob.size > 2 * 1024 * 1024) {
            throw new AppError("Profilbild konnte nicht verkleinert werden.");
        }
        return blob;
    } finally {
        URL.revokeObjectURL(url);
    }
}

$("avatar-upload-button").addEventListener("click", () => {
    if (currentUser && !busy) $("avatar-file").click();
});

async function changeAvatar(file) {
    if (!currentUser || busy) return;
    const userId = currentUser.id;
    const epoch = accountEpoch;
    const controls = [$("avatar-upload-button"), $("avatar-remove-button")];
    controls.forEach(control => control.disabled = true);
    accountMessage("profile-message", file ? "Profilbild wird hochgeladen ..." : "Profilbild wird entfernt ...");
    let newPath = null;
    let cleanupFailed = false;
    try {
        const saved = await saveOperation(async id => {
            const oldPath = settings.avatar_path;
            if (file) {
                const blob = await resizeAvatar(file);
                if (!isActiveAccount(id, epoch)) throw new AppError("Benutzer gewechselt.");
                newPath = `${id}/${crypto.randomUUID()}.jpg`;
                await result(supabase.storage.from("avatars").upload(newPath, blob, {
                    contentType: "image/jpeg", upsert: false, cacheControl: "0"
                }));
            }
            if (!isActiveAccount(id, epoch)) throw new AppError("Benutzer gewechselt.");
            // Erst den neuen Pfad speichern, danach das alte Objekt löschen.
            await updateUserSettings(id, { avatar_path: newPath });
            if (isActiveAccount(id, epoch) && ownedAvatarPath(oldPath, id) && oldPath !== newPath) {
                try {
                    await result(supabase.storage.from("avatars").remove([oldPath]));
                } catch {
                    cleanupFailed = true;
                }
            }
        }, file ? "Profilbild gespeichert." : "Profilbild entfernt.");
        if (!isActiveAccount(userId, epoch)) return;
        if (saved) {
            settings.avatar_path = newPath;
            renderAccountProfile();
            accountMessage("profile-message", cleanupFailed
                ? "Profil aktualisiert. Die alte Datei konnte nicht gelöscht werden."
                : file ? "Profilbild gespeichert." : "Profilbild entfernt.", cleanupFailed ? "error" : "success");
        } else {
            accountMessage("profile-message", "Profilbild konnte nicht aktualisiert werden.", "error");
        }
    } finally {
        controls.forEach(control => control.disabled = false);
    }
}

$("avatar-file").addEventListener("change", async event => {
    const file = event.currentTarget.files[0];
    event.currentTarget.value = "";
    if (file) await changeAvatar(file);
});

$("avatar-remove-button").addEventListener("click", async () => {
    if (currentUser && !busy && confirm("Möchtest du dein Profilbild entfernen?")) await changeAvatar(null);
});

// PASSKEYS

async function loadPasskeys() {
    const userId = currentUser?.id;
    const epoch = accountEpoch;
    if (!userId || typeof supabase.auth.passkey?.list !== "function") return;
    const request = { userId, epoch };
    passkeyListRequest = request;
    try {
        const keys = await result(supabase.auth.passkey.list());
        if (passkeyListRequest !== request || !isActiveAccount(userId, epoch)) return;
        const list = $("passkey-list");
        list.replaceChildren();
        if (!keys?.length) {
            list.append(node("p", "entry-meta", "Noch keine Passkeys eingerichtet."));
            return;
        }
        for (const key of keys) {
            const item = node("div", "passkey-item");
            const info = node("div");
            info.append(node("strong", "", key.friendly_name || "Passkey"));
            if (key.created_at) info.append(node("p", "entry-meta", "Erstellt: " +
                new Date(key.created_at).toLocaleDateString("de-DE")));
            item.append(info, actionButton("Umbenennen", "button secondary", () => {
                if (!isActiveAccount(userId, epoch) || passkeyBusy || busy || passwordBusy) return;
                const name = prompt("Name des Passkeys", key.friendly_name || "Passkey")?.trim();
                if (name && name.length <= 120) runPasskeyAction(() =>
                    supabase.auth.passkey.update({ passkeyId: key.id, friendlyName: name }), "Passkey umbenannt.");
            }), actionButton("Entfernen", "button danger", () => {
                if (!isActiveAccount(userId, epoch) || passkeyBusy || busy || passwordBusy) return;
                if (confirm("Diesen Passkey wirklich entfernen? Die Passwortanmeldung bleibt möglich.")) {
                    runPasskeyAction(() => supabase.auth.passkey.delete({ passkeyId: key.id }), "Passkey entfernt.");
                }
            }));
            list.append(item);
        }
    } catch (error) {
        if (passkeyListRequest === request && isActiveAccount(userId, epoch)) {
            accountMessage("passkey-message", "Passkeys konnten nicht geladen werden. " + errorText(error, "Bitte versuche es erneut."), "error");
        }
    } finally {
        if (passkeyListRequest === request) passkeyListRequest = null;
    }
}

async function runPasskeyAction(operation, message) {
    if (!currentUser || passkeyBusy || passwordBusy || busy) return;
    const userId = currentUser.id;
    const epoch = accountEpoch;
    passkeyBusy = true;
    $("passkey-register-button").disabled = true;
    accountMessage("passkey-message");
    try {
        await result(operation());
        if (!isActiveAccount(userId, epoch)) return;
        accountMessage("passkey-message", message);
        await loadPasskeys();
    } catch (error) {
        if (isActiveAccount(userId, epoch)) accountMessage("passkey-message", errorText(error, "Passkey-Vorgang fehlgeschlagen. Bitte versuche es erneut."), "error");
    } finally {
        passkeyBusy = false;
        $("passkey-register-button").disabled = !currentUser || !supportsPasskeys();
    }
}

$("passkey-details").addEventListener("toggle", () => {
    if ($("passkey-details").open && currentUser) {
        if (!supportsPasskeys()) accountMessage("passkey-message", "Passkey-Anmeldung wird auf diesem Gerät oder Browser möglicherweise nicht unterstützt.", "error");
        loadPasskeys();
    }
});

$("passkey-register-button").addEventListener("click", () => {
    if (!supportsPasskeys()) return;
    runPasskeyAction(() => supabase.auth.registerPasskey(), "Passkey eingerichtet.");
});

// PASSWORT ÄNDERN

$("password-form").noValidate = true;

$("password-form").addEventListener("input", () => {
    accountMessage("password-message");
});

$("password-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!currentUser || passwordBusy || passkeyBusy || busy) return;
    accountMessage("password-message");
    const userId = currentUser.id;
    const epoch = accountEpoch;
    const currentPassword = $("current-password").value;
    const password = $("new-password").value;
    const confirmation = $("confirm-password").value;
    if (!currentPassword) {
        accountMessage("password-message", "Bitte dein aktuelles Passwort eingeben.", "error");
        return;
    }
    
    const validationError = newPasswordValidationError(password, confirmation);
    if (validationError) {
        accountMessage("password-message", validationError, "error");
        return;
    }
    if (password === currentPassword) {
        accountMessage("password-message", "Das neue Passwort muss sich vom bisherigen Passwort unterscheiden.", "error");
        return;
    }
    const form = event.currentTarget;
    const controls = Array.from(form.elements);
    passwordBusy = true;
    controls.forEach(control => control.disabled = true);
    accountMessage("password-message");
    try {
        await result(supabase.auth.updateUser({ password, current_password: currentPassword }));
        if (isActiveAccount(userId, epoch)) {
            form.reset();
            accountMessage("password-message", "Passwort erfolgreich geändert.");
        }
    } catch (error) {
        if (isActiveAccount(userId, epoch)) accountMessage("password-message", errorText(error, "Passwortänderung fehlgeschlagen. Bitte versuche es erneut.", "password"), "error");
    } finally {
        passwordBusy = false;
        controls.forEach(control => control.disabled = false);
    }
});


// ==========================================
// 22. PASSWORT SICHTBARKEIT
// ==========================================

function setPasswordVisibility(input, button, visible) {
    input.type = visible ? "text" : "password";
    button.setAttribute("aria-pressed", String(visible));
    button.title = visible ? "Passwort ausblenden" : "Passwort anzeigen";
    button.querySelector(".password-eye-slash")
        .toggleAttribute("hidden", !visible);
}

function hidePasswordFields(container = document) {
    container.querySelectorAll(".password-field").forEach(wrapper => {
        const input = wrapper.querySelector("input");
        const button = wrapper.querySelector(".password-toggle");
        if (input && button) setPasswordVisibility(input, button, false);
    });
}

function initPasswordVisibility() {
    const fields = [
        ["login-password", "Passwort"],
        ["current-password", "Aktuelles Passwort"],
        ["new-password", "Neues Passwort"],
        ["confirm-password", "Passwortwiederholung"],
        ["recovery-new-password", "Neues Passwort"],
        ["recovery-confirm-password", "Passwortwiederholung"]
    ];

    for (const [id, label] of fields) {
        const input = $(id);
        if (!input || input.closest(".password-field")) continue;

        const wrapper = node("div", "password-field");
        const button = node("button", "password-toggle");
        button.type = "button";
        button.setAttribute("aria-controls", id);
        button.setAttribute("aria-label", `${label} anzeigen`);

        input.spellcheck = false;
        input.setAttribute("autocapitalize", "off");
        input.setAttribute("autocorrect", "off");

        button.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="1.8"
                 stroke-linecap="round" stroke-linejoin="round"
                 aria-hidden="true" focusable="false">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/>
                <circle cx="12" cy="12" r="3"/>
                <path class="password-eye-slash" d="M3 3l18 18" hidden/>
            </svg>`;

        input.before(wrapper);
        wrapper.append(input, button);
        setPasswordVisibility(input, button, false);

        button.addEventListener("click", () => {
            if (input.disabled) return;
            setPasswordVisibility(input, button, input.type === "password");
        });
    }

         for (const id of ["login-form", "password-form", "recovery-reset-form"]) {
        const form = $(id);
        form.addEventListener("click", event => {
            if (event.target.closest('button[type="submit"]')) {
                hidePasswordFields(form);
            }
        }, true);
        form.addEventListener("invalid", () => hidePasswordFields(form), true);
        form.addEventListener("submit", () => hidePasswordFields(form), true);
        form.addEventListener("reset", () => hidePasswordFields(form), true);
    }

    $("password-details").addEventListener("toggle", () => {
        if (!$("password-details").open) hidePasswordFields($("password-form"));
    });

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) hidePasswordFields();
    });
    window.addEventListener("pagehide", () => hidePasswordFields());
}

initPasswordVisibility();

// ==========================================
// 23. PASSWORT-WIEDERHERSTELLUNG
// ==========================================

let recoveryBusy = false;
let recoveryUserId = null;
let recoveryFinished = false;

function showAuthView(view) {
    hidePasswordFields($("login-screen"));
    $("login-form").hidden = view !== "login";
    $("recovery-request-form").hidden = view !== "request";
    $("recovery-reset-form").hidden = view !== "reset";
    $("login-description").textContent = "Deine persönliche Arbeitszeiterfassung";
}

function recoveryMessage(id, text = "", type = "success") {
    const element = $(id);
    element.textContent = text;
    element.className = `auth-message ${type}`;
    element.hidden = !text;
}

function setRecoveryBusy(value) {
    recoveryBusy = value;
    for (const id of ["recovery-request-form", "recovery-reset-form"]) {
        Array.from($(id).elements).forEach(control => control.disabled = value);
    }
    
    $("recovery-reset-submit").disabled = value || !recoveryUserId || recoveryFinished;
    $("recovery-password-requirements").hidden = !recoveryUserId || recoveryFinished;
    for (const control of $("recovery-reset-form").querySelectorAll("input, .password-toggle")) {
        control.disabled = value || !recoveryUserId || recoveryFinished;
    }
    $("recovery-request-submit").textContent = value ? "Bitte warten ..." : "Wiederherstellungslink anfordern";
    $("recovery-reset-submit").textContent = value ? "Bitte warten ..." : "Neues Passwort speichern";
}

$("forgot-password-button").addEventListener("click", () => {
    if (recoveryRoute || loginBusy || recoveryBusy || currentUser) return;
    $("recovery-email").value = $("login-email").value.trim();
    $("login-password").value = "";
    loginMessage("");
    recoveryMessage("recovery-request-message");
    showAuthView("request");
    $("recovery-email").focus();
});

$("recovery-back-button").addEventListener("click", () => {
    if (recoveryBusy || recoveryRoute) return;
    $("login-email").value = $("recovery-email").value.trim();
    $("recovery-request-form").reset();
    recoveryMessage("recovery-request-message");
    showAuthView("login");
    $("login-email").focus();
});

$("recovery-email").addEventListener("input", () => recoveryMessage("recovery-request-message"));
$("recovery-request-form").noValidate = true;
$("recovery-request-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (recoveryRoute || recoveryBusy || loginBusy || currentUser || event.currentTarget.hidden) return;
    const input = $("recovery-email");
    input.value = input.value.trim();
    if (!input.value || !input.validity.valid) {
        recoveryMessage("recovery-request-message", "Bitte gib eine gültige E-Mail-Adresse ein.", "error");
        return;
    }
    const neutral = "Falls ein Konto mit dieser E-Mail-Adresse existiert, wurde ein Wiederherstellungslink angefordert. Bitte prüfe auch deinen Spam-Ordner.";
    recoveryMessage("recovery-request-message");
    setRecoveryBusy(true);
    try {
        const redirect = new URL(appUrl);
        redirect.searchParams.set("recovery", "1");
        await result(supabase.auth.resetPasswordForEmail(input.value, { redirectTo: redirect.href }));
        recoveryMessage("recovery-request-message", neutral);
    } catch (error) {
        const code = String(error?.code ?? "");
        if (["user_not_found", "user_banned", "email_not_confirmed", "email_address_not_authorized"].includes(code)) {
            recoveryMessage("recovery-request-message", neutral);
        } else {
            const text = navigator.onLine === false || Number(error?.status) === 429
                ? errorText(error)
                : "Die Anfrage konnte nicht verarbeitet werden. Bitte versuche es später erneut.";
            recoveryMessage("recovery-request-message", text, "error");
        }
    } finally {
        setRecoveryBusy(false);
    }
});

async function startRecovery() {
    showAuthView("reset");
    $("app").hidden = true;
    $("floating-add-button").hidden = true;
    $("login-screen").hidden = false;
    setRecoveryBusy(true);
    recoveryMessage("recovery-reset-message", "Wiederherstellungslink wird geprüft ...");
    const credentials = recoveryCredentials;
    recoveryCredentials = null;
    try {
        if (!credentials) throw new AppError("Dieser Wiederherstellungslink ist ungültig, abgelaufen oder wurde bereits geöffnet. Bitte fordere einen neuen Link an.");
        const data = await result(supabase.auth.setSession(credentials));
        const verified = await result(supabase.auth.getUser());
        if (!data?.session || !verified?.user?.id || verified.user.id !== data.session.user.id) {
            throw new AppError("Der Wiederherstellungslink konnte nicht bestätigt werden.");
        }
        recoveryUserId = verified.user.id;
        $("login-description").textContent = `Passwort zurücksetzen für ${verified.user.email || "dein Benutzerkonto"}`;
        recoveryMessage("recovery-reset-message");
    } catch (error) {
        recoveryUserId = null;
        recoveryMessage("recovery-reset-message", error instanceof AppError ? error.message :
            "Der Wiederherstellungslink konnte nicht bestätigt werden. Bitte überprüfe deine Internetverbindung und fordere bei Bedarf einen neuen Link an.", "error");
    } finally {
        setRecoveryBusy(false);
    }
}

$("recovery-reset-form").addEventListener("input", () => {
    if (recoveryUserId && !recoveryFinished) recoveryMessage("recovery-reset-message");
});

$("recovery-reset-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!recoveryRoute || !recoveryUserId || recoveryBusy || recoveryFinished || event.currentTarget.hidden) return;
    const password = $("recovery-new-password").value;
    const confirmation = $("recovery-confirm-password").value;
    const messageId = "recovery-reset-message";
    recoveryMessage(messageId);
    
    const validationError = newPasswordValidationError(password, confirmation);
    if (validationError) {
        recoveryMessage(messageId, validationError, "error");
        return;
    }
    
    setRecoveryBusy(true);
    hidePasswordFields(event.currentTarget);
    try {
        const verified = await result(supabase.auth.getUser());
        if (verified?.user?.id !== recoveryUserId) {
            recoveryUserId = null;
            throw new AppError("Die Wiederherstellungssitzung ist ungültig. Bitte fordere einen neuen Link an.");
        }
        const updated = await result(supabase.auth.updateUser({ password }));
        if (updated?.user?.id !== recoveryUserId) throw new AppError("Die Passwortänderung konnte nicht bestätigt werden.");
        recoveryFinished = true;
        recoveryUserId = null;
        $("recovery-reset-form").reset();
        let logoutFailed = false;
        try {
            await result(supabase.auth.signOut({ scope: "global" }));
        } catch {
            logoutFailed = true;
        }
        for (const element of $("recovery-reset-form").querySelectorAll("label, .password-field, #recovery-password-hint, #recovery-password-requirements, #recovery-reset-submit")) {
            element.hidden = true;
        }
        $("recovery-reset-title").textContent = "Passwort geändert";
        $("recovery-cancel-button").textContent = "Zurück zur Anwendung";
        recoveryMessage(messageId, logoutFailed
            ? "Dein Passwort wurde geändert. Die Abmeldung aller Sitzungen konnte nicht bestätigt werden."
            : "Dein Passwort wurde erfolgreich geändert. Du kannst dich mit deinem neuen Passwort anmelden.", logoutFailed ? "error" : "success");
    } catch (error) {
        const code = String(error?.code ?? "");
        if (["session_expired", "session_not_found", "bad_jwt", "refresh_token_not_found", "current_password_required", "current_password_mismatch"].includes(code) || error?.name === "AuthSessionMissingError") {
            recoveryUserId = null;
            $("recovery-reset-form").reset();
            recoveryMessage(messageId, "Die Wiederherstellungssitzung ist nicht mehr gültig. Bitte fordere einen neuen Link an.", "error");
        } else {
            recoveryMessage(messageId, errorText(error, "Das Passwort konnte nicht zurückgesetzt werden. Bitte versuche es erneut."), "error");
        }
    } finally {
        setRecoveryBusy(false);
    }
});

$("recovery-cancel-button").addEventListener("click", async () => {
    if (!recoveryRoute || recoveryBusy) return;
    if (!recoveryFinished && recoveryUserId && !confirm("Möchtest du die Passwort-Wiederherstellung abbrechen?")) return;
    setRecoveryBusy(true);
    $("recovery-reset-form").reset();
    try {
        if (!recoveryFinished) await result(supabase.auth.signOut({ scope: "local" }));
    } catch {
        // Beim Verlassen wird die ausschließlich temporäre Sitzung verworfen.
    } finally {
        recoveryUserId = null;
        window.location.replace(appUrl.href);
    }
});

// ==========================================
// 24. LIVE-PASSWORTANFORDERUNGEN
// ==========================================

function getPasswordRequirements(password) {
    return {
        length: Array.from(password).length >= 8,
        number: /[0-9]/.test(password),
        lowercase: /[a-z]/.test(password),
        uppercase: /[A-Z]/.test(password),
        special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?`~]/.test(password)
    };
}

function newPasswordValidationError(password, confirmation) {
    const requirements = getPasswordRequirements(password);
    const confirmationTooShort = Array.from(confirmation).length < 8;

    if (!requirements.length && confirmationTooShort) {
        return "Die beiden neuen Passwörter müssen mindestens 8 Zeichen enthalten.";
    }
    if (!requirements.length) {
        return "Das neue Passwort muss mindestens 8 Zeichen enthalten.";
    }
    if (confirmationTooShort) {
        return "Die Passwortwiederholung muss mindestens 8 Zeichen enthalten.";
    }
    if (!Object.values(requirements).every(Boolean)) {
        return "Das neue Passwort muss alle angezeigten Passwortanforderungen erfüllen.";
    }
    if (new TextEncoder().encode(password).length > 72) {
        return "Das neue Passwort darf maximal 72 UTF-8-Bytes enthalten. Bitte verwende ein kürzeres Passwort.";
    }
    if (password !== confirmation) {
        return "Die neuen Passwörter stimmen nicht überein.";
    }
    return "";
}

function initPasswordRequirements() {
    const fields = [
        ["new-password", "password-requirements"],
        ["recovery-new-password", "recovery-password-requirements"]
    ];

    for (const [inputId, listId] of fields) {
        const input = $(inputId);
        const list = $(listId);
        const update = () => {
            const requirements = getPasswordRequirements(input.value);
            for (const item of list.querySelectorAll("[data-rule]")) {
                const met = requirements[item.dataset.rule] === true;
                item.classList.toggle("is-met", met);
                item.classList.toggle("is-unmet", !met);
                item.querySelector(".password-rule-icon").textContent = met ? "✓" : "×";
                item.querySelector(".password-rule-status").textContent = met ? " (erfüllt)" : " (nicht erfüllt)";
            }
        };
        input.addEventListener("input", update);
        input.addEventListener("change", update);
        input.addEventListener("focus", update);
        input.form.addEventListener("submit", update, true);
        input.form.addEventListener("reset", () => queueMicrotask(update));
        window.addEventListener("pageshow", update);
        $("password-details").addEventListener("toggle", update);
        update();
    }
}

initPasswordRequirements();

// ==========================================
// 25. INITIALISIERUNG
// ==========================================
resetEntryForm();

renderAll();

applyTheme("system");
setLoginBusy(false);
setRecoveryBusy(false);
$("forgot-password-button").hidden = recoveryRoute;
if (recoveryRoute) startRecovery();
