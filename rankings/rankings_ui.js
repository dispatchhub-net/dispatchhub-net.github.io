import { appState, allColumns, stubsSortConfig, setStubsSortConfig } from '../state.js';
import { coreMetrics, trophySvg, generateAllColumns } from '../config.js';
import { formatPercentage, calculateMedian } from '../utils.js';
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
    appState.visibleKeyMetrics = ['mainCriteria', 'driverHappiness', 'companyHappiness', 'totalDrivers', 'totalDispatchers', 'rpmAll'];
    appState.driverTypeFilter = 'all';
};

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
        const prevField = is4wk ? `${baseId}_4wkAvg` : baseId; // For prev week, use base ID or 4wk avg
        
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
                
                // For previous value, it's more complex, so for now we simplify and accept it might not be perfect
                const prevValues = prevWeekAggregated.map(d => d[prevField] ?? d[baseId]).filter(v => typeof v === 'number');
                prevValue = calculateMedian(prevValues);

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

        th.innerHTML = `${col.id === 'entityName' ? (appState.rankingMode === 'team' ? 'Team Name' : 'Dispatcher Name') : col.label} ${getSortIcon(col.id)}`;
        th.onclick = () => requestSort(col.id);
        tableHead.appendChild(th);
    });

    sortedData.forEach(entity => {
        const tr = document.createElement('tr');
        tr.className = `transition duration-150 ease-in-out cursor-pointer ${ appState.selectedEntity && appState.selectedEntity.entityName === entity.entityName ? 'bg-teal-900 bg-opacity-70' : ''} ${entity._isBelowMinDrivers ? 'opacity-50 grayscale' : ''} relative`;
        tr.onclick = () => handleRowClick(entity);

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

            // --- START OF FIX ---
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
                // Add specific cases for your change columns
                case 'mainCriteria_1wkChange':
                case 'mainCriteria_1wkChange_4wksAgo':
                case 'mainCriteria_4wkAvg_1wkChange':
                case 'mainCriteria_4wkAvg_4wkChange':
                    content = formatChangeValue(value);
                    break;
                // --- END OF FIX ---
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
                            displayValue = `$${value.toFixed(0)}`;
                        } else {
                            displayValue = value.toFixed(0);
                        }
                        content = `<span class="${col.color}${baseMetricId === 'mainCriteria' ? ' font-bold' : ''}">${displayValue}</span>`;
                    } else {
                        content = `<span class="text-gray-300">${(value === null || value === undefined) ? '-' : String(value).includes('.') ? parseFloat(value).toFixed(0) : value}</span>`;
                    }
                    break;
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
    
    const entityLabel = document.getElementById('bump-chart-entity-label');
    if (entityLabel) {
        entityLabel.textContent = appState.rankingMode === 'team' ? 'Teams:' : 'Dispatchers:';
    }

    renderMultiSelectDropdown();

    if (Object.keys(appState.entityColors).length === 0) {
        const baseColors = [
            '#60a5fa', '#f87171', '#4ade80', '#fbbf24', '#a78bfa', '#22d3ee', '#f472b6', '#34d399',
            '#ef4444', '#8b5cf6', '#facc15', '#6b7280', '#ec4899', '#14b8a6', '#c084fc', '#eab300' 
        ];
        const allEntities = [...appState.allDispatcherNames, ...appState.allTeamNames];
        allEntities.forEach((name, index) => {
            appState.entityColors[name] = baseColors[index % baseColors.length];
        });
    }
    drawCharts(); 
};

const renderMultiSelectDropdown = () => {
    const container = document.getElementById('multi-select-dropdown-container');
    if (!container) return;
    container.innerHTML = '';

    const isTeamMode = appState.rankingMode === 'team';
    const options = isTeamMode ? appState.allTeamNames : appState.allDispatcherNames;
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

const renderPerformanceTrackerSections = () => {
    const lowPerformersTableContainer = document.getElementById('low-performers-table-container');
    const performanceDropsTableContainer = document.getElementById('performance-drops-table-container');
    const trendingTableContainer = document.getElementById('trending-table-container');
    const showLowPerformersBtn = document.getElementById('show-low-performers');
    const showPerformanceDropsBtn = document.getElementById('show-performance-drops');
    const showTrendingBtn = document.getElementById('show-trending');

    const buttons = [showLowPerformersBtn, showPerformanceDropsBtn, showTrendingBtn];
    const containers = [lowPerformersTableContainer, performanceDropsTableContainer, trendingTableContainer];
    const views = ['lowPerformers', 'performanceDrops', 'trending'];

    buttons.forEach((btn, index) => {
        if (appState.performanceTrackerView === views[index]) {
            btn.classList.add('bg-teal-600', 'text-white');
            btn.classList.remove('bg-gray-700', 'text-gray-300', 'hover:bg-gray-600');
            containers[index].classList.remove('hidden');
        } else {
            btn.classList.remove('bg-teal-600', 'text-white');
            btn.classList.add('bg-gray-700', 'text-gray-300', 'hover:bg-gray-600');
            containers[index].classList.add('hidden');
        }
    });

    if (appState.performanceTrackerView === 'lowPerformers') {
        renderConsistentlyLowPerformers();
    } else if (appState.performanceTrackerView === 'performanceDrops') {
        renderSignificantPerformanceDrops();
    } else if (appState.performanceTrackerView === 'trending') {
        renderTrendingSection();
    }
};

const renderConsistentlyLowPerformers = () => {
    const lowPerformersTableContainer = document.getElementById('low-performers-table-container');
    
    const consistentlyLowPerformers = calculateConsistentlyLowPerformers();
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

    const performanceDrops = calculatePerformanceDrops();

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

    const { trendingUp, trendingDown } = calculateTrendingData();
    const entityLabel = appState.rankingMode === 'team' ? 'Team' : 'Dispatcher';

    if (trendingUp.length === 0 && trendingDown.length === 0) {
        container.innerHTML = `<p class="text-gray-400 text-sm p-4 text-center">No significant trends detected based on current criteria.</p>`;
        return;
    }

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
                                <th scope="col" class="w-1/3 px-2 py-1 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">Trend</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(entity => `
                                <tr class="bg-gray-800 hover:bg-gray-700">
                                    <td class="px-2 py-1 whitespace-nowrap text-sm font-bold text-gray-200">${entity.name}</td>
                                    <td class="px-2 py-1 whitespace-nowrap text-sm text-gray-300 text-center">${entity.metricLabel}</td>
                                    <td class="px-2 py-1 whitespace-nowrap text-sm ${colorClass} text-center font-semibold">
                                        ${entity.trendPercentage > 0 ? '+' : ''}${entity.trendPercentage.toFixed(1)}%
                                        <span class="text-xs text-gray-400">(${(entity.unit === '$' ? (entity.trendValue > 0 ? '+' : '') + '$' + entity.trendValue.toFixed(2) : (entity.trendValue > 0 ? '+' : '') + (entity.trendValue * 100).toFixed(1) + '%')})</span>
                                    </td>
                                </tr>
                            `).join('')}
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

const renderModalContent = () => {
    const chartContainer = document.getElementById('modal-chart-container');
    const stubsContainer = document.getElementById('modal-stubs-container');
    const legendContainer = document.getElementById('modal-chart-legend');

    chartContainer.style.display = 'none';
    stubsContainer.style.display = 'none';
    d3.select(chartContainer).html('');
    stubsContainer.innerHTML = '';
    d3.select(legendContainer).html('');

    document.querySelectorAll('#modal-chart-switcher button').forEach(btn => {
        const isActive = btn.dataset.view === appState.entityModalChartView;
        if (isActive) {
            btn.classList.add('bg-teal-500', 'text-white');
            btn.classList.remove('hover:bg-gray-600');
        } else {
            btn.classList.remove('bg-teal-500', 'text-white');
            btn.classList.add('hover:bg-gray-600');
        }
    });

    if (!appState.selectedEntity) return;

    if (appState.entityModalChartView === 'stubs') {
        stubsContainer.style.display = 'block';
        renderStubsTable();
    } else {
        chartContainer.style.display = 'block';
        renderIndividualEntityChart();
    }
};

const renderStubsTable = () => {
    const container = document.getElementById('modal-stubs-container');
    const entity = appState.selectedEntity;
    const date = appState.selectedDate;

    if (!entity || !date) {
        container.innerHTML = `<p class="text-center text-gray-400 p-8">Missing data to display stubs.</p>`;
        return;
    }

    if (appState.rankingMode === 'dispatcher') {
        // Use the consolidated stubs directly from the selected entity object
        const driverStubs = entity.stubs || [];

        let filteredDriverStubs = driverStubs.filter(stub => {
            if (appState.driverTypeFilter === 'all') return true;
            return typeof stub.contractType === 'string' && stub.contractType.toLowerCase() === appState.driverTypeFilter;
        });

        if (filteredDriverStubs.length === 0) {
            container.innerHTML = `<p class="text-center text-gray-400 p-8">No individual driver stubs were found for the selected type.</p>`;
            return;
        }

        const headers = [
            { label: 'Driver Name', key: 'driverName', type: 'string' },
            { label: 'Contract Type', key: 'type', type: 'string' },
            { label: 'Net %', key: 'netPercentage', type: 'number' },
            { label: 'Gross %', key: 'driverGross', type: 'number' },
            { label: 'Miles', key: 'miles', type: 'number' },
            { label: 'Driver Happiness', key: 'netDriverGrossPercentage', type: 'number' },
            { label: 'Company Happiness', key: 'cashFlow', type: 'number' },
            { label: 'Criteria', key: 'criteria', type: 'number' },
            { label: 'All Miles', key: 'all_miles', type: 'number' },
            { label: 'Margin ($)', key: 'margin_dollar', type: 'number' },
            { label: 'Driver Gross ($)', key: 'driver_gross', type: 'number' }
        ];

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
                    ${filteredDriverStubs.map(stub => {
                        return `<tr>
                            ${headers.map(h => {
                                const key = h.key;
                                let value = stub[key];
                                let displayValue = (value === null || value === undefined) ? '-' : value;
                            
                                if (key === 'criteria') {
                                    const criteriaValue = ((stub['netDriverGrossPercentage'] || 0) + (stub['cashFlow'] || 0)) / 2;
                                    displayValue = formatPercentage(criteriaValue);
                                } else if (typeof value === 'number') {
                                    if (['driver_gross', 'margin_dollar'].includes(key)) {
                                        displayValue = `$${value.toFixed(0)}`;
                                    } else if (['netPercentage', 'driverGross', 'miles', 'netDriverGrossPercentage', 'cashFlow'].includes(key)) {
                                        displayValue = formatPercentage(value);
                                    } else {
                                        displayValue = value.toFixed(0);
                                    }
                                }
                            
                                return `<td class="px-4 py-2 whitespace-nowrap text-sm text-gray-200">${displayValue}</td>`;
                            }).join('')}
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>`;
        container.innerHTML = tableHTML;

    } else if (appState.rankingMode === 'team') {
        const filteredData = getFilteredDataByDriverType(appState.allHistoricalData);
        const teamDispatchers = [...new Set(filteredData
            .filter(row => row.date.toISOString().split('T')[0] === date && row.dispatcherTeam === entity.entityName)
            .map(row => row.dispatcherName)
        )];

        let dispatcherDetails = teamDispatchers.map(dispatcherName => {
            const tempDispatcherData = processDataForMode(true, dispatcherName);
            return tempDispatcherData.find(d => d.entityName === dispatcherName);
        }).filter(Boolean);

        if (dispatcherDetails.length === 0) {
            container.innerHTML = `<p class="text-center text-gray-400 p-8">No dispatcher data found for this team with the selected driver type.</p>`;
            return;
        }

        const headers = [
            { label: 'Dispatcher', key: 'entityName', type: 'string' },
            { label: 'Drivers', key: 'numDrivers', type: 'number' },
            { label: 'Net %', key: 'pNet_current', type: 'number' },
            { label: 'Gross %', key: 'pDriverGross_current', type: 'number' },
            { label: 'Margin %', key: 'pMargin_current', type: 'number' },
            { label: 'Miles %', key: 'pMileage_current', type: 'number' },
            { label: 'RPM', key: 'rpmAll_current', type: 'number' },
            { label: 'Driver Happiness', key: 'pMainCriteriaNetDriverMargin_current', type: 'number' },
            { label: 'Company Happiness', key: 'pMainCriteria2CashFlow_current', type: 'number' },
            { label: 'Criteria', key: 'mainCriteria_current', type: 'number' }
        ];

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
                    String(aValue).localeCompare(String(aValue)) : 
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
                <tbody class="divide-y divide-gray-700">
                    ${dispatcherDetails.map(d => `
                        <tr>
                            ${headers.map(h => {
                                let value = d[h.key];
                                if (['pNet_current', 'pDriverGross_current', 'pMargin_current', 'pMileage_current', 'pMainCriteriaNetDriverMargin_current', 'pMainCriteria2CashFlow_current', 'mainCriteria_current'].includes(h.key)) {
                                    value = formatPercentage(value);
                                } else if (h.key === 'rpmAll_current') {
                                    value = `$${(value || 0).toFixed(2)}`;
                                }
                                return `<td class="px-4 py-2 whitespace-nowrap text-sm text-gray-200">${value || '-'}</td>`;
                            }).join('')}
                        </tr>`).join('')}
                </tbody>
            </table>`;
        container.innerHTML = tableHTML;
    }
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
    if (!containerNode || containerNode.clientWidth <= 0 || containerNode.clientHeight <= 0) {
        return; // Exit if the container has no dimensions
    }

    if (!appState.selectedEntity) return;

    const chartData = getIndividualEntityChartData(appState.selectedEntity.entityName);

    if (chartData.length === 0) {
        chartContainer.html(`<p class="text-center text-gray-400">No performance data available for this ${appState.rankingMode}.</p>`);
        return;
    }

    const isRankView = appState.entityModalChartView === 'rank';
    const margin = { top: 20, right: 40, bottom: 50, left: 50 };
    const width = chartContainer.node().clientWidth - margin.left - margin.right;
    const height = chartContainer.node().clientHeight - margin.top - margin.bottom;

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

    const activeChartData = chartData.filter(d => d.oneWeekRank !== null || d.fourWeekRank !== null || d.oneWeekCriteria !== null || d.fourWeekCriteria !== null);
    const xScale = d3.scaleTime()
        .domain(d3.extent(activeChartData, d => d.date))
        .range([0, width]);

    let yScaleLeft, yAxisLeft;
    if (isRankView) {
        const allRanks = chartData.flatMap(d => [d.oneWeekRank, d.fourWeekRank]).filter(v => v !== null && !isNaN(v));
        const maxRank = allRanks.length > 0 ? d3.max(allRanks) : 1;
        yScaleLeft = d3.scaleLinear().domain([maxRank + 1, 0.5]).range([height, 0]);
        const tickValues = new Set([1]);
        yScaleLeft.ticks(Math.min(8, maxRank)).forEach(tick => { if (tick > 0) tickValues.add(Math.round(tick)); });
        if (maxRank > 1) tickValues.add(maxRank);
        const finalTickValues = Array.from(tickValues).sort((a,b) => a - b);
        yAxisLeft = d3.axisLeft(yScaleLeft).tickValues(finalTickValues).tickFormat(d3.format('d'));
    } else {
        const allValues = chartData.flatMap(d => [d.oneWeekCriteria, d.fourWeekCriteria]).filter(v => v !== null && !isNaN(v));
        const yMax = allValues.length > 0 ? d3.max(allValues) : 1;
        yScaleLeft = d3.scaleLinear().domain([0, yMax > 0 ? yMax * 1.1 : 0.1]).range([height, 0]);
        yAxisLeft = d3.axisLeft(yScaleLeft).tickFormat(d3.format(".0%"));
    }

    const truckValues = chartData.map(d => d.truckCount).filter(v => v !== null && !isNaN(v));
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

    const line1wk = d3.line().x(d => xScale(d.date)).y(d => yScaleLeft(isRankView ? d.oneWeekRank : d.oneWeekCriteria)).defined(d => (isRankView ? d.oneWeekRank : d.oneWeekCriteria) !== null);
    const line4wk = d3.line().x(d => xScale(d.date)).y(d => yScaleLeft(isRankView ? d.fourWeekRank : d.fourWeekCriteria)).defined(d => (isRankView ? d.fourWeekRank : d.fourWeekCriteria) !== null);
    const truckLine = d3.line().x(d => xScale(d.date)).y(d => yScaleRight(d.truckCount)).defined(d => d.truckCount !== null);

    svg.append('path').datum(chartData).attr('fill', 'none').attr('stroke', '#5EEAD4').attr('stroke-width', 2.5).attr('d', line1wk).attr('class', 'line line-1wk');
    svg.append('path').datum(chartData).attr('fill', 'none').attr('stroke', '#FDBA74').attr('stroke-width', 2.5).attr('d', line4wk).attr('class', 'line line-4wk');
    svg.append('path').datum(chartData).attr('fill', 'none').attr('stroke', '#A78BFA').attr('stroke-width', 1.5).attr('stroke-dasharray', '4 4').attr('d', truckLine).attr('class', 'line line-truck');

    legendContainer.html(`
        <div class="chart-legend-compact">
            <span class="chart-legend-item-compact legend-line-1wk" data-line="line-1wk">
                <span class="chart-legend-color" style="background-color: #5EEAD4;"></span>
                1-Wk ${isRankView ? 'Rank' : '%-ile'}
            </span>
            <span class="chart-legend-item-compact legend-line-4wk" data-line="line-4wk">
                <span class="chart-legend-color" style="background-color: #FDBA74;"></span>
                4-Wk Avg. ${isRankView ? 'Rank' : '%-ile'}
            </span>
            <span class="chart-legend-item-compact legend-line-truck" data-line="line-truck">
                <span class="chart-legend-color-line" style="border-top-color: #A78BFA;"></span>
                Drivers
            </span>
        </div>
    `);

    legendContainer.selectAll('.chart-legend-item-compact')
        .on('mouseover', function() {
            const lineClass = d3.select(this).attr('data-line');
            highlight(lineClass);
        })
        .on('mouseout', unhighlight);

    const tooltip = d3.select("body").selectAll(".d3-tooltip").data([null]).join("div").attr("class", "d3-tooltip");
    const focus = svg.append("g").attr("class", "focus").style("display", "none");
    focus.append("line").attr("class", "x-hover-line").attr("y1", 0).attr("y2", height).attr("stroke", "#9ca3af").attr("stroke-width", 1.5).attr("stroke-dasharray", "3,3");
    svg.append("rect")
        .attr("class", "overlay")
        .attr("width", width)
        .attr("height", height)
        .style("fill", "none")
        .style("pointer-events", "all")
        .on("mouseover", () => { focus.style("display", null); tooltip.style("opacity", 1); })
        .on("mouseout", () => {
            focus.style("display", "none");
            tooltip.style("opacity", 0);
        })
        .on("mousemove", function(event) {
            const bisectDate = d3.bisector(d => d.date).left;
            const x0 = xScale.invert(d3.pointer(event, this)[0]);
            const i = bisectDate(chartData, x0, 1);
            const d0 = chartData[i - 1];
            const d1 = chartData[i];
            const d = (d1 && d0) ? (x0 - d0.date > d1.date - x0 ? d1 : d0) : (d0 || d1);
            if (!d) return;
            focus.select(".x-hover-line").attr("transform", `translate(${xScale(d.date)},0)`);
            svg.selectAll(".dot-1wk, .dot-4wk").attr("r", 4).attr("stroke", "none");
            svg.selectAll(".dot-truck").attr("r", 3).attr("stroke", "none");
            focus.selectAll("circle").remove();
            if ((isRankView ? d.oneWeekRank : d.oneWeekCriteria) !== null) {
                focus.append("circle").attr("cx", xScale(d.date)).attr("cy", yScaleLeft(isRankView ? d.oneWeekRank : d.oneWeekCriteria)).attr("r", 6).attr("fill", "#14b8a6").attr("stroke", "white").attr("stroke-width", 2);
            }
            if ((isRankView ? d.fourWeekRank : d.fourWeekCriteria) !== null) {
                focus.append("circle").attr("cx", xScale(d.date)).attr("cy", yScaleLeft(isRankView ? d.fourWeekRank : d.fourWeekCriteria)).attr("r", 6).attr("fill", "#f97316").attr("stroke", "white").attr("stroke-width", 2);
            }
            if (d.truckCount !== null) {
                focus.append("circle").attr("cx", xScale(d.date)).attr("cy", yScaleRight(d.truckCount)).attr("r", 5).attr("fill", "#8b5cf6").attr("stroke", "white").attr("stroke-width", 1.5);
            }
            let tooltipHtml = `<strong class="font-bold">${d3.timeFormat("%Y-%m-%d")(d.date)}</strong><br/>`;
            if (isRankView) {
                tooltipHtml += `<span class="font-bold" style="color:#5EEAD4">1-Wk Rank:</span> ${d.oneWeekRank !== null ? d.oneWeekRank : 'N/A'}<br/>`;
                tooltipHtml += `<span class="font-bold" style="color:#FDBA74">4-Wk Rank:</span> ${d.fourWeekRank !== null ? d.fourWeekRank : 'N/A'}<br/>`;
            } else {
                tooltipHtml += `<span class="font-bold" style="color:#5EEAD4">1-Wk Crit:</span> ${d.oneWeekCriteria !== null ? formatPercentage(d.oneWeekCriteria) : 'N/A'}<br/>`;
                tooltipHtml += `<span class="font-bold" style="color:#FDBA74">4-Wk Crit:</span> ${d.fourWeekCriteria !== null ? formatPercentage(d.fourWeekCriteria) : 'N/A'}<br/>`;
            }
            tooltipHtml += `<span class="font-bold" style="color:#A78BFA">Drivers:</span> ${d.truckCount !== null ? d.truckCount : 'N/A'}`;
            tooltip.html(tooltipHtml);
            const tooltipWidth = tooltip.node().offsetWidth;
            const tooltipHeight = tooltip.node().offsetHeight;
            let tooltipLeft = event.pageX + 15;
            let tooltipTop = event.pageY - 28;
            if (tooltipLeft + tooltipWidth > window.innerWidth + window.scrollX - 20) {
                tooltipLeft = window.innerWidth + window.scrollX - tooltipWidth - 20;
            }
            if (tooltipTop + tooltipHeight > window.innerHeight + window.scrollY - 20) {
                tooltipTop = window.innerHeight + window.scrollY - tooltipHeight - 20;
            }
            if (tooltipTop < window.scrollY + 10) {
                tooltipTop = window.scrollY + 10;
            }
            if (tooltipLeft < window.scrollX + 10) {
                tooltipLeft = window.scrollX + 10;
            }
            tooltip
                .style("left", tooltipLeft + "px")
                .style("top", tooltipTop + "px");
        });
};

export const renderD3BumpChart = (bumpChartData, selectedEntityNames) => {
    const chartContainer = document.getElementById('bump-chart-container');
    const legendContainer = document.getElementById('bump-chart-legend');
    chartContainer.innerHTML = '';
    legendContainer.innerHTML = '';

    if (!chartContainer || chartContainer.clientWidth <= 0 || chartContainer.clientHeight <= 0) {
        return; // Exit if the container has no dimensions yet
    }

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
        .on('mouseover', function() {
            const entityName = d3.select(this).attr('data-entity');
            highlight(entityName);
        })
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

    let allRanks = [];
    selectedEntityNames.forEach(name => {
        bumpChartData.forEach(d => {
            if (typeof d[name] === 'number' && !isNaN(d[name])) {
                allRanks.push(d[name]);
            }
        });
    });

    const domainX = d3.extent(bumpChartData, d => d.date);
    const domainY = d3.extent(allRanks);

    if (!domainX[0] || !domainX[1] || !domainY[0] || !domainY[1] || isNaN(domainY[0]) || isNaN(domainY[1])) {
        chartContainer.innerHTML = '<p class="text-center text-gray-400">Not enough valid data to render chart for selected criteria/entities.</p>';
        return;
    }

    const maxVisibleRank = Math.max(1, d3.max(allRanks));
    const xScale = d3.scaleTime().domain(domainX).range([0, width]);
    const yScale = d3.scaleLinear().domain([maxVisibleRank + 0.5, 0.5]).range([height, 0]);

    let yTickValues = [];
    const minRankVal = 1;
    const maxRankVal = maxVisibleRank;
    const desiredTotalTicks = 5;

    if (minRankVal <= maxRankVal) {
        yTickValues.push(minRankVal);
        if (maxRankVal !== minRankVal) {
            yTickValues.push(maxRankVal);
        }
    }

    if (maxRankVal > minRankVal && desiredTotalTicks > yTickValues.length) {
        const numToAdd = desiredTotalTicks - yTickValues.length;
        if (numToAdd > 0) {
            const stepSize = Math.max(1, Math.floor((maxRankVal - minRankVal) / (numToAdd + 1)));
            for (let i = 1; i <= numToAdd; i++) {
                const candidate = minRankVal + i * stepSize;
                if (candidate > minRankVal && candidate < maxRankVal) {
                    const isClose = yTickValues.some(existingTick => Math.abs(existingTick - candidate) < stepSize / 2);
                    if (!isClose) {
                        yTickValues.push(candidate);
                    }
                }
            }
        }
    }
    yTickValues = [...new Set(yTickValues)].sort((a, b) => a - b).map(Math.round);

    let xTickValues = [];
    if (bumpChartData.length > 0) {
        const firstDate = bumpChartData[0].date;
        const lastDate = bumpChartData[bumpChartData.length - 1].date;
        xTickValues.push(firstDate);

        const numDates = bumpChartData.length;
        const desiredIntermediateDates = 4;

        if (numDates > 2) {
            const totalDays = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);
            const idealIntervalDays = totalDays / (desiredIntermediateDates);

            for (let i = 1; i <= desiredIntermediateDates; i++) {
                const dateCandidate = new Date(firstDate.getTime() + i * idealIntervalDays * (1000 * 60 * 60 * 24));
                let closestDate = bumpChartData.reduce((prev, curr) => {
                    return (Math.abs(curr.date.getTime() - dateCandidate.getTime()) < Math.abs(prev.date.getTime() - dateCandidate.getTime()) ? curr : prev);
                }).date;
                if (!xTickValues.some(d => d.getTime() === closestDate.getTime()) && closestDate.getTime() !== lastDate.getTime()) {
                    xTickValues.push(closestDate);
                }
            }
        }
        if (lastDate.getTime() !== firstDate.getTime()) {
            xTickValues.push(lastDate);
        }
    }
    xTickValues = [...new Set(xTickValues)].sort((a,b) => a.getTime() - b.getTime());

    const xAxis = d3.axisBottom(xScale).tickValues(xTickValues).tickFormat(d3.timeFormat("%Y-%m-%d")).tickSizeOuter(0);
    const yAxis = d3.axisLeft(yScale).tickValues(yTickValues).tickSizeOuter(0).tickFormat(d3.format("d"));

    svg.append('g').attr('transform', `translate(0,${height})`).call(xAxis).selectAll('text').style('fill', '#a0aec0').style('font-size', '12px').style("text-anchor", "middle");
    svg.append('g').call(yAxis).selectAll('text').style('fill', '#a0aec0').style('font-size', '12px');
    svg.append('g').attr('class', 'grid').call(d3.axisLeft(yScale).tickValues(yTickValues).tickSize(-width).tickFormat('')).select('.domain').remove();
    svg.selectAll('.grid .tick line').attr('stroke', '#4a5568').attr('stroke-dasharray', '3 3');

    selectedEntityNames.forEach(name => {
        const line = d3.line()
            .x(d => xScale(d.date))
            .y(d => yScale(d[name]))
            .defined(d => d[name] !== undefined && d[name] !== null)
            .curve(d3.curveMonotoneX);

        svg.append('path')
            .datum(bumpChartData)
            .attr('fill', 'none')
            .attr('stroke', appState.entityColors[name] || '#ccc')
            .attr('stroke-width', 2.5)
            .attr('d', line)
            .attr('class', `entity-line line-${name.replace(/\s/g, '-')}`);

        svg.selectAll(`circle.dot-${name.replace(/\s/g, '-')}`)
            .data(bumpChartData.filter(d => typeof d[name] === 'number' && !isNaN(d[name])))
            .join("circle")
            .attr("class", `entity-dot dot-${name.replace(/\s/g, '-')}`)
            .attr("r", 4)
            .attr("cx", d => xScale(d.date))
            .attr("cy", d => yScale(d[name]))
            .attr("fill", appState.entityColors[name] || '#ccc');
    });
    const focus = svg.append("g")
                .attr("class", "focus")
                .style("display", "none");

            focus.append("line")
                .attr("class", "x-hover-line hover-line")
                .attr("y1", 0)
                .attr("y2", height)
                .attr("stroke", "#9ca3af")
                .attr("stroke-width", 2);

                const tooltip = d3.select("body").selectAll(".d3-tooltip").data([null]).join("div").attr("class", "d3-tooltip");

            svg.append("rect")
                .attr("class", "overlay")
                .attr("width", width)
                .attr("height", height)
                .attr("fill", "transparent")
                .on("mouseover", () => { focus.style("display", null); tooltip.style("opacity", 1); })
                .on("mouseout", () => {
                    focus.style("display", "none");
                    tooltip.style("opacity", 0);
                    selectedEntityNames.forEach(name => {
                        svg.selectAll(`circle.dot-${name.replace(/\s/g, '-')}`)
                            .attr("r", 4)
                            .attr("stroke", "none");
                    });
                })
                .on("mousemove", function(event) {
                    const x0 = xScale.invert(d3.pointer(event)[0]);
                    const bisectDate = d3.bisector(p => p.date.getTime()).left;
                    const i = bisectDate(bumpChartData, x0, 1);

                    const d0 = i > 0 ? bumpChartData[i - 1] : null;
                    const d1 = i < bumpChartData.length ? bumpChartData[i] : null;

                    let d;
                    if (d0 && d1) {
                        d = x0 - d0.date.getTime() > d1.date.getTime() - x0 ? d1 : d0;
                    } else if (d0) {
                        d = d0;
                    } else if (d1) {
                        d = d1;
                    } else {
                        return;
                    }

                    if (!d || !d.date) return;

                    focus.select(".x-hover-line")
                        .attr("transform", `translate(${xScale(d.date)},0)`);

                    selectedEntityNames.forEach(name => {
                        svg.selectAll(`circle.dot-${name.replace(/\s/g, '-')}`)
                            .attr("r", 4)
                            .attr("stroke", "none");
                    });

                    selectedEntityNames.forEach(name => {
                        svg.selectAll(`circle.dot-${name.replace(/\s/g, '-')}`).filter(p => p.date.getTime() === d.date.getTime())
                            .attr("r", 8)
                            .attr("stroke", "white")
                            .attr("stroke-width", 2);
                    });

                    let tooltipHtml = `<strong>Date:</strong> ${d3.timeFormat("%Y-%m-%d")(d.date)}<br/>`;
                    selectedEntityNames.forEach(name => {
                        const rank = d[name];
                        if (rank !== undefined && rank !== null) {
                            tooltipHtml += `<span style="color:${appState.entityColors[name]}">${name}</span>: Rank ${rank}<br/>`;
                        }
                    });

                    tooltip
                        .html(tooltipHtml);

                    const tooltipWidth = tooltip.node().offsetWidth;
                    const tooltipHeight = tooltip.node().offsetHeight;

                    let tooltipLeft = event.pageX + 15;
                    let tooltipTop = event.pageY - 28;

                    if (tooltipLeft + tooltipWidth > window.innerWidth + window.scrollX - 20) {
                        tooltipLeft = window.innerWidth + window.scrollX - tooltipWidth - 20;
                    }
                    if (tooltipTop + tooltipHeight > window.innerHeight + window.scrollY - 20) {
                        tooltipTop = window.innerHeight + window.scrollY - tooltipHeight - 20;
                    }
                    if (tooltipTop < window.scrollY + 10) {
                        tooltipTop = window.scrollY + 10;
                    }
                    if (tooltipLeft < window.scrollX + 10) {
                        tooltipLeft = window.scrollX + 10;
                    }

                    tooltip
                        .style("left", tooltipLeft + "px")
                        .style("top", tooltipTop + "px");
                });
};

// --- Event Handlers & State Changers ---

export function handleRowClick(entity) {
    appState.selectedEntity = entity;
    appState.isEntityModalOpen = true;
    appState.entityModalChartView = 'percentile';
    renderUI();
}

export function handleCloseEntityModal() {
    appState.isEntityModalOpen = false;
    appState.selectedEntity = null;
    d3.select(".d3-tooltip").style("opacity", 0);
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

    const defaultViewItem = createViewListItem('Default View', false);
    savedViewsList.appendChild(defaultViewItem);

    viewOrder.forEach(viewName => {
        const viewItem = createViewListItem(viewName, true);
        savedViewsList.appendChild(viewItem);
    });
};