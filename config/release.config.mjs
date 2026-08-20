export default {
  versioning: "independent",
  packages: ["packages/libs/sdk"],
  branches: ["develop", "main"],
  branchChannels: { develop: "beta", main: "latest" },
  prereleaseIds: { beta: "b" },
  packageManager: "pnpm",
  checks: ["pnpm exec rune typecheck", "pnpm exec rune test", "pnpm exec rune build"],
  access: "public",
  github: true,
};
