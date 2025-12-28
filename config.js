// Initialize Supabase Client
const SUPABASE_URL = 'https://wzcjyuflxywvlgzhylhd.supabase.co'; // Replace with your actual URL from Supabase Settings
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6Y2p5dWZseHl3dmxnemh5bGhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4OTAyMjEsImV4cCI6MjA3OTQ2NjIyMX0.5-1vtpJFXmJPUKXR3O__6ov7VaFES4QVzcFeOHC-l9g';    // Replace with your actual Anon Key from Supabase Settings
export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
// ** IMPORTANT: THIS FILE USES A SECURE PROXY **

// ⬇️ DispatchHub Cloudflare Worker URL ⬇️
const API_BASE_URL = "https://dispatch-hub.mihailo-cfc.workers.dev/api/";

// The URL for your new Authentication and User Management script
export const AUTH_APPS_SCRIPT_URL = API_BASE_URL + "AUTH_APPS_SCRIPT_URL";

// NEW: This URL is for the global settings
export const SETTINGS_APPS_SCRIPT_URL = API_BASE_URL + "SETTINGS_APPS_SCRIPT_URL";

// The array URLs have been broken down into individual, unique endpoints. This is for Rankings. Pre-calculation from rankings g-sheet
export const RANKINGS_APPS_SCRIPT_URLS = [
    API_BASE_URL + "RANKINGS_URL_0",
    API_BASE_URL + "RANKINGS_URL_1",
    API_BASE_URL + "RANKINGS_URL_2"
];

// This one is for overdue loads.
export const OVERDUE_LOADS_URL = API_BASE_URL + "OVERDUE_LOADS_URL";

// This one is for loads.
export const LOADS_APPS_SCRIPT_URLS = [
    API_BASE_URL + "LOADS_URL_0",
    API_BASE_URL + "LOADS_URL_1",
    API_BASE_URL + "LOADS_URL_2",
    API_BASE_URL + "LOADS_URL_3",
    API_BASE_URL + "LOADS_URL_4"
];

// This one is for stubs in fleet health
export const HISTORICAL_STUBS_URLS = [
    API_BASE_URL + "STUBS_URL_0",
    API_BASE_URL + "STUBS_URL_1",
    API_BASE_URL + "STUBS_URL_2",
];

export const DRIVER_COUNT_LIVE_URL = API_BASE_URL + "DRIVER_COUNT_LIVE_URL";

export const CONTRACT_STATUS_URL = API_BASE_URL + "CONTRACT_STATUS_URL";

export const TUESDAY_OPEN_URL = API_BASE_URL + "TUESDAY_OPEN_URL";

export const MISSING_PAPERWORK_URL = API_BASE_URL + "MISSING_PAPERWORK_URL";

export const CALCULATOR_ACTIVITY_URL = API_BASE_URL + "CALCULATOR_ACTIVITY_URL";

export const TRAILER_DROPS_URL = API_BASE_URL + "TRAILER_DROPS_URL";
export const RC_ENTRY_URL = API_BASE_URL + "RC_ENTRY_URL"; // Replace with your actual deployment URL

// --- The rest of your config file remains the same ---
export const coreMetrics = [
    { id: 'pNet', label: 'Net', unit: '%', lowerIsWorse: true, color: 'text-yellow-100', color4W: 'text-green-100' },
    { id: 'pDriverGross', label: 'Driver Gross', unit: '%', lowerIsWorse: true, color: 'text-yellow-100', color4W: 'text-green-100' },
    { id: 'pMargin', label: 'Margin', unit: '%', lowerIsWorse: true, color: 'text-yellow-100', color4W: 'text-green-100' },
    { id: 'pMileage', label: 'Mileage', unit: '%', lowerIsWorse: true, color: 'text-yellow-100', color4W: 'text-green-100' },
    { id: 'rpmAll', label: 'RPM (All)', unit: '$', lowerIsWorse: true, color: 'text-yellow-100', color4W: 'text-green-100' },
    { id: 'pMainCriteriaNetDriverMargin', label: 'Driver Happiness', unit: '%', lowerIsWorse: true, color: 'text-orange-300', color4W: 'text-purple-300' },
    { id: 'pMainCriteria2CashFlow', label: 'Company Happiness', unit: '%', lowerIsWorse: true, color: 'text-orange-300', color4W: 'text-purple-300' },
    { id: 'mainCriteria', label: 'Criteria', unit: '%', lowerIsWorse: true, color: 'text-orange-500', color4W: 'text-purple-500' },

    { id: 'pMargin_dollar', label: 'Margin', unit: '$', lowerIsWorse: true, color: 'text-yellow-100', color4W: 'text-green-100' },
    { id: 'pAll_miles', label: 'All Miles', unit: '', lowerIsWorse: true, color: 'text-yellow-100', color4W: 'text-green-100' },
    { id: 'pDriver_gross', label: 'Driver Gross', unit: '$', lowerIsWorse: true, color: 'text-yellow-100', color4W: 'text-green-100' },
    { id: 'pLoaded_miles', label: 'Loaded Miles', unit: '', lowerIsWorse: true, color: 'text-yellow-100', color4W: 'text-green-100' },

    { id: 'pEstimated_fuel', label: 'Est. Fuel', unit: '$', lowerIsWorse: false, color: 'text-yellow-100', color4W: 'text-green-100' },
    { id: 'pEstimated_tolls', label: 'Est. Tolls', unit: '$', lowerIsWorse: false, color: 'text-yellow-100', color4W: 'text-green-100' },

    { id: 'pDriver_rpm', label: 'Driver RPM', unit: '$', lowerIsWorse: true, color: 'text-yellow-100', color4W: 'text-green-100' },
    { id: 'pDepreciation', label: 'Depreciation', unit: '$', lowerIsWorse: false, color: 'text-yellow-100', color4W: 'text-green-100' },
    { id: 'pTotal_gross', label: 'Total Gross', unit: '$', lowerIsWorse: true, color: 'text-yellow-100', color4W: 'text-green-100' },
    { id: 'pEstimated_net', label: 'Estimated Net', unit: '$', lowerIsWorse: true, color: 'text-yellow-100', color4W: 'text-green-100' }, // Added Estimated Net
];

export const trophySvg = {
    gold: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="gold" stroke="gold" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="feather feather-award inline-block ml-1 align-middle"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>`,
    silver: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="silver" stroke="silver" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="feather feather-award inline-block ml-1 align-middle"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>`,
    bronze: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="#CD7F32" stroke="#CD7F32" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="feather feather-award inline-block ml-1 align-middle"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>`
};

export const generateAllColumns = () => {
    // ... (This function remains unchanged)
    const defaultVisibleColumnIds = new Set([
        'rank', 'entityName', 'dispatcherTeam', 'numDrivers', 'numDispatchers',
        'pNet_current', 'pNet_4wkAvg',
        'pDriverGross_current', 'pDriverGross_4wkAvg',
        'pMargin_current', 'pMargin_4wkAvg',
        'pMainCriteriaNetDriverMargin_current', 'pMainCriteriaNetDriverMargin_4wkAvg',
        'pMainCriteria2CashFlow_current', 'pMainCriteria2CashFlow_4wkAvg',
        'rpmAll_current', 'rpmAll_4wkAvg',
        'mainCriteria_current', 'mainCriteria_4wkAvg'
    ]);


   let columns = [
       { id: 'rank', label: 'Rank', type: 'number', width: 'w-12', isHeatmapCandidate: false },
       { id: 'entityName', label: 'Dispatcher Name', type: 'string', width: 'w-32', isHeatmapCandidate: false }, // Generic name
       { id: 'dispatcherTeam', label: 'Team', type: 'string', width: 'w-24', isHeatmapCandidate: false },
       { id: 'numDispatchers', label: 'Dispatchers', type: 'number', width: 'w-24', isHeatmapCandidate: false }, // New column
       { id: 'numDrivers', label: 'Drivers', type: 'number', width: 'w-20', isHeatmapCandidate: false },
       { id: 'numDrivers_4wkAvg', label: 'Drivers (4W)', type: 'number', width: 'w-28', decimalPlaces: 1, isHeatmapCandidate: false },
       { id: 'numOOs', label: 'OO', type: 'number', width: 'w-16', isHeatmapCandidate: false },
       { id: 'numOOs_4wkAvg', label: 'OO (4W)', type: 'number', width: 'w-24', decimalPlaces: 1, isHeatmapCandidate: false },
       { id: 'numLOOs', label: 'LOO', type: 'number', width: 'w-16', isHeatmapCandidate: false },
       { id: 'numLOOs_4wkAvg', label: 'LOO (4W)', type: 'number', width: 'w-24', decimalPlaces: 1, isHeatmapCandidate: false },
       { id: 'weeksIncluded_4wkAvg', label: 'Weeks Included', type: 'number', width: 'w-32', isHeatmapCandidate: false },
       
       // --- New Regional Movement Columns ---
       // Using 'text-yellow-100' for 1W and 'text-green-100' for 4W to match the Margin style pattern
       { id: 'region_northeast_1wk', label: 'NE (1W)', type: 'number', unit: '%', width: 'w-20', isHeatmapCandidate: false, defaultVisible: false, color: 'text-yellow-100', tooltip: 'ME, NH, MA, RI, CT, VT, NY, NJ, PA, DE, MD, DC, WV, VA' },
       { id: 'region_northeast_4wk', label: 'NE (4W)', type: 'number', unit: '%', width: 'w-20', isHeatmapCandidate: false, defaultVisible: false, color: 'text-green-100', tooltip: 'ME, NH, MA, RI, CT, VT, NY, NJ, PA, DE, MD, DC, WV, VA' },
       
       { id: 'region_southeast_1wk', label: 'SE (1W)', type: 'number', unit: '%', width: 'w-20', isHeatmapCandidate: false, defaultVisible: false, color: 'text-yellow-100', tooltip: 'NC, SC, GA, FL, AL, MS, TN' },
       { id: 'region_southeast_4wk', label: 'SE (4W)', type: 'number', unit: '%', width: 'w-20', isHeatmapCandidate: false, defaultVisible: false, color: 'text-green-100', tooltip: 'NC, SC, GA, FL, AL, MS, TN' },
       
       { id: 'region_midwest_1wk', label: 'MidW (1W)', type: 'number', unit: '%', width: 'w-20', isHeatmapCandidate: false, defaultVisible: false, color: 'text-yellow-100', tooltip: 'MI, OH, IN, IL, WI, MN, IA, MO, KY, NE, KS' },
       { id: 'region_midwest_4wk', label: 'MidW (4W)', type: 'number', unit: '%', width: 'w-20', isHeatmapCandidate: false, defaultVisible: false, color: 'text-green-100', tooltip: 'MI, OH, IN, IL, WI, MN, IA, MO, KY, NE, KS' },
       
       { id: 'region_south_1wk', label: 'South (1W)', type: 'number', unit: '%', width: 'w-20', isHeatmapCandidate: false, defaultVisible: false, color: 'text-yellow-100', tooltip: 'AR, LA, OK, TX, NM' },
       { id: 'region_south_4wk', label: 'South (4W)', type: 'number', unit: '%', width: 'w-20', isHeatmapCandidate: false, defaultVisible: false, color: 'text-green-100', tooltip: 'AR, LA, OK, TX, NM' },
       
       { id: 'region_west_1wk', label: 'West (1W)', type: 'number', unit: '%', width: 'w-20', isHeatmapCandidate: false, defaultVisible: false, color: 'text-yellow-100', tooltip: 'CA, OR, WA, NV, AZ' },
       { id: 'region_west_4wk', label: 'West (4W)', type: 'number', unit: '%', width: 'w-20', isHeatmapCandidate: false, defaultVisible: false, color: 'text-green-100', tooltip: 'CA, OR, WA, NV, AZ' },
       
       { id: 'region_mountain_west_1wk', label: 'MtnW (1W)', type: 'number', unit: '%', width: 'w-20', isHeatmapCandidate: false, defaultVisible: false, color: 'text-yellow-100', tooltip: 'CO, UT, ID, WY, MT, SD, ND' },
       { id: 'region_mountain_west_4wk', label: 'MtnW (4W)', type: 'number', unit: '%', width: 'w-20', isHeatmapCandidate: false, defaultVisible: false, color: 'text-green-100', tooltip: 'CO, UT, ID, WY, MT, SD, ND' },
   ];

   coreMetrics.forEach(metric => {
       const labelWithUnit = metric.unit === '$' ? `${metric.label} ($)` : metric.label;
       columns.push({
           id: `${metric.id}_current`,
           label: labelWithUnit,
           type: 'number',
           unit: metric.unit,
           lowerIsWorse: metric.lowerIsWorse,
           color: metric.color,
           width: metric.width || 'w-28',
           isHeatmapCandidate: true // Default for core metrics
       });
       columns.push({
           id: `${metric.id}_4wkAvg`,
           label: `${labelWithUnit} (4W)`,
           type: 'number',
           unit: metric.unit,
           lowerIsWorse: metric.lowerIsWorse,
           color: metric.color4W,
           width: metric.width || 'w-28',
           isHeatmapCandidate: true // Default for core metrics (4W avg)
       });
   });

   // Handle the '1w 4w average changes' columns, they should not be heatmap candidates
   columns.push(
       { id: 'mainCriteria_1wkChange', label: '1W Crit. Chg.', type: 'number', unit: '%', lowerIsWorse: false, width: 'w-36', color: 'text-yellow-100', isHeatmapCandidate: false },
       { id: 'mainCriteria_1wkChange_4wksAgo', label: '1W Crit. Chg. (vs 4W Ago)', type: 'number', unit: '%', lowerIsWorse: false, width: 'w-40', color: 'text-yellow-100', isHeatmapCandidate: false },
       { id: 'mainCriteria_4wkAvg_1wkChange', label: '4W Avg. Crit. Chg.', type: 'number', unit: '%', lowerIsWorse: false, width: 'w-40', color: 'text-green-100', isHeatmapCandidate: false },
       { id: 'mainCriteria_4wkAvg_4wkChange', label: '4W Avg. Crit. Chg. (vs 4W Ago)', type: 'number', unit: '%', lowerIsWorse: false, width: 'w-40', color: 'text-green-100', isHeatmapCandidate: false }
   );
   
   columns.forEach(col => {
       // Adjust default visibility for generic 'entityName'
       if (col.id === 'entityName') {
           col.defaultVisible = defaultVisibleColumnIds.has('entityName');
       } else {
           col.defaultVisible = defaultVisibleColumnIds.has(col.id);
       }
   });

   return columns;
};