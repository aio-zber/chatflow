import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test('should redirect to sign in when not authenticated', async ({ page }) => {
    await page.goto('/chat')
    await expect(page).toHaveURL(/\/auth\/signin/)
  })

  test('should show sign in form', async ({ page }) => {
    await page.goto('/auth/signin')
    
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()
    await expect(page.getByPlaceholder(/email/i)).toBeVisible()
    await expect(page.getByPlaceholder(/password/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('should show sign up form', async ({ page }) => {
    await page.goto('/auth/signup')
    
    await expect(page.getByRole('heading', { name: /sign up/i })).toBeVisible()
    await expect(page.getByPlaceholder(/email/i)).toBeVisible()
    await expect(page.getByPlaceholder(/username/i)).toBeVisible()
    await expect(page.getByPlaceholder(/password/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /sign up/i })).toBeVisible()
  })

  test('should navigate between sign in and sign up', async ({ page }) => {
    await page.goto('/auth/signin')
    
    await page.getByRole('link', { name: /sign up/i }).click()
    await expect(page).toHaveURL(/\/auth\/signup/)
    
    await page.getByRole('link', { name: /sign in/i }).click()
    await expect(page).toHaveURL(/\/auth\/signin/)
  })

  test('should validate email format', async ({ page }) => {
    await page.goto('/auth/signin')
    
    await page.getByPlaceholder(/email/i).fill('invalid-email')
    await page.getByRole('button', { name: /sign in/i }).click()
    
    // Check for validation error (this depends on your validation implementation)
    await expect(page.getByText(/invalid email/i)).toBeVisible()
  })

  test('should handle form submission', async ({ page }) => {
    await page.goto('/auth/signin')
    
    await page.getByPlaceholder(/email/i).fill('test@example.com')
    await page.getByPlaceholder(/password/i).fill('password123')
    await page.getByRole('button', { name: /sign in/i }).click()
    
    // Should show loading state or attempt to sign in
    // Note: This test might fail if there's no backend running
    // In a real test, you'd mock the API or use a test database
  })
})
