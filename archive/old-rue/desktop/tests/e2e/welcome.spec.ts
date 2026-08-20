import { expect, test } from '@playwright/test'
import { launchRue } from './_helper.js'

test.describe('Welcome flow', () => {
  test('first launch shows welcome → finishes → reveals ask-bar', async () => {
    // Seed with onboardingComplete: false so welcome shows up.
    const { app, window } = await launchRue({
      seedSettings: { onboardingComplete: false, apiKey: '' }
    })

    await expect(window.getByText('Welcome to Rue')).toBeVisible({ timeout: 5000 })

    // Intro → key step
    await window.getByRole('button', { name: /Get started/ }).click()
    await expect(window.getByText('Choose a provider')).toBeVisible()

    // Enter a fake API key
    await window.getByPlaceholder('sk-ant-...').fill('sk-ant-test-key')
    await window.getByRole('button', { name: /Continue/ }).click()

    // Model step
    await expect(window.getByText('Pick a model')).toBeVisible()
    await window.getByRole('button', { name: /Continue/ }).click()

    // Done step
    await expect(window.getByText("You're set")).toBeVisible()
    await window.getByRole('button', { name: /Open Rue/ }).click()

    // Welcome dismissed → ask-bar input is visible
    await expect(window.getByPlaceholder(/Ask anything/)).toBeVisible({ timeout: 5000 })

    await app.close()
  })

  test('skips welcome when onboardingComplete: true', async () => {
    const { app, window } = await launchRue() // seeded onboardingComplete: true

    await expect(window.getByPlaceholder(/Ask anything/)).toBeVisible({ timeout: 5000 })
    await expect(window.getByText('Welcome to Rue')).not.toBeVisible()

    await app.close()
  })
})
