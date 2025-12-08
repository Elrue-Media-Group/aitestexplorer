# Debugging Failed Tests Guide

This document explains how to investigate each type of test failure and what they indicate.

## Common Failure Types

### 1. "No input fields found" Error

**Symptoms:**
- Test step is trying to verify something (like a heading or navigation items)
- Error message: "No input fields found"
- Step action might be incorrectly identified as "type" instead of "verify"

**Root Cause:**
- The action detection logic is incorrectly identifying verify steps as type steps
- This happens when `step.action` is undefined/empty and the description doesn't clearly indicate the action type

**How to Debug:**
1. Check the test case file (`test-cases.md`) to see what action was specified for the step
2. Check the console output to see what action was detected: `📋 [Step X] Action: "..."`
3. Look at the step description - does it contain "verify", "check", or similar words?
4. Check if the step has an explicit `action` field or if it's missing

**Fix Applied:**
- Added `inferActionFromDescription()` method to intelligently infer actions from descriptions
- Prioritized "verify" when description contains "verify" or "check"
- Added safety checks to prevent undefined action errors
- Improved action detection order to prioritize verify over type

**Files to Check:**
- `output/run-XXX/test-cases.md` - See what the AI generated
- `output/run-XXX/test-results.md` - See the error details
- Console output during execution - See what action was detected

---

### 2. Theme Toggle Timeout Issues

**Symptoms:**
- First click on "Toggle theme" works
- Second click fails with timeout: "elementHandle.click: Timeout 30000ms exceeded"
- Error mentions: "intercepts pointer events"

**Root Cause:**
- After the first theme toggle, the page's HTML element (`<html>`) might be intercepting pointer events
- This could be due to:
  - CSS transitions/animations blocking clicks
  - Theme change causing DOM re-render that blocks interactions
  - Overlay or modal appearing during theme transition

**How to Debug:**
1. Check the screenshot in `evidence/TC-XXX-step-X-failure-XXX.png`
2. Look at the console output to see the exact error
3. Check if there's a delay needed after theme toggle
4. Verify if the element is still visible/enabled after first click

**Potential Fixes:**
- Add a wait after theme toggle before attempting second click
- Use `page.waitForTimeout()` or `page.waitForSelector()` with state options
- Try using `force: true` option on click (though this might mask real issues)
- Check if element needs to be re-queried after theme change

**Files to Check:**
- `output/run-XXX/evidence/TC-XXX-step-X-failure-XXX.png` - Screenshot of failure
- Console output showing the timeout details
- Test results showing the step that failed

---

### 3. Heading/Content Verification Failures

**Symptoms:**
- Test expects a specific heading to be visible (e.g., "Learning Center")
- Verification fails even though heading might actually be present
- Error might be "No input fields found" (wrong action) or generic verification failure

**Root Cause:**
- Action detection issue (see #1 above)
- Heading text might have slight variations (whitespace, case, etc.)
- Page might not be fully loaded when verification runs
- Heading might be in a different location than expected

**How to Debug:**
1. Check the screenshot to see if heading is actually visible
2. Compare expected heading text with what's in the screenshot
3. Check console output for what was actually found
4. Look at `extractContentDetails()` output in the test results

**Potential Fixes:**
- Improve heading matching to be case-insensitive and whitespace-tolerant
- Add wait for content to load before verification
- Use more flexible text matching (contains vs exact match)
- Check if heading is in a different element (h1, h2, span, etc.)

**Files to Check:**
- `output/run-XXX/evidence/TC-XXX-step-X-failure-XXX.png` - Screenshot
- `output/run-XXX/test-results.md` - See what was actually found
- Console output showing extracted content details

---

### 4. Navigation Verification Failures

**Symptoms:**
- Test verifies navigation items are visible
- Verification fails with "No input fields found" or similar
- Navigation items might actually be present

**Root Cause:**
- Same as #1 - action detection issue
- Or verification logic not properly checking for navigation elements

**How to Debug:**
1. Check screenshot to confirm navigation items are visible
2. Check console output for what action was detected
3. Look at test results to see what was actually found

**Potential Fixes:**
- Fix action detection (already done)
- Improve verification logic to specifically check for navigation elements
- Add better logging to show what elements were found

---

## General Debugging Workflow

1. **Check the Test Case Definition**
   - Open `output/run-XXX/test-cases.md`
   - Find the failing test case
   - Check what action was specified for the failing step
   - Note if action is missing or incorrect

2. **Check the Execution Log**
   - Look at console output during test execution
   - Find the step that failed
   - Check what action was detected: `📋 [Step X] Action: "..."`
   - Look for any warnings or errors before the failure

3. **Check the Screenshot**
   - Open `output/run-XXX/evidence/TC-XXX-step-X-failure-XXX.png`
   - Verify if the expected element is actually visible
   - Check if page state matches expectations

4. **Check the Test Results**
   - Open `output/run-XXX/test-results.md`
   - Find the failing test case section
   - Read the "Error" field and "Verification Details"
   - Check what was actually found vs. what was expected

5. **Check the AI Reasoning Log**
   - Open `output/run-XXX/ai-reasoning.md`
   - Find the test case generation operation
   - Check what the AI generated and why
   - See if the prompt or response suggests issues

## Code Locations for Fixes

- **Action Detection**: `src/test-executor.ts` - `executeStep()` method (lines ~167-700)
- **Verify Logic**: `src/test-executor.ts` - `executeStep()` verify section (lines ~532-689)
- **Click Logic**: `src/test-executor.ts` - `executeStep()` click section (lines ~205-416)
- **Test Case Generation**: `src/test-case-generator.ts` - `generateWithAI()` method
- **Action Inference**: `src/test-executor.ts` - `inferActionFromDescription()` method (new)

## Next Steps

After reviewing a failure:
1. Identify the root cause using the steps above
2. Determine if it's a:
   - **Code bug** (action detection, verification logic, etc.) - Fix in code
   - **Test case issue** (AI generated wrong test) - Improve prompts or validation
   - **Site issue** (element actually missing) - Verify manually, might be real bug
3. Apply appropriate fix
4. Re-run test to verify fix

