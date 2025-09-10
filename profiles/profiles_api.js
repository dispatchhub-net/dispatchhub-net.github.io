import { LOADS_APPS_SCRIPT_URL } from '../config.js';
import { appState } from '../state.js';
import { LZW } from '../utils.js';

export async function fetchProfileData() {
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

        let finalData;

        if (result.compressed) {
            // 1. Decode the Base64 string
            const compressedString = atob(result.data);
            // 2. Convert the string back into an array of numbers
            const compressedArray = compressedString.split(',').map(Number);
            // 3. Decompress the array
            const decompressedString = LZW.decompress(compressedArray);
            
            if (decompressedString === null) {
                throw new Error("Failed to decompress data from the server. The data might be corrupted or in an unexpected format.");
            }

            finalData = JSON.parse(decompressedString);
        } else {
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
