import { hasPermission, PERMISSIONS} from '../permissions.js';
import { appState } from '../state.js';
import { calculateMedian, getPayrollWeekDateRange, showSavingIndicator, hideSavingIndicator, formatPercentage } from '../utils.js';
import { getFilteredDataByDriverType, calculateFourWeekAverageDataForDate, getTeamRankHistory, getCompanyOrAllTeamsCriteriaHistory } from '../rankings/rankings_api.js';
import { canViewTeam, isAdmin, canViewSnapshot, updateFleetHealthSettings } from '../auth.js';
import { 
    calculateKpiData, 
    renderProfileHeader, 
    renderKpiSettingsDropdown, 
    getEnrichedStubs,
    getProfilePayrollWeek,
    getRankingDateForProfileWeek,
    getChangeDisplay_Profiles,
    renderProfileWeekSelector,
    calculateHistoricalRetention,
    calculateLiveRetention,
    renderComplianceHistoryChart, 
    renderRetentionHistoryChart,
    renderTrailerDropsHistoryChart
} from './profiles_kpi.js';

const debounce = (func, delay) => {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
};


/**
 * Finds the corresponding Thursday rankings date for a given profiles payroll week.
 * @param {number} weeksAgo - 0 for the current/live week, 1 for last week, etc.
 * @param {string[]} allHistoricalDates - An array of all available ranking dates.
 * @returns {string|null} The matching YYYY-MM-DD date string, or null if not found.
 */


/**
 * Calculates 1-week and 4-week ranks for a given list of dispatchers for a specific period.
 * @param {string} selectedWeekId - The week identifier (e.g., 'live', 'week_1').
 * @param {string} driverTypeFilter - The active driver type filter ('all', 'oo', 'loo').
 * @returns {Map<string, {rank1w: number|null, rank4w: number|null}>} A map of dispatcher names to their ranks.
 */
function calculateDispatcherRanksForPeriod(selectedWeekId, driverTypeFilter) {
    const { allHistoricalData } = appState;
    const ranks = new Map();

    const historicalDates = [...new Set(allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const weeksAgo = selectedWeekId === 'live' ? 0 : parseInt(selectedWeekId.replace('week_', ''), 10);
    
    const targetDateString = getRankingDateForProfileWeek(weeksAgo, historicalDates);

    if (!targetDateString) return ranks;

    const originalDriverType = appState.driverTypeFilter;
    appState.driverTypeFilter = driverTypeFilter;

    const dataFor1W = getFilteredDataByDriverType(allHistoricalData.filter(d => d.date.toISOString().split('T')[0] === targetDateString));
    const ranked1W = dataFor1W
        .filter(d => d.mainCriteria != null)
        .sort((a, b) => b.mainCriteria - a.mainCriteria);
    ranked1W.forEach((dispatcher, index) => {
        const name = dispatcher.dispatcherName;
        if (!ranks.has(name)) ranks.set(name, { rank1w: null, rank4w: null });
        ranks.get(name).rank1w = index + 1;
    });

    const fourWeekAverages = calculateFourWeekAverageDataForDate(targetDateString, 'dispatcher');
    const ranked4W = Object.values(fourWeekAverages)
        .filter(d => d.mainCriteria != null)
        .sort((a, b) => b.mainCriteria - a.mainCriteria);
    ranked4W.forEach((dispatcher, index) => {
        const name = dispatcher.entityName;
        if (!ranks.has(name)) ranks.set(name, { rank1w: null, rank4w: null });
        ranks.get(name).rank4w = index + 1;
    });

    appState.driverTypeFilter = originalDriverType;
    return ranks;
}

function calculateLiveFlagsForDriver(driverName, historicalStubs, allDriversData) {
    const flags = [];
    const settings = appState.profiles.driverHealthSettings.flags;

    const driverStubs = historicalStubs
        .filter(s => s.driver_name === driverName)
        .sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date));

    const driverLoads = appState.profiles.liveData.filter(l => l.driver === driverName);

    if (driverStubs.length === 0 && driverLoads.length === 0) return flags;
    
    const mostRecentContractStub = driverStubs.find(s => s.contract_type) || {};
    const contractType = (mostRecentContractStub.contract_type || 'LOO').toUpperCase();

    const getThreshold = (thresholdsObject, contract) => {
        return thresholdsObject.by_contract[contract] ?? thresholdsObject.default;
    };

    const getStubsInLookback = (flagSettings) => {
        let relevantStubs = driverStubs;

        if (flagSettings.lookback && flagSettings.lookback.type === 'weeks') {
            const weeksAgo = flagSettings.lookback.value;
            const lookbackDate = new Date();
            lookbackDate.setDate(lookbackDate.getDate() - (weeksAgo * 7));
            relevantStubs = driverStubs.filter(s => new Date(s.pay_date) >= lookbackDate);
        }

        return relevantStubs.filter(s => s.total_miles && s.total_miles > 0);
    };
    
    // ... (High Tolls, Heavy Loads, Dispatcher Hopper logic remains the same) ...
    // --- High Tolls ---
    if (settings.highTolls.enabled) {
        const relevantStubsForDriver = getStubsInLookback(settings.highTolls);
        if (relevantStubsForDriver.length >= settings.highTolls.minStubs) { 
            const allRelevantStubs = historicalStubs.filter(stub => 
                relevantStubsForDriver.some(rs => rs.pay_date === stub.pay_date)
            ).filter(s => s.total_miles && s.total_miles > 0);
            
            const tollsByDriver = allRelevantStubs.reduce((acc, stub) => {
                const driver = stub.driver_name;
                const tolls = stub.total_expected_tolls || stub.pEstimated_tolls || 0;
                if (!acc[driver]) { acc[driver] = { totalTolls: 0, stubCount: 0 }; }
                acc[driver].totalTolls += tolls;
                acc[driver].stubCount++;
                return acc;
            }, {});

            const avgTollsByDriver = Object.entries(tollsByDriver).reduce((acc, [driver, data]) => {
                acc[driver] = data.stubCount > 0 ? data.totalTolls / data.stubCount : 0;
                return acc;
            }, {});

            const allAvgTollValues = Object.values(avgTollsByDriver).sort((a, b) => a - b);
            
            if (allAvgTollValues.length > 0) {
                const percentileIndex = Math.floor((1 - (settings.highTolls.thresholds.default / 100)) * (allAvgTollValues.length - 1));
                const tollThreshold = allAvgTollValues[percentileIndex];
                const driverAvgTolls = avgTollsByDriver[driverName] || 0;

                if (driverAvgTolls >= tollThreshold && driverAvgTolls > 0) {
                    flags.push({
                        text: settings.highTolls.label,
                        color: settings.highTolls.color,
                        tooltipData: {
                            avgTolls: driverAvgTolls,
                            lookback: settings.highTolls.lookback.value
                        }
                    });
                }
            }
        }
    }

    // --- Heavy Loads ---
    if (settings.heavyLoads.enabled) {
        const relevantLoads = driverLoads.filter(l => !['Canceled', 'TONU', 'Layover'].includes(l.status) && l.weight > 0);
        if (relevantLoads.length >= settings.heavyLoads.minLoads) {
            const totalWeight = relevantLoads.reduce((sum, l) => sum + (l.weight || 0), 0);
            const avgWeight = totalWeight / relevantLoads.length;
            const threshold = getThreshold(settings.heavyLoads.thresholds, relevantLoads[0]?.contract_type);
            if (avgWeight > threshold) {
                flags.push({
                    text: settings.heavyLoads.label,
                    color: settings.heavyLoads.color,
                    tooltipData: { avgWeight: avgWeight, loadCount: relevantLoads.length }
                });
            }
        }
    }

    // --- Dispatcher Hopper ---
    if (settings.dispatcherHopper.enabled) {
        const relevantStubs = getStubsInLookback(settings.dispatcherHopper);
        const uniqueDispatchers = [...new Set(relevantStubs.map(s => s.stub_dispatcher).filter(Boolean))];
        const threshold = getThreshold(settings.dispatcherHopper.thresholds, contractType);
        if (uniqueDispatchers.length > threshold) {
            flags.push({ 
                text: settings.dispatcherHopper.label, 
                color: settings.dispatcherHopper.color,
                tooltipData: {
                    dispatchers: uniqueDispatchers.sort(),
                    count: uniqueDispatchers.length,
                    lookback: settings.dispatcherHopper.lookback.type === 'allTime' ? 'All Time' : `${settings.dispatcherHopper.lookback.value} wks`
                }
            });
        }
    }

    // --- Tenure (New Hire / Veteran) ---
    if (settings.tenure.enabled) {
        const newHireThreshold = getThreshold(settings.tenure.newHireThresholds, contractType);
        const veteranThreshold = getThreshold(settings.tenure.veteranThresholds, contractType);
        const totalStubs = driverStubs.length;

        if (totalStubs > 0) { // Only apply if we have historical data
            if (totalStubs < newHireThreshold) {
                flags.push({
                    text: settings.tenure.label, // "New Hire"
                    color: settings.tenure.color,
                    tooltipData: { stubs: totalStubs, threshold: newHireThreshold, type: 'new' }
                });
            } else if (totalStubs >= veteranThreshold) {
                flags.push({
                    text: settings.tenure.positiveLabel, // "Veteran"
                    color: settings.tenure.positiveColor,
                    tooltipData: { stubs: totalStubs, threshold: veteranThreshold, type: 'veteran' }
                });
            }
        }
    }

    // --- Negative Balance/PO ---
    if (settings.negative.enabled && driverStubs.length >= settings.negative.minStubs) {
        const mostRecentStub = driverStubs[0];
        const finalBalance = (mostRecentStub.balance || 0) + (mostRecentStub.balance_settle || 0);
        const finalPo = (mostRecentStub.po_deductions || 0) - (mostRecentStub.po_settle || 0);
        const totalLiability = Math.abs(finalBalance) + finalPo;
        const threshold = getThreshold(settings.negative.thresholds, mostRecentStub.contract_type);
        if (totalLiability > threshold) {
             flags.push({ 
                 text: settings.negative.label, 
                 color: settings.negative.color,
                 tooltipData: { balance: finalBalance, po: finalPo, date: mostRecentStub.pay_date }
            });
        }
    }

    // --- Low Pay Metrics ---
    ['lowRpm', 'lowGross', 'lowNet'].forEach(flagId => {
        const flagSettings = settings[flagId];
        if (flagSettings.enabled) {
            const relevantStubs = getStubsInLookback(flagSettings);
            if (relevantStubs.length >= flagSettings.minStubs) {
                const threshold = getThreshold(flagSettings.thresholds, relevantStubs[0].contract_type);
                const metricKey = { lowRpm: 'rpm_all', lowGross: 'driver_gross', lowNet: 'net_pay' }[flagId];
                const stubsBelowThreshold = relevantStubs.filter(s => (s[metricKey] || 0) < threshold);
                const percentageBelow = (stubsBelowThreshold.length / relevantStubs.length) * 100;
                if (percentageBelow >= flagSettings.minPercentageOfStubs) {
                    flags.push({
                        text: flagSettings.label,
                        color: flagSettings.color,
                        tooltipData: {
                            stubsBelow: stubsBelowThreshold.length,
                            totalStubs: relevantStubs.length,
                            threshold: threshold,
                            metric: flagId
                        }
                    });
                }
            }
        }
    });

    return flags;
}

// Helper function to get historical data for a specific driver
const getHistoricalStubsForDriver = (driverName, historicalStubs = []) => {
    const driverData = historicalStubs.filter(stub => stub.driver_name === driverName);
    return driverData.sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date));
};


/**
 * Creates a "predicted" stub object for a given week by aggregating a driver's loads,
 * accounting for pay delay.
 * @param {string} driverName - The name of the driver.
 * @param {number} weeksAgoTarget - The target week relative to the current calendar week (0 for current, -1 for next).
 * @param {number} payDelayWeeks - The pay delay for this driver (1 or 2).
 * @returns {object|null} A single predicted stub object, or null if no loads are found.
 */
function createPredictedStub(driverName, weeksAgoTarget, payDelayWeeks) {
    const workWeeksAgo = payDelayWeeks === 2 ? weeksAgoTarget + 1 : weeksAgoTarget;

    // Get the date range for the *work* period.
    const { start: workStart, end: workEnd } = getPayrollWeekDateRange(workWeeksAgo);

    // Filter loads based on the work period.
    const driverLoads = appState.profiles.liveData.filter(load =>
        load.driver === driverName &&
        load.do_date &&
        new Date(load.do_date) >= workStart &&
        new Date(load.do_date) <= workEnd &&
        load.status !== 'Canceled'
    );

    if (driverLoads.length === 0) {
        return null;
    }

    // --- Calculate the CORRECT future pay date (Thursday) ---
    // The pay date is calculated based on the END of the WORK week (workEnd, which is a Monday).
    const payDate = new Date(workEnd);
    // Standard pay is 3 days after Monday (Thursday). If delayed, it's 10 days after (Next Thursday).
    payDate.setUTCDate(workEnd.getUTCDate() + (payDelayWeeks === 2 ? 10 : 3));
    const payDateString = payDate.toISOString();
    // --- End Pay Date Calculation ---

    // Aggregate data from all loads in the work period
    const predictedStub = driverLoads.reduce((acc, load) => {
        const gross = (load.price || 0) - (load.cut || 0); // Gross is price - cut for the driver line
        acc.driver_gross += gross;
        acc.margin += (load.cut || 0); // Margin is the cut
        acc.total_miles += (load.trip_miles || 0) + (load.deadhead_miles || 0);
        acc.total_price += (load.price || 0); // Use total price (rate) for RPM calculation
        acc.sum_expected_fuel_cost += (load.expected_fuel_cost || 0); // Add expected fuel cost
        return acc;
    }, {
        is_predicted: true,
        pay_date: payDateString, // Use the calculated future pay date based on work week end
        weeks_ago: weeksAgoTarget, // Store the target week (0 or -1) for reference in display logic
        pay_delay_wks: payDelayWeeks, // Store the delay used for this prediction
        driver_name: driverName,
        driver_gross: 0,
        margin: 0,
        total_miles: 0,
        total_price: 0, // Store total price for RPM calculation
        sum_expected_fuel_cost: 0, // Initialize sum for expected fuel cost
        stub_dispatcher: driverLoads[0]?.dispatcher || 'N/A',
        stub_team: driverLoads[0]?.team || 'N/A',
        trailer_type: driverLoads[0]?.trailer_type || 'V',
        net_pay: '-',
        balance: '-',
        balance_settle: '-',
        po_settle: '-',
        contract_type: driverLoads[0]?.contract_type || 'LOO', // Use contract type from load
    });

    // Calculate RPM based on total price and total miles
    predictedStub.rpm_all = predictedStub.total_miles > 0
        ? predictedStub.total_price / predictedStub.total_miles
        : 0;

    return predictedStub;
}



const getLowRpmThreshold = (contractType) => {
    const thresholds = appState.profiles.thresholdSettings.lowRpm;
    return thresholds.by_contract[contractType] ?? thresholds.default;
};


/**
 * Calculates the start (Tuesday) and end (Monday) of a payroll week for the Profiles section.
 * @param {number} weeksAgo - 0 for current, 1 for last week, etc.
 * @returns {{label: string, id: string}}
 */

function calculateDriverSummary(drivers, columnId, mode) {
    const values = drivers
        .map(d => d[columnId])
        .filter(v => typeof v === 'number' && !isNaN(v));

    if (mode === 'none' || values.length === 0) return null;

    if (mode === 'median') {
        return calculateMedian(values);
    } else if (mode === 'sum') {
        return values.reduce((sum, v) => sum + v, 0);
    } else if (mode === 'avg') {
        return values.reduce((sum, v) => sum + v, 0) / values.length;
    }
    return null;
}

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
    { id: 'goodMoves', label: 'Good Moves', type: 'number', tooltip: "Moved loads that helped a driver reach their gross target." },
    { id: 'badMoves', label: 'Bad Moves', type: 'number', tooltip: "Moved loads where the driver was already on track for a good gross." },
    { id: 'hiddenMiles', label: 'Hidden Miles', type: 'number', tooltip: "Loads where the start location was modified, indicating hidden deadhead." },
    { id: 'lowRpm', label: 'Low RPM', type: 'number', tooltip: "Loads booked below the RPM threshold." },
    { id: 'tuesdayOpen', label: 'Tue. Open', type: 'number', tooltip: "Loads still open on Tuesday that should have been closed." },
    { id: 'trailerDrops', label: 'Drops', type: 'number', tooltip: "Number of trailers dropped by drivers." },
    { id: 'trailerRecoveries', label: 'Recoveries', type: 'number', tooltip: "Number of trailers recovered by drivers." },
    { id: 'missingPaperwork', label: 'Missing Ppw', type: 'number', tooltip: "Number of loads with missing paperwork." },
    { id: 'rcEntry', label: 'RC Entry', type: 'number', tooltip: "Median time (minutes) to enter Rate Confirmations." }, 
    { id: 'calculatorActivity', label: 'Calc. Activity', type: 'percentage', tooltip: "Percentage of days the dispatcher accessed the payroll calculator." },
    { id: 'newStarts', label: 'New Starts', type: 'number', tooltip: "Number of drivers with their first load this week." },
    { id: 'overdueLoads', label: 'Overdue', type: 'number', tooltip: "Total days past delivery date for all open loads." },
    { id: 'wellness', label: 'Wellness %', type: 'percentage', tooltip: "Percentage of loads that passed the Wellness check." },
    { id: 'canceled', label: 'Canceled', type: 'number', tooltip: "Number of loads with 'Canceled' status." },
    { id: 'complianceScore', label: '% Compliance', type: 'percentage', tooltip: "Aggregate score (0-100%) based on weighted performance metrics." },
    { id: 'medianTenureOO', label: 'Tenure (OO)', type: 'number', tooltip: "Median weeks active for Owner Operators." },
    { id: 'medianTenureLOO', label: 'Tenure (LOO)', type: 'number', tooltip: "Median weeks active for Lease Owner Operators." }, 
    { id: 'retention4w', label: '4W Retention', type: 'percentage', tooltip: "Percentage of drivers from 4 weeks ago who are still active." },
];

// --- FIX: Updated the driver table configuration ---
const driverTableColumns = [
    { id: 'name', label: 'Driver Name', type: 'string' },
    { id: 'status', label: 'Status', type: 'string' },
    { id: 'company', label: 'Company', type: 'string' },
    { id: 'dispatcher', label: 'Dispatcher', type: 'string' },
    // 'team' is added dynamically for "All Teams" view
    { id: 'franchise', label: 'Franchise', type: 'string' }, // NEW
    { id: 'contract', label: 'Contract', type: 'string' },
    { id: 'equipment', label: 'Equipment', type: 'string' },
    { id: 'gross', label: 'Gross', type: 'number', isSummaryCandidate: true },
    { id: 'miles', label: 'Miles', type: 'number', isSummaryCandidate: true },
    { id: 'margin', label: 'Margin', type: 'number', isSummaryCandidate: true },
    { id: 'rpm', label: 'RPM', type: 'number', isSummaryCandidate: true },
   { id: 'risk', label: 'Drop Risk %', type: 'number', isSummaryCandidate: true },
    { id: 'flags', label: 'Flags', type: 'string' },
];

const driverTablePinnedLeft = ['rowNum', 'name', 'status'];
const driverTablePinnedRight = ['risk', 'flags'];



export function renderDriverDeepDiveModal_Profiles() {
    const modal = document.getElementById('profiles-driver-deep-dive-modal');
    if (!modal) return;

    const { isModalOpen, selectedDriver, showCanceledLoads } = appState.profiles.driverDeepDive;
    modal.classList.toggle('hidden', !isModalOpen);

    if (isModalOpen && selectedDriver) {
        const headerRight = document.getElementById('profiles-modal-header-right');
        if (headerRight) {
            headerRight.className = 'flex items-center gap-x-4';
            const buttonText = showCanceledLoads ? 'Hide Canceled' : 'Show Canceled';
            const buttonColor = showCanceledLoads ? 'bg-red-800 hover:bg-red-700' : 'bg-gray-600 hover:bg-gray-500';
            headerRight.innerHTML = `
                <button id="toggle-canceled-loads-btn" class="text-xs font-semibold py-1 px-3 rounded-md transition-colors ${buttonColor}">
                    ${buttonText}
                </button>
                <button id="close-profiles-deep-dive-modal-btn" class="text-gray-400 hover:text-white transition-colors text-3xl">&times;</button>
            `;
        }

        const historicalStubs = getHistoricalStubsForDriver(selectedDriver, appState.loads.historicalStubsData);
        
        // Try to find driver in current view, fallback to global precomputed stats
        let driverData = appState.profiles.currentTeamData?.drivers.find(d => d.name === selectedDriver);
        if (!driverData && appState.profiles.globalDriverStats) {
            driverData = appState.profiles.globalDriverStats.get(selectedDriver);
        }
        
        const contractType = driverData?.contract || null;

        // --- Determine Full Contract Type ---
        const mostRecentContractStub = historicalStubs.find(s => s.contract_type) || {};
        const fullContractType = mostRecentContractStub.contract_type || (contractType === 'OO' ? 'OO' : 'LOO');
        
        // --- Determine Pay Delay ---
        const mostRecentStubWithDelay = historicalStubs.find(s => s.pay_delay_wks);
        const driverPayDelay = mostRecentStubWithDelay ? parseInt(mostRecentStubWithDelay.pay_delay_wks, 10) : 1;
        // --- End Pay Delay Determination ---

        // --- Generate Predicted Stubs based on Delay ---
        const predictedStubs = [];
        if (driverPayDelay === 1) {
            // Standard Pay: Only show "Live" for current work week (target 0)
            const liveWeekPrediction = createPredictedStub(selectedDriver, 0, 1);
            if (liveWeekPrediction) {
                predictedStubs.push(liveWeekPrediction);
            }
        } else if (driverPayDelay === 2) {
            // Delayed Pay: Show "Delayed Wk" (target 0, work 1) AND "Live" (target -1, work 0)
            const delayedWeekPrediction = createPredictedStub(selectedDriver, 0, 2); // Target Pay Date = 10/30 (Work Wk ending 10/20)
            if (delayedWeekPrediction) {
                predictedStubs.push(delayedWeekPrediction);
            }
            const liveForNextPayPrediction = createPredictedStub(selectedDriver, -1, 2); // Target Pay Date = 11/06 (Work Wk ending 10/27)
            if (liveForNextPayPrediction) {
                predictedStubs.push(liveForNextPayPrediction);
            }
        }
        // --- End Predicted Stub Generation ---

        // Combine predicted and historical stubs for display, sorting predictions newest target first
        const allStubsForDisplay = [...predictedStubs.sort((a, b) => a.weeks_ago - b.weeks_ago), ...historicalStubs];

        // Determine Team Status (no change needed here)
        const isLiveData = appState.profiles.selectedWeek === 'live';
        let teamStatus = null;
        if (isLiveData) {
            const driverLoads = appState.profiles.liveData
                .filter(l => l.driver === selectedDriver && l.status_teams)
                .sort((a, b) => new Date(b.do_date) - new Date(a.do_date));
            if (driverLoads.length > 0) {
                teamStatus = driverLoads[0].status_teams;
            }
        } else {
            const recentStubWithStatus = historicalStubs.find(s => s.status_teams);
            if (recentStubWithStatus) {
                teamStatus = recentStubWithStatus.status_teams;
            }
        }

        // Render modal components
        renderModalHeader_Profiles(selectedDriver, historicalStubs, contractType, teamStatus, fullContractType);
        renderModalKpis_Profiles(historicalStubs);
        renderModalHistoricalTable_Profiles(allStubsForDisplay); // Pass combined stubs
        renderModalChart_Profiles(historicalStubs);
    }
}

function renderSaveFilterModal() {
    const modal = document.getElementById('save-driver-filter-modal');
    if (!modal) return;

    if (appState.profiles.driverFilters.isSaveModalOpen) {
        document.body.appendChild(modal);
        modal.classList.remove('hidden');

        const nameInput = document.getElementById('save-filter-name-input');
        const colorInput = document.getElementById('save-filter-color-input');
        const filterToEdit = appState.profiles.driverFilters.filterToEdit;

        if (filterToEdit) {
            nameInput.value = filterToEdit.name;
            colorInput.value = filterToEdit.color || '#374151';
        } else {
            nameInput.value = '';
            colorInput.value = '#374151';
        }
        nameInput.focus();
    } else {
        modal.classList.add('hidden');
    }
}

function calculateDropRisk(driver) {
    const { weights, flags: flagSettings } = appState.profiles.driverHealthSettings;
    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
    if (totalWeight === 0) return 0;

    let weightedScore = 0;
    driver.flags.forEach(flag => {
        // Find the setting for the flag based on its text
        const flagKey = Object.keys(flagSettings).find(key => 
            flagSettings[key].label === flag.text || flagSettings[key].positiveLabel === flag.text
        );

        if (flagKey && weights[flagKey]) {
            // If it's a positive flag (Veteran), subtract the weight
            if (flagSettings[flagKey].positiveLabel === flag.text) {
                weightedScore -= weights[flagKey];
            } else { // Otherwise, it's a negative flag, so add the weight
                weightedScore += weights[flagKey];
            }
        }
    });

    // The score can't be negative, but it can be low.
    const finalScore = Math.max(0, weightedScore);

    return Math.min(100, (finalScore / totalWeight) * 100);
}

// In renderModalHeader_Profiles
function renderModalHeader_Profiles(driverName, historicalStubs, contractType, teamStatus, fullContractType) {
    const headerEl = document.getElementById('profiles-modal-header'); // Get the parent header
    const leftEl = document.getElementById('profiles-modal-header-left');
    const centerEl = document.getElementById('profiles-modal-header-center');
    if (!headerEl || !leftEl || !centerEl) return;

    // --- START OF FIX: Add positioning classes ---
    // Make the header the positioning container for the center element.
    headerEl.classList.add('relative');
    // Position the center element absolutely within the header.
    centerEl.className = 'absolute left-1/2 -translate-x-1/2';
    // --- END OF FIX ---

    // Try to find driver in current view, fallback to global precomputed stats
    let driverData = appState.profiles.currentTeamData?.drivers.find(d => d.name === driverName);
    if (!driverData && appState.profiles.globalDriverStats) {
        driverData = appState.profiles.globalDriverStats.get(driverName);
    }

    const riskPercent = driverData ? Math.round(driverData.risk) : 50;
    const mostRecentStub = historicalStubs.length > 0 ? historicalStubs[0] : null;
    const currentCompany = mostRecentStub?.company_name || driverData?.company || '-';
    
    // START: FIX for Contract Type
    const displayContract = contractType === 'LOO' && fullContractType && fullContractType !== 'LOO' && fullContractType !== 'LOO '
        ? `${contractType} (${fullContractType})`
        : contractType;

    const details = [
        currentCompany !== '-' ? currentCompany : null,
        displayContract,
        teamStatus
    ].filter(Boolean).join(', ');
    // END: FIX for Contract Type

    leftEl.innerHTML = `
        <div>
            <h2 class="text-2xl font-bold text-white whitespace-nowrap">${driverName}</h2>
            ${details ? `<p class="text-sm text-gray-400 mt-1">${details}</p>` : ''}
        </div>
    `;

    centerEl.innerHTML = `
        <div class="modal-risk-display">
            <span class="modal-risk-label">Drop Risk: ${riskPercent}%</span>
            <div class="modal-risk-bar">
                <div class="modal-risk-bar-fill" style="width: ${riskPercent}%;"></div>
            </div>
        </div>
    `;
}

function renderModalKpis_Profiles(historicalStubs) {
    const kpiContainer = document.getElementById('profiles-modal-kpi-container');
    if (!kpiContainer) return;

    if (historicalStubs.length === 0) {
        kpiContainer.innerHTML = '<p class="text-gray-500 col-span-2 text-center">No historical data for KPIs.</p>';
        return;
    }

    // 1. Filter for all valid stubs (miles > 0). The input `historicalStubs` is already sorted newest to oldest.
    const allValidStubs = historicalStubs.filter(s => s.total_miles && s.total_miles > 0);

    // 2. Take the most recent 4 valid stubs for calculation. `slice` handles cases with fewer than 4 stubs gracefully.
    const stubsForCalc = allValidStubs.slice(0, 4);
    
    if (stubsForCalc.length === 0) {
        kpiContainer.innerHTML = '<p class="text-gray-500 col-span-2 text-center">No stubs with miles found for KPI calculation.</p>';
        return;
    }

    const totalStubs = stubsForCalc.length;

    const avgNetPay = stubsForCalc.reduce((sum, s) => sum + (parseFloat(s.net_pay) || 0), 0) / totalStubs;
    const avgRpm = stubsForCalc.reduce((sum, s) => sum + (parseFloat(s.rpm_all) || 0), 0) / totalStubs;
    const avgMiles = stubsForCalc.reduce((sum, s) => sum + (parseFloat(s.total_miles) || 0), 0) / totalStubs;
    const avgGross = stubsForCalc.reduce((sum, s) => sum + (parseFloat(s.driver_gross) || 0), 0) / totalStubs;

    const kpis = [
        { label: '4-Week Avg Net', value: `$${avgNetPay.toLocaleString('en-US', {maximumFractionDigits: 0})}` },
        { label: '4-Week Avg Gross', value: `$${avgGross.toLocaleString('en-US', {maximumFractionDigits: 0})}` },
        { label: '4-Week Avg RPM', value: `$${avgRpm.toFixed(2)}` },
        { label: '4-Week Avg Miles', value: `${avgMiles.toLocaleString('en-US', {maximumFractionDigits: 0})}` },
    ];
    
    kpiContainer.innerHTML = kpis.map(kpi => `
    <div class="bg-gray-800/50 border border-gray-700/50 rounded-lg p-2 text-center flex flex-col justify-center">
        <h4 class="text-xs text-gray-400 uppercase font-semibold">${kpi.label}</h4>
        <p class="text-xl font-bold text-teal-400 mt-0.5">${kpi.value}</p>
    </div>
    `).join('');
}

function renderModalHistoricalTable_Profiles(stubsData) {
    const tableContainer = document.getElementById('profiles-modal-table-container');
    if (!tableContainer) return;

    if (stubsData.length === 0) {
        const message = 'No historical stubs or live loads found for this driver.';
        tableContainer.innerHTML = `<p class="p-4 text-center text-gray-500">${message}</p>`;
        return;
    }

    // --- Detect Duplicate Pay Dates ---
    const payDateCounts = stubsData.reduce((acc, stub) => {
        if (!stub.pay_date) return acc;
        const dateKey = new Date(stub.pay_date).toISOString().split('T')[0];
        acc[dateKey] = (acc[dateKey] || 0) + 1;
        return acc;
    }, {});

    // --- Define Table Headers ---
    const headers = [
        { label: 'Pay Date', key: 'pay_date', format: (d, stub) => {
            // Check for duplicate count
            const dateKey = new Date(d).toISOString().split('T')[0];
            const isDuplicate = payDateCounts[dateKey] > 1;
            const duplicateIndicator = isDuplicate ? 
                `<span class="ml-1 text-red-500 font-bold cursor-help" title="Duplicate Pay Date Detected">!</span>` : '';

            // --- Pay Date Display Logic ---
            if (stub.is_predicted) {
                 const date = new Date(d); // Use the already calculated future pay date
                 const formattedDate = date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', timeZone: 'UTC' });

                 // Determine the label based on delay and target week
                 let label = 'Live'; // Default for standard pay (delay=1) or future prediction (delay=2, weeks_ago=-1)
                 if (stub.pay_delay_wks === 2 && stub.weeks_ago === 0) {
                     label = 'Delayed Wk'; // Only show "Delayed Wk" for the prediction targeting the *current* pay date (work week = previous)
                 }

                 return `
                    <div class="flex items-center justify-center gap-x-2">
                        <span class="font-bold text-teal-400">${label} - ${formattedDate}</span>
                        <svg title="This is a prediction based on unsettled loads from the corresponding work week." class="w-4 h-4 text-teal-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
                        ${duplicateIndicator}
                    </div>
                `;
            }
            // Historical stub: format normally
            return `${new Date(d).toLocaleDateString('en-US', { timeZone: 'UTC' })}${duplicateIndicator}`;
            // --- End Pay Date Display Logic ---
        }},
        { label: 'Flags', key: 'flags' }, // Flags might need adjustment if based on live loads for delayed stubs
        { label: 'Gross', key: 'driver_gross', format: (d) => d === '-' ? '-' : `$${(parseFloat(d) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, class: 'text-blue-400' },
        { label: 'Margin', key: 'margin', format: (d) => d === '-' ? '-' : `$${(parseFloat(d) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, class: 'text-yellow-400' },
        {
            label: 'Contract',
            key: 'contract',
            format: (d) => {
                if (d === null || d === undefined) return '-';
                const value = parseFloat(d);
                // The value is expected to be a decimal like 0.22
                return formatPercentage(value);
            },
            class: 'text-sky-400'
        },
        {
            label: 'Net',
            key: 'net_pay',
            format: (d, stub) => {
                if (d === '-') return '-';
                const value = parseFloat(d) || 0;
                let colorClass = '';
                const contractType = (stub.contract_type || 'LOO').toUpperCase();

                if (contractType === 'OO') {
                    if (value < 800) colorClass = 'text-red-400';
                    else if (value <= 1300) colorClass = 'text-orange-400';
                    else colorClass = 'text-green-400';
                } else { // LOO and everything else
                    if (value < 400) colorClass = 'text-red-400';
                    else if (value <= 900) colorClass = 'text-orange-400';
                    else colorClass = 'text-green-400';
                }

                return `<span class="${colorClass}">$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;
            }
        },
        {
            label: 'Contract %',
            key: 'contract',
            format: (d) => {
                if (d === null || d === undefined) return '-';
                const value = parseFloat(d);
                // The value is expected to be a decimal like 0.22
                return formatPercentage(value);
            },
            class: 'text-sky-400'
        },
        { label: 'Miles', key: 'total_miles', format: (val) => val === '-' ? '-' : (parseFloat(val) || 0).toLocaleString() },
        { label: 'RPM', key: 'rpm_all', format: (d) => d === '-' ? '-' : `$${(parseFloat(d) || 0).toFixed(2)}` },
        { label: 'Dispatch', key: 'stub_dispatcher' },
        { label: 'Team', key: 'stub_team' },
        {
            label: 'Fuel', key: 'fuel_used', format: (d, stub) => {
                if (stub.is_predicted) {
                    // Use sum_expected_fuel_cost for predicted, apply special styling
                    const expectedFuel = stub.sum_expected_fuel_cost;
                    return `<span class="text-gray-500 italic">$${(expectedFuel || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;
                } else {
                    // Use fuel_used for historical
                    const fuelUsed = stub.fuel_used; // Already defined key
                    // Check specifically for null or undefined, treat 0 as a valid value
                    const value = (fuelUsed === null || fuelUsed === undefined) ? '-' : `$${(parseFloat(fuelUsed) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                     return value;
                }
            }, class: 'text-orange-400' // Base color for historical fuel
        },
        {
            label: 'Balance',
            key: 'balance',
            format: (d) => {
                if (d === '-') return '-';
                const value = parseFloat(d) || 0;
                const colorClass = value < 0 ? 'text-red-400' : '';
                return `<span class="${colorClass}">$${value.toFixed(2)}</span>`;
            }
        },
        {
            label: 'Bal. Settle',
            key: 'balance_settle',
            format: (d) => { /* ... (no change needed) ... */
                if (d === '-') return '-';
                const value = parseFloat(d) || 0;
                const colorClass = value < 0 ? 'text-red-400' : '';
                return `<span class="${colorClass}">$${value.toFixed(2)}</span>`;
            }
        },
        {
            label: 'PO Settle',
            key: 'po_settle',
            format: (d) => { /* ... (no change needed) ... */
                if (d === '-') return '-';
                const value = parseFloat(d) || 0;
                const colorClass = value < 0 ? 'text-red-400' : '';
                return `<span class="${colorClass}">$${value.toFixed(2)}</span>`;
            }
        },
        {
            label: 'Equipment',
            key: 'trailer_type',
            format: (type) => { /* ... (no change needed) ... */
                if (!type) return '-';
                const upperType = type.toUpperCase();
                if (upperType === 'REEFER') return `R`;
                if (upperType === 'FLATBED') return `F`;
                if (upperType === 'VAN' || upperType === 'V') return `V`;
                return type;
            }
        }
    ];
    // --- End Header Definition ---

    // --- Render Table HTML ---
    tableContainer.innerHTML = `
        <table class="w-full text-xs text-left text-gray-400 stubs-deep-dive-table">
            <thead class="text-xs text-gray-300 uppercase bg-gray-900 sticky top-0">
                <tr>
                    ${headers.map(h => `<th class="px-3 py-2 text-center whitespace-nowrap">${h.label}</th>`).join('')}
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-800">
                ${stubsData.map(stub => {
                    // --- Get Pay Delay for this specific stub ---
                    // Predicted stubs store it directly. Historical stubs need lookup (or default).
                    const payDelayForStub = stub.is_predicted ? stub.pay_delay_wks : (parseInt(stub.pay_delay_wks, 10) || 1);
                    // --- End Pay Delay Retrieval ---

                    // --- Calculate work period based on pay date AND delay ---
                    const { start, end } = stub.is_predicted
                        ? getPayrollWeekDateRange(payDelayForStub === 2 ? stub.weeks_ago + 1 : stub.weeks_ago) // Use work week offset
                        : getPayPeriodFromPayDate(stub.pay_date, payDelayForStub); // Use utility with delay
                    // --- End Work Period Calculation ---

                    let loadsForStubPeriod = appState.profiles.liveData.filter(load =>
                        load.driver === stub.driver_name &&
                        load.do_date && // Make sure do_date exists
                        new Date(load.do_date) >= start &&
                        new Date(load.do_date) <= end
                    );

                    // Filter out canceled loads if they are supposed to be hidden
                    if (!appState.profiles.driverDeepDive.showCanceledLoads) {
                        loadsForStubPeriod = loadsForStubPeriod.filter(load => load.status !== 'Canceled');
                    }

                    // Calculate move flags based on loads within the *correct* period
                    let moveFlag = null;
                    let hasGoodMove = false;
                    for (const load of loadsForStubPeriod) {
                        if (load.moved_monday === 'Moved Monday Load') {
                            const goodMoveThresholds = appState.profiles.thresholdSettings.goodMove;
                            const threshold = goodMoveThresholds.by_contract[load.contract_type] ?? goodMoveThresholds.default;
                          // Estimate gross without this specific load by subtracting its price from the stub's gross
                            // This assumes stub.driver_gross includes the price of this moved load, which is typical
                            // FIX: Subtract (Price - Cut) to get the actual Driver Pay, handling negative margins correctly
                            const estimatedGrossWithout = (parseFloat(stub.driver_gross) || 0) - ((load.price || 0) - (load.cut || 0));
                            const isGoodMove = estimatedGrossWithout < threshold;
                            if (!isGoodMove) {
                                moveFlag = { text: 'Bad Move', color: 'red' };
                                break; // Only need one bad move to flag
                            }
                            hasGoodMove = true; // Mark that at least one good move was found
                        }
                    }
                    if (!moveFlag && hasGoodMove) {
                        moveFlag = { text: 'Good Move', color: 'green' };
                    }


                    return `
                    <tr class="hover:bg-gray-700/50 cursor-pointer stub-row"
                        data-pay-date="${stub.pay_date}"
                        data-driver-name="${stub.driver_name}"
                        data-is-predicted="${stub.is_predicted || false}"
                        data-weeks-ago="${stub.weeks_ago !== undefined ? stub.weeks_ago : ''}"
                        data-pay-delay="${payDelayForStub}">
                        ${headers.map(h => {
                            const value = stub[h.key]; // Don't use ?? '-' here yet
                            let displayValue;

                            if (h.key === 'flags') {
                                // For historical stubs, use flags already stored if they exist
                                // For predicted stubs, or if historical flags are missing, calculate based on associated loads
                                let existingFlags = [];
                                if (!stub.is_predicted && Array.isArray(stub.flags)) {
                                    existingFlags = stub.flags;
                                } else {
                                     // Calculate live flags if needed (e.g., for predicted or missing historical)
                                     // This might be simplified; for now, we only add the Move flag
                                }
                                const allFlags = moveFlag ? [...existingFlags, moveFlag] : existingFlags;
                                displayValue = allFlags.length > 0
                                    ? allFlags.map(f => `<span class="driver-flag flag-${f.color}">${f.text}</span>`).join(' ')
                                    : '-';
                            } else {
                                // Format the value using the header's format function, handle '-' case inside format
                                displayValue = h.format ? h.format(value, stub) : (value === null || value === undefined ? '-' : value);
                            }

                            const cellClass = typeof h.class === 'function' ? h.class(value) : (h.class || '');
                            return `<td class="px-3 py-1.5 whitespace-nowrap text-center font-mono ${cellClass}">${displayValue}</td>`;
                        }).join('')}
                    </tr>
                `}).join('')}
            </tbody>
        </table>
    `;
    // --- End Render Table HTML ---

    // --- Attach Click Handler ---
    const tableBody = tableContainer.querySelector('tbody');
    if (tableBody && !tableBody._clickHandlerAttached) {
        tableBody.addEventListener('click', e => {
            const stubRow = e.target.closest('.stub-row');
            if (!stubRow) return;

            // --- Read Pay Delay from clicked row ---
            const payDelay = parseInt(stubRow.dataset.payDelay, 10) || 1;
            // --- End Read Pay Delay ---

            const isPredicted = stubRow.dataset.isPredicted === 'true';
            const weeksAgo = parseInt(stubRow.dataset.weeksAgo, 10); // Relevant for predicted stubs' work week

            const existingDetailsRow = stubRow.nextElementSibling;
            if (existingDetailsRow && existingDetailsRow.classList.contains('stub-details-row')) {
                existingDetailsRow.remove();
                stubRow.classList.remove('bg-gray-700/80');
                return;
            }

            document.querySelectorAll('.stub-details-row').forEach(row => row.remove());
            document.querySelectorAll('.stub-row').forEach(row => row.classList.remove('bg-gray-700/80'));

            stubRow.classList.add('bg-gray-700/80');

            const payDate = stubRow.dataset.payDate;
            const driverName = stubRow.dataset.driverName;

            // --- Calculate Correct Work Period using Pay Delay ---
            const { start, end } = isPredicted
                ? getPayrollWeekDateRange(payDelay === 2 ? weeksAgo + 1 : weeksAgo) // Get work week for prediction
                : getPayPeriodFromPayDate(payDate, payDelay); // Use utility with delay for historical
            // --- End Correct Work Period Calculation ---

            // Filter loads based on the CORRECT work period
            let loadsForStubDrilldown = appState.profiles.liveData.filter(load =>
                load.driver === driverName &&
                load.do_date && // Ensure do_date exists
                new Date(load.do_date) >= start &&
                new Date(load.do_date) <= end
            );

            // Apply the show/hide canceled loads filter
            if (!appState.profiles.driverDeepDive.showCanceledLoads) {
                loadsForStubDrilldown = loadsForStubDrilldown.filter(load => load.status !== 'Canceled');
            }

            loadsForStubDrilldown.sort((a, b) => new Date(a.pu_date) - new Date(b.pu_date) || new Date(a.do_date) - new Date(b.do_date));

            // --- Render Drilldown Row (no change needed inside here if loadsForStubDrilldown is correct) ---
            const detailsRow = document.createElement('tr');
            detailsRow.className = 'stub-details-row';
            let contentHTML;
            if (loadsForStubDrilldown.length > 0) {
                const loadsTable = loadsForStubDrilldown.map(load => {
                    const isCanceled = load.status === 'Canceled';
                    let flags = [];
                    // Determine Good/Bad Move Flag for *this specific load*
                    if (load.moved_monday === 'Moved Monday Load') {
                        const goodMoveThresholds = appState.profiles.thresholdSettings.goodMove;
                        const threshold = goodMoveThresholds.by_contract[load.contract_type] ?? goodMoveThresholds.default;
                        // Get the gross *without* this moved load
                        const grossWithoutThisMovedLoad = loadsForStubDrilldown
                            .filter(l => l.id !== load.id && l.status !== 'Canceled') // Exclude current load and canceled
                            .reduce((sum, l) => sum + (l.price || 0) - (l.cut || 0), 0);
                        flags.push(grossWithoutThisMovedLoad < threshold ? '<span class="stub-flag flag-green">Good</span>' : '<span class="stub-flag flag-red">Bad</span>');
                    }
                    if (load.hidden_miles === 'Hidden Miles Found!') {
                        flags.push('<span class="stub-flag flag-purple">Hidden</span>');
                    }
                    const puDate = load.pu_date ? new Date(load.pu_date).toLocaleDateString('en-US', {month: '2-digit', day: '2-digit', timeZone: 'UTC'}) : 'N/A';
                    const doDate = load.do_date ? new Date(load.do_date).toLocaleDateString('en-US', {month: '2-digit', day: '2-digit', timeZone: 'UTC'}) : 'N/A';
                    const totalMiles = (load.trip_miles || 0) + (load.deadhead_miles || 0);
                    const driverRate = (load.price || 0) - (load.cut || 0); // Driver gross for the load
                    const loadRPM = (load.trip_miles || 0) > 0 ? (load.price || 0) / load.trip_miles : 0; // RPM based on price/trip miles

                    return `
                        <tr class="hover:bg-cyan-700/50 ${isCanceled ? 'opacity-50' : ''}">
                            <td class="px-2 py-1.5">${puDate} - ${doDate}</td>
                            <td class="px-2 py-1.5">${load.pu_location || 'N/A'}</td>
                            <td class="px-2 py-1.5">${load.do_location || 'N/A'}</td>
                            <td class="px-2 py-1.5 text-right font-mono text-green-400">$${driverRate.toLocaleString()}</td>
                            <td class="px-2 py-1.5 text-right font-mono text-yellow-400">$${(load.cut || 0).toLocaleString()}</td>
                            <td class="px-2 py-1.5 text-right font-mono">$${loadRPM.toFixed(2)}</td>
                            <td class="px-2 py-1.5 text-right font-mono">${totalMiles.toLocaleString()} mi</td>
                            <td class="px-2 py-1.5">${load.dispatcher || 'N/A'}</td>
                            <td class="px-2 py-1.5">${load.status || 'N/A'}</td>
                            <td class="px-2 py-1.5">${flags.join(' ')}</td>
                        </tr>
                    `;
                }).join('');

                contentHTML = `
                    <div class="bg-cyan-900/50 p-3">
                        <table class="w-full text-xs">
                            <thead>
                                <tr class="border-b border-cyan-700">
                                    <th class="px-2 py-2 text-left">Dates</th><th class="px-2 py-2 text-left">Origin</th><th class="px-2 py-2 text-left">Destination</th>
                                    <th class="px-2 py-2 text-right">Driver Rate</th><th class="px-2 py-2 text-right">Margin</th><th class="px-2 py-2 text-right">RPM</th><th class="px-2 py-2 text-right">Miles</th>
                                    <th class="px-2 py-2 text-left">Dispatcher</th><th class="px-2 py-2 text-left">Status</th><th class="px-2 py-2 text-left">Flags</th>
                                </tr>
                            </thead>
                            <tbody>${loadsTable}</tbody>
                        </table>
                    </div>
                `;
            } else {
                contentHTML = `<div class="text-center text-gray-500 py-4">No individual loads found for this pay period.</div>`;
            }

            detailsRow.innerHTML = `<td colspan="${headers.length}" class="p-0">${contentHTML}</td>`; // Use headers.length for colspan
            stubRow.after(detailsRow);
            // --- End Render Drilldown Row ---
        });
        tableBody._clickHandlerAttached = true;
    }
    // --- End Attach Click Handler ---
}


function renderModalChart_Profiles(historicalStubs) {
    const chartContainer = d3.select("#profiles-modal-chart-container");
    chartContainer.html(""); // Clear previous content

    const metrics = [
        { key: 'net_pay', label: 'Net Pay', format: d3.format("$,.0f"), color: "#4ade80", negativeColor: "#f87171" },
        { key: 'driver_gross', label: 'Gross', format: d3.format("$,.0f"), color: "#60a5fa", negativeColor: "#f87171" },
        { key: 'rpm_all', label: 'RPM', format: d3.format("$.2f"), color: "#f87171", negativeColor: "#f87171" },
        { key: 'total_miles', label: 'Miles', format: d3.format(",.0f"), color: "#fbbf24", negativeColor: "#f87171" },
        { key: 'heatmap', label: '4W Movement' } // Renamed from "Heatmap"
    ];
    
    const switcher = chartContainer.append('div').attr('class', 'p-2 pb-4 text-center flex-shrink-0');
    metrics.forEach(metric => {
        switcher.append('button')
            .attr('class', `px-3 py-1 text-xs rounded-md mx-1 font-semibold ${appState.profiles.driverDeepDive.chartView === metric.key ? 'bg-teal-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`)
            .text(metric.label)
            .on('click', () => {
                appState.profiles.driverDeepDive.chartView = metric.key;
                renderModalChart_Profiles(historicalStubs);
            });
    });

    const vizContainer = chartContainer.append('div')
        .attr('id', 'profiles-modal-viz-subcontainer')
        .style('height', 'calc(100% - 40px)')
        .style('width', '100%');

    const activeMetric = metrics.find(m => m.key === appState.profiles.driverDeepDive.chartView);

    if (activeMetric.key === 'heatmap') {
        renderDriverHeatmap(vizContainer);
        return;
    }

    const chartData = historicalStubs.map(d => ({ 
        date: new Date(d.pay_date), 
        value: d[activeMetric.key] || 0 
    })).filter(d => d.date instanceof Date && !isNaN(d.date) && typeof d.value === 'number' && isFinite(d.value))
       .sort((a, b) => a.date - b.date);

    if (chartData.length < 1) {
        vizContainer.append('div').attr('class', 'flex items-center justify-center h-full text-gray-500 text-sm').text('No data available for this chart.');
        return;
    }
    
    const margin = { top: 10, right: 20, bottom: 30, left: 60 };
    const width = vizContainer.node().getBoundingClientRect().width - margin.left - margin.right;
    const height = vizContainer.node().getBoundingClientRect().height - margin.top - margin.bottom;

    const svg = vizContainer.append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleTime().domain(d3.extent(chartData, d => d.date)).range([0, width]);
    const yDomain = d3.extent(chartData, d => d.value);
    const yMin = yDomain[0] >= 0 ? 0 : yDomain[0] * 1.2;
    const yMax = yDomain[1] < 0 ? 0 : yDomain[1] * 1.2;
    const y = d3.scaleLinear().domain([yMin, yMax]).range([height, 0]).nice();

    svg.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(5).tickFormat(d3.timeFormat("%b %d")).tickSizeOuter(0)).attr("class", "axis-style");
    svg.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(activeMetric.format).tickSizeOuter(0)).attr("class", "axis-style");
    svg.selectAll(".domain").remove();
    svg.selectAll(".tick line").attr("stroke", "#4b5563");
    svg.selectAll(".tick text").attr("fill", "#d1d5db").attr("font-size", "11px").attr("font-weight", "500");

    svg.append("defs").append("clipPath").attr("id", "clip-above-profiles").append("rect").attr("width", width).attr("height", y(0));
    svg.append("defs").append("clipPath").attr("id", "clip-below-profiles").append("rect").attr("width", width).attr("height", height - y(0)).attr("y", y(0));
    const area = d3.area().x(d => x(d.date)).y0(y(0)).y1(d => y(d.value));
    svg.append("path").datum(chartData).attr("clip-path", "url(#clip-above-profiles)").attr("fill", activeMetric.color).style("opacity", 0.4).attr("d", area);
    svg.append("path").datum(chartData).attr("clip-path", "url(#clip-below-profiles)").attr("fill", activeMetric.negativeColor).style("opacity", 0.4).attr("d", area);
    if (yMin < 0 && yMax > 0) svg.append("line").attr("x1", 0).attr("x2", width).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", "#6b7280").attr("stroke-width", 1.5).attr("stroke-dasharray", "3,3");
    svg.append("path").datum(chartData).attr("fill", "none").attr("stroke", activeMetric.color).attr("stroke-width", 2.5).attr("d", d3.line().x(d => x(d.date)).y(d => y(d.value)));
    
    const tooltip = vizContainer.selectAll(".d3-tooltip").data([null]).join("div").attr("class", "d3-tooltip hidden");
    const focus = svg.append("g").attr("class", "focus").style("display", "none");
    focus.append("line").attr("class", "x-hover-line").attr("stroke", "#9ca3af").attr("stroke-width", 1).attr("stroke-dasharray", "3,3").attr("y1", 0).attr("y2", height);
    focus.append("circle").attr("r", 5).attr("stroke", "white").attr("stroke-width", 2);

    svg.append("rect")
        .attr("width", width)
        .attr("height", height)
        .style("fill", "none")
        .style("pointer-events", "all")
        .on("mouseover", () => { focus.style("display", null); tooltip.classed('hidden', false); })
        .on("mouseout", () => { focus.style("display", "none"); tooltip.classed('hidden', true); })
        .on("mousemove", (event) => {
            const bisectDate = d3.bisector(d => d.date).left;
            const [pointerX, pointerY] = d3.pointer(event);
            const x0 = x.invert(pointerX);
            const i = bisectDate(chartData, x0, 1);
            const d0 = chartData[i - 1], d1 = chartData[i];
            const d = (d1 && d0 && (x0 - d0.date > d1.date - x0)) ? d1 : (d0 || d1);
            if (!d) return;
        
            const focusX = x(d.date);
            const focusY = y(d.value);
            
            focus.attr("transform", `translate(${focusX}, 0)`);
            focus.select("circle").attr("transform", `translate(0, ${focusY})`).attr("fill", activeMetric.color);
            tooltip.html(`<strong>${d.date.toLocaleDateString('en-us', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</strong><br/>${activeMetric.label}: ${activeMetric.format(d.value)}`)
                .style("left", `${pointerX + 15}px`)
                .style("top", `${pointerY - 15}px`);
        })
}

export function calculateComplianceScores(dispatchers, allDispatchers) {
    const { weights } = appState.profiles.complianceSettings;
    const comparisonPool = allDispatchers && allDispatchers.length > 0 ? allDispatchers : dispatchers;
    
    // Recalculate wellness based on the new logic before scoring
    // The loop must run on the entire `comparisonPool`, not just the `dispatchers` list.
    comparisonPool.forEach(d => {
        const wellnessLoads = d.loads.filter(l => ['GOOD', 'FAIL', '-'].includes(l.wellness_fail));
        const successfulLoads = wellnessLoads.filter(l => l.wellness_fail === 'GOOD' || l.wellness_fail === '-').length;
        d.wellness = wellnessLoads.length > 0 ? (successfulLoads / wellnessLoads.length) * 100 : 0;
    });

    // --- FIX 2: Define metrics for calculation. Note 'medianTenure' is back as one item. ---
    const allMetrics = [
        { id: 'goodMoves', higherIsBetter: true },
        { id: 'badMoves', higherIsBetter: false },
        { id: 'hiddenMiles', higherIsBetter: false },
        { id: 'lowRpm', higherIsBetter: false },
        { id: 'tuesdayOpen', higherIsBetter: false }, 
        { id: 'missingPaperwork', higherIsBetter: false }, 
        { id: 'trailerDrops', higherIsBetter: false }, // More is worse
        { id: 'trailerRecoveries', higherIsBetter: true }, // More is better
        { id: 'calculatorActivity', higherIsBetter: true }, 
        { id: 'rcEntry', higherIsBetter: false }, // Lower minutes is better
        { id: 'overdueLoads', higherIsBetter: false },
        { id: 'wellness', higherIsBetter: true },
        { id: 'retention4w', higherIsBetter: true },
        { id: 'medianTenureOO', higherIsBetter: true }, // Keep separate for proportional scoring
        { id: 'medianTenureLOO', higherIsBetter: true } // Keep separate for proportional scoring
    ];

    const proportionalScores = {};

    allMetrics.forEach(metric => {
        // --- FIX 3A: Use null for missing values, not 0 ---
        const allValues = comparisonPool.map(d => d[metric.id] === null ? null : (d[metric.id] ?? null)).filter(v => v !== null);
        if (allValues.length === 0) {
            proportionalScores[metric.id] = {}; // No data for this metric
            return;
        }
        
        const maxValue = Math.max(...allValues, 1);
        
        const scores = {};
        comparisonPool.forEach(dispatcher => {
            const value = dispatcher[metric.id]; // This can be null
            if (value === null || value === undefined) {
                scores[dispatcher.name] = null; // Store null if no data
                return;
            }
            
            let score = 0;
            if (metric.id === 'wellness') {
                score = value;
            } else {
                const proportion = value / maxValue;
                score = metric.higherIsBetter ? proportion * 100 : (1 - proportion) * 100;
            }
            scores[dispatcher.name] = score;
        });
        proportionalScores[metric.id] = scores;
    });

    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
    if (totalWeight === 0) {
        return dispatchers.map(d => ({ ...d, complianceScore: 0 }));
    }

    return dispatchers.map(dispatcher => {
        let weightedScore = 0;
        let dynamicTotalWeight = 0; // <--- NEW: Track weight specific to this dispatcher

        // --- FIX 2: List of metrics for the *modal* (uses medianTenure, not OO/LOO) ---
        const settingMetrics = ['goodMoves', 'badMoves', 'hiddenMiles', 'lowRpm', 'tuesdayOpen', 'missingPaperwork', 'trailerDrops', 'trailerRecoveries', 'calculatorActivity', 'rcEntry', 'overdueLoads', 'wellness', 'retention4w', 'medianTenure'];

        for (const metricId of settingMetrics) {
            const weight = weights[metricId] || 0;
            if (weight === 0) continue;

            let finalScore = null;

            // --- FIX 3B: Special averaging logic for medianTenure ---
            if (metricId === 'medianTenure') {
                const scoreOO = proportionalScores['medianTenureOO'] ? proportionalScores['medianTenureOO'][dispatcher.name] : null;
                const scoreLOO = proportionalScores['medianTenureLOO'] ? proportionalScores['medianTenureLOO'][dispatcher.name] : null;

                // Check if scores are valid numbers (not null, not undefined)
                const isScoreOOValid = typeof scoreOO === 'number';
                const isScoreLOOValid = typeof scoreLOO === 'number';

                if (isScoreOOValid && isScoreLOOValid) {
                    finalScore = (scoreOO + scoreLOO) / 2; // Average if both exist
                } else if (isScoreOOValid) {
                    finalScore = scoreOO; // Use OO if only it exists
                } else if (isScoreLOOValid) {
                    finalScore = scoreLOO; // Use LOO if only it exists
                }
                // If neither is valid, finalScore remains null
            } else {
                // Standard logic for all other metrics
                if (proportionalScores[metricId] && proportionalScores[metricId][dispatcher.name] !== undefined) {
                    finalScore = proportionalScores[metricId][dispatcher.name];
                }
            }
            
            // Only add to weighted score if a valid score was calculated
            if (finalScore !== null) {
                weightedScore += (finalScore * weight);
                dynamicTotalWeight += weight; // <--- NEW: Only add weight if data exists
            }
        }
        
        // NEW: Divide by the dynamic weight instead of the global totalWeight
        const finalScore = dynamicTotalWeight > 0 ? (weightedScore / dynamicTotalWeight) : 0;
        return { ...dispatcher, complianceScore: finalScore };
    });
}

function renderComplianceSettingsModal(allDispatchers) {
    const modal = document.getElementById('profiles-compliance-settings-modal');
    if (!modal) return;

    modal.classList.toggle('hidden', !appState.profiles.complianceSettings.isModalOpen);
    if (!appState.profiles.complianceSettings.isModalOpen) return;

    const container = document.getElementById('compliance-weights-container');
    const totalEl = document.getElementById('compliance-total-weight');
    const weights = appState.profiles.complianceSettings.weights;

    const metrics = [
        { id: 'goodMoves', label: 'Good Moves' },
        { id: 'badMoves', label: 'Bad Moves' },
        { id: 'hiddenMiles', label: 'Hidden Miles' },
        { id: 'lowRpm', label: 'Low RPM Loads' },
        { id: 'tuesdayOpen', label: 'Tuesday Open' },
        { id: 'missingPaperwork', label: 'Missing Paperwork' },
        { id: 'trailerDrops', label: 'Drops' },
        { id: 'trailerRecoveries', label: 'Recoveries' },
        { id: 'calculatorActivity', label: 'Calculator Activity %' },
        { id: 'rcEntry', label: 'RC Entry (Min)' },
        { id: 'overdueLoads', label: 'Overdue Loads' },
        { id: 'wellness', label: 'Wellness %' },
        { id: 'retention4w', label: '4W Retention %' },
        { id: 'medianTenure', label: 'Median Tenure (Wks)' }, // <-- Reverted to one line
    ];

    container.innerHTML = metrics.map(metric => `
        <div class="grid grid-cols-2 gap-4 items-center">
            <label class="text-gray-300 text-right">${metric.label}</label>
            <div class="relative">
                <input type="number" min="0" max="100" step="1" value="${weights[metric.id]}" 
                       data-metric-id="${metric.id}" 
                       class="settings-input w-full compliance-input">
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">%</span>
            </div>
        </div>
    `).join('');

    const updateTotal = () => {
        const total = Object.values(appState.profiles.complianceSettings.weights).reduce((s, v) => s + v, 0);
        totalEl.textContent = `${total}%`;
        totalEl.classList.toggle('text-red-500', total !== 100);
        totalEl.classList.toggle('text-green-400', total === 100);
    };

    container.querySelectorAll('.compliance-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const metricId = e.target.dataset.metricId;
            let value = parseInt(e.target.value, 10);
            if (isNaN(value) || value < 0) value = 0;
            if (value > 100) value = 100;

            appState.profiles.complianceSettings.weights[metricId] = value;
            e.target.value = value;

            updateTotal();
            const { selectedCompany } = appState.profiles;
            let filteredDispatchers = allDispatchers;
            if (selectedCompany && selectedCompany !== 'All Companies') {
                 filteredDispatchers = allDispatchers.filter(d => d.company === selectedCompany);
            }
            renderDispatchTable(filteredDispatchers, allDispatchers);
        });
    });

    updateTotal();
}


function renderDriverHealthSettingsModal() {
    const modal = document.getElementById('profiles-driver-health-settings-modal');
    if (!modal) return;

    modal.classList.toggle('hidden', !appState.profiles.driverHealthSettings.isModalOpen);
    if (!appState.profiles.driverHealthSettings.isModalOpen) return;

    const container = document.getElementById('driver-health-weights-container');
    const totalEl = document.getElementById('driver-health-total-weight');
    const weights = appState.profiles.driverHealthSettings.weights;

    const metrics = [
        { id: 'highTolls', label: 'High Tolls' },
        { id: 'dispatcherHopper', label: 'Dispatcher Hopper' },
        { id: 'lowRpm', label: 'Low RPM' },
        { id: 'lowGross', label: 'Low Gross' },
        { id: 'lowNet', label: 'Low Net' },
        { id: 'heavyLoads', label: 'Heavy Loads' },
        { id: 'negative', label: 'Negative Balance' },
        { id: 'tenure', label: 'Tenure (New Hire/Veteran)' }, // <-- ADDED
    ];

    container.innerHTML = metrics.map(metric => `
        <div class="grid grid-cols-2 gap-4 items-center">
            <label class="text-gray-300 text-right">${metric.label}</label>
            <div class="relative">
                <input type="number" min="0" max="100" step="1" value="${weights[metric.id]}" 
                       data-metric-id="${metric.id}" 
                       class="settings-input w-full driver-health-input">
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">%</span>
            </div>
        </div>
    `).join('');

    const updateTotal = () => {
        const total = Object.values(appState.profiles.driverHealthSettings.weights).reduce((s, v) => s + v, 0);
        totalEl.textContent = `${total}%`;
        totalEl.classList.toggle('text-red-500', total !== 100);
        totalEl.classList.toggle('text-green-400', total === 100);
    };

    container.querySelectorAll('.driver-health-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const metricId = e.target.dataset.metricId;
            let value = parseInt(e.target.value, 10);
            if (isNaN(value) || value < 0) value = 0;
            if (value > 100) value = 100;

            appState.profiles.driverHealthSettings.weights[metricId] = value;
            e.target.value = value;

            updateTotal();
        });
    });

    updateTotal();
}

function renderDriverSettingsModal() {
    const modal = document.getElementById('profiles-driver-settings-modal');
    if (!modal) return;

    modal.classList.toggle('hidden', !appState.profiles.isDriverSettingsModalOpen);
    if (!appState.profiles.isDriverSettingsModalOpen || !appState.profiles.tempDriverHealthSettings) return;

    const contentContainer = document.getElementById('driver-settings-modal-content');
    const { flags, activeSettingTab } = appState.profiles.tempDriverHealthSettings;

    const tabs = [
        { id: 'highTolls', label: 'High Tolls', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />' },
        { id: 'dispatcherHopper', label: 'Dispatcher Hopper', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />' },
        { id: 'tenure', label: 'Tenure', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />' },
        { id: 'heavyLoads', label: 'Heavy Loads', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.096.428m3.095 2.074A5.983 5.983 0 0118.75 20.25m-13.5-14.78A48.416 48.416 0 0112 4.5c2.291 0 4.545.16 6.75.47m-13.5 0c-1.01.143-2.01.317-3 .52m3-.52l-2.62 10.726c-.122.499.106 1.028.589 1.202a5.989 5.989 0 002.096.428m-3.095 2.074A5.983 5.983 0 005.25 20.25" />' },
        { id: 'negative', label: 'Balance/PO', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />' },
        { id: 'lowPayMetrics', label: 'Low Pay Metrics', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V5.75A2.25 2.25 0 0018 3.5H6A2.25 2.25 0 003.75 5.75v12.5A2.25 2.25 0 006 20.25z" />' },
    ];
    
    const createSettingSection = (description, content) => `
        <div class="description">${description}</div>
        <div class="setting-controls">${content}</div>
    `;
    
    const createLookbackInput = (flagKey) => {
        const lookback = flags[flagKey].lookback;
        return `<div class="input-group compact">
            <label>Lookback Period</label>
            <div class="lookback-group">
                <select data-flag="${flagKey}" data-sub-setting="type" class="settings-select lookback-type-select">
                    <option value="allTime" ${lookback.type === 'allTime' ? 'selected' : ''}>All Time</option>
                    <option value="weeks" ${lookback.type === 'weeks' ? 'selected' : ''}>Weeks</option>
                </select>
                <input type="number" data-flag="${flagKey}" data-sub-setting="value" value="${lookback.value}" class="settings-input lookback-value-input" ${lookback.type === 'allTime' ? 'disabled' : ''}>
            </div>
        </div>`;
    };

    const createThresholdsWithOverrides = (flagKey, thresholdKey, labelText, step = "1", showLabel = true) => {
        const thresholds = flags[flagKey][thresholdKey];
        const availableOverrides = ['OO', 'LOO'].filter(c => !Object.keys(thresholds.by_contract).includes(c));
        return `<div class="input-group compact">
            ${showLabel ? `<label>${labelText}</label>` : ''}
            <input data-flag="${flagKey}" data-threshold-key="${thresholdKey}" data-threshold-type="default" type="number" step="${step}" value="${thresholds.default}" class="settings-input" placeholder="${labelText}">
            <div class="override-section">
                ${Object.entries(thresholds.by_contract).map(([contract, value]) => `
                    <div class="input-group compact override-row" data-contract="${contract}">
                        <label class="override-label">${contract} Override</label>
                        <div class="flex items-center">
                            <input data-flag="${flagKey}" data-threshold-key="${thresholdKey}" class="contract-value-input settings-input" type="number" step="${step}" value="${value}">
                            <button class="remove-override-btn" title="Remove override">&times;</button>
                        </div>
                    </div>
                `).join('')}
            </div>
            ${availableOverrides.length > 0 ? `<div class="relative mt-2">
                <button class="add-override-btn" data-flag="${flagKey}" data-threshold-key="${thresholdKey}">+ Add Contract Override</button>
                </div>` : ''}
        </div>`;
    };
    
    let accordionHTML = '';
    tabs.forEach(tab => {
        let panelContentHTML = '';
        switch(tab.id) {
            case 'highTolls':
                panelContentHTML = createSettingSection(
                    'Flag drivers in the top X% of estimated toll costs compared to the company average for the selected period.',
                    `<div class="setting-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;">
                        ${createLookbackInput('highTolls')}
                        ${createThresholdsWithOverrides('highTolls', 'thresholds', 'Top Percentile Threshold (%)')}
                        <div class="input-group compact">
                            <label>Min. Stubs</label>
                            <input type="number" data-flag="highTolls" data-setting="minStubs" value="${flags.highTolls.minStubs}" class="settings-input w-full">
                        </div>
                    </div>`
                );
                break;
            case 'dispatcherHopper':
                panelContentHTML = createSettingSection('Flag drivers who have worked with more than X different dispatchers.', `<div class="setting-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem;">${createLookbackInput('dispatcherHopper')}${createThresholdsWithOverrides('dispatcherHopper', 'thresholds', 'Min. Different Dispatchers')}</div>`);
                break;
            case 'tenure':
                panelContentHTML = createSettingSection(
                    'Flag new drivers or reward veterans based on their number of pay stubs.',
                    `<div class="setting-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                        ${createThresholdsWithOverrides('tenure', 'newHireThresholds', '"New Hire" if stubs <')}
                        ${createThresholdsWithOverrides('tenure', 'veteranThresholds', '"Veteran" if stubs >')}
                    </div>`
                );
                break;
            case 'heavyLoads':
                panelContentHTML = createSettingSection(
                    'Flag drivers whose average load weight is over a certain threshold.',
                    `<div class="setting-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;">
                        ${createLookbackInput('heavyLoads')}
                        ${createThresholdsWithOverrides('heavyLoads', 'thresholds', 'Avg. Weight Threshold (lbs)')}
                        <div class="input-group compact">
                            <label>Min. Loads</label>
                            <input type="number" data-flag="heavyLoads" data-setting="minLoads" value="${flags.heavyLoads.minLoads}" class="settings-input w-full">
                        </div>
                    </div>`
                );
                break;
            case 'negative':
                 panelContentHTML = createSettingSection(
                    'Flag drivers when their combined Balance and PO are negative.',
                    `<div class="setting-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem;">
                        ${createThresholdsWithOverrides('negative', 'thresholds', 'Combined Balance/PO Threshold ($)')}
                        <div class="input-group compact">
                            <label>Min. Stubs</label>
                            <input type="number" data-flag="negative" data-setting="minStubs" value="${flags.negative.minStubs}" class="settings-input w-full" placeholder="Min. Stubs">
                        </div>
                    </div>`
                );
                break;
            case 'lowPayMetrics':
                panelContentHTML = createSettingSection('Flag if X% of stubs in a period are below a threshold, given a minimum number of stubs.', `
                    <div class="low-pay-grid compact grid-cols-[0.75fr_1fr_2.5fr_1fr_1fr]"><div class="grid-header"></div>
                        <div class="grid-header">Lookback (Wks)</div>
                        <div class="grid-header">Threshold ($)</div>
                        <div class="grid-header">% of Stubs Below</div>
                        <div class="grid-header">Min. Stubs</div>
                        
                        <div class="metric-label">Low RPM</div>
                        <div class="input-group compact"><input type="number" data-flag="lowRpm" data-sub-setting="value" value="${flags.lowRpm.lookback.value}" class="settings-input"></div>
                        <div class="threshold-wrapper">${createThresholdsWithOverrides('lowRpm', 'thresholds', 'Default RPM ($/mi)', '0.01', false)}</div>
                        <div class="input-group compact"><input type="number" data-flag="lowRpm" data-setting="minPercentageOfStubs" value="${flags.lowRpm.minPercentageOfStubs}" class="settings-input"></div>
                        <div class="input-group compact"><input type="number" data-flag="lowRpm" data-setting="minStubs" value="${flags.lowRpm.minStubs}" class="settings-input"></div>
                        
                        <div class="metric-label">Low Gross</div>
                        <div class="input-group compact"><input type="number" data-flag="lowGross" data-sub-setting="value" value="${flags.lowGross.lookback.value}" class="settings-input"></div>
                        <div class="threshold-wrapper">${createThresholdsWithOverrides('lowGross', 'thresholds', 'Default Gross ($)', '1', false)}</div>
                        <div class="input-group compact"><input type="number" data-flag="lowGross" data-setting="minPercentageOfStubs" value="${flags.lowGross.minPercentageOfStubs}" class="settings-input"></div>
                        <div class="input-group compact"><input type="number" data-flag="lowGross" data-setting="minStubs" value="${flags.lowGross.minStubs}" class="settings-input"></div>

                        <div class="metric-label">Low Net</div>
                        <div class="input-group compact"><input type="number" data-flag="lowNet" data-sub-setting="value" value="${flags.lowNet.lookback.value}" class="settings-input"></div>
                        <div class="threshold-wrapper">${createThresholdsWithOverrides('lowNet', 'thresholds', 'Default Net ($)', '1', false)}</div>
                        <div class="input-group compact"><input type="number" data-flag="lowNet" data-setting="minPercentageOfStubs" value="${flags.lowNet.minPercentageOfStubs}" class="settings-input"></div>
                        <div class="input-group compact"><input type="number" data-flag="lowNet" data-setting="minStubs" value="${flags.lowNet.minStubs}" class="settings-input"></div>
                    </div>`);
                break;
        }

        accordionHTML += `
            <div class="accordion-item ${activeSettingTab === tab.id ? 'open' : ''}" data-tab-id="${tab.id}">
                <button class="accordion-header">
                    <span class="accordion-title">
                        <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">${tab.icon}</svg>
                        ${tab.label}
                    </span>
                    <svg class="accordion-arrow w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                </button>
                <div class="accordion-panel">
                    <div class="accordion-panel-content">
                        ${panelContentHTML}
                    </div>
                </div>
            </div>
        `;
    });

    contentContainer.innerHTML = accordionHTML;

    const openPanel = contentContainer.querySelector('.accordion-item.open .accordion-panel');
    if (openPanel) {
        requestAnimationFrame(() => {
            openPanel.style.maxHeight = openPanel.scrollHeight + 'px';
        });
    }
}





function initializeDriverSettingsModalEventListeners() {
    const modal = document.getElementById('profiles-driver-settings-modal');
    if (!modal || modal.dataset.listenersAttached === 'true') return;
    modal.dataset.listenersAttached = 'true';

    // Helper function to recalculate the open accordion's height
    const updateOpenAccordionHeight = () => {
        requestAnimationFrame(() => {
            const openItem = modal.querySelector('.accordion-item.open');
            if (openItem) {
                const panel = openItem.querySelector('.accordion-panel');
                if (panel) {
                    panel.style.maxHeight = panel.scrollHeight + 'px';
                }
            }
        });
    };

    // Main event listener for all actions within the modal
    modal.addEventListener('click', e => {
        const header = e.target.closest('.accordion-header');
        const removeBtn = e.target.closest('.remove-override-btn');
        const addOverrideBtn = e.target.closest('.add-override-btn');

        // --- Accordion Toggle Logic (FIXED) ---
        if (header) {
            // Check if the click was on the toggle switch itself. If so, do nothing here.
            // The 'change' event listener will handle the toggle action.
            if (e.target.closest('.toggle-switch-container')) {
                return;
            }

            const item = header.closest('.accordion-item');
            if (!item) return;

            const panel = item.querySelector('.accordion-panel');
            const isOpen = item.classList.contains('open');

            // Close all other items first
            document.querySelectorAll('#driver-settings-modal-content .accordion-item.open').forEach(openItem => {
                if (openItem !== item) {
                    openItem.classList.remove('open');
                    openItem.querySelector('.accordion-panel').style.maxHeight = null;
                }
            });

            // Then, toggle the clicked item
            if (isOpen) {
                item.classList.remove('open');
                panel.style.maxHeight = null; // Collapse it
                appState.profiles.tempDriverHealthSettings.activeSettingTab = null;
            } else {
                item.classList.add('open');
                panel.style.maxHeight = panel.scrollHeight + 'px'; // Expand to its content height
                appState.profiles.tempDriverHealthSettings.activeSettingTab = item.dataset.tabId;
            }
            return;
        }

        // --- Add/Remove Override Logic ---
        if (removeBtn) {
            const overrideRow = removeBtn.closest('.override-row');
            const flagKey = overrideRow.closest('.setting-controls, .threshold-wrapper').querySelector('[data-flag]').dataset.flag;
            const contract = overrideRow.dataset.contract;
            delete appState.profiles.tempDriverHealthSettings.flags[flagKey].thresholds.by_contract[contract];
            renderDriverSettingsModal();
            return;
        }
        
        if (addOverrideBtn) {
            document.querySelectorAll('.add-override-panel').forEach(p => p.remove());
            const flagKey = addOverrideBtn.dataset.flag;
            const thresholds = appState.profiles.tempDriverHealthSettings.flags[flagKey].thresholds;
            const availableOverrides = ['OO', 'LOO'].filter(c => !Object.keys(thresholds.by_contract).includes(c));
            if (availableOverrides.length === 0) return;

            const panel = document.createElement('div');
            panel.className = 'add-override-panel';
            panel.innerHTML = availableOverrides.map(c => `<div class="add-override-option" data-contract="${c}">${c}</div>`).join('');
            document.body.appendChild(panel);

            const rect = addOverrideBtn.getBoundingClientRect();
            panel.style.top = `${rect.bottom + window.scrollY + 4}px`;
            panel.style.left = `${rect.left + window.scrollX}px`;

            const handlePanelClick = (event) => {
                const option = event.target.closest('.add-override-option');
                if (option) {
                    const contract = option.dataset.contract;
                    const flagSettings = appState.profiles.tempDriverHealthSettings.flags[flagKey];
                    flagSettings.thresholds.by_contract[contract] = flagSettings.thresholds.default;
                    renderDriverSettingsModal();
                }
                panel.remove();
                document.removeEventListener('click', handlePanelClick, true);
            };

            setTimeout(() => {
                document.addEventListener('click', handlePanelClick, true);
            }, 0);
            return;
        }
    });

    // --- Input/Select Change Logic ---
    modal.addEventListener('change', e => {
        const target = e.target;
        const flagKey = target.dataset.flag;
        if (!flagKey) return;

        const flagSettings = appState.profiles.tempDriverHealthSettings.flags[flagKey];
        const isFloat = target.step === '0.01';
        const parse = isFloat ? parseFloat : parseInt;
        
        if (target.classList.contains('toggle-input')) {
            flagSettings.enabled = target.checked;
            const item = target.closest('.accordion-item');
            if (item) item.classList.toggle('is-disabled', !target.checked);
        } else if (target.classList.contains('lookback-type-select')) {
            flagSettings.lookback.type = target.value;
            renderDriverSettingsModal();
        } else if (target.classList.contains('lookback-value-input')) {
            flagSettings.lookback.value = parse(target.value) || 0;
        } else if (target.dataset.thresholdType === 'default') {
            flagSettings.thresholds.default = parse(target.value);
        } else if (target.classList.contains('contract-value-input')) {
            const contract = target.closest('.override-row').dataset.contract;
            flagSettings.thresholds.by_contract[contract] = parse(target.value);
        } else if (target.dataset.setting) {
             flagSettings[target.dataset.setting] = parse(target.value);
        } else if(target.dataset.subSetting) {
            flagSettings.lookback[target.dataset.subSetting] = parse(target.value);
        }

        updateOpenAccordionHeight();
    });
}


async function saveDriverHealthSettings() {
    // Commit the temporary settings to the actual application state
    appState.profiles.driverHealthSettings = JSON.parse(JSON.stringify(appState.profiles.tempDriverHealthSettings));
    appState.profiles.tempDriverHealthSettings = null; // Clear the temporary state

    try {
        const settingsToSave = {
            complianceSettings: appState.profiles.complianceSettings,
            driverHealthSettings: appState.profiles.driverHealthSettings,
            thresholdSettings: appState.profiles.thresholdSettings
        };
        await updateFleetHealthSettings(settingsToSave);
    } catch (error) {
        console.error("Failed to save settings:", error);
        alert(`Error saving settings: ${error.message}`);
    }

    appState.profiles.fleetHealthCache = {}; // Clear the cache to force recalculation
    appState.profiles.isDriverSettingsModalOpen = false;
    renderTeamProfileUI(); // Re-render the main UI to reflect the saved changes
}

const getThreshold = (thresholdsObject, contractType = 'default') => {
    // Use the specific contract threshold if it exists, otherwise use the default
    const contractKey = (contractType || 'LOO').toUpperCase(); // Default to LOO if undefined
    return thresholdsObject.by_contract[contractKey] ?? thresholdsObject.default;
};

function generateFlagTooltipText(label) {
    const { flags } = appState.profiles.driverHealthSettings;
    const { goodMove, lowRpm } = appState.profiles.thresholdSettings;

    // Helper to format thresholds including overrides
    const formatThresholdText = (thresholdSetting, unit = '', higherIsBetter = false, lowerIsBetter = false) => {
        if (!thresholdSetting || typeof thresholdSetting !== 'object') return 'N/A';
        const defaultVal = thresholdSetting.default;
        const ooOverride = thresholdSetting.by_contract?.['OO'];
        const looOverride = thresholdSetting.by_contract?.['LOO'];

        let text = `${higherIsBetter ? '>' : '<'} ${defaultVal.toLocaleString()}${unit}`; // Default
        if (ooOverride !== undefined && ooOverride !== defaultVal) {
            text += ` (OO: ${higherIsBetter ? '>' : '<'} ${ooOverride.toLocaleString()}${unit})`;
        }
        if (looOverride !== undefined && looOverride !== defaultVal) {
            text += ` (LOO: ${higherIsBetter ? '>' : '<'} ${looOverride.toLocaleString()}${unit})`;
        }
        return text;
    };

    const flagKey = Object.keys(flags).find(key =>
        flags[key].label === label || flags[key].positiveLabel === label
    );

    // Special cases first
    if (label === 'Good Moves' || label === 'Bad Moves') {
        const defaultThresh = goodMove.default;
        const ooThresh = goodMove.by_contract?.['OO'] ?? defaultThresh;
        const looThresh = goodMove.by_contract?.['LOO'] ?? defaultThresh;
        return `Counts moved Monday loads where driver's weekly gross (excl. load) was < $${ooThresh.toLocaleString()} (OO) or < $${looThresh.toLocaleString()} (LOO). 'Bad Moves' are >= threshold.`;
    }
    // MODIFIED a special case for the new Median Overdue metric
    if (label === 'Median Overdue') {
        return `The median number of overdue loads per dispatcher for the selected period. Shows the typical backlog size for a dispatcher in this group.`;
    }

    if (!flagKey || !flags[flagKey]) return `Definition for ${label} not found.`;

    const setting = flags[flagKey];
    const thresholdsExist = setting.thresholds && typeof setting.thresholds === 'object';
    const lookback = setting.lookback ? (setting.lookback.type === 'weeks' ? `${setting.lookback.value} wks` : 'All Time') : '';
    const minStubs = setting.minStubs ? ` (min ${setting.minStubs} stubs)` : '';
    const minLoads = setting.minLoads ? ` (min ${setting.minLoads} loads)` : '';

    switch (flagKey) {
        case 'negative':
            const negThresholdText = thresholdsExist ? formatThresholdText(setting.thresholds, '$', true) : 'N/A'; // Balance+PO > X
            return `Driver Balance + PO liability ${negThresholdText}${minStubs}.`;
        case 'highTolls':
            const tollsThresholdText = thresholdsExist ? `${setting.thresholds.default}%` : 'N/A'; // Only default % supported here
            return `Driver avg tolls in top ${tollsThresholdText} of drivers over ${lookback}${minStubs}.`;
        case 'dispatcherHopper':
            const dispThresholdText = thresholdsExist ? formatThresholdText(setting.thresholds, '', true) : 'N/A'; // > X dispatchers
            return `Driver worked with ${dispThresholdText} dispatchers over ${lookback}${minStubs}.`;
        case 'heavyLoads':
            const heavyThresholdText = thresholdsExist ? formatThresholdText(setting.thresholds, ' lbs', true) : 'N/A'; // > X lbs
            return `Driver avg load weight ${heavyThresholdText} over ${lookback}${minLoads}.`;
        case 'lowRpm':
        case 'lowGross':
        case 'lowNet':
            const metricThresholdText = thresholdsExist ? formatThresholdText(setting.thresholds, flagKey === 'lowRpm' ? '/mi' : '$') : 'N/A'; // < X
            const metricMinPercent = setting.minPercentageOfStubs;
            return `At least ${metricMinPercent}% of stubs over ${lookback} had ${setting.label} ${metricThresholdText}${minStubs}.`;
        case 'tenure':
            const newHireThresh = setting.newHireThresholds ? formatThresholdText(setting.newHireThresholds) : 'N/A'; // < X stubs
            const vetThresh = setting.veteranThresholds ? formatThresholdText(setting.veteranThresholds, '', true) : 'N/A'; // >= X stubs (formatted as > X-1)
            if (label === 'New Hire') {
                return `Driver has ${newHireThresh} total pay stubs with more then 0 miles.`;
            } else if (label === 'Veteran') {
                // Adjusting the veteran threshold text slightly for clarity
                let vetText = `Driver has ${vetThresh.replace('>', '>=')} total pay stubs with more then 0 miles.`;
                return vetText;
            }
            break;
        default:
            return `Definition for ${label} not set up yet.`;
    }
    return `Definition for ${label} not set up yet.`;
}

// --- FIX: Updated the entire renderTeamProfileUI function ---
function renderFlagSummary(drivers) { // 'drivers' is the already filtered list for the driver table
    const container = document.getElementById('fleet-health-flag-summary');
    if (!container) return;

    // Use the currently displayed dispatchers from the state
    const dispatchers = appState.profiles.currentTeamData?.dispatchers || [];
    if (!dispatchers) {
        container.innerHTML = ''; // Handle case where dispatchers aren't loaded yet
        return;
    }

    const allPossibleFlags = appState.profiles.driverHealthSettings.flags;
    const flagCounts = {};

    // Initialize counts for all possible flags
    Object.values(allPossibleFlags).forEach(flag => {
        flagCounts[flag.label] = { count: 0, color: flag.color };
        if (flag.positiveLabel) {
            flagCounts[flag.positiveLabel] = { count: 0, color: flag.positiveColor };
        }
    });

    // --- FIX 1: Count flags ONLY from the currently displayed drivers ---
    // The 'drivers' array passed to this function is already filtered by team, company, contract, search, etc.
    drivers.flatMap(d => d.flags).forEach(flag => {
        if (flagCounts[flag.text]) {
            flagCounts[flag.text].count++;
        }
    });
    // --- End FIX 1 ---

    // Good/Bad moves are still based on the displayed dispatchers
    flagCounts['Good Moves'] = { count: dispatchers.reduce((sum, d) => sum + d.goodMoves, 0), color: 'green' };
    flagCounts['Bad Moves'] = { count: dispatchers.reduce((sum, d) => sum + d.badMoves, 0), color: 'red' };

    const overdueColumnValues = dispatchers.map(d => d.overdueLoads || 0);
    const medianOverdueDays = overdueColumnValues.length > 0 ? calculateMedian(overdueColumnValues) : 0;
    
    // Use 'Median Overdue' as the key
    flagCounts['Median Overdue'] = { count: medianOverdueDays.toFixed(1), color: 'yellow' };
    // --- End MODIFIED Block ---

    const displayOrder = [
        'Balance', 'Low Net', 'Low Gross', 'Low RPM', 'Veteran', 'New Hire',
        'Heavy Loads', 'High Tolls', 'Hopper',
        'Median Overdue',
        'Good Moves', 'Bad Moves'
    ];

    const sortedFlags = Object.entries(flagCounts)
        .filter(([label]) => displayOrder.includes(label))
        .sort(([labelA], [labelB]) => displayOrder.indexOf(labelA) - displayOrder.indexOf(labelB));

    if (sortedFlags.length === 0) {
        container.innerHTML = '';
        return;
    }

    // Tooltip generation remains the same
    container.innerHTML = sortedFlags.map(([label, data]) => {
        const tooltipText = generateFlagTooltipText(label).replace(/"/g, '&quot;');
        return `
        <div class="flag-summary-item summary-tooltip-trigger" data-tooltip-text="${tooltipText}">
            <span class="flag-summary-count" style="color: var(--flag-color-${data.color}, '#e5e7eb');">${data.count}</span>
            <span class="flag-summary-label">${label}</span>
        </div>
        `;
    }).join('');

    // Re-initialize tooltip listeners for the summary bar if necessary
    // (Assuming initializeProfileEventListeners handles this or you call a specific function here)
    initializeSummaryTooltipListeners(); // Example: You might need a dedicated function
}

// You might need to extract the tooltip listener setup into its own function
// if it's not already handled within initializeProfileEventListeners
function initializeSummaryTooltipListeners() {
    const summaryBar = document.getElementById('fleet-health-flag-summary');
    let summaryTooltip = document.getElementById('summary-tooltip');

    if (!summaryTooltip) {
        summaryTooltip = document.createElement('div');
        summaryTooltip.id = 'summary-tooltip';
        summaryTooltip.className = 'fixed bg-gray-900 text-gray-200 text-xs rounded py-2 px-3 z-50 hidden pointer-events-none max-w-sm shadow-xl border border-gray-600 leading-relaxed';
        document.body.appendChild(summaryTooltip);
    }

    if (summaryBar && !summaryBar._tooltipListenersAttached) {
        summaryBar.addEventListener('mouseover', (e) => {
            const trigger = e.target.closest('.summary-tooltip-trigger');
            if (trigger && trigger.dataset.tooltipText) {
                summaryTooltip.innerHTML = trigger.dataset.tooltipText;
                summaryTooltip.classList.remove('hidden');
                summaryTooltip.classList.add('visible');
                positionTooltip(e, summaryTooltip);
            }
        });

        summaryBar.addEventListener('mousemove', (e) => {
            if (summaryTooltip.classList.contains('visible')) {
                positionTooltip(e, summaryTooltip);
            }
        });

        summaryBar.addEventListener('mouseout', (e) => {
            const trigger = e.target.closest('.summary-tooltip-trigger');
            if (trigger || !summaryBar.contains(e.relatedTarget)) {
                summaryTooltip.classList.remove('visible');
                summaryTooltip.classList.add('hidden');
            }
        });
        summaryBar._tooltipListenersAttached = true;
    }
}

// Ensure the positionTooltip function is accessible here (it might be in initializeProfileEventListeners already)
function positionTooltip(event, tooltipElement) {
    const offset = 15;
    const tooltipRect = tooltipElement.getBoundingClientRect();
    let left = event.pageX + offset;
    let top = event.pageY + offset;

    if (left + tooltipRect.width > window.innerWidth - offset) {
        left = event.pageX - tooltipRect.width - offset;
    }
    if (top + tooltipRect.height > window.innerHeight - offset) {
        top = event.pageY - tooltipRect.height - offset;
    }
    if (left < offset) left = offset;
    if (top < offset) top = offset;

    tooltipElement.style.left = `${left}px`;
    tooltipElement.style.top = `${top}px`;
}

function renderFranchiseFilterDropdown() {
    const container = document.getElementById('franchise-filter-container');
    if (!container) return;

    const existingDropdown = document.getElementById('franchise-filter-dropdown');
    if (existingDropdown) existingDropdown.remove();

    if (!appState.profiles.isFranchiseFilterOpen) return;

    const dropdown = document.createElement('div');
    dropdown.id = 'franchise-filter-dropdown';
    dropdown.className = 'absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 p-2';

    const { selectedWeek } = appState.profiles;
    const weeksAgo = selectedWeek === 'live' ? 0 : parseInt(selectedWeek.replace('week_', ''), 10);
    const { start, end } = getPayrollWeekDateRange(weeksAgo);

    const useLiveData = selectedWeek === 'live';
    const sourceData = useLiveData ? appState.profiles.liveData : appState.loads.historicalStubsData;
    const dateKey = useLiveData ? 'do_date' : 'pay_date';
    const franchiseKey = 'franchise_name';

    const activeFranchises = [...new Set(
        sourceData
            .filter(d => {
                if (!d[dateKey]) return false;
                const itemDate = new Date(d[dateKey]);
                return itemDate >= start && itemDate <= end && d[franchiseKey];
            })
            .map(d => d[franchiseKey])
    )].sort();

    const options = ['All Franchises', ...activeFranchises];

    let dropdownHTML = `<div class="text-xs uppercase text-gray-400 font-bold mb-2">Filter Franchise</div>`;

    options.forEach(opt => {
        const isActive = appState.profiles.selectedFranchise === opt;
        dropdownHTML += `
            <a href="#" data-filter="${opt}" class="franchise-filter-option flex items-center justify-between p-1.5 hover:bg-gray-600 rounded-md text-sm ${isActive ? 'text-teal-400 font-semibold' : 'text-gray-200'}">
                <span>${opt}</span>
                ${isActive ? '<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.052-.143z" clip-rule="evenodd" /></svg>' : ''}
            </a>
        `;
    });

    dropdown.innerHTML = dropdownHTML;
    container.appendChild(dropdown);

    dropdown.querySelectorAll('.franchise-filter-option').forEach(optionEl => {
        optionEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            appState.profiles.selectedFranchise = e.currentTarget.dataset.filter;
            appState.profiles.isFranchiseFilterOpen = false;
            renderTeamProfileUI();
        });
    });
}





// REPLACE the entire renderTeamProfileUI function in 1.DispatchHub/profiles/profiles_ui.js with this:

export const renderTeamProfileUI = async () => {
    const snapshotTrigger = document.getElementById('snapshot-trigger');
    if (snapshotTrigger) {
        const isSpecificTeamSelected = appState.profiles.selectedTeam !== 'ALL_TEAMS';
        const isHistoricalWeekSelected = appState.profiles.selectedWeek !== 'live';
        const isAllCompaniesSelected = appState.profiles.selectedCompany === 'All Companies';
        const isAllFranchisesSelected = appState.profiles.selectedFranchise === 'All Franchises';

        if (canViewSnapshot() && isSpecificTeamSelected && isHistoricalWeekSelected && isAllCompaniesSelected && isAllFranchisesSelected) {
            snapshotTrigger.style.display = 'flex';
        } else {
            snapshotTrigger.style.display = 'none';
        }
    }

    const profilesContent = document.getElementById('profiles-content');
    if (!profilesContent) return;

    if (!appState.profiles.liveData || appState.profiles.liveData.length === 0) {
        profilesContent.innerHTML = `<div class="flex items-center justify-center h-full"><div class="text-center"><div class="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-400 mx-auto"></div><p class="mt-4 text-gray-400">Loading Live Profile Data...</p></div></div>`;
        return;
    }
    
    const liveData = appState.profiles.liveData;
    const historicalStubs = appState.loads.historicalStubsData || [];
    const { allHistoricalData } = appState;
    const historicalDates = [...new Set(allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();

    const user = appState.auth.user;
    let allAvailableTeams = [];
    let dispatcherNameFromAccess = null;
    const isDispatcherRole = user && user.role === 'Dispatcher';
    const specialPrefixes = ['agnius', 'uros', 'miles', 'wayne', 'mubeen', 'vito'];
    const excludedNames = ['cletus spuckler', 'ralph wiggum', 'seymour skinner', 'med disp disp'];

    if (hasPermission(user, PERMISSIONS.VIEW_ALL_TEAMS)) {
        const teams = new Set();
        liveData.forEach(d => {
            if (d.team) {
                const teamLower = d.team.toLowerCase();
                const prefix = specialPrefixes.find(p => teamLower.startsWith(p));
                if (prefix) {
                    teams.add(prefix.charAt(0).toUpperCase() + prefix.slice(1));
                } else if (!excludedNames.includes(teamLower)) {
                    teams.add(d.team);
                }
            }
        });
        allAvailableTeams = [...teams].sort();
    } else if (isDispatcherRole) {
        if (Array.isArray(user.access) && user.access.length > 0) {
            dispatcherNameFromAccess = String(user.access[0]).trim();
        } else if (typeof user.access === 'string' && user.access.trim()) {
            dispatcherNameFromAccess = user.access.split(',')[0].trim();
        }
        if (dispatcherNameFromAccess) {
            const liveInfo = appState.profiles.liveDriverCountData.find(d => d.dispatcher_name?.toLowerCase() === dispatcherNameFromAccess.toLowerCase());
            if (liveInfo && liveInfo.dispatcher_team) {
                const teamLower = liveInfo.dispatcher_team.toLowerCase();
                const prefix = specialPrefixes.find(p => teamLower.startsWith(p));
                const teamToShow = prefix ? prefix.charAt(0).toUpperCase() + prefix.slice(1) : liveInfo.dispatcher_team;
                appState.profiles.selectedTeam = teamToShow;
                allAvailableTeams = [teamToShow];
            }
        }
    } else {
        const userAccessItems = (Array.isArray(user.access) ? user.access : String(user.access || '').split(','))
            .map(item => item.trim().toLowerCase())
            .filter(Boolean);

        if (userAccessItems.length > 0) {
            const accessibleTeams = new Set();
            const allData = [...liveData, ...allHistoricalData];
            allData.forEach(d => {
                const team = d.team || d.dispatcherTeam;
                const company = (d.company_name || '').toLowerCase();

                if (team && !excludedNames.includes(team.toLowerCase())) {
                    if (userAccessItems.includes(team.toLowerCase()) || (company && userAccessItems.includes(company))) {
                        const teamLower = team.toLowerCase();
                        const prefix = specialPrefixes.find(p => teamLower.startsWith(p));
                        if (prefix) {
                            accessibleTeams.add(prefix.charAt(0).toUpperCase() + prefix.slice(1));
                        } else {
                            accessibleTeams.add(team);
                        }
                    }
                }
            });
            allAvailableTeams = [...accessibleTeams].sort();
        }
    }

    if (!allAvailableTeams.includes(appState.profiles.selectedTeam) && appState.profiles.selectedTeam !== 'ALL_TEAMS') {
        // ** THIS IS THE FIX **
        // If user has full access OR access to multiple teams, default to 'ALL_TEAMS'.
        if (hasPermission(user, PERMISSIONS.VIEW_ALL_TEAMS) || allAvailableTeams.length > 1) {
            appState.profiles.selectedTeam = 'ALL_TEAMS';
        } else if (allAvailableTeams.length > 0) { // If only one team is available, default to it.
            appState.profiles.selectedTeam = allAvailableTeams[0];
        } else { // Fallback if no teams are available
            appState.profiles.selectedTeam = 'ALL_TEAMS';
        }
    }
    
    const { selectedWeek, selectedTeam, contractTypeFilter, selectedCompany, selectedFranchise } = appState.profiles;
    const cacheKey = `${selectedWeek}-${selectedTeam}-${contractTypeFilter}-${selectedCompany}-${selectedFranchise}-${dispatcherNameFromAccess || ''}`;

   if (appState.profiles.fleetHealthCache[cacheKey]) {
        const { teamData, currentKpis, prevWeekKpis, allAvailableTeams, allProcessedDispatchersForCompliance } = appState.profiles.fleetHealthCache[cacheKey];
        appState.profiles.currentTeamData = teamData;
        appState.profiles.currentKpis = currentKpis;
        appState.profiles.allProcessedDispatchers = allProcessedDispatchersForCompliance;
        profilesContent.innerHTML = `
            <div id="profiles-header" class="flex-shrink-0 flex justify-between items-center"></div>
            <div class="profile-tables-wrapper">
                <div id="profiles-dispatch-breakdown" class="profile-table-container"></div>
                <div id="fleet-health-flag-summary" class="flex-shrink-0"></div>
                <div id="profiles-driver-health" class="profile-table-container">
                    <div id="profiles-driver-toolbar" class="flex-shrink-0 flex flex-wrap items-center justify-between gap-4 mb-3"></div>
                    <div id="profiles-driver-table-container" class="flex-grow overflow-auto"></div>
                </div>
            </div>
        `;
        // --- START: Apply Saved Table Heights (AFTER rendering in CACHE path) ---
        // Now call all the render functions for the different parts of the UI
        renderProfileHeader(teamData, allAvailableTeams, currentKpis, prevWeekKpis);
        renderFlagSummary(teamData.drivers); // <-- Use teamData.drivers from cache
        renderDispatchTable(teamData.dispatchers, allProcessedDispatchersForCompliance, appState.profiles.selectedWeek);
        renderDriverToolbar(teamData);
        renderDriverTable(teamData.drivers);
        renderDriverSettingsModal(); // Renders the Flag Settings modal structure
        renderComplianceSettingsModal(allProcessedDispatchersForCompliance); // Renders compliance modal structure
        renderKpiSettingsDropdown(); // Renders KPI visibility dropdown
        renderContractTypeFilterDropdown(); // Renders contract filter dropdown
        renderCompanyFilterDropdown(); // Renders company filter dropdown
        renderFranchiseFilterDropdown(); // Renders franchise filter dropdown
        renderThresholdSettingsModal(); // Renders threshold settings modal
        renderDriverHealthSettingsModal(); // Renders risk weight settings modal
        renderDriverDeepDiveModal_Profiles(); // Renders the deep dive modal structure
        renderSaveFilterModal(); // Renders the save filter modal structure
        renderTeamSnapshot(); // Renders snapshot panel

        initializeProfileEventListeners(); // Initialize listeners FIRST

        // Apply Saved Table Heights logic (moved inside the cache block as well)
        const topPanelCached = document.getElementById('profiles-dispatch-breakdown');
        const bottomPanelCached = document.getElementById('profiles-driver-health');
        if (topPanelCached && bottomPanelCached) {
            requestAnimationFrame(() => {
                // Always apply minimum heights first for stability
                topPanelCached.style.minHeight = '100px';
                bottomPanelCached.style.minHeight = '200px';

                if (appState.profiles.dispatchTableFlexBasis) {
                    // Apply saved height
                    topPanelCached.style.flexBasis = appState.profiles.dispatchTableFlexBasis;
                    topPanelCached.style.flexGrow = '0'; // Prevent growing
                    topPanelCached.style.flexShrink = '0'; // Prevent shrinking

                    // Let bottom panel fill remaining space
                    bottomPanelCached.style.flexBasis = '0';
                    bottomPanelCached.style.flexGrow = '1';
                    bottomPanelCached.style.flexShrink = '1'; // Allow shrinking if needed
                } else {
                    // If no saved height, explicitly reset to default-like behavior
                    topPanelCached.style.flexBasis = ''; // Rely on default or CSS basis
                    topPanelCached.style.flexGrow = '1'; // Allow growing
                    topPanelCached.style.flexShrink = '1'; // Allow shrinking
                    bottomPanelCached.style.flexBasis = '';
                    bottomPanelCached.style.flexGrow = '1';
                    bottomPanelCached.style.flexShrink = '1';
                }
            });
        }
        // --- END: Apply Saved Table Heights (CACHE path) ---

        return; // Keep the return statement
    }
    
    const weeksAgo = selectedWeek === 'live' ? 0 : parseInt(selectedWeek.replace('week_', ''), 10);
    const targetStubDate = getRankingDateForProfileWeek(weeksAgo, historicalDates);
    const useLiveData = selectedWeek === 'live' || !targetStubDate;
    const dispatcherRanks = calculateDispatcherRanksForPeriod(selectedWeek, contractTypeFilter);

    if (isNaN(weeksAgo)) {
        profilesContent.innerHTML = `<p class="p-4 text-center text-red-400">Invalid date selection.</p>`;
        return;
    }

    const { start: currentStart, end: currentEnd } = getPayrollWeekDateRange(weeksAgo);
    
    const filterDataByDateAndTeam = (source, start, end, isForLiveData, ignoreFilters = false) => {
        let dateFilteredSource = isForLiveData
            ? source.filter(d => d.do_date && new Date(d.do_date) >= start && new Date(d.do_date) <= end)
            : source.filter(d => {
                if (!d.pay_date) return false;
                const payDate = new Date(d.pay_date);
                if (isNaN(payDate.getTime())) return false;
                const weekEnd = new Date(end);
                weekEnd.setUTCDate(weekEnd.getUTCDate() + 3);
                return payDate.toISOString().split('T')[0] === weekEnd.toISOString().split('T')[0];
            });
    
        if (ignoreFilters) {
            return dateFilteredSource;
        }
    
        const teamKey = isForLiveData ? 'team' : 'stub_team';
        const companyKey = 'company_name';
        const franchiseKey = isForLiveData ? 'franchise_name' : 'franchise_name';
    
        if (selectedTeam === 'ALL_TEAMS') {
            if (!hasPermission(user, PERMISSIONS.VIEW_ALL_TEAMS)) {
                const userAccessItems = (Array.isArray(user.access) ? user.access : String(user.access || '').split(','))
                    .map(item => String(item).trim().toLowerCase())
                    .filter(Boolean);
    
                dateFilteredSource = dateFilteredSource.filter(d => {
                    const itemTeam = d[teamKey]?.toLowerCase();
                    if (!itemTeam) return false;
                    if (userAccessItems.includes(itemTeam)) return true;
                    
                    const prefix = specialPrefixes.find(p => itemTeam.startsWith(p));
                    if (prefix && d[companyKey]) {
                        const compositeName = `${prefix} ${d[companyKey].toLowerCase()}`;
                        if (userAccessItems.includes(compositeName)) return true;
                    }
                    
                    return false;
                });
            }
        } else { 
            const teamLower = selectedTeam.toLowerCase();
            if (specialPrefixes.includes(teamLower)) {
                dateFilteredSource = dateFilteredSource.filter(d => d[teamKey] && d[teamKey].toLowerCase().startsWith(teamLower));
    
                if (!hasPermission(user, PERMISSIONS.VIEW_ALL_TEAMS) && selectedCompany === 'All Companies') {
                    const userAccessItems = (Array.isArray(user.access) ? user.access : String(user.access || '').split(','))
                        .map(item => String(item).trim().toLowerCase())
                        .filter(Boolean);
    
                    const accessibleCompanies = userAccessItems
                        .filter(item => item.startsWith(teamLower))
                        .map(item => item.substring(teamLower.length).trim());
    
                    if (accessibleCompanies.length > 0) {
                        dateFilteredSource = dateFilteredSource.filter(d => 
                            d[companyKey] && accessibleCompanies.includes(d[companyKey].toLowerCase())
                        );
                    }
                }
            } else {
                dateFilteredSource = dateFilteredSource.filter(d => d[teamKey] === selectedTeam);
            }
        }
    
        if (selectedCompany && selectedCompany !== 'All Companies') {
            dateFilteredSource = dateFilteredSource.filter(d => d[companyKey] === selectedCompany);
        }
        if (selectedFranchise && selectedFranchise !== 'All Franchises') {
            dateFilteredSource = dateFilteredSource.filter(d => d[franchiseKey] === selectedFranchise);
        }
        
        return dateFilteredSource;
    };
    
    let currentFilteredData = filterDataByDateAndTeam(useLiveData ? liveData : historicalStubs, currentStart, currentEnd, useLiveData);
    if (dispatcherNameFromAccess) {
        // FIX: Added String(...) wrap for safety
        currentFilteredData = currentFilteredData.filter(d => String((useLiveData ? d.dispatcher : d.stub_dispatcher) || "").toLowerCase() === String(dispatcherNameFromAccess).toLowerCase());
    }

    const allDriversInViewUnfiltered = [...new Set(currentFilteredData.map(d => useLiveData ? d.driver : d.driver_name).filter(Boolean))];
    const driverEquipmentMap = historicalStubs.reduce((acc, stub) => {
        if (stub.driver_name && stub.trailer_type) {
            if (!acc[stub.driver_name] || new Date(stub.pay_date) > new Date(acc[stub.driver_name].pay_date)) {
                acc[stub.driver_name] = { trailer_type: stub.trailer_type, pay_date: stub.pay_date };
            }
        }
        return acc;
    }, {});

    let processedDrivers = allDriversInViewUnfiltered.map((name, index) => {
        let driverData = currentFilteredData.filter(d => (useLiveData ? d.driver : d.driver_name) === name && d.status !== 'Canceled');
        const firstEntry = driverData[0] || {};
        let equipment = '-';
        const equipmentInfo = driverEquipmentMap[name];
        if (equipmentInfo) {
            const trailerType = equipmentInfo.trailer_type.toUpperCase();
            if (trailerType === 'REEFER') equipment = 'R'; else if (trailerType === 'FLATBED') equipment = 'F'; else if (trailerType === 'VAN') equipment = 'V';
        }
        const liveFlags = calculateLiveFlagsForDriver(name, historicalStubs, allDriversInViewUnfiltered);
        const contractType = firstEntry.contract_type ? firstEntry.contract_type.toUpperCase() : 'LOO';
        const contract = contractType === 'OO' ? 'OO' : 'LOO';
        const statusInfo = appState.profiles.contractStatusData.find(s => s.driver_name === name);
        const driver = {
            id: 1000 + index, name, company: firstEntry.company_name || '-',
            dispatcher: useLiveData ? firstEntry.dispatcher : firstEntry.stub_dispatcher || '-',
            team: useLiveData ? firstEntry.team : firstEntry.stub_team || '-',
            franchise: firstEntry.franchise_name || '-',
            contract, equipment, 
            status: statusInfo ? statusInfo.contract_status : 'Unknown',
            flags: liveFlags,
            gross: useLiveData ? driverData.reduce((s, l) => s + ((parseFloat(String(l.price).replace(/,/g, '')) || 0) - (parseFloat(String(l.cut).replace(/,/g, '')) || 0)), 0) : driverData.reduce((s, l) => s + (parseFloat(String(l.driver_gross).replace(/,/g, '')) || 0), 0),
            margin: useLiveData ? driverData.reduce((s, l) => s + (parseFloat(String(l.cut).replace(/,/g, '')) || 0), 0) : driverData.reduce((s, l) => s + (parseFloat(String(l.margin).replace(/,/g, '')) || 0), 0),
            miles: useLiveData ? driverData.reduce((s, l) => s + (parseFloat(String(l.trip_miles).replace(/,/g, '')) || 0), 0) : driverData.reduce((s, l) => s + (parseFloat(String(l.total_miles).replace(/,/g, '')) || 0), 0),
            rpm: useLiveData ? (driverData.reduce((s, l) => s + (parseFloat(String(l.trip_miles).replace(/,/g, '')) || 0), 0) > 0 ? driverData.reduce((s, l) => s + (parseFloat(String(l.price).replace(/,/g, '')) || 0), 0) / driverData.reduce((s, l) => s + (parseFloat(String(l.trip_miles).replace(/,/g, '')) || 0), 0) : 0) : (parseFloat(String(firstEntry.rpm_all).replace(/,/g, '')) || 0),
        };
        driver.risk = calculateDropRisk(driver);
        return driver;
    });
    
    if (dispatcherNameFromAccess) {
        // FIX: Added String(...) wrap to prevent crash if driver.dispatcher is undefined
        processedDrivers = processedDrivers.filter(driver => String(driver.dispatcher || "").toLowerCase() === String(dispatcherNameFromAccess).toLowerCase());
    }
    if (contractTypeFilter !== 'all') {
        processedDrivers = processedDrivers.filter(d => (contractTypeFilter === 'oo' ? d.contract === 'OO' : d.contract !== 'OO'));
    }

    const weekFilteredLiveDataForDispatch = liveData.filter(d => d.do_date && new Date(d.do_date) >= currentStart && new Date(d.do_date) <= currentEnd);
    const currentSourceForNames = useLiveData ? appState.profiles.liveDriverCountData : filterDataByDateAndTeam(historicalStubs, currentStart, currentEnd, false, true);
    const currentNameKey = useLiveData ? 'dispatcher_name' : 'stub_dispatcher';
    const allDispatcherNamesForCurrentWeek = [...new Set(currentSourceForNames.map(d => d[currentNameKey]).filter(Boolean))];

    // --- PRE-CALCULATION FOR RETENTION ---
    // Map every active driver in the current week to their current dispatcher.
    // This helps us check if a historical driver has moved to *any* dispatcher this week.
    // FIX: Sort loads by date (ascending) so the reduce function captures the MOST RECENT dispatcher.
    const allCurrentWeekLoads = liveData
        .filter(d => d.do_date && new Date(d.do_date) >= currentStart && new Date(d.do_date) <= currentEnd && d.status !== 'Canceled')
        .sort((a, b) => new Date(a.do_date) - new Date(b.do_date));

    const currentDriverDispatcherMap = allCurrentWeekLoads.reduce((acc, load) => {
        if (load.driver && load.dispatcher) {
            acc[load.driver] = load.dispatcher;
        }
        return acc;
    }, {});

    // Pre-calculate enriched stubs once for the 4W table generation
    const enrichedHistoricalStubs = getEnrichedStubs(historicalStubs);

    const masterDispatcherList = allDispatcherNamesForCurrentWeek.map((name, index) => {
        const wellnessLoads = weekFilteredLiveDataForDispatch.filter(d => d.dispatcher === name && ['GOOD', 'FAIL', '-'].includes(d.wellness_fail));
        const successfulLoads = wellnessLoads.filter(l => l.wellness_fail === 'GOOD' || l.wellness_fail === '-').length;
        const wellness = wellnessLoads.length > 0 ? (successfulLoads / wellnessLoads.length) * 100 : 0;
        const liveDriversForDispatcher = appState.profiles.liveDriverCountData.filter(d => d.dispatcher_name && d.dispatcher_name.trim().toLowerCase() === name.trim().toLowerCase());
        const allTrucks = liveDriversForDispatcher.length;
        const ooTrucks = liveDriversForDispatcher.filter(d => d.contract_type === 'OO').length;
        const looTrucks = allTrucks - ooTrucks;
        let loadsForStats = weekFilteredLiveDataForDispatch.filter(d => d.dispatcher === name);
        const movedLoads = loadsForStats.filter(d => d.moved_monday === 'Moved Monday Load');
        const goodMoveThresholds = appState.profiles.thresholdSettings.goodMove;
        const goodMoves = movedLoads.filter(load => (load.driver_gross_without_moved || 0) < (goodMoveThresholds.by_contract[load.contract_type] ?? goodMoveThresholds.default)).length;
        const firstLiveDriverRecord = appState.profiles.liveDriverCountData.find(d => d.dispatcher_name && d.dispatcher_name.trim().toLowerCase() === name.trim().toLowerCase());
        const ranks = dispatcherRanks.get(name) || { rank1w: null, rank4w: null };

        // --- 4W RETENTION CALCULATION (UPDATED with Enrichment) ---
        
        // 1. Determine 4-Week Window
        const targetPayDate = new Date(currentEnd);
        targetPayDate.setUTCDate(currentEnd.getUTCDate() + 3); // Thursday
        targetPayDate.setUTCHours(23, 59, 59, 999); // End of day

        // Calculate start date for 4-week window (Current + 3 previous weeks)
        // We subtract 21 days to capture exactly 4 weekly pay dates (0, -7, -14, -21 days)
        const fourWeeksAgoStart = new Date(targetPayDate);
        fourWeeksAgoStart.setDate(fourWeeksAgoStart.getDate() - 21);
        fourWeeksAgoStart.setUTCHours(0, 0, 0, 0);

        // 2. Build the Pool using ENRICHED stubs
        const poolStubs = enrichedHistoricalStubs.filter(s => {
            const pDate = new Date(s.pay_date);
            const isDateMatch = pDate >= fourWeeksAgoStart && pDate <= targetPayDate;
            const isDispatcherMatch = s.stub_dispatcher === name; 
            const status = (s.retention_status || '').trim();
            
            // FIX: Include 'Start' in BOTH Live and Historical views.
            // If a driver 'Started' with JJ Kelb last week and 'Transferred' to Andrew Osa this week,
            // JJ Kelb should take the hit. We must include 'Start' stubs in the pool to track this.
            const isStatusMatch = status === 'Active' || status === 'Terminated' || status === 'Start';
            
            return isDateMatch && isDispatcherMatch && isStatusMatch;
        });

        // FIX 2: Ensure historicalPool is defined!
        const historicalPool = new Set(poolStubs.map(s => s.driver_name));

        // 3. Determine Status
        let retainedCount = 0;
        const retentionDetails = { retained: [], terminated: [], transferred: [] };

        historicalPool.forEach(driverName => {
            let isTerminated = false;
            let isTransferred = false;

            // Helper to find the most recent stub for this driver from the ENRICHED global list
            // We need this to determine who "owned" the driver when they were terminated
            const getLastKnownStub = () => {
                return enrichedHistoricalStubs
                    .filter(s => s.driver_name === driverName)
                    .sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date))[0];
            };

            if (useLiveData) {
                // LIVE VIEW: Use current contract status
                const statusInfo = appState.profiles.contractStatusData.find(c => c.driver_name === driverName);
                
                if (statusInfo && statusInfo.contract_status === 'Terminated') {
                    // FIX: Check if they were terminated while with THIS dispatcher, or someone else.
                    const lastStub = getLastKnownStub();
                    // If the last known dispatcher on a stub is NOT this dispatcher, they transferred out before terminating.
                    if (lastStub && lastStub.stub_dispatcher && lastStub.stub_dispatcher !== name) {
                        isTransferred = true;
                        retentionDetails.transferred.push({ name: driverName, to: lastStub.stub_dispatcher });
                    } else {
                        isTerminated = true;
                    }
                } else {
                    // Transfer Check: Driver is active, but check if they moved
                    let currentDispatcher = currentDriverDispatcherMap[driverName];

                    // Fallback to official roster if not in this week's loads
                    if (!currentDispatcher) {
                        const liveRecord = appState.profiles.liveDriverCountData.find(d => d.driver_name === driverName);
                        if (liveRecord && liveRecord.dispatcher_name) {
                            currentDispatcher = liveRecord.dispatcher_name;
                        }
                    }

                    if (currentDispatcher && currentDispatcher !== name) {
                        isTransferred = true;
                        retentionDetails.transferred.push({ name: driverName, to: currentDispatcher });
                    }
                }
            } else {
                // HISTORICAL VIEW: Use Stubs Data
                const driverStubsInWindow = enrichedHistoricalStubs.filter(s => 
                    s.driver_name === driverName &&
                    new Date(s.pay_date) >= fourWeeksAgoStart && 
                    new Date(s.pay_date) <= targetPayDate
                ).sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date));

                if (driverStubsInWindow.length > 0) {
                    const lastStub = driverStubsInWindow[0];
                    
                    if ((lastStub.retention_status || '').trim() === 'Terminated') {
                        // FIX: Only count as terminated for THIS dispatcher if they were the one on the stub
                        if (lastStub.stub_dispatcher === name) {
                            isTerminated = true;
                        } else {
                            // If the termination stub belongs to someone else, it counts as a transfer for 'name'
                            isTransferred = true;
                            retentionDetails.transferred.push({ name: driverName, to: lastStub.stub_dispatcher });
                        }
                    } else if (lastStub.stub_dispatcher !== name) {
                        isTransferred = true;
                        retentionDetails.transferred.push({ name: driverName, to: lastStub.stub_dispatcher });
                    }
                }
            }

            if (isTerminated) {
                retentionDetails.terminated.push(driverName);
            } else if (isTransferred) {
                // Already handled in logic above
            } else {
                retainedCount++;
                retentionDetails.retained.push(driverName);
            }
        });

        const retention4w = historicalPool.size > 0 ? (retainedCount / historicalPool.size) * 100 : null;

        return {
            id: index + 1, name, loads: loadsForStats,
            company: firstLiveDriverRecord?.company_name || '-', team: firstLiveDriverRecord?.dispatcher_team || '-',
            allTrucks, ooTrucks, looTrucks,
            goodMoves, badMoves: movedLoads.length - goodMoves,
            hiddenMiles: loadsForStats.filter(d => d.hidden_miles === 'Hidden Miles Found!').length,
            lowRpm: loadsForStats.filter(d => d.rpm_all < getLowRpmThreshold(d.contract_type)).length,
            overdueLoads: appState.profiles.overdueLoadsData
                .filter(ol => {
                    if (ol.dispatcher !== name || !ol.deliveryDate) return false;
                    const deliveryDate = new Date(ol.deliveryDate);
                    return deliveryDate >= currentStart && deliveryDate <= currentEnd;
                })
                .reduce((sum, ol) => sum + (ol.daysPastDO || 0), 0),
                tuesdayOpen: (appState.profiles.tuesdayOpenData || []).filter(d => {
                if (d.dispatch !== name) return false;
                // Date Logic: If it's Tuesday, shift it back 1 day (to Monday) to include it in the week ending Monday.
                const dDate = new Date(d.date);
                const shiftBack = dDate.getUTCDay() === 2 ? 1 : 0; // 2 = Tuesday
                dDate.setUTCDate(dDate.getUTCDate() - shiftBack);
                
                return dDate >= currentStart && dDate <= currentEnd;
            }).length,
            missingPaperwork: (appState.profiles.missingPaperworkData || []).filter(d => {
                if (d.dispatch !== name) return false;
                const dDate = new Date(d.do_date);
                return dDate >= currentStart && dDate <= currentEnd;
            }).length,
            // Calculator Activity Logic
            ...(() => {
                const activityData = appState.profiles.calculatorActivityData || [];
                let daysVisited = 0;
                const activityDetails = [];
                // Iterate through the 7 days of the payroll week
                for (let i = 0; i < 7; i++) {
                    const day = new Date(currentStart);
                    day.setUTCDate(day.getUTCDate() + i);
                    const dayString = day.toISOString().split('T')[0];
                    
                    const record = activityData.find(d => {
                        if (d.dispatcher !== name) return false;
                        return new Date(d.date).toISOString().split('T')[0] === dayString;
                    });
                    
                    const minutes = record ? (parseFloat(record.minutes) || 0) : 0;
                    if (minutes > 0) daysVisited++;
                    activityDetails.push({ date: day, minutes });
                }
                return {
                    calculatorActivity: (daysVisited / 7) * 100,
                    calculatorActivityDetails: activityDetails
                };
            })(),
            // Calculate RC Entry
            rcEntry: (() => {
                const entries = (appState.profiles.rcEntryData || [])
                    .filter(d => d.dispatcher === name && d.date && new Date(d.date) >= currentStart && new Date(d.date) <= currentEnd)
                    .map(d => parseFloat(d.entry_minutes)).filter(m => !isNaN(m));
                return entries.length > 0 ? calculateMedian(entries) : null;
            })(),

            // We'll calculate arrays first
            trailerDropsDetails: (appState.profiles.trailerDropsData || []).filter(d => {
                if (d.droppedByDispatcher !== name) return false;
                if (!d.dropTime) return false;
                const dDate = new Date(d.dropTime);
                return dDate >= currentStart && dDate <= currentEnd;
            }),
            trailerRecoveriesDetails: (appState.profiles.trailerDropsData || []).filter(d => {
                if (d.recoveredByDispatcher !== name) return false;
                if (!d.recoveryTime) return false;
                const rDate = new Date(d.recoveryTime);
                return rDate >= currentStart && rDate <= currentEnd;
            }),
            // Then return counts as the main properties
            get trailerDrops() { return this.trailerDropsDetails.length; },
            get trailerRecoveries() { return this.trailerRecoveriesDetails.length; },
            newStarts: new Set(loadsForStats.filter(d => d.new_start === 'NEW START').map(l => l.driver)).size,
            canceled: loadsForStats.filter(d => d.status === 'Canceled').length,
            rank1w: ranks.rank1w, rank4w: ranks.rank4w,
            retention4w: retention4w, 
            retentionDetails: retentionDetails, // Store details for tooltip
            wellness: wellness.toFixed(0)
        };
    });

   // --- START: NEW POINT-IN-TIME MEDIAN TENURE LOGIC ---
    
    // FIX: Create a GLOBAL list of drivers for the current period to ensure tenure is calculated for ALL dispatchers,
    // regardless of the current view filters. This ensures Compliance Scores remain consistent.
    const globalDataForTenure = filterDataByDateAndTeam(useLiveData ? liveData : historicalStubs, currentStart, currentEnd, useLiveData, true);
    const globalDriversForTenure = [...new Set(globalDataForTenure.map(d => useLiveData ? d.driver : d.driver_name).filter(Boolean))].map(name => {
        const entry = globalDataForTenure.find(d => (useLiveData ? d.driver : d.driver_name) === name);
        return {
            name: name,
            dispatcher: useLiveData ? entry.dispatcher : entry.stub_dispatcher,
            contract: (entry.contract_type || 'LOO').toUpperCase() === 'OO' ? 'OO' : 'LOO'
        };
    });

    // Pre-calculate DISPATCHER-SPECIFIC tenure for ALL drivers (excluding 0 miles)
    const historicalStubsData = appState.loads.historicalStubsData || [];
    const dispatcherSpecificTenureMap = historicalStubsData.reduce((acc, stub) => {
        if (stub.driver_name && stub.stub_dispatcher && stub.total_miles && parseFloat(stub.total_miles) > 0 && stub.pay_date) {
            const driverName = stub.driver_name;
            const dispatcherName = stub.stub_dispatcher;
            
            if (!acc[driverName]) {
                acc[driverName] = {};
            }
            if (!acc[driverName][dispatcherName]) {
                acc[driverName][dispatcherName] = [];
            }
            acc[driverName][dispatcherName].push(new Date(stub.pay_date));
        }
        return acc;
    }, {});

    // Now, sort all the date arrays once
    Object.values(dispatcherSpecificTenureMap).forEach(driverMap => {
        Object.values(driverMap).forEach(dateArray => {
            dateArray.sort((a, b) => a - b); // Sort dates chronologically
        });
    });

    appState.profiles.dispatcherSpecificTenureMap = dispatcherSpecificTenureMap;

    // Get the end date for the *selected* week. This is our "point-in-time".
    const { end: periodEnd } = getPayrollWeekDateRange(weeksAgo);
    const pointInTimeDate = new Date(periodEnd);
    pointInTimeDate.setUTCDate(pointInTimeDate.getUTCDate() + 3); // Get the Thursday pay date for comparison
    if (selectedWeek === 'live') {
        pointInTimeDate.setFullYear(pointInTimeDate.getFullYear() + 10);
    }

    // --- START: New +1 Live Week Tenure Logic ---
    let activeDriverSet = new Set();
    if (selectedWeek === 'live') {
        const { start: currentWeekStart, end: currentWeekEnd } = getPayrollWeekDateRange(0);
        appState.profiles.liveData.forEach(load => {
            if (load.driver && load.do_date && load.status !== 'Canceled') {
                const doDate = new Date(load.do_date);
                if (doDate >= currentWeekStart && doDate <= currentWeekEnd) {
                    activeDriverSet.add(load.driver);
                }
            }
        });
    }

    // Calculate median tenure for each dispatcher and ADD it to the master list
    masterDispatcherList.forEach(dispatcher => {
        const dispatcherName = dispatcher.name;
        // FIX: Use the global driver list here instead of processedDrivers
        const dispatcherDriversInView = globalDriversForTenure
            .filter(driver => driver.dispatcher === dispatcherName);

        const getTenureList = (contractType) => {
            const drivers = (contractType === 'OO')
                ? dispatcherDriversInView.filter(d => d.contract === 'OO')
                : dispatcherDriversInView.filter(d => d.contract !== 'OO');
                
            return drivers.map(driver => {
                    const driverName = driver.name;
                    const driverTenuresMap = dispatcherSpecificTenureMap[driverName];
                    const allStubDates = (driverTenuresMap && driverTenuresMap[dispatcherName]) ? driverTenuresMap[dispatcherName] : [];
                    
                    const pointInTimeStubs = allStubDates.filter(stubDate => stubDate <= pointInTimeDate);
                    let tenureWeeks = pointInTimeStubs.length;

                    if (selectedWeek === 'live' && activeDriverSet.has(driverName)) {
                        const lastStubDate = allStubDates.length > 0 ? allStubDates[allStubDates.length - 1] : null;
                        if (!lastStubDate || lastStubDate < pointInTimeDate) {
                            tenureWeeks += 1;
                        }
                    }
                    
                    return tenureWeeks;
                })
                .filter(tenure => tenure > 0);
        };

        const ooTenures = getTenureList('OO');
        const looTenures = getTenureList('LOO');

        dispatcher.medianTenureOO = ooTenures.length > 0 ? calculateMedian(ooTenures) : null;
        dispatcher.medianTenureLOO = looTenures.length > 0 ? calculateMedian(looTenures) : null;
    });
    // --- END: NEW POINT-IN-TIME MEDIAN TENURE LOGIC ---
    

    const allProcessedDispatchersForCompliance = calculateComplianceScores(masterDispatcherList, masterDispatcherList);
    appState.profiles.allProcessedDispatchers = allProcessedDispatchersForCompliance;
    
    // --- START: CORRECTED FILTERING LOGIC ---
    let dispatchersToDisplay;

    if (isDispatcherRole) {
        // For a dispatcher, the list is ONLY their own entry.
        if (dispatcherNameFromAccess) {
            dispatchersToDisplay = allProcessedDispatchersForCompliance.filter(d => d.name.toLowerCase() === dispatcherNameFromAccess.toLowerCase());
        } else {
            dispatchersToDisplay = []; // No access name, show nothing.
        }
        if (dispatchersToDisplay.length > 0) {
           appState.profiles.selectedDispatcherId = dispatchersToDisplay[0].id;
        }
    } else if (!hasPermission(user, PERMISSIONS.VIEW_ALL_TEAMS)) {
        // For other restricted roles (Team Lead, Operations)
        const userAccessItems = (Array.isArray(user.access) ? user.access : String(user.access || '').split(','))
            .map(item => String(item).trim().toLowerCase())
            .filter(Boolean);

        dispatchersToDisplay = allProcessedDispatchersForCompliance.filter(d => {
            const dispatcherTeam = d.team?.toLowerCase();
            if (!dispatcherTeam) return false;

            // Check for simple team access (e.g., "SMT")
            if (userAccessItems.includes(dispatcherTeam)) return true;

            // Check for composite team access (e.g., "Agnius AmongUs")
            const prefix = specialPrefixes.find(p => dispatcherTeam.startsWith(p));
            if (prefix && d.company) {
                const compositeName = `${prefix} ${d.company.toLowerCase()}`;
                if (userAccessItems.includes(compositeName)) return true;
            }
            
            return false;
        });
    } else {
        // For Admins or users with full team view permission
        dispatchersToDisplay = allProcessedDispatchersForCompliance;
    }

    // Now, apply the UI-driven filters ON TOP of the permission-filtered list
    if (contractTypeFilter !== 'all') {
        dispatchersToDisplay = dispatchersToDisplay.filter(d => contractTypeFilter === 'oo' ? d.ooTrucks > 0 : d.looTrucks > 0);
    }
    if (selectedCompany && selectedCompany !== 'All Companies') {
        dispatchersToDisplay = dispatchersToDisplay.filter(d => d.company === selectedCompany);
    }
    if (selectedFranchise && selectedFranchise !== 'All Franchises') {
        dispatchersToDisplay = dispatchersToDisplay.filter(disp => disp.loads.some(load => load.franchise_name === selectedFranchise));
    }
    if (selectedTeam && selectedTeam !== 'ALL_TEAMS') {
        const teamLower = selectedTeam.toLowerCase();
        if (specialPrefixes.includes(teamLower)) {
            dispatchersToDisplay = dispatchersToDisplay.filter(d => d.team && d.team.toLowerCase().startsWith(teamLower));
        } else {
            dispatchersToDisplay = dispatchersToDisplay.filter(d => d.team === selectedTeam);
        }
    }
    // --- END: CORRECTED FILTERING LOGIC ---

    const teamData = {
        teamName: selectedTeam === 'ALL_TEAMS' ? 'All Teams' : selectedTeam,
        weekLabel: getProfilePayrollWeek(weeksAgo).label,
        companies: [...new Set(liveData.map(d => d.company_name).filter(Boolean))],
        dispatchers: dispatchersToDisplay,
        drivers: processedDrivers
    };
    appState.profiles.currentTeamData = teamData;
    
    const prevWeeksAgo = weeksAgo + 1;
    const { start: prevStartForFunc, end: prevEndForFunc } = getPayrollWeekDateRange(prevWeeksAgo);
    const useLiveDataForPrev = prevWeeksAgo === 0 || !getRankingDateForProfileWeek(prevWeeksAgo, historicalDates);

    const prevSourceForNames = useLiveDataForPrev ? appState.profiles.liveDriverCountData : filterDataByDateAndTeam(historicalStubs, prevStartForFunc, prevEndForFunc, false, true);
    const prevNameKey = useLiveDataForPrev ? 'dispatcher_name' : 'stub_dispatcher';
    const allDispatcherNamesForPrevWeek = [...new Set(prevSourceForNames.map(d => d[prevNameKey]).filter(Boolean))];

    console.log("%c[FLEET HEALTH] Prev Week Universe:", "color: orange; font-weight: bold;", allDispatcherNamesForPrevWeek);

    const weekFilteredLiveDataForDispatch_PREV = liveData.filter(d => d.do_date && new Date(d.do_date) >= prevStartForFunc && new Date(d.do_date) <= prevEndForFunc);
    
    // --- PREV WEEK CALCULATION DATE TARGETS ---
    const prevTargetPayDate = new Date(prevEndForFunc);
    prevTargetPayDate.setUTCDate(prevEndForFunc.getUTCDate() + 3); // Thursday
    prevTargetPayDate.setUTCHours(23, 59, 59, 999);
    const prevFourWeeksAgoStart = new Date(prevTargetPayDate);
    prevFourWeeksAgoStart.setDate(prevFourWeeksAgoStart.getDate() - 21);
    prevFourWeeksAgoStart.setUTCHours(0, 0, 0, 0);

    const masterDispatcherList_PREV = allDispatcherNamesForPrevWeek.map(name => {
        const wellnessLoads = weekFilteredLiveDataForDispatch_PREV.filter(d => d.dispatcher === name && ['GOOD', 'FAIL', '-'].includes(d.wellness_fail));
        const successfulLoads = wellnessLoads.filter(l => l.wellness_fail === 'GOOD' || l.wellness_fail === '-').length;
        const wellness = wellnessLoads.length > 0 ? (successfulLoads / wellnessLoads.length) * 100 : 0;
        const loadsForStats = weekFilteredLiveDataForDispatch_PREV.filter(d => d.dispatcher === name);
        const movedLoads = loadsForStats.filter(d => d.moved_monday === 'Moved Monday Load');
        const goodMoveThresholds = appState.profiles.thresholdSettings.goodMove;
        const goodMoves = movedLoads.filter(load => (load.driver_gross_without_moved || 0) < (goodMoveThresholds.by_contract[load.contract_type] ?? goodMoveThresholds.default)).length;
        const firstLiveDriverRecord = appState.profiles.liveDriverCountData.find(d => d.dispatcher_name && d.dispatcher_name.trim().toLowerCase() === name.trim().toLowerCase());

        // 1. Overdue Loads & Tuesday Open (Previous Week)
        const overdueLoads = appState.profiles.overdueLoadsData
            .filter(ol => {
                if (ol.dispatcher !== name || !ol.deliveryDate) return false;
                const deliveryDate = new Date(ol.deliveryDate);
                return deliveryDate >= prevStartForFunc && deliveryDate <= prevEndForFunc;
            })
            .reduce((sum, ol) => sum + (ol.daysPastDO || 0), 0);

            const tuesdayOpen = (appState.profiles.tuesdayOpenData || []).filter(d => {
                if (d.dispatch !== name) return false;
                // Date Logic: If it's Tuesday, shift it back 1 day (to Monday)
                const dDate = new Date(d.date);
                const shiftBack = dDate.getUTCDay() === 2 ? 1 : 0; 
                dDate.setUTCDate(dDate.getUTCDate() - shiftBack);
    
                return dDate >= prevStartForFunc && dDate <= prevEndForFunc;
            }).length;
    
            const missingPaperwork = (appState.profiles.missingPaperworkData || []).filter(d => {
                if (d.dispatch !== name) return false;
                const dDate = new Date(d.do_date);
                return dDate >= prevStartForFunc && dDate <= prevEndForFunc;
            }).length;

            // Previous Week Calculator Activity
        let prevDaysVisited = 0;
        const prevActivityData = appState.profiles.calculatorActivityData || [];
        for (let i = 0; i < 7; i++) {
            const day = new Date(prevStartForFunc);
            day.setUTCDate(day.getUTCDate() + i);
            const dayString = day.toISOString().split('T')[0];
            
            const record = prevActivityData.find(d => {
                if (d.dispatcher !== name) return false;
                return new Date(d.date).toISOString().split('T')[0] === dayString;
            });
            if (record && (parseFloat(record.minutes) || 0) > 0) prevDaysVisited++;
        }
        const calculatorActivity = (prevDaysVisited / 7) * 100;

        const trailerDrops = (appState.profiles.trailerDropsData || []).filter(d => {
            if (d.droppedByDispatcher !== name) return false;
            if (!d.dropTime) return false;
            const dDate = new Date(d.dropTime);
            return dDate >= prevStartForFunc && dDate <= prevEndForFunc;
        }).length;

        const trailerRecoveries = (appState.profiles.trailerDropsData || []).filter(d => {
            if (d.recoveredByDispatcher !== name) return false;
            if (!d.recoveryTime) return false;
            const rDate = new Date(d.recoveryTime);
            return rDate >= prevStartForFunc && rDate <= prevEndForFunc;
        }).length;

        const prevRcEntries = (appState.profiles.rcEntryData || [])
            .filter(d => d.dispatcher === name && d.date && new Date(d.date) >= prevStartForFunc && new Date(d.date) <= prevEndForFunc)
            .map(d => parseFloat(d.entry_minutes)).filter(m => !isNaN(m));
        const rcEntry = prevRcEntries.length > 0 ? calculateMedian(prevRcEntries) : null;

        // 2. Retention (Previous 4 Weeks)
        const poolStubs = enrichedHistoricalStubs.filter(s => {
            const pDate = new Date(s.pay_date);
            const isDateMatch = pDate >= prevFourWeeksAgoStart && pDate <= prevTargetPayDate;
            const isDispatcherMatch = s.stub_dispatcher === name; 
            const status = (s.retention_status || '').trim();
            return isDateMatch && isDispatcherMatch && (status === 'Active' || status === 'Terminated' || status === 'Start');
        });
        const historicalPool = new Set(poolStubs.map(s => s.driver_name));
        let retainedCount = 0;
        historicalPool.forEach(driverName => {
            // Get most recent stub strictly within the previous window
            const driverStubsInWindow = enrichedHistoricalStubs.filter(s => 
                s.driver_name === driverName &&
                new Date(s.pay_date) >= prevFourWeeksAgoStart && 
                new Date(s.pay_date) <= prevTargetPayDate
            ).sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date));

            if (driverStubsInWindow.length > 0) {
                const lastStub = driverStubsInWindow[0];
                const status = (lastStub.retention_status || '').trim();
                // Retained if: Not Terminated on THIS dispatcher, and Not Transferred (Dispatcher mismatch)
                if (status !== 'Terminated' && lastStub.stub_dispatcher === name) {
                    retainedCount++;
                }
            }
        });
        const retention4w = historicalPool.size > 0 ? (retainedCount / historicalPool.size) * 100 : null;

        // 3. Tenure (Previous Week Snapshot)
        // Use the global dispatcherSpecificTenureMap we created earlier
        const dispatcherSpecificTenureMap = appState.profiles.dispatcherSpecificTenureMap || {};
        const getTenureList = (contractType) => {
            // Get all drivers who had a stub with this dispatcher in the past (global pool from tenure map)
            // Filter to those who had a stub specifically in the previous week window
            const driversWithStubs = enrichedHistoricalStubs.filter(s => 
                s.stub_dispatcher === name &&
                (contractType === 'OO' ? s.contract_type === 'OO' : s.contract_type !== 'OO') &&
                new Date(s.pay_date) >= prevStartForFunc && // Optimization: roughly verify they existed recently
                new Date(s.pay_date) <= prevTargetPayDate // but map lookup is safer
            ).map(s => s.driver_name);
            
            const uniqueDrivers = [...new Set(driversWithStubs)];

            return uniqueDrivers.map(driverName => {
                const driverTenuresMap = dispatcherSpecificTenureMap[driverName];
                const allStubDates = (driverTenuresMap && driverTenuresMap[name]) ? driverTenuresMap[name] : [];
                const pointInTimeStubs = allStubDates.filter(stubDate => stubDate <= prevTargetPayDate);
                return pointInTimeStubs.length;
            }).filter(t => t > 0);
        };

        const ooTenures = getTenureList('OO');
        const looTenures = getTenureList('LOO');

        return {
            name, loads: loadsForStats,
            company: firstLiveDriverRecord?.company_name || '-', team: firstLiveDriverRecord?.dispatcher_team || '-',
            goodMoves, badMoves: movedLoads.length - goodMoves,
            hiddenMiles: loadsForStats.filter(d => d.hidden_miles === 'Hidden Miles Found!').length,
            lowRpm: loadsForStats.filter(d => d.rpm_all < getLowRpmThreshold(d.contract_type)).length,
            wellness: wellness.toFixed(0),
            overdueLoads,
            tuesdayOpen,
            trailerDrops,
            trailerRecoveries,
            missingPaperwork,
            calculatorActivity,
            rcEntry,
            retention4w: retention4w !== null ? retention4w : 0,
            medianTenureOO: ooTenures.length > 0 ? calculateMedian(ooTenures) : null,
            medianTenureLOO: looTenures.length > 0 ? calculateMedian(looTenures) : null
        };
    });
    
    const allProcessedDispatchers_PREV = calculateComplianceScores(masterDispatcherList_PREV, masterDispatcherList_PREV);

    
    
    let dispatchersToDisplay_PREV = allProcessedDispatchers_PREV;
    if (contractTypeFilter !== 'all') {
        const liveCounts = appState.profiles.liveDriverCountData;
        dispatchersToDisplay_PREV = dispatchersToDisplay_PREV.filter(disp => {
            const liveInfo = liveCounts.filter(d => d.dispatcher_name === disp.name);
            const oo = liveInfo.filter(d => d.contract_type === 'OO').length;
            const loo = liveInfo.length - oo;
            return contractTypeFilter === 'oo' ? oo > 0 : loo > 0;
        });
    }
    if (selectedCompany && selectedCompany !== 'All Companies') { dispatchersToDisplay_PREV = dispatchersToDisplay_PREV.filter(d => d.company === selectedCompany); }
    if (selectedFranchise && selectedFranchise !== 'All Franchises') { dispatchersToDisplay_PREV = dispatchersToDisplay_PREV.filter(disp => disp.loads.some(load => load.franchise_name === selectedFranchise)); }
    if (selectedTeam && selectedTeam !== 'ALL_TEAMS') {
        const teamLower = selectedTeam.toLowerCase();
        if (specialPrefixes.includes(teamLower)) {
            dispatchersToDisplay_PREV = dispatchersToDisplay_PREV.filter(d => d.team && d.team.toLowerCase().startsWith(teamLower));
        } else {
            dispatchersToDisplay_PREV = dispatchersToDisplay_PREV.filter(d => d.team === selectedTeam);
        }
    }
    if (dispatcherNameFromAccess) { dispatchersToDisplay_PREV = dispatchersToDisplay_PREV.filter(d => d.name.toLowerCase() === dispatcherNameFromAccess.toLowerCase()); }

    const prevWeekTeamDataObject = { ...teamData, dispatchers: dispatchersToDisplay_PREV };
    let prevWeekFilteredData = filterDataByDateAndTeam(useLiveDataForPrev ? liveData : historicalStubs, prevStartForFunc, prevEndForFunc, useLiveDataForPrev);
    if (dispatcherNameFromAccess) { 
        // FIX: Added String(...) wrap for safety
        prevWeekFilteredData = prevWeekFilteredData.filter(d => String((useLiveDataForPrev ? d.dispatcher : d.stub_dispatcher) || "").toLowerCase() === String(dispatcherNameFromAccess).toLowerCase()); 
    }
    const prevWeekDrivers = [...new Set(prevWeekFilteredData.map(d => useLiveDataForPrev ? d.driver : d.driver_name).filter(Boolean))].map(name => ({ name }));

    const currentKpis = calculateKpiData(currentFilteredData, useLiveData, processedDrivers, historicalStubs, contractTypeFilter, teamData, weeksAgo);
    const prevWeekKpis = calculateKpiData(prevWeekFilteredData, useLiveDataForPrev, prevWeekDrivers, historicalStubs, contractTypeFilter, prevWeekTeamDataObject, prevWeeksAgo);
    
    appState.profiles.currentKpis = currentKpis; 

    appState.profiles.fleetHealthCache[cacheKey] = {
        teamData,
        currentKpis,
        prevWeekKpis,
        allAvailableTeams,
        allProcessedDispatchersForCompliance
    };

    profilesContent.innerHTML = `
        <div id="profiles-header" class="flex-shrink-0 flex justify-between items-center"></div>
        <div class="profile-tables-wrapper">
            <div id="profiles-dispatch-breakdown" class="profile-table-container"></div>
            <div id="fleet-health-flag-summary" class="flex-shrink-0"></div>
            <div id="profiles-driver-health" class="profile-table-container">
                <div id="profiles-driver-toolbar" class="flex-shrink-0 flex flex-wrap items-center justify-between gap-4 mb-3"></div>
                <div id="profiles-driver-table-container" class="flex-grow overflow-auto"></div>
            </div>
        </div>
    `;

    renderProfileHeader(teamData, allAvailableTeams, currentKpis, prevWeekKpis);
    renderFlagSummary(processedDrivers);
    renderDispatchTable(dispatchersToDisplay, allProcessedDispatchersForCompliance, selectedWeek);
    renderDriverToolbar(teamData);
    renderDriverTable(teamData.drivers); // Pass processedDrivers here too
    renderDriverSettingsModal();
    renderComplianceSettingsModal(allProcessedDispatchersForCompliance);
    renderKpiSettingsDropdown();
    renderContractTypeFilterDropdown();
    renderCompanyFilterDropdown();
    renderFranchiseFilterDropdown();
    renderThresholdSettingsModal();
    renderDriverHealthSettingsModal();
    renderDriverDeepDiveModal_Profiles();
    renderSaveFilterModal();
    renderTeamSnapshot(); // Render snapshot panel also in non-cached path

    // --- Apply Saved Table Heights (Non-cached path - DUPLICATE THE LOGIC HERE) ---
    const topPanelNonCached = document.getElementById('profiles-dispatch-breakdown');
    const bottomPanelNonCached = document.getElementById('profiles-driver-health');
    if (topPanelNonCached && bottomPanelNonCached) {
        requestAnimationFrame(() => {
            // Always apply minimum heights first for stability
            topPanelNonCached.style.minHeight = '100px';
            bottomPanelNonCached.style.minHeight = '200px';

            if (appState.profiles.dispatchTableFlexBasis) {
                // Apply saved height
                topPanelNonCached.style.flexBasis = appState.profiles.dispatchTableFlexBasis;
                topPanelNonCached.style.flexGrow = '0'; // Prevent growing
                topPanelNonCached.style.flexShrink = '0'; // Prevent shrinking

                // Let bottom panel fill remaining space
                bottomPanelNonCached.style.flexBasis = '0';
                bottomPanelNonCached.style.flexGrow = '1';
                bottomPanelNonCached.style.flexShrink = '1'; // Allow shrinking if needed
            } else {
                // If no saved height, explicitly reset to default-like behavior
                topPanelNonCached.style.flexBasis = ''; // Rely on default or CSS basis
                topPanelNonCached.style.flexGrow = '1'; // Allow growing
                topPanelNonCached.style.flexShrink = '1'; // Allow shrinking
                bottomPanelNonCached.style.flexBasis = '';
                bottomPanelNonCached.style.flexGrow = '1';
                bottomPanelNonCached.style.flexShrink = '1';
            }
        });
    }
    // --- END Apply Saved Table Heights (Non-cached path) ---

    initializeProfileEventListeners(); // Initialize listeners AFTER non-cached rendering too
}; // End of renderTeamProfileUI function


function renderDispatchTable(dispatchersToDisplay, allDispatchers, selectedWeek) {
    const componentContainer = document.getElementById('profiles-dispatch-breakdown');
    if (!componentContainer) return;

    const teamData = appState.profiles.currentTeamData;
    const franchiseText = appState.profiles.selectedFranchise === 'All Franchises' ? '' : ` for ${appState.profiles.selectedFranchise}`;
    const title = teamData ? `Dispatch Breakdown for ${teamData.teamName}${franchiseText}` : 'Dispatch Breakdown';

    // --- START: Search Filtering Logic ---
    // Note: dispatchersToDisplay already has complianceScore calculated from renderTeamProfileUI.
    // We do NOT recalculate it here to ensure consistency across views.
    const searchTerm = appState.profiles.dispatcherSearchTerm.toLowerCase();
    let dispatchersWithScores = dispatchersToDisplay;
    
    if (searchTerm) {
        dispatchersWithScores = dispatchersWithScores.filter(d => 
            d.name.toLowerCase().includes(searchTerm)
        );
    }
    // --- END: Search Filtering Logic ---
    
    const { sortConfig, columnOrder, visibleColumnIds, pinnedLeftColumns, pinnedRightColumns } = appState.profiles.dispatchTable;
    const selectedDispatcherId = appState.profiles.selectedDispatcherId;
    
    let visibleColumns = columnOrder
        .map(id => dispatchTableColumns.find(c => c.id === id))
        .filter(col => col && visibleColumnIds.includes(col.id));

    if (appState.profiles.selectedTeam === 'ALL_TEAMS') {
        const companyIndex = visibleColumns.findIndex(c => c.id === 'company');
        const insertionIndex = companyIndex > -1 ? companyIndex : 1; 
        if (!visibleColumns.some(c => c.id === 'team')) {
            visibleColumns.splice(insertionIndex, 0, { id: 'team', label: 'Team', type: 'string' });
        }
    }

    dispatchersWithScores.sort((a, b) => {
        const valA = a[sortConfig.key];
        const valB = b[sortConfig.key];
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        if (typeof valA === 'string') {
            return sortConfig.direction === 'ascending' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else {
            return sortConfig.direction === 'ascending' ? valA - valB : valB - valA;
        }
    });

    const getSortIcon = (key) => {
        if (sortConfig.key !== key) return '';
        return sortConfig.direction === 'ascending' ? ' ▲' : ' ▼';
    };

    componentContainer.innerHTML = `
        <div class="flex justify-between items-center mb-3">
            <div class="flex items-center">
                <h3 class="text-lg font-bold text-gray-200">${title}</h3>
                <input type="text" id="dispatcher-search-input" class="profile-table-search" placeholder="Search dispatcher..." value="${appState.profiles.dispatcherSearchTerm}">
            </div>
            <div class="flex items-center gap-2">
            ${isAdmin() ? `
            <button id="compliance-settings-btn" class="toolbar-btn !p-2" title="Compliance Score Settings">
                <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" /></svg>
            </button>
            <button id="dispatch-threshold-settings-btn" class="toolbar-btn !p-2" title="Threshold Settings">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924-1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
            </button>
            ` : ''}
                <div class="relative">
                    <button id="dispatch-table-settings-btn" class="toolbar-btn !p-2" title="Visible Columns">
                        <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3.375 6.375h17.25M3.375 12h17.25m-17.25 5.625h17.25" /></svg>
                    </button>
                    <div id="dispatch-column-settings-dropdown" class="absolute right-0 mt-2 w-72 bg-gray-700 border border-gray-600 rounded-lg shadow-xl z-50 hidden p-2"></div>
                </div>
            </div>
        </div>
        <div id="profiles-dispatch-table-container" class="overflow-auto">
             <table class="w-full text-sm text-left text-gray-400">
             <thead class="text-xs text-gray-300 uppercase sticky top-0 bg-gray-900 z-20">
             <tr id="dispatch-table-head">
                 ${visibleColumns.map(col => {
                     const isPinnedLeft = pinnedLeftColumns.includes(col.id);
                     const isPinnedRight = pinnedRightColumns.includes(col.id);
                     const stickyClasses = isPinnedLeft ? 'sticky sticky-left' : isPinnedRight ? 'sticky sticky-right' : '';
                     
                     let tooltipAttrs = '';
                     let extraClasses = '';
                     if (col.tooltip) {
                         tooltipAttrs = `data-tooltip-html="${col.tooltip}"`;
                         extraClasses = 'dispatch-tooltip-trigger'; 
                     }

                     return `<th class="py-2 px-3 whitespace-nowrap cursor-pointer select-none ${stickyClasses} ${extraClasses}" ${tooltipAttrs} draggable="true" data-col-id="${col.id}" onclick="requestDispatchSort('${col.id}')">${col.label}${getSortIcon(col.id)}</th>`;
                 }).join('')}
             </tr>
         </thead>
                <tbody id="dispatch-table-body" class="divide-y divide-gray-700">
                    ${dispatchersWithScores.map(d => `
                        <tr class="dispatch-table-row ${selectedDispatcherId === d.id ? 'selected' : ''}" data-dispatcher-id="${d.id}" data-dispatcher-name="${d.name}">
                            ${visibleColumns.map(col => {
                                const isPinnedLeft = pinnedLeftColumns.includes(col.id);
                                const isPinnedRight = pinnedRightColumns.includes(col.id);
                                const stickyClasses = isPinnedLeft ? 'sticky sticky-left' : isPinnedRight ? 'sticky sticky-right' : '';
                                
                                let content = d[col.id];
                                let cellClass = 'text-center';
                                let tooltipAttr = '';

                                if (['goodMoves', 'badMoves', 'hiddenMiles', 'lowRpm', 'tuesdayOpen', 'missingPaperwork', 'trailerDrops', 'trailerRecoveries', 'newStarts', 'wellness', 'canceled', 'overdueLoads'].includes(col.id)) { 
                                    cellClass += ' dispatch-tooltip-trigger cursor-help';
                                    tooltipAttr = `data-tooltip-metric="${col.id}"`;
                                }
                                
                                if (col.id === 'name') cellClass = 'text-left font-medium text-gray-200';
                                if (col.id === 'goodMoves') cellClass += ' text-green-400 font-semibold';
                                if (col.id === 'badMoves') cellClass += ' text-red-400 font-semibold';
                                
                                switch(col.type) {
                                    case 'percentage':
                                        if (col.id === 'complianceScore') {
                                            content = `<span class="font-bold text-teal-300">${(d[col.id] ?? 0).toFixed(1)}%</span>`;
                                        } else if (col.id === 'calculatorActivity') {
                                            // Custom Tooltip for Calculator Activity
                                            const actDetails = d.calculatorActivityDetails || [];
                                            let tooltipHTML = `<div class='text-left min-w-[150px]'><strong class='text-blue-400 block border-b border-gray-600 mb-2 pb-1'>Activity Breakdown</strong>`;
                                            
                                            actDetails.forEach(day => {
                                                const dateStr = day.date.toLocaleDateString('en-US', {weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC'});
                                                const hasMinutes = day.minutes > 0;
                                                const colorClass = hasMinutes ? 'text-green-400' : 'text-red-400';
                                                const icon = hasMinutes ? '✗' : '✗'; // Fixed icon logic logic below handles the checkmark
                                                
                                                // Round the minutes and add "min"
                                                const minutesDisplay = hasMinutes ? `${Math.round(day.minutes)} min` : '✗';
                                                
                                                tooltipHTML += `<div class="flex justify-between items-center text-xs mb-1">
                                                    <span class="text-gray-300">${dateStr}</span>
                                                    <span class="${colorClass} font-mono font-bold">${minutesDisplay}</span>
                                                </div>`;
                                            });
                                            tooltipHTML += `</div>`;
                                            
                                            // Color Logic: 100% = Green, 0% = Red, Others = Gray
                                            const val = d[col.id] || 0;
                                            let textColor = 'text-gray-200';
                                            if (val === 100) textColor = 'text-green-400';
                                            else if (val === 0) textColor = 'text-red-400';

                                            content = `<span class="font-bold ${textColor}">${val.toFixed(0)}%</span>`;
                                            
                                            cellClass += ' dispatch-tooltip-trigger cursor-help';
                                            tooltipAttr = `data-tooltip-html="${tooltipHTML.replace(/"/g, '&quot;')}"`;

                                        } else if (col.id === 'retention4w') {
                                            const rVal = d[col.id];
                                            if (rVal === null) {
                                                content = '-';
                                            } else {
                                                // Generate Tooltip HTML
                                                const rData = d.retentionDetails || { retained: [], terminated: [], transferred: [] };

                                                let tooltipHTML = `<div class='text-left min-w-[200px]'>`;
                                                
                                                if (rData.retained.length > 0) {
                                                    tooltipHTML += `<div class='mb-2'><strong class='text-green-400 block border-b border-gray-600 mb-1'>Retained (${rData.retained.length})</strong><div class='text-xs text-gray-300 leading-relaxed'>${rData.retained.join(', ')}</div></div>`;
                                                }
                                                if (rData.terminated.length > 0) {
                                                    tooltipHTML += `<div class='mb-2'><strong class='text-red-400 block border-b border-gray-600 mb-1'>Terminated (${rData.terminated.length})</strong><div class='text-xs text-gray-300 leading-relaxed'>${rData.terminated.join(', ')}</div></div>`;
                                                }
                                                if (rData.transferred.length > 0) {
                                                    tooltipHTML += `<div><strong class='text-yellow-400 block border-b border-gray-600 mb-1'>Transferred (${rData.transferred.length})</strong><ul class='text-xs text-gray-300 list-none pl-0 leading-relaxed'>`;
                                                    rData.transferred.forEach(t => {
                                                        tooltipHTML += `<li>${t.name} <span class='text-gray-500'>→ ${t.to}</span></li>`;
                                                    });
                                                    tooltipHTML += `</ul></div>`;
                                                }
                                                if (rData.retained.length === 0 && rData.terminated.length === 0 && rData.transferred.length === 0) {
                                                    tooltipHTML += `<span class='text-gray-500 italic'>No historical drivers found in 4W window.</span>`;
                                                }
                                                tooltipHTML += `</div>`;

                                                // Color code the percentage (0-40 Red, 40-70 Orange, 70+ Green)
                                                const textColor = rVal >= 70 ? 'text-green-400' : rVal >= 40 ? 'text-orange-400' : 'text-red-400';
                                                content = `<span class="font-bold ${textColor}">${rVal.toFixed(0)}%</span>`;
                                                
                                                // Attach Tooltip Attributes
                                                cellClass += ' dispatch-tooltip-trigger cursor-help';
                                                tooltipAttr = `data-tooltip-html="${tooltipHTML.replace(/"/g, '&quot;')}"`;
                                            }
                                        } else {
                                            content = `${(d[col.id] ?? 0).toFixed(0)}%`;
                                        }
                                        break;
                                    // ADD or MODIFY the medianTenure handling
                                    default:
                                        if (col.id === 'medianTenureOO' || col.id === 'medianTenureLOO') {
                                            // --- Tooltip Generation START (Table Redesign) ---
                                            const dispatcherName = d.name;
                                            // Find drivers associated with this dispatcher in the current view's data
                                            const driversForDispatcher = teamData.drivers
                                                .filter(driver => driver.dispatcher === dispatcherName);
    
                                            // Access the NEW tenure map from appState
                                            const dispatcherSpecificTenureMap = appState.profiles.dispatcherSpecificTenureMap || {}; // Ensure it exists

                                            // Get the end date for the *selected* week (same as in the main calculation)
                                            const weeksAgo = (selectedWeek === 'live' || !selectedWeek) ? 0 : parseInt(selectedWeek.replace('week_', ''), 10);
                                            const { start: currentWeekStart, end: periodEnd } = getPayrollWeekDateRange(weeksAgo);
                                            const pointInTimeDate = new Date(periodEnd);
                                            pointInTimeDate.setUTCDate(pointInTimeDate.getUTCDate() + 3); // Get the Thursday pay date
                                            if (selectedWeek === 'live') {
                                                // For "live" view, we want the max tenure, so set the date to the future
                                                pointInTimeDate.setFullYear(pointInTimeDate.getFullYear() + 10);
                                            }
                                            
                                            // --- START: New +1 Live Week Tenure Logic for TOOLTIP ---
                                            let activeDriverSet = new Set();
                                            if (selectedWeek === 'live') {
                                                appState.profiles.liveData.forEach(load => {
                                                    if (load.driver && load.do_date && load.status !== 'Canceled') {
                                                        const doDate = new Date(load.do_date);
                                                        if (doDate >= currentWeekStart && doDate <= periodEnd) {
                                                            activeDriverSet.add(load.driver);
                                                        }
                                                    }
                                                });
                                            }
                                            // --- END: New +1 Live Week Tenure Logic for TOOLTIP ---
    
                                            const tenureData = driversForDispatcher
                                                // FILTER FOR OO or LOO based on the column ID
                                                .filter(driver => col.id === 'medianTenureOO' ? driver.contract === 'OO' : driver.contract !== 'OO')
                                                .map(driver => {
                                                    const driverTenuresMap = dispatcherSpecificTenureMap[driver.name];
                                                    const allStubDates = (driverTenuresMap && driverTenuresMap[dispatcherName]) ? driverTenuresMap[dispatcherName] : [];
                                                    
                                                    // Filter stubs for point-in-time count
                                                    const pointInTimeStubs = allStubDates.filter(stubDate => stubDate <= pointInTimeDate);
                                                    let tenureWeeks = pointInTimeStubs.length;

                                                    // --- Add +1 for "Live" week ---
                                                    if (selectedWeek === 'live' && activeDriverSet.has(driver.name)) {
                                                        const lastStubDate = allStubDates.length > 0 ? allStubDates[allStubDates.length - 1] : null;
                                                        if (!lastStubDate || lastStubDate < pointInTimeDate) {
                                                            tenureWeeks += 1;
                                                        }
                                                    }
                                                    
                                                    return {
                                                        name: driver.name,
                                                        contract: driver.contract,
                                                        status: driver.status,
                                                        weeks: tenureWeeks
                                                    };
                                                }).sort((a, b) => b.weeks - a.weeks); // Sort by tenure descending
    
                                            // Build tooltip HTML using a table
                                            const tooltipTitle = `<strong class='tooltip-title'>Driver Tenure Details for ${dispatcherName} (${col.id === 'medianTenureOO' ? 'OO' : 'LOO'})</strong>`;
                                            let tooltipTableHTML = `<table class='tooltip-tenure-table'>
                                                                        <thead>
                                                                            <tr>
                                                                                <th>Driver</th>
                                                                                <th>Wks</th>
                                                                                <th>Contract</th>
                                                                                <th>Status</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>`;
    
                                            if (tenureData.length > 0) {
                                                tooltipTableHTML += tenureData.map(driver =>
                                                    `<tr>
                                                        <td>${driver.name}</td>
                                                        <td class='text-center'>${driver.weeks}</td>
                                                        <td class='text-center'>${driver.contract}</td>
                                                        <td class='text-center'>${driver.status}</td>
                                                    </tr>`
                                                ).join('');
                                            } else {
                                                tooltipTableHTML += `<tr><td colspan='4' class='text-center text-gray-500 py-2'>No driver data</td></tr>`;
                                            }
    
                                            tooltipTableHTML += `</tbody></table>`;
    
                                            const tooltipHtml = `${tooltipTitle}${tooltipTableHTML}`;
                                            const cleanedTooltipHtml = tooltipHtml.replace(/"/g, '&quot;').replace(/\n/g, '').trim();
                                            tooltipAttr = `data-tooltip-html="${cleanedTooltipHtml}"`; // Assign tooltip data attribute
                                            cellClass += ' dispatch-tooltip-trigger cursor-help'; // Add trigger class and cursor
                                            
                                            // This is the fix for 0 vs -
                                            const tenureValue = d[col.id];
                                            content = `<span class="text-gray-300">${(tenureValue === null || tenureValue === 0) ? '-' : tenureValue.toFixed(0)}</span>`;
                                            // --- Tooltip Generation END ---
                                        } else {
                                             // Fix for RC Entry rounding
                                             if (col.id === 'rcEntry' && d[col.id] !== null && d[col.id] !== undefined) {
                                                 content = Math.round(Number(d[col.id]));
                                             } else {
                                                 content = d[col.id] ?? '-';
                                             }
                                        }
                                        break;
                                }
                                return `<td class="py-2 px-3 whitespace-nowrap ${stickyClasses} ${cellClass}" ${tooltipAttr}>${content ?? '-'}</td>`; // Ensure tooltipAttr is included
                            }).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    renderDispatchColumnSettingsDropdown();
    initializeDispatchTableDragDrop();
    applyStickyStyles_DispatchTable();
    initializeProfileEventListeners();
}

function renderThresholdSettingsModal() {
    const modal = document.getElementById('profiles-threshold-settings-modal');
    if (!modal) return;

    modal.classList.toggle('hidden', !appState.profiles.thresholdSettings.isModalOpen);
    if (!appState.profiles.thresholdSettings.isModalOpen) return;

    // Ensure settings exist before destructuring, provide defaults
    const lowRpm = appState.profiles.thresholdSettings.lowRpm || { default: 1.5, by_contract: {} };
    const goodMove = appState.profiles.thresholdSettings.goodMove || { default: 6000, by_contract: {} };
    // Get tenure settings with default
    const tenureSettings = appState.profiles.tenureSettings || { lookback: { type: 'weeks', value: 12 } };

    // Ensure liveData is populated before accessing contract types
    const allContractTypes = [...new Set((appState.profiles.liveData || []).map(d => d.contract_type).filter(Boolean))].sort();
    const modalContent = document.getElementById('threshold-modal-content');
    if (!modalContent) return;

    // Use 'lowRpm' as default tab if none is set, or fallback if previous tab no longer exists
    const validTabIds = ['lowRpm', 'goodMove', 'driverTenure'];
    let activeSettingTab = appState.profiles.thresholdSettings.activeSettingTab || 'lowRpm';
    if (!validTabIds.includes(activeSettingTab)) {
        activeSettingTab = 'lowRpm';
    }

    // --- Define Helper Functions ---
    // Lookback Helper (Only used for Tenure now)
    const createLookbackInputHTML = (type, lookbackConfig) => `
        <div class="input-group compact">
             <label class="setting-label">Lookback Period</label>
             <div class="lookback-group flex w-48">
                 <select data-type="${type}" data-lookback-setting="type" class="settings-select lookback-type-select !flex-basis-auto !flex-grow">
                     <option value="allTime" ${lookbackConfig?.type === 'allTime' ? 'selected' : ''}>All Time</option>
                     <option value="weeks" ${lookbackConfig?.type === 'weeks' ? 'selected' : ''}>Weeks</option>
                 </select>
                 <input type="number" data-type="${type}" data-lookback-setting="value" value="${lookbackConfig?.value || 0}" class="settings-input lookback-value-input !flex-basis-1/3 !w-auto" ${lookbackConfig?.type === 'allTime' ? 'disabled' : ''}>
             </div>
        </div>
    `;

    // Threshold + Overrides Helper
    const createThresholdsWithOverridesHTML = (config) => {
        let overridesHTML = '';
        for (const [contract, value] of Object.entries(config.settings.by_contract || {})) {
            overridesHTML += `
                <div class="threshold-row">
                    <select class="contract-type-select settings-select" data-type="${config.type}" data-old-contract="${contract}">
                        ${allContractTypes.map(c => `<option value="${c}" ${c === contract ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                    <div class="input-dollar-sign-wrapper">
                        <span>$</span>
                        <input class="contract-value-input settings-input" type="number" step="${config.step}" data-type="${config.type}" data-contract="${contract}" value="${value}">
                    </div>
                    <button class="remove-threshold-btn" data-type="${config.type}" data-contract="${contract}" title="Remove override">&times;</button>
                </div>
            `;
        }
        return `
            <div class="setting-item">
                <label class="setting-label">Default Threshold</label>
                <div class="input-dollar-sign-wrapper">
                    <span>$</span>
                    <input id="${config.type}-default-threshold" data-type="${config.type}" type="number" step="${config.step}" value="${config.settings.default || 0}" class="settings-input default-threshold-input">
                </div>
            </div>
            <div class="border-t border-gray-700 my-4"></div>
            <p class="text-gray-400 text-xs mb-3">Contract-Specific Overrides</p>
            <div class="good-move-overrides-list flex-grow">${overridesHTML}</div>
            <button class="add-criteria-btn mt-2 add-override-btn" data-type="${config.type}">+ Add Override</button>
        `;
    };
    // --- End Helper Functions ---

    // --- Accordion Item Definitions ---
    const accordionItems = [
        {
            id: 'lowRpm',
            title: 'Low RPM Thresholds',
            icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 014.306 6.43l.776 2.898m0 0l3.182-5.511m-3.182 5.51l-5.511-3.181" /></svg>',
            description: 'Loads with an RPM below this value will be flagged as "Low RPM" for the selected week.',
            content: createThresholdsWithOverridesHTML({ type: 'lowRpm', settings: lowRpm, step: 0.01 })
        },
        {
            id: 'goodMove',
            title: '"Good Move" Thresholds',
            icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
            description: 'A "Moved Load" is a <span class="font-bold text-green-400">Good Move</span> if the driver\'s gross pay for that week (excluding the moved load) is below this threshold.',
            content: createThresholdsWithOverridesHTML({ type: 'goodMove', settings: goodMove, step: 100 })
        }
    ];
    // --- End Accordion Item Definitions ---

    // --- Build Accordion HTML ---
    let accordionHTML = '';
    accordionItems.forEach(item => {
        accordionHTML += `
            <div class="accordion-item ${activeSettingTab === item.id ? 'open' : ''}" data-tab-id="${item.id}">
                <button class="accordion-header">
                    <span class="accordion-title">
                        <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">${item.icon}</svg>
                        ${item.title}
                    </span>
                    <svg class="accordion-arrow w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                </button>
                <div class="accordion-panel">
                    <div class="accordion-panel-content">
                        <div class="description">${item.description}</div>
                        <div class="setting-controls">${item.content}</div>
                    </div>
                </div>
            </div>
        `;
    });
    modalContent.innerHTML = accordionHTML;
    // --- End Build Accordion HTML ---

    // --- Accordion Height Animation ---
    const openPanel = modalContent.querySelector('.accordion-item.open .accordion-panel');
    if (openPanel) {
        requestAnimationFrame(() => {
            openPanel.style.maxHeight = openPanel.scrollHeight + 'px';
        });
    }
    // --- End Accordion Height Animation ---

    // --- Event Listener Logic (Ensure it's attached only once) ---
    if (!modalContent._listenersAttached) {
        // Click listener for accordion headers, add/remove overrides
        modalContent.addEventListener('click', e => {
            const header = e.target.closest('.accordion-header');
            const removeBtn = e.target.closest('.remove-threshold-btn');
            const addOverrideBtn = e.target.closest('.add-override-btn');

            if (header) {
                 const item = header.closest('.accordion-item');
                 if (!item) return;
                 const panel = item.querySelector('.accordion-panel');
                 const isOpen = item.classList.contains('open');
                 const tabId = item.dataset.tabId;

                 modalContent.querySelectorAll('.accordion-item.open').forEach(openItem => {
                     if (openItem !== item) {
                         openItem.classList.remove('open');
                         openItem.querySelector('.accordion-panel').style.maxHeight = null;
                     }
                 });

                 if (isOpen) {
                     item.classList.remove('open');
                     panel.style.maxHeight = null;
                     appState.profiles.thresholdSettings.activeSettingTab = null;
                 } else {
                     item.classList.add('open');
                     panel.style.maxHeight = panel.scrollHeight + 'px';
                     appState.profiles.thresholdSettings.activeSettingTab = tabId;
                 }
                 return; // Prevent further actions if header clicked
            }

            if (removeBtn) {
                 e.preventDefault();
                 const type = removeBtn.dataset.type;
                 // Ensure type is valid before proceeding
                 if (!appState.profiles.thresholdSettings[type] || !appState.profiles.thresholdSettings[type].by_contract) return;
                 const contract = removeBtn.dataset.contract;
                 delete appState.profiles.thresholdSettings[type].by_contract[contract];
                 renderThresholdSettingsModal(); // Re-render to update UI
                 return;
            }

            if (addOverrideBtn) {
                 e.preventDefault();
                 const type = addOverrideBtn.dataset.type;
                  // Ensure type is valid before proceeding
                 if (!appState.profiles.thresholdSettings[type]) return;
                 const settings = appState.profiles.thresholdSettings[type];
                 if (!settings.by_contract) settings.by_contract = {};

                 const usedContracts = Object.keys(settings.by_contract);
                 const availableContract = allContractTypes.find(c => !usedContracts.includes(c));

                 if (availableContract) {
                     settings.by_contract[availableContract] = settings.default || 0;
                     renderThresholdSettingsModal(); // Re-render to show new override row
                 } else {
                     alert('All contract types already have a specific threshold.');
                 }
                 return;
            }
        });

        // Change listener for inputs/selects
        modalContent.addEventListener('change', e => {
            const type = e.target.dataset.type; // This will be 'lowRpm', 'goodMove', or 'driverTenure'

            // --- Handle Tenure Lookback ---
            if (type === 'driverTenure') {
                 // Ensure tenureSettings and its lookback property exist
                if (!appState.profiles.tenureSettings) appState.profiles.tenureSettings = { lookback: { type: 'weeks', value: 12 } };
                if (!appState.profiles.tenureSettings.lookback) appState.profiles.tenureSettings.lookback = { type: 'weeks', value: 12 };
                const tenureLookback = appState.profiles.tenureSettings.lookback;

                if (e.target.classList.contains('lookback-type-select')) {
                    tenureLookback.type = e.target.value;
                    const valueInput = e.target.closest('.lookback-group')?.querySelector('.lookback-value-input');
                    if (valueInput) valueInput.disabled = (e.target.value === 'allTime');
                } else if (e.target.classList.contains('lookback-value-input')) {
                    tenureLookback.value = parseInt(e.target.value, 10) || 0;
                }
            }
            // --- Handle Threshold Settings ---
            else if (appState.profiles.thresholdSettings && appState.profiles.thresholdSettings[type]) {
                const settings = appState.profiles.thresholdSettings[type];
                if (e.target.classList.contains('default-threshold-input')) {
                    const isFloat = e.target.step === '0.01';
                    settings.default = isFloat ? (parseFloat(e.target.value) || 0) : (parseInt(e.target.value, 10) || 0);
                } else if (e.target.classList.contains('contract-value-input')) {
                    const isFloat = e.target.step === '0.01';
                    // Ensure by_contract exists
                    if (!settings.by_contract) settings.by_contract = {};
                    settings.by_contract[e.target.dataset.contract] = isFloat ? (parseFloat(e.target.value) || 0) : (parseInt(e.target.value, 10) || 0);
                } else if (e.target.classList.contains('contract-type-select')) {
                     // Ensure by_contract exists
                    if (!settings.by_contract) settings.by_contract = {};
                    const oldContract = e.target.dataset.oldContract;
                    const newContract = e.target.value;
                    if (oldContract !== newContract && !(settings.by_contract && settings.by_contract[newContract])) {
                        const value = settings.by_contract[oldContract];
                        delete settings.by_contract[oldContract];
                        settings.by_contract[newContract] = value;
                        renderThresholdSettingsModal(); // Re-render needed
                    } else if (oldContract !== newContract) {
                         alert(`An override already exists for ${newContract}. Please remove it first or edit the existing one.`);
                         e.target.value = oldContract; // Revert selection
                    }
                }
            }

            // Recalculate open accordion height
            const openPanel = modalContent.querySelector('.accordion-item.open .accordion-panel');
            if (openPanel) {
                requestAnimationFrame(() => {
                    openPanel.style.maxHeight = openPanel.scrollHeight + 'px';
                });
            }
        });

        modalContent._listenersAttached = true;
    }
    // --- End Event Listener Logic ---
}

function renderDispatchTableSettings(allDispatchers) {
    renderComplianceSettingsModal(allDispatchers);
}

function renderDriverToolbar(teamData) {
    const toolbarContainer = document.getElementById('profiles-driver-toolbar');
    if (!toolbarContainer) return;

    const selectedDispatcherName = appState.profiles.selectedDispatcherId
        ? teamData.dispatchers.find(d => d.id === appState.profiles.selectedDispatcherId)?.name
        : null;

    const activeFiltersCount = appState.profiles.driverFilters.activeFilters.length;
    const isFilterModified = appState.profiles.activeSavedFilterId === null;

    const savedFilters = appState.profiles.savedDriverFilters || [];
    const hasCustomFilters = savedFilters.some(f => !f.isDefault);

    const franchiseText = appState.profiles.selectedFranchise === 'All Franchises' ? '' : ` for ${appState.profiles.selectedFranchise}`;
    
    const title = selectedDispatcherName 
        ? `Driver Health for ${selectedDispatcherName}` 
        : `Driver Health for ${teamData.teamName}${franchiseText}`;
    
    const modifiedText = isFilterModified ? '<span class="text-sm font-normal text-yellow-400 ml-2">(modified)</span>' : '';

    const savedFiltersHTML = savedFilters.map(filter => {
        if (!hasCustomFilters && filter.isDefault) {
            return '';
        }

        const isActive = appState.profiles.activeSavedFilterId === filter.id;
        const isDefault = filter.isDefault;
        let styleOverrides = '';
        if (!isDefault && filter.color && filter.color.startsWith('#')) {
            if (isActive) {
                styleOverrides = `style="background-color: ${filter.color}; border-color: ${filter.color}; color: white;"`;
            } else {
                styleOverrides = `style="border-color: ${filter.color}; color: ${filter.color};"`;
            }
        }

        if (isDefault) {
            return `<button class="saved-filter-btn ${isActive ? 'active' : ''}" data-filter-id="${filter.id}" data-color="blue"><span class="text-sm">${filter.name}</span></button>`;
        } else {
            return `
            <div class="custom-filter-wrapper ${isActive ? 'is-active' : ''}" data-color="${filter.color || 'gray'}" data-filter-id="${filter.id}">
                <button class="saved-filter-btn saved-filter-main" data-filter-id="${filter.id}" ${styleOverrides}>
                    <span class="text-sm">${filter.name}</span>
                </button>
                <div class="filter-actions-menu-container ${!isActive ? 'hidden' : ''}">
                    <button class="filter-actions-trigger" ${styleOverrides}>☰</button>
                    <div class="filter-actions-panel hidden">
                        <button class="filter-action-item edit-driver-filter-btn" data-filter-id="${filter.id}">Edit</button>
                        <button class="filter-action-item delete-driver-filter-btn" data-filter-id="${filter.id}">Delete</button>
                    </div>
                </div>
            </div>`;
        }
    }).join('');

    toolbarContainer.innerHTML = `
        <div class="flex items-center">
             <h3 id="driver-table-title" class="text-lg font-bold text-gray-200 flex-shrink-0">
                ${title}${modifiedText}
            </h3>
            <input type="text" id="driver-search-input" class="profile-table-search" placeholder="Search driver..." value="${appState.profiles.driverSearchTerm}">
        </div>
        
        <div id="saved-driver-filters-bar" class="flex items-center justify-center gap-x-2 flex-wrap">
            ${savedFiltersHTML}
        </div>

        <div class="flex items-center gap-x-2 flex-shrink-0">
        ${isAdmin() ? `
        <button id="driver-health-settings-btn" class="toolbar-btn !p-2" title="Drop Risk Settings">
            <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" /></svg>
        </button>
        <button id="driver-settings-btn" class="toolbar-btn !p-2" title="Flag Settings">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924-1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
        </button>
        ` : ''}
        <button id="driver-filter-btn" class="toolbar-btn !p-2 relative" title="Filters">
            <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.572a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" /></svg>
            ${activeFiltersCount > 0 ? `<span class="absolute -top-1.5 -right-1.5 bg-blue-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center border-2 border-gray-800">${activeFiltersCount}</span>` : ''}
        </button>
        </div>
    `;
}

function renderDriverTable(drivers) {
    const tableContainer = document.getElementById('profiles-driver-table-container');
    if (!tableContainer) return;

    const teamData = appState.profiles.currentTeamData;
    if (!teamData) {
        tableContainer.innerHTML = `<p class="text-center py-6 text-gray-500">No data available to display driver table.</p>`;
        return;
    }

    const sourceDrivers = drivers || teamData.drivers;
    let filteredDrivers = [...sourceDrivers];

    // --- START: Search Filtering Logic ---
    const searchTerm = appState.profiles.driverSearchTerm.toLowerCase();
    if (searchTerm) {
        filteredDrivers = filteredDrivers.filter(d =>
            d.name.toLowerCase().includes(searchTerm)
        );
    }
    // --- END: Search Filtering Logic ---

    // --- START: Dispatcher Filtering Logic ---
    const selectedDispatcherName = appState.profiles.selectedDispatcherId
        ? teamData?.dispatchers.find(d => d.id === appState.profiles.selectedDispatcherId)?.name
        : null;
    if (selectedDispatcherName) {
        filteredDrivers = filteredDrivers.filter(driver => driver.dispatcher === selectedDispatcherName);
    }
    // --- END: Dispatcher Filtering Logic ---

    // --- START: Apply Custom Filters from State ---
    const { activeFilters } = appState.profiles.driverFilters;
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
                    const driverFlags = driver.flags.map(f => f.text.toLowerCase());
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
                    case 'isAnyOf': const list = parseList(filterValue); return list.includes(String(driverValue).toLowerCase());
                    case 'isNotAnyOf': const notList = parseList(filterValue); return !notList.includes(String(driverValue).toLowerCase());
                    case 'greaterThan': return Number(driverValue) > Number(filterValue);
                    case 'greaterOrEqual': return Number(driverValue) >= Number(filterValue);
                    case 'lessThan': return Number(driverValue) < Number(filterValue);
                    case 'lessOrEqual': return Number(driverValue) <= Number(filterValue);
                    default: return true;
                }
            });
        });
    }
    // --- END: Apply Custom Filters ---

    const { sortConfig } = appState.profiles.driverTable;
    filteredDrivers.sort((a, b) => {
        const valA = a[sortConfig.key];
        const valB = b[sortConfig.key];
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        if (typeof valA === 'string') {
            return sortConfig.direction === 'ascending' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else {
            return sortConfig.direction === 'ascending' ? valA - valB : valB - valA;
        }
    });

    let baseColumns = [
        { id: 'rowNum', label: '#', type: 'number' },
        ...driverTableColumns.filter(c => c.id !== 'rowNum')
    ];

    let currentColumns = [...baseColumns];
    if (appState.profiles.selectedTeam === 'ALL_TEAMS') {
        const dispatcherIndex = currentColumns.findIndex(c => c.id === 'dispatcher');
        const teamColumnExists = currentColumns.some(c => c.id === 'team');
        if (!teamColumnExists && dispatcherIndex > -1) {
             currentColumns.splice(dispatcherIndex + 1, 0, { id: 'team', label: 'Team', type: 'string' });
        } else if (!teamColumnExists) {
            const equipmentIndex = currentColumns.findIndex(c => c.id === 'equipment');
            currentColumns.splice(equipmentIndex > -1 ? equipmentIndex : currentColumns.length -1 , 0, { id: 'team', label: 'Team', type: 'string' });
        }
    }

    const getSortIcon = (key) => {
        if (sortConfig.key !== key) return '';
        return sortConfig.direction === 'ascending' ? ' ▲' : ' ▼';
    };

    const renderCell = (driver, col) => {
        let content = driver[col.id] ?? '-';
        let cellClass = '';
        const numericCols = ['risk', 'gross', 'margin', 'rpm', 'miles'];
        const noWrapCols = ['name', 'company', 'dispatcher', 'team', 'franchise', 'status'];

        if (numericCols.includes(col.id)) cellClass = 'text-right font-mono';
        else if (col.id === 'equipment') cellClass = 'text-center';
        else cellClass = 'text-left';
        
        if (noWrapCols.includes(col.id)) cellClass += ' whitespace-nowrap';

        switch (col.id) {
            case 'rowNum': 
                content = `<td class="py-2 px-3 text-center font-mono text-gray-400 row-number-cell"></td>`;
                break;
            case 'name':
                content = `<td class="py-2 px-3 font-medium text-gray-200 whitespace-nowrap">${driver.name}</td>`;
                break;
            case 'equipment':
                content = `<td class="py-2 px-3 text-center"><span class="equipment-letter">${driver.equipment}</span></td>`;
                break;
            case 'flags':
                const flagsHTML = driver.flags.map(flag => {
                    const flagConfig = Object.values(appState.profiles.driverHealthSettings.flags).find(f => f.label === flag.text || f.positiveLabel === flag.text);
                    if (!flagConfig) return '';
                    const isPositive = flagConfig.positiveLabel === flag.text;
                    const iconSVG = isPositive ? (flagConfig.positiveIcon || flagConfig.icon) : flagConfig.icon;
                    const bgColor = isPositive ? flagConfig.positiveColor : flag.color;
                    const finalClasses = `driver-flag-icon flag-${bgColor}`;
                    
                    const tooltipText = generateFlagTooltipText(flag.text);
                    const tooltipHtml = `<div class='font-bold mb-1 text-gray-200'>${flag.text}</div><div class='text-xs'>${tooltipText}</div>`;
                    const safeTooltip = tooltipHtml.replace(/"/g, '&quot;');
                    
                    return `<div class="${finalClasses} dispatch-tooltip-trigger cursor-help" data-tooltip-html="${safeTooltip}">${iconSVG}</div>`;
                }).join('');
                content = `<td class="py-2 px-3"><div class="flex flex-nowrap gap-1.5">${flagsHTML}</div></td>`;
                break;
            case 'risk':
                content = `<td class="py-2 px-3 text-center"><div class="flex items-center justify-center gap-2"><div class="risk-bar"><div style="width: ${Math.round(driver.risk)}%;" class="risk-bar-fill"></div></div><span class="font-mono text-xs">${Math.round(driver.risk)}%</span></div></td>`;
                break;
            case 'gross':
            case 'margin':
                const value = driver[col.id] || 0;
                content = `<td class="py-2 px-3 text-right font-mono">$${value.toLocaleString()}</td>`;
                break;
            case 'rpm':
                content = `<td class="py-2 px-3 text-right font-mono">$${(driver.rpm || 0).toFixed(2)}</td>`;
                break;
            case 'miles':
               content = `<td class="py-2 px-3 text-right font-mono">${(driver[col.id] || 0).toLocaleString()}</td>`;
               break;
            default:
                 content = `<td class="py-2 px-3 ${cellClass}">${driver[col.id] ?? '-'}</td>`;
        }
        return content;
    };

    const driverTableFooterHTML = `
        <tfoot id="profiles-driver-table-foot">
            <tr class="h-10 summary-footer-row">
                ${currentColumns.map((col, index) => {
                    const isNumerical = col.isSummaryCandidate;
                    const mode = appState.profiles.driverSummaryMode;
                    const isRowNum = col.id === 'rowNum';
                    const isDriverName = col.id === 'name';

                    // --- FIX: MERGE # AND NAME FOR STICKY DROPDOWN ---
                    if (isRowNum) {
                        const dropdownHtml = `
                            <select onchange="window.requestDriverSummaryMode(this.value)" class="summary-mode-select text-blue-300 border-blue-400 bg-gray-900 rounded-md text-xs h-6 px-2 py-0">
                                <option value="median" ${mode === 'median' ? 'selected' : ''}>Median</option>
                                <option value="sum" ${mode === 'sum' ? 'selected' : ''}>Sum</option>
                                <option value="avg" ${mode === 'avg' ? 'selected' : ''}>Average</option>
                            </select>
                        `;
                        // Sticky na left:0 (odmah fiksiran), colspan 2, pozadina kao header
                        return `<td class="py-2 px-3 text-left bg-gray-900" style="position: sticky; left: 0; z-index: 30;" colspan="2">${dropdownHtml}</td>`;
                    }
                    if (isDriverName) {
                        return ''; // Preskačemo jer je spojena sa rowNum
                    }
                    // -------------------------------------------------

                    let content = '';
                    let alignmentClass = isNumerical ? 'text-right font-mono' : 'text-left';
                    
                    if (isNumerical && mode !== 'none') {
                        let summaryValue = calculateDriverSummary(filteredDrivers, col.id, mode);
                        
                        // --- FIX: FORCE OVERRIDE MARGIN SUM WITH KPI VALUE ---
                        if (col.id === 'margin' && mode === 'sum' && appState.profiles.currentKpis) {
                            if (filteredDrivers.length === (teamData.drivers || []).length) {
                                summaryValue = appState.profiles.currentKpis.teamMargin;
                            }
                        }
                        
                        let formattedValue;
                        if (summaryValue === null) {
                            formattedValue = '-';
                        } else if (col.id === 'risk') {
                            formattedValue = `${Math.round(summaryValue)}%`;
                        } else if (col.id === 'rpm') {
                            formattedValue = `$${summaryValue.toFixed(2)}`;
                        } else {
                            formattedValue = `$${Math.round(summaryValue).toLocaleString()}`;
                        }
                        
                        content = `<span class="text-teal-400 font-bold">${formattedValue}</span>`;
                    }

                    return `<td class="py-2 px-3 ${alignmentClass}" data-col-id="${col.id}">${content}</td>`;
                }).join('')}
            </tr>
        </tfoot>
    `;

    tableContainer.innerHTML = `
    <table class="w-full text-sm text-left text-gray-400" id="profiles-driver-health-table">
        <thead class="text-xs text-gray-300 uppercase sticky top-0 bg-gray-900" id="profiles-driver-table-head">
            <tr>
                ${currentColumns.map(col => {
                    let headerClass = '';
                    const noWrapCols = ['name', 'company', 'dispatcher', 'team', 'franchise', 'status'];
                    if (col.id === 'rowNum') headerClass = 'text-center';
                    else if (['risk', 'gross', 'margin', 'rpm', 'miles', 'balance', 'po'].includes(col.id)) headerClass = 'text-right';
                    else if (col.id === 'equipment') headerClass = 'text-center';
                    else headerClass = 'text-left';

                    if (noWrapCols.includes(col.id)) headerClass += ' whitespace-nowrap';

                    return `<th class="py-2 px-3 cursor-pointer select-none ${headerClass}" onclick="requestDriverSort('${col.id}')" data-col-id="${col.id}">${col.label}${getSortIcon(col.id)}</th>`
                }).join('')}
            </tr>
        </thead>
        <tbody class="divide-y divide-gray-700">
            ${filteredDrivers.length > 0 ? filteredDrivers.map((driver, index) => { 
                 const cellsHTML = currentColumns.map(col => {
                     return renderCell(driver, col);
                 }).join('');

                 const rowHTML = `<tr class="hover:bg-gray-700/50 cursor-pointer" data-driver-name="${driver.name}">${cellsHTML}</tr>`;
                 const rowNumberCell = `<td class="py-2 px-3 text-center font-mono text-gray-400">${index + 1}</td>`;
                 return rowHTML.replace(/<td.*?row-number-cell.*?<\/td>/, rowNumberCell);
            }).join('') : `<tr><td colspan="${currentColumns.length}" class="text-center py-6 text-gray-500">No drivers match the current filters.</td></tr>`}
        </tbody>
        ${driverTableFooterHTML}
    </table>
    `;
}

function renderDispatchColumnSettingsDropdown() {
    const container = document.getElementById('dispatch-column-settings-dropdown');
    if (!container) return;
    const teamData = appState.profiles.currentTeamData;
    if (!teamData) return;

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
            e.stopPropagation(); 
            const visibleSet = new Set(appState.profiles.dispatchTable.visibleColumnIds);
            visibleSet.has(colId) ? visibleSet.delete(colId) : visibleSet.add(colId);
            appState.profiles.dispatchTable.visibleColumnIds = Array.from(visibleSet);
            // FIX: Use appState.profiles.allProcessedDispatchers as the second argument
            renderDispatchTable(teamData.dispatchers, appState.profiles.allProcessedDispatchers);
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




function renderFlagFilter() {
    const container = document.getElementById('driver-flag-filter-container');
    if (!container) return;
    container.innerHTML = `<select id="flag-filter-select" class="w-full bg-gray-700 text-gray-100 border border-gray-600 rounded-lg px-3 py-2 text-sm"><option>All Flags</option></select>`;
}

function handlePinColumn(columnId, side) {
    const { pinnedLeftColumns, pinnedRightColumns, columnOrder } = appState.profiles.dispatchTable;
    const teamData = appState.profiles.currentTeamData;
    if (!teamData) return;

    const isPinnedLeft = pinnedLeftColumns.includes(columnId);
    const isPinnedRight = pinnedRightColumns.includes(columnId);
    
    let unpinned = columnOrder.filter(id => !pinnedLeftColumns.includes(id) && !pinnedRightColumns.includes(id));
    
    if (isPinnedLeft) pinnedLeftColumns.splice(pinnedLeftColumns.indexOf(columnId), 1);
    if (isPinnedRight) pinnedRightColumns.splice(pinnedRightColumns.indexOf(columnId), 1);
    if (!isPinnedLeft && !isPinnedRight) unpinned.splice(unpinned.indexOf(columnId), 1);

    if (side === 'left' && !isPinnedLeft) pinnedLeftColumns.push(columnId); 
    else if (side === 'right' && !isPinnedRight) pinnedRightColumns.unshift(columnId); 
    else unpinned.unshift(columnId);

    appState.profiles.dispatchTable.columnOrder = [...pinnedLeftColumns, ...unpinned, ...pinnedRightColumns];
    // FIX: Use appState.profiles.allProcessedDispatchers as the second argument
    renderDispatchTable(teamData.dispatchers, appState.profiles.allProcessedDispatchers);
}

function applyStickyStyles_DispatchTable() {
    const tableHead = document.getElementById('dispatch-table-head');
    const tableBody = document.getElementById('dispatch-table-body');
    if (!tableHead || !tableBody) return;

    const { pinnedLeftColumns, pinnedRightColumns } = appState.profiles.dispatchTable;
    const headerCells = Array.from(tableHead.children);
    const bodyRows = Array.from(tableBody.children);

    let leftOffset = 0;
    
    headerCells.forEach((th, index) => {
        const colId = th.dataset.colId;
        if (pinnedLeftColumns.includes(colId)) {
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

    for (let i = headerCells.length - 1; i >= 0; i--) {
        const th = headerCells[i];
        const colId = th.dataset.colId;
        if (pinnedRightColumns.includes(colId)) {
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
    const teamData = appState.profiles.currentTeamData;
    if (!teamData) return;

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
                renderDispatchTable(teamData.dispatchers, teamData.dispatchers);
            }
        });
        header.addEventListener('dragend', e => e.target.classList.remove('opacity-50'));
    });
}



export function initializeProfileEventListeners() {
    if (!document.body.profileListenersAttached) {
        // --- START: Updated Global Click Listener ---
        document.body.addEventListener('click', (e) => {
            const openDropdowns = {
                kpi: appState.profiles.isKpiSettingsOpen,
                contract: appState.profiles.isContractTypeFilterOpen,
                company: appState.profiles.isCompanyFilterOpen,
                franchise: appState.profiles.isFranchiseFilterOpen,
                week: appState.profiles.isWeekSelectorOpen
            };

            const isClickInsideAnyDropdown = e.target.closest('#kpi-settings-container, #contract-type-filter-container, #company-filter-container, #franchise-filter-container, #profile-week-selector-container');
            
            if (Object.values(openDropdowns).some(isOpen => isOpen) && !isClickInsideAnyDropdown) {
                appState.profiles.isKpiSettingsOpen = false;
                appState.profiles.isContractTypeFilterOpen = false;
                appState.profiles.isCompanyFilterOpen = false;
                appState.profiles.isFranchiseFilterOpen = false;
                appState.profiles.isWeekSelectorOpen = false;
                renderTeamProfileUI();
            }

            // Close settings dropdown
            const settingsDropdown = document.getElementById('dispatch-column-settings-dropdown');
            if (settingsDropdown && !settingsDropdown.classList.contains('hidden') && !e.target.closest('#dispatch-table-settings-btn') && !settingsDropdown.contains(e.target)) {
                settingsDropdown.classList.add('hidden');
            }
        });
        // --- END: Updated Global Click Listener ---

        document.body.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (appState.profiles.driverDeepDive.isModalOpen) {
                    appState.profiles.driverDeepDive.isModalOpen = false;
                    renderDriverDeepDiveModal_Profiles();
                }
            }
        });
        document.body.profileListenersAttached = true;
    }
    
    // ... (dispatcher and driver search listeners remain the same) ...
    const dispatcherSearchInput = document.getElementById('dispatcher-search-input');
    if (dispatcherSearchInput && !dispatcherSearchInput.listenerAttached) {
        dispatcherSearchInput.addEventListener('input', debounce((e) => {
            appState.profiles.dispatcherSearchTerm = e.target.value;
            const teamData = appState.profiles.currentTeamData;
            renderDispatchTable(teamData.dispatchers, appState.profiles.allProcessedDispatchers);
        }, 300));
        dispatcherSearchInput.listenerAttached = true;
    }

    const driverSearchInput = document.getElementById('driver-search-input');
    if (driverSearchInput && !driverSearchInput.listenerAttached) {
        driverSearchInput.addEventListener('input', debounce((e) => {
            appState.profiles.driverSearchTerm = e.target.value;
            const teamData = appState.profiles.currentTeamData;
            renderDriverTable(teamData.drivers);
        }, 300));
        driverSearchInput.listenerAttached = true;
    }
    // ...

    const teamSelector = document.getElementById('team-selector');
    if (teamSelector && !teamSelector.listenerAttached) {
        teamSelector.addEventListener('change', (e) => {
            appState.profiles.selectedTeam = e.target.value;
            renderTeamProfileUI();
        });
        teamSelector.listenerAttached = true;
    }

    const header = document.getElementById('profiles-header');
    if (header) {
        if (header._clickHandler) header.removeEventListener('click', header._clickHandler);
        
        // --- START: New Header Click Handler for Exclusive Dropdowns ---
        header._clickHandler = (e) => {
            const targetId = e.target.closest('button')?.id;
            if (!targetId) {
                // Handle selecting an option from a dropdown
                const weekOption = e.target.closest('.profile-week-option');
                if (weekOption) {
                    e.preventDefault();
                    appState.profiles.selectedWeek = weekOption.dataset.weekId;
                    appState.profiles.isWeekSelectorOpen = false;
                    renderTeamProfileUI();
                }
                return;
            }

            e.stopPropagation();

            const dropdownStates = {
                'kpi-settings-btn': 'isKpiSettingsOpen',
                'contract-type-filter-btn': 'isContractTypeFilterOpen',
                'company-filter-btn': 'isCompanyFilterOpen',
                'franchise-filter-btn': 'isFranchiseFilterOpen',
                'profile-week-selector-btn': 'isWeekSelectorOpen'
            };

            const clickedStateKey = dropdownStates[targetId];
            if (!clickedStateKey) return;

            const wasOpen = appState.profiles[clickedStateKey];

            // Close all dropdowns
            Object.values(dropdownStates).forEach(key => appState.profiles[key] = false);
            
            // Toggle the clicked one
            appState.profiles[clickedStateKey] = !wasOpen;

            renderTeamProfileUI();
        };
        // --- END: New Header Click Handler ---
        header.addEventListener('click', header._clickHandler);
    }

    const resizer = document.getElementById('fleet-health-flag-summary');
    const topPanel = document.getElementById('profiles-dispatch-breakdown');
    const bottomPanel = document.getElementById('profiles-driver-health');

    if (resizer && topPanel && bottomPanel && !resizer._listenerAttached) {
        const handleMouseDown = (e) => {
            e.preventDefault();

            const startY = e.clientY;
            const startTopHeight = topPanel.offsetHeight;
            const startBottomHeight = bottomPanel.offsetHeight;
            let finalTopHeight = startTopHeight; // Keep track of the last valid height

            document.body.classList.add('resizing-vertical');

            const handleMouseMove = (moveEvent) => {
                window.requestAnimationFrame(() => {
                    const dy = moveEvent.clientY - startY;
                    const newTopHeight = startTopHeight + dy;
                    const newBottomHeight = startBottomHeight - dy;

                    // Set minimum heights for the panels
                    if (newTopHeight > 100 && newBottomHeight > 200) {
                        finalTopHeight = newTopHeight; // Update last valid height
                        topPanel.style.flexBasis = `${newTopHeight}px`;
                        topPanel.style.flexGrow = '0';
                        topPanel.style.flexShrink = '0';

                        // Let the bottom panel fill the rest of the space
                        bottomPanel.style.flexBasis = '0';
                        bottomPanel.style.flexGrow = '1';
                    }
                });
            };

            const handleMouseUp = () => {
                document.body.classList.remove('resizing-vertical');
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                // Save the final valid height to the app state
                appState.profiles.dispatchTableFlexBasis = `${finalTopHeight}px`;
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        };

        resizer.addEventListener('mousedown', handleMouseDown);
        resizer._listenerAttached = true;
    }

    // ... (The rest of the function remains the same, handling tooltips, modals, etc.)
    const tooltip = document.getElementById('dispatch-tooltip');
    const attachTooltipListeners = (containerElement) => {
        if (!containerElement || !tooltip) return;
        if (containerElement._mouseoverHandler) containerElement.removeEventListener('mouseover', containerElement._mouseoverHandler);
        containerElement._mouseoverHandler = (e) => {
            const trigger = e.target.closest('.dispatch-tooltip-trigger');
            if (!trigger) return;
            let htmlContent = '';
            if (trigger.dataset.tooltipHtml) {
                htmlContent = trigger.dataset.tooltipHtml;
            } else if (trigger.dataset.tooltipMetric) {
                const teamData = appState.profiles.currentTeamData;
                const dispatcherId = parseInt(trigger.parentElement.dataset.dispatcherId, 10);
                const dispatcher = teamData?.dispatchers.find(d => d.id === dispatcherId);
                const metricId = trigger.dataset.tooltipMetric;
                if (dispatcher && metricId) {
                    htmlContent = generateDispatchTooltipHTML(dispatcher, metricId, appState.profiles.liveData);
                }
            }
            if (htmlContent) {
                tooltip.innerHTML = htmlContent;
                tooltip.classList.add('visible');
            }
        };
        containerElement.addEventListener('mouseover', containerElement._mouseoverHandler);
        if (containerElement._mousemoveHandler) containerElement.removeEventListener('mousemove', containerElement._mousemoveHandler);
        containerElement._mousemoveHandler = (e) => {
            if (tooltip.classList.contains('visible')) {
                const tooltipRect = tooltip.getBoundingClientRect();
                let left = e.pageX - tooltipRect.width - 15;
                if (left < 10) { left = e.pageX + 15; }
                tooltip.style.left = `${left}px`;
                tooltip.style.top = `${e.pageY + 15}px`;
            }
        };
        containerElement.addEventListener('mousemove', containerElement._mousemoveHandler);
        if (containerElement._mouseoutHandler) containerElement.removeEventListener('mouseout', containerElement._mouseoutHandler);
        containerElement._mouseoutHandler = (e) => {
            if (e.target.closest('.dispatch-tooltip-trigger')) {
                tooltip.classList.remove('visible');
            }
        };
        containerElement.addEventListener('mouseout', containerElement._mouseoutHandler);
    };

    // Attach tooltips to the header KPIs
    const profilesHeader = document.getElementById('profiles-header');
    if (profilesHeader) {
        attachTooltipListeners(profilesHeader);
        
        // New Listener for Retention Chart
        const retentionCard = document.getElementById('kpi-card-retention');
        if (retentionCard && !retentionCard._clickListenerAttached) {
            retentionCard.addEventListener('click', (e) => {
                e.stopPropagation();
                openRetentionHistoryModal();
            });
            retentionCard._clickListenerAttached = true;
        }

        // New Listener for Compliance Chart
        const complianceCard = document.getElementById('kpi-card-compliance');
        if (complianceCard && !complianceCard._clickListenerAttached) {
            complianceCard.addEventListener('click', (e) => {
                e.stopPropagation();
                openComplianceHistoryModal();
            });
            complianceCard._clickListenerAttached = true;
        }

        // New Listener for Trailer Drops Chart
        const dropsCard = document.getElementById('kpi-card-trailer-drops');
        if (dropsCard && !dropsCard._clickListenerAttached) {
            dropsCard.addEventListener('click', (e) => {
                e.stopPropagation();
                openTrailerDropsHistoryModal();
            });
            dropsCard._clickListenerAttached = true;
        }

        // Listeners for General KPI Cards
        ['totalGross', 'teamRpm', 'teamMargin', 'activeTrucks', 'balance'].forEach(metricId => {
            const card = document.getElementById(`kpi-card-${metricId}`);
            if (card && !card._clickListenerAttached) {
                card.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openGeneralHistoryModal(metricId);
                });
                card._clickListenerAttached = true;
            }
        });
    }

    const dispatchTable = document.getElementById('profiles-dispatch-table-container');
    if (dispatchTable) {
        if (dispatchTable._clickHandler) dispatchTable.removeEventListener('click', dispatchTable._clickHandler);
        dispatchTable._clickHandler = (e) => {
            const teamData = appState.profiles.currentTeamData;
            if (!teamData) return;
            const tooltipTrigger = e.target.closest('.dispatch-tooltip-trigger');
            const row = e.target.closest('.dispatch-table-row');
            if (tooltipTrigger) {
                const dispatcherId = parseInt(tooltipTrigger.parentElement.dataset.dispatcherId, 10);
                const dispatcher = teamData.dispatchers.find(d => d.id === dispatcherId);
                const metricId = tooltipTrigger.dataset.tooltipMetric;
                if (dispatcher && metricId) {
                    const htmlContent = generateDispatchTooltipHTML(dispatcher, metricId, appState.profiles.liveData);
                    const plainText = htmlContent.replace(/<br\s*[\/]?>/gi, "\n").replace(/<[^>]*>/g, '').trim();
                    copyToClipboard(plainText);
                    const tooltipElement = document.getElementById('dispatch-tooltip');
                    tooltipElement.classList.add('copied');
                    setTimeout(() => tooltipElement.classList.remove('copied'), 500);
                }
            } else if (row) {
                const dispatcherId = parseInt(row.dataset.dispatcherId, 10);
                appState.profiles.selectedDispatcherId = appState.profiles.selectedDispatcherId === dispatcherId ? null : dispatcherId;

                // Clear the driver search term when selecting a dispatcher
                appState.profiles.driverSearchTerm = '';
                
                // --- THIS IS THE FIX ---
                // Call the main UI render function to rebuild everything
                // and correctly re-attach all event listeners.
                renderTeamProfileUI(); 
                // --- END OF FIX ---
                
                // We re-run the scroll-to-view *after* renderTeamProfileUI has
                // had a chance to (asynchronously) render.
                requestAnimationFrame(() => {
                    // Find the row again *after* the re-render
                    const newRow = document.querySelector(`.dispatch-table-row[data-dispatcher-id='${dispatcherId}']`);
                    if (newRow && appState.profiles.selectedDispatcherId === dispatcherId) { // Only scroll if it's selected
                        newRow.scrollIntoView({ behavior: 'auto', block: 'nearest' });
                    }
                });
            }
        };
        dispatchTable.addEventListener('click', dispatchTable._clickHandler);
        attachTooltipListeners(dispatchTable);
    }

    const driverTableContainer = document.getElementById('profiles-driver-table-container');
    if (driverTableContainer) {
        if (driverTableContainer._clickHandler) driverTableContainer.removeEventListener('click', driverTableContainer._clickHandler);
        driverTableContainer._clickHandler = (e) => {
            const row = e.target.closest('tr[data-driver-name]');
            if (row && !e.target.closest('.dispatch-tooltip-trigger')) {
                appState.profiles.driverDeepDive.selectedDriver = row.dataset.driverName;
                appState.profiles.driverDeepDive.isModalOpen = true;
                renderDriverDeepDiveModal_Profiles();
            }
        };
        driverTableContainer.addEventListener('click', driverTableContainer._clickHandler);
        attachTooltipListeners(driverTableContainer);
    }
    
    // The rest of the function continues as before...
    const driverDeepDiveModal = document.getElementById('profiles-driver-deep-dive-modal');
    if (driverDeepDiveModal && !driverDeepDiveModal._clickHandlerAttached) {
        driverDeepDiveModal.addEventListener('click', (e) => {
            if (e.target.closest('#close-profiles-deep-dive-modal-btn')) {
                appState.profiles.driverDeepDive.isModalOpen = false;
                appState.profiles.driverDeepDive.selectedDriver = null;
                renderDriverDeepDiveModal_Profiles();
            }
            // ** THIS IS THE CORRECTED LISTENER **
            if (e.target.closest('#toggle-canceled-loads-btn')) {
                appState.profiles.driverDeepDive.showCanceledLoads = !appState.profiles.driverDeepDive.showCanceledLoads;
                renderDriverDeepDiveModal_Profiles(); // Re-render the whole modal
            }
        });
        driverDeepDiveModal._clickHandlerAttached = true;
    }

    const snapshotTrigger = document.getElementById('snapshot-trigger');
    if (snapshotTrigger && !snapshotTrigger._clickHandlerAttached) {
        snapshotTrigger.addEventListener('click', () => {
            appState.profiles.isSnapshotOpen = true;
            renderTeamSnapshot();
        });
        snapshotTrigger._clickHandlerAttached = true;
    }

    const snapshotCloseBtn = document.getElementById('snapshot-close-btn');
    if (snapshotCloseBtn && !snapshotCloseBtn._clickHandlerAttached) {
        snapshotCloseBtn.addEventListener('click', () => {
            appState.profiles.isSnapshotOpen = false;
            renderTeamSnapshot();
        });
        snapshotCloseBtn._clickHandlerAttached = true;
    }
    
    const complianceSettingsBtn = document.getElementById('compliance-settings-btn');
    if (complianceSettingsBtn) {
        if (complianceSettingsBtn._clickHandler) complianceSettingsBtn.removeEventListener('click', complianceSettingsBtn._clickHandler);
        complianceSettingsBtn._clickHandler = (e) => {
            e.stopPropagation();
            appState.profiles.complianceSettings.isModalOpen = true;
            const teamData = appState.profiles.currentTeamData;
            if (teamData) {
                renderComplianceSettingsModal(teamData.dispatchers);
            }
        };
        complianceSettingsBtn.addEventListener('click', complianceSettingsBtn._clickHandler);
    }

    const thresholdSettingsBtn = document.getElementById('dispatch-threshold-settings-btn');
    if (thresholdSettingsBtn && !thresholdSettingsBtn.listenerAttached) {
        thresholdSettingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            appState.profiles.thresholdSettings.isModalOpen = true;
            renderThresholdSettingsModal();
        });
        thresholdSettingsBtn.listenerAttached = true;
    }

    const settingsBtn = document.getElementById('dispatch-table-settings-btn');
    const settingsDropdown = document.getElementById('dispatch-column-settings-dropdown');
    if (settingsBtn && settingsDropdown) {
        if (settingsBtn._clickHandler) settingsBtn.removeEventListener('click', settingsBtn._clickHandler);
        settingsBtn._clickHandler = (e) => {
            e.stopPropagation();
            settingsDropdown.classList.toggle('hidden');
        };
        settingsBtn.addEventListener('click', settingsBtn._clickHandler);
        if (settingsDropdown._clickHandler) settingsDropdown.removeEventListener('click', settingsDropdown._clickHandler);
        settingsDropdown._clickHandler = (e) => {
            const pinButton = e.target.closest('button[data-pin]');
            if (pinButton) { e.stopPropagation(); handlePinColumn(pinButton.dataset.colId, pinButton.dataset.pin); }
        };
        settingsDropdown.addEventListener('click', settingsDropdown._clickHandler);
    }

    const setupSettingsModal = (modalId, closeBtnId, saveBtnId, stateKey) => {
        const modal = document.getElementById(modalId);
        if (modal && !modal.listenerAttached) {
            modal.addEventListener('click', async (e) => {
                const teamData = appState.profiles.currentTeamData;
                if (!teamData) return;
    
                if (e.target.closest(`#${closeBtnId}`)) {
                    appState.profiles[stateKey].isModalOpen = false;
                    renderTeamProfileUI(); // Re-render to close
                }
                if (e.target.closest(`#${saveBtnId}`)) {
                    appState.profiles[stateKey].isModalOpen = false;
                    showSavingIndicator(); // Show indicator
                    try {
                        // Gather all settings from the main state
                        const settingsToSave = {
                            complianceSettings: appState.profiles.complianceSettings,
                            driverHealthSettings: appState.profiles.driverHealthSettings,
                            thresholdSettings: appState.profiles.thresholdSettings
                        };
                        // Send all settings to the backend
                        await updateFleetHealthSettings(settingsToSave);
                    } catch (error) {
                         console.error("Failed to save settings:", error);
                         alert(`Error saving settings: ${error.message}`);
                    } finally {
                        hideSavingIndicator(); // Hide indicator
                        // Clear cache and re-render everything to reflect changes
                        appState.profiles.fleetHealthCache = {};
                        renderTeamProfileUI();
                    }
                }
            });
            modal.listenerAttached = true;
        }
    };
    
    // Apply the new, correct logic to both modals
    setupSettingsModal('profiles-compliance-settings-modal', 'close-compliance-settings-modal-btn', 'save-compliance-settings-btn', 'complianceSettings');
    setupSettingsModal('profiles-threshold-settings-modal', 'close-threshold-settings-modal-btn', 'save-threshold-settings-btn', 'thresholdSettings');

    const driverToolbar = document.getElementById('profiles-driver-toolbar');
    if (driverToolbar) {
        if (driverToolbar._clickHandler) driverToolbar.removeEventListener('click', driverToolbar._clickHandler);
        driverToolbar._clickHandler = (e) => {
            const savedFilterBtn = e.target.closest('.saved-filter-btn');
            const actionsTrigger = e.target.closest('.filter-actions-trigger');
            const editBtn = e.target.closest('.edit-driver-filter-btn');
            const deleteBtn = e.target.closest('.delete-driver-filter-btn');
            if (savedFilterBtn) {
                const filterId = savedFilterBtn.dataset.filterId;
                const savedFilter = appState.profiles.savedDriverFilters.find(f => f.id === filterId);
                if (savedFilter) {
                    appState.profiles.driverFilters.activeFilters = savedFilter.criteria;
                    appState.profiles.driverFilters.filterLogic = savedFilter.logic || 'AND';
                    appState.profiles.activeSavedFilterId = filterId;
                    renderTeamProfileUI();
                }
                return;
            }
            if (actionsTrigger) {
                e.stopPropagation();
                const panel = actionsTrigger.nextElementSibling;
                const isHidden = panel.classList.contains('hidden');
                document.querySelectorAll('.filter-actions-panel').forEach(p => p.classList.add('hidden'));
                if (isHidden) {
                    panel.classList.remove('hidden');
                }
                return;
            }
            if (editBtn) {
                e.stopPropagation();
                const filterId = editBtn.dataset.filterId;
                const filterToEdit = appState.profiles.savedDriverFilters.find(f => f.id === filterId);
                if (filterToEdit) {
                    appState.profiles.driverFilters.filterToEdit = filterToEdit;
                    appState.profiles.driverFilters.activeFilters = filterToEdit.criteria;
                    appState.profiles.driverFilters.isSaveModalOpen = true;
                    renderSaveFilterModal();
                }
                return;
            }
            if (deleteBtn) {
                e.stopPropagation();
                const filterIdToDelete = deleteBtn.dataset.filterId;
                if (confirm('Are you sure you want to delete this filter?')) {
                    appState.profiles.savedDriverFilters = appState.profiles.savedDriverFilters.filter(f => f.id !== filterIdToDelete);
                    if (appState.profiles.activeSavedFilterId === filterIdToDelete) {
                        appState.profiles.activeSavedFilterId = 'all_drivers';
                        const allDriversFilter = appState.profiles.savedDriverFilters.find(f=>f.id === 'all_drivers');
                        appState.profiles.driverFilters.activeFilters = allDriversFilter ? allDriversFilter.criteria : [];
                    }
                    renderTeamProfileUI();
                }
                return;
            }
            if (e.target.closest('#driver-filter-btn')) {
                appState.profiles.driverFilters.isFilterModalOpen = true;
                renderDriverFilterModal();
            }
            if (e.target.closest('#driver-settings-btn')) {
                appState.profiles.tempDriverHealthSettings = JSON.parse(JSON.stringify(appState.profiles.driverHealthSettings));
                appState.profiles.isDriverSettingsModalOpen = true;
                renderDriverSettingsModal();
            }
            if (e.target.closest('#driver-health-settings-btn')) {
                appState.profiles.driverHealthSettings.isModalOpen = true;
                renderDriverHealthSettingsModal();
            }
        };
        driverToolbar.addEventListener('click', driverToolbar._clickHandler);
    }
    
    const summaryBar = document.getElementById('fleet-health-flag-summary');
    const summaryTooltip = document.getElementById('summary-tooltip');
    
    if (summaryBar && summaryTooltip && !summaryBar._tooltipListenersAttached) {
        summaryBar.addEventListener('mouseover', (e) => {
            const trigger = e.target.closest('.summary-tooltip-trigger');
            if (trigger && trigger.dataset.tooltipText) {
                summaryTooltip.innerHTML = trigger.dataset.tooltipText; // Use innerHTML for potential line breaks
                summaryTooltip.classList.remove('hidden');
                summaryTooltip.classList.add('visible');
                // Initial position update
                positionTooltip(e, summaryTooltip);
            }
        });
    
        summaryBar.addEventListener('mousemove', (e) => {
            if (summaryTooltip.classList.contains('visible')) {
                positionTooltip(e, summaryTooltip);
            }
        });
    
        summaryBar.addEventListener('mouseout', (e) => {
            const trigger = e.target.closest('.summary-tooltip-trigger');
            // Check if the mouse is still inside the summary bar but not over a trigger
            if (trigger || !summaryBar.contains(e.relatedTarget)) {
                summaryTooltip.classList.remove('visible');
                summaryTooltip.classList.add('hidden');
            }
        });
    
        summaryBar._tooltipListenersAttached = true;
    }
    
    // Helper function for positioning
    function positionTooltip(event, tooltipElement) {
        const offset = 15; // Distance from cursor
        const tooltipRect = tooltipElement.getBoundingClientRect();
        let left = event.pageX + offset;
        let top = event.pageY + offset;
    
        // Adjust if too close to the right edge
        if (left + tooltipRect.width > window.innerWidth - offset) {
            left = event.pageX - tooltipRect.width - offset;
        }
        // Adjust if too close to the bottom edge
        if (top + tooltipRect.height > window.innerHeight - offset) {
            top = event.pageY - tooltipRect.height - offset;
        }
        // Adjust if too close to the left edge
        if (left < offset) {
            left = offset;
        }
        // Adjust if too close to the top edge
        if (top < offset) {
            top = offset;
        }
    
        tooltipElement.style.left = `${left}px`;
        tooltipElement.style.top = `${top}px`;
    }

const driverFilterModal = document.getElementById('profiles-driver-filter-modal');
if (driverFilterModal && !driverFilterModal._listenersAttached) {
    const teamData = appState.profiles.currentTeamData;
    if (!teamData) return;

    const readCriteriaFromModal = () => {
        const criteriaRows = driverFilterModal.querySelectorAll('.driver-filter-criteria-row');
        return Array.from(criteriaRows).map((row) => {
            const columnId = row.querySelector('.column-select').value;
            const operator = row.querySelector('.operator-select').value;
            let value;
            const multiSelectContainer = row.querySelector('.filter-multiselect-container');
            const standardInput = row.querySelector('.value-input');
            const previousDaysContainer = row.querySelector('.load-filter-previous-days-container');

            if (multiSelectContainer && multiSelectContainer.offsetParent !== null) {
                value = Array.from(row.querySelectorAll('.multiselect-checkbox:checked')).map(cb => cb.value);
            } else if (previousDaysContainer && previousDaysContainer.offsetParent !== null) {
                 value = {
                    days: parseInt(row.querySelector('.load-filter-previous-days-input').value, 10) || 7,
                    from: row.querySelector('.load-filter-previous-days-from-select').value
                };
            } else if (standardInput && standardInput.offsetParent !== null) {
                value = standardInput.value;
            } else {
                value = null;
            }
            
            return { columnId, operator, value };
        }).filter(f => {
            if (['isEmpty', 'isNotEmpty'].includes(f.operator)) return true;
            if (f.operator === 'inPrevious') return f.value && !isNaN(f.value.days);
            return (Array.isArray(f.value) ? f.value.length > 0 : f.value !== '' && f.value !== null);
        });
    };

    const closeModal = () => {
        appState.profiles.driverFilters.isFilterModalOpen = false;
        renderDriverFilterModal();
    };

    driverFilterModal.querySelector('#close-driver-filter-modal-btn')?.addEventListener('click', closeModal);
    driverFilterModal.querySelector('#cancel-driver-filter-btn')?.addEventListener('click', closeModal);

    driverFilterModal.querySelector('#apply-driver-filter-btn')?.addEventListener('click', () => {
        const newFilters = readCriteriaFromModal();
        appState.profiles.driverFilters.activeFilters = newFilters;
        appState.profiles.activeSavedFilterId = null;
        closeModal();
        // --- FIX: Call the main render function ---
        renderTeamProfileUI();
        // --- END FIX ---
    });

    driverFilterModal.querySelector('#clear-driver-filters-btn')?.addEventListener('click', () => {
        appState.profiles.driverFilters.activeFilters = [];
        appState.profiles.activeSavedFilterId = 'all_drivers'; 
        closeModal();
        renderDriverToolbar(teamData);
        renderDriverTable(teamData.drivers);
    });

    driverFilterModal.querySelector('#save-driver-filter-btn')?.addEventListener('click', () => {
        const newFilters = readCriteriaFromModal();
        if (newFilters.length === 0) {
            alert("Please add at least one valid criterion before saving.");
            return;
        }
        
        appState.profiles.driverFilters.activeFilters = newFilters;
        appState.profiles.driverFilters.isSaveModalOpen = true;
        renderSaveFilterModal();
    });

    driverFilterModal._listenersAttached = true;
}

setupSettingsModal('profiles-driver-health-settings-modal', 'close-driver-health-settings-modal-btn', 'save-driver-health-settings-btn', 'driverHealthSettings');

    const driverSettingsModal = document.getElementById('profiles-driver-settings-modal');
    if (driverSettingsModal) {
        if (driverSettingsModal._clickHandler) driverSettingsModal.removeEventListener('click', driverSettingsModal._clickHandler);
        driverSettingsModal._clickHandler = (e) => {
            if (e.target.closest('#close-driver-settings-modal-btn')) {
                appState.profiles.isDriverSettingsModalOpen = false;
                appState.profiles.tempDriverHealthSettings = null;
                renderDriverSettingsModal();
            }
            if (e.target.closest('#save-driver-settings-btn')) {
                saveDriverHealthSettings();
            }
        };
        driverSettingsModal.addEventListener('click', driverSettingsModal._clickHandler);
        initializeDriverSettingsModalEventListeners(); 
    }

    const saveFilterModal = document.getElementById('save-driver-filter-modal');
    if (saveFilterModal && !saveFilterModal._clickHandlerAttached) {
        saveFilterModal.addEventListener('click', e => {
            if (e.target.closest('#close-save-driver-filter-modal-btn')) {
                appState.profiles.driverFilters.isSaveModalOpen = false;
                renderSaveFilterModal();
                appState.profiles.driverFilters.isFilterModalOpen = true;
                renderDriverFilterModal();
            }
            if (e.target.closest('#confirm-save-driver-filter-btn')) {
                const nameInput = document.getElementById('save-filter-name-input');
                const colorInput = document.getElementById('save-filter-color-input');
                const filterName = nameInput.value.trim();
                if (!filterName) {
                    alert('Please provide a name for the filter.');
                    return;
                }
                const filterToEdit = appState.profiles.driverFilters.filterToEdit;
                if (filterToEdit) {
                    const existingFilter = appState.profiles.savedDriverFilters.find(f => f.id === filterToEdit.id);
                    if (existingFilter) {
                        existingFilter.name = filterName;
                        existingFilter.color = colorInput.value;
                        existingFilter.criteria = [...appState.profiles.driverFilters.activeFilters];
                        existingFilter.logic = appState.profiles.driverFilters.filterLogic;
                    }
                } else {
                    const newFilter = {
                        id: `custom_${Date.now()}`,
                        name: filterName,
                        color: colorInput.value,
                        isDefault: false,
                        criteria: [...appState.profiles.driverFilters.activeFilters],
                        logic: appState.profiles.driverFilters.filterLogic,
                    };
                    appState.profiles.savedDriverFilters.push(newFilter);
                    appState.profiles.activeSavedFilterId = newFilter.id;
                }

                appState.profiles.driverFilters.filterToEdit = null;
                appState.profiles.driverFilters.isSaveModalOpen = false;
                appState.profiles.driverFilters.isFilterModalOpen = false;

                renderSaveFilterModal();
                renderDriverFilterModal();
                renderTeamProfileUI();
            }
        });
        saveFilterModal._clickHandlerAttached = true;
    }
    // Listener for KPI settings changes from profiles_kpi.js
    if (!document.body.kpiListenerAttached) {
        document.addEventListener('kpi-settings-changed', () => {
            // Re-render UI when KPI settings change
            renderTeamProfileUI(); 
        });
        document.body.kpiListenerAttached = true;
    }
}


window.requestDispatchSort = (key) => {
    const { sortConfig } = appState.profiles.dispatchTable;
    const teamData = appState.profiles.currentTeamData;
    if (!teamData) return;

    let direction = 'descending';
    if (sortConfig.key === key && sortConfig.direction === 'descending') {
        direction = 'ascending';
    }
    appState.profiles.dispatchTable.sortConfig = { key, direction };
    // FIX: Use appState.profiles.allProcessedDispatchers as the second argument
    renderDispatchTable(teamData.dispatchers, appState.profiles.allProcessedDispatchers);
};


window.requestDriverSort = (key) => {
    const { sortConfig } = appState.profiles.driverTable;
    const teamData = appState.profiles.currentTeamData;
    if (!teamData) return;

    let direction = 'descending';
    if (sortConfig.key === key && sortConfig.direction === 'descending') {
        direction = 'ascending';
    }
    appState.profiles.driverTable.sortConfig = { key, direction };
    renderDriverTable(teamData.drivers);
};

function generateDispatchTooltipHTML(dispatcher, metricId, allLoadsForSearch) {
    const title = `<strong class="tooltip-title">${metricId.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())} for ${dispatcher.name}</strong>`;
    let content = '';
    const allLoadsForDispatcher = dispatcher.loads || [];
    let filteredLoads = [];

    const goodMoveThresholds = appState.profiles.thresholdSettings.goodMove;

    const findPreviousLoad = (currentLoad) => {
        if (!currentLoad.driver || typeof currentLoad.load_order !== 'number' && typeof currentLoad.load_order !== 'string') {
            return null;
        }

        const currentOrder = parseInt(currentLoad.load_order, 10);
        if (isNaN(currentOrder)) return null;

        const targetLoadOrder = currentOrder - 1;

        const driverLoads = allLoadsForSearch.filter(l => l.driver === currentLoad.driver);

        return driverLoads.find(l => l.load_order != null && parseInt(l.load_order, 10) === targetLoadOrder) || null;
    };

    switch (metricId) {
        case 'goodMoves':
            filteredLoads = allLoadsForDispatcher.filter(l => l.moved_monday === 'Moved Monday Load' && (l.driver_gross_without_moved < (goodMoveThresholds.by_contract[l.contract_type] ?? goodMoveThresholds.default)));
            break;
        case 'badMoves':
            filteredLoads = allLoadsForDispatcher.filter(l => l.moved_monday === 'Moved Monday Load' && (l.driver_gross_without_moved >= (goodMoveThresholds.by_contract[l.contract_type] ?? goodMoveThresholds.default)));
            break;
        case 'canceled':
            filteredLoads = allLoadsForDispatcher.filter(l => l.status === 'Canceled');
            break;
        case 'hiddenMiles':
            filteredLoads = allLoadsForDispatcher.filter(l => l.hidden_miles === 'Hidden Miles Found!');
            break;
        case 'lowRpm':
            filteredLoads = allLoadsForDispatcher.filter(l => l.rpm_all < getLowRpmThreshold(l.contract_type));
            break;
        case 'newStarts':
            filteredLoads = allLoadsForDispatcher.filter(l => l.new_start === 'NEW START');
            break;
            case 'overdueLoads':
            // --- FIX START: Filter tooltip data by the selected week ---
            const { selectedWeek } = appState.profiles;
            const weeksAgoTooltip = selectedWeek === 'live' ? 0 : parseInt(selectedWeek.replace('week_', ''), 10);
            // Get the date range for the currently selected week in the UI
            const { start: currentStartTooltip, end: currentEndTooltip } = getPayrollWeekDateRange(weeksAgoTooltip);

            filteredLoads = appState.profiles.overdueLoadsData
                .filter(ol => {
                    // Filter by dispatcher AND check if the deliveryDate falls within the selected week
                    if (ol.dispatcher !== dispatcher.name || !ol.deliveryDate) return false;
                    const deliveryDate = new Date(ol.deliveryDate);
                    return deliveryDate >= currentStartTooltip && deliveryDate <= currentEndTooltip;
                });
            // --- FIX END ---
            break;
            case 'tuesdayOpen':
                // Get the date range for the currently selected week
                const weekSelection = appState.profiles.selectedWeek === 'live' ? 0 : parseInt(appState.profiles.selectedWeek.replace('week_', ''), 10);
                const { start: tStart, end: tEnd } = getPayrollWeekDateRange(weekSelection);
                
                // Filter raw tuesdayOpenData using the Shift Logic
                filteredLoads = (appState.profiles.tuesdayOpenData || []).filter(d => {
                    if (d.dispatch !== dispatcher.name) return false;
                    
                    const dDate = new Date(d.date);
                    const shiftBack = dDate.getUTCDay() === 2 ? 1 : 0; // 2 = Tuesday
                    dDate.setUTCDate(dDate.getUTCDate() - shiftBack);
    
                    return dDate >= tStart && dDate <= tEnd;
                });
                
                if (filteredLoads.length > 0) {
                    const rows = filteredLoads.map(item => `
                        <div class="tooltip-load-row-flex">
                            <span class="font-bold text-gray-400">#${item.id}</span>
                            <span class="tooltip-details-flex ml-auto">${new Date(item.date).toLocaleDateString('en-US', { timeZone: 'UTC' })}</span>
                        </div>
                    `).join('');
                    return `${title}<div class="tooltip-load-list">${rows}</div>`;
            }
            break;
        case 'missingPaperwork':
            // Get date range for current view
            const weekSelectionMP = appState.profiles.selectedWeek === 'live' ? 0 : parseInt(appState.profiles.selectedWeek.replace('week_', ''), 10);
            const { start: mpStart, end: mpEnd } = getPayrollWeekDateRange(weekSelectionMP);
            
            // Filter raw missingPaperworkData
            filteredLoads = (appState.profiles.missingPaperworkData || []).filter(d => {
                if (d.dispatch !== dispatcher.name) return false;
                const dDate = new Date(d.do_date);
                return dDate >= mpStart && dDate <= mpEnd;
            });
            
            if (filteredLoads.length > 0) {
                const rows = filteredLoads.map(item => `
                    <div class="tooltip-load-row-flex">
                        <span class="font-bold text-gray-400">#${item.id}</span>
                        <span class="tooltip-details-flex ml-auto">${new Date(item.do_date).toLocaleDateString('en-US', { timeZone: 'UTC' })}</span>
                    </div>
                `).join('');
                return `${title}<div class="tooltip-load-list">${rows}</div>`;
            }
            break;
        case 'trailerDrops':
        case 'trailerRecoveries':
            const dropsOrRecs = metricId === 'trailerDrops' ? dispatcher.trailerDropsDetails : dispatcher.trailerRecoveriesDetails;
            if (dropsOrRecs && dropsOrRecs.length > 0) {
                const rows = dropsOrRecs.map(item => {
                    const time = metricId === 'trailerDrops' ? item.dropTime : item.recoveryTime;
                    const dateStr = new Date(time).toLocaleString('en-US', {month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit'});
                    return `
                    <div class="tooltip-load-row-flex">
                        <span class="font-bold text-gray-400">#${item.trailerId}</span>
                        <span class="tooltip-driver-name">${item.unit || 'N/A'}</span>
                        <span class="tooltip-details-flex ml-auto">${dateStr}</span>
                    </div>`;
                }).join('');
                return `${title}<div class="tooltip-load-list">${rows}</div>`;
            }
            break;
        case 'wellness':
            const goodLoads = allLoadsForDispatcher.filter(d => d.wellness_fail === 'GOOD');
            const passedLoads = allLoadsForDispatcher.filter(d => d.wellness_fail === '-');
            const failedLoads = allLoadsForDispatcher.filter(d => d.wellness_fail === 'FAIL');

            let stats = `<div class="tooltip-grid">
                <span class="tooltip-label">Passed Wellness Plan:</span><span class="tooltip-value-green">${goodLoads.length}</span>
                <span class="tooltip-label">Good Wellness:</span><span class="tooltip-value-green">${passedLoads.length}</span>
                <span class="tooltip-label">Failed Wellness Plan:</span><span class="tooltip-value-orange">${failedLoads.length}</span>
            </div>`;

            if (failedLoads.length > 0) {
            stats += `<hr class="tooltip-hr"><strong class="tooltip-title !mb-1">Failed Wellness Plan Details</strong>`;
            const failedLoadsList = failedLoads.map(load =>
                `<div class="tooltip-load-row-flex">
                    <span class="font-bold text-gray-400">#${load.id}</span>
                    <span class="tooltip-driver-name">${load.driver || 'N/A'}</span>
                    <span class="tooltip-route-flex">${load.pu_location || 'N/A'} → ${load.do_location || 'N/A'}</span>
                </div>`
            ).join('');
            content = `<div class="tooltip-load-list">${stats}${failedLoadsList}</div>`;
        } else {
            content = stats;
        }
        return title + content; // Return directly since content is fully built
    default:
        return 'No details available.';
}

if (filteredLoads.length === 0) {
    return `${title}<div class="p-2 text-gray-500">No matching loads found.</div>`;
}

if (metricId === 'newStarts') {
    const newStartsByDriver = filteredLoads.reduce((acc, load) => {
        const driver = load.driver;
        if (!acc[driver] || new Date(load.pu_date) < new Date(acc[driver].pu_date)) {
            acc[driver] = load;
        }
        return acc;
    }, {});

    const sortedNewStarts = Object.values(newStartsByDriver).sort((a,b) => new Date(a.pu_date) - new Date(b.pu_date));

    content = `<div class="tooltip-load-list">${sortedNewStarts.map(load => {
        const puDate = new Date(load.pu_date);
        const dayOfWeek = puDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
        const formattedDate = puDate.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });

        return `<div class="tooltip-load-row-flex">
            <span class="tooltip-driver-name">${load.driver || 'N/A'}</span>
            <span class="tooltip-details-flex ml-auto">First load on ${formattedDate} (${dayOfWeek})</span>
        </div>`;
    }).join('')}</div>`;

} else {
    const loadToHtml = (load) => {
        let details = '';
        let loadId = load.id; // Default for non-overdue
        let driverName = load.driver; // Default
        let puLocation = load.pu_location; // Default
        let doLocation = load.do_location; // Default

        // --- Logic specific to OVERDUE loads ---
        if (metricId === 'overdueLoads') {
             loadId = load.loadId; // Use loadId from overdue data
             driverName = load.driver;
             puLocation = 'N/A'; // Assume not available in overdue data
             doLocation = 'N/A';
             details = `Status: <span class="tooltip-value-orange">${load.status}</span> | Days Past: <span class="tooltip-value-red">${load.daysPastDO}</span>`;
        }
        // --- Logic for OTHER metrics ---
        else {
            switch (metricId) {
                case 'goodMoves':
                case 'badMoves':
                    const threshold = goodMoveThresholds.by_contract[load.contract_type] ?? goodMoveThresholds.default;
                    details = `Gross w/o: <span class="tooltip-rate">$${(load.driver_gross_without_moved || 0).toLocaleString()}</span> (Thresh: $${threshold.toLocaleString()})`;
                    break;
                case 'lowRpm':
                    details = `RPM: <span class="tooltip-value-yellow">$${(load.rpm_all || 0).toFixed(2)}</span>`;
                    break;
                case 'canceled':
                    details = `Status: <span class="tooltip-canceled">Canceled</span>`;
                    break;
                case 'hiddenMiles':
                 const startCity = load.start_location_city || '-';
                 const startState = load.start_location_state || '';
                 const previousLoad = findPreviousLoad(load); // You need findPreviousLoad defined elsewhere
                 const prevDOLocation = previousLoad ? previousLoad.do_location : '-';
                 details = `Prev DO: <span class="tooltip-value-purple">${prevDOLocation}</span> | Start: <span class="tooltip-value-purple">${startCity}, ${startState}</span>`;
                 break;
            }
         }

        // Common HTML structure for all tooltip rows
        return `<div class="tooltip-load-row-flex">
        <span class="font-bold text-gray-400" style="flex-shrink: 0;">#${loadId}</span>
            <span class="tooltip-driver-name">${driverName || 'N/A'}</span>
            ${metricId !== 'overdueLoads' ? `<span class="tooltip-route-flex">${puLocation || 'N/A'} → ${doLocation || 'N/A'}</span>` : ''}
            <span class="tooltip-details-flex ml-auto">${details}</span>
        </div>`;
    };
    content = `<div class="tooltip-load-list">${filteredLoads.map(loadToHtml).join('')}</div>`;
}

return title + content;
}

function copyToClipboard(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed'; 
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

    const teamData = appState.profiles.currentTeamData;
    if (!teamData) {
        container.innerHTML = `<p class="text-gray-400">Driver data is not available for filtering.</p>`;
        return;
    }

    const readModalState = () => {
        const rows = container.querySelectorAll('.driver-filter-criteria-row');
        if (!rows || rows.length === 0) return [];
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

    // --- START: UPDATED FILTERABLE COLUMNS ---
    const filterColumns = [
        { id: 'rowNum', label: '#', type: 'number' },
        { id: 'name', label: 'Driver Name', type: 'string' },
        { id: 'status', label: 'Status', type: 'select', options: ['Active', 'Terminated'] },
        { id: 'company', label: 'Company', type: 'select', options: [...new Set(teamData.drivers.map(d => d.company))] },
        { id: 'dispatcher', label: 'Dispatcher', type: 'select', options: [...new Set(teamData.drivers.map(d => d.dispatcher))] },
        { id: 'team', label: 'Team', type: 'select', options: [...new Set(teamData.drivers.map(d => d.team))] },
        { id: 'contract', label: 'Contract', type: 'select', options: ['OO', 'LOO'] },
        { id: 'equipment', label: 'Equipment', type: 'select', options: ['V', 'R', 'F'] },
        { id: 'flags', label: 'Flags', type: 'multiselect', options: [...new Set(teamData.drivers.flatMap(d => d.flags.map(f => f.text)))] },
        { id: 'risk', label: 'Drop Risk %', type: 'number' },
        { id: 'gross', label: 'Weekly Gross', type: 'number' },
        { id: 'margin', label: 'Margin', type: 'number' },
        { id: 'rpm', label: 'RPM', type: 'number' },
        { id: 'miles', label: 'Total Miles', type: 'number' }
    ];
    // --- END: UPDATED FILTERABLE COLUMNS ---

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
        
        const validOperatorsForType = operators[selectedColumn.type] || operators.string;
        const isOperatorValid = validOperatorsForType.some(op => op.v === filter.operator);

        if (!filter.operator || !isOperatorValid) {
            filter.operator = validOperatorsForType[0].v;
        }

        const ops = validOperatorsForType;
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
        
        const multiSelectTrigger = row.querySelector('.multiselect-trigger');
        if (multiSelectTrigger) {
            multiSelectTrigger.addEventListener('click', (e) => {
                const panel = e.target.nextElementSibling;
                panel.classList.toggle('hidden');
            });
        }
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

function renderContractTypeFilterDropdown() {
    const container = document.getElementById('contract-type-filter-container');
    if (!container) return;

    const existingDropdown = document.getElementById('contract-type-filter-dropdown');
    if (existingDropdown) existingDropdown.remove();

    if (!appState.profiles.isContractTypeFilterOpen) return;

    const dropdown = document.createElement('div');
    dropdown.id = 'contract-type-filter-dropdown';
    dropdown.className = 'absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 p-2';

    const options = [
        { id: 'all', label: 'All Drivers' },
        { id: 'oo', label: 'OO Only' },
        { id: 'loo', label: 'LOO Only' },
    ];

    let dropdownHTML = `<div class="text-xs uppercase text-gray-400 font-bold mb-2">Filter Contract Type</div>`;
    
    options.forEach(opt => {
        const isActive = appState.profiles.contractTypeFilter === opt.id;
        dropdownHTML += `
            <a href="#" data-filter="${opt.id}" class="contract-type-option flex items-center justify-between p-1.5 hover:bg-gray-600 rounded-md text-sm ${isActive ? 'text-teal-400 font-semibold' : 'text-gray-200'}">
                <span>${opt.label}</span>
                ${isActive ? '<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.052-.143z" clip-rule="evenodd" /></svg>' : ''}
            </a>
        `;
    });
    
    dropdown.innerHTML = dropdownHTML;
    container.appendChild(dropdown);

    dropdown.querySelectorAll('.contract-type-option').forEach(optionEl => {
        optionEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            appState.profiles.contractTypeFilter = e.currentTarget.dataset.filter;
            appState.profiles.isContractTypeFilterOpen = false; 
            renderTeamProfileUI(); 
        });
    });
}

function renderCompanyFilterDropdown() {
    const container = document.getElementById('company-filter-container');
    if (!container) return;

    const existingDropdown = document.getElementById('company-filter-dropdown');
    if (existingDropdown) existingDropdown.remove();

    if (!appState.profiles.isCompanyFilterOpen) return;

    const dropdown = document.createElement('div');
    dropdown.id = 'company-filter-dropdown';
    dropdown.className = 'absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 p-2';

    const { selectedTeam } = appState.profiles;
    const user = appState.auth.user;
    const specialPrefixes = ['agnius', 'uros', 'miles', 'wayne', 'mubeen', 'vito'];
    let options = ['All Companies'];
    let relevantData = appState.profiles.liveData || [];

    // 1. Filter data based on user permissions FIRST.
    if (!hasPermission(user, PERMISSIONS.VIEW_ALL_TEAMS)) {
        const userAccessItems = (Array.isArray(user.access) ? user.access : String(user.access || '').split(','))
            .map(item => String(item).trim().toLowerCase())
            .filter(Boolean);

        relevantData = relevantData.filter(d => {
            const itemTeam = (d.team || '').toLowerCase();
            if (!itemTeam) return false;

            // Check direct team access (e.g., 'SMT')
            if (userAccessItems.includes(itemTeam)) return true;

            // Check composite team access (e.g., 'agnius amongus')
            const prefix = specialPrefixes.find(p => itemTeam.startsWith(p));
            if (prefix && d.company_name) {
                const compositeName = `${prefix} ${d.company_name.toLowerCase()}`;
                if (userAccessItems.includes(compositeName)) return true;
            }
            return false;
        });
    }

    // 2. NOW, filter the permission-filtered data by the selected team in the UI.
    if (selectedTeam !== 'ALL_TEAMS') {
        const teamLower = selectedTeam.toLowerCase();
        if (specialPrefixes.includes(teamLower)) {
            relevantData = relevantData.filter(d => d.team && d.team.toLowerCase().startsWith(teamLower));
        } else {
            relevantData = relevantData.filter(d => d.team === selectedTeam);
        }
    }

    // 3. Extract unique companies from the final dataset.
    const companies = [...new Set(relevantData.map(d => d.company_name).filter(Boolean))].sort();
    if (companies.length > 0) {
        options = ['All Companies', ...companies];
    }


    let dropdownHTML = `<div class="text-xs uppercase text-gray-400 font-bold mb-2">Filter Company</div>`;

    options.forEach(opt => {
        const isActive = appState.profiles.selectedCompany === opt;
        dropdownHTML += `
            <a href="#" data-filter="${opt}" class="company-filter-option flex items-center justify-between p-1.5 hover:bg-gray-600 rounded-md text-sm ${isActive ? 'text-teal-400 font-semibold' : 'text-gray-200'}">
                <span>${opt}</span>
                ${isActive ? '<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.052-.143z" clip-rule="evenodd" /></svg>' : ''}
            </a>
        `;
    });

    dropdown.innerHTML = dropdownHTML;
    container.appendChild(dropdown);

    dropdown.querySelectorAll('.company-filter-option').forEach(optionEl => {
        optionEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            appState.profiles.selectedCompany = e.currentTarget.dataset.filter;
            appState.profiles.isCompanyFilterOpen = false;
            renderTeamProfileUI(); 
        });
    });
}
window.requestDriverSummaryMode = (mode) => {
    // If the user clicks the currently active button, turn it off.
    if (appState.profiles.driverSummaryMode === mode) {
        appState.profiles.driverSummaryMode = 'none';
    } else {
        appState.profiles.driverSummaryMode = mode;
    }
    
    const teamData = appState.profiles.currentTeamData;
    if (teamData) {
        renderDriverTable(teamData.drivers);
    }
};
window.requestDispatchSort = (key) => {
    const { sortConfig } = appState.profiles.dispatchTable;
    const teamData = appState.profiles.currentTeamData;
    if (!teamData) return;

    let direction = 'descending';
    if (sortConfig.key === key && sortConfig.direction === 'descending') {
        direction = 'ascending';
    }
    appState.profiles.dispatchTable.sortConfig = { key, direction };
    renderDispatchTable(teamData.dispatchers, teamData.dispatchers);
};

window.requestDriverSort = (key) => {
    const { sortConfig } = appState.profiles.driverTable;
    const teamData = appState.profiles.currentTeamData;
    if (!teamData) return;

    let direction = 'descending';
    if (sortConfig.key === key && sortConfig.direction === 'descending') {
        direction = 'ascending';
    }
    appState.profiles.driverTable.sortConfig = { key, direction };
    renderDriverTable(teamData.drivers);
};


/**
 * Calculates the start (Tuesday) and end (Monday) of a pay period from a given pay date (Thursday),
 * accounting for potential delays.
 * @param {string} payDateString - The pay date from the stub (e.g., "8/28/2025").
 * @param {number} [payDelayWeeks=1] - The pay delay in weeks (1 = standard, 2 = delayed one week).
 * @returns {{start: Date, end: Date}}
 */
function getPayPeriodFromPayDate(payDateString, payDelayWeeks = 1) {
    const payDate = new Date(payDateString);
    payDate.setUTCHours(0, 0, 0, 0);

    // Standard delay assumes pay date (Thursday) is 3 days after the period ends (Monday).
    // If payDelayWeeks is 2, it's 10 days after (3 standard + 7 delay).
    const daysSincePeriodEnd = payDelayWeeks === 2 ? 10 : 3;

    const end = new Date(payDate);
    end.setUTCDate(payDate.getUTCDate() - daysSincePeriodEnd);
    end.setUTCHours(23, 59, 59, 999); // End of Monday

    // The period started on the Tuesday 6 days before the end Monday.
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - 6);
    start.setUTCHours(0, 0, 0, 0); // Start of Tuesday

    return { start, end };
}

/**
 * Generates a trend display for snapshot KPIs.
 */
function getSnapshotTrend(current, previous, lowerIsBetter = false) {
    if (current === null || previous === null || isNaN(current) || isNaN(previous)) {
        return '<span class="trend neutral">--</span>';
    }
    const change = current - previous;

    // FIX 1: Use a smarter threshold that adapts to small vs large numbers, just like the main KPIs.
    const threshold = Math.abs(previous) > 1000 ? 0.5 : 0.005; 
    if (Math.abs(change) < threshold) {
        return '<span class="trend neutral">--</span>';
    }

    const isGood = lowerIsBetter ? change < 0 : change > 0;
    const color = isGood ? 'good' : 'bad';
    // FIX 2: Arrow direction is now correctly based on whether the change is beneficial.
    const arrow = isGood ? '▲' : '▼';
    
    return `<span class="trend ${color}">${arrow}</span>`;
}

/**
 * Generates the title for the snapshot panel based on active filters.
 */
function generateSnapshotTitle() {
    const { selectedTeam, selectedCompany, contractTypeFilter, selectedWeek } = appState.profiles;
    const weeksAgo = selectedWeek === 'live' ? 0 : parseInt(selectedWeek.replace('week_', ''), 10);
    const weekLabel = getProfilePayrollWeek(weeksAgo).label;

    let context = [];

    if (selectedCompany !== 'All Companies') {
        context.push(selectedCompany);
    } else if (selectedTeam !== 'ALL_TEAMS') {
        context.push(selectedTeam);
    } else {
        context.push("All Teams");
    }

    if (contractTypeFilter !== 'all') {
        context.push(`(${contractTypeFilter.toUpperCase()})`);
    }

    return `${context.join(' ')} | ${weekLabel}`;
}
function generateSnapshotData() {
    const user = appState.auth.user;
    let dispatcherNameFromAccess = null;
    let isDispatcherRole = user && user.role === 'Dispatcher' && !isAdmin();

    if (isDispatcherRole) {
        if (Array.isArray(user.access) && user.access.length > 0) {
            dispatcherNameFromAccess = String(user.access[0]).trim();
        } else if (typeof user.access === 'string' && user.access.trim()) {
            dispatcherNameFromAccess = user.access.split(',')[0].trim();
        }
    }

    const { currentTeamData, selectedWeek, selectedTeam, contractTypeFilter, selectedCompany, selectedFranchise } = appState.profiles;
    const cacheKey = `${selectedWeek}-${selectedTeam}-${contractTypeFilter}-${selectedCompany}-${selectedFranchise}-${dispatcherNameFromAccess || ''}`;

    if (!currentTeamData) return null;

    const cachedKpis = appState.profiles.fleetHealthCache[cacheKey];

    if (!cachedKpis || !cachedKpis.currentKpis || !cachedKpis.prevWeekKpis) {
         console.warn("Snapshot data could not be generated because KPI cache is not ready. Cache key:", cacheKey);
         return null;
    }

    const currentKpis = cachedKpis.currentKpis;
    const prevWeekKpis = cachedKpis.prevWeekKpis;

    const kpis = {
        totalGross: { value: currentKpis.totalGross, trend: getSnapshotTrend(currentKpis.totalGross, prevWeekKpis.totalGross) },
        totalMargin: { value: currentKpis.teamMargin, trend: getSnapshotTrend(currentKpis.teamMargin, prevWeekKpis.teamMargin) },
        totalRpm: { value: currentKpis.teamRpm, trend: getSnapshotTrend(currentKpis.teamRpm, prevWeekKpis.teamRpm) },
        activeTrucks: { value: currentKpis.activeTrucks, trend: getSnapshotTrend(currentKpis.activeTrucks, prevWeekKpis.activeTrucks) },
        dispatchers: { value: currentKpis.dispatchers, trend: getSnapshotTrend(currentKpis.dispatchers, prevWeekKpis.dispatchers) },
        avgWellness: { value: currentKpis.medianWellness, trend: getSnapshotTrend(currentKpis.medianWellness, prevWeekKpis.medianWellness) }
    };

    // --- START OF FIX ---
    // Use the filtered 'dispatchers' from the currentTeamData for all snapshot rankings.
    const { dispatchers, drivers } = currentTeamData;

    const sortedByRank = [...dispatchers].sort((a, b) => (a.rank1w || Infinity) - (b.rank1w || Infinity));
    const sortedByCompliance = [...dispatchers].sort((a, b) => (b.complianceScore || 0) - (a.complianceScore || 0));
    // --- END OF FIX ---
    
    const highRiskDrivers = [...drivers].sort((a, b) => b.risk - a.risk).slice(0, 5);
    
    const flagSnapshot = drivers.flatMap(d => d.flags.map(f => f.text)).reduce((acc, flag) => {
        acc[flag] = (acc[flag] || 0) + 1;
        return acc;
    }, {});
    
    const badMoves = dispatchers.reduce((sum, d) => sum + (d.badMoves || 0), 0);
    if (badMoves > 0) flagSnapshot['Bad Moves'] = badMoves;

    return {
        kpis,
        bestDispatchersRank: sortedByRank.slice(0, 3),
        worstDispatchersRank: sortedByRank.filter(d => d.rank1w !== null).slice(-3).reverse(),
        worstDispatchersCompliance: sortedByCompliance.slice(-3).reverse(),
        highRiskDrivers,
        flagSnapshot
    };
}

/**
 * Renders the D3 chart for the snapshot panel with adaptive logic.
 */
export function renderSnapshotChart(containerId) {
    const container = d3.select(`#${containerId}`);
    container.html(""); // Clear previous chart

    const containerNode = container.node();
    if (!containerNode) return;
    const { width: containerWidth, height: containerHeight } = containerNode.getBoundingClientRect();

    if (containerWidth < 50 || containerHeight < 50) {
        setTimeout(() => renderSnapshotChart(containerId), 50);
        return;
    }

    const originalDriverFilter = appState.driverTypeFilter;
    appState.driverTypeFilter = appState.profiles.contractTypeFilter;

    const { selectedTeam, selectedCompany } = appState.profiles;
    const allTeams = [...new Set(appState.allHistoricalData.map(d => d.dispatcherTeam).filter(Boolean))];
    let datasets = [];
    let yLabel = "Rank";

    if (selectedCompany !== 'All Companies') {
        const entityName = selectedCompany;
        datasets.push({ name: entityName, data: getCompanyOrAllTeamsCriteriaHistory(entityName, 'company', appState.allHistoricalData, 8) });
        yLabel = "Avg Criteria";
    } else if (selectedTeam !== 'ALL_TEAMS') {
        const teamsToPlot = allTeams.filter(t => t.startsWith(selectedTeam));
        
        if (teamsToPlot.length > 0) {
            teamsToPlot.forEach(teamName => {
                const shortName = teamName.replace(selectedTeam, '').trim() || teamName;
                datasets.push({ name: shortName, data: getTeamRankHistory(teamName, appState.allHistoricalData, 8) });
            });
        } else {
            datasets.push({ name: selectedTeam, data: getTeamRankHistory(selectedTeam, appState.allHistoricalData, 8) });
        }
    } else {
        datasets.push({ name: "All Teams", data: getCompanyOrAllTeamsCriteriaHistory('ALL_TEAMS', 'all', appState.allHistoricalData, 8) });
        yLabel = "Avg Criteria";
    }

    appState.driverTypeFilter = originalDriverFilter;

    const chartData = datasets.flatMap(ds => ds.data.filter(d => d.value !== null));
    if (!chartData || chartData.length === 0) {
        container.html(`<div class="flex items-center justify-center h-full text-gray-500 text-sm">Not enough historical data for trend.</div>`);
        return;
    }
    
    const margin = { top: 20, right: 15, bottom: 40, left: 15 };
    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;

    const svg = container.append("svg").attr("width", containerWidth).attr("height", containerHeight)
        .append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleTime().domain(d3.extent(chartData, d => d.date)).range([0, width]);
    const y = d3.scaleLinear().domain(d3.extent(chartData, d => d.value)).range([height, 0]).nice();
    if (yLabel === "Rank") y.domain([d3.max(chartData, d => d.value) * 1.1, 0.5]);
    
   const uniqueDates = [...new Set(chartData.map(d => d.date.getTime()))].sort((a, b) => a - b).map(t => new Date(t));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).tickValues(uniqueDates).tickFormat(d3.timeFormat("%b %d")));
    
    svg.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(4).tickSize(-width).tickFormat('')).select('.domain').remove();

    const colorScale = d3.scaleOrdinal(["#2dd4bf", "#a78bfa", "#f472b6", "#fbbf24"]);

    datasets.forEach((dataset, i) => {
        const color = colorScale(i);
        const line = d3.line().x(d => x(d.date)).y(d => y(d.value)).defined(d => d.value !== null);
        svg.append("path").datum(dataset.data).attr("class", "chart-line").attr("d", line).style("stroke", color);

        svg.selectAll(`.label-${i}`).data(dataset.data.filter(d => d.value !== null))
           .enter().append("text")
           .attr("class", "chart-data-label")
           .attr("x", d => x(d.date))
           .attr("y", d => y(d.value) - 6)
           .attr("fill", color)
           .text(d => yLabel === "Rank" ? `#${d.value}` : d3.format(".0%")(d.value));
    });

    if (datasets.length > 1) {
        const legend = container.append("div").attr("class", "snapshot-chart-legend");
        datasets.forEach((ds, i) => {
            legend.append("div").attr("class", "snapshot-legend-item")
                .html(`<div class="snapshot-legend-color" style="background-color: ${colorScale(i)};"></div> ${ds.name}`);
        });
    }

    // --- START OF TOOLTIP FIX ---
    // Create a dedicated tooltip for this chart instance
    const tooltip = container.append("div")
        .attr("class", "d3-tooltip")
        .style("opacity", 0);
    // --- END OF TOOLTIP FIX ---

    const focus = svg.append("g")
        .attr("class", "focus")
        .style("display", "none");

    focus.append("line")
        .attr("class", "x-hover-line")
        .attr("y1", 0)
        .attr("y2", height);

    datasets.forEach((ds, i) => {
        focus.append("circle")
            .attr("r", 4)
            .attr("class", `focus-circle-${i}`)
            .style("fill", colorScale(i))
            .style("stroke", "white");
    });

    svg.append("rect")
        .attr("width", width)
        .attr("height", height)
        .style("fill", "none")
        .style("pointer-events", "all")
        .on("mouseover", () => { focus.style("display", null); tooltip.style("opacity", 1); })
        .on("mouseout", () => { focus.style("display", "none"); tooltip.style("opacity", 0); })
        .on("mousemove", mousemove);

    function mousemove(event) {
        const bisectDate = d3.bisector(d => d.date).left;
        const [pointerX, pointerY] = d3.pointer(event);
        const x0 = x.invert(pointerX);
        let tooltipHtml = `<strong>${d3.timeFormat("%b %d, %Y")(x0)}</strong>`;
        let closestDateForLine = null;

        datasets.forEach((dataset, i) => {
            const data = dataset.data.filter(d => d.value !== null);
            if (data.length === 0) return;
            
            const index = bisectDate(data, x0, 1);
            const d0 = data[index - 1];
            const d1 = data[index];
            const d = (d1 && d0) ? (x0 - d0.date > d1.date - x0 ? d1 : d0) : (d0 || d1);

            if (d) {
                closestDateForLine = d.date; 
                focus.select(`.focus-circle-${i}`)
                    .attr("transform", `translate(${x(d.date)},${y(d.value)})`);
                
                const formattedValue = yLabel === "Rank" ? `#${d.value}` : d3.format(".0%")(d.value);
                tooltipHtml += `<br><span style="color:${colorScale(i)}">●</span> ${dataset.name}: ${formattedValue}`;
            }
        });

        if (closestDateForLine) {
            focus.select(".x-hover-line").attr("transform", `translate(${x(closestDateForLine)},0)`);
        }

        tooltip.html(tooltipHtml);
        
        // Get container dimensions, which are available in this scope
        const tooltipNode = tooltip.node();
        if (!tooltipNode) return; // Safety check
        
        const tooltipWidth = tooltipNode.offsetWidth;
        const tooltipHeight = tooltipNode.offsetHeight;
        let tooltipLeft = pointerX + 15;
        let tooltipTop = pointerY - 28; // Position above cursor

        // Check right edge (relative to container)
        if (tooltipLeft + tooltipWidth > containerWidth) {
            tooltipLeft = pointerX - tooltipWidth - 15;
        }
        // Check left edge (relative to container)
        if (tooltipLeft < 0) {
            tooltipLeft = 5; // Small buffer
        }
        // Check top edge (relative to container)
        if (tooltipTop < 0) {
            tooltipTop = pointerY + 15; // Flip below
        }
        // Check bottom edge (relative to container)
        if (tooltipTop + tooltipHeight > containerHeight) {
            tooltipTop = containerHeight - tooltipHeight - 5; // Nudge up
        }

        tooltip.style("left", `${tooltipLeft}px`).style("top", `${tooltipTop}px`);
    }
}

/**
 * Renders the entire snapshot panel with dynamic data.
 */
export function renderTeamSnapshot() {
    const panel = document.getElementById('snapshot-panel');
    const content = document.getElementById('snapshot-content');
    if (!panel || !content) return;

    if (!appState.profiles.isSnapshotOpen) {
        panel.classList.remove('open');
        return;
    }
    
    panel.classList.add('open');
    document.getElementById('snapshot-title').textContent = generateSnapshotTitle();
    
    const data = generateSnapshotData();
    if (!data) {
        content.innerHTML = `<p class="text-gray-400 p-4 text-center">No data available.</p>`;
        return;
    }

    const { kpis, bestDispatchersRank, worstDispatchersRank, worstDispatchersCompliance, highRiskDrivers, flagSnapshot } = data;
    
    const flagKpis = [
        { label: 'Balance/PO', value: flagSnapshot['Balance'] || 0 },
        { label: 'High Tolls', value: flagSnapshot['High Tolls'] || 0 },
        { label: 'Low Net', value: flagSnapshot['Low Net'] || 0 },
        { label: 'Low RPM', value: flagSnapshot['Low RPM'] || 0 },
        { label: 'Low Gross', value: flagSnapshot['Low Gross'] || 0 },
        { label: 'Heavy Loads', value: flagSnapshot['Heavy Loads'] || 0 },
        { label: 'Bad Moves', value: flagSnapshot['Bad Moves'] || 0 },
        { label: 'Hopper', value: flagSnapshot['Hopper'] || 0 },
    ];

    content.innerHTML = `
        <div class="snapshot-kpi-grid">
            <div class="snapshot-kpi-item relative"><div class="label">Total Gross</div><div class="value">$${Math.round(kpis.totalGross.value).toLocaleString()}</div><div class="trend">${kpis.totalGross.trend}</div></div>
            <div class="snapshot-kpi-item relative"><div class="label">RPM (All)</div><div class="value">$${kpis.totalRpm.value.toFixed(2)}</div><div class="trend">${kpis.totalRpm.trend}</div></div>
            <div class="snapshot-kpi-item relative"><div class="label">Total Margin</div><div class="value">$${Math.round(kpis.totalMargin.value).toLocaleString()}</div><div class="trend">${kpis.totalMargin.trend}</div></div>
            <div class="snapshot-kpi-item relative"><div class="label">Active Trucks</div><div class="value">${kpis.activeTrucks.value}</div><div class="trend">${kpis.activeTrucks.trend}</div></div>
            <div class="snapshot-kpi-item relative"><div class="label">Dispatchers</div><div class="value">${kpis.dispatchers.value}</div><div class="trend">${kpis.dispatchers.trend}</div></div>
            <div class="snapshot-kpi-item relative"><div class="label">Avg Wellness</div><div class="value">${kpis.avgWellness.value.toFixed(0)}%</div><div class="trend">${kpis.avgWellness.trend}</div></div>
        </div>

        <div class="snapshot-section flex-grow min-h-0">
             <h3 class="snapshot-section-title">Weekly Rankings (1w)</h3>
             <div class="snapshot-chart-container" id="snapshot-chart-container"></div>
        </div>

        <div class="snapshot-section">
            <h3 class="snapshot-section-title">Dispatcher Snapshot</h3>
            <div class="snapshot-rankings-grid">
                <div>
                    <h5>Top 3 (Rank)</h5>
                    ${bestDispatchersRank.map(d => `<div class="snapshot-list-item"><span class="name">${d.name}</span><span class="value good">#${d.rank1w || '-'}</span></div>`).join('')}
                </div>
                <div>
                    <h5>Bottom 3 (Rank)</h5>
                    ${worstDispatchersRank.map(d => `<div class="snapshot-list-item"><span class="name">${d.name}</span><span class="value bad">#${d.rank1w || '-'}</span></div>`).join('')}
                </div>
                 <div>
                    <h5>Bottom 3 (Compliance)</h5>
                    ${worstDispatchersCompliance.map(d => `<div class="snapshot-list-item"><span class="name">${d.name}</span><span class="value bad">${d.complianceScore.toFixed(0)}%</span></div>`).join('')}
                </div>
            </div>
        </div>
        
        <div class="snapshot-section">
            <h3 class="snapshot-section-title">Flag Summary</h3>
            <div class="snapshot-kpi-grid" style="grid-template-columns: repeat(4, 1fr);">
                ${flagKpis.map(fk => `<div class="snapshot-kpi-item !py-1 !h-auto"><div class="label">${fk.label}</div><div class="value !text-base">${fk.value}</div></div>`).join('')}
            </div>
        </div>

        <div class="snapshot-section">
        <h3 class="snapshot-section-title">Driver Insight</h3>
        <table id="snapshot-driver-table">
            <thead>
                <tr><th>NAME</th><th>Company</th><th>Contract</th><th>Dispatcher</th><th class="text-right">Risk %</th></tr>
            </thead>
            <tbody>
            ${highRiskDrivers.map(d => `
                <tr>
                    <td class="font-semibold">${d.name}</td>
                    <td>${d.company}</td>
                    <td>${d.contract}</td>
                    <td>${d.dispatcher}</td>
                    <td class="text-right risk-value">${Math.round(d.risk)}%</td>
                </tr>
            `).join('')}
            </tbody>
        </table>
    </div>
    `;

    // --- FIX: Implement ResizeObserver for responsive chart rendering ---
    const chartContainer = document.getElementById('snapshot-chart-container');
    if (chartContainer) {
        // If an observer is already on this element from a previous render, disconnect it first.
        if (chartContainer._resizeObserver) {
            chartContainer._resizeObserver.disconnect();
        }

        // Create a debounced version of the render function to prevent rapid-fire redraws.
        const debouncedRender = debounce(renderSnapshotChart, 50);

        // Create an observer that calls the debounced render function whenever the container size changes.
        const observer = new ResizeObserver(() => {
            debouncedRender('snapshot-chart-container');
        });

        // Start observing the container.
        observer.observe(chartContainer);

        // Store the observer on the element itself so we can manage it later.
        chartContainer._resizeObserver = observer;
    }
}


/**
 * Renders a US heatmap and a statistical list of a driver's loads for the last 4 valid pay periods.
 * @param {d3.Selection} container - The D3 selection of the container element.
 */
function renderDriverHeatmap(container) {
    container.html("");

    const driverName = appState.profiles.driverDeepDive.selectedDriver;
    
    const historicalStubs = getHistoricalStubsForDriver(driverName, appState.loads.historicalStubsData);
    const validStubs = historicalStubs.filter(s => s.total_miles && s.total_miles > 0);
    if (validStubs.length === 0) {
        container.append('div').attr('class', 'flex items-center justify-center h-full text-gray-500 text-sm').text('No historical stubs with miles found.');
        return;
    }

    const stubsForDateRange = validStubs.slice(0, 4);
    const oldestValidStub = stubsForDateRange[stubsForDateRange.length - 1];
    const { start: fourWeeksAgo } = getPayPeriodFromPayDate(oldestValidStub.pay_date);

    const relevantLoads = appState.profiles.liveData.filter(load => {
        const totalMiles = (load.trip_miles || 0) + (load.deadhead_miles || 0);
        return load.driver === driverName && new Date(load.do_date) >= fourWeeksAgo && load.status !== 'Canceled' && totalMiles > 0;
    });

    if (relevantLoads.length === 0) {
        container.append('div').attr('class', 'flex items-center justify-center h-full text-gray-500 text-sm').text('No valid loads found for the last 4 pay periods.');
        return;
    }

    const loadsByState = relevantLoads.reduce((acc, load) => {
        const stateMatch = (load.pu_location || '').match(/,\s*([A-Z]{2})$/);
        if (stateMatch) {
            const state = stateMatch[1];
            if (!acc[state]) acc[state] = { count: 0, totalRate: 0, totalTripMiles: 0 };
            acc[state].count++;
            acc[state].totalRate += (load.price || 0);
            acc[state].totalTripMiles += (load.trip_miles || 0);
        }
        return acc;
    }, {});

    const stateListData = Object.entries(loadsByState).map(([state, data]) => ({
        state,
        count: data.count,
        avgRate: data.count > 0 ? data.totalRate / data.count : 0,
        avgRpm: data.totalTripMiles > 0 ? data.totalRate / data.totalTripMiles : 0,
    })).sort((a, b) => b.count - a.count);

    container.html(`
        <div class="driver-heatmap-layout">
            <div id="driver-heatmap-list" class="driver-heatmap-list-container"></div>
            <div id="driver-heatmap-map" class="driver-heatmap-map-container"></div>
        </div>
    `);

    const listContainer = container.select('#driver-heatmap-list');
    if (stateListData.length > 0) {
        listContainer.html(`
            <div class="heatmap-list-header">
                <span>State</span><span>Loads</span><span>Avg Rate</span><span>Avg RPM</span>
            </div>
            <ul class="heatmap-list-body">
                ${stateListData.map(d => `<li><span class="state-name">${d.state}</span><span class="state-count">${d.count}</span><span class="state-rate">$${d.avgRate.toLocaleString(undefined,{maximumFractionDigits:0})}</span><span class="state-rpm">$${d.avgRpm.toFixed(2)}</span></li>`).join('')}
            </ul>
        `);
    } else {
        listContainer.html('<div class="flex items-center justify-center h-full text-gray-500 text-sm">No state data.</div>');
    }

    const mapContainer = container.select('#driver-heatmap-map');
    const { width, height } = mapContainer.node().getBoundingClientRect();
    const stateFullNameToAbbr = { "Alabama": "AL", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY" };

    const maxLoads = Math.max(...Object.values(loadsByState).map(d => d.count), 1);
    const colorScale = d3.scaleSequential(d3.interpolateRgb("#fee2e2", "#ef4444")) // Lighter red to a softer red
        .domain([0, maxLoads]);

    const tooltip = d3.select("body").append("div").attr("class", "driver-heatmap-tooltip").style("opacity", 0);

    const svg = mapContainer.append("svg").attr("width", "100%").attr("height", "100%").attr("viewBox", `0 0 ${width} ${height}`);

    d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json").then(us => {
        const unwantedFips = ["02", "15", "60", "66", "69", "72", "78"];
        const statesGeoJson = topojson.feature(us, us.objects.states);
        statesGeoJson.features = statesGeoJson.features.filter(d => !unwantedFips.includes(d.id));

        const projection = d3.geoAlbersUsa().fitSize([width, height], statesGeoJson);
        const path = d3.geoPath().projection(projection);

        svg.append("g")
            .selectAll("path")
            .data(statesGeoJson.features)
            .join("path")
            .attr("fill", d => {
                const stateAbbr = stateFullNameToAbbr[d.properties.name];
                return loadsByState[stateAbbr] ? colorScale(loadsByState[stateAbbr].count) : "#4a5568";
            })
            .attr("d", path)
            .attr("class", "driver-heatmap-state")
            .on("mouseover", function(event, d) {
                tooltip.transition().duration(100).style("opacity", .9);
                const stateAbbr = stateFullNameToAbbr[d.properties.name];
                const loadCount = loadsByState[stateAbbr]?.count || 0;
                tooltip.html(`<strong>${d.properties.name}</strong><br/>Loads: ${loadCount}`);
            })
            .on("mousemove", function(event) {
                tooltip.style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", function(d) {
                tooltip.transition().duration(200).style("opacity", 0);
            });
    });
}

/**
 * Opens a modal displaying the 1W Retention History.
 */
function openRetentionHistoryModal() {
    let modal = document.getElementById('retention-history-modal');
    
    // Create modal if it doesn't exist
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'retention-history-modal';
        modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4 hidden';
        modal.innerHTML = `
            <div class="bg-gray-800 border-2 border-gray-700 rounded-2xl shadow-2xl w-full max-w-4xl h-[500px] flex flex-col animate-fade-in-up">
                <div class="flex items-center justify-between p-4 border-b border-gray-700">
                    <div>
                        <h2 class="text-lg font-bold text-gray-200">1W Retention History (Last 12 Weeks)</h2>
                        <p class="text-xs text-gray-400 mt-1">Tracks the % of drivers from last week who remained active in the current view. 'Transferred' refers to active drivers who moved to a team or dispatcher outside your current filters.</p>
                        <p class="text-xs text-gray-500 mt-2">Filtered by: ${appState.profiles.selectedTeam === 'ALL_TEAMS' ? 'All Teams' : appState.profiles.selectedTeam} | ${appState.profiles.contractTypeFilter.toUpperCase()}</p>
                    </div>
                    <button id="close-retention-modal-btn" class="text-gray-400 hover:text-white text-2xl transition-colors">&times;</button>
                </div>
                <div class="p-4 flex-grow relative" id="retention-chart-container">
                    <div class="absolute inset-0 flex items-center justify-center text-gray-500">
                        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-400 mr-3"></div> Calculating History...
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Close logic
        const closeBtn = modal.querySelector('#close-retention-modal-btn');
        const closeModal = () => modal.classList.add('hidden');
        closeBtn.onclick = closeModal;
        modal.addEventListener('click', (e) => { if(e.target === modal) closeModal(); });
    }
    
    modal.classList.remove('hidden');
    
    // Calculate and Render (with small delay to allow modal to show loading state)
    requestAnimationFrame(() => {
        setTimeout(() => {
            const data = calculateRetentionHistoryData();
            renderRetentionHistoryChart(data);
        }, 50);
    });
}

/**
 * Calculates retention data for the last 12 weeks based on current filters.
 */
function calculateRetentionHistoryData() {
    const weeksToCheck = 12;
    const { contractTypeFilter, selectedTeam, selectedCompany, selectedFranchise } = appState.profiles;
    const user = appState.auth.user;
    const isDispatcherRole = user && user.role === 'Dispatcher';
    let dispatcherNameFromAccess = isDispatcherRole ? (user.access || [])[0] : null;

    const historicalStubs = appState.loads.historicalStubsData || [];
    const enrichedStubs = getEnrichedStubs(historicalStubs);

    // Helper to run the 12-week calculation for a specific scope
    const calculateTrendForScope = (scopeName, teamFilter) => {
        const historyData = [];
        
        // Validator for Historical Stubs
        const isStubValid = (s) => {
            if (dispatcherNameFromAccess && (s.stub_dispatcher || '').toLowerCase() !== dispatcherNameFromAccess.toLowerCase()) return false;
            
            // Team Filter
            const stubTeam = s.stub_team || s.current_team;
            if (teamFilter !== 'ALL_TEAMS') {
                const teamLower = teamFilter.toLowerCase();
                const specialPrefixes = ['agnius', 'uros', 'miles'];
                if (specialPrefixes.includes(teamLower)) {
                    if (!stubTeam || !stubTeam.toLowerCase().startsWith(teamLower)) return false;
                } else if (stubTeam !== teamFilter) return false;
            }

            // Other Filters
            if (selectedCompany !== 'All Companies' && s.company_name !== selectedCompany) return false;
            if (selectedFranchise !== 'All Franchises' && s.franchise_name !== selectedFranchise) return false;
            if (contractTypeFilter !== 'all') {
                const raw = String(s.contract_type || '').toUpperCase();
                const norm = raw === 'OO' ? 'OO' : 'LOO';
                if (contractTypeFilter === 'loo' && norm === 'OO') return false;
                if (contractTypeFilter !== 'loo' && norm !== contractTypeFilter.toUpperCase()) return false;
            }
            return true;
        };

        // Validator for Live Drivers
        const isLiveDriverValid = (liveRecord) => {
            if (dispatcherNameFromAccess && (liveRecord.dispatcher_name || '').toLowerCase() !== dispatcherNameFromAccess.toLowerCase()) return false;
            
            const recTeam = liveRecord.dispatcher_team;
            if (teamFilter !== 'ALL_TEAMS') {
                const teamLower = teamFilter.toLowerCase();
                const specialPrefixes = ['agnius', 'uros', 'miles', 'wayne', 'mubeen', 'vito'];
                if (specialPrefixes.includes(teamLower)) {
                    if (!recTeam || !recTeam.toLowerCase().startsWith(teamLower)) return false;
                } else if (recTeam !== teamFilter) return false;
            }

            if (selectedCompany !== 'All Companies' && liveRecord.company_name !== selectedCompany) return false;
            if (selectedFranchise !== 'All Franchises') {
                const driverLoad = appState.profiles.liveData.find(l => l.driver === liveRecord.driver_name);
                if (driverLoad && driverLoad.franchise_name !== selectedFranchise) return false;
            }
            return true;
        };

        const scopedStubs = enrichedStubs.filter(isStubValid);

        for (let i = weeksToCheck; i >= 0; i--) {
            const { end } = getPayrollWeekDateRange(i);
            let result;

            if (i === 0) { // Live Week
                result = calculateLiveRetention(
                    scopedStubs, 
                    appState.profiles.contractStatusData || [],
                    appState.profiles.liveDriverCountData || [],
                    isLiveDriverValid
                );
            } else { // Historical
                const targetPayDate = new Date(end);
                targetPayDate.setUTCDate(end.getUTCDate() + 3); 
                targetPayDate.setUTCHours(0,0,0,0);
                const targetDateString = targetPayDate.toISOString().split('T')[0];
                
                const stubsInWeek = scopedStubs.filter(s => {
                        if (!s.pay_date) return false;
                        return new Date(s.pay_date).toISOString().split('T')[0] === targetDateString;
                });
                result = calculateHistoricalRetention(stubsInWeek);
            }
            
          historyData.push({
                weekDate: end,
                retention: result.percentage,
                active: result.active,
                total: result.total
            });
        }
        return { name: scopeName, data: historyData.sort((a,b) => a.weekDate - b.weekDate) };
    };

    const datasets = [];

    // 1. Add Main Selection (Aggregate)
    datasets.push(calculateTrendForScope(selectedTeam === 'ALL_TEAMS' ? "All Teams" : selectedTeam, selectedTeam));

    // 2. If ALL TEAMS is selected, also calculate for every individual team found in history
    if (selectedTeam === 'ALL_TEAMS' && !isDispatcherRole) {
        const uniqueTeams = [...new Set(enrichedStubs.map(s => s.stub_team).filter(Boolean))].sort();
        uniqueTeams.forEach(teamName => {
            datasets.push(calculateTrendForScope(teamName, teamName));
        });
    }

    return datasets;
}

function openComplianceHistoryModal() {
    let modal = document.getElementById('compliance-history-modal');
    
    // Initialize cache if it doesn't exist
    if (!appState.profiles.complianceHistoryCache) {
        appState.profiles.complianceHistoryCache = { key: null, data: null };
    }

    // Initialize chart view state if it doesn't exist
    if (!appState.profiles.complianceHistoryView) {
        appState.profiles.complianceHistoryView = 'compliance'; // Default view
    }

    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'compliance-history-modal';
        modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4 hidden';
        modal.innerHTML = `
            <div class="bg-gray-800 border-2 border-gray-700 rounded-2xl shadow-2xl w-full max-w-5xl h-[600px] flex flex-col animate-fade-in-up">
                <div class="flex items-center justify-between p-4 border-b border-gray-700">
                    <div>
                        <h2 class="text-lg font-bold text-gray-200">Historical Metrics by Team (Last 12 Weeks)</h2>
                        <p class="text-xs text-gray-400 mt-1">Compare performance across teams or against the company average.</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <select id="compliance-chart-select" class="bg-gray-700 text-gray-200 text-xs font-semibold rounded-md border-gray-600 focus:ring-2 focus:ring-teal-500 py-1.5 px-3 outline-none cursor-pointer hover:bg-gray-600 transition-colors">
                            <option value="compliance">Median Compliance %</option>
                            <option value="overdue">Median Overdue (Sum)</option>
                            <option value="badMoves">Bad Moves (Count)</option>
                            <option value="wellness">Wellness %</option>
                            <option value="canceled">Canceled (Count)</option>
                            <option value="tuesdayOpen">Tuesday Open (Count)</option>
                            <option value="calculatorActivity">Median Calc. Activity (Visits)</option>
                            <option value="rcEntry">Median RC Entry (Min)</option>
                            <option value="missingPaperwork">Missing PPW (Count)</option>
                        </select>
                        <button id="close-compliance-modal-btn" class="text-gray-400 hover:text-white text-2xl transition-colors ml-4">&times;</button>
                    </div>
                </div>
                <div class="p-4 flex-grow relative" id="compliance-chart-container">
                    <div class="absolute inset-0 flex items-center justify-center text-gray-500">
                        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-400 mr-3"></div> Calculating History...
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        const closeBtn = modal.querySelector('#close-compliance-modal-btn');
        closeBtn.onclick = () => modal.classList.add('hidden');
        modal.addEventListener('click', (e) => { if(e.target === modal) modal.classList.add('hidden'); });

        const select = modal.querySelector('#compliance-chart-select');
        select.addEventListener('change', (e) => {
            const metric = e.target.value;
            appState.profiles.complianceHistoryView = metric;
            if (window._complianceHistoryData) renderComplianceHistoryChart(window._complianceHistoryData, metric);
        });
    } else {
        // Update select value based on current state
        const select = modal.querySelector('#compliance-chart-select');
        if (select) {
            select.value = appState.profiles.complianceHistoryView;
        }
    }
    
    modal.classList.remove('hidden');
    
    const { contractTypeFilter, selectedCompany, selectedFranchise } = appState.profiles;
    // FIX: Removed selectedTeam from key to ensure history is calculated broadly and reused
    const currentKey = `ALL_TEAMS|${contractTypeFilter}|${selectedCompany}|${selectedFranchise}|${appState.lastRefreshed}`;
    
    const chartContainer = document.getElementById('compliance-chart-container');

    if (appState.profiles.complianceHistoryCache.key === currentKey) {
        const data = appState.profiles.complianceHistoryCache.data;
        window._complianceHistoryData = data;
        // Use the saved view state
        renderComplianceHistoryChart(data, appState.profiles.complianceHistoryView);
    } else {
        if (chartContainer) {
            chartContainer.innerHTML = `<div class="absolute inset-0 flex items-center justify-center text-gray-500"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-400 mr-3"></div> Calculating History...</div>`;
        }
        requestAnimationFrame(() => {
            setTimeout(() => {
                const data = calculateComplianceHistoryData();
                appState.profiles.complianceHistoryCache = { key: currentKey, data: data };
                window._complianceHistoryData = data;
                // Use the saved view state
                renderComplianceHistoryChart(data, appState.profiles.complianceHistoryView);
            }, 50);
        });
    }
}

function calculateComplianceHistoryData() {
    const weeksToCheck = 12;
    const { contractTypeFilter, selectedCompany, selectedFranchise, selectedTeam } = appState.profiles;
    const allLoadData = appState.profiles.liveData || [];
    const overdueSource = appState.profiles.overdueLoadsData || [];
    const goodMoveThresholds = appState.profiles.thresholdSettings.goodMove;
    const lowRpmThresholds = appState.profiles.thresholdSettings.lowRpm;
    const historicalStubs = appState.loads.historicalStubsData || [];

    // 1. Prepare Data Helpers (Tenure & Enriched Stubs)
    let tenureMap = appState.profiles.dispatcherSpecificTenureMap;
    // Ensure map exists (logic copied from renderTeamProfileUI)
    if (!tenureMap) {
        tenureMap = historicalStubs.reduce((acc, stub) => {
            if (stub.driver_name && stub.stub_dispatcher && parseFloat(stub.total_miles) > 0 && stub.pay_date) {
                const dName = stub.driver_name;
                const dispName = stub.stub_dispatcher;
                if (!acc[dName]) acc[dName] = {};
                if (!acc[dName][dispName]) acc[dName][dispName] = [];
                acc[dName][dispName].push(new Date(stub.pay_date));
            }
            return acc;
        }, {});
        Object.values(tenureMap).forEach(dMap => Object.values(dMap).forEach(dates => dates.sort((a, b) => a - b)));
        appState.profiles.dispatcherSpecificTenureMap = tenureMap;
    }

    const enrichedHistoricalStubs = getEnrichedStubs(historicalStubs);

    const specialPrefixes = ['agnius', 'uros', 'miles', 'wayne', 'mubeen', 'vito']; 
    const excludedNames = ['cletus spuckler', 'ralph wiggum', 'seymour skinner', 'med disp disp'];

    const getGroupedTeamName = (rawTeam) => {
        if (!rawTeam) return null;
        const lower = rawTeam.toLowerCase();
        if (excludedNames.includes(lower)) return null;
        const prefix = specialPrefixes.find(p => lower.startsWith(p));
        if (prefix) {
            return prefix.charAt(0).toUpperCase() + prefix.slice(1);
        }
        return rawTeam;
    };

    // Prepare Roster Map for Fallbacks
    const rosterTeamMap = {};
    if (appState.profiles.liveDriverCountData) {
        appState.profiles.liveDriverCountData.forEach(d => {
            if (d.dispatcher_name) {
                rosterTeamMap[d.dispatcher_name.toLowerCase()] = d.dispatcher_team;
            }
        });
    }

    const teamSet = new Set();
    if (appState.profiles.liveDriverCountData) {
        appState.profiles.liveDriverCountData.forEach(d => {
             const t = getGroupedTeamName(d.dispatcher_team);
             if (t) teamSet.add(t);
        });
    }
    allLoadData.forEach(l => {
         const t = getGroupedTeamName(l.team);
         if (t) teamSet.add(t);
    });
 
    const allUniqueTeams = [...teamSet].sort();
    const datasets = {}; 
    datasets["All Teams"] = [];
    allUniqueTeams.forEach(t => datasets[t] = []);

    const user = appState.auth.user;
    const isDispatcherRole = user && user.role === 'Dispatcher';
    let dispatcherNameFromAccess = null;
    if (isDispatcherRole) {
         if (Array.isArray(user.access) && user.access.length > 0) {
            dispatcherNameFromAccess = String(user.access[0]).trim();
        } else if (typeof user.access === 'string' && user.access.trim()) {
            dispatcherNameFromAccess = user.access.split(',')[0].trim();
        }
    }
    if (dispatcherNameFromAccess) {
        datasets[dispatcherNameFromAccess] = [];
    }

    // console.log(`[Compliance History] Starting calculation...`);

    for (let i = 0; i <= weeksToCheck; i++) { 
        const { start, end } = getPayrollWeekDateRange(i);
        const payDate = new Date(end);
        payDate.setUTCDate(end.getUTCDate() + 3);
        const targetPayDateForTenure = new Date(payDate);
        if (i === 0) {
             targetPayDateForTenure.setFullYear(targetPayDateForTenure.getFullYear() + 10);
        }
        
        const fourWeeksAgoStart = new Date(payDate);
        fourWeeksAgoStart.setDate(fourWeeksAgoStart.getDate() - 21);
        fourWeeksAgoStart.setUTCHours(0, 0, 0, 0);
        const retentionEnd = new Date(payDate);
        retentionEnd.setUTCHours(23, 59, 59, 999);

        const dateLabel = `${start.toLocaleDateString('en-US', {month:'short', day:'numeric'})} - ${end.toLocaleDateString('en-US', {month:'short', day:'numeric'})}`;

        // 3. Get Loads & Stubs - GLOBAL POOL for this week
        const weekLoads = allLoadData.filter(d => d.do_date && new Date(d.do_date) >= start && new Date(d.do_date) <= end);

        const weekOverdue = overdueSource.filter(ol => {
            if (!ol.deliveryDate) return false;
            const dDate = new Date(ol.deliveryDate);
            return dDate >= start && dDate <= end;
        });

        // 4. FIND ACTIVE DISPATCHERS
        // For Live Week (i=0), we combine Loads + Stubs + Live Roster (to catch idle dispatchers)
        // For Historical Weeks (i>0), we rely PRIMARILY on Stubs to identify who was active.
        let activeDispatchers = new Set();

        if (i === 0) {
            weekLoads.forEach(l => { if(l.dispatcher) activeDispatchers.add(l.dispatcher); });
            if (appState.profiles.liveDriverCountData) {
                appState.profiles.liveDriverCountData.forEach(d => { if(d.dispatcher_name) activeDispatchers.add(d.dispatcher_name); });
            }
        } else {
            // For history, strict date matching on stubs
            historicalStubs.forEach(s => {
                if (s.pay_date && s.stub_dispatcher) {
                    const sDate = new Date(s.pay_date).toISOString().split('T')[0];
                    const pDate = payDate.toISOString().split('T')[0];
                    if (sDate === pDate) {
                        activeDispatchers.add(s.stub_dispatcher);
                    }
                }
            });
        }
        
        const activeDispatchersList = [...activeDispatchers];

        // --- PREPARE DATA FOR TENURE CALCULATION (Same logic as renderTeamProfileUI) ---
        // Combine Live (if i=0) and Stubs (if i>0) to find ALL drivers associated with dispatchers this week
        let weekDrivers = [];
        if (i === 0) {
             weekDrivers = weekLoads.map(l => ({ 
                 name: l.driver, 
                 dispatcher: l.dispatcher, 
                 contract: (l.contract_type || 'LOO').toUpperCase() === 'OO' ? 'OO' : 'LOO' 
             }));
             // Also add from roster if no load
             if (appState.profiles.liveDriverCountData) {
                 appState.profiles.liveDriverCountData.forEach(d => {
                     if (!weekDrivers.find(wd => wd.name === d.driver_name)) {
                         weekDrivers.push({
                             name: d.driver_name,
                             dispatcher: d.dispatcher_name,
                             contract: (d.contract_type || 'LOO').toUpperCase() === 'OO' ? 'OO' : 'LOO'
                         });
                     }
                 });
             }
        } else {
             const targetPayDateStr = payDate.toISOString().split('T')[0];
             const weekStubs = historicalStubs.filter(s => s.pay_date && new Date(s.pay_date).toISOString().split('T')[0] === targetPayDateStr);
             
             const uniqueDriverNames = [...new Set(weekStubs.map(s => s.driver_name))];
             weekDrivers = uniqueDriverNames.map(name => {
                 const s = weekStubs.find(stub => stub.driver_name === name);
                 return {
                     name: s.driver_name,
                     dispatcher: s.stub_dispatcher, 
                     contract: (s.contract_type || 'LOO').toUpperCase() === 'OO' ? 'OO' : 'LOO'
                 };
             });
        }
        
        // Setup Active Driver Set for "Live + 1" Tenure Logic
        let activeDriverSet = new Set();
        if (i === 0) {
            weekLoads.forEach(l => { if (l.driver) activeDriverSet.add(l.driver); });
        }

        const dispatcherMetricsList = activeDispatchersList.map(dispName => {
            const dispLoads = weekLoads.filter(l => l.dispatcher === dispName);
            
            // Metrics Calculation
            const passed = dispLoads.filter(l => l.wellness_fail === 'GOOD').length;
            const good = dispLoads.filter(l => l.wellness_fail === '-').length;
            const failed = dispLoads.filter(l => l.wellness_fail === 'FAIL').length;
            const totalWellness = passed + good + failed;
            const wellnessScore = totalWellness > 0 ? ((passed + good) / totalWellness) * 100 : 0;

            const movedLoads = dispLoads.filter(d => d.moved_monday === 'Moved Monday Load');
            const badMovesCount = movedLoads.filter(load => {
                const rawContract = load.contract_type || 'LOO';
                const contractKey = Object.keys(goodMoveThresholds.by_contract).find(k => k.toUpperCase() === (rawContract).toUpperCase()) || 'LOO';
                const threshold = goodMoveThresholds.by_contract[contractKey] ?? goodMoveThresholds.default;
                return (load.driver_gross_without_moved || 0) >= threshold;
            }).length;
            const goodMovesCount = movedLoads.length - badMovesCount;

            const hiddenMiles = dispLoads.filter(d => d.hidden_miles === 'Hidden Miles Found!').length;
            const lowRpmCount = dispLoads.filter(load => {
                const rawContract = load.contract_type || 'LOO';
                const contractKey = Object.keys(lowRpmThresholds.by_contract).find(k => k.toUpperCase() === (rawContract).toUpperCase()) || 'LOO';
                const threshold = lowRpmThresholds.by_contract[contractKey] ?? lowRpmThresholds.default;
                return (load.rpm_all || 0) < threshold;
            }).length;

            const canceledCount = dispLoads.filter(l => l.status === 'Canceled').length;

            const dispOverdueLoads = weekOverdue.filter(ol => ol.dispatcher === dispName);
            const overdueSum = dispOverdueLoads.reduce((sum, ol) => sum + (ol.daysPastDO || 0), 0);

            const tuesdayOpen = (appState.profiles.tuesdayOpenData || []).filter(d => {
                if (d.dispatch !== dispName) return false;
                const dDate = new Date(d.date);
                const shiftBack = dDate.getUTCDay() === 2 ? 1 : 0;
                dDate.setUTCDate(dDate.getUTCDate() - shiftBack);
                return dDate >= start && dDate <= end;
            }).length;

            const missingPaperwork = (appState.profiles.missingPaperworkData || []).filter(d => {
                if (d.dispatch !== dispName) return false;
                const dDate = new Date(d.do_date);
                return dDate >= start && dDate <= end;
            }).length;

            let daysVisited = 0;
            let totalMinutes = 0;
            const activityData = appState.profiles.calculatorActivityData || [];
            for (let k = 0; k < 7; k++) {
                const day = new Date(start);
                day.setUTCDate(day.getUTCDate() + k);
                const dayString = day.toISOString().split('T')[0];
                const record = activityData.find(r => {
                    if (r.dispatcher !== dispName) return false;
                    return new Date(r.date).toISOString().split('T')[0] === dayString;
                });
                if (record && (parseFloat(record.minutes) || 0) > 0) {
                    daysVisited++;
                    totalMinutes += (parseFloat(record.minutes) || 0);
                }
            }
            const calculatorActivity = (daysVisited / 7) * 100;
            const calculatorActivityMinutes = totalMinutes;
            
            const trailerDrops = (appState.profiles.trailerDropsData || []).filter(d => {
                if (d.droppedByDispatcher !== dispName) return false;
                if (!d.dropTime) return false;
                const dt = new Date(d.dropTime);
                return dt >= start && dt <= end;
            }).length;

            const trailerRecoveries = (appState.profiles.trailerDropsData || []).filter(d => {
                if (d.recoveredByDispatcher !== dispName) return false;
                if (!d.recoveryTime) return false;
                const rt = new Date(d.recoveryTime);
                return rt >= start && rt <= end;
            }).length;

            const rcEntries = (appState.profiles.rcEntryData || [])
                .filter(d => d.dispatcher === dispName && d.date && new Date(d.date) >= start && new Date(d.date) <= end)
                .map(d => parseFloat(d.entry_minutes)).filter(m => !isNaN(m));
            const rcEntry = rcEntries.length > 0 ? calculateMedian(rcEntries) : null;

            // Retention (Still uses Enriched for accuracy, matches Main View)
            const poolStubs = enrichedHistoricalStubs.filter(s => {
                const pDate = new Date(s.pay_date);
                return pDate >= fourWeeksAgoStart && pDate <= retentionEnd && s.stub_dispatcher === dispName &&
                       (s.retention_status === 'Active' || s.retention_status === 'Terminated' || s.retention_status === 'Start');
            });
            const historicalPool = new Set(poolStubs.map(s => s.driver_name));
            let retainedCount = 0;
            historicalPool.forEach(driverName => {
                const driverStubsInWindow = enrichedHistoricalStubs.filter(s => 
                    s.driver_name === driverName && new Date(s.pay_date) >= fourWeeksAgoStart && new Date(s.pay_date) <= retentionEnd
                ).sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date));
                if (driverStubsInWindow.length > 0) {
                    const lastStub = driverStubsInWindow[0];
                    if ((lastStub.retention_status || '').trim() !== 'Terminated' && lastStub.stub_dispatcher === dispName) {
                        retainedCount++;
                    }
                }
            });
            const retention4w = historicalPool.size > 0 ? (retainedCount / historicalPool.size) * 100 : null;

            // --- TENURE CALCULATION (MATCHING TABLE LOGIC) ---
            const dispatcherDriversInView = weekDrivers.filter(wd => wd.dispatcher === dispName);
            
            const getTenureList = (contractType) => {
                const drivers = (contractType === 'OO') 
                    ? dispatcherDriversInView.filter(d => d.contract === 'OO') 
                    : dispatcherDriversInView.filter(d => d.contract !== 'OO');
                
                return drivers.map(driver => {
                    const dName = driver.name;
                    const driverTenuresMap = tenureMap[dName];
                    const allStubDates = (driverTenuresMap && driverTenuresMap[dispName]) ? driverTenuresMap[dispName] : [];
                    
                    const pointInTimeStubs = allStubDates.filter(stubDate => stubDate <= targetPayDateForTenure);
                    let tenureWeeks = pointInTimeStubs.length;

                    // Add +1 for Live Week Active Drivers
                    if (i === 0 && activeDriverSet.has(dName)) {
                        const lastStubDate = allStubDates.length > 0 ? allStubDates[allStubDates.length - 1] : null;
                        if (!lastStubDate || lastStubDate < targetPayDateForTenure) {
                            tenureWeeks += 1;
                        }
                    }
                    return tenureWeeks;
                }).filter(t => t > 0);
            };

            const medianTenureOO = getTenureList('OO').length > 0 ? calculateMedian(getTenureList('OO')) : null;
            const medianTenureLOO = getTenureList('LOO').length > 0 ? calculateMedian(getTenureList('LOO')) : null;

            let resolvedTeam = rosterTeamMap[dispName.toLowerCase()] || '-';
            const normalizedTeam = getGroupedTeamName(resolvedTeam) || 'Unknown';

            // Add Company/Truck Info from Live Roster (Consistent with Table)
            const liveDriversForDispatcher = appState.profiles.liveDriverCountData.filter(d => d.dispatcher_name && d.dispatcher_name.trim().toLowerCase() === dispName.trim().toLowerCase());
            const firstLiveDriverRecord = liveDriversForDispatcher[0];
            const ooTrucks = liveDriversForDispatcher.filter(d => d.contract_type === 'OO').length;
            const looTrucks = liveDriversForDispatcher.length - ooTrucks;
            const company = firstLiveDriverRecord?.company_name || '-';

            return {
                name: dispName,
                loads: dispLoads, 
                team: normalizedTeam, 
                company: company,
                ooTrucks: ooTrucks,
                looTrucks: looTrucks,
                wellness: wellnessScore,
                wellnessDetails: { passed, good, failed },
                goodMoves: goodMovesCount,
                badMoves: badMovesCount,
                hiddenMiles: hiddenMiles,
                lowRpm: lowRpmCount,
                canceled: canceledCount,
                overdueLoads: overdueSum,
                retention4w: retention4w,
                medianTenureOO: medianTenureOO,
                medianTenureLOO: medianTenureLOO,
                tuesdayOpen: tuesdayOpen,
                missingPaperwork: missingPaperwork,
                calculatorActivity: calculatorActivity,
                calculatorActivityMinutes: calculatorActivityMinutes,
                trailerDrops: trailerDrops,
                trailerRecoveries: trailerRecoveries,
                rcEntry: rcEntry
            };
        });
        
        // Score based on GLOBAL pool for this week
        const scoredDispatchers = calculateComplianceScores(dispatcherMetricsList, dispatcherMetricsList);

        // 5. Apply UI Filters (Post-Scoring) to determine aggregation group
        let filteredScoredDispatchers = scoredDispatchers;

        if (contractTypeFilter !== 'all') {
            filteredScoredDispatchers = filteredScoredDispatchers.filter(d => contractTypeFilter === 'oo' ? d.ooTrucks > 0 : d.looTrucks > 0);
        }
        if (selectedCompany !== 'All Companies') {
            filteredScoredDispatchers = filteredScoredDispatchers.filter(d => d.company === selectedCompany);
        }
        if (selectedFranchise !== 'All Franchises') {
            filteredScoredDispatchers = filteredScoredDispatchers.filter(d => d.loads.some(l => l.franchise_name === selectedFranchise));
        }

        // 6. Aggregate
        const aggregateForGroup = (groupDispatchers) => {
            if (groupDispatchers.length === 0) return { weekDate: payDate, dateLabel, badMoves: null, wellness: null, compliance: null, overdue: null, canceled: null, tuesdayOpen: null, calculatorActivity: null, missingPaperwork: null };
            const totalBadMoves = groupDispatchers.reduce((sum, d) => sum + d.badMoves, 0);
            const totalCanceled = groupDispatchers.reduce((sum, d) => sum + d.canceled, 0);
            const totalPassed = groupDispatchers.reduce((sum, d) => sum + d.wellnessDetails.passed, 0);
            const totalGood = groupDispatchers.reduce((sum, d) => sum + d.wellnessDetails.good, 0);
            const totalFailed = groupDispatchers.reduce((sum, d) => sum + d.wellnessDetails.failed, 0);
            const totalWellnessLoads = totalPassed + totalGood + totalFailed;
            const avgWellnessScore = totalWellnessLoads > 0 ? ((totalPassed + totalGood) / totalWellnessLoads) * 100 : 0;
            const overdueSums = groupDispatchers.map(d => d.overdueLoads);
            const medianOverdue = overdueSums.length > 0 ? calculateMedian(overdueSums) : 0;

            const complianceScores = groupDispatchers.map(d => d.complianceScore).filter(c => isFinite(c) && c !== null);
            const medianCompliance = complianceScores.length > 0 ? calculateMedian(complianceScores) : 0;

            const totalTuesdayOpen = groupDispatchers.reduce((sum, d) => sum + (d.tuesdayOpen || 0), 0);
            const totalMissingPaperwork = groupDispatchers.reduce((sum, d) => sum + (d.missingPaperwork || 0), 0);
            
            const calcActivities = groupDispatchers.map(d => {
                const activityData = d.calculatorActivity / 100 * 7; 
                return Math.round(activityData);
            });
            const medianCalculatorActivity = calcActivities.length > 0 ? calculateMedian(calcActivities) : 0;

            const rcEntriesAll = groupDispatchers.map(d => d.rcEntry).filter(v => v !== null);
            const medianRcEntry = rcEntriesAll.length > 0 ? calculateMedian(rcEntriesAll) : 0;

           return {
                weekDate: payDate, dateLabel, badMoves: totalBadMoves, canceled: totalCanceled,
                wellness: avgWellnessScore, compliance: medianCompliance, overdue: medianOverdue,
                tuesdayOpen: totalTuesdayOpen, calculatorActivity: medianCalculatorActivity, missingPaperwork: totalMissingPaperwork, rcEntry: medianRcEntry,
                wellnessBreakdown: { passed: totalPassed, good: totalGood, failed: totalFailed }
            };
        };

        const isMatchingWeek = (appState.profiles.selectedWeek === 'live' && i === 0) || (appState.profiles.selectedWeek === `week_${i}`);
        const targetViewName = selectedTeam === 'ALL_TEAMS' ? 'All Teams' : selectedTeam;

        // 1. All Teams Aggregate
        const allTeamsAgg = aggregateForGroup(filteredScoredDispatchers);
        if (isMatchingWeek && targetViewName === 'All Teams' && appState.profiles.currentKpis) {
            allTeamsAgg.compliance = appState.profiles.currentKpis.medianCompliance;
        }
        datasets["All Teams"].push(allTeamsAgg);

        // 2. Individual Teams
        allUniqueTeams.forEach(teamName => {
            const teamDispatchers = filteredScoredDispatchers.filter(d => {
                const grouped = getGroupedTeamName(d.team);
                return grouped === teamName;
            });
            const teamAgg = aggregateForGroup(teamDispatchers);
            // Use currentKpis medianCompliance ONLY if we are viewing "All Teams" OR this specific team
            if (isMatchingWeek && (targetViewName === 'All Teams' || targetViewName === teamName) && appState.profiles.currentKpis) {
                
                 if (i === 0 && appState.profiles.currentTeamData && appState.profiles.currentTeamData.dispatchers) {
                     // Find the dispatchers belonging to this team from the OFFICIAL current state
                     const liveTeamDispatchers = appState.profiles.currentTeamData.dispatchers.filter(d => {
                         const grouped = getGroupedTeamName(d.team);
                         return grouped === teamName;
                     });
                     
                     if (liveTeamDispatchers.length > 0) {
                         const scores = liveTeamDispatchers.map(d => d.complianceScore).filter(c => isFinite(c) && c !== null);
                         if (scores.length > 0) {
                             teamAgg.compliance = calculateMedian(scores);
                         }
                     }
                 }
            }
            datasets[teamName].push(teamAgg);
        });

        // 3. Specific Dispatcher
        if (dispatcherNameFromAccess) {
             const specificDispatcher = filteredScoredDispatchers.filter(d => d.name.toLowerCase() === dispatcherNameFromAccess.toLowerCase());
             const dispAgg = aggregateForGroup(specificDispatcher);
             if (isMatchingWeek && appState.profiles.currentKpis) {
                 dispAgg.compliance = appState.profiles.currentKpis.medianCompliance;
             }
             datasets[dispatcherNameFromAccess].push(dispAgg);
        }
    }

    return Object.entries(datasets).map(([name, data]) => ({ name, data: data.sort((a,b) => a.weekDate - b.weekDate) }));
}



export function precomputeGlobalDriverStats() {
    const liveData = appState.profiles.liveData || [];
    const historicalStubs = appState.loads.historicalStubsData || [];
    
    const allDriverNames = new Set();
    liveData.forEach(d => { if(d.driver) allDriverNames.add(d.driver); });
    historicalStubs.forEach(d => { if(d.driver_name) allDriverNames.add(d.driver_name); });

    const globalStats = new Map();

    allDriverNames.forEach(name => {
        // Calculate Flags
        const flags = calculateLiveFlagsForDriver(name, historicalStubs, []);
        
        // Calculate Risk (calculateDropRisk expects an object with a 'flags' array)
        const risk = calculateDropRisk({ name, flags });

        // Determine Contract
        let contract = 'LOO'; 
        const liveEntry = liveData.find(d => d.driver === name);
        if (liveEntry && liveEntry.contract_type === 'OO') contract = 'OO';
        else {
            const recentStub = historicalStubs.filter(s => s.driver_name === name && s.contract_type).sort((a,b) => new Date(b.pay_date) - new Date(a.pay_date))[0];
            if (recentStub && recentStub.contract_type === 'OO') contract = 'OO';
        }
        
        // Determine Company
        let company = '-';
        if (liveEntry && liveEntry.company_name) company = liveEntry.company_name;
        else {
             const recentStub = historicalStubs.filter(s => s.driver_name === name && s.company_name).sort((a,b) => new Date(b.pay_date) - new Date(a.pay_date))[0];
             if (recentStub) company = recentStub.company_name;
        }

        globalStats.set(name, { name, risk, contract, company, flags });
    });

    appState.profiles.globalDriverStats = globalStats;
}
function openTrailerDropsHistoryModal() {
    let modal = document.getElementById('trailer-drops-history-modal');
    
    // Initialize cache if it doesn't exist
    if (!appState.profiles.trailerDropsHistoryCache) {
        appState.profiles.trailerDropsHistoryCache = { key: null, data: null };
    }

    // Initialize chart view state if it doesn't exist
    if (!appState.profiles.trailerDropsHistoryView) {
        appState.profiles.trailerDropsHistoryView = 'drops'; // Default view
    }

    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'trailer-drops-history-modal';
        modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4 hidden';
        modal.innerHTML = `
            <div class="bg-gray-800 border-2 border-gray-700 rounded-2xl shadow-2xl w-full max-w-5xl h-[600px] flex flex-col animate-fade-in-up">
                <div class="flex items-center justify-between p-4 border-b border-gray-700">
                    <div>
                        <h2 class="text-lg font-bold text-gray-200">Trailer Activity History (Last 12 Weeks)</h2>
                        <p class="text-xs text-gray-400 mt-1">Track drops and recoveries across teams.</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <select id="trailer-drops-chart-select" class="bg-gray-700 text-gray-200 text-xs font-semibold rounded-md border-gray-600 focus:ring-2 focus:ring-teal-500 py-1.5 px-3 outline-none cursor-pointer hover:bg-gray-600 transition-colors">
                            <option value="drops">Drops</option>
                            <option value="recoveries">Recoveries</option>
                        </select>
                        <button id="close-trailer-drops-modal-btn" class="text-gray-400 hover:text-white text-2xl transition-colors ml-4">&times;</button>
                    </div>
                </div>
                <div class="p-4 flex-grow relative" id="trailer-drops-chart-container">
                    <div class="absolute inset-0 flex items-center justify-center text-gray-500">
                        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-400 mr-3"></div> Calculating History...
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        const closeBtn = modal.querySelector('#close-trailer-drops-modal-btn');
        closeBtn.onclick = () => modal.classList.add('hidden');
        modal.addEventListener('click', (e) => { if(e.target === modal) modal.classList.add('hidden'); });

        const select = modal.querySelector('#trailer-drops-chart-select');
        select.addEventListener('change', (e) => {
            const metric = e.target.value;
            appState.profiles.trailerDropsHistoryView = metric;
            if (window._trailerDropsHistoryData) renderTrailerDropsHistoryChart(window._trailerDropsHistoryData, metric);
        });
    } else {
        const select = modal.querySelector('#trailer-drops-chart-select');
        if (select) {
            select.value = appState.profiles.trailerDropsHistoryView;
        }
    }
    
    modal.classList.remove('hidden');
    
    const { contractTypeFilter, selectedCompany, selectedFranchise } = appState.profiles;
    const currentKey = `ALL_TEAMS|${contractTypeFilter}|${selectedCompany}|${selectedFranchise}|${appState.lastRefreshed}`;
    
    const chartContainer = document.getElementById('trailer-drops-chart-container');

    if (appState.profiles.trailerDropsHistoryCache.key === currentKey) {
        const data = appState.profiles.trailerDropsHistoryCache.data;
        window._trailerDropsHistoryData = data;
        renderTrailerDropsHistoryChart(data, appState.profiles.trailerDropsHistoryView);
    } else {
        if (chartContainer) {
            chartContainer.innerHTML = `<div class="absolute inset-0 flex items-center justify-center text-gray-500"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-400 mr-3"></div> Calculating History...</div>`;
        }
        requestAnimationFrame(() => {
            setTimeout(() => {
                const data = calculateTrailerDropsHistoryData();
                appState.profiles.trailerDropsHistoryCache = { key: currentKey, data: data };
                window._trailerDropsHistoryData = data;
                renderTrailerDropsHistoryChart(data, appState.profiles.trailerDropsHistoryView);
            }, 50);
        });
    }
}

function calculateTrailerDropsHistoryData() {
    const weeksToCheck = 12;
    const { contractTypeFilter, selectedCompany, selectedFranchise, selectedTeam } = appState.profiles;
    const trailerDropsData = appState.profiles.trailerDropsData || [];
    
    // 1. Get List of Valid Dispatchers based on Current Filters (Contract, Company, Franchise)
    // We use allProcessedDispatchers if available (from renderTeamProfileUI), otherwise fallback to liveDriverCountData
    let validDispatcherNames = new Set();
    
    if (appState.profiles.allProcessedDispatchers) {
        // This list is already filtered by permissions, but NOT by UI filters yet.
        // We apply UI filters here to match the "All Teams" KPI card logic.
        let filtered = appState.profiles.allProcessedDispatchers;

        if (contractTypeFilter !== 'all') {
            filtered = filtered.filter(d => contractTypeFilter === 'oo' ? d.ooTrucks > 0 : d.looTrucks > 0);
        }
        if (selectedCompany !== 'All Companies') {
            filtered = filtered.filter(d => d.company === selectedCompany);
        }
        if (selectedFranchise !== 'All Franchises') {
            filtered = filtered.filter(d => d.loads && d.loads.some(l => l.franchise_name === selectedFranchise));
        }

        filtered.forEach(d => validDispatcherNames.add(d.name.toLowerCase().trim()));
    } else if (appState.profiles.liveDriverCountData) {
        // Fallback if full object isn't ready
        appState.profiles.liveDriverCountData.forEach(d => {
             // Basic filtering approximation
             let isValid = true;
             if (selectedCompany !== 'All Companies' && d.company_name !== selectedCompany) isValid = false;
             if (contractTypeFilter !== 'all') {
                 const oo = d.contract_type === 'OO';
                 if (contractTypeFilter === 'oo' && !oo) isValid = false;
                 if (contractTypeFilter === 'loo' && oo) isValid = false;
             }
             if (isValid && d.dispatcher_name) validDispatcherNames.add(d.dispatcher_name.toLowerCase().trim());
        });
    }

    const specialPrefixes = ['agnius', 'uros', 'miles', 'wayne', 'mubeen', 'vito']; 
    const excludedNames = ['cletus spuckler', 'ralph wiggum', 'seymour skinner', 'med disp disp'];

    const getGroupedTeamName = (rawTeam) => {
        if (!rawTeam) return null;
        const lower = rawTeam.toLowerCase();
        if (excludedNames.includes(lower)) return null;
        const prefix = specialPrefixes.find(p => lower.startsWith(p));
        if (prefix) {
            return prefix.charAt(0).toUpperCase() + prefix.slice(1);
        }
        return rawTeam;
    };

    const teamSet = new Set();
    
    // Build Dispatcher -> Team Map for Grouping
    const dispatcherToTeamMap = {};
    if (appState.profiles.liveDriverCountData) {
        appState.profiles.liveDriverCountData.forEach(d => {
            if (d.dispatcher_name && d.dispatcher_team) {
                const groupedTeam = getGroupedTeamName(d.dispatcher_team);
                dispatcherToTeamMap[d.dispatcher_name.toLowerCase().trim()] = groupedTeam;
                if (groupedTeam) teamSet.add(groupedTeam);
            }
        });
    }
    
    const allUniqueTeams = [...teamSet].sort();
    const datasets = {}; 
    datasets["All Teams"] = [];
    allUniqueTeams.forEach(t => datasets[t] = []);

    const user = appState.auth.user;
    const isDispatcherRole = user && user.role === 'Dispatcher';
    let dispatcherNameFromAccess = null;
    if (isDispatcherRole) {
         if (Array.isArray(user.access) && user.access.length > 0) {
            dispatcherNameFromAccess = String(user.access[0]).trim();
        } else if (typeof user.access === 'string' && user.access.trim()) {
            dispatcherNameFromAccess = user.access.split(',')[0].trim();
        }
    }
    if (dispatcherNameFromAccess) {
        datasets[dispatcherNameFromAccess] = [];
    }
    
    for (let i = 0; i <= weeksToCheck; i++) { 
        const { start, end } = getPayrollWeekDateRange(i);
        const payDate = new Date(end);
        payDate.setUTCDate(end.getUTCDate() + 3);
        const dateLabel = `${start.toLocaleDateString('en-US', {month:'short', day:'numeric'})} - ${end.toLocaleDateString('en-US', {month:'short', day:'numeric'})}`;

        // Get drops for the week
        let weekDrops = trailerDropsData.filter(d => {
            if (!d.dropTime) return false;
            const dt = new Date(d.dropTime);
            return dt >= start && dt <= end;
        });

        // Get recoveries for the week
        let weekRecoveries = trailerDropsData.filter(d => {
            if (!d.recoveryTime) return false;
            const rt = new Date(d.recoveryTime);
            return rt >= start && rt <= end;
        });

        // 2. FILTER DROPS/RECOVERIES BY VALID DISPATCHERS (Matches KPI Card Logic)
        // Only count drops where the dispatcher exists in our filtered list
        weekDrops = weekDrops.filter(d => d.droppedByDispatcher && validDispatcherNames.has(d.droppedByDispatcher.toLowerCase().trim()));
        weekRecoveries = weekRecoveries.filter(d => d.recoveredByDispatcher && validDispatcherNames.has(d.recoveredByDispatcher.toLowerCase().trim()));

        const aggregateForGroup = (teamName) => {
            let totalDrops = 0;
            let totalRecoveries = 0;
            
            if (teamName === 'All Teams') {
                totalDrops = weekDrops.length;
                totalRecoveries = weekRecoveries.length;
            } else if (teamName === dispatcherNameFromAccess) {
                totalDrops = weekDrops.filter(d => (d.droppedByDispatcher || '').toLowerCase().trim() === teamName.toLowerCase().trim()).length;
                totalRecoveries = weekRecoveries.filter(d => (d.recoveredByDispatcher || '').toLowerCase().trim() === teamName.toLowerCase().trim()).length;
            } else {
                 // Sum up for all dispatchers belonging to this team
                 // We iterate the drops and check the team map
                 totalDrops = weekDrops.filter(d => {
                     const dispName = (d.droppedByDispatcher || '').toLowerCase().trim();
                     return dispatcherToTeamMap[dispName] === teamName;
                 }).length;

                 totalRecoveries = weekRecoveries.filter(d => {
                     const dispName = (d.recoveredByDispatcher || '').toLowerCase().trim();
                     return dispatcherToTeamMap[dispName] === teamName;
                 }).length;
            }

            return { weekDate: payDate, dateLabel, drops: totalDrops, recoveries: totalRecoveries };
        };

        datasets["All Teams"].push(aggregateForGroup('All Teams'));
        allUniqueTeams.forEach(teamName => {
            datasets[teamName].push(aggregateForGroup(teamName));
        });
        if (dispatcherNameFromAccess) {
             datasets[dispatcherNameFromAccess].push(aggregateForGroup(dispatcherNameFromAccess));
        }
    }

    // --- TRIM EMPTY WEEKS LOGIC ---
    // Iterate from the oldest week (index = length - 1) backwards.
    // Find the first index (going backwards) that has data. Everything older than that is removed.
    
    let oldestWeekIndexToKeep = 0;
    
    // Check every week index
    for (let i = 0; i <= weeksToCheck; i++) {
         const hasDataAnywhere = Object.values(datasets).some(ds => {
             const entry = ds[i]; // Access by index
             return entry && (entry.drops > 0 || entry.recoveries > 0);
         });
         
         if (hasDataAnywhere) {
             oldestWeekIndexToKeep = i;
         }
    }
    
    // Slice datasets to keep only up to the oldest active week
    Object.keys(datasets).forEach(key => {
        // Keep 0 to oldestWeekIndexToKeep
        datasets[key] = datasets[key].slice(0, oldestWeekIndexToKeep + 1);
    });

    return Object.entries(datasets).map(([name, data]) => ({ name, data: data.sort((a,b) => a.weekDate - b.weekDate) }));
}
function openGeneralHistoryModal(metricId) {
    let modal = document.getElementById('general-history-modal');
    
    // Reset cache if needed or just use current metric
    appState.profiles.generalHistoryView = metricId;

    const metricLabels = {
        totalGross: 'Total Weekly Gross',
        teamRpm: 'Team RPM (All)',
        teamMargin: 'Team Margin',
        activeTrucks: 'Active Trucks',
        balance: 'Balance + PO'
    };
    const title = metricLabels[metricId] || 'Metric History';

    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'general-history-modal';
        modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50 p-4 hidden';
        modal.innerHTML = `
            <div class="bg-gray-800 border-2 border-gray-700 rounded-2xl shadow-2xl w-full max-w-5xl h-[600px] flex flex-col animate-fade-in-up">
                <div class="flex items-center justify-between p-4 border-b border-gray-700">
                    <div>
                        <h2 id="general-history-title" class="text-lg font-bold text-gray-200">${title} History (Last 12 Weeks)</h2>
                        <p class="text-xs text-gray-400 mt-1">Track performance trends across teams.</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <button id="close-general-modal-btn" class="text-gray-400 hover:text-white text-2xl transition-colors ml-4">&times;</button>
                    </div>
                </div>
                <div class="p-4 flex-grow relative" id="general-chart-container">
                    <div class="absolute inset-0 flex items-center justify-center text-gray-500">
                        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-400 mr-3"></div> Calculating History...
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        const closeBtn = modal.querySelector('#close-general-modal-btn');
        closeBtn.onclick = () => modal.classList.add('hidden');
        modal.addEventListener('click', (e) => { if(e.target === modal) modal.classList.add('hidden'); });
    } else {
        // Update title if modal already exists
        const titleEl = modal.querySelector('#general-history-title');
        if (titleEl) titleEl.textContent = `${title} History (Last 12 Weeks)`;
    }
    
    modal.classList.remove('hidden');
    
    const { contractTypeFilter, selectedCompany, selectedFranchise } = appState.profiles;
    const currentKey = `ALL_TEAMS|${contractTypeFilter}|${selectedCompany}|${selectedFranchise}|${appState.lastRefreshed}`;
    
    const chartContainer = document.getElementById('general-chart-container');

    // Always recalculate or verify cache
    if (appState.profiles.generalHistoryCache && appState.profiles.generalHistoryCache.key === currentKey) {
        const data = appState.profiles.generalHistoryCache.data;
        window._generalHistoryData = data;
        renderGeneralHistoryChart(data, metricId);
    } else {
        if (chartContainer) {
            chartContainer.innerHTML = `<div class="absolute inset-0 flex items-center justify-center text-gray-500"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-400 mr-3"></div> Calculating History...</div>`;
        }
        requestAnimationFrame(() => {
            setTimeout(() => {
                const data = calculateGeneralHistoryData();
                appState.profiles.generalHistoryCache = { key: currentKey, data: data };
                window._generalHistoryData = data;
                renderGeneralHistoryChart(data, metricId);
            }, 50);
        });
    }
}

function calculateGeneralHistoryData() {
    const weeksToCheck = 12;
    const { contractTypeFilter, selectedCompany, selectedFranchise } = appState.profiles;
    const historicalStubs = appState.loads.historicalStubsData || [];
    const liveData = appState.profiles.liveData || [];

    // Helper to get raw data for a week based on main filters
    const getDataForWeek = (weekIndex) => {
        const { start, end } = getPayrollWeekDateRange(weekIndex);
        const isLive = weekIndex === 0;
        
        let filteredData;
       if (isLive) {
            filteredData = liveData.filter(d => d.do_date && new Date(d.do_date) >= start && new Date(d.do_date) <= end);
        } else  {
            // For historical, we want data with pay_date corresponding to this week's period
            const targetPayDate = new Date(end);
            targetPayDate.setUTCDate(end.getUTCDate() + 3); // Thursday
            const targetDateStr = targetPayDate.toISOString().split('T')[0];
            
            filteredData = historicalStubs.filter(s => s.pay_date && s.pay_date.split('T')[0] === targetDateStr);
        }

        // Apply filters
        if (contractTypeFilter !== 'all') {
             filteredData = filteredData.filter(d => {
                const cType = (d.contract_type || 'LOO').toUpperCase();
                const norm = cType === 'OO' ? 'OO' : 'LOO';
                return contractTypeFilter === 'oo' ? norm === 'OO' : norm !== 'OO';
             });
        }
        if (selectedCompany !== 'All Companies') filteredData = filteredData.filter(d => d.company_name === selectedCompany);
        if (selectedFranchise !== 'All Franchises') filteredData = filteredData.filter(d => d.franchise_name === selectedFranchise);

        return { data: filteredData, isLive, end, start };
    };

    const specialPrefixes = ['agnius', 'uros', 'miles', 'wayne', 'mubeen', 'vito']; 
    const excludedNames = ['cletus spuckler', 'ralph wiggum', 'seymour skinner', 'med disp disp'];

    const getGroupedTeamName = (rawTeam) => {
        if (!rawTeam) return null;
        const lower = rawTeam.toLowerCase();
        if (excludedNames.includes(lower)) return null;
        const prefix = specialPrefixes.find(p => lower.startsWith(p));
        if (prefix) return prefix.charAt(0).toUpperCase() + prefix.slice(1);
        return rawTeam;
    };

    // Collect all teams present in live data + historical stubs
    const allTeamsSet = new Set();
    liveData.forEach(d => { if(d.team) { const t = getGroupedTeamName(d.team); if(t) allTeamsSet.add(t); } });
    historicalStubs.forEach(d => { if(d.stub_team) { const t = getGroupedTeamName(d.stub_team); if(t) allTeamsSet.add(t); } });
    const allUniqueTeams = [...allTeamsSet].sort();

    const datasets = { "All Teams": [] };
    allUniqueTeams.forEach(t => datasets[t] = []);

    // Check user role for dispatcher view
    const user = appState.auth.user;
    const isDispatcherRole = user && user.role === 'Dispatcher';
    let dispatcherNameFromAccess = null;
    if (isDispatcherRole) {
         if (Array.isArray(user.access) && user.access.length > 0) dispatcherNameFromAccess = String(user.access[0]).trim();
         else if (typeof user.access === 'string' && user.access.trim()) dispatcherNameFromAccess = user.access.split(',')[0].trim();
    }
    if (dispatcherNameFromAccess) datasets[dispatcherNameFromAccess] = [];

    // Iterate Weeks
    for (let i = weeksToCheck; i >= 0; i--) {
        const { data: weekData, isLive, end, start } = getDataForWeek(i);
        const payDate = new Date(end);
        payDate.setUTCDate(end.getUTCDate() + 3);
        
        // --- ADDED: Format Date Label for Tooltip ---
        const dateLabel = `${start.toLocaleDateString('en-US', {month:'short', day:'numeric'})} - ${end.toLocaleDateString('en-US', {month:'short', day:'numeric'})}`;

        const aggregate = (items) => {
            if (items.length === 0) return { totalGross: 0, teamRpm: 0, teamMargin: 0, activeTrucks: 0, balance: 0 };

            const activeItems = isLive 
                ? items.filter(d => d.status !== 'Canceled') 
                : items.filter(s => s.stub_team && s.total_miles > 0);
            
            const totalGross = isLive
                ? activeItems.reduce((sum, l) => sum + (l.price || 0), 0)
                : activeItems.reduce((sum, s) => sum + (s.driver_gross || 0) + (s.margin || 0), 0);
            
            const totalMargin = isLive
                ? activeItems.reduce((sum, l) => sum + (parseFloat(String(l.cut).replace(/,/g, '')) || 0), 0)
                : activeItems.reduce((sum, s) => sum + (parseFloat(String(s.margin).replace(/,/g, '')) || 0), 0);
                
            const totalMiles = isLive
                ? activeItems.reduce((sum, l) => sum + (l.trip_miles || 0) + (l.deadhead_miles || 0), 0)
                : activeItems.reduce((sum, s) => sum + (s.total_miles || 0), 0);
            
            const activeTrucks = new Set(activeItems.map(d => isLive ? d.driver : d.driver_name)).size;
            
            let balance = 0;
            
            const getStubLiability = (stub) => {
                const b = parseFloat(String(stub.balance || 0).replace(/,/g, ''));
                const bSettle = parseFloat(String(stub.balance_settle || 0).replace(/,/g, ''));
                const po = parseFloat(String(stub.po_deductions || 0).replace(/,/g, ''));
                const poSettle = parseFloat(String(stub.po_settle || 0).replace(/,/g, ''));
                
                const finalBalance = b + bSettle;
                const finalPo = po - poSettle;
                
                return Math.abs(finalBalance) + finalPo;
            };

            if (!isLive) {
                 const uniqueDrivers = {};
                 items.forEach(s => {
                     if (!uniqueDrivers[s.driver_name] || new Date(s.pay_date) > new Date(uniqueDrivers[s.driver_name].pay_date)) {
                         uniqueDrivers[s.driver_name] = s;
                     }
                 });
                 balance = Object.values(uniqueDrivers).reduce((sum, stub) => sum + getStubLiability(stub), 0);
            } else {
                const activeDrivers = new Set(items.map(d => d.driver));
                balance = [...activeDrivers].reduce((sum, driverName) => {
                    const driverStubs = historicalStubs.filter(s => s.driver_name === driverName).sort((a,b) => new Date(b.pay_date) - new Date(a.pay_date));
                    if (driverStubs.length > 0) {
                        return sum + getStubLiability(driverStubs[0]);
                    }
                    return sum;
                }, 0);
            }

            return {
                totalGross,
                teamRpm: totalMiles > 0 ? totalGross / totalMiles : 0,
                teamMargin: totalMargin,
                activeTrucks,
                balance
            };
        };

        const pushData = (name, metrics) => {
            datasets[name].push({
                weekDate: payDate,
                dateLabel, // --- ADDED: Pass dateLabel to dataset ---
                ...metrics
            });
        };

        // All Teams Aggregate
        pushData("All Teams", aggregate(weekData));

        // Per Team Aggregate
        allUniqueTeams.forEach(teamName => {
            const teamItems = weekData.filter(d => {
                const t = getGroupedTeamName(isLive ? d.team : d.stub_team);
                return t === teamName;
            });
            pushData(teamName, aggregate(teamItems));
        });

        // Dispatcher Aggregate
        if (dispatcherNameFromAccess) {
             const dispItems = weekData.filter(d => {
                 const dName = (isLive ? d.dispatcher : d.stub_dispatcher) || '';
                 return dName.toLowerCase() === dispatcherNameFromAccess.toLowerCase();
             });
             pushData(dispatcherNameFromAccess, aggregate(dispItems));
        }
    }

    return Object.entries(datasets).map(([name, data]) => ({ name, data: data.sort((a,b) => a.weekDate - b.weekDate) }));
}

export function renderGeneralHistoryChart(datasets, metricKey) {
    const container = d3.select("#general-chart-container");
    container.html("");
    d3.selectAll(".general-tooltip").remove();

    const currentTeam = appState.profiles.selectedTeam === 'ALL_TEAMS' ? "All Teams" : appState.profiles.selectedTeam;
    const user = appState.auth.user;
    let dispatcherNameFromAccess = null;
    if (user && user.role === 'Dispatcher') {
         if (Array.isArray(user.access) && user.access.length > 0) {
            dispatcherNameFromAccess = String(user.access[0]).trim();
        } else if (typeof user.access === 'string' && user.access.trim()) {
            dispatcherNameFromAccess = user.access.split(',')[0].trim();
        }
    }

    const hasViewAllPermission = hasPermission(user, PERMISSIONS.VIEW_ALL_TEAMS);
    const excludedTeams = ["Cletus Spuckler", "Ralph Wiggum", "Seymour Skinner", "Spotter"];

    datasets = datasets.filter(ds => {
        if (excludedTeams.includes(ds.name)) return false;
        if (hasViewAllPermission) return true;
        if (currentTeam !== "All Teams") {
            return ds.name === currentTeam || ds.name === "All Teams" || (dispatcherNameFromAccess && ds.name === dispatcherNameFromAccess);
        }
        return true;
    });

    // --- START: Independent Visibility Logic ---
    if (!appState.profiles.generalChartVisibility) {
        appState.profiles.generalChartVisibility = {};
    }
    
    // Check if we have saved visibility state for THIS specific metric
    const hiddenTeamsForMetric = appState.profiles.generalChartVisibility[metricKey];

    datasets.forEach(ds => {
        if (hiddenTeamsForMetric) {
            // Apply saved visibility if it exists for this metric
            ds.hidden = hiddenTeamsForMetric.includes(ds.name);
        } else {
            // Default initialization if no saved state
            if (currentTeam === "All Teams") {
                ds.hidden = ds.name !== "All Teams";
            } else {
                const isRelevant = ds.name === "All Teams" || ds.name === currentTeam || (dispatcherNameFromAccess && ds.name === dispatcherNameFromAccess);
                ds.hidden = !isRelevant;
            }
        }
    });
    
    // Save initial state if it wasn't there
    if (!hiddenTeamsForMetric) {
        appState.profiles.generalChartVisibility[metricKey] = datasets.filter(ds => ds.hidden).map(ds => ds.name);
    }
    // --- END: Independent Visibility Logic ---

    const margin = { top: 20, right: 40, bottom: 30, left: 60 }; 
    const width = container.node().clientWidth - margin.left - margin.right;
    const height = container.node().clientHeight - margin.top - margin.bottom - 80; 
    
    const svg = container.append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    svg.append("defs").append("clipPath").attr("id", "gen-clip").append("rect").attr("width", width).attr("height", height);

    const x = d3.scaleTime().range([0, width]);
    const y = d3.scaleLinear().range([height, 0]);

    const formatY = (d) => {
        if (metricKey === 'teamRpm') return `$${d.toFixed(2)}`;
        if (metricKey === 'activeTrucks') return d;
        if (Math.abs(d) >= 1000) return `$${(d / 1000).toFixed(0)}k`;
        return `$${d}`;
    };

    const xAxisGroup = svg.append("g").attr("transform", `translate(0,${height})`).attr("color", "#9ca3af");
    const yAxisGroup = svg.append("g").attr("color", "#9ca3af");
    const gridGroup = svg.append("g").attr("class", "grid").style("stroke-dasharray", "3, 3").style("stroke-opacity", 0.1);

    const chartBody = svg.append("g").attr("clip-path", "url(#gen-clip)");
    const line = d3.line().x(d => x(d.weekDate)).y(d => y(d[metricKey])).curve(d3.curveMonotoneX);
    const colorScale = d3.scaleOrdinal(d3.schemeTableau10); 

    const updateChart = () => {
        const visibleDatasets = datasets.filter(ds => !ds.hidden);
        const allPoints = visibleDatasets.flatMap(ds => ds.data);
        
        if (allPoints.length === 0) {
             // Handle empty chart gracefully
             x.domain([new Date(), new Date()]); 
             y.domain([0, 10]);
        } else {
            x.domain(d3.extent(allPoints, d => d.weekDate));
            const yMin = d3.min(allPoints, d => d[metricKey]);
            const yMax = d3.max(allPoints, d => d[metricKey]);
            // Add padding
            y.domain([yMin < 0 ? yMin * 1.1 : yMin * 0.9, yMax * 1.05]);
        }

        const t = svg.transition().duration(750);
        
const tickValues = Array.from(new Set(
            visibleDatasets
            .flatMap(ds => ds.data)
            .filter(d => d.weekDate >= x.domain()[0] && d.weekDate <= x.domain()[1])
            .map(d => d.weekDate.getTime())
        )).sort((a, b) => a - b).map(t => new Date(t));

        xAxisGroup.transition(t).call(d3.axisBottom(x).tickValues(tickValues).tickFormat(d3.timeFormat("%b %d")));
        yAxisGroup.transition(t).call(d3.axisLeft(y).ticks(5).tickFormat(formatY));
        gridGroup.transition(t).call(d3.axisLeft(y).tickSize(-width).tickFormat(""));
        gridGroup.select(".domain").remove();

        datasets.forEach((ds, i) => {
            // Lines
            const path = chartBody.selectAll(`.line-${i}`).data([ds.data]);
            path.enter().append("path").attr("class", `line-series line-${i}`)
                .attr("fill", "none")
                .attr("stroke", colorScale(i))
                .attr("stroke-width", ds.name === "All Teams" ? 4 : 2)
                .style("opacity", ds.hidden ? 0 : 1)
                .attr("d", line)
                .merge(path).transition(t)
                .attr("d", line)
                .style("opacity", ds.hidden ? 0 : 1);
            
            // Dots
            const dots = chartBody.selectAll(`.dot-${i}`).data(ds.data);
            dots.enter().append("circle").attr("class", `dot-series dot-${i}`)
                .attr("r", 4)
                .attr("fill", "#1f2937")
                .attr("stroke", colorScale(i))
                .attr("stroke-width", 2)
                .attr("cx", d => x(d.weekDate))
                .attr("cy", d => y(d[metricKey]))
                .style("opacity", ds.hidden ? 0 : 1)
                .merge(dots).transition(t)
                .attr("cx", d => x(d.weekDate))
                .attr("cy", d => y(d[metricKey]))
                .style("opacity", ds.hidden ? 0 : 1);
        });
    };

    updateChart();

    // Legend
    const legendContainer = container.append("div").attr("class", "chart-legend flex flex-wrap justify-center gap-x-4 gap-y-2 mt-2 px-4 overflow-y-auto").style("max-height", "80px");
    datasets.forEach((ds, i) => {
        const color = colorScale(i);
        legendContainer.append("div")
            .attr("class", `chart-legend-item cursor-pointer flex items-center gap-2 text-xs select-none ${ds.hidden ? 'opacity-40 grayscale' : 'opacity-100'}`)
            .style("text-decoration", ds.hidden ? "line-through" : "none")
            .html(`<div class="w-3 h-3 rounded-full" style="background-color: ${color}"></div><span>${ds.name}</span>`)
            .on("click", function() {
                ds.hidden = !ds.hidden;
                
                // --- UPDATE Independent Visibility State ---
                if (ds.hidden) {
                    if (!appState.profiles.generalChartVisibility[metricKey].includes(ds.name)) {
                        appState.profiles.generalChartVisibility[metricKey].push(ds.name);
                    }
                } else {
                    appState.profiles.generalChartVisibility[metricKey] = appState.profiles.generalChartVisibility[metricKey].filter(t => t !== ds.name);
                }
                
                d3.select(this).classed("opacity-40 grayscale", ds.hidden).classed("opacity-100", !ds.hidden).style("text-decoration", ds.hidden ? "line-through" : "none");
                updateChart();
            });
    });

    // Tooltip
    const tooltip = d3.select("body").append("div").attr("class", "d3-tooltip general-tooltip").style("opacity", 0);
    const focus = svg.append("g").style("display", "none");
    focus.append("line").attr("y1", 0).attr("y2", height).style("stroke", "#4b5563").style("stroke-dasharray", "3,3");

    svg.append("rect").attr("width", width).attr("height", height).style("fill", "none").style("pointer-events", "all")
        .on("mouseover", () => { focus.style("display", null); tooltip.style("opacity", 1); })
        .on("mouseout", () => { focus.style("display", "none"); tooltip.style("opacity", 0); })
        .on("mousemove", (event) => {
            const x0 = x.invert(d3.pointer(event)[0]);
            const visibleDatasets = datasets.filter(ds => !ds.hidden);
            if (visibleDatasets.length === 0) return;
            const refData = visibleDatasets[0].data;
            const bisect = d3.bisector(d => d.weekDate).left;
            const i = bisect(refData, x0, 1);
            const d0 = refData[i - 1], d1 = refData[i];
            const d = (d0 && d1) ? (x0 - d0.weekDate > d1.weekDate - x0 ? d1 : d0) : (d0 || d1);
            
            if (!d) return;

            focus.attr("transform", `translate(${x(d.weekDate)},0)`);
            
            // --- UPDATED TOOLTIP HEADER (Pay Date separate from Range) ---
            const headerText = d.dateLabel 
                ? `<div class="text-[10px] text-gray-400 font-normal">Pay Date: ${d3.timeFormat("%b %d")(d.weekDate)}</div>${d.dateLabel}`
                : d3.timeFormat("%b %d")(d.weekDate);

            let html = `<div class="font-bold text-white border-b border-gray-600 pb-1 mb-1 text-center">${headerText}</div>`;
            
            const points = datasets.map((ds, idx) => {
                const pt = ds.data.find(p => p.weekDate.getTime() === d.weekDate.getTime());
                return pt && !ds.hidden ? { name: ds.name, val: pt[metricKey], color: colorScale(idx) } : null;
            }).filter(Boolean).sort((a, b) => b.val - a.val);

            points.forEach(p => {
                let valStr;
                if (metricKey === 'teamRpm') valStr = `$${p.val.toFixed(2)}`;
                else if (metricKey === 'activeTrucks') valStr = p.val;
                else valStr = `$${p.val.toLocaleString(undefined, {maximumFractionDigits:0})}`;
                html += `<div class="flex justify-between gap-4 text-xs"><span style="color:${p.color}">${p.name}</span><span class="font-mono text-white">${valStr}</span></div>`;
            });
            tooltip.html(html).style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px");
        });
}