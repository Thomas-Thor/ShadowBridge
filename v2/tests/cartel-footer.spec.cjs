const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const path = require('node:path');

test('invitation footer is accessible on mobile and opens the existing division', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => errors.push(request.url()));
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(process.env.SHADOWBRIDGE_TEST_URL || './');
  await page.evaluate(() => document.fonts.ready);
  const home = new URL(page.url());
  const footer = page.locator('.site-footer');
  const button = footer.getByRole('link', { name: 'C.A.R.T.E.L. Division', exact: true });
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeVisible();
  await expect(button).toHaveAccessibleDescription('By invitation only');
  await expect(footer.getByText('By invitation only', { exact: true })).toBeVisible();
  await expect(button.locator('svg[aria-hidden="true"]')).toBeVisible();
  const box = await button.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(page.viewportSize().width);

  await button.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(button).toBeFocused();
  expect(await button.evaluate(element => {
    const style = getComputedStyle(element);
    return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
  })).toBe(true);
  const background = await button.evaluate(element => getComputedStyle(element).backgroundColor);
  await button.hover();
  expect(await button.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(background);
  const accessibility = await new AxeBuilder({ page }).include('.site-footer').analyze();
  expect(accessibility.violations).toEqual([]);

  if (process.env.SHADOWBRIDGE_SCREENSHOTS) {
    await page.mouse.move(0, 0);
    await button.blur();
    await footer.screenshot({ path: path.join(process.env.SHADOWBRIDGE_SCREENSHOTS, `${testInfo.project.name}.png`) });
  }

  const division = new URL('cartel/', home);
  expect(await button.evaluate(element => element.href)).toBe(division.href);
  await button.click();
  await expect(page).toHaveURL(division.href);
  await expect(page.getByText('ACCESS RESTRICTED', { exact: true })).toBeVisible();
  await expect(page.getByText('Admission is granted exclusively by invitation.', { exact: true })).toBeVisible();
  await expect(page.locator('input, form')).toHaveCount(0);
  await page.getByRole('link', { name: 'Return to ShadowBridge' }).click();
  await expect(page).toHaveURL(new URL('#home', home).href);
  await expect(page.locator('#business-contact a')).toHaveAttribute('href', 'mailto:shadowbridge.trade@gmail.com');
  expect(errors).toEqual([]);
});
