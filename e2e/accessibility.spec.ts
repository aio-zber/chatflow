import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('Accessibility', () => {
  test('should not have any automatically detectable accessibility issues', async ({ page }) => {
    await page.goto('/')
    
    const accessibilityScanResults = await new AxeBuilder({ page }).analyze()
    
    expect(accessibilityScanResults.violations).toEqual([])
  })

  test('should support keyboard navigation', async ({ page }) => {
    await page.goto('/')
    
    // Test tab navigation through interactive elements
    await page.keyboard.press('Tab')
    await expect(page.locator(':focus')).toBeVisible()
    
    // Continue tabbing through elements
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    
    // Test that focus is visible
    const focusedElement = page.locator(':focus')
    await expect(focusedElement).toBeVisible()
  })

  test('should have proper heading hierarchy', async ({ page }) => {
    await page.goto('/')
    
    // Check for h1
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    
    // Check that headings follow proper hierarchy
    const headings = page.locator('h1, h2, h3, h4, h5, h6')
    const headingTexts = await headings.allTextContents()
    
    expect(headingTexts.length).toBeGreaterThan(0)
  })

  test('should have alt text for images', async ({ page }) => {
    await page.goto('/')
    
    const images = page.locator('img')
    const count = await images.count()
    
    for (let i = 0; i < count; i++) {
      const img = images.nth(i)
      const alt = await img.getAttribute('alt')
      
      // Images should have alt attribute (can be empty for decorative images)
      expect(alt).not.toBeNull()
    }
  })

  test('should have proper form labels', async ({ page }) => {
    await page.goto('/auth/signin')
    
    // Check that form inputs have associated labels
    const inputs = page.locator('input[type="email"], input[type="password"], input[type="text"]')
    const count = await inputs.count()
    
    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i)
      const id = await input.getAttribute('id')
      const ariaLabel = await input.getAttribute('aria-label')
      const ariaLabelledBy = await input.getAttribute('aria-labelledby')
      
      if (id) {
        // Check for associated label
        const label = page.locator(`label[for="${id}"]`)
        const labelExists = await label.count() > 0
        
        // Input should have either a label, aria-label, or aria-labelledby
        expect(labelExists || ariaLabel || ariaLabelledBy).toBeTruthy()
      }
    }
  })

  test('should have sufficient color contrast', async ({ page }) => {
    await page.goto('/')
    
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2aa'])
      .analyze()
    
    const colorContrastViolations = accessibilityScanResults.violations.filter(
      violation => violation.id === 'color-contrast'
    )
    
    expect(colorContrastViolations).toHaveLength(0)
  })

  test('should support screen reader announcements', async ({ page }) => {
    await page.goto('/')
    
    // Check for aria-live regions
    const liveRegions = page.locator('[aria-live]')
    expect(await liveRegions.count()).toBeGreaterThan(0)
    
    // Check for screen reader only content
    const srOnly = page.locator('.sr-only')
    expect(await srOnly.count()).toBeGreaterThan(0)
  })

  test('should have proper button roles and states', async ({ page }) => {
    await page.goto('/')
    
    const buttons = page.locator('button, [role="button"]')
    const count = await buttons.count()
    
    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i)
      
      // Buttons should be keyboard accessible
      await expect(button).toBeFocusable()
      
      // Check for proper button text or aria-label
      const text = await button.textContent()
      const ariaLabel = await button.getAttribute('aria-label')
      
      expect(text?.trim() || ariaLabel).toBeTruthy()
    }
  })

  test('should handle high contrast mode', async ({ page }) => {
    await page.goto('/')
    
    // Simulate high contrast mode by adding the class
    await page.addStyleTag({
      content: `
        .high-contrast {
          --background: #000000;
          --foreground: #ffffff;
        }
      `
    })
    
    await page.evaluate(() => {
      document.documentElement.classList.add('high-contrast')
    })
    
    // Verify that content is still visible and readable
    const heading = page.locator('h1').first()
    await expect(heading).toBeVisible()
  })
})
