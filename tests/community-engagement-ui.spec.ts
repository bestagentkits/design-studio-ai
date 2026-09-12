import { test, expect } from './authenticated-browser';
test('private Community management exposes opt-in profile and real empty impact',async({page})=>{
  await page.goto('/community/publishing');await page.getByText('Edit public profile',{exact:true}).click();
  await expect(page.getByLabel('Public display name',{exact:true})).toHaveValue('');await expect(page.getByLabel('Public handle',{exact:true})).toHaveValue('');
  await page.goto('/community/impact');await expect(page.getByRole('heading',{name:'Your impact',exact:true})).toBeVisible();await expect(page.getByText('Unique people who remixed',{exact:true})).toBeVisible();
  const impactResponse=await page.request.get('/api/community/me/impact');expect(impactResponse.ok()).toBe(true);const impact=await impactResponse.json();expect(impact.impact).toMatchObject({views:0,downloadsServed:0,uniqueDownloaders:0,uniqueRemixers:0,publishedDesigns:0});
  await expect(page.locator('.community-impact-grid strong')).toHaveText(['0','0','0','0','0']);
  await page.goto('/community/moderation');await expect(page.getByRole('alert')).toContainText(/operator|moderator|authorized|access|permission/i);
  await page.goto('/community/saved');await expect(page.getByRole('heading',{name:'Your saved designs',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Nothing saved yet'})).toBeVisible();
});
