import supabase from "./supabase";

const SUPABASE_PAGE_SIZE = 1000;
const JWT_CLOCK_SKEW_RETRY_DELAYS = [1500, 4000, 8000];

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
    setTimeout(resolve, ms);
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

async function fetchWeeklyRowsUntil(weekStart) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const result = await runSupabaseQueryWithClockSkewRetry(() =>
      supabase
        .from("ott_weekly")
        .select("*")
        .lte("week_start", weekStart)
        .order("week_start")
        .range(from, to),
    );
    const pageRows = assertSupabaseResult("ott_weekly", result);

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

function roundToOne(value) {
  return Math.round(value * 10) / 10;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function createLookup(rows, key) {
  return new Map(rows.map((row) => [row[key], row]));
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

function calculateReportRows(weeklyRows, servicesRows, weekStart) {
  const serviceById = createLookup(servicesRows, "id");
  const rows = weeklyRows
    .map((row) => ({
      week_start: formatWeekStart(row.week_start),
      service_id: row.service_id,
      service_name: serviceById.get(row.service_id)?.name ?? "Unknown",
      wau: Number(row.wau ?? 0),
      total_usage_hours: Number(row.total_usage_hours ?? 0),
      active_devices: Number(row.active_devices ?? 0),
      new_installs: Number(row.new_installs ?? 0),
      event_note: row.event_note ?? null,
    }))
    .sort(
      (left, right) =>
        String(left.service_id).localeCompare(String(right.service_id)) ||
        left.week_start.localeCompare(right.week_start),
    );
  const rowsByServiceId = new Map();

  rows.forEach((row) => {
    const serviceRows = rowsByServiceId.get(row.service_id) ?? [];
    serviceRows.push(row);
    rowsByServiceId.set(row.service_id, serviceRows);
  });

  const baseRows = [...rowsByServiceId.values()].flatMap((serviceRows) =>
    serviceRows.map((row, index) => {
      const previousRow = serviceRows[index - 1];

      return {
        ...row,
        ats: row.wau === 0 ? null : roundToTwo(row.total_usage_hours / row.wau),
        prev_wau: previousRow?.wau ?? null,
        prev_new_installs: previousRow?.new_installs ?? null,
      };
    }),
  );
  const totalWauByWeek = new Map();

  baseRows.forEach((row) => {
    totalWauByWeek.set(
      row.week_start,
      (totalWauByWeek.get(row.week_start) ?? 0) + row.wau,
    );
  });

  const rankByWeekAndService = new Map();
  const weeks = [...new Set(baseRows.map((row) => row.week_start))];

  weeks.forEach((week) => {
    const weekRows = baseRows
      .filter((row) => row.week_start === week)
      .sort((left, right) => right.wau - left.wau);
    let previousWau = null;
    let previousRank = 0;

    weekRows.forEach((row, index) => {
      const rank = row.wau === previousWau ? previousRank : index + 1;

      previousWau = row.wau;
      previousRank = rank;
      rankByWeekAndService.set(`${week}:${row.service_id}`, rank);
    });
  });

  const rangeStart = addDays(weekStart, -49);

  return baseRows
    .map((row) => {
      const wauWowChange =
        row.prev_wau === null ? null : row.wau - row.prev_wau;
      const installsWowChange =
        row.prev_new_installs === null
          ? null
          : row.new_installs - row.prev_new_installs;

      return {
        ...row,
        wau_wow_change: wauWowChange,
        wau_wow_rate:
          row.prev_wau === null || row.prev_wau === 0
            ? null
            : roundToOne((wauWowChange / row.prev_wau) * 100),
        wau_share:
          totalWauByWeek.get(row.week_start) === 0
            ? null
            : roundToOne((row.wau / totalWauByWeek.get(row.week_start)) * 100),
        wau_rank: rankByWeekAndService.get(
          `${row.week_start}:${row.service_id}`,
        ),
        installs_wow_change: installsWowChange,
        installs_wow_rate:
          row.prev_new_installs === null || row.prev_new_installs === 0
            ? null
            : roundToOne((installsWowChange / row.prev_new_installs) * 100),
      };
    })
    .filter((row) => row.week_start >= rangeStart && row.week_start <= weekStart)
    .sort(
      (left, right) =>
        right.week_start.localeCompare(left.week_start) ||
        left.wau_rank - right.wau_rank,
    );
}

function createReportSummary(reportRows, weekStart) {
  const currentRows = reportRows
    .filter((row) => row.week_start === weekStart)
    .sort((left, right) => left.wau_rank - right.wau_rank);
  const previousWeek = addDays(weekStart, -7);
  const previousRows = reportRows.filter(
    (row) => row.week_start === previousWeek,
  );
  const totalWau = sum(currentRows, "wau");
  const previousTotalWau = sum(previousRows, "wau");
  const totalWauChange = currentRows.reduce(
    (total, row) => total + (row.wau_wow_change ?? 0),
    0,
  );
  const totalWauRate =
    previousTotalWau === 0
      ? null
      : roundToOne((totalWauChange / previousTotalWau) * 100);
  const fastestGrowth =
    [...currentRows]
      .filter((row) => row.wau_wow_rate !== null)
      .sort((left, right) => right.wau_wow_rate - left.wau_wow_rate)[0] ??
    [...currentRows].sort(
      (left, right) =>
        (right.wau_wow_change ?? -Infinity) -
        (left.wau_wow_change ?? -Infinity),
    )[0] ??
    null;

  return {
    currentRows,
    previousWeek,
    previousRows,
    totalWau,
    previousTotalWau,
    totalWauChange,
    totalWauRate,
    topService: currentRows[0] ?? null,
    fastestGrowth,
    totalNewInstalls: sum(currentRows, "new_installs"),
    reportEnd: addDays(weekStart, 6),
  };
}

function createChartTableRows(reportRows, weeks, services, metric) {
  const rowsByWeekAndService = new Map(
    reportRows.map((row) => [`${row.week_start}:${row.service_name}`, row]),
  );

  return weeks.map((week) => ({
    week_start: week,
    ...Object.fromEntries(
      services.map((service) => {
        const row = rowsByWeekAndService.get(`${week}:${service}`);

        return [service, row?.[metric] ?? null];
      }),
    ),
  }));
}

function createReportPages(reportRows, summary, weekStart) {
  const currentRows = summary.currentRows;
  const weeks = [...new Set(reportRows.map((row) => row.week_start))].sort();
  const chartWeeks = weeks.slice(-8);
  const chartServices = currentRows.map((row) => row.service_name);

  return {
    page1: {
      title: "Executive Summary",
      reportWeek: {
        start: weekStart,
        end: summary.reportEnd,
      },
      metrics: {
        totalWau: summary.totalWau,
        totalWauChange: summary.totalWauChange,
        totalWauRate: summary.totalWauRate,
        topService: summary.topService,
        fastestGrowth: summary.fastestGrowth,
        totalNewInstalls: summary.totalNewInstalls,
      },
      bullets: [
        {
          key: "total_wau_wow",
          value: `${currentRows.length} services total WAU changed ${summary.totalWauRate ?? "-"}% WoW.`,
        },
        {
          key: "top_service",
          value: summary.topService
            ? `${summary.topService.service_name} ranked #1 with ${summary.topService.wau_share}% WAU share.`
            : null,
        },
        {
          key: "fastest_growth",
          value: summary.fastestGrowth
            ? `${summary.fastestGrowth.service_name} had the strongest WAU growth at ${summary.fastestGrowth.wau_wow_rate}%.`
            : null,
        },
      ],
    },
    page2: {
      title: "Service WAU Ranking",
      columns: [
        "rank",
        "service",
        "wau",
        "wau_wow_rate",
        "wau_share",
        "new_installs",
        "installs_wow_rate",
        "ats",
        "event_note",
      ],
      rows: currentRows.map((row) => ({
        rank: row.wau_rank,
        service: row.service_name,
        service_id: row.service_id,
        wau: row.wau,
        wau_wow_rate: row.wau_wow_rate,
        wau_share: row.wau_share,
        new_installs: row.new_installs,
        installs_wow_rate: row.installs_wow_rate,
        ats: row.ats,
        event_note: row.event_note,
      })),
    },
    page3: {
      title: "Week-over-week Movement",
      comparison: {
        currentWeek: weekStart,
        previousWeek: summary.previousWeek,
      },
      rows: currentRows.map((row) => ({
        service: row.service_name,
        service_id: row.service_id,
        current_wau: row.wau,
        previous_wau: row.prev_wau,
        wau_wow_change: row.wau_wow_change,
        wau_wow_rate: row.wau_wow_rate,
        current_new_installs: row.new_installs,
        previous_new_installs: row.prev_new_installs,
        installs_wow_change: row.installs_wow_change,
        installs_wow_rate: row.installs_wow_rate,
      })),
    },
    page4: {
      title: "8-Week Trend",
      range: {
        start: chartWeeks[0] ?? null,
        end: chartWeeks[chartWeeks.length - 1] ?? null,
      },
      services: chartServices,
      atsTable: createChartTableRows(
        reportRows,
        chartWeeks,
        chartServices,
        "ats",
      ),
      newInstallsTable: createChartTableRows(
        reportRows,
        chartWeeks,
        chartServices,
        "new_installs",
      ),
    },
  };
}

export async function getReportData(weekStart) {
  if (!weekStart) {
    throw new Error("weekStart is required.");
  }

  const normalizedWeekStart = formatWeekStart(weekStart);
  const [weeklyRows, servicesRows] = await Promise.all([
    fetchWeeklyRowsUntil(normalizedWeekStart),
    fetchTableRows("ott_services", "id"),
  ]);
  const rows = calculateReportRows(
    weeklyRows,
    servicesRows,
    normalizedWeekStart,
  );
  const summary = createReportSummary(rows, normalizedWeekStart);

  return {
    weekStart: normalizedWeekStart,
    referenceWeek: normalizedWeekStart,
    queryWindow: {
      from: addDays(normalizedWeekStart, -49),
      to: normalizedWeekStart,
      previousWeek: summary.previousWeek,
      reportEnd: summary.reportEnd,
    },
    rows,
    services: servicesRows,
    summary,
    pages: createReportPages(rows, summary, normalizedWeekStart),
  };
}
