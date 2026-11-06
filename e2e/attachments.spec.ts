import { expect, test, type Page } from '@playwright/test';

const pixel = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/SxoAAAAASUVORK5CYII='), char => char.charCodeAt(0));

async function mockApp(page: Page, vision = true, initialMessages: Array<{ role: string; content: string; model?: string }> = []) {
  let sent: Record<string, unknown> | undefined;
  const conversations: Record<string, Array<{ role: string; content: string; model?: string }>> = { p1: initialMessages };
  let uploaded = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/endpoints' && method === 'GET') return route.fulfill({ json: [{ id: 'ep1', name: 'Hugo test', url: 'http://hugo.test/v1' }] });
    if (url.pathname === '/api/projects' && method === 'GET') return route.fulfill({ json: [{ id: 'p1', name: 'Research' }] });
    if (url.pathname === '/api/projects' && method === 'POST') return route.fulfill({ json: { id: 'p2', name: 'Project 2' } });
    if (url.pathname === '/api/endpoints/ep1/models') return route.fulfill({ json: [
      { name: 'text-model', capabilities: ['completion', 'tools'], contextLength: 8192, size: 2_000_000 },
      ...(vision ? [{ name: 'vision-model', capabilities: ['completion', 'vision'], contextLength: 8192, size: 4_000_000 }] : []),
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
      sent = route.request().postDataJSON();
      conversations[String(sent?.project)] = [{ role: 'user', content: String(sent?.prompt ?? '') }, { role: 'assistant', content: 'READY', model: String(sent?.model ?? '') }];
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"delta":"READY"}\n\ndata: {"done":true}\n\n' });
    }
    return route.fulfill({ json: [] });
  });
  return { getSent: () => sent };
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
  }, Array.from(pixel));
  await expect(page.getByRole('combobox', { name: 'Model' })).toHaveValue('vision-model');
  await expect(page.getByRole('combobox', { name: 'Composer model' })).toHaveValue('vision-model');
  await page.getByRole('combobox', { name: 'Model' }).selectOption('text-model');
  const message = page.getByRole('textbox', { name: 'Message' });
  await message.fill('Describe the image.');
  await message.press('Enter');
  await expect(page.getByText('This model cannot process the attached image.', { exact: false }).first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Composer model' }).selectOption('vision-model');
  await expect(page.getByRole('combobox', { name: 'Model' })).toHaveValue('vision-model');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('heading', { name: /What are you looking into\?/ })).toHaveCount(0);
  await expect.poll(() => app.getSent()).toMatchObject({ model: 'vision-model', prompt: 'Describe the image.' });
  expect(app.getSent()?.image).toMatch(/^data:image\/png;base64,/);
  await page.locator('button.project').click();
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

test('site text and composer placeholder render white', async ({ page }) => {
  await mockApp(page);
  await page.goto('/');
  const colors = await page.locator('body *').evaluateAll(elements => elements
    .filter(element => element.children.length === 0 && element.textContent?.trim())
    .map(element => getComputedStyle(element).color));
  expect([...new Set(colors)]).toEqual(['rgb(255, 255, 255)']);
  const placeholderColor = await page.getByRole('textbox', { name: 'Message' }).evaluate(element => getComputedStyle(element, '::placeholder').color);
  expect(placeholderColor).toBe('rgb(255, 255, 255)');
  await expect(page.getByRole('button', { name: 'Search' })).toHaveCSS('opacity', '1');
});

test('no vision model opens the requested dialog and cancel retains the staged image', async ({ page }) => {
  await mockApp(page, false);
  await page.goto('/');
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: Buffer.from(pixel) });
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
});
