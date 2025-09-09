// 1. DISPEČ TEST/profiles/profiles_api.js

import { LOADS_APPS_SCRIPT_URL } from '../config.js';
import { appState } from '../state.js';

/**
 * Fetches and processes live load data specifically for the Profiles view.
 * It maps the Google Sheet columns to the names the app expects.
 */
export async function fetchProfileData() {
    // If data already exists, don't fetch it again.
    if (appState.profiles.liveData && appState.profiles.liveData.length > 0) {
        return;
    }

    try {
        const response = await fetch(LOADS_APPS_SCRIPT_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();

        if (result.error) {
            throw new Error(result.error);
        }

        // Map the raw data from the Google Sheet to the structure the app uses
        const mappedData = (result.loadsData || []).map(load => ({
            // Core Identifiers
            id: load.id,
            price: load.price, // Use 'price' for gross calculations
            cut: load.cut,     // Use 'cut' for margin calculations
            status: load.status,
            
            // Dates & Locations
            pu_date: load.pu_date,
            pu_location: load.pu_location,
            do_date: load.do_date,
            do_location: load.do_location,
            delivered_at: load.do_date,

            // People & Teams
            driver: load.driver,
            dispatcher: load.dispatcher,
            team: load.team,
            contract_type: load.contract,
            company_name: load.company_name,

            // Mileage & Financials
            trip_miles: load.trip_miles,
            deadhead_miles: load.deadhead_miles,
            rpm_all: ((load.trip_miles || 0) + (load.deadhead_miles || 0)) > 0 ? ((load.price || 0) + (load.cut || 0)) / ((load.trip_miles || 0) + (load.deadhead_miles || 0)) : 0,

            // Pre-calculated Flags & Tooltip Data from Sheet
            new_start: load.new_start,
            hidden_miles: load.Hidden_Miles,
            moved_monday: load.moved_monday,
            driver_gross_without_moved: load.driver_gross_without_moved,
            wellness_fail: load.wellness_fail,

            // Keep any other columns from the sheet
            ...load 
        }));
        
        // --- FIX: Store the processed data in all necessary state locations ---
        appState.profiles.liveData = mappedData;
        appState.loads.data = mappedData; // Also update the main loads data
        appState.loads.spreadsheetTimezone = result.spreadsheetTimezone || 'UTC';


    } catch (e) {
        console.error("Error fetching Profiles data:", e);
        // Optionally set an error state for the profiles view
        appState.profiles.error = "Failed to load live data for profiles.";
    }
}
