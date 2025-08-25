// profiles/profiles_ui.js
import { appState } from '../state.js';

// --- CONFIGURATION FOR DISPATCH TABLE ---
const dispatchTableColumns = [
    { id: 'name', label: 'Dispatcher', type: 'string' },
    { id: 'company', label: 'Company', type: 'string' },
    { id: 'allTrucks', label: 'All Trucks', type: 'number' },
    { id: 'ooTrucks', label: 'OO Trucks', type: 'number' },
    { id: 'looTrucks', label: 'LOO Trucks', type: 'number' },
    { id: 'dryvan', label: 'Dryvan', type: 'number' },
    { id: 'reefer', label: 'Reefer', type: 'number' },
    { id: 'flatbed', label: 'Flatbed', type: 'number' },
    { id: 'rank1w', label: '1W Rank', type: 'number' },
    { id: 'rank4w', label: '4W Rank', type: 'number' },
    { id: 'trend1w', label: '1W Trend', type: 'sparkline' },
    { id: 'trend4w', label: '4W Trend', type: 'sparkline' },
    { id: 'goodMoves', label: 'Good Moves', type: 'number' },
    { id: 'badMoves', label: 'Bad Moves', type: 'number' },
    { id: 'hiddenMiles', label: 'Hidden Miles', type: 'number' },
    { id: 'lowRpm', label: 'Low RPM', type: 'number' },
    { id: 'newStarts', label: 'New Starts', type: 'number' },
    { id: 'wellness', label: 'Wellness %', type: 'percentage' }
];

// --- DUMMY DATA (Updated with new fields) ---
const dummyProfileData = {
    teamName: "SMT",
    companies: ["SMT", "AmeriGo", "FleetForce"], // List of companies in the team
    kpis: {
        totalGross: 576460, prevWeekTotalGross: 550200,
        teamRpm: 2.03, prevWeekTeamRpm: 2.05,
        teamMargin: 36536, prevWeekTeamMargin: 38000,
        activeTrucks: 89, prevWeekActiveTrucks: 85,
        dispatchers: 17, prevWeekDispatchers: 15, // Updated count
        ooCount: 65, looCount: 24,
        dryvanCount: 50, reeferCount: 30, flatbedCount: 9,
        medianDropRisk: 45,
        prevWeekMedianDropRisk: 50,
        // Per-company KPIs
        SMT: { totalGross: 450000, prevWeekTotalGross: 430000, teamRpm: 2.10, prevWeekTeamRpm: 2.08 },
        AmeriGo: { totalGross: 100000, prevWeekTotalGross: 105000, teamRpm: 1.95, prevWeekTeamRpm: 1.98 },
        FleetForce: { totalGross: 26460, prevWeekTotalGross: 15200, teamRpm: 1.80, prevWeekTeamRpm: 1.75 },
    },
    dispatchers: [
        { id: 1, name: "John Doe", company: "SMT", allTrucks: 18, ooTrucks: 12, looTrucks: 6, dryvan: 10, reefer: 8, flatbed: 0, rank1w: 3, rank4w: 5, trend1w: [0.58, 0.62], trend4w: [0.55, 0.6, 0.58, 0.62], goodMoves: 5, badMoves: 1, hiddenMiles: 0, lowRpm: 2, newStarts: 1, wellness: 92 },
        { id: 2, name: "Jane Smith", company: "SMT", allTrucks: 22, ooTrucks: 18, looTrucks: 4, dryvan: 15, reefer: 5, flatbed: 2, rank1w: 1, rank4w: 1, trend1w: [0.75, 0.72], trend4w: [0.68, 0.7, 0.75, 0.72], goodMoves: 8, badMoves: 0, hiddenMiles: 1, lowRpm: 1, newStarts: 0, wellness: 98 },
        { id: 3, name: "Mike Johnson", company: "AmeriGo", allTrucks: 15, ooTrucks: 10, looTrucks: 5, dryvan: 5, reefer: 5, flatbed: 5, rank1w: 8, rank4w: 7, trend1w: [0.46, 0.5], trend4w: [0.45, 0.48, 0.46, 0.5], goodMoves: 3, badMoves: 2, hiddenMiles: 2, lowRpm: 4, newStarts: 2, wellness: 85 },
        { id: 4, name: "Emily White", company: "SMT", allTrucks: 19, ooTrucks: 15, looTrucks: 4, dryvan: 18, reefer: 1, flatbed: 0, rank1w: 5, rank4w: 4, trend1w: [0.65, 0.64], trend4w: [0.59, 0.62, 0.65, 0.64], goodMoves: 6, badMoves: 1, hiddenMiles: 0, lowRpm: 1, newStarts: 0, wellness: 95 },
        { id: 5, name: "Chris Green", company: "AmeriGo", allTrucks: 15, ooTrucks: 10, looTrucks: 5, dryvan: 2, reefer: 11, flatbed: 2, rank1w: 12, rank4w: 15, trend1w: [0.3, 0.31], trend4w: [0.35, 0.32, 0.3, 0.31], goodMoves: 2, badMoves: 4, hiddenMiles: 3, lowRpm: 6, newStarts: 3, wellness: 78 },
        { id: 6, name: "Sarah Connor", company: "SMT", allTrucks: 12, ooTrucks: 9, looTrucks: 3, dryvan: 12, reefer: 0, flatbed: 0, rank1w: 7, rank4w: 9, trend1w: [0.50, 0.52], trend4w: [0.48, 0.49, 0.50, 0.52], goodMoves: 4, badMoves: 1, hiddenMiles: 1, lowRpm: 3, newStarts: 0, wellness: 90 },
        { id: 7, name: "Kyle Reese", company: "FleetForce", allTrucks: 8, ooTrucks: 8, looTrucks: 0, dryvan: 0, reefer: 0, flatbed: 8, rank1w: 15, rank4w: 12, trend1w: [0.42, 0.40], trend4w: [0.45, 0.44, 0.42, 0.40], goodMoves: 1, badMoves: 3, hiddenMiles: 2, lowRpm: 5, newStarts: 1, wellness: 81 },
        { id: 8, name: "Laura Palmer", company: "SMT", allTrucks: 14, ooTrucks: 11, looTrucks: 3, dryvan: 14, reefer: 0, flatbed: 0, rank1w: 6, rank4w: 6, trend1w: [0.55, 0.57], trend4w: [0.53, 0.54, 0.55, 0.57], goodMoves: 5, badMoves: 0, hiddenMiles: 0, lowRpm: 2, newStarts: 0, wellness: 94 },
        { id: 9, name: "Dale Cooper", company: "SMT", allTrucks: 16, ooTrucks: 13, looTrucks: 3, dryvan: 8, reefer: 8, flatbed: 0, rank1w: 4, rank4w: 3, trend1w: [0.60, 0.63], trend4w: [0.58, 0.59, 0.60, 0.63], goodMoves: 7, badMoves: 1, hiddenMiles: 0, lowRpm: 1, newStarts: 0, wellness: 96 },
        { id: 10, name: "Walter White", company: "AmeriGo", allTrucks: 11, ooTrucks: 7, looTrucks: 4, dryvan: 3, reefer: 8, flatbed: 0, rank1w: 10, rank4w: 11, trend1w: [0.40, 0.42], trend4w: [0.38, 0.39, 0.40, 0.42], goodMoves: 2, badMoves: 3, hiddenMiles: 1, lowRpm: 4, newStarts: 1, wellness: 82 },
        { id: 11, name: "Jesse Pinkman", company: "AmeriGo", allTrucks: 9, ooTrucks: 5, looTrucks: 4, dryvan: 9, reefer: 0, flatbed: 0, rank1w: 13, rank4w: 14, trend1w: [0.35, 0.33], trend4w: [0.37, 0.36, 0.35, 0.33], goodMoves: 1, badMoves: 4, hiddenMiles: 2, lowRpm: 5, newStarts: 2, wellness: 75 },
        { id: 12, name: "Tony Soprano", company: "FleetForce", allTrucks: 10, ooTrucks: 10, looTrucks: 0, dryvan: 5, reefer: 5, flatbed: 0, rank1w: 9, rank4w: 8, trend1w: [0.48, 0.50], trend4w: [0.46, 0.47, 0.48, 0.50], goodMoves: 3, badMoves: 2, hiddenMiles: 1, lowRpm: 3, newStarts: 0, wellness: 88 },
        { id: 13, name: "Don Draper", company: "SMT", allTrucks: 13, ooTrucks: 10, looTrucks: 3, dryvan: 13, reefer: 0, flatbed: 0, rank1w: 2, rank4w: 2, trend1w: [0.65, 0.68], trend4w: [0.63, 0.64, 0.65, 0.68], goodMoves: 6, badMoves: 0, hiddenMiles: 0, lowRpm: 1, newStarts: 0, wellness: 97 },
        { id: 14, name: "Peggy Olson", company: "SMT", allTrucks: 11, ooTrucks: 8, looTrucks: 3, dryvan: 11, reefer: 0, flatbed: 0, rank1w: 11, rank4w: 10, trend1w: [0.45, 0.47], trend4w: [0.43, 0.44, 0.45, 0.47], goodMoves: 4, badMoves: 2, hiddenMiles: 1, lowRpm: 3, newStarts: 1, wellness: 89 },
        { id: 15, name: "Michael Scott", company: "AmeriGo", allTrucks: 7, ooTrucks: 4, looTrucks: 3, dryvan: 7, reefer: 0, flatbed: 0, rank1w: 16, rank4w: 16, trend1w: [0.30, 0.28], trend4w: [0.32, 0.31, 0.30, 0.28], goodMoves: 1, badMoves: 5, hiddenMiles: 3, lowRpm: 7, newStarts: 2, wellness: 70 },
        { id: 16, name: "Dwight Schrute", company: "AmeriGo", allTrucks: 10, ooTrucks: 6, looTrucks: 4, dryvan: 5, reefer: 5, flatbed: 0, rank1w: 14, rank4w: 13, trend1w: [0.38, 0.36], trend4w: [0.40, 0.39, 0.38, 0.36], goodMoves: 2, badMoves: 3, hiddenMiles: 2, lowRpm: 4, newStarts: 1, wellness: 80 },
        { id: 17, name: "Jim Halpert", company: "SMT", allTrucks: 15, ooTrucks: 12, looTrucks: 3, dryvan: 15, reefer: 0, flatbed: 0, rank1w: 5, rank4w: 4, trend1w: [0.59, 0.61], trend4w: [0.57, 0.58, 0.59, 0.61], goodMoves: 6, badMoves: 1, hiddenMiles: 0, lowRpm: 2, newStarts: 0, wellness: 93 },
    ],
    drivers: [
        { id: 101, name: "Alex Ray", company: "SMT", dispatcher: "Jane Smith", equipment: "V", flags: [{ text: 'Good Move', color: 'green' }], risk: 10, gross: 8500, rpm: 2.5, miles: 3400, deadhead: 250, balance: 0, po: 1500 },
        { id: 102, name: "Ben Carter", company: "SMT", dispatcher: "John Doe", equipment: "R", flags: [{ text: 'Low RPM', color: 'yellow' }, { text: 'Bad Move', color: 'red' }], risk: 75, gross: 5500, rpm: 1.8, miles: 3055, deadhead: 450, balance: -250, po: 0 },
        { id: 103, name: "Casey Jones", company: "SMT", dispatcher: "Jane Smith", equipment: "V", flags: [], risk: 5, gross: 9200, rpm: 2.8, miles: 3285, deadhead: 150, balance: 100, po: 2000 },
        { id: 104, name: "David Lee", company: "AmeriGo", dispatcher: "Mike Johnson", equipment: "F", flags: [{ text: 'Low Net', color: 'red' }], risk: 95, gross: 4800, rpm: 2.1, miles: 2285, deadhead: 300, balance: -500, po: 500 },
        { id: 105, name: "Ethan Hunt", company: "AmeriGo", dispatcher: "Chris Green", equipment: "R", flags: [{ text: 'Low Gross', color: 'red' }], risk: 80, gross: 5100, rpm: 1.9, miles: 2684, deadhead: 200, balance: 0, po: 1200 },
        { id: 106, name: "Frank Martin", company: "SMT", dispatcher: "Emily White", equipment: "V", flags: [], risk: 8, gross: 8900, rpm: 2.6, miles: 3423, deadhead: 180, balance: 50, po: 1800 },
        { id: 107, name: "Grace Hall", company: "SMT", dispatcher: "John Doe", equipment: "R", flags: [{ text: 'Dispatcher Hopper', color: 'blue' }], risk: 40, gross: 7200, rpm: 2.2, miles: 3272, deadhead: 320, balance: 0, po: 900 },
        { id: 108, name: "Ivy Adams", company: "SMT", dispatcher: "Jane Smith", equipment: "V", flags: [], risk: 5, gross: 9500, rpm: 2.9, miles: 3275, deadhead: 120, balance: 200, po: 2500 },
        { id: 109, name: "Jack Bauer", company: "AmeriGo", dispatcher: "Mike Johnson", equipment: "F", flags: [{ text: 'Low RPM', color: 'yellow' }], risk: 60, gross: 6100, rpm: 1.95, miles: 3128, deadhead: 280, balance: -150, po: 700 },
        { id: 110, name: "Kate Austen", company: "SMT", dispatcher: "Emily White", equipment: "V", flags: [], risk: 12, gross: 8750, rpm: 2.55, miles: 3431, deadhead: 160, balance: 0, po: 1600 },
        { id: 111, name: "Liam Neeson", company: "SMT", dispatcher: "Sarah Connor", equipment: "V", flags: [], risk: 15, gross: 8200, rpm: 2.4, miles: 3416, deadhead: 190, balance: 0, po: 1300 },
        { id: 112, name: "Maximus Aurelius", company: "FleetForce", dispatcher: "Kyle Reese", equipment: "F", flags: [{ text: 'Heavy Loads', color: 'purple' }], risk: 55, gross: 7800, rpm: 2.3, miles: 3391, deadhead: 210, balance: -100, po: 1100 },
    ]
};

// ADD THIS NEW FUNCTION
function renderDriverSettingsModal() {
    const modal = document.getElementById('profiles-driver-settings-modal');
    if (!modal) return;
    modal.classList.toggle('hidden', !appState.profiles.isDriverSettingsModalOpen);
}

// --- RENDER FUNCTIONS ---
export const renderTeamProfileUI = () => {
    const teamData = dummyProfileData;
    renderProfileHeader(teamData);
    renderKPIs(teamData.kpis);
    renderDispatchTable(teamData.dispatchers);
    renderDriverToolbar(teamData);
    renderDriverTable(teamData.drivers);
    renderDriverSettingsModal();
    initializeProfileEventListeners();
};

function renderProfileHeader(teamData) {
    const headerContainer = document.getElementById('profiles-header');
    if (!headerContainer) return;
    const allTeams = ["SMT", "AmeriGo", "FleetForce", "LogiPro"];
    headerContainer.innerHTML = `
        <h2 class="text-xl font-bold text-white">${teamData.teamName} <span class="text-teal-400">Performance Profile</span></h2>
        <div class="flex items-center gap-2">
            <div id="kpi-settings-container" class="relative">
                <button id="kpi-settings-btn" class="toolbar-btn !p-2" title="Select KPIs">
                    <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" /></svg>
                </button>
                <!-- KPI Settings Dropdown will be rendered here -->
            </div>
            <button id="profile-date-range-btn" class="toolbar-btn !p-2" title="Select Date Range">
                <svg class="w-5 h-5 pointer-events-none" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0h18" /></svg>
            </button>
            <div class="w-56">
                <select id="team-selector" class="w-full bg-gray-900 text-gray-100 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent transition duration-200">
                    ${allTeams.map(team => `<option value="${team}" ${team === teamData.teamName ? 'selected' : ''}>${team}</option>`).join('')}
                </select>
            </div>
        </div>
    `;
}

function renderKPIs(kpis) {
    const kpiContainer = document.getElementById('profiles-kpi-container');
    if (!kpiContainer) return;

    kpiContainer.innerHTML = ''; // Clear existing KPIs

    // --- START: REPLACEMENT LOGIC FOR renderKPIs ---
    const allPossibleKpis = [
        { id: 'totalGross', label: 'Total Weekly Gross', value: `$${kpis.totalGross.toLocaleString()}`, change: getChangeDisplay(kpis.totalGross, kpis.prevWeekTotalGross, { isCurrency: true }) },
        { id: 'teamRpm', label: 'Team RPM (All)', value: `$${kpis.teamRpm.toFixed(2)}`, change: getChangeDisplay(kpis.teamRpm, kpis.prevWeekTeamRpm, { isCurrency: true, isRpm: true }) },
        { id: 'teamMargin', label: 'Team Margin ($)', value: `$${kpis.teamMargin.toLocaleString()}`, change: getChangeDisplay(kpis.teamMargin, kpis.prevWeekTeamMargin, { isCurrency: true }) },
        { id: 'activeTrucks', label: 'Active Trucks', value: kpis.activeTrucks, change: getChangeDisplay(kpis.activeTrucks, kpis.prevWeekActiveTrucks) },
        { id: 'dispatchers', label: 'Dispatchers', value: kpis.dispatchers, change: getChangeDisplay(kpis.dispatchers, kpis.prevWeekDispatchers) },
        { id: 'medianDropRisk', label: 'Median Drop Risk', value: `${kpis.medianDropRisk}%`, change: getChangeDisplay(kpis.medianDropRisk, kpis.prevWeekMedianDropRisk, { lowerIsBetter: true }) },
    ];

    // Dynamically add company-specific KPIs to the master list
    dummyProfileData.companies.forEach(company => {
        const companyKpis = kpis[company];
        if (companyKpis) {
            allPossibleKpis.push({
                id: `${company}_gross`,
                label: `${company} Gross`,
                value: `$${companyKpis.totalGross.toLocaleString()}`,
                change: getChangeDisplay(companyKpis.totalGross, companyKpis.prevWeekTotalGross, { isCurrency: true })
            });
            allPossibleKpis.push({
                id: `${company}_rpm`,
                label: `${company} RPM`,
                value: `$${companyKpis.teamRpm.toFixed(2)}`,
                change: getChangeDisplay(companyKpis.teamRpm, companyKpis.prevWeekTeamRpm, { isCurrency: true, isRpm: true })
            });
        }
    });
    
    // Update the master list in the state (if it hasn't been populated with company KPIs yet)
    if (appState.profiles.kpiSettings.allKpis.length < allPossibleKpis.length) {
         appState.profiles.kpiSettings.allKpis = allPossibleKpis.map(({id, label}) => ({id, label}));
    }

    // Filter the master list based on what's set to be visible in the state
    const visibleKpis = allPossibleKpis.filter(kpi => appState.profiles.kpiSettings.visibleKpiIds.includes(kpi.id));

    // Render only the visible KPIs
    visibleKpis.forEach(kpi => {
        kpiContainer.innerHTML += `
            <div class="profile-kpi-card-ranking">
                <h4 class="kpi-title-ranking">${kpi.label}</h4>
                <p class="kpi-value-ranking">${kpi.value}</p>
                <p class="kpi-trend">${kpi.change}</p>
            </div>
        `;
    });
    // --- END: REPLACEMENT LOGIC FOR renderKPIs ---
}

// --- START: ADD THIS NEW FUNCTION ---
function renderKpiSettingsDropdown() {
    const container = document.getElementById('kpi-settings-container');
    if (!container) return;

    // Remove any existing dropdown to prevent duplicates
    const existingDropdown = document.getElementById('kpi-settings-dropdown');
    if (existingDropdown) existingDropdown.remove();

    // Only create the dropdown if it's supposed to be open
    if (!appState.profiles.isKpiSettingsOpen) return;

    const dropdown = document.createElement('div');
    dropdown.id = 'kpi-settings-dropdown';
    dropdown.className = 'absolute right-0 mt-2 w-72 bg-gray-700 border border-gray-600 rounded-lg shadow-xl z-50 p-2';

    let dropdownHTML = `<div class="text-xs uppercase text-gray-400 font-bold mb-2">Visible KPIs</div>`;
    
    const { allKpis, visibleKpiIds } = appState.profiles.kpiSettings;

    allKpis.forEach(kpi => {
        const isVisible = visibleKpiIds.includes(kpi.id);
        dropdownHTML += `
            <label class="flex items-center p-1.5 hover:bg-gray-600 rounded-md text-sm text-gray-200 cursor-pointer">
                <input type="checkbox" data-kpi-id="${kpi.id}" ${isVisible ? 'checked' : ''} class="form-checkbox h-4 w-4 text-teal-500 rounded border-gray-500 focus:ring-teal-500 mr-2 bg-gray-800">
                <span>${kpi.label}</span>
            </label>
        `;
    });
    
    dropdown.innerHTML = dropdownHTML;
    container.appendChild(dropdown);

    // Add event listeners to the new checkboxes
    dropdown.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation(); // Prevent the dropdown from closing
            const kpiId = e.target.dataset.kpiId;
            const visibleSet = new Set(appState.profiles.kpiSettings.visibleKpiIds);
            
            if (e.target.checked) {
                visibleSet.add(kpiId);
            } else {
                visibleSet.delete(kpiId);
            }
            
            // Maintain original order
            appState.profiles.kpiSettings.visibleKpiIds = appState.profiles.kpiSettings.allKpis
                .map(k => k.id)
                .filter(id => visibleSet.has(id));

            renderKPIs(dummyProfileData.kpis); // Re-render the KPIs instantly
        });
    });
}
// --- END: ADD THIS NEW FUNCTION ---

function renderDispatchTable(dispatchers) {
    const tableContainer = document.getElementById('profiles-dispatch-table-container');
    if (!tableContainer) return;

    const { columnOrder, visibleColumnIds, pinnedLeftColumns, pinnedRightColumns } = appState.profiles.dispatchTable;
    const selectedDispatcherId = appState.profiles.selectedDispatcherId;

    const visibleColumns = columnOrder
        .map(id => dispatchTableColumns.find(c => c.id === id))
        .filter(col => col && visibleColumnIds.includes(col.id));

    tableContainer.innerHTML = `
        <table class="w-full text-sm text-left text-gray-400">
            <thead class="text-xs text-gray-300 uppercase sticky top-0 bg-gray-900 z-20">
                <tr id="dispatch-table-head">
                    ${visibleColumns.map(col => {
                        const isPinnedLeft = pinnedLeftColumns.includes(col.id);
                        const isPinnedRight = pinnedRightColumns.includes(col.id);
                        const stickyClasses = isPinnedLeft ? 'sticky sticky-left' : isPinnedRight ? 'sticky sticky-right' : '';
                        return `<th class="py-2 px-3 whitespace-nowrap ${stickyClasses}" draggable="true" data-col-id="${col.id}">${col.label}</th>`;
                    }).join('')}
                </tr>
            </thead>
            <tbody id="dispatch-table-body" class="divide-y divide-gray-700">
                ${dispatchers.map(d => `
                    <tr class="dispatch-table-row ${selectedDispatcherId === d.id ? 'selected' : ''}" data-dispatcher-id="${d.id}" data-dispatcher-name="${d.name}">
                        ${visibleColumns.map(col => {
                            const isPinnedLeft = pinnedLeftColumns.includes(col.id);
                            const isPinnedRight = pinnedRightColumns.includes(col.id);
                            const stickyClasses = isPinnedLeft ? 'sticky sticky-left' : isPinnedRight ? 'sticky sticky-right' : '';
                            
                            let content = d[col.id];
                            let cellClass = 'text-center';
                            let tooltipAttr = '';

                            if (['goodMoves', 'badMoves', 'hiddenMiles', 'lowRpm', 'newStarts', 'wellness'].includes(col.id)) {
                                cellClass += ' dispatch-tooltip-trigger cursor-help';
                                tooltipAttr = `data-tooltip-metric="${col.id}"`;
                            }
                            
                            if (col.id === 'name') cellClass = 'text-left font-medium text-gray-200';
                            if (col.id === 'goodMoves') cellClass += ' text-green-400 font-semibold';
                            if (col.id === 'badMoves') cellClass += ' text-red-400 font-semibold';
                            
                            switch(col.type) {
                                case 'sparkline': content = `<div class="sparkline" data-trend='${JSON.stringify(d[col.id] || [])}'></div>`; break;
                                case 'percentage': content = `${d[col.id]}%`; break;
                            }
                            return `<td class="py-2 px-3 whitespace-nowrap ${stickyClasses} ${cellClass}" ${tooltipAttr}>${content}</td>`;
                        }).join('')}
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    document.querySelectorAll('.sparkline').forEach(span => renderSparkline(span));
    renderDispatchColumnSettingsDropdown();
    initializeDispatchTableDragDrop();
    applyStickyStyles_DispatchTable();
}

function renderDriverToolbar(teamData) {
    const toolbarContainer = document.getElementById('profiles-driver-toolbar');
    if (!toolbarContainer) return;
    const selectedDispatcherName = appState.profiles.selectedDispatcherId 
        ? teamData.dispatchers.find(d => d.id === appState.profiles.selectedDispatcherId)?.name
        : null;

    const activeFilters = appState.profiles.driverFilters.activeFilters;

    // Generate HTML for the active filter tags that appear below the header
    let activeFiltersHTML = activeFilters.map((filter, index) => {
        // ... (this logic will be moved to the filter modal, so we can simplify)
        return ''; // We will handle active filter display differently or remove it for a cleaner look
    }).join('');

    // New Toolbar Layout
    toolbarContainer.innerHTML = `
        <div class="flex justify-between items-center w-full">
            <h3 id="driver-table-title" class="text-lg font-bold text-gray-200">
                ${selectedDispatcherName ? `Driver Health for ${selectedDispatcherName}` : `Driver Health Breakdown for ${teamData.teamName}`}
            </h3>
            <div class="flex items-center gap-x-2">
                <button id="driver-filter-btn" class="toolbar-btn">
                    <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.572a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" /></svg>
                    <span>Filters ${activeFilters.length > 0 ? `<span class="bg-blue-600 text-white rounded-full px-2 py-0.5 text-xs ml-1">${activeFilters.length}</span>` : ''}</span>
                </button>
                <button id="driver-settings-btn" class="toolbar-btn !p-2" title="Table Settings">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924-1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                </button>
            </div>
        </div>
    `;
}

function renderDriverTable(drivers) {
    const tableContainer = document.getElementById('profiles-driver-table-container');
    if (!tableContainer) return;
    
    let filteredDrivers = [...drivers];

    const selectedDispatcherName = appState.profiles.selectedDispatcherId
        ? dummyProfileData.dispatchers.find(d => d.id === appState.profiles.selectedDispatcherId)?.name
        : null;
    if (selectedDispatcherName) {
        filteredDrivers = filteredDrivers.filter(driver => driver.dispatcher === selectedDispatcherName);
    }

    const { activeFilters, filterLogic } = appState.profiles.driverFilters;
    if (activeFilters.length > 0) {
        const filterMethod = appState.profiles.driverFilters.filterLogic === 'OR' ? 'some' : 'every';
        
        filteredDrivers = filteredDrivers.filter(driver => {
            return activeFilters[filterMethod](filter => {
                const driverValue = driver[filter.columnId];
                const filterValue = filter.value;

                if (filter.operator === 'isEmpty') return driverValue === null || driverValue === undefined || driverValue === '';
                if (filter.operator === 'isNotEmpty') return driverValue !== null && driverValue !== undefined && driverValue !== '';
                if (driverValue === undefined || driverValue === null) return false;

                const parseList = (val) => Array.isArray(val) ? val.map(s => String(s).trim().toLowerCase()) : String(val).split(',').map(s => s.trim().toLowerCase());

                if (filter.columnId === 'flags') {
                    const driverFlags = driver.flags.map(f => f.text);
                    const filterFlags = parseList(filterValue);
                    if (filter.operator === 'containsAll') return filterFlags.every(ff => driverFlags.includes(ff));
                    if (filter.operator === 'containsAny') return filterFlags.some(ff => driverFlags.includes(ff));
                    if (filter.operator === 'notContainsAny') return !filterFlags.some(ff => driverFlags.includes(ff));
                }

                switch (filter.operator) {
                    case 'contains': return String(driverValue).toLowerCase().includes(String(filterValue).toLowerCase());
                    case 'notContains': return !String(driverValue).toLowerCase().includes(String(filterValue).toLowerCase());
                    case 'equals': case 'is': return String(driverValue).toLowerCase() === String(filterValue).toLowerCase();
                    case 'notEquals': case 'isNot': return String(driverValue).toLowerCase() !== String(filterValue).toLowerCase();
                    case 'startsWith': return String(driverValue).toLowerCase().startsWith(String(filterValue).toLowerCase());
                    case 'endsWith': return String(driverValue).toLowerCase().endsWith(String(filterValue).toLowerCase());
                    case 'isAnyOf':
                        const list = parseList(filterValue);
                        return list.includes(String(driverValue).toLowerCase());
                    case 'isNotAnyOf':
                        const notList = parseList(filterValue);
                        return !notList.includes(String(driverValue).toLowerCase());
                    case 'greaterThan': return Number(driverValue) > Number(filterValue);
                    case 'greaterOrEqual': return Number(driverValue) >= Number(filterValue);
                    case 'lessThan': return Number(driverValue) < Number(filterValue);
                    case 'lessOrEqual': return Number(driverValue) <= Number(filterValue);
                    default: return true;
                }
            });
        });
    }

    // The rest of the function remains the same...
    tableContainer.innerHTML = `
        <table class="w-full text-sm text-left text-gray-400">
            <thead class="text-xs text-gray-300 uppercase sticky top-0 bg-gray-900">
                <tr>
                    <th class="py-2 px-3">Driver Name</th><th class="py-2 px-3">Company</th><th class="py-2 px-3">Dispatcher</th>
                    <th class="py-2 px-3 text-center">Equipment</th><th class="py-2 px-3">Live Flags</th><th class="py-2 px-3 text-center">Drop Risk %</th>
                    <th class="py-2 px-3 text-right">Weekly Gross</th><th class="py-2 px-3 text-right">RPM (All)</th>
                    <th class="py-2 px-3 text-right">Total Miles</th><th class="py-2 px-3 text-right">DH</th>
                    <th class="py-2 px-3 text-right">Balance</th><th class="py-2 px-3 text-right">PO</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-700">
                ${filteredDrivers.length > 0 ? filteredDrivers.map(driver => {
                    const eqClass = { V: 'eq-v', R: 'eq-r', F: 'eq-f' }[driver.equipment] || '';
                    const balanceColor = driver.balance < 0 ? 'text-red-400' : 'text-gray-300';
                    return `<tr class="hover:bg-gray-700/50">
                        <td class="py-2 px-3 font-medium text-gray-200">${driver.name}</td><td class="py-2 px-3">${driver.company}</td>
                        <td class="py-2 px-3">${driver.dispatcher}</td>
                        <td class="py-2 px-3 text-center"><span class="equipment-letter ${eqClass}">${driver.equipment}</span></td>
                        <td class="py-2 px-3"><div class="flex flex-wrap gap-1">${driver.flags.map(flag => `<span class="driver-flag flag-${flag.color}">${flag.text}</span>`).join('')}</div></td>
                        <td class="py-2 px-3 text-center"><div class="flex items-center justify-center gap-2"><div class="risk-bar"><div style="width: ${driver.risk}%;" class="risk-bar-fill"></div></div><span class="font-mono text-xs">${driver.risk}%</span></div></td>
                        <td class="py-2 px-3 text-right font-mono">$${driver.gross.toLocaleString()}</td><td class="py-2 px-3 text-right font-mono">$${driver.rpm.toFixed(2)}</td>
                        <td class="py-2 px-3 text-right font-mono">${driver.miles.toLocaleString()}</td><td class="py-2 px-3 text-right font-mono">${driver.deadhead}</td>
                        <td class="py-2 px-3 text-right font-mono ${balanceColor}">$${driver.balance.toLocaleString()}</td><td class="py-2 px-3 text-right font-mono">$${driver.po.toLocaleString()}</td>
                    </tr>`
                }).join('') : `<tr><td colspan="12" class="text-center py-6 text-gray-500">No drivers match the current filters.</td></tr>`}
            </tbody>
        </table>
    `;
}

function renderDispatchColumnSettingsDropdown() {
    const container = document.getElementById('dispatch-column-settings-dropdown');
    if (!container) return;
    container.innerHTML = `<div class="text-xs uppercase text-gray-400 font-bold mb-2">Visible Columns</div>`;
    appState.profiles.dispatchTable.columnOrder.forEach(colId => {
        const column = dispatchTableColumns.find(c => c.id === colId);
        if (!column) return;
        const isVisible = appState.profiles.dispatchTable.visibleColumnIds.includes(colId);
        const isPinnedLeft = appState.profiles.dispatchTable.pinnedLeftColumns.includes(colId);
        const isPinnedRight = appState.profiles.dispatchTable.pinnedRightColumns.includes(colId);
        const wrapper = document.createElement('div');
        wrapper.className = 'flex items-center justify-between p-1.5 hover:bg-gray-600 rounded-md text-sm text-gray-200';
        const label = document.createElement('label');
        label.className = 'flex items-center cursor-pointer flex-grow';
        label.innerHTML = `
            <input type="checkbox" ${isVisible ? 'checked' : ''} class="form-checkbox h-4 w-4 text-teal-500 rounded border-gray-500 focus:ring-teal-500 mr-2 bg-gray-800">
            <span>${column.label}</span>
        `;
        label.querySelector('input').addEventListener('change', (e) => {
            e.stopPropagation(); // <-- This prevents the dropdown from closing
            const visibleSet = new Set(appState.profiles.dispatchTable.visibleColumnIds);
            visibleSet.has(colId) ? visibleSet.delete(colId) : visibleSet.add(colId);
            appState.profiles.dispatchTable.visibleColumnIds = Array.from(visibleSet);
            renderDispatchTable(dummyProfileData.dispatchers);
        });
        const controls = document.createElement('div');
        controls.className = 'flex items-center space-x-2';
        controls.innerHTML = `
            <button class="p-1 rounded-md ${isPinnedLeft ? 'bg-teal-600 text-white' : 'text-gray-400 hover:bg-gray-500'}" title="Pin to Left" data-col-id="${colId}" data-pin="left">
                <svg class="w-4 h-4 pointer-events-none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18.5 12H6m-2.5 0h2.5M11 18l-6-6 6-6"/></svg>
            </button>
            <button class="p-1 rounded-md ${isPinnedRight ? 'bg-teal-600 text-white' : 'text-gray-400 hover:bg-gray-500'}" title="Pin to Right" data-col-id="${colId}" data-pin="right">
                <svg class="w-4 h-4 pointer-events-none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5.5 12H18m2.5 0h-2.5M13 18l6-6-6-6"/></svg>
            </button>
        `;
        wrapper.appendChild(label);
        wrapper.appendChild(controls);
        container.appendChild(wrapper);
    });
}

/**
 * Generates HTML for the change indicator on KPI cards.
 * @param {number} current - The current week's value.
 * @param {number} previous - The previous week's value.
 * @param {object} options - Configuration options { isCurrency, isRpm, lowerIsBetter }.
 * @returns {string} HTML string for the change indicator.
 */
function getChangeDisplay(current, previous, options = {}) {
    if (previous === null || current === null || previous === undefined || current === undefined) return '<span>-</span>';

    const change = current - previous;
    if (change === 0) return `<span class="text-gray-400">No Change</span>`;

    const isPositive = change > 0;
    const isGood = options.lowerIsBetter ? !isPositive : isPositive;

    const colorClass = isGood ? 'text-green-400' : 'text-red-400';
    const arrow = isPositive 
        ? `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>`;

    let changeText;
    if (options.isRpm) {
        changeText = `${isPositive ? '+' : ''}$${Math.abs(change).toFixed(2)}`;
    } else if (options.isCurrency) {
        changeText = `${isPositive ? '+' : ''}$${Math.abs(change).toLocaleString()}`;
    } else {
        changeText = `${isPositive ? '+' : ''}${Math.abs(change).toLocaleString()}`;
    }

    return `<span class="${colorClass} flex items-center justify-center gap-1">${arrow} ${changeText} vs Prev. Week</span>`;
}

// --- HELPERS & EVENT LISTENERS ---
function renderSparkline(span) {
    const data = JSON.parse(span.dataset.trend);
    if (!data || data.length === 0) return;
    const width = 80;
    const height = 16;
    const svg = d3.select(span).append("svg").attr("width", width).attr("height", height);
    const x = d3.scaleLinear().domain([0, data.length - 1]).range([0, width]);
    const y = d3.scaleLinear().domain(d3.extent(data)).range([height - 2, 2]);
    const line = d3.line().x((d, i) => x(i)).y(d => y(d)).curve(d3.curveMonotoneX);
    svg.append("path").datum(data).attr("fill", "none").attr("stroke", "#34d399").attr("stroke-width", 2).attr("d", line);
}

function renderFlagFilter() {
    const container = document.getElementById('driver-flag-filter-container');
    if (!container) return;
    container.innerHTML = `<select id="flag-filter-select" class="w-full bg-gray-700 text-gray-100 border border-gray-600 rounded-lg px-3 py-2 text-sm"><option>All Flags</option></select>`;
}

function handlePinColumn(columnId, side) {
    const { pinnedLeftColumns, pinnedRightColumns } = appState.profiles.dispatchTable;
    const leftIndex = pinnedLeftColumns.indexOf(columnId);
    const rightIndex = pinnedRightColumns.indexOf(columnId);
    if (leftIndex > -1) pinnedLeftColumns.splice(leftIndex, 1);
    if (rightIndex > -1) pinnedRightColumns.splice(rightIndex, 1);
    if (side === 'left' && leftIndex === -1) {
        pinnedLeftColumns.push(columnId);
    } else if (side === 'right' && rightIndex === -1) {
        pinnedRightColumns.push(columnId);
    }
    renderDispatchTable(dummyProfileData.dispatchers);
}

function applyStickyStyles_DispatchTable() {
    const tableHead = document.getElementById('dispatch-table-head');
    const tableBody = document.getElementById('dispatch-table-body');
    if (!tableHead || !tableBody) return;

    const { pinnedLeftColumns, pinnedRightColumns } = appState.profiles.dispatchTable;
    const headerCells = Array.from(tableHead.children);
    const bodyRows = Array.from(tableBody.children);

    let leftOffset = 0;
    
    // Left pins, iterating forwards
    headerCells.forEach((th, index) => {
        const colId = th.dataset.colId;
        if (pinnedLeftColumns.includes(colId)) {
            // Higher z-index for columns further to the left
            const zIndex = 20 + (pinnedLeftColumns.length - pinnedLeftColumns.indexOf(colId));
            th.style.left = `${leftOffset}px`;
            th.style.zIndex = zIndex;
            bodyRows.forEach(row => {
                if (row.children[index]) {
                    row.children[index].style.left = `${leftOffset}px`;
                    row.children[index].style.zIndex = zIndex - 10;
                }
            });
            leftOffset += th.offsetWidth;
        }
    });

    let rightOffset = 0;

    // Right pins, iterating backwards
    for (let i = headerCells.length - 1; i >= 0; i--) {
        const th = headerCells[i];
        const colId = th.dataset.colId;
        if (pinnedRightColumns.includes(colId)) {
            // Higher z-index for columns further to the right
            const zIndex = 20 + (pinnedRightColumns.length - pinnedRightColumns.indexOf(colId));
            th.style.right = `${rightOffset}px`;
            th.style.zIndex = zIndex;
            bodyRows.forEach(row => {
                if (row.children[i]) {
                    row.children[i].style.right = `${rightOffset}px`;
                    row.children[i].style.zIndex = zIndex - 10;
                }
            });
            rightOffset += th.offsetWidth;
        }
    }
}

function initializeDispatchTableDragDrop() {
    const headers = document.querySelectorAll('#dispatch-table-head th');
    headers.forEach(header => {
        header.addEventListener('dragstart', e => {
            appState.profiles.dispatchTable.draggedColumnId = e.target.dataset.colId;
            e.target.classList.add('opacity-50');
        });
        header.addEventListener('dragover', e => {
            e.preventDefault();
            if (e.target.dataset.colId !== appState.profiles.dispatchTable.draggedColumnId) {
                e.target.classList.add('drag-over-border');
            }
        });
        header.addEventListener('dragleave', e => e.target.classList.remove('drag-over-border'));
        header.addEventListener('drop', e => {
            e.preventDefault();
            e.target.classList.remove('drag-over-border');
            const draggedId = appState.profiles.dispatchTable.draggedColumnId;
            const droppedOnId = e.target.dataset.colId;
            if (draggedId && draggedId !== droppedOnId) {
                const order = [...appState.profiles.dispatchTable.columnOrder];
                const fromIndex = order.indexOf(draggedId);
                order.splice(fromIndex, 1);
                const toIndex = order.indexOf(droppedOnId);
                order.splice(toIndex, 0, draggedId);
                appState.profiles.dispatchTable.columnOrder = order;
                renderDispatchTable(dummyProfileData.dispatchers);
            }
        });
        header.addEventListener('dragend', e => e.target.classList.remove('opacity-50'));
    });
}

export function initializeProfileEventListeners() {
    const dispatchTable = document.getElementById('profiles-dispatch-table-container');
    
    // Combined click listener for the entire dispatch table
    if (dispatchTable && !dispatchTable.listenerAttached) {
        dispatchTable.addEventListener('click', (e) => {
            const tooltipTrigger = e.target.closest('.dispatch-tooltip-trigger');
            
            // --- Logic for Tooltip Click (Copy) ---
            if (tooltipTrigger) {
                e.stopPropagation(); // <-- CRUCIAL: Prevents the row click event
                
                const dispatcherId = parseInt(tooltipTrigger.parentElement.dataset.dispatcherId, 10);
                const dispatcher = dummyProfileData.dispatchers.find(d => d.id === dispatcherId);
                const metricId = tooltipTrigger.dataset.tooltipMetric;

                if (dispatcher && metricId) {
                    const htmlContent = generateDispatchTooltipHTML(dispatcher, metricId);
                    const plainText = new DOMParser().parseFromString(htmlContent, 'text/html').body.textContent || "";
                    const cleanedText = plainText.replace(/\s\s+/g, '\n').trim();
                    copyToClipboard(cleanedText);
                    
                    const tooltip = document.getElementById('dispatch-tooltip');
                    if (tooltip) {
                        tooltip.classList.add('copied');
                        setTimeout(() => tooltip.classList.remove('copied'), 300);
                    }
                }
                return; // End execution here
            }

            // --- Logic for Row Click (Filter) ---
            const row = e.target.closest('.dispatch-table-row');
            if (row) {
                const dispatcherId = parseInt(row.dataset.dispatcherId, 10);
                appState.profiles.selectedDispatcherId = appState.profiles.selectedDispatcherId === dispatcherId ? null : dispatcherId;
                renderDispatchTable(dummyProfileData.dispatchers);
                renderDriverToolbar(dummyProfileData);
                renderDriverTable(dummyProfileData.drivers);
            }
        });
        dispatchTable.listenerAttached = true;
    }
    
    // Fix for date picker icon click
    const dateRangeBtn = document.getElementById('profile-date-range-btn');
    if(dateRangeBtn && !dateRangeBtn.litepickerInstance) {
        const picker = new Litepicker({ 
            element: dateRangeBtn, 
            singleMode: false, 
            autoApply: true 
        });
        // This makes the whole button clickable, including the SVG icon inside it
        dateRangeBtn.addEventListener('click', (e) => {
            // Litepicker attaches its own listener. We stop this event from
            // bubbling up to prevent it from closing the picker immediately.
            e.stopPropagation();
            picker.show();
        });
        dateRangeBtn.litepickerInstance = picker;
    }

    // New listener for KPI settings
    const kpiSettingsBtn = document.getElementById('kpi-settings-btn');
    const kpiSettingsContainer = document.getElementById('kpi-settings-container');

    if (kpiSettingsBtn && !kpiSettingsBtn.listenerAttached) {
        kpiSettingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Toggle the state for the dropdown
            appState.profiles.isKpiSettingsOpen = !appState.profiles.isKpiSettingsOpen;
            // Re-render the dropdown (it will either be created or removed)
            renderKpiSettingsDropdown();
        });
        kpiSettingsBtn.listenerAttached = true;
    }

    // Existing listeners for dispatch table settings
    const settingsBtn = document.getElementById('dispatch-table-settings-btn');
    const settingsDropdown = document.getElementById('dispatch-column-settings-dropdown');
    
    if (settingsBtn && settingsDropdown && !settingsBtn.listenerAttached) {
        settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); settingsDropdown.classList.toggle('hidden'); });
        settingsBtn.listenerAttached = true;
        settingsDropdown.addEventListener('click', e => {
            const pinButton = e.target.closest('button[data-pin]');
            if (pinButton) { e.stopPropagation(); handlePinColumn(pinButton.dataset.colId, pinButton.dataset.pin); }
        });
    }

    // --- START: NEW LISTENERS FOR DRIVER FILTER MODAL ---
    const driverFilterModal = document.getElementById('profiles-driver-filter-modal');

    // Open Modal Button
    // Use event delegation on a parent that always exists, like the main content area
    const profileContent = document.getElementById('profiles-content');
    if (profileContent && !profileContent.driverFilterListener) {
        profileContent.addEventListener('click', e => {
            // Open modal
            if (e.target.closest('#driver-filter-btn')) {
                appState.profiles.driverFilters.isFilterModalOpen = true;
                renderDriverFilterModal();
            }
            // Remove an active filter tag
            if (e.target.closest('.remove-active-filter-btn')) {
                const indexToRemove = parseInt(e.target.closest('.remove-active-filter-btn').dataset.index, 10);
                appState.profiles.driverFilters.activeFilters.splice(indexToRemove, 1);
                renderDriverToolbar(dummyProfileData);
                renderDriverTable(dummyProfileData.drivers);
            }
        });
        profileContent.driverFilterListener = true;
    }

    // Listeners for inside the modal
    if (driverFilterModal && !driverFilterModal.listenerAttached) {
        // This function reads the current state of the inputs in the modal
        const readAndApplyFiltersFromModal = () => {
            const criteriaRows = driverFilterModal.querySelectorAll('.driver-filter-criteria-row');
            const newFilters = Array.from(criteriaRows).map(row => {
                const columnId = row.querySelector('.column-select').value;
                const operator = row.querySelector('.operator-select').value;
                let value;
                if (row.querySelector('.filter-multiselect-container')) {
                     value = Array.from(row.querySelectorAll('.multiselect-checkbox:checked')).map(cb => cb.value);
                } else {
                    const valueInput = row.querySelector('.value-input');
                    value = valueInput ? valueInput.value : null;
                }
                return { columnId, operator, value };
            }).filter(f => {
                // Keep filter if value is an array with items, or a non-empty string/number
                if (Array.isArray(f.value)) return f.value.length > 0;
                return f.value !== '' && f.value !== null;
            });

            appState.profiles.driverFilters.activeFilters = newFilters;
            appState.profiles.driverFilters.isFilterModalOpen = false;
            renderDriverFilterModal();
            renderDriverToolbar(dummyProfileData);
            renderDriverTable(dummyProfileData.drivers);
        };

        driverFilterModal.querySelector('#apply-driver-filter-btn').addEventListener('click', readAndApplyFiltersFromModal);
        
        const closeModal = () => {
            appState.profiles.driverFilters.isFilterModalOpen = false;
            renderDriverFilterModal();
        };
        driverFilterModal.querySelector('#close-driver-filter-modal-btn').addEventListener('click', closeModal);
        driverFilterModal.querySelector('#cancel-driver-filter-btn').addEventListener('click', closeModal);
        
        driverFilterModal.querySelector('#clear-driver-filters-btn').addEventListener('click', () => {
            appState.profiles.driverFilters.activeFilters = [];
            closeModal();
            renderDriverToolbar(dummyProfileData);
            renderDriverTable(dummyProfileData.drivers);
        });
        
        driverFilterModal.listenerAttached = true;
    }
    // --- END: NEW LISTENERS ---

    // New listeners for Dispatch Table Tooltips
    const tooltip = document.getElementById('dispatch-tooltip');
    if (dispatchTable && tooltip && !dispatchTable.tooltipListenerAttached) {
        dispatchTable.addEventListener('mouseover', (e) => {
            const trigger = e.target.closest('.dispatch-tooltip-trigger');
            if (!trigger) return;
            const dispatcherId = parseInt(trigger.parentElement.dataset.dispatcherId, 10);
            const dispatcher = dummyProfileData.dispatchers.find(d => d.id === dispatcherId);
            const metricId = trigger.dataset.tooltipMetric;
            if (dispatcher && metricId) {
                tooltip.innerHTML = generateDispatchTooltipHTML(dispatcher, metricId);
                tooltip.classList.add('visible');
            }
        });

        dispatchTable.addEventListener('mousemove', (e) => {
            if (tooltip.classList.contains('visible')) {
                // Position tooltip to the left of the cursor
                tooltip.style.left = `${e.pageX - tooltip.offsetWidth - 15}px`;
                tooltip.style.top = `${e.pageY + 15}px`;
            }
        });

        dispatchTable.addEventListener('mouseout', (e) => {
            const trigger = e.target.closest('.dispatch-tooltip-trigger');
            if (trigger) { tooltip.classList.remove('visible'); }
        });
        dispatchTable.tooltipListenerAttached = true;
    }

    // Global click to close settings dropdown
    if(!document.body.profileSettingsListener) {
        document.addEventListener('click', (e) => {
            if (settingsDropdown && !settingsDropdown.classList.contains('hidden') && !settingsBtn.contains(e.target) && !settingsDropdown.contains(e.target)) {
                settingsDropdown.classList.add('hidden');
            }
            if (appState.profiles.isKpiSettingsOpen && kpiSettingsContainer && !kpiSettingsContainer.contains(e.target)) {
                 appState.profiles.isKpiSettingsOpen = false;
                 renderKpiSettingsDropdown(); // This will remove the dropdown from the DOM
            }
        });
        document.body.profileSettingsListener = true;
    }

    if (profileContent && !profileContent.driverSettingsListener) { // Add a new listener block
        profileContent.addEventListener('click', e => {
            if (e.target.closest('#driver-settings-btn')) {
                appState.profiles.isDriverSettingsModalOpen = true;
                renderDriverSettingsModal();
            }
        });
        profileContent.driverSettingsListener = true;
    }

    const driverSettingsModal = document.getElementById('profiles-driver-settings-modal');
    if (driverSettingsModal && !driverSettingsModal.listenerAttached) {
        const closeModal = () => {
            appState.profiles.isDriverSettingsModalOpen = false;
            renderDriverSettingsModal();
        };
        driverSettingsModal.querySelector('#close-driver-settings-modal-btn').addEventListener('click', closeModal);
        driverSettingsModal.querySelector('#save-driver-settings-btn').addEventListener('click', () => {
            // Add save logic here in the future
            console.log("Driver settings saved!");
            closeModal();
        });
        driverSettingsModal.listenerAttached = true;
    }
}

function generateDispatchTooltipHTML(dispatcher, metricId) {
    const title = `<strong class="tooltip-title">${metricId.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())} for ${dispatcher.name}</strong>`;
    let content = '';

    const tooltipLoads = [
        { id: 84321, route: "CHI, IL → ATL, GA", rate: 3200, gross_wo: 5500, rpm: 1.65, prev_rpm: 2.80, next_rpm: 2.50 },
        { id: 84325, route: "DAL, TX → LA, CA", rate: 2800, gross_wo: 5900, rpm: 2.10, prev_rpm: 2.90, next_rpm: 2.60 }
    ];

    const loadToHtml = (load) => {
        let details = '';
        switch (metricId) {
            case 'goodMoves':
            case 'badMoves':
                details = `Rate: <span class="tooltip-rate">$${load.rate.toLocaleString()}</span> (Gross w/o: $${load.gross_wo.toLocaleString()})`;
                break;
            case 'lowRpm':
                details = `RPM: <span class="tooltip-value-yellow">$${load.rpm.toFixed(2)}</span> (Prev: $${load.prev_rpm.toFixed(2)}, Next: $${load.next_rpm.toFixed(2)})`;
                break;
        }
        return `<div class="tooltip-load-row-flex">
            <div class="flex-shrink-0 font-bold text-gray-400">#${load.id}</div>
            <div class="tooltip-route-flex">${load.route}</div>
            <div class="tooltip-details-flex flex-shrink-0">${details}</div>
        </div>`;
    };

    switch (metricId) {
        case 'goodMoves':
        case 'badMoves':
        case 'lowRpm':
            content = `<div class="tooltip-load-list">${tooltipLoads.map(loadToHtml).join('')}</div>`;
            break;
        case 'hiddenMiles':
             content = `<div class="tooltip-load-list"><div class="tooltip-load-row-flex">
                <div class="flex-shrink-0 font-bold text-gray-400">#84337</div>
                <div class="tooltip-route-flex">OMA, NE → KC, MO</div>
                <div class="tooltip-details-flex"><span class="tooltip-value-purple">Prev. DO: SIOUX FALLS, SD</span></div>
            </div></div>`;
            break;
        // ... (rest of the cases remain the same)
        case 'newStarts':
            content = `<div class="tooltip-grid"><span class="tooltip-label">Driver:</span><span>John Smith (First load on Wednesday)</span></div>`;
            break;
        case 'wellness':
            content = `<div class="tooltip-grid"><span class="tooltip-label">Good Loads:</span><span class="tooltip-value-green">25</span><span class="tooltip-label">Failed Loads:</span><span class="tooltip-value-orange">2</span></div>`;
            break;
        default:
            return 'No details available.';
    }
    return title + content;
}

function copyToClipboard(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed'; // Prevent scrolling to bottom of page in MS Edge.
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
        document.execCommand('copy');
    } catch (err) {
        console.error('Fallback: Oops, unable to copy', err);
    }
    document.body.removeChild(textarea);
}

function renderDriverFilterModal() {
    const modal = document.getElementById('profiles-driver-filter-modal');
    const container = document.getElementById('driver-filter-criteria-container');
    if (!modal || !container) return;

    modal.classList.toggle('hidden', !appState.profiles.driverFilters.isFilterModalOpen);
    if (!appState.profiles.driverFilters.isFilterModalOpen) return;

    const readModalState = () => {
        const rows = container.querySelectorAll('.driver-filter-criteria-row');
        if (!rows || rows.length === 0) return []; // Return empty array instead of null
        return Array.from(rows).map(row => {
            const columnId = row.querySelector('.column-select').value;
            const operator = row.querySelector('.operator-select').value;
            let value;
            if (row.querySelector('.filter-multiselect-container')) {
                value = Array.from(row.querySelectorAll('.multiselect-checkbox:checked')).map(cb => cb.value);
            } else {
                const valueInput = row.querySelector('.value-input');
                value = valueInput ? valueInput.value : null;
            }
            return { columnId, operator, value };
        });
    };

    const tempFilters = appState.profiles.driverFilters.activeFilters;
    container.innerHTML = '';

    const filterColumns = [
        { id: 'name', label: 'Driver Name', type: 'string' },
        { id: 'company', label: 'Company', type: 'select', options: [...new Set(dummyProfileData.drivers.map(d => d.company))] },
        { id: 'dispatcher', label: 'Dispatcher', type: 'select', options: [...new Set(dummyProfileData.drivers.map(d => d.dispatcher))] },
        { id: 'equipment', label: 'Equipment', type: 'select', options: ['V', 'R', 'F'] },
        { id: 'flags', label: 'Live Flags', type: 'multiselect', options: [...new Set(dummyProfileData.drivers.flatMap(d => d.flags.map(f => f.text)))] },
        { id: 'risk', label: 'Drop Risk %', type: 'number' },
        { id: 'gross', label: 'Weekly Gross', type: 'number' },
        { id: 'rpm', label: 'RPM', type: 'number' },
        { id: 'miles', label: 'Total Miles', type: 'number' },
        { id: 'deadhead', label: 'DH', type: 'number' },
        { id: 'balance', label: 'Balance', type: 'number' },
        { id: 'po', label: 'PO', type: 'number' }
    ];

    const operators = {
        string: [
            { v: 'contains', l: 'contains' }, { v: 'notContains', l: 'does not contain' },
            { v: 'equals', l: 'equals' }, { v: 'isNot', l: 'is not' },
            { v: 'startsWith', l: 'starts with' }, { v: 'endsWith', l: 'ends with' },
            { v: 'isAnyOf', l: 'is any of (a,b)' }, { v: 'isNotAnyOf', l: 'is not any of (a,b)' },
            { v: 'isEmpty', l: 'is empty' }, { v: 'isNotEmpty', l: 'is not empty' }
        ],
        number: [
            { v: 'equals', l: '=' }, { v: 'notEquals', l: '!=' },
            { v: 'greaterThan', l: '>' }, { v: 'greaterOrEqual', l: '>=' },
            { v: 'lessThan', l: '<' }, { v: 'lessOrEqual', l: '<=' },
            { v: 'isAnyOf', l: 'is any of (1,2)' },
            { v: 'isEmpty', l: 'is empty' }, { v: 'isNotEmpty', l: 'is not empty' }
        ],
        select: [
            { v: 'is', l: 'is' }, { v: 'isNot', l: 'is not' },
            { v: 'isAnyOf', l: 'is any of' }, { v: 'isNotAnyOf', l: 'is not any of' },
            { v: 'isEmpty', l: 'is empty' }, { v: 'isNotEmpty', l: 'is not empty' }
        ],
        multiselect: [
            { v: 'containsAll', l: 'contains all of' },
            { v: 'containsAny', l: 'contains any of' },
            { v: 'notContainsAny', l: 'does not contain any of' }
        ]
    };

    const renderRow = (filter = {}) => {
        const row = document.createElement('div');
        row.className = 'grid grid-cols-[1.5fr_1.5fr_2fr_auto] gap-2 items-center driver-filter-criteria-row';
        
        const selectedColumn = filterColumns.find(c => c.id === filter.columnId) || filterColumns[0];
        
        // ** THE FIX IS HERE **
        // This block now robustly checks if the stored operator is valid for the selected column.
        // If not, it resets the operator to the FIRST valid option for that type.
        const validOperatorsForType = operators[selectedColumn.type] || operators.string;
        const isOperatorValid = validOperatorsForType.some(op => op.v === filter.operator);

        if (!filter.operator || !isOperatorValid) {
            filter.operator = validOperatorsForType[0].v; // Reset to the first valid operator
        }
        // ** END OF FIX **

        const ops = validOperatorsForType; // Use the already determined valid operators
        const currentOperator = filter.operator;
        const needsValue = !['isEmpty', 'isNotEmpty'].includes(currentOperator);
        let valueInputHTML = '';

        if (needsValue) {
            const isMultiSelectOp = ['isAnyOf', 'isNotAnyOf', 'containsAll', 'containsAny', 'notContainsAny'].includes(currentOperator);
            
            if (isMultiSelectOp && (selectedColumn.type === 'select' || selectedColumn.type === 'multiselect')) {
                 const opts = selectedColumn.options || [];
                 const currentValues = new Set(Array.isArray(filter.value) ? filter.value : String(filter.value || '').split(',').map(s => s.trim()));
                 const selectedCount = currentValues.size;
                 const triggerText = selectedCount === 0 ? 'Select...' : selectedCount === 1 ? [...currentValues][0] : `${selectedCount} selected`;

                 valueInputHTML = `<div class="filter-multiselect-container relative">
                    <button type="button" class="multiselect-trigger settings-select text-left w-full">${triggerText}</button>
                    <div class="multiselect-panel hidden">${opts.map(opt => `<label><input type="checkbox" class="multiselect-checkbox" value="${opt}" ${currentValues.has(opt) ? 'checked' : ''}> ${opt}</label>`).join('')}</div>
                 </div>`;

            } else if (selectedColumn.type === 'select' && ['is', 'isNot'].includes(currentOperator)) {
                valueInputHTML = `<select class="settings-select value-input">${selectedColumn.options.map(opt => `<option value="${opt}" ${filter.value === opt ? 'selected' : ''}>${opt}</option>`).join('')}</select>`;
            } else {
                 valueInputHTML = `<input type="${selectedColumn.type === 'number' ? 'number' : 'text'}" class="settings-input value-input w-full" value="${filter.value || ''}" placeholder="Enter value...">`;
            }
        }
        row.innerHTML = `
            <select class="settings-select column-select">${filterColumns.map(c => `<option value="${c.id}" ${filter.columnId === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
            <select class="settings-select operator-select">${ops.map(op => `<option value="${op.v}" ${currentOperator === op.v ? 'selected' : ''}>${op.l}</option>`).join('')}</select>
            <div class="value-container">${valueInputHTML}</div>
            <button class="remove-threshold-btn remove-criteria-btn" title="Remove Criteria"><svg class="pointer-events-none" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
        `;
        container.appendChild(row);
    };

    if (tempFilters.length === 0) {
        renderRow(); 
    } else {
        tempFilters.forEach(filter => renderRow(filter));
    }
    
    container.querySelectorAll('.column-select, .operator-select').forEach(sel => {
        sel.addEventListener('change', () => {
            appState.profiles.driverFilters.activeFilters = readModalState();
            renderDriverFilterModal(); 
        });
    });

    container.addEventListener('click', e => {
        if (e.target.closest('.remove-criteria-btn')) {
            e.target.closest('.driver-filter-criteria-row').remove();
            appState.profiles.driverFilters.activeFilters = readModalState();
        }
        if (e.target.closest('.multiselect-trigger')) {
            const panel = e.target.closest('.multiselect-trigger').nextElementSibling;
            panel.classList.toggle('hidden');
        }
    });

    const addBtn = modal.querySelector('#add-driver-filter-criteria-btn');
    if (addBtn && !addBtn.listenerAttached) {
        addBtn.addEventListener('click', () => {
            const currentFilters = readModalState();
            currentFilters.push({}); 
            appState.profiles.driverFilters.activeFilters = currentFilters;
            renderDriverFilterModal();
        });
        addBtn.listenerAttached = true;
    }
    
    const logicButtons = modal.querySelectorAll('.filter-logic-btn');
    logicButtons.forEach(btn => {
        btn.classList.toggle('active', appState.profiles.driverFilters.filterLogic === btn.dataset.logic);
        const handleLogicClick = () => {
            appState.profiles.driverFilters.filterLogic = btn.dataset.logic;
            logicButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        };
        btn.removeEventListener('click', btn.logicClickHandler);
        btn.addEventListener('click', handleLogicClick);
        btn.logicClickHandler = handleLogicClick;
    });
}
