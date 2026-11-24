import { expect, test as base } from '@playwright/test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/http.js';
import { databaseFixture } from './fixture.js';

const test = base.extend<{ stockroomUrl: string }>({
  stockroomUrl: async ({}, use) => {
    const fixture = await databaseFixture();
    const app = createApp(fixture.db);
    app.use(express.static(fileURLToPath(new URL('../dist/client/', import.meta.url))));
    const server = app.listen(0, '127.0.0.1');
    try {
      await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
      await use('http://127.0.0.1:' + (server.address() as AddressInfo).port);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fixture.close();
    }
  },
});

test('принимает товар с браком, проверяет остаток и открывает историю SKU', async ({ page, stockroomUrl }) => {
  await page.goto(stockroomUrl);
  await expect(page.getByRole('heading', { name: 'Реестр поставок' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 850 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.getByRole('searchbox', { name: 'Поиск по номеру или поставщику' }).fill('1048');
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
  await page.getByRole('link', { name: 'ПСТ-1048', exact: true }).click();

  await page.getByRole('spinbutton', { name: 'Принято · BX-210' }).fill('6');
  await page.getByRole('spinbutton', { name: 'Отклонено · BX-210' }).fill('1');
  await page.getByRole('textbox', { name: 'Причина отклонения · BX-210' }).fill('Смята коробка');
  await page.getByRole('button', { name: 'Сохранить приёмку' }).click();
  await expect(page.getByText('Частично обработана', { exact: true })).toBeVisible();
  await expect(page.getByText('Смята коробка')).toBeVisible();

  await page.getByRole('link', { name: 'Остатки', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Поиск по SKU или названию' }).fill('BX-210');
  const stockRow = page.getByRole('row').filter({ hasText: 'BX-210' });
  await expect(stockRow.getByRole('cell', { name: '6 шт.' })).toBeVisible();
  await stockRow.getByRole('link', { name: 'История' }).click();

  await expect(page.getByRole('heading', { name: 'История по SKU BX-210' })).toBeVisible();
  const movement = page.getByRole('row').filter({ hasText: 'BX-210' });
  await expect(movement.getByRole('cell', { name: '+6', exact: true })).toBeVisible();
  await expect(movement.getByText('Приёмка')).toBeVisible();
  await movement.getByRole('link', { name: 'ПСТ-1048' }).click();
  await expect(page.getByRole('heading', { name: 'ПСТ-1048' })).toBeVisible();

  await page.getByRole('spinbutton', { name: 'Принято · BX-210' }).fill('3');
  await page.getByRole('button', { name: 'Сохранить приёмку' }).click();
  await expect(page.getByText('Все единицы поставки обработаны.')).toBeVisible();
  await page.getByRole('link', { name: 'Остатки', exact: true }).click();
  await expect(stockRow.getByRole('cell', { name: '9 шт.' })).toBeVisible();
  await stockRow.getByRole('button', { name: 'Выдать', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Количество' }).fill('4');
  await page.getByRole('textbox', { name: 'Основание выдачи' }).fill('Заявка Р-018');
  await page.getByRole('button', { name: 'Подтвердить выдачу' }).click();
  await expect(stockRow.getByRole('cell', { name: '5 шт.' })).toBeVisible();

  await stockRow.getByRole('button', { name: 'Выдать', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Количество' }).fill('6');
  await page.getByRole('textbox', { name: 'Основание выдачи' }).fill('Заявка Р-019');
  await page.getByRole('button', { name: 'Подтвердить выдачу' }).click();
  await expect(page.getByRole('alert')).toContainText('доступно 5 шт.');
  await expect(stockRow.getByRole('cell', { name: '5 шт.' })).toBeVisible();
  await stockRow.getByRole('link', { name: 'История' }).click();
  await expect(movement).toHaveCount(3);
  await expect(movement.getByRole('cell', { name: '−4', exact: true })).toBeVisible();
});
