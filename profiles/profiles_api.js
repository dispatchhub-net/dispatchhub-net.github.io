// from 1. DISP TEST/profiles/profiles_api.js

import { LOADS_APPS_SCRIPT_URLS } from '../config.js'; // <-- MODIFIED to import the new array
import { appState } from '../state.js';
import { LZW, fetchWithRetry } from '../utils.js';

export async function fetchProfileData() {
    try {
        // Use the new fetchWithRetry function for each URL
        const fetchPromises = LOADS_APPS_SCRIPT_URLS.map(url => 
            fetchWithRetry(url).then(res => res.json()) // Use it here
        );

        const results = await Promise.all(fetchPromises);

        let combinedData = [];
        let spreadsheetTimezone = 'UTC';

        for (const result of results) {
            if (result.error) {
                throw new Error(result.error);
            }

            let finalData;
            if (result.compressed) {
                const decompressedString = LZW.decompress(result.data);
                if (decompressedString === null) {
                    throw new Error("Failed to decompress data. The data might be corrupted.");
                }
                finalData = JSON.parse(decompressedString);
            } else {
                finalData = result;
            }

            if (finalData.loadsData) {
                combinedData.push(...finalData.loadsData);
            }
            spreadsheetTimezone = finalData.spreadsheetTimezone || spreadsheetTimezone;
        }

        const mappedData = combinedData.map(load => ({
            id: load.id, price: load.price, cut: load.cut, status: load.status, pu_date: load.pu_date,
            pu_location: load.pu_location, do_date: load.do_date, do_location: load.do_location,
            delivered_at: load.do_date, driver: load.driver, dispatcher: load.dispatcher, team: load.team,
            franchise_name: load.franchise_name, contract_type: load.contract, company_name: load.company_name,
            trip_miles: load.trip_miles, deadhead_miles: load.deadhead_miles,
            rpm_all: ((load.trip_miles || 0) + (load.deadhead_miles || 0)) > 0 ? ((load.price || 0) + (load.cut || 0)) / ((load.trip_miles || 0) + (load.deadhead_miles || 0)) : 0,
            new_start: load.new_start, hidden_miles: load.Hidden_Miles, moved_monday: load.moved_monday,
            driver_gross_without_moved: load.driver_gross_without_moved, wellness_fail: load.wellness_fail,
            ...load 
        }));
        
        appState.profiles.liveData = mappedData;
        appState.loads.data = mappedData;
        appState.loads.spreadsheetTimezone = spreadsheetTimezone;

    } catch (e) {
        console.error("Error fetching Profiles data from multiple sources:", e);
        appState.profiles.error = "Failed to load live data for profiles. " + e.message;
        throw e; // Re-throw the error
    }
}
