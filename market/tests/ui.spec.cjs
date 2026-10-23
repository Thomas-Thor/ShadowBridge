const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadTestDependency } = require('../../tests/dependencies.cjs');
const { test, expect } = loadTestDependency('@playwright/test');
const { default:AxeBuilder } = loadTestDependency('@axe-core/playwright');
const taxonomy = require('../public/data/taxonomy.json');
const id = key => taxonomy.categories.find(c => c.key === key).id;
const ready = async page => expect(page.locator('h1')).toBeVisible();
const noOverflow = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
test.beforeEach(async ({page}) => {
  const errors=[],unexpected=[];
  page.on('pageerror',error => errors.push(error.message));
  page.on('request',request => {
    const url=new URL(request.url());
    if(url.origin!=='http://127.0.0.1:4175' || url.pathname.startsWith('/api/') || !['GET','HEAD'].includes(request.method())) unexpected.push(`${request.method()} ${url}`);
  });
  page.__marketErrors=errors;page.__marketUnexpected=unexpected;
});
test.afterEach(async ({page}) => {
  expect(page.__marketErrors).toEqual([]);expect(page.__marketUnexpected).toEqual([]);
  expect(await page.evaluate(() => [localStorage.length,sessionStorage.length])).toEqual([0,0]);
});
test('Homepage: distinct demo identity, eight canonical categories, functional search and buyer/supplier entry points',async ({page}) => {
  await page.goto('/'); await ready(page);
  await expect(page.locator('.demo-strip')).toContainText('Fictional companies');
  await expect(page.locator('.category-card')).toHaveCount(8);
  await expect(page.locator('.home-offers .offer-card')).toHaveCount(6);
  await expect(page.locator('.supplier-card')).toHaveCount(3);
  await page.getByRole('link',{name:'For buyers',exact:true}).click();
  await expect(page).toHaveURL(/#buyers$/);
  await expect(page.locator('#buyers')).toBeInViewport();
  await page.getByRole('link',{name:'For suppliers',exact:true}).click();
  await expect(page.locator('#suppliers')).toBeInViewport();
  await page.getByRole('link',{name:/ShadowBridge Market B2B home/i,exact:true}).click();
  await page.getByRole('searchbox',{name:'Search products, categories or demo suppliers'}).fill('oats');
  await page.locator('#hero-category').selectOption(id('food-agriculture'));
  await page.getByRole('button',{name:'Search offers',exact:false}).click();
  await expect(page.getByRole('heading',{name:'1 demo offer',exact:true})).toBeVisible();
  await expect(page.locator('.offer-card')).toContainText('Bulk rolled oats');
  await page.reload(); await expect(page.locator('#filter-q')).toHaveValue('oats');
  await expect(page.locator('#filter-category')).toHaveValue(id('food-agriculture'));
});
test('Browse: pagination, back navigation, combined filters, counts, source currency, sort and empty state',async ({page}) => {
  await page.goto('/offers/');await ready(page);
  await expect(page.locator('.offer-card')).toHaveCount(9);
  const first=await page.locator('.offer-card').evaluateAll(nodes => nodes.map(n => n.dataset.offerId));
  await page.getByRole('navigation',{name:'Offer pages'}).getByRole('link',{name:'Next',exact:true}).click();
  const second=await page.locator('.offer-card').evaluateAll(nodes => nodes.map(n => n.dataset.offerId));
  expect(new Set([...first,...second]).size).toBe(18);
  await page.goBack();await expect(page.locator('[aria-current="page"]').filter({hasText:'1'})).toBeVisible();
  await page.locator('#filter-category').selectOption(id('food-agriculture'));
  await page.locator('#filter-subcategory').selectOption(id('grains-ingredients'));
  await page.locator('#filter-country').selectOption('PL');
  await page.locator('#filter-type').selectOption('wholesale');
  await page.locator('#filter-currency').selectOption('EUR');
  await page.getByRole('button',{name:'Apply filters'}).click();
  await expect(page.locator('.offer-card')).toHaveCount(1);
  await expect(page.locator('.offer-card')).toContainText('Bulk rolled oats');
  await page.getByRole('link',{name:'Clear filters',exact:true}).click();
  await page.locator('#filter-currency').selectOption('PLN');
  await page.getByRole('button',{name:'Apply filters'}).click();
  await expect(page.locator('.offer-card')).toHaveCount(2);
  await expect(page.locator('.offer-price').first()).toContainText('PLN');
  await page.getByRole('link',{name:'Clear filters',exact:true}).click();
  await page.locator('#sort').selectOption('title-asc');
  await expect(page.locator('.offer-card').first()).toContainText('Agricultural trailer components');
  await page.locator('#filter-q').fill('not an available fictional product');
  await page.getByRole('button',{name:'Apply filters'}).click();
  await expect(page.getByRole('heading',{name:'No demo offers match your filters.'})).toBeVisible();
  await expect(page.locator('.offer-card')).toHaveCount(0);
});
test('Details and supplier: true demo labels, optional fields, enquiry modal never sends or stores a message',async ({page}) => {
  await page.goto('/offers/DEMO-MKT-007/');await ready(page);
  await expect(page.locator('.detail-price')).toContainText('Price not provided');
  await expect(page.locator('.facts').filter({hasText:'Incoterms'})).toContainText('Not provided');
  await page.getByRole('button',{name:'Enquire · demo only'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Nothing will be sent or saved');
  const dialogScan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  expect(dialogScan.violations.map(v => v.id)).toEqual([]);
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button',{name:'Enquire · demo only'})).toBeFocused();
  await page.getByRole('link',{name:'View demo supplier',exact:false}).click();
  await expect(page.getByRole('heading',{level:1})).toHaveText('Northline Relief Goods (DEMO)');
  await expect(page.locator('.profile-body')).toContainText('Not assessed — fictional business');
  await expect(page.locator('.offer-card')).toHaveCount(3);
  await page.locator('.offer-card h3 a').first().click();
  await expect(page.getByRole('heading',{level:1})).toHaveText('Foldable emergency shelters');
  await page.getByRole('button',{name:'Enquire · demo only'}).click();
  await page.getByRole('button',{name:'Back to browsing'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('Safe failure states: unknown record, escaped URL input and unavailable taxonomy never invent results',async ({page}) => {
  await page.goto('/offers/DEMO-MKT-999/');await ready(page);
  await expect(page.getByRole('heading',{level:1})).toHaveText('Demo page not found.');
  await page.goto('/offers/?q='+encodeURIComponent('\"><img src=x onerror="window.marketInjected=1">'));
  await ready(page);await expect(page.locator('.offer-card')).toHaveCount(0);
  expect(await page.evaluate(() => window.marketInjected)).toBeUndefined();
  await page.route('**/data/taxonomy.json',route => route.fulfill({status:503,body:'Unavailable'}));
  await page.reload();
  await expect(page.getByRole('heading',{name:'The demo catalogue could not load.'})).toBeVisible();
  await expect(page.locator('.offer-card')).toHaveCount(0);
});
for (const width of [1440,390,320]) test(`Four views: responsive layout, images, WCAG A/AA scans at ${width}px`,async ({page}) => {
  await page.setViewportSize({width,height:1000});
  const shotDir=path.join(os.tmpdir(),'shadowbridge-market-m1-ui','screenshots');await fs.mkdir(shotDir,{recursive:true});
  for (const [name,route] of [['home','/'],['browse','/offers/'],['offer','/offers/DEMO-MKT-001/'],['supplier','/suppliers/demo-morava/']]) {
    await page.goto(route);await ready(page);await noOverflow(page);
    await page.locator('img').evaluateAll(async images => { for (const image of images) image.loading = 'eager'; await Promise.all(images.map(i => i.decode().catch(() => {}))); });
    expect(await page.locator('img').evaluateAll(images => images.filter(i => !i.complete || !i.naturalWidth).map(i => i.src))).toEqual([]);
    const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    expect(report.violations.map(v => ({id:v.id,impact:v.impact,nodes:v.nodes.map(n => n.target)})),`${name} at ${width}px`).toEqual([]);
    if (width!==390) await page.screenshot({path:path.join(shotDir,`${name}-${width}.png`),fullPage:true});
  }
});
test('Mobile keyboard: skip link, menu with Escape, functional filters and modal focus trap',async ({page}) => {
  await page.setViewportSize({width:320,height:850});await page.goto('/');await ready(page);
  await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to content'})).toBeFocused();
  await page.keyboard.press('Enter');await expect(page.locator('main')).toBeFocused();
  const menu=page.getByRole('button',{name:'Menu',exact:false});await menu.focus();await page.keyboard.press('Enter');
  await expect(menu).toHaveAttribute('aria-expanded','true');
  await page.keyboard.press('Escape');await expect(menu).toBeFocused();await expect(menu).toHaveAttribute('aria-expanded','false');
  await menu.click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Browse offers',exact:true}).click();
  await page.locator('summary').click();await page.locator('#filter-country').selectOption('NO');
  await page.getByRole('button',{name:'Apply filters'}).click();await expect(page.locator('.offer-card')).toHaveCount(2);
  await page.locator('.offer-card h3 a').first().click();await page.getByRole('button',{name:'Enquire · demo only'}).click();
  for (let i=0;i<8;i++) {await page.keyboard.press('Tab');expect(await page.evaluate(() => !!document.activeElement.closest('dialog'))).toBe(true);}
  for (let i=0;i<4;i++) {await page.keyboard.press('Shift+Tab');expect(await page.evaluate(() => !!document.activeElement.closest('dialog'))).toBe(true);}
  await noOverflow(page);await page.keyboard.press('Escape');
});
