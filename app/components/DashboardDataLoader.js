"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DashboardCharts from "./DashboardCharts";
import ReportSlideshow from "./ReportSlideshow";
import { getReportData } from "../lib/reportData";
import supabase from "../lib/supabase";

const SUPABASE_PAGE_SIZE = 1000;
const JWT_CLOCK_SKEW_RETRY_DELAYS = [1500, 4000, 8000];
const REPORT_MODAL_TRANSITION_MS = 240;
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

function isJwtIssuedAtFutureError(result) {
  return (
    result.error?.code === "PGRST303" ||
    result.error?.message?.toLowerCase().includes("jwt issued at future")
  );
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function runSupabaseQueryWithClockSkewRetry(createQuery) {
  for (
    let attempt = 0;
    attempt <= JWT_CLOCK_SKEW_RETRY_DELAYS.length;
    attempt += 1
  ) {
    const result = await createQuery();

    if (
      !isJwtIssuedAtFutureError(result) ||
      attempt === JWT_CLOCK_SKEW_RETRY_DELAYS.length
    ) {
      return result;
    }

    await wait(JWT_CLOCK_SKEW_RETRY_DELAYS[attempt]);
  }
}

async function fetchTableRows(tableName, orderColumn) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const result = await runSupabaseQueryWithClockSkewRetry(() =>
      supabase.from(tableName).select("*").order(orderColumn).range(from, to),
    );
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

function formatShortDate(value) {
  if (!value) {
    return "-";
  }

  return String(value).slice(2, 10);
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  return Number(value).toLocaleString("ko-KR");
}

function formatDecimal(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  return Number(value).toLocaleString("ko-KR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  return `${Number(value) > 0 ? "+" : ""}${formatDecimal(value, 1)}%`;
}

function formatSignedNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  return `${Number(value) > 0 ? "+" : ""}${formatNumber(value)}`;
}

function formatMetricCompact(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  const numberValue = Number(value);

  if (Math.abs(numberValue) >= 1000000) {
    return `${formatDecimal(numberValue / 1000000, 2)}M`;
  }

  if (Math.abs(numberValue) >= 1000) {
    return `${formatDecimal(numberValue / 1000, 1)}K`;
  }

  return formatNumber(numberValue);
}

function createFormDefaults(services, latestWeek) {
  return {
    ...initialForm,
    week_start: addDays(latestWeek, 7),
    service_id: services[0]?.id != null ? String(services[0].id) : "",
    event_type_id: "",
  };
}

function MetricCard({ label, primary, secondary }) {
  return (
    <div className="reportDataMetric">
      <span>{label}</span>
      <strong>{primary}</strong>
      <small>{secondary}</small>
    </div>
  );
}

function ReportDataTable({ columns, rows, emptyMessage }) {
  return (
    <div className="reportDataTableWrap">
      <table className="reportDataTable">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key ?? index}>
              {columns.map((column) => (
                <td key={column.key}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td className="emptyCell" colSpan={columns.length}>
                {emptyMessage}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function ReportDataModal({
  isLoading,
  errorMessage,
  reportData,
  selectedWeek,
  onClose,
  onBackdropClick,
}) {
  const summary = reportData?.summary ?? null;
  const currentRows = summary?.currentRows ?? [];
  const weeks = reportData
    ? [...new Set(reportData.rows.map((row) => row.week_start))].sort()
    : [];
  const chartWeeks = weeks.slice(-8);
  const chartServices = currentRows.map((row) => row.service_name);
  const rowsByWeekAndService = new Map(
    (reportData?.rows ?? []).map((row) => [
      `${row.week_start}:${row.service_name}`,
      row,
    ]),
  );
  const rankingColumns = [
    { key: "rank", label: "Rank", render: (row) => row.wau_rank },
    { key: "service", label: "Service", render: (row) => row.service_name },
    { key: "wau", label: "WAU", render: (row) => formatNumber(row.wau) },
    {
      key: "wau_wow",
      label: "WoW",
      render: (row) => formatPercent(row.wau_wow_rate),
    },
    {
      key: "share",
      label: "Share",
      render: (row) =>
        row.wau_share === null ? "-" : `${formatDecimal(row.wau_share, 1)}%`,
    },
    {
      key: "new_installs",
      label: "신규 설치",
      render: (row) => formatNumber(row.new_installs),
    },
    {
      key: "installs_wow",
      label: "WoW",
      render: (row) => formatPercent(row.installs_wow_rate),
    },
    { key: "ats", label: "ATS", render: (row) => formatDecimal(row.ats, 2) },
    {
      key: "note",
      label: "주요 특징",
      render: (row) => row.event_note || "큰 변화 없음",
    },
  ];
  const comparisonColumns = [
    { key: "service", label: "Service", render: (row) => row.service_name },
    { key: "wau", label: "기준주 WAU", render: (row) => formatNumber(row.wau) },
    {
      key: "prev_wau",
      label: "전주 WAU",
      render: (row) => formatNumber(row.prev_wau),
    },
    {
      key: "wau_change",
      label: "WAU 증감",
      render: (row) => formatSignedNumber(row.wau_wow_change),
    },
    {
      key: "wau_rate",
      label: "WAU 증감률",
      render: (row) => formatPercent(row.wau_wow_rate),
    },
    {
      key: "new_installs",
      label: "기준주 신규 설치",
      render: (row) => formatNumber(row.new_installs),
    },
    {
      key: "prev_new_installs",
      label: "전주 신규 설치",
      render: (row) => formatNumber(row.prev_new_installs),
    },
    {
      key: "installs_change",
      label: "신규 설치 증감",
      render: (row) => formatSignedNumber(row.installs_wow_change),
    },
    {
      key: "installs_rate",
      label: "신규 설치 증감률",
      render: (row) => formatPercent(row.installs_wow_rate),
    },
  ];
  const chartColumns = [
    { key: "week", label: "Week", render: (row) => row.week_start },
    ...chartServices.map((service) => ({
      key: service,
      label: service,
      render: (row) => row[service],
    })),
  ];
  const atsChartRows = chartWeeks.map((week) => ({
    key: `ats-${week}`,
    week_start: week,
    ...Object.fromEntries(
      chartServices.map((service) => {
        const row = rowsByWeekAndService.get(`${week}:${service}`);

        return [service, formatDecimal(row?.ats, 2)];
      }),
    ),
  }));
  const installsChartRows = chartWeeks.map((week) => ({
    key: `installs-${week}`,
    week_start: week,
    ...Object.fromEntries(
      chartServices.map((service) => {
        const row = rowsByWeekAndService.get(`${week}:${service}`);

        return [service, formatNumber(row?.new_installs)];
      }),
    ),
  }));

  return (
    <div
      aria-labelledby="report-data-title"
      aria-modal="true"
      className="modalBackdrop"
      role="dialog"
      onClick={onBackdropClick}
    >
      <section className="modalPanel reportDataPanel">
        <div className="modalHeader">
          <div>
            <h2 id="report-data-title">리포트 데이터</h2>
            <p className="reportDataSubtitle">
              기준주 {selectedWeek ? formatShortDate(selectedWeek) : "-"}
            </p>
          </div>
          <button
            aria-label="닫기"
            className="modalCloseButton"
            type="button"
            onClick={onClose}
          >
            x
          </button>
        </div>

        {isLoading ? (
          <div className="reportDataState" aria-live="polite">
            보고서 작성용 데이터를 불러오는 중입니다.
          </div>
        ) : errorMessage ? (
          <div className="reportDataState reportDataError" role="alert">
            {errorMessage}
          </div>
        ) : reportData && summary ? (
          <div className="reportDataPages">
            <article className="reportDataPage">
              <div className="reportDataPageHeader">
                <span>Page 1</span>
                <h3>Executive Summary</h3>
                <p>
                  Report week: {formatShortDate(reportData.referenceWeek)} ~{" "}
                  {formatShortDate(summary.reportEnd)}
                </p>
              </div>
              <div className="reportDataMetrics">
                <MetricCard
                  label="Total WAU"
                  primary={formatNumber(summary.totalWau)}
                  secondary={`${formatSignedNumber(
                    summary.totalWauChange,
                  )} WoW`}
                />
                <MetricCard
                  label="WoW Growth"
                  primary={formatPercent(summary.totalWauRate)}
                  secondary={`${formatShortDate(summary.previousWeek)} 대비`}
                />
                <MetricCard
                  label="Top Service"
                  primary={summary.topService?.service_name ?? "-"}
                  secondary={
                    summary.topService
                      ? `${formatMetricCompact(summary.topService.wau)} WAU`
                      : "-"
                  }
                />
                <MetricCard
                  label="Fastest Growth"
                  primary={summary.fastestGrowth?.service_name ?? "-"}
                  secondary={
                    summary.fastestGrowth
                      ? `${formatPercent(summary.fastestGrowth.wau_wow_rate)} WoW`
                      : "-"
                  }
                />
              </div>
              <ul className="reportDataBullets">
                <li>
                  {currentRows.length}개 OTT 합산 WAU는 전주 대비{" "}
                  {formatPercent(summary.totalWauRate)} 변동했습니다.
                </li>
                <li>
                  {summary.topService
                    ? `${summary.topService.service_name}가 ${formatDecimal(
                        summary.topService.wau_share,
                        1,
                      )}% 점유율로 1위입니다.`
                    : "선택한 주차의 1위 서비스 데이터가 없습니다."}
                </li>
                <li>
                  {summary.fastestGrowth
                    ? `${summary.fastestGrowth.service_name}가 WAU ${formatPercent(
                        summary.fastestGrowth.wau_wow_rate,
                      )}로 가장 크게 성장했습니다.`
                    : "전주 대비 성장률을 계산할 데이터가 없습니다."}
                </li>
              </ul>
            </article>

            <article className="reportDataPage">
              <div className="reportDataPageHeader">
                <span>Page 2</span>
                <h3>Service WAU Ranking</h3>
              </div>
              <ReportDataTable
                columns={rankingColumns}
                rows={currentRows}
                emptyMessage="선택한 주차의 서비스별 데이터가 없습니다."
              />
            </article>

            <article className="reportDataPage">
              <div className="reportDataPageHeader">
                <span>Page 3</span>
                <h3>Week-over-week Movement</h3>
                <p>
                  {formatShortDate(reportData.referenceWeek)} vs.{" "}
                  {formatShortDate(summary.previousWeek)}
                </p>
              </div>
              <ReportDataTable
                columns={comparisonColumns}
                rows={currentRows}
                emptyMessage="전주 비교 데이터를 계산할 수 없습니다."
              />
            </article>

            <article className="reportDataPage">
              <div className="reportDataPageHeader">
                <span>Page 4</span>
                <h3>8-Week Trend</h3>
                <p>
                  {formatShortDate(chartWeeks[0])} ~{" "}
                  {formatShortDate(chartWeeks[chartWeeks.length - 1])}
                </p>
              </div>
              <div className="reportDataChartTables">
                <section>
                  <h4>Average Time Spent</h4>
                  <ReportDataTable
                    columns={chartColumns}
                    rows={atsChartRows}
                    emptyMessage="ATS 차트용 데이터가 없습니다."
                  />
                </section>
                <section>
                  <h4>New Installs</h4>
                  <ReportDataTable
                    columns={chartColumns}
                    rows={installsChartRows}
                    emptyMessage="신규 설치 차트용 데이터가 없습니다."
                  />
                </section>
              </div>
            </article>
          </div>
        ) : (
          <div className="reportDataState">표시할 데이터가 없습니다.</div>
        )}
      </section>
    </div>
  );
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

export default function DashboardDataLoader({ reports = [] }) {
  const reportModalCloseTimerRef = useRef(null);
  const [data, setData] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isReportDataModalOpen, setIsReportDataModalOpen] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [reportDataError, setReportDataError] = useState("");
  const [isReportDataLoading, setIsReportDataLoading] = useState(false);
  const [selectedReportDataWeek, setSelectedReportDataWeek] = useState("");
  const [form, setForm] = useState(initialForm);
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [session, setSession] = useState(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isReportModalVisible, setIsReportModalVisible] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [loginForm, setLoginForm] = useState(initialLoginForm);
  const [authError, setAuthError] = useState("");
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isPasswordChanging, setIsPasswordChanging] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [selectedReportFileName, setSelectedReportFileName] = useState(
    reports[0]?.fileName ?? "",
  );
  const services = data?.services ?? [];
  const eventTypes = data?.eventTypes ?? [];
  const currentUserEmail = session?.user?.email ?? "";
  const currentUserId = session?.user?.id ?? "";
  const sessionUserId = session?.user?.id ?? "";
  const selectedReport =
    reports.find((report) => report.fileName === selectedReportFileName) ??
    null;
  const isDataManager =
    dataManagerIdentifiers.has(currentUserEmail.toLowerCase()) ||
    dataManagerIdentifiers.has(currentUserId.toLowerCase());

  const updateSelectedReportDataWeek = useCallback((week) => {
    setSelectedReportDataWeek(week);
  }, []);

  const openReportModal = () => {
    if (!session || !reports.length || !selectedReport) {
      return;
    }

    window.clearTimeout(reportModalCloseTimerRef.current);
    setIsReportModalOpen(true);
    requestAnimationFrame(() => {
      setIsReportModalVisible(true);
    });
  };

  const closeReportModal = () => {
    setIsReportModalVisible(false);
    window.clearTimeout(reportModalCloseTimerRef.current);
    reportModalCloseTimerRef.current = window.setTimeout(() => {
      setIsReportModalOpen(false);
    }, REPORT_MODAL_TRANSITION_MS);
  };

  const openReportDataModal = async () => {
    const referenceWeek = selectedReportDataWeek || data?.latestWeek;

    if (!session || !referenceWeek) {
      return;
    }

    setIsReportDataModalOpen(true);
    setIsReportDataLoading(true);
    setReportDataError("");
    setReportData(null);

    try {
      const nextReportData = await getReportData(referenceWeek);

      setReportData(nextReportData);
    } catch (error) {
      setReportDataError(error.message);
    } finally {
      setIsReportDataLoading(false);
    }
  };

  const closeReportDataModal = () => {
    if (!isReportDataLoading) {
      setIsReportDataModalOpen(false);
      setReportDataError("");
    }
  };

  const closeReportDataModalFromBackdrop = (event) => {
    if (event.target === event.currentTarget) {
      closeReportDataModal();
    }
  };

  const loadData = useCallback(() => {
    let isMounted = true;

    getDashboardData()
      .then((nextData) => {
        if (!isMounted) {
          return;
        }

        setData(nextData);
        setSelectedReportDataWeek((currentWeek) => {
          const weeks = new Set(nextData.trend.map((row) => row.week_start));

          return currentWeek && weeks.has(currentWeek)
            ? currentWeek
            : nextData.latestWeek;
        });
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
  }, [isAuthReady, loadData, sessionUserId]);

  useEffect(() => {
    if (!reports.length) {
      setSelectedReportFileName("");
      return;
    }

    setSelectedReportFileName((currentFileName) =>
      reports.some((report) => report.fileName === currentFileName)
        ? currentFileName
        : reports[0].fileName,
    );
  }, [reports]);

  useEffect(() => {
    if (
      !isModalOpen &&
      !isAuthModalOpen &&
      !isReportModalOpen &&
      !isReportDataModalOpen
    ) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isModalOpen, isAuthModalOpen, isReportModalOpen, isReportDataModalOpen]);

  useEffect(() => {
    if (!isReportModalOpen) {
      return undefined;
    }

    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        closeReportModal();
      }
    };

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isReportModalOpen]);

  useEffect(
    () => () => {
      window.clearTimeout(reportModalCloseTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!session && isReportModalOpen) {
      window.clearTimeout(reportModalCloseTimerRef.current);
      setIsReportModalVisible(false);
      setIsReportModalOpen(false);
    }

    if (!session && isReportDataModalOpen) {
      setIsReportDataModalOpen(false);
      setReportData(null);
      setReportDataError("");
    }
  }, [isReportDataModalOpen, isReportModalOpen, session]);

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
      setIsReportDataModalOpen(false);
      setReportData(null);
      setReportDataError("");
      setIsReportModalVisible(false);
      setIsReportModalOpen(false);
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

    const result = await runSupabaseQueryWithClockSkewRetry(() =>
      supabase.from("ott_weekly").insert(payload),
    );

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
          {session ? (
            <button
              className="secondaryButton reportOpenButton"
              disabled={!data || !selectedReportDataWeek || isReportDataLoading}
              type="button"
              onClick={openReportDataModal}
            >
              리포트 데이터
            </button>
          ) : null}
          {session ? (
            <button
              className="secondaryButton reportOpenButton"
              disabled={!reports.length}
              type="button"
              onClick={openReportModal}
            >
              분석 보고서
            </button>
          ) : null}
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

  const reportModal =
    isReportModalOpen && session && selectedReport ? (
      <div
        aria-labelledby="report-modal-title"
        aria-modal="true"
        className={`reportModalBackdrop${
          isReportModalVisible ? " visible" : ""
        }`}
        role="dialog"
      >
        <div className="reportModalPanel">
          <ReportSlideshow
            report={selectedReport}
            reports={reports}
            selectedReportFileName={selectedReportFileName}
            onClose={closeReportModal}
            onReportChange={setSelectedReportFileName}
          />
        </div>
      </div>
    ) : null;

  const reportDataModal =
    isReportDataModalOpen && session ? (
      <ReportDataModal
        errorMessage={reportDataError}
        isLoading={isReportDataLoading}
        reportData={reportData}
        selectedWeek={selectedReportDataWeek || data?.latestWeek}
        onBackdropClick={closeReportDataModalFromBackdrop}
        onClose={closeReportDataModal}
      />
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
        {reportDataModal}
        {reportModal}
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
        {reportDataModal}
        {reportModal}
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
        {reportDataModal}
        {reportModal}
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
        {reportDataModal}
        {reportModal}
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
        {reportDataModal}
        {reportModal}
        {authModal}
      </>
    );
  }

  return (
    <>
      {header}
      <DashboardCharts
        data={data}
        onRankingDateChange={updateSelectedReportDataWeek}
      />
      {modal}
      {reportDataModal}
      {reportModal}
      {authModal}
    </>
  );
}
