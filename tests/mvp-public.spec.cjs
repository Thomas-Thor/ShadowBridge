const { loadTestDependency }=require('./dependencies.cjs');
const {test,expect}=loadTestDependency('@playwright/test');
const AxeBuilder=loadTestDependency('@axe-core/playwright').default;

test('Horus footer has a keyboard accessible transparent image and preserves cartel navigation',async({page})=>{
 const failures=[];page.on('pageerror',error=>failures.push(error.message));
 page.on('response',response=>{if(response.status()>=400)failures.push(response.url());});
 await page.goto('/');await page.evaluate(()=>document.fonts.ready);
 const link=page.getByRole('link',{name:'C.A.R.T.E.L. Division',exact:true});
 await link.scrollIntoViewIfNeeded();await expect(link).toBeVisible();
 expect(await link.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
 const box=await link.boundingBox();expect(Math.abs(box.x+box.width/2-page.viewportSize().width/2)).toBeLessThan(2);
 expect(box.height).toBeGreaterThanOrEqual(44);
 expect(await page.locator('.footer-private-access').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(0, 0, 0)');
 expect(await link.evaluate(e=>parseFloat(getComputedStyle(e).borderWidth))).toBe(0);
 await page.mouse.move(0,0);const baseFilter=await link.evaluate(e=>getComputedStyle(e).filter);
 await link.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');await expect(link).toBeFocused();
 expect(await link.evaluate(e=>parseFloat(getComputedStyle(e).outlineWidth))).toBeGreaterThanOrEqual(2);
 await link.blur();await page.mouse.move(0,0);await link.hover();
 expect(await link.evaluate(e=>getComputedStyle(e).filter)).not.toBe(baseFilter);
 await link.focus();
 const accessibility=await new AxeBuilder({page}).include('.footer-private-access').analyze();expect(accessibility.violations).toEqual([]);
 await page.keyboard.press('Enter');await expect(page).toHaveURL(/\/cartel\/$/);
 await expect(page.locator('.access-label')).toContainText('ACCESS RESTRICTED');
 await page.getByRole('link',{name:'Return to ShadowBridge'}).click();await expect(page).toHaveURL(/\/#home$/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
 expect(failures).toEqual([]);
});

test('configured WhatsApp link is valid and static account pages cannot activate authentication',async({page})=>{
 await page.goto('/');
 const link=page.getByRole('link',{name:'Discuss business on WhatsApp (opens in a new tab)'});
 await link.scrollIntoViewIfNeeded();await expect(link).toBeVisible();
 const url=new URL(await link.getAttribute('href'));expect(url.origin).toBe('https://wa.me');expect(url.pathname).toBe('/4747747007');
 expect(url.searchParams.get('text')).toContain('business enquiry');await expect(link).toHaveAttribute('target','_blank');await expect(link).toHaveAttribute('rel',/noopener/);
 const region=await page.locator('#contact').innerText();expect(region).not.toMatch(/47747007|4747747007/);
 await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
 await expect(page.locator('#send-enquiry')).toBeDisabled();
 await expect(page.locator('#enquiry-status')).toContainText('unavailable');
 await page.getByRole('link',{name:'Legal Information',exact:true}).first().click();
 await expect(page.getByRole('link',{name:'shadowbridge.trade@gmail.com',exact:true})).toHaveAttribute('href','mailto:shadowbridge.trade@gmail.com');
 await expect(page.locator('body')).not.toContainText('TODO');
 for(const route of ['/apply/buyer/','/apply/supplier/','/apply/partner/','/member-sign-in/']){
  const requests=[];const listener=request=>requests.push(request.url());page.on('request',listener);
  await page.goto(route);await expect(page.locator('input:enabled,textarea:enabled,select:enabled,button[type="submit"]:enabled')).toHaveCount(0);
  await expect(page.locator('script[src$="account.js"]')).toHaveCount(0);
  expect(requests.some(url=>url.includes('/api/'))).toBe(false);page.off('request',listener);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','noindex, nofollow');
 }
});
