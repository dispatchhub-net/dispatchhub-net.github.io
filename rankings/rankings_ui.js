import { hasPermission, PERMISSIONS } from '../permissions.js';
import { renderClusterMap, renderDriverRouteMap } from '../loads/loads_maps.js';
import { renderDriverDeepDiveModal_Profiles, initializeProfileEventListeners } from '../profiles/profiles_ui.js';
import { canViewTeam, isAdmin, canViewDispatcher } from '../auth.js';
import { appState, allColumns, stubsSortConfig, setStubsSortConfig } from '../state.js';
import { coreMetrics, trophySvg, generateAllColumns } from '../config.js';
import { formatPercentage, calculateMedian, getPayrollWeekDateRange, generateDistinctColors } from '../utils.js';
import {
    getPreviousWeekData,
    getFilteredDataByDriverType,
    aggregateTeamData,
    processDataForMode,
    getOrComputeHistoricalMetrics,
    calculateBumpChartData,
    getFilteredBumpChartEntityNames,
    getIndividualEntityChartData,
    calculateConsistentlyLowPerformers,
    calculatePerformanceDrops,
    calculateTrendingData
} from './rankings_api.js';


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

// --- NEW: Refresh Status Display ---
export const renderRefreshStatus = () => {
    const statusContainer = document.getElementById('sidebar-refresh-status');
    if (!statusContainer) return;

    let iconHTML = '';
    let textHTML = '';
    let tooltipText = '';

    if (appState.isRefreshing) {
        iconHTML = `
            <svg class="animate-spin h-5 w-5 text-sky-400 nav-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>`;
        textHTML = `<span class="sidebar-text">Syncing...</span>`;
        tooltipText = 'Syncing new data...';
        statusContainer.classList.add('pointer-events-none'); // Disable clicking while syncing

    } else if (appState.lastRefreshed) {
        const timeString = new Date(appState.lastRefreshed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        iconHTML = `
            <svg class="h-5 w-5 text-green-400 nav-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>`;
        textHTML = `<span class="sidebar-text">Last updated: ${timeString}</span>`;
        tooltipText = `Last updated: ${timeString}`;
         statusContainer.classList.remove('pointer-events-none');
    }

    statusContainer.innerHTML = iconHTML + textHTML;

    const sidebarText = statusContainer.querySelector('.sidebar-text');
    if (sidebarText) {
        sidebarText.textContent = tooltipText;
    }
};


// --- Display Helper Functions ---

const getChangeDisplay = (currentValue, prevValue, metricInfo, isCurrency = false, isPercentageDifference = false, omitVsPrevWeek = false) => {
    let change = 0;
    let changeIndicator = '';
    let changeValue = 0;
    let changeColor = 'text-gray-300'; 

    if ((typeof prevValue === 'number' && !isNaN(prevValue)) && (typeof currentValue === 'number' && !isNaN(currentValue))) {
        if (isPercentageDifference) {
            change = (currentValue - prevValue);
            changeValue = Math.abs(change);
        } else {
            change = currentValue - prevValue;
            changeValue = Math.abs(change);
        }

        if (metricInfo && metricInfo.lowerIsWorse) {
            if (change < 0) {
                changeIndicator = 'up';
                changeColor = 'text-green-200';
            } else if (change > 0) {
                changeIndicator = 'down';
                changeColor = 'text-red-200';
            }
        } else {
            if (change > 0) {
                changeIndicator = 'up';
                changeColor = 'text-green-200';
            } else if (change < 0) {
                changeIndicator = 'down';
                changeColor = 'text-red-200';
            }
        }
    } else {
        return `<span class="text-gray-400 text-xs">-</span>`;
    }

    if (changeIndicator) {
        const prefix = change > 0 ? '+' : '';
        let displayChange;
        if (isPercentageDifference) {
            displayChange = `${(changeValue * 100).toFixed(1)}%`;
        } else {
            displayChange = isCurrency ? `$${changeValue.toFixed(2)}` : changeValue.toFixed(0);
        }

        const vsPrevWeekText = omitVsPrevWeek ? '' : ' vs Prev. Week';

        return `
            <span class="${changeColor} text-xs font-semibold flex items-center">
                ${changeIndicator === 'up' ? '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 mr-1"><polyline points="12 17 12 3"/><path d="m6 9 6-6 6 6"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 mr-1"><polyline points="12 7 12 21"/><path d="m18 15-6 6-6-6"/></svg>'}
                ${prefix}${displayChange}${vsPrevWeekText}
            </span>
        `;
    }
    return `<span class="text-gray-400 text-xs">No change</span>`; 
};

// --- View Management & Drag-and-Drop Logic ---

function captureCurrentViewState() {
    return {
        rankingMode: appState.rankingMode,
        filters: JSON.parse(JSON.stringify(appState.filters)),
        minDriverSetting: JSON.parse(JSON.stringify(appState.minDriverSetting)),
        visibleColumns: Array.from(appState.visibleColumns.entries()),
        columnOrder: allColumns.map(c => c.id),
        sortConfig: JSON.parse(JSON.stringify(appState.sortConfig)),
        tableMaxHeight: appState.tableMaxHeight,
        visibleKeyMetrics: [...appState.visibleKeyMetrics],
        driverTypeFilter: appState.driverTypeFilter,
    };
};

function applyViewState(viewState) {
    appState.rankingMode = viewState.rankingMode || 'dispatcher';
    appState.filters = viewState.filters;
    appState.minDriverSetting = viewState.minDriverSetting;
    appState.visibleColumns = new Map(viewState.visibleColumns);
    
    allColumns.sort((a, b) => {
        return viewState.columnOrder.indexOf(a.id) - viewState.columnOrder.indexOf(b.id);
    });
    
    appState.sortConfig = viewState.sortConfig;
    appState.tableMaxHeight = viewState.tableMaxHeight;
    appState.visibleKeyMetrics = viewState.visibleKeyMetrics;
    appState.driverTypeFilter = viewState.driverTypeFilter;
    
    // We need to re-process and re-render
    processDataForMode();
    getOrComputeHistoricalMetrics();
    renderUI();
};

export function saveView(viewName) {
    if (!viewName) {
        console.warn("Please enter a name for the view.");
        return;
    }
    const savedViews = JSON.parse(localStorage.getItem('dispatcherHubViews')) || {};
    savedViews[viewName] = captureCurrentViewState();
    localStorage.setItem('dispatcherHubViews', JSON.stringify(savedViews));

    let viewOrder = JSON.parse(localStorage.getItem('dispatcherHubViewsOrder')) || [];
    if (!viewOrder.includes(viewName)) {
        viewOrder.push(viewName);
        localStorage.setItem('dispatcherHubViewsOrder', JSON.stringify(viewOrder));
    }

    renderViewDropdown();
};

export function loadView(viewName) {
    if (viewName === 'Default View') {
        loadDefaultView();
        processDataForMode();
        getOrComputeHistoricalMetrics();
        renderUI();
    } else if (viewName === '1wk ALL View') {
        load1WkAllView();
    } else if (viewName === '4wk ALL View') {
        load4WkAllView();
    } else if (viewName === 'Regional View') { 
        loadRegionalView();
    } else {
        const savedViews = JSON.parse(localStorage.getItem('dispatcherHubViews')) || {};
        const viewState = savedViews[viewName];
        if (viewState) {
            applyViewState(viewState);
        }
    }
};

export function deleteView(viewName) {
    let savedViews = JSON.parse(localStorage.getItem('dispatcherHubViews')) || {};
    delete savedViews[viewName];
    localStorage.setItem('dispatcherHubViews', JSON.stringify(savedViews));

    let viewOrder = JSON.parse(localStorage.getItem('dispatcherHubViewsOrder')) || [];
    viewOrder = viewOrder.filter(v => v !== viewName);
    localStorage.setItem('dispatcherHubViewsOrder', JSON.stringify(viewOrder));

    renderViewDropdown();
};

export function loadDefaultView() {
    const defaultColumns = generateAllColumns();
    const visibleColumnsMap = new Map();
    defaultColumns.forEach(col => {
        visibleColumnsMap.set(col.id, col.defaultVisible);
    });
    
    appState.rankingMode = 'dispatcher';
    appState.filters = [];
    appState.minDriverSetting = { type: 'numDrivers', value: 3 };
    appState.visibleColumns = visibleColumnsMap;
    appState.sortConfig = { key: 'rank', direction: 'ascending' };
    appState.tableMaxHeight = 500;
    appState.visibleKeyMetrics = [];
    appState.driverTypeFilter = 'all';
};

export function load1WkAllView() {
    const allColumns = generateAllColumns();
    const visibleColumnsMap = new Map();
    const oneWkColumnIds = new Set([
        'rank', 'entityName', 'dispatcherTeam', 'numOOs', 'numLOOs', 
        'pNet_current', 'pDriverGross_current', 'pMargin_current', 'pMileage_current', 
        'pMainCriteriaNetDriverMargin_current', 'pMainCriteria2CashFlow_current', 'mainCriteria_current'
    ]);

    allColumns.forEach(col => {
        visibleColumnsMap.set(col.id, oneWkColumnIds.has(col.id));
    });

    appState.visibleColumns = visibleColumnsMap;
    // Keep other state like filters, sort, etc., as they are, just change columns
    renderUI();
};

export function load4WkAllView() {
    const allColumns = generateAllColumns();
    const visibleColumnsMap = new Map();
    const fourWkColumnIds = new Set([
        'rank', 'entityName', 'dispatcherTeam', 'numOOs_4wkAvg', 'numLOOs_4wkAvg',
        'pNet_4wkAvg', 'pDriverGross_4wkAvg', 'pMargin_4wkAvg', 'pMileage_4wkAvg',
        'pMainCriteriaNetDriverMargin_4wkAvg', 'pMainCriteria2CashFlow_4wkAvg', 'mainCriteria_4wkAvg'
    ]);

    allColumns.forEach(col => {
        visibleColumnsMap.set(col.id, fourWkColumnIds.has(col.id));
    });
    
    appState.visibleColumns = visibleColumnsMap;
    // Keep other state like filters, sort, etc., as they are, just change columns
    renderUI();
};

export function loadRegionalView() {
    const allColumns = generateAllColumns();
    const visibleColumnsMap = new Map();
    const regionalColumnIds = new Set([
        'rank', 'entityName', 'dispatcherTeam', 'numDrivers',
        'region_northeast_1wk', 'region_northeast_4wk',
        'region_southeast_1wk', 'region_southeast_4wk',
        'region_midwest_1wk', 'region_midwest_4wk',
        'region_south_1wk', 'region_south_4wk',
        'region_west_1wk', 'region_west_4wk',
        'region_mountain_west_1wk', 'region_mountain_west_4wk',
        'mainCriteria_current'
    ]);

    allColumns.forEach(col => {
        visibleColumnsMap.set(col.id, regionalColumnIds.has(col.id));
    });
    
    appState.visibleColumns = visibleColumnsMap;
    renderUI();
}

function handleViewDragStart(e) {
    setDraggedViewName(e.currentTarget.dataset.viewName);
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.setData('text/plain', e.currentTarget.dataset.viewName);
    e.dataTransfer.effectAllowed = 'move';
}

function handleViewDragOver(e) {
    e.preventDefault();
    const targetItem = e.target.closest('[data-view-name]');
    if (targetItem && targetItem.dataset.viewName !== appState.draggedViewName) {
        document.querySelectorAll('#saved-views-list [data-view-name]').forEach(el => el.classList.remove('drag-over'));
        targetItem.classList.add('drag-over');
    }
}

function handleViewDragLeave(e) {
    const targetItem = e.target.closest('[data-view-name]');
    if (targetItem) {
        targetItem.classList.remove('drag-over');
    }
}

function handleViewDrop(e) {
    e.preventDefault();
    const targetItem = e.target.closest('[data-view-name]');
    if (targetItem) {
        targetItem.classList.remove('drag-over');
        const droppedOnViewName = targetItem.dataset.viewName;

        if (appState.draggedViewName && appState.draggedViewName !== droppedOnViewName) {
            let viewOrder = JSON.parse(localStorage.getItem('dispatcherHubViewsOrder')) || [];
            const draggedIndex = viewOrder.indexOf(appState.draggedViewName);
            const droppedOnIndex = viewOrder.indexOf(droppedOnViewName);
            if (draggedIndex > -1 && droppedOnIndex > -1) {
                const [draggedItem] = viewOrder.splice(draggedIndex, 1);
                viewOrder.splice(droppedOnIndex, 0, draggedItem);
                localStorage.setItem('dispatcherHubViewsOrder', JSON.stringify(viewOrder));
                renderViewDropdown();
            }
        }
    }
}

function handleViewDragEnd(e) {
    document.querySelectorAll('#saved-views-list [data-view-name]').forEach(el => {
        el.classList.remove('dragging', 'drag-over');
    });
    setDraggedViewName(null);
}

const getRankChangeDisplay = (currentValue, prevValue) => {
    let change = 0;
    let changeIndicator = '';
    let changeColor = 'text-gray-300';
    let changeText = ''; 

    if ((typeof prevValue === 'number' && !isNaN(prevValue)) && (typeof currentValue === 'number' && !isNaN(currentValue))) {
        change = currentValue - prevValue;
        changeText = Math.abs(change).toFixed(0); 

        if (change === 0) {
            return ``; 
        }

        if (change < 0) { 
            changeIndicator = 'up';
            changeColor = 'text-green-400';
        } else if (change > 0) { 
            changeIndicator = 'down';
            changeColor = 'text-red-400';
        }
    } else {
        return ``; 
    }

    if (changeIndicator) {
        return `
            <span class="${changeColor} flex items-center group relative cursor-help">
                ${changeIndicator === 'up' ? '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 ml-1 inline-block"><polyline points="12 17 12 3"/><path d="m6 9 6-6 6 6"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 ml-1 inline-block"><polyline points="12 7 12 21"/><path d="m18 15-6 6-6-6"/></svg>'}
                <span class="rank-change-tooltip hidden group-hover:block bg-gray-700 text-gray-100 text-xs rounded-md py-1 px-2 -top-6 left-0 whitespace-nowrap shadow-lg">
                ${changeIndicator === 'up' ? 'Up' : 'Down'} ${changeText} places
            </span>
            </span>
        `;
    }
    return ``; 
};

const getSortIcon = (key) => {
    if (appState.sortConfig.key === key) {
        return appState.sortConfig.direction === 'ascending' ?
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 ml-1 inline-block"><polyline points="18 15 12 9 6 15"/></svg>' :
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 ml-1 inline-block"><polyline points="6 9 12 15 18 9"/></svg>';
    }
    return '';
};

const getHeatmapColor = (value, stats, metricInfo) => {
    if (value === null || isNaN(value) || stats.min === undefined || stats.max === undefined || stats.median === undefined) {
        return '';
    }

    const lowColor = '#dc2626'; 
    const midColor = '#4a5568';
    const highColor = '#059669';

    let colorScale;

    if (metricInfo && metricInfo.lowerIsWorse) {
        colorScale = d3.scaleLinear()
            .domain([stats.max, stats.median, stats.min])
            .range([lowColor, midColor, highColor])
            .clamp(true);
    } else {
        colorScale = d3.scaleLinear()
            .domain([stats.min, stats.median, stats.max])
            .range([lowColor, midColor, highColor])
            .clamp(true);
    }

    return colorScale(value);
};

// --- Main Render Functions ---

export const renderUI = () => {
    renderLoadingAndError();
    if (!appState.loading && !appState.error) {
        document.getElementById('main-content').classList.remove('hidden');
        renderRefreshStatus();
        updateDynamicTitles();
        updateDriverTypeSwitcherUI();
        renderKeyMetrics();
        renderMainTable();
        renderColumnVisibilityDropdown();
        renderBumpChartSection();
        renderPerformanceTrackerSections();
        renderFilterDropdown();
        renderViewDropdown();
    } else {
        document.getElementById('main-content').classList.add('hidden');
    }
    renderModals();
};

const renderLoadingAndError = () => {
    const fullPageLoader = document.getElementById('full-page-loader');
    const appWrapper = document.getElementById('app-wrapper');
    const errorMessage = document.getElementById('error-message');
    const errorDetails = document.getElementById('error-details');

    if (appState.loading) {
        fullPageLoader.classList.remove('hidden');
        appWrapper.classList.add('hidden');
    } else {
        fullPageLoader.classList.add('hidden');
        if (appState.error) {
            appWrapper.classList.remove('hidden');
            errorMessage.classList.remove('hidden');
            errorDetails.textContent = appState.error;
        } else {
            appWrapper.classList.remove('hidden');
            errorMessage.classList.add('hidden');
        }
    }
};

const renderKeyMetrics = () => {
    const keyMetricsContainer = document.getElementById('key-metrics-overview');
    keyMetricsContainer.innerHTML = '';

    const currentData = appState.data;
    const prevWeekDataRaw = getFilteredDataByDriverType(getPreviousWeekData(appState.selectedDate));
    
    const prevWeekAggregated = appState.rankingMode === 'team'
        ? aggregateTeamData(prevWeekDataRaw)
        : prevWeekDataRaw;

    const getCardData = (metricId) => {
        const is4wk = metricId.endsWith('_4wkAvg');
        let baseId = metricId.replace('_4wkAvg', '');
        
        if (baseId === 'driverHappiness') baseId = 'pMainCriteriaNetDriverMargin';
        if (baseId === 'companyHappiness') baseId = 'pMainCriteria2CashFlow';
        
        const metricInfo = coreMetrics.find(m => m.id === baseId) || {label: baseId, unit: ''};
        let cardData = { label: metricInfo.label, displayValue: '-', changeDisplay: '-', icon: '' };
        
        let currentValue, prevValue;
        
        // --- THIS IS THE CORRECTED LOGIC ---
        const currentField = is4wk ? `${baseId}_4wkAvg` : `${baseId}_current`;
        // FIX: The key for the previous week's data depends on the ranking mode.
        // Team data has a "_current" suffix, while dispatcher data does not.
        const prevField = is4wk ? `${baseId}_4wkAvg` : (appState.rankingMode === 'team' ? `${baseId}_current` : baseId);

        const iconMap = {
            pDriverGross: `<div class="p-0.5 rounded-full bg-indigo-600 bg-opacity-20 text-indigo-400"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>`,
            pNet: `<div class="p-0.5 rounded-full bg-lime-600 bg-opacity-20 text-lime-400"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>`,
            pMileage: `<div class="p-0.5 rounded-full bg-amber-600 bg-opacity-20 text-amber-400"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M14 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3"/><path d="M9 12H4"/><path d="m18 12 3-3-3-3"/><path d="M13 17H4"/></svg></div>`,
            pMargin: `<div class="p-0.5 rounded-full bg-rose-600 bg-opacity-20 text-rose-400"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></svg></div>`,
        };

        switch(baseId) {
            case 'totalDrivers':
                cardData.label = 'Total Drivers';
                currentValue = currentData.reduce((acc, curr) => acc + (isNaN(curr.numDrivers) ? 0 : curr.numDrivers), 0);
                prevValue = prevWeekAggregated.reduce((acc, curr) => acc + (isNaN(curr.numDrivers) ? 0 : curr.numDrivers), 0);
                cardData.displayValue = currentValue;
                cardData.changeDisplay = getChangeDisplay(currentValue, prevValue, { lowerIsWorse: false });
                cardData.icon = `<div class="p-0.5 rounded-full bg-purple-600 bg-opacity-20 text-purple-400"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>`;
                break;
            case 'totalDispatchers':
                cardData.label = appState.rankingMode === 'team' ? 'Total Teams' : 'Total Dispatchers';
                currentValue = currentData.length;
                prevValue = prevWeekAggregated.length;
                cardData.displayValue = currentValue;
                cardData.changeDisplay = getChangeDisplay(currentValue, prevValue, { lowerIsWorse: false });
                cardData.icon = `<div class="p-0.5 rounded-full bg-cyan-600 bg-opacity-20 text-cyan-400"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>`;
                break;
            default: // Handles all other metrics including rpmAll, mainCriteria, etc.
                cardData.label = is4wk ? `${metricInfo.label} (4W)` : metricInfo.label;
                const currentValues = currentData.map(d => d[currentField]).filter(v => typeof v === 'number');
                currentValue = calculateMedian(currentValues);
                
                const prevValues = prevWeekAggregated.map(d => d[prevField]).filter(v => typeof v === 'number' && !isNaN(v));
                // FIX: Check if there are previous values before calculating median to avoid treating 0 as a value
                prevValue = prevValues.length > 0 ? calculateMedian(prevValues) : null;

                if (baseId === 'rpmAll') {
                     cardData.displayValue = `$${(isNaN(currentValue) || currentValue === null ? 0 : currentValue).toFixed(2)}`;
                     cardData.changeDisplay = getChangeDisplay(currentValue, prevValue, { lowerIsWorse: false }, true);
                } else {
                     cardData.displayValue = formatPercentage(currentValue);
                     cardData.changeDisplay = getChangeDisplay(currentValue, prevValue, { lowerIsWorse: false }, false, true);
                }

                if (baseId === 'mainCriteria') cardData.icon = `<div class="p-0.5 rounded-full bg-emerald-600 bg-opacity-20 text-emerald-400"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div>`;
                else if (baseId === 'pMainCriteriaNetDriverMargin') cardData.icon = `<div class="p-0.5 rounded-full bg-orange-600 bg-opacity-20 text-orange-400"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" class="w-4 h-4"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15s-2-2-4-2-4 2-4 2v-2s2-2 4-2 4 2 4 2zm-1-8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm6 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg></div>`;
                else if (baseId === 'pMainCriteria2CashFlow') cardData.icon = `<div class="p-0.5 rounded-full bg-blue-600 bg-opacity-20 text-blue-400"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" class="w-4 h-4"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15s-2-2-4-2-4 2-4 2v-2s2-2 4-2 4 2 4 2zm-1-8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm6 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg></div>`;
                else if (baseId === 'rpmAll') cardData.icon = `<div class="p-0.5 rounded-full bg-pink-600 bg-opacity-20 text-pink-400"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>`;
                else cardData.icon = iconMap[baseId] || `<div class="p-0.5 rounded-full bg-gray-600 bg-opacity-20 text-gray-400"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></svg></div>`;
                break;
        }
        return cardData;
    };

    appState.visibleKeyMetrics.forEach(metricId => {
        const data = getCardData(metricId);
        const card = document.createElement('div');
        card.className = "bg-gray-800 border-2 border-gray-700 rounded-xl p-1 shadow-lg flex flex-col items-start space-y-0.5 flex-1 min-w-[140px]";
        card.innerHTML = `
            <div class="flex items-center space-x-1">
                ${data.icon}
                <p class="text-gray-400 text-xs uppercase font-semibold">${data.label}</p>
            </div>
            <p class="text-md font-bold text-gray-200">${data.displayValue}</p>
            ${data.changeDisplay}
        `;
        keyMetricsContainer.appendChild(card);
    });
};

const applyStickyStyles = () => {
    const tableHead = document.getElementById('main-table-head')?.querySelector('tr');
    const tableBody = document.getElementById('main-table-body');

    if (!tableHead || !tableBody || tableHead.children.length === 0) {
        return;
    }

    const pinnedLeft = appState.pinnedLeftColumns.map(id => allColumns.find(c => c.id === id)).filter(Boolean);
    const pinnedRight = appState.pinnedRightColumns.map(id => allColumns.find(c => c.id === id)).filter(Boolean);
    const unpinned = allColumns.filter(c => !appState.pinnedLeftColumns.includes(c.id) && !appState.pinnedRightColumns.includes(c.id));
    const orderedColumns = [...pinnedLeft, ...unpinned, ...pinnedRight];
    const visibleCols = orderedColumns.filter(col => {
        if (appState.rankingMode === 'team' && (col.id === 'dispatcherTeam' || col.id === 'weeksIncluded_4wkAvg')) return false;
        if (appState.rankingMode === 'dispatcher' && col.id === 'numDispatchers') return false;
        return appState.visibleColumns.get(col.id);
    });

    const ths = Array.from(tableHead.children);
    let leftOffset = 0;
    let rightOffset = 0;

    visibleCols.forEach((col, index) => {
        if (appState.pinnedLeftColumns.includes(col.id)) {
            const th = ths[index];
            if (!th) return;
            const width = th.offsetWidth;
            th.style.left = `${leftOffset}px`;
            Array.from(tableBody.children).forEach(row => {
                if (row.children[index]) {
                    row.children[index].style.left = `${leftOffset}px`;
                }
            });
            leftOffset += width;
        }
    });

    for (let i = visibleCols.length - 1; i >= 0; i--) {
        const col = visibleCols[i];
        if (appState.pinnedRightColumns.includes(col.id)) {
            const th = ths[i];
            if (!th) return;
            const width = th.offsetWidth;
            th.style.right = `${rightOffset}px`;
            Array.from(tableBody.children).forEach(row => {
                if (row.children[i]) {
                    row.children[i].style.right = `${rightOffset}px`;
                }
            });
            rightOffset += width;
        }
    }
};

export const renderMainTable = () => {
    const tableHead = document.getElementById('main-table-head').querySelector('tr');
    const tableBody = document.getElementById('main-table-body');
    const mainTableContainer = document.getElementById('main-table-container');
    const user = appState.auth.user; // Get the current user

    const columnsToRedact = new Set([
        'pMargin_dollar', 'pDriver_gross', 'pDefault_fuel', 'pEstimated_fuel', 
        'pEstimated_tolls', 'pMaintenance', 'pDepreciation', 'pTotal_gross', 'pEstimated_net'
    ]);

    if (mainTableContainer) {
        mainTableContainer.style.maxHeight = `${appState.tableMaxHeight}px`;
    }

    tableHead.innerHTML = '';
    tableBody.innerHTML = '';

    const pinnedLeft = appState.pinnedLeftColumns.map(id => allColumns.find(c => c.id === id)).filter(Boolean);
    const pinnedRight = appState.pinnedRightColumns.map(id => allColumns.find(c => c.id === id)).filter(Boolean);
    const unpinned = allColumns.filter(c => !appState.pinnedLeftColumns.includes(c.id) && !appState.pinnedRightColumns.includes(c.id));
    const orderedColumns = [...pinnedLeft, ...unpinned, ...pinnedRight];

    let visibleCols = orderedColumns.filter(col => {
        if (appState.rankingMode === 'team' && (col.id === 'dispatcherTeam' || col.id === 'weeksIncluded_4wkAvg')) return false;
        if (appState.rankingMode === 'dispatcher' && col.id === 'numDispatchers') return false;
        return appState.visibleColumns.get(col.id);
    });

    let filteredData = applyFilters(appState.data);

    filteredData = filteredData.map(d => {
        let isBelowMin = false;
        const minType = appState.minDriverSetting.type;
        const minValue = appState.minDriverSetting.value;
        if (minType !== 'none' && d[minType] !== null && d[minType] !== undefined) {
            isBelowMin = d[minType] < minValue;
        }
        return { ...d, _isBelowMinDrivers: isBelowMin };
    });

    const sortedData = [...filteredData].sort((a, b) => {
        const key = appState.sortConfig.key;
        let aValue = a[key];
        let bValue = b[key];
        if (key === 'rank') {
            aValue = a['_sortRank'];
            bValue = b['_sortRank'];
            return (aValue || Infinity) - (bValue || Infinity);
        }
        if (aValue === null || aValue === undefined) return appState.sortConfig.direction === 'ascending' ? 1 : -1;
        if (bValue === null || bValue === undefined) return appState.sortConfig.direction === 'ascending' ? -1 : 1;
        if (aValue < bValue) return appState.sortConfig.direction === 'ascending' ? -1 : 1;
        if (aValue > bValue) return appState.sortConfig.direction === 'ascending' ? 1 : -1;
        return 0;
    });

    const eligibleForRanking = sortedData.filter(d => !d._isBelowMinDrivers);
    const finalVisibleRanks = new Map(
        eligibleForRanking
            .sort((a, b) => (b.mainCriteria_current || -Infinity) - (a.mainCriteria_current || -Infinity))
            .map((d, i) => [d.entityName, i + 1])
    );

    visibleCols.forEach(col => {
        const th = document.createElement('th');
        const isPinnedLeft = appState.pinnedLeftColumns.includes(col.id);
        const isPinnedRight = appState.pinnedRightColumns.includes(col.id);

        th.className = `${col.width} px-1 py-1 text-xs font-medium text-gray-300 uppercase tracking-wider select-none whitespace-nowrap ${col.id === 'rank' ? 'text-left' : 'text-center'}`;
        
        if (isPinnedLeft) th.classList.add('sticky', 'sticky-left');
        if (isPinnedRight) th.classList.add('sticky', 'sticky-right');
        
        // Add Tooltip logic here
        if (col.tooltip) {
            th.setAttribute('title', col.tooltip);
            th.classList.add('cursor-help'); // Optional: change cursor to question mark
        }

        th.innerHTML = `${col.id === 'entityName' ? (appState.rankingMode === 'team' ? 'Team Name' : 'Dispatcher Name') : col.label} ${getSortIcon(col.id)}`;
        th.onclick = () => requestSort(col.id);
        tableHead.appendChild(th);
    });

    sortedData.forEach(entity => {
        const tr = document.createElement('tr');
        tr.className = `transition duration-150 ease-in-out cursor-pointer ${ appState.selectedEntity && appState.selectedEntity.entityName === entity.entityName ? 'bg-teal-900 bg-opacity-70' : ''} ${entity._isBelowMinDrivers ? 'opacity-50 grayscale' : ''} relative`;
        tr.onclick = () => handleRowClick(entity);

        let shouldRedact = false;
        if (!hasPermission(user, PERMISSIONS.VIEW_ALL_DISPATCHERS) && !hasPermission(user, PERMISSIONS.VIEW_ALL_TEAMS)) {
            if (appState.rankingMode === 'team') {
                shouldRedact = !canViewTeam(entity.entityName);
            } else {
                shouldRedact = !canViewDispatcher(entity.entityName);
            }
        }

        visibleCols.forEach(col => {
            const td = document.createElement('td');
            const isPinnedLeft = appState.pinnedLeftColumns.includes(col.id);
            const isPinnedRight = appState.pinnedRightColumns.includes(col.id);

            td.className = `${col.width} px-1 py-1 whitespace-nowrap text-xs ${col.id === 'rank' || col.id === 'entityName' ? 'text-left' : 'text-center'}`;
            if (col.id === 'entityName') td.className = `${col.width} px-1 py-1 whitespace-nowrap text-left text-sm font-bold`;
            
            if (isPinnedLeft) td.classList.add('sticky', 'sticky-left');
            if (isPinnedRight) td.classList.add('sticky', 'sticky-right');

            let content = '';
            const baseMetricId = col.id.replace(/_(current|4wkAvg)$/, '');
            const metricInfo = coreMetrics.find(m => m.id === baseMetricId);
            const value = entity[col.id];

            if (shouldRedact && columnsToRedact.has(baseMetricId)) {
                content = '<span class="text-gray-500">-</span>';
            } else {
                const formatChangeValue = (val) => {
                    if (val === null || isNaN(val)) return '<span class="text-gray-400">-</span>';
                    const color = val > 0 ? 'text-green-200' : val < 0 ? 'text-red-200' : 'text-gray-300';
                    const sign = val > 0 ? '+' : '';
                    return `<span class="${color}">${sign}${(val * 100).toFixed(1)}%</span>`;
                };

                switch (col.id) {
                    case 'rank':
                        const displayRank = finalVisibleRanks.get(entity.entityName);
                        content = `<span class="font-bold text-gray-100 flex items-center justify-start">${entity._isBelowMinDrivers ? '-' : (displayRank || '-')} ${getRankChangeDisplay(displayRank, entity.prevRank)}</span>`;
                        break;
                    case 'entityName':
                        const finalRank = finalVisibleRanks.get(entity.entityName);
                        const trophyType = finalRank <= 3 ? ['gold', 'silver', 'bronze'][finalRank - 1] : null;
                        let entityTrophy = trophyType && !entity._isBelowMinDrivers ? trophySvg[trophyType] : '';
                        const statusCircle = entity.statusColor ? `<span class="inline-block w-[0.25rem] h-[0.25rem] mr-2 rounded-full" style="background-color: ${entity.statusColor};"></span>` : '';
                        content = `<div class="flex items-center">${statusCircle}<span class="text-gray-200">${value === null ? '-' : value}</span>${entityTrophy}</div>`;
                        break;
                    case 'mainCriteria_1wkChange':
                    case 'mainCriteria_1wkChange_4wksAgo':
                    case 'mainCriteria_4wkAvg_1wkChange':
                    case 'mainCriteria_4wkAvg_4wkChange':
                        content = formatChangeValue(value);
                        break;
                        default:
                            if (metricInfo) {
                                let displayValue;
                                if (value === null || value === undefined || isNaN(value)) {
                                    displayValue = '-';
                                } else if (metricInfo.unit === '%') {
                                    displayValue = formatPercentage(value);
                                } else if (metricInfo.id === 'rpmAll' || metricInfo.id === 'pDriver_rpm') {
                                    displayValue = `$${value.toFixed(2)}`;
                                } else if (metricInfo.unit === '$') {
                                    displayValue = `$${value.toLocaleString('en-US', {maximumFractionDigits: 0})}`;
                                } else {
                                    displayValue = value.toLocaleString('en-US', {maximumFractionDigits: 0});
                                }
                                content = `<span class="${col.color}${baseMetricId === 'mainCriteria' ? ' font-bold' : ''}">${displayValue}</span>`;
                            } else {
                                // --- Logic for Regional & Generic Columns ---
                                const textColorClass = col.color || 'text-gray-300';
                                let displayVal;
    
                                if (value === null || value === undefined) {
                                    displayVal = '-';
                                } else if (col.unit === '%' && typeof value === 'number') {
                                    // Format decimals (0.15) into percentages (15.0%)
                                    displayVal = formatPercentage(value); 
                                } else if (col.decimalPlaces) {
                                    displayVal = parseFloat(value).toFixed(col.decimalPlaces);
                                } else if (typeof value === 'number' && String(value).includes('.')) {
                                    displayVal = parseFloat(value).toFixed(0);
                                } else {
                                    displayVal = value;
                                }
    
                                content = `<span class="${textColorClass}">${displayVal}</span>`;
                            }
                            break;
                }
            }
            td.innerHTML = content;
            tr.appendChild(td);
        });
        tableBody.appendChild(tr);
    });

    requestAnimationFrame(applyStickyStyles);
};

// --- Other Component Render Functions ---

export const renderColumnVisibilityDropdown = () => {
    const container = document.getElementById('column-checkboxes');
    if (!container) return;
    container.innerHTML = ''; 

    const handlePin = (columnId, side) => {
        const leftIndex = appState.pinnedLeftColumns.indexOf(columnId);
        const rightIndex = appState.pinnedRightColumns.indexOf(columnId);

        if (leftIndex > -1) appState.pinnedLeftColumns.splice(leftIndex, 1);
        if (rightIndex > -1) appState.pinnedRightColumns.splice(rightIndex, 1);

        if (side === 'left') {
            appState.pinnedLeftColumns.push(columnId);
        } else if (side === 'right') {
            appState.pinnedRightColumns.push(columnId);
        }
        renderUI();
    };

    allColumns.forEach(col => {
        const isVisible = appState.visibleColumns.get(col.id);
        const isPinnedLeft = appState.pinnedLeftColumns.includes(col.id);
        const isPinnedRight = appState.pinnedRightColumns.includes(col.id);

        const wrapper = document.createElement('div');
        wrapper.className = 'flex items-center justify-between p-2 hover:bg-gray-600 text-sm text-gray-200';

        const label = document.createElement('label');
        label.className = 'flex items-center cursor-pointer flex-grow';
        label.innerHTML = `
            <input type="checkbox" ${isVisible ? 'checked' : ''} class="form-checkbox h-4 w-4 text-teal-500 rounded border-gray-500 focus:ring-teal-500 mr-2 bg-gray-800">
            <span>${col.label}</span>
        `;
        label.querySelector('input').addEventListener('change', () => toggleColumnVisibility(col.id));

        const controls = document.createElement('div');
        controls.className = 'flex items-center space-x-2';

        const pinLeftBtn = document.createElement('button');
        pinLeftBtn.className = `p-1 rounded-md ${isPinnedLeft ? 'bg-teal-600 text-white' : 'text-gray-400 hover:bg-gray-500'}`;
        pinLeftBtn.title = 'Pin to Left';
        pinLeftBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18.5 12H6m-2.5 0h2.5M11 18l-6-6 6-6"/></svg>`;
        pinLeftBtn.onclick = () => handlePin(col.id, isPinnedLeft ? null : 'left');

        const pinRightBtn = document.createElement('button');
        pinRightBtn.className = `p-1 rounded-md ${isPinnedRight ? 'bg-teal-600 text-white' : 'text-gray-400 hover:bg-gray-500'}`;
        pinRightBtn.title = 'Pin to Right';
        pinRightBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 12H18m2.5 0h-2.5M13 18l6-6-6-6"/></svg>`;
        pinRightBtn.onclick = () => handlePin(col.id, isPinnedRight ? null : 'right');

        controls.appendChild(pinLeftBtn);
        controls.appendChild(pinRightBtn);

        wrapper.appendChild(label);
        wrapper.appendChild(controls);
        container.appendChild(wrapper);
    });
};

const renderBumpChartSection = () => {
    const bumpMetricSelect = document.getElementById('bump-metric-select');
    
    const rankByOptions = [];
    coreMetrics.forEach(metric => {
        rankByOptions.push({ value: metric.id, label: metric.label });
        if (!metric.id.includes('Change') && !metric.id.includes('Avg')) { 
            rankByOptions.push({ value: `${metric.id}_4wkAvg`, label: `${metric.label} (4W)` });
        }
    });

    if (bumpMetricSelect) { 
        if (bumpMetricSelect.options.length === 0 || bumpMetricSelect.dataset.populated !== 'true') {
            bumpMetricSelect.innerHTML = ''; 
            rankByOptions.forEach(optionData => { 
                const option = document.createElement('option');
                option.value = optionData.value;
                option.textContent = optionData.label;
                bumpMetricSelect.appendChild(option);
            });
            bumpMetricSelect.dataset.populated = 'true'; 
        }
        bumpMetricSelect.value = appState.bumpMetric;
    }

   const weeksBackInput = document.getElementById('weeks-back-input');
    if (weeksBackInput) { 
        weeksBackInput.value = appState.weeksBack;
    }

    // LOGIC: Initialize selection ONLY if empty. 
    // We NEVER filter out existing selections here. This ensures persistence across views.
    if (!appState.selectedBumpEntities) appState.selectedBumpEntities = [];

    if (appState.selectedBumpEntities.length === 0 && appState.data && appState.data.length > 0) {
        let eligibleData = [...appState.data];
        const user = appState.auth.user;

        // 1. Permission Filter: If user cannot view all, restrict default selection to what they CAN view.
        // This ensures Dispatchers only see themselves, and Team Leads only see their team members by default.
        if (!hasPermission(user, PERMISSIONS.VIEW_ALL_DISPATCHERS) && !hasPermission(user, PERMISSIONS.VIEW_ALL_TEAMS)) {
            eligibleData = eligibleData.filter(d => {
                return appState.rankingMode === 'team' ? canViewTeam(d.entityName) : canViewDispatcher(d.entityName);
            });
        }

        // 2. Min Driver Filter (Optional, for initial selection)
        const minType = appState.minDriverSetting.type;
        const minValue = appState.minDriverSetting.value;
        if (minType !== 'none') {
            eligibleData = eligibleData.filter(d => {
                const val = d[minType];
                return val !== null && val !== undefined && val >= minValue;
            });
        }

        appState.selectedBumpEntities = eligibleData
            .sort((a, b) => (b.mainCriteria_current || -Infinity) - (a.mainCriteria_current || -Infinity))
            .slice(0, 5)
            .map(d => d.entityName);
    }
    
    const entityLabel = document.getElementById('bump-chart-entity-label');
    if (entityLabel) {
        entityLabel.textContent = appState.rankingMode === 'team' ? 'Teams:' : 'Dispatchers:';
    }

    renderMultiSelectDropdown();

    drawCharts(); 
};

const renderMultiSelectDropdown = () => {
    const container = document.getElementById('multi-select-dropdown-container');
    if (!container) return;
    container.innerHTML = '';

    const isTeamMode = appState.rankingMode === 'team';
    const user = appState.auth.user;
    const isDispatcherRole = user && user.role === 'Dispatcher';

    // If it's a dispatcher in team mode, lock everything down.
    if (isTeamMode && isDispatcherRole) {
        let dispatcherTeamName = 'Your Team'; // Default text
        const dispatcherNameFromAccess = (user.access || [])[0] || (typeof user.access === 'string' ? user.access.split(',')[0].trim() : null);

        if (dispatcherNameFromAccess) {
            // Find the most recent team association from all historical data.
            const historicalInfo = appState.allHistoricalData
                .filter(d => d.dispatcherName?.toLowerCase() === dispatcherNameFromAccess.toLowerCase() && d.dispatcherTeam)
                .sort((a, b) => b.date - a.date);
            
            if (historicalInfo.length > 0) {
                dispatcherTeamName = historicalInfo[0].dispatcherTeam;
            }
        }

        container.innerHTML = `
            <div class="relative w-full flex-grow">
                <div class="bg-gray-700 text-gray-100 border border-gray-600 rounded-lg px-3 py-1.5 text-xs flex items-center justify-between h-8 opacity-70 cursor-not-allowed">
                    <span class="font-semibold">${dispatcherTeamName}</span>
                </div>
            </div>
        `;
        return; // Stop execution for this specific case.
    }

    let allOptions;

    // Logic for Admins, Team Leads, and Operations
    if (!hasPermission(user, PERMISSIONS.VIEW_ALL_DISPATCHERS) && !isTeamMode) {
        const userRole = user ? user.role : '';
        if (userRole === 'Operations' || userRole === 'Team Lead') {
            let accessibleTeams = [];
            if (user && user.access) {
                if (Array.isArray(user.access)) {
                    accessibleTeams = user.access.map(t => String(t).trim().toLowerCase());
                } else if (typeof user.access === 'string') {
                    accessibleTeams = user.access.split(',').map(t => t.trim().toLowerCase());
                }
            }
            if (accessibleTeams.length > 0) {
                const dispatchersInAccessibleTeams = appState.allHistoricalData
                    .filter(d => d.dispatcherTeam && accessibleTeams.includes(d.dispatcherTeam.toLowerCase()))
                    .map(d => d.dispatcherName);
                allOptions = [...new Set(dispatchersInAccessibleTeams)].sort();
            } else {
                allOptions = [];
            }
        } else {
             allOptions = appState.allDispatcherNames.filter(dispatcherName => canViewDispatcher(dispatcherName));
        }
    } else if (!hasPermission(user, PERMISSIONS.VIEW_ALL_TEAMS) && isTeamMode) {
        allOptions = appState.allTeamNames.filter(teamName => canViewTeam(teamName));
    }
    else {
        allOptions = isTeamMode ? appState.allTeamNames : appState.allDispatcherNames;
    }
    const options = allOptions;

    const selectedOptions = appState.selectedBumpEntities;
    const placeholder = isTeamMode ? "Select Teams" : "Select Dispatchers";

    const dropdownWrapper = document.createElement('div');
    dropdownWrapper.className = "relative w-full flex-grow";
    dropdownWrapper.id = "multi-select-dropdown-wrapper";

    const selectedDisplay = document.createElement('div');
    selectedDisplay.className = "bg-gray-700 text-gray-100 border border-gray-600 rounded-lg px-3 py-1.5 text-xs flex items-center justify-between cursor-pointer h-8";
    selectedDisplay.id = "multi-select-display";

    const dropdownOptions = document.createElement('div');
    dropdownOptions.className = "absolute left-0 right-0 mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto hidden";
    dropdownOptions.id = "multi-select-options";

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.id = 'multi-select-search';
    searchInput.placeholder = `Search ${isTeamMode ? 'teams' : 'dispatchers'}...`;
    searchInput.className = "w-full bg-gray-800 text-gray-100 border border-gray-600 rounded-md px-2 py-1 text-sm focus:ring-teal-500 focus:border-transparent transition duration-200";

    const updateSelectedDisplay = () => {
        const textContent = selectedOptions.length === 0 ? placeholder : `${selectedOptions.length} Selected`;
        selectedDisplay.innerHTML = `
            <span class="${selectedOptions.length === 0 ? 'text-gray-400' : 'text-gray-100'}">${textContent}</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-gray-400 ml-auto"><polyline points="6 9 12 15 18 9"/></svg>
        `;
    };

    const toggleMultiSelectOption = (option) => {
        const index = selectedOptions.indexOf(option);
        if (index > -1) {
            selectedOptions.splice(index, 1);
        } else {
            selectedOptions.push(option);
        }
        appState.selectedBumpEntities = selectedOptions;
        updateDropdownOptionsList();
        updateSelectedDisplay();
        drawCharts();
        renderPerformanceTrackerSections();
    };

    const updateDropdownOptionsList = () => {
        const searchTerm = searchInput.value;
        const optionsListContainer = dropdownOptions.querySelector('#options-list-container');
        if (!optionsListContainer) return;
        optionsListContainer.innerHTML = '';

        const filteredOptions = options.filter(option =>
            option.toLowerCase().includes(searchTerm.toLowerCase())
        ).sort((a, b) => {
            const aSelected = selectedOptions.includes(a);
            const bSelected = selectedOptions.includes(b);
            if (aSelected && !bSelected) return -1;
            if (!aSelected && bSelected) return 1;
            return a.localeCompare(b);
        });

        if (filteredOptions.length === 0) {
            const noMatchDiv = document.createElement('div');
            noMatchDiv.className = 'p-3 text-gray-400 text-sm';
            noMatchDiv.textContent = `No matching ${isTeamMode ? 'teams' : 'dispatchers'}.`;
            optionsListContainer.appendChild(noMatchDiv);
        } else {
            filteredOptions.forEach(option => {
                const isSelected = selectedOptions.includes(option);
                const optionDiv = document.createElement('div');
                optionDiv.className = `p-2 flex items-center justify-between hover:bg-gray-600 cursor-pointer text-gray-200 text-sm ${isSelected ? 'bg-gray-600' : ''}`;
                optionDiv.innerHTML = `
                    <span>${option}</span>
                    ${isSelected ? '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-teal-400 ml-2"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                `;
                optionDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleMultiSelectOption(option);
                });
                optionsListContainer.appendChild(optionDiv);
            });
        }
    };

    selectedDisplay.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownOptions.classList.toggle('hidden');
    });

    searchInput.addEventListener('input', updateDropdownOptionsList);

    dropdownOptions.innerHTML = `
        <div class="p-2 border-b border-gray-600"></div>
        <div id="options-list-container" class="py-1"></div>
    `;
    dropdownOptions.querySelector('div').appendChild(searchInput);

    updateDropdownOptionsList();
    updateSelectedDisplay();
    dropdownWrapper.appendChild(selectedDisplay);
    dropdownWrapper.appendChild(dropdownOptions);
    container.appendChild(dropdownWrapper);

    document.addEventListener('mousedown', (event) => {
        if (dropdownWrapper && !dropdownWrapper.contains(event.target)) {
            dropdownOptions.classList.add('hidden');
        }
    }, { passive: true });
};

const renderFilterDropdown = () => {
    const filterColumnSelect = document.getElementById('filter-column-select');
    const filterOperatorSelect = document.getElementById('filter-operator-select');
    const appliedFiltersContainer = document.getElementById('applied-filters-container');
    const filterValueInput = document.getElementById('filter-value-input');

    const minDriversFilterType = document.getElementById('min-drivers-filter-type');
    const minDriversFilterValue = document.getElementById('min-drivers-filter-value');
    const applyMinDriversFilterBtn = document.getElementById('apply-min-drivers-filter-btn');

    if (filterColumnSelect && !filterColumnSelect.dataset.populated) {
        filterColumnSelect.innerHTML = '<option value="">Select Column</option>';
        allColumns.forEach(col => {
            const option = document.createElement('option');
            option.value = col.id;
            option.textContent = col.label;
            filterColumnSelect.appendChild(option);
        });
        filterColumnSelect.dataset.populated = 'true';
    }

    if (minDriversFilterType) minDriversFilterType.value = appState.minDriverSetting.type;
    if (minDriversFilterValue) minDriversFilterValue.value = appState.minDriverSetting.value;

    const populateOperatorSelect = () => {
        filterOperatorSelect.innerHTML = '<option value="">Select Operator</option>';
        const selectedColumnId = filterColumnSelect.value;
        const selectedColumn = allColumns.find(col => col.id === selectedColumnId);

        if (selectedColumn) {
            let operators = [];
            if (selectedColumn.type === 'number') {
                operators = [
                    { value: 'equals', label: 'Equals' },
                    { value: 'notEquals', label: 'Does Not Equal' },
                    { value: 'greaterThan', label: 'Greater Than' },
                    { value: 'lessThan', label: 'Less Than' }
                ];
                filterValueInput.type = 'number';
            } else if (selectedColumn.type === 'string') {
                operators = [
                    { value: 'contains', label: 'Contains' },
                    { value: 'notContains', label: 'Does Not Contain' },
                    { value: 'equals', label: 'Equals' },
                    { value: 'notEquals', label: 'Does Not Equal' },
                    { value: 'startsWith', label: 'Starts With' },
                    { value: 'endsWith', label: 'Ends With' }
                ];
                filterValueInput.type = 'text';
            }
            operators.forEach(op => {
                const option = document.createElement('option');
                option.value = op.value;
                option.textContent = op.label;
                filterOperatorSelect.appendChild(option);
            });
        } else {
            filterValueInput.type = 'text'; 
        }
    };

    if (filterColumnSelect && !filterColumnSelect._listenerAttached) {
        filterColumnSelect.addEventListener('change', populateOperatorSelect);
        filterColumnSelect._listenerAttached = true;
    }
    populateOperatorSelect(); 

    appliedFiltersContainer.innerHTML = '';
    
    if (appState.minDriverSetting.type !== 'none' && appState.minDriverSetting.value > 0) {
        const minDriverFilterTag = document.createElement('span');
        minDriverFilterTag.className = 'inline-flex items-center bg-blue-600 text-white text-xs px-2 py-1 rounded-full mr-2 mb-2';
        const typeLabel = allColumns.find(c => c.id === appState.minDriverSetting.type)?.label || appState.minDriverSetting.type;
        minDriverFilterTag.innerHTML = `
            Min. ${typeLabel}: ${appState.minDriverSetting.value}
            <button class="ml-1 text-blue-200 hover:text-white" data-filter-type="min-drivers">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        `;
        appliedFiltersContainer.appendChild(minDriverFilterTag);
        minDriverFilterTag.querySelector('button').addEventListener('click', () => {
            appState.minDriverSetting = { type: 'none', value: 0 };
            renderUI();
        });
    }

    if (appState.filters.length === 0 && appState.minDriverSetting.type === 'none') {
        const noFiltersTag = document.createElement('div');
        noFiltersTag.className = 'text-gray-400 text-xs';
        noFiltersTag.textContent = 'No filters applied.';
        appliedFiltersContainer.appendChild(noFiltersTag);
    } else {
        appState.filters.forEach((filter, index) => {
            const filterTag = document.createElement('span');
            filterTag.className = 'inline-flex items-center bg-gray-600 text-gray-200 text-xs px-2 py-1 rounded-full mr-2 mb-2';
            const columnLabel = allColumns.find(c => c.id === filter.columnId)?.label || filter.columnId;
            filterTag.innerHTML = `
                ${columnLabel} ${filter.operator} "${filter.value}"
                <button class="ml-1 text-gray-400 hover:text-white" data-filter-index="${index}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            `;
            appliedFiltersContainer.appendChild(filterTag);

            filterTag.querySelector('button').addEventListener('click', (e) => {
                const filterIndex = parseInt(e.currentTarget.dataset.filterIndex);
                appState.filters.splice(filterIndex, 1);
                renderUI(); 
            });
        });
    }
};

const applyFilters = (dataToFilter) => {
    let filteredData = [...dataToFilter]; 

    appState.filters.forEach(filter => {
        const { columnId, operator, value } = filter;
        const column = allColumns.find(c => c.id === columnId);
        const baseMetricId = columnId.replace(/_(current|4wkAvg)$/, '');
        const metricInfo = coreMetrics.find(m => m.id === baseMetricId);

        if (!column) return; 

        filteredData = filteredData.filter(item => {
            const itemValue = item[columnId];

            if (itemValue === null || itemValue === undefined) {
                return (operator === 'notContains' || operator === 'notEquals'); 
            }

            if (column.type === 'number') {
                const numValue = parseFloat(itemValue);
                let filterNumValue = parseFloat(value);
                
                if (metricInfo && metricInfo.unit === '%') {
                    filterNumValue /= 100;
                }
                
                if (isNaN(numValue) || isNaN(filterNumValue)) return false; 

                switch (operator) {
                    case 'equals': return numValue === filterNumValue;
                    case 'notEquals': return numValue !== filterNumValue;
                    case 'greaterThan': return numValue > filterNumValue;
                    case 'lessThan': return numValue < filterNumValue;
                    default: return true;
                }
            } else if (column.type === 'string') {
                const strValue = String(itemValue).toLowerCase();
                const filterStrValue = String(value).toLowerCase();

                switch (operator) {
                    case 'contains': return strValue.includes(filterStrValue);
                    case 'notContains': return !strValue.includes(filterStrValue);
                    case 'equals': return strValue === filterStrValue;
                    case 'notEquals': return strValue !== filterStrValue;
                    case 'startsWith': return strValue.startsWith(filterStrValue);
                    case 'endsWith': return strValue.endsWith(filterStrValue);
                    default: return true;
                }
            }
            return true;
        });
    });

    return filteredData;
};

// --- Performance Tracker ---

export const renderPerformanceTrackerSections = () => {
    const lowPerformersTableContainer = document.getElementById('low-performers-table-container');
    const performanceDropsTableContainer = document.getElementById('performance-drops-table-container');
    const trendingTableContainer = document.getElementById('trending-table-container');
    const historicalMovementContainer = document.getElementById('historical-movement-container');
    const wthLoadsTableContainer = document.getElementById('wth-loads-table-container');

    const showAlertsBtn = document.getElementById('show-alerts');
    const showLowPerformersBtn = document.getElementById('show-low-performers');
    const showPerformanceDropsBtn = document.getElementById('show-performance-drops');
    const showTrendingBtn = document.getElementById('show-trending');
    const showHistoricalMovementBtn = document.getElementById('show-historical-movement');

    // Handle visibility for the dispatcher-only "Historical Movement" view.
    if (appState.rankingMode === 'team') {
        if (showHistoricalMovementBtn) showHistoricalMovementBtn.style.display = 'none';
        if (appState.performanceTrackerView === 'historicalMovement') {
            appState.performanceTrackerView = 'alerts';
        }
    } else {
        if (showHistoricalMovementBtn) showHistoricalMovementBtn.style.display = 'block';
    }

    // --- START: ROBUST VISIBILITY FIX ---

    // 1. First, hide and CLEAR all containers, and deactivate all buttons.
    // Note: reusing wthLoadsTableContainer for Alerts to save DOM elements
    const allContainers = [lowPerformersTableContainer, performanceDropsTableContainer, trendingTableContainer, historicalMovementContainer, wthLoadsTableContainer];
    allContainers.forEach(container => {
        if (container) {
            container.classList.add('hidden');
            container.innerHTML = ''; 
        }
    });

    const allButtons = [showAlertsBtn, showLowPerformersBtn, showPerformanceDropsBtn, showTrendingBtn, showHistoricalMovementBtn];
    allButtons.forEach(btn => {
        if (btn) {
            btn.classList.remove('bg-teal-600', 'text-white');
            btn.classList.add('bg-gray-700', 'text-gray-300', 'hover:bg-gray-600');
        }
    });

    // 2. Now, based on the current state, activate only the correct view and render its content.
    switch (appState.performanceTrackerView) {
        case 'alerts':
            if (showAlertsBtn) {
                showAlertsBtn.classList.remove('bg-gray-700', 'text-gray-300', 'hover:bg-gray-600');
                showAlertsBtn.classList.add('bg-teal-600', 'text-white');
            }
            if (wthLoadsTableContainer) wthLoadsTableContainer.classList.remove('hidden'); // Reusing this container
            renderAlertsFeed();
            break;
        case 'lowPerformers':
            if (showLowPerformersBtn) {
                showLowPerformersBtn.classList.remove('bg-gray-700', 'text-gray-300', 'hover:bg-gray-600');
                showLowPerformersBtn.classList.add('bg-teal-600', 'text-white');
            }
            if (lowPerformersTableContainer) lowPerformersTableContainer.classList.remove('hidden');
            renderConsistentlyLowPerformers();
            break;
        case 'performanceDrops':
            if (showPerformanceDropsBtn) {
                showPerformanceDropsBtn.classList.remove('bg-gray-700', 'text-gray-300', 'hover:bg-gray-600');
                showPerformanceDropsBtn.classList.add('bg-teal-600', 'text-white');
            }
            if (performanceDropsTableContainer) performanceDropsTableContainer.classList.remove('hidden');
            renderSignificantPerformanceDrops();
            break;
        case 'trending':
            if (showTrendingBtn) {
                showTrendingBtn.classList.remove('bg-gray-700', 'text-gray-300', 'hover:bg-gray-600');
                showTrendingBtn.classList.add('bg-teal-600', 'text-white');
            }
            if (trendingTableContainer) trendingTableContainer.classList.remove('hidden');
            renderTrendingSection();
            break;
        case 'historicalMovement':
            if (showHistoricalMovementBtn) {
                showHistoricalMovementBtn.classList.remove('bg-gray-700', 'text-gray-300', 'hover:bg-gray-600');
                showHistoricalMovementBtn.classList.add('bg-teal-600', 'text-white');
            }
            if (historicalMovementContainer) historicalMovementContainer.classList.remove('hidden');
            renderHistoricalMovement();
            break;
    }
    // --- END: ROBUST VISIBILITY FIX ---
    // --- END: ROBUST VISIBILITY FIX ---
};

const renderConsistentlyLowPerformers = () => {
    const lowPerformersTableContainer = document.getElementById('low-performers-table-container');
    const user = appState.auth.user;

    let consistentlyLowPerformers = calculateConsistentlyLowPerformers();
    
    if (!hasPermission(user, PERMISSIONS.VIEW_ALL_TEAMS) && !hasPermission(user, PERMISSIONS.VIEW_ALL_DISPATCHERS)) {
        if (appState.rankingMode === 'team') {
            consistentlyLowPerformers = consistentlyLowPerformers.filter(team => canViewTeam(team.name));
        } else {
            consistentlyLowPerformers = consistentlyLowPerformers.filter(dispatcher => canViewDispatcher(dispatcher.name));
        }
    }

    const metricInfo = coreMetrics.find(m => m.id === appState.lowPerformanceMetric);
    const metricLabel = metricInfo?.label;
    const entityLabel = appState.rankingMode === 'team' ? 'Team' : 'Dispatcher';

    if (lowPerformersTableContainer) {
        if (consistentlyLowPerformers.length > 0) {
            const tableHtml = `
                <div class="overflow-x-auto scrollable-table-container">
                    <table class="min-w-full divide-y divide-gray-700">
                        <thead class="bg-gray-700 sticky-header">
                            <tr>
                                <th scope="col" class="px-2 py-1 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">${entityLabel}</th>
                                <th scope="col" class="px-2 py-1 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">Current Rank</th>
                                <th scope="col" class="px-2 py-1 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">Current ${metricLabel}</th>
                                <th scope="col" class="px-2 py-1 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">Low Perf. Weeks</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${consistentlyLowPerformers.map(entity => `
                                <tr key="${entity.id}" class="bg-gray-800 hover:bg-gray-700 transition duration-150 ease-in-out">
                                    <td class="px-2 py-1 whitespace-nowrap text-sm font-bold text-gray-200">${entity.name}</td>
                                    <td class="px-2 py-1 whitespace-nowrap text-sm text-red-400 font-bold text-center">${entity.currentRank}</td>
                                    <td class="px-2 py-1 whitespace-nowrap text-sm text-pink-400 text-center">
                                        ${isNaN(entity.currentValue) || entity.currentValue === null ? '-' : (metricInfo?.unit === '%' ? formatPercentage(entity.currentValue) : '$' + entity.currentValue.toFixed(2))}
                                    </td>
                                    <td class="px-2 py-1 whitespace-nowrap text-sm text-red-300 text-center">${entity.lowDaysCount} / ${entity.totalDays}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
            lowPerformersTableContainer.innerHTML = tableHtml;
        } else {
            lowPerformersTableContainer.innerHTML = `<p class="text-gray-400 text-sm p-4 text-center">No ${appState.rankingMode}s identified with consistently low performance based on current criteria.</p>`;
        }
    }
};

const renderSignificantPerformanceDrops = () => {
    const performanceDropsTableContainer = document.getElementById('performance-drops-table-container');
    const user = appState.auth.user;

    let performanceDrops = calculatePerformanceDrops();

    if (!hasPermission(user, PERMISSIONS.VIEW_ALL_TEAMS) && !hasPermission(user, PERMISSIONS.VIEW_ALL_DISPATCHERS)) {
        if (appState.rankingMode === 'team') {
            performanceDrops = performanceDrops.filter(team => canViewTeam(team.name));
        } else {
            performanceDrops = performanceDrops.filter(dispatcher => canViewDispatcher(dispatcher.name));
        }
    }

    const selectedDeviationMetricId = appState.deviationMetric;
    const baseMetricId = selectedDeviationMetricId.replace('_4wkAvg', '');
    const metricInfo = coreMetrics.find(m => m.id === baseMetricId);

    let metricLabel = metricInfo?.label;
    if (selectedDeviationMetricId.endsWith('_4wkAvg')) {
        metricLabel = `${metricLabel} (4W)`;
    }
    if (!metricLabel) {
        metricLabel = 'Metric';
    }

    const entityLabel = appState.rankingMode === 'team' ? 'Team' : 'Dispatcher';

    if (performanceDropsTableContainer) {
        if (performanceDrops.length > 0) {
            const tableHtml = `
                <div class="overflow-x-auto scrollable-table-container">
                    <table class="min-w-full divide-y divide-gray-700">
                        <thead class="bg-gray-700 sticky-header">
                            <tr>
                                <th scope="col" class="px-2 py-1 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">${entityLabel}</th>
                                <th scope="col" class="px-2 py-1 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">Current Rank</th>
                                <th scope="col" class="px-2 py-1 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">Current ${metricLabel}</th>
                                <th scope="col" class="px-2 py-1 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">Avg. Historical Value</th>
                                <th scope="col" class="px-2 py-1 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">Deviation</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${performanceDrops.map(entity => `
                                <tr key="${entity.id}" class="bg-gray-800 hover:bg-gray-700 transition duration-150 ease-in-out">
                                    <td class="px-2 py-1 whitespace-nowrap text-sm font-bold text-gray-200">${entity.name}</td>
                                    <td class="px-2 py-1 whitespace-nowrap text-sm text-red-400 font-bold text-center">${entity.currentRank === null ? '-' : entity.currentRank}</td>
                                    <td class="px-2 py-1 whitespace-nowrap text-sm text-orange-400 text-center">
                                        ${isNaN(entity.currentValue) || entity.currentValue === null ? '-' : (metricInfo?.unit === '%' ? formatPercentage(entity.currentValue) : '$' + entity.currentValue.toFixed(2))}
                                    </td>
                                    <td class="px-2 py-1 whitespace-nowrap text-sm text-gray-300 text-center">
                                        ${isNaN(entity.averageValue) || entity.averageValue === null ? '-' : (metricInfo?.unit === '%' ? formatPercentage(entity.averageValue) : '$' + entity.averageValue.toFixed(2))}
                                    </td>
                                    <td class="px-2 py-1 whitespace-nowrap text-sm text-red-300 text-center">${isNaN(entity.deviation) ? '-' : entity.deviation.toFixed(2) + '%'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
            performanceDropsTableContainer.innerHTML = tableHtml;
        } else {
            performanceDropsTableContainer.innerHTML = `<p class="text-gray-400 text-sm p-4 text-center">No significant performance drops detected for ${appState.rankingMode}s based on current criteria.</p>`;
        }
    }
};

const renderTrendingSection = () => {
    const container = document.getElementById('trending-table-container');
    if (!container) return;

    let { trendingUp, trendingDown } = calculateTrendingData();

    if (!isAdmin()) {
        if (appState.rankingMode === 'team') {
            trendingUp = trendingUp.filter(team => canViewTeam(team.name));
            trendingDown = trendingDown.filter(team => canViewTeam(team.name));
        } else {
            trendingUp = trendingUp.filter(dispatcher => canViewDispatcher(dispatcher.name));
            trendingDown = trendingDown.filter(dispatcher => canViewDispatcher(dispatcher.name));
        }
    }

    const entityLabel = appState.rankingMode === 'team' ? 'Team' : 'Dispatcher';

    if (trendingUp.length === 0 && trendingDown.length === 0) {
        container.innerHTML = `<p class="text-gray-400 text-sm p-4 text-center">No significant trends detected based on current criteria.</p>`;
        return;
    }

    // --- START: New Tooltip Content Generation ---
    const uniqueDates = [...new Set(appState.allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const selectedDateIndex = uniqueDates.indexOf(appState.selectedDate);
    const recentPeriodDates = uniqueDates.slice(selectedDateIndex, selectedDateIndex + appState.trendRecentPeriod).sort((a,b) => new Date(a) - new Date(b));
    const olderPeriodDates = uniqueDates.slice(selectedDateIndex + appState.trendRecentPeriod, selectedDateIndex + appState.trendRecentPeriod + appState.trendOlderPeriod).sort((a,b) => new Date(a) - new Date(b));
    
    const formatDate = (dateStr) => new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

    let tooltipText = "Compares the average of a metric over two periods.";
    if (recentPeriodDates.length > 0 && olderPeriodDates.length > 0) {
        const recentStart = formatDate(recentPeriodDates[0]);
        const recentEnd = formatDate(recentPeriodDates[recentPeriodDates.length - 1]);
        const olderStart = formatDate(olderPeriodDates[0]);
        const olderEnd = formatDate(olderPeriodDates[olderPeriodDates.length - 1]);
        tooltipText = `Recent Period (${recentStart} to ${recentEnd}) vs. Older Period (${olderStart} to ${olderEnd}).`;
    }
    // --- END: New Tooltip Content Generation ---


    const createTableHTML = (title, data, colorClass) => {
        return `
            <div class="flex-1 min-w-[300px] py-2">
                <h4 class="font-semibold ${colorClass} text-md mb-2 px-1">${title}</h4>
                <div class="overflow-y-auto" style="max-height: 250px;">
                    <table class="w-full divide-y divide-gray-700">
                        <thead class="bg-gray-700 sticky-header">
                            <tr>
                                <th scope="col" class="w-1/3 px-2 py-1 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">${entityLabel}</th>
                                <th scope="col" class="w-1/3 px-2 py-1 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">Metric</th>
                                <th scope="col" class="w-1/3 px-2 py-1 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">
                                    <div class="flex items-center justify-center gap-1">
                                        Trend
                                        <span class="trend-tooltip-trigger cursor-help" data-tooltip-text="${tooltipText}">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        </span>
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(entity => {
                                const formatValue = (val, unit) => {
                                    if (isNaN(val)) return '-';
                                    if (unit === '%') return (val * 100).toFixed(1) + '%';
                                    if (unit === '$') return '$' + val.toFixed(2);
                                    return val.toLocaleString(undefined, {maximumFractionDigits: 0});
                                };
            
                                return `
                                <tr class="bg-gray-800 hover:bg-gray-700">
                                    <td class="px-2 py-1 whitespace-nowrap text-xs font-bold text-gray-200">${entity.name}</td>
                                    <td class="px-2 py-1 whitespace-nowrap text-xs text-gray-300 text-center">${entity.metricLabel}</td>
                                    <td class="px-2 py-1 whitespace-nowrap text-xs text-center font-semibold">
                                        <span class="${colorClass}">${formatValue(entity.avgRecent, entity.unit)}</span>
                                        <span class="text-gray-500 mx-1">vs</span>
                                        <span class="text-gray-400">${formatValue(entity.avgOlder, entity.unit)}</span>
                                    </td>
                                </tr>
                            `}).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    };

    container.innerHTML = `
        <div class="flex flex-wrap justify-center">
            ${createTableHTML('Trending Up', trendingUp, 'text-green-400')}
            ${createTableHTML('Trending Down', trendingDown, 'text-red-400')}
        </div>
    `;

    // Add event listeners for the new custom tooltip
    const tooltip = document.getElementById('dispatch-tooltip');
    if (container && tooltip && !container._tooltipListenersAttached) {
        container.addEventListener('mouseover', (e) => {
            const trigger = e.target.closest('.trend-tooltip-trigger');
            if (trigger) {
                tooltip.textContent = trigger.dataset.tooltipText;
                tooltip.classList.add('visible');
            }
        });
        container.addEventListener('mousemove', (e) => {
            if (tooltip.classList.contains('visible')) {
                // Position tooltip relative to the cursor
                tooltip.style.left = `${e.pageX + 15}px`;
                tooltip.style.top = `${e.pageY + 15}px`;
            }
        });
        container.addEventListener('mouseout', (e) => {
            const trigger = e.target.closest('.trend-tooltip-trigger');
            if (trigger) {
                tooltip.classList.remove('visible');
            }
        });
        container._tooltipListenersAttached = true;
    }
};
// --- Modals and Popups ---

const renderModals = () => {
    const entityModal = document.getElementById('dispatcher-trend-modal');
    const mainCriteriaModal = document.getElementById('main-criteria-info-modal');
    const performanceTrackerSettingsModal = document.getElementById('performance-tracker-settings-modal');
    const displaySettingsModal = document.getElementById('display-settings-modal'); 

    if (appState.isEntityModalOpen) {
        entityModal.classList.remove('hidden');
        const modalEntityNameText = document.getElementById('modal-entity-name-text');
        if (modalEntityNameText) {
            modalEntityNameText.textContent = `${appState.selectedEntity.entityName} - `; 
        }
        renderModalContent();
    } else {
        entityModal.classList.add('hidden');
    }

    if (appState.isMainCriteriaModalOpen) {
        mainCriteriaModal.classList.remove('hidden');
    } else {
        mainCriteriaModal.classList.add('hidden');
    }

    if (appState.isPerformanceTrackerModalOpen) {
        performanceTrackerSettingsModal.classList.remove('hidden');
        populatePerformanceTrackerSettingsModal();
    } else {
        performanceTrackerSettingsModal.classList.add('hidden');
    }

    if (appState.isDisplaySettingsModalOpen) {
        displaySettingsModal.classList.remove('hidden');
        populateDisplaySettingsModal();
    } else {
        displaySettingsModal.classList.add('hidden');
    }
};

export const renderModalContent = () => {
    const chartContainer = document.getElementById('modal-chart-container');
    const stubsContainer = document.getElementById('modal-stubs-container');
    const legendContainer = document.getElementById('modal-chart-legend');
    const modalTitle = document.getElementById('dispatcher-modal-title');
    const chartSwitcher = document.getElementById('modal-chart-switcher');
    const modalHeader = document.querySelector('#dispatcher-trend-modal .relative.flex'); // Target the header

    // FIX: Dynamically adjust the height of the chart container based on the view
    if (chartContainer) {
        if (appState.entityModalChartView === 'heatmap') {
            chartContainer.style.height = '425px'; // Give more height for the map and table
        } else {
            chartContainer.style.height = '300px'; // Revert to original height for other charts
        }
    }

    // Clear previous header content
    if (modalHeader) modalHeader.innerHTML = '';

    // Update Modal Content
    if (modalHeader && appState.selectedEntity) {
        const isHistoricalView = appState.modalSource === 'historicalMovement';
        let leftHeaderHTML = '';
        let centerHeaderHTML = '';

        if (isHistoricalView && appState.historicalNavigation) {
            const { currentIndex, availableDates } = appState.historicalNavigation;
            const hasPrev = currentIndex < availableDates.length - 1;
            const hasNext = currentIndex > 0;
            const currentDate = new Date(appState.selectedEntity.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

            leftHeaderHTML = `
                <div class="historical-nav-controls">
                    <button id="historical-prev-btn" title="Previous Date" ${!hasPrev ? 'disabled' : ''}>
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <span class="historical-nav-date">${currentDate}</span>
                    <button id="historical-next-btn" title="Next Date" ${!hasNext ? 'disabled' : ''}>
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                    </button>
                </div>
            `;
        }

        if (isHistoricalView && appState.selectedEntities.length > 0) {
            // Logic for multiple names from Historical Movement
            const colors = ['#e5e7eb', '#ef4444', '#3b82f6']; // Default/White, Red, Blue
            const titleParts = appState.selectedEntities.map((entity, index) => {
                const color = colors[index % colors.length];
                return `<span style="color: ${color}; font-weight: bold;">${entity.entityName}</span>`;
            });
            centerHeaderHTML = `<h2 id="dispatcher-modal-title-text" class="text-lg font-bold text-gray-200 text-center">${titleParts.join(' vs ')} - Paystub Details</h2>`;
        } else {
            // Fallback to original logic for single entity view from rankings table or comparison view
            centerHeaderHTML = `<h2 id="dispatcher-modal-title-text" class="text-lg font-bold text-gray-200 text-center">${appState.selectedEntity.entityName} - Paystub Details</h2>`;
            // Only show comparison UI if not in historical view
            if (!isHistoricalView) {
                centerHeaderHTML += `<div id="comparison-container" class="inline-flex items-center ml-2"></div>`;
            }
        }

        modalHeader.innerHTML = `
            <div class="modal-header-left">${leftHeaderHTML}</div>
            <div class="modal-header-center">${centerHeaderHTML}</div>
            <button id="close-dispatcher-modal-btn" class="absolute right-3 text-gray-400 hover:text-white transition-colors text-2xl">&times;</button>
        `;

        if (!isHistoricalView) {
            renderComparisonSelector();
        }
        
        // Re-attach the close button listener since we replaced the HTML
        document.getElementById('close-dispatcher-modal-btn')?.addEventListener('click', handleCloseEntityModal);
    }

    if (chartSwitcher) {
        chartSwitcher.style.display = appState.modalSource === 'historicalMovement' ? 'none' : 'flex';
    }

    chartContainer.style.display = 'none';
    stubsContainer.style.display = 'none';
    d3.select(chartContainer).html('');
    stubsContainer.innerHTML = '';
    d3.select(legendContainer).html('');

    document.querySelectorAll('#modal-chart-switcher button').forEach(btn => {
        const isActive = btn.dataset.view === appState.entityModalChartView;
        btn.classList.toggle('bg-teal-500', isActive);
        btn.classList.toggle('text-white', isActive);
        btn.classList.toggle('hover:bg-gray-600', !isActive);
    });

    if (!appState.selectedEntity) return;

    if (appState.entityModalChartView === 'stubs') {
        stubsContainer.style.display = 'block';
        renderStubsTable();
    } else if (appState.entityModalChartView === 'heatmap') {
        chartContainer.style.display = 'flex';
        chartContainer.style.flexDirection = 'column';
        renderDispatcherHeatmap();
    } else if (appState.entityModalChartView === 'rank') {
        chartContainer.style.display = 'block';
        renderIndividualEntityChart();
    }
};

const renderStubsTable = () => {
    const container = document.getElementById('modal-stubs-container');
    const primaryEntity = appState.selectedEntity;
    const comparisonEntity = appState.comparisonEntity;
    const date = appState.selectedDate;

    const columnsToRedactForStubs = new Set(['driver_gross', 'margin_dollar', 'all_miles', 'rpm']);

    if (!primaryEntity || !date) {
        container.innerHTML = `<p class="text-center text-gray-400 p-8">Missing data to display stubs.</p>`;
        return;
    }

    if (appState.rankingMode === 'dispatcher') {
        let allStubs = [];
        const colors = ['transparent', 'rgba(239, 68, 68, 0.15)', 'rgba(59, 130, 246, 0.15)']; // Default/Transparent, Red, Blue with transparency

        const entitiesToDisplay = appState.modalSource === 'historicalMovement' ? appState.selectedEntities : [primaryEntity, comparisonEntity].filter(Boolean);

        entitiesToDisplay.forEach((entity, index) => {
            const stubs = (entity.stubs || []).map(s => ({ ...s, __source: entity.entityName, __color: colors[index % colors.length] }));
            allStubs.push(...stubs);
        });

        const filterStubs = (stubs) => {
            if (appState.driverTypeFilter === 'all') return stubs;
            return stubs.filter(stub => typeof stub.contractType === 'string' && stub.contractType.toLowerCase() === appState.driverTypeFilter);
        };

        allStubs = filterStubs(allStubs);

        if (allStubs.length === 0) {
            container.innerHTML = `<p class="text-center text-gray-400 p-8">No individual driver stubs were found for the selected criteria.</p>`;
            return;
        }

        const headers = [
            { label: 'Driver Name', key: 'driverName', type: 'string' },
            { label: 'Contract Type', key: 'type', type: 'string' },
            { label: 'Net %', key: 'netPercentage', type: 'number' },
            { label: 'Gross %', key: 'driverGross', type: 'number' },
            { label: 'Margin %', key: 'margin', type: 'number' },
            { label: 'Driver Gross', key: 'driver_gross', type: 'number' },
            { label: 'Margin', key: 'margin_dollar', type: 'number' },
            { label: 'Miles', key: 'all_miles', type: 'number' },
            { label: 'RPM', key: 'rpm', type: 'number' },
            { label: 'Driver Happiness', key: 'netDriverGrossPercentage', type: 'number' },
            { label: 'Company Happiness', key: 'cashFlow', type: 'number' },
            { label: 'Criteria', key: 'criteria', type: 'number' }
        ];

        const { key: sortKey, direction: sortDirection } = stubsSortConfig;
        allStubs.sort((a, b) => {
            let aValue = a[sortKey];
            let bValue = b[sortKey];
            if (sortKey === 'criteria') {
                 aValue = ((a['netDriverGrossPercentage'] || 0) + (a['cashFlow'] || 0)) / 2;
                 bValue = ((b['netDriverGrossPercentage'] || 0) + (b['cashFlow'] || 0)) / 2;
            }
            if (aValue === null || aValue === undefined) return 1;
            if (bValue === null || bValue === undefined) return -1;
            
            const headerInfo = headers.find(h => h.key === sortKey);
            if (headerInfo && headerInfo.type === 'number') {
                return sortDirection === 'ascending' ? aValue - bValue : bValue - aValue;
            } else {
                return sortDirection === 'ascending' ? 
                    String(aValue).localeCompare(String(bValue)) : 
                    String(bValue).localeCompare(String(aValue));
            }
        });

        const tableHTML = `
            <table class="min-w-full divide-y divide-gray-700">
                <thead class="bg-gray-700 sticky top-0 z-10">
                    <tr>
                        ${headers.map(h => `
                            <th class="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer select-none" 
                                onclick="requestStubsSort('${h.key}')">
                                ${h.label} ${getStubsSortIcon(h.key)}
                            </th>
                        `).join('')}
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-700">
                ${allStubs.map(stub => {
                    const rowClass = `hover:bg-gray-700`;
                    const rowStyle = `style="background-color: ${stub.__color || 'transparent'}"`;

                    const entityForStub = entitiesToDisplay.find(e => e.entityName === stub.__source);

                    const entityDispatcherName = entityForStub?.entityName;
                    const entityTeamName = entityForStub?.dispatcherTeam;
                    
                    // Fix: Ensure Dispatchers only see their own data, not their peers' data even if in the same team.
                    const userRole = appState.auth.user?.role;
                    const hasPermission = isAdmin() || 
                                          (userRole !== 'Dispatcher' && canViewTeam(entityTeamName)) || 
                                          canViewDispatcher(entityDispatcherName);

                    const shouldRedactStub = !hasPermission;

                    return `<tr class="${rowClass}" ${rowStyle}>
                        ${headers.map(h => {
                            const key = h.key;
                            let value = stub[key];
                            let displayValue;
                            
                            if (shouldRedactStub && columnsToRedactForStubs.has(key)) {
                                displayValue = '<span class="text-gray-500">-</span>';
                            } else {
                                displayValue = (value === null || value === undefined) ? '-' : value;
                        
                                if (key === 'criteria') {
                                    const criteriaValue = ((stub['netDriverGrossPercentage'] || 0) + (stub['cashFlow'] || 0)) / 2;
                                    displayValue = formatPercentage(criteriaValue);
                                } else if (typeof value === 'number') {
                                    if (key === 'rpm') {
                                        displayValue = `$${value.toFixed(2)}`;
                                    } else if (['driver_gross', 'margin_dollar'].includes(key)) {
                                        displayValue = `$${value.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
                                    } else if (['netPercentage', 'driverGross', 'margin', 'netDriverGrossPercentage', 'cashFlow'].includes(key)) {
                                        displayValue = formatPercentage(value);
                                    } else {
                                        displayValue = value.toLocaleString(undefined, {maximumFractionDigits: 0});
                                    }
                                }
                            }
                            
                            if (key === 'driverName') {
                                return `<td class="px-4 py-2 whitespace-nowrap text-sm text-blue-300 font-semibold hover:text-teal-400 cursor-pointer driver-link" data-driver-name="${value}" data-dispatcher-name="${stub.__source}">${displayValue}</td>`;
                            }
                            return `<td class="px-4 py-2 whitespace-nowrap text-sm text-gray-200">${displayValue}</td>`;
                        }).join('')}
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>`;
        container.innerHTML = tableHTML;

        // Add event listener for driver links in Paystub Details
        const tbody = container.querySelector('tbody');
        if (tbody && !tbody._listenerAttached) {
            tbody.addEventListener('click', (e) => {
                const driverLink = e.target.closest('.driver-link');
                if (driverLink) {
                    e.stopPropagation();
                    const driverName = driverLink.dataset.driverName;
                    const dispatcherName = driverLink.dataset.dispatcherName;

                    // Security Check - Fail Silently
                    if (!isAdmin() && !canViewDispatcher(dispatcherName)) {
                        return;
                    }
                    
                    initializeProfileEventListeners();
                    
                    appState.profiles.driverDeepDive.selectedDriver = driverName;
                    appState.profiles.driverDeepDive.isModalOpen = true;
                    renderDriverDeepDiveModal_Profiles();
                }
            });
            tbody._listenerAttached = true;
        }

    } else if (appState.rankingMode === 'team') {
        const filteredData = getFilteredDataByDriverType(appState.allHistoricalData);
        
        // 1. Get Primary Team Dispatchers
        const primaryDispatchers = [...new Set(filteredData
            .filter(row => row.date.toISOString().split('T')[0] === date && row.dispatcherTeam === primaryEntity.entityName)
            .map(row => row.dispatcherName)
        )];

        // 2. Get Comparison Team Dispatchers (if applicable)
        const comparisonDispatchers = comparisonEntity ? [...new Set(filteredData
            .filter(row => row.date.toISOString().split('T')[0] === date && row.dispatcherTeam === comparisonEntity.entityName)
            .map(row => row.dispatcherName)
        )] : [];

        // 3. Combine unique dispatchers from both teams
        const allDispatcherNames = [...new Set([...primaryDispatchers, ...comparisonDispatchers])];

        let dispatcherDetails = allDispatcherNames.map(dispatcherName => {
            const tempDispatcherData = processDataForMode(true, dispatcherName);
            const dData = tempDispatcherData.find(d => d.entityName === dispatcherName);
            
            if (dData) {
                // Determine row color: Red tint if it belongs ONLY to the comparison team
                if (comparisonEntity && comparisonDispatchers.includes(dispatcherName) && !primaryDispatchers.includes(dispatcherName)) {
                    dData.__rowColor = 'rgba(239, 68, 68, 0.15)'; 
                } else {
                    dData.__rowColor = 'transparent';
                }
            }
            return dData;
        }).filter(Boolean);

        if (dispatcherDetails.length === 0) {
            container.innerHTML = `<p class="text-center text-gray-400 p-8">No dispatcher data found for the selected teams with the selected driver type.</p>`;
            return;
        }

        const headers = [
            { label: 'Dispatcher', key: 'entityName', type: 'string' },
            { label: 'Drivers', key: 'numDrivers', type: 'number' },
            { label: 'Net %', key: 'pNet_current', type: 'number' },
            { label: 'Gross %', key: 'pDriverGross_current', type: 'number' },
            { label: 'Margin %', key: 'pMargin_current', type: 'number' },
            { label: 'Driver Gross', key: 'pDriver_gross_current', type: 'number' },
            { label: 'Margin', key: 'pMargin_dollar_current', type: 'number' },
            { label: 'Miles', key: 'pAll_miles_current', type: 'number' },
            { label: 'RPM', key: 'rpmAll_current', type: 'number' },
            { label: 'Driver Happiness', key: 'pMainCriteriaNetDriverMargin_current', type: 'number' },
            { label: 'Company Happiness', key: 'pMainCriteria2CashFlow_current', type: 'number' },
            { label: 'Criteria', key: 'mainCriteria_current', type: 'number' }
        ];
        
        const teamColumnsToRedact = new Set(['pDriver_gross_current', 'pMargin_dollar_current', 'pAll_miles_current', 'rpmAll_current']);
        
        const { key: sortKey, direction: sortDirection } = stubsSortConfig;
        dispatcherDetails.sort((a, b) => {
            const aValue = a[sortKey];
            const bValue = b[sortKey];

            if (aValue === null || aValue === undefined) return 1;
            if (bValue === null || bValue === undefined) return -1;

            const headerInfo = headers.find(h => h.key === sortKey);
            if (headerInfo && headerInfo.type === 'number') {
                return sortDirection === 'ascending' ? aValue - bValue : bValue - aValue;
            } else {
                return sortDirection === 'ascending' ? 
                    String(aValue).localeCompare(String(bValue)) : 
                    String(bValue).localeCompare(String(aValue));
            }
        });

        let tableHTML = `
            <table class="min-w-full divide-y divide-gray-700">
                <thead class="bg-gray-700 sticky top-0 z-10">
                    <tr>
                        ${headers.map(h => `
                            <th class="px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer select-none"
                                onclick="requestStubsSort('${h.key}')">
                                ${h.label} ${getStubsSortIcon(h.key)}
                            </th>
                        `).join('')}
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-700" id="team-dispatchers-tbody">
                    ${dispatcherDetails.map(d => {
                        const isExpanded = appState.expandedDispatcher === d.entityName;
                        const shouldRedactThisRow = !canViewDispatcher(d.entityName);
                        
                        // Apply tint only if not expanded
                        const rowStyle = (!isExpanded && d.__rowColor) ? `style="background-color: ${d.__rowColor};"` : '';

                        let rowHTML = `<tr class="dispatcher-row ${isExpanded ? 'is-expanded' : ''}" data-dispatcher-name="${d.entityName}" ${rowStyle}>`;
                        rowHTML += headers.map(h => {
                            let value = d[h.key];
                            let displayValue;

                            if (shouldRedactThisRow && teamColumnsToRedact.has(h.key)) {
                                displayValue = '<span class="text-gray-500">-</span>';
                            } else {
                                displayValue = (value === null || value === undefined) ? '-' : value;

                                if (typeof value === 'number') {
                                    if (['pNet_current', 'pDriverGross_current', 'pMargin_current', 'pMainCriteriaNetDriverMargin_current', 'pMainCriteria2CashFlow_current', 'mainCriteria_current'].includes(h.key)) {
                                        displayValue = formatPercentage(value);
                                    } else if (h.key === 'rpmAll_current') {
                                        displayValue = `$${value.toFixed(2)}`;
                                    } else if (['pDriver_gross_current', 'pMargin_dollar_current'].includes(h.key)) {
                                        displayValue = `$${value.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
                                    } else {
                                        displayValue = value.toLocaleString(undefined, {maximumFractionDigits: 0});
                                    }
                                }
                            }
                            return `<td class="px-4 py-2 whitespace-nowrap text-sm text-gray-200">${displayValue}</td>`;
                        }).join('');
                        rowHTML += `</tr>`;

                        if (isExpanded) {
                            rowHTML += `<tr class="dispatcher-details-row"><td colspan="${headers.length}" class="p-0">${renderDispatcherDriverDetails(d)}</td></tr>`;
                        }
                        return rowHTML;
                    }).join('')}
                </tbody>
            </table>`;
        container.innerHTML = tableHTML;

        const tbody = document.getElementById('team-dispatchers-tbody');
        if (tbody && !tbody._listenerAttached) {
            tbody.addEventListener('click', (e) => {
                // Check if a driver link was clicked first
                const driverLink = e.target.closest('.driver-link');
                if (driverLink) {
                    e.stopPropagation();
                    const driverName = driverLink.dataset.driverName;
                    const dispatcherName = driverLink.dataset.dispatcherName;

                    // Security Check - Fail Silently
                    if (!isAdmin() && !canViewDispatcher(dispatcherName)) {
                        return;
                    }
                    
                    // Initialize listeners if needed (in case user came straight to Rankings)
                    initializeProfileEventListeners();
                    
                    appState.profiles.driverDeepDive.selectedDriver = driverName;
                    appState.profiles.driverDeepDive.isModalOpen = true;
                    renderDriverDeepDiveModal_Profiles();
                    return;
                }

                // Otherwise handle row expansion
                const row = e.target.closest('.dispatcher-row');
                if (row) {
                    const dispatcherName = row.dataset.dispatcherName;
                    appState.expandedDispatcher = appState.expandedDispatcher === dispatcherName ? null : dispatcherName;
                    renderStubsTable();
                }
            });
            tbody._listenerAttached = true;
        }
    }
};

const renderDispatcherDriverDetails = (dispatcher) => {
    const driverStubs = dispatcher.stubs || [];
    let filteredDriverStubs = driverStubs.filter(stub => {
        if (appState.driverTypeFilter === 'all') return true;
        return typeof stub.contractType === 'string' && stub.contractType.toLowerCase() === appState.driverTypeFilter;
    });

    if (filteredDriverStubs.length === 0) {
        return `<div class="p-4 text-center text-gray-500">No individual driver stubs found for this dispatcher.</div>`;
    }

    const headers = [
        { label: 'Driver Name', key: 'driverName', type: 'string' },
        { label: 'Contract Type', key: 'type', type: 'string' },
        { label: 'Net %', key: 'netPercentage', type: 'number' },
        { label: 'Gross %', key: 'driverGross', type: 'number' },
        { label: 'Margin %', key: 'margin', type: 'number' },
        { label: 'Driver Gross', key: 'driver_gross', type: 'number' },
        { label: 'Margin', key: 'margin_dollar', type: 'number' },
        { label: 'Miles', key: 'all_miles', type: 'number' },
        { label: 'RPM', key: 'rpm', type: 'number' },
        { label: 'Driver Happiness', key: 'netDriverGrossPercentage', type: 'number' },
        { label: 'Company Happiness', key: 'cashFlow', type: 'number' },
        { label: 'Criteria', key: 'criteria', type: 'number' }
    ];

    const columnsToRedact = new Set(['driver_gross', 'margin_dollar', 'all_miles', 'rpm']);
    const shouldRedact = !canViewDispatcher(dispatcher.entityName);

    const { key: sortKey, direction: sortDirection } = stubsSortConfig;
    filteredDriverStubs.sort((a, b) => {
        let aValue = a[sortKey];
        let bValue = b[sortKey];
        if (sortKey === 'criteria') {
             aValue = ((a['netDriverGrossPercentage'] || 0) + (a['cashFlow'] || 0)) / 2;
             bValue = ((b['netDriverGrossPercentage'] || 0) + (b['cashFlow'] || 0)) / 2;
        }
        if (aValue === null || aValue === undefined) return 1;
        if (bValue === null || bValue === undefined) return -1;
        
        const headerInfo = headers.find(h => h.key === sortKey);
        if (headerInfo && headerInfo.type === 'number') {
            return sortDirection === 'ascending' ? aValue - bValue : bValue - aValue;
        } else {
            return sortDirection === 'ascending' ? 
                String(aValue).localeCompare(String(bValue)) : 
                String(bValue).localeCompare(String(aValue));
        }
    });

    return `
        <div class="bg-gray-900 p-2">
            <table class="min-w-full divide-y divide-gray-800 nested-driver-table">
                <thead class="bg-gray-800">
                    <tr>
                        ${headers.map(h => `<th class="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">${h.label}</th>`).join('')}
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-800">
                    ${filteredDriverStubs.map(stub => `
                        <tr>
                            ${headers.map(h => {
                                const key = h.key;
                                let value = stub[key];
                                let displayValue;
                                
                                if (shouldRedact && columnsToRedact.has(key)) {
                                    displayValue = '<span class="text-gray-500">-</span>';
                                } else {
                                    displayValue = (value === null || value === undefined) ? '-' : value;
                                
                                    if (key === 'criteria') {
                                        const criteriaValue = ((stub['netDriverGrossPercentage'] || 0) + (stub['cashFlow'] || 0)) / 2;
                                        displayValue = formatPercentage(criteriaValue);
                                    } else if (typeof value === 'number') {
                                        if (key === 'rpm') {
                                            displayValue = `$${value.toFixed(2)}`;
                                        } else if (['driver_gross', 'margin_dollar'].includes(key)) {
                                            displayValue = `$${value.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
                                        } else if (['netPercentage', 'driverGross', 'margin', 'netDriverGrossPercentage', 'cashFlow'].includes(key)) {
                                            displayValue = formatPercentage(value);
                                        } else {
                                            displayValue = value.toLocaleString(undefined, {maximumFractionDigits: 0});
                                        }
                                    }
                                }
                                
                                if (key === 'driverName') {
                                    return `<td class="px-3 py-1.5 whitespace-nowrap text-xs text-blue-300 font-semibold hover:text-teal-400 cursor-pointer driver-link" data-driver-name="${value}" data-dispatcher-name="${dispatcher.entityName}">${displayValue}</td>`;
                                }
                                return `<td class="px-3 py-1.5 whitespace-nowrap text-xs text-gray-300">${displayValue}</td>`;
                            }).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
};

const populateDisplaySettingsModal = () => {
    populateTableHeightSetting();
    populateKeyMetricsSettings();
    
    const toggleHeatmapCheckbox = document.getElementById('toggle-heatmap');
    if (toggleHeatmapCheckbox) {
        toggleHeatmapCheckbox.checked = appState.enableHeatmap;
        if (!toggleHeatmapCheckbox._listenerAttached) {
            toggleHeatmapCheckbox.addEventListener('change', (e) => {
                appState.enableHeatmap = e.target.checked;
                renderUI();
            });
            toggleHeatmapCheckbox._listenerAttached = true;
        }
    }
};

const populateTableHeightSetting = () => {
    const tableHeightInput = document.getElementById('table-height-input');
    const tableHeightValue = document.getElementById('table-height-value');

    if (tableHeightInput && tableHeightValue) {
        tableHeightInput.value = appState.tableMaxHeight;
        tableHeightValue.textContent = `${appState.tableMaxHeight}px`;

        if (!tableHeightInput._listenerAttached) {
            tableHeightInput.addEventListener('input', (e) => {
                const newHeight = e.target.value;
                appState.tableMaxHeight = newHeight;
                tableHeightValue.textContent = `${newHeight}px`;
                document.getElementById('main-table-container').style.maxHeight = `${newHeight}px`;
            });
            tableHeightInput._listenerAttached = true;
        }
    }
};

const populateKeyMetricsSettings = () => {
    const container = document.getElementById('key-metrics-multiselect-container');
    if (!container) return;

    const selectableMetrics = [
        { id: 'mainCriteria', label: 'Criteria' },
        { id: 'mainCriteria_4wkAvg', label: 'Criteria (4W)' },
        { id: 'driverHappiness', label: 'Driver Happiness' },
        { id: 'driverHappiness_4wkAvg', label: 'Driver Happiness (4W)' },
        { id: 'companyHappiness', label: 'Company Happiness' },
        { id: 'companyHappiness_4wkAvg', label: 'Company Happiness (4W)' },
        { id: 'totalDrivers', label: 'Total Drivers' },
        { id: 'totalDispatchers', label: 'Total Dispatchers/Teams' },
        { id: 'rpmAll', label: 'RPM' },
        { id: 'rpmAll_4wkAvg', label: 'RPM (4W)' },
        { id: 'pDriverGross', label: 'Driver Gross' },
        { id: 'pDriverGross_4wkAvg', label: 'Driver Gross (4W)' },
        { id: 'pMargin', label: 'Margin' },
        { id: 'pMargin_4wkAvg', label: 'Margin (4W)' },
        { id: 'pNet', label: 'Net' },
        { id: 'pNet_4wkAvg', label: 'Net (4W)' },
        { id: 'pMileage', label: 'Mileage' },
        { id: 'pMileage_4wkAvg', label: 'Mileage (4W)' },
    ];
    
    const idPrefix = 'key-metrics-multiselect';
    const selectedOptions = appState.visibleKeyMetrics;
    const placeholder = 'Select Key Metrics';

    const dropdownWrapper = document.createElement('div');
    dropdownWrapper.className = "relative w-full";
    dropdownWrapper.id = `${idPrefix}-wrapper`;
    
    const selectedDisplay = document.createElement('div');
    selectedDisplay.className = "bg-gray-700 text-gray-100 border border-gray-600 rounded-lg px-3 py-1.5 text-sm flex items-center justify-between cursor-pointer";
    selectedDisplay.id = `${idPrefix}-display`;

    const dropdownOptions = document.createElement('div');
    dropdownOptions.className = "absolute left-0 right-0 mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto hidden";
    dropdownOptions.id = `${idPrefix}-options`;

    const updateSelectedDisplay = () => {
        const textContent = selectedOptions.length === 0 ? placeholder : `${selectedOptions.length} Metric${selectedOptions.length === 1 ? '' : 's'} Selected`;
        selectedDisplay.innerHTML = `<span class="${selectedOptions.length === 0 ? 'text-gray-400' : 'text-gray-100'}">${textContent}</span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-gray-400"><polyline points="6 9 12 15 18 9"/></svg>`;
    };

    const toggleOption = (metricId) => {
        const index = appState.visibleKeyMetrics.indexOf(metricId);
        if (index > -1) {
            appState.visibleKeyMetrics.splice(index, 1);
        } else {
            appState.visibleKeyMetrics.push(metricId);
        }
        renderKeyMetrics();
        updateDropdownOptions();
        updateSelectedDisplay();
    };
    
    const updateDropdownOptions = () => {
        dropdownOptions.innerHTML = '';
        selectableMetrics.forEach(metric => {
            const isSelected = selectedOptions.includes(metric.id);
            const optionDiv = document.createElement('div');
            optionDiv.className = `p-2 flex items-center justify-between hover:bg-gray-600 cursor-pointer text-gray-200 text-sm ${isSelected ? 'bg-gray-600' : ''}`;
            optionDiv.innerHTML = `
                <span>${metric.label}</span>
                ${isSelected ? '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-teal-400 ml-2"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
            `;
            optionDiv.addEventListener('click', () => toggleOption(metric.id));
            dropdownOptions.appendChild(optionDiv);
        });
    };

    selectedDisplay.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownOptions.classList.toggle('hidden');
    });
    
    container.innerHTML = '';
    updateSelectedDisplay();
    updateDropdownOptions();
    dropdownWrapper.appendChild(selectedDisplay);
    dropdownWrapper.appendChild(dropdownOptions);
    container.appendChild(dropdownWrapper);

    document.addEventListener('mousedown', (event) => {
        if (dropdownWrapper && !dropdownWrapper.contains(event.target)) {
            dropdownOptions.classList.add('hidden');
        }
    }, { passive: true });
};

const populatePerformanceTrackerSettingsModal = () => {
    const lowPerformanceMetricSelect = document.getElementById('low-performance-metric-select');
    const lowPerformerThresholdInput = document.getElementById('low-performer-threshold-input');
    const minLowStubsThresholdInput = document.getElementById('min-low-stubs-threshold-input');
    const lowPerfHistoryLookbackSelect = document.getElementById('low-perf-history-lookback-select');
    const lowPerfSpecificWeeksInput = document.getElementById('low-perf-specific-weeks-input');
    const lowPerfSpecificWeeksInputGroup = document.getElementById('settings-low-perf-specific-weeks-input-group');

    const deviationMetricSelect = document.getElementById('deviation-metric-select');
    const deviationThresholdInput = document.getElementById('deviation-threshold-input');
    const dropHistoryLookbackSelect = document.getElementById('drop-history-lookback-select');
    const dropSpecificWeeksInput = document.getElementById('drop-specific-weeks-input');
    const dropSpecificWeeksInputGroup = document.getElementById('settings-drop-specific-weeks-input-group');

    const trendMetricSelect = document.getElementById('trend-metric-select');
    const trendSignificanceThresholdInput = document.getElementById('trend-significance-threshold-input');
    const trendOlderPeriodInput = document.getElementById('trend-older-period-input');
    const trendRecentPeriodInput = document.getElementById('trend-recent-period-input');
    const trendMinOlderStubsInput = document.getElementById('trend-min-older-stubs-input');
    const trendMinRecentStubsInput = document.getElementById('trend-min-recent-stubs-input');

    if (lowPerformanceMetricSelect && !lowPerformanceMetricSelect.dataset.populated) {
        coreMetrics.forEach(metric => lowPerformanceMetricSelect.add(new Option(metric.label, metric.id)));
        lowPerformanceMetricSelect.dataset.populated = 'true';
    }
    if (deviationMetricSelect && !deviationMetricSelect.dataset.populated) {
        coreMetrics.forEach(metric => {
            deviationMetricSelect.add(new Option(metric.label, metric.id));
            deviationMetricSelect.add(new Option(`${metric.label} (4W)`, `${metric.id}_4wkAvg`));
        });
        deviationMetricSelect.dataset.populated = 'true';
    }
    if (trendMetricSelect && !trendMetricSelect.dataset.populated) {
        trendMetricSelect.add(new Option('Overall Momentum', 'overall'));
        coreMetrics.forEach(metric => {
            trendMetricSelect.add(new Option(metric.label, metric.id));
            trendMetricSelect.add(new Option(`${metric.label} (4W)`, `${metric.id}_4wkAvg`));
        });
        trendMetricSelect.dataset.populated = 'true';
    }

    if (lowPerformanceMetricSelect) lowPerformanceMetricSelect.value = appState.lowPerformanceMetric;
    if (lowPerformerThresholdInput) lowPerformerThresholdInput.value = appState.lowPerformerThreshold;
    if (minLowStubsThresholdInput) minLowStubsThresholdInput.value = appState.minLowDaysThreshold;
    if (lowPerfHistoryLookbackSelect) lowPerfHistoryLookbackSelect.value = appState.lowPerfHistoryLookback;
    if (lowPerfSpecificWeeksInput) lowPerfSpecificWeeksInput.value = appState.lowPerfHistorySpecificWeeks;
    if (lowPerfSpecificWeeksInputGroup) lowPerfSpecificWeeksInputGroup.style.display = appState.lowPerfHistoryLookback === 'specificWeeks' ? 'flex' : 'none';

    if (deviationMetricSelect) deviationMetricSelect.value = appState.deviationMetric;
    if (deviationThresholdInput) deviationThresholdInput.value = appState.deviationThreshold;
    if (dropHistoryLookbackSelect) dropHistoryLookbackSelect.value = appState.dropHistoryLookback;
    if (dropSpecificWeeksInput) dropSpecificWeeksInput.value = appState.dropHistorySpecificWeeks;
    if (dropSpecificWeeksInputGroup) dropSpecificWeeksInputGroup.style.display = appState.dropHistoryLookback === 'specificWeeks' ? 'flex' : 'none';

    if (trendMetricSelect) trendMetricSelect.value = appState.trendAnalysisMetric;
    if (trendSignificanceThresholdInput) trendSignificanceThresholdInput.value = appState.trendSignificanceThreshold;
    if (trendOlderPeriodInput) trendOlderPeriodInput.value = appState.trendOlderPeriod;
    if (trendRecentPeriodInput) trendRecentPeriodInput.value = appState.trendRecentPeriod;
    if (trendMinOlderStubsInput) trendMinOlderStubsInput.value = appState.trendMinOlderStubs;
    if (trendMinRecentStubsInput) trendMinRecentStubsInput.value = appState.trendMinRecentStubs;

    const addGenericListener = (element, stateKey, isString = false) => {
        if (element && !element._listenerAttached) {
            const eventType = element.tagName === 'SELECT' ? 'change' : 'input';
            element.addEventListener(eventType, (e) => {
                appState[stateKey] = isString ? e.target.value : parseFloat(e.target.value) || 0;
                renderUI();
            });
            element._listenerAttached = true;
        }
    };

    addGenericListener(lowPerformanceMetricSelect, 'lowPerformanceMetric', true);
    addGenericListener(lowPerformerThresholdInput, 'lowPerformerThreshold');
    addGenericListener(minLowStubsThresholdInput, 'minLowDaysThreshold');
    addGenericListener(lowPerfSpecificWeeksInput, 'lowPerfHistorySpecificWeeks');

    addGenericListener(deviationMetricSelect, 'deviationMetric', true);
    addGenericListener(deviationThresholdInput, 'deviationThreshold');
    addGenericListener(dropSpecificWeeksInput, 'dropHistorySpecificWeeks');

    addGenericListener(trendMetricSelect, 'trendAnalysisMetric', true);
    addGenericListener(trendSignificanceThresholdInput, 'trendSignificanceThreshold');
    addGenericListener(trendOlderPeriodInput, 'trendOlderPeriod');
    addGenericListener(trendRecentPeriodInput, 'trendRecentPeriod');
    addGenericListener(trendMinOlderStubsInput, 'trendMinOlderStubs');
    addGenericListener(trendMinRecentStubsInput, 'trendMinRecentStubs');

    if (lowPerfHistoryLookbackSelect && !lowPerfHistoryLookbackSelect._specificListener) {
        lowPerfHistoryLookbackSelect.addEventListener('change', (e) => {
            appState.lowPerfHistoryLookback = e.target.value;
            if (lowPerfSpecificWeeksInputGroup) {
                lowPerfSpecificWeeksInputGroup.style.display = appState.lowPerfHistoryLookback === 'specificWeeks' ? 'flex' : 'none';
            }
            renderUI(); 
        });
        lowPerfHistoryLookbackSelect._specificListener = true;
    }

    if (dropHistoryLookbackSelect && !dropHistoryLookbackSelect._specificListener) {
        dropHistoryLookbackSelect.addEventListener('change', (e) => {
            appState.dropHistoryLookback = e.target.value;
            if (dropSpecificWeeksInputGroup) {
                dropSpecificWeeksInputGroup.style.display = appState.dropHistoryLookback === 'specificWeeks' ? 'flex' : 'none';
            }
            renderUI(); 
        });
        dropHistoryLookbackSelect._specificListener = true;
    }
};

// --- D3 Charting Functions ---

const drawCharts = () => {
    if (appState.isEntityModalOpen) {
        renderModalContent();
    }
    renderD3BumpChart(calculateBumpChartData(), getFilteredBumpChartEntityNames());
};

export const renderIndividualEntityChart = () => {
    const chartContainer = d3.select('#modal-chart-container');
    const legendContainer = d3.select('#modal-chart-legend');
    chartContainer.html('');
    legendContainer.html('');

    const containerNode = chartContainer.node();
    if (!containerNode || containerNode.clientWidth <= 0 || containerNode.clientHeight <= 0) return;
    if (!appState.selectedEntity) return;

    // Clear previous visibility state on re-render
    appState.chartLineVisibility.clear();

    const primaryChartData = getIndividualEntityChartData(appState.selectedEntity.entityName);
    const comparisonChartData = appState.comparisonEntity ? getIndividualEntityChartData(appState.comparisonEntity.entityName) : [];

    const combinedChartData = [...primaryChartData, ...comparisonChartData];
    if (combinedChartData.length === 0) {
        chartContainer.html(`<p class="text-center text-gray-400">No performance data available for this ${appState.rankingMode}.</p>`);
        return;
    }

    const isRankView = appState.entityModalChartView === 'rank';
    const margin = { top: 20, right: 40, bottom: 50, left: 50 };
    const width = containerNode.clientWidth - margin.left - margin.right;
    const height = containerNode.clientHeight - margin.top - margin.bottom;

    const svg = chartContainer.append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    const highlight = (lineClass) => {
        svg.selectAll('path.line').classed('dimmed', true);
        legendContainer.selectAll('.chart-legend-item-compact').classed('dimmed', true);

        if (lineClass) {
            svg.select(`path.${lineClass}`).classed('dimmed', false).raise();
            legendContainer.select(`.legend-${lineClass}`).classed('dimmed', false);
        }
    };

    const unhighlight = () => {
        svg.selectAll('path.line').classed('dimmed', false);
        legendContainer.selectAll('.chart-legend-item-compact').classed('dimmed', false);
    };

    const updateChartLineVisibility = () => {
        appState.chartLineVisibility.forEach((isVisible, lineClass) => {
            svg.select(`path.${lineClass}`).style('display', isVisible ? null : 'none');
            legendContainer.select(`.legend-${lineClass}`).classed('legend-hidden', !isVisible);
        });
    };

    const activeChartData = combinedChartData.filter(d => d.oneWeekRank !== null || d.fourWeekRank !== null || d.oneWeekCriteria !== null || d.fourWeekCriteria !== null);
    const xScale = d3.scaleTime()
        .domain(d3.extent(activeChartData, d => d.date))
        .range([0, width]);

    let yScaleLeft, yAxisLeft;
    if (isRankView) {
        const allRanks = combinedChartData.flatMap(d => [d.oneWeekRank, d.fourWeekRank]).filter(v => v !== null && !isNaN(v));
        const maxRank = allRanks.length > 0 ? d3.max(allRanks) : 1;
        yScaleLeft = d3.scaleLinear().domain([maxRank + 1, 0.5]).range([height, 0]);
        yAxisLeft = d3.axisLeft(yScaleLeft).ticks(Math.min(10, maxRank)).tickFormat(d3.format('d'));
    } else {
        const allValues = combinedChartData.flatMap(d => [d.oneWeekCriteria, d.fourWeekCriteria]).filter(v => v !== null && !isNaN(v));
        const yMax = allValues.length > 0 ? d3.max(allValues) : 1;
        yScaleLeft = d3.scaleLinear().domain([0, yMax > 0 ? yMax * 1.1 : 0.1]).range([height, 0]);
        yAxisLeft = d3.axisLeft(yScaleLeft).tickFormat(d3.format(".0%"));
    }

    const truckValues = combinedChartData.map(d => d.truckCount).filter(v => v !== null && !isNaN(v));
    const yMaxTrucks = truckValues.length > 0 ? d3.max(truckValues) : 1;
    const yScaleRight = d3.scaleLinear()
        .domain([0, yMaxTrucks > 0 ? yMaxTrucks * 1.2 : 5])
        .range([height, 0]);

    const xAxis = d3.axisBottom(xScale).tickFormat(d3.timeFormat("%b %d"));
    const yAxisRight = d3.axisRight(yScaleRight).ticks(5).tickFormat(d3.format('d'));

    svg.append('g').attr('transform', `translate(0,${height})`).call(xAxis).selectAll('text').style('fill', '#a0aec0').style('font-size', '10px');
    svg.append('g').call(yAxisLeft).selectAll('text').style('fill', '#a0aec0').style('font-size', '10px');
    svg.append('g').attr('transform', `translate(${width}, 0)`).call(yAxisRight).selectAll('text').style('fill', '#a0aec0').style('font-size', '10px');
    svg.append('g').attr('class', 'grid').call(d3.axisLeft(yScaleLeft).tickSize(-width).tickFormat('')).selectAll('line').attr('stroke', '#4a5568').attr('stroke-dasharray', '2,2');
    svg.selectAll('.domain').remove();
    
    // --- Line Definitions ---
    const lineDefs = {
        'line-1wk-primary': { data: primaryChartData, stroke: '#5EEAD4', strokeWidth: 2.5, dash: '', yValue: d => yScaleLeft(isRankView ? d.oneWeekRank : d.oneWeekCriteria), defined: d => (isRankView ? d.oneWeekRank : d.oneWeekCriteria) !== null },
        'line-4wk-primary': { data: primaryChartData, stroke: '#FDBA74', strokeWidth: 2.5, dash: '', yValue: d => yScaleLeft(isRankView ? d.fourWeekRank : d.fourWeekCriteria), defined: d => (isRankView ? d.fourWeekRank : d.fourWeekCriteria) !== null },
        'line-truck-primary': { data: primaryChartData, stroke: '#A78BFA', strokeWidth: 1.5, dash: '4 4', yValue: d => yScaleRight(d.truckCount), defined: d => d.truckCount !== null },
    };
    if (appState.comparisonEntity) {
        lineDefs['line-1wk-compare'] = { data: comparisonChartData, stroke: '#f472b6', strokeWidth: 2.5, dash: '5,5', yValue: d => yScaleLeft(isRankView ? d.oneWeekRank : d.oneWeekCriteria), defined: d => (isRankView ? d.oneWeekRank : d.oneWeekCriteria) !== null };
        lineDefs['line-4wk-compare'] = { data: comparisonChartData, stroke: '#818cf8', strokeWidth: 2.5, dash: '5,5', yValue: d => yScaleLeft(isRankView ? d.fourWeekRank : d.fourWeekCriteria), defined: d => (isRankView ? d.fourWeekRank : d.fourWeekCriteria) !== null };
        lineDefs['line-truck-compare'] = { data: comparisonChartData, stroke: '#fca5a5', strokeWidth: 1.5, dash: '2 6', yValue: d => yScaleRight(d.truckCount), defined: d => d.truckCount !== null };
    }
    
    Object.keys(lineDefs).forEach(key => {
        const def = lineDefs[key];
        const lineGenerator = d3.line().x(d => xScale(d.date)).y(def.yValue).defined(def.defined);
        svg.append('path').datum(def.data).attr('fill', 'none').attr('stroke', def.stroke).attr('stroke-width', def.strokeWidth).attr('stroke-dasharray', def.dash).attr('d', lineGenerator).attr('class', `line ${key}`);
    });

    // --- Legend ---
    let legendHTML = `<div class="chart-legend-compact">`;
    const metricLabel = isRankView ? 'Rank' : '%-ile';
    const legendItems = [
        { class: 'line-1wk-primary', color: '#5EEAD4', type: 'solid', label: `${appState.selectedEntity.entityName} (1-Wk ${metricLabel})` },
        { class: 'line-4wk-primary', color: '#FDBA74', type: 'solid', label: `${appState.selectedEntity.entityName} (4-Wk ${metricLabel})` },
        { class: 'line-truck-primary', color: '#A78BFA', type: 'dashed', label: `${appState.selectedEntity.entityName} (Drivers)` }
    ];
    if (appState.comparisonEntity) {
        legendItems.push(
            { class: 'line-1wk-compare', color: '#f472b6', type: 'solid', label: `${appState.comparisonEntity.entityName} (1-Wk ${metricLabel})` },
            { class: 'line-4wk-compare', color: '#818cf8', type: 'solid', label: `${appState.comparisonEntity.entityName} (4-Wk ${metricLabel})` },
            { class: 'line-truck-compare', color: '#fca5a5', type: 'dashed', label: `${appState.comparisonEntity.entityName} (Drivers)` }
        );
    }
    legendItems.forEach(item => {
        appState.chartLineVisibility.set(item.class, true); // Initialize all lines as visible
        legendHTML += `
            <span class="chart-legend-item-compact legend-${item.class}" data-line-class="${item.class}">
                ${item.type === 'solid' ? `<span class="chart-legend-color" style="background-color: ${item.color};"></span>` : `<span class="chart-legend-color-line" style="border-top-color: ${item.color};"></span>`}
                ${item.label}
            </span>`;
    });
    legendHTML += `</div>`;
    legendContainer.html(legendHTML);

    legendContainer.selectAll('.chart-legend-item-compact')
        .on('mouseover', function() { highlight(d3.select(this).attr('data-line-class')); })
        .on('mouseout', unhighlight)
        .on('click', function() {
            const lineClass = d3.select(this).attr('data-line-class');
            const currentVisibility = appState.chartLineVisibility.get(lineClass);
            appState.chartLineVisibility.set(lineClass, !currentVisibility);
            updateChartLineVisibility();
        });

    // --- Tooltip and Focus ---
    const tooltip = d3.select("body").selectAll(".d3-tooltip").data([null]).join("div").attr("class", "d3-tooltip");
    const focus = svg.append("g").attr("class", "focus").style("display", "none");
    focus.append("line").attr("class", "x-hover-line").attr("y1", 0).attr("y2", height).attr("stroke", "#9ca3af").attr("stroke-width", 1.5).attr("stroke-dasharray", "3,3");
    
    svg.append("rect").attr("width", width).attr("height", height).style("fill", "none").style("pointer-events", "all")
        .on("mouseover", () => { focus.style("display", null); tooltip.style("opacity", 1); })
        .on("mouseout", () => { focus.style("display", "none"); tooltip.style("opacity", 0); })
        .on("mousemove", function(event) {
            const bisectDate = d3.bisector(d => d.date).left;
            const x0 = xScale.invert(d3.pointer(event, this)[0]);
            
            const findDataPoint = (data, date) => {
                if (!data || data.length === 0) return null;
                const i = bisectDate(data, date, 1);
                const d0 = data[i-1], d1 = data[i];
                return (d1 && d0) ? (date - d0.date > d1.date - date ? d1 : d0) : (d0 || d1);
            };

            const primaryDataPoint = findDataPoint(primaryChartData, x0);
            if (!primaryDataPoint) return;
            
            focus.select(".x-hover-line").attr("transform", `translate(${xScale(primaryDataPoint.date)},0)`);
            focus.selectAll("circle").remove();
            
            let tooltipHtml = `<strong class="font-bold">${d3.timeFormat("%Y-%m-%d")(primaryDataPoint.date)}</strong><br/>`;
            
            // Primary Entity
            tooltipHtml += `<strong style="color:#e5e7eb">${appState.selectedEntity.entityName}</strong><br/>`;
            tooltipHtml += `<span style="color:#5EEAD4">&nbsp;&nbsp;1-Wk ${metricLabel}:</span> ${isRankView ? primaryDataPoint.oneWeekRank ?? 'N/A' : formatPercentage(primaryDataPoint.oneWeekCriteria)}<br/>`;
            tooltipHtml += `<span style="color:#FDBA74">&nbsp;&nbsp;4-Wk ${metricLabel}:</span> ${isRankView ? primaryDataPoint.fourWeekRank ?? 'N/A' : formatPercentage(primaryDataPoint.fourWeekCriteria)}<br/>`;
            tooltipHtml += `<span style="color:#A78BFA">&nbsp;&nbsp;Drivers:</span> ${primaryDataPoint.truckCount ?? 'N/A'}`;

            // Comparison Entity
            if (appState.comparisonEntity) {
                const compareDataPoint = findDataPoint(comparisonChartData, primaryDataPoint.date);
                if (compareDataPoint) {
                    tooltipHtml += `<hr class="my-1 border-gray-600">`;
                    tooltipHtml += `<strong style="color:#e5e7eb">${appState.comparisonEntity.entityName}</strong><br/>`;
                    tooltipHtml += `<span style="color:#f472b6">&nbsp;&nbsp;1-Wk ${metricLabel}:</span> ${isRankView ? compareDataPoint.oneWeekRank ?? 'N/A' : formatPercentage(compareDataPoint.oneWeekCriteria)}<br/>`;
                    tooltipHtml += `<span style="color:#818cf8">&nbsp;&nbsp;4-Wk ${metricLabel}:</span> ${isRankView ? compareDataPoint.fourWeekRank ?? 'N/A' : formatPercentage(compareDataPoint.fourWeekCriteria)}<br/>`;
                    tooltipHtml += `<span style="color:#fca5a5">&nbsp;&nbsp;Drivers:</span> ${compareDataPoint.truckCount ?? 'N/A'}`;
                }
            }

            tooltip.html(tooltipHtml)
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px");
        });
};

export const renderD3BumpChart = (bumpChartData, selectedEntityNames) => {
    const chartContainer = document.getElementById('bump-chart-container');
    const legendContainer = document.getElementById('bump-chart-legend');
    chartContainer.innerHTML = '';
    legendContainer.innerHTML = '';

    // Assigns colors only to active dispatchers
    const baseColors = [
        '#60a5fa', '#f87171', '#4ade80', '#fbbf24', '#a78bfa', '#22d3ee', '#f472b6', '#34d399',
        '#ef4444', '#8b5cf6', '#facc15', '#6b7280', '#ec4899', '#14b8a6', '#c084fc', '#eab300' 
    ];
    appState.entityColors = {}; // Clear previous colors
    selectedEntityNames.forEach((name, index) => {
        appState.entityColors[name] = baseColors[index % baseColors.length];
    });
    // END OF NEW BLOCK

    if (!chartContainer || chartContainer.clientWidth <= 0 || chartContainer.clientHeight <= 0) return;

    const highlight = (entityName) => {
        svg.selectAll('path.entity-line').classed('dimmed', true);
        d3.selectAll('#bump-chart-legend .chart-legend-item').classed('dimmed', true);
        svg.selectAll('circle.entity-dot').classed('dimmed', true);
        if (entityName) {
            const safeClassName = entityName.replace(/\s/g, '-');
            svg.select(`path.line-${safeClassName}`).classed('dimmed', false).raise();
            d3.select(`.legend-${safeClassName}`).classed('dimmed', false);
            svg.selectAll(`circle.dot-${safeClassName}`).classed('dimmed', false);
        }
    };

    const unhighlight = () => {
        svg.selectAll('path.entity-line').classed('dimmed', false);
        d3.selectAll('#bump-chart-legend .chart-legend-item').classed('dimmed', false);
        svg.selectAll('circle.entity-dot').classed('dimmed', false);
    };

    legendContainer.innerHTML = selectedEntityNames.map(name => `
        <div class="chart-legend-item justify-center legend-${name.replace(/\s/g, '-')}" data-entity="${name}">
            <span class="chart-legend-color" style="background-color: ${appState.entityColors[name] || '#ccc'};"></span>
            <span>${name}</span>
        </div>
    `).join('');

    d3.selectAll('#bump-chart-legend .chart-legend-item')
        .on('mouseover', function() { highlight(d3.select(this).attr('data-entity')); })
        .on('mouseout', unhighlight);

    if (bumpChartData.length === 0 || selectedEntityNames.length === 0) {
        chartContainer.innerHTML = `<p class="text-center text-gray-400">No data or ${appState.rankingMode}s selected for the bump chart.</p>`;
        return;
    }

    const margin = { top: 20, right: 30, bottom: 50, left: 60 };
    const width = chartContainer.clientWidth - margin.left - margin.right;
    const height = chartContainer.clientHeight - margin.top - margin.bottom;

    const svg = d3.select(chartContainer).append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    const allRanks = selectedEntityNames.flatMap(name =>
        bumpChartData.map(d => d[name]?.rank).filter(rank => typeof rank === 'number')
    );

    const domainX = d3.extent(bumpChartData, d => d.date);
    if (!domainX[0] || !domainX[1] || allRanks.length === 0) {
        chartContainer.innerHTML = '<p class="text-center text-gray-400">Not enough valid data to render chart.</p>';
        return;
    }

    const maxVisibleRank = Math.max(1, d3.max(allRanks));
    const xScale = d3.scaleTime().domain(domainX).range([0, width]);
    const yScale = d3.scaleLinear().domain([maxVisibleRank + 0.5, 0.5]).range([height, 0]);

    const xAxis = d3.axisBottom(xScale).ticks(d3.timeWeek.every(1)).tickFormat(d3.timeFormat("%b %d")).tickSizeOuter(0);
    const yAxis = d3.axisLeft(yScale).ticks(Math.min(maxVisibleRank, 10)).tickFormat(d3.format("d"));

    svg.append('g').attr('transform', `translate(0,${height})`).call(xAxis).selectAll('text').style('fill', '#a0aec0').style('font-size', '12px');
    svg.append('g').call(yAxis).selectAll('text').style('fill', '#a0aec0').style('font-size', '12px');
    svg.append('g').attr('class', 'grid').call(d3.axisLeft(yScale).tickSize(-width).tickFormat('')).select('.domain').remove();
    svg.selectAll('.grid .tick line').attr('stroke', '#4a5568').attr('stroke-dasharray', '3 3');

    selectedEntityNames.forEach(name => {
        const line = d3.line()
            .x(d => xScale(d.date))
            .y(d => yScale(d[name]?.rank))
            .defined(d => d[name] && d[name].rank != null)
            .curve(d3.curveMonotoneX);

        svg.append('path').datum(bumpChartData)
            .attr('fill', 'none').attr('stroke', appState.entityColors[name] || '#ccc')
            .attr('stroke-width', 2.5).attr('d', line)
            .attr('class', `entity-line line-${name.replace(/\s/g, '-')}`);

        svg.selectAll(`circle.dot-${name.replace(/\s/g, '-')}`)
            .data(bumpChartData.filter(d => d[name] && typeof d[name].rank === 'number'))
            .join("circle").attr("class", `entity-dot dot-${name.replace(/\s/g, '-')}`)
            .attr("r", 4).attr("cx", d => xScale(d.date)).attr("cy", d => yScale(d[name].rank))
            .attr("fill", appState.entityColors[name] || '#ccc');
    });

    const focus = svg.append("g").attr("class", "focus").style("display", "none");
    focus.append("line").attr("class", "x-hover-line").attr("y1", 0).attr("y2", height).attr("stroke", "#9ca3af").attr("stroke-width", 1.5).attr("stroke-dasharray", "3,3");
    const tooltip = d3.select("body").selectAll(".d3-tooltip").data([null]).join("div").attr("class", "d3-tooltip");

    svg.append("rect").attr("width", width).attr("height", height).style("fill", "none").style("pointer-events", "all")
        .on("mouseover", () => { focus.style("display", null); tooltip.style("opacity", 1); })
        .on("mouseout", () => { focus.style("display", "none"); tooltip.style("opacity", 0); })
        .on("mousemove", function(event) {
            const bisectDate = d3.bisector(d => d.date).left;
            const x0 = xScale.invert(d3.pointer(event, this)[0]);
            const i = bisectDate(bumpChartData, x0, 1);
            const d0 = bumpChartData[i - 1], d1 = bumpChartData[i];
            const d = (d1 && d0) ? (x0 - d0.date > d1.date - x0 ? d1 : d0) : (d0 || d1);
            if (!d) return;

            focus.select(".x-hover-line").attr("transform", `translate(${xScale(d.date)},0)`);
            const metricInfo = coreMetrics.find(m => m.id === appState.bumpMetric.replace('_4wkAvg', ''));

            let tooltipHtml = `<strong>Date:</strong> ${d3.timeFormat("%Y-%m-%d")(d.date)}<br/>`;
            selectedEntityNames.forEach(name => {
                const entityData = d[name];
                if (entityData) {
                    let formattedValue = '';
                    if (metricInfo && metricInfo.unit === '%') formattedValue = `(${(entityData.value * 100).toFixed(1)}%)`;
                    else if (metricInfo && metricInfo.unit === '$') formattedValue = `($${entityData.value.toFixed(2)})`;
                    else if (typeof entityData.value === 'number') formattedValue = `(${entityData.value.toFixed(0)})`;
                    tooltipHtml += `<span style="color:${appState.entityColors[name]}">${name}</span>: Rank ${entityData.rank} ${formattedValue}<br/>`;
                }
            });

            tooltip.html(tooltipHtml);
            const tooltipWidth = tooltip.node().offsetWidth;
            const tooltipHeight = tooltip.node().offsetHeight;
            let tooltipLeft = event.pageX + 15;
            let tooltipTop = event.pageY - 28;
            if (tooltipLeft + tooltipWidth > window.innerWidth) tooltipLeft = event.pageX - tooltipWidth - 15;
            if (tooltipTop < 0) tooltipTop = event.pageY + 15;
            tooltip.style("left", `${tooltipLeft}px`).style("top", `${tooltipTop}px`);
        });
};

// --- Event Handlers & State Changers ---

export function handleRowClick(entity) {
    appState.selectedEntity = entity;
    appState.isEntityModalOpen = true;
    appState.modalSource = 'rankingsTable';
    appState.entityModalChartView = 'rank';
    appState.profiles.driverDeepDive.entityModalDayFilter = 'all'; // Reset day filter on open
    renderUI();
}

export function handleCloseEntityModal() {
    appState.isEntityModalOpen = false;
    appState.selectedEntity = null;
    appState.comparisonEntity = null; 
    appState.isCompareDropdownOpen = false;
    appState.modalSource = null;
    appState.historicalNavigation = null;
    appState.entityModalHeatmapDriver = null; // <-- This line is added to reset the driver

    d3.select("body").selectAll(".d3-tooltip").remove();

    renderUI();
}

export function handleCloseMainCriteriaModal() {
    appState.isMainCriteriaModalOpen = false;
    renderUI();
}

export function handleCloseDisplaySettingsModal() {
    appState.isDisplaySettingsModalOpen = false;
    renderUI();
}

export function handleClosePerformanceTrackerSettingsModal() {
    appState.isPerformanceTrackerModalOpen = false;
    renderUI();
}

export function requestSort(key) {
    let direction = 'ascending';
    if (appState.sortConfig.key === key && appState.sortConfig.direction === 'ascending') {
        direction = 'descending';
    }
    appState.sortConfig = { key, direction };
    renderMainTable(); 
}

export function toggleColumnVisibility(columnId) {
    const newMap = new Map(appState.visibleColumns);
    newMap.set(columnId, !newMap.get(columnId));
    appState.visibleColumns = newMap;
    renderUI(); 
}

export function getStubsSortIcon(key) {
    if (stubsSortConfig.key === key) {
        return stubsSortConfig.direction === 'ascending' ?
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3 ml-1 inline-block"><polyline points="18 15 12 9 6 15"/></svg>' :
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3 ml-1 inline-block"><polyline points="6 9 12 15 18 9"/></svg>';
    }
    return '';
};

export function requestStubsSort(key) {
    let direction = 'ascending';
    if (stubsSortConfig.key === key && stubsSortConfig.direction === 'ascending') {
        direction = 'descending';
    }
    setStubsSortConfig({ key, direction });
    renderModalContent();
};

export function updateDynamicTitles() {
    const mode = appState.rankingMode;
    const rankingModeTitle = document.getElementById('ranking-mode-title');
    if(rankingModeTitle) {
        if (mode === 'team') {
            rankingModeTitle.innerHTML = `Team <span class="text-yellow-400">Rankings</span>`;
        } else {
            rankingModeTitle.innerHTML = `Dispatcher <span class="text-yellow-400">Rankings</span>`;
        }
    }

    const typeSuffix = `(${appState.driverTypeFilter.toUpperCase()})`;

    const historicalRankTitle = document.getElementById('historical-rank-title');
    if(historicalRankTitle) {
        historicalRankTitle.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6 mr-2 text-blue-400"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
        Historical Rank Changes ${typeSuffix}`;
    }

    const performanceTrackerTitle = document.getElementById('performance-tracker-title').querySelector('span');
     if(performanceTrackerTitle) {
         performanceTrackerTitle.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6 mr-2 text-red-400"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
        Performance Tracker ${typeSuffix}`;
    }

    const entityModalTitle = document.getElementById('dispatcher-modal-title');
    if(entityModalTitle && appState.selectedEntity) {
        entityModalTitle.innerHTML = `<span id="modal-entity-name-text">${appState.selectedEntity.entityName} -</span> Performance Trend ${typeSuffix}`;
    }
};

export const updateDriverTypeSwitcherUI = () => {
    const buttons = document.querySelectorAll('#driver-type-switcher button');
    buttons.forEach(button => {
        if (button.dataset.type === appState.driverTypeFilter) {
            button.classList.add('bg-teal-500', 'text-white');
            button.classList.remove('text-gray-300');
        } else {
            button.classList.remove('bg-teal-500', 'text-white');
            button.classList.add('text-gray-300');
        }
    });
};

export const populateDateDropdown = () => {
    const dateSelector = document.getElementById('date-selector');
    if (dateSelector) { 
        dateSelector.innerHTML = ''; 
        const uniqueDates = [...new Set(appState.allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
        uniqueDates.forEach(dateString => {
            const option = document.createElement('option');
            option.value = dateString;
            option.textContent = dateString;
            if (dateString === appState.selectedDate) {
                option.selected = true;
            }
            dateSelector.appendChild(option);
        });
    }
};

const createViewListItem = (viewName, isDeletable) => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'flex items-center justify-between p-2 hover:bg-gray-600 cursor-pointer text-gray-200 text-sm group';
    itemDiv.draggable = true;
    itemDiv.dataset.viewName = viewName;
    
    // Add event listeners for drag and drop
    itemDiv.addEventListener('dragstart', handleViewDragStart);
    itemDiv.addEventListener('dragover', handleViewDragOver);
    itemDiv.addEventListener('dragleave', handleViewDragLeave);
    itemDiv.addEventListener('drop', handleViewDrop);
    itemDiv.addEventListener('dragend', handleViewDragEnd);
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = viewName;
    nameSpan.className = 'flex-grow';
    nameSpan.onclick = () => loadView(viewName);
    itemDiv.appendChild(nameSpan);

    if (isDeletable) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'ml-2 text-gray-500 group-hover:text-red-400 hover:text-red-200 transition-colors';
        deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
        deleteBtn.title = 'Delete view';
        deleteBtn.onclick = (e) => {
            e.stopPropagation(); // prevent loading the view when deleting
            if(confirm(`Are you sure you want to delete the view "${viewName}"?`)) {
                deleteView(viewName);
            }
        };
        itemDiv.appendChild(deleteBtn);
    }
    return itemDiv;
};

export const renderViewDropdown = () => {
    const savedViewsList = document.getElementById('saved-views-list');
    if (!savedViewsList) return;
    
    savedViewsList.innerHTML = '';
    
    const savedViews = JSON.parse(localStorage.getItem('dispatcherHubViews')) || {};
    let viewOrder = JSON.parse(localStorage.getItem('dispatcherHubViewsOrder')) || [];
    
    const savedViewNames = Object.keys(savedViews);
    savedViewNames.forEach(name => {
        if (!viewOrder.includes(name)) {
            viewOrder.push(name);
        }
    });
    viewOrder = viewOrder.filter(name => savedViewNames.includes(name));
    localStorage.setItem('dispatcherHubViewsOrder', JSON.stringify(viewOrder));

    // Add the default, non-deletable views first
    savedViewsList.appendChild(createViewListItem('Default View', false));
    savedViewsList.appendChild(createViewListItem('1wk ALL View', false));
    savedViewsList.appendChild(createViewListItem('4wk ALL View', false));
    savedViewsList.appendChild(createViewListItem('Regional View', false));

    // Add a separator
    const separator = document.createElement('hr');
    separator.className = 'border-gray-600 my-1';
    savedViewsList.appendChild(separator);

    // Add user-saved views
    viewOrder.forEach(viewName => {
        const viewItem = createViewListItem(viewName, true);
        savedViewsList.appendChild(viewItem);
    });
};


function renderComparisonSelector() {
    const container = document.getElementById('comparison-container');
    if (!container) return;

    if (appState.comparisonEntity) {
        container.innerHTML = `
            <span class="text-gray-400 mx-1">vs</span>
            <span class="font-bold text-rose-400">${appState.comparisonEntity.entityName}</span>
            <button id="remove-comparison-btn" class="ml-2 text-gray-500 hover:text-white">&times;</button>
        `;
    } else {
        container.innerHTML = `
            <button id="add-comparison-btn" class="ml-2 p-1 rounded-full hover:bg-gray-700" title="Compare">
                <svg class="w-4 h-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            </button>
        `;
    }

    if (appState.isCompareDropdownOpen) {
        const dropdown = document.createElement('div');
        dropdown.id = 'comparison-dropdown';
        dropdown.className = 'absolute top-full left-0 mt-2 w-64 bg-gray-700 border border-gray-600 rounded-lg shadow-xl z-50 p-2';
        
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = `Search ${appState.rankingMode === 'team' ? 'teams' : 'dispatchers'}...`;
        searchInput.className = 'w-full bg-gray-800 text-gray-100 border-gray-600 rounded-md px-2 py-1 text-sm mb-2';
        
        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'max-h-48 overflow-y-auto';

        const renderOptions = (filter = '') => {
            optionsContainer.innerHTML = '';
            const isTeamMode = appState.rankingMode === 'team';
            const optionsList = isTeamMode ? appState.allTeamNames : appState.allDispatcherNames;

            optionsList
                .filter(name => name !== appState.selectedEntity.entityName && name.toLowerCase().includes(filter.toLowerCase()))
                .forEach(name => {
                    const option = document.createElement('div');
                    option.className = 'p-2 hover:bg-gray-600 cursor-pointer text-sm rounded-md';
                    option.textContent = name;
                    option.onclick = () => {
                        const isTeamMode = appState.rankingMode === 'team';
                        const groupKey = isTeamMode ? 'dispatcherTeam' : 'dispatcherName';

                        const entityRawData = appState.allHistoricalData.filter(
                            d => d.date.toISOString().split('T')[0] === appState.selectedDate && d[groupKey] === name
                        );

                        if (entityRawData.length > 0) {
                            if (isTeamMode) {
                                // For teams, the structure is different, we can just find the pre-aggregated data
                                const teamData = appState.data.find(d => d.entityName === name);
                                if (teamData) {
                                    appState.comparisonEntity = teamData;
                                } else {
                                     appState.comparisonEntity = { entityName: name, stubs: [] };
                                }
                            } else {
                                // For dispatchers, perform consolidation on the fly
                                const totalWeight = entityRawData.reduce((sum, r) => sum + (r.numDrivers || 0), 0);
                                const consolidated = {
                                    ...entityRawData[0], // Start with the first record as a base
                                    entityName: name,
                                    numDrivers: entityRawData.reduce((sum, r) => sum + (r.numDrivers || 0), 0),
                                    numOOs: entityRawData.reduce((sum, r) => sum + (r.numOOs || 0), 0),
                                    numLOOs: entityRawData.reduce((sum, r) => sum + (r.numLOOs || 0), 0),
                                    driverNames: [...new Set(entityRawData.flatMap(r => r.driverNames || []))],
                                    stubs: entityRawData.flatMap(r => r.stubs || []),
                                };

                                // Calculate weighted averages for all core metrics
                                coreMetrics.forEach(metric => {
                                    const weightedSum = entityRawData.reduce((sum, r) => {
                                        const value = r[metric.id];
                                        const weight = r.numDrivers || 0;
                                        return sum + ((typeof value === 'number' ? value : 0) * weight);
                                    }, 0);
                                    consolidated[metric.id] = totalWeight > 0 ? weightedSum / totalWeight : 0;
                                });
                                appState.comparisonEntity = consolidated;
                            }
                        } else {
                            appState.comparisonEntity = { entityName: name, stubs: [] };
                        }

                        appState.isCompareDropdownOpen = false;
                        renderModalContent();
                    };
                    optionsContainer.appendChild(option);
                });
        };
        
        searchInput.oninput = () => renderOptions(searchInput.value);
        
        dropdown.appendChild(searchInput);
        dropdown.appendChild(optionsContainer);
        container.appendChild(dropdown);
        renderOptions();
    }
}

const renderHistoricalMovement = () => {
    const container = document.getElementById('historical-movement-container');
    if (!container) return;

    const selectedDispatchers = appState.selectedBumpEntities.slice(0, 3);

    if (selectedDispatchers.length === 0) {
        container.innerHTML = `<div class="historical-movement-placeholder">Select up to 3 dispatchers from the 'Historical Rank Changes' chart to see their history.</div>`;
        return;
    }

    const { selectedDate, weeksBack } = appState;
    const dataToUse = getFilteredDataByDriverType(appState.allHistoricalData); // Use filtered data
    const uniqueDates = [...new Set(dataToUse.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const selectedDateIndex = uniqueDates.indexOf(selectedDate);
    const relevantDateStrings = uniqueDates.slice(selectedDateIndex, selectedDateIndex + weeksBack);

    const historyForSelected = dataToUse.filter(d =>
        selectedDispatchers.includes(d.dispatcherName) &&
        relevantDateStrings.includes(d.date.toISOString().split('T')[0])
    );

    const allDates = [...new Set(historyForSelected.map(d => d.date.toISOString().split('T')[0]))]
        .sort((a, b) => new Date(b) - new Date(a));

    if (allDates.length === 0) {
        container.innerHTML = `<div class="historical-movement-placeholder">No historical data found for the selected dispatchers in this time period.</div>`;
        return;
    }

    const dataByDate = historyForSelected.reduce((acc, stub) => {
        const dateKey = stub.date.toISOString().split('T')[0];
        if (!acc[dateKey]) acc[dateKey] = {};
        acc[dateKey][stub.dispatcherName] = {
            gross: stub.pDriver_gross || 0,
            margin: stub.pMargin_dollar || 0,
            rpm: stub.rpmAll || 0,
            drivers: stub.numDrivers || 0
        };
        return acc;
    }, {});

    const headersHTML = selectedDispatchers.map(name => `
        <div class="hm-header-group">
            <div class="hm-super-header">${name}</div>
            <div class="hm-sub-header-grid">
                <span>Gross</span><span>Margin</span><span>RPM</span><span>Drivers</span>
            </div>
        </div>
    `).join('');

    const colgroupHTML = selectedDispatchers.map(() => `
        <col span="4" class="dispatcher-col-group">
    `).join('');

    const bodyRowsHTML = allDates.map(date => {
        const rowData = selectedDispatchers.map(dispatcherName => {
            if (!canViewDispatcher(dispatcherName)) {
                return `<td class="hm-no-data-cell hm-group-start" colspan="4">-</td>`;
            }

            const data = dataByDate[date]?.[dispatcherName];
            return data
                ? `<td class="hm-group-start" data-dispatcher-name="${dispatcherName}" data-date="${date}">$${data.gross.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                   <td data-dispatcher-name="${dispatcherName}" data-date="${date}">$${data.margin.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                   <td data-dispatcher-name="${dispatcherName}" data-date="${date}">$${data.rpm.toFixed(2)}</td>
                   <td data-dispatcher-name="${dispatcherName}" data-date="${date}">${data.drivers}</td>`
                : `<td class="hm-no-data-cell hm-group-start" colspan="4">- No Data -</td>`;
        }).join('');

        return `
            <tr>
                <td class="hm-date-cell">${new Date(date).toLocaleDateString('en-US', { timeZone: 'UTC' })}</td>
                ${rowData}
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="hm-layout-container">
            <div class="hm-header-container">
                <div class="hm-date-header">Date</div>
                ${headersHTML}
            </div>
            <div class="hm-body-container">
                <table class="historical-movement-table">
                    <colgroup>
                        <col class="date-col">
                        ${colgroupHTML}
                    </colgroup>
                    <tbody>
                        ${bodyRowsHTML}
                    </tbody>
                </table>
            </div>
        </div>
    `;
};

export function handleHistoricalMovementRowClick(dispatcherNames, date) {
    const dataToUse = getFilteredDataByDriverType(appState.allHistoricalData);

    const entities = dispatcherNames.map(dispatcherName => {
        return dataToUse.find(d => d.dispatcherName === dispatcherName && d.date.toISOString().split('T')[0] === date);
    }).filter(Boolean);

    if (entities.length > 0) {
        appState.selectedEntities = entities.map(entity => ({ ...entity, entityName: entity.dispatcherName }));
        appState.selectedEntity = appState.selectedEntities[0];
        appState.isEntityModalOpen = true;
        appState.modalSource = 'historicalMovement';
        appState.entityModalChartView = 'stubs';

        const commonDates = dispatcherNames.map(dispatcherName => 
            new Set(dataToUse
                .filter(d => d.dispatcherName === dispatcherName)
                .map(d => d.date.toISOString().split('T')[0]))
        ).reduce((a, b) => new Set([...a].filter(x => b.has(x))));

        const sortedCommonDates = [...commonDates].sort((a, b) => new Date(b) - new Date(a));

        appState.historicalNavigation = {
            dispatcherNames: dispatcherNames,
            availableDates: sortedCommonDates,
            currentIndex: sortedCommonDates.indexOf(date)
        };

        renderUI();
    } else {
        console.warn(`Could not find entity data for selected dispatchers on ${date}`);
    }
}


function renderDispatcherHeatmap() {
    const chartContainer = document.getElementById('modal-chart-container');
    if (!chartContainer) return;

    const primaryEntityName = appState.selectedEntity.entityName;
    const comparisonEntityName = appState.comparisonEntity ? appState.comparisonEntity.entityName : null;
    const viewMode = appState.entityModalHeatmapView; // 'cluster' or 'driver'
    const timeView = appState.entityModalHeatmapPeriod; // '1w' or '4w'
    const dayView = appState.profiles.driverDeepDive.entityModalDayFilter;
    const directionView = appState.profiles.driverDeepDive.heatmapDirection;
    let dateType = appState.profiles.driverDeepDive.heatmapDateType;
    const clusterSize = appState.entityModalClusterSize;

    const isDriverView = viewMode === 'driver';
    const isDateByLocked = dayView === 'all' || isDriverView;
    
    if (isDriverView) {
        dateType = 'pu';
    } else if (isDateByLocked) {
        dateType = 'del';
    }


    let daysOfWeek = [
        { id: 'all', label: 'All Days' }, { id: '2', label: 'Tuesday' }, { id: '3', label: 'Wednesday' },
        { id: '4', label: 'Thursday' }, { id: '5', label: 'Friday' }, { id: '6', label: 'Saturday' },
        { id: '0', label: 'Sunday' }, { id: '1', label: 'Monday' }
    ];
    if (!isDriverView && timeView === '1w') {
        daysOfWeek.splice(1, 0, { id: 'prev_mon', label: 'Previous Mon' });
    }

    const milesPerLat = 69;
    const milesPerLon = 53;
    const radiusInMiles = Math.round(Math.sqrt(Math.pow(clusterSize * milesPerLat / 2, 2) + Math.pow(clusterSize * milesPerLon / 2, 2)));

    // --- Driver Selection Logic ---
    const { selectedDate, rankingMode } = appState;
    const dataToUse = getFilteredDataByDriverType(appState.allHistoricalData);
    const uniqueDates = [...new Set(dataToUse.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const selectedDateIndex = uniqueDates.indexOf(selectedDate);
    const relevantDateStrings = uniqueDates.slice(selectedDateIndex, selectedDateIndex + (timeView === '1w' ? 1 : 4));
    
    const entityFilterField = rankingMode === 'team' ? 'dispatcherTeam' : 'dispatcherName';
    const driverStubsForPeriod = dataToUse.filter(d => 
        d[entityFilterField] === primaryEntityName && 
        relevantDateStrings.includes(d.date.toISOString().split('T')[0])
    ).flatMap(d => d.stubs || []);

    const driversForDropdown = [...new Set(driverStubsForPeriod.map(s => s.driverName))].sort();

    chartContainer.innerHTML = `
        <div class="flex items-center justify-center gap-3 p-2 border-b border-gray-700 flex-shrink-0 flex-wrap">
            <div class="flex items-center gap-2 ${isDriverView ? 'hidden' : ''}">
                 <label class="text-xs font-semibold text-gray-400">Cluster Radius:</label>
                <input type="range" id="heatmap-cluster-size-slider" min="0.5" max="5" value="${clusterSize}" step="0.25" class="w-20 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer">
                <span id="heatmap-cluster-radius-label" class="text-xs font-mono text-teal-300 w-24 text-left">~ ${radiusInMiles} mi</span>
            </div>

            <div class="flex items-center gap-2" title="Toggle the main map view.">
                <label class="text-xs font-semibold text-gray-400">View:</label>
                <div class="flex rounded-lg p-0-5 bg-gray-900 border border-gray-600">
                    <button data-viewmode="cluster" class="heatmap-viewmode-btn px-3 py-1 text-xs rounded-md ${!isDriverView ? 'bg-teal-600 text-white' : ''}">Cluster</button>
                    <button data-viewmode="driver" class="heatmap-viewmode-btn px-3 py-1 text-xs rounded-md ${isDriverView ? 'bg-teal-600 text-white' : ''}">Driver</button>
                </div>
            </div>

            <div class="flex items-center gap-2">
                <label class="text-xs font-semibold text-gray-400">Period:</label>
                <div class="flex rounded-lg p-0-5 bg-gray-900 border border-gray-600">
                    <button data-period="1w" class="heatmap-period-btn px-3 py-1 text-xs rounded-md ${timeView === '1w' ? 'bg-teal-600 text-white' : ''}">1 Week</button>
                    <button data-period="4w" class="heatmap-period-btn px-3 py-1 text-xs rounded-md ${timeView === '4w' ? 'bg-teal-600 text-white' : ''}">4 Weeks</button>
                </div>
            </div>

            <div class="flex items-center gap-2 ${!isDriverView ? 'hidden' : ''}">
                <label class="text-xs font-semibold text-gray-400">Driver:</label>
                <select id="heatmap-driver-select" class="bg-gray-900 border border-gray-600 rounded-md px-2 py-1 text-xs h-[26px]">
                    <option value="">Select a Driver...</option>
                    ${driversForDropdown.map(d => `<option value="${d}" ${d === appState.entityModalHeatmapDriver ? 'selected' : ''}>${d}</option>`).join('')}
                </select>
            </div>

            <div class="flex items-center gap-2 ${isDriverView ? 'hidden' : ''}" title="Toggle the map view between Pick-Up (PU) locations or Delivery (DEL) locations.">
                <label class="text-xs font-semibold text-gray-400">Direction:</label>
                <div class="flex rounded-lg p-0-5 bg-gray-900 border border-gray-600">
                    <button data-direction="outbound" class="heatmap-direction-btn px-3 py-1 text-xs rounded-md ${directionView === 'outbound' ? 'bg-teal-600 text-white' : ''}">PU</button>
                    <button data-direction="inbound" class="heatmap-direction-btn px-3 py-1 text-xs rounded-md ${directionView === 'inbound' ? 'bg-teal-600 text-white' : ''}">DEL</button>
                </div>
            </div>

            <div class="flex items-center gap-2 ${isDriverView ? 'hidden' : ''}" title="Filter loads based on their Pick-Up (PU) date or Delivery (DEL) date. 'All Days' defaults to Delivery date.">
                <label class="text-xs font-semibold text-gray-400">Date By:</label>
                <div class="flex rounded-lg p-0-5 bg-gray-900 border border-gray-600 ${isDateByLocked ? 'date-by-locked' : ''}">
                    <button data-datetype="pu" class="heatmap-datetype-btn px-3 py-1 text-xs rounded-md ${dateType === 'pu' ? 'bg-teal-600 text-white' : ''}">PU</button>
                    <button data-datetype="del" class="heatmap-datetype-btn px-3 py-1 text-xs rounded-md ${dateType === 'del' ? 'bg-teal-600 text-white' : ''}">DEL</button>
                </div>
            </div>
            <div class="flex items-center gap-2 ${isDriverView ? 'hidden' : ''}">
                <label class="text-xs font-semibold text-gray-400">Day:</label>
                <select id="heatmap-day-select" class="bg-gray-900 border border-gray-600 rounded-md px-2 py-1 text-xs h-[26px]">
                    ${daysOfWeek.map(d => `<option value="${d.id}" ${d.id === dayView ? 'selected' : ''} style="${d.id === 'prev_mon' ? 'color: #f87171;' : ''}">${d.label}</option>`).join('')}
                </select>
            </div>
        </div>
        <div class="flex-grow grid grid-cols-2 gap-x-3 p-2 min-h-0">
            <div id="dispatcher-heatmap-render-area" class="relative h-full rounded-lg overflow-hidden border border-gray-700/50"></div>
            <div id="dispatcher-heatmap-state-breakdown" class="h-full rounded-lg overflow-hidden border border-gray-700/50"></div>
        </div>
    `;
    
    const tooltip = d3.select("#loads-tooltip");

    const getPayPeriodFromPayDate = (payDateString) => {
        const payDate = new Date(payDateString);
        payDate.setUTCHours(0, 0, 0, 0);
        const end = new Date(payDate);
        end.setUTCDate(payDate.getUTCDate() - 3);
        end.setUTCHours(23, 59, 59, 999);
        const start = new Date(end);
        start.setUTCDate(end.getUTCDate() - 6);
        start.setUTCHours(0, 0, 0, 0);
        return { start, end };
    };

    const selectedPayDate = appState.selectedDate;
    
    const getFilteredDataForEntity = (entityName) => {
        if (!entityName) return [];
        let baseData = appState.profiles.liveData.filter(d => d.status !== 'Canceled' && d.do_date && d.pu_date);

        baseData = baseData.filter(load => {
            const rpm = (load.rpm_all || 0);
            const rate = (load.price || 0);
            if (rpm === 0 && rate < 500) {
                return false; // Exclude this load
            }
            return true; // Include this load
        });

        const driverTypeFilter = appState.driverTypeFilter;
        if (driverTypeFilter !== 'all') {
            baseData = baseData.filter(load => {
                const contractType = (load.contract_type || '').trim().toUpperCase();
                if (driverTypeFilter === 'oo') {
                    return contractType === 'OO';
                } else if (driverTypeFilter === 'loo') {
                    // LOO filter includes anything that isn't 'OO'
                    return contractType !== 'OO';
                }
                return true;
            });
        }

        if (appState.rankingMode === 'team') {
            const specialPrefixes = ['agnius', 'miles', 'uros'];
            const entityNameLower = entityName.toLowerCase().trim();
            const prefix = specialPrefixes.find(p => entityNameLower.startsWith(p));
    
            if (prefix) {
                // Handles special teams like "Uros EB Infinity" by splitting the name
                const companyPart = entityName.substring(prefix.length).trim();
                const companyPartLower = companyPart.toLowerCase();

                baseData = baseData.filter(d => {
                    if (!d.team || !d.company_name) return false;
                    const teamLower = d.team.toLowerCase().trim();
                    const companyLower = d.company_name.toLowerCase().trim();

                    // Match loads where team is the prefix AND company matches the rest
                    return teamLower === prefix && companyLower === companyPartLower;
                });
            } else {
                // Standard team name matching for other teams
                baseData = baseData.filter(d => d.team && d.team.toLowerCase().trim() === entityNameLower);
            }
        } else {
            baseData = baseData.filter(d => d.dispatcher === entityName);
        }
        
        const { start: weekStart, end: weekEnd } = getPayPeriodFromPayDate(selectedPayDate);
        
        if (dayView === 'prev_mon') {
             const previousMonday = new Date(weekStart);
             previousMonday.setUTCDate(previousMonday.getUTCDate() - 1);
             return baseData.filter(d => {
                const dateKey = dateType === 'pu' ? 'pu_date' : 'do_date';
                if (!d[dateKey]) return false;
                const eventDate = new Date(d[dateKey]);
                return eventDate.getUTCFullYear() === previousMonday.getUTCFullYear() &&
                       eventDate.getUTCMonth() === previousMonday.getUTCMonth() &&
                       eventDate.getUTCDate() === previousMonday.getUTCDate();
            });
        }
        
        const lookbackStart = new Date(weekEnd);
        const daysToLookback = timeView === '1w' ? 6 : 27;
        lookbackStart.setUTCDate(lookbackStart.getUTCDate() - daysToLookback);
        lookbackStart.setUTCHours(0, 0, 0, 0);
        
        baseData = baseData.filter(d => new Date(d.do_date) >= lookbackStart && new Date(d.do_date) <= weekEnd);
        
        const dateKeyForDayFilter = (dayView === 'all' || isDriverView) ? 'do_date' : (dateType === 'pu' ? 'pu_date' : 'do_date');
        if (!isDriverView && dayView !== 'all') {
            const dayIndex = parseInt(dayView, 10);
            baseData = baseData.filter(d => new Date(d[dateKeyForDayFilter]).getUTCDay() === dayIndex);
        }
        
        return baseData;
    };
    
    let allLoadsForPeriod = appState.profiles.liveData.filter(d => d.status !== 'Canceled' && d.do_date);
    const { end: selectedWeekEnd } = getPayPeriodFromPayDate(selectedPayDate);
    const lookbackStartForMedian = new Date(selectedWeekEnd);
    lookbackStartForMedian.setUTCDate(lookbackStartForMedian.getUTCDate() - (timeView === '1w' ? 6 : 27));
    lookbackStartForMedian.setUTCHours(0, 0, 0, 0);
    allLoadsForPeriod = allLoadsForPeriod.filter(d => new Date(d.do_date) >= lookbackStartForMedian && new Date(d.do_date) <= selectedWeekEnd);
    
    const allRpmsForPeriod = allLoadsForPeriod.map(load => parseFloat(load.rpmAll || load.rpm_all)).filter(rpm => !isNaN(rpm) && rpm > 0);
    const universalMedianRpm = calculateMedian(allRpmsForPeriod);

    const primarySourceData = getFilteredDataForEntity(primaryEntityName);
    const comparisonSourceData = getFilteredDataForEntity(comparisonEntityName);
    
    window.resetHeatmapDetailsView = () => {
        appState.heatmapSelectedCluster = null;
        renderStateBreakdownTable(primarySourceData, comparisonSourceData);
    };

    const renderArea = document.getElementById('dispatcher-heatmap-render-area');
    const breakdownContainer = document.getElementById('dispatcher-heatmap-state-breakdown');
    
    if (isDriverView && appState.entityModalHeatmapDriver) {
        const driverName = appState.entityModalHeatmapDriver;
        const { end } = getPayPeriodFromPayDate(selectedPayDate);
        const lookbackEnd = end;
        const lookbackStart = new Date(lookbackEnd);
        lookbackStart.setUTCDate(lookbackStart.getUTCDate() - (timeView === '1w' ? 6 : 27));
        lookbackStart.setUTCHours(0, 0, 0, 0);
        
        const driverLoads = appState.profiles.liveData.filter(l => 
            l.driver === driverName && 
            l.status !== 'Canceled' &&
            new Date(l.do_date) >= lookbackStart &&
            new Date(l.do_date) <= lookbackEnd
        ).sort((a,b) => new Date(a.pu_date) - new Date(b.pu_date));

        if (renderArea) {
            renderDriverRouteMap(renderArea, driverLoads, directionView, tooltip);
            
            renderArea.insertAdjacentHTML('afterbegin', `
                <div class="absolute top-3 left-3 z-50">
                    <button id="heatmap-back-btn" title="Back to Cluster">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="15 18 9 12 15 6"></polyline>
                        </svg>
                    </button>
                </div>
            `);

            const backBtn = document.getElementById('heatmap-back-btn');
            if (backBtn) {
                backBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    appState.entityModalHeatmapView = 'cluster';
                    appState.entityModalHeatmapDriver = null;
                    renderDispatcherHeatmap();
                });
            }
        }
        if (breakdownContainer) renderDriverLoadTable(breakdownContainer, driverLoads);

    } else if (isDriverView && !appState.entityModalHeatmapDriver) {
        if (renderArea) renderArea.innerHTML = `<div class="flex items-center justify-center h-full text-gray-500 text-sm">Please select a driver to see their route.</div>`;
        if (breakdownContainer) breakdownContainer.innerHTML = '';
    } else { // Cluster View
        if (renderArea) {
            const primaryRpms = primarySourceData.map(load => parseFloat(load.rpmAll || load.rpm_all)).filter(rpm => !isNaN(rpm) && rpm > 0);
            const rpmsBelowMedian = primaryRpms.filter(r => r < universalMedianRpm);
            const rpmsAboveMedian = primaryRpms.filter(r => r > universalMedianRpm);
            const minLabel = rpmsBelowMedian.length > 0 ? `$${d3.min(rpmsBelowMedian).toFixed(2)}` : ``;
            const maxLabel = rpmsAboveMedian.length > 0 ? `$${d3.max(rpmsAboveMedian).toFixed(2)}` : ``;
            const legendHTML = `
                <div class="map-rpm-legend">
                    <div class="legend-labels"><span>LOW RPM</span><span>HIGH RPM</span></div>
                    <div class="legend-gradient"></div>
                    <div class="legend-values">
                        <span>${minLabel}</span>
                        <span title="Universal Median RPM for this period">$${universalMedianRpm.toFixed(2)}</span>
                        <span>${maxLabel}</span>
                    </div>
                </div>`;
            renderArea.insertAdjacentHTML('beforeend', legendHTML);
        }

        setTimeout(() => {
            if (!renderArea) return;
            
            if (appState.heatmapSelectedCluster) {
                 renderDriverRouteMap(renderArea, appState.heatmapSelectedCluster.loads, directionView, tooltip);
                 renderArea.insertAdjacentHTML('afterbegin', `
                    <div class="absolute top-3 left-3 z-50">
                        <button id="heatmap-cluster-back-btn" class="bg-gray-800 text-white p-1 rounded-full shadow-md hover:bg-gray-700 transition" title="Back to All Clusters">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                `);
                const clusterBackBtn = document.getElementById('heatmap-cluster-back-btn');
                if (clusterBackBtn) {
                    clusterBackBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        appState.heatmapSelectedCluster = null;
                        renderDispatcherHeatmap();
                    });
                }
            } else {
                const datasets = [];
                const isComparing = !!comparisonEntityName;
                if (primarySourceData.length > 0) datasets.push({ data: primarySourceData, color: isComparing ? '#86efac' : null });
                if (isComparing && comparisonSourceData.length > 0) datasets.push({ data: comparisonSourceData, color: '#ef4444' });
                if (datasets.length > 0) {
                    renderClusterMap(renderArea, datasets, clusterSize, directionView, 'rpm', tooltip, universalMedianRpm, 80);
                } else {
                    renderArea.innerHTML = `<div class="flex items-center justify-center h-full text-gray-500 text-sm">No load data with location information found.</div>`;
                }
            }
        }, 0);
        
        // Restore the specific cluster table if returning from driver view
        if (appState.heatmapSelectedCluster) {
            renderClusterLoadsTable(appState.heatmapSelectedCluster.loads, appState.heatmapSelectedCluster.clusterName, appState.heatmapSelectedCluster.isComparing);
        } else {
            renderStateBreakdownTable(primarySourceData, comparisonSourceData);
        }
    }

    // Event Listeners
    chartContainer.querySelectorAll('.heatmap-viewmode-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            appState.entityModalHeatmapView = e.target.dataset.viewmode;
            renderDispatcherHeatmap();
        });
    });
    chartContainer.querySelectorAll('.heatmap-direction-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            appState.profiles.driverDeepDive.heatmapDirection = e.target.dataset.direction;
            renderDispatcherHeatmap();
        });
    });
    chartContainer.querySelectorAll('.heatmap-datetype-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            appState.profiles.driverDeepDive.heatmapDateType = e.target.dataset.datetype;
            renderDispatcherHeatmap();
        });
    });
    chartContainer.querySelectorAll('.heatmap-period-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            appState.entityModalHeatmapPeriod = e.target.dataset.period;
            appState.entityModalHeatmapDriver = null;
            appState.heatmapSelectedCluster = null; // Reset selection on filter change
            renderDispatcherHeatmap();
        });
    });
    document.getElementById('heatmap-day-select')?.addEventListener('change', (e) => {
        appState.profiles.driverDeepDive.entityModalDayFilter = e.target.value;
        renderDispatcherHeatmap();
    });
     document.getElementById('heatmap-driver-select')?.addEventListener('change', (e) => {
        appState.entityModalHeatmapDriver = e.target.value;
        renderDispatcherHeatmap();
    });
    const slider = document.getElementById('heatmap-cluster-size-slider');
    const radiusLabel = document.getElementById('heatmap-cluster-radius-label');
    if(slider && radiusLabel) {
        slider.addEventListener('input', (e) => {
            const tempClusterSize = parseFloat(e.target.value);
            const tempRadiusInMiles = Math.round(Math.sqrt(Math.pow(tempClusterSize * milesPerLat / 2, 2) + Math.pow(tempClusterSize * milesPerLon / 2, 2)));
            radiusLabel.textContent = `~ ${tempRadiusInMiles} mi`;
        });
        slider.addEventListener('change', (e) => {
            appState.entityModalClusterSize = parseFloat(e.target.value);
            renderDispatcherHeatmap();
        });
    }
}

function renderDriverLoadTable(container, loads) {
    if (!container) return;

    if (loads.length === 0) {
        container.innerHTML = `<div class="p-4 text-center text-sm text-gray-500">No loads found for the selected driver in this period.</div>`;
        return;
    }
    
    const isDispatcherRoleInTeamMode = appState.auth.user?.role === 'Dispatcher' && appState.rankingMode === 'team';

    container.innerHTML = `
        <div class="p-2 h-full flex flex-col">
            <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 text-center flex-shrink-0">Driver Load Breakdown</h4>
            <div class="relative flex-grow min-h-0">
                <div class="absolute inset-0 overflow-y-auto rounded-lg">
                    <table class="w-full text-xs text-left heatmap-loads-table">
                        <thead class="text-xs text-gray-400 uppercase sticky top-0 bg-gray-900/70 backdrop-blur-sm z-10">
                            <tr>
                                <th style="width: 5%;">#</th>
                                <th style="width: 12%;">PU Date</th>
                                <th style="width: 28%;">Origin</th>
                                <th style="width: 28%;">Destination</th>
                                <th style="width: 12%;">DEL Date</th>
                                <th style="width: 10%;" class="text-right">Rate</th>
                                <th style="width: 10%;" class="text-right">RPM</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${loads.map((load, index) => {
                                const compositeTeamName = getCompositeTeamName(load);
                                const canView = appState.rankingMode === 'team' ? canViewTeam(compositeTeamName) : canViewDispatcher(load.dispatcher);
                                const formatDate = (dateString) => dateString ? new Date(dateString).toLocaleDateString('en-US', {month: '2-digit', day: '2-digit'}) : '-';
                                const rateContent = canView && !isDispatcherRoleInTeamMode ? `$${(load.price || 0).toLocaleString()}` : '-';
                                const rpmContent = canView && !isDispatcherRoleInTeamMode ? `$${(load.rpm_all || 0).toFixed(2)}` : '-';
                                return `
                                    <tr>
                                        <td class="font-bold text-center">${index + 1}</td>
                                        <td>${formatDate(load.pu_date)}</td>
                                        <td>${load.pu_location || '-'}</td>
                                        <td>${load.do_location || '-'}</td>
                                        <td>${formatDate(load.do_date)}</td>
                                        <td class="text-right font-mono text-green-400-pale">${rateContent}</td>
                                        <td class="text-right font-mono text-yellow-400-pale">${rpmContent}</td>
                                    </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

function renderStateBreakdownTable(primarySourceData, comparisonSourceData = []) {
    const container = document.getElementById('dispatcher-heatmap-state-breakdown');
    if (!container) return;
    const dayView = appState.profiles.driverDeepDive.entityModalDayFilter;
    const hasComparison = comparisonSourceData.length > 0;
    const isDispatcherRoleInTeamMode = appState.auth.user?.role === 'Dispatcher' && appState.rankingMode === 'team';

    if (dayView !== 'all') {
        const allLoads = [...primarySourceData, ...comparisonSourceData].sort((a,b) => new Date(a.pu_date) - new Date(b.pu_date));
        if (allLoads.length === 0) {
            container.innerHTML = `<div class="p-4 text-center text-sm text-gray-500">No loads found for the selected day.</div>`;
            return;
        }

        const primaryName = appState.selectedEntity.entityName;

        const getColorClass = (load, column) => {
            let isPrimary = false;
            if (appState.rankingMode === 'team') {
                const compositeName = getCompositeTeamName(load);
                isPrimary = compositeName === primaryName;
            } else {
                 isPrimary = load.dispatcher === primaryName;
            }

            if (!hasComparison) {
                return (column === 'rate') ? 'text-green-400-pale' : (column === 'rpm') ? 'text-yellow-400-pale' : 'text-white';
            }
            return isPrimary ? 'text-green-400-pale' : 'text-red-400-pale';
        };

        container.innerHTML = `
            <div class="p-2 h-full flex flex-col">
                <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 text-center flex-shrink-0">Loads for Selected Day</h4>
                <div class="relative flex-grow min-h-0">
                    <div class="absolute inset-0 overflow-y-auto rounded-lg">
                        <table class="w-full text-xs text-left heatmap-loads-table">
                            <thead class="text-xs text-gray-400 uppercase sticky top-0 bg-gray-900/70 backdrop-blur-sm z-10">
                                <tr>
                                    <th style="width: 12%;">PU Date</th>
                                    <th style="width: 28%;">PU</th>
                                    <th style="width: 28%;">DEL</th>
                                    <th style="width: 12%;">DEL Date</th>
                                    <th style="width: 10%;" class="text-right">Rate</th>
                                    <th style="width: 10%;" class="text-right">RPM</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${allLoads.map(load => {
                                    const formatDate = (dateString) => dateString ? new Date(dateString).toLocaleDateString('en-US', {month: '2-digit', day: '2-digit'}) : '-';
                                    const compositeTeamName = getCompositeTeamName(load);
                                    const canView = appState.rankingMode === 'team' ? canViewTeam(compositeTeamName) : canViewDispatcher(load.dispatcher);
                                    const rateContent = canView && !isDispatcherRoleInTeamMode ? `$${(load.price || 0).toLocaleString()}` : '-';
                                    const rpmContent = canView && !isDispatcherRoleInTeamMode ? `$${(load.rpm_all || 0).toFixed(2)}` : '-';

                                    return `
                                        <tr>
                                            <td class="${getColorClass(load)}">${formatDate(load.pu_date)}</td>
                                            <td class="${getColorClass(load)}">${load.pu_location || '-'}</td>
                                            <td class="${getColorClass(load)}">${load.do_location || '-'}</td>
                                            <td class="${getColorClass(load)}">${formatDate(load.do_date)}</td>
                                            <td class="text-right font-mono ${getColorClass(load, 'rate')}">${rateContent}</td>
                                            <td class="text-right font-mono ${getColorClass(load, 'rpm')}">${rpmContent}</td>
                                        </tr>`;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        return;
    }
    
    const processData = (data) => data.reduce((acc, load) => {
        const stateMatch = (load.pu_location || '').match(/,\s*([A-Z]{2})$/);
        if (!stateMatch) return acc;
        const state = stateMatch[1];
        if (!acc[state]) {
            acc[state] = { loads: 0, totalRate: 0, totalRpm: 0, dispatchers: new Set(), teams: new Set() };
        }
        acc[state].loads++;
        acc[state].totalRate += (load.price || 0);
        acc[state].totalRpm += (load.rpm_all || 0);
        if(load.dispatcher) acc[state].dispatchers.add(load.dispatcher);
        const compositeTeamName = getCompositeTeamName(load);
        if(compositeTeamName) acc[state].teams.add(compositeTeamName);
        return acc;
    }, {});

    const primaryDataByState = processData(primarySourceData);
    const comparisonDataByState = processData(comparisonSourceData);

    const allStates = [...new Set([...Object.keys(primaryDataByState), ...Object.keys(comparisonDataByState)])];

    const tableData = allStates.map(state => {
        const pData = primaryDataByState[state];
        const cData = comparisonDataByState[state];
        
        let canViewPrimary = true;
        if (pData) {
            canViewPrimary = appState.rankingMode === 'team' ? 
                Array.from(pData.teams).some(canViewTeam) : 
                Array.from(pData.dispatchers).some(canViewDispatcher);
        }

        let canViewComparison = true;
        if (cData) {
            canViewComparison = appState.rankingMode === 'team' ?
                Array.from(cData.teams).some(canViewTeam) :
                Array.from(cData.dispatchers).some(canViewDispatcher);
        }

        return {
            state,
            primary: pData ? {
                loads: pData.loads,
                avgRate: canViewPrimary && pData.loads > 0 && !isDispatcherRoleInTeamMode ? pData.totalRate / pData.loads : null,
                avgRpm: canViewPrimary && pData.loads > 0 && !isDispatcherRoleInTeamMode ? pData.totalRpm / pData.loads : null
            } : null,
            comparison: cData ? {
                loads: cData.loads,
                avgRate: canViewComparison && cData.loads > 0 && !isDispatcherRoleInTeamMode ? cData.totalRate / cData.loads : null,
                avgRpm: canViewComparison && cData.loads > 0 && !isDispatcherRoleInTeamMode ? cData.totalRpm / cData.loads : null
            } : null,
            totalLoads: (pData?.loads || 0) + (cData?.loads || 0)
        };
    }).sort((a, b) => b.totalLoads - a.totalLoads);

    let tableHTML;

    if (!hasComparison) {
        tableHTML = `
            <div class="p-2 h-full flex flex-col">
                <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 text-center flex-shrink-0">Breakdown by Pickup State</h4>
                <div class="relative flex-grow min-h-0">
                    <div class="absolute inset-0 overflow-y-auto rounded-lg">
                        <table class="w-full text-xs text-left">
                            <thead class="text-xs text-gray-400 uppercase sticky top-0 bg-gray-900/70 backdrop-blur-sm z-10">
                                <tr>
                                    <th class="py-2 px-2">State</th>
                                    <th class="py-2 px-2 text-right">Loads</th>
                                    <th class="py-2 px-2 text-right">Avg Rate</th>
                                    <th class="py-2 px-2 text-right">Avg RPM</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-800">
                                ${tableData.map(row => {
                                    const pData = row.primary || { loads: '-', avgRate: null, avgRpm: null };
                                    const avgRateText = typeof pData.avgRate === 'number' ? `$${pData.avgRate.toLocaleString(undefined, {maximumFractionDigits: 0})}` : '-';
                                    const avgRpmText = typeof pData.avgRpm === 'number' ? `$${pData.avgRpm.toFixed(2)}` : '-';
                                    return `
                                    <tr class="hover:bg-gray-700/50">
                                        <td class="py-1.5 px-2 font-semibold text-gray-200">${row.state}</td>
                                        <td class="py-1.5 px-2 text-right font-mono text-white">${pData.loads}</td>
                                        <td class="py-1.5 px-2 text-right font-mono text-white">${avgRateText}</td>
                                        <td class="py-1.5 px-2 text-right font-mono text-white">${avgRpmText}</td>
                                    </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    } else {
        tableHTML = `
            <div class="p-2 h-full flex flex-col">
                <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 text-center flex-shrink-0">Breakdown by Pickup State</h4>
                <div class="relative flex-grow min-h-0">
                    <div class="absolute inset-0 overflow-y-auto rounded-lg">
                        <table class="w-full text-xs text-left breakdown-table-compare">
                            <thead class="text-xs text-gray-400 uppercase sticky top-0 bg-gray-900/70 backdrop-blur-sm z-10">
                                <tr>
                                    <th class="state-header">State</th>
                                    <th colspan="2" class="group-header">Loads</th>
                                    <th colspan="2" class="group-header">Avg Rate</th>
                                    <th colspan="2" class="group-header">Avg RPM</th>
                                </tr>
                                <tr>
                                    <th></th>
                                    <th class="sub-header group-start text-green-400-pale">P</th>
                                    <th class="sub-header text-red-400-pale">C</th>
                                    <th class="sub-header group-start text-green-400-pale">P</th>
                                    <th class="sub-header text-red-400-pale">C</th>
                                    <th class="sub-header group-start text-green-400-pale">P</th>
                                    <th class="sub-header text-red-400-pale">C</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-800">
                                ${tableData.map(row => {
                                    const pData = row.primary || {};
                                    const cData = row.comparison || {};
                                    const pAvgRate = typeof pData.avgRate === 'number' ? `$${pData.avgRate.toLocaleString(undefined, {maximumFractionDigits: 0})}` : '-';
                                    const cAvgRate = typeof cData.avgRate === 'number' ? `$${cData.avgRate.toLocaleString(undefined, {maximumFractionDigits: 0})}` : '-';
                                    const pAvgRpm = typeof pData.avgRpm === 'number' ? `$${pData.avgRpm.toFixed(2)}` : '-';
                                    const cAvgRpm = typeof cData.avgRpm === 'number' ? `$${cData.avgRpm.toFixed(2)}` : '-';
                                    return `
                                        <tr class="hover:bg-gray-700/50">
                                            <td class="py-1.5 px-2 font-semibold text-gray-200">${row.state}</td>
                                            <td class="text-center font-mono text-green-400-pale group-start">${pData.loads ?? '-'}</td>
                                            <td class="text-center font-mono text-red-400-pale">${cData.loads ?? '-'}</td>
                                            <td class="group-start text-center font-mono text-green-400-pale">${pAvgRate}</td>
                                            <td class="text-center font-mono text-red-400-pale">${cAvgRate}</td>
                                            <td class="group-start text-center font-mono text-green-400-pale">${pAvgRpm}</td>
                                            <td class="text-center font-mono text-red-400-pale">${cAvgRpm}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }
    container.innerHTML = tableHTML;
}

// This function will be called from the map to trigger the table render
window.showClusterLoadDetails = (loads, clusterName, isComparing) => {
    appState.heatmapSelectedCluster = { loads, clusterName, isComparing };
    renderClusterLoadsTable(loads, clusterName, isComparing);
};

// This function builds and renders the HTML table for the loads in a cluster
function renderClusterLoadsTable(loads, clusterName, isComparing) {
    const container = document.getElementById('dispatcher-heatmap-state-breakdown');
    if (!container) return;

    if (!loads || loads.length === 0) {
        container.innerHTML = `<div class="p-4 text-center text-sm text-gray-500">No loads to display for this cluster.</div>`;
        return;
    }

    const sortedLoads = [...loads].sort((a, b) => new Date(a.pu_date) - new Date(b.pu_date));
    const isDispatcherRoleInTeamMode = appState.auth.user?.role === 'Dispatcher' && appState.rankingMode === 'team';
    const isTeamView = appState.rankingMode === 'team';
    
    container.innerHTML = `
        <div class="p-2 h-full flex flex-col">
            <h4 class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 text-center flex-shrink-0">Loads from ${clusterName}</h4>
            <div class="relative flex-grow min-h-0">
                <div class="absolute inset-0 overflow-y-auto rounded-lg">
                    <table class="w-full text-xs text-left heatmap-loads-table">
                        <thead class="text-xs text-gray-400 uppercase sticky top-0 bg-gray-900/70 backdrop-blur-sm z-10">
                                <tr>
                                    <th style="width: ${isTeamView ? '10%' : '15%'}">Driver</th>
                                    ${isTeamView ? '<th style="width: 10%;">Dispatcher</th>' : ''}
                                    <th style="width: ${isTeamView ? '10%' : '10%'}">PU Date</th>
                                    <th style="width: ${isTeamView ? '15%' : '20%'}">PU</th>
                                    <th style="width: ${isTeamView ? '15%' : '20%'}">DEL</th>
                                    <th style="width: ${isTeamView ? '10%' : '10%'}">DEL Date</th>
                                    <th style="width: 10%;" class="text-center">Rate</th>
                                    <th style="width: 10%;" class="text-center">RPM</th>
                                </tr>
                            </thead>
                           <tbody>
                        ${sortedLoads.map(load => {
                            const baseTextColor = 'text-white';
                            const formatDate = (dateString) => dateString ? new Date(dateString).toLocaleDateString('en-US', {month: '2-digit', day: '2-digit'}) : '-';
                            const compositeTeamName = getCompositeTeamName(load);
                            const canView = appState.rankingMode === 'team' ? canViewTeam(compositeTeamName) : canViewDispatcher(load.dispatcher);
                            const rateContent = canView && !isDispatcherRoleInTeamMode ? `$${(load.price || 0).toLocaleString()}` : '-';
                            const rpmContent = canView && !isDispatcherRoleInTeamMode ? `$${(load.rpm_all || 0).toFixed(2)}` : '-';
                            const dispatcherCell = isTeamView ? `<td class="${baseTextColor}">${load.dispatcher || '-'}</td>` : '';

                            return `
                                <tr>
                                    <td class="${baseTextColor} font-semibold cursor-pointer driver-link" data-driver="${load.driver}">${load.driver || '-'}</td>
                                    ${dispatcherCell}
                                    <td class="${baseTextColor}">${formatDate(load.pu_date)}</td>
                                    <td class="${baseTextColor}">${load.pu_location || '-'}</td>
                                    <td class="${baseTextColor}">${load.do_location || '-'}</td>
                                    <td class="${baseTextColor}">${formatDate(load.do_date)}</td>
                                    <td class="text-right font-mono text-green-400">${rateContent}</td>
                                    <td class="text-right font-mono text-yellow-400">${rpmContent}</td>
                                </tr>`;
                        }).join('')}
                            </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    // Add click listeners to driver names
    container.querySelectorAll('.driver-link').forEach(el => {
        el.addEventListener('click', (e) => {
            const driverName = e.target.dataset.driver;
            if (driverName && driverName !== '-') {
                appState.entityModalHeatmapView = 'driver';
                appState.entityModalHeatmapDriver = driverName;
                renderDispatcherHeatmap();
            }
        });
    });
}
const renderAlertsFeed = () => {
    const container = document.getElementById('wth-loads-table-container');
    if (!container) return;

    // --- 1. Gather Data & Context ---
    const allLoads = appState.profiles.liveData || [];
    const historicalStubs = appState.loads.historicalStubsData || [];
    const overdueLoads = appState.profiles.overdueLoadsData || [];
    const globalDriverStats = appState.profiles.globalDriverStats || new Map();
    const lowRpmThreshold = appState.loads.lowRpmThreshold || 1.65;
    const goodMoveThresholds = appState.loads.goodMoveThresholds;

    const payDateStr = appState.selectedDate;
    if (!payDateStr) {
        container.innerHTML = `<p class="text-gray-400 text-xs p-4 text-center">No date selected.</p>`;
        return;
    }
    const payDate = new Date(payDateStr);
    const workEnd = new Date(payDate);
    workEnd.setUTCDate(payDate.getUTCDate() - 3); 
    workEnd.setUTCHours(23, 59, 59, 999);
    const workStart = new Date(workEnd);
    workStart.setUTCDate(workEnd.getUTCDate() - 6); 
    workStart.setUTCHours(0, 0, 0, 0);

    // --- 2. Permission Helper ---
    const hasAccess = (entityName, entityType = 'dispatcher') => {
        if (!entityName) return false;
        if (isAdmin() || hasPermission(appState.auth.user, PERMISSIONS.VIEW_ALL_TEAMS)) return true;
        if (entityType === 'dispatcher') return canViewDispatcher(entityName);
        if (entityType === 'team') return canViewTeam(entityName);
        return false;
    };

    // --- 3. Build Alerts Array ---
    let alerts = [];
    const hiddenMilesCounts = {}; // Track hidden miles per dispatcher
    const dispatcherTeamMap = {}; // Map dispatcher to team for display

    // > LOADS Logic
    const weeklyLoads = allLoads.filter(l => {
        if (!l.do_date) return false;
        const doDate = new Date(l.do_date);
        return doDate >= workStart && doDate <= workEnd && l.status !== 'Canceled' && l.status !== 'TONU';
    });
    
    const calculateWeeklyGrossLocal = (driverName) => {
        return weeklyLoads.filter(l => l.driver === driverName)
            .reduce((sum, l) => sum + ((parseFloat(l.price) || 0) - (parseFloat(l.cut) || 0)), 0);
    };

    weeklyLoads.forEach(load => {
        if (!hasAccess(load.dispatcher)) return;

        // Capture Team Map
        if (load.dispatcher && load.team) {
            dispatcherTeamMap[load.dispatcher] = load.team;
        }

        // Low RPM
        const rpm = (load.trip_miles > 0) ? (load.price / load.trip_miles) : 0;
        if (rpm > 0 && rpm < lowRpmThreshold) {
            alerts.push({
                priority: 'medium', title: 'Low RPM', type: 'Load', 
                entity: load.driver, dispatcher: load.dispatcher,
                details: `Load #${load.id} (${load.pu_location.split(',')[1]?.trim() || '?'} ➝ ${load.do_location.split(',')[1]?.trim() || '?'})`,
                value: `$${rpm.toFixed(2)}`
            });
        }
        // Bad Moves
        if (load.moved_monday === 'Moved Monday Load') {
            const contract = load.contract_type || 'LOO';
            const threshold = goodMoveThresholds.by_contract[contract] ?? goodMoveThresholds.default;
            const grossWithout = calculateWeeklyGrossLocal(load.driver) - ((parseFloat(load.price) || 0) - (parseFloat(load.cut) || 0));
            
            // Show only if they were ALREADY $1000 over the threshold
            if (grossWithout >= (threshold + 1000)) {
                const overAmount = grossWithout - threshold;
                alerts.push({
                    priority: 'high', title: 'Bad Move', type: 'Load', 
                    entity: load.driver, dispatcher: load.dispatcher,
                    details: `Load #${load.id} (Gross w/o: $${Math.round(grossWithout)}, Over: $${Math.round(overAmount)})`,
                    value: `$${Math.round(grossWithout)}`
                });
            }
        }
        // Hidden Miles Collection
        if (load.hidden_miles === 'Hidden Miles Found!') {
            if (!hiddenMilesCounts[load.dispatcher]) hiddenMilesCounts[load.dispatcher] = 0;
            hiddenMilesCounts[load.dispatcher]++;
        }
    });

    // Process Hidden Miles Aggregation
    Object.entries(hiddenMilesCounts).forEach(([dispatcherName, count]) => {
        if (count > 3) {
            alerts.push({
                priority: 'medium', title: 'Hidden Miles', type: 'Dispatcher',
                entity: dispatcherName, 
                dispatcher: dispatcherTeamMap[dispatcherName] || 'Unknown', // Show Team Name
                details: `Multiple start locations changed in this week.`,
                value: `${count} Loads`
            });
        }
    });

    // > OVERDUE Logic (Global)
    // defined based on the backend script provided
    const openStatuses = ['Assigned', 'At Receiver', 'At Shipper', 'Booked', 'En Route to Receiver', 'Missing Paperwork', 'En Route to Shipper'];

    overdueLoads.forEach(ol => {
        if (!hasAccess(ol.dispatcher)) return;

        // Filter: Only show loads with an "Open" status
        if (!openStatuses.includes(ol.status)) return;

        if (ol.daysPastDO > 3) { 
            const dueDate = ol.deliveryDate ? new Date(ol.deliveryDate).toLocaleDateString('en-US', {month:'numeric', day:'numeric'}) : 'N/A';
            
            // Try to find full load details from live loads just for the location string
            const fullLoad = allLoads.find(l => l.id == ol.loadId); 
            let locString = '';
            if (fullLoad && fullLoad.pu_location && fullLoad.do_location) {
                locString = ` (${fullLoad.pu_location.split(',')[1]?.trim() || '?'} ➝ ${fullLoad.do_location.split(',')[1]?.trim() || '?'})`;
            }

            alerts.push({
                priority: 'high', title: 'Overdue', type: 'Load', 
                entity: ol.driver, dispatcher: ol.dispatcher,
                details: `Load #${ol.loadId}${locString} (Due ${dueDate})`, 
                value: `${ol.daysPastDO} Days`
            });
        }
    });

    // > RETENTION (Dispatcher)
    const stubsThisWeek = historicalStubs.filter(s => s.pay_date && new Date(s.pay_date).toISOString().split('T')[0] === payDateStr);
    const dispStubMap = {};
    stubsThisWeek.forEach(s => {
        if(!dispStubMap[s.stub_dispatcher]) dispStubMap[s.stub_dispatcher] = { active: 0, terminated: 0 };
        const status = (s.retention_status || '').trim();
        if(status === 'Active') dispStubMap[s.stub_dispatcher].active++;
        if(status === 'Terminated') dispStubMap[s.stub_dispatcher].terminated++;
    });
    Object.entries(dispStubMap).forEach(([dispName, counts]) => {
        if (!hasAccess(dispName)) return;
        const total = counts.active + counts.terminated;
        if (total >= 3) {
            const retention = (counts.active / total) * 100;
            if (retention < 45) {
                alerts.push({
                    priority: 'high', title: '4W Retention', type: 'Dispatcher', 
                    entity: dispName, dispatcher: dispName,
                    details: `Retention Critical`, value: `${retention.toFixed(0)}%`
                });
            }
        }
    });

    // > DRIVER STATS (Stubs)
    stubsThisWeek.forEach(stub => {
        const dispName = stub.stub_dispatcher;
        if (!hasAccess(dispName)) return;
        
        if (Math.abs(stub.balance || 0) > 5000) {
            alerts.push({
                priority: 'high', title: 'Balance', type: 'Driver', 
                entity: stub.driver_name, dispatcher: dispName,
                details: `High Negative Balance`, value: `$${Math.abs(stub.balance).toLocaleString()}`
            });
        }
        if (Math.abs(stub.po_deductions || 0) > 2750) {
            alerts.push({
                priority: 'medium', title: 'High PO', type: 'Driver', 
                entity: stub.driver_name, dispatcher: dispName,
                details: `High Deduction`, value: `$${Math.abs(stub.po_deductions).toLocaleString()}`
            });
        }
        // Low Pay History
        const driverHistory = historicalStubs
            .filter(s => s.driver_name === stub.driver_name && new Date(s.pay_date) <= payDate)
            .sort((a,b) => new Date(b.pay_date) - new Date(a.pay_date));
        if (driverHistory.length >= 4) {
            const last4 = driverHistory.slice(0, 4);
            
            // UPDATED: Dynamic threshold based on contract type
            const contract = (stub.contract_type || 'LOO').toUpperCase();
            const threshold = contract === 'OO' ? 1000 : 700;

            if (last4.every(s => (s.net_pay || 0) < threshold)) {
                // Calculate Average
                const avgNet = last4.reduce((sum, s) => sum + (s.net_pay || 0), 0) / 4;
                alerts.push({
                    priority: 'high', title: 'Low Pay', type: 'Driver', 
                    entity: stub.driver_name, dispatcher: dispName,
                    details: `4 Weeks < $${threshold}`, 
                    value: `$${Math.round(avgNet)}` // Show Average
                });
            }
        }
    });

    // > DROP RISK
    if (globalDriverStats.size > 0) {
        globalDriverStats.forEach((stats, driverName) => {
            const relevantStub = stubsThisWeek.find(s => s.driver_name === driverName);
            const relevantLoad = weeklyLoads.find(l => l.driver === driverName);
            const dispName = relevantStub?.stub_dispatcher || relevantLoad?.dispatcher || stats.dispatcher;
            if (dispName && hasAccess(dispName) && stats.risk >= 70) { 
                alerts.push({
                    priority: 'high', title: 'Drop Risk', type: 'Driver', 
                    entity: driverName, dispatcher: dispName,
                    details: `High Probability`, value: `${Math.round(stats.risk)}%`
                });
            }
        });
    }

    // --- 4. Filtering Logic (Title Based) ---
    const filter = appState.alertsFilter || 'all';
    
    // Dynamic Filter Options
    const uniqueTitles = [...new Set(alerts.map(a => a.title))].sort();
    const filterOptions = [{val: 'all', lbl: 'All Alerts'}, ...uniqueTitles.map(t => ({val: t, lbl: t}))];

    const filteredAlerts = alerts.filter(a => {
        if (filter === 'all') return true;
        return a.title === filter;
    });

    const pMap = { high: 3, medium: 2, low: 1 };
    filteredAlerts.sort((a, b) => pMap[b.priority] - pMap[a.priority]);

    // --- 5. Render HTML ---
    
    // Header Filter Logic
    const headerActions = document.querySelector('#performance-tracker-title > div.flex.items-center.space-x-2');
    let filterContainer = document.getElementById('header-alerts-filter-container');
    
    // Create filter container in header if it doesn't exist
    if (!filterContainer && headerActions) {
        filterContainer = document.createElement('div');
        filterContainer.id = 'header-alerts-filter-container';
        filterContainer.className = 'mr-2 flex items-center gap-2'; 
        headerActions.insertBefore(filterContainer, headerActions.firstChild);
    }

    // Populate filter if container exists
    if (filterContainer) {
        filterContainer.classList.remove('hidden');
        
        // Tooltip Content - UPDATED DEFINITIONS
        const infoTooltipContent = `
            <div class='text-left min-w-[220px]'>
                <div class='font-bold mb-2 text-white border-b border-gray-600 pb-1'>Alert Definitions</div>
                <div class='mb-1'><span class='text-red-400 font-bold'>Bad Move:</span> Driver gross (w/o load) is ≥ $1,000 over threshold.</div>
                <div class='mb-1'><span class='text-orange-400 font-bold'>Low Pay:</span> 4-week avg net < $700 (LOO) or < $1,000 (OO).</div>
                <div class='mb-1'><span class='text-purple-400 font-bold'>Hidden Miles:</span> Dispatcher has > 3 loads with start location changes this week.</div>
                <div class='mb-1'><span class='text-red-400 font-bold'>Overdue:</span> Load is > 3 days past delivery date (active only).</div>
                <div class='mb-1'><span class='text-yellow-400 font-bold'>Low RPM:</span> Load RPM is below the set threshold.</div>
                <div class='mb-1'><span class='text-orange-400 font-bold'>Drop Risk:</span> Driver has ≥ 70% risk score.</div>
                <div class='mb-1'><span class='text-pink-400 font-bold'>Balance:</span> Driver negative balance > $5,000.</div>
                <div class='mb-1'><span class='text-pink-400 font-bold'>High PO:</span> PO Deduction > $2,750.</div>
            </div>
        `.replace(/"/g, '&quot;');

        filterContainer.innerHTML = `
            <div class="dispatch-tooltip-trigger cursor-help text-gray-400 hover:text-white transition-colors" data-tooltip-html="${infoTooltipContent}">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
                </svg>
            </div>
            <select id="alerts-filter-select" class="bg-gray-700 text-gray-300 text-[10px] uppercase font-bold border border-gray-600 rounded px-2 py-1 outline-none focus:border-teal-500 cursor-pointer">
                ${filterOptions.map(o => `<option value="${o.val}" ${filter === o.val ? 'selected' : ''}>${o.lbl}</option>`).join('')}
            </select>
        `;
        
        // Attach listener to new select
        const select = document.getElementById('alerts-filter-select');
        select.onchange = (e) => {
            appState.alertsFilter = e.target.value;
            renderAlertsFeed();
        };

        // Attach Tooltip Listeners (Important for the new icon)
        const trigger = filterContainer.querySelector('.dispatch-tooltip-trigger');
        const tooltip = document.getElementById('dispatch-tooltip');
        if(trigger && tooltip) {
            trigger.addEventListener('mouseover', () => {
                tooltip.innerHTML = trigger.dataset.tooltipHtml;
                tooltip.classList.add('visible');
            });
            trigger.addEventListener('mousemove', (e) => {
                 const tooltipRect = tooltip.getBoundingClientRect();
                 tooltip.style.left = `${e.pageX - tooltipRect.width - 15}px`;
                 tooltip.style.top = `${e.pageY + 15}px`;
            });
            trigger.addEventListener('mouseout', () => {
                tooltip.classList.remove('visible');
            });
        }
    }

    // Distinct Colors for Alert Titles
    const alertColors = {
        'Bad Move': 'bg-red-500',
        'Overdue': 'bg-red-500',
        'Low Pay': 'bg-orange-500',
        'Drop Risk': 'bg-orange-500',
        'Hidden Miles': 'bg-purple-500',
        'Low RPM': 'bg-yellow-500',
        '4W Retention': 'bg-blue-500',
        'Balance': 'bg-pink-500',
        'High PO': 'bg-pink-500'
    };

    // Table Content
    let rowsHTML = '';
    if (filteredAlerts.length === 0) {
        rowsHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500 text-xs">No alerts found.</td></tr>`;
    } else {
        rowsHTML = filteredAlerts.map(alert => {
            const barColor = alertColors[alert.title] || (alert.priority === 'high' ? 'bg-red-500' : 'bg-gray-500');
            let typeColor = alert.type === 'Load' ? 'text-blue-300' : (alert.type === 'Driver' ? 'text-purple-300' : 'text-teal-300');
            let entityHTML = `<span class="text-gray-200 font-semibold">${alert.entity}</span>`;
            
            // Driver Popup Logic
            if (alert.type !== 'Dispatcher') {
                entityHTML = `<span class="driver-link cursor-pointer text-blue-300 hover:text-white transition-colors" data-driver-name="${alert.entity}" data-dispatcher-name="${alert.dispatcher}">${alert.entity}</span>`;
            }

            return `
            <tr class="hover:bg-gray-700/50 border-b border-gray-700/50 last:border-0 transition-colors">
                <td class="w-1 p-0"><div class="h-full w-1 ${barColor}"></div></td>
                <td class="px-2 py-1 whitespace-nowrap text-[10px] font-bold uppercase ${typeColor} w-16">${alert.type}</td>
                <td class="px-2 py-1 whitespace-nowrap text-[11px] font-bold text-gray-200 w-24">${alert.title}</td>
                <td class="px-2 py-1 text-[11px] text-gray-400 leading-tight">${alert.details}</td>
                <td class="px-2 py-1 whitespace-nowrap text-[11px] w-32">
                    ${entityHTML}
                    <div class="text-[9px] text-gray-500 uppercase">${alert.dispatcher}</div>
                </td>
                <td class="px-2 py-1 whitespace-nowrap text-right text-[11px] font-mono text-gray-200 w-16">${alert.value}</td>
            </tr>`;
        }).join('');
    }

    // Using scrollable-table-container which sets height max to 300px (consistent with other tables)
    container.innerHTML = `
        <div class="overflow-x-auto scrollable-table-container rounded-lg border border-gray-700 bg-gray-800">
            <table class="min-w-full text-left border-collapse">
                <thead class="bg-gray-900 text-gray-400 text-[9px] uppercase tracking-wider font-bold sticky top-0 z-10 shadow-sm">
                    <tr>
                        <th class="w-1 p-0"></th>
                        <th class="px-2 py-2">Type</th>
                        <th class="px-2 py-2">Alert</th>
                        <th class="px-2 py-2">Details</th>
                        <th class="px-2 py-2">Entity</th>
                        <th class="px-2 py-2 text-right">Value</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-700/50">
                    ${rowsHTML}
                </tbody>
            </table>
        </div>
    `;

    // --- 6. Event Listeners (Delegate to container for driver links) ---
    if (!container._alertsListeners) {
        // No local filter listener needed here anymore as it's moved to header
        
        container.addEventListener('click', (e) => {
            const link = e.target.closest('.driver-link');
            if(link) {
                e.stopPropagation();
                const driverName = link.dataset.driverName;
                if(!driverName) return;
                
                import('../profiles/profiles_ui.js').then(module => {
                    module.initializeProfileEventListeners();
                    
                    if (!appState.profiles.driverDeepDive) appState.profiles.driverDeepDive = {};
                    appState.profiles.driverDeepDive.selectedDriver = driverName;
                    appState.profiles.driverDeepDive.isModalOpen = true;
                    module.renderDriverDeepDiveModal_Profiles();
                });
            }
        });
        container._alertsListeners = true;
    }
};