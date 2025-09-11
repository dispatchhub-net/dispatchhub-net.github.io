import { LOADS_APPS_SCRIPT_URL } from '../config.js';
import { appState } from '../state.js';
import { LZW } from '../utils.js'; // <-- Import the new LZW utility

/**
 * Fetches and processes live load data specifically for the Profiles view.
 * It handles compressed data from the Apps Script and maps columns.
 */
export async function fetchProfileData() {
    // FIX: Removed a caching check here that prevented live data from ever being refreshed.
    // Now, it will always fetch the latest data when called.
    try {
        const response = await fetch(LOADS_APPS_SCRIPT_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();

        if (result.error) {
            throw new Error(result.error);
        }

        let finalData;

        // Check if the data is compressed and decompress it
        if (result.compressed) {
            const decompressedString = LZW.decompress(result.data);
            
            // --- START OF FIX ---
            // Add a check to ensure decompression was successful.
            if (decompressedString === null) {
                throw new Error("Failed to decompress data from the server. The data might be corrupted or in an unexpected format.");
            }
            // --- END OF FIX ---

            finalData = JSON.parse(decompressedString);
        } else {
            // Handle uncompressed data as a fallback
            finalData = result;
        }

        const mappedData = (finalData.loadsData || []).map(load => ({
            id: load.id,
            price: load.price,
            cut: load.cut,
            status: load.status,
            pu_date: load.pu_date,
            pu_location: load.pu_location,
            do_date: load.do_date,
            do_location: load.do_location,
            delivered_at: load.do_date,
            driver: load.driver,
            dispatcher: load.dispatcher,
            team: load.team,
            contract_type: load.contract,
            company_name: load.company_name,
            trip_miles: load.trip_miles,
            deadhead_miles: load.deadhead_miles,
            rpm_all: ((load.trip_miles || 0) + (load.deadhead_miles || 0)) > 0 ? ((load.price || 0) + (load.cut || 0)) / ((load.trip_miles || 0) + (load.deadhead_miles || 0)) : 0,
            new_start: load.new_start,
            hidden_miles: load.Hidden_Miles,
            moved_monday: load.moved_monday,
            driver_gross_without_moved: load.driver_gross_without_moved,
            wellness_fail: load.wellness_fail,
            ...load 
        }));
        
        appState.profiles.liveData = mappedData;
        appState.loads.data = mappedData;
        appState.loads.spreadsheetTimezone = finalData.spreadsheetTimezone || 'UTC';

    } catch (e) {
        console.error("Error fetching Profiles data:", e);
        appState.profiles.error = "Failed to load live data for profiles.";
    }
}
