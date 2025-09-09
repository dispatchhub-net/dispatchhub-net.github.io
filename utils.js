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
