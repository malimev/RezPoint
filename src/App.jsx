
import { useState, useEffect, useRef } from "react";
import "./App.css";
import logo from "./assets/logo.png";
import { supabase } from "./supabaseClient";

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

function App() {
  const [page, setPage] = useState("home");
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [error, setError] = useState("");
  const [loginError, setLoginError] = useState("");
  const [panelTab, setPanelTab] = useState("incoming");
  const [customerInsightTab, setCustomerInsightTab] = useState("age");
  const [customerTab, setCustomerTab] = useState("pending");

  const [availableTimes, setAvailableTimes] = useState([
    "18:00",
    "19:00",
    "20:30",
  ]);
  const [availableDays, setAvailableDays] = useState(["Friday", "Saturday"]);
  const [availabilityMode, setAvailabilityMode] = useState("selected");
  const [savedMessage, setSavedMessage] = useState("");

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
  const [loggedBusiness, setLoggedBusiness] = useState(null);
  const [isCreatingReservation, setIsCreatingReservation] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [businessSearch, setBusinessSearch] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);

  const [businessProfileForm, setBusinessProfileForm] = useState({
    name: "",
    location: "",
    phone: "",
    description: "",
    menu: "",
  });
  const [businessProfileSaved, setBusinessProfileSaved] = useState("");
  const [selectedBusinessInfo, setSelectedBusinessInfo] = useState(null);

  const [searchLocation, setSearchLocation] = useState("Hepsi");
  const [searchDate, setSearchDate] = useState("");
  const [searchTime, setSearchTime] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);

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
  useEffect(() => {
    const loadInitialData = async () => {
      // Restore Supabase Auth session if one exists
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: custData } = await supabase
          .from("customers")
          .select("*")
          .eq("auth_user_id", session.user.id)
          .single();
        if (custData) {
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
          setEmailVerified(!!session.user.email_confirmed_at);
        }
      }

      // Businesses
      const { data: businessData, error: businessError } = await supabase
        .from("businesses")
        .select("*");

      if (businessError) {
        console.log("Businesses fetch error:", businessError);
      }

      if (businessData) {
        const parseMenuText = (raw) => {
          if (!raw) return { description: "", menu: "", phone: "" };
          try {
            const p = JSON.parse(raw);
            if (p && typeof p === "object") return { description: p.description || "", menu: p.menu || "", phone: p.phone || "" };
          } catch {}
          return { description: "", menu: raw, phone: "" };
        };

        const formattedBusinesses = businessData.map((business) => {
          const parsed = parseMenuText(business.menu_text);
          return {
            id: business.id,
            name: business.name,
            email: business.email,
            password: business.password,
            reservationActive: business.reservation_enabled,
            aiMenuActive: business.ai_menu_enabled,
            menuText: business.menu_text || "",
            description: parsed.description,
            menu: parsed.menu,
            phone: parsed.phone,
            type: business.type || "Business",
            location: business.location || "",
            icon: business.icon || "🏢",
            availabilityMode: business.availability_mode || "selected",
            availableDays: business.available_days
              ? business.available_days.split(",")
              : ["Friday", "Saturday"],
            availableTimes: business.available_times
              ? business.available_times.split(",")
              : ["18:00", "19:00", "20:30"],
          };
        });

        setAdminBusinesses(formattedBusinesses);
      }

      // Reservations
      const { data: reservationData, error: reservationError } =
        await supabase.from("reservations").select("*");

      if (reservationError) {
        console.log("Reservations fetch error:", reservationError);
      }

      if (reservationData) {
        const formattedReservations = reservationData.map((rez) => ({
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
          customerProfile: {
            gender: rez.gender,
            birthDate: rez.birth_date,
            job: rez.job,
            smoking: rez.smoking,
          },
        }));

        setReservations(formattedReservations);
      }

      // Customers
      // NOTE: previously this state was never populated, which meant
      // safe-score updates inside closeDayReservations() never reached
      // any actual customer record in local state.
      const { data: customerData, error: customerError } = await supabase
        .from("customers")
        .select("*");

      if (customerError) {
        console.log("Customers fetch error:", customerError);
      }

      if (customerData) {
        const formattedCustomers = customerData.map((customer) => ({
          id: customer.id,
          name: customer.name,
          email: customer.email,
          password: customer.password,
          safeScore: customer.safe_score ?? 100,
          profile: {
            phone: customer.phone || "",
            gender: customer.gender || "",
            birthDate: customer.birth_date || "",
            job: customer.job || "",
            smoking: customer.smoking || "",
          },
        }));

        setRegisteredCustomers(formattedCustomers);
      }
    };

    loadInitialData();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setLoggedCustomer(null);
        setEmailVerified(false);
      }
    });
    return () => subscription?.unsubscribe();
  }, []);

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

  function getAvailableDates() {
    const dates = [];

    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + i);

      const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
      const businessAvailabilityMode = selectedBusiness?.availabilityMode || availabilityMode;
      const businessAvailableDays = selectedBusiness?.availableDays?.length
        ? selectedBusiness.availableDays
        : availableDays;
      const shouldInclude =
        businessAvailabilityMode === "everyday" ||
        businessAvailableDays.includes(dayName);

      if (shouldInclude) {
        const fullDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
        rez.businessId === loggedBusiness.id && rez.status === "accepted",
    );
  }
  function getBusinessReservationCount(status) {
    if (!loggedBusiness) return 0;

    return reservations.filter(
      (rez) => rez.businessId === loggedBusiness.id && rez.status === status,
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
    if (!loggedCustomer) {
      setCustomerMode("login");
      setPage("customerAuth");
      return;
    }

    setSelectedBusiness(business);
    setReservation({ phone: "", date: "", time: "", guests: "", note: "" });
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

  function handleBusinessLogin() {
    const business = adminBusinesses.find(
      (item) =>
        item.email === businessLogin.email &&
        item.password === businessLogin.password,
    );

    if (business) {
      setLoggedBusiness(business);

      setAvailabilityMode(
        business.availabilityMode || business.availability_mode || "selected",
      );

      setAvailableDays(
        business.availableDays ||
          (business.available_days ? business.available_days.split(",") : []),
      );

      setAvailableTimes(
        business.availableTimes ||
          (business.available_times ? business.available_times.split(",") : []),
      );

      setBusinessProfileForm({
        name: business.name || "",
        location: business.location || "",
        phone: business.phone || "",
        description: business.description || "",
        menu: business.menu || "",
      });

      setLoginError("");
      setPanelTab("incoming");
      setPage("businessPanel");
    } else {
      setLoginError("Hatalı e-posta veya şifre.");
    }
  }

  function handleAdminLogin() {
    // SECURITY NOTE: This check runs entirely in the browser, so the
    // credentials below are visible to anyone who opens devtools / the
    // bundled JS. For real protection this must be enforced server-side
    // (e.g. Supabase Auth + Row Level Security policies), not here.
    if (
      adminLogin.email === "admin@rezpoint.com" &&
      adminLogin.password === "0000"
    ) {
      setAdminError("");
      setPage("adminPanel");
    } else {
      setAdminError("Hatalı yönetici e-postası veya şifre.");
    }
  }

  async function closeDayReservations() {
    // SECURITY NOTE: same caveat as handleAdminLogin - this is a
    // client-side-only check and is not a real access control.
    const password = prompt("Günü kapatmak için güvenlik kodunu girin:");

    if (password !== "0000") {
      alert("Hatalı güvenlik kodu.");
      return;
    }
    if (
      !window.confirm(
        "Bu günü kapat? İşaretli müşteriler tamamlandı, işaretlenmeyenler no-show olarak işaretlenecek.",
      )
    ) {
      return;
    }
    if (!selectedAcceptedDate) {
      alert("Önce bir tarih seçin.");
      return;
    }

    const targetReservations = reservations.filter(
      (rez) =>
        rez.businessId === loggedBusiness.id &&
        rez.status === "accepted" &&
        rez.date === selectedAcceptedDate,
    );

    if (targetReservations.length === 0) {
      alert("Bu tarih için kabul edilmiş rezervasyon yok.");
      return;
    }

    // Track score changes per customer email so we can apply them to
    // local state (registeredCustomers / loggedCustomer) after the
    // Supabase updates succeed.
    const scoreChangesByEmail = {};

    for (const rez of targetReservations) {
      const newStatus = checkedInReservations.includes(rez.id)
        ? "completed"
        : "no-show";

      const { error: reservationUpdateError } = await supabase
        .from("reservations")
        .update({
          status: newStatus,
        })
        .eq("id", rez.id);

      if (reservationUpdateError) {
        console.log("Close day error:", reservationUpdateError);
        alert("Close Day işlemi sırasında hata oldu.");
        return;
      }

      const scoreChange = newStatus === "completed" ? 2 : -8;

      scoreChangesByEmail[rez.email] =
        (scoreChangesByEmail[rez.email] || 0) + scoreChange;
    }

    // Apply accumulated score changes to each affected customer.
    for (const email of Object.keys(scoreChangesByEmail)) {
      const { data: customerRow, error: customerFetchError } = await supabase
        .from("customers")
        .select("safe_score")
        .eq("email", email)
        .single();

      if (customerFetchError || !customerRow) {
        console.log("Customer fetch error for", email, customerFetchError);
        continue;
      }

      const currentScore = customerRow.safe_score ?? 100;
      const newSafeScore = Math.min(
        100,
        Math.max(0, currentScore + scoreChangesByEmail[email]),
      );

      const { error: customerUpdateError } = await supabase
        .from("customers")
        .update({
          safe_score: newSafeScore,
        })
        .eq("email", email);

      if (customerUpdateError) {
        console.log("Customer score update error for", email, customerUpdateError);
        continue;
      }

      // Keep local state in sync with the database.
      setRegisteredCustomers((prevCustomers) =>
        prevCustomers.map((customer) =>
          customer.email === email
            ? { ...customer, safeScore: newSafeScore }
            : customer,
        ),
      );

      if (loggedCustomer && loggedCustomer.email === email) {
        setLoggedCustomer((prev) =>
          prev ? { ...prev, safeScore: newSafeScore } : prev,
        );
      }
    }

    // Update reservation statuses in local state.
    setReservations((prev) =>
      prev.map((rez) => {
        if (
          rez.businessId === loggedBusiness.id &&
          rez.status === "accepted" &&
          rez.date === selectedAcceptedDate
        ) {
          return {
            ...rez,
            status: checkedInReservations.includes(rez.id)
              ? "completed"
              : "no-show",
          };
        }

        return rez;
      }),
    );

    setCheckedInReservations([]);
    alert("Gün başarıyla kapatıldı.");
  }
  return (
    <div className="page">
      <nav className="navbar">
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
          <img src={logo} alt="RezPoint Logo" />
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
            Rezervasyon Oluştur
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
            {loggedCustomer ? "Hesabım" : "Müşteri Girişi"}
          </button>

          <button
            className="nav-button"
            onClick={() => {
              setPage("businessLogin");
              setMobileMenuOpen(false);
            }}
          >
            İşletme Girişi
          </button>

          <button
            className="nav-button"
            onClick={() => {
              setPage("contact");
              setMobileMenuOpen(false);
            }}
          >
            İletişim
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
        <section className="hero">
          <div className="hero-text">
            <h1>Modern işletmeler için akıllı rezervasyon.</h1>
            <p className="description">
              Konum ve zaman seç, müsait işletmeleri gör — saniyeler içinde rezervasyon oluştur.
            </p>

            <div className="search-panel">
              <div className="search-fields">
                <div className="search-field">
                  <label className="search-label">📍 Konum</label>
                  <select
                    className="search-select"
                    value={searchLocation}
                    onChange={(e) => setSearchLocation(e.target.value)}
                  >
                    <option value="Hepsi">Hepsi</option>
                    <option value="İskele">İskele</option>
                    <option value="Mağusa">Mağusa</option>
                  </select>
                </div>

                <div className="search-field">
                  <label className="search-label">📅 Tarih</label>
                  <input
                    type="date"
                    className="search-input"
                    value={searchDate}
                    onChange={(e) => setSearchDate(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                    max={(() => {
                      const d = new Date();
                      d.setDate(d.getDate() + 30);
                      return d.toISOString().split("T")[0];
                    })()}
                  />
                </div>

                <div className="search-field">
                  <label className="search-label">🕐 Saat</label>
                  <select
                    className="search-select"
                    value={searchTime}
                    onChange={(e) => setSearchTime(e.target.value)}
                  >
                    <option value="">Fark etmez</option>
                    {ALL_TIME_SLOTS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                className="search-btn"
                onClick={() => setPage("businesses")}
              >
                {searchDate
                  ? `${formatDate(searchDate)}${searchTime ? ` saat ${searchTime}` : ""} için müsait işletmeleri gör`
                  : "Tüm işletmeleri gör"}
              </button>
            </div>
          </div>

          <div className="hero-card">
            <h3>Nasıl çalışır?</h3>
            <div className="card-row">
              <span>1</span>
              <strong>Giriş yap veya hesap oluştur</strong>
            </div>
            <div className="card-row">
              <span>2</span>
              <strong>İşletme seç</strong>
            </div>
            <div className="card-row">
              <span>3</span>
              <strong>İstek gönder</strong>
            </div>
          </div>
        </section>
      )}

      {page === "businesses" && (
        <section className="business-section">
          <button className="back-btn" onClick={() => setPage("home")}>
            ← Geri
          </button>

          <h1>İşletme Seç</h1>
          <p className="description">
            Rezervasyon oluşturmak istediğin işletmeyi seç.
          </p>

          <div className="business-search-wrapper">
            <span className="business-search-icon">🔍</span>
            <input
              className="business-search-input"
              type="text"
              placeholder="İşletme ara..."
              value={businessSearch}
              onChange={(e) => setBusinessSearch(e.target.value)}
            />
            {businessSearch && (
              <button className="business-search-clear" onClick={() => setBusinessSearch("")}>✕</button>
            )}
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
                ✕ Filtreyi Temizle
              </button>
            </div>
          )}

          <div className="business-grid">
            {adminBusinesses
              .filter((business) => {
                if (!business.reservationActive) return false;
                const q = businessSearch.toLowerCase();
                if (q && !business.name.toLowerCase().includes(q) && !business.type.toLowerCase().includes(q) && !business.location.toLowerCase().includes(q)) return false;
                if (searchLocation !== "Hepsi" && business.location !== searchLocation) return false;
                if (searchDate) {
                  const dayName = new Date(searchDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
                  const dayOk = business.availabilityMode === "everyday" || business.availableDays.includes(dayName);
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
                  style={{ animationDelay: `${index * 0.07}s` }}
                >
                  <div className="bc-glow" />
                  <div className="bc-icon-wrap">
                    <span className="bc-icon">{business.icon}</span>
                  </div>
                  <div className="bc-body">
                    <h3 className="bc-name">{business.name}</h3>
                    <span className="bc-type-tag">{business.type}</span>
                    {business.location && (
                      <p className="bc-location">📍 {business.location}</p>
                    )}
                  </div>
                  <div className="bc-actions">
                    <button
                      className="bc-select-btn"
                      onClick={() => openReservationForm(business)}
                    >
                      Rezervasyon Yap <span className="bc-arrow">→</span>
                    </button>
                    <button
                      className="bc-info-btn"
                      onClick={(e) => { e.stopPropagation(); setSelectedBusinessInfo(business); }}
                    >
                      ℹ İşletme Hakkında
                    </button>
                  </div>
                </div>
              ))}
            {adminBusinesses.filter((b) => {
              if (!b.reservationActive) return false;
              const q = businessSearch.toLowerCase();
              if (q && !b.name.toLowerCase().includes(q) && !b.type.toLowerCase().includes(q) && !b.location.toLowerCase().includes(q)) return false;
              if (searchLocation !== "Hepsi" && b.location !== searchLocation) return false;
              if (searchDate) {
                const dayName = new Date(searchDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
                if (b.availabilityMode !== "everyday" && !b.availableDays.includes(dayName)) return false;
              }
              if (searchDate && searchTime && !b.availableTimes.includes(searchTime)) return false;
              return true;
            }).length === 0 && (
              <p className="description" style={{ gridColumn: "1/-1" }}>
                {businessSearch ? `"${businessSearch}" için` : "Seçili filtrelerle eşleşen"} işletme bulunamadı.
              </p>
            )}
          </div>
        </section>
      )}

      {page === "reservation" && selectedBusiness && loggedCustomer && (
        <section className="reservation-section">
          <button className="back-btn" onClick={() => setPage("businesses")}>
            ← Geri
          </button>

          <div className="reservation-box">
            <h1>{selectedBusiness.name}</h1>
            <p className="description" style={{ marginTop: 0 }}>
              {selectedBusiness.type}{selectedBusiness.location ? ` · ${selectedBusiness.location}` : ""}
            </p>

            {!emailVerified && (
              <div className="email-verify-warning">
                <span>⚠️</span>
                <div>
                  <strong>E-postanız doğrulanmamış</strong>
                  <p>Rezervasyon oluşturmak için e-posta adresinizi doğrulayın.</p>
                </div>
                <button
                  type="button"
                  className="resend-btn"
                  onClick={async () => {
                    await supabase.auth.resend({ type: "signup", email: loggedCustomer.email });
                    alert("Doğrulama maili gönderildi!");
                  }}
                >
                  📧 Tekrar Gönder
                </button>
              </div>
            )}

            <form className="reservation-form">
              {/* Ad & E-posta (otomatik) */}
              <div className="rez-info-row">
                <div className="rez-info-item">
                  <span className="rez-info-label">İsim</span>
                  <span className="rez-info-value">{loggedCustomer.name}</span>
                </div>
                <div className="rez-info-item">
                  <span className="rez-info-label">E-posta</span>
                  <span className="rez-info-value">{loggedCustomer.email}</span>
                </div>
              </div>

              {/* Tarih + Saat yan yana strip */}
              <div className="date-time-row">
                <div className="strip-section">
                  <div className="strip-label">📅 Tarih</div>
                  <div className="date-strip">
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
                </div>

                <div className="strip-section">
                  <div className="strip-label">🕐 Saat</div>
                  <div className="time-strip">
                    {(selectedBusiness?.availableTimes?.length
                      ? selectedBusiness.availableTimes
                      : availableTimes
                    ).map((time) => (
                      <button
                        key={time}
                        type="button"
                        className={reservation.time === time ? "strip-btn active" : "strip-btn"}
                        onClick={() => setReservation({ ...reservation, time })}
                      >
                        {time}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Kişi sayısı */}
              <input
                name="guests"
                value={reservation.guests}
                onChange={handleChange}
                type="number"
                placeholder="👥 Kişi sayısı (1-20)"
                min="1"
                max="20"
              />

              {/* Telefon */}
              <input
                name="phone"
                value={reservation.phone}
                onChange={handleChange}
                type="tel"
                placeholder="📞 Telefon numarası"
              />

              {/* Not */}
              <textarea
                name="note"
                value={reservation.note}
                onChange={handleChange}
                placeholder="📝 Not, masa tercihi veya özel istek (opsiyonel)"
              />

              {error && <p className="error-message">{error}</p>}

              <button
                type="button"
                disabled={!emailVerified || !reservation.date || !reservation.time || !reservation.guests || !reservation.phone}
                onClick={sendReservation}
                style={{ opacity: (!emailVerified || !reservation.date || !reservation.time || !reservation.guests || !reservation.phone) ? 0.5 : 1 }}
              >
                Rezervasyon İsteği Gönder →
              </button>

              <p className="rez-terms">
                Rezervasyon oluşturarak RezPoint kullanım koşullarını kabul etmiş olursunuz.
              </p>
            </form>
          </div>
        </section>
      )}

      {page === "summary" && selectedBusiness && loggedCustomer && (
        <section className="reservation-section">
          <div className="reservation-box">
            <h1>Rezervasyon Özeti</h1>
            <p className="description">İsteğiniz oluşturuldu.</p>

            <div className="card-row">
              <span>İşletme</span>
              <strong>{selectedBusiness.name}</strong>
            </div>
            <div className="card-row">
              <span>İsim</span>
              <strong>{loggedCustomer.name}</strong>
            </div>
            <div className="card-row">
              <span>E-posta</span>
              <strong>{loggedCustomer.email}</strong>
            </div>
            <div className="card-row">
              <span>Telefon</span>
              <strong>{reservation.phone}</strong>
            </div>
            <div className="card-row">
              <span>Tarih</span>
              <strong>{formatDate(reservation.date)}</strong>
            </div>
            <div className="card-row">
              <span>Saat</span>
              <strong>{reservation.time}</strong>
            </div>
            <div className="card-row">
              <span>Misafir</span>
              <strong>{reservation.guests}</strong>
            </div>
            <div className="card-row">
              <span>Not</span>
              <strong>{reservation.note || "Not yok"}</strong>
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
                  alert("Rezervasyon oluşturulamadı.");
                  setIsCreatingReservation(false);
                  return;
                }

                setReservations([...reservations, newReservation]);
                setIsCreatingReservation(false);
                setPage("success");
              }}
            >
              {isCreatingReservation
                ? "Oluşturuluyor..."
                : "Onayla ve Gönder"}
            </button>
          </div>
        </section>
      )}

      {page === "success" && selectedBusiness && loggedCustomer && (
        <section className="reservation-section">
          <div className="reservation-box">
            <h1>Rezervasyon Gönderildi ✅</h1>

            <p className="description">
              Rezervasyon isteğiniz {selectedBusiness.name} işletmesine gönderildi.
              İşletme isteğinizi inceleyecek.
            </p>

            <div className="card-row">
              <span>Rezervasyon Kodu</span>
              <strong>{reservationCode}</strong>
            </div>

            <p className="description">
              Rezervasyon kodu şuraya gönderildi: <strong>{loggedCustomer.email}</strong>
            </p>

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
                setCustomerTab("pending");
                setPage("customerDashboard");
              }}
            >
              Rezervasyonlarıma Git
            </button>
          </div>
        </section>
      )}

      {page === "customerAuth" && (
        <section className="reservation-section">
          <div className="reservation-box">
            <h1>
              {customerMode === "login" ? "Müşteri Girişi" : "Hesap Oluştur"}
            </h1>

            <p className="description">
              Rezervasyonlarınızı yönetmek için giriş yapın veya hesap oluşturun.
            </p>

            <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
              <button
                className={
                  customerMode === "login" ? "selected-time" : "time-btn"
                }
                type="button"
                onClick={() => setCustomerMode("login")}
              >
                Giriş
              </button>

              <button
                className={
                  customerMode === "register" ? "selected-time" : "time-btn"
                }
                type="button"
                onClick={() => setCustomerMode("register")}
              >
                Kayıt
              </button>
            </div>

            <form className="reservation-form">
              {customerMode === "register" && (
                <input
                  type="text"
                  placeholder="Ad Soyad"
                  value={customerForm.name}
                  onChange={(e) =>
                    setCustomerForm({ ...customerForm, name: e.target.value })
                  }
                />
              )}

              <input
                type="email"
                placeholder="E-posta Adresi"
                value={customerForm.email}
                onChange={(e) =>
                  setCustomerForm({ ...customerForm, email: e.target.value })
                }
              />

              <input
                type="password"
                placeholder="Şifre"
                value={customerForm.password}
                onChange={(e) =>
                  setCustomerForm({ ...customerForm, password: e.target.value })
                }
              />

              {customerAuthError && (
                <p className="error-message">{customerAuthError}</p>
              )}

              <button
                type="button"
                onClick={async () => {
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
                      });

                    if (authError) {
                      setCustomerAuthError(authError.message);
                      return;
                    }

                    // Check if a customer record already exists for this email
                    // (migration case: user registered before Supabase Auth).
                    const { data: existingCust } = await supabase
                      .from("customers")
                      .select("id, safe_score")
                      .eq("email", customerForm.email)
                      .single();

                    let custId, safeScore;
                    if (existingCust) {
                      // Link existing record to the new Auth user
                      await supabase
                        .from("customers")
                        .update({ auth_user_id: authData.user.id })
                        .eq("id", existingCust.id);
                      custId = existingCust.id;
                      safeScore = existingCust.safe_score || 100;
                    } else {
                      const { data: inserted, error: insertError } = await supabase
                        .from("customers")
                        .insert([{
                          name: customerForm.name,
                          email: customerForm.email,
                          auth_user_id: authData.user.id,
                          safe_score: 100,
                        }])
                        .select("id")
                        .single();

                      if (insertError) {
                        setCustomerAuthError("Hesap oluşturulamadı. Tekrar deneyin.");
                        return;
                      }
                      custId = inserted.id;
                      safeScore = 100;
                    }

                    const newCustomer = {
                      id: custId,
                      name: customerForm.name,
                      email: customerForm.email,
                      safeScore,
                    };
                    setCustomerAuthError("");
                    setLoggedCustomer(newCustomer);
                    setCustomerProfile({ phone: "", gender: "", birthDate: "", job: "", smoking: "" });
                    setEmailVerified(false);
                    setCustomerTab("pending");
                    setPage("customerDashboard");
                  } else {
                    const { data: authData, error: authError } =
                      await supabase.auth.signInWithPassword({
                        email: customerForm.email,
                        password: customerForm.password,
                      });

                    if (authError) {
                      setCustomerAuthError("Hatalı e-posta veya şifre.");
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
                    setEmailVerified(!!authData.user.email_confirmed_at);
                    setPage("customerDashboard");
                  }
                }}
              >
                {customerMode === "login" ? "Giriş Yap" : "Hesap Oluştur"}
              </button>
            </form>
          </div>
        </section>
      )}

      {page === "customerDashboard" && (
        <section className="reservation-section">
          <div className="reservation-box">
            <h1>Müşteri Paneli</h1>

            {loggedCustomer ? (
              <>
                <p className="description">Hoş geldiniz, {loggedCustomer.name}</p>
                <button
                  className="dashboard-create-btn"
                  onClick={() => {
                    setCustomerTab("pending");
                    goToReservationFlow();
                  }}
                >
                  + Yeni Rezervasyon Oluştur
                </button>

                <div className="panel-tabs">
                  <button
                    className={customerTab === "pending" ? "active-tab" : ""}
                    onClick={() => setCustomerTab("pending")}
                  >
                    Bekleyen
                  </button>

                  <button
                    className={customerTab === "accepted" ? "active-tab" : ""}
                    onClick={() => setCustomerTab("accepted")}
                  >
                    Kabul Edildi
                  </button>

                  <button
                    className={customerTab === "rejected" ? "active-tab" : ""}
                    onClick={() => setCustomerTab("rejected")}
                  >
                    Reddedildi
                  </button>

                  <button
                    className={customerTab === "statistics" ? "active-tab" : ""}
                    onClick={() => setCustomerTab("statistics")}
                  >
                    İstatistikler
                  </button>
                  <button
                    className={customerTab === "profile" ? "active-tab" : ""}
                    onClick={() => setCustomerTab("profile")}
                  >
                    Profil
                  </button>

                  <button
                    className={
                      customerTab === "notifications" ? "active-tab" : ""
                    }
                    onClick={() => setCustomerTab("notifications")}
                  >
                    Bildirimler
                  </button>
                </div>

                {customerTab === "statistics" && (() => {
                  const myRezs = reservations.filter(rez => rez.email === loggedCustomer.email);
                  const total = myRezs.length;
                  const completed = myRezs.filter(r => r.status === "completed").length;
                  const noshow = myRezs.filter(r => r.status === "no-show").length;
                  const accepted = myRezs.filter(r => r.status === "accepted").length;
                  const pending = myRezs.filter(r => r.status === "pending").length;
                  const rejected = myRezs.filter(r => r.status === "rejected").length;
                  const cancelled = myRezs.filter(r => r.status === "cancelled").length;
                  return (
                    <div style={{ marginTop: 20 }}>
                      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
                        <div className="stat-card"><span className="stat-icon">📋</span><span>Toplam</span><strong><AnimatedNumber value={total} /></strong></div>
                        <div className="stat-card"><span className="stat-icon">✅</span><span>Tamamlandı</span><strong><AnimatedNumber value={completed} /></strong></div>
                        <div className="stat-card"><span className="stat-icon">⏳</span><span>Bekleyen</span><strong><AnimatedNumber value={pending} /></strong></div>
                        <div className="stat-card"><span className="stat-icon">👍</span><span>Kabul</span><strong><AnimatedNumber value={accepted} /></strong></div>
                        <div className="stat-card"><span className="stat-icon">❌</span><span>No Show</span><strong><AnimatedNumber value={noshow} /></strong></div>
                        <div className="stat-card"><span className="stat-icon">🚫</span><span>İptal</span><strong><AnimatedNumber value={rejected + cancelled} /></strong></div>
                      </div>
                      {total > 0 && (
                        <div className="reservation-box" style={{ marginTop: 16 }}>
                          <h3 style={{ marginBottom: 16 }}>Rezervasyon Dağılımı</h3>
                          {[
                            { label: "Tamamlandı", val: completed, color: "green" },
                            { label: "Kabul Bekliyor", val: pending + accepted, color: "" },
                            { label: "No Show", val: noshow, color: "orange" },
                            { label: "İptal/Red", val: rejected + cancelled, color: "pink" },
                          ].map(item => item.val > 0 && (
                            <div className="progress-row" key={item.label}>
                              <div className="progress-label">
                                <span>{item.label}</span>
                                <strong>{item.val} ({Math.round(item.val/total*100)}%)</strong>
                              </div>
                              <ProgressBar percent={Math.round(item.val/total*100)} color={item.color} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
                {customerTab === "profile" && (
                  <div
                    className="reservation-box"
                    style={{ marginTop: "20px" }}
                  >
                    <h2>Müşteri Profili</h2>
                    <div className="safe-score-box">
                      <div
                        className="safe-score-circle"
                        style={{
                          "--score": loggedCustomer?.safeScore ?? 100,
                        }}
                      >
                        <div className="safe-score-inner">
                          <strong>{loggedCustomer?.safeScore ?? 100}%</strong>
                          <span>Güven Puanı</span>
                        </div>
                      </div>

                      <p className="description">
                        Güven puanınız rezervasyonlara katıldığınızda artar, kaçırdığınızda azalır.
                      </p>
                    </div>
                    <p className="description">
                      Güven puanınız rezervasyon güvenilirliğinizi yansıtır. Daha yüksek puan,
                      gelecekteki rezervasyonların kabul edilme şansını artırır.
                    </p>

                    <p className="description">
                      Bu alanlar isteğe bağlıdır. Profilinizi istediğiniz zaman tamamlayabilirsiniz.
                    </p>

                    <form className="reservation-form">
                      <input
                        type="tel"
                        placeholder="Telefon Numarası"
                        value={customerProfile.phone}
                        onChange={(e) =>
                          setCustomerProfile({
                            ...customerProfile,
                            phone: e.target.value,
                          })
                        }
                      />

                      <h3>Cinsiyet</h3>

                      <div className="time-slots">
                        <button
                          type="button"
                          className={
                            customerProfile.gender === "Male"
                              ? "profile-option selected-time"
                              : "profile-option time-btn"
                          }
                          onClick={() =>
                            setCustomerProfile({
                              ...customerProfile,
                              gender: "Male",
                            })
                          }
                        >
                          {customerProfile.gender === "Male" ? "✓ " : ""}Erkek
                        </button>

                        <button
                          type="button"
                          className={
                            customerProfile.gender === "Female"
                              ? "profile-option selected-time"
                              : "profile-option time-btn"
                          }
                          onClick={() =>
                            setCustomerProfile({
                              ...customerProfile,
                              gender: "Female",
                            })
                          }
                        >
                          {customerProfile.gender === "Female" ? "✓ " : ""}Kadın
                        </button>

                        <button
                          type="button"
                          className={
                            customerProfile.gender === "Prefer not to say"
                              ? "profile-option selected-time"
                              : "profile-option time-btn"
                          }
                          onClick={() =>
                            setCustomerProfile({
                              ...customerProfile,
                              gender: "Prefer not to say",
                            })
                          }
                        >
                          {customerProfile.gender === "Prefer not to say" ? "✓ " : ""}Belirtmek istemiyorum
                        </button>
                      </div>
                      <h3 style={{ marginTop: "20px" }}>Doğum Tarihi</h3>
                      <input
                        type="date"
                        value={customerProfile.birthDate}
                        onChange={(e) =>
                          setCustomerProfile({
                            ...customerProfile,
                            birthDate: e.target.value,
                          })
                        }
                      />

                      <input
                        type="text"
                        placeholder="Meslek"
                        value={customerProfile.job}
                        onChange={(e) =>
                          setCustomerProfile({
                            ...customerProfile,
                            job: e.target.value,
                          })
                        }
                      />

                      <h3 style={{ marginTop: "20px" }}>Sigara Tercihi</h3>

                      <div className="time-slots">
                        <button
                          type="button"
                          className={
                            customerProfile.smoking === "Smoker"
                              ? "profile-option selected-time"
                              : "profile-option time-btn"
                          }
                          onClick={() =>
                            setCustomerProfile({
                              ...customerProfile,
                              smoking: "Smoker",
                            })
                          }
                        >
                          {customerProfile.smoking === "Smoker" ? "✓ " : ""}İçiyor
                        </button>

                        <button
                          type="button"
                          className={
                            customerProfile.smoking === "Non-smoker"
                              ? "profile-option selected-time"
                              : "profile-option time-btn"
                          }
                          onClick={() =>
                            setCustomerProfile({
                              ...customerProfile,
                              smoking: "Non-smoker",
                            })
                          }
                        >
                          {customerProfile.smoking === "Non-smoker" ? "✓ " : ""}İçmiyor
                        </button>

                        <button
                          type="button"
                          className={
                            customerProfile.smoking === "No preference"
                              ? "profile-option selected-time"
                              : "profile-option time-btn"
                          }
                          onClick={() =>
                            setCustomerProfile({
                              ...customerProfile,
                              smoking: "No preference",
                            })
                          }
                        >
                          {customerProfile.smoking === "No preference" ? "✓ " : ""}Fark Etmez
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={async () => {
                          const updatedCustomer = {
                            ...loggedCustomer,
                            profile: customerProfile,
                          };
                          const { error } = await supabase
                            .from("customers")
                            .update({
                              phone: customerProfile.phone,
                              gender: customerProfile.gender,
                              birth_date: customerProfile.birthDate,
                              job: customerProfile.job,
                              smoking: customerProfile.smoking,
                            })
                            .eq("email", loggedCustomer.email);

                          if (error) {
                            console.log("Profile update error:", error);
                            alert("Profil kaydedilemedi.");
                            return;
                          }

                          setLoggedCustomer(updatedCustomer);

                          setRegisteredCustomers(
                            registeredCustomers.map((customer) =>
                              customer.email === loggedCustomer.email
                                ? updatedCustomer
                                : customer,
                            ),
                          );

                          alert("Profil başarıyla kaydedildi.");
                        }}
                      >
                        Profili Kaydet
                      </button>
                    </form>
                  </div>
                )}

                {customerTab === "notifications" && (
                  <div
                    className="reservation-box"
                    style={{ marginTop: "20px" }}
                  >
                    <h2>Bildirimler</h2>

                    {reservations.filter(
                      (rez) =>
                        rez.email === loggedCustomer.email &&
                        rez.businessMessage &&
                        rez.status !== "cancelled",
                    ).length > 0 ? (
                      reservations
                        .filter(
                          (rez) =>
                            rez.email === loggedCustomer.email &&
                            rez.businessMessage &&
                            rez.status !== "cancelled",
                        )
                        .map((rez) => (
                          <div
                            className="accepted-list-item"
                            key={rez.id}
                            onClick={() => setSelectedReservation(rez)}
                          >
                            <div>
                              <strong>{rez.business}</strong>

                              <p style={{ marginTop: "6px", color: "#cbd5e1" }}>
                                {formatDate(rez.date)} - {rez.time}
                              </p>

                              <p style={{ marginTop: "6px", color: "#cbd5e1" }}>
                                {rez.status === "accepted"
                                  ? "Rezervasyon kabul edildi"
                                  : "Rezervasyon reddedildi"}
                              </p>

                              <p style={{ marginTop: "8px", color: "#e5e7eb" }}>
                                {rez.businessMessage}
                              </p>
                            </div>

                            {rez.status === "pending" ? (
                              <button
                                type="button"
                                className="cancel-reservation-btn"
                                disabled={loadingReservationId === rez.id}
                                onClick={async (e) => {
                                  setLoadingReservationId(rez.id);

                                  e.stopPropagation();

                                  if (
                                    !window.confirm("Bu rezervasyonu iptal etmek istiyor musunuz?")
                                  ) {
                                    setLoadingReservationId(null);
                                    return;
                                  }

                                  const { error } = await supabase
                                    .from("reservations")
                                    .update({
                                      status: "cancelled",
                                    })
                                    .eq("id", rez.id);

                                  setLoadingReservationId(null);

                                  if (error) {
                                    alert("Rezervasyon iptal edilemedi.");
                                    return;
                                  }

                                  setReservations(
                                    reservations.map((item) =>
                                      item.id === rez.id
                                        ? { ...item, status: "cancelled", businessMessage: "" }
                                        : item,
                                    ),
                                  );
                                }}
                              >
                                {loadingReservationId === rez.id ? <><Spinner />Yükleniyor</> : "İptal Et"}
                              </button>
                            ) : (
                              <StatusBadge status={rez.status} />
                            )}
                          </div>
                        ))
                    ) : (
                      <p className="description">Henüz bildirim yok.</p>
                    )}
                  </div>
                )}
                {customerTab !== "statistics" && customerTab !== "profile" && (
                  <>
                    {reservations.filter(
                      (rez) =>
                        rez.email === loggedCustomer.email &&
                        rez.status === customerTab,
                    ).length > 0 ? (
                      reservations
                        .filter(
                          (rez) =>
                            rez.email === loggedCustomer.email &&
                            rez.status === customerTab,
                        )
                        .map((rez) => (
                          <div
                            className="accepted-list-item"
                            key={rez.id}
                            onClick={() => setSelectedReservation(rez)}
                          >
                            <div>
                              <strong>{rez.business}</strong>

                              <p style={{ marginTop: "6px", color: "#cbd5e1" }}>
                                {formatDate(rez.date)} - {rez.time}
                              </p>

                              <p style={{ marginTop: "6px", color: "#cbd5e1" }}>
                                {rez.guests} misafir
                              </p>
                            </div>

                            {rez.status === "pending" ? (
                              <button
                                type="button"
                                className="cancel-reservation-btn"
                                onClick={async (e) => {
                                  e.stopPropagation();

                                  if (
                                    !window.confirm("Bu rezervasyonu iptal etmek istiyor musunuz?")
                                  ) {
                                    return;
                                  }

                                  const { error } = await supabase
                                    .from("reservations")
                                    .update({
                                      status: "cancelled",
                                    })
                                    .eq("id", rez.id);

                                  console.log("Cancel error:", error);
                                  console.log("Rez ID:", rez.id);

                                  if (error) {
                                    alert("Rezervasyon iptal edilemedi.");
                                    return;
                                  }

                                  setReservations(
                                    reservations.map((item) =>
                                      item.id === rez.id
                                        ? { ...item, status: "cancelled", businessMessage: "" }
                                        : item,
                                    ),
                                  );
                                }}
                              >
                                İptal Et
                              </button>
                            ) : (
                              <StatusBadge status={rez.status} />
                            )}
                          </div>
                        ))
                    ) : (
                      <p className="description">
                        {{ pending: "Bekleyen", accepted: "Kabul edilen", rejected: "Reddedilen" }[customerTab] || customerTab} rezervasyon bulunamadı.
                      </p>
                    )}
                  </>
                )}

                <button
                  className="primary-btn"
                  style={{ marginTop: "20px" }}
                  onClick={async () => {
                    await supabase.auth.signOut();
                    setLoggedCustomer(null);
                    setEmailVerified(false);
                    setCustomerForm({ name: "", email: "", password: "" });
                    setCustomerProfile({
                      phone: "",
                      gender: "",
                      birthDate: "",
                      job: "",
                      smoking: "",
                    });
                    setPage("home");
                  }}
                >
                  Çıkış
                </button>
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

            <form className="reservation-form">
              <input
                type="email"
                placeholder="İşletme E-postası"
                value={businessLogin.email}
                onChange={(e) =>
                  setBusinessLogin({ ...businessLogin, email: e.target.value })
                }
              />

              <input
                type="password"
                placeholder="Şifre"
                value={businessLogin.password}
                onChange={(e) =>
                  setBusinessLogin({
                    ...businessLogin,
                    password: e.target.value,
                  })
                }
              />

              {loginError && <p className="error-message">{loginError}</p>}

              <button type="button" onClick={handleBusinessLogin}>
                Giriş Yap
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

            <form className="reservation-form">
              <input
                type="email"
                placeholder="Yönetici E-postası"
                value={adminLogin.email}
                onChange={(e) =>
                  setAdminLogin({ ...adminLogin, email: e.target.value })
                }
              />

              <input
                type="password"
                placeholder="Şifre"
                value={adminLogin.password}
                onChange={(e) =>
                  setAdminLogin({ ...adminLogin, password: e.target.value })
                }
              />

              {adminError && <p className="error-message">{adminError}</p>}

              <button type="button" onClick={handleAdminLogin}>
                Giriş Yap
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
              <strong><AnimatedNumber value={reservations.filter(r => r.status === "no-show").length} /></strong>
            </div>
            <div className="stat-card">
              <span className="stat-icon">🤖</span>
              <span>AI Menu Aktif</span>
              <strong><AnimatedNumber value={adminBusinesses.filter(b => b.aiMenuActive).length} /></strong>
            </div>
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

                    const { data, error } = await supabase
                      .from("businesses")
                      .insert([
                        {
                          name: newBusinessForm.name,
                          email: newBusinessForm.email,
                          password: newBusinessForm.password,
                          reservation_enabled: true,
                          ai_menu_enabled: false,
                        },
                      ])
                      .select();

                    if (error) {
                      console.log("Add business error:", error);
                      alert("Business eklenirken hata oldu.");
                      return;
                    }

                    const addedBusiness = data[0];

                    const formattedBusiness = {
                      id: addedBusiness.id,
                      name: addedBusiness.name,
                      email: addedBusiness.email,
                      password: addedBusiness.password,
                      reservationActive: addedBusiness.reservation_enabled,
                      aiMenuActive: addedBusiness.ai_menu_enabled,
                      menuText: "",
                      description: "",
                      menu: "",
                      phone: "",
                      type: newBusinessForm.type || "Business",
                      location: newBusinessForm.location || "",
                      icon: newBusinessForm.icon || "🏢",
                      availabilityMode: "selected",
                      availableDays: ["Friday", "Saturday"],
                      availableTimes: ["18:00", "19:00", "20:30"],
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

            <table className="admin-table" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>İşletme</th>
                  <th>Tür / Konum</th>
                  <th>Rezervasyon</th>
                  <th>AI Menu</th>
                  <th>İşlemler</th>
                </tr>
              </thead>
              <tbody>
                {adminBusinesses.map((business) => (
                  <tr key={business.id}>
                    <td>
                      <span style={{ fontSize: 20, marginRight: 8 }}>{business.icon}</span>
                      <strong>{business.name}</strong>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{business.email}</div>
                    </td>
                    <td style={{ color: "#94a3b8" }}>
                      {business.type}<br />
                      <span style={{ fontSize: 11 }}>{business.location}</span>
                    </td>
                    <td>
                      <button
                        className={business.reservationActive ? "selected-time" : "time-btn"}
                        style={{ fontSize: 12, padding: "6px 12px" }}
                        onClick={async () => {
                          const newValue = !business.reservationActive;
                          const { error } = await supabase.from("businesses").update({ reservation_enabled: newValue }).eq("id", business.id);
                          if (error) { alert("Güncellenemedi."); return; }
                          setAdminBusinesses(adminBusinesses.map(item => item.id === business.id ? { ...item, reservationActive: newValue } : item));
                        }}
                      >
                        {business.reservationActive ? "✓ Aktif" : "✕ Kapalı"}
                      </button>
                    </td>
                    <td>
                      <button
                        className={business.aiMenuActive ? "selected-time" : "time-btn"}
                        style={{ fontSize: 12, padding: "6px 12px" }}
                        onClick={async () => {
                          const newValue = !business.aiMenuActive;
                          const { error } = await supabase.from("businesses").update({ ai_menu_enabled: newValue }).eq("id", business.id);
                          if (error) { alert("Güncellenemedi."); return; }
                          setAdminBusinesses(adminBusinesses.map(item => item.id === business.id ? { ...item, aiMenuActive: newValue } : item));
                        }}
                      >
                        {business.aiMenuActive ? "✓ Aktif" : "✕ Kapalı"}
                      </button>
                    </td>
                    <td>
                      <button
                        className="reject-btn"
                        style={{ fontSize: 12, padding: "6px 12px" }}
                        onClick={async () => {
                          if (!window.confirm(`${business.name} silinsin mi? Rezervasyonlar da silinecek.`)) return;
                          const { error } = await supabase.from("businesses").delete().eq("id", business.id);
                          if (error) { alert("Silinemedi."); return; }
                          setAdminBusinesses(adminBusinesses.filter(item => item.id !== business.id));
                          setReservations(reservations.filter(rez => rez.businessId !== business.id));
                          if (loggedBusiness?.id === business.id) { setLoggedBusiness(null); setPage("home"); }
                        }}
                      >
                        Sil
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {page === "contact" && (
        <section className="contact-page">
          <div className="contact-hero">
            <div className="contact-hero-icon">💬</div>
            <h1>Yardıma mı İhtiyacınız Var?</h1>
            <p className="contact-hero-desc">
              RezPoint ile ilgili tüm soru, öneri ve destek talepleriniz için bizimle iletişime geçebilirsiniz.
            </p>
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
                <div className="contact-card-label">E-posta</div>
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
            <h2>İşletmenizi RezPoint'e Ekleyin</h2>
            <p>
              İşletmenizi RezPoint ağına dahil etmek, rezervasyon süreçlerinizi dijitalleştirmek
              ve müşterilerinizi daha yakından tanımak için bizimle iletişime geçebilirsiniz.
              Size özel kurulum ve destek süreci için hemen yazın.
            </p>
            <a
              className="primary-btn contact-cta"
              href="mailto:rezpointsupport@gmail.com?subject=RezPoint%20İşletme%20Başvurusu"
              target="_blank"
              rel="noopener noreferrer"
            >
              Başvuru Yap →
            </a>
          </div>

          <button className="back-btn" onClick={() => setPage("home")} style={{ marginTop: 32 }}>
            ← Ana Sayfa
          </button>
        </section>
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
                setLoggedBusiness(null);
                setBusinessLogin({ email: "", password: "" });
                setPage("home");
              }}
            >
              Çıkış
            </button>
          </div>

          <div className="panel-tabs">
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
              Tamamlandı ({getBusinessReservationCount("completed")})
            </button>

            <button
              className={panelTab === "noShow" ? "active-tab" : ""}
              onClick={() => setPanelTab("noShow")}
            >
              No Show ({getBusinessReservationCount("no-show")})
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
          </div>

          <div className="panel-content">
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
                    rez.businessId === loggedBusiness.id,
                ).length > 0 ? (
                  reservations
                    .filter(
                      (rez) =>
                        rez.status === "pending" &&
                        loggedBusiness &&
                        rez.businessId === loggedBusiness.id,
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

                              const { error } = await supabase
                                .from("reservations")
                                .update({ status: "accepted" })
                                .eq("id", rez.id)
                                .select();

                              if (error) {
                                alert("Rezervasyon kabul edilemedi.");
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

                              const { error } = await supabase
                                .from("reservations")
                                .update({ status: "rejected" })
                                .eq("id", rez.id);

                              setLoadingReservationId(null);

                              if (error) {
                                alert("Rezervasyon reddedilemedi.");
                                return;
                              }

                              setReservations(
                                reservations.map((item) =>
                                  item.id === rez.id
                                    ? { ...item, status: "rejected", businessMessage: "İşletmemizde uygun masa bulunmamaktadır, yine bekleriz ❤️" }
                                    : item,
                                ),
                              );
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
                <p className="description">
                  Kabul edilen rezervasyonları görmek için tarih seçin.
                </p>

                <div className="time-slots">
                  {getAvailableDates().map((date) => {
                    const count = reservations.filter(
                      (rez) =>
                        rez.status === "accepted" &&
                        rez.date === date.fullDate &&
                        loggedBusiness &&
                        rez.businessId === loggedBusiness.id,
                    ).length;

                    return (
                      <button
                        key={date.fullDate}
                        className={
                          selectedAcceptedDate === date.fullDate
                            ? "selected-time"
                            : "time-btn"
                        }
                        onClick={() => setSelectedAcceptedDate(date.fullDate)}
                      >
                        {date.display}
                        <br />
                        <small>{count} rezervasyon</small>
                      </button>
                    );
                  })}
                </div>

                {selectedAcceptedDate && (
                  <div style={{ marginTop: "25px" }}>
                    <h3>{formatDate(selectedAcceptedDate)}</h3>

                    {reservations.filter(
                      (rez) =>
                        rez.status === "accepted" &&
                        rez.date === selectedAcceptedDate &&
                        loggedBusiness &&
                        rez.businessId === loggedBusiness.id,
                    ).length > 0 ? (
                      reservations
                        .filter(
                          (rez) =>
                            rez.status === "accepted" &&
                            rez.date === selectedAcceptedDate &&
                            loggedBusiness &&
                            rez.businessId === loggedBusiness.id,
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
                              <p style={{ marginTop: "6px", color: "#cbd5e1" }}>
                                {rez.guests} misafir
                              </p>
                            </div>

                            <button
                              type="button"
                              className={
                                checkedInReservations.includes(rez.id)
                                  ? "checkin-btn checked"
                                  : "checkin-btn"
                              }
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();

                                setCheckedInReservations((prev) =>
                                  prev.includes(rez.id)
                                    ? prev.filter((id) => id !== rez.id)
                                    : [...prev, rez.id],
                                );
                              }}
                            >
                              ✓
                            </button>
                          </div>
                        ))
                    ) : (
                      <p className="description">
                        Bu tarih için kabul edilen rezervasyon yok.
                      </p>
                    )}
                    <button
                      className="close-day-btn"
                      onClick={closeDayReservations}
                    >
                      Günü Kapat
                    </button>
                  </div>
                )}
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
                    rez.businessId === loggedBusiness.id,
                ).length > 0 ? (
                  reservations
                    .filter(
                      (rez) =>
                        rez.status === "rejected" &&
                        loggedBusiness &&
                        rez.businessId === loggedBusiness.id,
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
                          <p style={{ marginTop: "6px", color: "#cbd5e1" }}>
                            {formatDate(rez.date)}
                          </p>
                          <p style={{ marginTop: "6px", color: "#cbd5e1" }}>
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
                    loggedBusiness &&
                    rez.businessId === loggedBusiness.id,
                ).length > 0 ? (
                  reservations
                    .filter(
                      (rez) =>
                        rez.status === "completed" &&
                        loggedBusiness &&
                        rez.businessId === loggedBusiness.id,
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
                          <p style={{ marginTop: "6px", color: "#cbd5e1" }}>
                            {formatDate(rez.date)}
                          </p>
                        </div>

                        <span>✓ Tamamlandı</span>
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
                    rez.status === "no-show" &&
                    loggedBusiness &&
                    rez.businessId === loggedBusiness.id,
                ).length > 0 ? (
                  reservations
                    .filter(
                      (rez) =>
                        rez.status === "no-show" &&
                        loggedBusiness &&
                        rez.businessId === loggedBusiness.id,
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
                          <p style={{ marginTop: "6px", color: "#cbd5e1" }}>
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
                    className={
                      availabilityMode === "everyday"
                        ? "selected-time"
                        : "time-btn"
                    }
                    onClick={() => setAvailabilityMode("everyday")}
                  >
                    Her Gün
                  </button>

                  <button
                    className={
                      availabilityMode === "selected"
                        ? "selected-time"
                        : "time-btn"
                    }
                    onClick={() => setAvailabilityMode("selected")}
                  >
                    Seçili Günler
                  </button>
                </div>

                {availabilityMode === "selected" && (
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
                        <button
                          key={value}
                          className={
                            availableDays.includes(value)
                              ? "selected-time"
                              : "time-btn"
                          }
                          onClick={() => {
                            if (availableDays.includes(value)) {
                              setAvailableDays(
                                availableDays.filter((d) => d !== value),
                              );
                            } else {
                              setAvailableDays([...availableDays, value]);
                            }
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <h3 style={{ marginTop: "24px" }}>Müsait Saatler</h3>
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

                    const { error } = await supabase
                      .from("businesses")
                      .update({
                        availability_mode: availabilityMode,
                        available_days: availableDays.join(","),
                        available_times: availableTimes.join(","),
                      })
                      .eq("id", loggedBusiness.id);

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
                  {businessProfileSaved && (
                    <p style={{ color: "#86efac", fontWeight: "bold", marginTop: 8 }}>{businessProfileSaved}</p>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      if (!loggedBusiness) return;

                      // Step 1: Save name & location (columns guaranteed to exist)
                      const { error: basicError } = await supabase
                        .from("businesses")
                        .update({
                          name: businessProfileForm.name,
                          location: businessProfileForm.location,
                        })
                        .eq("id", loggedBusiness.id);

                      if (basicError) {
                        console.log("Business profile save error:", basicError);
                        alert("Profil kaydedilemedi: " + basicError.message);
                        return;
                      }

                      // Step 2: Try to save description/menu/phone via menu_text (optional column)
                      const menuData = JSON.stringify({
                        description: businessProfileForm.description,
                        menu: businessProfileForm.menu,
                        phone: businessProfileForm.phone,
                      });
                      const { error: menuError } = await supabase
                        .from("businesses")
                        .update({ menu_text: menuData })
                        .eq("id", loggedBusiness.id);

                      const updatedBusiness = {
                        ...loggedBusiness,
                        name: businessProfileForm.name,
                        location: businessProfileForm.location,
                        phone: businessProfileForm.phone,
                        description: businessProfileForm.description,
                        menu: businessProfileForm.menu,
                        menuText: menuError ? loggedBusiness.menuText : menuData,
                      };
                      setLoggedBusiness(updatedBusiness);
                      setAdminBusinesses((prev) =>
                        prev.map((b) => b.id === loggedBusiness.id ? updatedBusiness : b)
                      );

                      if (menuError) {
                        setBusinessProfileSaved("İsim/konum kaydedildi ✅ — Açıklama/menü için Supabase'de şu SQL'i çalıştırın: ALTER TABLE businesses ADD COLUMN menu_text text;");
                      } else {
                        setBusinessProfileSaved("Profil başarıyla kaydedildi ✅");
                      }
                      setTimeout(() => setBusinessProfileSaved(""), 8000);
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
                      Kabul edilen rezervasyonlardan elde edilen müşteri analizleri.
                    </p>
                  </div>
                  <div className="insight-total-badge">
                    <AnimatedNumber value={getBusinessAcceptedReservations().length} /> kabul
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
          </div>
        </section>
      )}

      {selectedBusinessInfo && (
        <div className="popup-overlay" onClick={() => setSelectedBusinessInfo(null)}>
          <div className="popup-box business-info-popup" onClick={(e) => e.stopPropagation()}>
            <div className="business-info-icon">{selectedBusinessInfo.icon}</div>
            <h2>{selectedBusinessInfo.name}</h2>
            <p style={{ color: "#94a3b8", marginBottom: 20 }}>{selectedBusinessInfo.type} · {selectedBusinessInfo.location}</p>

            {selectedBusinessInfo.phone && (
              <div className="card-row">
                <span>📞 Telefon</span>
                <strong>{selectedBusinessInfo.phone}</strong>
              </div>
            )}

            {selectedBusinessInfo.description ? (
              <div className="business-info-section">
                <div className="business-info-label">📋 Hakkımızda</div>
                <p className="business-info-text">{selectedBusinessInfo.description}</p>
              </div>
            ) : (
              <p className="business-info-empty">Açıklama henüz girilmemiş.</p>
            )}

            {selectedBusinessInfo.menu ? (
              <div className="business-info-section">
                <div className="business-info-label">🍽 Menü</div>
                {selectedBusinessInfo.menu.startsWith("http") ? (
                  <a
                    href={selectedBusinessInfo.menu}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="business-info-link"
                  >
                    Menüyü Görüntüle →
                  </a>
                ) : (
                  <p className="business-info-text">{selectedBusinessInfo.menu}</p>
                )}
              </div>
            ) : (
              <p className="business-info-empty">Menü henüz eklenmemiş.</p>
            )}

            <button
              className="primary-btn"
              style={{ marginTop: 20 }}
              onClick={() => setSelectedBusinessInfo(null)}
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      {selectedReservation && (
        <div className="popup-overlay">
          <div className="popup-box">
            <h2>Rezervasyon Detayları</h2>

            <div className="card-row">
              <span>İsim</span>
              <strong>{selectedReservation.fullName}</strong>
            </div>

            <div className="card-row">
              <span>E-posta</span>
              <strong>{selectedReservation.email}</strong>
            </div>

            <div className="card-row">
              <span>Telefon</span>
              <strong>{selectedReservation.phone}</strong>
            </div>

            <div className="card-row">
              <span>İşletme</span>
              <strong>{selectedReservation.business}</strong>
            </div>

            <div className="card-row">
              <span>Tarih</span>
              <strong>{formatDate(selectedReservation.date)}</strong>
            </div>

            <div className="card-row">
              <span>Saat</span>
              <strong>{selectedReservation.time}</strong>
            </div>

            <div className="card-row">
              <span>Misafir</span>
              <strong>{selectedReservation.guests}</strong>
            </div>

            <div className="card-row">
              <span>Durum</span>
              <strong>{selectedReservation.status}</strong>
            </div>
            <div className="card-row">
              <span>Güven Puanı</span>
              <strong>{selectedReservation.safeScore ?? 100}/100</strong>
            </div>
            <div className="card-row">
              <span>Rezervasyon Kodu</span>
              <strong style={{ color: "#a855f7" }}>
                {selectedReservation.code}
              </strong>
            </div>

            <div className="card-row">
              <span>Cinsiyet</span>
              <strong>
                {selectedReservation.customerProfile?.gender || "Belirtilmedi"}
              </strong>
            </div>

            <div className="card-row">
              <span>Doğum Tarihi</span>
              <strong>
                {selectedReservation.customerProfile?.birthDate ||
                  "Belirtilmedi"}
              </strong>
            </div>

            <div className="card-row">
              <span>Meslek</span>
              <strong>
                {selectedReservation.customerProfile?.job || "Belirtilmedi"}
              </strong>
            </div>

            <div className="card-row">
              <span>Sigara</span>
              <strong>
                {selectedReservation.customerProfile?.smoking || "Belirtilmedi"}
              </strong>
            </div>
            <div className="card-row">
              <span>Not</span>
              <strong>{selectedReservation.note || "Not yok"}</strong>
            </div>

            <button
              className="primary-btn"
              style={{ marginTop: "20px" }}
              onClick={() => setSelectedReservation(null)}
            >
              Kapat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
