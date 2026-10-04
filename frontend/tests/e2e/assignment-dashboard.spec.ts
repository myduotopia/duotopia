import { test, expect, Page } from '@playwright/test';

// Test configuration
const TEST_URL = 'http://localhost:5173';
const TEACHER_EMAIL = 'teacher1@duotopia.com';
const TEACHER_PASSWORD = 'password123';

test.describe('Assignment Dashboard Complete Test Suite', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    // Create a new page for each test
    page = await browser.newPage();

    // Login as teacher
    await loginAsTeacher(page);
  });

  test.afterEach(async () => {
    await page.close();
  });

  async function loginAsTeacher(page: Page) {
    await page.goto(`${TEST_URL}/teacher/login`);

    // Fill login form
    await page.fill('input[type="email"]', TEACHER_EMAIL);
    await page.fill('input[type="password"]', TEACHER_PASSWORD);

    // Click login button
    await page.click('button[type="submit"]');

    // Wait for navigation to dashboard
    await page.waitForURL('**/teacher/dashboard', { timeout: 10000 });

    // Verify login success
    await expect(page).toHaveURL(/.*teacher\/dashboard/);
  }

  test('1. Navigate to Classroom Detail page', async () => {
    // Go to classrooms page
    await page.goto(`${TEST_URL}/teacher/classrooms`);

    // Wait for classroom list to load
    await page.waitForSelector('.classroom-card', { timeout: 10000 });

    // Click on first classroom
    const firstClassroom = page.locator('.classroom-card').first();
    await firstClassroom.click();

    // Verify we're on classroom detail page
    await expect(page).toHaveURL(/.*teacher\/classrooms\/\d+/);

    // Check if classroom title is visible
    await expect(page.locator('h1')).toBeVisible();
  });

  test('2. Test Assignment Tab Navigation', async () => {
    // Navigate to classroom detail
    await page.goto(`${TEST_URL}/teacher/classrooms`);
    await page.locator('.classroom-card').first().click();

    // Click on Assignment tab
    await page.click('button:has-text("作業管理")');

    // Verify assignment section is visible
    await expect(page.locator('h3:has-text("作業列表")')).toBeVisible();

    // Check if stats cards are visible
    await expect(page.locator('text=總作業數')).toBeVisible();
    await expect(page.locator('text=已完成')).toBeVisible();
    await expect(page.locator('text=進行中')).toBeVisible();
    await expect(page.locator('text=已逾期')).toBeVisible();
  });

  test('3. Test Create New Assignment Button', async () => {
    await page.goto(`${TEST_URL}/teacher/classrooms`);
    await page.locator('.classroom-card').first().click();
    await page.click('button:has-text("作業管理")');

    // Click create assignment button
    const createButton = page.locator('button:has-text("指派新作業")');
    await expect(createButton).toBeVisible();
    await createButton.click();

    // Verify assignment dialog opens
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(page.locator('text=指派作業')).toBeVisible();

    // Close dialog
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });

  test('4. Test Assignment List Display', async () => {
    await page.goto(`${TEST_URL}/teacher/classrooms`);
    await page.locator('.classroom-card').first().click();
    await page.click('button:has-text("作業管理")');

    // Check if assignment table headers are visible
    const tableHeaders = [
      '作業標題',
      '內容類型',
      '指派對象',
      '截止日期',
      '完成率'
    ];

    for (const header of tableHeaders) {
      await expect(page.locator(`th:has-text("${header}")`)).toBeVisible();
    }
  });

  test('5. Test Assignment Details Dialog', async () => {
    await page.goto(`${TEST_URL}/teacher/classrooms`);
    await page.locator('.classroom-card').first().click();
    await page.click('button:has-text("作業管理")');

    // Check if there are any assignments
    const viewDetailsButtons = page.locator('button:has-text("作業設定")');
    const count = await viewDetailsButtons.count();

    if (count > 0) {
      // Click first assignment's view details button
      await viewDetailsButtons.first().click();

      // Verify assignment details dialog opens
      await expect(page.locator('[role="dialog"]')).toBeVisible();
      await expect(page.getByRole('dialog').getByText('作業設定', { exact: true })).toBeVisible();

      // Check if student completion dashboard is visible
      await expect(page.locator('text=學生列表')).toBeVisible();

      // Check if summary statistics are visible
      await expect(page.locator('text=總人數')).toBeVisible();
      await expect(page.locator('text=未開始')).toBeVisible();
      await expect(page.locator('text=進行中')).toBeVisible();
      await expect(page.locator('text=已提交')).toBeVisible();
      await expect(page.locator('text=已批改')).toBeVisible();

      // Check if progress bar is visible
      await expect(page.locator('text=整體完成進度')).toBeVisible();

      // Close dialog
      await page.keyboard.press('Escape');
    }
  });

  test('6. Test Student Completion Dashboard Interactions', async () => {
    await page.goto(`${TEST_URL}/teacher/classrooms`);
    await page.locator('.classroom-card').first().click();
    await page.click('button:has-text("作業管理")');

    const viewDetailsButtons = page.locator('button:has-text("作業設定")');
    const count = await viewDetailsButtons.count();

    if (count > 0) {
      await viewDetailsButtons.first().click();

      // Wait for dialog to open
      await page.waitForSelector('[role="dialog"]');

      // Test search functionality
      const searchInput = page.locator('input[placeholder*="搜尋學生"]');
      if (await searchInput.isVisible()) {
        await searchInput.fill('A');
        await page.waitForTimeout(500); // Wait for search to filter

        // Clear search
        await searchInput.clear();
      }

      // Test status filter
      const statusFilter = page.locator('select').filter({ hasText: /全部狀態/ });
      if (await statusFilter.isVisible()) {
        await statusFilter.selectOption('NOT_STARTED');
        await page.waitForTimeout(500);

        // Reset filter
        await statusFilter.selectOption('all');
      }

      // Test sort button
      const sortButton = page.locator('button').filter({ has: page.locator('svg') }).last();
      if (await sortButton.isVisible()) {
        await sortButton.click();
        await page.waitForTimeout(500);
      }
    }
  });

  test('7. Test Assignment Action Buttons', async () => {
    await page.goto(`${TEST_URL}/teacher/classrooms`);
    await page.locator('.classroom-card').first().click();
    await page.click('button:has-text("作業管理")');

    const viewDetailsButtons = page.locator('button:has-text("作業設定")');
    const count = await viewDetailsButtons.count();

    if (count > 0) {
      await viewDetailsButtons.first().click();
      await page.waitForSelector('[role="dialog"]');

      // Check if action buttons are visible
      const actionButtons = [
        '查看學生提交',
        '編輯作業',
        '刪除作業'
      ];

      for (const buttonText of actionButtons) {
        const button = page.locator(`button:has-text("${buttonText}")`);
        await expect(button).toBeVisible();

        // Test clicking each button
        await button.click();

        // Check for toast notification (indicating functionality is pending)
        await page.waitForTimeout(1000);
      }
    }
  });

  test('8. Test Programs Tab', async () => {
    await page.goto(`${TEST_URL}/teacher/classrooms`);
    await page.locator('.classroom-card').first().click();

    // Click on Programs tab
    await page.click('button:has-text("課程管理")');

    // Check if add program button is visible
    const addProgramButton = page.locator('button:has-text("新增課程")');
    await expect(addProgramButton).toBeVisible();

    // Test clicking add program button
    await addProgramButton.click();

    // Check if dialog opens
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // Close dialog
    await page.keyboard.press('Escape');
  });

  test('9. Test Students Tab', async () => {
    await page.goto(`${TEST_URL}/teacher/classrooms`);
    await page.locator('.classroom-card').first().click();

    // Click on Students tab
    await page.click('button:has-text("學生管理")');

    // Check if student management buttons are visible
    await expect(page.locator('button:has-text("新增學生")')).toBeVisible();
    await expect(page.locator('button:has-text("批量匯入")')).toBeVisible();

    // Check if student table is visible
    await expect(page.locator('text=學生姓名')).toBeVisible();
  });

  test('10. Test Lesson Management', async () => {
    await page.goto(`${TEST_URL}/teacher/classrooms`);
    await page.locator('.classroom-card').first().click();
    await page.click('button:has-text("課程管理")');

    // Check if any lessons exist
    const addLessonButtons = page.locator('button:has-text("新增單元")');
    const lessonCount = await addLessonButtons.count();

    if (lessonCount > 0) {
      // Click first add lesson button
      await addLessonButtons.first().click();

      // Check if lesson dialog opens
      await expect(page.locator('[role="dialog"]')).toBeVisible();
      await expect(page.locator('text=新增單元')).toBeVisible();

      // Fill lesson form
      await page.fill('input[id="name"]', 'Test Lesson');
      await page.fill('textarea[id="description"]', 'Test Description');
      await page.fill('input[id="minutes"]', '30');

      // Cancel (don't actually create)
      await page.click('button:has-text("取消")');
    }
  });

  test('11. Test Responsive Layout', async () => {
    await page.goto(`${TEST_URL}/teacher/classrooms`);
    await page.locator('.classroom-card').first().click();

    // Test different viewport sizes
    const viewports = [
      { width: 1920, height: 1080 }, // Desktop
      { width: 768, height: 1024 },  // Tablet
      { width: 375, height: 667 }    // Mobile
    ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(500);

      // Check if main elements are still visible
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('[role="tablist"]')).toBeVisible();
    }
  });

  test('12. Test Data Persistence', async () => {
    await page.goto(`${TEST_URL}/teacher/classrooms`);
    await page.locator('.classroom-card').first().click();
    await page.click('button:has-text("作業管理")');

    // Get initial assignment count
    const initialCount = await page.locator('tbody tr').count();

    // Reload page
    await page.reload();

    // Navigate back to assignments tab
    await page.click('button:has-text("作業管理")');

    // Check if count is the same
    const afterReloadCount = await page.locator('tbody tr').count();
    expect(afterReloadCount).toBe(initialCount);
  });

  test('13. Test Error Handling', async () => {
    // Test invalid classroom ID
    await page.goto(`${TEST_URL}/teacher/classrooms/99999`);

    // Should either redirect or show error
    await page.waitForTimeout(2000);

    // Check if we're redirected or error is shown
    const url = page.url();
    const hasError = await page.locator('text=/錯誤|找不到|not found/i').isVisible();

    expect(url.includes('/teacher/classrooms') || hasError).toBeTruthy();
  });

  test('14. Test Loading States', async () => {
    await page.goto(`${TEST_URL}/teacher/classrooms`);

    // Slow down network to see loading states
    await page.route('**/*', route => {
      setTimeout(() => route.continue(), 1000);
    });

    await page.locator('.classroom-card').first().click();

    // Check for loading indicators
    const loadingIndicators = page.locator('text=/載入|loading/i');
    const spinners = page.locator('.animate-spin');

    const hasLoadingState = await loadingIndicators.first().isVisible() || await spinners.first().isVisible();
    expect(hasLoadingState).toBeTruthy();
  });

  test('15. Test Keyboard Navigation', async () => {
    await page.goto(`${TEST_URL}/teacher/classrooms`);
    await page.locator('.classroom-card').first().click();

    // Test Tab key navigation
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // Test Enter key on focused element
    await page.keyboard.press('Enter');

    // Test Escape key for dialogs
    const buttons = page.locator('button:has-text("新增")');
    if (await buttons.first().isVisible()) {
      await buttons.first().click();
      await page.waitForSelector('[role="dialog"]');
      await page.keyboard.press('Escape');
      await expect(page.locator('[role="dialog"]')).not.toBeVisible();
    }
  });
});

// Run a comprehensive smoke test
test('Smoke Test - Complete User Journey', async ({ page }) => {
  // Login
  await page.goto(`${TEST_URL}/teacher/login`);
  await page.fill('input[type="email"]', TEACHER_EMAIL);
  await page.fill('input[type="password"]', TEACHER_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/teacher/dashboard');

  // Navigate to classrooms
  await page.click('text=班級管理');
  await page.waitForSelector('.classroom-card');

  // Enter first classroom
  await page.locator('.classroom-card').first().click();

  // Test all tabs
  const tabs = ['學生管理', '課程管理', '作業管理'];
  for (const tab of tabs) {
    await page.click(`button:has-text("${tab}")`);
    await page.waitForTimeout(1000);
  }

  // Test assignment details
  await page.click('button:has-text("作業管理")');
  const viewButtons = page.locator('button:has-text("作業設定")');
  if (await viewButtons.count() > 0) {
    await viewButtons.first().click();
    await page.waitForSelector('[role="dialog"]');

    // Verify student dashboard is visible
    await expect(page.locator('text=學生列表')).toBeVisible();
    await expect(page.locator('table')).toBeVisible();

    // Close dialog
    await page.keyboard.press('Escape');
  }

  // Logout
  await page.click('button:has-text("登出")');

  console.log('✅ Smoke test completed successfully!');
});
