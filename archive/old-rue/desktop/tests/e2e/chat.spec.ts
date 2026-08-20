import { expect, test } from '@playwright/test'
import { launchRue, mockAnthropicStream } from './_helper.js'

test.describe('Chat flow', () => {
  test('sends a message → streams response → renders bubble', async () => {
    const { app, window } = await launchRue()
    await mockAnthropicStream(window, ['Hello', ' from', ' Rue.'])

    const input = window.getByPlaceholder(/Ask anything/)
    await input.fill('hi there')
    await input.press('Enter')

    // User bubble appears
    await expect(window.getByText('hi there')).toBeVisible()

    // Assistant streams in
    await expect(window.getByText('Hello from Rue.')).toBeVisible({ timeout: 5000 })

    await app.close()
  })

  test('shows thinking indicator before first token', async () => {
    const { app, window } = await launchRue()

    // Delay the response so we can observe the indicator
    await window.route('https://api.anthropic.com/**', async route => {
      if (!route.request().url().includes('/messages')) return route.continue()
      await new Promise(r => setTimeout(r, 600))
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"done"}}\ndata: [DONE]\n'
      })
    })

    await window.getByPlaceholder(/Ask anything/).fill('go')
    await window.getByPlaceholder(/Ask anything/).press('Enter')

    await expect(window.getByText('Thinking…')).toBeVisible({ timeout: 1500 })
    await expect(window.getByText('done')).toBeVisible({ timeout: 5000 })
    // Thinking disappears once first token arrives
    await expect(window.getByText('Thinking…')).not.toBeVisible()

    await app.close()
  })

  test('Stop button aborts streaming', async () => {
    const { app, window } = await launchRue()

    // Hanging route — never fulfills, so the AbortController test path exercises.
    await window.route('https://api.anthropic.com/**', async () => {
      // intentional: never call route.fulfill so the request hangs until abort
    })

    await window.getByPlaceholder(/Ask anything/).fill('test stop')
    await window.getByPlaceholder(/Ask anything/).press('Enter')

    // Send button morphs into Stop while busy
    const stopBtn = window.getByTitle('Stop generating')
    await expect(stopBtn).toBeVisible({ timeout: 3000 })
    await stopBtn.click()

    // After stop, the Send button is back
    await expect(window.getByTitle('Send (Enter)')).toBeVisible({ timeout: 3000 })

    await app.close()
  })
})
