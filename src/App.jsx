import { useState, useEffect } from "react";
import "./App.css";
import logo from "./assets/logo.png";
import { supabase } from "./supabaseClient";



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

  const [customerMode, setCustomerMode] = useState("login");
  const [registeredCustomers, setRegisteredCustomers] = useState([]);
  const [customerAuthError, setCustomerAuthError] = useState("");
  const [loggedCustomer, setLoggedCustomer] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [logoClickCount, setLogoClickCount] = useState(0);
  const [loggedBusiness, setLoggedBusiness] = useState(null);
  const [isCreatingReservation, setIsCreatingReservation] = useState(false);

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

  useEffect(() => {
    const testSupabase = async () => {
      const { data, error } = await supabase.from("businesses").select("*");
      if (data) {
        const formattedBusinesses = data.map((business) => ({
          id: business.id,
          name: business.name,
          email: business.email,
          password: business.password,
          reservationActive: business.reservation_enabled,
          aiMenuActive: business.ai_menu_enabled,
          menuText: business.menu_text || "",
          type: business.type || "Business",
          location: business.location || "",
          icon: business.icon || "🏢",
        }));

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
            customerProfile: {
              gender: rez.gender,
              birthDate: rez.birth_date,
              job: rez.job,
              smoking: rez.smoking,
            },
          }));

          setReservations(formattedReservations);
        }

        setAdminBusinesses(formattedBusinesses);
      }

      console.log("DATA:", data);
      console.log("ERROR:", error);
    };

    testSupabase();
  }, []);

  function formatDate(dateValue) {
    if (!dateValue) return "Choose date";

    const date = new Date(dateValue);

    return date.toLocaleDateString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      weekday: "long",
    });
  }

  function getAvailableDates() {
    const dates = [];

    for (let i = 0; i < 14; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);

      const dayName = date.toLocaleDateString("en-US", {
        weekday: "long",
      });

      const shouldInclude =
        availabilityMode === "everyday" || availableDays.includes(dayName);

      if (shouldInclude) {
        dates.push({
          fullDate: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
          display: date.toLocaleDateString("tr-TR", {
            day: "2-digit",
            month: "2-digit",
            weekday: "long",
          }),
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
      const dayName = new Date(rez.date).toLocaleDateString("tr-TR", {
        weekday: "long",
      });

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
    if (!birthDate) return "Not provided";

    const birth = new Date(birthDate);
    const today = new Date();

    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birth.getDate())
    ) {
      age--;
    }

    if (age < 18) return "Under 18";
    if (age <= 24) return "18-24";
    if (age <= 34) return "25-34";
    if (age <= 44) return "35-44";
    return "45+";
  }

  function getDistributionList(field) {
    const accepted = getBusinessAcceptedReservations();
    const map = {};

    accepted.forEach((rez) => {
      let value = "Not provided";

      if (field === "age") {
        value = getAgeGroup(rez.customerProfile?.birthDate);
      } else {
        value = rez.customerProfile?.[field] || "Not provided";
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
      setError("Please login before creating a reservation.");
      setCustomerMode("login");
      setPage("customerAuth");
      return;
    }

    if (reservation.phone === "")
      return setError("Please enter your phone number.");
    if (reservation.date === "") return setError("Please select a date.");
    if (reservation.time === "") return setError("Please select a time.");
    if (reservation.guests === "")
      return setError("Please enter number of guests.");

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
      setLoginError("");
      setPanelTab("incoming");
      setPage("businessPanel");
    } else {
      setLoginError("Wrong email or password.");
    }
  }

  function handleAdminLogin() {
    if (
      adminLogin.email === "admin@rezpoint.com" &&
      adminLogin.password === "0000"
    ) {
      setAdminError("");
      setPage("adminPanel");
    } else {
      setAdminError("Wrong admin email or password.");
    }
  }
  async function closeDayReservations() {
    const password = prompt("Enter security code to close the day:");

    if (password !== "0000") {
      alert("Wrong security code.");
      return;
    }
    if (
      !window.confirm(
        "Close this day? Checked customers will be marked as completed, unchecked customers as no-show.",
      )
    ) {
      return;
    }
    if (!selectedAcceptedDate) {
      alert("Please select a date first.");
      return;
    }

    const targetReservations = reservations.filter(
      (rez) =>
        rez.businessId === loggedBusiness.id &&
        rez.status === "accepted" &&
        rez.date === selectedAcceptedDate,
    );

    for (const rez of targetReservations) {
      const newStatus = checkedInReservations.includes(rez.id)
        ? "completed"
        : "no-show";

      const { error } = await supabase
        .from("reservations")
        .update({
          status: newStatus,
        })
        .eq("id", rez.id);

      if (error) {
        console.log("Close day error:", error);
        alert("Close Day işlemi sırasında hata oldu.");
        return;
      }
    }

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

    const dayReservations = reservations.filter(
      (rez) =>
        rez.businessId === loggedBusiness.id &&
        rez.status === "accepted" &&
        rez.date === selectedAcceptedDate,
    );

    setRegisteredCustomers((prevCustomers) =>
      prevCustomers.map((customer) => {
        const customerDayReservations = dayReservations.filter(
          (rez) => rez.email === customer.email,
        );

        if (customerDayReservations.length === 0) return customer;

        let scoreChange = 0;

        customerDayReservations.forEach((rez) => {
          if (checkedInReservations.includes(rez.id)) {
            scoreChange += 4;
          } else {
            scoreChange -= 8;
          }
        });

        const currentScore = customer.safeScore ?? 100;
        const newScore = Math.max(0, Math.min(100, currentScore + scoreChange));

        if (loggedCustomer && loggedCustomer.email === customer.email) {
          setLoggedCustomer({
            ...customer,
            safeScore: newScore,
          });
        }

        return {
          ...customer,
          safeScore: newScore,
        };
      }),
    );

    setCheckedInReservations([]);
    alert("Day closed successfully.");
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
            Create Reservation
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
            {loggedCustomer ? "My Account" : "Customer Login"}
          </button>

          <button
            className="nav-button"
            onClick={() => {
              setPage("businessLogin");
              setMobileMenuOpen(false);
            }}
          >
            Business Login
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
            <p className="badge">AI Powered Reservation System</p>
            <h1>Smart reservations for modern businesses.</h1>
            <p className="description">
              Customers choose a business, select a date and time, then create a
              reservation in seconds.
            </p>

            <button
              className="hero-reservation-btn"
              onClick={goToReservationFlow}
            >
              Create Reservation
            </button>
          </div>

          <div className="hero-card">
            <h3>How it works</h3>
            <div className="card-row">
              <span>1</span>
              <strong>Login or create account</strong>
            </div>
            <div className="card-row">
              <span>2</span>
              <strong>Choose business</strong>
            </div>
            <div className="card-row">
              <span>3</span>
              <strong>Send request</strong>
            </div>
          </div>
        </section>
      )}

      {page === "businesses" && (
        <section className="business-section">
          <button className="back-btn" onClick={() => setPage("home")}>
            ← Back
          </button>

          <h1>Choose a business</h1>
          <p className="description">
            Select where you want to create your reservation.
          </p>

          <div className="business-grid">
            {adminBusinesses
              .filter((business) => business.reservationActive)
              .map((business) => (
                <div className="business-card" key={business.id}>
                  <div className="business-icon">{business.icon}</div>
                  <h3>{business.name}</h3>
                  <p>{business.type}</p>
                  <span>{business.location}</span>

                  <button onClick={() => openReservationForm(business)}>
                    Select Business
                  </button>
                </div>
              ))}
          </div>
        </section>
      )}

      {page === "reservation" && selectedBusiness && loggedCustomer && (
        <section className="reservation-section">
          <button className="back-btn" onClick={() => setPage("businesses")}>
            ← Back
          </button>

          <div className="reservation-box">
            <h1>{selectedBusiness.name}</h1>
            <p className="description">
              Create your reservation request as{" "}
              <strong>{loggedCustomer.name}</strong>.
            </p>

            <form className="reservation-form">
              <div className="card-row">
                <span>Name</span>
                <strong>{loggedCustomer.name}</strong>
              </div>

              <div className="card-row">
                <span>Email</span>
                <strong>{loggedCustomer.email}</strong>
              </div>

              <input
                name="phone"
                value={reservation.phone}
                onChange={handleChange}
                type="tel"
                placeholder="Phone Number"
              />

              <p>
                Selected Date: <strong>{formatDate(reservation.date)}</strong>
              </p>

              <div className="time-slots">
                {getAvailableDates().map((date) => (
                  <button
                    key={date.fullDate}
                    type="button"
                    className={
                      reservation.date === date.fullDate
                        ? "selected-time"
                        : "time-btn"
                    }
                    onClick={() =>
                      setReservation({ ...reservation, date: date.fullDate })
                    }
                  >
                    {date.display}
                  </button>
                ))}
              </div>

              <p>
                Selected Time:{" "}
                <strong>{reservation.time || "Choose time"}</strong>
              </p>

              <div className="time-slots">
                {availableTimes.map((time) => (
                  <button
                    key={time}
                    type="button"
                    className={
                      reservation.time === time ? "selected-time" : "time-btn"
                    }
                    onClick={() => setReservation({ ...reservation, time })}
                  >
                    {time}
                  </button>
                ))}
              </div>

              <input
                name="guests"
                value={reservation.guests}
                onChange={handleChange}
                type="number"
                placeholder="Number of guests"
                min="1"
              />

              <textarea
                name="note"
                value={reservation.note}
                onChange={handleChange}
                placeholder="Note, table preference or special request"
              ></textarea>

              {error && <p className="error-message">{error}</p>}

              <button type="button" onClick={sendReservation}>
                Send Reservation Request
              </button>
            </form>
          </div>
        </section>
      )}

      {page === "summary" && selectedBusiness && loggedCustomer && (
        <section className="reservation-section">
          <div className="reservation-box">
            <h1>Reservation Summary</h1>
            <p className="description">Your request has been created.</p>

            <div className="card-row">
              <span>Business</span>
              <strong>{selectedBusiness.name}</strong>
            </div>
            <div className="card-row">
              <span>Name</span>
              <strong>{loggedCustomer.name}</strong>
            </div>
            <div className="card-row">
              <span>Email</span>
              <strong>{loggedCustomer.email}</strong>
            </div>
            <div className="card-row">
              <span>Phone</span>
              <strong>{reservation.phone}</strong>
            </div>
            <div className="card-row">
              <span>Date</span>
              <strong>{formatDate(reservation.date)}</strong>
            </div>
            <div className="card-row">
              <span>Time</span>
              <strong>{reservation.time}</strong>
            </div>
            <div className="card-row">
              <span>Guests</span>
              <strong>{reservation.guests}</strong>
            </div>
            <div className="card-row">
              <span>Note</span>
              <strong>{reservation.note || "No note"}</strong>
            </div>

            <button
              className="primary-btn"
              disabled={isCreatingReservation}
              onClick={async () => {
                if (isCreatingReservation) return;

                setIsCreatingReservation(true);
                const newCode = generateReservationCode();
                setReservationCode(newCode);

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
                    gender: customerProfile.gender,
                    birthDate: customerProfile.birthDate,
                    job: customerProfile.job,
                    smoking: customerProfile.smoking,
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

                    gender: customerProfile.gender,
                    birth_date: customerProfile.birthDate,
                    job: customerProfile.job,
                    smoking: customerProfile.smoking,

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
                ? "Creating Reservation..."
                : "Confirm & Send"}
            </button>
          </div>
        </section>
      )}

      {page === "success" && selectedBusiness && loggedCustomer && (
        <section className="reservation-section">
          <div className="reservation-box">
            <h1>Reservation Sent ✅</h1>

            <p className="description">
              Your reservation request has been sent to {selectedBusiness.name}.
              The business will review your request.
            </p>

            <div className="card-row">
              <span>Reservation Code</span>
              <strong>{reservationCode}</strong>
            </div>

            <p className="description">
              Reservation code sent to: <strong>{loggedCustomer.email}</strong>
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
              Go to My Reservations
            </button>
          </div>
        </section>
      )}

      {page === "customerAuth" && (
        <section className="reservation-section">
          <div className="reservation-box">
            <h1>
              {customerMode === "login" ? "Customer Login" : "Create Account"}
            </h1>

            <p className="description">
              Login or create an account to manage your reservations.
            </p>

            <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
              <button
                className={
                  customerMode === "login" ? "selected-time" : "time-btn"
                }
                type="button"
                onClick={() => setCustomerMode("login")}
              >
                Login
              </button>

              <button
                className={
                  customerMode === "register" ? "selected-time" : "time-btn"
                }
                type="button"
                onClick={() => setCustomerMode("register")}
              >
                Register
              </button>
            </div>

            <form className="reservation-form">
              {customerMode === "register" && (
                <input
                  type="text"
                  placeholder="Full Name"
                  value={customerForm.name}
                  onChange={(e) =>
                    setCustomerForm({ ...customerForm, name: e.target.value })
                  }
                />
              )}

              <input
                type="email"
                placeholder="Email Address"
                value={customerForm.email}
                onChange={(e) =>
                  setCustomerForm({ ...customerForm, email: e.target.value })
                }
              />

              <input
                type="password"
                placeholder="Password"
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
                      setCustomerAuthError("Please fill all fields.");
                      return;
                    }

                    const alreadyExists = registeredCustomers.some(
                      (customer) => customer.email === customerForm.email,
                    );

                    if (alreadyExists) {
                      setCustomerAuthError("This email is already registered.");
                      return;
                    }

                    setCustomerAuthError("");
                    setPage("customerVerify");
                  } else {
                    const { data, error } = await supabase
                      .from("customers")
                      .select("*")
                      .eq("email", customerForm.email)
                      .eq("password", customerForm.password)
                      .single();

                    if (error || !data) {
                      setCustomerAuthError("Wrong email or password.");
                      return;
                    }

                    const foundCustomer = {
                      id: data.id,
                      name: data.name,
                      email: data.email,
                      password: data.password,
                      safeScore: data.safe_score,
                      profile: {
                        phone: data.phone || "",
                        gender: data.gender || "",
                        birthDate: data.birth_date || "",
                        job: data.job || "",
                        smoking: data.smoking || "",
                      },
                    };

                    setCustomerAuthError("");
                    setCustomerForm({
                      name: foundCustomer.name,
                      email: foundCustomer.email,
                      password: foundCustomer.password,
                    });

                    setLoggedCustomer(foundCustomer);
                    setCustomerProfile(foundCustomer.profile);
                    setPage("customerDashboard");
                  }
                }}
              >
                {customerMode === "login" ? "Login" : "Create Account"}
              </button>
            </form>
          </div>
        </section>
      )}

      {page === "customerVerify" && (
        <section className="reservation-section">
          <div className="reservation-box">
            <h1>Email Verification</h1>

            <p className="description">
              We sent a verification code to{" "}
              <strong>{customerForm.email}</strong>.
            </p>

            <form className="reservation-form">
              <input type="text" placeholder="Enter verification code" />

              <button
                type="button"
                onClick={async () => {
                  const newCustomer = {
                    name: customerForm.name,
                    email: customerForm.email,
                    password: customerForm.password,
                    safeScore: 100,
                    profile: {
                      phone: "",
                      gender: "",
                      birthDate: "",
                      job: "",
                      smoking: "",
                    },
                  };

                  const { error } = await supabase.from("customers").insert([
                    {
                      name: newCustomer.name,
                      email: newCustomer.email,
                      password: newCustomer.password,
                      safe_score: newCustomer.safeScore,
                    },
                  ]);

                  if (error) {
                    console.log("Customer insert error:", error);
                    alert("Customer oluşturulamadı.");
                    return;
                  }

                  setRegisteredCustomers([...registeredCustomers, newCustomer]);
                  setLoggedCustomer(newCustomer);
                  setCustomerProfile(newCustomer.profile);
                  setCustomerTab("pending");
                  setPage("customerDashboard");
                }}
              >
                Verify Account
              </button>
            </form>
          </div>
        </section>
      )}

      {page === "customerDashboard" && (
        <section className="reservation-section">
          <div className="reservation-box">
            <h1>Customer Dashboard</h1>

            {loggedCustomer ? (
              <>
                <p className="description">Welcome, {loggedCustomer.name}</p>
                <button
                  className="dashboard-create-btn"
                  onClick={() => {
                    setCustomerTab("pending");
                    goToReservationFlow();
                  }}
                >
                  + Create New Reservation
                </button>

                <div className="panel-tabs">
                  <button
                    className={customerTab === "pending" ? "active-tab" : ""}
                    onClick={() => setCustomerTab("pending")}
                  >
                    Pending
                  </button>

                  <button
                    className={customerTab === "accepted" ? "active-tab" : ""}
                    onClick={() => setCustomerTab("accepted")}
                  >
                    Accepted
                  </button>

                  <button
                    className={customerTab === "rejected" ? "active-tab" : ""}
                    onClick={() => setCustomerTab("rejected")}
                  >
                    Rejected
                  </button>

                  <button
                    className={customerTab === "statistics" ? "active-tab" : ""}
                    onClick={() => setCustomerTab("statistics")}
                  >
                    Statistics
                  </button>
                  <button
                    className={customerTab === "profile" ? "active-tab" : ""}
                    onClick={() => setCustomerTab("profile")}
                  >
                    Profile
                  </button>

                  <button
                    className={
                      customerTab === "notifications" ? "active-tab" : ""
                    }
                    onClick={() => setCustomerTab("notifications")}
                  >
                    Notifications
                  </button>
                </div>

                {customerTab === "statistics" && (
                  <div
                    className="reservation-box"
                    style={{ marginTop: "20px" }}
                  >
                    <h2>Reservation Statistics</h2>

                    <div className="card-row">
                      <span>Total Reservations</span>
                      <strong>
                        {
                          reservations.filter(
                            (rez) => rez.email === loggedCustomer.email,
                          ).length
                        }
                      </strong>
                    </div>

                    <div className="card-row">
                      <span>Pending</span>
                      <strong>
                        {
                          reservations.filter(
                            (rez) =>
                              rez.email === loggedCustomer.email &&
                              rez.status === "pending",
                          ).length
                        }
                      </strong>
                    </div>

                    <div className="card-row">
                      <span>Accepted</span>
                      <strong>
                        {
                          reservations.filter(
                            (rez) =>
                              rez.email === loggedCustomer.email &&
                              rez.status === "accepted",
                          ).length
                        }
                      </strong>
                    </div>

                    <div className="card-row">
                      <span>Rejected</span>
                      <strong>
                        {
                          reservations.filter(
                            (rez) =>
                              rez.email === loggedCustomer.email &&
                              rez.status === "rejected",
                          ).length
                        }
                      </strong>
                    </div>
                  </div>
                )}
                {customerTab === "profile" && (
                  <div
                    className="reservation-box"
                    style={{ marginTop: "20px" }}
                  >
                    <h2>Customer Profile</h2>
                    <div className="safe-score-box">
                      <div
                        className="safe-score-circle"
                        style={{
                          "--score": loggedCustomer?.safeScore ?? 100,
                        }}
                      >
                        <div className="safe-score-inner">
                          <strong>{loggedCustomer?.safeScore ?? 100}%</strong>
                          <span>Safe Score</span>
                        </div>
                      </div>

                      <p className="description">
                        Your Safe Score increases when you attend reservations
                        and decreases when you miss them.
                      </p>
                    </div>
                    <p className="description">
                      Your Safe Score reflects your reservation reliability. A
                      higher score improves your chances of having future
                      reservations accepted.
                    </p>

                    <p className="description">
                      These fields are optional. You can complete your profile
                      anytime.
                    </p>

                    <form className="reservation-form">
                      <input
                        type="tel"
                        placeholder="Phone Number"
                        value={customerProfile.phone}
                        onChange={(e) =>
                          setCustomerProfile({
                            ...customerProfile,
                            phone: e.target.value,
                          })
                        }
                      />

                      <h3>Gender</h3>

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
                          Male
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
                          Female
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
                          Prefer not to say
                        </button>
                      </div>
                      <h3 style={{ marginTop: "20px" }}>Birth Date</h3>
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
                        placeholder="Job"
                        value={customerProfile.job}
                        onChange={(e) =>
                          setCustomerProfile({
                            ...customerProfile,
                            job: e.target.value,
                          })
                        }
                      />

                      <h3 style={{ marginTop: "20px" }}>Smoking Preference</h3>

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
                          Smoker
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
                          Non-smoker
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
                          No Preference
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

                          alert("Profile saved successfully");
                        }}
                      >
                        Save Profile
                      </button>
                    </form>
                  </div>
                )}

                {customerTab === "notifications" && (
                  <div
                    className="reservation-box"
                    style={{ marginTop: "20px" }}
                  >
                    <h2>Notifications</h2>

                    {reservations.filter(
                      (rez) =>
                        rez.email === loggedCustomer.email &&
                        rez.businessMessage,
                    ).length > 0 ? (
                      reservations
                        .filter(
                          (rez) =>
                            rez.email === loggedCustomer.email &&
                            rez.businessMessage,
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
                                  ? "Reservation accepted"
                                  : "Reservation rejected"}
                              </p>

                              <p style={{ marginTop: "8px", color: "#e5e7eb" }}>
                                {rez.businessMessage}
                              </p>
                            </div>

                            {rez.status === "pending" ? (
                              <button
                                type="button"
                                className="cancel-reservation-btn"
                                onClick={async (e) => {
                                  e.stopPropagation();

                                  console.log("CANCEL CLICKED");

                                  if (
                                    !window.confirm("Cancel this reservation?")
                                  ) {
                                    return;
                                  }

                                  const { data, error } = await supabase
                                    .from("reservations")
                                    .update({
                                      status: "accepted",
                                    })
                                    .eq("id", rez.id)
                                    .select();

                                  console.log("ACCEPT REZ ID:", rez.id);
                                  console.log("ACCEPT DATA:", data);
                                  console.log("ACCEPT ERROR:", error);

                                  if (error) {
                                    alert("Rezervasyon iptal edilemedi.");
                                    return;
                                  }

                                  setReservations(
                                    reservations.map((item) =>
                                      item.id === rez.id
                                        ? {
                                            ...item,
                                            status: "cancelled",
                                            businessMessage:
                                              "Customer cancelled this reservation.",
                                          }
                                        : item,
                                    ),
                                  );
                                }}
                              >
                                Cancel
                              </button>
                            ) : (
                              <span>{rez.status}</span>
                            )}
                          </div>
                        ))
                    ) : (
                      <p className="description">No notifications yet.</p>
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
                                {rez.guests} guests
                              </p>
                            </div>

                            {rez.status === "pending" ? (
                              <button
                                type="button"
                                className="cancel-reservation-btn"
                                onClick={async (e) => {
                                  e.stopPropagation();

                                  if (
                                    !window.confirm("Cancel this reservation?")
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
                                        ? {
                                            ...item,
                                            status: "cancelled",
                                            businessMessage:
                                              "Customer cancelled this reservation.",
                                          }
                                        : item,
                                    ),
                                  );
                                }}
                              >
                                Cancel
                              </button>
                            ) : (
                              <span>{rez.status}</span>
                            )}
                          </div>
                        ))
                    ) : (
                      <p className="description">
                        No {customerTab} reservations found.
                      </p>
                    )}
                  </>
                )}

                <button
                  className="primary-btn"
                  style={{ marginTop: "20px" }}
                  onClick={() => {
                    setLoggedCustomer(null);
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
                  Logout
                </button>
              </>
            ) : (
              <>
                <p className="description">
                  Please login to see your reservations.
                </p>
                <button
                  className="primary-btn"
                  onClick={() => setPage("customerAuth")}
                >
                  Go to Login
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {page === "businessLogin" && (
        <section className="reservation-section">
          <div className="reservation-box">
            <h1>Business Login</h1>
            <p className="description">Login to manage reservations.</p>

            <form className="reservation-form">
              <input
                type="email"
                placeholder="Business Email"
                value={businessLogin.email}
                onChange={(e) =>
                  setBusinessLogin({ ...businessLogin, email: e.target.value })
                }
              />

              <input
                type="password"
                placeholder="Password"
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
                Login
              </button>
            </form>
          </div>
        </section>
      )}
      {page === "adminLogin" && (
        <section className="reservation-section">
          <div className="reservation-box">
            <h1>Admin Login</h1>
            <p className="description">RezPoint management panel.</p>

            <form className="reservation-form">
              <input
                type="email"
                placeholder="Admin Email"
                value={adminLogin.email}
                onChange={(e) =>
                  setAdminLogin({ ...adminLogin, email: e.target.value })
                }
              />

              <input
                type="password"
                placeholder="Password"
                value={adminLogin.password}
                onChange={(e) =>
                  setAdminLogin({ ...adminLogin, password: e.target.value })
                }
              />

              {adminError && <p className="error-message">{adminError}</p>}

              <button type="button" onClick={handleAdminLogin}>
                Login
              </button>
            </form>
          </div>
        </section>
      )}

      {page === "adminPanel" && (
        <section className="business-panel-section">
          <div className="business-panel-header">
            <div>
              <h1>RezPoint Admin Panel</h1>
              <p className="description">
                Manage businesses, AI Menu access and platform statistics.
              </p>
            </div>

            <button
              className="nav-button"
              onClick={() => {
                setAdminLogin({ email: "", password: "" });
                setPage("home");
              }}
            >
              Logout
            </button>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <span>Businesses</span>
              <strong>{adminBusinesses.length}</strong>
            </div>

            <div className="stat-card">
              <span>Customers</span>
              <strong>{registeredCustomers.length}</strong>
            </div>

            <div className="stat-card">
              <span>Reservations</span>
              <strong>{reservations.length}</strong>
            </div>

            <div className="stat-card">
              <span>AI Menu Active</span>
              <strong>
                {
                  adminBusinesses.filter((business) => business.aiMenuActive)
                    .length
                }
              </strong>
            </div>
          </div>

          <div className="reservation-box" style={{ marginTop: "24px" }}>
            <h2>Businesses</h2>
            <button
              className="primary-btn"
              style={{ marginBottom: "20px" }}
              onClick={() => setShowAddBusinessForm(!showAddBusinessForm)}
            >
              + Add Business
            </button>
            {showAddBusinessForm && (
              <form
                className="reservation-form"
                style={{ marginBottom: "24px" }}
              >
                <input
                  type="text"
                  placeholder="Business Name"
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
                  placeholder="Business Type"
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
                  placeholder="Location"
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
                  placeholder="Icon emoji e.g. 🍸"
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
                  placeholder="Business Login Email"
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
                  placeholder="Business Login Password"
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
                      alert("Please fill all required fields.");
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
                      type: newBusinessForm.type || "Business",
                      location: newBusinessForm.location || "",
                      icon: newBusinessForm.icon || "🏢",
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
                  Create Business
                </button>
              </form>
            )}

            {adminBusinesses.map((business) => (
              <div className="accepted-list-item" key={business.id}>
                <div>
                  <strong>{business.name}</strong>
                  <p style={{ marginTop: "6px", color: "#cbd5e1" }}>
                    {business.type} • {business.location}
                  </p>

                  <p style={{ marginTop: "6px", color: "#cbd5e1" }}>
                    Reservations:{" "}
                    {business.reservationActive ? "Active" : "Disabled"}
                  </p>

                  <p style={{ marginTop: "6px", color: "#cbd5e1" }}>
                    AI Menu: {business.aiMenuActive ? "Active" : "Disabled"}
                  </p>
                </div>

                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <button
                    className={
                      business.reservationActive ? "selected-time" : "time-btn"
                    }
                    onClick={async () => {
                      const newValue = !business.reservationActive;

                      const { error } = await supabase
                        .from("businesses")
                        .update({
                          reservation_enabled: newValue,
                        })
                        .eq("id", business.id);

                      if (error) {
                        console.log(error);
                        alert("Reservation durumu güncellenemedi.");
                        return;
                      }

                      setAdminBusinesses(
                        adminBusinesses.map((item) =>
                          item.id === business.id
                            ? {
                                ...item,
                                reservationActive: !item.reservationActive,
                              }
                            : item,
                        ),
                      );
                    }}
                  >
                    Reservation {business.reservationActive ? "ON" : "OFF"}
                  </button>

                  <button
                    className={
                      business.aiMenuActive ? "selected-time" : "time-btn"
                    }
                    onClick={async () => {
                      const newValue = !business.aiMenuActive;

                      const { error } = await supabase
                        .from("businesses")
                        .update({
                          ai_menu_enabled: newValue,
                        })
                        .eq("id", business.id);

                      if (error) {
                        console.log(error);
                        alert("AI Menu durumu güncellenemedi.");
                        return;
                      }

                      setAdminBusinesses(
                        adminBusinesses.map((item) =>
                          item.id === business.id
                            ? {
                                ...item,
                                aiMenuActive: !item.aiMenuActive,
                              }
                            : item,
                        ),
                      );
                    }}
                  >
                    AI Menu {business.aiMenuActive ? "ON" : "OFF"}
                  </button>
                  <button
                    className="time-btn"
                    style={{ color: "#fca5a5", borderColor: "#fca5a5" }}
                    onClick={async () => {
                      const confirmDelete = window.confirm(
                        `${business.name} işletmesini silmek istediğine emin misin? Bu işletmeye ait rezervasyonlar da silinecek.`,
                      );

                      if (!confirmDelete) return;

                      const { error } = await supabase
                        .from("businesses")
                        .delete()
                        .eq("id", business.id);

                      if (error) {
                        console.log("Delete business error:", error);
                        alert("Business silinirken hata oldu.");
                        return;
                      }

                      setAdminBusinesses(
                        adminBusinesses.filter(
                          (item) => item.id !== business.id,
                        ),
                      );

                      setReservations(
                        reservations.filter(
                          (rez) => rez.businessId !== business.id,
                        ),
                      );

                      if (loggedBusiness?.id === business.id) {
                        setLoggedBusiness(null);
                        setPage("home");
                      }
                    }}
                  >
                    Delete Business
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {page === "businessPanel" && (
        <section className="business-panel-section">
          <div className="business-panel-header">
            <div>
              <h1>
                {loggedBusiness ? loggedBusiness.name : "Business Dashboard"}
              </h1>
              <p className="description">
                Manage your reservations and business settings.
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
              Logout
            </button>
          </div>

          <div className="panel-tabs">
            <button
              className={panelTab === "incoming" ? "active-tab" : ""}
              onClick={() => setPanelTab("incoming")}
            >
              Incoming Requests ({getBusinessReservationCount("pending")})
            </button>

            <button
              className={panelTab === "accepted" ? "active-tab" : ""}
              onClick={() => setPanelTab("accepted")}
            >
              Accepted ({getBusinessReservationCount("accepted")})
            </button>

            <button
              className={panelTab === "rejected" ? "active-tab" : ""}
              onClick={() => setPanelTab("rejected")}
            >
              Rejected ({getBusinessReservationCount("rejected")})
            </button>

            <button
              className={panelTab === "completed" ? "active-tab" : ""}
              onClick={() => setPanelTab("completed")}
            >
              Completed ({getBusinessReservationCount("completed")})
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
              Availability
            </button>

            <button
              className={panelTab === "profile" ? "active-tab" : ""}
              onClick={() => setPanelTab("profile")}
            >
              Business Profile
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
                <h2>Incoming Reservation Requests</h2>

                {reservations.filter((rez) => rez.status === "pending").length >
                0 ? (
                  reservations
                    .filter(
                      (rez) =>
                        (rez.status === "pending" ||
                          rez.status === "cancelled") &&
                        loggedBusiness &&
                        rez.businessId === loggedBusiness.id,
                    )
                    .map((rez) => (
                      <div
                        key={rez.id}
                        className="accepted-list-item"
                        style={{ marginTop: "15px" }}
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
                            {rez.guests} guests
                          </p>

                          <p style={{ marginTop: "6px", color: "#cbd5e1" }}>
                            Note: {rez.note || "No note"}
                          </p>
                        </div>

                        {rez.status === "cancelled" ? (
                          <span style={{ color: "#fca5a5", fontWeight: "700" }}>
                            Cancelled by customer
                          </span>
                        ) : (
                          <div style={{ display: "flex", gap: "10px" }}>
                            <button
                              className="primary-btn"
                              onClick={async (e) => {
                                e.stopPropagation();
                                const { error } = await supabase
                                  .from("reservations")
                                  .update({
                                    status: "accepted",
                                  })
                                  .eq("id", rez.id);

                                if (error) {
                                  console.log("Accept error:", error);
                                  alert("Rezervasyon kabul edilemedi.");
                                  return;
                                }
                                setReservations(
                                  reservations.map((item) =>
                                    item.id === rez.id
                                      ? {
                                          ...item,
                                          status: "accepted",
                                          businessMessage:
                                            "Rezervasyonunuz oluşturuldu. Sizi bekliyoruz ❤️",
                                        }
                                      : item,
                                  ),
                                );
                              }}
                            >
                              Accept
                            </button>

                            <button
                              className="reject-btn"
                              onClick={async (e) => {
                                e.stopPropagation();

                                const { error } = await supabase
                                  .from("reservations")
                                  .update({
                                    status: "rejected",
                                  })
                                  .eq("id", rez.id);

                                if (error) {
                                  console.log("Reject error:", error);
                                  alert("Rezervasyon reddedilemedi.");
                                  return;
                                }

                                setReservations(
                                  reservations.map((item) =>
                                    item.id === rez.id
                                      ? {
                                          ...item,
                                          status: "rejected",
                                          businessMessage:
                                            "İşletmemizde uygun masa bulunmamaktadır, yine bekleriz ❤️",
                                        }
                                      : item,
                                  ),
                                );
                              }}
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                ) : (
                  <p className="description">
                    No incoming reservation requests.
                  </p>
                )}
              </div>
            )}

            {panelTab === "accepted" && (
              <div className="reservation-box">
                <h2>Accepted Reservations</h2>
                <p className="description">
                  Select a date to view accepted reservations.
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
                        <small>{count} reservations</small>
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
                                {rez.guests} guests
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
                        No accepted reservations for this date.
                      </p>
                    )}
                    <button
                      className="close-day-btn"
                      onClick={closeDayReservations}
                    >
                      Close Day
                    </button>
                  </div>
                )}
              </div>
            )}

            {panelTab === "rejected" && (
              <div className="reservation-box">
                <h2>Rejected Reservations</h2>
                <p className="description">
                  Rejected reservation requests will appear here.
                </p>

                {reservations.filter((rez) => rez.status === "rejected")
                  .length > 0 ? (
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
                            Note: {rez.note || "No note"}
                          </p>
                        </div>

                        <span>{rez.guests} guests</span>
                      </div>
                    ))
                ) : (
                  <p className="description">No rejected reservations yet.</p>
                )}
              </div>
            )}

            {panelTab === "completed" && (
              <div className="reservation-box">
                <h2>Completed Reservations</h2>

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

                        <span>✓ Completed</span>
                      </div>
                    ))
                ) : (
                  <p className="description">No completed reservations yet.</p>
                )}
              </div>
            )}

            {panelTab === "noShow" && (
              <div className="reservation-box">
                <h2>No Show Reservations</h2>

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
                  <p className="description">No no-show reservations yet.</p>
                )}
              </div>
            )}

            {panelTab === "settings" && (
              <div className="reservation-box">
                <h2>Availability Settings</h2>
                <p className="description">
                  Edit available days and time slots.
                </p>

                <h3>Reservation Mode</h3>

                <div className="time-slots">
                  <button
                    className={
                      availabilityMode === "everyday"
                        ? "selected-time"
                        : "time-btn"
                    }
                    onClick={() => setAvailabilityMode("everyday")}
                  >
                    Everyday
                  </button>

                  <button
                    className={
                      availabilityMode === "selected"
                        ? "selected-time"
                        : "time-btn"
                    }
                    onClick={() => setAvailabilityMode("selected")}
                  >
                    Selected Week Days
                  </button>
                </div>

                {availabilityMode === "selected" && (
                  <>
                    <h3 style={{ marginTop: "24px" }}>Available Days</h3>

                    <div className="time-slots">
                      {[
                        "Monday",
                        "Tuesday",
                        "Wednesday",
                        "Thursday",
                        "Friday",
                        "Saturday",
                        "Sunday",
                      ].map((day) => (
                        <button
                          key={day}
                          className={
                            availableDays.includes(day)
                              ? "selected-time"
                              : "time-btn"
                          }
                          onClick={() => {
                            if (availableDays.includes(day)) {
                              setAvailableDays(
                                availableDays.filter((d) => d !== day),
                              );
                            } else {
                              setAvailableDays([...availableDays, day]);
                            }
                          }}
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <h3 style={{ marginTop: "24px" }}>Available Times</h3>

                <div className="time-slots">
                  {["18:00", "19:00", "20:30", "22:00"].map((time) => (
                    <button
                      key={time}
                      className={
                        availableTimes.includes(time)
                          ? "selected-time"
                          : "time-btn"
                      }
                      onClick={() => {
                        if (availableTimes.includes(time)) {
                          setAvailableTimes(
                            availableTimes.filter((t) => t !== time),
                          );
                        } else {
                          setAvailableTimes([...availableTimes, time]);
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
                  onClick={() => {
                    setSavedMessage("Changes updated successfully ✅");

                    setTimeout(() => {
                      setSavedMessage("");
                    }, 3000);
                  }}
                >
                  Save Changes
                </button>
              </div>
            )}

            {panelTab === "profile" && (
              <div className="reservation-box">
                <h2>Business Profile</h2>
                <p className="description">Edit business information.</p>

                <form className="reservation-form">
                  <input type="text" placeholder="Business Name" />
                  <input type="text" placeholder="Location" />
                  <input type="tel" placeholder="Phone Number" />
                  <textarea placeholder="Business Description"></textarea>
                  <button type="button">Save Profile</button>
                </form>
              </div>
            )}

            {panelTab === "insights" && (
              <div className="reservation-box">
                <h2>Müşterini Tanı</h2>
                <p className="description">
                  Demo insights are shown for presentation. Real analytics will
                  appear after enough customer data is collected.
                </p>

                <div className="panel-tabs" style={{ marginTop: "20px" }}>
                  <button
                    className={customerInsightTab === "age" ? "active-tab" : ""}
                    onClick={() => setCustomerInsightTab("age")}
                  >
                    Yaş Aralığı
                  </button>

                  <button
                    className={
                      customerInsightTab === "gender" ? "active-tab" : ""
                    }
                    onClick={() => setCustomerInsightTab("gender")}
                  >
                    Cinsiyet
                  </button>

                  <button
                    className={
                      customerInsightTab === "firstTimers" ? "active-tab" : ""
                    }
                    onClick={() => setCustomerInsightTab("firstTimers")}
                  >
                    İlk Kez Gelenler
                  </button>

                  <button
                    className={
                      customerInsightTab === "topCustomers" ? "active-tab" : ""
                    }
                    onClick={() => setCustomerInsightTab("topCustomers")}
                  >
                    En Çok Gelenler
                  </button>

                  <button
                    className={
                      customerInsightTab === "smoking" ? "active-tab" : ""
                    }
                    onClick={() => setCustomerInsightTab("smoking")}
                  >
                    Sigara
                  </button>

                  <button
                    className={
                      customerInsightTab === "busyDays" ? "active-tab" : ""
                    }
                    onClick={() => setCustomerInsightTab("busyDays")}
                  >
                    Yoğun Günler
                  </button>

                  <button
                    className={
                      customerInsightTab === "busyHours" ? "active-tab" : ""
                    }
                    onClick={() => setCustomerInsightTab("busyHours")}
                  >
                    Yoğun Saatler
                  </button>
                </div>

                {customerInsightTab === "age" && (
                  <div style={{ marginTop: "24px" }}>
                    <h3>Yaş Aralığı</h3>

                    {getDistributionList("age").length > 0 ? (
                      getDistributionList("age").map((item) => (
                        <div className="card-row" key={item.label}>
                          <span>{item.label}</span>
                          <strong>
                            {item.count} customers • {item.percent}%
                          </strong>
                        </div>
                      ))
                    ) : (
                      <p className="description">
                        Yaş dağılımı için kabul edilmiş rezervasyon gerekiyor.
                      </p>
                    )}
                  </div>
                )}

                {customerInsightTab === "gender" && (
                  <div style={{ marginTop: "24px" }}>
                    <h3>Cinsiyet Dağılımı</h3>

                    {getDistributionList("gender").length > 0 ? (
                      getDistributionList("gender").map((item) => (
                        <div className="card-row" key={item.label}>
                          <span>{item.label}</span>
                          <strong>
                            {item.count} customers • {item.percent}%
                          </strong>
                        </div>
                      ))
                    ) : (
                      <p className="description">
                        Cinsiyet dağılımı için kabul edilmiş rezervasyon
                        gerekiyor.
                      </p>
                    )}
                  </div>
                )}

                {customerInsightTab === "firstTimers" && (
                  <div style={{ marginTop: "24px" }}>
                    <h3>İlk Kez Gelenler</h3>

                    {getCustomerFrequencyList().filter(
                      (customer) => customer.count === 1,
                    ).length > 0 ? (
                      getCustomerFrequencyList()
                        .filter((customer) => customer.count === 1)
                        .map((customer) => (
                          <div
                            className="accepted-list-item"
                            key={customer.email}
                          >
                            <strong>{customer.name}</strong>
                            <span>1 accepted reservation</span>
                          </div>
                        ))
                    ) : (
                      <p className="description">
                        İlk kez gelen müşteri verisi henüz yok.
                      </p>
                    )}
                  </div>
                )}

                {customerInsightTab === "topCustomers" && (
                  <div style={{ marginTop: "24px" }}>
                    <h3>En Çok Gelenler</h3>

                    {getCustomerFrequencyList().filter(
                      (customer) => customer.count > 1,
                    ).length > 0 ? (
                      getCustomerFrequencyList()
                        .filter((customer) => customer.count > 1)
                        .map((customer) => (
                          <div
                            className="accepted-list-item"
                            key={customer.email}
                          >
                            <strong>{customer.name}</strong>
                            <span>{customer.count} accepted reservations</span>
                          </div>
                        ))
                    ) : (
                      <p className="description">
                        Tekrar gelen müşteri verisi henüz yok.
                      </p>
                    )}
                  </div>
                )}

                {customerInsightTab === "smoking" && (
                  <div style={{ marginTop: "24px" }}>
                    <h3>Sigara İçme Dağılımı</h3>

                    {getDistributionList("smoking").length > 0 ? (
                      getDistributionList("smoking").map((item) => (
                        <div className="card-row" key={item.label}>
                          <span>{item.label}</span>
                          <strong>
                            {item.count} customers • {item.percent}%
                          </strong>
                        </div>
                      ))
                    ) : (
                      <p className="description">
                        Sigara dağılımı için kabul edilmiş rezervasyon
                        gerekiyor.
                      </p>
                    )}
                  </div>
                )}

                {customerInsightTab === "busyDays" && (
                  <div style={{ marginTop: "24px" }}>
                    <h3>En Yoğun Günler</h3>

                    {getBusyDaysList().length > 0 ? (
                      getBusyDaysList().map((item) => (
                        <div className="card-row" key={item.day}>
                          <span>{item.day}</span>
                          <strong>{item.count} accepted reservations</strong>
                        </div>
                      ))
                    ) : (
                      <p className="description">
                        Yoğun gün verisi için kabul edilmiş rezervasyon
                        gerekiyor.
                      </p>
                    )}
                  </div>
                )}

                {customerInsightTab === "busyHours" && (
                  <div style={{ marginTop: "24px" }}>
                    <h3>En Yoğun Saatler</h3>

                    {getBusyHoursList().length > 0 ? (
                      getBusyHoursList().map((item) => (
                        <div className="card-row" key={item.time}>
                          <span>{item.time}</span>
                          <strong>{item.count} accepted reservations</strong>
                        </div>
                      ))
                    ) : (
                      <p className="description">
                        Yoğun saat verisi için kabul edilmiş rezervasyon
                        gerekiyor.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {selectedReservation && (
        <div className="popup-overlay">
          <div className="popup-box">
            <h2>Reservation Details</h2>

            <div className="card-row">
              <span>Name</span>
              <strong>{selectedReservation.fullName}</strong>
            </div>

            <div className="card-row">
              <span>Email</span>
              <strong>{selectedReservation.email}</strong>
            </div>

            <div className="card-row">
              <span>Phone</span>
              <strong>{selectedReservation.phone}</strong>
            </div>

            <div className="card-row">
              <span>Business</span>
              <strong>{selectedReservation.business}</strong>
            </div>

            <div className="card-row">
              <span>Date</span>
              <strong>{formatDate(selectedReservation.date)}</strong>
            </div>

            <div className="card-row">
              <span>Time</span>
              <strong>{selectedReservation.time}</strong>
            </div>

            <div className="card-row">
              <span>Guests</span>
              <strong>{selectedReservation.guests}</strong>
            </div>

            <div className="card-row">
              <span>Status</span>
              <strong>{selectedReservation.status}</strong>
            </div>
            <div className="card-row">
              <span>Safe Score</span>
              <strong>{selectedReservation.safeScore ?? 100}/100</strong>
            </div>
            <div className="card-row">
              <span>Reservation Code</span>
              <strong style={{ color: "#a855f7" }}>
                {selectedReservation.code}
              </strong>
            </div>

            <div className="card-row">
              <span>Gender</span>
              <strong>
                {selectedReservation.customerProfile?.gender || "Not provided"}
              </strong>
            </div>

            <div className="card-row">
              <span>Birth Date</span>
              <strong>
                {selectedReservation.customerProfile?.birthDate ||
                  "Not provided"}
              </strong>
            </div>

            <div className="card-row">
              <span>Job</span>
              <strong>
                {selectedReservation.customerProfile?.job || "Not provided"}
              </strong>
            </div>

            <div className="card-row">
              <span>Smoking</span>
              <strong>
                {selectedReservation.customerProfile?.smoking || "Not provided"}
              </strong>
            </div>
            <div className="card-row">
              <span>Note</span>
              <strong>{selectedReservation.note || "No note"}</strong>
            </div>

            <button
              className="primary-btn"
              style={{ marginTop: "20px" }}
              onClick={() => setSelectedReservation(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
