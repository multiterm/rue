export default {
  versioning: "independent",
  packages: ["packages/libs/sdk"],
  branches: ["develop", "main"],
  branchChannels: { develop: "beta", main: "latest" },
  prereleaseIds: { beta: "b" },
  packageManager: "pnpm",
  checks: ["pnpm typecheck", "pnpm test", "pnpm build"],
  access: "public",
  github: true,
};
