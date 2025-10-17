// DISPATCH TESTER/loads/loads_ui.js
import { appState, setDraggedLoadsFilterId, updateLoadsFilterOrder, addOrUpdateLoadsFilter, deleteLoadsFilter, setLoadsSettingsModalOpen, setLoadsCustomFilterModalOpen, setEditingLoadsFilterId } from '../state.js';
import { renderUI as renderRankingsUI } from '../rankings/rankings_ui.js';
import { formatUtcToSheetTime, calculateMedian } from '../utils.js';
import { renderPrimaryMap, renderComparisonMap } from './loads_maps.js';


const getCompositeTeamName = (load) => {
    if (!load || !load.team) return null;
    const specialPrefixes = ['agnius', 'miles', 'uros'];
    const teamLower = load.team.toLowerCase();
    const prefix = specialPrefixes.find(p => teamLower.startsWith(p));
    
    if (prefix && load.company_name) {
        return `${prefix.charAt(0).toUpperCase() + prefix.slice(1)} ${load.company_name}`;
    }
    return load.team;
};

// --- CONFIGURATION ---

// Defines all possible columns for the loads table. This is the single source of truth.
const LOADS_TABLE_COLUMNS = [
    { id: 'id', label: 'ID', type: 'number' },
    { id: 'price', label: 'Price', type: 'number' },
    { id: 'pu_date', label: 'PU Date', type: 'date' },
    { id: 'do_date', label: 'DO Date', type: 'date' },
    { id: 'pu_location', label: 'Pick-up', type: 'string' },
    { id: 'do_location', label: 'Drop-off', type: 'string' },
    { id: 'start_location', label: 'Start Location', type: 'string', isCalculated: true },
    { id: 'deadhead_miles', label: 'Deadhead Miles', type: 'number' },
    { id: 'trip_miles', label: 'Trip Miles', type: 'number' },
    { id: 'rpm', label: 'RPM', type: 'number', isCalculated: true },
    { id: 'driver', label: 'Driver', type: 'string' },
    { id: 'dispatcher', label: 'Dispatcher', type: 'string' },
    { id: 'team', label: 'Team', type: 'string' },
    { id: 'status', label: 'Status', type: 'string' },
    { id: 'status_modified_dt', label: 'Status Modified', type: 'date' },
    { id: 'delivered_at', label: 'Delivered At', type: 'date' },
    { id: 'weight', label: 'Weight', type: 'number' },
    { id: 'commodity', label: 'Commodity', type: 'string' },
    { id: 'load_type', label: 'Load Type', type: 'string' },
    { id: 'pu_type', label: 'PU Type', type: 'string' },
    { id: 'do_type', label: 'DO Type', type: 'string' },
    { id: 'fuel_surcharge', label: 'Fuel Surcharge', type: 'number' },
    { id: 'layover_amount', label: 'Layover', type: 'number' },
    { id: 'detention_amount', label: 'Detention', type: 'number' },
    { id: 'cut', label: 'Cut', type: 'number' },
    { id: 'flags', label: 'Flags', type: 'string', isCalculated: true, width: 'w-64' },
    { id: 'expected_fuel_cost', label: 'Expected Fuel Cost', type: 'number' },
    { id: 'expected_tolls', label: 'Expected Tolls', type: 'number' },
    { id: 'contract_type', label: 'Contract Type', type: 'string' },
    { id: 'truck_days_in_status', label: 'Truck Days In Status', type: 'number' },
    { id: 'driver_days_in_status', label: 'Driver Days In Status', type: 'number' },
    { id: 'gross_total', label: 'Total Gross', type: 'number' },
];

const LOAD_FILTER_COLUMNS = [
    { id: 'id', label: 'ID', type: 'number' },
    { id: 'price', label: 'Price', type: 'number' },
    { id: 'pu_location', label: 'Pick-up Location', type: 'string' },
    { id: 'pu_zipcode', label: 'Pick-up Zip', type: 'string' },
    { id: 'pu_date', label: 'Pick-up Date', type: 'date' },
    { id: 'pu_type', label: 'PU Type', type: 'string' },
    { id: 'do_location', label: 'Drop-off Location', type: 'string' },
    { id: 'do_zipcode', label: 'Drop-off Zip', type: 'string' },
    { id: 'do_date', label: 'Drop-off Date', type: 'date' },
    { id: 'do_type', label: 'DO Type', type: 'string' },
    { id: 'deadhead_miles', label: 'Deadhead Miles', type: 'number' },
    { id: 'trip_miles', label: 'Trip Miles', type: 'number' },
    { id: 'weight', label: 'Weight', type: 'number' },
    { id: 'commodity', label: 'Commodity', type: 'string' },
    { id: 'status', label: 'Status', type: 'string' },
    { id: 'status_modified_dt', label: 'Status Modified', type: 'date' },
    { id: 'delivered_at', label: 'Delivered At', type: 'date' },
    { id: 'driver', label: 'Driver', type: 'string' },
    { id: 'dispatcher', label: 'Dispatcher', type: 'string' },
    { id: 'team', label: 'Team', type: 'string' },
    { id: 'rpm', label: 'RPM', type: 'number', isCalculated: true },
    { id: 'load_type', label: 'Load Type', type: 'string' },
    { id: 'fuel_surcharge', label: 'Fuel Surcharge', type: 'number' },
    { id: 'layover_amount', label: 'Layover', type: 'number' },
    { id: 'detention_amount', label: 'Detention', type: 'number' },
    { id: 'wellness_status', label: 'Wellness Status', type: 'string' },
    { id: 'expected_fuel_cost', label: 'Expected Fuel Cost', type: 'number' },
    { id: 'expected_tolls', label: 'Expected Tolls', type: 'number' },
    { id: 'contract_type', label: 'Contract Type', type: 'multiselect', optionsSource: 'contractTypes' },
    { id: 'truck_days_in_status', label: 'Truck Days In Status', type: 'number' },
    { id: 'driver_days_in_status', label: 'Driver Days In Status', type: 'number' },
    { id: 'gross_total', label: 'Total Gross', type: 'number' },
    { id: 'flags', label: 'Flags', type: 'multiselect', optionsSource: 'flagTypes' },
];


// --- START: New Summary Card Logic ---

// Calculation functions for each card type
const calculateSummaryData = (loads, filterFn) => {
    const filteredLoads = loads.filter(load => filterFn(load, appState.loads.data));
    return filteredLoads.reduce((acc, load) => {
        const team = load.team || 'No Team';
        const contractType = load.contract_type || 'Unknown';
        if (!acc[team]) acc[team] = {};
        if (!acc[team][contractType]) acc[team][contractType] = 0;
        acc[team][contractType]++;
        return acc;
    }, {});
};

// Generic function to render any summary card
const renderSummaryCard = (config) => {
    const card = document.getElementById(config.id);
    if (!card) return;

    // Generate the inner HTML structure for the card
    card.innerHTML = `
        <div class="card-header">
            <div id="${config.id}-title-container" class="relative">
                <h3 id="${config.id}-title" class="dropdown-title card-title">
                    <span>${config.title}</span>
                    ${config.views ? `<svg class="dropdown-arrow" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>` : ''}
                </h3>
                ${config.views ? `
                    <div id="${config.id}-dropdown" class="dropdown-panel hidden">
                        ${Object.entries(config.views).map(([key, value]) => `<a href="#" class="dropdown-item" data-view="${key}">${value}</a>`).join('')}
                    </div>
                ` : ''}
            </div>
        </div>
        <div class="card-content">
            <div id="${config.id}-table" class="summary-card-table"></div>
        </div>
    `;

    const tableContainer = document.getElementById(`${config.id}-table`);
    const titleEl = document.getElementById(`${config.id}-title`)?.querySelector('span');
    const dropdown = document.getElementById(`${config.id}-dropdown`);

    const dateFilteredLoads = getLoadsInDateRange();
    
    let summaryData;
    let currentView = null;

    if (config.views) {
        currentView = appState.loads[config.viewStateKey];
        summaryData = config.calculationFn(dateFilteredLoads, currentView);
        titleEl.textContent = config.views[currentView];
        dropdown.querySelectorAll('.dropdown-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === currentView);
        });
    } else {
        summaryData = config.calculationFn(dateFilteredLoads, config.filterFn);
    }
    
    const teams = Object.keys(summaryData).sort();
    const contractTypes = [...new Set(Object.values(summaryData).flatMap(teamData => Object.keys(teamData)))].sort();

    if (teams.length === 0) {
        tableContainer.innerHTML = `<p class="text-gray-400 text-center p-4">No loads match the criteria.</p>`;
        return;
    }

    const allCellCounts = teams.flatMap(team => contractTypes.map(type => summaryData[team][type] || 0)).filter(count => count > 0);
    let cellThreshold = null;
    if (allCellCounts.length > 3) {
        allCellCounts.sort((a, b) => a - b);
        cellThreshold = allCellCounts[Math.floor(0.85 * allCellCounts.length)];
    }

    const allTotals = teams.map(team => Object.values(summaryData[team]).reduce((sum, count) => sum + count, 0)).filter(total => total > 0);
    let totalThreshold = null;
    if (allTotals.length > 3) {
        allTotals.sort((a, b) => a - b);
        totalThreshold = allTotals[Math.floor(0.85 * allTotals.length)];
    }

    let tableHTML = `
        <table class="w-full text-xs text-left text-gray-400">
            <thead class="text-xs text-gray-300 uppercase">
                <tr>
                    <th scope="col" class="px-3 py-2">Team</th>
                    ${contractTypes.map(type => `<th scope="col" class="px-3 py-2">${type}</th>`).join('')}
                    <th scope="col" class="px-3 py-2">Total</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-700">
                ${teams.map(team => {
                    let total = 0;
                    const rowData = contractTypes.map(type => {
                        const count = summaryData[team][type] || 0;
                        total += count;
                        let tdClass = '';
                        if (count === 0) tdClass = 'is-zero';
                        else if (cellThreshold && count >= cellThreshold) tdClass = 'is-high-value';
                        return `<td class="px-3 py-2 text-center ${tdClass}">${count}</td>`;
                    }).join('');
                    let totalTdClass = 'font-bold';
                    if (total === 0) totalTdClass = 'is-zero';
                    else if (totalThreshold && total >= totalThreshold) totalTdClass = 'is-high-value font-bold';
                    return `
                        <tr class="hover:bg-gray-700/50">
                            <td class="px-3 py-2 font-bold">${team}</td>
                            ${rowData}
                            <td class="px-3 py-2 text-center ${totalTdClass}">${total}</td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;

    tableContainer.innerHTML = tableHTML;
};

const debounce = (func, delay) => {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
};

const getLoadsInDateRange = () => {
    const startDateInput = document.getElementById('loads-start-date');
    const endDateInput = document.getElementById('loads-end-date');

    if (!startDateInput || !endDateInput || !startDateInput.value || !endDateInput.value) {
        return appState.loads.data || [];
    }

    const startDateString = startDateInput.value;
    const endDateString = endDateInput.value;

    return (appState.loads.data || []).filter(load => {
        if (!load.pu_date) return false;
        const loadPuDateString = load.pu_date.split('T')[0];
        return loadPuDateString >= startDateString && loadPuDateString <= endDateString;
    });
};

// --- RENDER FUNCTIONS ---

const updateSearchComponent = () => {
    const trigger = document.getElementById('loads-search-column-trigger');
    const panel = document.getElementById('loads-search-column-panel');
    if (!trigger || !panel) return;

    const searchableColumns = LOADS_TABLE_COLUMNS.filter(c => !c.isCalculated || ['rpm', 'flags'].includes(c.id));
    const allColsOption = { id: 'all', label: 'All Visible Columns' };
    const options = [allColsOption, ...searchableColumns];
    const selectedColumnId = appState.loads.searchColumn;
    const selectedColumn = options.find(c => c.id === selectedColumnId) || allColsOption;

    trigger.querySelector('.column-name').textContent = selectedColumn.label;
    trigger.querySelector('.column-name').title = selectedColumn.label;

    panel.querySelectorAll('.column-panel-item').forEach(item => {
        const isSelected = item.dataset.colId === selectedColumnId;
        item.classList.toggle('selected', isSelected);
        const checkmark = item.querySelector('svg');
        if (isSelected && !checkmark) {
            item.insertAdjacentHTML('beforeend', '<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.052-.143z" clip-rule="evenodd" /></svg>');
        } else if (!isSelected && checkmark) {
            checkmark.remove();
        }
    });
};

export const renderLoadsAnalyticsUI = () => {
    const dateFilteredLoads = getLoadsInDateRange();
    const allRpms = (dateFilteredLoads || []).map(load => parseFloat(load.rpm_all)).filter(rpm => !isNaN(rpm) && rpm > 0);
    const universalMedianRpm = calculateMedian(allRpms);
    const activeDashboardView = appState.loads.analyticsDashboardView;

    // Update main dashboard switcher buttons
    document.querySelectorAll('#dashboard-switcher .switcher-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === activeDashboardView);
    });

    // Show/hide main dashboard content
    document.querySelectorAll('.dashboard-view').forEach(view => {
        const isDeepDive = view.id === 'deep-dive-dashboard';
        view.style.display = view.id === `${activeDashboardView}-dashboard` ? (isDeepDive ? 'flex' : 'block') : 'none';
    });

    // If deep dive is active, render it. Otherwise, handle the placeholder.
    if (activeDashboardView === 'deep-dive') {
        if (appState.loads.deepDiveSelection) {
            renderDeepDiveDashboard();
        } else {
            const container = document.getElementById('deep-dive-dashboard');
            if (container) {
                container.innerHTML = `
                    <div class="flex flex-col items-center justify-center h-full text-gray-500">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <h3 class="text-xl font-semibold">Select a Region</h3>
                        <p>Click on a state or cluster on the maps to begin your deep dive.</p>
                    </div>
                `;
            }
        }
    }

    const liveData = appState.loads.data || [];

    const primaryMapContainer = document.getElementById('primary-map-container');
    if (primaryMapContainer) {
        renderPrimaryMap(primaryMapContainer, liveData, universalMedianRpm);
    }

    const secondaryMapContainer = document.getElementById('secondary-map-container');
    if (secondaryMapContainer) {
        renderComparisonMap(secondaryMapContainer, liveData, universalMedianRpm);
    }
    renderMapFilterPopups();
};

export const renderLoadsUI = () => {
    const dateFilteredLoads = getLoadsInDateRange();
    renderSavedFilters(dateFilteredLoads);
    updateSearchComponent();
    renderLoadsTable();
    renderLoadsModals();

    // Render all summary cards
    renderSummaryCard({
        id: 'moved-loads-summary-card',
        calculationFn: calculateMovedLoadsSummary,
        views: { all: 'All Moved Loads', good: 'Good Moves', bad: 'Bad Moves' },
        viewStateKey: 'movedLoadsSummaryView'
    });
    renderSummaryCard({
        id: 'hidden-mileage-summary-card',
        title: 'Hidden Mileage Summary',
        calculationFn: calculateSummaryData,
        filterFn: checkHiddenMiles
    });
    renderSummaryCard({
        id: 'not-closed-summary-card',
        title: 'Not Closed Loads Summary',
        calculationFn: calculateSummaryData,
        filterFn: checkNotClosedLoad
    });
    renderSummaryCard({
        id: 'low-rpm-summary-card',
        title: 'Low RPM Loads Summary',
        calculationFn: calculateSummaryData,
        filterFn: checkLowRpmLoad
    });
};

// NEW: Function to check for New Start Driver
function checkNewStartDriver(load, allLoads) {
    if (!load.driver || !load.do_date) return false;

    const currentDoDate = new Date(load.do_date);

    // Get the day of the week (0 for Sunday, 1 for Monday, etc.)
    const dayOfWeek = currentDoDate.getUTCDay();

    // Calculate the Monday of the current payroll week
    const mondayOfCurrentWeek = new Date(currentDoDate);
    const daysToSubtractForMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    mondayOfCurrentWeek.setUTCDate(currentDoDate.getUTCDate() - daysToSubtractForMonday);
    mondayOfCurrentWeek.setUTCHours(0, 0, 0, 0);

    // Calculate the Tuesday of the current payroll week (start of the week)
    const tuesdayOfCurrentWeek = new Date(mondayOfCurrentWeek);
    tuesdayOfCurrentWeek.setUTCDate(mondayOfCurrentWeek.getUTCDate() - 6);


    // Previous payroll week (ends on the Monday before the current payroll week's Tuesday)
    const mondayOfPreviousWeek = new Date(tuesdayOfCurrentWeek);
    mondayOfPreviousWeek.setUTCDate(tuesdayOfCurrentWeek.getUTCDate() - 1);


    // Start of the previous payroll week
    const tuesdayOfPreviousWeek = new Date(mondayOfPreviousWeek);
    tuesdayOfPreviousWeek.setUTCDate(mondayOfPreviousWeek.getUTCDate() - 6);


    const driverLoads = allLoads.filter(l => l.driver === load.driver && l.do_date);

    const hasLoadsInPreviousWeek = driverLoads.some(l => {
        const doDate = new Date(l.do_date);
        return doDate >= tuesdayOfPreviousWeek && doDate <= mondayOfPreviousWeek;
    });

    if (hasLoadsInPreviousWeek) return false;

    const hasLoadsInCurrentWeek = driverLoads.some(l => {
        const doDate = new Date(l.do_date);
        return doDate >= tuesdayOfCurrentWeek && doDate <= mondayOfCurrentWeek;
    });


    return hasLoadsInCurrentWeek;
}


const renderSavedFilters = (loadsToCount) => {
    const allLoads = loadsToCount || [];
    // MODIFICATION: Get the full dataset to use for history-dependent checks.
    const fullDataset = appState.loads.data || []; 
    
    // MODIFICATION: Pass the full dataset to functions that need complete driver history.
    const movedLoadsCount = allLoads.filter(l => checkMovedLoad(l)).length;
    const hiddenMilesCount = allLoads.filter(l => checkHiddenMiles(l, fullDataset)).length;
    const notClosedCount = allLoads.filter(l => checkNotClosedLoad(l)).length;
    const lowRpmCount = allLoads.filter(l => checkLowRpmLoad(l)).length;
    const mondaysMovedLoadsCount = allLoads.filter(l => checkMondaysMovedLoad(l)).length;
    const newStartCount = allLoads.filter(l => checkNewStartDriver(l, fullDataset)).length;

    const filtersToRender = appState.loads.filterOrder
        .filter(filterId => appState.loads.visibleFilterIds.includes(filterId))
        .map(filterId => {
            const filter = appState.loads.savedFilters.find(f => f.id === filterId);
            if (!filter) return null;

            let count = 0;
            switch (filter.id) {
                case 'moved_loads': count = movedLoadsCount; break;
                case 'hidden_miles': count = hiddenMilesCount; break;
                case 'not_closed': count = notClosedCount; break;
                case 'low_rpm': count = lowRpmCount; break;
                case 'late_assign': count = allLoads.length; break;
                case 'mondays_moved_loads': count = mondaysMovedLoadsCount; break;
                case 'new_start': count = newStartCount; break;
                default:
                    const filteredCustomLoads = applyLoadsFilters(allLoads, filter.id);
                    count = filteredCustomLoads.length;
            }
            return { ...filter, count };
        }).filter(Boolean);

    const container = document.getElementById('saved-filters-bar');
    if (!container) return;
    container.innerHTML = filtersToRender.map(filter => {
        const isActive = appState.loads.activeFilterId === filter.id;
        const isDefault = !filter.id.startsWith('custom_');

        let styleOverrides = '';
        if (!isDefault && filter.color && filter.color.startsWith('#')) {
            if (isActive) {
                styleOverrides = `style="background-color: ${filter.color}; border-color: ${filter.color}; color: white;"`;
            } else {
                styleOverrides = `style="border-color: ${filter.color}; color: ${filter.color};"`;
            }
        }

        if (isDefault) {
            return `
            <button data-filter-id="${filter.id}"
                    class="saved-filter-btn ${isActive ? 'active' : ''}"
                    data-color="${filter.color || 'gray'}">
                <span class="font-bold">${filter.count}</span>
                <span class="text-sm">${filter.name}</span>
            </button>`;
        } else {
            const draggableAttribute = 'draggable="true"';
            return `
            <div class="custom-filter-wrapper ${isActive ? 'is-active' : ''}" 
                 data-color="${filter.color || 'gray'}" 
                 ${draggableAttribute} 
                 data-filter-id="${filter.id}">
                
                <button class="saved-filter-btn saved-filter-main" 
                        data-filter-id="${filter.id}" 
                        ${styleOverrides}>
                    <span class="font-bold">${filter.count}</span>
                    <span class="text-sm">${filter.name}</span>
                </button>

                <div class="filter-actions-menu-container ${!isActive ? 'hidden' : ''}">
                    <button class="filter-actions-trigger" ${styleOverrides}>☰</button>
                    <div class="filter-actions-panel hidden">
                        <button class="filter-action-item edit-loads-filter-btn" data-filter-id="${filter.id}">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                            Edit
                        </button>
                        <button class="filter-action-item delete-loads-filter-btn" data-filter-id="${filter.id}">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            Delete
                        </button>
                    </div>
                </div>
            </div>`;
        }
    }).join('');

    addEventListenersToFilterButtons();
};

const renderLoadsTable = () => {
    const container = document.getElementById('loads-table-container');
    if (!container) return;

    const visibleColumns = appState.loads.columnOrder
        .map(id => LOADS_TABLE_COLUMNS.find(col => col.id === id))
        .filter(col => col && appState.loads.visibleColumnIds.includes(col.id));

    // MODIFICATION: Check the active filter type BEFORE getting the initial data.
    const currentActiveFilter = appState.loads.savedFilters.find(f => f.id === appState.loads.activeFilterId);
    const isTodayFilter = currentActiveFilter?.criteria?.some(c => c.operator === 'inPrevious' && c.value.from === 'today');

    // If a 'today' filter is active, use the full dataset. Otherwise, use the date range pickers.
    const allLoads = isTodayFilter ? (appState.loads.data || []) : getLoadsInDateRange();
    const fullDataset = appState.loads.data || [];
    
    let filteredLoads = currentActiveFilter ? applyLoadsFilters(allLoads, currentActiveFilter.id) : allLoads;

    const searchInput = document.getElementById('loads-master-search-input');
    const searchTerm = searchInput?.value.toLowerCase() || '';
    const searchColumn = appState.loads.searchColumn;

    if (searchTerm) {
        const visibleColumnIds = LOADS_TABLE_COLUMNS.filter(c => appState.loads.visibleColumnIds.includes(c.id)).map(c => c.id);

        filteredLoads = filteredLoads.filter(load => {
            const columnsToSearch = searchColumn === 'all' ? visibleColumnIds : [searchColumn];
            
            return columnsToSearch.some(colId => {
                const columnDef = LOADS_TABLE_COLUMNS.find(c => c.id === colId);
                let cellValue = '';
                const rawValue = load[colId];
                if (rawValue === null || rawValue === undefined) return false;

                if (columnDef.isCalculated) {
                     switch (colId) {
                        case 'start_location':
                            const city = load.start_location_city || '';
                            const state = load.start_location_state || '';
                            cellValue = `${city}, ${state}`.replace(/^, |, $/g, '');
                            break;
                        case 'rpm':
                            cellValue = calculateRPM(load.price, load.trip_miles).toFixed(2);
                            break;
                        case 'flags':
                            let flagsText = '';
                            if (checkMovedLoad(load)) flagsText += 'Moved ';
                            if (checkHiddenMiles(load, fullDataset)) flagsText += 'Hidden Mileage ';
                            if (checkNotClosedLoad(load)) flagsText += 'Not Closed ';
                            if (checkLowRpmLoad(load)) flagsText += 'Low RPM ';
                            if (checkMondaysMovedLoad(load)) flagsText += "Monday's Moved Loads ";
                            if (checkNewStartDriver(load, fullDataset)) flagsText += "New Start ";
                            cellValue = flagsText.trim();
                            break;
                    }
                } else if (columnDef.type === 'date') {
                    cellValue = formatUtcToSheetTime(rawValue, appState.loads.spreadsheetTimezone);
                } else {
                    cellValue = String(rawValue);
                }
                
                return cellValue.toLowerCase().includes(searchTerm);
            });
        });
    }

    const { key: sortKey, direction: sortDir } = appState.loads.sortConfig;
    const sortedLoads = [...filteredLoads].sort((a, b) => {
        let valA = a[sortKey];
        let valB = b[sortKey];
        if (sortKey === 'rpm') {
            valA = calculateRPM(a.price, a.trip_miles);
            valB = calculateRPM(b.price, b.trip_miles);
        }
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        if (valA < valB) return sortDir === 'ascending' ? -1 : 1;
        if (valA > valB) return sortDir === 'ascending' ? 1 : -1;
        return 0;
    });

    const { currentPage, rowsPerPage } = appState.loads;
    const totalRows = sortedLoads.length;
    const totalPages = Math.ceil(totalRows / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    const paginatedLoads = sortedLoads.slice(startIndex, endIndex);

    const getSortIcon = (key) => {
        if (sortKey !== key) return '';
        return sortDir === 'ascending' ? ' ▲' : ' ▼';
    };

    const headersHTML = visibleColumns.map(col =>
        `<th scope="col" class="px-3 py-2 cursor-pointer select-none bg-gray-900" 
             draggable="true" 
             data-col-id="${col.id}"
             onclick="requestLoadsSort('${col.id}')">
            ${col.label}${getSortIcon(col.id)}
        </th>`
    ).join('');

    const rowsHTML = paginatedLoads.map(load => {
        const cellsHTML = visibleColumns.map(col => {
            let cellValue = load[col.id] ?? '-';
            let finalCellContent;
            switch (col.id) {
                case 'gross_total':
                case 'price':
                case 'price_total':
                case 'fuel_surcharge':
                case 'layover_amount':
                case 'detention_amount':
                case 'cut':
                    finalCellContent = `<span class="font-bold text-green-400">$${load[col.id] || '0'}</span>`; 
                    break;
                case 'start_location':
                    const city = load.start_location_city || '';
                    const state = load.start_location_state || '';
                    finalCellContent = `${city}, ${state}`.replace(/^, |, $/g, '');
                    break;
                case 'pu_date':
                    if (load.pu_date && load.pu_time) {
                        const fullPuDate = `${load.pu_date.split('T')[0]}T${load.pu_time}`;
                        finalCellContent = formatUtcToSheetTime(fullPuDate, appState.loads.spreadsheetTimezone);
                    } else {
                        finalCellContent = formatUtcToSheetTime(load.pu_date, appState.loads.spreadsheetTimezone);
                    }
                    break;
                case 'do_date':
                    if (load.do_date && load.do_time) {
                        const fullDoDate = `${load.do_date.split('T')[0]}T${load.do_time}`;
                        finalCellContent = formatUtcToSheetTime(fullDoDate, appState.loads.spreadsheetTimezone);
                    } else {
                        finalCellContent = formatUtcToSheetTime(load.do_date, appState.loads.spreadsheetTimezone);
                    }
                    break;
                case 'status_modified_dt':
                case 'delivered_at':
                    finalCellContent = formatUtcToSheetTime(load[col.id], appState.loads.spreadsheetTimezone);
                    break;
                case 'rpm': 
                    finalCellContent = calculateRPM(load.price, load.trip_miles).toFixed(2); 
                    break;
                case 'flags': 
                    finalCellContent = getFlagsHTML(load, fullDataset);
                    break;
                default:
                    finalCellContent = cellValue;
            }

            if (col.id === 'pu_location') {
                const lastLocation = getLastDeliveryLocation(load.driver, load, fullDataset);
                return `<td class="px-3 py-2 whitespace-nowrap"><span class="tooltip-container" data-tooltip="Last DO: ${lastLocation}">${finalCellContent}</span></td>`;
            }
            const colWidthClass = LOADS_TABLE_COLUMNS.find(c => c.id === col.id)?.width || '';
            return `<td class="px-3 py-2 whitespace-nowrap ${colWidthClass}">${finalCellContent}</td>`;
        }).join('');
        return `<tr class="hover:bg-gray-700/50">${cellsHTML}</tr>`;
    }).join('');

    container.innerHTML = `
        <table class="w-full text-xs text-left text-gray-400">
            <thead class="text-xs text-gray-300 uppercase">
                <tr>${headersHTML}</tr>
            </thead>
            <tbody class="divide-y divide-gray-700">
                ${rowsHTML.length > 0 ? rowsHTML : `<tr><td colspan="${visibleColumns.length}" class="px-4 py-3 text-center text-gray-500">No loads found for this filter.</td></tr>`}
            </tbody>
        </table>
    `;

    renderPaginationControls(currentPage, totalPages, totalRows);
    addDragDropToTableHeaders();
};

const renderLoadsModals = () => {
    const settingsModal = document.getElementById('loads-settings-modal');
    const customFilterModal = document.getElementById('add-custom-load-filter-modal');

    if (settingsModal) {
        settingsModal.classList.toggle('hidden', !appState.loads.isSettingsModalOpen);
        if (appState.loads.isSettingsModalOpen) {
            document.getElementById('moved-load-threshold-input').value = appState.loads.movedLoadThreshold;
            document.getElementById('not-closed-days-threshold-input').value = appState.loads.notClosedDaysThreshold;
            document.getElementById('low-rpm-threshold-input').value = appState.loads.lowRpmThreshold;
            renderGoodMoveThresholdSettings(); // <-- MODIFIED
            renderFilterVisibilitySettings();
            renderColumnSettings();
        }
    }

    if (customFilterModal) {
        customFilterModal.classList.toggle('hidden', !appState.loads.isCustomFilterModalOpen);
        if (appState.loads.isCustomFilterModalOpen) {
            const filterToEdit = appState.loads.editingFilterId
                ? appState.loads.savedFilters.find(f => f.id === appState.loads.editingFilterId)
                : null;
            populateCustomFilterModal(filterToEdit);
        }
    }
};

const renderPaginationControls = (currentPage, totalPages, totalRows) => {
    const container = document.getElementById('loads-pagination-controls');
    if (!container) return;

    if (totalRows <= 0) {
        container.innerHTML = '';
        return;
    }

    const { rowsPerPage } = appState.loads;
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, totalRows);

    const changePage = (newPage) => {
        if (newPage >= 1 && newPage <= totalPages) {
            appState.loads.currentPage = newPage;
            renderLoadsTable();
        }
    };

    const changeRowsPerPage = (num) => {
        appState.loads.rowsPerPage = parseInt(num, 10);
        appState.loads.currentPage = 1;
        renderLoadsTable();
    };

    window.changeLoadsPage = changePage;
    window.changeLoadsRowsPerPage = changeRowsPerPage;

    const rowsPerPageOptions = [15, 25, 50, 100];

    container.innerHTML = `
        <div class="pagination-controls-wrapper">
            <span class="pagination-label">Rows per page:</span>
            <div class="pagination-select-container">
                <select class="pagination-select" onchange="changeLoadsRowsPerPage(this.value)">
                    ${rowsPerPageOptions.map(opt => `<option value="${opt}" ${rowsPerPage === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                </select>
            </div>
            <span class="pagination-range">${startIndex + 1} - ${endIndex} of ${totalRows}</span>
            <div class="pagination-buttons">
                <button class="pagination-button" ${currentPage === 1 ? 'disabled' : ''} onclick="changeLoadsPage(${currentPage - 1})">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="m15 18-6-6 6-6"/></svg>
                </button>
                <button class="pagination-button" ${currentPage === totalPages || totalPages === 0 ? 'disabled' : ''} onclick="changeLoadsPage(${currentPage + 1})">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="m9 18 6-6-6-6"/></svg>
                </button>
            </div>
        </div>
    `;
};

const renderFilterVisibilitySettings = () => {
    const container = document.getElementById('loads-filter-visibility-dropdown');
    if (!container) return;

    const visibleCount = appState.loads.visibleFilterIds.length;
    const totalCount = appState.loads.filterOrder.length;
    const isOpen = appState.loads.isFilterVisibilityDropdownOpen;

    const filtersInOrder = appState.loads.filterOrder
        .map(id => appState.loads.savedFilters.find(f => f.id === id))
        .filter(Boolean);

    const optionsHTML = filtersInOrder.map(filter => `
        <label class="flex items-center space-x-3 cursor-pointer p-2 rounded-md hover:bg-gray-700">
            <input type="checkbox" data-filter-id="${filter.id}" class="form-checkbox h-4 w-4 text-teal-500 rounded border-gray-500 focus:ring-teal-500 bg-gray-900"
                   ${appState.loads.visibleFilterIds.includes(filter.id) ? 'checked' : ''}>
            <span class="text-gray-200">${filter.name}</span>
        </label>
    `).join('');

    container.innerHTML = `
        <button id="filter-visibility-toggle" class="bg-gray-700 text-gray-100 border border-gray-600 rounded-lg px-3 py-1.5 text-sm w-full flex items-center justify-between">
            <span>${visibleCount} of ${totalCount} selected</span>
            <svg class="w-4 h-4 transform transition-transform ${isOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
        </button>
        <div id="filter-visibility-options" class="absolute left-0 right-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto ${isOpen ? '' : 'hidden'}">
            ${optionsHTML}
        </div>
    `;

    document.getElementById('filter-visibility-toggle').addEventListener('click', () => {
        appState.loads.isFilterVisibilityDropdownOpen = !appState.loads.isFilterVisibilityDropdownOpen;
        renderLoadsModals();
    });

    container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const filterId = e.target.dataset.filterId;
            const isVisible = e.target.checked;
            const visibleSet = new Set(appState.loads.visibleFilterIds);
            isVisible ? visibleSet.add(filterId) : visibleSet.delete(filterId);
            appState.loads.visibleFilterIds = appState.loads.filterOrder.filter(id => visibleSet.has(id));
            renderLoadsUI();
        });
    });
};

const renderColumnSettings = () => {
    const container = document.getElementById('loads-column-dropdown');
    if (!container) return;

    const visibleCount = appState.loads.visibleColumnIds.length;
    const totalCount = appState.loads.columnOrder.length;
    const isOpen = appState.loads.isColumnDropdownOpen;

    const optionsHTML = appState.loads.columnOrder.map(colId => {
        const column = LOADS_TABLE_COLUMNS.find(c => c.id === colId);
        if (!column) return '';
        return `
            <div class="flex items-center p-2 hover:bg-gray-700 rounded-md">
                <label class="flex-grow flex items-center cursor-pointer">
                    <input type="checkbox" data-col-id="${colId}" class="form-checkbox h-4 w-4 text-teal-500 rounded border-gray-500 focus:ring-teal-500 bg-gray-900 mr-3"
                           ${appState.loads.visibleColumnIds.includes(colId) ? 'checked' : ''}>
                    <span class="text-gray-200">${column.label}</span>
                </label>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <button id="column-manager-toggle" class="bg-gray-700 text-gray-100 border border-gray-600 rounded-lg px-3 py-1.5 text-sm w-full flex items-center justify-between">
            <span>${visibleCount} of ${totalCount} selected</span>
            <svg class="w-4 h-4 transform transition-transform ${isOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
        </button>
        <div id="column-manager-options" class="absolute left-0 right-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto ${isOpen ? '' : 'hidden'}">
            ${optionsHTML}
        </div>
    `;

    document.getElementById('column-manager-toggle').addEventListener('click', () => {
        appState.loads.isColumnDropdownOpen = !appState.loads.isColumnDropdownOpen;
        renderLoadsModals();
    });

    container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const colId = e.target.dataset.colId;
            const visibleSet = new Set(appState.loads.visibleColumnIds);
            e.target.checked ? visibleSet.add(colId) : visibleSet.delete(colId);
            appState.loads.visibleColumnIds = appState.loads.columnOrder.filter(id => visibleSet.has(id));
            renderLoadsTable();
        });
    });
};

// --- EVENT LISTENERS & HANDLERS ---

const initializeSearchComponent = () => {
    const container = document.getElementById('loads-search-component');
    if (!container) return;

    const searchableColumns = LOADS_TABLE_COLUMNS.filter(c => !c.isCalculated || ['rpm', 'flags'].includes(c.id));
    const allColsOption = { id: 'all', label: 'All Visible Columns' };
    const options = [allColsOption, ...searchableColumns];

    container.innerHTML = `
        <div class="search-wrapper">
            <div class="search-column-trigger" id="loads-search-column-trigger">
                <span class="column-name"></span>
                <svg class="arrow" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
            </div>
            <input type="text" id="loads-master-search-input" placeholder="Type to search...">
        </div>
        <div id="loads-search-column-panel" class="hidden">
            ${options.map(opt => `
                <div class="column-panel-item" data-col-id="${opt.id}">
                    <span>${opt.label}</span>
                </div>
            `).join('')}
        </div>
    `;

    const trigger = document.getElementById('loads-search-column-trigger');
    const panel = document.getElementById('loads-search-column-panel');
    const searchInput = document.getElementById('loads-master-search-input');

    trigger?.addEventListener('click', () => panel.classList.toggle('hidden'));

    panel?.querySelectorAll('.column-panel-item').forEach(item => {
        item.addEventListener('click', () => {
            appState.loads.searchColumn = item.dataset.colId;
            panel.classList.add('hidden');
            updateSearchComponent();
            renderLoadsTable();
        });
    });

    searchInput?.addEventListener('input', debounce(() => {
        appState.loads.currentPage = 1;
        renderLoadsTable();
    }, 300));

    updateSearchComponent();
};

export const initializeLoadsEventListeners = () => {
    if (appState.loads.loadsInitialized) return;

    initializeSearchComponent();
   

    document.getElementById('compact-flags-toggle')?.addEventListener('change', (e) => {
        appState.loads.compactFlags = e.target.checked;
        renderLoadsTable();
    });

    window.requestLoadsSort = (key) => {
        const { sortConfig } = appState.loads;
        const direction = (sortConfig.key === key && sortConfig.direction === 'ascending') ? 'descending' : 'ascending';
        appState.loads.sortConfig = { key, direction };
        renderLoadsTable();
    };


    document.getElementById('loads-settings-btn')?.addEventListener('click', () => { 
        setLoadsSettingsModalOpen(true); 
        renderLoadsUI(); 
    });
    document.getElementById('close-loads-settings-btn')?.addEventListener('click', () => { 
        setLoadsSettingsModalOpen(false); 
        renderLoadsUI(); 
    });

    const startDateInput = document.getElementById('loads-start-date');
    const endDateInput = document.getElementById('loads-end-date');

    if (startDateInput && !startDateInput._listenerAttached) {
        startDateInput.addEventListener('change', () => {
            appState.loads.currentPage = 1;
            renderLoadsUI();
        });
        startDateInput._listenerAttached = true;
    }

    if (endDateInput && !endDateInput._listenerAttached) {
        endDateInput.addEventListener('change', () => {
            appState.loads.currentPage = 1;
            renderLoadsUI();
        });
        endDateInput._listenerAttached = true;
    }

    ['moved-load-threshold', 'not-closed-days-threshold', 'low-rpm-threshold'].forEach(id => { // <-- REMOVED 'good-move-threshold'
        const input = document.getElementById(`${id}-input`);
        if (input) {
            input.addEventListener('input', (e) => {
                const key = id.replace(/-(\w)/g, (match, p1) => p1.toUpperCase());
                const isFloat = id.includes('rpm');
                appState.loads[key] = isFloat ? parseFloat(e.target.value) || 0 : parseInt(e.target.value, 10) || 0;
            });
        }
    });



    document.getElementById('save-loads-settings-btn')?.addEventListener('click', () => {
        const settingsToSave = {
            movedLoadThreshold: appState.loads.movedLoadThreshold,
            notClosedDaysThreshold: appState.loads.notClosedDaysThreshold,
            lowRpmThreshold: appState.loads.lowRpmThreshold,
            goodMoveThreshold: appState.loads.goodMoveThreshold,
            visibleFilterIds: appState.loads.visibleFilterIds,
            columnOrder: appState.loads.columnOrder,
            visibleColumnIds: appState.loads.visibleColumnIds,
        };
        localStorage.setItem('loadsSettings', JSON.stringify(settingsToSave));
        setLoadsSettingsModalOpen(false);
        renderLoadsUI();
    });

    document.getElementById('loads-settings-btn')?.addEventListener('click', () => { setLoadsSettingsModalOpen(true); renderLoadsUI(); });
    document.getElementById('close-loads-settings-btn')?.addEventListener('click', () => { setLoadsSettingsModalOpen(false); renderLoadsUI(); });

    document.getElementById('add-custom-load-filter-btn')?.addEventListener('click', () => {
        populateCustomFilterModal(null);
        setLoadsCustomFilterModalOpen(true);
        renderLoadsUI();
    });

    document.getElementById('close-add-custom-load-filter-modal-btn')?.addEventListener('click', () => {
        setLoadsCustomFilterModalOpen(false);
        const saveBtn = document.getElementById('save-load-filter-btn');
        if (saveBtn) saveBtn.removeAttribute('data-edit-id');
        renderLoadsUI();
    });

    const cancelBtn = document.getElementById('cancel-load-filter-btn');
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            setLoadsCustomFilterModalOpen(false);
            const saveBtn = document.getElementById('save-load-filter-btn');
            if (saveBtn) saveBtn.removeAttribute('data-edit-id');
            renderLoadsUI();
        };
    }

    document.getElementById('save-load-filter-btn')?.addEventListener('click', saveLoadsCustomFilter);
    document.getElementById('add-load-filter-criteria-btn')?.addEventListener('click', () => addLoadsFilterCriteriaRow());

    const tooltip = document.getElementById('loads-tooltip');
    const tableContainer = document.getElementById('loads-table-container');

    if (tableContainer && tooltip) {
        tableContainer.addEventListener('mouseover', (e) => {
            const target = e.target.closest('.flag-tooltip-container');
            if (!target) return;

            const tooltipHtml = target.dataset.tooltipHtml;
            if (!tooltipHtml) return;

            tooltip.innerHTML = tooltipHtml;
            tooltip.classList.remove('hidden');

            const targetRect = target.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();

            let top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);
            let left = targetRect.left - tooltipRect.width - 5;

            if (left < 0) { left = targetRect.right + 5; }
            if (top < 0) { top = 5; }
            if (top + tooltipRect.height > window.innerHeight) { top = window.innerHeight - tooltipRect.height - 5; }

            tooltip.style.top = `${top + window.scrollY}px`;
            tooltip.style.left = `${left + window.scrollX}px`;
        });

        tableContainer.addEventListener('mouseout', (e) => {
            const target = e.target.closest('.flag-tooltip-container');
            if (target) { tooltip.classList.add('hidden'); }
        });
    }

    // --- START: Corrected Card Event Listener Logic ---
    const cardContainer = document.getElementById('summary-cards-container');
    if (cardContainer) {
        cardContainer.addEventListener('click', e => {
            const card = e.target.closest('.summary-card');
            if (!card) return;

            const isExpanded = card.classList.contains('expanded');
            const header = card.querySelector('.card-header');
            const titleContainer = card.querySelector('.dropdown-title');
            const dropdown = card.querySelector('.dropdown-panel');
            const dropdownItem = e.target.closest('.dropdown-item');

            // Case 1: Click on a dropdown item (most specific)
            if (dropdownItem) {
                e.preventDefault();
                const cardConfig = cardConfigs.find(c => c.id === card.id);
                if (cardConfig) {
                    appState.loads[cardConfig.viewStateKey] = dropdownItem.dataset.view;
                    renderLoadsUI(); // This re-renders card content
                    // After re-render, we must ensure the parent card remains expanded
                    document.getElementById(card.id)?.classList.remove('collapsed');
                    document.getElementById(card.id)?.classList.add('expanded');
                }
                return;
            }
            
            // Case 2: Click on the title to toggle dropdown
            if (isExpanded && dropdown && titleContainer && titleContainer.contains(e.target)) {
                dropdown.classList.toggle('hidden');
                titleContainer.parentElement.classList.toggle('dropdown-open');
                return;
            }

            // Case 3: Click anywhere on the header (or the whole card if collapsed) to toggle expand/collapse
            if ((header && header.contains(e.target)) || !isExpanded) {
                document.querySelectorAll('#summary-cards-container .summary-card').forEach(c => {
                    if (c !== card) {
                        c.classList.add('collapsed');
                        c.classList.remove('expanded');
                    }
                });
                card.classList.toggle('collapsed');
                card.classList.toggle('expanded');
            }
        });
    }
    

    

    // Inside initializeLoadsEventListeners, after other listeners
    const switcher = document.getElementById('dashboard-switcher');
    if (switcher && !switcher._listenerAttached) {
        switcher.addEventListener('click', e => {
            const target = e.target.closest('.switcher-btn');
            if (target && target.dataset.view) {
                appState.loads.analyticsDashboardView = target.dataset.view;
                renderLoadsAnalyticsUI();
            }
        });
        switcher._listenerAttached = true;
    }

    // Global listener to close dropdowns
    document.addEventListener('click', e => {
        const openDropdown = document.querySelector('.dropdown-panel:not(.hidden)');
        if (openDropdown && !openDropdown.parentElement.contains(e.target)) {
            openDropdown.classList.add('hidden');
            openDropdown.parentElement.classList.remove('dropdown-open');
        }
    });
    // --- END: Corrected Card Event Listener Logic ---

    const thresholdsContainer = document.getElementById('good-move-thresholds-container');
if (thresholdsContainer && !thresholdsContainer._listenerAttached) {
    thresholdsContainer.addEventListener('change', e => {
        const thresholds = appState.loads.goodMoveThresholds;
        if (e.target.id === 'default-threshold-input') {
            thresholds.default = parseInt(e.target.value, 10) || 0;
        } else if (e.target.classList.contains('contract-value-input')) {
            thresholds.by_contract[e.target.dataset.contract] = parseInt(e.target.value, 10) || 0;
        } else if (e.target.classList.contains('contract-type-select')) {
            const oldContract = e.target.dataset.oldContract;
            const newContract = e.target.value;
            if (oldContract !== newContract) {
                const value = thresholds.by_contract[oldContract];
                delete thresholds.by_contract[oldContract];
                thresholds.by_contract[newContract] = value;
                renderGoodMoveThresholdSettings(); // Re-render to update attributes
            }
        }
    });

    thresholdsContainer.addEventListener('click', e => {
        const thresholds = appState.loads.goodMoveThresholds;
        if (e.target.id === 'add-threshold-btn') {
            e.preventDefault();
            const usedContracts = Object.keys(thresholds.by_contract);
            const availableContract = appState.loads.contractTypes.find(c => !usedContracts.includes(c.id));
            if (availableContract) {
                thresholds.by_contract[availableContract.id] = thresholds.default;
                renderGoodMoveThresholdSettings();
            } else {
                alert('All contract types already have a specific threshold.');
            }
        } else if (e.target.classList.contains('remove-threshold-btn')) {
            e.preventDefault();
            delete thresholds.by_contract[e.target.dataset.contract];
            renderGoodMoveThresholdSettings();
        }
    });
    thresholdsContainer._listenerAttached = true;
}

    appState.loads.loadsInitialized = true;
};

function addEventListenersToFilterButtons() {
    // Listener for activating the main filter button
    document.querySelectorAll('.saved-filter-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            appState.loads.activeFilterId = button.dataset.filterId;
            renderLoadsUI();
        });
    });

    // Delegated listeners for custom filter wrappers (for drag-and-drop)
    document.querySelectorAll('.custom-filter-wrapper').forEach(wrapper => {
        wrapper.addEventListener('dragstart', (e) => {
            setDraggedLoadsFilterId(e.currentTarget.dataset.filterId);
            e.currentTarget.classList.add('dragging');
        });
        wrapper.addEventListener('dragover', (e) => e.preventDefault());
        wrapper.addEventListener('drop', (e) => {
            e.preventDefault();
            const droppedOnId = e.currentTarget.dataset.filterId;
            const draggedId = appState.loads.draggedFilterId;
            if (draggedId && draggedId !== droppedOnId) {
                const order = [...appState.loads.filterOrder];
                const draggedIndex = order.indexOf(draggedId);
                order.splice(draggedIndex, 1);
                const droppedOnIndex = order.indexOf(droppedOnId);
                order.splice(droppedOnIndex, 0, draggedId);
                updateLoadsFilterOrder(order);
                renderLoadsUI();
            }
        });
        wrapper.addEventListener('dragend', (e) => e.currentTarget.classList.remove('dragging'));
    });

    // Listener for opening/closing the actions dropdown
    document.querySelectorAll('.filter-actions-trigger').forEach(trigger => {
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const panel = trigger.nextElementSibling;
            const isHidden = panel.classList.contains('hidden');
            
            document.querySelectorAll('.filter-actions-panel').forEach(p => p.classList.add('hidden'));
            
            if (isHidden) {
                panel.classList.remove('hidden');
            }
        });
    });

    // Listener for the Edit action inside the dropdown
    document.querySelectorAll('.edit-loads-filter-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const filterId = e.currentTarget.dataset.filterId;
            openCustomFilterModalForEdit(filterId);
        });
    });

    // Listener for the Delete action inside the dropdown
    document.querySelectorAll('.delete-loads-filter-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Are you sure you want to delete this filter?')) {
                const deletedFilterId = e.currentTarget.dataset.filterId;
                deleteLoadsFilter(deletedFilterId);
                if (appState.loads.activeFilterId === deletedFilterId) {
                    appState.loads.activeFilterId = appState.loads.filterOrder[0] || '';
                }
                renderLoadsUI();
            }
        });
    });

    // Add a global listener to close menus when clicking outside
    if (!document.body.hasAttribute('data-global-click-listener')) {
        document.body.setAttribute('data-global-click-listener', 'true');
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.filter-actions-menu-container')) {
                document.querySelectorAll('.filter-actions-panel').forEach(p => {
                    p.classList.add('hidden');
                });
            }
        });
    }
}

function openCustomFilterModalForEdit(filterId) {
    const filterToEdit = appState.loads.savedFilters.find(f => f.id === filterId);
    if (filterToEdit) {
        // MODIFICATION: Directly populate the modal with the specific filter's data.
        populateCustomFilterModal(filterToEdit);
        
        // MODIFICATION: Directly open the modal without a full UI re-render.
        setLoadsCustomFilterModalOpen(true);
        const modal = document.getElementById('add-custom-load-filter-modal');
        if (modal) {
            modal.classList.remove('hidden');
        }
    }
}

function addDragDropToTableHeaders() {
    const headers = document.querySelectorAll('#loads-table-container th');
    headers.forEach(header => {
        header.addEventListener('dragstart', (e) => {
            appState.loads.draggedColumnId = e.currentTarget.dataset.colId;
            e.currentTarget.classList.add('opacity-50');
        });
        header.addEventListener('dragend', (e) => {
            e.currentTarget.classList.remove('opacity-50');
            document.querySelectorAll('#loads-table-container th.drag-over').forEach(th => th.classList.remove('drag-over'));
            appState.loads.draggedColumnId = null;
        });
        header.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (e.currentTarget.dataset.colId !== appState.loads.draggedColumnId) {
                e.currentTarget.classList.add('drag-over');
            }
        });
        header.addEventListener('dragleave', (e) => {
            e.currentTarget.classList.remove('drag-over');
        });
        header.addEventListener('drop', (e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('drag-over');
            
            const droppedOnId = e.currentTarget.dataset.colId;
            const draggedId = appState.loads.draggedColumnId;

            if (draggedId && draggedId !== droppedOnId) {
                const order = [...appState.loads.columnOrder];
                const fromIndex = order.indexOf(draggedId);
                const toIndex = order.indexOf(droppedOnId);
                
                order.splice(fromIndex, 1);
                order.splice(toIndex, 0, draggedId);
                
                appState.loads.columnOrder = order;
                renderLoadsTable();
            }
        });
    });
}

// --- LOGIC & HELPERS ---

function saveLoadsCustomFilter() {
    const nameInput = document.getElementById('load-filter-name-input');
    const colorInput = document.getElementById('load-filter-color-input');
    const criteriaRows = document.querySelectorAll('#load-filter-criteria-container .criteria-row');
    const saveBtn = document.getElementById('save-load-filter-btn');
    const editId = saveBtn.dataset.editId;

    const name = nameInput.value.trim();
    if (!name) return alert('Please enter a filter name.');

    const criteria = Array.from(criteriaRows).map(row => {
        const columnId = row.querySelector('.load-filter-column-select').value;
        const operator = row.querySelector('.load-filter-operator-select').value;
        const selectedColumn = LOAD_FILTER_COLUMNS.find(c => c.id === columnId);
        
        let value;
        if (operator === 'inPrevious') {
            const daysInput = row.querySelector('.load-filter-previous-days-input');
            const fromSelect = row.querySelector('.load-filter-previous-days-from-select');
            value = {
                days: parseInt(daysInput.value, 10) || 7,
                from: fromSelect.value
            };
        } else if (selectedColumn && selectedColumn.type === 'multiselect') {
            const checkedBoxes = row.querySelectorAll('.multiselect-checkbox:checked');
            value = Array.from(checkedBoxes).map(cb => cb.value);
        } else {
            value = row.querySelector('.load-filter-value-input').value;
        }

        return { columnId, operator, value };
    }).filter(c => {
        if (!c.columnId || !c.operator) {
            return false;
        }
        if (c.operator === 'inPrevious') {
            return c.value && !isNaN(c.value.days);
        }
        if (Array.isArray(c.value)) {
            return c.value.length > 0;
        }
        return c.value != null && c.value !== '';
    });

    if (criteria.length === 0) {
        alert('Please add at least one criterion.');
        return;
    }

    const filter = {
        id: editId || `custom_${Date.now()}`,
        name: name,
        color: colorInput.value,
        criteria: criteria,
    };
    saveBtn.removeAttribute('data-edit-id'); 
    addOrUpdateLoadsFilter(filter);
    setLoadsCustomFilterModalOpen(false);
    renderLoadsUI();
}

function getLastDeliveryLocation(driverName, currentLoad, allLoads) {
    if (!driverName) return "No driver assigned.";
    const getCombinedDateTime = (load) => new Date(`${load.pu_date.split('T')[0]}T${load.pu_time || '00:00:00'}`);
    const driverLoads = allLoads.filter(l => l.driver === driverName).sort((a, b) => getCombinedDateTime(a) - getCombinedDateTime(b));
    const currentIndex = driverLoads.findIndex(l => l.id === currentLoad.id);
    if (currentIndex > 0) {
        let previousValidLoad = null; // Initialize previousValidLoad here
        for (let i = currentIndex - 1; i >= 0; i--) {
            const tempLoad = driverLoads[i];
            if (tempLoad.status !== 'Canceled' && tempLoad.status !== 'TONU') {
                previousValidLoad = tempLoad;
                break;
            }
        }
        // Use previousValidLoad instead of previousLoad
        if (previousValidLoad) {
            return previousValidLoad.do_location || "Previous DO location not available.";
        }
    }
    return "No prior delivery found for this driver.";
}

function addLoadsFilterCriteriaRow(criteria = {}) {
    const container = document.getElementById('load-filter-criteria-container');
    const row = document.createElement('div');
    // --- THIS IS THE CORRECTED LINE ---
    row.className = 'threshold-row items-center criteria-row'; // Added 'criteria-row'
    // --- END OF CORRECTION ---
    row.innerHTML = `
        <select class="load-filter-column-select settings-select"></select>
        <select class="load-filter-operator-select settings-select"></select>
        <div class="relative w-full value-container">
            <input type="text" class="load-filter-value-input settings-input w-full" placeholder="Value" style="display: none;"/>
            <div class="load-filter-flag-multiselect" style="display: none;">
                <button type="button" class="multiselect-trigger settings-select text-left w-full">Select Options...</button>
                <div class="multiselect-panel hidden"></div>
            </div>
            <div class="load-filter-previous-days-container grid grid-cols-[1fr_auto_1.5fr] gap-x-2 items-center" style="display: none;">
                <input type="number" class="load-filter-previous-days-input settings-input" placeholder="Days" value="7">
                <span class="text-gray-400 text-sm">days from</span>
                <select class="load-filter-previous-days-from-select settings-select">
                    <option value="endDate">'To' Date</option>
                    <option value="today">Today (Local)</option>
                </select>
            </div>
        </div>
        <button class="remove-threshold-btn" title="Remove Criteria">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
    `;
    container.appendChild(row);

    const columnSelect = row.querySelector('.load-filter-column-select');
    const operatorSelect = row.querySelector('.load-filter-operator-select');
    const valueContainer = row.querySelector('.value-container');

    const toggleValueInputs = () => {
        const selectedColumn = LOAD_FILTER_COLUMNS.find(c => c.id === columnSelect.value);
        const selectedOperator = operatorSelect.value;

        valueContainer.querySelectorAll('.load-filter-value-input, .load-filter-flag-multiselect, .load-filter-previous-days-container').forEach(el => el.style.display = 'none');

        if (selectedOperator === 'inPrevious') {
            valueContainer.querySelector('.load-filter-previous-days-container').style.display = 'grid';
        } else if (selectedColumn?.type === 'multiselect') {
            valueContainer.querySelector('.load-filter-flag-multiselect').style.display = 'block';
        } else {
            const standardInput = valueContainer.querySelector('.load-filter-value-input');
            standardInput.type = selectedColumn?.type === 'date' ? 'date' : 'text';
            standardInput.style.display = 'block';
        }
    };

    operatorSelect.addEventListener('change', toggleValueInputs);

    const populateAndShowCorrectInput = () => {
        const selectedColumn = LOAD_FILTER_COLUMNS.find(c => c.id === columnSelect.value);
        populateLoadsFilterOperators(columnSelect, operatorSelect, row);
        
        toggleValueInputs();

        if (selectedColumn && selectedColumn.type === 'multiselect') {
            const options = appState.loads[selectedColumn.optionsSource] || [];
            const multiSelectPanel = valueContainer.querySelector('.multiselect-panel');
            multiSelectPanel.innerHTML = '';
            options.forEach(opt => {
                multiSelectPanel.innerHTML += `
                    <label class="flex items-center p-2 cursor-pointer hover:bg-gray-600 rounded-md">
                        <input type="checkbox" value="${opt.id}" class="form-checkbox h-4 w-4 text-teal-500 rounded border-gray-500 mr-2 bg-gray-900 multiselect-checkbox">
                        <span class="text-sm">${opt.text}</span>
                    </label>
                `;
            });
        }
    };

    LOAD_FILTER_COLUMNS.forEach(col => columnSelect.add(new Option(col.label, col.id)));
    if (criteria.columnId) {
        columnSelect.value = criteria.columnId;
    }
    populateAndShowCorrectInput();

    if (criteria.operator) {
        operatorSelect.value = criteria.operator;
        toggleValueInputs();
    }

    if (criteria.value) {
        if (criteria.operator === 'inPrevious' && typeof criteria.value === 'object') {
            const daysInput = valueContainer.querySelector('.load-filter-previous-days-input');
            const fromSelect = valueContainer.querySelector('.load-filter-previous-days-from-select');
            if(daysInput) daysInput.value = criteria.value.days || 7;
            if(fromSelect) fromSelect.value = criteria.value.from || 'endDate';
        } else if (Array.isArray(criteria.value)) {
            criteria.value.forEach(val => {
                const checkbox = valueContainer.querySelector(`input[value="${val}"]`);
                if(checkbox) checkbox.checked = true;
            });
        } else {
            row.querySelector('.load-filter-value-input').value = criteria.value;
        }
    }

    columnSelect.addEventListener('change', populateAndShowCorrectInput);
    
    const multiSelectContainer = valueContainer.querySelector('.load-filter-flag-multiselect');
    const multiSelectTrigger = multiSelectContainer.querySelector('.multiselect-trigger');
    const multiSelectPanel = multiSelectContainer.querySelector('.multiselect-panel');
    multiSelectTrigger.addEventListener('click', () => multiSelectPanel.classList.toggle('hidden'));
    
    const updateMultiSelectTriggerText = () => {
        const checked = multiSelectContainer.querySelectorAll('input:checked');
        if (checked.length === 0) {
            multiSelectTrigger.textContent = 'Select Options...';
        } else if (checked.length === 1) {
            multiSelectTrigger.textContent = checked[0].parentElement.querySelector('span').textContent;
        } else {
            multiSelectTrigger.textContent = `${checked.length} options selected`;
        }
    };
    
    multiSelectPanel.addEventListener('change', updateMultiSelectTriggerText);
    document.addEventListener('click', (e) => {
        if (!multiSelectContainer.contains(e.target)) {
            multiSelectPanel.classList.add('hidden');
        }
    });

    row.querySelector('.remove-threshold-btn').addEventListener('click', () => row.remove());
    updateMultiSelectTriggerText();
}

function populateCustomFilterModal(filterToEdit = null) {
    const nameInput = document.getElementById('load-filter-name-input');
    const colorInput = document.getElementById('load-filter-color-input');
    const container = document.getElementById('load-filter-criteria-container');
    const saveBtn = document.getElementById('save-load-filter-btn');

    container.innerHTML = '';
    nameInput.value = filterToEdit ? filterToEdit.name : '';
    colorInput.value = filterToEdit ? filterToEdit.color : '#374151';
    saveBtn.dataset.editId = filterToEdit ? filterToEdit.id : '';

    if (filterToEdit && filterToEdit.criteria.length > 0) {
        filterToEdit.criteria.forEach(c => addLoadsFilterCriteriaRow(c));
    } else {
        addLoadsFilterCriteriaRow();
    }
}

function populateLoadsFilterOperators(columnSelect, operatorSelect, row) {
    operatorSelect.innerHTML = '';
    const selectedColumn = LOAD_FILTER_COLUMNS.find(c => c.id === columnSelect.value);
    if (!selectedColumn) return;

    const valueInput = row.querySelector('.load-filter-value-input');
    const multiSelectContainer = row.querySelector('.load-filter-flag-multiselect');
    const previousDaysContainer = row.querySelector('.load-filter-previous-days-container');

    let operators = [];
    valueInput.style.display = 'none';
    multiSelectContainer.style.display = 'none';
    if (previousDaysContainer) previousDaysContainer.style.display = 'none';

    if (selectedColumn.type === 'number') {
        operators = [{v: 'equals', l: 'Equals'}, {v: 'notEquals', l: 'Not Equal'}, {v: 'greaterThan', l: '>'}, {v: 'lessThan', l: '<'}];
        valueInput.style.display = 'block';
    } else if (selectedColumn.type === 'date') {
        operators = [{v: 'on', l: 'On'}, {v: 'before', l: 'Before'}, {v: 'after', l: 'After'}, {v: 'inPrevious', l: 'In Previous X Days'}];
        valueInput.type = 'date';
        valueInput.style.display = 'block';
    } else if (selectedColumn.type === 'multiselect') {
        operators = [
            {v: 'isAllOf', l: 'Is (All Of)'},
            {v: 'isAnyOf', l: 'Is Any Of'},
            {v: 'isNoneOf', l: 'Is None Of'}
        ];
        multiSelectContainer.style.display = 'block';
    } else {
        operators = [{v: 'contains', l: 'Contains'}, {v: 'notContains', l: 'Not Contain'}, {v: 'equals', l: 'Equals'}, {v: 'startsWith', l: 'Starts With'}];
        valueInput.style.display = 'block';
    }

    operators.forEach(op => operatorSelect.add(new Option(op.l, op.v)));
}

function calculateWeeklyGross(driverName, currentLoad, allLoads) {
    if (!driverName || !currentLoad.do_date) return 0;

    const mondayDoDate = new Date(currentLoad.do_date);
    // Ensure time is set to the end of the day for inclusive comparison
    mondayDoDate.setUTCHours(23, 59, 59, 999);

    // Calculate the preceding Tuesday
    const dayOfWeek = mondayDoDate.getUTCDay(); // Sunday = 0, Monday = 1...
    const daysToSubtract = (dayOfWeek === 1) ? 6 : (dayOfWeek + 6) % 7;
    const tuesdayStartDate = new Date(mondayDoDate.getTime() - daysToSubtract * 24 * 60 * 60 * 1000);
    tuesdayStartDate.setUTCHours(0, 0, 0, 0);

    // Filter loads for the driver within the date range, excluding 'Canceled'
    const weeklyLoads = allLoads.filter(l => {
        if (l.driver !== driverName || l.status === 'Canceled' || !l.do_date) {
            return false;
        }
        const loadDoDate = new Date(l.do_date);
        return loadDoDate >= tuesdayStartDate && loadDoDate <= mondayDoDate;
    });

    // Sum the price of the filtered loads
    return weeklyLoads.reduce((total, load) => total + (load.price || 0), 0);
}

function calculatePreviousWeeklyGross(driverName, currentLoad, allLoads) {
    if (!driverName || !currentLoad.do_date) return 0;

    const currentDoDate = new Date(currentLoad.do_date);
    const dayOfWeek = currentDoDate.getUTCDay();

    // Find Tuesday of the current week to establish the boundary
    const daysToSubtractForMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const mondayOfCurrentWeek = new Date(currentDoDate);
    mondayOfCurrentWeek.setUTCDate(currentDoDate.getUTCDate() - daysToSubtractForMonday);
    const tuesdayOfCurrentWeek = new Date(mondayOfCurrentWeek);
    tuesdayOfCurrentWeek.setUTCDate(mondayOfCurrentWeek.getUTCDate() - 6);
    tuesdayOfCurrentWeek.setUTCHours(0, 0, 0, 0);

    // Previous week's Monday is one day before the current week's Tuesday
    const mondayOfPreviousWeek = new Date(tuesdayOfCurrentWeek);
    mondayOfPreviousWeek.setUTCDate(tuesdayOfCurrentWeek.getUTCDate() - 1);
    mondayOfPreviousWeek.setUTCHours(23, 59, 59, 999);

    // Previous week's Tuesday is 6 days before that
    const tuesdayOfPreviousWeek = new Date(mondayOfPreviousWeek);
    tuesdayOfPreviousWeek.setUTCDate(mondayOfPreviousWeek.getUTCDate() - 6);
    tuesdayOfPreviousWeek.setUTCHours(0, 0, 0, 0);

    const previousWeeklyLoads = allLoads.filter(l => {
        if (l.driver !== driverName || l.status === 'Canceled' || !l.do_date) {
            return false;
        }
        const loadDoDate = new Date(l.do_date);
        return loadDoDate >= tuesdayOfPreviousWeek && loadDoDate <= mondayOfPreviousWeek;
    });

    return previousWeeklyLoads.reduce((total, load) => total + (load.price || 0), 0);
}

function getNewStartWeekLoads(driverName, currentLoad, allLoads) {
    if (!driverName || !currentLoad.do_date) return [];

    const currentDoDate = new Date(currentLoad.do_date);
    const dayOfWeek = currentDoDate.getUTCDay();

    const mondayOfCurrentWeek = new Date(currentDoDate);
    const daysToSubtractForMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    mondayOfCurrentWeek.setUTCDate(currentDoDate.getUTCDate() - daysToSubtractForMonday);
    mondayOfCurrentWeek.setUTCHours(23, 59, 59, 999);

    const tuesdayOfCurrentWeek = new Date(mondayOfCurrentWeek);
    tuesdayOfCurrentWeek.setUTCDate(mondayOfCurrentWeek.getUTCDate() - 6);
    tuesdayOfCurrentWeek.setUTCHours(0, 0, 0, 0);

    return allLoads
        .filter(l => {
            if (l.driver !== driverName || !l.do_date) return false;
            const doDate = new Date(l.do_date);
            return doDate >= tuesdayOfCurrentWeek && doDate <= mondayOfCurrentWeek;
        })
        .sort((a, b) => new Date(a.pu_date) - new Date(b.pu_date));
}

function getFlagsHTML(load, allLoads) {
    if (appState.loads.compactFlags) {
        const flagChecks = [
            checkNewStartDriver(load, allLoads),
            checkMovedLoad(load),
            checkMondaysMovedLoad(load),
            checkHiddenMiles(load, allLoads),
            checkNotClosedLoad(load),
            checkLowRpmLoad(load),
        ];

        const isMovedOrMondaysMoved = flagChecks[1] || flagChecks[2];
        let flagCount = flagChecks.filter(Boolean).length;
        if (isMovedOrMondaysMoved) {
            flagCount++; // Add one for the "Good/Bad Move" determination
        }


        if (flagCount === 0) return '';

        const flagTexts = [];
        if (flagChecks[0]) flagTexts.push('New Start');
        if (flagChecks[1]) flagTexts.push('Moved');
        if (flagChecks[2]) flagTexts.push('Mon. Moved');
        if (isMovedOrMondaysMoved) {
            const threshold = getGoodMoveThreshold(load.contract_type);
            const grossWithoutLoad = calculateWeeklyGross(load.driver, load, allLoads) - (load.price || 0);
            flagTexts.push(grossWithoutLoad > threshold ? 'Bad Move' : 'Good Move');
        }
        if (flagChecks[3]) flagTexts.push('Hidden Mileage');
        if (flagChecks[4]) flagTexts.push('Not Closed');
        if (flagChecks[5]) flagTexts.push('Low RPM');

        const tooltipHtml = flagTexts.join('<br>');

        return `
            <div class="compact-flags-container flag-tooltip-container" data-tooltip-html="${tooltipHtml.replace(/'/g, "&apos;")}">
                <span class="compact-flags-count">${flagCount}</span>
            </div>
        `;
    }
    let flagsHTML = '';
    const isMoved = checkMovedLoad(load);
    const isMondaysMoved = checkMondaysMovedLoad(load);
    const isNewStart = checkNewStartDriver(load, allLoads);

    if (isNewStart) {
        const weekLoads = getNewStartWeekLoads(load.driver, load, allLoads);
        const tooltipLoadsHTML = weekLoads.map((l, index) => {
            const puDate = new Date(l.pu_date);
            const doDate = new Date(l.do_date);
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const dayRange = `<span class="tooltip-day-range">${days[puDate.getUTCDay()]}–${days[doDate.getUTCDay()]}</span>`;
            const origin = (l.pu_location || 'N/A').split(',')[1]?.trim() || 'N/A';
            const dest = (l.do_location || 'N/A').split(',')[1]?.trim() || 'N/A';
            
            if (l.status === 'Canceled') {
                return `${index + 1}. ${dayRange} | ${origin} ➝ ${dest} | <span class="tooltip-canceled">CANCELED</span>`;
            }

            const miles = l.trip_miles || 0;
            const price = l.price || 0;
            const formattedPrice = `<span class="tooltip-rate">$${price.toLocaleString()}</span>`;
            const rpm = l.status === 'TONU' ? 'TONU' : `$${calculateRPM(price, miles).toFixed(2)}/mi`;
            return `${index + 1}. ${dayRange} | ${origin} ➝ ${dest} | ${miles} mi | ${formattedPrice} | ${rpm}`;
        }).join('<br>');

        flagsHTML += `<span class="load-flag new-start-flag flag-tooltip-container" data-tooltip-html='${tooltipLoadsHTML.replace(/'/g, "&apos;")}'>New Start</span>`;
    }

    if (isMoved) {
        flagsHTML += `<span class="load-flag bg-red-500">Moved</span>`;
    }
    if (isMondaysMoved) {
        flagsHTML += `<span class="load-flag bg-blue-500">Mon. Moved</span>`;
    }

    if (isMoved || isMondaysMoved) {
        const grossWithLoad = calculateWeeklyGross(load.driver, load, allLoads);
        const grossWithoutLoad = grossWithLoad - (load.price || 0);
        
        const weekLoads = getNewStartWeekLoads(load.driver, load, allLoads);
        const tooltipLoadsHTML = weekLoads.map((l, index) => {
            const puDate = new Date(l.pu_date);
            const doDate = new Date(l.do_date);
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const dayRange = `<span class="tooltip-day-range">${days[puDate.getUTCDay()]}–${days[doDate.getUTCDay()]}</span>`;
            const origin = (l.pu_location || 'N/A').split(',')[1]?.trim() || 'N/A';
            const dest = (l.do_location || 'N/A').split(',')[1]?.trim() || 'N/A';
            
            if (l.status === 'Canceled') {
                return `${index + 1}. ${dayRange} | ${origin} ➝ ${dest} | <span class="tooltip-canceled">CANCELED</span>`;
            }
            
            const miles = l.trip_miles || 0;
            const price = l.price || 0;
            const formattedPrice = `<span class="tooltip-rate">$${price.toLocaleString()}</span>`;
            const rpm = l.status === 'TONU' ? 'TONU' : `$${calculateRPM(price, miles).toFixed(2)}/mi`;
            return `${index + 1}. ${dayRange} | ${origin} ➝ ${dest} | ${miles} mi | ${formattedPrice} | ${rpm}`;
        }).join('<br>');

        const prevWeekGrossHTML = isNewStart 
            ? 'NEW START' 
            : `$${calculatePreviousWeeklyGross(load.driver, load, allLoads).toFixed(2)}`;

        const tooltipText = `
            Gross Without Moved Load: <span class="font-bold text-orange-400">$${grossWithoutLoad.toFixed(2)}</span><br>
            Gross With Moved Load: <span class="font-bold text-green-400">$${grossWithLoad.toFixed(2)}</span><br>
            Previous Week Gross: <span class="font-bold text-yellow-400">${prevWeekGrossHTML}</span>
            <hr class="border-gray-600 my-2">
            <b>Week's Loads:</b><br>
            ${tooltipLoadsHTML}
        `.replace(/'/g, "&apos;");
        
        // --- THIS IS THE CORRECTED LINE ---
        const threshold = getGoodMoveThreshold(load.contract_type);
        if (grossWithoutLoad > threshold) {
            flagsHTML += `<span class="load-flag flag-tooltip-container" style="background-color: #ef4444;" data-tooltip-html='${tooltipText}'>Bad Move</span>`;
        } else {
            flagsHTML += `<span class="load-flag flag-tooltip-container" style="background-color: #22c55e;" data-tooltip-html='${tooltipText}'>Good Move</span>`;
        }
    }


    if (checkHiddenMiles(load, allLoads)) {
        flagsHTML += `<span class="load-flag bg-purple-500">Hidden Mileage</span>`;
    }
    if (checkNotClosedLoad(load)) {
        flagsHTML += `<span class="load-flag bg-orange-500">Not Closed</span>`;
    }
    if (checkLowRpmLoad(load)) {
        flagsHTML += `<span class="load-flag bg-yellow-500">Low RPM</span>`;
    }

    return `<div class="flex flex-wrap gap-1">${flagsHTML}</div>`;
}

function checkMovedLoad(load) {
    const doDate = new Date(load.do_date);
    if (doDate.getUTCDay() !== 1) return false;
    const puDate = new Date(load.pu_date);
    const transitDuration = Math.ceil((doDate - puDate) / (1000 * 60 * 60 * 24)) + 1;
    const daysInTransit = Math.max(1, transitDuration);
    const totalMiles = (load.trip_miles || 0) + (load.deadhead_miles || 0);
    const avgMilesPerDay = totalMiles / daysInTransit;
    return avgMilesPerDay > appState.loads.movedLoadThreshold;
}

function getFlagsForLoad(load, allLoads) {
    const flags = new Set();
    const flagChecks = {
        new_start: checkNewStartDriver(load, allLoads),
        moved: checkMovedLoad(load),
        mondays_moved: checkMondaysMovedLoad(load),
        hidden_miles: checkHiddenMiles(load, allLoads),
        not_closed: checkNotClosedLoad(load),
        low_rpm: checkLowRpmLoad(load),
    };

    for (const [flagId, isPresent] of Object.entries(flagChecks)) {
        if (isPresent) flags.add(flagId);
    }

    // Correctly determine and add good_move or bad_move
    const goodOrBadStatus = checkGoodOrBadMove(load, allLoads);
    if (goodOrBadStatus) {
        flags.add(goodOrBadStatus);
    }

    return flags;
}

function checkHiddenMiles(currentLoad, allLoads) {
    if (!currentLoad.driver || currentLoad.status === 'Canceled' || currentLoad.status === 'TONU') return false;
    const getCombinedDateTime = (load) => new Date(`${load.pu_date.split('T')[0]}T${load.pu_time || '00:00:00'}`);
    const driverLoads = allLoads.filter(l => l.driver === currentLoad.driver).sort((a, b) => getCombinedDateTime(a) - getCombinedDateTime(b));
    const currentIndex = driverLoads.findIndex(l => l.id === currentLoad.id);
    if (currentIndex < 1) return false;
    let previousValidLoad = null;
    for (let i = currentIndex - 1; i >= 0; i--) {
        const tempLoad = driverLoads[i];
        if (tempLoad.status !== 'Canceled' && tempLoad.status !== 'TONU') {
            previousValidLoad = tempLoad;
            break;
        }
    }
    if (!previousValidLoad) return false;
    const normalizeLocation = (locString) => {
        if (!locString) return '';
        return String(locString).trim().toLowerCase().replace(/\s*,\s*/g, ', ');
    };
    const previousDropOff = normalizeLocation(previousValidLoad.do_location);
    const currentStartCity = currentLoad.start_location_city || '';
    const currentStartState = currentLoad.start_location_state || '';
    const currentStartLocation = normalizeLocation(`${currentStartCity}, ${currentStartState}`);
    if (!previousDropOff || !currentStartLocation || currentStartLocation === ", ") return false;
    return previousDropOff !== currentStartLocation;
}

function checkNotClosedLoad(load) {
    const excludedStatuses = [
        'Pending to Bill',
        'Canceled',
        'Billed',
        'Paid',
        'Missing Paperwork',
        'TONU',
        'Billed - Pending Acc.',
        'Open Balance'
    ];

    // If the load's status is in the excluded list, it's considered "closed".
    if (excludedStatuses.includes(load.status)) {
        return false;
    }

    // For all other statuses, apply the date threshold logic.
    const doDate = new Date(load.do_date);
    const today = new Date(new Date().setHours(0, 0, 0, 0));

    // If the drop-off date is in the future, it's not "not closed".
    if (doDate >= today) {
        return false;
    }

    // Check if the days past the drop-off date exceed the threshold.
    const diffDays = Math.ceil((today - doDate) / (1000 * 60 * 60 * 24));
    return diffDays > appState.loads.notClosedDaysThreshold;
}

function checkLowRpmLoad(load) {
    const rpm = calculateRPM(load.price, load.trip_miles);
    return rpm > 0 && rpm < appState.loads.lowRpmThreshold;
}

// NEW: Function to check for Monday's Moved Loads
function checkMondaysMovedLoad(load) {
    if (!load.pu_date || !load.do_date) return false;

    const puDate = new Date(load.pu_date);
    const doDate = new Date(load.do_date);

    // GetUTCDay() returns 0 for Sunday, 1 for Monday, ..., 6 for Saturday
    const isPuMonday = puDate.getUTCDay() === 1;
    const isDoMonday = doDate.getUTCDay() === 1;

    // Check if both dates are Monday and they are the same date
    const areSameDate = puDate.toISOString().split('T')[0] === doDate.toISOString().split('T')[0];

    return isPuMonday && isDoMonday && areSameDate;
}

function calculateRPM(price, tripMiles) { return (price && tripMiles > 0) ? (price / tripMiles) : 0; }

function applyLoadsFilters(loads, activeFilterId) {
    if (activeFilterId === 'late_assign') {
        return loads;
    }

    const filter = appState.loads.savedFilters.find(f => f.id === activeFilterId);
    if (!filter) return loads;

    const flagChecks = {
        'moved_loads': (l, all) => checkMovedLoad(l),
        'hidden_miles': (l, all) => checkHiddenMiles(l, all),
        'not_closed': (l, all) => checkNotClosedLoad(l),
        'low_rpm': (l, all) => checkLowRpmLoad(l),
        'mondays_moved_loads': (l, all) => checkMondaysMovedLoad(l),
        'new_start': (l, all) => checkNewStartDriver(l, all),
    };

    if (flagChecks[filter.id]) {
        return loads.filter(l => flagChecks[filter.id](l, appState.loads.data));
    }

    const flagCriteria = filter.criteria.filter(c => c.columnId === 'flags');
    const otherCriteria = filter.criteria.filter(c => c.columnId !== 'flags');

    return loads.filter(load => {
        const matchesOthers = otherCriteria.every(criterion => {
            const selectedColumn = LOAD_FILTER_COLUMNS.find(c => c.id === criterion.columnId);
            if (!selectedColumn) return false;

            if (selectedColumn.type === 'multiselect') {
                const loadValue = load[selectedColumn.id];
                if (loadValue === null || loadValue === undefined) return false;

                const filterValues = (Array.isArray(criterion.value) ? criterion.value : [criterion.value]).map(v => String(v).trim().toLowerCase());
                if (filterValues.length === 0) return true;

                const cleanLoadValue = String(loadValue).trim().toLowerCase();

                switch(criterion.operator) {
                    case 'isAnyOf':
                        return filterValues.includes(cleanLoadValue);
                    case 'isNoneOf':
                        return !filterValues.includes(cleanLoadValue);
                    case 'isAllOf':
                        return filterValues.includes(cleanLoadValue);
                    default: return true;
                }
            } else {
                let loadValue = load[criterion.columnId];
                if (criterion.columnId === 'rpm') loadValue = calculateRPM(load.price, load.trip_miles);
                if (loadValue === null || loadValue === undefined) return false;

                if (criterion.operator === 'inPrevious') {
                    const loadDate = new Date(loadValue.split('T')[0]);
                    if (isNaN(loadDate.getTime())) return false;

                    const refDateVal = criterion.value.from === 'endDate'
                        ? document.getElementById('loads-end-date').value
                        : new Date().toISOString().split('T')[0];

                    const referenceDate = new Date(refDateVal);
                    referenceDate.setUTCHours(23, 59, 59, 999);

                    const startDate = new Date(referenceDate);
                    startDate.setUTCDate(startDate.getUTCDate() - (criterion.value.days - 1));
                    startDate.setUTCHours(0, 0, 0, 0);

                    return loadDate >= startDate && loadDate <= referenceDate;
                }

                const filterValue = criterion.value;
                const numLoadValue = parseFloat(loadValue);
                const numFilterValue = parseFloat(filterValue);

                switch (criterion.operator) {
                    case 'equals': return String(loadValue).toLowerCase() == filterValue.toLowerCase();
                    case 'notEquals': return String(loadValue).toLowerCase() != filterValue.toLowerCase();
                    case 'contains': return String(loadValue).toLowerCase().includes(filterValue.toLowerCase());
                    case 'notContains': return !String(loadValue).toLowerCase().includes(filterValue.toLowerCase());
                    case 'startsWith': return String(loadValue).toLowerCase().startsWith(filterValue.toLowerCase());
                    case 'endsWith': return String(loadValue).toLowerCase().endsWith(filterValue.toLowerCase());
                    case 'greaterThan': return numLoadValue > numFilterValue;
                    case 'lessThan': return numLoadValue < numFilterValue;
                    case 'on': return new Date(loadValue).toDateString() === new Date(filterValue).toDateString();
                    case 'before': return new Date(loadValue) < new Date(filterValue);
                    case 'after': return new Date(loadValue) > new Date(filterValue);
                    default: return true;
                }
            }
        });

        if (!matchesOthers) {
            return false;
        }

        if (flagCriteria.length > 0) {
            const loadFlags = getFlagsForLoad(load, appState.loads.data);

            return flagCriteria.every(criterion => {
                const filterValues = Array.isArray(criterion.value) ? criterion.value : [criterion.value];
                if (filterValues.length === 0) return true;

                switch(criterion.operator) {
                    case 'isAnyOf':
                        return filterValues.some(val => loadFlags.has(String(val)));
                    case 'isAllOf':
                        return filterValues.every(val => loadFlags.has(String(val)));
                    case 'isNoneOf':
                        return !filterValues.some(val => loadFlags.has(String(val)));
                    default:
                        return true;
                }
            });
        }

        return true;
    });
}

const checkGoodOrBadMove = (load, allLoads) => {
    const isMoved = checkMovedLoad(load) || checkMondaysMovedLoad(load);
    if (!isMoved) return null;

    const grossWithoutLoad = calculateWeeklyGross(load.driver, load, allLoads) - (load.price || 0);
    const threshold = getGoodMoveThreshold(load.contract_type);
    return grossWithoutLoad > threshold ? 'bad_move' : 'good_move';
};

const calculateMovedLoadsSummary = (loads, view) => {
    let movedLoads;
    const fullDataset = appState.loads.data || [];

    if (view === 'all') {
        movedLoads = loads.filter(load => checkMovedLoad(load) || checkMondaysMovedLoad(load));
    } else {
        // --- THIS IS THE CORRECTED LINE ---
        movedLoads = loads.filter(load => checkGoodOrBadMove(load, fullDataset) === `${view}_move`);
    }

    const summary = movedLoads.reduce((acc, load) => {
        const team = load.team || 'No Team';
        const contractType = load.contract_type || 'Unknown';

        if (!acc[team]) {
            acc[team] = {};
        }
        if (!acc[team][contractType]) {
            acc[team][contractType] = 0;
        }
        acc[team][contractType]++;

        return acc;
    }, {});

    return summary;
};


// Add this function to render the summary card and its table
const renderMovedLoadsSummaryCard = () => {
    const card = document.getElementById('moved-loads-summary-card');
    const tableContainer = document.getElementById('moved-loads-summary-table');
    const titleContainer = document.getElementById('moved-loads-summary-title-container');
    const titleEl = document.getElementById('moved-loads-summary-title')?.querySelector('span');
    const dropdown = document.getElementById('moved-loads-summary-dropdown');

    if (!card || !tableContainer || !titleEl || !dropdown) return;

    const view = appState.loads.movedLoadsSummaryView;
    const dateFilteredLoads = getLoadsInDateRange();
    const summaryData = calculateMovedLoadsSummary(dateFilteredLoads, view);

    const viewTitles = {
        all: 'Moved Loads Summary',
        good: 'Good Moves Summary',
        bad: 'Bad Moves Summary'
    };
    titleEl.textContent = viewTitles[view];

    dropdown.querySelectorAll('.dropdown-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === view);
    });

    const teams = Object.keys(summaryData).sort();
    const contractTypes = [...new Set(Object.values(summaryData).flatMap(teamData => Object.keys(teamData)))].sort();

    if (teams.length === 0) {
        tableContainer.innerHTML = `<p class="text-gray-400 text-center p-4">No loads match the selected criteria.</p>`;
        return;
    }

    // --- START: New Highlighting Logic ---
    const allCellCounts = teams.flatMap(team =>
        contractTypes.map(type => summaryData[team][type] || 0)
    ).filter(count => count > 0);

    let cellThreshold = null;
    if (allCellCounts.length > 3) { // Only highlight if there's enough data
        allCellCounts.sort((a, b) => a - b);
        const percentileIndex = Math.floor(0.85 * allCellCounts.length);
        cellThreshold = allCellCounts[percentileIndex];
    }

    const allTotals = teams.map(team =>
        Object.values(summaryData[team]).reduce((sum, count) => sum + count, 0)
    ).filter(total => total > 0);

    let totalThreshold = null;
    if (allTotals.length > 3) {
        allTotals.sort((a, b) => a - b);
        const percentileIndex = Math.floor(0.85 * allTotals.length);
        totalThreshold = allTotals[percentileIndex];
    }
    // --- END: New Highlighting Logic ---

    let tableHTML = `
        <table class="w-full text-xs text-left text-gray-400">
            <thead class="text-xs text-gray-300 uppercase">
                <tr>
                    <th scope="col" class="px-3 py-2">Team</th>
                    ${contractTypes.map(type => `<th scope="col" class="px-3 py-2">${type}</th>`).join('')}
                    <th scope="col" class="px-3 py-2">Total</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-700">
    `;

    teams.forEach(team => {
        let total = 0;
        const rowData = contractTypes.map(type => {
            const count = summaryData[team][type] || 0;
            total += count;
            let tdClass = '';
            if (count === 0) {
                tdClass = 'is-zero';
            } else if (cellThreshold && count >= cellThreshold) {
                tdClass = 'is-high-value';
            }
            return `<td class="px-3 py-2 text-center ${tdClass}">${count}</td>`;
        }).join('');

        let totalTdClass = 'font-bold';
        if (total === 0) {
            totalTdClass = 'is-zero';
        } else if (totalThreshold && total >= totalThreshold) {
            totalTdClass = 'is-high-value font-bold';
        }

        tableHTML += `
            <tr class="hover:bg-gray-700/50">
                <td class="px-3 py-2 font-bold">${team}</td>
                ${rowData}
                <td class="px-3 py-2 text-center ${totalTdClass}">${total}</td>
            </tr>
        `;
    });

    tableHTML += `
            </tbody>
        </table>
    `;

    tableContainer.innerHTML = tableHTML;
};
const cardConfigs = [{
    id: 'moved-loads-summary-card',
    viewStateKey: 'movedLoadsSummaryView'
}];
const getGoodMoveThreshold = (contractType) => {
    const thresholds = appState.loads.goodMoveThresholds;
    return thresholds.by_contract[contractType] ?? thresholds.default;
};

const renderGoodMoveThresholdSettings = () => {
    const container = document.getElementById('good-move-thresholds-container');
    if (!container) return;

    const thresholds = appState.loads.goodMoveThresholds;
    const allContractTypes = appState.loads.contractTypes.map(c => c.id);

    let overridesHTML = '';
    for (const [contract, value] of Object.entries(thresholds.by_contract)) {
        overridesHTML += `
            <div class="threshold-row">
                <select class="contract-type-select settings-select" data-old-contract="${contract}">
                    ${allContractTypes.map(c => `<option value="${c}" ${c === contract ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
                <div class="input-dollar-sign-wrapper">
                    <span>$</span>
                    <input class="contract-value-input settings-input" type="number" step="100" data-contract="${contract}" value="${value}">
                </div>
                <button class="remove-threshold-btn" data-contract="${contract}" title="Remove override">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        `;
    }

    container.innerHTML = `
        <div class="setting-item">
            <label for="default-threshold-input" class="setting-label">Default Threshold</label>
            <div class="input-dollar-sign-wrapper">
                <span>$</span>
                <input id="default-threshold-input" type="number" step="100" value="${thresholds.default}" class="settings-input">
            </div>
        </div>
        <div class="border-t border-gray-700 my-4"></div>
        <p class="text-gray-400 text-xs mb-3">Contract-Specific Overrides</p>
        <div class="good-move-overrides-list">${overridesHTML}</div>
        <button id="add-threshold-btn">+ Add Specific Threshold</button>
    `;
};

const setupPickerToggleButton = (buttonSelector) => {
    const button = document.querySelector(buttonSelector);
    if (button && !button._toggleListenerAttached) {
        button.addEventListener('click', (e) => {
            // Check if the picker instance exists and is currently visible
            if (button.litepickerInstance && button.litepickerInstance.isShowing()) {
                // Stop the event to prevent litepicker from trying to re-open it
                e.stopPropagation();
                // Manually hide the picker
                button.litepickerInstance.hide();
            }
        }, true); // 'true' makes this listener run before litepicker's default one
        button._toggleListenerAttached = true; // Prevents adding the listener multiple times
    }
};


// 🟢 REPLACE this entire function in DISP. TEST/loads/loads_ui.js

export const initializeAnalyticsEventListeners = () => {
    // Helper function to set up a single togglable picker
    const setupTogglablePicker = (buttonSelector, startDateKey, endDateKey) => {
        const button = document.querySelector(buttonSelector);
        if (!button || button._pickerInitialized) return; // Prevent re-initialization

        // Create a hidden input to be the actual element for Litepicker
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        document.body.appendChild(hiddenInput); // Needs to be in the DOM

        const picker = new Litepicker({
            element: hiddenInput, // Attach to the hidden input, not the button
            singleMode: false,
            autoApply: true,
            format: 'MMM DD, YYYY',
            setup: (pickerInstance) => {
                pickerInstance.on('selected', (date1, date2) => {
                    const formatDate = (date) => date.getFullYear() + '-' + ('0' + (date.getMonth() + 1)).slice(-2) + '-' + ('0' + date.getDate()).slice(-2);
                    appState.loads[startDateKey] = formatDate(date1.dateInstance);
                    appState.loads[endDateKey] = formatDate(date2.dateInstance);
                    renderLoadsAnalyticsUI();
                });
            },
        });

        // Attach the picker to the visible button for access
        button.litepickerInstance = picker;
        button._pickerInitialized = true;

        // The main toggle logic
        button.addEventListener('click', () => {
            if (picker.isShowing) { // Corrected: No parentheses
                picker.hide();
            } else {
                picker.show(button);
            }
        });
    };

    // Set up both pickers with the new toggle logic
    setupTogglablePicker('#strategic-map-view .map-container:nth-child(1) .sidebar-btn[title="Date Range"]', 'mapAStartDate', 'mapAEndDate');
    setupTogglablePicker('#strategic-map-view .map-container:nth-child(2) .sidebar-btn[title="Date Range"]', 'mapBStartDate', 'mapBEndDate');

    // --- The rest of the function remains to handle other listeners ---
    const mapAFilterBtn = document.getElementById('map-a-filter-btn');
    if (mapAFilterBtn && !mapAFilterBtn._listenerAttached) {
        mapAFilterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            appState.loads.isMapAFilterOpen = !appState.loads.isMapAFilterOpen;
            appState.loads.isMapBFilterOpen = false;
            renderLoadsAnalyticsUI();
        });
        mapAFilterBtn._listenerAttached = true;
    }

    const mapBFilterBtn = document.getElementById('map-b-filter-btn');
    if (mapBFilterBtn && !mapBFilterBtn._listenerAttached) {
        mapBFilterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            appState.loads.isMapBFilterOpen = !appState.loads.isMapBFilterOpen;
            appState.loads.isMapAFilterOpen = false;
            renderLoadsAnalyticsUI();
        });
        mapBFilterBtn._listenerAttached = true;
    }

    if (!document.body.hasAttribute('data-map-filter-listener')) {
        document.body.setAttribute('data-map-filter-listener', 'true');
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.map-filter-popup') && !e.target.closest('.sidebar-btn[title="Filters"]')) {
                if (appState.loads.isMapAFilterOpen || appState.loads.isMapBFilterOpen) {
                    appState.loads.isMapAFilterOpen = false;
                    appState.loads.isMapBFilterOpen = false;
                    renderLoadsAnalyticsUI();
                }
            }
        });
    }

    const mapAModeSelect = document.getElementById('map-a-mode-select');
    if (mapAModeSelect && !mapAModeSelect._listenerAttached) {
        mapAModeSelect.addEventListener('change', (e) => {
            appState.loads.mapAMode = e.target.value;
            renderLoadsAnalyticsUI();
        });
        mapAModeSelect._listenerAttached = true;
    }

    const mapAMetricSelect = document.getElementById('map-a-metric-select');
    if (mapAMetricSelect && !mapAMetricSelect._listenerAttached) {
        mapAMetricSelect.addEventListener('change', (e) => {
            appState.loads.mapAMetric = e.target.value;
            renderLoadsAnalyticsUI();
        });
        mapAMetricSelect._listenerAttached = true;
    }

    const mapADirectionSelect = document.getElementById('map-a-direction-select');
    if (mapADirectionSelect && !mapADirectionSelect._listenerAttached) {
        mapADirectionSelect.addEventListener('change', (e) => {
            appState.loads.mapADirection = e.target.value;
            renderLoadsAnalyticsUI();
        });
        mapADirectionSelect._listenerAttached = true;
    }

    const mapBModeSelect = document.getElementById('map-b-mode-select');
    if (mapBModeSelect && !mapBModeSelect._listenerAttached) {
        mapBModeSelect.addEventListener('change', (e) => {
            appState.loads.mapBMode = e.target.value;
            renderLoadsAnalyticsUI();
        });
        mapBModeSelect._listenerAttached = true;
    }

    const mapBMetricSelect = document.getElementById('map-b-metric-select');
    if (mapBMetricSelect && !mapBMetricSelect._listenerAttached) {
        mapBMetricSelect.addEventListener('change', (e) => {
            appState.loads.mapBMetric = e.target.value;
            renderLoadsAnalyticsUI();
        });
        mapBMetricSelect._listenerAttached = true;
    }

    const mapBDirectionSelect = document.getElementById('map-b-direction-select');
    if (mapBDirectionSelect && !mapBDirectionSelect._listenerAttached) {
        mapBDirectionSelect.addEventListener('change', (e) => {
            appState.loads.mapBDirection = e.target.value;
            renderLoadsAnalyticsUI();
        });
        mapBDirectionSelect._listenerAttached = true;
    }

    const setupSlider = (sliderId, stateKey) => {
        const slider = document.getElementById(sliderId);
        if (slider && !slider._listenerAttached) {
            slider.addEventListener('input', (e) => {
                appState.loads[stateKey] = parseFloat(e.target.value);
                renderLoadsAnalyticsUI();
            });
            slider._listenerAttached = true;
        }
    };
    setupSlider('cluster-granularity-slider', 'mapAClusterSize');
    setupSlider('cluster-granularity-slider-b', 'mapBClusterSize');

    const switcher = document.getElementById('dashboard-switcher');
    if (switcher && !switcher._listenerAttached) {
        switcher.addEventListener('click', e => {
            const target = e.target.closest('.switcher-btn');
            if (target && target.dataset.view) {
                appState.loads.analyticsDashboardView = target.dataset.view;
                renderLoadsAnalyticsUI();
            }
        });
        switcher._listenerAttached = true;
    }
};

const renderMapFilterPopups = () => {
    const popupA = document.getElementById('map-a-filter-popup');
    if (popupA) popupA.classList.toggle('hidden', !appState.loads.isMapAFilterOpen);

    const popupB = document.getElementById('map-b-filter-popup');
    if (popupB) popupB.classList.toggle('hidden', !appState.loads.isMapBFilterOpen);
};

const initializeDatePickers = () => {
    const setupPicker = (buttonSelector, startDateKey, endDateKey) => {
        const button = document.querySelector(buttonSelector);
        if (!button) return;

        // --- FIX START ---
        // Destroy any existing picker instance before creating a new one
        if (button._picker) {
            button._picker.destroy();
        }
        // --- FIX END ---

        // Attach the new Litepicker instance
        const picker = new Litepicker({
            element: button,
            singleMode: false,
            format: 'MMM DD, YYYY',
            autoApply: true,
            setup: (picker) => {
                picker.on('selected', (date1, date2) => {
                    const formatDate = (date) => date.getFullYear() + '-' + ('0' + (date.getMonth() + 1)).slice(-2) + '-' + ('0' + date.getDate()).slice(-2);
                    appState.loads[startDateKey] = formatDate(date1.dateInstance);
                    appState.loads[endDateKey] = formatDate(date2.dateInstance);
                    renderLoadsAnalyticsUI();
                });
            }
        });

        // --- FIX START ---
        // Store the new picker instance on the button element itself
        button._picker = picker;
        // --- FIX END ---
    };

    setupPicker('#strategic-map-view .map-container:nth-child(1) .sidebar-btn[title="Date Range"]', 'mapAStartDate', 'mapAEndDate');
    setupPicker('#strategic-map-view .map-container:nth-child(2) .sidebar-btn[title="Date Range"]', 'mapBStartDate', 'mapBEndDate');
    
    // Also update the main loads table date pickers if they exist
    const startDateInput = document.getElementById('loads-start-date');
    if (startDateInput && !startDateInput._pickerAttached) {
        new Litepicker({ element: startDateInput, autoApply: true });
        startDateInput._pickerAttached = true;
    }
    const endDateInput = document.getElementById('loads-end-date');
    if (endDateInput && !endDateInput._pickerAttached) {
        new Litepicker({ element: endDateInput, autoApply: true });
        endDateInput._pickerAttached = true;
    }
};

// Global function to trigger the deep dive from the map
window.triggerDeepDive = (selection) => {
    // 1. Switch the main dashboard view to 'deep-dive'
    appState.loads.analyticsDashboardView = 'deep-dive';
    document.querySelectorAll('#dashboard-switcher .switcher-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === 'deep-dive');
    });
    document.querySelectorAll('.dashboard-view').forEach(view => {
        view.style.display = view.id === 'deep-dive-dashboard' ? 'flex' : 'none';
    });

    // 2. Render the dashboard with the selection data
    renderDeepDiveDashboard(appState.loads.data, selection);
};

// Add listener for the close button
document.getElementById('deep-dive-close-btn')?.addEventListener('click', () => {
    // Switch back to the performance view
    appState.loads.analyticsDashboardView = 'performance';
    renderLoadsAnalyticsUI();
});

// --- START: DEEP DIVE DASHBOARD LOGIC ---

// This global function is called by the map click handlers
window.showDeepDive = (selection) => {
    appState.loads.deepDiveSelection = selection; // Store the selected data
    appState.loads.analyticsDashboardView = 'deep-dive'; // Change the active view
    renderLoadsAnalyticsUI(); // Re-render the UI to show the new view
};

// Renders the main content of the deep dive dashboard
function renderDeepDiveDashboard() {
    const selection = appState.loads.deepDiveSelection;
    if (!selection) return;

    const container = document.getElementById('deep-dive-dashboard');
    container.innerHTML = `
        <div id="deep-dive-header" class="flex justify-between items-center mb-2 flex-shrink-0">
            <h3 id="deep-dive-title" class="text-xl font-bold text-white"></h3>
            <button id="deep-dive-close-btn" class="text-gray-400 hover:text-white">&times;</button>
        </div>
        <div id="deep-dive-kpis" class="grid grid-cols-4 gap-4 mb-4 flex-shrink-0"></div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-grow min-h-0">
            <div id="deep-dive-history-chart" class="chart-placeholder"></div>
            <div class="flex flex-col min-h-0">
                <div id="deep-dive-tabs-container" class="deep-dive-tabs flex-shrink-0"></div>
                <div id="deep-dive-tables-container" class="flex-grow relative min-h-0"></div>
            </div>
        </div>
    `;

    const { name, data } = selection;
    const allLoads = appState.loads.data || [];

    // Pre-process all loads to add state abbreviations for easier filtering
    const processedAllLoads = allLoads.map(load => {
        const puStateMatch = (load.pu_location || '').match(/,\s*([A-Z]{2})$/);
        load.pu_location_state = puStateMatch ? puStateMatch[1] : null;
        const doStateMatch = (load.do_location || '').match(/,\s*([A-Z]{2})$/);
        load.do_location_state = doStateMatch ? doStateMatch[1] : null;
        return load;
    });

    // Set Title & Close Button
    const titleEl = document.getElementById('deep-dive-title');
    if (titleEl) titleEl.textContent = `Deep Dive: ${name}`;
    document.getElementById('deep-dive-close-btn')?.addEventListener('click', () => {
        appState.loads.analyticsDashboardView = 'performance';
        appState.loads.deepDiveSelection = null;
        renderLoadsAnalyticsUI();
    });

    // KPIs
    const kpis = calculateDeepDiveKPIs(data, processedAllLoads, selection);
    renderDeepDiveKPIs(kpis);

    // Render Tabs and initial table
    renderDeepDiveTabsAndTables(data);

    // Render Chart
    renderDeepDiveHistoryChart(processedAllLoads, selection);
}

function calculateDeepDiveKPIs(selectedLoads, allLoads, selection) {
    const rpms = selectedLoads.map(l => parseFloat(l.rpm_all)).filter(rpm => !isNaN(rpm) && rpm > 0);
    const { type, name } = selection;
    
    let outboundCount = selectedLoads.length;
    let inboundCount = 0;
    
    if (type === 'State') {
        const stateAbbr = Object.keys(stateAbbrToFullName).find(key => stateAbbrToFullName[key] === name);
        inboundCount = allLoads.filter(l => l.do_location_state === stateAbbr).length;
    } else {
        // For clusters, a true inbound count is not feasible with current data.
        inboundCount = 'N/A';
    }

    let ratio = 'N/A';
    if (inboundCount !== 'N/A') {
        if (inboundCount > 0) {
            ratio = `${(outboundCount / inboundCount).toFixed(2)} : 1`;
        } else if (outboundCount > 0) {
            ratio = '∞';
        }
    }

    return {
        loadCount: selectedLoads.length,
        medianRpm: rpms.length > 0 ? calculateMedian(rpms) : 0,
        outboundInboundRatio: ratio,
        avgWeight: selectedLoads.reduce((sum, l) => sum + (parseFloat(l.weight) || 0), 0) / (selectedLoads.length || 1),
    };
}

function renderDeepDiveKPIs(kpis) {
    const container = document.getElementById('deep-dive-kpis');
    if (container) {
        container.innerHTML = `
            <div class="deep-dive-kpi-compact"><div class="kpi-title">Selected Loads</div><div class="kpi-value">${kpis.loadCount}</div></div>
            <div class="deep-dive-kpi-compact"><div class="kpi-title">Median RPM</div><div class="kpi-value">$${kpis.medianRpm.toFixed(2)}</div></div>
            <div class="deep-dive-kpi-compact"><div class="kpi-title">Out/In Ratio</div><div class="kpi-value">${kpis.outboundInboundRatio}</div></div>
            <div class="deep-dive-kpi-compact"><div class="kpi-title">Avg. Weight</div><div class="kpi-value">${kpis.avgWeight.toLocaleString(undefined, {maximumFractionDigits: 0})} lbs</div></div>
        `;
    }
}

function getTopLocations(selectedLoads, type) {
    const locationField = type === 'origin' ? 'pu_location' : 'do_location';
    const counts = selectedLoads.reduce((acc, load) => {
        const loc = (load[locationField] || 'Unknown').split(',')[0];
        acc[loc] = (acc[loc] || 0) + 1;
        return acc;
    }, {});
    
    return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10);
}

function renderTopLocationsTable(containerId, title, data) {
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = `
            <h4 class="market-list-title">${title}</h4>
            <ul class="market-list-items">
                ${data.length > 0 ? data.map(item => `<li><span>${item.name}</span><span class="font-bold">${item.count}</span></li>`).join('') : '<li class="text-gray-500">No data available.</li>'}
            </ul>
        `;
    }
}

function renderDeepDiveHistoryChart(allLoads, selection) {
    const container = d3.select("#deep-dive-history-chart");
    container.html("");
    const { type, definition } = selection;

    const weeklyData = allLoads.reduce((acc, load) => {
        let isMatch = false;
        if (type === 'State') {
            const locField = definition.direction === 'inbound' ? 'do_location' : 'pu_location';
            const stateAbbrMatch = (load[locField] || '').match(/,\s*([A-Z]{2})$/);
            if (stateAbbrMatch && stateAbbrMatch[1] === definition.stateAbbr) isMatch = true;
        } else { // Cluster
            const latField = definition.direction === 'inbound' ? 'do_latitude' : 'pu_latitude';
            const lonField = definition.direction === 'inbound' ? 'do_longitude' : 'pu_longitude';
            const lat = parseFloat(load[latField]);
            const lon = parseFloat(load[lonField]);
            if (!isNaN(lat) && !isNaN(lon)) {
                const GRID_SIZE = definition.clusterSize;
                const loadGridKey = `${Math.round(lat / GRID_SIZE) * GRID_SIZE},${Math.round(lon / GRID_SIZE) * GRID_SIZE}`;
                const clusterGridKey = `${Math.round(definition.lat / GRID_SIZE) * GRID_SIZE},${Math.round(definition.lon / GRID_SIZE) * GRID_SIZE}`;
                if (loadGridKey === clusterGridKey) isMatch = true;
            }
        }

        if (!isMatch || !load.pu_date) return acc;
        
        const week = d3.utcWeek.floor(new Date(load.pu_date));
        const weekKey = week.toISOString();
        if (!acc[weekKey]) acc[weekKey] = { date: week, rpms: [], volume: 0 };
        acc[weekKey].volume++;
        const rpm = parseFloat(load.rpm_all);
        if (!isNaN(rpm) && rpm > 0) acc[weekKey].rpms.push(rpm);
        return acc;
    }, {});

    const chartData = Object.values(weeklyData).map(d => ({ date: d.date, medianRpm: calculateMedian(d.rpms), volume: d.volume })).sort((a, b) => a.date - b.date);

    if (chartData.length < 2) {
        container.html('<span class="chart-placeholder-title">Not Enough Historical Data For Trend</span>');
        return;
    }
    // D3 chart drawing logic... (omitted for brevity, but the logic you already have is correct)
}

function renderDeepDiveTeamChart(selectedLoads) {
    const container = d3.select("#deep-dive-team-chart");
    container.html("");
    // D3 chart drawing logic... (omitted for brevity, but the logic you already have is correct)
}

// --- END: DEEP DIVE DASHBOARD LOGIC ---

function renderDeepDiveTabsAndTables(selectedLoads) {
    const tabsContainer = document.getElementById('deep-dive-tabs-container');
    const tablesContainer = document.getElementById('deep-dive-tables-container');
    if (!tabsContainer || !tablesContainer) return;

    const tabs = [
        { id: 'origins', label: 'Top Origins' },
        { id: 'dests', label: 'Top Destinations' },
        { id: 'teams', label: 'Top Teams' },
    ];

    tabsContainer.innerHTML = tabs.map(tab => `<button class="deep-dive-tab-btn" data-tab="${tab.id}">${tab.label}</button>`).join('');
    
    tablesContainer.innerHTML = `
        <div id="origins-content" class="deep-dive-tab-content">${renderTopLocationsTable('Top Origins (within selection)', getTopLocations(selectedLoads, 'origin'))}</div>
        <div id="dests-content" class="deep-dive-tab-content">${renderTopLocationsTable('Top Destinations (from selection)', getTopLocations(selectedLoads, 'destination'))}</div>
        <div id="teams-content" class="deep-dive-tab-content">${renderDeepDiveTeamTable(selectedLoads)}</div>
    `;

    const tabButtons = tabsContainer.querySelectorAll('.deep-dive-tab-btn');
    const tabContents = tablesContainer.querySelectorAll('.deep-dive-tab-content');

    const switchTab = (tabId) => {
        tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
        tabContents.forEach(content => content.classList.toggle('active', content.id === `${tabId}-content`));
    };

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Activate the first tab by default
    switchTab('origins');
}

function renderDeepDiveTeamTable(selectedLoads) {
    const teamData = selectedLoads.reduce((acc, load) => {
        const team = load.team || 'Unknown Team';
        if (!acc[team]) {
            acc[team] = { count: 0, rpms: [], gross: 0 };
        }
        acc[team].count++;
        acc[team].gross += load.gross_total || 0;
        const rpm = parseFloat(load.rpm_all);
        if (!isNaN(rpm) && rpm > 0) acc[team].rpms.push(rpm);
        return acc;
    }, {});

    const tableData = Object.entries(teamData)
        .map(([name, data]) => ({
            name,
            count: data.count,
            medianRpm: calculateMedian(data.rpms),
            totalGross: data.gross
        }))
        .sort((a, b) => b.count - a.count);

    if (tableData.length === 0) {
        return '<p class="text-gray-500 text-center p-4">No team data available.</p>';
    }

    return `
        <div class="market-list">
            <ul class="market-list-items">
                <li class="font-bold text-xs uppercase text-gray-400">
                    <span>Team</span>
                    <div class="flex gap-x-6 text-right">
                        <span class="w-20">Loads</span>
                        <span class="w-20">Median RPM</span>
                    </div>
                </li>
                ${tableData.map(item => `
                    <li>
                        <span>${item.name}</span>
                        <div class="flex gap-x-6 text-right font-mono">
                            <span class="w-20">${item.count}</span>
                            <span class="w-20 text-teal-400">$${item.medianRpm.toFixed(2)}</span>
                        </div>
                    </li>
                `).join('')}
            </ul>
        </div>
    `;
}