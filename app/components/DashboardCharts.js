"use client";

import { useEffect, useRef, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar, Line, Pie } from "react-chartjs-2";

const LEGEND_CHART_GAP = 14;

const legendSpacingPlugin = {
  id: "legendSpacing",
  beforeInit(chart) {
    const originalFit = chart.legend?.fit;

    if (!originalFit) {
      return;
    }

    chart.legend.fit = function fit() {
      originalFit.call(this);

      if (this.options.display !== false) {
        this.height += LEGEND_CHART_GAP;
      }
    };
  },
};

const pieShareLabelsPlugin = {
  id: "pieShareLabels",
  afterDatasetsDraw(chart) {
    if (chart.config.type !== "pie") {
      return;
    }

    const dataset = chart.data.datasets[0];
    const values = dataset.data.map(Number);
    const total = values.reduce((sum, value) => sum + value, 0);

    if (!total) {
      return;
    }

    const meta = chart.getDatasetMeta(0);
    const { ctx } = chart;

    ctx.save();
    ctx.font = "700 14px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    meta.data.forEach((arc, index) => {
      const value = values[index];

      if (!value) {
        return;
      }

      const angle = (arc.startAngle + arc.endAngle) / 2;
      const radius =
        arc.innerRadius + (arc.outerRadius - arc.innerRadius) * 0.75;
      const x = arc.x + Math.cos(angle) * radius;
      const y = arc.y + Math.sin(angle) * radius;
      const label = chart.data.labels[index];
      const share = `${((value / total) * 100).toLocaleString("ko-KR", {
        maximumFractionDigits: 1,
      })}%`;

      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
      ctx.fillStyle = "#ffffff";
      ctx.strokeText(label, x, y - 8);
      ctx.fillText(label, x, y - 8);
      ctx.strokeText(share, x, y + 8);
      ctx.fillText(share, x, y + 8);
    });

    ctx.restore();
  },
};

const eventMarkersPlugin = {
  id: "eventMarkers",
  afterDatasetsDraw(chart, _args, options) {
    const markers = options?.markers ?? [];

    if (!markers.length) {
      return;
    }

    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;

    if (!xScale) {
      return;
    }

    ctx.save();
    markers.forEach((marker) => {
      if (!marker.event) {
        return;
      }

      const x = xScale.getPixelForValue(marker.index);

      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(234, 88, 12, 0.45)";
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.fillStyle = "#ea580c";
      ctx.arc(x, chartArea.top + 8, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  },
};

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
  legendSpacingPlugin,
  pieShareLabelsPlugin,
  eventMarkersPlugin,
);

const CHART_COLORS = [
  "#2563eb",
  "#16a34a",
  "#dc2626",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#be123c",
  "#4f46e5",
  "#65a30d",
  "#c026d3",
];

function getServiceColor(service, services) {
  const index = services.indexOf(service);
  const colorIndex = index >= 0 ? index : 0;
  return CHART_COLORS[colorIndex % CHART_COLORS.length];
}

function alphaColor(hex, alpha) {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getServiceLabel(serviceKey, services) {
  return (
    services.find(
      (service) => service.toLowerCase() === serviceKey.toLowerCase(),
    ) ?? serviceKey
  );
}

function formatMillions(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return value;
  }

  return `${(number / 1_000_000).toLocaleString("ko-KR", {
    maximumFractionDigits: 1,
  })}M`;
}

function formatNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return value;
  }

  return number.toLocaleString("ko-KR");
}

function formatPercent(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return value;
  }

  return `${number.toLocaleString("ko-KR", {
    maximumFractionDigits: 1,
  })}%`;
}

function formatShortWeek(value) {
  const date =
    typeof value === "number"
      ? new Date(value)
      : new Date(`${String(value).slice(0, 10)}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = String(date.getFullYear()).slice(2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

const COMPARISON_METRICS = [
  { key: "wau", label: "WAU", unit: "명" },
  { key: "ats", label: "ATS", unit: "시간" },
  { key: "total_usage_hours", label: "이용시간", unit: "시간" },
  { key: "active_devices", label: "액티브 기기", unit: "대" },
];

function getComparisonMetric(key) {
  return COMPARISON_METRICS.find((metric) => metric.key === key);
}

function formatMetricTick(metricKey, value) {
  return metricKey === "ats" ? formatNumber(value) : formatMillions(value);
}

function formatMetricValue(metricKey, value) {
  const metric = getComparisonMetric(metricKey);
  const formatted =
    metricKey === "ats"
      ? Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 2 })
      : formatNumber(value);

  return metric?.unit ? `${formatted}${metric.unit}` : formatted;
}

function getEventLabel(row) {
  return [row.event_types, row.event_notes].filter(Boolean).join(" / ");
}

function getWeekScaleOptions() {
  return {
    type: "category",
    grid: {
      drawOnChartArea: false,
    },
    ticks: {
      autoSkip: true,
      callback(value) {
        return formatShortWeek(this.getLabelForValue(value));
      },
      maxRotation: 0,
      maxTicksLimit: 6,
      minRotation: 0,
    },
  };
}

const wauScaleOptions = {
  y: {
    ticks: {
      callback: formatMillions,
    },
  },
};

const shareScaleOptions = {
  y: {
    ticks: {
      callback: formatPercent,
    },
  },
};

const wauTooltipOptions = {
  callbacks: {
    label(context) {
      const value =
        typeof context.parsed === "number" ? context.parsed : context.parsed.y;

      return `${context.label ?? context.dataset.label}: ${formatNumber(value)}`;
    },
  },
};

const weekWauTooltipOptions = {
  callbacks: {
    title(context) {
      return formatShortWeek(context[0]?.label);
    },
    label(context) {
      return `${context.dataset.label}: ${formatNumber(context.parsed.y)}`;
    },
  },
};

const weekShareTooltipOptions = {
  callbacks: {
    title(context) {
      return formatShortWeek(context[0]?.label);
    },
    label(context) {
      return `${context.dataset.label}: ${formatPercent(context.parsed.y)}`;
    },
  },
};

const weekTooltipOptions = {
  callbacks: {
    title(context) {
      return formatShortWeek(context[0]?.label);
    },
  },
};

function focusLegendDataset(_event, legendItem, legend) {
  const chart = legend.chart;
  const selectedIndex = legendItem.datasetIndex;
  const datasetIndexes = chart.data.datasets.map((_dataset, index) => index);
  const visibleIndexes = chart.data.datasets
    .map((_dataset, index) => index)
    .filter((index) => chart.isDatasetVisible(index));
  const allVisible = visibleIndexes.length === chart.data.datasets.length;
  const selectedVisible = chart.isDatasetVisible(selectedIndex);

  if (allVisible) {
    datasetIndexes.forEach((index) => {
      chart.setDatasetVisibility(index, index === selectedIndex);
    });
  } else if (selectedVisible) {
    const willHideLastVisible = visibleIndexes.length === 1;

    datasetIndexes.forEach((index) => {
      chart.setDatasetVisibility(
        index,
        willHideLastVisible || index !== selectedIndex,
      );
    });
  } else {
    chart.setDatasetVisibility(selectedIndex, true);
  }

  chart.update();
}

const lineChartOptions = {
  maintainAspectRatio: false,
  plugins: {
    legend: {
      onClick: focusLegendDataset,
      labels: {
        boxWidth: 10,
        boxHeight: 10,
        padding: 12,
      },
    },
  },
};

export default function DashboardCharts({ data, onRankingDateChange }) {
  const rangeDragRef = useRef(null);
  const usageRangeDragRef = useRef(null);
  const comparisonRangeDragRef = useRef(null);
  const rankingDateMenuRef = useRef(null);
  const dates = [...new Set(data.trend.map((row) => row.week_start))];
  const rankingDates = [...dates].reverse();
  const allComparisonDates = data.comparison.map((row) => row.week_start);
  const [rankingChartType, setRankingChartType] = useState("bar");
  const [showRankingComparison, setShowRankingComparison] = useState(false);
  const [selectedRankingDate, setSelectedRankingDate] = useState(
    dates[dates.length - 1] ?? "",
  );
  const [isRankingDateMenuOpen, setIsRankingDateMenuOpen] = useState(false);
  const [trendMetric, setTrendMetric] = useState("wau");
  const [usageMetric, setUsageMetric] = useState("ats");
  const [comparisonService, setComparisonService] = useState("all");
  const [comparisonMetricLeft, setComparisonMetricLeft] = useState("wau");
  const [comparisonMetricRight, setComparisonMetricRight] = useState("ats");
  const [eventThreshold, setEventThreshold] = useState(2);
  const [eventService, setEventService] = useState("all");
  const [trendRange, setTrendRange] = useState({
    start: 0,
    end: Math.max(dates.length - 1, 0),
  });
  const [usageRange, setUsageRange] = useState({
    start: 0,
    end: Math.max(data.usage.length - 1, 0),
  });
  const [comparisonRange, setComparisonRange] = useState({
    start: 0,
    end: Math.max(allComparisonDates.length - 1, 0),
  });

  useEffect(() => {
    onRankingDateChange?.(selectedRankingDate);
  }, [onRankingDateChange, selectedRankingDate]);

  useEffect(() => {
    if (!isRankingDateMenuOpen) {
      return;
    }

    const menu = rankingDateMenuRef.current;
    const selectedOption = menu?.querySelector('[aria-selected="true"]');

    if (!menu || !selectedOption) {
      return;
    }

    menu.scrollTop =
      selectedOption.offsetTop -
      menu.clientHeight / 2 +
      selectedOption.clientHeight / 2;
  }, [isRankingDateMenuOpen, selectedRankingDate]);

  const services = [...new Set(data.trend.map((row) => row.service))];
  const comparisonRows =
    comparisonService === "all"
      ? data.comparison
      : data.serviceComparison.filter((row) => row.service === comparisonService);
  const comparisonDates = comparisonRows.map((row) => row.week_start);
  const maxTrendIndex = Math.max(dates.length - 1, 0);
  const trendStartIndex = Math.min(trendRange.start, maxTrendIndex);
  const trendEndIndex = Math.max(
    trendStartIndex,
    Math.min(trendRange.end, maxTrendIndex),
  );
  const rangeStartPercent =
    maxTrendIndex > 0 ? (trendStartIndex / maxTrendIndex) * 100 : 0;
  const rangeEndPercent =
    maxTrendIndex > 0 ? (trendEndIndex / maxTrendIndex) * 100 : 100;
  const selectedDates = dates.slice(trendStartIndex, trendEndIndex + 1);
  const trendPresetRanges = {
    weeks12: {
      start: Math.max(0, maxTrendIndex - 11),
      end: maxTrendIndex,
    },
    year: {
      start: Math.max(0, maxTrendIndex - 51),
      end: maxTrendIndex,
    },
    all: {
      start: 0,
      end: maxTrendIndex,
    },
  };
  const setTrendPreset = (preset) => {
    setTrendRange(trendPresetRanges[preset]);
  };
  const isTrendPresetActive = (preset) =>
    trendStartIndex === trendPresetRanges[preset].start &&
    trendEndIndex === trendPresetRanges[preset].end;
  const selectedDateTotals = Object.fromEntries(
    selectedDates.map((date) => [
      date,
      data.trend
        .filter((row) => row.week_start === date)
        .reduce((sum, row) => sum + row.wau, 0),
    ]),
  );
  const usageDates = data.usage.map((row) => row.week_start);
  const usageServiceKeys = Object.keys(data.usage[0] ?? {}).filter(
    (key) => key !== "week_start",
  );
  const maxUsageIndex = Math.max(usageDates.length - 1, 0);
  const usageStartIndex = Math.min(usageRange.start, maxUsageIndex);
  const usageEndIndex = Math.max(
    usageStartIndex,
    Math.min(usageRange.end, maxUsageIndex),
  );
  const usageRangeStartPercent =
    maxUsageIndex > 0 ? (usageStartIndex / maxUsageIndex) * 100 : 0;
  const usageRangeEndPercent =
    maxUsageIndex > 0 ? (usageEndIndex / maxUsageIndex) * 100 : 100;
  const selectedUsageRows = data.usage.slice(usageStartIndex, usageEndIndex + 1);
  const selectedUsageDates = selectedUsageRows.map((row) => row.week_start);
  const usagePresetRanges = {
    weeks12: {
      start: Math.max(0, maxUsageIndex - 11),
      end: maxUsageIndex,
    },
    year: {
      start: Math.max(0, maxUsageIndex - 51),
      end: maxUsageIndex,
    },
    all: {
      start: 0,
      end: maxUsageIndex,
    },
  };
  const setUsagePreset = (preset) => {
    setUsageRange(usagePresetRanges[preset]);
  };
  const isUsagePresetActive = (preset) =>
    usageStartIndex === usagePresetRanges[preset].start &&
    usageEndIndex === usagePresetRanges[preset].end;
  const maxComparisonIndex = Math.max(comparisonDates.length - 1, 0);
  const comparisonStartIndex = Math.min(
    comparisonRange.start,
    maxComparisonIndex,
  );
  const comparisonEndIndex = Math.max(
    comparisonStartIndex,
    Math.min(comparisonRange.end, maxComparisonIndex),
  );
  const comparisonRangeStartPercent =
    maxComparisonIndex > 0
      ? (comparisonStartIndex / maxComparisonIndex) * 100
      : 0;
  const comparisonRangeEndPercent =
    maxComparisonIndex > 0
      ? (comparisonEndIndex / maxComparisonIndex) * 100
      : 100;
  const selectedComparisonRows = comparisonRows.slice(
    comparisonStartIndex,
    comparisonEndIndex + 1,
  );
  const selectedComparisonDates = selectedComparisonRows.map(
    (row) => row.week_start,
  );
  const comparisonPresetRanges = {
    weeks12: {
      start: Math.max(0, maxComparisonIndex - 11),
      end: maxComparisonIndex,
    },
    year: {
      start: Math.max(0, maxComparisonIndex - 51),
      end: maxComparisonIndex,
    },
    all: {
      start: 0,
      end: maxComparisonIndex,
    },
  };
  const setComparisonPreset = (preset) => {
    setComparisonRange(comparisonPresetRanges[preset]);
  };
  const isComparisonPresetActive = (preset) =>
    comparisonStartIndex === comparisonPresetRanges[preset].start &&
    comparisonEndIndex === comparisonPresetRanges[preset].end;
  const moveTrendRange = (event) => {
    const drag = rangeDragRef.current;

    if (!drag || maxTrendIndex <= 0) {
      return;
    }

    const deltaIndex = Math.round(
      ((event.clientX - drag.startX) / drag.width) * maxTrendIndex,
    );
    const rangeSize = drag.end - drag.start;
    const nextStart = Math.max(
      0,
      Math.min(drag.start + deltaIndex, maxTrendIndex - rangeSize),
    );

    setTrendRange({
      start: nextStart,
      end: nextStart + rangeSize,
    });
  };
  const stopTrendRangeDrag = () => {
    rangeDragRef.current = null;
  };
  const moveUsageRange = (event) => {
    const drag = usageRangeDragRef.current;

    if (!drag || maxUsageIndex <= 0) {
      return;
    }

    const deltaIndex = Math.round(
      ((event.clientX - drag.startX) / drag.width) * maxUsageIndex,
    );
    const rangeSize = drag.end - drag.start;
    const nextStart = Math.max(
      0,
      Math.min(drag.start + deltaIndex, maxUsageIndex - rangeSize),
    );

    setUsageRange({
      start: nextStart,
      end: nextStart + rangeSize,
    });
  };
  const stopUsageRangeDrag = () => {
    usageRangeDragRef.current = null;
  };
  const moveComparisonRange = (event) => {
    const drag = comparisonRangeDragRef.current;

    if (!drag || maxComparisonIndex <= 0) {
      return;
    }

    const deltaIndex = Math.round(
      ((event.clientX - drag.startX) / drag.width) * maxComparisonIndex,
    );
    const rangeSize = drag.end - drag.start;
    const nextStart = Math.max(
      0,
      Math.min(drag.start + deltaIndex, maxComparisonIndex - rangeSize),
    );

    setComparisonRange({
      start: nextStart,
      end: nextStart + rangeSize,
    });
  };
  const stopComparisonRangeDrag = () => {
    comparisonRangeDragRef.current = null;
  };
  const selectedRankingIndex = dates.indexOf(selectedRankingDate);
  const previousRankingDate =
    selectedRankingIndex > 0 ? dates[selectedRankingIndex - 1] : null;
  const selectedRankingRows = data.trend
    .filter((row) => row.week_start === selectedRankingDate)
    .sort((a, b) => b.wau - a.wau);
  const previousRankingByService = Object.fromEntries(
    data.trend
      .filter((row) => row.week_start === previousRankingDate)
      .map((row) => [row.service, row.wau]),
  );
  const rankingColors = selectedRankingRows.map((row) =>
    getServiceColor(row.service, services),
  );
  const rankingChartData = {
    labels: selectedRankingRows.map((row) => row.service),
    datasets: [
      {
        label: "WAU",
        data: selectedRankingRows.map((row) => row.wau),
        backgroundColor: rankingColors,
        borderColor: rankingColors,
        borderWidth: 1,
      },
    ],
  };
  const rankingComparisonData = {
    labels: selectedRankingRows.map((row) => row.service),
    datasets: [
      {
        label: "선택 주차",
        data: selectedRankingRows.map((row) => row.wau),
        backgroundColor: rankingColors,
        borderColor: rankingColors,
        borderWidth: 1,
      },
      {
        label: "전주",
        data: selectedRankingRows.map(
          (row) => previousRankingByService[row.service] ?? null,
        ),
        backgroundColor: rankingColors.map((color) => alphaColor(color, 0.32)),
        borderColor: rankingColors.map((color) => alphaColor(color, 0.65)),
        borderWidth: 1,
      },
    ],
  };
  const rankingCompareTooltipOptions = {
    callbacks: {
      title(context) {
        const week =
          context[0]?.datasetIndex === 1
            ? previousRankingDate
            : selectedRankingDate;

        return `${context[0]?.label ?? ""} (${formatShortWeek(week)})`;
      },
      afterBody(context) {
        const service = context[0]?.label;
        const current = selectedRankingRows.find(
          (row) => row.service === service,
        )?.wau;
        const previous = previousRankingByService[service];

        if (current === undefined || previous === undefined) {
          return "";
        }

        const diff = current - previous;
        const sign = diff > 0 ? "+" : "";
        return `전주 대비: ${sign}${formatNumber(diff)}`;
      },
      label(context) {
        return `${context.dataset.label}: ${formatNumber(context.parsed.y)}`;
      },
    },
  };
  const rankingTooltipOptions = {
    callbacks: {
      title(context) {
        return `${context[0]?.label ?? ""} (${formatShortWeek(
          selectedRankingDate,
        )})`;
      },
      label(context) {
        const value =
          typeof context.parsed === "number" ? context.parsed : context.parsed.y;

        return `WAU: ${formatNumber(value)}`;
      },
    },
  };

  const trendDatasets = services.map((service) => ({
    label: service,
    data: selectedDates.map((date) => {
      const row = data.trend.find(
        (item) => item.service === service && item.week_start === date,
      );

      if (!row) {
        return null;
      }

      if (trendMetric === "share") {
        const total = selectedDateTotals[date];
        return total ? (row.wau / total) * 100 : null;
      }

      return row.wau;
    }),
    borderColor: getServiceColor(service, services),
    backgroundColor: getServiceColor(service, services),
    pointRadius: 0,
    pointHoverRadius: 5,
    tension: 0.25,
  }));

  const usageDatasets = usageServiceKeys.map((serviceKey) => {
    const service = getServiceLabel(serviceKey, services);
    const color = getServiceColor(service, services);

    return {
      label: service,
      data: selectedUsageRows.map((row) => {
        const value = row[serviceKey];

        if (value === null || value === undefined) {
          return null;
        }

        if (usageMetric === "share") {
          const total = usageServiceKeys.reduce(
            (sum, key) => sum + (row[key] ?? 0),
            0,
          );

          return total ? (value / total) * 100 : null;
        }

        return value;
      }),
      borderColor: color,
      backgroundColor: color,
      borderWidth: 1,
      pointRadius: 0,
      pointHoverRadius: 5,
      tension: 0.25,
    };
  });
  const comparisonMetricLeftMeta = getComparisonMetric(comparisonMetricLeft);
  const comparisonMetricRightMeta = getComparisonMetric(comparisonMetricRight);
  const comparisonEventMarkers = selectedComparisonRows.map((row, index) => ({
    index,
    event: getEventLabel(row),
  }));
  const comparisonDatasets = [
    {
      label: comparisonMetricLeftMeta.label,
      metricKey: comparisonMetricLeft,
      data: selectedComparisonRows.map((row) => row[comparisonMetricLeft]),
      borderColor: CHART_COLORS[0],
      backgroundColor: CHART_COLORS[0],
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 5,
      tension: 0.25,
      yAxisID: "y",
    },
    {
      label: comparisonMetricRightMeta.label,
      metricKey: comparisonMetricRight,
      data: selectedComparisonRows.map((row) => row[comparisonMetricRight]),
      borderColor: CHART_COLORS[1],
      backgroundColor: CHART_COLORS[1],
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 5,
      tension: 0.25,
      yAxisID: "y1",
    },
  ];
  const comparisonTooltipOptions = {
    callbacks: {
      title(context) {
        const week = context[0]?.label;
        const row = selectedComparisonRows.find(
          (item) => item.week_start === week,
        );
        const eventLabel = row ? getEventLabel(row) : "";

        return eventLabel
          ? [formatShortWeek(week), `이벤트: ${eventLabel}`]
          : formatShortWeek(week);
      },
      label(context) {
        return `${context.dataset.label}: ${formatMetricValue(
          context.dataset.metricKey,
          context.parsed.y,
        )}`;
      },
    },
  };
  const filteredEvents = data.events.filter(
    (row) =>
      row.install_ratio >= eventThreshold &&
      (eventService === "all" || row.service === eventService),
  );

  return (
    <section className="grid">
      <article className="card">
        <div className="cardHeader">
          <h2>1. 현재 가장 많이 사용하는 OTT</h2>
          <div className="cardActions">
            <div
              className="dateDropdown"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setIsRankingDateMenuOpen(false);
                }
              }}
            >
              <button
                type="button"
                className="dateDropdownButton rankingDateSelect"
                aria-haspopup="listbox"
                aria-expanded={isRankingDateMenuOpen}
                onClick={() =>
                  setIsRankingDateMenuOpen((current) => !current)
                }
              >
                {formatShortWeek(selectedRankingDate)}
              </button>
              {isRankingDateMenuOpen && (
                <div
                  className="dateDropdownMenu"
                  role="listbox"
                  ref={rankingDateMenuRef}
                >
                  {rankingDates.map((date) => (
                    <button
                      key={date}
                      type="button"
                      className={
                        date === selectedRankingDate
                          ? "dateDropdownOption active"
                          : "dateDropdownOption"
                      }
                      role="option"
                      aria-selected={date === selectedRankingDate}
                      onClick={() => {
                        setSelectedRankingDate(date);
                        setIsRankingDateMenuOpen(false);
                      }}
                    >
                      {formatShortWeek(date)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {rankingChartType === "bar" && (
              <button
                type="button"
                className="chartToggleButton"
                disabled={!previousRankingDate}
                onClick={() => {
                  setShowRankingComparison((current) => !current);
                  setRankingChartType("bar");
                }}
              >
                {showRankingComparison ? "현재만" : "전주 비교"}
              </button>
            )}
            <button
              type="button"
              className="chartToggleButton"
              onClick={() => {
                setShowRankingComparison(false);
                setRankingChartType((current) =>
                  current === "bar" ? "pie" : "bar",
                );
              }}
            >
              {rankingChartType === "bar" ? "Pie" : "Bar"}
            </button>
          </div>
        </div>
        <div className="chart">
          {showRankingComparison ? (
            <Bar
              data={rankingComparisonData}
              options={{
                maintainAspectRatio: false,
                scales: wauScaleOptions,
                plugins: {
                  tooltip: rankingCompareTooltipOptions,
                },
              }}
            />
          ) : rankingChartType === "bar" ? (
            <Bar
              data={rankingChartData}
              options={{
                maintainAspectRatio: false,
                scales: wauScaleOptions,
                plugins: {
                  legend: { display: false },
                  tooltip: rankingTooltipOptions,
                },
              }}
            />
          ) : (
            <Pie
              data={rankingChartData}
              options={{
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    labels: {
                      boxWidth: 10,
                      boxHeight: 10,
                      padding: 12,
                    },
                  },
                  tooltip: rankingTooltipOptions,
                },
              }}
            />
          )}
        </div>
      </article>

      <article className="card trendCard">
        <div className="cardHeader">
          <h2>2. 최근 가장 크게 성장한 서비스</h2>
          <div className="cardActions">
            <div className="presetGroup" role="group" aria-label="기간 선택">
              <button
                type="button"
                className={
                  isTrendPresetActive("weeks12")
                    ? "presetButton active"
                    : "presetButton"
                }
                onClick={() => setTrendPreset("weeks12")}
              >
                12주
              </button>
              <button
                type="button"
                className={
                  isTrendPresetActive("year")
                    ? "presetButton active"
                    : "presetButton"
                }
                onClick={() => setTrendPreset("year")}
              >
                1년
              </button>
              <button
                type="button"
                className={
                  isTrendPresetActive("all")
                    ? "presetButton active"
                    : "presetButton"
                }
                onClick={() => setTrendPreset("all")}
              >
                전체
              </button>
            </div>
            <button
              type="button"
              className="chartToggleButton"
              onClick={() =>
                setTrendMetric((current) =>
                  current === "wau" ? "share" : "wau",
                )
              }
            >
              {trendMetric === "wau" ? "점유율" : "추이"}
            </button>
          </div>
        </div>
        <div className="chart chartCompact">
          <Line
            data={{
              labels: selectedDates,
              datasets: trendDatasets,
            }}
            options={{
              ...lineChartOptions,
              scales: {
                x: getWeekScaleOptions(),
                ...(trendMetric === "wau"
                  ? wauScaleOptions
                  : shareScaleOptions),
              },
              plugins: {
                ...lineChartOptions.plugins,
                tooltip:
                  trendMetric === "wau"
                    ? weekWauTooltipOptions
                    : weekShareTooltipOptions,
              },
            }}
          />
        </div>
        <div className="periodControl">
          <div className="periodLabels">
            <span>{formatShortWeek(selectedDates[0] ?? dates[0])}</span>
            <span>
              {formatShortWeek(
                selectedDates[selectedDates.length - 1] ??
                  dates[dates.length - 1],
              )}
            </span>
          </div>
          <div
            className="rangeBar"
            style={{
              "--range-start": `${rangeStartPercent}%`,
              "--range-end": `${rangeEndPercent}%`,
            }}
          >
            <div
              className="rangeSelection"
              aria-hidden="true"
              onPointerDown={(event) => {
                const bounds = event.currentTarget
                  .closest(".rangeBar")
                  .getBoundingClientRect();

                rangeDragRef.current = {
                  startX: event.clientX,
                  width: bounds.width,
                  start: trendStartIndex,
                  end: trendEndIndex,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={moveTrendRange}
              onPointerUp={(event) => {
                event.currentTarget.releasePointerCapture(event.pointerId);
                stopTrendRangeDrag();
              }}
              onPointerCancel={stopTrendRangeDrag}
            />
            <input
              type="range"
              min="0"
              max={maxTrendIndex}
              value={trendStartIndex}
              disabled={dates.length <= 1}
              aria-label="2번 차트 시작 주차"
              onChange={(event) => {
                const nextStart = Math.min(
                  Number(event.target.value),
                  trendEndIndex,
                );

                setTrendRange((current) => ({
                  ...current,
                  start: nextStart,
                }));
              }}
            />
            <input
              type="range"
              min="0"
              max={maxTrendIndex}
              value={trendEndIndex}
              disabled={dates.length <= 1}
              aria-label="2번 차트 종료 주차"
              onChange={(event) => {
                const nextEnd = Math.max(
                  Number(event.target.value),
                  trendStartIndex,
                );

                setTrendRange((current) => ({
                  ...current,
                  end: nextEnd,
                }));
              }}
            />
          </div>
        </div>
      </article>

      <article className="card trendCard">
        <div className="cardHeader">
          <h2>3. 이용자 수와 실제 사용시간은 비례할까?</h2>
          <div className="cardActions">
            <div className="presetGroup" role="group" aria-label="기간 선택">
              <button
                type="button"
                className={
                  isUsagePresetActive("weeks12")
                    ? "presetButton active"
                    : "presetButton"
                }
                onClick={() => setUsagePreset("weeks12")}
              >
                12주
              </button>
              <button
                type="button"
                className={
                  isUsagePresetActive("year")
                    ? "presetButton active"
                    : "presetButton"
                }
                onClick={() => setUsagePreset("year")}
              >
                1년
              </button>
              <button
                type="button"
                className={
                  isUsagePresetActive("all")
                    ? "presetButton active"
                    : "presetButton"
                }
                onClick={() => setUsagePreset("all")}
              >
                전체
              </button>
            </div>
            <button
              type="button"
              className="chartToggleButton"
              onClick={() =>
                setUsageMetric((current) =>
                  current === "ats" ? "share" : "ats",
                )
              }
            >
              {usageMetric === "ats" ? "점유율" : "추이"}
            </button>
          </div>
        </div>
        <div className="chart chartCompact">
          <Line
            data={{
              labels: selectedUsageDates,
              datasets: usageDatasets,
            }}
            options={{
              ...lineChartOptions,
              scales: {
                x: getWeekScaleOptions(),
                ...(usageMetric === "share" ? shareScaleOptions : {}),
              },
              plugins: {
                ...lineChartOptions.plugins,
                tooltip:
                  usageMetric === "share"
                    ? weekShareTooltipOptions
                    : weekTooltipOptions,
              },
            }}
          />
        </div>
        <div className="periodControl">
          <div className="periodLabels">
            <span>
              {formatShortWeek(selectedUsageDates[0] ?? usageDates[0])}
            </span>
            <span>
              {formatShortWeek(
                selectedUsageDates[selectedUsageDates.length - 1] ??
                  usageDates[usageDates.length - 1],
              )}
            </span>
          </div>
          <div
            className="rangeBar"
            style={{
              "--range-start": `${usageRangeStartPercent}%`,
              "--range-end": `${usageRangeEndPercent}%`,
            }}
          >
            <div
              className="rangeSelection"
              aria-hidden="true"
              onPointerDown={(event) => {
                const bounds = event.currentTarget
                  .closest(".rangeBar")
                  .getBoundingClientRect();

                usageRangeDragRef.current = {
                  startX: event.clientX,
                  width: bounds.width,
                  start: usageStartIndex,
                  end: usageEndIndex,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={moveUsageRange}
              onPointerUp={(event) => {
                event.currentTarget.releasePointerCapture(event.pointerId);
                stopUsageRangeDrag();
              }}
              onPointerCancel={stopUsageRangeDrag}
            />
            <input
              type="range"
              min="0"
              max={maxUsageIndex}
              value={usageStartIndex}
              disabled={usageDates.length <= 1}
              aria-label="3번 차트 시작 주차"
              onChange={(event) => {
                const nextStart = Math.min(
                  Number(event.target.value),
                  usageEndIndex,
                );

                setUsageRange((current) => ({
                  ...current,
                  start: nextStart,
                }));
              }}
            />
            <input
              type="range"
              min="0"
              max={maxUsageIndex}
              value={usageEndIndex}
              disabled={usageDates.length <= 1}
              aria-label="3번 차트 종료 주차"
              onChange={(event) => {
                const nextEnd = Math.max(
                  Number(event.target.value),
                  usageStartIndex,
                );

                setUsageRange((current) => ({
                  ...current,
                  end: nextEnd,
                }));
              }}
            />
          </div>
        </div>
      </article>

      <article className="card">
        <h2>4. 특정 이벤트가 이용자 증가에 영향을 주었을까?</h2>
        <div className="filterControls">
          <div className="presetGroup" role="group" aria-label="증가 기준">
            {[1.5, 2, 2.5].map((threshold) => (
              <button
                key={threshold}
                type="button"
                className={
                  eventThreshold === threshold
                    ? "presetButton active"
                    : "presetButton"
                }
                onClick={() => setEventThreshold(threshold)}
              >
                {threshold}배
              </button>
            ))}
          </div>
          <select
            className="serviceSelect"
            value={eventService}
            aria-label="서비스 선택"
            onChange={(event) => setEventService(event.target.value)}
          >
            <option value="all">전체 서비스</option>
            {services.map((service) => (
              <option key={service} value={service}>
                {service}
              </option>
            ))}
          </select>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>주차</th>
                <th>서비스</th>
                <th>신규 설치</th>
                <th>전주 대비</th>
                <th>이벤트</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((row, index) => (
                <tr key={`${row.week_start}-${row.service}-${index}`}>
                  <td>{row.week_start}</td>
                  <td>{row.service}</td>
                  <td>{row.new_installs.toLocaleString("ko-KR")}</td>
                  <td>{row.install_ratio.toFixed(2)}배</td>
                  <td>{row.event_type ?? "-"}</td>
                </tr>
              ))}
              {filteredEvents.length === 0 && (
                <tr>
                  <td colSpan="5" className="emptyCell">
                    조건에 맞는 급증 시점이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      <article className="card trendCard wideCard comparisonCard">
        <div className="cardHeader comparisonHeader">
          <h2>5. 주요 지표 간 흐름 비교</h2>
          <div className="cardActions comparisonActions">
            <label className="metricField">
              <span>업체</span>
              <select
                className="serviceSelect"
                value={comparisonService}
                aria-label="5번 차트 업체 선택"
                onChange={(event) => setComparisonService(event.target.value)}
              >
                <option value="all">전체 서비스</option>
                {services.map((service) => (
                  <option key={service} value={service}>
                    {service}
                  </option>
                ))}
              </select>
            </label>
            <label className="metricField">
              <span>왼쪽 축</span>
              <select
                className="serviceSelect"
                value={comparisonMetricLeft}
                aria-label="왼쪽 축 지표 선택"
                onChange={(event) => setComparisonMetricLeft(event.target.value)}
              >
                {COMPARISON_METRICS.map((metric) => (
                  <option
                    key={metric.key}
                    value={metric.key}
                    disabled={metric.key === comparisonMetricRight}
                  >
                    {metric.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="metricField">
              <span>오른쪽 축</span>
              <select
                className="serviceSelect"
                value={comparisonMetricRight}
                aria-label="오른쪽 축 지표 선택"
                onChange={(event) =>
                  setComparisonMetricRight(event.target.value)
                }
              >
                {COMPARISON_METRICS.map((metric) => (
                  <option
                    key={metric.key}
                    value={metric.key}
                    disabled={metric.key === comparisonMetricLeft}
                  >
                    {metric.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="presetGroup" role="group" aria-label="기간 선택">
              <button
                type="button"
                className={
                  isComparisonPresetActive("weeks12")
                    ? "presetButton active"
                    : "presetButton"
                }
                onClick={() => setComparisonPreset("weeks12")}
              >
                12주
              </button>
              <button
                type="button"
                className={
                  isComparisonPresetActive("year")
                    ? "presetButton active"
                    : "presetButton"
                }
                onClick={() => setComparisonPreset("year")}
              >
                1년
              </button>
              <button
                type="button"
                className={
                  isComparisonPresetActive("all")
                    ? "presetButton active"
                    : "presetButton"
                }
                onClick={() => setComparisonPreset("all")}
              >
                전체
              </button>
            </div>
          </div>
        </div>
        <div className="eventLegend">
          <span className="eventLegendMark" aria-hidden="true" />
          이벤트 발생 주차
        </div>
        <div className="chart comparisonChart">
          <Line
            data={{
              labels: selectedComparisonDates,
              datasets: comparisonDatasets,
            }}
            options={{
              ...lineChartOptions,
              interaction: {
                mode: "index",
                intersect: false,
              },
              scales: {
                x: getWeekScaleOptions(),
                y: {
                  type: "linear",
                  position: "left",
                  title: {
                    display: true,
                    text: comparisonMetricLeftMeta.label,
                  },
                  ticks: {
                    callback(value) {
                      return formatMetricTick(comparisonMetricLeft, value);
                    },
                  },
                },
                y1: {
                  type: "linear",
                  position: "right",
                  title: {
                    display: true,
                    text: comparisonMetricRightMeta.label,
                  },
                  grid: {
                    drawOnChartArea: false,
                  },
                  ticks: {
                    callback(value) {
                      return formatMetricTick(comparisonMetricRight, value);
                    },
                  },
                },
              },
              plugins: {
                ...lineChartOptions.plugins,
                eventMarkers: {
                  markers: comparisonEventMarkers,
                },
                tooltip: comparisonTooltipOptions,
              },
            }}
          />
        </div>
        <div className="periodControl">
          <div className="periodLabels">
            <span>
              {formatShortWeek(
                selectedComparisonDates[0] ?? comparisonDates[0],
              )}
            </span>
            <span>
              {formatShortWeek(
                selectedComparisonDates[selectedComparisonDates.length - 1] ??
                  comparisonDates[comparisonDates.length - 1],
              )}
            </span>
          </div>
          <div
            className="rangeBar"
            style={{
              "--range-start": `${comparisonRangeStartPercent}%`,
              "--range-end": `${comparisonRangeEndPercent}%`,
            }}
          >
            <div
              className="rangeSelection"
              aria-hidden="true"
              onPointerDown={(event) => {
                const bounds = event.currentTarget
                  .closest(".rangeBar")
                  .getBoundingClientRect();

                comparisonRangeDragRef.current = {
                  startX: event.clientX,
                  width: bounds.width,
                  start: comparisonStartIndex,
                  end: comparisonEndIndex,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={moveComparisonRange}
              onPointerUp={(event) => {
                event.currentTarget.releasePointerCapture(event.pointerId);
                stopComparisonRangeDrag();
              }}
              onPointerCancel={stopComparisonRangeDrag}
            />
            <input
              type="range"
              min="0"
              max={maxComparisonIndex}
              value={comparisonStartIndex}
              disabled={comparisonDates.length <= 1}
              aria-label="5번 차트 시작 주차"
              onChange={(event) => {
                const nextStart = Math.min(
                  Number(event.target.value),
                  comparisonEndIndex,
                );

                setComparisonRange((current) => ({
                  ...current,
                  start: nextStart,
                }));
              }}
            />
            <input
              type="range"
              min="0"
              max={maxComparisonIndex}
              value={comparisonEndIndex}
              disabled={comparisonDates.length <= 1}
              aria-label="5번 차트 종료 주차"
              onChange={(event) => {
                const nextEnd = Math.max(
                  Number(event.target.value),
                  comparisonStartIndex,
                );

                setComparisonRange((current) => ({
                  ...current,
                  end: nextEnd,
                }));
              }}
            />
          </div>
        </div>
      </article>
    </section>
  );
}
