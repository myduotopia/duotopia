/**
 * Password validation utilities
 * Matches backend validation in backend/auth.py:validate_password_strength()
 */

export interface PasswordValidationResult {
  valid: boolean;
  errorKey?: string; // i18n translation key for the error
}

/**
 * Validate password strength with comprehensive checks
 * Returns i18n key for specific error message
 */
export function validatePasswordStrength(
  password: string,
): PasswordValidationResult {
  // Check minimum length (8 characters)
  if (password.length < 8) {
    return { valid: false, errorKey: "passwordTooShort" };
  }

  // Check for spaces
  if (/\s/.test(password)) {
    return { valid: false, errorKey: "containsSpaces" };
  }

  // Check for uppercase letter
  if (!/[A-Z]/.test(password)) {
    return { valid: false, errorKey: "missingUppercase" };
  }

  // Check for lowercase letter
  if (!/[a-z]/.test(password)) {
    return { valid: false, errorKey: "missingLowercase" };
  }

  // Check for number
  if (!/[0-9]/.test(password)) {
    return { valid: false, errorKey: "missingNumber" };
  }

  // Check for special character (matches backend special_chars)
  if (!/[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password)) {
    return { valid: false, errorKey: "missingSpecialChar" };
  }

  return { valid: true };
}

/**
 * Validate student password strength (relaxed rules)
 * Students only need minimum 6 characters, digits-only is OK
 * Matches backend: auth.py:validate_student_password_strength()
 */
export function validateStudentPasswordStrength(
  password: string,
): PasswordValidationResult {
  if (password.length < 6) {
    return { valid: false, errorKey: "passwordTooShort" };
  }

  return { valid: true };
}
