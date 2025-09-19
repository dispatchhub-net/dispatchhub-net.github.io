// DISPATCH TESTER/state.js
import { generateAllColumns } from './config.js';

// Initialize allColumns from config. This can be modified by user actions (reordering).
export let allColumns = generateAllColumns();

// Variables to store the ID of the column or view being dragged.
export let draggedColumnId = null;
export let draggedViewName = null;

// This keeps track of the sorting for the stubs table in the modal.
// It's kept separate from the main appState to not interfere with main table sorting.
export let stubsSortConfig = { key: 'criteria', direction: 'descending' };

// The main application state object.
export let appState = {
    // MODIFIED: Default view is now more specific
    currentView: 'rankings', // 'rankings', 'loads-table', 'loads-analytics', etc.
    isRefreshing: false, // To track background refresh status
    lastRefreshed: null, // To store the timestamp of the last successful refresh
    rankingMode: 'dispatcher', // 'dispatcher' or 'team'
    data: [],
    sortConfig: { key: 'rank', direction: 'ascending' },
    selectedDate: '',
    selectedEntity: null, // Generic for dispatcher or team
    isEntityModalOpen: false, // Generic modal state
    entityModalChartView: 'percentile', // 'percentile' or 'rank' or 'stubs'
    isMainCriteriaModalOpen: false,
    isPerformanceTrackerModalOpen: false,
    isDisplaySettingsModalOpen: false,
    expandedDispatcher: null, // NEW: Tracks the dispatcher whose drivers are shown in the team modal
    tableMaxHeight: 500,
    tableGroupColors: {},
    allHistoricalData: [],
    loading: true,
    error: null,
    selectedBumpEntities: [], // Can hold dispatcher or team names
    bumpMetric: 'mainCriteria',
    weeksBack: 12,
    deviationMetric: 'mainCriteria_4wkAvg',
    deviationThreshold: 20,
    dropHistoryLookback: 'specificWeeks',
    dropHistorySpecificWeeks: 8,
    lowPerformanceMetric: 'rpmAll',
    minLowDaysThreshold: 40,
    lowPerformerThreshold: 30,
    lowPerfHistoryLookback: 'allTime',
    lowPerfHistorySpecificWeeks: 4,
    allDispatcherNames: [],
    allTeamNames: [],
    entityColors: {},
    visibleColumns: new Map(),
    performanceTrackerView: 'lowPerformers',
    filters: [],
    minDriverSetting: { type: 'numDrivers', value: 3 },
    precomputedDispatcher4WkAverages: {},
    precomputedTeam4WkAverages: {},
    trendAnalysisMetric: 'overall',
    trendOlderPeriod: 8,
    trendRecentPeriod: 4,
    trendSignificanceThreshold: 10,
    trendMinOlderStubs: 4,
    trendMinRecentStubs: 2,
    precomputationCache: {
        dispatcher: {}, // Cache for dispatcher mode (ALL, OO, LOO)
        team: {}        // Cache for team mode (ALL, OO, LOO)
    },
    unfilteredRanks: new Map(), // For stable ranking in tracker
    visibleKeyMetrics: [
        'mainCriteria', 'driverHappiness', 'companyHappiness', 'totalDrivers', 'totalDispatchers', 'rpmAll'
    ],
    driverTypeFilter: 'all', // 'all', 'oo', or 'loo'
    enableHeatmap: false, // Control for heatmap feature
    pinnedLeftColumns: ['rank', 'entityName', 'dispatcherTeam'],
    pinnedRightColumns: ['mainCriteria_current', 'mainCriteria_4wkAvg'],

    // --- NEW: Comparison State ---
    comparisonEntity: null, // Stores the entity object for comparison
    isCompareDropdownOpen: false, // Toggles the comparison dropdown
    chartLineVisibility: new Map(), // Tracks visibility of chart lines in the modal

    // --- START ADDITION FOR PROFILES ---
    // --- START ADDITION FOR PROFILES ---
    profiles: {
        fleetHealthCache: {},
        liveData: [],
        liveDriverCountData: [],
        currentTeamData: null,
        selectedTeam: 'SMT',
        isKpiSettingsOpen: false,
        selectedDispatcherId: null,
        contractTypeFilter: 'all',
        isContractTypeFilterOpen: false,
        selectedCompany: 'All Companies',
        isCompanyFilterOpen: false,
        selectedFranchise: 'All Franchises', // NEW
        isFranchiseFilterOpen: false, // NEW
        selectedWeek: 'live',
        isWeekSelectorOpen: false,
        activeDetails: {
            dispatcherId: null,
            metricId: null
        },
        driverFilters: {
            isFilterModalOpen: false,
            activeFilters: [], // The currently applied, potentially unsaved, filters
            filterLogic: 'AND',
            isSaveModalOpen: false, // To control the new small modal for saving
            filterToEdit: null, // To hold a filter when editing
        },
        savedDriverFilters: [ // Array to hold saved filter objects
            { id: 'all_drivers', name: 'All Drivers', isDefault: true, criteria: [], logic: 'AND', color: '#374151' }
        ],
        activeSavedFilterId: 'all_drivers', // The ID of the currently active saved filter
        isDriverSettingsModalOpen: false,
        driverDeepDive: {
            isModalOpen: false,
            selectedDriver: null,
            chartView: 'net_pay'
        },
        // --- FIX START: Add a place to store the master list of all processed dispatchers ---
        allProcessedDispatchers: [],
        // --- FIX END ---
        kpiSettings: {
            allKpis: [
                { id: 'totalGross', label: 'Total Weekly Gross' },
                { id: 'teamRpm', label: 'Team RPM (All)' },
                { id: 'teamMargin', label: 'Team Margin ($)' },
                { id: 'activeTrucks', label: 'Active Trucks' },
                { id: 'medianDropRisk', label: 'Median Drop Risk' },
                { id: 'balance', label: 'Total Balance' },
                { id: 'medianCompliance', label: 'Median Compliance %' },
                { id: 'medianWellness', label: 'Median Wellness %' },
                { id: 'dispatchers', label: 'Dispatchers' },
                { id: 'canceledLoads', label: 'Canceled Loads' },
            ],
            visibleKpiIds: [
                'totalGross', 'teamMargin', 'teamRpm', 'activeTrucks', 'medianDropRisk', 'balance', 'medianCompliance'
            ]
        },
        dispatchTable: {
            sortConfig: { key: 'complianceScore', direction: 'ascending' },
            columnOrder: [
                'name', 'company', 'team', 'allTrucks', 'ooTrucks', 'looTrucks',
                'dryvan', 'reefer', 'flatbed',
                'rank1w', 'rank4w', 'goodMoves',
                'badMoves', 'hiddenMiles', 'lowRpm', 'newStarts', 'wellness', 'canceled', 'complianceScore'
            ],
            visibleColumnIds: [
                'name', 'company', 'allTrucks', 'ooTrucks', 'looTrucks',
                'rank1w', 'rank4w', 'goodMoves', 'badMoves', 'hiddenMiles', 
                'lowRpm', 'newStarts', 'wellness', 'complianceScore'
            ],
            pinnedLeftColumns: ['name'],
            pinnedRightColumns: ['complianceScore'],
            draggedColumnId: null,
        },
        driverTable: {
            sortConfig: { key: 'risk', direction: 'descending' }
        },
        thresholdSettings: {
            isModalOpen: false,
            lowRpm: {
                default: 1.5,
                by_contract: { "LOO": 1.5, "OO": 1.6 }
            },
            goodMove: {
                default: 7000,
                by_contract: { "OO": 5500, "LOO": 6500 }
            }
        },
        complianceSettings: {
            isModalOpen: false,
            weights: {
                goodMoves: 10, badMoves: 35, hiddenMiles: 25, lowRpm: 10, wellness: 20,
            }
        },
        driverHealthSettings: {
            activeSettingTab: 'highTolls',
            isModalOpen: false,
            weights: {
                highTolls: 5, dispatcherHopper: 5, lowRpm: 15, lowGross: 15, lowNet: 25, heavyLoads: 10, negative: 25,
            },
            flags: {
                highTolls: {
                    enabled: true, label: 'High Tolls', color: 'green',
                    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /></svg>',
                    lookback: { type: 'weeks', value: 8 }, thresholds: { default: 30, by_contract: {} }, minStubs: 4
                },
                dispatcherHopper: {
                    enabled: true, label: 'Hopper', color: 'purple',
                    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>',
                    lookback: { type: 'weeks', value: 12 }, thresholds: { default: 3, by_contract: {} }
                },
                lowRpm: {
                    enabled: true, label: 'Low RPM', color: 'gray',
                    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 014.306 6.43l.776 2.898m0 0l3.182-5.511m-3.182 5.51l-5.511-3.181" /></svg>',
                    lookback: { type: 'weeks', value: 10 }, thresholds: { default: 1.80, by_contract: {"LOO": 1.75} }, minPercentageOfStubs: 40, minStubs: 4
                },
                lowGross: {
                    enabled: true, label: 'Low Gross', color: 'red',
                    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 11.21 12.768 11 12 11c-.768 0-1.536.21-2.121.782L9 12M12 6v12" /></svg>',
                    lookback: { type: 'weeks', value: 10 }, thresholds: { default: 5000, by_contract: {"LOO": 6000} }, minPercentageOfStubs: 50, minStubs: 4
                },
                lowNet: {
                    enabled: true, label: 'Low Net', color: 'orange',
                    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 11.21 12.768 11 12 11c-.768 0-1.536.21-2.121.782L9 12m-3 0a9 9 0 1118 0 9 9 0 01-18 0z" /></svg>',
                    lookback: { type: 'weeks', value: 10 }, thresholds: { default: 1000, by_contract: {"OO": 2000} }, minPercentageOfStubs: 50, minStubs: 4
                },
                heavyLoads: {
                    enabled: true, label: 'Heavy Loads', color: 'blue',
                    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.096.428m3.095 2.074A5.983 5.983 0 0118.75 20.25m-13.5-14.78A48.416 48.416 0 0112 4.5c2.291 0 4.545.16 6.75.47m-13.5 0c-1.01.143-2.01.317-3 .52m3-.52l-2.62 10.726c-.122.499.106 1.028.589 1.202a5.989 5.989 0 002.096.428m-3.095 2.074A5.983 5.983 0 005.25 20.25" /></svg>',
                    lookback: { type: 'weeks', value: 10 }, thresholds: { default: 40000, by_contract: {} }, minLoads: 8
                },
                negative: {
                    enabled: true, label: 'Balance', color: 'red',
                    icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
                    thresholds: { default: 3000, by_contract: {"OO": 2000} }, minStubs: 6
                }
            }
        },
        tempDriverHealthSettings: null,
    },

    liveDriverFlagsCache: {},

     // --- START ADDITION FOR LOADS ---
     loads: {
        data: [],
        spreadsheetTimezone: 'UTC',
        movedLoadThreshold: 800,
        notClosedDaysThreshold: 7,
        lowRpmThreshold: 1.65,
        goodMoveThresholds: {
            default: 6000,
            by_contract: {
                "MCLOO": 6500,
                "OO": 5500,
                "LOO": 6500,
                "CPM": 6500,
                "LPOO": 6500,
                "POG": 6500
            }
        },
        flagTypes: [
            { id: 'new_start', text: 'New Start' },
            { id: 'moved', text: 'Moved' },
            { id: 'mondays_moved', text: 'Mon. Moved' },
            { id: 'bad_move', text: 'Bad Move' },
            { id: 'good_move', text: 'Good Move' },
            { id: 'hidden_miles', text: 'Hidden Mileage' },
            { id: 'not_closed', text: 'Not Closed' },
            { id: 'low_rpm', text: 'Low RPM' }
        ],
        contractTypes: [
            { id: 'OO', text: 'OO' },
            { id: 'LOO', text: 'LOO' },
            { id: 'MCLOO', text: 'MCLOO' },
            { id: 'POG', text: 'POG' },
            { id: 'CPM', text: 'CPM' },
            { id: 'LPOO', text: 'LPOO' }
        ],
        visibleFilterIds: ['moved_loads', 'late_assign', 'low_rpm', 'hidden_miles', 'not_closed', 'mondays_moved_loads', 'new_start'],
        isSettingsModalOpen: false,
        isCustomFilterModalOpen: false,
        isFilterVisibilityDropdownOpen: false,
        isColumnDropdownOpen: false,
        editingFilterId: null,
        analyticsDashboardView: 'performance',
        analyticsContextualView: 'welcome',
        mapAMode: 'cluster', // 'state' or 'cluster' for the PRIMARY map
        mapAMetric: 'rpm',   // 'volume' or 'rpm' for the PRIMARY map
        mapBMode: 'cluster', // 'state' or 'cluster'
        mapBMetric: 'rpm',   // 'volume' or 'rpm'
        mapAClusterSize: 2.5,
        mapBClusterSize: 2.5,
        mapADirection: 'outbound', // 'outbound' or 'inbound'
        mapBDirection: 'outbound', // 'outbound' or 'inbound'
        isMapAFilterOpen: false,
        isMapBFilterOpen: false,
        mapAStartDate: '',
        mapAEndDate: '',
        mapBStartDate: '',
        mapBEndDate: '',

        /// --- ADDED FOR STUBS DEEP DIVE ---
        isStubsModalOpen: false,
        selectedDriverForModal: null,
        historicalStubsData: [], // <-- To store the new historical data
        stubsModalChartView: 'net_pay', // <-- To track the selected chart metric

        mapBEndDate: '',
        deepDiveSelection: null,



        // --- START: MODIFIED/NEW PROPERTIES ---
        activeFilterId: 'moved_loads',
        savedFilters: [ // "Moved Loads" is now a single filter
            { id: 'moved_loads', name: 'Moved Loads', color: 'red', criteria: [] },
            { id: 'late_assign', name: 'All Loads', color: 'orange', criteria: [] }, 
            { id: 'low_rpm', name: 'Low RPM Loads', color: 'yellow', criteria: [] },
            { id: 'hidden_miles', name: 'Hidden Mileage', color: 'purple', criteria: [] },
            { id: 'not_closed', name: 'Not Closed Loads', color: 'green', criteria: [] },
            // NEW: Added Monday's Moved Loads filter
            { id: 'mondays_moved_loads', name: "Monday's Moved Loads", color: 'blue', criteria: [] },
            // NEW: Added NEW START filter
            { id: 'new_start', name: 'New Starts', color: 'white', criteria: [] },
        ],
        // MODIFIED: Added 'mondays_moved_loads'
        filterOrder: ['moved_loads', 'late_assign', 'low_rpm', 'hidden_miles', 'not_closed', 'mondays_moved_loads', 'new_start'],
        draggedFilterId: null,
        loadsInitialized: false,

        // New properties for table management
        sortConfig: { key: 'id', direction: 'descending' },
        // --- FIND AND REPLACE THESE TWO PROPERTIES ---
        columnOrder: [
            'id', 'contract_type','gross_total', 'pu_date', 'pu_location', 'do_location', 
            'do_date', 'trip_miles', 'status', 'driver', 'dispatcher', 'team', 'flags',
            // --- Hidden by default ---
            'start_location','status_modified_dt', 'delivered_at', 'weight', 'commodity', 'load_type', 'pu_type', 'do_type',
            'fuel_surcharge', 'layover_amount', 'detention_amount', 'cut', 'expected_fuel_cost','expected_tolls','truck_days_in_status','driver_days_in_status','price','rpm','deadhead_miles'
        ],
        visibleColumnIds: [
            'id', 'contract_type','gross_total', 'pu_date', 'pu_location', 'do_location', 
            'do_date', 'trip_miles', 'status', 'driver', 'dispatcher', 'team', 'flags',
        ],
        draggedColumnId: null,
        compactFlags: false,
        currentPage: 1,
        rowsPerPage: 25, // You can adjust this number
        searchColumn: 'all',
        movedLoadsSummaryView: 'all',

        
    },
};

// Functions to update the drag-and-drop state.
export function setDraggedColumnId(id) {
    draggedColumnId = id;
}

export function setDraggedViewName(name) {
    draggedViewName = name;
}

export function setStubsSortConfig(config) {
    stubsSortConfig = config;
}

// Add this new state variable for the main stubs table
export let mainStubsSortConfig = { key: 'totalPrice', direction: 'descending' };

// Add this function to update it
export function setMainStubsSortConfig(config) {
    mainStubsSortConfig = config;
}

// --- START ADDITION FOR LOADS ---
export function setDraggedLoadsFilterId(id) {
    appState.loads.draggedFilterId = id;
}

export function setEditingLoadsFilterId(id) {
    appState.loads.editingFilterId = id;
}

export function setLoadsSettingsModalOpen(isOpen) {
    appState.loads.isSettingsModalOpen = isOpen;
}

export function setLoadsCustomFilterModalOpen(isOpen) {
    appState.loads.isCustomFilterModalOpen = isOpen;
}

export function updateLoadsFilterOrder(newOrder) {
    appState.loads.filterOrder = newOrder;
}

export function addOrUpdateLoadsFilter(filter) {
    const index = appState.loads.savedFilters.findIndex(f => f.id === filter.id);
    if (index > -1) {
        appState.loads.savedFilters[index] = filter;
    } else {
        appState.loads.savedFilters.push(filter);
        if (!appState.loads.filterOrder.includes(filter.id)) {
            appState.loads.filterOrder.push(filter.id);
        }
        appState.loads.visibleFilterIds.push(filter.id);
    }
}

export function deleteLoadsFilter(id) {
    appState.loads.savedFilters = appState.loads.savedFilters.filter(f => f.id !== id);
    appState.loads.filterOrder = appState.loads.filterOrder.filter(fId => fId !== id);
}
