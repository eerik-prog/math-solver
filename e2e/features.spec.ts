import AxeBuilder from '@axe-core/playwright'
import { type Page, expect, test } from '@playwright/test'

const input = (page: Page) => page.getByLabel('Math problem')

async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`accessibility (${colorScheme})`, () => {
    test.use({ colorScheme, reducedMotion: 'reduce' })

    test('home page', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoAxeViolations(page)
    })

    test('solved problem with steps and a graph', async ({ page }) => {
      await page.goto('/?q=' + encodeURIComponent('x^2 - 5x + 6 = 0'))
      await expect(page.getByText('Step-by-step')).toBeVisible()
      await expect(page.locator('.plot svg path.curve').first()).toHaveAttribute('d', /M/)
      await expectNoAxeViolations(page)
    })

    test('error state', async ({ page }) => {
      await page.goto('/')
      await input(page).fill('2x + (3')
      await input(page).press('Enter')
      await expect(page.getByRole('alert')).toBeVisible()
      await expectNoAxeViolations(page)
    })
  })
}

test('shows how the problem was read while typing', async ({ page }) => {
  await page.goto('/')
  await input(page).fill('2(x+1)')
  await expect(page.locator('.read-as')).toContainText('We read this as:')
  await expect(page.locator('.read-as .katex')).toBeVisible()
  await input(page).fill('2x + (')
  await expect(page.locator('.read-as .katex')).toHaveCount(0)
  await input(page).fill('')
  await expect(page.locator('.read-as')).toHaveCount(0)
})

test('keyboard: "/" focuses the box, Esc clears it, answers are announced', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('heading', { level: 1 }).click()
  await page.keyboard.press('/')
  await expect(input(page)).toBeFocused()
  await page.keyboard.type('2x + 3 = 11')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toHaveText('Answer: x = 4')
  await expect(page).toHaveURL(/q=/)
  await page.keyboard.press('Escape')
  await expect(input(page)).toHaveValue('')
  await expect(page.getByText('Step-by-step')).toHaveCount(0)
  await expect(page).not.toHaveURL(/q=/)
})

test('the keypad is one Tab stop, moved through with the arrow keys', async ({ page }) => {
  await page.goto('/')
  await input(page).fill('x')
  await input(page).focus()
  await page.keyboard.press('Tab') // clear button
  await page.keyboard.press('Tab') // Solve
  await page.keyboard.press('Tab')
  await expect(page.getByTitle('Plus')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTitle('Minus')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.locator('.keypad button:focus')).toHaveCount(0)
})

test('copies an answer as LaTeX', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/?q=' + encodeURIComponent('2x = 1'))
  await page.getByRole('button', { name: 'Copy LaTeX of x = 1/2' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('x = \\frac{1}{2}')
})

test('has an About footer and the sharing and search tags', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Source code on GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/eerik-prog/math-solver',
  )
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://eerik-prog.github.io/math-solver/',
  )
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /og-image\.png$/)
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}')
  expect(ld['@type']).toBe('WebApplication')
  const manifest = await (await request.get('manifest.webmanifest')).json()
  expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true)
  for (const file of ['robots.txt', 'og-image.png', 'icon-512.png', 'sw.js'])
    expect((await request.get(file)).ok(), file).toBe(true)
})

test('long answers never make the page scroll sideways', async ({ page }) => {
  await page.goto('/?q=' + encodeURIComponent('2^1000'))
  await expect(page.getByText('Step-by-step')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('works offline after the first visit', async ({ page, context }) => {
  await page.goto('/')
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready
    return navigator.serviceWorker.controller !== null
  })
  await context.setOffline(true)
  await page.goto('/?q=' + encodeURIComponent('x^2 - 5x + 6 = 0'))
  await expect(page.getByRole('button', { name: 'Copy x = 2' })).toBeVisible()
  await expect(page.locator('.katex').first()).toBeVisible()
  await context.setOffline(false)
})
