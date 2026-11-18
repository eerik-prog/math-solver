import { expect, test } from '@playwright/test'

test('solves an equation typed into the box', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/')
  await page.getByLabel('Math problem').fill('x^2 - 5x + 6 = 0')
  await page.getByLabel('Math problem').press('Enter')
  await expect(page.getByText('Solve for x')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy x = 2' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy x = 3' })).toBeVisible()
  await expect(page.locator('.katex').first()).toBeVisible()
  await expect(page.locator('.plot svg path.curve').first()).toHaveAttribute('d', /M/)
  expect(errors).toEqual([])
})

test('solves calculus problems from the examples', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'integrate x^2 from 0 to 3' }).click()
  await expect(page.getByText('Definite integral with respect to x')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy 9' })).toBeVisible()
  await expect(page).toHaveURL(/q=integrate/)
})

test('opens a shared link and reports bad input clearly', async ({ page }) => {
  await page.goto('/?q=' + encodeURIComponent('limit of sin(x)/x as x -> 0'))
  await expect(page.getByRole('button', { name: 'Copy 1' })).toBeVisible()
  await page.getByLabel('Math problem').fill('2x + (3')
  await page.getByLabel('Math problem').press('Enter')
  await expect(page.getByRole('alert')).toContainText('parenthesis')
})

test('fits the screen without horizontal scrolling', async ({ page }) => {
  await page.goto('/?q=' + encodeURIComponent('2x^2 + 3x - 1 = 0'))
  await expect(page.getByText('Step-by-step')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
