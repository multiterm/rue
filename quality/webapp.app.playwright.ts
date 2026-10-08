import {registerApplicationBrowserContract} from './app-playwright'
registerApplicationBrowserContract('webapp')
import { expect, test } from '@playwright/test'
import { APP_CONTRACTS, resolveAppUrl } from './app-contract'
test('Keyname hosted login is not blocked by the deployed content security policy', async ({ page }) => {
  const base = resolveAppUrl(APP_CONTRACTS.find((app) => app.name === 'webapp')!)
  await page.goto(new URL('/login', base).href)
  await page.getByRole('button', { name: /Sign in with Keyname/ }).click()
  await expect(page.frameLocator('iframe[title="Sign in with Keyname"]').getByRole('textbox').first()).toBeVisible()
})
