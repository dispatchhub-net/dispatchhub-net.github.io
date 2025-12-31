import { supabase } from '../config.js';
import { appState } from '../state.js';

const REGIONS = {
    'NORTHEAST': ['ME', 'NH', 'MA', 'RI', 'CT', 'VT', 'NY', 'NJ', 'PA', 'DE', 'MD', 'DC', 'WV', 'VA'],
    'SOUTHEAST': ['NC', 'SC', 'GA', 'FL', 'AL', 'MS', 'TN'],
    'MIDWEST': ['MI', 'OH', 'IN', 'IL', 'WI', 'MN', 'IA', 'MO', 'KY', 'NE', 'KS'],
    'SOUTH': ['AR', 'LA', 'OK', 'TX', 'NM'],
    'WEST': ['CA', 'OR', 'WA', 'NV', 'AZ'],
    'MOUNTAIN_WEST': ['CO', 'UT', 'ID', 'WY', 'MT', 'SD', 'ND']
};

export const fetchHallOfFame = async () => {
    const { data, error } = await supabase.from('hall_of_fame').select('*');
    if (error) {
        console.error("Error fetching Hall of Fame:", error);
        return {};
    }
    const recordsMap = {};
    data.forEach(r => recordsMap[r.record_key] = r);
    appState.hallOfFameData = recordsMap;
    return recordsMap;
};

export const updateHallOfFameFromSession = async () => {
    if (!appState.loads.historicalStubsData || !appState.profiles.liveData) return;
    
    // Ensure we have the latest baseline
    let existingRecords = appState.hallOfFameData || {};
    if (Object.keys(existingRecords).length === 0) {
        existingRecords = await fetchHallOfFame();
    }
    
    // --- 0. SANITIZE: Purge specific bad records from memory ---
    // This removes the "Current High Score" if it matches the bad data, 
    // forcing the system to find the next highest valid record.
    const badDataList = [
        { name: 'Akim Howell', date: '2024-08-15' },
        { name: 'Aaron Jamison', date: '2025-03-06' }
    ];

    Object.keys(existingRecords).forEach(key => {
        const rec = existingRecords[key];
        const isBad = badDataList.some(bad => 
            rec.holder_name === bad.name && 
            (rec.record_date || '').includes(bad.date)
        );
        
        if (isBad) {
            console.log(`[Hall of Fame] 🗑️ Purging invalid record: ${key} held by ${rec.holder_name}`);
            delete existingRecords[key]; // Remove from local calculation baseline
            delete appState.hallOfFameData[key]; // Remove from app state
            // We intentionally don't delete from DB here; the new valid record will overwrite it via upsert below.
        }
    });

    const updates = [];
    const updatesMap = {}; 

    const checkRecord = (key, value, holder, dispatcher, date, details = {}) => {
        if (!holder || !dispatcher || !date || value === null || isNaN(value)) return; 

        const existing = updatesMap[key] || existingRecords[key];
        const prevValue = existing ? parseFloat(existing.record_value) : 0;

        if (!existing || value > prevValue) {
            const newRecord = {
                record_key: key,
                record_value: value,
                holder_name: holder,
                dispatcher_name: dispatcher,
                record_date: date,
                details: details,
                updated_at: new Date().toISOString()
            };
            
            updates.push(newRecord);
            updatesMap[key] = newRecord; 
            appState.hallOfFameData[key] = newRecord; 
        }
    };

    // --- 1. PROCESS STUBS (Driver & Weekly Records) ---
    const stubs = appState.loads.historicalStubsData;
    const weeklyAggregates = {}; 

    stubs.forEach(stub => {
        const type = (stub.contract_type || stub.contract || 'LOO').toUpperCase() === 'OO' ? 'OO' : 'LOO';
        const driver = stub.driver_name || stub.driverName || stub.driver;
        const disp = stub.stub_dispatcher || stub.dispatcherName || stub.dispatcher;
        
        let date = null;
        if (stub.pay_date) date = new Date(stub.pay_date).toISOString().split('T')[0];
        else if (stub.date) date = new Date(stub.date).toISOString().split('T')[0];
        
        if (!disp || !date || !driver) return;

        // --- EXCLUSION: Skip Bad Data Records in Calculation ---
        if (driver === 'Akim Howell' && date === '2024-08-15') return;
        if (driver === 'Aaron Jamison' && date === '2025-03-06') return;

        const dGross = parseFloat(stub.driver_gross || stub.pDriver_gross || 0);
        const margin = parseFloat(stub.margin || stub.margin_dollar || stub.pMargin_dollar || 0);
        const tGross = dGross + margin; 
        const miles = parseFloat(stub.total_miles || stub.all_miles || stub.pAll_miles || 0);
        const loadedMiles = parseFloat(stub.loaded_miles || stub.pLoaded_miles || 0);
        
        if (tGross === 0 && miles === 0) return;

        // Per Driver Records
        checkRecord(`${type}_DRIVER_GROSS`, dGross, disp, driver, date);
        checkRecord(`${type}_TOTAL_GROSS`, tGross, disp, driver, date);
        checkRecord(`${type}_MARGIN`, margin, disp, driver, date);
        checkRecord(`${type}_MILEAGE`, miles, disp, driver, date);

        if (loadedMiles > 400) {
            checkRecord(`${type}_RPM_LOADED`, tGross / loadedMiles, disp, driver, date, { miles: loadedMiles });
        }
        if (miles >= 2000) {
            checkRecord(`${type}_RPM_ALL`, tGross / miles, disp, driver, date, { miles: miles });
        }

        // Aggregate for Weekly Records (Group by Dispatcher + Date)
        const aggKey = `${disp}|${date}`;
        if (!weeklyAggregates[aggKey]) weeklyAggregates[aggKey] = { OO: createAgg(), LOO: createAgg() };
        const agg = weeklyAggregates[aggKey][type];
        agg.gross += tGross;
        agg.margin += margin;
        agg.miles += miles;
        agg.loadedMiles += loadedMiles;
    });

    function createAgg() { return { gross: 0, margin: 0, miles: 0, loadedMiles: 0 }; }

    Object.entries(weeklyAggregates).forEach(([key, types]) => {
        const [dispatcherName, date] = key.split('|');
        ['OO', 'LOO'].forEach(type => {
            const data = types[type];
            if (data.miles === 0) return;
            
            checkRecord(`${type}_WEEKLY_GROSS`, data.gross, dispatcherName, dispatcherName, date);
            checkRecord(`${type}_WEEKLY_MARGIN`, data.margin, dispatcherName, dispatcherName, date);
            checkRecord(`${type}_WEEKLY_MILEAGE`, data.miles, dispatcherName, dispatcherName, date);
            
            if (data.miles >= 2000) {
                checkRecord(`${type}_WEEKLY_RPM_ALL`, data.gross / data.miles, dispatcherName, dispatcherName, date);
            }
        });
    });

    // --- 2. PROCESS LOADS (Per Load & Regional) ---
    const loads = appState.loads.data || [];
    
    const getRegion = (state) => {
        for (const [region, states] of Object.entries(REGIONS)) {
            if (states.includes(state)) return region;
        }
        return null;
    };
    
    const getState = (loc) => {
        if (!loc) return null;
        const match = loc.match(/,\s*([A-Z]{2})$/);
        return match ? match[1] : null;
    };

    // Define allowed statuses for Hall of Fame eligibility
    const validHofStatuses = [
        'Billed',
        'Billed - Pending Acc.',
        'Delivered',
        'Delivered - Pending',
        'Open Balance',
        'Paid',
        'Pending to Bill'
    ];

    loads.forEach(load => {
        const driver = load.driver;
        const disp = load.dispatcher;
        const doDate = load.do_date;
        
        if (!driver || !disp || !doDate) return;

        // Filter out loads that are not in a "closed" or valid status
        if (!validHofStatuses.includes(load.status)) return;

        const type = (load.contract_type || load.contract || 'LOO').toUpperCase() === 'OO' ? 'OO' : 'LOO';
        const date = doDate.split('T')[0];
        
        const price = parseFloat(load.price_total || load.price) || 0;
        const cut = parseFloat(load.cut) || 0;
        const totalRate = price;
        
        checkRecord(`${type}_LOAD_RATE`, totalRate, disp, driver, date, { loadId: load.id, origin: load.pu_location, dest: load.do_location });
        checkRecord(`${type}_LOAD_MARGIN`, cut, disp, driver, date, { loadId: load.id });

        const state = getState(load.pu_location);
        if (state) {
            const region = getRegion(state);
            if (region) {
                checkRecord(`${type}_REGION_RATE_${region}`, totalRate, disp, driver, date, { loadId: load.id, region: region });
                checkRecord(`${type}_REGION_MARGIN_${region}`, cut, disp, driver, date, { loadId: load.id, region: region });
            }
        }
    });

    // --- 3. Batch Update Supabase ---
    const finalUpdates = Object.values(updatesMap);

    if (finalUpdates.length > 0) {
        console.log(`[Hall of Fame] Upserting ${finalUpdates.length} new records...`);
        await supabase.from('hall_of_fame').upsert(finalUpdates, { onConflict: 'record_key' });
    }
};

export const checkForNewRecords = () => {
    const localData = localStorage.getItem('dispatcherHub_knownRecords');
    const currentRecords = appState.hallOfFameData;
    const knownRecords = localData ? JSON.parse(localData) : {};
    
    let newKeys = [];
    // If no local data exists, it's the very first time. We don't flag specific records as "new" to avoid overwhelming the user, just show the welcome popup.
    const isFirstTime = !localData; 

    if (!isFirstTime) {
        Object.keys(currentRecords).forEach(key => {
            const record = currentRecords[key];
            const knownRec = knownRecords[key];

            // If we've never seen this record key before, OR the value/timestamp has changed
            if (!knownRec) {
                newKeys.push(key);
            } else {
                // Use updated_at if available, otherwise fallback to value check
                if (record.updated_at && knownRec.updated_at) {
                    if (new Date(record.updated_at) > new Date(knownRec.updated_at)) {
                        newKeys.push(key);
                    }
                } else if (parseFloat(record.record_value) > parseFloat(knownRec.record_value)) {
                    newKeys.push(key);
                }
            }
        });
    }

    appState.hallOfFameUpdates.newRecordKeys = newKeys;
    appState.hallOfFameUpdates.isFirstTime = isFirstTime;
    appState.hallOfFameUpdates.hasUnseenChanges = isFirstTime || newKeys.length > 0;
};

export const commitSeenRecords = () => {
    // Save current state as "Known"
    const currentRecords = appState.hallOfFameData;
    localStorage.setItem('dispatcherHub_knownRecords', JSON.stringify(currentRecords));
    
    // Reset state
    appState.hallOfFameUpdates.newRecordKeys = [];
    appState.hallOfFameUpdates.isFirstTime = false;
    appState.hallOfFameUpdates.hasUnseenChanges = false;
    
    // Update UI button immediately
    const btn = document.getElementById('hall-of-fame-btn');
    if (btn) btn.classList.remove('animate-glow-gold');
};
