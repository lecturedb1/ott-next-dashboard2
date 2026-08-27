import fs from "fs";
import path from "path";

const REPORTS_DIRECTORY = path.join(process.cwd(), "public", "data");
const GITHUB_PAGES_BASE_PATH = "/ott-next-dashboard2";

function formatReportLabel(fileName) {
  return path
    .basename(fileName, ".pdf")
    .split("_")
    .map((part) => {
      if (part.toLowerCase() === "ott") {
        return "OTT";
      }

      return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
    })
    .join(" ");
}

function getBasePath() {
  return process.env.GITHUB_ACTIONS === "true" ? GITHUB_PAGES_BASE_PATH : "";
}

export function getReports() {
  if (!fs.existsSync(REPORTS_DIRECTORY)) {
    return [];
  }

  return fs
    .readdirSync(REPORTS_DIRECTORY)
    .filter((fileName) => fileName.toLowerCase().endsWith(".pdf"))
    .sort((left, right) => right.localeCompare(left))
    .map((fileName) => ({
      fileName,
      label: formatReportLabel(fileName),
      url: `${getBasePath()}/data/${encodeURIComponent(fileName)}`,
    }));
}
