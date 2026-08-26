"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardCharts from "./DashboardCharts";
import supabase from "../lib/supabase";

const SUPABASE_PAGE_SIZE = 1000;
const initialForm = {
  week_start: "",
  active_devices: "",
  wau: "",
  total_usage_hours: "",
  new_installs: "",
  event_note: "",
  service_id: "",
  event_type_id: "",
};
const initialLoginForm = {
  email: "",
  password: "",
  newPassword: "",
};
const dataManagerIdentifiers = new Set(
  (process.env.NEXT_PUBLIC_DATA_MANAGER_EMAILS ?? "")
    .split(",")
    .map((identifier) => identifier.trim().toLowerCase())
    .filter(Boolean),
);

function assertSupabaseResult(tableName, result) {
  if (result.error) {
    const details = [
      result.error.message,
      result.error.code ? `code: ${result.error.code}` : null,
      result.status ? `status: ${result.status}` : null,
      result.error.hint ? `hint: ${result.error.hint}` : null,
    ].filter(Boolean);

    throw new Error(`Failed to load ${tableName}: ${details.join(" / ")}`);
  }

  return result.data ?? [];
}

async function fetchTableRows(tableName, orderColumn) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const result = await supabase
      .from(tableName)
      .select("*")
      .order(orderColumn)
      .range(from, to);
    const pageRows = assertSupabaseResult(tableName, result);

    rows.push(...pageRows);

    if (pageRows.length < SUPABASE_PAGE_SIZE) {
      return rows;
    }

    from += SUPABASE_PAGE_SIZE;
  }
}

function formatWeekStart(value) {
  return String(value).slice(0, 10);
}

function roundToTwo(value) {
  return Math.round(value * 100) / 100;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function distinctJoined(values) {
  const distinctValues = [...new Set(values.filter(Boolean))];

  return distinctValues.length ? distinctValues.join(", ") : null;
}

function createLookup(rows, key) {
  return new Map(rows.map((row) => [row[key], row]));
}

function createUsageServiceKey(service) {
  return String(service).toLowerCase();
}

function sortByWeekAndService(left, right) {
  return (
    left.week_start.localeCompare(right.week_start) ||
    left.service.localeCompare(right.service)
  );
}

function sanitizeInteger(value) {
  return value.replace(/\D/g, "");
}

function sanitizeDecimal(value) {
  const numericValue = value.replace(/[^\d.]/g, "");
  const [integerPart, ...decimalParts] = numericValue.split(".");

  return decimalParts.length
    ? `${integerPart}.${decimalParts.join("")}`
    : integerPart;
}

function normalizeSelectId(value) {
  if (value === "") {
    return null;
  }

  return /^\d+$/.test(String(value)) ? Number(value) : value;
}

function addDays(value, days) {
  if (!value) {
    return "";
  }

  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

function createFormDefaults(services, latestWeek) {
  return {
    ...initialForm,
    week_start: addDays(latestWeek, 7),
    service_id: services[0]?.id != null ? String(services[0].id) : "",
    event_type_id: "",
  };
}

async function getDashboardData() {
  const [weeklyRowsResult, servicesRows, eventTypesRows] = await Promise.all([
    fetchTableRows("ott_weekly", "week_start"),
    fetchTableRows("ott_services", "id"),
    fetchTableRows("event_types", "id"),
  ]);

  const weeklyRows = weeklyRowsResult.map((row) => ({
    ...row,
    week_start: formatWeekStart(row.week_start),
  }));
  const serviceById = createLookup(servicesRows, "id");
  const eventTypeById = createLookup(eventTypesRows, "id");
  const rows = weeklyRows
    .map((row) => ({
      ...row,
      service: serviceById.get(row.service_id)?.name ?? "Unknown",
      event_type: eventTypeById.get(row.event_type_id)?.name ?? null,
    }))
    .sort(sortByWeekAndService);

  const weeks = [...new Set(rows.map((row) => row.week_start))].sort();
  const latestWeek = weeks[weeks.length - 1];
  const previousWeek = weeks[weeks.length - 2] ?? latestWeek;
  const ranking = rows
    .filter((row) => row.week_start === latestWeek)
    .map((row) => ({
      service: row.service,
      wau: Number(row.wau),
    }))
    .sort((left, right) => right.wau - left.wau);
  const previousRanking = rows
    .filter((row) => row.week_start === previousWeek)
    .map((row) => ({
      service: row.service,
      wau: Number(row.wau),
    }))
    .sort((left, right) => right.wau - left.wau);
  const trend = rows.map((row) => ({
    week_start: row.week_start,
    service: row.service,
    wau: Number(row.wau),
  }));
  const usage = weeks.map((week) => {
    const weekRows = rows.filter((row) => row.week_start === week);
    const values = Object.fromEntries(
      weekRows.map((row) => [
        createUsageServiceKey(row.service),
        Number(row.wau) === 0
          ? null
          : roundToTwo(Number(row.total_usage_hours) / Number(row.wau)),
      ]),
    );

    return {
      week_start: week,
      ...values,
    };
  });
  const serviceRows = new Map();

  rows.forEach((row) => {
    const serviceRowsForId = serviceRows.get(row.service_id) ?? [];
    serviceRowsForId.push(row);
    serviceRows.set(row.service_id, serviceRowsForId);
  });

  const events = [...serviceRows.values()]
    .flatMap((serviceWeeklyRows) =>
      [...serviceWeeklyRows]
        .sort((left, right) => left.week_start.localeCompare(right.week_start))
        .map((row, index, sortedRows) => {
          const previousRow = sortedRows[index - 1];

          if (!previousRow) {
            return null;
          }

          const previousInstalls = Number(previousRow.new_installs);
          const installRatio =
            previousInstalls === 0
              ? null
              : roundToTwo(Number(row.new_installs) / previousInstalls);

          return {
            week_start: row.week_start,
            service: row.service,
            new_installs: Number(row.new_installs),
            install_ratio: installRatio,
            event_type: row.event_type,
          };
        })
        .filter(Boolean),
    )
    .sort(
      (left, right) =>
        right.week_start.localeCompare(left.week_start) ||
        left.service.localeCompare(right.service),
    );
  const comparison = weeks.map((week) => {
    const weekRows = rows.filter((row) => row.week_start === week);
    const wau = sum(weekRows, "wau");
    const totalUsageHours = sum(weekRows, "total_usage_hours");

    return {
      week_start: week,
      wau,
      ats: wau === 0 ? null : roundToTwo(totalUsageHours / wau),
      total_usage_hours: totalUsageHours,
      active_devices: sum(weekRows, "active_devices"),
      event_types: distinctJoined(weekRows.map((row) => row.event_type)),
      event_notes: distinctJoined(weekRows.map((row) => row.event_note)),
    };
  });
  const serviceComparison = rows.map((row) => ({
    week_start: row.week_start,
    service: row.service,
    wau: Number(row.wau),
    ats:
      Number(row.wau) === 0
        ? null
        : roundToTwo(Number(row.total_usage_hours) / Number(row.wau)),
    total_usage_hours: Number(row.total_usage_hours),
    active_devices: Number(row.active_devices),
    event_types: row.event_type,
    event_notes: row.event_note,
  }));

  return {
    ranking,
    previousRanking,
    trend,
    usage,
    events,
    comparison,
    serviceComparison,
    services: servicesRows,
    eventTypes: eventTypesRows,
    latestWeek,
  };
}

export default function DashboardDataLoader() {
  const [data, setData] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [session, setSession] = useState(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [loginForm, setLoginForm] = useState(initialLoginForm);
  const [authError, setAuthError] = useState("");
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isPasswordChanging, setIsPasswordChanging] = useState(false);
  const services = data?.services ?? [];
  const eventTypes = data?.eventTypes ?? [];
  const currentUserEmail = session?.user?.email ?? "";
  const currentUserId = session?.user?.id ?? "";
  const isDataManager =
    dataManagerIdentifiers.has(currentUserEmail.toLowerCase()) ||
    dataManagerIdentifiers.has(currentUserId.toLowerCase());

  const loadData = useCallback(() => {
    let isMounted = true;

    getDashboardData()
      .then((nextData) => {
        if (!isMounted) {
          return;
        }

        setData(nextData);
        setErrorMessage("");
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setErrorMessage(error.message);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    supabase.auth
      .getSession()
      .then(({ data: authData, error }) => {
        if (!isMounted) {
          return;
        }

        if (error) {
          setAuthError(error.message);
          setIsAuthReady(true);
          return;
        }

        setSession(authData.session);
        setIsAuthReady(true);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setAuthError(error.message);
        setIsAuthReady(true);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isAuthReady) {
      return undefined;
    }

    if (!session) {
      setData(null);
      setErrorMessage("");
      return undefined;
    }

    return loadData();
  }, [isAuthReady, loadData, session]);

  useEffect(() => {
    if (!isModalOpen && !isAuthModalOpen) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isModalOpen, isAuthModalOpen]);

  const openModal = () => {
    if (!isDataManager) {
      return;
    }

    setForm(createFormDefaults(services, data?.latestWeek));
    setSaveError("");
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (!isSaving) {
      setIsModalOpen(false);
      setSaveError("");
    }
  };

  const openAuthModal = () => {
    setLoginForm({
      ...initialLoginForm,
      email: currentUserEmail,
    });
    setAuthMode("login");
    setAuthError("");
    setIsAuthModalOpen(true);
  };

  const closeAuthModal = () => {
    if (!isAuthSubmitting && !isPasswordChanging) {
      setIsAuthModalOpen(false);
      setAuthMode("login");
      setAuthError("");
      setLoginForm(initialLoginForm);
    }
  };

  const updateLoginField = (field, value) => {
    setLoginForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  };

  const closeAuthModalFromBackdrop = (event) => {
    if (event.target === event.currentTarget) {
      closeAuthModal();
    }
  };

  const handleAuthButtonClick = async () => {
    if (!session) {
      openAuthModal();
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError("");

    const { error } = await supabase.auth.signOut();

    if (error) {
      setAuthError(error.message);
    } else {
      setSession(null);
      setData(null);
      setErrorMessage("");
      setIsModalOpen(false);
    }

    setIsAuthSubmitting(false);
  };

  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    setIsAuthSubmitting(true);
    setAuthError("");
    setErrorMessage("");

    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email: loginForm.email.trim(),
      password: loginForm.password,
    });

    if (error) {
      setAuthError(error.message);
      setIsAuthSubmitting(false);
      return;
    }

    try {
      const nextData = await getDashboardData();
      setData(nextData);
      setErrorMessage("");
      setSession(authData.session);
      setIsAuthReady(true);
      setIsAuthModalOpen(false);
      setLoginForm(initialLoginForm);
    } catch (loadError) {
      setSession(authData.session);
      setIsAuthReady(true);
      setErrorMessage(loadError.message);
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handlePasswordChange = async (event) => {
    event.preventDefault();
    const email = loginForm.email.trim();
    const currentPassword = loginForm.password;
    const nextPassword = loginForm.newPassword;

    if (!email || !currentPassword || !nextPassword) {
      setAuthError("이메일, 현재 비번, 새 비번을 모두 입력해주세요.");
      return;
    }

    if (nextPassword.length < 6) {
      setAuthError("새 비번은 6자 이상으로 입력해주세요.");
      return;
    }

    if (currentPassword === nextPassword) {
      setAuthError("새 비번은 현재 비번과 다르게 입력해주세요.");
      return;
    }

    setIsPasswordChanging(true);
    setAuthError("");

    const { data: authData, error: signInError } =
      await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      });

    if (signInError) {
      setAuthError(`현재 비번을 확인하지 못했습니다: ${signInError.message}`);
      setIsPasswordChanging(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: nextPassword,
    });

    if (updateError) {
      setAuthError(`비번 변경에 실패했습니다: ${updateError.message}`);
      setIsPasswordChanging(false);
      return;
    }

    setSession(authData.session);
    setIsAuthModalOpen(false);
    setAuthMode("login");
    setLoginForm(initialLoginForm);
    setIsPasswordChanging(false);
    window.alert("비번을 변경했습니다.");
  };

  const updateField = (field, value) => {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  };

  const updateIntegerField = (field, value) => {
    updateField(field, sanitizeInteger(value));
  };

  const updateDecimalField = (field, value) => {
    updateField(field, sanitizeDecimal(value));
  };

  const closeModalFromBackdrop = (event) => {
    if (event.target === event.currentTarget) {
      closeModal();
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setSaveError("");

    const payload = {
      week_start: form.week_start,
      active_devices: Number(form.active_devices),
      wau: Number(form.wau),
      total_usage_hours: Number(form.total_usage_hours),
      new_installs: Number(form.new_installs),
      event_note: form.event_note.trim() || null,
      service_id: normalizeSelectId(form.service_id),
      event_type_id: normalizeSelectId(form.event_type_id),
    };

    const result = await supabase.from("ott_weekly").insert(payload);

    if (result.error) {
      setSaveError(result.error.message);
      setIsSaving(false);
      return;
    }

    try {
      const nextData = await getDashboardData();
      setData(nextData);
      setErrorMessage("");
      setIsModalOpen(false);
      setForm(createFormDefaults(nextData.services, nextData.latestWeek));
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const header = (
    <header className="header">
      <p className="eyebrow">OTT WEEKLY</p>
      <div className="headerTitleRow">
        <h1>OTT 이용 현황 대시보드</h1>
        <div className="headerActions">
          {isDataManager ? (
            <button
              className="addDataButton"
              disabled={!data || !services.length}
              type="button"
              onClick={openModal}
            >
              데이터 추가
            </button>
          ) : null}
          {currentUserEmail ? (
            <span className="userEmail">{currentUserEmail}</span>
          ) : null}
          <button
            className="secondaryButton"
            disabled={isAuthSubmitting}
            type="button"
            onClick={handleAuthButtonClick}
          >
            {session ? "로그아웃" : "로그인"}
          </button>
        </div>
      </div>
      <p>Supabase의 최신 데이터를 바로 확인합니다.</p>
    </header>
  );

  const modal = isModalOpen ? (
    <div
      aria-labelledby="add-data-title"
      aria-modal="true"
      className="modalBackdrop"
      role="dialog"
      onClick={closeModalFromBackdrop}
    >
      <form className="modalPanel" onSubmit={handleSubmit}>
        <div className="modalHeader">
          <h2 id="add-data-title">데이터 추가</h2>
          <button
            aria-label="닫기"
            className="modalCloseButton"
            disabled={isSaving}
            type="button"
            onClick={closeModal}
          >
            x
          </button>
        </div>

        <div className="formGrid">
          <label className="formField">
            <span>기준일</span>
            <input
              required
              type="date"
              value={form.week_start}
              onChange={(event) => updateField("week_start", event.target.value)}
            />
          </label>

          <label className="formField">
            <span>서비스 ID</span>
            <select
              required
              value={form.service_id}
              onChange={(event) => updateField("service_id", event.target.value)}
            >
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name} ({service.id})
                </option>
              ))}
            </select>
          </label>

          <label className="formField">
            <span>WAU</span>
            <input
              required
              inputMode="numeric"
              min="0"
              pattern="[0-9]*"
              type="text"
              value={form.wau}
              onChange={(event) => updateIntegerField("wau", event.target.value)}
            />
          </label>

          <label className="formField">
            <span>이용 시간</span>
            <input
              required
              inputMode="decimal"
              min="0"
              type="text"
              value={form.total_usage_hours}
              onChange={(event) =>
                updateDecimalField("total_usage_hours", event.target.value)
              }
            />
          </label>

          <label className="formField">
            <span>active_devices</span>
            <input
              required
              inputMode="numeric"
              min="0"
              pattern="[0-9]*"
              type="text"
              value={form.active_devices}
              onChange={(event) =>
                updateIntegerField("active_devices", event.target.value)
              }
            />
          </label>

          <label className="formField">
            <span>이벤트 타입 ID</span>
            <select
              value={form.event_type_id}
              onChange={(event) =>
                updateField("event_type_id", event.target.value)
              }
            >
              <option value="">NULL</option>
              {eventTypes.map((eventType) => (
                <option key={eventType.id} value={eventType.id}>
                  {eventType.name} ({eventType.id})
                </option>
              ))}
            </select>
          </label>

          <label className="formField">
            <span>신규 설치</span>
            <input
              required
              inputMode="numeric"
              min="0"
              pattern="[0-9]*"
              type="text"
              value={form.new_installs}
              onChange={(event) =>
                updateIntegerField("new_installs", event.target.value)
              }
            />
          </label>

          <label className="formField">
            <span>이벤트</span>
            <input
              type="text"
              value={form.event_note}
              onChange={(event) => updateField("event_note", event.target.value)}
            />
          </label>
        </div>

        {saveError ? (
          <p className="formError" role="alert">
            {saveError}
          </p>
        ) : null}

        <div className="modalActions">
          <button
            className="secondaryButton"
            disabled={isSaving}
            type="button"
            onClick={closeModal}
          >
            취소
          </button>
          <button className="primaryButton" disabled={isSaving} type="submit">
            {isSaving ? "저장 중" : "저장"}
          </button>
        </div>
      </form>
    </div>
  ) : null;

  const authModal = isAuthModalOpen ? (
    <div
      aria-labelledby="login-title"
      aria-modal="true"
      className="modalBackdrop"
      role="dialog"
      onClick={closeAuthModalFromBackdrop}
    >
      <form
        className="modalPanel loginModalPanel"
        onSubmit={
          authMode === "passwordChange"
            ? handlePasswordChange
            : handleLoginSubmit
        }
      >
        <div className="modalHeader">
          <h2 id="login-title">
            {authMode === "passwordChange" ? "비번 변경" : "로그인"}
          </h2>
          <button
            aria-label="닫기"
            className="modalCloseButton"
            disabled={isAuthSubmitting || isPasswordChanging}
            type="button"
            onClick={closeAuthModal}
          >
            x
          </button>
        </div>

        <div className="loginForm">
          <label className="formField">
            <span>이메일</span>
            <input
              required
              autoComplete="email"
              type="email"
              value={loginForm.email}
              onChange={(event) => updateLoginField("email", event.target.value)}
            />
          </label>

          <label className="formField">
            <span>{authMode === "passwordChange" ? "현재 비번" : "비번"}</span>
            <input
              required
              autoComplete="current-password"
              type="password"
              value={loginForm.password}
              onChange={(event) =>
                updateLoginField("password", event.target.value)
              }
            />
          </label>

          {authMode === "passwordChange" ? (
            <label className="formField">
              <span>새 비번</span>
              <input
                required
                autoComplete="new-password"
                minLength="6"
                type="password"
                value={loginForm.newPassword}
                onChange={(event) =>
                  updateLoginField("newPassword", event.target.value)
                }
              />
            </label>
          ) : null}
        </div>

        {authError ? (
          <p className="formError" role="alert">
            {authError}
          </p>
        ) : null}

        <div className="modalActions loginActions">
          <button
            className="primaryButton"
            disabled={isAuthSubmitting || isPasswordChanging}
            type="submit"
          >
            {authMode === "passwordChange"
              ? isPasswordChanging
                ? "변경 중"
                : "변경"
              : isAuthSubmitting
                ? "로그인 중"
                : "로그인"}
          </button>
          <button
            className="passwordResetLink"
            disabled={isAuthSubmitting || isPasswordChanging}
            type="button"
            onClick={() => {
              setAuthError("");
              setAuthMode((currentMode) =>
                currentMode === "passwordChange" ? "login" : "passwordChange",
              );
            }}
          >
            {authMode === "passwordChange" ? "로그인으로 돌아가기" : "비번 변경"}
          </button>
        </div>
      </form>
    </div>
  ) : null;

  if (errorMessage) {
    return (
      <>
        {header}
        <section className="statusPanel" role="alert">
          <h2>데이터를 불러오지 못했습니다</h2>
          <p>{errorMessage}</p>
        </section>
        {modal}
        {authModal}
      </>
    );
  }

  if (!isAuthReady) {
    return (
      <>
        {header}
        <section className="statusPanel" aria-live="polite">
          <h2>로그인 상태를 확인하는 중입니다</h2>
          <p>잠시 후 데이터 확인 가능 여부를 표시합니다.</p>
        </section>
        {modal}
        {authModal}
      </>
    );
  }

  if (!session) {
    return (
      <>
        {header}
        <section className="statusPanel">
          <h2>로그인 후 데이터 확인이 가능합니다</h2>
          <p>오른쪽 상단의 로그인 버튼을 눌러 이메일과 비번을 입력해주세요.</p>
        </section>
        {modal}
        {authModal}
      </>
    );
  }

  if (!data) {
    return (
      <>
        {header}
        <section className="statusPanel" aria-live="polite">
          <h2>Supabase 데이터를 불러오는 중입니다</h2>
          <p>브라우저에서 직접 최신 데이터를 요청하고 있습니다.</p>
        </section>
        {modal}
        {authModal}
      </>
    );
  }

  if (!data.trend.length) {
    return (
      <>
        {header}
        <section className="statusPanel">
          <h2>표시할 데이터가 없습니다</h2>
          <p>Supabase 테이블에 조회 가능한 행이 있는지 확인해주세요.</p>
        </section>
        {modal}
        {authModal}
      </>
    );
  }

  return (
    <>
      {header}
      <DashboardCharts data={data} />
      {modal}
      {authModal}
    </>
  );
}
