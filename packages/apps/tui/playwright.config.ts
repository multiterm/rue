import {defineConfig} from '@playwright/test'
export default defineConfig({testDir:'tests/e2e',timeout:15_000,fullyParallel:true,forbidOnly:!!process.env.CI,retries:0,reporter:process.env.CI?'github':'list'})
