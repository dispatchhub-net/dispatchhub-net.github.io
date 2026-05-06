// from 1. DISP TEST/profiles/profiles_api.js

// 1. Make sure ALL URLs are imported here!
import { LOADS_APPS_SCRIPT_URLS, TUESDAY_OPEN_URL, MISSING_PAPERWORK_URL, CALCULATOR_ACTIVITY_URL, TRAILER_DROPS_URL, RC_ENTRY_URL } from '../config.js'; 
import { appState } from '../state.js';
import { LZW, fetchWithRetry } from '../utils.js';

export async function fetchProfileData() {
    try {
        // 2. Define the promises BEFORE using them
        const tuesdayPromise = TUESDAY_OPEN_URL ? fetchWithRetry(TUESDAY_OPEN_URL).then(res => res.json()) : Promise.resolve([]);
        const paperworkPromise = MISSING_PAPERWORK_URL ? fetchWithRetry(MISSING_PAPERWORK_URL).then(res => res.json()) : Promise.resolve([]);
        const activityPromise = CALCULATOR_ACTIVITY_URL ? fetchWithRetry(CALCULATOR_ACTIVITY_URL).then(res => res.json()) : Promise.resolve([]);
        const dropsPromise = TRAILER_DROPS_URL ? fetchWithRetry(TRAILER_DROPS_URL).then(res => res.json()) : Promise.resolve([]);
        const rcEntryPromise = RC_ENTRY_URL ? fetchWithRetry(RC_ENTRY_URL).then(res => res.json()) : Promise.resolve([]);

        const fetchPromises = LOADS_APPS_SCRIPT_URLS.map(url => 
            fetchWithRetry(url).then(res => res.json())
        );

        // 3. Await all promises together
        const [tuesdayResult, paperworkResult, activityResult, dropsResult, rcEntryResult, ...results] = await Promise.all([tuesdayPromise, paperworkPromise, activityPromise, dropsPromise, rcEntryPromise, ...fetchPromises]);

        // 0. Handle RC Entry Data
        if (rcEntryResult && !rcEntryResult.error) {
             if (Array.isArray(rcEntryResult)) {
                appState.profiles.rcEntryData = rcEntryResult;
            } else if (rcEntryResult.data && Array.isArray(rcEntryResult.data)) {
                appState.profiles.rcEntryData = rcEntryResult.data;
            } else {
                appState.profiles.rcEntryData = [];
            }
        } else {
            console.error("Error fetching RC Entry Data:", rcEntryResult?.error);
            appState.profiles.rcEntryData = [];
        }

        // 0. Handle Trailer Drops Data
        if (dropsResult && !dropsResult.error) {
            if (Array.isArray(dropsResult)) {
                appState.profiles.trailerDropsData = dropsResult;
            } else if (dropsResult.data && Array.isArray(dropsResult.data)) {
                appState.profiles.trailerDropsData = dropsResult.data;
            } else {
                appState.profiles.trailerDropsData = [];
            }
        } else {
            console.error("Error fetching Trailer Drops Data:", dropsResult?.error);
            appState.profiles.trailerDropsData = [];
        }

        // 0. Handle Calculator Activity Data
        if (activityResult && !activityResult.error) {
            if (Array.isArray(activityResult)) {
                appState.profiles.calculatorActivityData = activityResult;
            } else if (activityResult.data && Array.isArray(activityResult.data)) {
                appState.profiles.calculatorActivityData = activityResult.data;
            } else {
                appState.profiles.calculatorActivityData = [];
            }
        } else {
            console.error("Error fetching Calculator Activity Data:", activityResult?.error);
            appState.profiles.calculatorActivityData = [];
        }

        // 3. Handle Tuesday Open Data (Fixing the .filter error)
        if (tuesdayResult && !tuesdayResult.error) {
            if (Array.isArray(tuesdayResult)) {
                appState.profiles.tuesdayOpenData = tuesdayResult;
            } else if (tuesdayResult.data && Array.isArray(tuesdayResult.data)) {
                appState.profiles.tuesdayOpenData = tuesdayResult.data; // <--- This extracts the array
            } else {
                appState.profiles.tuesdayOpenData = [];
            }
        } else {
            console.error("Error fetching Tuesday Open Data:", tuesdayResult?.error);
            appState.profiles.tuesdayOpenData = [];
        }

        // 4. Handle Missing Paperwork Data
        if (paperworkResult && !paperworkResult.error) {
            if (Array.isArray(paperworkResult)) {
                appState.profiles.missingPaperworkData = paperworkResult;
            } else if (paperworkResult.data && Array.isArray(paperworkResult.data)) {
                appState.profiles.missingPaperworkData = paperworkResult.data; // <--- This extracts the array
            } else {
                appState.profiles.missingPaperworkData = [];
            }
        } else {
            console.error("Error fetching Missing Paperwork Data:", paperworkResult?.error);
            appState.profiles.missingPaperworkData = [];
        }

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
        throw e; 
    }
}