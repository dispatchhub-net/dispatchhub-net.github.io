import { appState } from '../state.js';

let current2025Sort = { key: 'avgCriteria', direction: 'desc' };
let filterSettings = {}; 
let isFilteredHidden = false;

// Static data from the spreadsheet image
const STATIC_TEAM_DATA = [
    { name: 'Uros AmongUs', driverCount: 9, oo: 1, loo: 8, net: 0.638, gross: 0.711, margin: 0.452, cf: 0.559, criteria: 0.607 },
    { name: 'Agnius AmongUs', driverCount: 242, oo: 42, loo: 201, net: 0.532, gross: 0.537, margin: 0.549, cf: 0.558, criteria: 0.540 },
    { name: 'Miles SMJ', driverCount: 184, oo: 23, loo: 163, net: 0.519, gross: 0.531, margin: 0.485, cf: 0.517, criteria: 0.515 },
    { name: 'Miles AmongUs', driverCount: 126, oo: 13, loo: 114, net: 0.491, gross: 0.499, margin: 0.531, cf: 0.508, criteria: 0.508 },
    { name: 'Uros SMJ', driverCount: 272, oo: 161, loo: 117, net: 0.534, gross: 0.525, margin: 0.402, cf: 0.506, criteria: 0.504 },
    { name: 'Uros EB Infinity', driverCount: 93, oo: 62, loo: 31, net: 0.544, gross: 0.549, margin: 0.343, cf: 0.490, criteria: 0.500 },
    { name: 'Agnius SMJ', driverCount: 636, oo: 26, loo: 613, net: 0.485, gross: 0.477, margin: 0.466, cf: 0.504, criteria: 0.484 },
    { name: 'Uros Spot Edge', driverCount: 2, oo: 2, loo: 0, net: 0.500, gross: 0.600, margin: 0.306, cf: 0.495, criteria: 0.482 },
    { name: 'Alex', driverCount: 104, oo: 79, loo: 27, net: 0.487, gross: 0.504, margin: 0.410, cf: 0.500, criteria: 0.480 },
    { name: 'Agnius EB Infinity', driverCount: 2, oo: 0, loo: 2, net: 0.528, gross: 0.491, margin: 0.247, cf: 0.409, criteria: 0.455 },
    { name: 'Vito', driverCount: 81, oo: 2, loo: 79, net: 0.467, gross: 0.467, margin: 0.387, cf: 0.423, criteria: 0.448 },
    { name: 'Wayne', driverCount: 53, oo: 11, loo: 43, net: 0.466, gross: 0.452, margin: 0.329, cf: 0.459, criteria: 0.436 },
    { name: 'Altin', driverCount: 95, oo: 86, loo: 11, net: 0.460, gross: 0.433, margin: 0.348, cf: 0.428, criteria: 0.434 },
    { name: 'Stefan', driverCount: 77, oo: 19, loo: 59, net: 0.414, gross: 0.416, margin: 0.349, cf: 0.437, criteria: 0.411 },
    { name: 'Mubeen', driverCount: 28, oo: 28, loo: 0, net: 0.353, gross: 0.349, margin: 0.417, cf: 0.363, criteria: 0.373 }
];

export const openYear2025Modal = () => {
    let modal = document.getElementById('year-2025-modal');

    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'year-2025-modal';
        modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-[300] p-4 hidden transition-opacity duration-300';
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    }

    // Reset defaults based on mode
    current2025Sort = { key: 'avgCriteria', direction: 'desc' };
    isFilteredHidden = false;
    
    if (appState.rankingMode === 'team') {
        filterSettings = { minDrivers: 25 };
    } else {
        filterSettings = { minWeeks: 12, minStubs: 35 };
    }
    
    modal.classList.remove('hidden');
    renderYear2025Content(modal);
};

const renderYear2025Content = (modal) => {
    // 1. Filter Data for 2025
    const yearData = appState.allHistoricalData.filter(d => {
        const date = new Date(d.date);
        return date.getFullYear() === 2025;
    });

    if (yearData.length === 0) {
        modal.innerHTML = `
            <div class="bg-gray-800 border-2 border-gray-700 rounded-2xl shadow-2xl w-full max-w-4xl p-8 text-center animate-fade-in-up">
                <h2 class="text-2xl font-bold text-gray-200 mb-4">2025 Performance</h2>
                <p class="text-gray-400">No data available for the year 2025 yet.</p>
                <button id="close-2025-btn" class="mt-6 px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">Close</button>
            </div>
        `;
        document.getElementById('close-2025-btn').onclick = () => modal.classList.add('hidden');
        return;
    }

    const isTeamMode = appState.rankingMode === 'team';
    let tableData = [];

    if (isTeamMode) {
        // --- TEAM MODE: Use Static Data + Dynamic Gross/Margin/Miles ---
        
        // Pre-calculate aggregates for all teams from yearData
        const dynamicAggregates = {};
        
        yearData.forEach(record => {
            const team = record.dispatcherTeam;
            if (!team) return;
            
            // Normalize team name for matching (e.g. "Agnius AmongUs" vs "agnius amongus")
            const normalizedTeam = team.toLowerCase().trim();
            
            if (!dynamicAggregates[normalizedTeam]) {
                dynamicAggregates[normalizedTeam] = {
                    totalGross: 0,
                    totalMargin: 0,
                    totalMiles: 0,
                    weeksSet: new Set()
                };
            }
            
            const drivers = record.numDrivers || 0;
            dynamicAggregates[normalizedTeam].totalGross += (record.pTotal_gross || 0) * drivers;
            dynamicAggregates[normalizedTeam].totalMargin += (record.pMargin_dollar || 0) * drivers;
            dynamicAggregates[normalizedTeam].totalMiles += (record.pAll_miles || 0) * drivers;
            dynamicAggregates[normalizedTeam].weeksSet.add(new Date(record.date).toISOString().split('T')[0]);
        });

        tableData = STATIC_TEAM_DATA.map(staticTeam => {
            const normalizedName = staticTeam.name.toLowerCase().trim();
            const dynamicData = dynamicAggregates[normalizedName] || { totalGross: 0, totalMargin: 0, totalMiles: 0, weeksSet: new Set() };
            
            const miles = dynamicData.totalMiles;
            const gross = dynamicData.totalGross;
            
            return {
                name: staticTeam.name,
                team: staticTeam.name, // For consistency
                
                // Static Data from Spreadsheet
                totalUniqueDrivers: staticTeam.driverCount,
                totalOO: staticTeam.oo,
                totalLOO: staticTeam.loo,
                
                avgNet: staticTeam.net,
                avgGrossPct: staticTeam.gross,
                avgMarginPct: staticTeam.margin,
                avgCompHappy: staticTeam.cf,
                // Mapping spreadsheet NET/MILE (or Estimated Net) to Driver Happy as requested
                avgDriverHappy: staticTeam.net, 
                avgCriteria: staticTeam.criteria,
                
                // Dynamic Data
                totalGross: gross,
                totalMargin: dynamicData.totalMargin,
                totalMiles: miles,
                rpm: miles > 0 ? gross / miles : 0,
                weeksActive: dynamicData.weeksSet.size,
                
                // Placeholders for sorting consistency
                totalStubs: 0
            };
        });

    } else {
        // --- DISPATCHER MODE: Fully Dynamic (Original Logic) ---
        const dispatcherStats = {};
        const excludedNames = ['ralph wiggum', 'cletus spuckler', 'seymour skinner'];

        yearData.forEach(record => {
            const name = record.dispatcherName;
            if (!name) return;
            if (excludedNames.includes(name.toLowerCase())) return;

            if (!dispatcherStats[name]) {
                dispatcherStats[name] = {
                    name: name,
                    team: record.dispatcherTeam || '-',
                    totalGross: 0, totalMargin: 0, totalMiles: 0,
                    weightedCriteriaSum: 0, weightedCompHappy: 0, weightedDriverHappy: 0,
                    weightedNet: 0, weightedMarginPct: 0, weightedGrossPct: 0,
                    sumOO: 0, sumLOO: 0, totalStubs: 0, totalWeight: 0, weeksActive: 0,
                    uniqueOOs: new Set(), uniqueLOOs: new Set()
                };
            }

            const drivers = record.numDrivers || 0;
            const driversWeight = drivers > 0 ? drivers : 0; 
            
            dispatcherStats[name].totalGross += (record.pTotal_gross || 0) * drivers;
            dispatcherStats[name].totalMargin += (record.pMargin_dollar || 0) * drivers;
            dispatcherStats[name].totalMiles += (record.pAll_miles || 0) * drivers;
            dispatcherStats[name].totalStubs += drivers;
            dispatcherStats[name].sumOO += (record.numOOs || 0);
            dispatcherStats[name].sumLOO += (record.numLOOs || 0);

            if (record.driverNames && Array.isArray(record.driverNames)) {
                 record.driverNames.forEach(driver => {
                     if (record.numOOs > 0) dispatcherStats[name].uniqueOOs.add(driver);
                     else if (record.numLOOs > 0) dispatcherStats[name].uniqueLOOs.add(driver);
                 });
            }

            if (driversWeight > 0) {
                if (record.mainCriteria !== null) dispatcherStats[name].weightedCriteriaSum += (record.mainCriteria * driversWeight);
                if (record.pMainCriteria2CashFlow !== null) dispatcherStats[name].weightedCompHappy += (record.pMainCriteria2CashFlow * driversWeight);
                if (record.pMainCriteriaNetDriverMargin !== null) dispatcherStats[name].weightedDriverHappy += (record.pMainCriteriaNetDriverMargin * driversWeight);
                if (record.pNet !== null) dispatcherStats[name].weightedNet += (record.pNet * driversWeight);
                if (record.pMargin !== null) dispatcherStats[name].weightedMarginPct += (record.pMargin * driversWeight);
                if (record.pDriverGross !== null) dispatcherStats[name].weightedGrossPct += (record.pDriverGross * driversWeight);
                
                dispatcherStats[name].totalWeight += driversWeight;
            }
            dispatcherStats[name].weeksActive++;
        });

        tableData = Object.values(dispatcherStats).map(d => {
            const weight = d.totalWeight || 1;
            return {
                ...d,
                rpm: d.totalMiles > 0 ? d.totalGross / d.totalMiles : 0,
                avgCriteria: d.totalWeight > 0 ? d.weightedCriteriaSum / weight : 0,
                avgCompHappy: d.totalWeight > 0 ? d.weightedCompHappy / weight : 0,
                avgDriverHappy: d.totalWeight > 0 ? d.weightedDriverHappy / weight : 0,
                avgNet: d.totalWeight > 0 ? d.weightedNet / weight : 0,
                avgMarginPct: d.totalWeight > 0 ? d.weightedMarginPct / weight : 0,
                avgGrossPct: d.totalWeight > 0 ? d.weightedGrossPct / weight : 0,
                totalOO: d.uniqueOOs.size,
                totalLOO: d.uniqueLOOs.size,
                // Placeholder for team mode props
                totalUniqueDrivers: 0
            };
        });
    }

    // 4. Sort Data
    tableData.sort((a, b) => {
        const valA = a[current2025Sort.key];
        const valB = b[current2025Sort.key];
        
        if (typeof valA === 'string') {
             return current2025Sort.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return current2025Sort.direction === 'asc' ? valA - valB : valB - valA;
    });

    // 5. Helper for Headers
    const getSortIcon = (key) => {
        if (current2025Sort.key !== key) return '';
        return current2025Sort.direction === 'asc' ? ' ▲' : ' ▼';
    };

    const headerHTML = (key, label, classes = "") => `
        <th class="px-2 py-3 cursor-pointer select-none hover:bg-gray-800 transition-colors whitespace-nowrap ${classes}" data-sort-key="${key}">
            ${label}${getSortIcon(key)}
        </th>
    `;

    // 6. Render Rows
    let visibleRank = 0;
    const rows = tableData.map((d, index) => {
        // Filter Logic
        let isDimmed = false;
        if (isTeamMode) {
            // Team Mode Filter: Unique Drivers Count
            isDimmed = d.totalUniqueDrivers < filterSettings.minDrivers;
        } else {
            // Dispatcher Mode Filter: Weeks & Stubs
            isDimmed = d.weeksActive < filterSettings.minWeeks || d.totalStubs < filterSettings.minStubs;
        }
        
        if (isFilteredHidden && isDimmed) return '';

        const rowClass = isDimmed ? "opacity-30 grayscale" : "hover:bg-gray-700/50";
        
        let rankDisplay = '-';
        if (!isDimmed) {
            visibleRank++;
            rankDisplay = visibleRank;
        }

        const rankColor = isDimmed ? "text-gray-600" : (visibleRank <= 3 ? 'text-yellow-400 font-bold' : 'text-gray-400 font-mono');

        // Mode-Specific Columns
        let modeColumns = '';
        if (isTeamMode) {
             modeColumns = `<td class="px-2 py-2 text-center text-blue-300 font-mono text-xs">${d.totalUniqueDrivers}</td>`;
        } else {
             modeColumns = `
                <td class="px-2 py-2 text-gray-400 text-xs whitespace-nowrap">${d.team}</td>
                <td class="px-2 py-2 text-center text-gray-300 font-mono text-xs">${d.weeksActive}</td>
                <td class="px-2 py-2 text-center text-indigo-300 font-mono text-xs">${d.totalStubs}</td>
                <td class="px-2 py-2 text-center text-gray-400 font-mono text-xs"><span class="text-blue-300">${d.totalOO}</span> / <span class="text-orange-300">${d.totalLOO}</span></td>
             `;
        }

        return `
            <tr class="${rowClass} border-b border-gray-700 last:border-0 transition-all duration-300">
                <td class="px-2 py-2 text-center ${rankColor} text-xs">${rankDisplay}</td>
                <td class="px-2 py-2 font-bold text-white text-xs whitespace-nowrap">${d.name}</td>
                ${modeColumns}
                <td class="px-2 py-2 text-right text-green-400 font-mono text-xs">$${d.totalGross.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                <td class="px-2 py-2 text-right text-yellow-400 font-mono text-xs">$${d.totalMargin.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                <td class="px-2 py-2 text-right text-blue-300 font-mono text-xs">${d.totalMiles.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                <td class="px-2 py-2 text-right text-purple-300 font-mono text-xs">$${d.rpm.toFixed(2)}</td>
                
                <td class="px-2 py-2 text-center text-gray-300 font-mono text-xs">${(d.avgNet * 100).toFixed(1)}%</td>
                <td class="px-2 py-2 text-center text-gray-300 font-mono text-xs">${(d.avgMarginPct * 100).toFixed(1)}%</td>
                <td class="px-2 py-2 text-center text-gray-300 font-mono text-xs">${(d.avgGrossPct * 100).toFixed(1)}%</td>
                
                <td class="px-2 py-2 text-center text-indigo-300 font-mono text-xs">${(d.avgCompHappy * 100).toFixed(1)}%</td>
                <td class="px-2 py-2 text-center text-pink-300 font-mono text-xs">${(d.avgDriverHappy * 100).toFixed(1)}%</td>
                <td class="px-2 py-2 text-center text-white font-bold font-mono text-xs bg-gray-700/30 border-l border-gray-600">${(d.avgCriteria * 100).toFixed(1)}%</td>
            </tr>
        `;
    }).join('');

    // Filter Inputs based on Mode
    let filterInputsHTML = '';
    if (isTeamMode) {
        filterInputsHTML = `
            <div class="flex items-center gap-2">
                <label class="text-xs text-gray-400 font-bold uppercase">Min Drivers</label>
                <input type="number" id="filter-min-drivers" value="${filterSettings.minDrivers}" class="w-16 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-teal-500 text-center">
            </div>
        `;
    } else {
        filterInputsHTML = `
            <div class="flex items-center gap-2">
                <label class="text-xs text-gray-400 font-bold uppercase">Min Weeks</label>
                <input type="number" id="filter-min-weeks" value="${filterSettings.minWeeks}" class="w-16 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-teal-500 text-center">
            </div>
            <div class="w-px h-6 bg-gray-700"></div>
            <div class="flex items-center gap-2">
                <label class="text-xs text-gray-400 font-bold uppercase">Min Stubs</label>
                <input type="number" id="filter-min-stubs" value="${filterSettings.minStubs}" class="w-16 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-teal-500 text-center">
            </div>
        `;
    }

    // Headers based on Mode
    let specificHeadersHTML = '';
    if (isTeamMode) {
        specificHeadersHTML = headerHTML('totalUniqueDrivers', 'Total Drivers', 'text-center');
    } else {
        specificHeadersHTML = `
            ${headerHTML('team', 'Team')}
            ${headerHTML('weeksActive', 'Wks', 'text-center')}
            ${headerHTML('totalStubs', 'Stubs', 'text-center')}
            <th class="px-2 py-3 text-center text-gray-400">OO / LOO</th>
        `;
    }

    // 7. Assemble Modal HTML
    modal.innerHTML = `
        <div class="bg-gray-800 border-2 border-gray-700 rounded-2xl shadow-2xl w-full max-w-[1500px] max-h-[90vh] flex flex-col animate-fade-in-up">
            <div class="flex flex-col md:flex-row justify-between items-center p-5 border-b border-gray-700 bg-gray-800/50 gap-4">
                <div class="flex items-center gap-3">
                    <div class="p-2 bg-indigo-500/20 rounded-lg text-indigo-400">
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                        </svg>
                    </div>
                    <div>
                        <h2 class="text-xl font-bold text-white">2025 ${isTeamMode ? 'Team' : 'Dispatcher'} Performance</h2>
                        <p class="text-xs text-gray-400">Aggregated totals and weighted averages for the year 2025</p>
                    </div>
                </div>

                <div class="flex items-center gap-4">
                    <div class="flex items-center gap-4 bg-gray-900/50 p-2 rounded-lg border border-gray-700">
                        ${filterInputsHTML}
                    </div>
                    <button id="toggle-filter-visibility-btn" class="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-xs font-semibold text-gray-300 hover:text-white hover:bg-gray-600 transition-colors">
                        ${isFilteredHidden ? 'Show Filtered' : 'Hide Filtered'}
                    </button>
                </div>

                <button id="close-2025-btn" class="text-gray-400 hover:text-white transition-colors text-2xl p-1 hover:bg-gray-700 rounded-lg">&times;</button>
            </div>
            
            <div class="overflow-auto flex-grow p-0 custom-scrollbar">
                <table class="w-full text-left border-collapse">
                    <thead class="bg-gray-900 text-xs uppercase text-gray-400 sticky top-0 z-10 font-bold shadow-sm">
                        <tr>
                            <th class="px-2 py-3 text-center w-8">#</th>
                            ${headerHTML('name', isTeamMode ? 'Team' : 'Dispatcher')}
                            ${specificHeadersHTML}
                            ${headerHTML('totalGross', 'Gross', 'text-right')}
                            ${headerHTML('totalMargin', 'Margin', 'text-right')}
                            ${headerHTML('totalMiles', 'Miles', 'text-right')}
                            ${headerHTML('rpm', 'RPM', 'text-right')}
                            
                            ${headerHTML('avgNet', 'Net %', 'text-center')}
                            ${headerHTML('avgMarginPct', 'Marg %', 'text-center')}
                            ${headerHTML('avgGrossPct', 'Gross %', 'text-center')}
                            ${headerHTML('avgCompHappy', 'Comp. Happy', 'text-center')}
                            ${headerHTML('avgDriverHappy', 'Drv. Happy', 'text-center')}
                            ${headerHTML('avgCriteria', 'Criteria', 'text-center text-white border-l border-gray-700')}
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-700 bg-gray-800/50">
                        ${rows}
                    </tbody>
                </table>
            </div>
            
            <div class="p-4 border-t border-gray-700 bg-gray-900/30 text-right text-xs text-gray-500 rounded-b-2xl">
                Data derived from historical weekly records. ${isTeamMode ? 'Team data includes calculated aggregates and spreadsheet rankings.' : 'Dispatcher data filtered by unique drivers.'}
            </div>
        </div>
    `;

    // 8. Attach Listeners
    document.getElementById('close-2025-btn').onclick = () => modal.classList.add('hidden');

    const headers = modal.querySelectorAll('th[data-sort-key]');
    headers.forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sortKey;
            if (current2025Sort.key === key) {
                current2025Sort.direction = current2025Sort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                current2025Sort.key = key;
                current2025Sort.direction = 'desc'; 
            }
            renderYear2025Content(modal);
        });
    });

    // Filter Change Listeners
    if (isTeamMode) {
        const driversInput = document.getElementById('filter-min-drivers');
        driversInput.addEventListener('change', (e) => {
            filterSettings.minDrivers = parseInt(e.target.value) || 0;
            renderYear2025Content(modal);
        });
    } else {
        const weekInput = document.getElementById('filter-min-weeks');
        const stubInput = document.getElementById('filter-min-stubs');
        const toggleVisibilityBtn = document.getElementById('toggle-filter-visibility-btn');
        
        weekInput.addEventListener('change', (e) => {
            filterSettings.minWeeks = parseInt(e.target.value) || 0;
            renderYear2025Content(modal);
        });

        stubInput.addEventListener('change', (e) => {
            filterSettings.minStubs = parseInt(e.target.value) || 0;
            renderYear2025Content(modal);
        });
    }

    document.getElementById('toggle-filter-visibility-btn').addEventListener('click', () => {
        isFilteredHidden = !isFilteredHidden;
        renderYear2025Content(modal);
    });
};