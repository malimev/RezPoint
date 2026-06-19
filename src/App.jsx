
import { useState, useEffect, useRef } from "react";
import "./App.css";
import logo from "./assets/logo.png";
import { supabase } from "./supabaseClient";
import translations from "./i18n";

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
    await supabase.from("push_subscriptions").upsert({
      endpoint,
      p256dh:     keys.p256dh,
      auth:       keys.auth,
      user_email: userEmail || null,
      user_type:  userType  || null,
      user_id:    userId    ? String(userId) : null,
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

const SAFE_PAGES = ["home","businesses","contact","customerAuth","businessLogin","adminLogin","businessProfile"];
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
    closingPin: b.closing_pin || "",
    meetingTimes: b.meeting_times ? b.meeting_times.split(",") : [],
    meetingDates: b.meeting_dates ? b.meeting_dates.split(",") : [],
    rating: b.rating || 0,
    businessHours: b.business_hours || {},
  };
}

function App() {
  const [page, setPage] = useState(getSavedPage);
  const [appReady, setAppReady] = useState(false);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [error, setError] = useState("");
  const [loginError, setLoginError] = useState("");
  const [panelTab, setPanelTab] = useState(() => localStorage.getItem("rp_panel_tab") || "incoming");
  const [customerInsightTab, setCustomerInsightTab] = useState("age");
  const [customerTab, setCustomerTab] = useState(() => localStorage.getItem("rp_customer_tab") || "reservations");

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

  const [bizLoginAttempts, setBizLoginAttempts] = useState(0);
  const [bizLoginLocked, setBizLoginLocked] = useState(false);
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
  // ---------------------------------------------------------------------
  /* ── Service Worker kaydı ── */
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
      navigator.serviceWorker.addEventListener("message", e => {
        if (e.data?.type === "NOTIFICATION_CLICK" && e.data.url) {
          window.location.href = e.data.url;
        }
      });
    }

    /* ── Install banner: tarayıcıda açıksa ve daha önce kapatılmamışsa göster ── */
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
          // Email doğrulama linkinden dönen kullanıcıyı dashboard'a yönlendir
          const savedPage = localStorage.getItem("rp_page") || "home";
          if (savedPage === "customerAuth") setPage("customerDashboard");
        }
      }

      // 2. Load businesses
      const { data: businessData, error: businessError } = await supabase
        .from("businesses")
        .select("*");
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
        restoredBusiness = formattedBusinesses.find(b => String(b.id) === String(savedBizId));
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
        }
      }

      // 4. Load reservations
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

      // 7. Load RezPoint terms
      const { data: rpTermsData } = await supabase.from("site_settings").select("value").eq("key", "rezpoint_terms").single();
      if (rpTermsData?.value) { setRpTerms(rpTermsData.value); setRpTermsEdit(rpTermsData.value); }

      setAppReady(true);
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

  useEffect(() => {
    if (page !== "home") return;
    const checkVisible = () => {
      document.querySelectorAll(".lp-animate").forEach(el => {
        const rect = el.getBoundingClientRect();
        const inView = rect.top < window.innerHeight - 20 && rect.bottom > 20;
        el.classList.toggle("lp-visible", inView);
      });
    };
    const timer = setTimeout(checkVisible, 100);
    window.addEventListener("scroll", checkVisible, { passive: true });
    const pageDiv = document.querySelector(".page");
    if (pageDiv) pageDiv.addEventListener("scroll", checkVisible, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", checkVisible);
      if (pageDiv) pageDiv.removeEventListener("scroll", checkVisible);
    };
  }, [page]);

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
    if (bizLoginLocked) return;

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
      const attempts = bizLoginAttempts + 1;
      setBizLoginAttempts(attempts);
      if (attempts >= 5) {
        setBizLoginLocked(true);
        setLoginError("Çok fazla hatalı deneme. Sayfayı yenileyin ve tekrar deneyin.");
      } else {
        setLoginError(`Hatalı e-posta veya şifre. (${attempts}/5)`);
      }
      return;
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
    setLoginError("");
    registerPush(business.email, "business", business.id);
    setBizLoginAttempts(0);
    setPanelTab("incoming");
    setPage("businessPanel");
  }

  async function handleAdminLogin() {
    if (adminLoginLocked) return;

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
      const attempts = adminLoginAttempts + 1;
      setAdminLoginAttempts(attempts);
      if (attempts >= 5) {
        setAdminLoginLocked(true);
        setAdminError("Çok fazla hatalı deneme. Sayfayı yenileyin ve tekrar deneyin.");
      } else {
        setAdminError(`Hatalı yönetici e-postası veya şifre. (${attempts}/5)`);
      }
      return;
    }

    setAdminError("");
    setAdminLoginAttempts(0);
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
    return (
      <div className="app-loading">
        <div className="app-loading-logo">
          <span className="app-loading-rp">R<span>P</span></span>
          <div className="app-loading-dots">
            <span /><span /><span />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">

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

        <button
          className="menu-button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          ☰
        </button>

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
              if (loggedCustomer) {
                setPage("customerDashboard");
              } else {
                setPage("customerAuth");
              }
              setMobileMenuOpen(false);
            }}
          >
            {loggedCustomer ? t.nav.myAccount : t.nav.customerLogin}
          </button>

          <button
            className="nav-button"
            onClick={() => {
              setPage("businessLogin");
              setMobileMenuOpen(false);
            }}
          >
            {t.nav.businessLogin}
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
        {/* ── OpenTable-style homepage ── */}
        <section className="ot-hero">
          <h1 className="ot-headline">{t.hero.headline}</h1>
          <p className="ot-subline">{t.hero.subheadline}</p>

          {/* Filter chips row */}
          <div className="ot-filter-row">
            <button
              className={`ot-chip${datePickerOpen ? " active" : ""}`}
              onClick={() => { setDatePickerOpen(p => !p); setTimePickerOpen(false); setLocationPickerOpen(false); }}
            >
              📅 {searchDate ? (() => { const d = new Date(searchDate + "T00:00:00"); return d.toLocaleDateString(lang === "en" ? "en-GB" : "tr-TR", { day: "numeric", month: "short" }); })() : (lang === "en" ? "Date" : "Tarih")}
              <span className="ot-chip-arrow">{datePickerOpen ? "▲" : "▼"}</span>
            </button>
            <button
              className={`ot-chip${timePickerOpen ? " active" : ""}`}
              onClick={() => { setTimePickerOpen(p => !p); setDatePickerOpen(false); setLocationPickerOpen(false); }}
            >
              🕐 {searchTime || (lang === "en" ? "Time" : "Saat")}
              <span className="ot-chip-arrow">{timePickerOpen ? "▲" : "▼"}</span>
            </button>
            <button
              className={`ot-chip${locationPickerOpen ? " active" : ""}`}
              onClick={() => { setLocationPickerOpen(p => !p); setDatePickerOpen(false); setTimePickerOpen(false); }}
            >
              📍 {searchLocation === "Hepsi" ? (lang === "en" ? "All locations" : "Tüm konumlar") : searchLocation}
              <span className="ot-chip-arrow">{locationPickerOpen ? "▲" : "▼"}</span>
            </button>
          </div>

          {/* Location picker dropdown */}
          {locationPickerOpen && (
            <div className="ot-picker-panel">
              <div className="ot-picker-label">{lang === "en" ? "Select location" : "Konum seç"}</div>
              <div className="ot-loc-options">
                {["Hepsi","Mağusa","İskele","Lefkoşa","Lefke","Girne"].map(loc => (
                  <button
                    key={loc}
                    className={`ot-loc-opt${searchLocation === loc ? " active" : ""}`}
                    onClick={() => { setSearchLocation(loc); setLocationPickerOpen(false); }}
                  >
                    {loc === "Hepsi" ? (lang === "en" ? "All locations" : "Tüm konumlar") : `📍 ${loc}`}
                  </button>
                ))}
              </div>
            </div>
          )}

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

          {/* Search row */}
          <div className="ot-search-row">
            <span className="ot-search-icon">🔍</span>
            <input
              className="ot-search-input"
              type="text"
              placeholder={t.businesses.searchPlaceholder}
              value={businessSearch}
              onChange={e => setBusinessSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && setPage("businesses")}
            />
            <button className="ot-search-btn" onClick={() => setPage("businesses")}>
              {lang === "en" ? "Let's go" : "Ara"}
            </button>
          </div>

        </section>

        {/* ── Şu an müsait mekanlar ── */}
        <section className="ot-section">
          <div className="ot-section-header">
            <h2 className="ot-section-title">{lang === "en" ? "Available now" : "Şu an müsait mekanlar"}</h2>
            <button className="ot-view-all" onClick={() => setPage("businesses")}>{lang === "en" ? "View all" : "Tümünü gör"} →</button>
          </div>
          <div className="ot-cards-scroll">
            {(() => {
              const now = new Date();
              const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
              const todayDayName = now.toLocaleDateString("en-US", { weekday: "long" });
              const nowMins = now.getHours() * 60 + now.getMinutes();
              const toMins = str => { const [h,m] = (str||"00:00").split(":").map(Number); return (h||0)*60+(m||0); };
              const available = adminBusinesses.filter(biz => {
                if (!biz.reservationActive) return false;
                if (searchLocation !== "Hepsi" && biz.location !== searchLocation) return false;
                // Gün kontrolü
                const dayOk = biz.availabilityMode === "specific"
                  ? (biz.specificDates || []).includes(todayStr)
                  : (biz.availableDays || []).includes(todayDayName);
                if (!dayOk) return false;
                // Saat kontrolü (businessHours tanımlıysa)
                const dayHours = (biz.businessHours || {})[todayDayName];
                if (dayHours && dayHours.open && dayHours.close) {
                  return nowMins >= toMins(dayHours.open) && nowMins < toMins(dayHours.close);
                }
                return true;
              });
              const shown = available.length > 0 ? available : adminBusinesses.filter(b => b.reservationActive && (searchLocation === "Hepsi" || b.location === searchLocation));
              return shown.slice(0, 8).map(biz => (
              <div className="ot-card" key={biz.id} onClick={() => { setSelectedBusiness(biz); setPage("businessProfile"); }}>
                <div className="ot-card-photo">
                  {biz.logoUrl
                    ? <img src={biz.logoUrl} alt={biz.name} />
                    : <div className="ot-card-photo-placeholder">{biz.icon || "🏠"}</div>
                  }
                </div>
                <div className="ot-card-body">
                  <div className="ot-card-name">{biz.name}</div>
                  <div className="ot-card-meta">{biz.type}{biz.location ? ` · ${biz.location}` : ""}</div>
                  <button className="ot-card-btn" onClick={e => { e.stopPropagation(); openReservationForm(biz); }}>
                    {lang === "en" ? "Find available" : "Rezervasyon yap"}
                  </button>
                </div>
              </div>
            ));})()}
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-section-header lp-animate">
            <h2>{t.landing.stepsTitle}</h2>
            <p>{t.landing.stepsSub}</p>
          </div>
          <div className="lp-steps-grid">
            <div className="lp-step lp-animate" style={{ transitionDelay: "0.05s" }}>
              <div className="lp-step-num">1</div>
              <div className="lp-step-icon">🔍</div>
              <h3>{t.landing.step1Title}</h3>
              <p>{t.landing.step1Desc}</p>
            </div>
            <div className="lp-step lp-animate" style={{ transitionDelay: "0.15s" }}>
              <div className="lp-step-num">2</div>
              <div className="lp-step-icon">📋</div>
              <h3>{t.landing.step2Title}</h3>
              <p>{t.landing.step2Desc}</p>
            </div>
            <div className="lp-step lp-animate" style={{ transitionDelay: "0.25s" }}>
              <div className="lp-step-num">3</div>
              <div className="lp-step-icon">✅</div>
              <h3>{t.landing.step3Title}</h3>
              <p>{t.landing.step3Desc}</p>
            </div>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-section-header lp-animate">
            <h2>{t.landing.whyTitle}</h2>
            <p>{t.landing.whySub}</p>
          </div>
          <div className="lp-features-grid">
            <div className="lp-feature lp-animate" style={{ transitionDelay: "0.05s" }}>
              <div className="lp-feature-icon">🛡️</div>
              <h3>{t.landing.feat1Title}</h3>
              <p>{t.landing.feat1Desc}</p>
            </div>
            <div className="lp-feature lp-animate" style={{ transitionDelay: "0.12s" }}>
              <div className="lp-feature-icon">⚡</div>
              <h3>{t.landing.feat2Title}</h3>
              <p>{t.landing.feat2Desc}</p>
            </div>
            <div className="lp-feature lp-animate" style={{ transitionDelay: "0.19s" }}>
              <div className="lp-feature-icon">💎</div>
              <h3>{t.landing.feat3Title}</h3>
              <p>{t.landing.feat3Desc}</p>
            </div>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-props-grid">
            <div className="lp-prop lp-animate" style={{ transitionDelay: "0.05s" }}>
              <div className="lp-prop-icon">⏱️</div>
              <div className="lp-prop-title">{t.landing.prop1Title}</div>
              <div className="lp-prop-desc">{t.landing.prop1Desc}</div>
            </div>
            <div className="lp-prop lp-animate" style={{ transitionDelay: "0.15s" }}>
              <div className="lp-prop-icon">📱</div>
              <div className="lp-prop-title">{t.landing.prop2Title}</div>
              <div className="lp-prop-desc">{t.landing.prop2Desc}</div>
            </div>
            <div className="lp-prop lp-animate" style={{ transitionDelay: "0.25s" }}>
              <div className="lp-prop-icon">🔒</div>
              <div className="lp-prop-title">{t.landing.prop3Title}</div>
              <div className="lp-prop-desc">{t.landing.prop3Desc}</div>
            </div>
          </div>
        </section>

        <section className="lp-cta-section lp-animate">
          <h2>{t.landing.ctaTitle}</h2>
          <p>{t.landing.ctaSub}</p>
          <button className="lp-cta-btn" onClick={() => setPage("businesses")}>{t.landing.ctaBtn}</button>
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

          <div className="business-grid">
            {adminBusinesses
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
                  className="business-card"
                  key={business.id}
                  style={{ animationDelay: `${index * 0.07}s`, cursor: "pointer" }}
                  onClick={() => { setSelectedBusiness(business); setPage("businessProfile"); }}
                >
                  <div className="bc-glow" />
                  <div className="bc-icon-wrap">
                    {business.logoUrl
                      ? <img src={business.logoUrl} alt={business.name} className="bc-logo-img" />
                      : <span className="bc-icon">{business.icon}</span>
                    }
                  </div>
                  <div className="bc-body">
                    <h3 className="bc-name">{business.name}</h3>
                    <span className="bc-type-tag">{business.type}</span>
                    {business.location && (
                      <a
                        className="bc-location bc-map-link"
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(business.name + " " + business.location)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                      >
                        📍 {business.location}
                      </a>
                    )}
                  </div>
                  <div className="bc-actions">
                    {business.reservationActive && (
                      <button
                        className="bc-select-btn"
                        onClick={(e) => { e.stopPropagation(); openReservationForm(business); }}
                      >
                        {t.businesses.reserveBtn} <span className="bc-arrow">→</span>
                      </button>
                    )}
                    {business.meetingEnabled && business.meetingDates?.length > 0 && (
                      <button
                        className="bc-info-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMeetingFormBusiness(business);
                          setMeetingForm({ fullName: loggedCustomer?.name || "", email: loggedCustomer?.email || "", phone: "", company: "", reason: "is_gorusmesi", productCategory: "", date: "", time: "", note: "" });
                          setMeetingTermsChecked({ biz: false, rp: false });
                          setMeetingFormError("");
                          setPage("meetingRequest");
                        }}
                      >
                        {t.businesses.meetingBtn}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            {adminBusinesses.filter((b) => {
              const q = businessSearch.toLowerCase();
              if (q && !b.name.toLowerCase().includes(q) && !b.type.toLowerCase().includes(q) && !b.location.toLowerCase().includes(q)) return false;
              if (searchLocation !== "Hepsi" && b.location !== searchLocation) return false;
              if (searchDate) {
                const dayName = new Date(searchDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
                const dayOk2 = b.availabilityMode === "specific"
                  ? (b.specificDates || []).includes(searchDate)
                  : (b.availableDays || []).includes(dayName);
                if (!dayOk2) return false;
              }
              if (searchDate && searchTime && !b.availableTimes.includes(searchTime)) return false;
              return true;
            }).length === 0 && (
              <p className="description" style={{ gridColumn: "1/-1" }}>
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
                sendPush({ userType: "business", userId: selectedBusiness?.id, title: "🔔 Yeni Rezervasyon İsteği", body: `${loggedCustomer?.name || "Misafir"} rezervasyon oluşturdu · ${newReservation.date} ${newReservation.time}`, url: "/" });
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
              {customerMode === "login" ? t.nav.customerLogin : t.auth.registerBtn}
            </h1>

            <p className="description">{t.auth.subtitle}</p>

            <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
              <button className={customerMode === "login" ? "selected-time" : "time-btn"} type="button" onClick={() => setCustomerMode("login")}>
                {t.auth.loginTab}
              </button>
              <button className={customerMode === "register" ? "selected-time" : "time-btn"} type="button" onClick={() => setCustomerMode("register")}>
                {t.auth.registerTab}
              </button>
            </div>

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
                    if (
                      customerForm.name === "" ||
                      customerForm.email === "" ||
                      customerForm.password === ""
                    ) {
                      setCustomerAuthError("Tüm alanları doldurun.");
                      return;
                    }

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
                    const { data: authData, error: authError } =
                      await supabase.auth.signInWithPassword({
                        email: customerForm.email,
                        password: customerForm.password,
                      });

                    if (authError) {
                      if (authError.message.toLowerCase().includes("email not confirmed")) {
                        setCustomerAuthError("E-posta adresinizi henüz doğrulamadınız. Mail kutunuzu kontrol edin.");
                      } else {
                        setCustomerAuthError("Hatalı e-posta veya şifre.");
                      }
                      return;
                    }

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
                      const email = customerForm.email.trim();
                      if (!email) { setForgotPasswordMsg("Önce e-posta adresinizi girin."); return; }
                      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: "https://getrezpoint.com" });
                      if (error) { setForgotPasswordMsg("Gönderilemedi: " + error.message); return; }
                      setForgotPasswordMsg("Şifre sıfırlama bağlantısı e-postanıza gönderildi.");
                    }}
                  >{t.auth.forgotPassword}</button>
                </p>
              )}
              {forgotPasswordMsg && (
                <p style={{ textAlign: "center", marginTop: 8, fontSize: 13, color: forgotPasswordMsg.startsWith("Gönderilemedi") ? "var(--red)" : "var(--green)", fontWeight: 600 }}>
                  {forgotPasswordMsg}
                </p>
              )}
            </form>
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
                  <button className={customerTab === "reservations" ? "active-tab" : ""} onClick={() => setCustomerTab("reservations")}>{t.dashboard.reservationsTab}</button>
                  <button className={customerTab === "safescore" ? "active-tab" : ""} onClick={() => setCustomerTab("safescore")}>SafeScore</button>
                  <button className={customerTab === "statistics" ? "active-tab" : ""} onClick={() => setCustomerTab("statistics")}>{lang === "en" ? "My Stats" : "İstatistiklerim"}</button>
                  <button className={customerTab === "loyalty" ? "active-tab" : ""} onClick={() => setCustomerTab("loyalty")}>{lang === "en" ? "Loyalty" : "Sadakat Puanları"}</button>
                  <button className={customerTab === "profile" ? "active-tab" : ""} onClick={() => setCustomerTab("profile")}>{lang === "en" ? "Profile" : "Profil"}</button>
                  <button className={customerTab === "notifications" ? "active-tab" : ""} onClick={() => setCustomerTab("notifications")}>
                    {t.dashboard.notificationsTab}{customerNotifications.filter(n => !n.is_read).length > 0 && <span className="notif-count">{customerNotifications.filter(n => !n.is_read).length}</span>}
                  </button>
                  <button className={customerTab === "meetings" ? "active-tab" : ""} onClick={() => setCustomerTab("meetings")}>📅 {t.dashboard.meetingsTab}</button>
                  <button className={customerTab === "account" ? "active-tab" : ""} onClick={() => { setCustomerTab("account"); setAccountMsg({ text: "", type: "" }); setAccountNewEmail(""); setAccountNewPassword(""); setAccountNewPassword2(""); }}>⚙ {t.dashboard.accountTab}</button>
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
                {customerTab === "safescore" && (() => {
                  const score = loggedCustomer.safeScore ?? 100;
                  const col = score >= 80 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
                  const circ = 2 * Math.PI * 42;
                  return (
                    <div style={{ marginTop: 16 }}>
                      <div className="safescore-page">
                        <div className="safescore-circle-wrap">
                          <svg viewBox="0 0 100 100" className="safescore-svg">
                            <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10"/>
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
                        <h2 className="safescore-title">SafeScore</h2>
                        <p className="safescore-desc">
                          Rezervasyonlarınıza ne kadar güvenilir katıldığınızı gösterir.
                          Yüksek puan, işletmelerin taleplerini öncelikli kabul etmesini sağlar.
                        </p>
                        <div className="safescore-legend">
                          <span style={{ color: "#10b981" }}>● 80–100 Güvenilir</span>
                          <span style={{ color: "#f59e0b" }}>● 50–79 Orta</span>
                          <span style={{ color: "#ef4444" }}>● 0–49 Riskli</span>
                        </div>
                      </div>
                      <p className="rez-section-title" style={{ marginTop: 24 }}>Son Hareketler</p>
                      {safescoreHistory.length > 0
                        ? safescoreHistory.slice(0, 5).map((h, i) => (
                          <div key={i} className="safescore-history-row">
                            <div>
                              <div className="safescore-history-reason">
                                {h.reason === "attended" ? "Rezervasyona katıldın" : h.reason === "no_show" ? "Rezervasyona katılmadın" : h.reason}
                              </div>
                              <div className="safescore-history-date">{new Date(h.created_at).toLocaleDateString("tr-TR")}</div>
                            </div>
                            <span className={`safescore-delta ${h.delta > 0 ? "pos" : "neg"}`}>{h.delta > 0 ? `+${h.delta}` : h.delta}</span>
                          </div>
                        ))
                        : <p className="description">Henüz SafeScore hareketi yok.</p>}
                    </div>
                  );
                })()}

                {/* ── İstatistiklerim ── */}
                {customerTab === "statistics" && (() => {
                  const myRezs = reservations.filter(r => r.email === loggedCustomer.email);
                  const total = myRezs.length;
                  const attended = myRezs.filter(r => r.attendanceStatus === "attended").length;
                  const noshow = myRezs.filter(r => r.attendanceStatus === "no_show").length;
                  const pending = myRezs.filter(r => r.status === "pending").length;
                  const accepted = myRezs.filter(r => r.status === "accepted").length;
                  const rejected = myRezs.filter(r => r.status === "rejected" || r.status === "cancelled").length;
                  const uniqueB = [...new Set(myRezs.map(r => r.businessId))].length;
                  return (
                    <div style={{ marginTop: 16 }}>
                      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
                        <div className="stat-card"><span className="stat-icon">📋</span><span>Toplam Rezervasyon</span><strong><AnimatedNumber value={total} /></strong></div>
                        <div className="stat-card"><span className="stat-icon">🏢</span><span>Keşfedilen İşletme</span><strong><AnimatedNumber value={uniqueB} /></strong></div>
                        <div className="stat-card"><span className="stat-icon">✅</span><span>Katıldım</span><strong><AnimatedNumber value={attended} /></strong></div>
                        <div className="stat-card"><span className="stat-icon">❌</span><span>Katılmadım</span><strong><AnimatedNumber value={noshow} /></strong></div>
                        <div className="stat-card"><span className="stat-icon">⏳</span><span>Bekleyen</span><strong><AnimatedNumber value={pending} /></strong></div>
                        <div className="stat-card"><span className="stat-icon">🚫</span><span>İptal/Red</span><strong><AnimatedNumber value={rejected} /></strong></div>
                      </div>
                      {total > 0 && <div style={{ marginTop: 16 }}>
                        {[
                          { label: "Katıldım", val: attended, color: "green" },
                          { label: "Kabul Bekliyor", val: pending + accepted, color: "" },
                          { label: "Katılmadım", val: noshow, color: "orange" },
                          { label: "İptal/Red", val: rejected, color: "pink" },
                        ].filter(i => i.val > 0).map(item => (
                          <div className="progress-row" key={item.label}>
                            <div className="progress-label">
                              <span>{item.label}</span>
                              <strong>{item.val} ({Math.round(item.val / total * 100)}%)</strong>
                            </div>
                            <ProgressBar percent={Math.round(item.val / total * 100)} color={item.color} />
                          </div>
                        ))}
                      </div>}
                    </div>
                  );
                })()}

                {/* ── Sadakat Puanları ── */}
                {customerTab === "loyalty" && (
                  <div style={{ marginTop: 16 }}>
                    <p className="description" style={{ marginBottom: 16 }}>
                      Her rezervasyona katıldığınızda işletme bazında +2 puan kazanırsınız.
                    </p>
                    {loyaltyPoints.length > 0
                      ? [...loyaltyPoints].sort((a, b) => b.points - a.points).map((lp, i) => (
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
                      : <p className="description">Henüz sadakat puanınız yok. Rezervasyonlara katıldıkça puan kazanırsınız.</p>}
                  </div>
                )}

                {/* ── Profil ── */}
                {customerTab === "profile" && (
                  <div className="reservation-box" style={{ marginTop: 16 }}>
                    <h2>Profilim</h2>
                    <p className="description">Bu alanlar isteğe bağlıdır. İstediğiniz zaman güncelleyebilirsiniz.</p>
                    <form className="reservation-form">
                      <input type="tel" placeholder="Telefon Numarası" value={customerProfile.phone}
                        onChange={e => setCustomerProfile({ ...customerProfile, phone: e.target.value })} />
                      <h3>Cinsiyet</h3>
                      <div className="time-slots">
                        {[["Male","Erkek"],["Female","Kadın"],["Prefer not to say","Belirtmek istemiyorum"]].map(([val, label]) => (
                          <button key={val} type="button"
                            className={customerProfile.gender === val ? "profile-option selected-time" : "profile-option time-btn"}
                            onClick={() => setCustomerProfile({ ...customerProfile, gender: val })}>
                            {customerProfile.gender === val ? "✓ " : ""}{label}
                          </button>
                        ))}
                      </div>
                      <h3 style={{ marginTop: 20 }}>Doğum Tarihi</h3>
                      <input type="date" value={customerProfile.birthDate}
                        onChange={e => setCustomerProfile({ ...customerProfile, birthDate: e.target.value })} />
                      <input type="text" placeholder="Meslek" value={customerProfile.job}
                        onChange={e => setCustomerProfile({ ...customerProfile, job: e.target.value })} />
                      <h3 style={{ marginTop: 20 }}>Sigara Tercihi</h3>
                      <div className="time-slots">
                        {[["Smoker","İçiyor"],["Non-smoker","İçmiyor"],["No preference","Fark Etmez"]].map(([val, label]) => (
                          <button key={val} type="button"
                            className={customerProfile.smoking === val ? "profile-option selected-time" : "profile-option time-btn"}
                            onClick={() => setCustomerProfile({ ...customerProfile, smoking: val })}>
                            {customerProfile.smoking === val ? "✓ " : ""}{label}
                          </button>
                        ))}
                      </div>
                      <button type="button" onClick={async () => {
                        const { error } = await supabase.rpc("customer_update_profile", {
                          p_phone: customerProfile.phone,
                          p_gender: customerProfile.gender,
                          p_birth_date: customerProfile.birthDate,
                          p_job: customerProfile.job,
                          p_smoking: customerProfile.smoking,
                        });
                        if (error) { alert("Profil kaydedilemedi."); return; }
                        alert("Profil başarıyla kaydedildi.");
                      }}>Profili Kaydet</button>
                    </form>
                  </div>
                )}

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

                    {accountMsg.text && (
                      <div className={accountMsg.type === "success" ? "success-message" : "error-message"} style={{ marginBottom: 20 }}>
                        {accountMsg.text}
                      </div>
                    )}

                    {/* Mevcut bilgiler */}
                    <div className="profile-card" style={{ marginBottom: 24 }}>
                      <div className="profile-field-row">
                        <span className="profile-field-label">Mevcut E-posta</span>
                        <span className="profile-field-value">{loggedCustomer.email}</span>
                      </div>
                    </div>

                    {/* E-posta değiştir */}
                    <div className="reservation-box" style={{ marginBottom: 20 }}>
                      <h3 style={{ marginBottom: 12, fontSize: 15 }}>✉️ E-posta Değiştir</h3>
                      <p className="description" style={{ fontSize: 13, marginBottom: 14 }}>
                        Yeni e-postanıza bir doğrulama linki gönderilir. Linke tıkladıktan sonra değişiklik geçerli olur.
                      </p>
                      <form className="reservation-form" onSubmit={async (e) => {
                        e.preventDefault();
                        const newEmail = accountNewEmail.trim().toLowerCase();
                        if (!newEmail) return setAccountMsg({ text: "Yeni e-posta adresini girin.", type: "error" });
                        if (newEmail === loggedCustomer.email) return setAccountMsg({ text: "Bu zaten mevcut e-posta adresiniz.", type: "error" });
                        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return setAccountMsg({ text: "Geçerli bir e-posta adresi girin.", type: "error" });

                        setAccountLoading("email");
                        const { error } = await supabase.auth.updateUser({ email: newEmail }, { emailRedirectTo: "https://getrezpoint.com" });
                        setAccountLoading("");

                        if (error) {
                          setAccountMsg({ text: "E-posta değiştirilemedi: " + error.message, type: "error" });
                        } else {
                          setAccountNewEmail("");
                          setAccountMsg({ text: `${newEmail} adresine doğrulama linki gönderildi. Linke tıkladıktan sonra e-postanız güncellenir.`, type: "success" });
                        }
                      }}>
                        <input
                          type="email"
                          placeholder="Yeni e-posta adresi"
                          value={accountNewEmail}
                          onChange={e => setAccountNewEmail(e.target.value)}
                          autoComplete="email"
                          disabled={accountLoading === "email"}
                        />
                        <button type="submit" className="save-changes-btn" disabled={accountLoading === "email"}>
                          {accountLoading === "email" ? <Spinner /> : "Doğrulama Linki Gönder"}
                        </button>
                      </form>
                    </div>

                    {/* Şifre değiştir */}
                    <div className="reservation-box" style={{ marginBottom: 20 }}>
                      <h3 style={{ marginBottom: 12, fontSize: 15 }}>🔒 Şifre Değiştir</h3>
                      <form className="reservation-form" onSubmit={async (e) => {
                        e.preventDefault();
                        if (!accountNewPassword) return setAccountMsg({ text: "Yeni şifre girin.", type: "error" });
                        if (accountNewPassword.length < 6) return setAccountMsg({ text: "Şifre en az 6 karakter olmalıdır.", type: "error" });
                        if (accountNewPassword !== accountNewPassword2) return setAccountMsg({ text: "Şifreler eşleşmiyor.", type: "error" });

                        setAccountLoading("password");
                        const { error } = await supabase.auth.updateUser({ password: accountNewPassword });
                        setAccountLoading("");

                        if (error) {
                          setAccountMsg({ text: "Şifre değiştirilemedi: " + error.message, type: "error" });
                        } else {
                          setAccountNewPassword("");
                          setAccountNewPassword2("");
                          setAccountMsg({ text: "Şifreniz başarıyla güncellendi.", type: "success" });
                        }
                      }}>
                        <input
                          type="password"
                          placeholder="Yeni şifre (en az 6 karakter)"
                          value={accountNewPassword}
                          onChange={e => setAccountNewPassword(e.target.value)}
                          autoComplete="new-password"
                          disabled={accountLoading === "password"}
                        />
                        <input
                          type="password"
                          placeholder="Yeni şifre (tekrar)"
                          value={accountNewPassword2}
                          onChange={e => setAccountNewPassword2(e.target.value)}
                          autoComplete="new-password"
                          disabled={accountLoading === "password"}
                        />
                        <button type="submit" className="save-changes-btn" disabled={accountLoading === "password"}>
                          {accountLoading === "password" ? <Spinner /> : "Şifreyi Güncelle"}
                        </button>
                      </form>
                    </div>

                    {/* Şifremi unuttum */}
                    <div className="reservation-box">
                      <h3 style={{ marginBottom: 8, fontSize: 15 }}>🔑 Şifremi Unuttum</h3>
                      <p className="description" style={{ fontSize: 13, marginBottom: 14 }}>
                        Mevcut şifrenizi bilmiyorsanız e-postanıza sıfırlama linki gönderebilirsiniz.
                      </p>
                      <button
                        className="secondary-btn"
                        disabled={accountLoading === "reset"}
                        onClick={async () => {
                          setAccountLoading("reset");
                          const { error } = await supabase.auth.resetPasswordForEmail(loggedCustomer.email, {
                            redirectTo: window.location.origin,
                          });
                          setAccountLoading("");
                          if (error) {
                            setAccountMsg({ text: "Gönderilemedi: " + error.message, type: "error" });
                          } else {
                            setAccountMsg({ text: `${loggedCustomer.email} adresine şifre sıfırlama linki gönderildi.`, type: "success" });
                          }
                        }}
                      >
                        {accountLoading === "reset" ? <Spinner /> : "Sıfırlama Linki Gönder"}
                      </button>
                    </div>
                  </div>
                )}

                {customerTab === "account" && (
                  <button
                    className="primary-btn"
                    style={{ marginTop: 16, maxWidth: 480 }}
                    onClick={async () => {
                      await supabase.auth.signOut();
                      localStorage.setItem("rp_page", "home");
                      setLoggedCustomer(null);
                      setEmailVerified(false);
                      setCustomerForm({ name: "", email: "", password: "" });
                      setCustomerProfile({ phone: "", gender: "", birthDate: "", job: "", smoking: "" });
                      setPage("home");
                    }}
                  >
                    Çıkış Yap
                  </button>
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

      {page === "businessLogin" && (
        <section className="reservation-section">
          <div className="reservation-box">
            <h1>İşletme Girişi</h1>
            <p className="description">Rezervasyonları yönetmek için giriş yapın.</p>

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
          </div>
        </section>
      )}
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
                      closingPin: "",
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
                            if (!error) setMeetings(prev => prev.map(x => x.id === m.id ? { ...x, status: "accepted" } : x));
                            setLoadingReservationId(null);
                          }}>{loadingReservationId === m.id ? <Spinner /> : "✓"}</button>
                          <button className="req-reject-btn" disabled={loadingReservationId === m.id} onClick={async () => {
                            setLoadingReservationId(m.id);
                            const { error } = await supabase.rpc("business_update_meeting_status", { p_token: bizSessionToken, p_meeting_id: m.id, p_status: "rejected" });
                            if (!error) setMeetings(prev => prev.map(x => x.id === m.id ? { ...x, status: "rejected" } : x));
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
                  Müsait gün ve saatleri düzenleyin.
                </p>

                <h3>Rezervasyon Modu</h3>

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
                    setLoggedBusiness(prev => ({ ...prev, businessHours }));
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

      {page === "businessProfile" && selectedBusiness && (
        <section className="biz-profile-page">
          <button className="back-btn" onClick={() => setPage("businesses")}>← Geri</button>

          <div className="biz-profile-header">
            <div className="biz-profile-icon-wrap">
              {selectedBusiness.logoUrl
                ? <img src={selectedBusiness.logoUrl} alt={selectedBusiness.name} className="biz-profile-logo-img" />
                : <span className="biz-profile-icon">{selectedBusiness.icon}</span>
              }
            </div>
            <div className="biz-profile-meta">
              <h1 className="biz-profile-name">{selectedBusiness.name}</h1>
              <span className="biz-profile-type">{selectedBusiness.type}</span>
              {(() => {
                const todayKey = new Date().toLocaleDateString("en-US", { weekday: "long" });
                const h = (selectedBusiness.businessHours || {})[todayKey];
                if (!h?.open || !h?.close) return null;
                const now = new Date();
                const nowMins = now.getHours() * 60 + now.getMinutes();
                const toMins = str => { const [hr, m] = (str||"00:00").split(":").map(Number); return (hr||0)*60+(m||0); };
                const isOpen = nowMins >= toMins(h.open) && nowMins < toMins(h.close);
                return (
                  <span className={`biz-open-status${isOpen ? " open" : " closed"}`}>
                    {isOpen ? `✓ Şu an açık · ${h.open}–${h.close}` : `✕ Şu an kapalı · ${h.open}–${h.close} arası açık`}
                  </span>
                );
              })()}
              {selectedBusiness.location && (
                <a
                  className="biz-profile-loc biz-map-link"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedBusiness.name + " " + selectedBusiness.location)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                >
                  📍 {selectedBusiness.location}
                  <span className="biz-map-badge">🗺️ Haritada gör</span>
                </a>
              )}
              {selectedBusiness.phone && (
                <span className="biz-profile-phone">📞 {selectedBusiness.phone}</span>
              )}
              {selectedBusiness.meetingEnabled && selectedBusiness.meetingDates?.length > 0 && (
                <div className="biz-profile-phone-row">
                  <button className="meeting-request-btn" onClick={() => {
                    setMeetingFormBusiness(selectedBusiness);
                    setMeetingForm({ fullName: loggedCustomer?.name || "", email: loggedCustomer?.email || "", phone: "", company: "", reason: "is_gorusmesi", productCategory: "", date: "", time: "", note: "" });
                    setMeetingTermsChecked({ biz: false, rp: false });
                    setMeetingFormError("");
                    setPage("meetingRequest");
                  }}>
                    {t.profile.meetingBtn}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="biz-profile-stats">
            <div className="biz-stat-item">
              <strong>{reservations.filter(r => r.businessId === selectedBusiness.id && r.status !== "cancelled").length}</strong>
              <span>Toplam Rezervasyon</span>
            </div>
            <div className="biz-stat-item">
              <strong>{reservations.filter(r => r.businessId === selectedBusiness.id && r.attendanceStatus === "attended").length}</strong>
              <span>Tamamlanan</span>
            </div>
            <div className="biz-stat-item">
              <strong>{selectedBusiness.availableTimes?.length || 0}</strong>
              <span>{t.profile.timezone}</span>
            </div>
          </div>

          {selectedBusiness.description && (
            <div className="biz-profile-section">
              <div className="biz-profile-section-title">{t.profile.about}</div>
              <p className="biz-profile-text">{selectedBusiness.description}</p>
            </div>
          )}

          {selectedBusiness.menu && (
            <div className="biz-profile-section">
              <div className="biz-profile-section-title">{t.profile.menu}</div>
              {selectedBusiness.menu.startsWith("http")
                ? <a href={selectedBusiness.menu} target="_blank" rel="noopener noreferrer" className="biz-profile-link">Menüyü Görüntüle →</a>
                : <p className="biz-profile-text">{selectedBusiness.menu}</p>}
            </div>
          )}

          {(() => {
            const hours = selectedBusiness.businessHours || {};
            const days = [
              { key: "Monday",    label: "Pazartesi" },
              { key: "Tuesday",   label: "Salı" },
              { key: "Wednesday", label: "Çarşamba" },
              { key: "Thursday",  label: "Perşembe" },
              { key: "Friday",    label: "Cuma" },
              { key: "Saturday",  label: "Cumartesi" },
              { key: "Sunday",    label: "Pazar" },
            ];
            const hasAny = days.some(d => hours[d.key]?.open);
            if (!hasAny) return null;
            const todayKey = new Date().toLocaleDateString("en-US", { weekday: "long" });
            return (
              <div className="biz-profile-section">
                <div className="biz-profile-section-title">🕐 Çalışma Saatleri</div>
                <div className="biz-hours-profile">
                  {days.map(({ key, label }) => {
                    const h = hours[key];
                    const isToday = key === todayKey;
                    const isOpen = h?.open && h?.close;
                    return (
                      <div key={key} className={`biz-hours-profile-row${isToday ? " today" : ""}${!isOpen ? " closed" : ""}`}>
                        <span className="bhp-day">{label}</span>
                        <span className="bhp-hours">
                          {isOpen ? `${h.open} – ${h.close}` : "Kapalı"}
                        </span>
                        {isToday && isOpen && <span className="bhp-badge open">Şu an açık</span>}
                        {isToday && !isOpen && <span className="bhp-badge closed">Bugün kapalı</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <div className="biz-profile-section">
            <div className="biz-profile-section-title">{t.profile.times}</div>
            <div className="biz-profile-times">
              {(selectedBusiness.availableTimes || []).map(slot => (
                <span key={slot} className="biz-time-chip">{slot}</span>
              ))}
            </div>
          </div>

          {selectedBusiness.reservationActive && (
            <div className="biz-profile-cta">
              <button className="primary-btn" onClick={() => openReservationForm(selectedBusiness)}>{t.profile.reserveBtn}</button>
            </div>
          )}
        </section>
      )}

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
    </div>
  );
}

export default App;
