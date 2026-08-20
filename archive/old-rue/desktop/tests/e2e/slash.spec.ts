import { expect, test } from '@playwright/test'
import { launchRue, mockAnthropicStream } from './_helper.js'

test.describe('Slash commands', () => {
  test('typing "/" shows the suggestion popup', async () => {
    const { app, window } = await launchRue()

    const input = window.getByPlaceholder(/Ask anything/)
    await input.fill('/')

    await expect(window.getByText(/screen|search|tldr|explain/).first()).toBeVisible({ timeout: 2000 })

    await app.close()
  })

  test('clicking a slash hint inserts the command into the input', async () => {
    const { app, window } = await launchRue()

    const input = window.getByPlaceholder(/Ask anything/)
    await input.fill('/tl')

    const tldrHint = window.getByText('/tldr').first()
    await expect(tldrHint).toBeVisible()
    await tldrHint.click()

    await expect(input).toHaveValue('/tldr ')

    await app.close()
  })

  test('/tldr transforms the prompt before sending', async () => {
    const { app, window } = await launchRue()
    await mockAnthropicStream(window, ['summary'])

    const input = window.getByPlaceholder(/Ask anything/)
    await input.fill('/tldr the long article body here')
    await input.press('Enter')

    // The bubble shows the typed text (display), but the actual model gets the
    // transformed prompt. We assert the response renders end-to-end.
    await expect(window.getByText('summary')).toBeVisible({ timeout: 5000 })

    await app.close()
  })
})
