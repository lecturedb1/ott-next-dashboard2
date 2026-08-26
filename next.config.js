const isGithubActions = process.env.GITHUB_ACTIONS === "true";
const githubPagesBasePath = "/ott-next-dashboard";

const nextConfig = {
  output: "export",
  basePath: isGithubActions ? githubPagesBasePath : "",
  assetPrefix: isGithubActions ? `${githubPagesBasePath}/` : "",
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
};

module.exports = nextConfig;
