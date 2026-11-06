import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const imageFixture = readFileSync(resolve('e2e/fixtures/vision-shapes.png'));
const blueFixture = readFileSync(resolve('e2e/fixtures/blue-shapes.png'));
const mockHugo = process.env.TEST_MOCK_HUGO_URL ?? 'http://127.0.0.1:15200';

async function mockApp(page: Page, vision = true, initialMessages: Array<{ role: string; content: string; model?: string }> = []) {
  let sent: Record<string, unknown> | undefined;
  let visionAvailable = vision, discoveryFails = false;
  const conversations: Record<string, Array<{ role: string; content: string; model?: string }>> = { p1: initialMessages };
  let uploaded = 0, chatCalls = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/endpoints' && method === 'GET') return route.fulfill({ json: [{ id: 'ep1', name: 'Hugo test', url: 'http://hugo.test/v1' }] });
    if (url.pathname === '/api/projects' && method === 'GET') return route.fulfill({ json: [{ id: 'p1', name: 'Research' }] });
    if (url.pathname === '/api/projects' && method === 'POST') return route.fulfill({ json: { id: 'p2', name: 'Project 2' } });
    if (url.pathname === '/api/endpoints/ep1/models' && discoveryFails) return route.fulfill({ status: 502, json: { error: 'Fixture discovery failed.' } });
    if (url.pathname === '/api/endpoints/ep1/models') return route.fulfill({ json: [
      { name: 'text-model', capabilities: ['completion', 'tools'], contextLength: 8192, size: 2_000_000 },
      ...(visionAvailable ? [{ name: 'vision-model', capabilities: ['completion', 'vision'], contextLength: 8192, size: 4_000_000 }] : []),
    ] });
    if (url.pathname.startsWith('/api/messages/')) return route.fulfill({ json: conversations[url.pathname.split('/').at(-1)!] ?? [] });
    if (url.pathname === '/api/files/p1') return route.fulfill({ json: [] });
    if (url.pathname === '/api/cases/p1') return route.fulfill({ json: [] });
    if (url.pathname === '/api/draft/p1') return route.fulfill({ json: { content: '' } });
    if (url.pathname === '/api/upload/p1' && method === 'POST') {
      const source = uploaded++ === 0 ? 'TXT distinctive: saffron lantern.' : 'PDF distinctive: cobalt river.';
      return route.fulfill({ json: { name: uploaded === 1 ? 'notes.txt' : 'source.pdf', content: source, chars: source.length } });
    }
    if (url.pathname === '/api/chat' && method === 'POST') {
      chatCalls++;
      sent = route.request().postDataJSON();
      conversations[String(sent?.project)] = [{ role: 'user', content: String(sent?.prompt ?? '') }, { role: 'assistant', content: 'READY', model: String(sent?.model ?? '') }];
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"delta":"READY"}\n\ndata: {"done":true}\n\n' });
    }
    return route.fulfill({ json: [] });
  });
  return { getSent: () => sent, getChatCount: () => chatCalls, setDiscoveryFailure: (value: boolean) => { discoveryFails = value; }, setVisionAvailable: (value: boolean) => { visionAvailable = value; } };
}

test('empty project welcomes, image drop selects vision, and chat sends the image', async ({ page }) => {
  const app = await mockApp(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /What are you looking into\?/ })).toBeVisible();
  await page.locator('.work').evaluate((element, file) => {
    const image = new File([Uint8Array.from(file)], 'sample.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(image);
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, Array.from(imageFixture));
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('vision-model');
  await expect(page.getByRole('combobox', { name: 'Composer model' })).toHaveValue('vision-model');
  await page.getByLabel('Model', { exact: true }).selectOption('text-model');
  const message = page.getByRole('textbox', { name: 'Message' });
  await message.fill('Describe the image.');
  await message.press('Enter');
  await expect(page.getByText('This model cannot process the attached image', { exact: false }).first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Composer model' }).selectOption('vision-model');
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('vision-model');
  await page.getByRole('button', { name: 'Send message' }).evaluate(button => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await expect(page.getByRole('heading', { name: /What are you looking into\?/ })).toHaveCount(0);
  await expect.poll(() => app.getSent()?.model).toBe('vision-model');
  expect(app.getChatCount()).toBe(1);
  expect(String(app.getSent()?.prompt)).toContain('Describe the image.');
  expect(app.getSent()?.image).toMatch(/^data:image\/png;base64,/);
  expect(String(app.getSent()?.prompt)).toContain('[Attached image: sample.png');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByRole('heading', { name: /What are you looking into\?/ })).toBeVisible();
});

test('document picker stages extracted PDF and TXT text for chat', async ({ page }) => {
  const app = await mockApp(page);
  await page.goto('/');
  const picker = page.locator('input[type=file]').first();
  await expect(picker).toHaveAttribute('multiple', '');
  await picker.setInputFiles([
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture') },
    { name: 'source.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF fixture') },
  ]);
  await expect(page.getByText('notes.txt', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('source.pdf', { exact: false }).first()).toBeVisible();
  await page.getByRole('textbox', { name: 'Message' }).fill('Summarize sources.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => app.getSent()?.prompt).toContain('TXT distinctive: saffron lantern.');
  expect(app.getSent()?.prompt).toContain('PDF distinctive: cobalt river.');
});

test('persisted messages reload without the welcome area', async ({ page }) => {
  await mockApp(page, true, [{ role: 'user', content: 'Saved question' }, { role: 'assistant', content: 'Saved answer', model: 'vision-model' }]);
  await page.goto('/');
  await expect(page.getByText('Saved answer')).toBeVisible();
  await expect(page.getByRole('heading', { name: /What are you looking into\?/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Saved answer')).toBeVisible();
  await expect(page.getByRole('heading', { name: /What are you looking into\?/ })).toHaveCount(0);
});

test('long Markdown stays in the transcript scroll region on desktop and phone', async ({ page }) => {
  const content = `# Notes\n\nA paragraph with a [safe link](https://example.org) and enough text to wrap naturally.\n\n${Array.from({ length: 26 }, (_, index) => `- Item ${index + 1}: ${'detail '.repeat(16)}`).join('\n')}\n\n\`\`\`text\n${'code line with a deliberately long value '.repeat(18)}\n\`\`\``;
  await mockApp(page, true, [{ role: 'user', content }]);
  await page.goto('/');
  const transcript = page.locator('.chat');
  await expect(transcript.locator('ul li')).toHaveCount(26);
  await expect(transcript.locator('pre code')).toBeVisible();
  const desktop = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, width: document.documentElement.clientWidth, transcript: document.querySelector('.chat')!.getBoundingClientRect(), composer: document.querySelector('.composer')!.getBoundingClientRect() }));
  expect(desktop.page).toBeLessThanOrEqual(desktop.width);
  expect(desktop.transcript.bottom).toBeLessThanOrEqual(desktop.composer.top);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await transcript.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await expect(page.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
  await page.getByRole('button', { name: 'Jump to latest' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const phone = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, width: document.documentElement.clientWidth, composer: document.querySelector('.composer')!.getBoundingClientRect().bottom, height: innerHeight }));
  expect(phone.page).toBeLessThanOrEqual(phone.width);
  expect(phone.composer).toBeLessThanOrEqual(phone.height);
});

test('site text and composer placeholder render white', async ({ page }) => {
  await mockApp(page);
  await page.goto('/');
  const colors = await page.locator('body *').evaluateAll(elements => elements
    .filter(element => element.children.length === 0 && element.textContent?.trim())
    .map(element => getComputedStyle(element).color));
  expect([...new Set(colors)]).toEqual(['rgb(255, 255, 255)']);
  const placeholderColor = await page.getByRole('textbox', { name: 'Message' }).evaluate(element => getComputedStyle(element, '::placeholder').color);
  expect(placeholderColor).toBe('rgb(255, 255, 255)');
  await expect(page.locator('.research .searchbar button', { hasText: 'Search' })).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const theme = page.getByRole('combobox', { name: 'Theme' });
  await theme.selectOption('light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(246, 246, 244)');
  await expect.poll(async () => await page.locator('body *').evaluateAll(elements => elements.filter(element => element.children.length === 0 && element.textContent?.trim()).every(element => getComputedStyle(element).color !== 'rgb(255, 255, 255)'))).toBe(true);
  await expect(page.locator('.brand-logo')).toHaveAttribute('src', /hugo-light/);
  await theme.selectOption('system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('.brand-logo')).toHaveAttribute('src', /hugo-dark/);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('.brand-logo')).toHaveAttribute('src', /hugo-light/);
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Theme' })).toHaveValue('system');
});

test('no vision model opens the requested dialog and cancel retains the staged image', async ({ page }) => {
  const app = await mockApp(page, false);
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: imageFixture });
  await expect(page.getByRole('dialog')).toContainText('Do you want to install a vision model or to unlock vision capabilities?');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Remove image sample.png' })).toBeVisible();
  await page.locator('.work').evaluate(element => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['second'], 'replacement.png', { type: 'image/png' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  });
  await expect(page.getByText(/existing image was kept/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove image sample.png' })).toBeVisible();
  app.setDiscoveryFailure(true);
  await page.getByRole('button', { name: 'Remove image sample.png' }).click();
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'retry-vision.png', mimeType: 'image/png', buffer: imageFixture });
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.locator('.modal [role="alert"]')).toContainText('Fixture discovery failed.');
  app.setDiscoveryFailure(false);
  app.setVisionAvailable(true);
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('vision-model');
});

test('mixed and oversized attachments report file-specific errors without replacing a staged image', async ({ page }) => {
  await mockApp(page);
  await page.goto('/');
  await page.locator('.work').evaluate((element, files) => {
    const transfer = new DataTransfer();
    for (const [name, data] of files) transfer.items.add(new File([data], name, { type: 'image/png' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, [['first.png', 'first'], ['second.png', 'second']]);
  await expect(page.getByRole('button', { name: 'Remove image first.png' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Only one image can be attached');
  await expect(page.getByRole('button', { name: 'Remove image second.png' })).toHaveCount(0);
  await page.route('**/api/upload/p1', route => route.fulfill({ status: 500, json: { error: 'Fixture upload failed.' } }));
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('valid document') },
    { name: 'archive.zip', mimeType: 'application/zip', buffer: Buffer.from('unsupported') },
  ]);
  await expect(page.getByRole('alert')).toContainText('notes.txt: Fixture upload failed.');
  await expect(page.getByRole('alert')).toContainText('archive.zip: unsupported file type.');
  await expect(page.getByRole('button', { name: 'Remove image first.png' })).toBeVisible();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'huge.txt', mimeType: 'text/plain', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(page.getByRole('alert')).toContainText('huge.txt: exceeds the 10 MiB upload limit.');
});


test('real application forwards picker and dropped image bytes, restores image cards, and forks independent history', async ({ page, request }) => {
  const reset = await request.get(`${mockHugo}/__test/reset`);
  expect(reset.ok()).toBeTruthy();
  const registered = await request.post(`${test.info().project.use.baseURL}/api/endpoints`, {
    data: { url: `${mockHugo}/v1`, name: 'Hugo image fixture' },
  });
  expect(registered.ok()).toBeTruthy();
  let parentProjectId = '';
  let lastAppRequest: Record<string, unknown> | undefined;
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', outgoing => { if (outgoing.url().endsWith('/api/chat') && outgoing.method() === 'POST') { lastAppRequest = outgoing.postDataJSON() as Record<string, unknown>; parentProjectId ||= String(lastAppRequest.project ?? ''); } });
  await page.goto('/');
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('text-only:1b');
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'vision-shapes.png', mimeType: 'image/png', buffer: imageFixture });
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('gemma3:4b');
  await page.getByRole('textbox', { name: 'Message' }).fill('Describe the visible colors and shape.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(/red left half, a blue right half, and a yellow circle/).last()).toBeVisible();
  const attachment = page.locator('.message-attachment').filter({ hasText: 'vision-shapes.png' });
  await expect(attachment).toBeVisible();
  await expect(attachment).toContainText('B');
  await page.getByRole('button', { name: 'Preview vision-shapes.png' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Preview vision-shapes.png' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Preview vision-shapes.png' })).toHaveCount(0);
  const last = await request.get(`${mockHugo}/__test/last`);
  const body = await last.json() as { model: string; messages: Array<{ role: string; content: string; images?: string[] }> };
  expect(body.model).toBe('gemma3:4b');
  const userTurn = body.messages.find(message => message.role === 'user');
  expect(userTurn?.content).toContain('[Attached image: vision-shapes.png');
  expect(Buffer.from(userTurn?.images?.[0] ?? '', 'base64').equals(imageFixture)).toBe(true);
  await expect(page.getByRole('button', { name: 'Reuse image' }).first()).toBeVisible();
  await page.reload();
  await expect(page.locator('.message-attachment').filter({ hasText: 'vision-shapes.png' })).toBeVisible();
  const originalTurnId = await page.locator('.message').first().getAttribute('data-message-id');
  await page.locator('.message').first().getByRole('button', { name: 'Reuse image' }).click();
  await page.getByRole('textbox', { name: 'Message' }).fill('Compare this with the earlier image.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(/red left half, a blue right half, and a yellow circle/).last()).toBeVisible();
  const reused = await request.get(`${mockHugo}/__test/last`);
  const reusedBody = await reused.json() as { model: string; messages: Array<{ role: string; content: string; images?: string[] }> };
  const reusedTurn = reusedBody.messages.filter(message => message.role === 'user').at(-1);
  expect(reusedTurn?.content).toContain(`Reused image from earlier turn ${originalTurnId}`);
  expect(Buffer.from(reusedTurn?.images?.[0] ?? '', 'base64').equals(imageFixture)).toBe(true);
  await page.locator('.message').first().getByRole('button', { name: 'Fork from here' }).click();
  await expect(page.locator('.fork-banner')).toContainText('Forked from');
  await expect(page.locator('.message')).toHaveCount(1);
  await expect(page.locator('.message-attachment').filter({ hasText: 'vision-shapes.png' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.fork-banner')).toBeVisible();
  await expect(page.locator('.message')).toHaveCount(1);
  await page.locator('input[accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: 'vision-shapes.png', mimeType: 'image/png', buffer: imageFixture });
  await page.getByRole('textbox', { name: 'Message' }).fill('Describe the visible colors and shape.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.message')).toHaveCount(3);
  await page.reload();
  await expect(page.locator('.message-attachment').filter({ hasText: 'vision-shapes.png' })).toHaveCount(2);
  await expect(page.locator('.message-attachment').first()).toContainText('Image pixels stored in this browser');
  await page.locator('.work').evaluate((element, bytes) => { const transfer = new DataTransfer(); transfer.items.add(new File([Uint8Array.from(bytes)], 'dropped-shapes.png', { type: 'image/png' })); element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer })); }, Array.from(imageFixture));
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('gemma3:4b');
  await page.getByRole('textbox', { name: 'Message' }).fill('Continue the fork and compare these shapes.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.message-attachment').filter({ hasText: 'dropped-shapes.png' })).toBeVisible();
  const dropped = await request.get(`${mockHugo}/__test/last`);
  const droppedBody = await dropped.json() as { model: string; messages: Array<{ role: string; content: string; images?: string[] }> };
  const droppedTurn = droppedBody.messages.filter(message => message.role === 'user').at(-1);
  expect(lastAppRequest?.project).not.toBe(parentProjectId);
  expect(droppedTurn?.content).toContain('[Attached image: dropped-shapes.png');
  expect(Buffer.from(droppedTurn?.images?.[0] ?? '', 'base64').equals(imageFixture)).toBe(true);
  const parent = await request.get(`${test.info().project.use.baseURL}/api/messages/${parentProjectId}`);
  expect((await parent.json() as Array<{role:string}>).map(message => message.role)).toEqual(['user','assistant','user','assistant']);
  await page.getByRole('button', { name: 'My research', exact: true }).click();
  await expect(page.locator('.message-attachment').first()).toContainText('Image pixels stored in this browser');
  await page.evaluate(() => new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase('local-harness-chat'); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('Local chat storage is still in use.')); }));
  await page.reload();
  await expect(page.locator('.message-attachment').first()).toContainText('Image pixels unavailable; attach again to use them');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('list', { name: 'Chats' })).toBeVisible();
  const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, composer: document.querySelector('.composer')!.getBoundingClientRect().bottom, height: innerHeight }));
  expect(layout.width).toBeLessThanOrEqual(layout.client);
  expect(layout.composer).toBeLessThanOrEqual(layout.height);
  expect(pageErrors).toEqual([]);
});

test('completed identical image prompts keep separate image identities after reload', async ({ page, request }) => {
  await request.get(`${mockHugo}/__test/reset`);
  const base = String(test.info().project.use.baseURL);
  const endpoint = await request.post(`${base}/api/endpoints`, { data: { url: `${mockHugo}/v1`, name: 'Hugo image identity fixture' } });
  expect(endpoint.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await page.evaluate(() => { Date.prototype.toISOString = () => '2000-01-01T00:00:00.000Z'; });
  const sendImagePrompt = async (bytes: Buffer) => {
    await page.locator('input[accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: 'same-name.png', mimeType: 'image/png', buffer: bytes });
    await page.getByRole('textbox', { name: 'Message' }).fill('Describe this exact picture.');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText(/red left half, a blue right half, and a yellow circle/).last()).toBeVisible();
  };
  await sendImagePrompt(imageFixture);
  await expect(page.locator('.message-attachment img')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.message-attachment img')).toHaveCount(1);
  await sendImagePrompt(blueFixture);
  await page.reload();
  await sendImagePrompt(imageFixture);
  const attachments = page.locator('.message-attachment');
  await expect(attachments).toHaveCount(3);
  await expect(attachments.locator('img')).toHaveCount(3);
  const firstId = await attachments.nth(0).getAttribute('data-attachment-id');
  const secondId = await attachments.nth(1).getAttribute('data-attachment-id');
  const thirdId = await attachments.nth(2).getAttribute('data-attachment-id');
  expect(new Set([firstId, secondId, thirdId]).size).toBe(3);
  const firstThumbnail = await attachments.nth(0).locator('img').evaluate(async image => Array.from(new Uint8Array(await fetch((image as HTMLImageElement).src).then(response => response.arrayBuffer()))));
  const secondThumbnail = await attachments.nth(1).locator('img').evaluate(async image => Array.from(new Uint8Array(await fetch((image as HTMLImageElement).src).then(response => response.arrayBuffer()))));
  const thirdThumbnail = await attachments.nth(2).locator('img').evaluate(async image => Array.from(new Uint8Array(await fetch((image as HTMLImageElement).src).then(response => response.arrayBuffer()))));
  expect(Buffer.from(firstThumbnail)).toEqual(imageFixture);
  expect(Buffer.from(secondThumbnail)).toEqual(blueFixture);
  expect(Buffer.from(thirdThumbnail)).toEqual(imageFixture);
});

test('stop during slow model startup preserves the message and staged image', async ({ page, request }) => {
  await request.get(`${mockHugo}/__test/reset`);
  await request.post(`${mockHugo}/__test/config`, { data: { scenario: 'slow-start' } });
  const base = String(test.info().project.use.baseURL);
  const endpoint = await request.post(`${base}/api/endpoints`, { data: { url: `${mockHugo}/v1`, name: 'Hugo slow fixture' } });
  expect(endpoint.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('text-only:1b');
  await page.locator('input[accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: 'pending.png', mimeType: 'image/png', buffer: imageFixture });
  await expect(page.getByRole('button', { name: 'Remove image pending.png' })).toBeVisible();
  const prompt = page.getByRole('textbox', { name: 'Message' });
  await prompt.fill('Keep this draft if stopped.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Waiting for the model…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible();
  await expect(prompt).toHaveValue('Keep this draft if stopped.');
  await page.getByRole('button', { name: 'Stop generation' }).click();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await expect(prompt).toHaveValue('Keep this draft if stopped.');
  await expect(page.getByRole('button', { name: 'Remove image pending.png' })).toBeVisible();
  await expect.poll(async () => (await (await request.get(`${mockHugo}/__test/slow-start-aborted`)).json() as {aborted:boolean}).aborted).toBe(true);
});

test('Stop during image persistence cancels before sending and keeps the staged draft', async ({ page, request }) => {
  await request.get(`${mockHugo}/__test/reset`);
  const base = String(test.info().project.use.baseURL);
  const endpoint = await request.post(`${base}/api/endpoints`, { data: { url: `${mockHugo}/v1`, name: 'Hugo preparation fixture' } });
  expect(endpoint.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await page.locator('input[accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: 'preparing.png', mimeType: 'image/png', buffer: imageFixture });
  const prompt = page.getByRole('textbox', { name: 'Message' });
  await prompt.fill('Keep this image if stopped during preparation.');
  await page.evaluate(() => {
    const scope = window as typeof window & {holdAttachmentSave?: boolean; releaseAttachmentSave?: boolean};
    const originalPut = IDBObjectStore.prototype.put;
    scope.holdAttachmentSave = true;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      const result = originalPut.call(this, value, key);
      const stored = value as {key?:string};
      if (scope.holdAttachmentSave && stored?.key?.startsWith('attachments:')) {
        scope.holdAttachmentSave = false;
        const tick = () => {
          if (scope.releaseAttachmentSave) { this.delete('__e2e_keepalive'); return; }
          const pending = originalPut.call(this, {key:'__e2e_keepalive',value:true});
          pending.onsuccess = tick;
        };
        const pending = originalPut.call(this, {key:'__e2e_keepalive',value:true});
        pending.onsuccess = tick;
      }
      return result;
    };
  });
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible();
  await expect(page.getByText('Preparing request…')).toBeVisible();
  await expect.poll(async () => (await (await request.get(`${mockHugo}/__test/count`)).json() as {count:number}).count).toBe(0);
  await page.getByRole('button', { name: 'Stop generation' }).click();
  await page.evaluate(() => { (window as typeof window & {releaseAttachmentSave?:boolean}).releaseAttachmentSave = true; });
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await expect(prompt).toHaveValue('Keep this image if stopped during preparation.');
  await expect(page.getByRole('button', { name: 'Remove image preparing.png' })).toBeVisible();
  await expect.poll(async () => (await (await request.get(`${mockHugo}/__test/count`)).json() as {count:number}).count).toBe(0);
});

test('an image completes into its original chat after navigating away during startup', async ({ page, request }) => {
  await request.get(`${mockHugo}/__test/reset`);
  await request.post(`${mockHugo}/__test/config`, { data: { scenario: 'navigation-start' } });
  const base = String(test.info().project.use.baseURL);
  const endpoint = await request.post(`${base}/api/endpoints`, { data: { url: `${mockHugo}/v1`, name: 'Hugo navigation fixture' } });
  expect(endpoint.ok()).toBeTruthy();
  await page.goto('/');
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('text-only:1b');
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'navigate.png', mimeType: 'image/png', buffer: imageFixture });
  await page.getByRole('textbox', { name: 'Message' }).fill('Keep this image with its original chat.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Waiting for the model…')).toBeVisible();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await page.getByRole('button', { name: 'My research', exact: true }).click();
  await expect(page.locator('.message-attachment').filter({ hasText: 'navigate.png' })).toContainText('Image pixels stored in this browser');
});

test('an interrupted stream retains drafts and retry does not duplicate its persisted user message', async ({ page, request }) => {
  await request.get(`${mockHugo}/__test/reset`);
  await request.post(`${mockHugo}/__test/config`, { data: { scenario: 'interrupt' } });
  const base = String(test.info().project.use.baseURL);
  const endpoint = await request.post(`${base}/api/endpoints`, { data: { url: `${mockHugo}/v1`, name: 'Hugo retry fixture' } });
  expect(endpoint.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('text-only:1b');
  let projectId = '';
  page.on('request', outgoing => { if (outgoing.url().endsWith('/api/chat') && outgoing.method() === 'POST') projectId = String((outgoing.postDataJSON() as { project: string }).project); });
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'retry.png', mimeType: 'image/png', buffer: imageFixture });
  const prompt = page.getByRole('textbox', { name: 'Message' });
  await prompt.fill('Retry this precise turn.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert')).toContainText('Hugo stream ended before the response completed.');
  await expect(prompt).toHaveValue('Retry this precise turn.');
  await expect(page.getByRole('button', { name: 'Remove image retry.png' })).toBeVisible();
  await expect(page.locator('.message').filter({ hasText: 'Retry this precise turn.' })).toBeVisible();
  await request.post(`${mockHugo}/__test/config`, { data: { scenario: 'normal' } });
  await page.reload();
  await expect(page.locator('.message-attachment').filter({ hasText: 'retry.png' })).toBeVisible();
  await page.locator('input[accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: 'retry.png', mimeType: 'image/png', buffer: imageFixture });
  await page.getByRole('textbox', { name: 'Message' }).fill('Retry this precise turn.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(/red left half, a blue right half, and a yellow circle/).last()).toBeVisible();
  await page.reload();
  await expect(page.locator('.message-attachment').filter({ hasText: 'retry.png' })).toContainText('Image pixels stored in this browser');
  await expect(page.getByRole('button', { name: 'Reuse image' })).toBeVisible();
  const persisted = await request.get(`${base}/api/messages/${projectId}`);
  expect((await persisted.json() as Array<{ role: string }>).map(message => message.role)).toEqual(['user', 'assistant']);
  const last = await request.get(`${mockHugo}/__test/last`);
  const body = await last.json() as { messages: Array<{ role: string; content: string; images?: string[] }> };
  const user = body.messages.find(message => message.role === 'user');
  expect(Buffer.from(user?.images?.[0] ?? '', 'base64').equals(imageFixture)).toBe(true);
  expect(body.messages.filter(message => message.role === 'user' && message.content.includes('Retry this precise turn.')).length).toBe(1);
});

test('retry pixel comparison cannot add an old message to a chat opened while it waits', async ({ page, request }) => {
  await request.get(`${mockHugo}/__test/reset`);
  await request.post(`${mockHugo}/__test/config`, { data: { scenario: 'interrupt' } });
  const base = String(test.info().project.use.baseURL);
  const endpoint = await request.post(`${base}/api/endpoints`, { data: { url: `${mockHugo}/v1`, name: 'Hugo retry-navigation fixture' } });
  expect(endpoint.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const originalChatName = await page.locator('.chat-row.active').innerText();
  let projectId = '';
  page.on('request', outgoing => { if (outgoing.url().endsWith('/api/chat') && outgoing.method() === 'POST') projectId = String((outgoing.postDataJSON() as {project:string}).project); });
  await page.locator('input[accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: 'wait-retry.png', mimeType: 'image/png', buffer: imageFixture });
  const prompt = page.getByRole('textbox', { name: 'Message' });
  await prompt.fill('Keep this retry in the source chat.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert')).toContainText('Hugo stream ended before the response completed.');

  await request.post(`${mockHugo}/__test/config`, { data: { scenario: 'normal' } });
  await page.locator('input[accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: 'wait-retry.png', mimeType: 'image/png', buffer: imageFixture });
  await prompt.fill('Keep this retry in the source chat.');
  await page.evaluate(() => {
    const scope = window as typeof window & {holdArrayBuffer?:boolean; releaseArrayBuffers?:()=>void; arrayBufferGate?:Promise<void>};
    const original = Blob.prototype.arrayBuffer;
    let open: () => void = () => {};
    scope.arrayBufferGate = new Promise<void>(resolve => { open = resolve; });
    scope.holdArrayBuffer = true;
    scope.releaseArrayBuffers = () => { scope.holdArrayBuffer = false; open(); };
    Blob.prototype.arrayBuffer = function() { return scope.holdArrayBuffer ? scope.arrayBufferGate!.then(() => original.call(this)) : original.call(this); };
  });
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.locator('.message')).toHaveCount(0);
  await page.evaluate(() => (window as typeof window & {releaseArrayBuffers?:()=>void}).releaseArrayBuffers?.());
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await expect(page.locator('.message')).toHaveCount(0);
  const persisted = await request.get(`${base}/api/messages/${projectId}`);
  expect((await persisted.json() as Array<{role:string}>).map(row => row.role)).toEqual(['user','assistant']);
  await page.getByRole('list', { name: 'Chats' }).getByRole('button', { name: originalChatName, exact: true }).click();
  await expect(page.locator('.message')).toHaveCount(2);
  await expect(page.locator('.message-attachment').filter({ hasText: 'wait-retry.png' })).toContainText('Image pixels stored in this browser');
  const messages = await request.get(`${base}/api/messages/${projectId}`);
  expect((await messages.json() as Array<{role:string}>).map(row => row.role)).toEqual(['user','assistant']);
});

test('stopping an interrupted image retry preserves the original persisted attachment', async ({ page, request }) => {
  await request.get(`${mockHugo}/__test/reset`);
  await request.post(`${mockHugo}/__test/config`, { data: { scenario: 'interrupt' } });
  const base = String(test.info().project.use.baseURL);
  const endpoint = await request.post(`${base}/api/endpoints`, { data: { url: `${mockHugo}/v1`, name: 'Hugo retry-stop fixture' } });
  expect(endpoint.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const originalChatName = await page.locator('.chat-row.active').innerText();
  await page.locator('input[accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: 'retry-stop.png', mimeType: 'image/png', buffer: imageFixture });
  const prompt = page.getByRole('textbox', { name: 'Message' });
  await prompt.fill('Preserve this image if its retry is stopped.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert')).toContainText('Hugo stream ended before the response completed.');
  await expect(page.locator('.message-attachment').filter({ hasText: 'retry-stop.png' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reuse image' })).toBeVisible();

  await request.post(`${mockHugo}/__test/config`, { data: { scenario: 'normal' } });
  await page.locator('input[accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: 'retry-stop.png', mimeType: 'image/png', buffer: imageFixture });
  await prompt.fill('Preserve this image if its retry is stopped.');
  await page.evaluate(() => {
    const scope = window as typeof window & {holdAttachmentSave?: boolean; releaseAttachmentSave?: boolean};
    const originalPut = IDBObjectStore.prototype.put;
    scope.holdAttachmentSave = true;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      const result = originalPut.call(this, value, key);
      if (scope.holdAttachmentSave && (value as {key?:string})?.key?.startsWith('attachments:')) {
        scope.holdAttachmentSave = false;
        const tick = () => {
          if (scope.releaseAttachmentSave) { this.delete('__e2e_keepalive_retry'); return; }
          const pending = originalPut.call(this, {key:'__e2e_keepalive_retry',value:true});
          pending.onsuccess = tick;
        };
        const pending = originalPut.call(this, {key:'__e2e_keepalive_retry',value:true});
        pending.onsuccess = tick;
      }
      return result;
    };
  });
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Stop generation' })).toBeVisible();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  await page.getByRole('button', { name: 'Stop generation' }).click();
  await page.evaluate(() => { (window as typeof window & {releaseAttachmentSave?:boolean}).releaseAttachmentSave = true; });
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await expect(prompt).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Remove image retry-stop.png' })).toHaveCount(0);
  await expect(page.locator('.message')).toHaveCount(0);
  await page.getByRole('list', { name: 'Chats' }).getByRole('button', { name: originalChatName, exact: true }).click();
  await expect(prompt).toHaveValue('');
  await expect(page.locator('.message').filter({ hasText: 'Preserve this image if its retry is stopped.' })).toBeVisible();
  await expect(page.locator('.message-attachment').filter({ hasText: 'retry-stop.png' })).toContainText('Image pixels stored in this browser');
  await expect(page.getByRole('button', { name: 'Reuse image' })).toBeVisible();
  await expect.poll(async () => (await (await request.get(`${mockHugo}/__test/count`)).json() as {count:number}).count).toBe(1);
});

test('server rejects a duplicate idempotency key while its first response is active', async ({ request }) => {
  await request.get(`${mockHugo}/__test/reset`);
  await request.post(`${mockHugo}/__test/config`, { data: { scenario: 'duplicate-start' } });
  const base = String(test.info().project.use.baseURL);
  const endpoint = `${mockHugo}/v1`;
  const projectResponse = await request.post(`${base}/api/projects`, { data: { name: 'Concurrent submission fixture' } });
  const project = await projectResponse.json() as {id:string};
  const key = crypto.randomUUID();
  const body = { endpoint, model: 'gemma3:4b', project: project.id, prompt: 'Only run this keyed turn once.', history: [], mode: 'Research', toolsEnabled: false };
  const firstPromise = request.post(`${base}/api/chat`, { data: body, headers: { 'idempotency-key': key } });
  await expect.poll(async () => ((await (await request.get(`${mockHugo}/__test/count`)).json()) as {count:number}).count).toBe(1);
  const differentTurn = await request.post(`${base}/api/chat`, { data: {...body, prompt:'A separate turn cannot overlap this one.'}, headers: {'idempotency-key':crypto.randomUUID()} });
  expect(differentTurn.status()).toBe(409);
  const duplicate = await request.post(`${base}/api/chat`, { data: body, headers: { 'idempotency-key': key } });
  expect(duplicate.status()).toBe(409);
  const first = await firstPromise;
  expect(await first.text()).toContain('"done":true');
  const count = await (await request.get(`${mockHugo}/__test/count`)).json() as {count:number};
  expect(count.count).toBe(1);
  const messages = await request.get(`${base}/api/messages/${project.id}`);
  expect((await messages.json() as Array<{role:string}>).map(row => row.role)).toEqual(['user','assistant']);
  const secondProjectResponse = await request.post(`${base}/api/projects`, { data: { name: 'Cross-project idempotency fixture' } });
  const secondProject = await secondProjectResponse.json() as {id:string};
  const reusedGlobally = await request.post(`${base}/api/chat`, { data:{...body,project:secondProject.id}, headers:{'idempotency-key':key} });
  expect(reusedGlobally.status()).toBe(409);
  const newKey = await request.post(`${base}/api/chat`, { data:{...body,project:secondProject.id,prompt:'This project lock was released.'}, headers:{'idempotency-key':crypto.randomUUID()} });
  expect(newKey.status()).toBe(200);
  expect((await (await request.get(`${mockHugo}/__test/count`)).json() as {count:number}).count).toBe(2);
});

test('a lost completion event replays the persisted answer without running the model twice', async ({ page, request }) => {
  await request.get(`${mockHugo}/__test/reset`);
  const base = String(test.info().project.use.baseURL);
  const endpoint = await request.post(`${base}/api/endpoints`, { data: { url: `${mockHugo}/v1`, name: 'Hugo lost acknowledgement fixture' } });
  expect(endpoint.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  let projectId = '';
  let requests = 0;
  await page.route('**/api/chat', async route => {
    requests++;
    const response = await route.fetch();
    const payload = await response.text();
    const outgoing = route.request().postDataJSON() as {project:string};
    projectId = outgoing.project;
    const withoutDone = requests === 1 ? payload.replace(/data: \{[^\n]*"done":true[^\n]*\}\n\n/g, '') : payload;
    await route.fulfill({ response, body: withoutDone });
  });
  await page.locator('input[accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: 'ack.png', mimeType: 'image/png', buffer: imageFixture });
  await page.getByRole('textbox', { name: 'Message' }).fill('Keep the completed answer after a dropped acknowledgement.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert')).toContainText('The response ended before the message completed.');
  await expect(page.locator('.message').filter({ hasText: 'red left half, a blue right half, and a yellow circle' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove image ack.png' })).toBeVisible();
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(/red left half, a blue right half, and a yellow circle/).last()).toBeVisible();
  const count = await (await request.get(`${mockHugo}/__test/count`)).json() as {count:number};
  expect(count.count).toBe(1);
  const persisted = await request.get(`${base}/api/messages/${projectId}`);
  expect((await persisted.json() as Array<{role:string}>).map(row => row.role)).toEqual(['user','assistant']);
  await expect(page.locator('.message')).toHaveCount(2);
});

test('changed image after an interrupted identical prompt is stored as a new turn', async ({ page, request }) => {
  await request.get(`${mockHugo}/__test/reset`);
  await request.post(`${mockHugo}/__test/config`, { data: { scenario: 'interrupt' } });
  const base = String(test.info().project.use.baseURL);
  const endpoint = await request.post(`${base}/api/endpoints`, { data: { url: `${mockHugo}/v1`, name: 'Hugo interrupted image fixture' } });
  expect(endpoint.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const stageAndSend = async (bytes: Buffer) => {
    await page.locator('input[accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: 'same-name.png', mimeType: 'image/png', buffer: bytes });
    await page.getByRole('textbox', { name: 'Message' }).fill('Retry this image question.');
    await page.getByRole('button', { name: 'Send message' }).click();
  };
  await stageAndSend(imageFixture);
  await expect(page.getByRole('alert')).toContainText('Hugo stream ended before the response completed.');
  await page.reload();
  await expect(page.locator('.message-attachment img')).toHaveCount(1);
  await stageAndSend(blueFixture);
  await expect(page.getByRole('alert')).toContainText('Hugo stream ended before the response completed.');
  await request.post(`${mockHugo}/__test/config`, { data: { scenario: 'normal' } });
  await page.reload();
  await expect(page.locator('.message-attachment img')).toHaveCount(2);
  await stageAndSend(blueFixture);
  await expect(page.getByText(/red left half, a blue right half, and a yellow circle/).last()).toBeVisible();
  await page.reload();
  const cards = page.locator('.message-attachment');
  await expect(cards).toHaveCount(2);
  await expect(cards.locator('img')).toHaveCount(2);
  const rows = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-attachment-id')));
  expect(new Set(rows).size).toBe(2);
  const persistedProjects = await request.get(`${base}/api/projects`);
  const projectIds = (await persistedProjects.json() as Array<{id:string}>).map(project => project.id);
  let matching: Array<{role:string}> = [];
  for (const projectId of projectIds) {
    const messages = await request.get(`${base}/api/messages/${projectId}`);
    const rows = await messages.json() as Array<{role:string;content:string}>;
    if (rows.filter(row => row.role === 'user' && row.content.startsWith('Retry this image question.')).length === 2) matching = rows;
  }
  expect(matching.map(row => row.role)).toEqual(['user', 'user', 'assistant']);
  const upstream = await (await request.get(`${mockHugo}/__test/last`)).json() as {messages:Array<{role:string;images?:string[]}>};
  const imageTurns = upstream.messages.filter(message => message.role === 'user');
  expect(imageTurns).toHaveLength(2);
  expect(imageTurns[0]?.content).toContain('[Attached image: same-name.png');
  expect(Buffer.from(imageTurns[1]?.images?.[0] ?? '', 'base64')).toEqual(blueFixture);
});

test('a failed draft in the same chat does not block recovery of an older interrupted turn', async ({ page, request }) => {
  await request.get(`${mockHugo}/__test/reset`);
  await request.post(`${mockHugo}/__test/config`, { data: { scenario: 'interrupt' } });
  const base = String(test.info().project.use.baseURL);
  const endpoint = await request.post(`${base}/api/endpoints`, { data: { url: `${mockHugo}/v1`, name: 'Hugo retry identity fixture' } });
  expect(endpoint.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  let projectId = '';
  page.on('request', outgoing => { if (outgoing.url().endsWith('/api/chat') && outgoing.method() === 'POST') projectId = String((outgoing.postDataJSON() as {project:string}).project); });
  const prompt = page.getByRole('textbox', { name: 'Message' });
  await prompt.fill('Retry the earlier persisted turn.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert')).toContainText('Hugo stream ended before the response completed.');
  await request.post(`${mockHugo}/__test/config`, { data: { scenario: 'reject-start' } });
  await prompt.fill('This later draft fails before persistence.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert')).toContainText('Hugo could not start this request.');
  await request.post(`${mockHugo}/__test/config`, { data: { scenario: 'normal' } });
  await prompt.fill('Retry the earlier persisted turn.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(/red left half, a blue right half, and a yellow circle/).last()).toBeVisible();
  const upstream = await (await request.get(`${mockHugo}/__test/last`)).json() as {messages:Array<{role:string;content:string}>};
  expect(upstream.messages.filter(message => message.role === 'user' && message.content === 'Retry the earlier persisted turn.')).toHaveLength(1);
  const persisted = await request.get(`${base}/api/messages/${projectId}`);
  expect((await persisted.json() as Array<{role:string;content:string}>).map(row => row.role)).toEqual(['user','assistant']);
});

test('text-only interrupted retry after reload removes the persisted turn from model history', async ({ page, request }) => {
  await request.get(`${mockHugo}/__test/reset`);
  await request.post(`${mockHugo}/__test/config`, { data: { scenario: 'interrupt' } });
  const base = String(test.info().project.use.baseURL);
  const endpoint = await request.post(`${base}/api/endpoints`, { data: { url: `${mockHugo}/v1`, name: 'Hugo text retry fixture' } });
  expect(endpoint.ok()).toBeTruthy();
  await page.goto('/');
  const chats = page.getByRole('list', { name: 'Chats' });
  await expect(chats.locator('button').first()).toBeVisible();
  const initialChatCount = await chats.locator('button').count();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(chats.locator('button')).toHaveCount(initialChatCount + 1);
  const targetChatName = await chats.locator('button').last().innerText();
  const projectsByPrompt = new Map<string, string>();
  page.on('request', outgoing => { if (outgoing.url().endsWith('/api/chat') && outgoing.method() === 'POST') { const body = outgoing.postDataJSON() as {project:string;prompt:string};projectsByPrompt.set(body.prompt,body.project); } });
  const prompt = page.getByRole('textbox', { name: 'Message' });
  await prompt.fill('Retry this text-only turn.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert')).toContainText('Hugo stream ended before the response completed.');
  const targetProject = projectsByPrompt.get('Retry this text-only turn.')!;
  const beforeOtherChat = await chats.locator('button').count();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(chats.locator('button')).toHaveCount(beforeOtherChat + 1);
  await prompt.fill('Fail a turn in another chat.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert')).toContainText('Hugo stream ended before the response completed.');
  await request.post(`${mockHugo}/__test/config`, { data: { scenario: 'normal' } });
  await chats.getByRole('button', { name: targetChatName, exact: true }).click();
  await expect(page.locator('.message').filter({ hasText: 'Retry this text-only turn.' })).toBeVisible();
  await prompt.fill('Retry this text-only turn.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(/red left half, a blue right half, and a yellow circle/).last()).toBeVisible();
  const upstream = await (await request.get(`${mockHugo}/__test/last`)).json() as {messages:Array<{role:string;content:string}>};
  expect(upstream.messages.filter(message => message.role === 'user' && message.content === 'Retry this text-only turn.')).toHaveLength(1);
  const persisted = await request.get(`${base}/api/messages/${targetProject}`);
  expect((await persisted.json() as Array<{role:string;content:string}>).map(row => row.role)).toEqual(['user','assistant']);
  expect(projectsByPrompt.has('Fail a turn in another chat.')).toBeTruthy();
});

test('server retry detection preserves fork history and persists repeated inherited text as a new turn', async ({ request }) => {
  const base = String(test.info().project.use.baseURL);
  await request.get(`${mockHugo}/__test/reset`);
  const endpoint = `${mockHugo}/v1`;
  const repeated = await request.post(`${base}/api/projects`, { data: { name: 'Repeated fork prompt' } });
  const repeatedProject = await repeated.json() as { id: string };
  const sameText = 'Question inherited from the parent.';
  const repeatedBody = { endpoint, model: 'gemma3:4b', project: repeatedProject.id, prompt: sameText, history: [{ role: 'user', content: sameText }], mode: 'Research', toolsEnabled: false };
  const repeatedResponse = await request.post(`${base}/api/chat`, { data: repeatedBody });
  expect((await repeatedResponse.text())).toContain('"done":true');
  const repeatedMessages = await request.get(`${base}/api/messages/${repeatedProject.id}`);
  expect((await repeatedMessages.json() as Array<{ role: string }>).map(message => message.role)).toEqual(['user', 'assistant']);

  const fork = await request.post(`${base}/api/projects`, { data: { name: 'Fork retry context' } });
  const forkProject = await fork.json() as { id: string };
  await request.post(`${mockHugo}/__test/config`, { data: { scenario: 'interrupt' } });
  const retryBody = { ...repeatedBody, project: forkProject.id, prompt: 'Interrupted continuation in the child.', history: [{ role: 'user', content: 'Parent snapshot message.' }] };
  const interrupted = await request.post(`${base}/api/chat`, { data: retryBody });
  expect(await interrupted.text()).toContain('Hugo stream ended before the response completed.');
  await request.post(`${mockHugo}/__test/config`, { data: { scenario: 'normal' } });
  const retried = await request.post(`${base}/api/chat`, { data: retryBody });
  expect(await retried.text()).toContain('"done":true');
  const upstream = await (await request.get(`${mockHugo}/__test/last`)).json() as { messages: Array<{ role: string; content: string }> };
  expect(upstream.messages[0]).toEqual({ role: 'user', content: 'Parent snapshot message.' });
  expect(upstream.messages.at(-1)?.content).toBe('Interrupted continuation in the child.');
  const forkMessages = await request.get(`${base}/api/messages/${forkProject.id}`);
  expect((await forkMessages.json() as Array<{ role: string }>).map(message => message.role)).toEqual(['user', 'assistant']);
});
