// Simple logging system with different log levels

const LOG_LEVELS = {
    ERROR: 'ERROR',
    WARNING: 'WARNING',
    INFO: 'INFO'
};

const COLORS = {
    ERROR: '\x1b[31m',      // Red
    WARNING: '\x1b[33m',    // Yellow
    INFO: '\x1b[36m',       // Cyan
    RESET: '\x1b[0m'        // Reset
};

/**
 * Format timestamp as HH:MM:SS
 */
function getTimestamp() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

/**
 * Log error messages
 * @param {string} message - The error message
 * @param {Error} error - Optional error object for stack trace
 */
function log_error(message, error = null) {
    const timestamp = getTimestamp();
    const prefix = `${COLORS.ERROR}[${timestamp}] [ERROR]${COLORS.RESET}`;
    console.error(`${prefix} ${message}`);
    
    if (error && error.stack) {
        console.error(`${COLORS.ERROR}${error.stack}${COLORS.RESET}`);
    }
}

/**
 * Log warning messages
 * @param {string} message - The warning message
 */
function log_warning(message) {
    const timestamp = getTimestamp();
    const prefix = `${COLORS.WARNING}[${timestamp}] [WARNING]${COLORS.RESET}`;
    console.warn(`${prefix} ${message}`);
}

/**
 * Log info messages
 * @param {string} message - The info message
 */
function log_info(message) {
    const timestamp = getTimestamp();
    const prefix = `${COLORS.INFO}[${timestamp}] [INFO]${COLORS.RESET}`;
    console.log(`${prefix} ${message}`);
}

module.exports = {
    log_error,
    log_warning,
    log_info
};
