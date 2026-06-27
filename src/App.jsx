
import { useState, useEffect, useRef } from "react";
import "./App.css";
import logo from "./assets/logo.png";
import { supabase } from "./supabaseClient";
import translations from "./i18n";

/* ══════════════════════════════════
   Rate Limiter — localStorage tabanlı
   Sayfa yenilemesi bypas etmez
══════════════════════════════════ */
const RL_KEYS = { customer: "rp_rl_cust", business: "rp_rl_biz", admin: "rp_rl_admin" };

function rlGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; }
}
function rlSet(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

/** Mevcut durum — locked:true ise remaining saniye döner */
function rlCheck(key) {
  const d = rlGet(key);
  if (d.until && Date.now() < d.until) {
    return { locked: true, remaining: Math.ceil((d.until - Date.now()) / 1000), attempts: d.attempts || 0 };
  }
  return { locked: false, attempts: d.attempts || 0 };
}

/** Başarısız deneme — yeni kilit süresini döner */
function rlFail(key) {
  const d = rlGet(key);
  // Kilit süresi dolmuşsa sayacı sıfırla
  const prev = (d.until && Date.now() >= d.until) ? 0 : (d.attempts || 0);
  const attempts = prev + 1;
  let until = null;
  if      (attempts >= 10) until = Date.now() + 30 * 60 * 1000; // 30 dk
  else if (attempts >=  7) until = Date.now() + 10 * 60 * 1000; // 10 dk
  else if (attempts >=  5) until = Date.now() +  2 * 60 * 1000; //  2 dk
  else if (attempts >=  3) until = Date.now() +      30 * 1000; // 30 sn
  rlSet(key, { attempts, until });
  return { attempts, locked: !!until, until, remaining: until ? Math.ceil((until - Date.now()) / 1000) : 0 };
}

/** Başarılı giriş — sayacı sıfırla */
function rlReset(key) { localStorage.removeItem(key); }

/** Kilit mesajı */
function rlMsg(remaining) {
  if (remaining >= 3600) return `${Math.ceil(remaining / 60)} dakika sonra tekrar deneyin.`;
  if (remaining >= 60)   return `${Math.ceil(remaining / 60)} dakika ${remaining % 60} saniye sonra tekrar deneyin.`;
  return `${remaining} saniye sonra tekrar deneyin.`;
}

/* ── E-posta domain MX kontrolü ── */
async function checkEmailDomainMX(email) {
  try {
    const domain = email.split("@")[1];
    if (!domain) return false;
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return true; // ağ hatasında engelleme
    const data = await res.json();
    // Status 0 = NOERROR, Answer dolu = MX kaydı var
    return data.Status === 0 && Array.isArray(data.Answer) && data.Answer.length > 0;
  } catch {
    return true; // kontrol yapılamazsa geçir, Supabase zaten doğrulama maili atar
  }
}

/* ── Push notification helpers ── */
const VAPID_PUBLIC = "BDMjWSUxEiOZtQjtivlisIbDYJLYUcIPjx0lDrZbn8gvSUV8ih9EyCxbHyniyrIpjBnjtLROfxY89XatXo2dZG8";
const PUSH_FN_URL  = "https://sghwmnagplaolqdfqpvz.supabase.co/functions/v1/send-push";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function registerPush(userEmail, userType, userId) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const existing = await reg.pushManager.getSubscription();
    const sub = existing || await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
    });

    const { endpoint, keys } = sub.toJSON();
    const numericId = userId ? Number(userId) : null;

    // Bu endpoint başka bir kullanıcıya kayıtlıysa önce sil
    await supabase.from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint)
      .neq("user_id", numericId);

    await supabase.from("push_subscriptions").upsert({
      endpoint,
      p256dh:     keys.p256dh,
      auth:       keys.auth,
      user_email: userEmail || null,
      user_type:  userType  || null,
      user_id:    numericId,
    }, { onConflict: "endpoint" });
  } catch (e) {
    console.warn("Push registration failed:", e);
  }
}

async function sendPush({ userEmail, userType, userId, title, body, url, tag }) {
  try {
    await fetch(PUSH_FN_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ user_email: userEmail, user_type: userType, user_id: userId, title, body, url, tag }),
    });
  } catch (e) {
    console.warn("Push send failed:", e);
  }
}

function Spinner() {
  return <span className="spinner" />;
}

function ScoreBadge({ score }) {
  const cls = score >= 80 ? "high" : score >= 50 ? "medium" : "low";
  const label = score >= 80 ? "✓ Güvenilir" : score >= 50 ? "⚠ Orta" : "✕ Riskli";
  return <span className={`score-badge ${cls}`}>{label} {score}/100</span>;
}

function StatusBadge({ status }) {
  const labels = { pending:"Bekliyor", accepted:"Kabul", rejected:"Reddedildi", completed:"Tamamlandı", "no-show":"No Show", cancelled:"İptal" };
  return <span className={`status-badge ${status}`}>{labels[status] || status}</span>;
}

function ProgressBar({ percent, color }) {
  return (
    <div className="progress-track">
      <div className={`progress-fill ${color || ""}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

function AnimatedNumber({ value }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    let start = 0;
    const end = Number(value) || 0;
    if (end === 0) { setDisplay(0); return; }
    const step = Math.max(1, Math.ceil(end / 30));
    clearInterval(ref.current);
    ref.current = setInterval(() => {
      start += step;
      if (start >= end) { setDisplay(end); clearInterval(ref.current); }
      else setDisplay(start);
    }, 30);
    return () => clearInterval(ref.current);
  }, [value]);
  return <>{display}</>;
}

const ALL_TIME_SLOTS = (() => {
  const slots = [];
  for (let h = 8; h < 24; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  for (let h = 0; h < 8; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
})();

const SAFE_PAGES = ["home","businesses","contact","customerAuth","adminLogin","businessProfile"];
const CUSTOMER_PAGES = ["customerDashboard"];
const BUSINESS_PAGES = ["businessPanel"];
const NO_RESTORE = ["reservation","summary","success","adminPanel"];

// React efektleri çalışmadan önce bir kere okunur.
// useEffect([page]) hemen "home" yazarken bu değer korunur.
const INITIAL_SAVED_PAGE = localStorage.getItem("rp_page") || "home";

function getSavedPage() {
  if (!INITIAL_SAVED_PAGE || NO_RESTORE.includes(INITIAL_SAVED_PAGE) || BUSINESS_PAGES.includes(INITIAL_SAVED_PAGE) || CUSTOMER_PAGES.includes(INITIAL_SAVED_PAGE)) return "home";
  return INITIAL_SAVED_PAGE;
}

function formatRez(rez) {
  return {
    id: rez.id,
    business: rez.business,
    businessId: rez.business_id,
    fullName: rez.full_name,
    email: rez.email,
    phone: rez.phone,
    date: rez.date,
    time: rez.time,
    guests: rez.guests,
    note: rez.note,
    safeScore: rez.safe_score,
    code: rez.code,
    status: rez.status,
    businessMessage: rez.business_message || "",
    attendanceStatus: rez.attendance_status || "pending",
    createdAt: rez.created_at || null,
    businessNote: rez.business_note || "",
    customerProfile: {
      gender: rez.gender,
      birthDate: rez.birth_date,
      job: rez.job,
      smoking: rez.smoking,
    },
  };
}

function parseMenuText(raw) {
  if (!raw) return { description: "", menu: "", phone: "", terms: "" };
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === "object")
      return { description: p.description || "", menu: p.menu || "", phone: p.phone || "", terms: p.terms || "" };
  } catch {}
  return { description: "", menu: raw, phone: "", terms: "" };
}

function formatBusiness(b) {
  const parsed = parseMenuText(b.menu_text);
  return {
    id: b.id,
    name: b.name,
    email: b.email,
    reservationActive: b.reservation_enabled,
    aiMenuActive: b.ai_menu_enabled,
    menuText: b.menu_text || "",
    description: parsed.description,
    menu: parsed.menu,
    phone: parsed.phone,
    terms: parsed.terms,
    type: b.type || "Business",
    location: b.location || "",
    icon: b.icon || "🏢",
    logoUrl: b.logo_url || null,
    meetingEnabled: b.meeting_enabled ?? false,
    adminReservationLocked: b.admin_reservation_locked ?? false,
    adminMeetingLocked: b.admin_meeting_locked ?? false,
    availabilityMode: b.availability_mode === "everyday" ? "specific" : (b.availability_mode || "weekly"),
    availableDays: b.available_days ? b.available_days.split(",") : ["Friday", "Saturday"],
    specificDates: b.specific_dates ? b.specific_dates.split(",") : [],
    availableTimes: b.available_times ? b.available_times.split(",") : ["18:00", "19:00", "20:30"],
    dateTimes: Object.fromEntries(
      Object.entries(b.date_times || {}).map(([d, v]) => [d, (v || "").split(",").filter(Boolean)])
    ),
    reservationDateTimes: Object.fromEntries(
      Object.entries(b.reservation_date_times || {}).map(([d, v]) => [d, (v || "").split(",").filter(Boolean)])
    ),
    meetingTimes: b.meeting_times ? b.meeting_times.split(",") : [],
    meetingDates: b.meeting_dates ? b.meeting_dates.split(",") : [],
    rating: b.rating || 0,
    businessHours: b.business_hours || {},
  };
}

function App() {
  const [page, setPage] = useState(getSavedPage);
  const [appReady, setAppReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [whatsNewRead, setWhatsNewRead] = useState(() => !!localStorage.getItem("rp_whatsnew_read_v1"));
  const [swUpdate, setSwUpdate] = useState(false);
  const [broadTitle, setBroadTitle] = useState("");
  const [broadBody, setBroadBody] = useState("");
  const [broadSending, setBroadSending] = useState(false);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [showFavPanel, setShowFavPanel] = useState(false);
  const [bizProfileTab, setBizProfileTab] = useState("about");
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem("rp_favorites") || "[]"); } catch { return []; }
  });
  const toggleFavorite = (biz) => {
    setFavorites(prev => {
      const exists = prev.some(f => f.id === biz.id);
      const next = exists ? prev.filter(f => f.id !== biz.id) : [...prev, { id: biz.id, name: biz.name, type: biz.type, location: biz.location, icon: biz.icon, logoUrl: biz.logoUrl, rating: biz.rating }];
      localStorage.setItem("rp_favorites", JSON.stringify(next));
      return next;
    });
  };
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [error, setError] = useState("");
  const [loginError, setLoginError] = useState("");
  const [panelTab, setPanelTab] = useState(() => localStorage.getItem("rp_panel_tab") || "incoming");
  const [bizStatsArchive, setBizStatsArchive] = useState({ total:0, attended:0, no_show:0, cancelled:0, rejected:0, unique_customers:0 });
  const [customerInsightTab, setCustomerInsightTab] = useState("age");
  const [customerTab, setCustomerTab] = useState(() => localStorage.getItem("rp_customer_tab") || "reservations");
  const [accountSubTab, setAccountSubTab] = useState("safescore");

  const [availableTimes, setAvailableTimes] = useState([
    "18:00",
    "19:00",
    "20:30",
  ]);
  const [availableDays, setAvailableDays] = useState(["Friday", "Saturday"]);
  const [availabilityMode, setAvailabilityMode] = useState("weekly");
  const [specificDates, setSpecificDates] = useState([]);
  const [dateTimesMap, setDateTimesMap] = useState({});
  const [reservationDateTimesMap, setReservationDateTimesMap] = useState({});
  const [expandedDateForTimes, setExpandedDateForTimes] = useState(null);
  const [expandedRezDateForTimes, setExpandedRezDateForTimes] = useState(null);
  const [availableSlotsForDate, setAvailableSlotsForDate] = useState(null);
  const [savedMessage, setSavedMessage] = useState("");
  const [afterLoginReturnPage, setAfterLoginReturnPage] = useState(null);
  const [lang, setLang] = useState(() => localStorage.getItem("rp_lang") || "tr");
  const t = translations[lang];

  const [selectedAcceptedDate, setSelectedAcceptedDate] = useState("");
  const [selectedReservation, setSelectedReservation] = useState(null);
  const [checkedInReservations, setCheckedInReservations] = useState([]);

  const [reservationCode, setReservationCode] = useState("");
  const [reservations, setReservations] = useState([]);
  const [loadingReservationId, setLoadingReservationId] = useState(null);

  const [customerMode, setCustomerMode] = useState("login");
  const [registeredCustomers, setRegisteredCustomers] = useState([]);
  const [customerAuthError, setCustomerAuthError] = useState("");
  const [loggedCustomer, setLoggedCustomer] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [logoClickCount, setLogoClickCount] = useState(0);
  const [heroPhase, setHeroPhase] = useState(0);
  const [navScrolled, setNavScrolled] = useState(false);
  const [adminEditingBiz, setAdminEditingBiz] = useState(null);
  const [loggedBusiness, setLoggedBusiness] = useState(null);
  const [isCreatingReservation, setIsCreatingReservation] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [businessSearch, setBusinessSearch] = useState("");
  const [bizCategory, setBizCategory] = useState("Tümü");
  const [businessHours, setBusinessHours] = useState({});
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const dateStripRef = useRef(null);
  const timeStripRef = useRef(null);

  // ── Meeting system ──
  const [meetings, setMeetings] = useState([]);
  const [bizMode, setBizMode] = useState("reservations"); // "reservations" | "meetings"
  const [meetingPanelTab, setMeetingPanelTab] = useState("incoming");
  const [meetingForm, setMeetingForm] = useState({ fullName: "", email: "", phone: "", company: "", reason: "is_gorusmesi", productCategory: "", date: "", time: "", note: "" });
  const [meetingTermsChecked, setMeetingTermsChecked] = useState({ biz: false, rp: false });
  const [meetingFormBusiness, setMeetingFormBusiness] = useState(null);
  const [meetingFormError, setMeetingFormError] = useState("");
  const [isSendingMeeting, setIsSendingMeeting] = useState(false);
  const [meetingDetailPopup, setMeetingDetailPopup] = useState(null);
  const [selectedMeetingDate, setSelectedMeetingDate] = useState("");
  const [meetingAvailableTimes, setMeetingAvailableTimes] = useState([]);
  const [meetingAvailableDays, setMeetingAvailableDays] = useState([]);
  const [meetingTimeSaved, setMeetingTimeSaved] = useState("");
  const meetingDateRef = useRef(null);
  const meetingTimeRef = useRef(null);

  const [businessProfileForm, setBusinessProfileForm] = useState({
    name: "",
    location: "",
    phone: "",
    description: "",
    menu: "",
    terms: "",
  });
  const [businessProfileSaved, setBusinessProfileSaved] = useState("");
  const [termsChecked, setTermsChecked] = useState({ biz: false, rp: false });
  const [termsModal, setTermsModal] = useState(null);
  const [legalModal, setLegalModal] = useState(null);
  const [rpTerms, setRpTerms] = useState("");
  const [rpTermsEdit, setRpTermsEdit] = useState("");
  const [selectedBusinessInfo, setSelectedBusinessInfo] = useState(null);

  const [searchLocation, setSearchLocation] = useState("Hepsi");
  const [searchDate, setSearchDate] = useState("");
  const [searchTime, setSearchTime] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [authConfirmMsg, setAuthConfirmMsg] = useState("");
  const [forgotPasswordMsg, setForgotPasswordMsg] = useState("");
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [emailPending, setEmailPending] = useState(false);

  const [bizLoginAttempts, setBizLoginAttempts] = useState(() => rlCheck(RL_KEYS.business).attempts);
  const [bizLoginLocked, setBizLoginLocked] = useState(() => rlCheck(RL_KEYS.business).locked);
  const [custLoginAttempts, setCustLoginAttempts] = useState(0);
  const [custLoginLocked, setCustLoginLocked] = useState(false);
  const [custLockUntil, setCustLockUntil] = useState(null);
  const [adminLoginAttempts, setAdminLoginAttempts] = useState(0);
  const [adminLoginLocked, setAdminLoginLocked] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [bizSessionToken, setBizSessionToken] = useState(localStorage.getItem("rp_biz_token") || "");
  const [loginLoading, setLoginLoading] = useState(false);

  const [accountNewEmail, setAccountNewEmail] = useState("");
  const [accountNewPassword, setAccountNewPassword] = useState("");
  const [accountNewPassword2, setAccountNewPassword2] = useState("");
  const [accountMsg, setAccountMsg] = useState({ text: "", type: "" });
  const [accountLoading, setAccountLoading] = useState("");

  const [safescoreHistory, setSafescoreHistory] = useState([]);
  const [loyaltyPoints, setLoyaltyPoints] = useState([]);
  const [customerNotifications, setCustomerNotifications] = useState([]);

  const [adminBizTypes, setAdminBizTypes] = useState([]);
  const [adminNewTypeName, setAdminNewTypeName] = useState("");
  const [adminNewTypeIcon, setAdminNewTypeIcon] = useState("🏢");

  const [adminLogin, setAdminLogin] = useState({
    email: "",
    password: "",
  });

  const [adminError, setAdminError] = useState("");

  const [adminBusinesses, setAdminBusinesses] = useState([]);
  const [showAddBusinessForm, setShowAddBusinessForm] = useState(false);

  const [newBusinessForm, setNewBusinessForm] = useState({
    name: "",
    type: "",
    location: "",
    icon: "",
    email: "",
    password: "",
  });

  const [customerForm, setCustomerForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [customerProfile, setCustomerProfile] = useState({
    phone: "",
    gender: "",
    birthDate: "",
    job: "",
    smoking: "",
  });

  const [reservation, setReservation] = useState({
    phone: "",
    date: "",
    time: "",
    guests: "",
    note: "",
  });

  const [businessLogin, setBusinessLogin] = useState({
    email: "",
    password: "",
  });

  // ---------------------------------------------------------------------
  // Initial data load
  /* ── Hero dönen başlık ── */
  useEffect(() => {
    const t = setInterval(() => setHeroPhase(p => (p + 1) % 3), 4000);
    return () => clearInterval(t);
  }, []);

  /* ── Landing page scroll reveal ── */
  useEffect(() => {
    if (page !== "home" || !appReady) return;
    const els = document.querySelectorAll(".lp-reveal");
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("lp-visible"); io.unobserve(e.target); } }),
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
    );
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [page, appReady]);

  // ---------------------------------------------------------------------
  /* ── Biz rate-limiter auto-unlock ── */
  useEffect(() => {
    if (!bizLoginLocked) return;
    const d = rlGet(RL_KEYS.business);
    if (!d.until) { setBizLoginLocked(false); return; }
    const ms = d.until - Date.now();
    if (ms <= 0) { setBizLoginLocked(false); setLoginError(""); return; }
    const t = setTimeout(() => { setBizLoginLocked(false); setLoginError(""); }, ms);
    return () => clearTimeout(t);
  }, [bizLoginLocked]);

  /* ── Service Worker kaydı + güncelleme tespiti ── */
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").then(reg => {
      /* Sayfa açıkken güncelleme gelirse */
      reg.addEventListener("updatefound", () => {
        const newSW = reg.installing;
        if (!newSW) return;
        newSW.addEventListener("statechange", () => {
          /* Yeni SW yüklendi, eski hâlâ kontrolde → banner göster */
          if (newSW.state === "installed" && navigator.serviceWorker.controller) {
            setSwUpdate(true);
          }
        });
      });

      /* Zaten bekleyen bir SW var mı? (sekme kapalıyken güncelleme geldiyse) */
      if (reg.waiting && navigator.serviceWorker.controller) {
        setSwUpdate(true);
      }
    }).catch(() => {});

    /* SW kontrolü değişince (yenileme sonrası) sayfayı yenile */
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) { refreshing = true; window.location.reload(); }
    });

    navigator.serviceWorker.addEventListener("message", e => {
      if (e.data?.type === "NOTIFICATION_CLICK" && e.data.url) {
        window.location.href = e.data.url;
      }
    });
  }, []);

  /* ── Install banner ── */
  useEffect(() => {
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches
      || window.navigator.standalone === true;
    const dismissed = localStorage.getItem("rp_install_dismissed");
    if (!isStandalone && !dismissed) {
      const t = setTimeout(() => setShowInstallBanner(true), 2500);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    const loadInitialData = async () => {
      setLoadProgress(8);
      // 1. Restore Supabase Auth customer session
      let sessionCustomer = null;
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: custData } = await supabase
          .from("customers")
          .select("*")
          .eq("auth_user_id", session.user.id)
          .single();
        if (custData) {
          sessionCustomer = custData;
          setLoggedCustomer({
            id: custData.id,
            name: custData.name,
            email: custData.email,
            safeScore: custData.safe_score || 100,
          });
          setCustomerProfile({
            phone: custData.phone || "",
            gender: custData.gender || "",
            birthDate: custData.birth_date || "",
            job: custData.job || "",
            smoking: custData.smoking || "",
          });
          setCustomerForm({ name: custData.name, email: custData.email, password: "" });
          setEmailVerified(true);
          loadCustomerExtras(custData.id);
          registerPush(custData.email, "customer", custData.id);
          // Email doğrulama linkinden dönen kullanıcıyı dashboard'a yönlendir
          const savedPage = localStorage.getItem("rp_page") || "home";
          if (savedPage === "customerAuth") setPage("customerDashboard");
        }
      }

      setLoadProgress(25);
      // 2. Load businesses
      const { data: businessData, error: businessError } = await supabase
        .from("businesses")
        .select("id,name,email,reservation_enabled,ai_menu_enabled,availability_mode,available_days,available_times,location,menu_text,about,menu_url,external_link,rating,meeting_times,meeting_dates,specific_dates,type,icon,logo_url,meeting_enabled,date_times,reservation_date_times,business_hours,admin_reservation_locked,admin_meeting_locked");
      if (businessError) console.log("Businesses fetch error:", businessError);

      let formattedBusinesses = [];
      if (businessData) {
        formattedBusinesses = businessData.map(formatBusiness);
        setAdminBusinesses(formattedBusinesses);
      }

      // 3. Restore business login from localStorage
      let restoredBusiness = null;
      const savedBizId = localStorage.getItem("rp_biz_id");
      if (savedBizId) {
        // Önce Supabase'den gelen listede ara; bulamazsan cache'i kullan
        restoredBusiness = formattedBusinesses.find(b => String(b.id) === String(savedBizId));
        if (!restoredBusiness) {
          try {
            const cached = localStorage.getItem("rp_biz_cache");
            if (cached) restoredBusiness = JSON.parse(cached);
          } catch {}
        }
        if (restoredBusiness) {
          setLoggedBusiness(restoredBusiness);
          setAvailabilityMode(restoredBusiness.availabilityMode || "weekly");
          setAvailableDays(restoredBusiness.availableDays || []);
          setSpecificDates(restoredBusiness.specificDates || []);
          setAvailableTimes(restoredBusiness.availableTimes || []);
          setDateTimesMap(restoredBusiness.dateTimes || {});
          setReservationDateTimesMap(restoredBusiness.reservationDateTimes || {});
          setMeetingAvailableTimes(restoredBusiness.meetingTimes || []);
          setMeetingAvailableDays(restoredBusiness.meetingDates || []);
          setBusinessHours(restoredBusiness.businessHours || {});
          setBusinessProfileForm({
            name: restoredBusiness.name || "",
            location: restoredBusiness.location || "",
            phone: restoredBusiness.phone || "",
            description: restoredBusiness.description || "",
            menu: restoredBusiness.menu || "",
            terms: restoredBusiness.terms || "",
          });
          registerPush(restoredBusiness.email, "business", String(restoredBusiness.id));
          supabase.rpc("get_business_stats", { p_business_id: restoredBusiness.id }).then(({ data }) => {
            if (data) setBizStatsArchive(data);
          });
        }
      }

      setLoadProgress(55);
      // 4. Load reservations — tümünü çek (istatistikler için gerekli, sınır yok)
      const { data: reservationData, error: reservationError } =
        await supabase.from("reservations").select("*");
      if (reservationError) console.log("Reservations fetch error:", reservationError);

      if (reservationData) {
        setReservations(reservationData.map(formatRez));
      }

      // 5. Customers loaded after admin login via admin_get_customers RPC

      // 6. Navigate to protected pages only after confirming session is valid.
      // getSavedPage() returns "home" for BUSINESS_PAGES and CUSTOMER_PAGES, so
      // we must explicitly setPage() here after session validation.
      // IMPORTANT: use INITIAL_SAVED_PAGE (module-level), NOT localStorage.getItem()
      // because the useEffect([page]) already overwrote localStorage with "home".
      const currentPage = INITIAL_SAVED_PAGE;
      const savedSelBizId = localStorage.getItem("rp_sel_biz_id");
      if (BUSINESS_PAGES.includes(currentPage)) {
        if (restoredBusiness) setPage("businessPanel");
        // else: already "home" from getSavedPage()
      } else if (CUSTOMER_PAGES.includes(currentPage)) {
        if (sessionCustomer) setPage("customerDashboard");
        // else: already "home" from getSavedPage()
      } else if (currentPage === "businessProfile" && savedSelBizId) {
        const selBiz = formattedBusinesses.find(b => String(b.id) === String(savedSelBizId));
        if (selBiz) setSelectedBusiness(selBiz);
        else setPage("businesses");
      }

      setLoadProgress(75);
      // 6b. Load meetings
      const { data: meetingData } = await supabase.from("meetings").select("*");
      if (meetingData) {
        setMeetings(meetingData.map(m => ({
          id: m.id, businessId: m.business_id, businessName: m.business_name,
          fullName: m.full_name, email: m.email, phone: m.phone,
          company: m.company_name || "", reason: m.reason,
          date: m.date, time: m.time, note: m.note || "",
          status: m.status, code: m.code, createdAt: m.created_at || "",
        })));
      }

      setLoadProgress(90);
      // 7. Load RezPoint terms
      const { data: rpTermsData } = await supabase.from("site_settings").select("value").eq("key", "rezpoint_terms").single();
      if (rpTermsData?.value) { setRpTerms(rpTermsData.value); setRpTermsEdit(rpTermsData.value); }

      // Süresi geçmiş bekleyen rezervasyonları otomatik reddet
      supabase.rpc("auto_reject_expired_reservations").then(() => {});

      setLoadProgress(100);
      setTimeout(() => setAppReady(true), 200);
    };

    loadInitialData();
  }, []);

  async function loadCustomerExtras(customerId) {
    const [historyRes, loyaltyRes, notifRes] = await Promise.all([
      supabase.from("safescore_history").select("*").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(20),
      supabase.from("loyalty_points").select("*, businesses(name)").eq("customer_id", customerId).order("points", { ascending: false }),
      supabase.from("notifications").select("*").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(50),
    ]);
    if (historyRes.data) setSafescoreHistory(historyRes.data);
    if (loyaltyRes.data) setLoyaltyPoints(loyaltyRes.data.map(lp => ({ ...lp, businessName: lp.businesses?.name || "" })));
    if (notifRes.data) setCustomerNotifications(notifRes.data);
  }

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setLoggedCustomer(null);
        setEmailVerified(false);
      }
      if (event === "PASSWORD_RECOVERY") {
        window.location.hash = "";
        setIsPasswordRecovery(true);
        setCustomerMode("login");
        setPage("customerAuth");
      }
      if (event === "SIGNED_IN") {
        const hash = window.location.hash;
        if (hash.includes("type=signup")) {
          window.location.hash = "";
          setAuthConfirmMsg("E-postanız onaylandı! Şimdi giriş yapabilirsiniz.");
          setEmailPending(false);
          setCustomerMode("login");
          setPage("customerAuth");
        } else if (hash.includes("type=email_change")) {
          window.location.hash = "";
          setAuthConfirmMsg("E-posta adresiniz başarıyla güncellendi.");
          setCustomerMode("login");
          setPage("customerAuth");
        }
      }
    });
    return () => subscription?.unsubscribe();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("reservations-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "reservations" }, (payload) => {
        const incoming = payload.new;
        setReservations(prev => {
          // If we already added this optimistically (matched by code), just update the ID
          const optimisticIdx = prev.findIndex(r => r.code === incoming.code);
          if (optimisticIdx >= 0) {
            return prev.map((r, i) => i === optimisticIdx ? { ...r, id: incoming.id, createdAt: incoming.created_at || r.createdAt } : r);
          }
          if (prev.some(r => r.id === incoming.id)) return prev;
          return [...prev, formatRez(incoming)];
        });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "reservations" }, (payload) => {
        const updated = payload.new;
        setReservations(prev => prev.map(r => r.id === updated.id ? formatRez(updated) : r));
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => { localStorage.setItem("rp_page", page); }, [page]);


  useEffect(() => { localStorage.setItem("rp_panel_tab", panelTab); }, [panelTab]);
  useEffect(() => { localStorage.setItem("rp_customer_tab", customerTab); }, [customerTab]);
  useEffect(() => {
    if (selectedBusiness?.id) localStorage.setItem("rp_sel_biz_id", selectedBusiness.id);
  }, [selectedBusiness]);

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  // Build a Date object from a "YYYY-MM-DD" string as a LOCAL date
  // (avoids the off-by-one day issue caused by `new Date("YYYY-MM-DD")`
  // being parsed as UTC midnight).
  function parseLocalDate(dateValue) {
    if (!dateValue) return null;

    if (typeof dateValue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      const [year, month, day] = dateValue.split("-").map(Number);
      return new Date(year, month - 1, day);
    }

    return new Date(dateValue);
  }

  function formatDate(dateValue) {
    if (!dateValue) return "Tarih seçin";

    const date = parseLocalDate(dateValue);

    if (!date || isNaN(date.getTime())) return "Tarih seçin";

    return date.toLocaleDateString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      weekday: "long",
    });
  }

  function getAvailableDates(forBusiness) {
    const biz = forBusiness || selectedBusiness;
    const dates = [];

    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + i);

      const fullDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
      const businessAvailabilityMode = biz?.availabilityMode || availabilityMode;
      const businessAvailableDays = biz?.availableDays?.length ? biz.availableDays : availableDays;
      const businessSpecificDates = biz?.specificDates || specificDates;
      const shouldInclude =
        businessAvailabilityMode === "specific"
          ? businessSpecificDates.includes(fullDate)
          : businessAvailableDays.includes(dayName);

      if (shouldInclude) {
        dates.push({
          fullDate,
          display: date.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", weekday: "long" }),
          dayShort: date.toLocaleDateString("tr-TR", { weekday: "short" }),
          dateShort: date.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" }),
        });
      }
    }

    return dates;
  }

  function generateReservationCode() {
    return "RP-" + Math.floor(10000 + Math.random() * 90000);
  }

  function getBusinessAcceptedReservations() {
    if (!loggedBusiness) return [];

    return reservations.filter(
      (rez) =>
        String(rez.businessId) === String(loggedBusiness.id) &&
        (
          (rez.status === "completed" && rez.attendanceStatus === "attended") ||
          rez.status === "accepted"
        ),
    );
  }
  function getBusinessReservationCount(status) {
    if (!loggedBusiness) return 0;

    return reservations.filter(
      (rez) => String(rez.businessId) === String(loggedBusiness.id) && rez.status === status,
    ).length;
  }

  function getCustomerFrequencyList() {
    const accepted = getBusinessAcceptedReservations();
    const customerMap = {};

    accepted.forEach((rez) => {
      if (!customerMap[rez.email]) {
        customerMap[rez.email] = {
          name: rez.fullName,
          email: rez.email,
          count: 0,
          lastDate: rez.date,
        };
      }

      customerMap[rez.email].count += 1;

      if (rez.date > customerMap[rez.email].lastDate) {
        customerMap[rez.email].lastDate = rez.date;
      }
    });

    return Object.values(customerMap).sort((a, b) => b.count - a.count);
  }

  function getBusyDaysList() {
    const accepted = getBusinessAcceptedReservations();
    const dayMap = {};

    accepted.forEach((rez) => {
      const dayDate = parseLocalDate(rez.date);
      const dayName = dayDate
        ? dayDate.toLocaleDateString("tr-TR", { weekday: "long" })
        : "Bilinmiyor";

      if (!dayMap[dayName]) {
        dayMap[dayName] = 0;
      }

      dayMap[dayName] += 1;
    });

    return Object.entries(dayMap)
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => b.count - a.count);
  }

  function getBusyHoursList() {
    const accepted = getBusinessAcceptedReservations();
    const hourMap = {};

    accepted.forEach((rez) => {
      if (!hourMap[rez.time]) {
        hourMap[rez.time] = 0;
      }

      hourMap[rez.time] += 1;
    });

    return Object.entries(hourMap)
      .map(([time, count]) => ({ time, count }))
      .sort((a, b) => b.count - a.count);
  }

  function getAgeGroup(birthDate) {
    if (!birthDate) return "Belirtilmedi";

    const birth = parseLocalDate(birthDate);
    if (!birth || isNaN(birth.getTime())) return "Belirtilmedi";

    const today = new Date();

    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birth.getDate())
    ) {
      age--;
    }

    if (age < 18) return "18 Altı";
    if (age <= 24) return "18-24";
    if (age <= 34) return "25-34";
    if (age <= 44) return "35-44";
    return "45+";
  }

  function getDistributionList(field) {
    const accepted = getBusinessAcceptedReservations();
    const map = {};

    accepted.forEach((rez) => {
      let value = "Belirtilmedi";

      if (field === "age") {
        value = getAgeGroup(rez.customerProfile?.birthDate);
      } else {
        value = rez.customerProfile?.[field] || "Belirtilmedi";
      }

      if (!map[value]) {
        map[value] = 0;
      }

      map[value] += 1;
    });

    return Object.entries(map)
      .map(([label, count]) => ({
        label,
        count,
        percent:
          accepted.length > 0 ? Math.round((count / accepted.length) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  function goToReservationFlow() {
    if (loggedCustomer) {
      setPage("businesses");
    } else {
      setCustomerMode("login");
      setPage("customerAuth");
    }
  }

  function openReservationForm(business) {
    if (!business.reservationActive) {
      alert("Bu işletme şu an rezervasyon kabul etmiyor.");
      return;
    }
    setSelectedBusiness(business);
    setReservation({ phone: "", date: "", time: "", guests: "", note: "" });
    setTermsChecked({ biz: false, rp: false });
    setDatePickerOpen(false);
    setTimePickerOpen(false);
    setError("");
    setPage("reservation");
  }

  function handleChange(event) {
    setReservation({
      ...reservation,
      [event.target.name]: event.target.value,
    });
  }

  function sendReservation() {
    if (!loggedCustomer) {
      setError("Rezervasyon oluşturmak için giriş yapın.");
      setCustomerMode("login");
      setPage("customerAuth");
      return;
    }

    if (!emailVerified) {
      setError("Rezervasyon oluşturmak için e-posta adresinizi doğrulayın.");
      return;
    }

    if (reservation.phone === "")
      return setError("Telefon numaranızı girin.");
    if (reservation.date === "") return setError("Tarih seçin.");
    if (reservation.time === "") return setError("Saat seçin.");

    const guestsNumber = Number(reservation.guests);

    if (
      reservation.guests === "" ||
      isNaN(guestsNumber) ||
      guestsNumber < 1 ||
      !Number.isInteger(guestsNumber)
    ) {
      return setError("Geçerli bir misafir sayısı girin (en az 1).");
    }

    setError("");
    setPage("summary");
  }

  async function handleBusinessLogin() {
    const rlBiz = rlCheck(RL_KEYS.business);
    if (rlBiz.locked) {
      setLoginError(`Hesap geçici olarak kilitlendi. ${rlMsg(rlBiz.remaining)}`);
      setBizLoginLocked(true);
      return;
    }

    const email = businessLogin.email.trim().toLowerCase();
    const password = businessLogin.password;

    if (!email || !password) {
      setLoginError("E-posta ve şifre alanlarını doldurun.");
      return;
    }

    setLoginLoading(true);
    const { data, error } = await supabase.rpc("login_business", {
      p_email: email,
      p_password: password,
    });
    setLoginLoading(false);

    if (error || !data || data.length === 0) {
      const { attempts, locked, remaining } = rlFail(RL_KEYS.business);
      setBizLoginAttempts(attempts);
      if (locked) {
        setBizLoginLocked(true);
        setLoginError(`Çok fazla hatalı deneme. ${rlMsg(remaining)}`);
      } else {
        setLoginError(`Hatalı e-posta veya şifre. (${attempts}. deneme)`);
      }
      return;
    }

    // Tek oturum: müşteri varsa kapat
    if (loggedCustomer) {
      await supabase.auth.signOut();
      setLoggedCustomer(null);
      setEmailVerified(false);
    }

    const token = data[0].session_token || "";
    setBizSessionToken(token);
    localStorage.setItem("rp_biz_token", token);

    const business = formatBusiness(data[0]);
    setLoggedBusiness(business);
    setAvailabilityMode(business.availabilityMode || "weekly");
    setAvailableDays(business.availableDays || []);
    setSpecificDates(business.specificDates || []);
    setAvailableTimes(business.availableTimes || []);
    setDateTimesMap(business.dateTimes || {});
    setReservationDateTimesMap(business.reservationDateTimes || {});
    setMeetingAvailableTimes(business.meetingTimes || []);
    setMeetingAvailableDays(business.meetingDates || []);
    setBusinessHours(business.businessHours || {});
    setBusinessProfileForm({
      name: business.name || "",
      location: business.location || "",
      phone: business.phone || "",
      description: business.description || "",
      menu: business.menu || "",
      terms: business.terms || "",
    });

    localStorage.setItem("rp_biz_id", String(business.id));
    localStorage.setItem("rp_biz_cache", JSON.stringify(business));
    setLoginError("");
    rlReset(RL_KEYS.business);
    registerPush(business.email, "business", business.id);
    setBizLoginAttempts(0);
    setBizLoginLocked(false);
    // Arşiv istatistikleri çek
    supabase.rpc("get_business_stats", { p_business_id: business.id }).then(({ data }) => {
      if (data) setBizStatsArchive(data);
    });
    setPanelTab("incoming");
    setPage("businessPanel");
  }

  async function handleAdminLogin() {
    const rlState = rlCheck(RL_KEYS.admin);
    if (rlState.locked) {
      setAdminError(`Hesap geçici olarak kilitlendi. ${rlMsg(rlState.remaining)}`);
      return;
    }
    setAdminLoginLocked(rlState.locked);

    const email = adminLogin.email.trim().toLowerCase();
    const password = adminLogin.password;

    if (!email || !password) {
      setAdminError("E-posta ve şifre alanlarını doldurun.");
      return;
    }

    setLoginLoading(true);
    const { data, error } = await supabase.rpc("verify_admin", {
      p_email: email,
      p_password: password,
    });
    setLoginLoading(false);

    if (error || !data) {
      const { attempts, locked, remaining } = rlFail(RL_KEYS.admin);
      setAdminLoginAttempts(attempts);
      if (locked) {
        setAdminLoginLocked(true);
        setAdminError(`Çok fazla hatalı deneme. ${rlMsg(remaining)}`);
      } else {
        setAdminError(`Hatalı yönetici bilgileri. (${attempts}. deneme)`);
      }
      return;
    }

    setAdminError("");
    setAdminLoginAttempts(0);
    rlReset(RL_KEYS.admin);
    setAdminPassword(adminLogin.password);
    setPage("adminPanel");
    supabase.from("business_types").select("*").order("name").then(({ data: bt }) => {
      if (bt) setAdminBizTypes(bt);
    });
    supabase.rpc("admin_get_customers", { p_password: adminLogin.password }).then(({ data: custData }) => {
      if (custData) {
        setRegisteredCustomers(custData.map((c) => ({
          id: c.id, name: c.name, email: c.email, safeScore: c.safe_score ?? 100,
          profile: { phone: c.phone || "", gender: c.gender || "", birthDate: c.birth_date || "", job: c.job || "", smoking: c.smoking || "" },
        })));
      }
    });
  }

  async function closeDayReservations() {
    if (!selectedAcceptedDate) return;

    const targetReservations = reservations.filter(
      (rez) => String(rez.businessId) === String(loggedBusiness.id) &&
               rez.status === "accepted" &&
               rez.date === selectedAcceptedDate,
    );
    if (targetReservations.length === 0) return;

    setActionLoading(true);

    const { error } = await supabase.rpc("business_close_day", {
      p_token: bizSessionToken,
      p_business_id: loggedBusiness.id,
      p_date: selectedAcceptedDate,
    });

    if (error) {
      alert("Gün kapatılamadı: " + error.message);
      setActionLoading(false);
      return;
    }

    setReservations(prev => prev.map(rez => {
      if (
        String(rez.businessId) === String(loggedBusiness.id) &&
        rez.status === "accepted" &&
        rez.date === selectedAcceptedDate
      ) {
        return {
          ...rez,
          status: "completed",
          attendanceStatus: rez.attendanceStatus === "pending" ? "no_show" : rez.attendanceStatus,
        };
      }
      return rez;
    }));

    setSelectedAcceptedDate("");
    setActionLoading(false);
    setSavedMessage(`${formatDate(selectedAcceptedDate)} günü başarıyla kapatıldı.`);
    setTimeout(() => setSavedMessage(""), 3000);
  }
  if (!appReady) {
    const fillPct = 100 - loadProgress;
    return (
      <div className="app-loading">
        {/* Aurora mesh arka plan */}
        <div className="alf-aurora-bg" />
        <div className="alf-blob alf-blob-1" />
        <div className="alf-blob alf-blob-2" />
        <div className="alf-blob alf-blob-3" />

        {/* RP yazı efekti */}
        <div className="alf-scene">
          {/* Conic progress ring */}
          <svg className="alf-ring" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="85"
              fill="none" stroke="rgba(99,102,241,0.08)" strokeWidth="6"/>
            <circle cx="100" cy="100" r="85"
              fill="none"
              stroke="url(#ringGrad)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 85}`}
              strokeDashoffset={`${2 * Math.PI * 85 * (1 - loadProgress / 100)}`}
              transform="rotate(-90 100 100)"
              style={{transition:"stroke-dashoffset 0.45s cubic-bezier(0.25,1,0.5,1)"}}
            />
            <defs>
              <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"   stopColor="#6366f1"/>
                <stop offset="40%"  stopColor="#8b5cf6"/>
                <stop offset="70%"  stopColor="#a855f7"/>
                <stop offset="100%" stopColor="#ec4899"/>
              </linearGradient>
            </defs>
          </svg>

          {/* Dışarı yayılan glow halkası */}
          <div className="alf-glow-ring" style={{opacity: loadProgress/100}} />

          {/* RP metin katmanları */}
          <div className="alf-text-wrap">
            {/* Gölge / arka plan katmanı */}
            <div className="alf-text-shadow">RP</div>
            {/* Asıl iridescent katman */}
            <div className="alf-text-main">RP</div>
            {/* Dolan katman — progress ile */}
            <div className="alf-text-fill"
              style={{ clipPath: `inset(${fillPct}% 0 0 0)` }}>RP</div>
            {/* Shimmer katman */}
            <div className="alf-text-shimmer">RP</div>
          </div>

          {/* Floating partiküller */}
          <div className="alf-particles">
            {[...Array(6)].map((_,i) => (
              <div key={i} className={`alf-particle alf-p${i+1}`}
                style={{opacity: Math.min(1, loadProgress/40)}}/>
            ))}
          </div>
        </div>

        {/* Alt bilgi */}
        <div className="alf-bottom">
          <div className="alf-brand">RezPoint</div>
          <div className="alf-progress-text">{loadProgress < 100 ? `${loadProgress}%` : "Hazır"}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">

      {/* ── SW güncelleme banner ── */}
      {swUpdate && (
        <div className="sw-update-banner">
          <span>🆕 Yeni sürüm mevcut</span>
          <button
            className="sw-update-btn"
            onClick={async () => {
              const reg = await navigator.serviceWorker.getRegistration();
              if (reg?.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
              setSwUpdate(false);
            }}
          >
            Güncelle →
          </button>
          <button className="sw-update-close" onClick={() => setSwUpdate(false)}>✕</button>
        </div>
      )}

      {/* ── Ana ekrana ekle banner ── */}
      {showInstallBanner && (
        <div className="install-banner">
          <button
            className="install-banner-close"
            onClick={() => {
              setShowInstallBanner(false);
              localStorage.setItem("rp_install_dismissed", "1");
            }}
            aria-label="Kapat"
          >✕</button>

          <div className="install-banner-anim">
            <div className="ib-phone">
              <div className="ib-screen">
                <div className="ib-app-icon">
                  <span>R<em>P</em></span>
                </div>
              </div>
              <div className="ib-home-bar" />
            </div>
            <div className="ib-arrow">→</div>
            <div className="ib-homescreen">
              <div className="ib-hs-icon">
                <span>R<em>P</em></span>
              </div>
              <div className="ib-hs-label">RezPoint</div>
              <div className="ib-notif">
                <span className="ib-notif-dot" />
                Bildirim
              </div>
            </div>
          </div>

          <div className="install-banner-text">
            <strong>📲 Ana ekrana ekle</strong>
            <p>Tarayıcı menüsünden <em>"Ana ekrana ekle"</em> seçerek uygulama gibi kullan ve anlık bildirimler al.</p>
          </div>

          <button
            className="install-banner-btn"
            onClick={() => {
              setShowInstallBanner(false);
              localStorage.setItem("rp_install_dismissed", "1");
            }}
          >
            Tamam, anladım
          </button>
        </div>
      )}

      <nav className={`navbar${navScrolled ? " navbar--scrolled" : ""}`}>
        <div
          className="logo"
          onClick={() => {
            const newCount = logoClickCount + 1;

            if (newCount >= 5) {
              setLogoClickCount(0);
              setPage("adminLogin");
              setMobileMenuOpen(false);
            } else {
              setLogoClickCount(newCount);
              setPage("home");
              setMobileMenuOpen(false);
            }
          }}
        >
          <span className="logo-text">Rez<span className="logo-accent">Point</span></span>
        </div>

        {/* Sağ grup: bildirim + hamburger */}
        <div className="navbar-right">
          <div className="navbar-notif-wrap">
            <button
              className={`navbar-notif-btn${showWhatsNew ? " active" : ""}`}
              onClick={() => {
                setShowWhatsNew(p => !p);
                setMobileMenuOpen(false);
                if (!whatsNewRead) {
                  setWhatsNewRead(true);
                  localStorage.setItem("rp_whatsnew_read_v1", "1");
                }
              }}
              aria-label="Güncellemeler"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="8" cy="8" r="3" fill="currentColor"/>
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                <line x1="8" y1="1" x2="8" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              {!whatsNewRead && <span className="navbar-notif-badge" />}
            </button>

            {showWhatsNew && (
              <>
                <div className="whatsnew-backdrop" onClick={() => setShowWhatsNew(false)} />
                <div className="whatsnew-panel">
                  <div className="whatsnew-header">
                    <span className="whatsnew-title">Yenilikler</span>
                    <button className="whatsnew-close" onClick={() => setShowWhatsNew(false)}>✕</button>
                  </div>
                  <div className="whatsnew-list">
                    <div className="whatsnew-item new">
                      <div className="whatsnew-item-icon">📲</div>
                      <div className="whatsnew-item-body">
                        <div className="whatsnew-item-title">Ana Ekrana Ekle</div>
                        <div className="whatsnew-item-desc">
                          Tarayıcı menüsünden <strong>"Ana Ekrana Ekle"</strong> seçerek uygulama gibi kullanabilir, <strong>anlık bildirim</strong> alabilirsiniz.
                        </div>
                        <div className="whatsnew-item-date">Haziran 2026</div>
                      </div>
                    </div>
                    <div className="whatsnew-item">
                      <div className="whatsnew-item-icon">🗺️</div>
                      <div className="whatsnew-item-body">
                        <div className="whatsnew-item-title">Haritada Gör</div>
                        <div className="whatsnew-item-desc">İşletme profilindeki konuma tıklayarak Google Haritalar'da görebilirsiniz.</div>
                        <div className="whatsnew-item-date">Haziran 2026</div>
                      </div>
                    </div>
                    <div className="whatsnew-item">
                      <div className="whatsnew-item-icon">🏷️</div>
                      <div className="whatsnew-item-body">
                        <div className="whatsnew-item-title">Kategori Filtresi</div>
                        <div className="whatsnew-item-desc">İşletmeleri Restoran, Kafe, Bar ve Meyhane olarak filtreleyebilirsiniz.</div>
                        <div className="whatsnew-item-date">Haziran 2026</div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            className="menu-button"
            onClick={() => { setMobileMenuOpen(!mobileMenuOpen); setShowWhatsNew(false); }}
          >
            ☰
          </button>
        </div>

        <div className={mobileMenuOpen ? "nav-links open" : "nav-links"}>
          <button
            className="nav-button"
            onClick={() => {
              goToReservationFlow();
              setMobileMenuOpen(false);
            }}
          >
            {t.nav.makeReservation}
          </button>

          <button
            className="nav-button"
            onClick={() => {
              if (loggedBusiness) {
                setPage("businessPanel");
              } else if (loggedCustomer) {
                setPage("customerDashboard");
              } else {
                setCustomerMode("login");
                setPage("customerAuth");
              }
              setMobileMenuOpen(false);
            }}
          >
            {loggedBusiness
              ? (lang === "en" ? "My Business" : "İşletmem")
              : loggedCustomer
                ? t.nav.myAccount
                : (lang === "en" ? "Sign In" : "Giriş Yap")}
          </button>

          <button
            className="nav-button"
            onClick={() => {
              setPage("contact");
              setMobileMenuOpen(false);
            }}
          >
            {t.nav.contact}
          </button>

          <button
            className="nav-button lang-toggle"
            onClick={() => {
              const next = lang === "tr" ? "en" : "tr";
              setLang(next);
              localStorage.setItem("rp_lang", next);
              setMobileMenuOpen(false);
            }}
          >
            {lang === "tr" ? "🇬🇧 EN" : "🇹🇷 TR"}
          </button>
        </div>
      </nav>

      {mobileMenuOpen && (
        <div
          className="menu-backdrop"
          onClick={() => setMobileMenuOpen(false)}
        ></div>
      )}

      {page === "home" && (
        <>
        {/* ══ HERO ══ */}
        <section className="hp-hero lp-hero">
          <div className="lp-hero-content">
            <h1 className="lp-hero-headline">
              <span className="lp-hero-phrase" key={heroPhase}>
                {lang === "en"
                  ? ["Smart Reservation Platform", "Fast & Easy Booking", "Discover Nearby Venues"][heroPhase]
                  : ["Akıllı Rezervasyon Platformu", "Hızlı ve Kolay Rezervasyon", "Yakındaki Mekanları Keşfet"][heroPhase]
                }
              </span>
            </h1>
            <p className="lp-hero-sub">
              {lang === "en"
                ? "Instant online reservations and appointments for restaurants, cafes and businesses."
                : "Restoranlar, kafeler ve işletmeler için anlık online rezervasyon ve randevu sistemi."}
            </p>
          </div>

          {/* Arama kartı */}
          <div className="hp-search-card">
            {/* Tarih + Saat yan yana */}
            <div className="hp-row-2">
              <button
                className={`hp-field${datePickerOpen ? " open" : ""}`}
                onClick={() => { setDatePickerOpen(p => !p); setTimePickerOpen(false); setLocationPickerOpen(false); }}
              >
                <span className="hp-field-icon">📅</span>
                <span className="hp-field-inner">
                  <span className="hp-field-label">{lang === "en" ? "Date" : "Tarih"}</span>
                  <span className="hp-field-value">
                    {searchDate
                      ? new Date(searchDate + "T00:00:00").toLocaleDateString(lang === "en" ? "en-GB" : "tr-TR", { day: "numeric", month: "long" })
                      : (lang === "en" ? "Any date" : "Herhangi bir gün")}
                  </span>
                </span>
                <span className="hp-field-arrow">›</span>
              </button>
              <button
                className={`hp-field${timePickerOpen ? " open" : ""}`}
                onClick={() => { setTimePickerOpen(p => !p); setDatePickerOpen(false); setLocationPickerOpen(false); }}
              >
                <span className="hp-field-icon">🕐</span>
                <span className="hp-field-inner">
                  <span className="hp-field-label">{lang === "en" ? "Time" : "Saat"}</span>
                  <span className="hp-field-value">{searchTime || (lang === "en" ? "Any time" : "Herhangi")}</span>
                </span>
                <span className="hp-field-arrow">›</span>
              </button>
            </div>

            {/* Konum */}
            <button
              className={`hp-field hp-field-full${locationPickerOpen ? " open" : ""}`}
              onClick={() => { setLocationPickerOpen(p => !p); setDatePickerOpen(false); setTimePickerOpen(false); }}
            >
              <span className="hp-field-icon">📍</span>
              <span className="hp-field-inner">
                <span className="hp-field-label">{lang === "en" ? "Location" : "Konum"}</span>
                <span className="hp-field-value">
                  {searchLocation === "Hepsi" ? (lang === "en" ? "All locations" : "Tüm konumlar") : searchLocation}
                </span>
              </span>
              <span className="hp-field-arrow">›</span>
            </button>

            {/* Picker panelleri */}
            {locationPickerOpen && (
              <div className="ot-picker-panel">
                <div className="ot-picker-label">{lang === "en" ? "Select location" : "Konum seç"}</div>
                <div className="ot-loc-options">
                  {["Hepsi","Mağusa","İskele","Lefkoşa","Lefke","Girne"].map(loc => (
                    <button key={loc} className={`ot-loc-opt${searchLocation === loc ? " active" : ""}`}
                      onClick={() => { setSearchLocation(loc); setLocationPickerOpen(false); }}>
                      {loc === "Hepsi" ? (lang === "en" ? "All locations" : "Tüm konumlar") : `📍 ${loc}`}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {datePickerOpen && (
              <div className="ot-picker-panel">
                <div className="ot-picker-label">{lang === "en" ? "Select date" : "Tarih seç"}</div>
                <div className="home-date-strip">
                  <button className={!searchDate ? "home-strip-btn active" : "home-strip-btn"} onClick={() => { setSearchDate(""); setDatePickerOpen(false); }}>
                    <span className="strip-day">{t.hero.dayAll[0]}</span>
                    <span className="strip-date">{t.hero.dayAll[1]}</span>
                  </button>
                  {Array.from({ length: 30 }, (_, i) => {
                    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + i);
                    const fullDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
                    const locale = lang === "en" ? "en-GB" : "tr-TR";
                    return (
                      <button key={fullDate} className={searchDate === fullDate ? "home-strip-btn active" : "home-strip-btn"}
                        onClick={() => { setSearchDate(fullDate); setDatePickerOpen(false); }}>
                        <span className="strip-day">{d.toLocaleDateString(locale,{weekday:"short"})}</span>
                        <span className="strip-date">{d.toLocaleDateString(locale,{day:"2-digit",month:"short"})}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {timePickerOpen && (
              <div className="ot-picker-panel">
                <div className="ot-picker-label">{lang === "en" ? "Select time" : "Saat seç"}</div>
                <div className="home-time-strip">
                  <button className={!searchTime ? "home-strip-btn compact active" : "home-strip-btn compact"} onClick={() => { setSearchTime(""); setTimePickerOpen(false); }}>{t.hero.timeAll}</button>
                  {ALL_TIME_SLOTS.map(slot => (
                    <button key={slot} className={searchTime === slot ? "home-strip-btn compact active" : "home-strip-btn compact"} onClick={() => { setSearchTime(slot); setTimePickerOpen(false); }}>{slot}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Arama satırı */}
            <div className="hp-search-row">
              <span className="hp-search-icon">🔍</span>
              <input
                className="hp-search-input"
                type="text"
                placeholder={lang === "en" ? "Search business, category or service..." : "İşletme, kategori veya hizmet ara..."}
                value={businessSearch}
                onChange={e => setBusinessSearch(e.target.value)}
                onKeyDown={e => e.key === "Enter" && setPage("businesses")}
              />
              <button className="hp-search-btn" onClick={() => setPage("businesses")}>
                {lang === "en" ? "Search" : "Ara"}
              </button>
            </div>
          </div>
        </section>

          {/* Date picker dropdown */}
          {datePickerOpen && (
            <div className="ot-picker-panel">
              <div className="ot-picker-label">{lang === "en" ? "Select date" : "Tarih seç"}</div>
              <div className="home-date-strip">
                <button className={!searchDate ? "home-strip-btn active" : "home-strip-btn"} onClick={() => { setSearchDate(""); setDatePickerOpen(false); }}>
                  <span className="strip-day">{t.hero.dayAll[0]}</span>
                  <span className="strip-date">{t.hero.dayAll[1]}</span>
                </button>
                {Array.from({ length: 30 }, (_, i) => {
                  const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + i);
                  const fullDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
                  const locale = lang === "en" ? "en-GB" : "tr-TR";
                  return (
                    <button key={fullDate} className={searchDate === fullDate ? "home-strip-btn active" : "home-strip-btn"}
                      onClick={() => { setSearchDate(fullDate); setDatePickerOpen(false); }}>
                      <span className="strip-day">{d.toLocaleDateString(locale,{weekday:"short"})}</span>
                      <span className="strip-date">{d.toLocaleDateString(locale,{day:"2-digit",month:"short"})}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Time picker dropdown */}
          {timePickerOpen && (
            <div className="ot-picker-panel">
              <div className="ot-picker-label">{lang === "en" ? "Select time" : "Saat seç"}</div>
              <div className="home-time-strip">
                <button className={!searchTime ? "home-strip-btn compact active" : "home-strip-btn compact"} onClick={() => { setSearchTime(""); setTimePickerOpen(false); }}>{t.hero.timeAll}</button>
                {ALL_TIME_SLOTS.map(slot => (
                  <button key={slot} className={searchTime === slot ? "home-strip-btn compact active" : "home-strip-btn compact"} onClick={() => { setSearchTime(slot); setTimePickerOpen(false); }}>{slot}</button>
                ))}
              </div>
            </div>
          )}

        {/* ── Öne çıkanlar ── */}
        <section className="hp-featured">
          <div className="hp-featured-header">
            <div>
              <h2 className="hp-featured-title">{lang === "en" ? "Featured" : "Öne çıkanlar"}</h2>
              <p className="hp-featured-sub">{lang === "en" ? "Available and popular venues" : "Şu an müsait ve popüler mekanlar"}</p>
            </div>
            <button className="ot-view-all" onClick={() => setPage("businesses")}>{lang === "en" ? "View all" : "Tümünü gör"} →</button>
          </div>
          <div className="hp-cards-scroll">
            {(() => {
              const now = new Date();
              const todayDayName = now.toLocaleDateString("en-US", { weekday: "long" });
              const nowMins = now.getHours() * 60 + now.getMinutes();
              const toMins = str => { const [h,m] = (str||"00:00").split(":").map(Number); return (h||0)*60+(m||0); };
              // 00:00 kapanış = gece yarısı biter (1440 dk) veya gece yarısını geçen aralık
              const isInHours = (open, close, now) => {
                let o = toMins(open), c = toMins(close);
                if (c === 0) c = 1440;           // 00:00 → gece yarısı sonu
                if (c <= o) return now >= o || now < c;  // gece yarısını geçen aralık (22:00–02:00)
                return now >= o && now < c;
              };

              // Açık/Kapalı hesapla
              const isOpenNow = biz => {
                const h = (biz.businessHours || {})[todayDayName];
                if (!h?.open || !h?.close) return null; // saat ayarlanmamış
                return isInHours(h.open, h.close, nowMins);
              };

              // Tüm işletmeleri göster — rezervasyon kapalı olsa da listelenir
              const shown = adminBusinesses.filter(b =>
                searchLocation === "Hepsi" || b.location === searchLocation
              );

              if (shown.length === 0) return (
                <p className="description" style={{padding:"20px 0"}}>
                  {lang === "en" ? "No venues found." : "Mekan bulunamadı."}
                </p>
              );

              // Önce açık olanlar, sonra kapalı
              const sorted = [...shown].sort((a, b) => {
                const aOpen = isOpenNow(a); const bOpen = isOpenNow(b);
                if (aOpen === true && bOpen !== true) return -1;
                if (bOpen === true && aOpen !== true) return 1;
                return 0;
              });

              return sorted.map(biz => {
                const openStatus = isOpenNow(biz);
                return (
                <div className="hp-card" key={biz.id} onClick={() => { setSelectedBusiness(biz); setPage("businessProfile"); }}>
                  <div className="hp-card-photo">
                    {biz.logoUrl
                      ? <img src={biz.logoUrl} alt={biz.name} />
                      : <div className="hp-card-photo-placeholder">{biz.icon || "🏠"}</div>
                    }
                    {openStatus === true  && <span className="hp-card-badge open">{lang === "en" ? "Open" : "Açık"}</span>}
                    {openStatus === false && <span className="hp-card-badge closed">{lang === "en" ? "Closed" : "Kapalı"}</span>}
                    {openStatus === null  && <span className="hp-card-badge neutral">{lang === "en" ? "Active" : "Aktif"}</span>}
                    <button className={`hp-card-heart${favorites.some(f => f.id === biz.id) ? " active" : ""}`}
                      onClick={e => { e.stopPropagation(); toggleFavorite(biz); }} aria-label="Favori">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill={favorites.some(f => f.id === biz.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
                      </svg>
                    </button>
                  </div>
                  <div className="hp-card-body">
                    <div className="hp-card-name">{biz.name}</div>
                    <div className="hp-card-meta">
                      {biz.type}{biz.location ? ` · ${biz.location}` : ""}
                    </div>
                    {biz.rating > 0 && (
                      <div className="hp-card-rating">
                        <span className="hp-card-star">★</span>
                        <span>{biz.rating.toFixed(1)}</span>
                      </div>
                    )}
                    <button
                      className="hp-card-btn"
                      onClick={e => { e.stopPropagation(); openReservationForm(biz); }}
                    >
                      {lang === "en" ? "Make Reservation" : "Rezervasyon yap"}
                    </button>
                  </div>
                </div>
              );
              });
            })()}
          </div>
        </section>

        {/* ══ ÖZELLİKLERİMİZ ══ */}
        <section className="lp-section lp-reveal">
          <div className="lp-section-header">
            <h2 className="lp-section-title">
              {lang === "en" ? "Our Features" : "Özelliklerimiz"}
            </h2>
            <p className="lp-section-sub">
              {lang === "en"
                ? "Everything you need to manage reservations and grow your venue."
                : "Rezervasyonları yönetmek ve işletmenizi büyütmek için ihtiyacınız olan her şey."}
            </p>
          </div>
          <div className="lp-features-grid">
            {[
              {
                icon: "🛡️",
                title: lang === "en" ? "SafeScore System" : "SafeScore Sistemi",
                desc: lang === "en"
                  ? "Customer trust score tracks no-shows and rewards reliable guests automatically."
                  : "Müşteri güven puanı, no-show'ları izler ve güvenilir misafirleri otomatik ödüllendirir.",
              },
              {
                icon: "📅",
                title: lang === "en" ? "Smart Slot Management" : "Akıllı Slot Yönetimi",
                desc: lang === "en"
                  ? "Define availability by day, time or specific dates. Full control over your calendar."
                  : "Gün, saat veya özel tarih bazlı müsaitlik tanımlayın. Takviminiz üzerinde tam kontrol.",
              },
              {
                icon: "⭐",
                title: lang === "en" ? "Ratings & Reviews" : "Puan & Değerlendirme",
                desc: lang === "en"
                  ? "Businesses earn ratings based on real visit data. Find the best venues instantly."
                  : "İşletmeler gerçek ziyaret verilerine göre puan kazanır. En iyi mekanları anında bulun.",
              },
              {
                icon: "🔔",
                title: lang === "en" ? "Instant Push Alerts" : "Anlık Push Bildirimler",
                desc: lang === "en"
                  ? "New reservation? You'll know in seconds — even when the app is closed."
                  : "Yeni rezervasyon mu geldi? Uygulama kapalıyken bile saniyeler içinde haberdar olun.",
              },
              {
                icon: "📊",
                title: lang === "en" ? "Single-Panel Control" : "Tek Panel Yönetim",
                desc: lang === "en"
                  ? "Accept, reject, view stats and manage appointments — all from one screen."
                  : "Kabul et, reddet, istatistikleri gör, randevuları yönet — tek ekrandan.",
              },
              {
                icon: "🌐",
                title: lang === "en" ? "TR / EN Support" : "TR / EN Destek",
                desc: lang === "en"
                  ? "Full bilingual experience for both your local and international customers."
                  : "Yerel ve uluslararası müşterileriniz için tam iki dilli deneyim.",
              },
            ].map((f, i) => (
              <div className="lp-feat-card" key={i} style={{ animationDelay: `${i * 0.07}s` }}>
                <div className="lp-feat-icon">{f.icon}</div>
                <div className="lp-feat-title">{f.title}</div>
                <div className="lp-feat-desc">{f.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ══ FAYDALARIMIZ ══ */}
        <section className="lp-section lp-benefits lp-reveal">
          <div className="lp-section-header">
            <h2 className="lp-section-title">
              {lang === "en" ? "Benefits" : "Faydalarımız"}
            </h2>
            <p className="lp-section-sub">
              {lang === "en"
                ? "RezPoint works for both sides of the table."
                : "RezPoint hem işletmeye hem müşteriye değer katıyor."}
            </p>
          </div>
          <div className="lp-benefits-grid">
            {/* İşletme */}
            <div className="lp-benefit-col lp-benefit-biz">
              <div className="lp-benefit-label">
                🏢 {lang === "en" ? "For Businesses" : "İşletme İçin"}
              </div>
              <ul className="lp-benefit-list">
                {(lang === "en" ? [
                  "Reduce no-shows with SafeScore filtering",
                  "Fill your calendar — see daily occupancy at a glance",
                  "View customer profiles before they arrive",
                  "Manage both reservations and appointments in one panel",
                  "Lock days, set availability, close with a PIN",
                ] : [
                  "SafeScore filtresiyle no-show'ları azaltın",
                  "Takviminizi doldurun — günlük doluluk oranını tek bakışta görün",
                  "Müşteri profillerini gelişlerinden önce inceleyin",
                  "Rezervasyon ve randevuları tek panelden yönetin",
                  "Gün kilitleyin, müsaitlik belirleyin, PIN ile kapayın",
                ]).map((item, i) => (
                  <li key={i} className="lp-benefit-item"><span className="lp-check">✓</span>{item}</li>
                ))}
              </ul>
            </div>
            {/* Müşteri */}
            <div className="lp-benefit-col lp-benefit-cust">
              <div className="lp-benefit-label">
                👤 {lang === "en" ? "For Customers" : "Müşteri İçin"}
              </div>
              <ul className="lp-benefit-list">
                {(lang === "en" ? [
                  "Reserve a table in seconds, no phone calls",
                  "Book appointments at your preferred time",
                  "Get instant push notifications on your phone",
                  "Track all your reservations in one place",
                  "Earn loyalty points with every visit",
                ] : [
                  "Saniyeler içinde masa ayırtın, telefon aramanıza gerek yok",
                  "Tercih ettiğiniz saatte randevu alın",
                  "Telefonunuza anlık push bildirim alın",
                  "Tüm rezervasyonlarınızı tek yerden takip edin",
                  "Her ziyarette sadakat puanı kazanın",
                ]).map((item, i) => (
                  <li key={i} className="lp-benefit-item"><span className="lp-check">✓</span>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ══ CTA ══ */}
        <section className="lp-cta-section lp-reveal">
          <h2 className="lp-cta-title">
            {lang === "en" ? "Ready to get started?" : "Hemen başlamaya hazır mısınız?"}
          </h2>
          <p className="lp-cta-sub">
            {lang === "en"
              ? "Make a reservation now or add your business to RezPoint."
              : "Şimdi rezervasyon oluşturun veya işletmenizi RezPoint'e ekleyin."}
          </p>
          <div className="lp-cta-btns">
            <button className="lp-cta-btn lp-cta-primary" onClick={goToReservationFlow}>
              {lang === "en" ? "Make Reservation" : "Rezervasyon Oluştur"}
            </button>
            <button className="lp-cta-btn lp-cta-secondary" onClick={() => {}}>
              {lang === "en" ? "Add Your Business — Apply" : "İşletmenizi Ekleyin — Başvur"}
            </button>
          </div>
        </section>
        </>
      )}

      {page === "businesses" && (
        <section className="business-section">
          <button className="back-btn" onClick={() => { setPage("home"); setBizCategory("Tümü"); setBusinessSearch(""); }}>{t.businesses.back}</button>

          <h1>{t.businesses.title}</h1>
          <p className="description">{t.businesses.subtitle}</p>

          <div className="business-search-wrapper">
            <span className="business-search-icon">🔍</span>
            <input
              className="business-search-input"
              type="text"
              placeholder={t.businesses.searchPlaceholder}
              value={businessSearch}
              onChange={(e) => setBusinessSearch(e.target.value)}
            />
            {businessSearch && (
              <button className="business-search-clear" onClick={() => setBusinessSearch("")}>✕</button>
            )}
          </div>

          <div className="biz-category-bar">
            {["Tümü","Restoranlar","Kafeler","Barlar","Meyhaneler"].map(cat => (
              <button
                key={cat}
                className={`biz-cat-btn${bizCategory === cat ? " active" : ""}`}
                onClick={() => setBizCategory(cat)}
              >
                {cat === "Tümü" && "🏠 "}
                {cat === "Restoranlar" && "🍽️ "}
                {cat === "Kafeler" && "☕ "}
                {cat === "Barlar" && "🍸 "}
                {cat === "Meyhaneler" && "🍻 "}
                {cat}
              </button>
            ))}
          </div>

          {(searchLocation !== "Hepsi" || searchDate || searchTime) && (
            <div className="search-active-bar">
              {searchLocation !== "Hepsi" && <span className="search-chip">📍 {searchLocation}</span>}
              {searchDate && <span className="search-chip">📅 {formatDate(searchDate)}</span>}
              {searchTime && <span className="search-chip">🕐 {searchTime}</span>}
              <button
                className="search-chip-clear"
                onClick={() => { setSearchLocation("Hepsi"); setSearchDate(""); setSearchTime(""); }}
              >
                {t.businesses.clearFilter}
              </button>
            </div>
          )}

          <div className="biz-list">
            {(() => {
              const now = new Date();
              const todayDay = now.toLocaleDateString("en-US", { weekday: "long" });
              const nowMins = now.getHours() * 60 + now.getMinutes();
              const toMins = str => { const [h,m] = (str||"00:00").split(":").map(Number); return (h||0)*60+(m||0); };
              const bizIsOpen = biz => {
                const h = (biz.businessHours || {})[todayDay];
                if (!h?.open || !h?.close) return null;
                let o = toMins(h.open), c = toMins(h.close);
                if (c === 0) c = 1440;
                if (c <= o) return nowMins >= o || nowMins < c;
                return nowMins >= o && nowMins < c;
              };
              return adminBusinesses
              .filter((business) => {
                const q = businessSearch.toLowerCase();
                const bizName = (business.name || "").toLowerCase();
                const bizType = (business.type || "").toLowerCase();
                const bizLoc  = (business.location || "").toLowerCase();
                if (q && !bizName.includes(q) && !bizType.includes(q) && !bizLoc.includes(q)) return false;
                if (searchLocation !== "Hepsi" && business.location !== searchLocation) return false;
                if (bizCategory !== "Tümü") {
                  const typeMap = { "Restoranlar": ["restoran","restaurant","yemek","lokanta"], "Kafeler": ["kafe","cafe","kahve","coffee"], "Barlar": ["bar","cocktail","lounge"], "Meyhaneler": ["meyhane","tavern","pub","içki"] };
                  const keywords = typeMap[bizCategory] || [];
                  if (!keywords.some(k => bizType.includes(k))) return false;
                }
                if (searchDate) {
                  const dayName = new Date(searchDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
                  const dayOk = business.availabilityMode === "specific"
                    ? (business.specificDates || []).includes(searchDate)
                    : (business.availableDays || []).includes(dayName);
                  if (!dayOk) return false;
                }
                if (searchDate && searchTime) {
                  const timeOk = business.availableTimes.includes(searchTime);
                  if (!timeOk) return false;
                }
                return true;
              })
              .map((business, index) => (
                <div
                  className="biz-list-item"
                  key={business.id}
                  style={{ animationDelay: `${index * 0.05}s` }}
                  onClick={() => { setSelectedBusiness(business); setPage("businessProfile"); }}
                >
                  {/* Sol: fotoğraf/ikon */}
                  <div className="bl-photo">
                    {business.logoUrl
                      ? <img src={business.logoUrl} alt={business.name} />
                      : <span className="bl-icon">{business.icon || "🏠"}</span>
                    }
                  </div>

                  {/* Orta: bilgiler */}
                  <div className="bl-info">
                    <div className="bl-name">{business.name}</div>
                    <div className="bl-meta">
                      <span className="bl-type">{business.type}</span>
                      {business.location && <span className="bl-dot">·</span>}
                      {business.location && (
                        <a className="bl-loc bc-map-link"
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(business.name + " " + business.location)}`}
                          target="_blank" rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}>
                          📍 {business.location}
                        </a>
                      )}
                    </div>
                    {(() => {
                      const os = bizIsOpen(business);
                      const h = (business.businessHours || {})[todayDay];
                      if (os === true)  return <span className="bl-status open">Açık{h?.close ? ` · ${h.close}'e kadar` : ""}</span>;
                      if (os === false) return <span className="bl-status closed">Kapalı{h?.open ? ` · ${h.open}'de açılıyor` : ""}</span>;
                      return null;
                    })()}
                  </div>

                  {/* Sağ: aksiyon */}
                  <div className="bl-actions">
                    <button className="bl-fav"
                      onClick={e => { e.stopPropagation(); toggleFavorite(business); }} aria-label="Favori">
                      <svg width="16" height="16" viewBox="0 0 24 24"
                        fill={favorites.some(f => f.id === business.id) ? "#ef4444" : "none"}
                        stroke={favorites.some(f => f.id === business.id) ? "#ef4444" : "currentColor"}
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
                      </svg>
                    </button>
                    {business.reservationActive && (
                      <button className="bl-btn primary"
                        onClick={e => { e.stopPropagation(); openReservationForm(business); }}>
                        {t.businesses.reserveBtn}
                      </button>
                    )}
                    {business.meetingEnabled && business.meetingDates?.length > 0 && (
                      <button className="bl-btn secondary"
                        onClick={e => {
                          e.stopPropagation();
                          setMeetingFormBusiness(business);
                          setMeetingForm({ fullName: loggedCustomer?.name || "", email: loggedCustomer?.email || "", phone: "", company: "", reason: "is_gorusmesi", productCategory: "", date: "", time: "", note: "" });
                          setMeetingTermsChecked({ biz: false, rp: false });
                          setMeetingFormError("");
                          setPage("meetingRequest");
                        }}>
                        {t.businesses.meetingBtn}
                      </button>
                    )}
                  </div>
                </div>
              )).concat(
                /* Sonuç yok */
                [] // filtrelenmiş liste boşsa aşağıda handle ediliyor
              );
            })()}
            {/* Sonuç yok mesajı */}
            {adminBusinesses.filter(b => {
              const q = businessSearch.toLowerCase();
              const bn = (b.name||"").toLowerCase(), bt = (b.type||"").toLowerCase(), bl = (b.location||"").toLowerCase();
              if (q && !bn.includes(q) && !bt.includes(q) && !bl.includes(q)) return false;
              if (searchLocation !== "Hepsi" && b.location !== searchLocation) return false;
              if (bizCategory !== "Tümü") {
                const tm = { "Restoranlar":["restoran","restaurant","yemek","lokanta"],"Kafeler":["kafe","cafe","kahve","coffee"],"Barlar":["bar","cocktail","lounge"],"Meyhaneler":["meyhane","tavern","pub","içki"] };
                if (!(tm[bizCategory]||[]).some(k => bt.includes(k))) return false;
              }
              return true;
            }).length === 0 && (
              <p className="description" style={{ padding: "20px 0" }}>
                {t.businesses.noResults(businessSearch)}{t.businesses.noResultsSuffix}
              </p>
            )}
          </div>
        </section>
      )}

      {page === "reservation" && selectedBusiness && (
        <section className="reservation-section">
          <button className="back-btn" onClick={() => setPage("businesses")}>{t.reservation.back}</button>

          <div className="reservation-box">
            <h1>{selectedBusiness.name}</h1>
            <p className="description" style={{ marginTop: 0 }}>
              {selectedBusiness.type}{selectedBusiness.location ? ` · ${selectedBusiness.location}` : ""}
            </p>

            {loggedCustomer && !emailVerified && (
              <div className="email-verify-warning">
                <span>⚠️</span>
                <div>
                  <strong>{t.reservation.emailNotVerified}</strong>
                  <p>{t.reservation.emailNotVerifiedDesc}</p>
                </div>
                <button
                  type="button"
                  className="resend-btn"
                  onClick={async () => {
                    await supabase.auth.resend({ type: "signup", email: loggedCustomer.email });
                    alert("Doğrulama maili gönderildi!");
                  }}
                >
                  {t.reservation.resendEmail}
                </button>
              </div>
            )}

            <form className="reservation-form">
              {loggedCustomer ? (
                <div className="rez-info-row">
                  <div className="rez-info-item">
                    <span className="rez-info-label">{t.reservation.nameLabel}</span>
                    <span className="rez-info-value">{loggedCustomer.name}</span>
                  </div>
                  <div className="rez-info-item">
                    <span className="rez-info-label">{t.reservation.emailLabel}</span>
                    <span className="rez-info-value">{loggedCustomer.email}</span>
                  </div>
                </div>
              ) : (
                <div style={{ background: "rgba(109,40,217,0.05)", border: "1px dashed rgba(109,40,217,0.25)", borderRadius: 10, padding: "10px 14px", marginBottom: 4, fontSize: 13, color: "#6b7280" }}>
                  {t.reservation.loginHint}
                </div>
              )}

              <div className="date-time-row">
                <div className="strip-section">
                  <div className="strip-label">{t.reservation.dateLabel}</div>
                  <div className="strip-scroll-wrap">
                    <button type="button" className="strip-arrow" onClick={() => dateStripRef.current?.scrollBy({ left: -160, behavior: "smooth" })}>‹</button>
                    <div className="date-strip" ref={dateStripRef}>
                      {getAvailableDates().map((date) => (
                        <button
                          key={date.fullDate}
                          type="button"
                          className={reservation.date === date.fullDate ? "strip-btn active" : "strip-btn"}
                          onClick={() => setReservation({ ...reservation, date: date.fullDate, time: "" })}
                        >
                          <span className="strip-day">{date.dayShort}</span>
                          <span className="strip-date">{date.dateShort}</span>
                        </button>
                      ))}
                    </div>
                    <button type="button" className="strip-arrow" onClick={() => dateStripRef.current?.scrollBy({ left: 160, behavior: "smooth" })}>›</button>
                  </div>
                </div>

                <div className="strip-section">
                  <div className="strip-label">{t.reservation.timeLabel}</div>
                  <div className="strip-scroll-wrap">
                    <button type="button" className="strip-arrow" onClick={() => timeStripRef.current?.scrollBy({ left: -160, behavior: "smooth" })}>‹</button>
                    <div className="time-strip" ref={timeStripRef}>
                      {(() => {
                        const perDate = reservation.date && selectedBusiness?.reservationDateTimes?.[reservation.date];
                        return (perDate?.length ? perDate : (selectedBusiness?.availableTimes?.length ? selectedBusiness.availableTimes : availableTimes));
                      })().map((time) => (
                        <button key={time} type="button"
                          className={reservation.time === time ? "strip-btn active" : "strip-btn"}
                          onClick={() => setReservation({ ...reservation, time })}>
                          {time}
                        </button>
                      ))}
                    </div>
                    <button type="button" className="strip-arrow" onClick={() => timeStripRef.current?.scrollBy({ left: 160, behavior: "smooth" })}>›</button>
                  </div>
                </div>
              </div>

              <input name="guests" value={reservation.guests} onChange={handleChange} type="number" placeholder={t.reservation.guestsPlaceholder} min="1" max="20" />
              <input name="phone" value={reservation.phone} onChange={handleChange} type="tel" placeholder={t.reservation.phonePlaceholder} />
              <textarea name="note" value={reservation.note} onChange={handleChange} placeholder={t.reservation.notePlaceholder} />

              {error && <p className="error-message">{error}</p>}

              <div className="rez-terms-checks">
                <label className="rez-terms-label">
                  <input type="checkbox" checked={termsChecked.biz} onChange={e => setTermsChecked(p => ({ ...p, biz: e.target.checked }))} />
                  <span className="rez-check-box">{termsChecked.biz ? "✓" : ""}</span>
                  <span>
                    <button type="button" className="terms-link" onClick={() => setTermsModal("biz")}>{t.reservation.bizTerms}</button>
                    {t.reservation.termsAccept}
                  </span>
                </label>
                <label className="rez-terms-label">
                  <input type="checkbox" checked={termsChecked.rp} onChange={e => setTermsChecked(p => ({ ...p, rp: e.target.checked }))} />
                  <span className="rez-check-box">{termsChecked.rp ? "✓" : ""}</span>
                  <span>
                    <button type="button" className="terms-link" onClick={() => setTermsModal("rp")}>{t.reservation.rpTerms}</button>
                    {t.reservation.termsAccept}
                  </span>
                </label>
              </div>

              {(() => {
                const formIncomplete = !reservation.date || !reservation.time || !reservation.guests || !reservation.phone || !termsChecked.biz || !termsChecked.rp;
                if (loggedCustomer) {
                  const disabled = !emailVerified || formIncomplete;
                  return (
                    <button type="button" disabled={disabled} onClick={sendReservation} style={{ opacity: disabled ? 0.5 : 1 }}>
                      {t.reservation.submitBtn}
                    </button>
                  );
                }
                return (
                  <button type="button" disabled={formIncomplete} style={{ opacity: formIncomplete ? 0.5 : 1 }}
                    onClick={() => { setAfterLoginReturnPage("reservation"); setCustomerMode("login"); setPage("customerAuth"); }}>
                    {t.reservation.loginAndSend}
                  </button>
                );
              })()}

              {termsModal && (
                <div className="terms-modal-overlay" onClick={() => setTermsModal(null)}>
                  <div className="terms-modal" onClick={e => e.stopPropagation()}>
                    <h3>
                      {termsModal === "biz"
                        ? `${selectedBusiness?.name} — Koşullar`
                        : "RezPoint Kullanım Koşulları"}
                    </h3>
                    <div className="terms-modal-body">
                      {termsModal === "biz"
                        ? (selectedBusiness?.terms || "Bu işletme henüz koşul belirlememiş.")
                        : (rpTerms || "Henüz koşul eklenmemiş.")}
                    </div>
                    <button type="button" className="primary-btn" style={{ marginTop: 16 }} onClick={() => setTermsModal(null)}>
                      {t.common.close}
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>
        </section>
      )}

      {page === "summary" && selectedBusiness && loggedCustomer && (
        <section className="reservation-section">
          <div className="reservation-box">
            <h1>{t.reservation.summaryTitle}</h1>
            <p className="description">{t.reservation.summaryDesc}</p>

            <div className="card-row">
              <span>{t.reservation.fieldBusiness}</span>
              <strong>{selectedBusiness.name}</strong>
            </div>
            <div className="card-row">
              <span>{t.reservation.fieldName}</span>
              <strong>{loggedCustomer.name}</strong>
            </div>
            <div className="card-row">
              <span>{t.reservation.fieldEmail}</span>
              <strong>{loggedCustomer.email}</strong>
            </div>
            <div className="card-row">
              <span>{t.reservation.fieldPhone}</span>
              <strong>{reservation.phone}</strong>
            </div>
            <div className="card-row">
              <span>{t.reservation.fieldDate}</span>
              <strong>{formatDate(reservation.date)}</strong>
            </div>
            <div className="card-row">
              <span>{t.reservation.fieldTime}</span>
              <strong>{reservation.time}</strong>
            </div>
            <div className="card-row">
              <span>{t.reservation.fieldGuests}</span>
              <strong>{reservation.guests}</strong>
            </div>
            <div className="card-row">
              <span>{t.reservation.fieldNote}</span>
              <strong>{reservation.note || t.reservation.noNote}</strong>
            </div>

            <button
              className="primary-btn"
              disabled={isCreatingReservation}
              onClick={async () => {
                if (isCreatingReservation) return;

                setIsCreatingReservation(true);
                const newCode = generateReservationCode();
                setReservationCode(newCode);

                // Use the logged-in customer's saved profile rather than
                // the (possibly unsaved / stale) customerProfile state,
                // so reservations always reflect the customer's actual
                // stored profile data.
                const profileToUse =
                  loggedCustomer.profile || customerProfile;

                const newReservation = {
                  id: Date.now(),
                  business: selectedBusiness.name,
                  businessId: selectedBusiness.id,
                  fullName: loggedCustomer.name,
                  email: loggedCustomer.email,
                  phone: reservation.phone,
                  date: reservation.date,
                  time: reservation.time,
                  guests: reservation.guests,
                  note: reservation.note,
                  safeScore: loggedCustomer.safeScore ?? 100,
                  code: newCode,
                  status: "pending",
                  attendanceStatus: "pending",
                  createdAt: new Date().toISOString(),
                  customerProfile: {
                    gender: profileToUse.gender,
                    birthDate: profileToUse.birthDate,
                    job: profileToUse.job,
                    smoking: profileToUse.smoking,
                  },
                };

                const { error } = await supabase.from("reservations").insert([
                  {
                    business_id: selectedBusiness.id,
                    business: selectedBusiness.name,

                    full_name: loggedCustomer.name,
                    email: loggedCustomer.email,
                    phone: reservation.phone,

                    date: reservation.date,
                    time: reservation.time,
                    guests: Number(reservation.guests),
                    note: reservation.note,

                    safe_score: loggedCustomer.safeScore ?? 100,
                    code: newCode,
                    status: "pending",

                    gender: profileToUse.gender,
                    birth_date: profileToUse.birthDate,
                    job: profileToUse.job,
                    smoking: profileToUse.smoking,

                    user_email: loggedCustomer.email,
                  },
                ]);

                if (error) {
                  console.log("Reservation insert error:", error);
                  alert(`Rezervasyon oluşturulamadı: ${error.message}`);
                  setIsCreatingReservation(false);
                  return;
                }

                setReservations([...reservations, newReservation]);
                setIsCreatingReservation(false);
                // İşletmeye yeni rezervasyon bildirimi
                sendPush({ userType: "business", userId: String(selectedBusiness?.id), title: "🔔 Yeni Rezervasyon İsteği", body: `${loggedCustomer?.name || "Misafir"} rezervasyon oluşturdu · ${newReservation.date} ${newReservation.time}`, url: "/" });
                setPage("success");
              }}
            >
              {isCreatingReservation ? t.reservation.confirming : t.reservation.confirmBtn}
            </button>
          </div>
        </section>
      )}

      {page === "success" && selectedBusiness && loggedCustomer && (
        <section className="reservation-section">
          <div className="reservation-box">
            <h1>{t.reservation.successTitle}</h1>

            <p className="description">{t.reservation.successDesc}</p>

            <div className="card-row">
              <span>{t.popup.fieldCode}</span>
              <strong>{reservationCode}</strong>
            </div>

            <button
              className="primary-btn"
              onClick={() => {
                setReservation({
                  phone: "",
                  date: "",
                  time: "",
                  guests: "",
                  note: "",
                });
                setSelectedBusiness(null);
                setCustomerTab("reservations");
                setPage("customerDashboard");
              }}
            >
              {t.reservation.goToReservations}
            </button>
          </div>
        </section>
      )}

      {page === "customerAuth" && (
        <section className="reservation-section">
          <div className="reservation-box">

            {emailPending ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: 56, marginBottom: 16 }}>📧</div>
                <h2>E-posta Doğrulama Linki Gönderildi</h2>
                <p className="description" style={{ marginBottom: 24 }}>
                  <strong>{customerForm.email}</strong> adresine bir doğrulama linki gönderdik.
                  Lütfen mail kutunuzu kontrol edin ve linke tıklayın.
                </p>
                <p className="description" style={{ fontSize: 13, marginBottom: 24 }}>
                  Spam/Junk klasörünü de kontrol etmeyi unutmayın.
                </p>
                <button
                  className="secondary-btn"
                  style={{ marginBottom: 10 }}
                  onClick={async () => {
                    const { error } = await supabase.auth.resend({
                      type: "signup",
                      email: customerForm.email,
                    });
                    if (!error) alert("Doğrulama maili tekrar gönderildi.");
                    else alert("Gönderilemedi, lütfen tekrar deneyin.");
                  }}
                >
                  Tekrar Gönder
                </button>
                <br />
                <button
                  className="secondary-btn"
                  onClick={() => { setEmailPending(false); setCustomerMode("login"); }}
                >
                  Giriş Sayfasına Dön
                </button>
              </div>
            ) : (
              <>
            {authConfirmMsg && (
              <div style={{ background: "#f0fdf4", border: "1.5px solid #86efac", borderRadius: 12, padding: "12px 16px", marginBottom: 16, color: "#15803d", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
                ✅ {authConfirmMsg}
              </div>
            )}

            <h1>
              {customerMode === "business"
                ? (lang === "en" ? "Business Login" : "İşletme Girişi")
                : customerMode === "register"
                  ? t.auth.registerBtn
                  : t.nav.customerLogin}
            </h1>

            <p className="description">{t.auth.subtitle}</p>

            <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
              <button
                className={customerMode !== "business" ? "selected-time" : "time-btn"}
                type="button"
                onClick={() => setCustomerMode("login")}
              >
                {lang === "en" ? "Customer" : "Müşteri Girişi"}
              </button>
              <button
                className={customerMode === "business" ? "selected-time" : "time-btn"}
                type="button"
                onClick={() => { setCustomerMode("business"); setLoginError(""); setCustomerAuthError(""); setBusinessLogin({ email: "", password: "" }); }}
              >
                {lang === "en" ? "Business" : "İşletme Girişi"}
              </button>
            </div>

            {customerMode === "business" ? (
              <form className="reservation-form" onSubmit={e => { e.preventDefault(); handleBusinessLogin(); }}>
                <input
                  type="email"
                  placeholder="İşletme E-postası"
                  autoComplete="username"
                  disabled={bizLoginLocked || loginLoading}
                  value={businessLogin.email}
                  onChange={(e) => setBusinessLogin({ ...businessLogin, email: e.target.value })}
                />
                <input
                  type="password"
                  placeholder="Şifre"
                  autoComplete="current-password"
                  disabled={bizLoginLocked || loginLoading}
                  value={businessLogin.password}
                  onChange={(e) => setBusinessLogin({ ...businessLogin, password: e.target.value })}
                />
                {loginError && <p className="error-message">{loginError}</p>}
                <button type="submit" disabled={bizLoginLocked || loginLoading}>
                  {loginLoading ? <Spinner /> : "Giriş Yap"}
                </button>
              </form>
            ) : (
            <form className="reservation-form">
              {isPasswordRecovery ? (
                <>
                  <input
                    type="password"
                    placeholder={t.auth.newPasswordPlaceholder}
                    value={customerForm.password}
                    onChange={(e) => setCustomerForm({ ...customerForm, password: e.target.value })}
                  />
                </>
              ) : (
                <>
                  {customerMode === "register" && (
                    <input
                      type="text"
                      placeholder={t.auth.namePlaceholder}
                      value={customerForm.name}
                      onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                    />
                  )}
                  <input type="email" placeholder={t.auth.emailPlaceholder} value={customerForm.email} onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })} />
                  <input type="password" placeholder={t.auth.passwordPlaceholder} value={customerForm.password} onChange={(e) => setCustomerForm({ ...customerForm, password: e.target.value })} />
                </>
              )}

              {customerAuthError && (
                <p className="error-message">{customerAuthError}</p>
              )}

              <button
                type="button"
                disabled={custLoginLocked && Date.now() < (custLockUntil ?? 0)}
                onClick={async () => {
                  if (isPasswordRecovery) {
                    if (customerForm.password.length < 6) {
                      setCustomerAuthError("Şifre en az 6 karakter olmalı.");
                      return;
                    }
                    const { error } = await supabase.auth.updateUser({ password: customerForm.password });
                    if (error) { setCustomerAuthError("Şifre güncellenemedi: " + error.message); return; }
                    setIsPasswordRecovery(false);
                    setCustomerForm(f => ({ ...f, password: "" }));
                    setAuthConfirmMsg("Şifreniz başarıyla güncellendi! Şimdi giriş yapabilirsiniz.");
                    setCustomerAuthError("");
                    return;
                  }
                  if (customerMode === "register") {
                    const emailTrimmedR = customerForm.email.trim().toLowerCase();
                    const emailRegexR = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
                    if (!customerForm.name.trim()) {
                      setCustomerAuthError("Lütfen adınızı ve soyadınızı girin.");
                      return;
                    }
                    if (!emailTrimmedR) {
                      setCustomerAuthError("Lütfen e-posta adresinizi girin.");
                      return;
                    }
                    if (!emailRegexR.test(emailTrimmedR)) {
                      setCustomerAuthError("Geçerli bir e-posta adresi girin. (örn: ad@example.com)");
                      return;
                    }
                    if (!customerForm.password) {
                      setCustomerAuthError("Lütfen bir şifre girin.");
                      return;
                    }
                    if (customerForm.password.length < 6) {
                      setCustomerAuthError("Şifre en az 6 karakter olmalıdır.");
                      return;
                    }
                    setCustomerAuthError("E-posta domaini kontrol ediliyor...");
                    const mxOkR = await checkEmailDomainMX(emailTrimmedR);
                    if (!mxOkR) {
                      setCustomerAuthError("Bu e-posta adresi geçersiz görünüyor. Lütfen gerçek bir e-posta adresi girin.");
                      return;
                    }
                    setCustomerAuthError("");

                    // Register via Supabase Auth — secure hashing,
                    // automatic email verification mail handled by Supabase.
                    const { data: authData, error: authError } =
                      await supabase.auth.signUp({
                        email: customerForm.email,
                        password: customerForm.password,
                        options: { emailRedirectTo: "https://getrezpoint.com" },
                      });

                    if (authError) {
                      setCustomerAuthError(authError.message);
                      return;
                    }

                    const { error: regError } = await supabase.rpc("register_or_link_customer", {
                      p_name: customerForm.name,
                      p_email: customerForm.email,
                      p_auth_user_id: authData.user.id,
                    });

                    if (regError) {
                      setCustomerAuthError("Hesap oluşturulamadı. Tekrar deneyin.");
                      return;
                    }

                    setCustomerAuthError("");
                    setEmailPending(true);
                  } else {
                    /* ── Kilit kontrolü ── */
                    const rlCust = rlCheck(RL_KEYS.customer);
                    if (rlCust.locked) {
                      setCustLoginLocked(true);
                      setCustomerAuthError(`Hesap geçici olarak kilitlendi. ${rlMsg(rlCust.remaining)}`);
                      return;
                    }
                    setCustLoginLocked(false);

                    /* ── Giriş doğrulaması ── */
                    const emailTrimmed = customerForm.email.trim().toLowerCase();
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
                    if (!emailTrimmed) {
                      setCustomerAuthError("Lütfen e-posta adresinizi girin.");
                      return;
                    }
                    if (!emailRegex.test(emailTrimmed)) {
                      setCustomerAuthError("Geçerli bir e-posta adresi girin. (örn: ad@example.com)");
                      return;
                    }
                    if (!customerForm.password) {
                      setCustomerAuthError("Lütfen şifrenizi girin.");
                      return;
                    }
                    setCustomerAuthError("E-posta domaini kontrol ediliyor...");
                    const mxOk = await checkEmailDomainMX(emailTrimmed);
                    if (!mxOk) {
                      setCustomerAuthError("Bu e-posta adresi geçersiz görünüyor. Lütfen gerçek bir e-posta adresi girin.");
                      return;
                    }
                    setCustomerAuthError("");

                    const { data: authData, error: authError } =
                      await supabase.auth.signInWithPassword({
                        email: emailTrimmed,
                        password: customerForm.password,
                      });

                    if (authError) {
                      if (authError.message.toLowerCase().includes("email not confirmed")) {
                        setCustomerAuthError("E-posta adresinizi henüz doğrulamadınız. Mail kutunuzu kontrol edin.");
                        return;
                      }
                      const { attempts, locked, remaining } = rlFail(RL_KEYS.customer);
                      setCustLoginAttempts(attempts);
                      if (locked) {
                        setCustLoginLocked(true);
                        setCustomerAuthError(`Çok fazla hatalı deneme. ${rlMsg(remaining)}`);
                      } else {
                        setCustomerAuthError(`Hatalı e-posta veya şifre. (${attempts}. deneme)`);
                      }
                      return;
                    }
                    rlReset(RL_KEYS.customer);
                    setCustLoginAttempts(0);
                    setCustLoginLocked(false);

                    const { data: custData, error: custError } = await supabase
                      .from("customers")
                      .select("*")
                      .eq("auth_user_id", authData.user.id)
                      .single();

                    if (custError || !custData) {
                      setCustomerAuthError("Hesap bilgileri alınamadı.");
                      return;
                    }

                    const foundCustomer = {
                      id: custData.id,
                      name: custData.name,
                      email: custData.email,
                      safeScore: custData.safe_score || 100,
                    };

                    setCustomerAuthError("");
                    setCustomerForm({ name: custData.name, email: custData.email, password: "" });
                    // Tek oturum: işletme varsa kapat
                    if (loggedBusiness) {
                      localStorage.removeItem("rp_biz_id");
                      localStorage.removeItem("rp_biz_token");
                      localStorage.removeItem("rp_biz_cache");
                      setBizSessionToken("");
                      setLoggedBusiness(null);
                    }
                    setLoggedCustomer(foundCustomer);
                    setCustomerProfile({
                      phone: custData.phone || "",
                      gender: custData.gender || "",
                      birthDate: custData.birth_date || "",
                      job: custData.job || "",
                      smoking: custData.smoking || "",
                    });
                    setEmailVerified(true);
                    loadCustomerExtras(custData.id);
                    registerPush(foundCustomer.email, "customer", foundCustomer.id);
                    if (afterLoginReturnPage) {
                      const returnTo = afterLoginReturnPage;
                      setAfterLoginReturnPage(null);
                      if (returnTo === "meetingRequest") {
                        setMeetingForm(prev => ({ ...prev, fullName: foundCustomer.name, email: foundCustomer.email }));
                      }
                      setPage(returnTo);
                    } else {
                      setPage("customerDashboard");
                    }
                  }
                }}
              >
                  {isPasswordRecovery ? t.auth.updatePasswordBtn : customerMode === "login" ? t.auth.loginBtn : t.auth.registerBtn}
              </button>
              {customerMode === "login" && !isPasswordRecovery && (
                <p style={{ textAlign: "center", marginTop: 12, fontSize: 13 }}>
                  <button
                    type="button"
                    style={{ background: "none", border: "none", color: "var(--purple)", cursor: "pointer", fontSize: 13, textDecoration: "underline" }}
                    onClick={async () => {
                      const email = customerForm.email.trim().toLowerCase();
                      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
                      if (!email) {
                        setForgotPasswordMsg("Önce e-posta adresinizi girin.");
                        return;
                      }
                      if (!emailRegex.test(email)) {
                        setForgotPasswordMsg("Geçerli bir e-posta adresi girin. (örn: ad@example.com)");
                        return;
                      }
                      setForgotPasswordMsg("E-posta domaini kontrol ediliyor...");
                      const mxOk = await checkEmailDomainMX(email);
                      if (!mxOk) {
                        setForgotPasswordMsg("Bu e-posta adresi geçersiz görünüyor.");
                        return;
                      }
                      setForgotPasswordMsg("");
                      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: "https://getrezpoint.com" });
                      if (error) { setForgotPasswordMsg("Gönderilemedi: " + error.message); return; }
                      setForgotPasswordMsg("✅ Şifre sıfırlama bağlantısı e-postanıza gönderildi.");
                    }}
                  >{t.auth.forgotPassword}</button>
                </p>
              )}
              {forgotPasswordMsg && (
                <p style={{ textAlign: "center", marginTop: 8, fontSize: 13, color: forgotPasswordMsg.startsWith("Gönderilemedi") ? "var(--red)" : "var(--green)", fontWeight: 600 }}>
                  {forgotPasswordMsg}
                </p>
              )}
              {customerMode === "login" && !isPasswordRecovery && (
                <p style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: "var(--muted)" }}>
                  Hesabın yok mu?{" "}
                  <button
                    type="button"
                    style={{ background: "none", border: "none", color: "var(--purple)", cursor: "pointer", fontSize: 13, fontWeight: 600, textDecoration: "underline" }}
                    onClick={() => setCustomerMode("register")}
                  >
                    Üye Ol
                  </button>
                </p>
              )}
              {customerMode === "register" && !isPasswordRecovery && (
                <p style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: "var(--muted)" }}>
                  Zaten hesabın var mı?{" "}
                  <button
                    type="button"
                    style={{ background: "none", border: "none", color: "var(--purple)", cursor: "pointer", fontSize: 13, fontWeight: 600, textDecoration: "underline" }}
                    onClick={() => setCustomerMode("login")}
                  >
                    Giriş Yap
                  </button>
                </p>
              )}
            </form>
            )}
              </>
            )}
          </div>
        </section>
      )}

      {page === "customerDashboard" && (
        <section className="reservation-section">
          <div className="reservation-box">
            <h1>Müşteri Paneli</h1>

            {loggedCustomer ? (
              <>
                <p className="description">{t.dashboard.hello(loggedCustomer.name)} 👋</p>
                <button className="dashboard-create-btn" onClick={goToReservationFlow}>
                  + {t.nav.makeReservation}
                </button>

                <div className="panel-tabs">
                  <button className={customerTab === "reservations" ? "active-tab" : ""} onClick={() => setCustomerTab("reservations")}>
                    {lang === "en" ? "Reservations" : "Rezervasyonlarım"}
                  </button>
                  <button className={customerTab === "meetings" ? "active-tab" : ""} onClick={() => setCustomerTab("meetings")}>
                    {lang === "en" ? "Appointments" : "Randevularım"}
                  </button>
                  <button className={customerTab === "notifications" ? "active-tab" : ""} onClick={() => setCustomerTab("notifications")}>
                    {lang === "en" ? "Notifications" : "Bildirimler"}
                    {customerNotifications.filter(n => !n.is_read).length > 0 && <span className="notif-count">{customerNotifications.filter(n => !n.is_read).length}</span>}
                  </button>
                  <button className={customerTab === "account" ? "active-tab" : ""} onClick={() => { setCustomerTab("account"); setAccountMsg({ text: "", type: "" }); setAccountNewEmail(""); setAccountNewPassword(""); setAccountNewPassword2(""); }}>
                    {lang === "en" ? "My Account" : "Hesabım"}
                  </button>
                </div>

                {/* ── Rezervasyonlarım ── */}
                {customerTab === "reservations" && (() => {
                  const now = new Date();
                  const myRezs = reservations.filter(r => r.email === loggedCustomer.email);
                  const byDate = (a, b) => (new Date(b.createdAt).getTime() || 0) - (new Date(a.createdAt).getTime() || 0);
                  const active = myRezs
                    .filter(r => r.status === "pending" || r.status === "accepted")
                    .sort(byDate);
                  const history = myRezs
                    .filter(r => r.status !== "pending" && r.status !== "accepted")
                    .sort(byDate);
                  const getAlertBadge = (rez) => {
                    const d = parseLocalDate(rez.date);
                    if (!d) return null;
                    const [h, m] = (rez.time || "00:00").split(":").map(Number);
                    d.setHours(h, m);
                    const diff = (d - now) / 60000;
                    if (diff >= 0 && diff < 180) return <span className="alert-badge red">Son {Math.ceil(diff)} dk</span>;
                    if (d.toDateString() === now.toDateString()) return <span className="alert-badge yellow">Bugün</span>;
                    return null;
                  };
                  return (
                    <div style={{ marginTop: 16 }}>
                      {active.length > 0 && <>
                        <p className="rez-section-title">Aktif Rezervasyonlar</p>
                        {active.map(rez => (
                          <div key={rez.id} className="rez-list-item" onClick={() => setSelectedReservation(rez)}>
                            <div className="rez-item-main">
                              <div className="rez-item-name">{rez.business}</div>
                              <div className="rez-item-meta">{formatDate(rez.date)} · {rez.time} · {rez.guests} kişi</div>
                            </div>
                            <div className="rez-item-right">
                              {getAlertBadge(rez)}
                              <StatusBadge status={rez.status} />
                              {rez.status === "pending" && (
                                <button className="cancel-small-btn" onClick={async e => {
                                  e.stopPropagation();
                                  if (!window.confirm("Rezervasyonu iptal etmek istiyor musunuz?")) return;
                                  const { error } = await supabase.rpc("customer_cancel_reservation", { p_rez_id: rez.id });
                                  if (!error) setReservations(prev => prev.map(r => r.id === rez.id ? { ...r, status: "cancelled" } : r));
                                }}>İptal</button>
                              )}
                            </div>
                          </div>
                        ))}
                      </>}
                      {history.length > 0 && <>
                        <p className="rez-section-title" style={{ marginTop: 24 }}>Geçmiş Rezervasyonlar</p>
                        {history.map(rez => (
                          <div key={rez.id} className="rez-list-item past" onClick={() => setSelectedReservation(rez)}>
                            <div className="rez-item-main">
                              <div className="rez-item-name">{rez.business}</div>
                              <div className="rez-item-meta">{formatDate(rez.date)} · {rez.time} · {rez.guests} kişi</div>
                            </div>
                            <div className="rez-item-right">
                              {rez.attendanceStatus === "attended"
                                ? <span className="attend-badge green">Katıldın ✓</span>
                                : rez.attendanceStatus === "no_show"
                                  ? <span className="attend-badge red" title="SafeScore etkilendi">Katılmadın ✕</span>
                                  : <StatusBadge status={rez.status} />}
                            </div>
                          </div>
                        ))}
                      </>}
                      {active.length === 0 && history.length === 0 && (
                        <p className="description">{t.dashboard.noReservations}</p>
                      )}
                    </div>
                  );
                })()}

                {/* ── SafeScore ── */}
                {/* ── Bildirimler ── */}
                {customerTab === "notifications" && (
                  <div style={{ marginTop: 16 }}>
                    {customerNotifications.length > 0
                      ? customerNotifications.map(notif => (
                        <div key={notif.id} className={`notif-row${notif.is_read ? "" : " unread"}`}
                          onClick={async () => {
                            if (!notif.is_read) {
                              await supabase.from("notifications").update({ is_read: true }).eq("id", notif.id);
                              setCustomerNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
                            }
                          }}>
                          {!notif.is_read && <span className="notif-dot" />}
                          <div className="notif-body">
                            <div className="notif-title">{notif.title}</div>
                            {notif.message && <div className="notif-message">{notif.message}</div>}
                            <div className="notif-time">{new Date(notif.created_at).toLocaleDateString("tr-TR", { day:"2-digit", month:"long", hour:"2-digit", minute:"2-digit" })}</div>
                          </div>
                        </div>
                      ))
                      : <p className="description">{t.dashboard.noNotifications}</p>}
                  </div>
                )}

                {/* ── Randevularım ── */}
                {customerTab === "meetings" && (() => {
                  const REASON_LABELS = { is_gorusmesi: "İş Görüşmesi", urun_tanitimi: "Ürün Tanıtımı", urun_teslimi: "Ürün Teslimi", diger: "Diğer" };
                  const myMeetings = meetings.filter(m => m.email === loggedCustomer.email).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                  return (
                    <div style={{ marginTop: 16 }}>
                      {myMeetings.length > 0 ? myMeetings.map(m => (
                        <div key={m.id} className="rez-list-item">
                          <div className="rez-item-main">
                            <div className="rez-item-name">{m.businessName}</div>
                            <div className="rez-item-meta">{REASON_LABELS[m.reason] || m.reason} · {formatDate(m.date)} {m.time}{m.company ? ` · ${m.company}` : ""}</div>
                          </div>
                          <div className="rez-item-right">
                            <span className={`status-badge ${m.status}`}>
                              {m.status === "accepted" ? t.status.accepted : m.status === "rejected" ? t.status.rejected : t.status.pending}
                            </span>
                          </div>
                        </div>
                      )) : <p className="description">{t.dashboard.noMeetings}</p>}
                    </div>
                  );
                })()}

                {/* ── Hesap Ayarları ── */}
                {customerTab === "account" && (
                  <div style={{ marginTop: 16, maxWidth: 480 }}>
                    {/* Alt menü */}
                    <div className="account-submenu">
                      {[
                        { key: "safescore", icon: "🛡️", label: "SafeScore" },
                        { key: "stats",     icon: "📊", label: "İstatistikler" },
                        { key: "loyalty",   icon: "🏆", label: "Sadakat Puanları" },
                        { key: "profile",   icon: "👤", label: "Profil Bilgileri" },
                        { key: "settings",  icon: "⚙️", label: "Hesap Ayarları" },
                      ].map(item => (
                        <button key={item.key}
                          className={`accsub-btn${accountSubTab === item.key ? " active" : ""}`}
                          onClick={() => setAccountSubTab(item.key)}>
                          <span className="accsub-icon">{item.icon}</span>
                          <span className="accsub-label">{item.label}</span>
                          <svg className="accsub-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
                        </button>
                      ))}
                    </div>

                    {/* SafeScore */}
                    {accountSubTab === "safescore" && (() => {
                      const score = loggedCustomer.safeScore ?? 100;
                      const col = score >= 80 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
                      const circ = 2 * Math.PI * 42;
                      return (
                        <div className="reservation-box" style={{ marginTop: 16 }}>
                          <h3 style={{ marginBottom: 12, fontSize: 15 }}>🛡️ SafeScore</h3>
                          <div className="safescore-page" style={{ padding: 0 }}>
                            <div className="safescore-circle-wrap">
                              <svg viewBox="0 0 100 100" className="safescore-svg">
                                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(124,58,237,0.1)" strokeWidth="10"/>
                                <circle cx="50" cy="50" r="42" fill="none" stroke={col} strokeWidth="10"
                                  strokeDasharray={`${circ * score / 100} ${circ * (1 - score / 100)}`}
                                  strokeDashoffset={circ * 0.25} strokeLinecap="round"
                                  style={{ transition: "stroke-dasharray 1s ease" }}/>
                              </svg>
                              <div className="safescore-center">
                                <span className="safescore-number" style={{ color: col }}><AnimatedNumber value={score} /></span>
                                <span className="safescore-sub">/ 100</span>
                              </div>
                            </div>
                            <div className="safescore-legend">
                              <span style={{ color: "#10b981" }}>● 80–100 Güvenilir</span>
                              <span style={{ color: "#f59e0b" }}>● 50–79 Orta</span>
                              <span style={{ color: "#ef4444" }}>● 0–49 Riskli</span>
                            </div>
                          </div>
                          {safescoreHistory.length > 0 && <>
                            <p className="rez-section-title" style={{ marginTop: 16 }}>Son Hareketler</p>
                            {safescoreHistory.slice(0, 3).map((h, i) => (
                              <div key={i} className="safescore-history-row">
                                <div>
                                  <div className="safescore-history-reason">{h.reason === "attended" ? "Rezervasyona katıldın" : h.reason === "no_show" ? "Rezervasyona katılmadın" : h.reason}</div>
                                  <div className="safescore-history-date">{new Date(h.created_at).toLocaleDateString("tr-TR")}</div>
                                </div>
                                <span className={`safescore-delta ${h.delta > 0 ? "pos" : "neg"}`}>{h.delta > 0 ? `+${h.delta}` : h.delta}</span>
                              </div>
                            ))}
                          </>}
                        </div>
                      );
                    })()}

                    {/* İstatistikler */}
                    {accountSubTab === "stats" && (() => {
                      const myRezs = reservations.filter(r => r.email === loggedCustomer.email);
                      const total = myRezs.length;
                      const attended = myRezs.filter(r => r.attendanceStatus === "attended").length;
                      const noshow = myRezs.filter(r => r.attendanceStatus === "no_show").length;
                      const uniqueB = [...new Set(myRezs.map(r => r.businessId))].length;
                      return (
                        <div className="reservation-box" style={{ marginTop: 16 }}>
                          <h3 style={{ marginBottom: 12, fontSize: 15 }}>📊 İstatistiklerim</h3>
                          <div className="stats-grid" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
                            <div className="stat-card"><span className="stat-icon">📋</span><span>Toplam</span><strong><AnimatedNumber value={total} /></strong></div>
                            <div className="stat-card"><span className="stat-icon">🏢</span><span>İşletme</span><strong><AnimatedNumber value={uniqueB} /></strong></div>
                            <div className="stat-card"><span className="stat-icon">✅</span><span>Katıldım</span><strong><AnimatedNumber value={attended} /></strong></div>
                            <div className="stat-card"><span className="stat-icon">❌</span><span>Katılmadım</span><strong><AnimatedNumber value={noshow} /></strong></div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Sadakat Puanları */}
                    {accountSubTab === "loyalty" && (
                      <div className="reservation-box" style={{ marginTop: 16 }}>
                        <h3 style={{ marginBottom: 12, fontSize: 15 }}>🏆 Sadakat Puanları</h3>
                        {loyaltyPoints.length > 0
                          ? [...loyaltyPoints].sort((a, b) => b.points - a.points).slice(0, 5).map((lp, i) => (
                            <div key={i} className="loyalty-row">
                              <div className="loyalty-rank">#{i + 1}</div>
                              <div className="loyalty-info">
                                <div className="loyalty-business">{lp.businessName}</div>
                                <div className="loyalty-sub">{Math.floor(lp.points / 2)} ziyaret</div>
                              </div>
                              <div className="loyalty-badge">
                                <span className="loyalty-trophy">{lp.points >= 20 ? "🏆" : lp.points >= 10 ? "🥈" : "🥉"}</span>
                                <span className="loyalty-pts">{lp.points} puan</span>
                              </div>
                            </div>
                          ))
                          : <p className="description">Henüz puan yok. Rezervasyonlara katıldıkça kazanırsınız.</p>}
                      </div>
                    )}

                    {/* Profil Bilgileri */}
                    {accountSubTab === "profile" && (
                      <div className="reservation-box" style={{ marginTop: 16 }}>
                        <h3 style={{ marginBottom: 12, fontSize: 15 }}>👤 Profil Bilgileri</h3>
                        <form className="reservation-form">
                          <input type="tel" placeholder="Telefon Numarası" value={customerProfile.phone}
                            onChange={e => setCustomerProfile({ ...customerProfile, phone: e.target.value })} />
                          <div className="time-slots">
                            {[["Male","Erkek"],["Female","Kadın"],["Prefer not to say","Belirtmek istemiyorum"]].map(([val, label]) => (
                              <button key={val} type="button"
                                className={customerProfile.gender === val ? "profile-option selected-time" : "profile-option time-btn"}
                                onClick={() => setCustomerProfile({ ...customerProfile, gender: val })}>
                                {customerProfile.gender === val ? "✓ " : ""}{label}
                              </button>
                            ))}
                          </div>
                          <input type="date" value={customerProfile.birthDate}
                            onChange={e => setCustomerProfile({ ...customerProfile, birthDate: e.target.value })} />
                          <input type="text" placeholder="Meslek" value={customerProfile.job}
                            onChange={e => setCustomerProfile({ ...customerProfile, job: e.target.value })} />
                          <div className="time-slots">
                            {[["Smoker","İçiyor"],["Non-smoker","İçmiyor"],["No preference","Fark Etmez"]].map(([val, label]) => (
                              <button key={val} type="button"
                                className={customerProfile.smoking === val ? "profile-option selected-time" : "profile-option time-btn"}
                                onClick={() => setCustomerProfile({ ...customerProfile, smoking: val })}>
                                {customerProfile.smoking === val ? "✓ " : ""}{label}
                              </button>
                            ))}
                          </div>
                          <button type="button" className="save-changes-btn" onClick={async () => {
                            const { error } = await supabase.rpc("customer_update_profile", {
                              p_phone: customerProfile.phone, p_gender: customerProfile.gender,
                              p_birth_date: customerProfile.birthDate, p_job: customerProfile.job, p_smoking: customerProfile.smoking,
                            });
                            if (error) { alert("Profil kaydedilemedi."); return; }
                            alert("Profil başarıyla kaydedildi.");
                          }}>Profili Kaydet</button>
                        </form>
                      </div>
                    )}

                    {/* Hesap Ayarları */}
                    {accountSubTab === "settings" && (
                      <div style={{ marginTop: 16 }}>
                        {accountMsg.text && (
                          <div className={accountMsg.type === "success" ? "success-message" : "error-message"} style={{ marginBottom: 16 }}>
                            {accountMsg.text}
                          </div>
                        )}
                        <div className="reservation-box" style={{ marginBottom: 16 }}>
                          <div className="profile-field-row">
                            <span className="profile-field-label">Mevcut E-posta</span>
                            <span className="profile-field-value">{loggedCustomer.email}</span>
                          </div>
                        </div>
                        <div className="reservation-box" style={{ marginBottom: 16 }}>
                          <h3 style={{ marginBottom: 12, fontSize: 15 }}>✉️ E-posta Değiştir</h3>
                          <form className="reservation-form" onSubmit={async (e) => {
                            e.preventDefault();
                            const newEmail = accountNewEmail.trim().toLowerCase();
                            if (!newEmail) return setAccountMsg({ text: "Yeni e-posta adresini girin.", type: "error" });
                            if (newEmail === loggedCustomer.email) return setAccountMsg({ text: "Bu zaten mevcut e-posta adresiniz.", type: "error" });
                            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return setAccountMsg({ text: "Geçerli bir e-posta adresi girin.", type: "error" });
                            setAccountLoading("email");
                            const { error } = await supabase.auth.updateUser({ email: newEmail }, { emailRedirectTo: "https://getrezpoint.com" });
                            setAccountLoading("");
                            if (error) { setAccountMsg({ text: "E-posta değiştirilemedi: " + error.message, type: "error" }); }
                            else { setAccountNewEmail(""); setAccountMsg({ text: `${newEmail} adresine doğrulama linki gönderildi.`, type: "success" }); }
                          }}>
                            <input type="email" placeholder="Yeni e-posta adresi" value={accountNewEmail}
                              onChange={e => setAccountNewEmail(e.target.value)} autoComplete="email" disabled={accountLoading === "email"} />
                            <button type="submit" className="save-changes-btn" disabled={accountLoading === "email"}>
                              {accountLoading === "email" ? <Spinner /> : "Doğrulama Linki Gönder"}
                            </button>
                          </form>
                        </div>
                        <div className="reservation-box" style={{ marginBottom: 16 }}>
                          <h3 style={{ marginBottom: 12, fontSize: 15 }}>🔒 Şifre Değiştir</h3>
                          <form className="reservation-form" onSubmit={async (e) => {
                            e.preventDefault();
                            if (!accountNewPassword) return setAccountMsg({ text: "Yeni şifre girin.", type: "error" });
                            if (accountNewPassword.length < 6) return setAccountMsg({ text: "Şifre en az 6 karakter olmalıdır.", type: "error" });
                            if (accountNewPassword !== accountNewPassword2) return setAccountMsg({ text: "Şifreler eşleşmiyor.", type: "error" });
                            setAccountLoading("password");
                            const { error } = await supabase.auth.updateUser({ password: accountNewPassword });
                            setAccountLoading("");
                            if (error) { setAccountMsg({ text: "Şifre değiştirilemedi: " + error.message, type: "error" }); }
                            else { setAccountNewPassword(""); setAccountNewPassword2(""); setAccountMsg({ text: "Şifreniz başarıyla güncellendi.", type: "success" }); }
                          }}>
                            <input type="password" placeholder="Yeni şifre (en az 6 karakter)" value={accountNewPassword}
                              onChange={e => setAccountNewPassword(e.target.value)} autoComplete="new-password" disabled={accountLoading === "password"} />
                            <input type="password" placeholder="Yeni şifre (tekrar)" value={accountNewPassword2}
                              onChange={e => setAccountNewPassword2(e.target.value)} autoComplete="new-password" disabled={accountLoading === "password"} />
                            <button type="submit" className="save-changes-btn" disabled={accountLoading === "password"}>
                              {accountLoading === "password" ? <Spinner /> : "Şifreyi Güncelle"}
                            </button>
                          </form>
                        </div>
                        <div className="reservation-box" style={{ marginBottom: 16 }}>
                          <h3 style={{ marginBottom: 8, fontSize: 15 }}>🔑 Şifremi Unuttum</h3>
                          <button className="secondary-btn" disabled={accountLoading === "reset"} onClick={async () => {
                            setAccountLoading("reset");
                            const { error } = await supabase.auth.resetPasswordForEmail(loggedCustomer.email, { redirectTo: window.location.origin });
                            setAccountLoading("");
                            if (error) { setAccountMsg({ text: "Gönderilemedi: " + error.message, type: "error" }); }
                            else { setAccountMsg({ text: `${loggedCustomer.email} adresine şifre sıfırlama linki gönderildi.`, type: "success" }); }
                          }}>
                            {accountLoading === "reset" ? <Spinner /> : "Sıfırlama Linki Gönder"}
                          </button>
                        </div>
                        <button className="primary-btn" style={{ width: "100%" }} onClick={async () => {
                          await supabase.auth.signOut();
                          localStorage.setItem("rp_page", "home");
                          setLoggedCustomer(null); setEmailVerified(false);
                          setCustomerForm({ name: "", email: "", password: "" });
                          setCustomerProfile({ phone: "", gender: "", birthDate: "", job: "", smoking: "" });
                          setPage("home");
                        }}>Çıkış Yap</button>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="description">
                  Rezervasyonlarınızı görmek için giriş yapın.
                </p>
                <button
                  className="primary-btn"
                  onClick={() => setPage("customerAuth")}
                >
                  Giriş Yap
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {/* businessLogin artık customerAuth'un işletme sekmesiyle birleşti */}
      {page === "adminLogin" && (
        <section className="reservation-section">
          <div className="reservation-box">
            <h1>Yönetici Girişi</h1>
            <p className="description">RezPoint yönetim paneli.</p>

            <form className="reservation-form" onSubmit={e => { e.preventDefault(); handleAdminLogin(); }}>
              <input
                type="email"
                placeholder="Yönetici E-postası"
                autoComplete="username"
                disabled={adminLoginLocked || loginLoading}
                value={adminLogin.email}
                onChange={(e) => setAdminLogin({ ...adminLogin, email: e.target.value })}
              />

              <input
                type="password"
                placeholder="Şifre"
                autoComplete="current-password"
                disabled={adminLoginLocked || loginLoading}
                value={adminLogin.password}
                onChange={(e) => setAdminLogin({ ...adminLogin, password: e.target.value })}
              />

              {adminError && <p className="error-message">{adminError}</p>}

              <button type="submit" disabled={adminLoginLocked || loginLoading}>
                {loginLoading ? <Spinner /> : "Giriş Yap"}
              </button>
            </form>
          </div>
        </section>
      )}

      {page === "adminPanel" && (
        <section className="business-panel-section">
          <div className="business-panel-header">
            <div>
              <h1>RezPoint Yönetici Paneli</h1>
              <p className="description">
                İşletmeler, AI Menü erişimi ve platform istatistiklerini yönetin.
              </p>
            </div>

            <button
              className="nav-button"
              onClick={() => {
                setAdminLogin({ email: "", password: "" });
                setPage("home");
              }}
            >
              Çıkış
            </button>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-icon">🏢</span>
              <span>İşletmeler</span>
              <strong><AnimatedNumber value={adminBusinesses.length} /></strong>
            </div>
            <div className="stat-card">
              <span className="stat-icon">👤</span>
              <span>Müşteriler</span>
              <strong><AnimatedNumber value={registeredCustomers.length} /></strong>
            </div>
            <div className="stat-card">
              <span className="stat-icon">📋</span>
              <span>Rezervasyonlar</span>
              <strong><AnimatedNumber value={reservations.length} /></strong>
            </div>
            <div className="stat-card">
              <span className="stat-icon">✅</span>
              <span>Kabul Edilen</span>
              <strong><AnimatedNumber value={reservations.filter(r => r.status === "accepted").length} /></strong>
            </div>
          </div>

          <div className="stats-grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginTop: 0 }}>
            <div className="stat-card">
              <span className="stat-icon">⏳</span>
              <span>Bekleyen</span>
              <strong><AnimatedNumber value={reservations.filter(r => r.status === "pending").length} /></strong>
            </div>
            <div className="stat-card">
              <span className="stat-icon">❌</span>
              <span>No Show</span>
              <strong><AnimatedNumber value={reservations.filter(r => r.attendanceStatus === "no_show").length} /></strong>
            </div>
            <div className="stat-card">
              <span className="stat-icon">🤖</span>
              <span>AI Menu Aktif</span>
              <strong><AnimatedNumber value={adminBusinesses.filter(b => b.aiMenuActive).length} /></strong>
            </div>
          </div>

          {/* ── Toplu Push Bildirimi ── */}
          {(() => {
            const [bTitle, setBTitle] = [broadTitle, setBroadTitle];
            const [bBody,  setBBody]  = [broadBody,  setBroadBody];
            const [bSending, setBSending] = [broadSending, setBroadSending];
            return (
              <div className="reservation-box" style={{ marginTop: "24px" }}>
                <h2>📣 Toplu Bildirim Gönder</h2>
                <p className="description">Uygulamayı yükleyen tüm kullanıcılara anlık bildirim gönder.</p>
                <div className="reservation-form">
                  <input type="text" placeholder="Bildirim başlığı  (örn: Babalar Günü 🎁)" value={bTitle} onChange={e => setBTitle(e.target.value)} />
                  <textarea placeholder="Bildirim mesajı  (örn: Tüm işletmeler sizi bekliyor!)" rows={3} value={bBody} onChange={e => setBBody(e.target.value)} />
                  <button
                    type="button"
                    className="primary-btn"
                    style={{ width: "100%" }}
                    disabled={bSending || !bTitle.trim() || !bBody.trim()}
                    onClick={async () => {
                      setBSending(true);
                      try {
                        const res = await fetch("https://sghwmnagplaolqdfqpvz.supabase.co/functions/v1/send-push", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ send_to_all: true, title: bTitle.trim(), body: bBody.trim() }),
                        });
                        const json = await res.json();
                        alert(`✅ Gönderildi! ${json.sent ?? 0} kullanıcıya ulaştı.`);
                        setBTitle(""); setBBody("");
                      } catch {
                        alert("Gönderilemedi, tekrar deneyin.");
                      } finally {
                        setBSending(false);
                      }
                    }}
                  >
                    {bSending ? "Gönderiliyor..." : "Herkese Gönder 🚀"}
                  </button>
                </div>
              </div>
            );
          })()}

          {/* ── Veritabanı Temizliği ── */}
          <div className="reservation-box" style={{ marginTop: "24px" }}>
            <h2>🧹 Veritabanı Temizliği</h2>
            <p className="description">
              90+ günlük rezervasyonları <strong>istatistiklerini saklayarak</strong> siler.
              Okunmuş bildirimleri (30+ gün), reddedilen randevuları (90+ gün) ve
              fazla SafeScore geçmişini temizler. İşletme istatistikleri etkilenmez.
            </p>
            <button
              type="button"
              className="secondary-btn"
              style={{ marginTop: 8 }}
              onClick={async () => {
                if (!window.confirm("Veritabanı temizliği yapılsın mı?\n\nRezervasyon istatistikleri arşivlenecek, ham veriler silinecek.")) return;
                const { data, error } = await supabase.rpc("cleanup_old_data");
                if (error) { alert("Hata: " + error.message); return; }
                const d = data || {};
                alert(
                  `✅ Temizlik tamamlandı:\n` +
                  `• ${d.archived_and_deleted_reservations ?? 0} rezervasyon arşivlendi ve silindi\n` +
                  `• ${d.deleted_notifications ?? 0} eski bildirim silindi\n` +
                  `• ${d.deleted_meetings      ?? 0} reddedilen randevu silindi\n` +
                  `• ${d.deleted_safescore     ?? 0} fazla SafeScore kaydı silindi`
                );
              }}
            >
              Temizliği Çalıştır
            </button>
          </div>

          <div className="reservation-box" style={{ marginTop: "24px" }}>
            <h2>📄 RezPoint Kullanım Koşulları</h2>
            <p className="description">Müşterilerin rezervasyon öncesi onaylaması gereken platform koşulları.</p>
            <form className="reservation-form">
              <textarea
                placeholder="RezPoint kullanım koşullarını buraya yazın..."
                value={rpTermsEdit}
                onChange={e => setRpTermsEdit(e.target.value)}
                rows={8}
              />
              <button
                type="button"
                onClick={async () => {
                  const { error } = await supabase.from("site_settings").upsert({ key: "rezpoint_terms", value: rpTermsEdit });
                  if (error) { alert("Kaydedilemedi: " + error.message); return; }
                  setRpTerms(rpTermsEdit);
                  alert("Koşullar kaydedildi ✅");
                }}
              >
                Koşulları Kaydet
              </button>
            </form>
          </div>

          <div className="reservation-box" style={{ marginTop: "24px" }}>
            <h2>İşletmeler</h2>
            <button
              className="primary-btn"
              style={{ marginBottom: "20px" }}
              onClick={() => setShowAddBusinessForm(!showAddBusinessForm)}
            >
              + İşletme Ekle
            </button>
            {showAddBusinessForm && (
              <form
                className="reservation-form"
                style={{ marginBottom: "24px" }}
              >
                <input
                  type="text"
                  placeholder="İşletme Adı"
                  value={newBusinessForm.name}
                  onChange={(e) =>
                    setNewBusinessForm({
                      ...newBusinessForm,
                      name: e.target.value,
                    })
                  }
                />

                <input
                  type="text"
                  placeholder="İşletme Türü"
                  value={newBusinessForm.type}
                  onChange={(e) =>
                    setNewBusinessForm({
                      ...newBusinessForm,
                      type: e.target.value,
                    })
                  }
                />

                <input
                  type="text"
                  placeholder="Konum"
                  value={newBusinessForm.location}
                  onChange={(e) =>
                    setNewBusinessForm({
                      ...newBusinessForm,
                      location: e.target.value,
                    })
                  }
                />

                <input
                  type="text"
                  placeholder="İkon emoji ör. 🍸"
                  value={newBusinessForm.icon}
                  onChange={(e) =>
                    setNewBusinessForm({
                      ...newBusinessForm,
                      icon: e.target.value,
                    })
                  }
                />

                <input
                  type="email"
                  placeholder="İşletme Giriş E-postası"
                  value={newBusinessForm.email}
                  onChange={(e) =>
                    setNewBusinessForm({
                      ...newBusinessForm,
                      email: e.target.value,
                    })
                  }
                />

                <input
                  type="password"
                  placeholder="İşletme Giriş Şifresi"
                  value={newBusinessForm.password}
                  onChange={(e) =>
                    setNewBusinessForm({
                      ...newBusinessForm,
                      password: e.target.value,
                    })
                  }
                />

                <button
                  type="button"
                  onClick={async () => {
                    if (
                      !newBusinessForm.name ||
                      !newBusinessForm.type ||
                      !newBusinessForm.location ||
                      !newBusinessForm.email ||
                      !newBusinessForm.password
                    ) {
                      alert("Lütfen tüm zorunlu alanları doldurun.");
                      return;
                    }

                    const { data: newId, error } = await supabase.rpc("admin_add_business", {
                      p_admin_password: adminPassword,
                      p_name: newBusinessForm.name,
                      p_email: newBusinessForm.email,
                      p_password: newBusinessForm.password,
                      p_type: newBusinessForm.type || "Business",
                      p_location: newBusinessForm.location || "",
                      p_icon: newBusinessForm.icon || "🏢",
                    });

                    if (error || !newId) {
                      console.log("Add business error:", error);
                      alert("Business eklenirken hata oldu: " + (error?.message || "Bilinmeyen hata"));
                      return;
                    }

                    const addedBusiness = { id: newId };

                    const formattedBusiness = {
                      id: newId,
                      name: newBusinessForm.name,
                      email: newBusinessForm.email,
                      reservationActive: true,
                      aiMenuActive: false,
                      menuText: "",
                      description: "",
                      menu: "",
                      phone: "",
                      terms: "",
                      type: newBusinessForm.type || "Business",
                      location: newBusinessForm.location || "",
                      icon: newBusinessForm.icon || "🏢",
                      availabilityMode: "weekly",
                      availableDays: ["Friday", "Saturday"],
                      availableTimes: ["18:00", "19:00", "20:30"],
                      specificDates: [],
                      meetingTimes: [],
                      meetingDates: [],
                      rating: 0,
                    };

                    setAdminBusinesses([...adminBusinesses, formattedBusiness]);

                    setNewBusinessForm({
                      name: "",
                      type: "",
                      location: "",
                      icon: "",
                      email: "",
                      password: "",
                    });

                    setShowAddBusinessForm(false);
                  }}
                >
                  İşletme Oluştur
                </button>
              </form>
            )}

            <div className="admin-table-wrap">
            <table className="admin-table" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>İşletme</th>
                  <th>Tür / Konum</th>
                  <th>Rezervasyon</th>
                  <th>Randevu</th>
                  <th>AI Menü</th>
                  <th>İşlemler</th>
                </tr>
              </thead>
              <tbody>
                {adminBusinesses.map((business) => (
                  <tr key={business.id}>
                    {/* ── Logo + İsim ── */}
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {business.logoUrl
                          ? <img src={business.logoUrl} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover", flexShrink: 0, border: "1px solid #e5e7eb" }} />
                          : <span style={{ fontSize: 22, flexShrink: 0 }}>{business.icon}</span>
                        }
                        <div>
                          <strong>{business.name}</strong>
                          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{business.email}</div>
                          <label style={{ fontSize: 11, color: "var(--purple)", cursor: "pointer", marginTop: 3, display: "block", fontWeight: 600 }}>
                            {business.logoUrl ? "🔄 Logo değiştir" : "📷 Logo yükle"}
                            <input type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => {
                              const file = e.target.files[0];
                              if (!file) return;
                              const compressedBlob = await new Promise((resolve) => {
                                const img = new Image();
                                const reader = new FileReader();
                                reader.onload = (ev) => {
                                  img.onload = () => {
                                    const MAX = 800;
                                    let { width, height } = img;
                                    if (width > MAX || height > MAX) {
                                      if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
                                      else { width = Math.round(width * MAX / height); height = MAX; }
                                    }
                                    const canvas = document.createElement("canvas");
                                    canvas.width = width; canvas.height = height;
                                    canvas.getContext("2d").drawImage(img, 0, 0, width, height);
                                    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.82);
                                  };
                                  img.src = ev.target.result;
                                };
                                reader.readAsDataURL(file);
                              });
                              const path = `${business.id}/logo.jpg`;
                              const { error: upErr } = await supabase.storage.from("business-logos").upload(path, compressedBlob, { upsert: true, contentType: "image/jpeg" });
                              if (upErr) { alert("Yükleme hatası: " + upErr.message); return; }
                              const { data: urlData } = supabase.storage.from("business-logos").getPublicUrl(path);
                              const logoUrl = urlData.publicUrl + "?t=" + Date.now();
                              const { error: dbErr } = await supabase.rpc("admin_update_business", { p_password: adminPassword, p_business_id: business.id, p_logo_url: urlData.publicUrl });
                              if (dbErr) { alert("Kaydedilemedi: " + dbErr.message); return; }
                              setAdminBusinesses(adminBusinesses.map(item => item.id === business.id ? { ...item, logoUrl } : item));
                            }} />
                          </label>
                        </div>
                      </div>
                    </td>

                    {/* ── Tür / Konum (inline düzenleme) ── */}
                    <td>
                      {adminEditingBiz?.id === business.id ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <input
                            value={adminEditingBiz.type}
                            onChange={e => setAdminEditingBiz({ ...adminEditingBiz, type: e.target.value })}
                            placeholder="Tür"
                            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--purple)", width: 110 }}
                          />
                          <input
                            value={adminEditingBiz.location}
                            onChange={e => setAdminEditingBiz({ ...adminEditingBiz, location: e.target.value })}
                            placeholder="Konum"
                            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #e2e8f0", width: 110 }}
                          />
                          <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                            <button className="primary-btn" style={{ fontSize: 11, padding: "3px 10px" }} onClick={async () => {
                              const { error } = await supabase.rpc("admin_update_business", { p_password: adminPassword, p_business_id: business.id, p_type: adminEditingBiz.type, p_location: adminEditingBiz.location });
                              if (error) { alert("Kaydedilemedi."); return; }
                              setAdminBusinesses(adminBusinesses.map(item => item.id === business.id ? { ...item, type: adminEditingBiz.type, location: adminEditingBiz.location } : item));
                              setAdminEditingBiz(null);
                            }}>✓ Kaydet</button>
                            <button className="time-btn" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setAdminEditingBiz(null)}>✕</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ cursor: "pointer" }} onClick={() => setAdminEditingBiz({ id: business.id, type: business.type, location: business.location })}>
                          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{business.type}</span><br />
                          <span style={{ fontSize: 11, color: "#94a3b8" }}>{business.location || "—"}</span>
                          <div style={{ fontSize: 10, color: "var(--purple)", marginTop: 2, fontWeight: 600 }}>✏ Düzenle</div>
                        </div>
                      )}
                    </td>

                    {/* ── Rezervasyon toggle ── */}
                    <td>
                      <button
                        className={business.reservationActive ? "selected-time" : "time-btn"}
                        style={{ fontSize: 12, padding: "6px 12px" }}
                        onClick={async () => {
                          const newValue = !business.reservationActive;
                          const { error } = await supabase.rpc("admin_update_business", { p_password: adminPassword, p_business_id: business.id, p_reservation_enabled: newValue });
                          if (error) { alert("Güncellenemedi."); return; }
                          setAdminBusinesses(adminBusinesses.map(item => item.id === business.id ? { ...item, reservationActive: newValue } : item));
                        }}
                      >
                        {business.reservationActive ? "✓ Açık" : "✕ Kapalı"}
                      </button>
                    </td>

                    {/* ── Randevu toggle ── */}
                    <td>
                      <button
                        className={business.meetingEnabled ? "selected-time" : "time-btn"}
                        style={{ fontSize: 12, padding: "6px 12px" }}
                        onClick={async () => {
                          const newValue = !business.meetingEnabled;
                          const { error } = await supabase.rpc("admin_update_business", { p_password: adminPassword, p_business_id: business.id, p_meeting_enabled: newValue });
                          if (error) { alert("Güncellenemedi."); return; }
                          setAdminBusinesses(adminBusinesses.map(item => item.id === business.id ? { ...item, meetingEnabled: newValue } : item));
                        }}
                      >
                        {business.meetingEnabled ? "✓ Açık" : "✕ Kapalı"}
                      </button>
                    </td>

                    {/* ── AI Menü toggle ── */}
                    <td>
                      <button
                        className={business.aiMenuActive ? "selected-time" : "time-btn"}
                        style={{ fontSize: 12, padding: "6px 12px" }}
                        onClick={async () => {
                          const newValue = !business.aiMenuActive;
                          const { error } = await supabase.rpc("admin_update_business", { p_password: adminPassword, p_business_id: business.id, p_ai_menu_enabled: newValue });
                          if (error) { alert("Güncellenemedi."); return; }
                          setAdminBusinesses(adminBusinesses.map(item => item.id === business.id ? { ...item, aiMenuActive: newValue } : item));
                        }}
                      >
                        {business.aiMenuActive ? "✓ Aktif" : "✕ Kapalı"}
                      </button>
                    </td>

                    {/* ── İşlemler: Sıfırla + Sil ── */}
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <button
                          className="time-btn"
                          style={{ fontSize: 12, padding: "6px 12px", color: "#f59e0b", borderColor: "#f59e0b" }}
                          onClick={async () => {
                            if (!window.confirm(`${business.name} istatistikleri sıfırlansın mı?`)) return;
                            const { error } = await supabase.rpc("admin_update_business", { p_password: adminPassword, p_business_id: business.id, p_rating: 0 });
                            if (error) { alert("Sıfırlanamadı."); return; }
                            setAdminBusinesses(adminBusinesses.map(item => item.id === business.id ? { ...item, rating: 0 } : item));
                            alert("İstatistikler sıfırlandı.");
                          }}
                        >
                          ↺ Sıfırla
                        </button>
                        <button
                          className="time-btn"
                          style={{ fontSize: 12, padding: "6px 12px", color: "#3b82f6", borderColor: "#3b82f6" }}
                          onClick={async () => {
                            const newPwd = window.prompt(`${business.name} için yeni şifre girin (en az 6 karakter):`);
                            if (!newPwd) return;
                            if (newPwd.length < 6) { alert("Şifre en az 6 karakter olmalı."); return; }
                            const { error } = await supabase.rpc("admin_reset_business_password", { p_admin_password: adminPassword, p_business_id: business.id, p_new_password: newPwd });
                            if (error) { alert("Şifre sıfırlanamadı: " + error.message); return; }
                            alert(`${business.name} şifresi güncellendi.`);
                          }}
                        >
                          🔑 Şifre
                        </button>
                        <button
                          className="reject-btn"
                          style={{ fontSize: 12, padding: "6px 12px" }}
                          onClick={async () => {
                            if (!window.confirm(`${business.name} silinsin mi? Rezervasyonlar da silinecek.`)) return;
                            const { error } = await supabase.rpc("admin_delete_business", { p_admin_password: adminPassword, p_business_id: business.id });
                            if (error) { alert("Silinemedi: " + error.message); return; }
                            if (business.logoUrl) supabase.storage.from("business-logos").remove([`${business.id}/logo.jpg`]);
                            setAdminBusinesses(adminBusinesses.filter(item => item.id !== business.id));
                            setReservations(reservations.filter(rez => rez.businessId !== business.id));
                            if (loggedBusiness?.id === business.id) { setLoggedBusiness(null); setPage("home"); }
                          }}
                        >
                          Sil
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          {/* ── Business Types ── */}
          <div className="reservation-box" style={{ marginTop: 24 }}>
            <h2>İşletme Türleri</h2>
            <div className="biz-types-add-row">
              <input type="text" placeholder="Tür adı (ör. Kafe)" value={adminNewTypeName} className="biz-types-input"
                onChange={e => setAdminNewTypeName(e.target.value)} />
              <input type="text" placeholder="İkon" value={adminNewTypeIcon} className="biz-types-icon-input"
                onChange={e => setAdminNewTypeIcon(e.target.value)} />
              <button className="primary-btn" style={{ padding: "10px 20px" }} onClick={async () => {
                if (!adminNewTypeName.trim()) return;
                const { data, error } = await supabase.from("business_types").insert([{ name: adminNewTypeName.trim(), icon: adminNewTypeIcon }]).select().single();
                if (!error && data) { setAdminBizTypes(prev => [...prev, data]); setAdminNewTypeName(""); setAdminNewTypeIcon("🏢"); }
                else alert("Eklenemedi.");
              }}>+ Ekle</button>
            </div>
            <div className="biz-types-list">
              {adminBizTypes.map(bt => (
                <div key={bt.id} className="biz-type-row">
                  <span className="biz-type-icon">{bt.icon}</span>
                  <span className="biz-type-name">{bt.name}</span>
                  <button className="biz-type-del" onClick={async () => {
                    if (!window.confirm(`"${bt.name}" türünü sil?`)) return;
                    const { error } = await supabase.from("business_types").delete().eq("id", bt.id);
                    if (!error) setAdminBizTypes(prev => prev.filter(t => t.id !== bt.id));
                    else alert("Silinemedi.");
                  }}>✕</button>
                </div>
              ))}
              {adminBizTypes.length === 0 && <p className="description">Henüz tür eklenmemiş.</p>}
            </div>
          </div>
        </section>
      )}

      {page === "contact" && (
        <section className="contact-page">
          <div className="contact-hero">
            <div className="contact-hero-icon">💬</div>
            <h1>{t.contact.title}</h1>
            <p className="contact-hero-desc">{t.contact.desc}</p>
          </div>

          <div className="contact-cards">
            <a
              className="contact-card"
              href="mailto:rezpointsupport@gmail.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="contact-card-icon">✉️</div>
              <div className="contact-card-body">
                <div className="contact-card-label">{t.contact.emailLabel}</div>
                <div className="contact-card-value">rezpointsupport@gmail.com</div>
              </div>
              <span className="contact-card-arrow">→</span>
            </a>

            <a
              className="contact-card"
              href="https://instagram.com/rezpoint.rp"
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="contact-card-icon">📸</div>
              <div className="contact-card-body">
                <div className="contact-card-label">Instagram</div>
                <div className="contact-card-value">@rezpoint.rp</div>
              </div>
              <span className="contact-card-arrow">→</span>
            </a>
          </div>

          <div className="contact-business-box">
            <div className="contact-business-icon">🏢</div>
            <h2>{t.contact.addBusiness}</h2>
            <p>{t.contact.addBusinessDesc}</p>
            <a
              className="primary-btn contact-cta"
              href="mailto:rezpointsupport@gmail.com?subject=RezPoint%20İşletme%20Başvurusu"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t.contact.applyBtn}
            </a>
          </div>

          <div className="contact-legal-row">
            <button className="contact-legal-btn" onClick={() => setLegalModal("privacy")}>
              🔒 Gizlilik Politikası
            </button>
            <button className="contact-legal-btn" onClick={() => setLegalModal("terms")}>
              📄 Kullanım Koşulları
            </button>
          </div>

          <button className="back-btn" onClick={() => setPage("home")} style={{ marginTop: 32 }}>
            ← Ana Sayfa
          </button>
        </section>
      )}

      {legalModal && (
        <div className="terms-modal-overlay" onClick={() => setLegalModal(null)}>
          <div className="terms-modal legal-modal" onClick={e => e.stopPropagation()}>
            <div className="terms-modal-header">
              <h2>{legalModal === "privacy" ? "🔒 Gizlilik Politikası" : "📄 Kullanım Koşulları"}</h2>
              <button className="terms-modal-close" onClick={() => setLegalModal(null)}>✕</button>
            </div>
            <div className="terms-modal-body legal-modal-body">
              {legalModal === "privacy" ? (
                <div className="legal-content">
                  <p className="legal-date"><strong>Son güncelleme:</strong> 14 Haziran 2026</p>

                  <p>RezPoint ("RezPoint", "Platform", "biz") olarak gizliliğinize önem veriyoruz. Bu Gizlilik Politikası, Platformu kullandığınızda hangi kişisel verileri, nasıl ve neden işlediğimizi; bu veriler üzerindeki haklarınızı açıklar.</p>
                  <p>Platformu kullanarak bu Politikada açıklanan veri işleme uygulamalarını kabul etmiş olursunuz.</p>

                  <h3>1. Veri Sorumlusu</h3>
                  <p>Kişisel verileriniz, veri sorumlusu sıfatıyla RezPoint tarafından işlenir.<br/>İletişim: <a href="mailto:rezpointsupport@gmail.com">rezpointsupport@gmail.com</a></p>

                  <h3>2. Topladığımız Veriler</h3>
                  <h4>2.1 Sizin Sağladığınız Veriler</h4>
                  <ul>
                    <li><strong>Hesap bilgileri:</strong> ad, soyad, e-posta adresi, telefon numarası.</li>
                    <li><strong>Profil tercihleri (opsiyonel):</strong> cinsiyet, sigara tercihi, müzik zevki gibi rezervasyon deneyimini iyileştirmeye yönelik bilgiler.</li>
                    <li><strong>Rezervasyon bilgileri:</strong> seçtiğiniz işletme, tarih, saat, kişi sayısı, varsa eklediğiniz notlar.</li>
                  </ul>
                  <h4>2.2 Otomatik Olarak Toplanan Veriler</h4>
                  <ul>
                    <li><strong>Kullanım verileri:</strong> rezervasyon geçmişi, katılım durumu, SafeScore ve sadakat puanı hesaplamaları.</li>
                    <li><strong>Teknik veriler:</strong> giriş zamanları, cihaz/tarayıcı türü (hizmetin güvenliği ve iyileştirilmesi için).</li>
                  </ul>
                  <h4>2.3 Şifreler Hakkında</h4>
                  <p>Şifreniz <strong>güvenli (hash'lenmiş) biçimde</strong> saklanır. RezPoint çalışanları, yöneticileri ve sistem yöneticileri dahil hiç kimse şifrenizi düz metin olarak göremez. Kimlik doğrulama, güvenli altyapı (Supabase Auth) üzerinden yürütülür. Şifrenizi unutmanız halinde yalnızca sıfırlanması mümkündür.</p>

                  <h3>3. Verileri İşleme Amaçlarımız</h3>
                  <ul>
                    <li>Hesabınızı oluşturmak ve yönetmek.</li>
                    <li>Rezervasyonlarınızı oluşturmak ve ilgili işletmeye iletmek.</li>
                    <li>SafeScore ve sadakat puanı sistemlerini işletmek.</li>
                    <li>Size bildirim göndermek (rezervasyon kabul/red, hatırlatma vb.).</li>
                    <li>Platformun güvenliğini sağlamak ve kötüye kullanımı önlemek.</li>
                    <li>Hizmetlerimizi analiz etmek ve geliştirmek.</li>
                    <li>Yasal yükümlülüklerimizi yerine getirmek.</li>
                  </ul>

                  <h3>4. Verilerin İşletmelerle Paylaşılması</h3>
                  <p>Bir rezervasyon oluşturduğunuzda, rezervasyonun gerçekleştirilebilmesi için gerekli bilgileriniz (ad, iletişim, kişi sayısı, varsa tercihleriniz ve notunuz) ilgili <strong>işletme</strong> ile paylaşılır.</p>
                  <p>İşletmeler bu verileri yalnızca rezervasyon ve hizmet sunumu amacıyla kullanmakla yükümlüdür. RezPoint, işletmelerin kendi sorumlulukları altında yaptıkları veri kullanımından sorumlu değildir.</p>

                  <h3>5. Üçüncü Taraflarla Paylaşım</h3>
                  <p>Verilerinizi şu durumlar dışında üçüncü taraflarla paylaşmayız:</p>
                  <ul>
                    <li><strong>Hizmet sağlayıcılar:</strong> Platformun çalışması için kullandığımız altyapı sağlayıcıları (Supabase — sunucu/veritabanı ve e-posta hizmeti). Bu sağlayıcılar verileri yalnızca bizim adımıza işler.</li>
                    <li><strong>Yasal zorunluluk:</strong> Yürürlükteki mevzuat veya yetkili merci talebi gerektirdiğinde.</li>
                  </ul>
                  <p>Verilerinizi <strong>hiçbir şekilde reklam amacıyla satmayız.</strong></p>

                  <h3>6. Verilerin Saklanma Süresi</h3>
                  <p>Verilerinizi hesabınız aktif olduğu sürece saklarız. Hesabınızı kapatmanız halinde, yasal saklama yükümlülükleri saklı kalmak kaydıyla, kişisel verileriniz makul süre içinde silinir veya anonimleştirilir. İstatistiksel amaçlarla tutulan veriler kimliğinizi belirlemeyecek şekilde anonim tutulabilir.</p>

                  <h3>7. Veri Güvenliği</h3>
                  <p>Verilerinizi yetkisiz erişime karşı korumak için şifrelerin hash'lenmesi, güvenli kimlik doğrulama ve erişim yetkilendirmesi gibi sektör standardı önlemler uygularız. Hiçbir sistem %100 güvenli olmamakla birlikte, verilerinizi korumak için gerekli tüm önlemleri alırız.</p>

                  <h3>8. Haklarınız</h3>
                  <p>Yürürlükteki kişisel veri mevzuatı kapsamında şu haklara sahipsiniz:</p>
                  <ul>
                    <li>Kişisel verilerinizin işlenip işlenmediğini öğrenme.</li>
                    <li>İşlenen verilerinize erişme ve kopyasını talep etme.</li>
                    <li>Yanlış veya eksik verilerin düzeltilmesini isteme.</li>
                    <li>Verilerinizin silinmesini veya yok edilmesini talep etme.</li>
                    <li>Verilerinizin işlenmesine itiraz etme.</li>
                  </ul>
                  <p>Bu haklarınızı kullanmak için <a href="mailto:rezpointsupport@gmail.com">rezpointsupport@gmail.com</a> adresinden bize ulaşabilirsiniz.</p>

                  <h3>9. Çerezler</h3>
                  <p>Platform, oturum yönetimi ve temel işlevsellik için yalnızca zorunlu çerezleri ve tarayıcı yerel depolama alanını (localStorage) kullanır. Reklam veya izleme amacıyla çerez kullanılmaz.</p>

                  <h3>10. Çocukların Gizliliği</h3>
                  <p>Platform 18 yaşından küçükler için tasarlanmamıştır. Bilerek 18 yaş altı kullanıcılardan veri toplamayız; böyle bir durumun farkına varırsak ilgili verileri sileriz.</p>

                  <h3>11. Politikada Değişiklik</h3>
                  <p>Bu Gizlilik Politikasını zaman zaman güncelleyebiliriz. Önemli değişiklikler Platform üzerinden duyurulur. Güncel tarih sayfanın üst kısmında belirtilir.</p>

                  <h3>12. İletişim</h3>
                  <p>Gizlilikle ilgili sorularınız için: <a href="mailto:rezpointsupport@gmail.com">rezpointsupport@gmail.com</a></p>
                </div>
              ) : (
                <div className="legal-content">
                  {rpTerms
                    ? rpTerms.split("\n").map((line, i) => <p key={i}>{line || <br />}</p>)
                    : <p className="description">Kullanım koşulları henüz yönetici tarafından eklenmemiştir.</p>
                  }
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {page === "businessPanel" && (
        <section className="business-panel-section">
          <div className="business-panel-header">
            <div>
              <h1>
                {loggedBusiness ? loggedBusiness.name : "İşletme Paneli"}
              </h1>
              <p className="description">
                Rezervasyonlarınızı ve işletme ayarlarınızı yönetin.
              </p>
            </div>

            <button
              className="nav-button"
              onClick={() => {
                localStorage.removeItem("rp_biz_id");
                localStorage.removeItem("rp_biz_token");
                localStorage.removeItem("rp_biz_cache");
                setBizSessionToken("");
                localStorage.setItem("rp_page", "home");
                setLoggedBusiness(null);
                setBusinessLogin({ email: "", password: "" });
                setPage("home");
              }}
            >
              Çıkış
            </button>
          </div>

          <div className="biz-mode-toggle">
            <button className={bizMode === "reservations" ? "biz-mode-btn active" : "biz-mode-btn"} onClick={() => setBizMode("reservations")}>🍽 Rezervasyonlar</button>
            <button className={bizMode === "meetings" ? "biz-mode-btn active" : "biz-mode-btn"} onClick={() => setBizMode("meetings")}>📅 Randevular</button>
          </div>

          {bizMode === "meetings" && (() => {
            const REASON_LABELS = { is_gorusmesi: "İş Görüşmesi", urun_tanitimi: "Ürün Tanıtımı", urun_teslimi: "Ürün Teslimi", diger: "Diğer" };
            const myMeetings = meetings.filter(m => String(m.businessId) === String(loggedBusiness?.id));
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const isPast = m => { const d = new Date(m.date + "T00:00:00"); return d < today; };
            const incomingMeetings = myMeetings.filter(m => m.status === "pending" && !isPast(m));
            const acceptedMeetings = myMeetings.filter(m => m.status === "accepted");
            const rejectedMeetings = myMeetings.filter(m => m.status === "rejected");
            const pastMeetings = myMeetings.filter(m => m.status === "accepted" && isPast(m));
            const activeMeetingDates = [...new Set(acceptedMeetings.filter(m => !isPast(m)).map(m => m.date))].sort();
            const meetingTitle = m => `${REASON_LABELS[m.reason] || m.reason} — ${m.company || m.fullName} — ${m.time} — ${formatDate(m.date)}`;
            return (
              <div>
                <div className="panel-tabs">
                  <button className={meetingPanelTab === "incoming" ? "active-tab" : ""} onClick={() => setMeetingPanelTab("incoming")}>Gelen İstekler ({incomingMeetings.length})</button>
                  <button className={meetingPanelTab === "accepted" ? "active-tab" : ""} onClick={() => setMeetingPanelTab("accepted")}>Kabul Edilenler ({acceptedMeetings.filter(m => !isPast(m)).length})</button>
                  <button className={meetingPanelTab === "rejected" ? "active-tab" : ""} onClick={() => setMeetingPanelTab("rejected")}>Reddedilenler ({rejectedMeetings.length})</button>
                  <button className={meetingPanelTab === "past" ? "active-tab" : ""} onClick={() => setMeetingPanelTab("past")}>Geçmiş ({pastMeetings.length})</button>
                  <button className={meetingPanelTab === "settings" ? "active-tab" : ""} onClick={() => setMeetingPanelTab("settings")}>Müsaitlik</button>
                </div>

                {meetingPanelTab === "incoming" && (
                  <div className="reservation-box">
                    <h2>Gelen Randevu İstekleri</h2>
                    {incomingMeetings.length > 0 ? incomingMeetings.map(m => (
                      <div key={m.id} className="incoming-req-item" style={{ cursor: "pointer" }} onClick={() => setMeetingDetailPopup(m)}>
                        <div className="incoming-req-info">
                          <div className="incoming-req-name">{meetingTitle(m)}</div>
                          <div className="incoming-req-meta">{m.email}</div>
                        </div>
                        <div className="incoming-req-actions" onClick={e => e.stopPropagation()}>
                          <button className="req-accept-btn" disabled={loadingReservationId === m.id} onClick={async () => {
                            setLoadingReservationId(m.id);
                            const { error } = await supabase.rpc("business_update_meeting_status", { p_token: bizSessionToken, p_meeting_id: m.id, p_status: "accepted" });
                            if (!error) {
                              setMeetings(prev => prev.map(x => x.id === m.id ? { ...x, status: "accepted" } : x));
                              sendPush({ userEmail: m.email, title: "✅ Randevu Talebiniz Kabul Edildi", body: `${loggedBusiness?.name || "İşletme"} randevu talebinizi onayladı. ${m.date} · ${m.time}`, url: "/" });
                            }
                            setLoadingReservationId(null);
                          }}>{loadingReservationId === m.id ? <Spinner /> : "✓"}</button>
                          <button className="req-reject-btn" disabled={loadingReservationId === m.id} onClick={async () => {
                            setLoadingReservationId(m.id);
                            const { error } = await supabase.rpc("business_update_meeting_status", { p_token: bizSessionToken, p_meeting_id: m.id, p_status: "rejected" });
                            if (!error) {
                              setMeetings(prev => prev.map(x => x.id === m.id ? { ...x, status: "rejected" } : x));
                              sendPush({ userEmail: m.email, title: "❌ Randevu Talebi Reddedildi", body: `${loggedBusiness?.name || "İşletme"} bu tarih için uygun değil. ${m.date} · ${m.time}`, url: "/" });
                            }
                            setLoadingReservationId(null);
                          }}>{loadingReservationId === m.id ? <Spinner /> : "✗"}</button>
                        </div>
                      </div>
                    )) : <p className="description" style={{ padding: "20px 0" }}>📭 Bekleyen randevu isteği yok.</p>}
                  </div>
                )}

                {meetingPanelTab === "accepted" && (
                  <div className="reservation-box">
                    <h2>Kabul Edilen Randevular</h2>
                    <div className="time-slots">
                      {activeMeetingDates.map(d => {
                        const parsed = new Date(d + "T00:00:00");
                        return (
                          <button key={d} className={selectedMeetingDate === d ? "selected-time" : "time-btn"} onClick={() => setSelectedMeetingDate(d)}>
                            {parsed.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", weekday: "long" })}<br />
                            <small>{acceptedMeetings.filter(m => m.date === d && !isPast(m)).length} randevu</small>
                          </button>
                        );
                      })}
                    </div>
                    {selectedMeetingDate && acceptedMeetings.filter(m => m.date === selectedMeetingDate && !isPast(m)).sort((a, b) => a.time.localeCompare(b.time)).map(m => (
                      <div key={m.id} className="accepted-list-item" style={{ cursor: "pointer" }} onClick={() => setMeetingDetailPopup(m)}>
                        <div className="accepted-list-info">
                          <strong>{m.time} — {REASON_LABELS[m.reason] || m.reason}</strong>
                          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{m.company || m.fullName} · {m.phone}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {meetingPanelTab === "rejected" && (
                  <div className="reservation-box">
                    <h2>Reddedilen Randevular</h2>
                    {rejectedMeetings.length > 0 ? rejectedMeetings.map(m => (
                      <div key={m.id} className="incoming-req-item" style={{ cursor: "pointer" }} onClick={() => setMeetingDetailPopup(m)}>
                        <div className="incoming-req-info">
                          <div className="incoming-req-name">{meetingTitle(m)}</div>
                          <div className="incoming-req-meta">{m.email}</div>
                        </div>
                        <span className="status-badge rejected">Reddedildi</span>
                      </div>
                    )) : <p className="description" style={{ padding: "20px 0" }}>Reddedilen randevu yok.</p>}
                  </div>
                )}

                {meetingPanelTab === "past" && (
                  <div className="reservation-box">
                    <h2>Geçmiş Randevular</h2>
                    {pastMeetings.length > 0 ? pastMeetings.sort((a, b) => b.date.localeCompare(a.date)).map(m => (
                      <div key={m.id} className="incoming-req-item" style={{ cursor: "pointer" }} onClick={() => setMeetingDetailPopup(m)}>
                        <div className="incoming-req-info">
                          <div className="incoming-req-name">{meetingTitle(m)}</div>
                          <div className="incoming-req-meta">{m.email}</div>
                        </div>
                        <span className="status-badge completed">Tamamlandı</span>
                      </div>
                    )) : <p className="description" style={{ padding: "20px 0" }}>Geçmiş randevu yok.</p>}
                  </div>
                )}

                {meetingPanelTab === "settings" && (() => {
                  const next15 = [];
                  for (let i = 0; i < 15; i++) {
                    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + i);
                    const fullDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
                    next15.push({ fullDate, display: d.toLocaleDateString("tr-TR", { day:"2-digit", month:"short", weekday:"short" }) });
                  }
                  return (
                    <div className="reservation-box">
                      <h2>Randevu Müsaitlik Ayarları</h2>

                      <p className="description" style={{ marginBottom: 10 }}>📅 Müsait günler</p>
                      <div className="time-slots" style={{ flexWrap: "wrap", marginBottom: 20 }}>
                        {next15.map(day => (
                          <button key={day.fullDate} type="button"
                            className={meetingAvailableDays.includes(day.fullDate) ? "selected-time" : "time-btn"}
                            onClick={() => setMeetingAvailableDays(prev => prev.includes(day.fullDate) ? prev.filter(d => d !== day.fullDate) : [...prev, day.fullDate].sort())}>
                            {day.display}
                          </button>
                        ))}
                      </div>

                      <p className="description" style={{ marginBottom: 10 }}>🕐 Genel müsait saatler (tarihe özel saat ayarlanmayan günlerde kullanılır)</p>
                      <div className="time-slots-grid" style={{ maxHeight: "none", marginBottom: 16 }}>
                        {ALL_TIME_SLOTS.map(slot => (
                          <button key={slot} type="button"
                            className={meetingAvailableTimes.includes(slot) ? "time-btn selected-time" : "time-btn"}
                            onClick={() => setMeetingAvailableTimes(prev => prev.includes(slot) ? prev.filter(t => t !== slot) : [...prev, slot].sort())}>
                            {slot}
                          </button>
                        ))}
                      </div>

                      {meetingAvailableDays.length > 0 && (
                        <>
                          <p className="description" style={{ marginBottom: 10, marginTop: 20 }}>📆 Tarihe Özel Saatler</p>
                          <p className="description" style={{ fontSize: 12, marginBottom: 12 }}>Her randevu günü için farklı saat dilimleri ayarlayabilirsiniz.</p>
                          {meetingAvailableDays.filter(d => new Date(d + "T00:00:00") >= new Date().setHours(0,0,0,0)).sort().map(date => {
                            const customTimes = dateTimesMap[date] || [];
                            const isExpanded = expandedDateForTimes === date;
                            const d = new Date(date + "T00:00:00");
                            const label = d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", weekday: "short" });
                            return (
                              <div key={date} style={{ marginBottom: 8 }}>
                                <button className="time-btn"
                                  style={{ width: "100%", textAlign: "left", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                                  onClick={() => setExpandedDateForTimes(isExpanded ? null : date)}>
                                  <span><strong>{label}</strong> — {customTimes.length > 0 ? customTimes.join(", ") : <em style={{ color: "#9ca3af" }}>genel saatler</em>}</span>
                                  <span>{isExpanded ? "▲" : "▼"}</span>
                                </button>
                                {isExpanded && (
                                  <div style={{ background: "rgba(109,40,217,0.04)", border: "1px solid rgba(109,40,217,0.12)", borderRadius: 12, padding: "12px 10px", marginTop: 4 }}>
                                    <div className="time-slots-grid">
                                      {ALL_TIME_SLOTS.map(time => (
                                        <button key={time}
                                          className={customTimes.includes(time) ? "selected-time" : "time-btn"}
                                          onClick={() => {
                                            const updated = customTimes.includes(time) ? customTimes.filter(t => t !== time) : [...customTimes, time].sort();
                                            setDateTimesMap(prev => {
                                              if (updated.length === 0) { const next = { ...prev }; delete next[date]; return next; }
                                              return { ...prev, [date]: updated };
                                            });
                                          }}>
                                          {time}
                                        </button>
                                      ))}
                                    </div>
                                    {customTimes.length > 0 && (
                                      <button className="time-btn" style={{ marginTop: 8, fontSize: 12 }}
                                        onClick={() => setDateTimesMap(prev => { const next = { ...prev }; delete next[date]; return next; })}>
                                        ✕ Genel saatlere dön
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </>
                      )}

                      {meetingTimeSaved && <p style={{ color: "#16a34a", fontWeight: 700, marginBottom: 8 }}>{meetingTimeSaved}</p>}
                      <button type="button" className="primary-btn" style={{ marginTop: 16 }} onClick={async () => {
                        const { error } = await supabase.rpc("business_save_meeting_availability", {
                          p_token: bizSessionToken,
                          p_business_id: loggedBusiness.id,
                          p_meeting_times: meetingAvailableTimes.join(","),
                          p_meeting_dates: meetingAvailableDays.join(","),
                          p_meeting_date_times: JSON.stringify(
                            Object.fromEntries(
                              Object.entries(dateTimesMap).filter(([,arr]) => arr.length > 0).map(([d,arr]) => [d, arr.join(",")])
                            )
                          ),
                        });
                        if (error) { alert("Kaydedilemedi: " + error.message); return; }
                        setLoggedBusiness(prev => ({ ...prev, meetingTimes: meetingAvailableTimes, meetingDates: meetingAvailableDays, dateTimes: dateTimesMap }));
                        setAdminBusinesses(prev => prev.map(b => b.id === loggedBusiness.id ? { ...b, meetingTimes: meetingAvailableTimes, meetingDates: meetingAvailableDays, dateTimes: dateTimesMap } : b));
                        setMeetingTimeSaved("Müsaitlik kaydedildi ✅");
                        setTimeout(() => setMeetingTimeSaved(""), 4000);
                      }}>Kaydet</button>
                    </div>
                  );
                })()}

                {meetingDetailPopup && (
                  <div className="popup-overlay" onClick={() => setMeetingDetailPopup(null)}>
                    <div className="popup-box" onClick={e => e.stopPropagation()} style={{ padding: "28px 28px 24px" }}>

                      {/* Başlık + gönderilme zamanı */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                        <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "#1a1a2e" }}>{t.popup.meetingTitle}</h2>
                        {meetingDetailPopup.createdAt && (
                          <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 500, lineHeight: 1.4, textAlign: "right" }}>
                            {t.popup.sentAt}<br/>
                            <strong style={{ color: "#6b7280" }}>
                              {(() => { const locale = lang === "en" ? "en-GB" : "tr-TR"; const d = new Date(meetingDetailPopup.createdAt); return `${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })} ${d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" })}`; })()}
                            </strong>
                          </span>
                        )}
                      </div>

                      {/* İsim + şirket + iletişim */}
                      <div style={{ textAlign: "center", marginBottom: 18 }}>
                        <div style={{ fontSize: "1.45rem", fontWeight: 800, color: "#1a1a2e", marginBottom: 4 }}>
                          {meetingDetailPopup.fullName}
                        </div>
                        {meetingDetailPopup.company && (
                          <div style={{ fontSize: 13, color: "#7c3aed", fontWeight: 600, marginBottom: 5 }}>{meetingDetailPopup.company}</div>
                        )}
                        <div style={{ fontSize: 13, color: "#6b7280", display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
                          <span>{meetingDetailPopup.email}</span>
                          <span>·</span>
                          <span>{meetingDetailPopup.phone}</span>
                        </div>
                      </div>

                      {/* Önemli bilgi chipler: tarih, saat, sebep */}
                      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 20 }}>
                        <span style={{ background: "rgba(109,40,217,0.12)", color: "#5b21b6", borderRadius: 12, padding: "9px 16px", fontWeight: 700, fontSize: "0.85rem" }}>
                          📅 {formatDate(meetingDetailPopup.date)}
                        </span>
                        <span style={{ background: "rgba(109,40,217,0.12)", color: "#5b21b6", borderRadius: 12, padding: "9px 16px", fontWeight: 700, fontSize: "0.85rem" }}>
                          🕐 {meetingDetailPopup.time}
                        </span>
                        <span style={{ background: "rgba(59,130,246,0.12)", color: "#1e40af", borderRadius: 12, padding: "9px 16px", fontWeight: 600, fontSize: "0.85rem" }}>
                          {REASON_LABELS[meetingDetailPopup.reason] || meetingDetailPopup.reason}
                        </span>
                      </div>

                      <hr style={{ border: "none", borderTop: "1px solid rgba(109,40,217,0.08)", margin: "0 0 16px" }} />

                      {/* Durum badge */}
                      {(() => {
                        const s = meetingDetailPopup.status;
                        const map = {
                          pending: { bg: "rgba(234,179,8,0.1)", color: "#854d0e", label: t.status.pending },
                          accepted: { bg: "rgba(34,197,94,0.1)", color: "#166534", label: t.status.accepted },
                          rejected: { bg: "rgba(239,68,68,0.1)", color: "#7f1d1d", label: t.status.rejected },
                        };
                        const st = map[s] || map.pending;
                        return (
                          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
                            <span style={{ background: st.bg, color: st.color, borderRadius: 8, padding: "5px 18px", fontWeight: 700, fontSize: "0.85rem" }}>
                              {st.label}
                            </span>
                          </div>
                        );
                      })()}

                      {/* Not */}
                      {meetingDetailPopup.note && meetingDetailPopup.note !== "—" && (
                        <div style={{ background: "rgba(109,40,217,0.04)", border: "1px solid rgba(109,40,217,0.1)", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#374151" }}>
                          <span style={{ fontWeight: 600, color: "#6d28d9" }}>Not: </span>
                          {meetingDetailPopup.note}
                        </div>
                      )}

                      <button className="primary-btn" style={{ marginTop: 8, width: "100%" }} onClick={() => setMeetingDetailPopup(null)}>{t.popup.close}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {bizMode === "reservations" && <div className="panel-tabs">
            <button
              className={panelTab === "incoming" ? "active-tab" : ""}
              onClick={() => setPanelTab("incoming")}
            >
              Gelen İstekler ({getBusinessReservationCount("pending")})
            </button>

            <button
              className={panelTab === "accepted" ? "active-tab" : ""}
              onClick={() => setPanelTab("accepted")}
            >
              Kabul Edildi ({getBusinessReservationCount("accepted")})
            </button>

            <button
              className={panelTab === "rejected" ? "active-tab" : ""}
              onClick={() => setPanelTab("rejected")}
            >
              Reddedildi ({getBusinessReservationCount("rejected")})
            </button>

            <button
              className={panelTab === "completed" ? "active-tab" : ""}
              onClick={() => setPanelTab("completed")}
            >
              Tamamlandı ({reservations.filter(r => String(r.businessId) === String(loggedBusiness?.id) && r.status === "completed" && r.attendanceStatus === "attended").length})
            </button>

            <button
              className={panelTab === "noShow" ? "active-tab" : ""}
              onClick={() => setPanelTab("noShow")}
            >
              No Show ({reservations.filter(r => String(r.businessId) === String(loggedBusiness?.id) && r.status === "completed" && r.attendanceStatus === "no_show").length})
            </button>

            <button
              className={panelTab === "settings" ? "active-tab" : ""}
              onClick={() => setPanelTab("settings")}
            >
              Müsaitlik
            </button>

            <button
              className={panelTab === "profile" ? "active-tab" : ""}
              onClick={() => setPanelTab("profile")}
            >
              İşletme Profili
            </button>

            <button
              className={panelTab === "insights" ? "active-tab" : ""}
              onClick={() => setPanelTab("insights")}
            >
              Müşterini Tanı
            </button>
          </div>}

          {bizMode === "reservations" && <div className="panel-content">
            {panelTab === "incoming" && (
              <div className="reservation-box">
                <h2>Gelen Rezervasyon İstekleri</h2>

                {/*
                  FIX: previously this checked
                  reservations.filter(rez => rez.status === "pending").length
                  across ALL businesses, which could show "no requests"
                  styling incorrectly when a different business had pending
                  items but this one didn't (or vice versa). Now scoped to
                  the logged-in business and includes "cancelled" so the
                  empty-state message and the list stay in sync.
                */}
                {loggedBusiness &&
                reservations.filter(
                  (rez) =>
                    rez.status === "pending" &&
                    String(rez.businessId) === String(loggedBusiness.id),
                ).length > 0 ? (
                  reservations
                    .filter(
                      (rez) =>
                        rez.status === "pending" &&
                        loggedBusiness &&
                        String(rez.businessId) === String(loggedBusiness.id),
                    )
                    .map((rez) => (
                      <div
                        key={rez.id}
                        className="incoming-req-item"
                        onClick={() => setSelectedReservation(rez)}
                      >
                        <div className="incoming-req-info">
                          <span className="incoming-req-name">{rez.fullName}</span>
                          <span className="incoming-req-meta">
                            {formatDate(rez.date)} · {rez.time} · {rez.guests} kişi
                          </span>
                        </div>

                        <div className="incoming-req-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="req-accept-btn"
                            disabled={loadingReservationId === rez.id}
                            title="Kabul Et"
                            onClick={async (e) => {
                              e.stopPropagation();
                              setLoadingReservationId(rez.id);

                              const { error } = await supabase.rpc("business_accept_reservation", {
                                p_token: bizSessionToken,
                                p_rez_id: rez.id,
                              });

                              if (error) {
                                alert(`Rezervasyon kabul edilemedi: ${error.message}`);
                                setLoadingReservationId(null);
                                return;
                              }

                              setReservations((prev) =>
                                prev.map((item) =>
                                  item.id === rez.id
                                    ? { ...item, status: "accepted", businessMessage: "Rezervasyonunuz oluşturuldu. Sizi bekliyoruz ❤️" }
                                    : item,
                                ),
                              );
                              // Müşteriye bildirim gönder
                              sendPush({ userEmail: rez.email, title: "✅ Rezervasyonunuz Kabul Edildi!", body: `${loggedBusiness?.name || "İşletme"} rezervasyonunuzu onayladı. ${rez.date} · ${rez.time}`, url: "/" });
                              setLoadingReservationId(null);
                            }}
                          >
                            {loadingReservationId === rez.id ? <Spinner /> : "✓"}
                          </button>

                          <button
                            className="req-reject-btn"
                            disabled={loadingReservationId === rez.id}
                            title="Reddet"
                            onClick={async (e) => {
                              e.stopPropagation();
                              setLoadingReservationId(rez.id);

                              const { error } = await supabase.rpc("business_reject_reservation", {
                                p_token: bizSessionToken,
                                p_rez_id: rez.id,
                              });

                              if (error) {
                                alert(`Rezervasyon reddedilemedi: ${error.message}`);
                                setLoadingReservationId(null);
                                return;
                              }

                              setReservations((prev) =>
                                prev.map((item) =>
                                  item.id === rez.id
                                    ? { ...item, status: "rejected", businessMessage: "İşletmemizde uygun masa bulunmamaktadır, yine bekleriz ❤️" }
                                    : item,
                                ),
                              );
                              // Müşteriye bildirim gönder
                              sendPush({ userEmail: rez.email, title: "❌ Rezervasyon Reddedildi", body: `${loggedBusiness?.name || "İşletme"} bu tarih için uygun değil. ${rez.date} · ${rez.time}`, url: "/" });
                              setLoadingReservationId(null);
                            }}
                          >
                            {loadingReservationId === rez.id ? <Spinner /> : "✗"}
                          </button>
                        </div>
                      </div>
                    ))
                ) : (
                  <p className="description" style={{ padding: "20px 0" }}>
                    📭 Bekleyen rezervasyon isteği yok.
                  </p>
                )}
              </div>
            )}

            {panelTab === "accepted" && (
              <div className="reservation-box">
                <h2>Kabul Edilen Rezervasyonlar</h2>
                <p className="description">Tarih seçin, ardından her rezervasyon için Katıldı / Katılmadı işaretleyin.</p>

                <div className="time-slots">
                  {(() => {
                    const futureDates = getAvailableDates();
                    const futureDateSet = new Set(futureDates.map(d => d.fullDate));
                    const pastAcceptedDates = [...new Set(
                      reservations
                        .filter(r => r.status === "accepted" && loggedBusiness && String(r.businessId) === String(loggedBusiness.id) && !futureDateSet.has(r.date))
                        .map(r => r.date)
                    )].sort().map(d => {
                      const parsed = parseLocalDate(d);
                      return {
                        fullDate: d,
                        display: parsed ? parsed.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", weekday: "long" }) : d,
                      };
                    });
                    return [...pastAcceptedDates, ...futureDates].map((date) => {
                      const count = reservations.filter(
                        (rez) => rez.status === "accepted" && rez.date === date.fullDate && loggedBusiness && String(rez.businessId) === String(loggedBusiness.id),
                      ).length;
                      return (
                        <button key={date.fullDate}
                          className={selectedAcceptedDate === date.fullDate ? "selected-time" : "time-btn"}
                          onClick={() => setSelectedAcceptedDate(date.fullDate)}>
                          {date.display}<br /><small>{count} rezervasyon</small>
                        </button>
                      );
                    });
                  })()}
                </div>

                {selectedAcceptedDate && (() => {
                  const dateRezs = reservations.filter(
                    (rez) => rez.status === "accepted" && rez.date === selectedAcceptedDate && loggedBusiness && String(rez.businessId) === String(loggedBusiness.id),
                  );
                  return (
                    <div style={{ marginTop: 25 }}>
                      <h3>{formatDate(selectedAcceptedDate)}</h3>
                      {dateRezs.length > 0 ? dateRezs.map((rez) => (
                        <div className="accepted-list-item" key={rez.id} onClick={() => setSelectedReservation(rez)}>
                          <div className="accepted-list-info">
                            <strong>{rez.time} — {rez.fullName}</strong>
                            <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>{rez.guests} misafir</p>
                          </div>
                          <button
                            type="button"
                            className={`attend-check${rez.attendanceStatus === "attended" ? " attended" : rez.attendanceStatus === "no_show" ? " no-show" : ""}`}
                            disabled={rez.attendanceStatus === "no_show"}
                            title={rez.attendanceStatus === "attended" ? "Katıldı — geri almak için tıkla" : rez.attendanceStatus === "no_show" ? "Katılmadı (gün kapatıldı)" : "Tıkla: Katıldı olarak işaretle"}
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (rez.attendanceStatus === "no_show") return;

                              if (rez.attendanceStatus === "attended") {
                                // Geri al — sadece durumu sıfırla, safescore değişmez
                                const { error } = await supabase.rpc("business_undo_attendance", { p_token: bizSessionToken, p_rez_id: rez.id });
                                if (error) { alert("Güncellenemedi."); return; }
                                setReservations(prev => prev.map(r => r.id === rez.id ? { ...r, attendanceStatus: "pending" } : r));
                                return;
                              }

                              // Katıldı olarak işaretle
                              const { data: newScore, error } = await supabase.rpc("business_mark_attended", { p_token: bizSessionToken, p_rez_id: rez.id });
                              if (error) { alert("Güncellenemedi."); return; }
                              if (loggedCustomer?.email === rez.email && newScore != null) {
                                setLoggedCustomer(prev => prev ? { ...prev, safeScore: Number(newScore) } : prev);
                              }
                              setReservations(prev => prev.map(r => r.id === rez.id ? { ...r, attendanceStatus: "attended" } : r));
                            }}
                          >
                            {rez.attendanceStatus === "attended" && "✓"}
                            {rez.attendanceStatus === "no_show" && "✕"}
                          </button>
                        </div>
                      )) : <p className="description">Bu tarih için kabul edilen rezervasyon yok.</p>}
                      {savedMessage && (
                        <p style={{ color: "var(--green)", fontWeight: 700, marginTop: 12, fontSize: 14 }}>{savedMessage}</p>
                      )}
                      <button
                        className="close-day-btn"
                        style={{ marginTop: 12 }}
                        disabled={actionLoading}
                        onClick={closeDayReservations}
                      >
                        {actionLoading ? <Spinner /> : "🔒 Günü Kapat"}
                      </button>
                    </div>
                  );
                })()}
              </div>
            )}

            {panelTab === "rejected" && (
              <div className="reservation-box">
                <h2>Reddedilen Rezervasyonlar</h2>
                <p className="description">
                  Reddedilen rezervasyon istekleri burada görünür.
                </p>

                {reservations.filter(
                  (rez) =>
                    rez.status === "rejected" &&
                    loggedBusiness &&
                    String(rez.businessId) === String(loggedBusiness.id),
                ).length > 0 ? (
                  reservations
                    .filter(
                      (rez) =>
                        rez.status === "rejected" &&
                        loggedBusiness &&
                        String(rez.businessId) === String(loggedBusiness.id),
                    )
                    .map((rez) => (
                      <div
                        className="accepted-list-item"
                        key={rez.id}
                        onClick={() => setSelectedReservation(rez)}
                      >
                        <div>
                          <strong>
                            {rez.time} - {rez.fullName}
                          </strong>
                          <p style={{ marginTop: "6px", color: "var(--text-muted)" }}>
                            {formatDate(rez.date)}
                          </p>
                          <p style={{ marginTop: "6px", color: "var(--text-muted)" }}>
                            Not: {rez.note || "Not yok"}
                          </p>
                        </div>

                        <span>{rez.guests} misafir</span>
                      </div>
                    ))
                ) : (
                  <p className="description">Henüz reddedilen rezervasyon yok.</p>
                )}
              </div>
            )}

            {panelTab === "completed" && (
              <div className="reservation-box">
                <h2>Tamamlanan Rezervasyonlar</h2>

                {reservations.filter(
                  (rez) =>
                    rez.status === "completed" &&
                    rez.attendanceStatus === "attended" &&
                    loggedBusiness &&
                    String(rez.businessId) === String(loggedBusiness.id),
                ).length > 0 ? (
                  reservations
                    .filter(
                      (rez) =>
                        rez.status === "completed" &&
                        rez.attendanceStatus === "attended" &&
                        loggedBusiness &&
                        String(rez.businessId) === String(loggedBusiness.id),
                    )
                    .map((rez) => (
                      <div
                        className="accepted-list-item"
                        key={rez.id}
                        onClick={() => setSelectedReservation(rez)}
                      >
                        <div>
                          <strong>
                            {rez.time} - {rez.fullName}
                          </strong>
                          <p style={{ marginTop: "6px", color: "var(--text-muted)" }}>
                            {formatDate(rez.date)}
                          </p>
                        </div>

                        <span>✓ Katıldı</span>
                      </div>
                    ))
                ) : (
                  <p className="description">Henüz tamamlanan rezervasyon yok.</p>
                )}
              </div>
            )}

            {panelTab === "noShow" && (
              <div className="reservation-box">
                <h2>No Show Rezervasyonlar</h2>

                {reservations.filter(
                  (rez) =>
                    rez.status === "completed" &&
                    rez.attendanceStatus === "no_show" &&
                    loggedBusiness &&
                    String(rez.businessId) === String(loggedBusiness.id),
                ).length > 0 ? (
                  reservations
                    .filter(
                      (rez) =>
                        rez.status === "completed" &&
                        rez.attendanceStatus === "no_show" &&
                        loggedBusiness &&
                        String(rez.businessId) === String(loggedBusiness.id),
                    )
                    .map((rez) => (
                      <div
                        className="accepted-list-item"
                        key={rez.id}
                        onClick={() => setSelectedReservation(rez)}
                      >
                        <div>
                          <strong>
                            {rez.time} - {rez.fullName}
                          </strong>
                          <p style={{ marginTop: "6px", color: "var(--text-muted)" }}>
                            {formatDate(rez.date)}
                          </p>
                        </div>

                        <span>✕ No Show</span>
                      </div>
                    ))
                ) : (
                  <p className="description">Henüz no-show rezervasyon yok.</p>
                )}
              </div>
            )}

            {panelTab === "settings" && (
              <div className="reservation-box">
                <h2>Müsaitlik Ayarları</h2>
                <p className="description">
                  Rezervasyon ve randevu sistemlerini açıp kapatın; müsait gün ve saatleri düzenleyin.
                </p>

                {/* ── Sistem Durumu ── */}
                <div className="biz-status-toggles">
                  <div className="biz-status-row">
                    <div className="biz-status-info">
                      <span className="biz-status-label">📋 Rezervasyon Sistemi</span>
                      <span className="biz-status-sub">
                        {loggedBusiness?.adminReservationLocked && !loggedBusiness?.reservationActive
                          ? "⛔ Admin tarafından kilitlendi"
                          : loggedBusiness?.reservationActive ? "Müşteriler rezervasyon yapabilir" : "Rezervasyon şu an kapalı"}
                      </span>
                    </div>
                    <button
                      className={`biz-toggle-btn${loggedBusiness?.reservationActive ? " on" : " off"}`}
                      disabled={!loggedBusiness?.reservationActive && loggedBusiness?.adminReservationLocked}
                      title={!loggedBusiness?.reservationActive && loggedBusiness?.adminReservationLocked ? "Admin tarafından kilitlendi" : ""}
                      onClick={async () => {
                        const newVal = !loggedBusiness.reservationActive;
                        const { data, error } = await supabase.rpc("business_set_status", { p_token: bizSessionToken, p_reservation_enabled: newVal });
                        if (error) { alert("Güncellenemedi: " + error.message); return; }
                        if (data?.reservation_error === "admin_locked") { alert("⛔ Bu sistem admin tarafından kilitlenmiştir. Açmak için yöneticinizle iletişime geçin."); return; }
                        setLoggedBusiness(prev => {
                          const updated = { ...prev, reservationActive: newVal };
                          localStorage.setItem("rp_biz_cache", JSON.stringify(updated));
                          return updated;
                        });
                        setAdminBusinesses(prev => prev.map(b => b.id === loggedBusiness.id ? { ...b, reservationActive: newVal } : b));
                      }}
                    >
                      <span className="biz-toggle-knob" />
                    </button>
                  </div>

                  <div className="biz-status-row">
                    <div className="biz-status-info">
                      <span className="biz-status-label">📅 Randevu Sistemi</span>
                      <span className="biz-status-sub">
                        {loggedBusiness?.adminMeetingLocked && !loggedBusiness?.meetingEnabled
                          ? "⛔ Admin tarafından kilitlendi"
                          : loggedBusiness?.meetingEnabled ? "Müşteriler randevu talep edebilir" : "Randevu şu an kapalı"}
                      </span>
                    </div>
                    <button
                      className={`biz-toggle-btn${loggedBusiness?.meetingEnabled ? " on" : " off"}`}
                      disabled={!loggedBusiness?.meetingEnabled && loggedBusiness?.adminMeetingLocked}
                      title={!loggedBusiness?.meetingEnabled && loggedBusiness?.adminMeetingLocked ? "Admin tarafından kilitlendi" : ""}
                      onClick={async () => {
                        const newVal = !loggedBusiness.meetingEnabled;
                        const { data, error } = await supabase.rpc("business_set_status", { p_token: bizSessionToken, p_meeting_enabled: newVal });
                        if (error) { alert("Güncellenemedi: " + error.message); return; }
                        if (data?.meeting_error === "admin_locked") { alert("⛔ Bu sistem admin tarafından kilitlenmiştir. Açmak için yöneticinizle iletişime geçin."); return; }
                        setLoggedBusiness(prev => {
                          const updated = { ...prev, meetingEnabled: newVal };
                          localStorage.setItem("rp_biz_cache", JSON.stringify(updated));
                          return updated;
                        });
                        setAdminBusinesses(prev => prev.map(b => b.id === loggedBusiness.id ? { ...b, meetingEnabled: newVal } : b));
                      }}
                    >
                      <span className="biz-toggle-knob" />
                    </button>
                  </div>
                </div>

                <h3 style={{ marginTop: 24 }}>Rezervasyon Modu</h3>

                <div className="time-slots">
                  <button
                    className={availabilityMode === "specific" ? "selected-time" : "time-btn"}
                    onClick={() => setAvailabilityMode("specific")}
                  >
                    Belirli Günler
                  </button>
                  <button
                    className={availabilityMode === "weekly" ? "selected-time" : "time-btn"}
                    onClick={() => setAvailabilityMode("weekly")}
                  >
                    Haftalık Gün
                  </button>
                </div>

                {availabilityMode === "specific" && (
                  <>
                    <h3 style={{ marginTop: "24px" }}>Müsait Günler (Önümüzdeki 15 Gün)</h3>
                    <div className="time-slots" style={{ flexWrap: "wrap" }}>
                      {(() => {
                        const next15 = [];
                        for (let i = 0; i < 15; i++) {
                          const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + i);
                          const fd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
                          next15.push({ fullDate: fd, display: d.toLocaleDateString("tr-TR", { day:"2-digit", month:"short", weekday:"short" }) });
                        }
                        return next15.map(day => (
                          <button key={day.fullDate}
                            className={specificDates.includes(day.fullDate) ? "selected-time" : "time-btn"}
                            onClick={() => setSpecificDates(prev => prev.includes(day.fullDate) ? prev.filter(d => d !== day.fullDate) : [...prev, day.fullDate].sort())}>
                            {day.display}
                          </button>
                        ));
                      })()}
                    </div>

                    {specificDates.length > 0 && (
                      <>
                        <p className="description" style={{ marginBottom: 10, marginTop: 20 }}>📆 Tarihe Özel Saatler</p>
                        <p className="description" style={{ fontSize: 12, marginBottom: 12 }}>Her gün için farklı saat dilimleri ayarlayabilirsiniz. Ayarlanmayan günlerde aşağıdaki genel saatler kullanılır.</p>
                        {specificDates.filter(d => new Date(d + "T00:00:00") >= new Date().setHours(0,0,0,0)).sort().map(date => {
                          const customTimes = reservationDateTimesMap[date] || [];
                          const isExpanded = expandedRezDateForTimes === date;
                          const d = new Date(date + "T00:00:00");
                          const label = d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", weekday: "short" });
                          return (
                            <div key={date} style={{ marginBottom: 8 }}>
                              <button className="time-btn"
                                style={{ width: "100%", textAlign: "left", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                                onClick={() => setExpandedRezDateForTimes(isExpanded ? null : date)}>
                                <span><strong>{label}</strong> — {customTimes.length > 0 ? customTimes.join(", ") : <em style={{ color: "#9ca3af" }}>genel saatler</em>}</span>
                                <span>{isExpanded ? "▲" : "▼"}</span>
                              </button>
                              {isExpanded && (
                                <div style={{ background: "rgba(109,40,217,0.04)", border: "1px solid rgba(109,40,217,0.12)", borderRadius: 12, padding: "12px 10px", marginTop: 4 }}>
                                  <div className="time-slots-grid">
                                    {ALL_TIME_SLOTS.map(time => (
                                      <button key={time}
                                        className={customTimes.includes(time) ? "selected-time" : "time-btn"}
                                        onClick={() => {
                                          const updated = customTimes.includes(time) ? customTimes.filter(s => s !== time) : [...customTimes, time].sort();
                                          setReservationDateTimesMap(prev => {
                                            if (updated.length === 0) { const next = { ...prev }; delete next[date]; return next; }
                                            return { ...prev, [date]: updated };
                                          });
                                        }}>
                                        {time}
                                      </button>
                                    ))}
                                  </div>
                                  {customTimes.length > 0 && (
                                    <button className="time-btn" style={{ marginTop: 8, fontSize: 12 }}
                                      onClick={() => setReservationDateTimesMap(prev => { const next = { ...prev }; delete next[date]; return next; })}>
                                      ✕ Genel saatlere dön
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </>
                )}

                {availabilityMode === "weekly" && (
                  <>
                    <h3 style={{ marginTop: "24px" }}>Müsait Günler</h3>
                    <div className="time-slots">
                      {[
                        { value: "Monday", label: "Pazartesi" },
                        { value: "Tuesday", label: "Salı" },
                        { value: "Wednesday", label: "Çarşamba" },
                        { value: "Thursday", label: "Perşembe" },
                        { value: "Friday", label: "Cuma" },
                        { value: "Saturday", label: "Cumartesi" },
                        { value: "Sunday", label: "Pazar" },
                      ].map(({ value, label }) => (
                        <button key={value}
                          className={availableDays.includes(value) ? "selected-time" : "time-btn"}
                          onClick={() => setAvailableDays(prev => prev.includes(value) ? prev.filter(d => d !== value) : [...prev, value])}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {/* ── Açılış / Kapanış Saatleri ── */}
                <h3 style={{ marginTop: "28px", marginBottom: "4px" }}>Açılış — Kapanış Saatleri</h3>
                <p className="description" style={{ fontSize: 12, margin: "4px 0 14px" }}>
                  Her gün için açılış ve kapanış saatini girin. Boş bırakılan günler kapalı sayılır.
                </p>
                <div className="biz-hours-grid">
                  {[
                    { key: "Monday",    label: "Pazartesi" },
                    { key: "Tuesday",   label: "Salı" },
                    { key: "Wednesday", label: "Çarşamba" },
                    { key: "Thursday",  label: "Perşembe" },
                    { key: "Friday",    label: "Cuma" },
                    { key: "Saturday",  label: "Cumartesi" },
                    { key: "Sunday",    label: "Pazar" },
                  ].map(({ key, label }) => {
                    const dayHours = businessHours[key] || {};
                    const closed = !dayHours.open && !dayHours.close;
                    return (
                      <div key={key} className={`biz-hours-row${closed ? " closed" : ""}`}>
                        <span className="biz-hours-day">{label}</span>
                        <div className="biz-hours-inputs">
                          <input
                            type="time"
                            className="biz-hours-time"
                            value={dayHours.open || ""}
                            placeholder="--:--"
                            onChange={e => setBusinessHours(prev => ({ ...prev, [key]: { ...(prev[key] || {}), open: e.target.value } }))}
                          />
                          <span className="biz-hours-sep">—</span>
                          <input
                            type="time"
                            className="biz-hours-time"
                            value={dayHours.close || ""}
                            placeholder="--:--"
                            onChange={e => setBusinessHours(prev => ({ ...prev, [key]: { ...(prev[key] || {}), close: e.target.value } }))}
                          />
                        </div>
                        <button
                          className={`biz-hours-toggle${closed ? "" : " open"}`}
                          onClick={() => setBusinessHours(prev => closed
                            ? { ...prev, [key]: { open: "09:00", close: "22:00" } }
                            : { ...prev, [key]: {} }
                          )}
                        >
                          {closed ? "Kapalı" : "Açık"}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button
                  className="save-changes-btn"
                  style={{ marginTop: "14px", marginBottom: "8px" }}
                  onClick={async () => {
                    const { error } = await supabase.rpc("business_save_hours", {
                      p_token: bizSessionToken,
                      p_business_hours: businessHours,
                    });
                    if (error) { alert("Saatler kaydedilemedi."); return; }
                    setAdminBusinesses(prev => prev.map(b => b.id === loggedBusiness.id ? { ...b, businessHours } : b));
                    setLoggedBusiness(prev => {
                      const updated = { ...prev, businessHours };
                      localStorage.setItem("rp_biz_cache", JSON.stringify(updated));
                      return updated;
                    });
                    setSavedMessage("Saatler kaydedildi ✅");
                    setTimeout(() => setSavedMessage(""), 3000);
                  }}
                >
                  Saatleri Kaydet
                </button>

                <h3 style={{ marginTop: "24px" }}>Rezervasyon Saatleri</h3>
                <p className="description" style={{ fontSize: 12, margin: "4px 0 10px" }}>
                  08:00'den başlayarak yarım saatlik dilimlerle seçin. Seçili saatler müşterilere gösterilir.
                </p>

                <div className="time-slots-grid">
                  {ALL_TIME_SLOTS.map((time) => (
                    <button
                      key={time}
                      className={availableTimes.includes(time) ? "selected-time" : "time-btn"}
                      onClick={() => {
                        if (availableTimes.includes(time)) {
                          setAvailableTimes(availableTimes.filter((t) => t !== time));
                        } else {
                          setAvailableTimes([...availableTimes, time].sort());
                        }
                      }}
                    >
                      {time}
                    </button>
                  ))}
                </div>

                {savedMessage && (
                  <p
                    style={{
                      marginTop: "15px",
                      color: "#86efac",
                      fontWeight: "bold",
                    }}
                  >
                    {savedMessage}
                  </p>
                )}

                <button
                  className="save-changes-btn"
                  style={{ marginTop: "20px" }}
                  onClick={async () => {
                    if (!loggedBusiness) return;

                    const { error } = await supabase.rpc("business_save_availability", {
                      p_token: bizSessionToken,
                      p_business_id: loggedBusiness.id,
                      p_availability_mode: availabilityMode,
                      p_available_days: availableDays.join(","),
                      p_available_times: availableTimes.join(","),
                      p_specific_dates: specificDates.join(","),
                      p_reservation_date_times: JSON.stringify(
                        Object.fromEntries(
                          Object.entries(reservationDateTimesMap).filter(([,arr]) => arr.length > 0).map(([d,arr]) => [d, arr.join(",")])
                        )
                      ),
                    });

                    if (error) {
                      console.log("Availability save error:", error);
                      alert("Settings kaydedilemedi.");
                      return;
                    }

                    // Keep local copy of the business in sync so other
                    // views (e.g. customer reservation flow) reflect the
                    // updated availability immediately.
                    const updatedBusiness = {
                      ...loggedBusiness,
                      availabilityMode,
                      availableDays,
                      availableTimes,
                      specificDates,
                      dateTimes: dateTimesMap,
                      reservationDateTimes: reservationDateTimesMap,
                    };

                    setLoggedBusiness(updatedBusiness);
                    localStorage.setItem("rp_biz_cache", JSON.stringify(updatedBusiness));

                    setAdminBusinesses((prev) =>
                      prev.map((b) =>
                        b.id === loggedBusiness.id ? updatedBusiness : b,
                      ),
                    );

                    setSavedMessage("Değişiklikler başarıyla kaydedildi ✅");

                    setTimeout(() => {
                      setSavedMessage("");
                    }, 3000);
                  }}
                >
                  Değişiklikleri Kaydet
                </button>
              </div>
            )}

            {panelTab === "profile" && (
              <div className="reservation-box">
                <h2>İşletme Profili</h2>
                <p className="description">İşletme bilgilerini ve menü bilgilerini düzenleyin.</p>

                <form className="reservation-form">
                  <input
                    type="text"
                    placeholder="İşletme Adı"
                    value={businessProfileForm.name}
                    onChange={(e) => setBusinessProfileForm({ ...businessProfileForm, name: e.target.value })}
                  />
                  <input
                    type="text"
                    placeholder="Konum"
                    value={businessProfileForm.location}
                    onChange={(e) => setBusinessProfileForm({ ...businessProfileForm, location: e.target.value })}
                  />
                  <input
                    type="tel"
                    placeholder="Telefon Numarası"
                    value={businessProfileForm.phone}
                    onChange={(e) => setBusinessProfileForm({ ...businessProfileForm, phone: e.target.value })}
                  />
                  <textarea
                    placeholder="İşletme Açıklaması (müşterilere görünür)"
                    value={businessProfileForm.description}
                    onChange={(e) => setBusinessProfileForm({ ...businessProfileForm, description: e.target.value })}
                    rows={4}
                  />
                  <textarea
                    placeholder="Menü (link veya metin — müşterilere görünür)"
                    value={businessProfileForm.menu}
                    onChange={(e) => setBusinessProfileForm({ ...businessProfileForm, menu: e.target.value })}
                    rows={4}
                  />
                  <textarea
                    placeholder="İşletme Koşulları (rezervasyon öncesi müşterilere gösterilir — boş bırakılabilir)"
                    value={businessProfileForm.terms}
                    onChange={(e) => setBusinessProfileForm({ ...businessProfileForm, terms: e.target.value })}
                    rows={5}
                  />
                  {businessProfileSaved && (
                    <p style={{ color: "#86efac", fontWeight: "bold", marginTop: 8 }}>{businessProfileSaved}</p>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      if (!loggedBusiness) return;

                      const menuData = JSON.stringify({
                        description: businessProfileForm.description,
                        menu: businessProfileForm.menu,
                        phone: businessProfileForm.phone,
                        terms: businessProfileForm.terms,
                      });

                      const { error: saveError } = await supabase.rpc("business_save_profile", {
                        p_token: bizSessionToken,
                        p_business_id: loggedBusiness.id,
                        p_name: businessProfileForm.name,
                        p_location: businessProfileForm.location,
                        p_menu_text: menuData,
                      });

                      if (saveError) {
                        alert("Profil kaydedilemedi: " + saveError.message);
                        return;
                      }

                      const updatedBusiness = {
                        ...loggedBusiness,
                        name: businessProfileForm.name,
                        location: businessProfileForm.location,
                        phone: businessProfileForm.phone,
                        description: businessProfileForm.description,
                        menu: businessProfileForm.menu,
                        terms: businessProfileForm.terms,
                        menuText: menuData,
                        logoUrl: loggedBusiness.logoUrl,
                      };
                      setLoggedBusiness(updatedBusiness);
                      localStorage.setItem("rp_biz_cache", JSON.stringify(updatedBusiness));
                      setAdminBusinesses((prev) =>
                        prev.map((b) => b.id === loggedBusiness.id ? { ...updatedBusiness, logoUrl: b.logoUrl || updatedBusiness.logoUrl } : b)
                      );
                      setBusinessProfileSaved("Profil başarıyla kaydedildi ✅");
                      setTimeout(() => setBusinessProfileSaved(""), 4000);
                    }}
                  >
                    Profili Kaydet
                  </button>
                </form>
              </div>
            )}

            {panelTab === "insights" && (
              <div className="reservation-box insight-box">
                <div className="insight-header">
                  <div>
                    <h2>Müşterini Tanı</h2>
                    <p className="description" style={{ marginBottom: 0 }}>
                      Katılan müşterilere ait analizler.
                    </p>
                  </div>
                  <div className="insight-total-badge">
                    <AnimatedNumber value={getBusinessAcceptedReservations().length} /> katılımcı
                  </div>
                </div>

                <div className="insight-tab-grid">
                  {[
                    { key: "age", icon: "🎂", label: "Yaş" },
                    { key: "gender", icon: "👥", label: "Cinsiyet" },
                    { key: "firstTimers", icon: "🌟", label: "İlk Kez" },
                    { key: "topCustomers", icon: "🏆", label: "VIP" },
                    { key: "smoking", icon: "🚬", label: "Sigara" },
                    { key: "busyDays", icon: "📅", label: "Günler" },
                    { key: "busyHours", icon: "🕐", label: "Saatler" },
                  ].map(tab => (
                    <button
                      key={tab.key}
                      className={`insight-tab-btn${customerInsightTab === tab.key ? " active" : ""}`}
                      onClick={() => setCustomerInsightTab(tab.key)}
                    >
                      <span className="insight-tab-icon">{tab.icon}</span>
                      <span>{tab.label}</span>
                    </button>
                  ))}
                </div>

                <div className="insight-content">
                  {customerInsightTab === "age" && (() => {
                    const list = getDistributionList("age");
                    return list.length > 0 ? (
                      <div>
                        <div className="insight-section-title">🎂 Yaş Aralığı Dağılımı</div>
                        {list.map((item, i) => (
                          <div className="insight-progress-row" key={item.label} style={{ animationDelay: `${i * 0.07}s` }}>
                            <div className="insight-progress-label">
                              <span>{item.label}</span>
                              <strong>{item.count} kişi <em>•</em> {item.percent}%</strong>
                            </div>
                            <div className="insight-track">
                              <div className="insight-fill" style={{ width: `${item.percent}%`, animationDelay: `${i * 0.07 + 0.1}s` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <p className="insight-empty">Yaş dağılımı için kabul edilmiş rezervasyon gerekiyor.</p>;
                  })()}

                  {customerInsightTab === "gender" && (() => {
                    const list = getDistributionList("gender");
                    return list.length > 0 ? (
                      <div>
                        <div className="insight-section-title">👥 Cinsiyet Dağılımı</div>
                        {list.map((item, i) => (
                          <div className="insight-progress-row" key={item.label} style={{ animationDelay: `${i * 0.07}s` }}>
                            <div className="insight-progress-label">
                              <span>{item.label}</span>
                              <strong>{item.count} kişi <em>•</em> {item.percent}%</strong>
                            </div>
                            <div className="insight-track">
                              <div className="insight-fill pink" style={{ width: `${item.percent}%`, animationDelay: `${i * 0.07 + 0.1}s` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <p className="insight-empty">Cinsiyet dağılımı için kabul edilmiş rezervasyon gerekiyor.</p>;
                  })()}

                  {customerInsightTab === "firstTimers" && (() => {
                    const list = getCustomerFrequencyList().filter(c => c.count === 1);
                    return (
                      <div>
                        <div className="insight-section-title">🌟 İlk Kez Gelenler <span className="insight-count-badge">{list.length}</span></div>
                        {list.length > 0 ? list.map((c, i) => (
                          <div className="insight-customer-row" key={c.email} style={{ animationDelay: `${i * 0.06}s` }}>
                            <div className="insight-avatar">{c.name[0].toUpperCase()}</div>
                            <div>
                              <strong>{c.name}</strong>
                              <p>{c.email}</p>
                            </div>
                            <span className="insight-badge new">İlk ziyaret</span>
                          </div>
                        )) : <p className="insight-empty">İlk kez gelen müşteri verisi henüz yok.</p>}
                      </div>
                    );
                  })()}

                  {customerInsightTab === "topCustomers" && (() => {
                    const list = getCustomerFrequencyList().filter(c => c.count > 1);
                    const maxCount = list[0]?.count || 1;
                    return (
                      <div>
                        <div className="insight-section-title">🏆 En Çok Gelenler <span className="insight-count-badge">{list.length}</span></div>
                        {list.length > 0 ? list.map((c, i) => (
                          <div className="insight-vip-row" key={c.email} style={{ animationDelay: `${i * 0.07}s` }}>
                            <div className="insight-rank">#{i + 1}</div>
                            <div className="insight-vip-info">
                              <div className="insight-progress-label">
                                <span>{c.name}</span>
                                <strong>{c.count} ziyaret</strong>
                              </div>
                              <div className="insight-track">
                                <div className="insight-fill gold" style={{ width: `${Math.round(c.count/maxCount*100)}%`, animationDelay: `${i * 0.07 + 0.1}s` }} />
                              </div>
                            </div>
                          </div>
                        )) : <p className="insight-empty">Tekrar gelen müşteri verisi henüz yok.</p>}
                      </div>
                    );
                  })()}

                  {customerInsightTab === "smoking" && (() => {
                    const list = getDistributionList("smoking");
                    return list.length > 0 ? (
                      <div>
                        <div className="insight-section-title">🚬 Sigara İçme Dağılımı</div>
                        {list.map((item, i) => (
                          <div className="insight-progress-row" key={item.label} style={{ animationDelay: `${i * 0.07}s` }}>
                            <div className="insight-progress-label">
                              <span>{item.label}</span>
                              <strong>{item.count} kişi <em>•</em> {item.percent}%</strong>
                            </div>
                            <div className="insight-track">
                              <div className="insight-fill orange" style={{ width: `${item.percent}%`, animationDelay: `${i * 0.07 + 0.1}s` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <p className="insight-empty">Sigara dağılımı için kabul edilmiş rezervasyon gerekiyor.</p>;
                  })()}

                  {customerInsightTab === "busyDays" && (() => {
                    const list = getBusyDaysList();
                    const max = list[0]?.count || 1;
                    return list.length > 0 ? (
                      <div>
                        <div className="insight-section-title">📅 En Yoğun Günler</div>
                        {list.map((item, i) => (
                          <div className="insight-progress-row" key={item.day} style={{ animationDelay: `${i * 0.07}s` }}>
                            <div className="insight-progress-label">
                              <span>{item.day}</span>
                              <strong>{item.count} rezervasyon</strong>
                            </div>
                            <div className="insight-track">
                              <div className="insight-fill green" style={{ width: `${Math.round(item.count/max*100)}%`, animationDelay: `${i * 0.07 + 0.1}s` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <p className="insight-empty">Yoğun gün verisi için kabul edilmiş rezervasyon gerekiyor.</p>;
                  })()}

                  {customerInsightTab === "busyHours" && (() => {
                    const list = getBusyHoursList();
                    const max = list[0]?.count || 1;
                    return list.length > 0 ? (
                      <div>
                        <div className="insight-section-title">🕐 En Yoğun Saatler</div>
                        {list.map((item, i) => (
                          <div className="insight-progress-row" key={item.time} style={{ animationDelay: `${i * 0.07}s` }}>
                            <div className="insight-progress-label">
                              <span>🕐 {item.time}</span>
                              <strong>{item.count} rezervasyon</strong>
                            </div>
                            <div className="insight-track">
                              <div className="insight-fill purple" style={{ width: `${Math.round(item.count/max*100)}%`, animationDelay: `${i * 0.07 + 0.1}s` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <p className="insight-empty">Yoğun saat verisi için kabul edilmiş rezervasyon gerekiyor.</p>;
                  })()}
                </div>
              </div>
            )}
          </div>}
        </section>
      )}

      {page === "businessProfile" && selectedBusiness && (() => {
        const todayKey = new Date().toLocaleDateString("en-US", { weekday: "long" });
        const nowMins  = new Date().getHours() * 60 + new Date().getMinutes();
        const toMins   = s => { const [h,m]=(s||"00:00").split(":").map(Number); return (h||0)*60+(m||0); };
        const calcOpen = (o,c,now) => { let om=toMins(o),cm=toMins(c); if(cm===0)cm=1440; return cm<=om?now>=om||now<cm:now>=om&&now<cm; };
        const todayH   = (selectedBusiness.businessHours || {})[todayKey];
        const isOpen   = todayH?.open && todayH?.close ? calcOpen(todayH.open, todayH.close, nowMins) : null;
        const days = [
          {key:"Monday",label:"Pazartesi"},{key:"Tuesday",label:"Salı"},
          {key:"Wednesday",label:"Çarşamba"},{key:"Thursday",label:"Perşembe"},
          {key:"Friday",label:"Cuma"},{key:"Saturday",label:"Cumartesi"},{key:"Sunday",label:"Pazar"},
        ];
        const hours = selectedBusiness.businessHours || {};
        const hasHours = days.some(d => hours[d.key]?.open);
        const tabs = [
          { key:"about", label:"Hakkında",  show: !!selectedBusiness.description },
          { key:"menu",  label:"Menü",      show: !!selectedBusiness.menu },
          { key:"hours", label:"Çalışma Saatleri", show: hasHours },
        ].filter(t => t.show);
        const activeTab = tabs.find(t=>t.key===bizProfileTab) ? bizProfileTab : (tabs[0]?.key || "about");

        return (
          <section className="biz-profile-page">
            <button className="back-btn" onClick={() => setPage("businesses")}>← Geri</button>

            {/* HERO */}
            <div className="bpro-hero">
              <div className="bpro-hero-bg" style={{
                background: selectedBusiness.logoUrl
                  ? `linear-gradient(180deg,rgba(30,10,80,0.5) 0%,rgba(20,5,60,0.85) 100%), url(${selectedBusiness.logoUrl}) center/cover`
                  : "linear-gradient(135deg,#3b1fa8,#7c3aed,#a855f7)"
              }} />
              {/* Favori */}
              <button className="bpro-fav-btn"
                onClick={e => { e.stopPropagation(); toggleFavorite(selectedBusiness); }}>
                <svg width="18" height="18" viewBox="0 0 24 24"
                  fill={favorites.some(f=>f.id===selectedBusiness.id)?"currentColor":"none"}
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
                </svg>
              </button>
              <div className="bpro-hero-content">
                {/* Logo */}
                <div className="bpro-logo">
                  {selectedBusiness.logoUrl
                    ? <img src={selectedBusiness.logoUrl} alt={selectedBusiness.name}/>
                    : <span>{selectedBusiness.icon||"🏠"}</span>}
                </div>
                {/* Info */}
                <div className="bpro-hero-info">
                  <h1 className="bpro-name">{selectedBusiness.name}</h1>
                  <div className="bpro-type-row">
                    <span className="bpro-type-chip">{selectedBusiness.type}</span>
                    {isOpen===true  && <span className="bpro-status open">● Açık</span>}
                    {isOpen===false && <span className="bpro-status closed">● Kapalı</span>}
                  </div>
                  <div className="bpro-contact-row">
                    {selectedBusiness.location && (
                      <a className="bpro-contact-item"
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedBusiness.name+" "+selectedBusiness.location)}`}
                        target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>
                        📍 {selectedBusiness.location}
                      </a>
                    )}
                    {selectedBusiness.phone && (
                      <a className="bpro-contact-item" href={`tel:${selectedBusiness.phone}`}>
                        📞 {selectedBusiness.phone}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* INFO BAR: puan + açık/kapalı */}
            <div className="bpro-infobar">
              <div className="bpro-ib-item">
                <span className="bpro-ib-icon">⭐</span>
                <div>
                  <div className="bpro-ib-val">—</div>
                  <div className="bpro-ib-sub">Puan</div>
                </div>
              </div>
              <div className="bpro-ib-div"/>
              <div className="bpro-ib-item">
                <span className="bpro-ib-icon" style={{color: isOpen===true?"#22c55e":isOpen===false?"#ef4444":"#a1a1aa"}}>🕐</span>
                <div>
                  <div className={`bpro-ib-val${isOpen===true?" green":isOpen===false?" red":""}`}>
                    {isOpen===true ? "Açık" : isOpen===false ? "Kapalı" : "—"}
                  </div>
                  <div className="bpro-ib-sub">
                    {todayH?.close && isOpen===true ? `${todayH.close}'de kapanıyor` :
                     todayH?.open  && isOpen===false ? `${todayH.open}'de açılıyor` : "Saat yok"}
                  </div>
                </div>
              </div>
            </div>

            {/* CTA BUTTONS */}
            <div className="bpro-cta-row">
              {selectedBusiness.reservationActive ? (
                <button className="primary-btn bpro-cta-main" onClick={()=>openReservationForm(selectedBusiness)}>
                  📋 Rezervasyon Yap
                </button>
              ) : (
                <div className="biz-closed-notice">
                  <span className="bcn-icon">📋</span>
                  <div><div className="bcn-title">Rezervasyon şu an kapalı</div><div className="bcn-sub">Bu işletme şu an rezervasyon kabul etmiyor.</div></div>
                </div>
              )}
              {selectedBusiness.meetingEnabled && selectedBusiness.meetingDates?.length > 0 ? (
                <button className="secondary-btn bpro-cta-sec" onClick={()=>{
                  setMeetingFormBusiness(selectedBusiness);
                  setMeetingForm({fullName:loggedCustomer?.name||"",email:loggedCustomer?.email||"",phone:"",company:"",reason:"is_gorusmesi",productCategory:"",date:"",time:"",note:""});
                  setMeetingTermsChecked({biz:false,rp:false});
                  setMeetingFormError("");
                  setPage("meetingRequest");
                }}>📅 Randevu Talep Et</button>
              ) : !selectedBusiness.meetingEnabled ? (
                <div className="biz-closed-notice" style={{marginTop:8}}>
                  <span className="bcn-icon">📅</span>
                  <div><div className="bcn-title">Randevu şu an kapalı</div></div>
                </div>
              ) : null}
            </div>

            {/* SEKMELER */}
            {tabs.length > 0 && (
              <>
                <div className="bpro-tabs">
                  {tabs.map(tab => (
                    <button key={tab.key}
                      className={`bpro-tab${activeTab===tab.key?" active":""}`}
                      onClick={()=>setBizProfileTab(tab.key)}>
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="bpro-tab-content">
                  {/* Hakkımızda */}
                  {activeTab==="about" && selectedBusiness.description && (
                    <p className="bpro-sec-text">{selectedBusiness.description}</p>
                  )}

                  {/* Menü */}
                  {activeTab==="menu" && selectedBusiness.menu && (
                    selectedBusiness.menu.startsWith("http")
                      ? <a href={selectedBusiness.menu} target="_blank" rel="noopener noreferrer" className="bpro-menu-link">
                          Menüyü Görüntüle
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        </a>
                      : <p className="bpro-sec-text">{selectedBusiness.menu}</p>
                  )}

                  {/* Çalışma Saatleri */}
                  {activeTab==="hours" && (
                    <div className="bpro-hours-list">
                      {days.map(({key,label}) => {
                        const h = hours[key];
                        const isToday = key===todayKey;
                        const hasH = h?.open && h?.close;
                        const open = hasH && calcOpen(h.open,h.close,nowMins);
                        return (
                          <div key={key} className={`bpro-hours-row${isToday?" today":""}${!hasH?" closed":""}`}>
                            <span className="bpro-hr-day">{label}</span>
                            <span className="bpro-hr-time">{hasH?`${h.open} – ${h.close}`:"Kapalı"}</span>
                            {isToday && <span className={`bpro-hr-now${open?" open":" closed"}`}>{open?"Açık":"Kapalı"}</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        );
      })()}

      {page === "meetingRequest" && meetingFormBusiness && (
        <section className="reservation-section">
          <div className="reservation-box">
            <button className="back-btn" style={{ marginBottom: 12 }} onClick={() => { setPage("businessProfile"); }}>{t.meeting.back}</button>
            <h1>{t.meeting.title}</h1>
            <p className="description">{t.meeting.subtitle(meetingFormBusiness.name)}</p>

            <form className="reservation-form">
              {loggedCustomer ? (
                <div className="rez-info-row">
                  <div className="rez-info-item">
                    <span className="rez-info-label">{t.meeting.nameLabel}</span>
                    <span className="rez-info-value">{loggedCustomer.name}</span>
                  </div>
                  <div className="rez-info-item">
                    <span className="rez-info-label">{t.meeting.emailLabel}</span>
                    <span className="rez-info-value">{loggedCustomer.email}</span>
                  </div>
                </div>
              ) : (
                <div style={{ background: "rgba(109,40,217,0.05)", border: "1px dashed rgba(109,40,217,0.25)", borderRadius: 10, padding: "10px 14px", marginBottom: 4, fontSize: 13, color: "#6b7280" }}>
                  {t.meeting.loginHint}
                </div>
              )}
              <input type="tel" placeholder={t.meeting.phonePlaceholder} value={meetingForm.phone} onChange={e => setMeetingForm(p => ({ ...p, phone: e.target.value }))} />
              <input type="text" placeholder={t.meeting.companyPlaceholder} value={meetingForm.company} onChange={e => setMeetingForm(p => ({ ...p, company: e.target.value }))} />
              <select value={meetingForm.reason} onChange={e => setMeetingForm(p => ({ ...p, reason: e.target.value, productCategory: "" }))}>
                {Object.entries(t.meeting.reasons).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>

              {meetingForm.reason === "urun_tanitimi" && (
                <select
                  value={meetingForm.productCategory}
                  onChange={e => setMeetingForm(p => ({ ...p, productCategory: e.target.value }))}
                  style={{ borderColor: meetingForm.productCategory ? "rgba(124,58,237,0.4)" : "rgba(239,68,68,0.35)" }}
                >
                  <option value="">📂 {lang === "en" ? "Select product category" : "Ürün kategorisi seçin"}</option>
                  {[
                    ["icecek",       "🥤 İçecek"],
                    ["yiyecek",      "🍽️ Yiyecek & Gıda"],
                    ["alkol_sigara", "🍷 Alkol & Sigara"],
                    ["hijen",        "🧴 Hijyen & Bakım"],
                    ["gunluk",       "🧹 Günlük Kullanım"],
                    ["giyim",        "👗 Giyim & Tekstil"],
                    ["teknoloji",    "💻 Teknoloji & Elektronik"],
                    ["ev_yasam",     "🏠 Ev & Yaşam"],
                    ["kozmetik",     "💄 Kozmetik & Güzellik"],
                    ["spor",         "🏋️ Spor & Outdoor"],
                    ["cocuk",        "🧸 Çocuk Ürünleri"],
                    ["ofis",         "📎 Ofis & Kırtasiye"],
                    ["diger",        "📦 Diğer"],
                  ].map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              )}

              <div className="date-time-row">
                <div className="strip-section">
                  <div className="strip-label">{t.meeting.dateLabel}</div>
                  <div className="strip-scroll-wrap">
                    <button type="button" className="strip-arrow" onClick={() => meetingDateRef.current?.scrollBy({ left: -160, behavior: "smooth" })}>‹</button>
                    <div className="date-strip" ref={meetingDateRef}>
                      {(() => {
                        const todayMs = new Date().setHours(0,0,0,0);
                        const locale = lang === "en" ? "en-GB" : "tr-TR";
                        return (meetingFormBusiness.meetingDates || [])
                          .filter(d => new Date(d + "T00:00:00").getTime() >= todayMs)
                          .sort()
                          .map(d => {
                            const parsed = new Date(d + "T00:00:00");
                            return (
                              <button key={d} type="button"
                                className={meetingForm.date === d ? "strip-btn active" : "strip-btn"}
                                onClick={async () => {
                                  setMeetingForm(p => ({ ...p, date: d, time: "" }));
                                  setAvailableSlotsForDate(null);
                                  const { data: slots } = await supabase.rpc("get_available_meeting_slots", {
                                    p_business_id: meetingFormBusiness.id,
                                    p_date: d,
                                  });
                                  setAvailableSlotsForDate(slots ? slots.split(",").filter(Boolean) : []);
                                }}>
                                <span className="strip-day">{parsed.toLocaleDateString(locale, { weekday: "short" })}</span>
                                <span className="strip-date">{parsed.toLocaleDateString(locale, { day: "2-digit", month: "short" })}</span>
                              </button>
                            );
                          });
                      })()}
                    </div>
                    <button type="button" className="strip-arrow" onClick={() => meetingDateRef.current?.scrollBy({ left: 160, behavior: "smooth" })}>›</button>
                  </div>
                </div>

                <div className="strip-section">
                  <div className="strip-label">{t.meeting.timeLabel}</div>
                  <div className="strip-scroll-wrap">
                    <button type="button" className="strip-arrow" onClick={() => meetingTimeRef.current?.scrollBy({ left: -160, behavior: "smooth" })}>‹</button>
                    <div className="time-strip" ref={meetingTimeRef}>
                      {availableSlotsForDate !== null ? (
                        availableSlotsForDate.length === 0 ? (
                          <span style={{ padding: "8px 12px", color: "#9ca3af", fontSize: 13 }}>{t.meeting.noSlotsForDate}</span>
                        ) : availableSlotsForDate.map(time => (
                          <button key={time} type="button"
                            className={meetingForm.time === time ? "strip-btn active" : "strip-btn"}
                            onClick={() => setMeetingForm(p => ({ ...p, time }))}>
                            {time}
                          </button>
                        ))
                      ) : (meetingFormBusiness.meetingTimes || []).map(time => (
                        <button key={time} type="button"
                          className={meetingForm.time === time ? "strip-btn active" : "strip-btn"}
                          onClick={() => setMeetingForm(p => ({ ...p, time }))}>
                          {time}
                        </button>
                      ))}
                    </div>
                    <button type="button" className="strip-arrow" onClick={() => meetingTimeRef.current?.scrollBy({ left: 160, behavior: "smooth" })}>›</button>
                  </div>
                </div>
              </div>

              <textarea placeholder={t.meeting.notePlaceholder} value={meetingForm.note} onChange={e => setMeetingForm(p => ({ ...p, note: e.target.value }))} />

              {meetingFormError && <p className="error-message">{meetingFormError}</p>}

              <div className="rez-terms-checks">
                <label className="rez-terms-label">
                  <input type="checkbox" checked={meetingTermsChecked.biz} onChange={e => setMeetingTermsChecked(p => ({ ...p, biz: e.target.checked }))} />
                  <span className="rez-check-box">{meetingTermsChecked.biz ? "✓" : ""}</span>
                  <span><button type="button" className="terms-link" onClick={() => setTermsModal("biz")}>{t.meeting.bizTerms}</button>{t.meeting.termsAccept}</span>
                </label>
                <label className="rez-terms-label">
                  <input type="checkbox" checked={meetingTermsChecked.rp} onChange={e => setMeetingTermsChecked(p => ({ ...p, rp: e.target.checked }))} />
                  <span className="rez-check-box">{meetingTermsChecked.rp ? "✓" : ""}</span>
                  <span><button type="button" className="terms-link" onClick={() => setTermsModal("rp")}>{t.meeting.rpTerms}</button>{t.meeting.termsAccept}</span>
                </label>
              </div>

              {(() => {
                const catOk = meetingForm.reason !== "urun_tanitimi" || !!meetingForm.productCategory;
                // Giriş yapılmamışsa ad/email henüz yok — login sonrası gelecek, kontrol etme
                const fieldsOk = loggedCustomer
                  ? (!!meetingForm.fullName && !!meetingForm.email && !!meetingForm.phone && !!meetingForm.date && !!meetingForm.time && catOk && meetingTermsChecked.biz && meetingTermsChecked.rp)
                  : (!!meetingForm.phone && !!meetingForm.date && !!meetingForm.time && catOk && meetingTermsChecked.biz && meetingTermsChecked.rp);
                const isDisabled = !fieldsOk || isSendingMeeting;

                return (
                  <button
                    type="button"
                    className="primary-btn"
                    style={{ width: "100%", marginTop: 4, opacity: isDisabled ? 0.45 : 1 }}
                    disabled={isDisabled}
                    onClick={async () => {
                      setMeetingFormError("");
                      if (!loggedCustomer) {
                        setAfterLoginReturnPage("meetingRequest");
                        setCustomerMode("login");
                        setPage("customerAuth");
                        return;
                      }
                      setIsSendingMeeting(true);
                      const code = "MT-" + Math.floor(10000 + Math.random() * 90000);
                      const { data: inserted, error } = await supabase.from("meetings").insert([{
                        business_id: meetingFormBusiness.id,
                        business_name: meetingFormBusiness.name,
                        full_name: meetingForm.fullName,
                        email: meetingForm.email,
                        phone: meetingForm.phone,
                        company_name: meetingForm.company || null,
                        reason: meetingForm.reason,
                        date: meetingForm.date,
                        time: meetingForm.time,
                        note: meetingForm.reason === "urun_tanitimi" && meetingForm.productCategory
                          ? `[Kategori: ${meetingForm.productCategory}]${meetingForm.note ? " " + meetingForm.note : ""}`
                          : meetingForm.note || null,
                        status: "pending",
                        code,
                      }]).select().single();
                      setIsSendingMeeting(false);
                      if (error) { setMeetingFormError((lang === "en" ? "Could not send: " : "Gönderilemedi: ") + error.message); return; }
                      setMeetings(prev => [...prev, {
                        id: inserted.id, businessId: meetingFormBusiness.id, businessName: meetingFormBusiness.name,
                        fullName: meetingForm.fullName, email: meetingForm.email, phone: meetingForm.phone,
                        company: meetingForm.company || "", reason: meetingForm.reason,
                        date: meetingForm.date, time: meetingForm.time, note: meetingForm.note || "",
                        status: "pending", code, createdAt: inserted.created_at || new Date().toISOString()
                      }]);
                      sendPush({ userType: "business", userId: String(meetingFormBusiness?.id), title: "📅 Yeni Randevu Talebi", body: `${meetingForm.fullName || "Misafir"} randevu talebi gönderdi · ${meetingForm.date} ${meetingForm.time}`, url: "/" });
                      setPage("meetingSuccess");
                    }}
                  >
                    {isSendingMeeting
                      ? t.meeting.sending
                      : loggedCustomer
                        ? t.meeting.submitBtn
                        : (lang === "en" ? "Log in & Send Request" : "Giriş Yap & Randevu İste")}
                  </button>
                );
              })()}

              {termsModal && (
                <div className="terms-modal-overlay" onClick={() => setTermsModal(null)}>
                  <div className="terms-modal" onClick={e => e.stopPropagation()}>
                    <h3>{termsModal === "biz" ? `${meetingFormBusiness?.name} — Koşullar` : "RezPoint Kullanım Koşulları"}</h3>
                    <div className="terms-modal-body">{termsModal === "biz" ? (meetingFormBusiness?.terms || "Bu işletme henüz koşul belirlememiş.") : (rpTerms || "Henüz koşul eklenmemiş.")}</div>
                    <button type="button" className="primary-btn" style={{ marginTop: 16 }} onClick={() => setTermsModal(null)}>{t.common.close}</button>
                  </div>
                </div>
              )}
            </form>
          </div>
        </section>
      )}

      {page === "meetingSuccess" && (
        <section className="reservation-section">
          <div className="reservation-box" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>📅</div>
            <h1>{t.meeting.successTitle}</h1>
            <p className="description">{t.meeting.successDesc}</p>
            <button className="primary-btn" style={{ marginTop: 20 }} onClick={() => { setPage("customerDashboard"); setCustomerTab("meetings"); }}>{t.meeting.goToMeetings}</button>
          </div>
        </section>
      )}

      {selectedReservation && (
        <div className="popup-overlay" onClick={() => setSelectedReservation(null)}>
          <div className="popup-box" onClick={e => e.stopPropagation()} style={{ padding: "28px 28px 24px" }}>

            {/* Başlık + gönderilme zamanı */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "#1a1a2e" }}>{t.popup.reservationTitle}</h2>
              {selectedReservation.createdAt && (
                <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 500, lineHeight: 1.4, textAlign: "right" }}>
                  {t.popup.sentAt}<br/>
                  <strong style={{ color: "#6b7280" }}>
                    {(() => { const locale = lang === "en" ? "en-GB" : "tr-TR"; const d = new Date(selectedReservation.createdAt); return `${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })} ${d.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" })}`; })()}
                  </strong>
                </span>
              )}
            </div>

            {/* İsim + iletişim */}
            <div style={{ textAlign: "center", marginBottom: 18 }}>
              <div style={{ fontSize: "1.45rem", fontWeight: 800, color: "#1a1a2e", marginBottom: 5 }}>
                {selectedReservation.fullName}
              </div>
              <div style={{ fontSize: 13, color: "#6b7280", display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
                <span>{selectedReservation.email}</span>
                <span>·</span>
                <span>{selectedReservation.phone}</span>
              </div>
            </div>

            {/* Önemli bilgi chipler: tarih, saat, kişi sayısı */}
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 20 }}>
              <span style={{ background: "rgba(109,40,217,0.12)", color: "#5b21b6", borderRadius: 12, padding: "9px 16px", fontWeight: 700, fontSize: "0.85rem" }}>
                📅 {formatDate(selectedReservation.date)}
              </span>
              <span style={{ background: "rgba(109,40,217,0.12)", color: "#5b21b6", borderRadius: 12, padding: "9px 16px", fontWeight: 700, fontSize: "0.85rem" }}>
                🕐 {selectedReservation.time}
              </span>
              <span style={{ background: "rgba(34,197,94,0.12)", color: "#166534", borderRadius: 12, padding: "9px 16px", fontWeight: 700, fontSize: "0.85rem" }}>
                👥 {t.common.persons(selectedReservation.guests)}
              </span>
            </div>

            <hr style={{ border: "none", borderTop: "1px solid rgba(109,40,217,0.08)", margin: "0 0 16px" }} />

            {/* Durum badge */}
            {(() => {
              const s = selectedReservation.status;
              const map = {
                pending: { bg: "rgba(234,179,8,0.1)", color: "#854d0e", label: t.status.pending },
                accepted: { bg: "rgba(34,197,94,0.1)", color: "#166534", label: t.status.accepted },
                rejected: { bg: "rgba(239,68,68,0.1)", color: "#7f1d1d", label: t.status.rejected },
                completed: { bg: "rgba(109,40,217,0.1)", color: "#4c1d95", label: t.status.completed },
              };
              const st = map[s] || map.pending;
              return (
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
                  <span style={{ background: st.bg, color: st.color, borderRadius: 8, padding: "5px 18px", fontWeight: 700, fontSize: "0.85rem" }}>
                    {st.label}
                  </span>
                </div>
              );
            })()}

            {/* Güven puanı + kod */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <div style={{ flex: 1, background: "rgba(0,0,0,0.03)", borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>{t.popup.fieldSafeScore}</div>
                <div style={{ fontWeight: 700, color: "#1a1a2e" }}>{selectedReservation.safeScore ?? 100}/100</div>
              </div>
              <div style={{ flex: 1, background: "rgba(0,0,0,0.03)", borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>{t.popup.fieldCode}</div>
                <div style={{ fontWeight: 700, color: "#7c3aed" }}>{selectedReservation.code}</div>
              </div>
            </div>

            {/* Profil bilgileri */}
            <div style={{ background: "rgba(0,0,0,0.025)", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
                {[
                  [t.popup.fieldGender, selectedReservation.customerProfile?.gender],
                  [t.popup.fieldBirth, selectedReservation.customerProfile?.birthDate],
                  [t.popup.fieldJob, selectedReservation.customerProfile?.job],
                  [t.popup.fieldSmoking, selectedReservation.customerProfile?.smoking],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 1 }}>{k}</div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "#374151" }}>{v || t.common.notSpecified}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Not */}
            {selectedReservation.note && (
              <div style={{ background: "rgba(109,40,217,0.04)", border: "1px solid rgba(109,40,217,0.1)", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#374151" }}>
                <span style={{ fontWeight: 600, color: "#6d28d9" }}>Not: </span>
                {selectedReservation.note}
              </div>
            )}

            <button className="primary-btn" style={{ marginTop: 8, width: "100%" }} onClick={() => setSelectedReservation(null)}>
              {t.popup.close}
            </button>
          </div>
        </div>
      )}

      {/* ── Favoriler paneli ── */}
      {showFavPanel && (
        <div className="bn-notif-overlay" onClick={() => setShowFavPanel(false)}>
          <div className="bn-notif-panel" onClick={e => e.stopPropagation()}>
            <div className="bn-notif-header">
              <span className="bn-notif-title">❤️ {lang === "en" ? "Favorites" : "Favorilerim"}</span>
              <button className="bn-notif-close" onClick={() => setShowFavPanel(false)}>✕</button>
            </div>
            <div className="bn-notif-body">
              {favorites.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>💔</div>
                  <p className="description">{lang === "en" ? "No favorites yet. Tap ♡ on a venue to save it." : "Henüz favori yok. Bir işletmede ♡ simgesine bas."}</p>
                </div>
              ) : favorites.map(fav => {
                const fullBiz = adminBusinesses.find(b => b.id === fav.id) || fav;
                return (
                  <div key={fav.id} className="fav-row" onClick={() => { setSelectedBusiness(fullBiz); setPage("businessProfile"); setShowFavPanel(false); }}>
                    <div className="fav-photo">
                      {fav.logoUrl ? <img src={fav.logoUrl} alt={fav.name} /> : <span>{fav.icon || "🏠"}</span>}
                    </div>
                    <div className="fav-info">
                      <div className="fav-name">{fav.name}</div>
                      <div className="fav-meta">{fav.type}{fav.location ? ` · ${fav.location}` : ""}</div>
                    </div>
                    <button className="fav-remove" onClick={e => { e.stopPropagation(); toggleFavorite(fav); }} aria-label="Kaldır">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Bildirim paneli (bottom nav'dan açılır) ── */}
      {showNotifPanel && (
        <div className="bn-notif-overlay" onClick={() => setShowNotifPanel(false)}>
          <div className="bn-notif-panel" onClick={e => e.stopPropagation()}>
            <div className="bn-notif-header">
              <span className="bn-notif-title">
                {lang === "en" ? "Notifications" : "Bildirimler"}
                {loggedCustomer && customerNotifications.filter(n => !n.is_read).length > 0 && (
                  <span className="notif-count">{customerNotifications.filter(n => !n.is_read).length}</span>
                )}
              </span>
              <button className="bn-notif-close" onClick={() => setShowNotifPanel(false)}>✕</button>
            </div>
            <div className="bn-notif-body">
              {!loggedCustomer ? (
                <div style={{ padding: "32px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🔔</div>
                  <p className="description" style={{ marginBottom: 16 }}>
                    {lang === "en" ? "Log in to see your notifications." : "Bildirimlerinizi görmek için giriş yapın."}
                  </p>
                  <button className="primary-btn" onClick={() => { setShowNotifPanel(false); setPage("customerAuth"); }}>
                    {lang === "en" ? "Log In" : "Giriş Yap"}
                  </button>
                </div>
              ) : customerNotifications.length === 0 ? (
                <p className="description" style={{ padding: "32px 16px", textAlign: "center" }}>
                  {lang === "en" ? "No notifications yet." : "Henüz bildirim yok."}
                </p>
              ) : (
                customerNotifications.map(notif => (
                  <div
                    key={notif.id}
                    className={`notif-row${notif.is_read ? "" : " unread"}`}
                    onClick={async () => {
                      if (!notif.is_read) {
                        await supabase.from("notifications").update({ is_read: true }).eq("id", notif.id);
                        setCustomerNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
                      }
                    }}
                  >
                    {!notif.is_read && <span className="notif-dot" />}
                    <div className="notif-body">
                      <div className="notif-title">{notif.title}</div>
                      {notif.message && <div className="notif-message">{notif.message}</div>}
                      <div className="notif-time">
                        {new Date(notif.created_at).toLocaleDateString("tr-TR", { day:"2-digit", month:"long", hour:"2-digit", minute:"2-digit" })}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Alt navigation bar (mobile) ── */}
      {(() => {
        /* Hangi tab aktif — paneller açıkken sayfa-bazlı active'i ezer */
        const bnActive = showFavPanel ? "fav"
          : showNotifPanel ? "notif"
          : page === "home" ? "home"
          : (page === "customerDashboard" && customerTab === "reservations") ? "rez"
          : (page === "customerDashboard" || page === "customerAuth") ? "profile"
          : "home";

        const closeAll = () => {
          setShowFavPanel(false);
          setShowNotifPanel(false);
          setMobileMenuOpen(false);
          setShowWhatsNew(false);
        };

        return (
          <nav className="bottom-nav">
            {/* Ana Sayfa */}
            <button
              className={`bn-item${bnActive === "home" ? " active" : ""}`}
              onClick={() => { closeAll(); setPage("home"); }}
            >
              <svg className="bn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              <span>{lang === "en" ? "Home" : "Ana Sayfa"}</span>
            </button>

            {/* Rezervasyonlarım / Gelen İstekler */}
            <button
              className={`bn-item${bnActive === "rez" ? " active" : ""}`}
              onClick={() => {
                closeAll();
                if (loggedBusiness) { setPanelTab("incoming"); setPage("businessPanel"); }
                else if (loggedCustomer) { setCustomerTab("reservations"); setPage("customerDashboard"); }
                else { setAfterLoginReturnPage("customerDashboard"); setCustomerMode("login"); setPage("customerAuth"); }
              }}
            >
              <svg className="bn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              <span>{loggedBusiness ? (lang === "en" ? "Requests" : "İstekler") : (lang === "en" ? "Reservations" : "Rezervasyon")}</span>
            </button>

            {/* Favoriler — sadece müşteride göster */}
            {!loggedBusiness && (
            <button
              className={`bn-item${bnActive === "fav" ? " active" : ""}`}
              onClick={() => {
                const opening = !showFavPanel;
                closeAll();
                if (opening) setShowFavPanel(true);
              }}
            >
              <svg className="bn-icon" viewBox="0 0 24 24" fill={bnActive === "fav" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
              </svg>
              <span>{lang === "en" ? "Favorites" : "Favoriler"}</span>
            </button>
            )}

            {/* Bildirimler */}
            <button
              className={`bn-item${bnActive === "notif" ? " active" : ""}${loggedCustomer && customerNotifications.filter(n => !n.is_read).length > 0 ? " bn-dot" : ""}`}
              onClick={() => {
                closeAll();
                if (loggedBusiness) { setPage("businessPanel"); setPanelTab("incoming"); }
                else {
                  const opening = !showNotifPanel;
                  if (opening) setShowNotifPanel(true);
                }
              }}
            >
              <svg className="bn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
              </svg>
              <span>{lang === "en" ? "Alerts" : "Bildirimler"}</span>
            </button>

            {/* Profil */}
            <button
              className={`bn-item${bnActive === "profile" ? " active" : ""}`}
              onClick={() => {
                closeAll();
                if (loggedBusiness) { setPage("businessPanel"); }
                else if (loggedCustomer) { setCustomerTab("account"); setPage("customerDashboard"); }
                else { setCustomerMode("login"); setPage("customerAuth"); }
              }}
            >
              <svg className="bn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
              <span>{loggedBusiness ? (lang === "en" ? "My Business" : "İşletmem") : (lang === "en" ? "Profile" : "Profil")}</span>
            </button>
          </nav>
        );
      })()}
    </div>
  );
}

export default App;
