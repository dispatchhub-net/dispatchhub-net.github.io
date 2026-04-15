/**
 * Calculates the median of an array of numbers.
 * @param {number[]} arr - The array of numbers.
 * @returns {number} The median value.
 */

export const calculateMedian = (arr) => {
    if (!arr || arr.length === 0) return 0;
    const sortedArr = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sortedArr.length / 2);
    return sortedArr.length % 2 === 0 ? (sortedArr[mid - 1] + sortedArr[mid]) / 2 : sortedArr[mid];
};

/**
 * Formats a numeric value into a percentage string.
 * @param {number | null} value - The number to format (e.g., 0.25).
 * @returns {string} The formatted percentage string (e.g., "25.0%"), or '-' if the value is invalid.
 */
export const formatPercentage = (value) => {
    if (isNaN(value) || value === null) return '-';
    return `${(value * 100).toFixed(1)}%`;
};
/**
 * Formats a UTC date string into a localized string using a specific timezone.
 * @param {string | Date} dateInput - The UTC date string or Date object from the API.
 * @param {string} timeZone - The IANA timezone name from the spreadsheet (e.g., "America/New_York").
 * @returns {string} The formatted date and time string, or '-' if the input is invalid.
 */
export const formatUtcToSheetTime = (dateInput, timeZone) => {
    if (!dateInput || !timeZone) return '-';

    try {
        const date = new Date(dateInput);
        
        // This object tells the function exactly how to format the date and time.
        const options = {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            hour12: true, // Use AM/PM
            timeZone: timeZone, // Apply the specific timezone from your sheet
        };

        // Check if the date is valid before trying to format it
        if (isNaN(date.getTime())) {
            // If the date is invalid, try to parse it more robustly
            // This handles cases where the string might be slightly off
            const robustDate = new Date(dateInput.replace(/-/g, '/'));
            if (isNaN(robustDate.getTime())) return '-'; // Still invalid, return placeholder
            return robustDate.toLocaleString('en-US', options);
        }

        return date.toLocaleString('en-US', options);
    } catch (error) {
        console.error("Could not format date:", dateInput, error);
        return '-';
    }
};

/**
 * Creates a simple performance timer.
 * @param {string} name - The name of the timer.
 * @returns {object} An object with a "stop" method.
 */
export const startTimer = (name) => {
    const startTime = performance.now();
    return {
        stop: () => {
            const endTime = performance.now();
            const duration = (endTime - startTime).toFixed(2);
            console.log(`%c[PERFORMANCE] ${name} took ${duration} ms`, 'color: #2dd4bf');
        }
    };
};

// LZW-decompress a string
export const LZW = {
    decompress: function (compressed) {
      "use strict";
      var i,
          dictionary = [],
          w,
          result,
          k,
          entry = "",
          dictSize = 256;
      for (i = 0; i < 256; i += 1) {
          dictionary[i] = String.fromCharCode(i);
      }
  
      w = String.fromCharCode(compressed[0]);
      result = w;
      for (i = 1; i < compressed.length; i += 1) {
          k = compressed[i];
          if (dictionary[k]) {
              entry = dictionary[k];
          } else {
              if (k === dictSize) {
                  entry = w + w.charAt(0);
              } else {
                  return null;
              }
          }
  
          result += entry;
  
          dictionary[dictSize++] = w + entry.charAt(0);
  
          w = entry;
      }
      return result;
    }
  };


  // In 1. DISP TEST/utils.js

/**
 * Fetches a resource with a specified number of retries on failure.
 * @param {string} url - The URL to fetch.
 * @param {number} retries - The number of times to retry on failure.
 * @param {number} delay - The delay in milliseconds between retries.
 * @returns {Promise<Response>} A promise that resolves to the fetch Response.
 */
export const fetchWithRetry = async (url, retries = 2, delay = 1000) => {
    for (let i = 0; i <= retries; i++) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                // Throw an error for server-side issues (like 403, 500)
                throw new Error(`HTTP error! status: ${response.status} for URL: ${url}`);
            }
            return response; // Success
        } catch (error) {
            console.warn(`Fetch attempt ${i + 1} for ${url} failed. Retrying in ${delay / 1000}s...`);
            if (i === retries) {
                console.error(`All fetch attempts for ${url} failed.`);
                throw error; // Throw the final error if all retries fail
            }
            // Wait for the specified delay before the next attempt
            await new Promise(res => setTimeout(res, delay));
        }
    }
};

/**
 * Calculates the start (Tuesday) and end (Monday) date objects for a given payroll week.
 * @param {number} weeksAgo - 0 for current week, 1 for last week, etc.
 * @returns {{start: Date, end: Date}}
 */
export function getPayrollWeekDateRange(weeksAgo = 0) {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // Sunday = 0, Monday = 1...
    
    const daysUntilNextMonday = (1 - dayOfWeek + 7) % 7;
    const end = new Date(now);
    end.setUTCDate(now.getUTCDate() + daysUntilNextMonday - (weeksAgo * 7));
    end.setUTCHours(23, 59, 59, 999);

    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - 6);
    start.setUTCHours(0, 0, 0, 0);
    
    return { start, end };
}

export function showSavingIndicator() {
    const indicator = document.getElementById('saving-indicator-overlay');
    if (indicator) {
        indicator.classList.remove('hidden');
    }
}

export function hideSavingIndicator() {
    const indicator = document.getElementById('saving-indicator-overlay');
    if (indicator) {
        indicator.classList.add('hidden');
    }
}

/**
 * Generates a specified number of visually distinct colors using the golden angle.
 * @param {number} count - The number of colors to generate.
 * @returns {string[]} An array of HSL color strings.
 */
export function generateDistinctColors(count) {
    const colors = [];
    const GOLDEN_ANGLE = 137.5;
    let hue = Math.random() * 360; // Start at a random hue for variety on each page load

    for (let i = 0; i < count; i++) {
        hue = (hue + GOLDEN_ANGLE) % 360;
        // We use consistent saturation (80%) and lightness (60%) for a cohesive look
        colors.push(`hsl(${hue}, 80%, 60%)`);
    }
    return colors;
}