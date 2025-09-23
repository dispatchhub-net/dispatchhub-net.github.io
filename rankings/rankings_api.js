import { GOOGLE_APPS_SCRIPT_WEB_APP_URL, coreMetrics } from '../config.js';
import { appState, stubsSortConfig } from '../state.js';
import { calculateMedian, formatPercentage } from '../utils.js';

const recalculateMetrics = (stubs, driverType) => {
    if (!stubs || stubs.length === 0) {
        return null;
    }

    const numDrivers = stubs.length;

    const avg = (key) => stubs.reduce((acc, stub) => acc + (stub[key] || 0), 0) / numDrivers;
    const sum = (key) => stubs.reduce((acc, stub) => acc + (stub[key] || 0), 0);

    const totalGross = sum('total_gross');
    const allMiles = sum('all_miles');
    const loadedMiles = sum('loaded_miles');

    // --- Recalculate all metrics on a per-driver average basis ---
    const driverHappiness = avg('netDriverGrossPercentage');
    const companyHappiness = avg('cashFlow');
    const mainCriteria = (driverHappiness + companyHappiness) / 2;

    const recalculated = {
        // --- Core criteria and percentages (Averages) ---
        mainCriteria: mainCriteria,
        pNet: avg('netPercentage'),
        pDriverGross: avg('driverGross'), // This is the %
        pMargin: avg('margin'),
        pMainCriteriaNetDriverMargin: driverHappiness,
        pMainCriteria2CashFlow: companyHappiness,
        pDriver_rpm: avg('driver_rpm'),

        // --- Ratios, calculated from totals ---
        rpmAll: allMiles > 0 ? totalGross / allMiles : 0,

        // --- Raw values, calculated as per-driver averages ---
        pAll_miles: allMiles / numDrivers,
        pLoaded_miles: loadedMiles / numDrivers,
        pMargin_dollar: sum('margin_dollar') / numDrivers,
        pDriver_gross: sum('driver_gross') / numDrivers, // This is the $ amount
        pDefault_fuel: sum('default_fuel') / numDrivers,
        pEstimated_fuel: sum('estimated_fuel') / numDrivers,
        pEstimated_tolls: sum('estimated_tolls') / numDrivers,
        pMaintenance: sum('maintenance') / numDrivers,
        pDepreciation: sum('Depreciation') / numDrivers,
        pTotal_gross: totalGross / numDrivers,
        pEstimated_net: sum('estimated_net') / numDrivers,

        // --- Driver counts ---
        numDrivers: numDrivers,
        numOOs: driverType === 'oo' ? numDrivers : 0,
        numLOOs: driverType === 'loo' ? numDrivers : 0,
        driverNames: stubs.map(s => s.driverName),
    };

    return recalculated;
};

export const fetchAllHistoricalData = async () => {
    try {
        const response = await fetch(GOOGLE_APPS_SCRIPT_WEB_APP_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();

        if (result.error) {
            throw new Error(result.error);
        }

        const historicalData = result.historicalData.map(item => {
            const newItem = { ...item, dispatcherName: item.dispatcherName || item.name, date: new Date(item.date) };

            // FIX: Use the team from the specific row, and only trim it if it exists.
            // Do not assign a default or fallback team.
            newItem.dispatcherTeam = item.dispatcherTeam ? String(item.dispatcherTeam).trim() : null;
            
            // FIX: Handle singular 'driverName' from sheet and ensure 'driverNames' is an array.
            if (item.driverName && !item.driverNames) {
                 newItem.driverNames = [item.driverName];
            } else if (item.driverNames) { 
                if (Array.isArray(item.driverNames)) {
                    newItem.driverNames = item.driverNames;
                } else if (typeof item.driverNames === 'string') {
                    newItem.driverNames = item.driverNames.split(',').map(name => name.trim()).filter(name => name.length > 0);
                }
            } else {
                newItem.driverNames = []; 
            }

            coreMetrics.forEach(metric => {
                const value = item[metric.id];
                if (value !== undefined && value !== null) {
                    const parsed = parseFloat(value);
                    newItem[metric.id] = isNaN(parsed) ? null : parsed;
                } else {
                    newItem[metric.id] = null; 
                }
            });

            ['numDrivers', 'numOOs', 'numLOOs'].forEach(colId => { 
                const value = item[colId];
                if (value !== undefined && value !== null) {
                    const parsed = parseFloat(value);
                    newItem[colId] = isNaN(parsed) ? null : parsed;
                } else {
                    newItem[colId] = null;
                }
            });
            
            return newItem;
        });

        appState.allHistoricalData = historicalData;
        
        const uniqueDates = [...new Set(appState.allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
        if (uniqueDates.length > 0) {
            appState.selectedDate = uniqueDates[0];
        }

        // Precompute for both dispatcher and team modes
        appState.precomputedDispatcher4WkAverages = {};
        appState.precomputedTeam4WkAverages = {};
        for (const dateString of uniqueDates) {
            appState.precomputedDispatcher4WkAverages[dateString] = calculateFourWeekAverageDataForDate(dateString, 'dispatcher');
            appState.precomputedTeam4WkAverages[dateString] = calculateFourWeekAverageDataForDate(dateString, 'team');
        }

    } catch (e) {
        console.error("Error fetching all historical data:", e);
        appState.error = "Failed to load historical data. Please check your Google Sheet setup and Apps Script deployment. Error: " + e.message;
    }
};

export const getFilteredDataByDriverType = (data) => {
    const filter = appState.driverTypeFilter;
    if (filter === 'all') {
        return data;
    }

    return data.map(dispatcherData => {
        const stubs = dispatcherData.stubs || [];
        // Ensure contractType is a string before calling toLowerCase
        const filteredStubs = stubs.filter(stub => typeof stub.contractType === 'string' && stub.contractType.toLowerCase() === filter);

        if (filteredStubs.length === 0) {
            // Return null for dispatchers with no matching drivers
            return null;
        }

        const recalculatedMetrics = recalculateMetrics(filteredStubs, filter);
        if (!recalculatedMetrics) {
             // Also return null if recalculation fails for some reason
            return null;
        }
        
        // Combine original data with the new, recalculated metrics
        return { ...dispatcherData, ...recalculatedMetrics };

    }).filter(Boolean); // This will filter out all the null values
};

export const getNUniqueHistoricalDates = (allHistoricalData, selectedDateString, numWeeks) => {
    const uniqueDates = [...new Set(allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse(); 
    const selectedDateIndex = uniqueDates.indexOf(selectedDateString);

    if (selectedDateIndex === -1) {
        return []; 
    }

    const relevantDateStrings = uniqueDates.slice(selectedDateIndex, selectedDateIndex + numWeeks);
    
    return allHistoricalData.filter(d => relevantDateStrings.includes(d.date.toISOString().split('T')[0]));
};

export const getNWeeksAgoData = (currentDateString, numberOfWeeksAgo) => {
    const uniqueDates = [...new Set(appState.allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const currentDateIndex = uniqueDates.indexOf(currentDateString);

    if (currentDateIndex === -1 || currentDateIndex + numberOfWeeksAgo >= uniqueDates.length) {
        return [];
    }
    const targetDateString = uniqueDates[currentDateIndex + numberOfWeeksAgo];
    return appState.allHistoricalData.filter(d => d.date.toISOString().split('T')[0] === targetDateString);
};

export const getDataForDate = (dateString) => {
    return appState.allHistoricalData.filter(d => d.date.toISOString().split('T')[0] === dateString);
};

export const getPreviousWeekData = (currentDateString) => {
    const availableDates = [...new Set(appState.allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse(); 

    let closestPrevWeekDate = null;
    for (let i = 0; i < availableDates.length; i++) {
        if (availableDates[i] < currentDateString) { 
            closestPrevWeekDate = availableDates[i];
            break;
        }
    }

    if (closestPrevWeekDate) {
        return appState.allHistoricalData.filter(d => d.date.toISOString().split('T')[0] === closestPrevWeekDate);
    }
    return [];
};

export const calculateFourWeekAverageDataForDate = (currentDateString, mode) => {
    const dataToUse = getFilteredDataByDriverType(appState.allHistoricalData);
    const uniqueDates = [...new Set(dataToUse.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const selectedDateIndex = uniqueDates.indexOf(currentDateString);
    if (selectedDateIndex === -1) return {};

    const relevantDateStrings = uniqueDates.slice(selectedDateIndex, selectedDateIndex + 4);
    
    const relevantHistoricalData = dataToUse.filter(d => 
        relevantDateStrings.includes(d.date.toISOString().split('T')[0])
    );

    const groupKey = mode === 'team' ? 'dispatcherTeam' : 'dispatcherName';

    const groupedByEntity = relevantHistoricalData.reduce((acc, curr) => {
        const key = curr[groupKey];
        if (!key) return acc;

        if (!acc[key]) {
            acc[key] = {
                entityName: key,
                weeks: new Set(),
                totalWeight: 0,
                totalGross: 0,
                totalMiles: 0,
            };
            coreMetrics.forEach(metric => {
                // Initialize sums for all metrics except rpmAll, as it's calculated from totals
                if (metric.id !== 'rpmAll') {
                    acc[key][metric.id] = 0;
                }
            });
            ['numDrivers', 'numOOs', 'numLOOs'].forEach(colId => { 
                acc[key][colId] = 0;
            });
        }

        const entity = acc[key];
        const dateKey = curr.date.toISOString().split('T')[0];
        entity.weeks.add(dateKey);
        
        const weight = curr.numDrivers > 0 ? curr.numDrivers : 1;
        entity.totalWeight += weight;

        entity.totalGross += (curr.pTotal_gross || 0) * weight;
        entity.totalMiles += (curr.pAll_miles || 0) * weight;

        coreMetrics.forEach(metric => {
            // Use weighted average for all metrics except rpmAll
            if (metric.id !== 'rpmAll') {
                const value = curr[metric.id];
                if (typeof value === 'number' && !isNaN(value)) {
                    entity[metric.id] += value * weight;
                }
            }
        });
        ['numDrivers', 'numOOs', 'numLOOs'].forEach(colId => { 
            const value = curr[colId];
            if (typeof value === 'number' && !isNaN(value)) {
                entity[colId] += value;
            }
        });
        return acc;
    }, {});

    const finalAverages = {};
    for (const entityName in groupedByEntity) {
        const entityAggregate = groupedByEntity[entityName];
        const activeWeeks = entityAggregate.weeks.size;
        if (activeWeeks > 0) {
            const avgData = {
                entityName: entityName,
                weeksIncluded: activeWeeks
            };
            coreMetrics.forEach(metric => {
                if (metric.id === 'rpmAll') {
                    // Calculate rpmAll from the summed totals
                    avgData.rpmAll = entityAggregate.totalMiles > 0 ? entityAggregate.totalGross / entityAggregate.totalMiles : 0;
                } else {
                    // For all other metrics, including pMargin, use the weighted average
                    avgData[metric.id] = entityAggregate.totalWeight > 0 ? entityAggregate[metric.id] / entityAggregate.totalWeight : 0;
                }
            });
            ['numDrivers', 'numOOs', 'numLOOs'].forEach(colId => { 
                avgData[colId] = entityAggregate[colId] / activeWeeks;
            });
            finalAverages[entityName] = avgData;
        }
    }
    return finalAverages; 
};

export const getOrComputeHistoricalMetrics = () => {
    const { rankingMode, driverTypeFilter } = appState;

    if (appState.precomputationCache[rankingMode] && appState.precomputationCache[rankingMode][driverTypeFilter]) {
        return;
    }

    console.log(`%cComputing metrics for: ${rankingMode} - ${driverTypeFilter}`, 'color: orange; font-weight: bold;');

    const dataToUse = getFilteredDataByDriverType(appState.allHistoricalData);
    const groupKey = rankingMode === 'team' ? 'dispatcherTeam' : 'dispatcherName';
    const allEntityNames = [...new Set(dataToUse.map(d => d[groupKey]).filter(Boolean))];
    const computedMetrics = new Map();

    allEntityNames.forEach(name => computedMetrics.set(name, []));

    const uniqueDates = [...new Set(dataToUse.map(d => d.date.toISOString().split('T')[0]))].sort();

    uniqueDates.forEach(dateString => {
        // --- FIX: Consolidate dispatcher data for each date before ranking ---
        let allDataForThisDate;
        if (rankingMode === 'dispatcher') {
            const rawDataForDate = dataToUse.filter(d => d.date.toISOString().split('T')[0] === dateString);
            const groupedByName = rawDataForDate.reduce((acc, curr) => {
                if (!acc[curr.dispatcherName]) {
                    acc[curr.dispatcherName] = { records: [], totalWeight: 0 };
                }
                acc[curr.dispatcherName].records.push(curr);
                acc[curr.dispatcherName].totalWeight += curr.numDrivers || 0;
                return acc;
            }, {});

            allDataForThisDate = Object.values(groupedByName).map(group => {
                if (group.records.length === 1) return group.records[0];
                const consolidated = {
                    dispatcherName: group.records[0].dispatcherName,
                    date: group.records[0].date,
                    numDrivers: group.records.reduce((sum, r) => sum + (r.numDrivers || 0), 0),
                };
                coreMetrics.forEach(metric => {
                    const weightedSum = group.records.reduce((sum, r) => {
                        const value = r[metric.id];
                        const weight = r.numDrivers || 0;
                        return sum + ((typeof value === 'number' ? value : 0) * weight);
                    }, 0);
                    consolidated[metric.id] = group.totalWeight > 0 ? weightedSum / group.totalWeight : 0;
                });
                return consolidated;
            });
        } else {
            // Team mode uses raw data for aggregation later
            allDataForThisDate = dataToUse.filter(d => d.date.toISOString().split('T')[0] === dateString);
        }
        // --- End of FIX ---

        let currentRankedData;
        if (rankingMode === 'team') {
            currentRankedData = aggregateTeamData(allDataForThisDate);
            currentRankedData.sort((a, b) => (b.mainCriteria_current || 0) - (a.mainCriteria_current || 0));
        } else {
            // Dispatcher mode now uses the consolidated data for ranking
            currentRankedData = allDataForThisDate
                .filter(d => d.mainCriteria !== null && d[groupKey])
                .sort((a, b) => (b.mainCriteria || 0) - (a.mainCriteria || 0));
        }

        const fourWeekAvgDataForDate = calculateFourWeekAverageDataForDate(dateString, rankingMode);
        const ranked4Wk = Object.values(fourWeekAvgDataForDate || {})
            .sort((a, b) => (b.mainCriteria || 0) - (a.mainCriteria || 0));

        allEntityNames.forEach(entityName => {
            let oneWeekEntityData = null;
            let oneWeekRank = null;

            if (rankingMode === 'team') {
                oneWeekEntityData = currentRankedData.find(d => d.entityName === entityName);
                if (oneWeekEntityData) {
                    oneWeekRank = currentRankedData.findIndex(d => d.entityName === entityName) + 1;
                }
            } else { // Dispatcher mode
                oneWeekEntityData = currentRankedData.find(d => d[groupKey] === entityName);
                if (oneWeekEntityData) {
                    oneWeekRank = currentRankedData.findIndex(d => d[groupKey] === entityName) + 1;
                }
            }

            const fourWeekRank = ranked4Wk.findIndex(d => d.entityName === entityName) + 1;

            if (oneWeekEntityData) {
                computedMetrics.get(entityName).push({
                    date: new Date(dateString),
                    oneWeekCriteria: rankingMode === 'team' ? oneWeekEntityData.mainCriteria_current : oneWeekEntityData.mainCriteria,
                    fourWeekCriteria: fourWeekAvgDataForDate?.[entityName]?.mainCriteria || null,
                    oneWeekRank: oneWeekRank > 0 ? oneWeekRank : null,
                    fourWeekRank: fourWeekRank > 0 ? fourWeekRank : null,
                    truckCount: oneWeekEntityData.numDrivers,
                });
            } else {
                computedMetrics.get(entityName).push({
                    date: new Date(dateString),
                    oneWeekCriteria: null,
                    fourWeekCriteria: fourWeekAvgDataForDate?.[entityName]?.mainCriteria || null,
                    oneWeekRank: null,
                    fourWeekRank: fourWeekRank > 0 ? fourWeekRank : null,
                    truckCount: fourWeekAvgDataForDate?.[entityName]?.numDrivers || null,
                });
            }
        });
    });

    if (!appState.precomputationCache[rankingMode]) {
        appState.precomputationCache[rankingMode] = {};
    }
    appState.precomputationCache[rankingMode][driverTypeFilter] = computedMetrics;
};

export const processDataForMode = (isForStubs = false, singleDispatcherName = null) => {
    const mode = appState.rankingMode;
    const filteredHistoricalData = getFilteredDataByDriverType(appState.allHistoricalData);

    let currentWeekRawDataAll = filteredHistoricalData.filter(d => d.date.toISOString().split('T')[0] === appState.selectedDate);

    if (isForStubs && singleDispatcherName) {
        currentWeekRawDataAll = currentWeekRawDataAll.filter(d => d.dispatcherName === singleDispatcherName);
    }

    const uniqueDatesDesc = [...new Set(filteredHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const currentDateIndex = uniqueDatesDesc.indexOf(appState.selectedDate);
    const prevWeekDateString = uniqueDatesDesc[currentDateIndex + 1] || null;
    const fourWeeksAgoDateString = uniqueDatesDesc[currentDateIndex + 4] || null;

    if (mode === 'dispatcher' || (isForStubs && appState.rankingMode === 'team')) {
        const groupedByDispatcher = currentWeekRawDataAll.reduce((acc, curr) => {
            if (!acc[curr.dispatcherName]) {
                acc[curr.dispatcherName] = {
                    records: [],
                    totalWeight: 0,
                    totalGross: 0, // NEW
                    totalMiles: 0, // NEW
                };
            }
            acc[curr.dispatcherName].records.push(curr);
            const weight = curr.numDrivers || 0;
            acc[curr.dispatcherName].totalWeight += weight;
            // Sum up the total gross and miles from the raw data
            acc[curr.dispatcherName].totalGross += (curr.pTotal_gross || 0) * weight; // NEW
            acc[curr.dispatcherName].totalMiles += (curr.pAll_miles || 0) * weight;   // NEW
            return acc;
        }, {});

        const consolidatedDispatcherData = Object.values(groupedByDispatcher).map(group => {
            if (group.records.length === 1) {
                const record = group.records[0];
                // Ensure rpmAll is calculated correctly even for single records
                record.rpmAll = (record.pAll_miles || 0) > 0 ? (record.pTotal_gross || 0) / (record.pAll_miles) : 0;
                return record;
            }

            const consolidated = {
                dispatcherName: group.records[0].dispatcherName,
                dispatcherTeam: [...new Set(group.records.map(r => r.dispatcherTeam))].join(', '),
                date: group.records[0].date,
                numDrivers: group.records.reduce((sum, r) => sum + (r.numDrivers || 0), 0),
                numOOs: group.records.reduce((sum, r) => sum + (r.numOOs || 0), 0),
                numLOOs: group.records.reduce((sum, r) => sum + (r.numLOOs || 0), 0),
                driverNames: [...new Set(group.records.flatMap(r => r.driverNames || []))],
                stubs: group.records.flatMap(r => r.stubs || []),
            };

            coreMetrics.forEach(metric => {
                // Keep the original weighted average for all metrics except rpmAll
                if (metric.id !== 'rpmAll') {
                    const weightedSum = group.records.reduce((sum, r) => {
                        const value = r[metric.id];
                        const weight = r.numDrivers || 0;
                        return sum + ((typeof value === 'number' ? value : 0) * weight);
                    }, 0);
                    consolidated[metric.id] = group.totalWeight > 0 ? weightedSum / group.totalWeight : 0;
                }
            });
            
            // Explicitly calculate rpmAll from the summed totals
            consolidated.rpmAll = group.totalMiles > 0 ? group.totalGross / group.totalMiles : 0; // NEW

            return consolidated;
        });
        
        const prevWeekRawData = getFilteredDataByDriverType(getNWeeksAgoData(appState.selectedDate, 1));
        const fourWeeksAgoRawData = getFilteredDataByDriverType(getNWeeksAgoData(appState.selectedDate, 4));
        const fourWeekAverages = appState.precomputedDispatcher4WkAverages[appState.selectedDate] || {};
        const prevFourWeekAverages = appState.precomputedDispatcher4WkAverages[prevWeekDateString] || {};
        const fourWeeksAgoFourWeekAverages = appState.precomputedDispatcher4WkAverages[fourWeeksAgoDateString] || {};

        const prevWeekRankedData = [...prevWeekRawData]
            .sort((a, b) => (b.mainCriteria || -Infinity) - (a.mainCriteria || -Infinity))
            .map((d, i) => ({ ...d, rank: i + 1 }));

        let processedData = consolidatedDispatcherData.map(currentDispatcher => {
            const combinedData = { ...currentDispatcher, entityName: currentDispatcher.dispatcherName };
            coreMetrics.forEach(m => combinedData[`${m.id}_current`] = currentDispatcher[m.id]);

            const avg4wk = fourWeekAverages[currentDispatcher.dispatcherName];
            coreMetrics.forEach(m => combinedData[`${m.id}_4wkAvg`] = avg4wk ? avg4wk[m.id] : null);
            ['numDrivers', 'numOOs', 'numLOOs'].forEach(col => combinedData[`${col}_4wkAvg`] = avg4wk ? avg4wk[col] : null);
            combinedData.weeksIncluded_4wkAvg = avg4wk ? avg4wk.weeksIncluded : null;

            const prevDispatcher = prevWeekRankedData.find(d => d.dispatcherName === currentDispatcher.dispatcherName);
            combinedData.prevRank = prevDispatcher ? prevDispatcher.rank : null;

            const prevDispatcherData = prevWeekRawData.find(d => d.dispatcherName === currentDispatcher.dispatcherName);
            const fourWeeksAgoDispatcherData = fourWeeksAgoRawData.find(d => d.dispatcherName === currentDispatcher.dispatcherName);
            const prev4wkAvgData = prevFourWeekAverages[currentDispatcher.dispatcherName];
            const fourWksAgo4wkAvgData = fourWeeksAgoFourWeekAverages[currentDispatcher.dispatcherName];

            combinedData.mainCriteria_1wkChange = (combinedData.mainCriteria_current && prevDispatcherData?.mainCriteria) ? combinedData.mainCriteria_current - prevDispatcherData.mainCriteria : null;
            combinedData.mainCriteria_1wkChange_4wksAgo = (combinedData.mainCriteria_current && fourWeeksAgoDispatcherData?.mainCriteria) ? combinedData.mainCriteria_current - fourWeeksAgoDispatcherData.mainCriteria : null;
            combinedData.mainCriteria_4wkAvg_1wkChange = (combinedData.mainCriteria_4wkAvg && prev4wkAvgData?.mainCriteria) ? combinedData.mainCriteria_4wkAvg - prev4wkAvgData.mainCriteria : null;
            combinedData.mainCriteria_4wkAvg_4wkChange = (combinedData.mainCriteria_4wkAvg && fourWksAgo4wkAvgData?.mainCriteria) ? combinedData.mainCriteria_4wkAvg - fourWksAgo4wkAvgData.mainCriteria : null;

            return combinedData;
        });

        const criteriaValues = processedData
            .map(d => d.mainCriteria_4wkAvg)
            .filter(v => typeof v === 'number' && !isNaN(v))
            .sort((a, b) => a - b);

        const total = criteriaValues.length;
        processedData.forEach(d => {
            const value = d.mainCriteria_4wkAvg;
            if (typeof value !== 'number' || isNaN(value)) {
                d.statusColor = 'gray';
                return;
            }
            const rank = criteriaValues.indexOf(value);
            const percentile = (rank / (total - 1));

            if (percentile <= 0.4) d.statusColor = '#ef4444';
            else if (percentile <= 0.7) d.statusColor = '#fb923c';
            else d.statusColor = '#22c55e';
        });

        if (isForStubs) return processedData;

        appState.data = processedData;
        const dispatcherRanks = new Map(processedData.sort((a, b) => (b.mainCriteria_current || -Infinity) - (a.mainCriteria_current || -Infinity)).map((d, i) => [d.entityName, i + 1]));
        appState.unfilteredRanks = dispatcherRanks;
        appState.data.forEach(d => d._sortRank = dispatcherRanks.get(d.entityName) || Infinity);

    } else if (mode === 'team') {
        const prevWeekRawData = getFilteredDataByDriverType(getNWeeksAgoData(appState.selectedDate, 1));
        const fourWeeksAgoRawData = getFilteredDataByDriverType(getNWeeksAgoData(appState.selectedDate, 4));

        const currentTeamData = aggregateTeamData(currentWeekRawDataAll);
        const prevWeekTeamData = aggregateTeamData(prevWeekRawData);
        const fourWeeksAgoTeamData = aggregateTeamData(fourWeeksAgoRawData);

        const fourWeekAverages = appState.precomputedTeam4WkAverages[appState.selectedDate] || {};
        const prevFourWeekAverages = appState.precomputedTeam4WkAverages[prevWeekDateString] || {};
        const fourWeeksAgoFourWeekAverages = appState.precomputedTeam4WkAverages[fourWeeksAgoDateString] || {};

        const prevWeekTeamRanks = new Map(
            prevWeekTeamData
            .sort((a, b) => (b.mainCriteria_current || -Infinity) - (a.mainCriteria_current || -Infinity))
            .map((team, i) => [team.entityName, i + 1])
        );

        appState.data = currentTeamData.map(team => {
            const team4wkAvg = fourWeekAverages[team.entityName];
            coreMetrics.forEach(m => team[`${m.id}_4wkAvg`] = team4wkAvg ? team4wkAvg[m.id] : null);
            ['numDrivers', 'numOOs', 'numLOOs'].forEach(col => team[`${col}_4wkAvg`] = team4wkAvg ? team4wkAvg[col] : null);

            const prevTeam = prevWeekTeamData.find(t => t.entityName === team.entityName);
            const fourWeeksAgoTeam = fourWeeksAgoTeamData.find(t => t.entityName === team.entityName);
            const prev4wkAvgData = prevFourWeekAverages[team.entityName];
            const fourWksAgo4wkAvgData = fourWeeksAgoFourWeekAverages[team.entityName];

            team.mainCriteria_1wkChange = (team.mainCriteria_current && prevTeam?.mainCriteria_current) ? team.mainCriteria_current - prevTeam.mainCriteria_current : null;
            team.mainCriteria_1wkChange_4wksAgo = (team.mainCriteria_current && fourWeeksAgoTeam?.mainCriteria_current) ? team.mainCriteria_current - fourWeeksAgoTeam.mainCriteria_current : null;
            team.mainCriteria_4wkAvg_1wkChange = (team.mainCriteria_4wkAvg && prev4wkAvgData?.mainCriteria) ? team.mainCriteria_4wkAvg - prev4wkAvgData.mainCriteria : null;
            team.mainCriteria_4wkAvg_4wkChange = (team.mainCriteria_4wkAvg && fourWksAgo4wkAvgData?.mainCriteria) ? team.mainCriteria_4wkAvg - fourWksAgo4wkAvgData.mainCriteria : null;
            team.prevRank = prevWeekTeamRanks.get(team.entityName) || null;
            return team;
        });

        const teamRanks = new Map(
            appState.data
            .sort((a, b) => (b.mainCriteria_current || -Infinity) - (a.mainCriteria_current || -Infinity))
            .map((team, i) => [team.entityName, i + 1])
        );

        appState.unfilteredRanks = teamRanks;
        appState.data.forEach(d => d._sortRank = teamRanks.get(d.entityName) || Infinity);
    }
};

// WITH THIS
export const aggregateTeamData = (rawData) => {
    const groupedByTeam = rawData.reduce((acc, curr) => {
        if (!curr.dispatcherTeam) return acc;
        if (!acc[curr.dispatcherTeam]) {
            acc[curr.dispatcherTeam] = {
                entityName: curr.dispatcherTeam,
                dispatcherTeam: curr.dispatcherTeam,
                numDrivers: 0,
                numOOs: 0,
                numLOOs: 0,
                driverNames: new Set(),
                dispatchers: new Set(),
                sum_pAll_miles: 0,
                sum_pDriver_gross_dollar: 0,
                sum_pMargin_dollar: 0,
                sum_pTotal_gross: 0,
                sum_pEstimated_net: 0,
                sum_pLoaded_miles: 0,
                sum_pDefault_fuel: 0,
                sum_pEstimated_fuel: 0,
                sum_pEstimated_tolls: 0,
                sum_pMaintenance: 0,
                sum_pDepreciation: 0,
                weighted_pMainCriteriaNetDriverMargin: { sum: 0, totalWeight: 0 },
                weighted_pMainCriteria2CashFlow: { sum: 0, totalWeight: 0 },
                weighted_pDriverGross_percent: { sum: 0, totalWeight: 0 },
                weighted_pNet_percent: { sum: 0, totalWeight: 0 },
                weighted_pMargin_percent: { sum: 0, totalWeight: 0 },
            };
        }
        
        const team = acc[curr.dispatcherTeam];
        const weight = curr.numDrivers > 0 ? curr.numDrivers : 1;
        const numDriversForRecord = curr.numDrivers || 0;

        team.numDrivers += numDriversForRecord;
        team.numOOs += curr.numOOs || 0;
        team.numLOOs += curr.numLOOs || 0;
        (curr.driverNames || []).forEach(name => team.driverNames.add(name));
        team.dispatchers.add(curr.dispatcherName);

        // Correctly calculate TOTALS by multiplying per-driver-averages by the driver count for each record
        team.sum_pAll_miles += (curr.pAll_miles || 0) * numDriversForRecord;
        team.sum_pDriver_gross_dollar += (curr.pDriver_gross || 0) * numDriversForRecord;
        team.sum_pMargin_dollar += (curr.pMargin_dollar || 0) * numDriversForRecord;
        team.sum_pTotal_gross += (curr.pTotal_gross || 0) * numDriversForRecord;
        team.sum_pEstimated_net += (curr.pEstimated_net || 0) * numDriversForRecord;
        team.sum_pLoaded_miles += (curr.pLoaded_miles || 0) * numDriversForRecord;
        team.sum_pDefault_fuel += (curr.pDefault_fuel || 0) * numDriversForRecord;
        team.sum_pEstimated_fuel += (curr.pEstimated_fuel || 0) * numDriversForRecord;
        team.sum_pEstimated_tolls += (curr.pEstimated_tolls || 0) * numDriversForRecord;
        team.sum_pMaintenance += (curr.pMaintenance || 0) * numDriversForRecord;
        team.sum_pDepreciation += (curr.pDepreciation || 0) * numDriversForRecord;

        if (typeof curr.pMainCriteriaNetDriverMargin === 'number') {
            team.weighted_pMainCriteriaNetDriverMargin.sum += curr.pMainCriteriaNetDriverMargin * weight;
            team.weighted_pMainCriteriaNetDriverMargin.totalWeight += weight;
        }
        if (typeof curr.pMainCriteria2CashFlow === 'number') {
            team.weighted_pMainCriteria2CashFlow.sum += curr.pMainCriteria2CashFlow * weight;
            team.weighted_pMainCriteria2CashFlow.totalWeight += weight;
        }
        if (typeof curr.pDriverGross === 'number') {
            team.weighted_pDriverGross_percent.sum += curr.pDriverGross * weight;
            team.weighted_pDriverGross_percent.totalWeight += weight;
        }
        if (typeof curr.pNet === 'number') {
            team.weighted_pNet_percent.sum += curr.pNet * weight;
            team.weighted_pNet_percent.totalWeight += weight;
        }
        if (typeof curr.pMargin === 'number') {
            team.weighted_pMargin_percent.sum += curr.pMargin * weight;
            team.weighted_pMargin_percent.totalWeight += weight;
        }
        
        return acc;
    }, {});

    return Object.values(groupedByTeam).map(team => {
        const finalTeamData = { ...team };
        const totalDrivers = team.numDrivers;

        finalTeamData.numDispatchers = team.dispatchers.size;
        finalTeamData.driverNames = [...team.driverNames];
        
        // --- Per-Driver Averages (For display if needed, but not for team-wide ratios) ---
        finalTeamData['pAll_miles_current'] = totalDrivers > 0 ? team.sum_pAll_miles / totalDrivers : 0;
        finalTeamData['pDriver_gross_current'] = totalDrivers > 0 ? team.sum_pDriver_gross_dollar / totalDrivers : 0;
        finalTeamData['pMargin_dollar_current'] = totalDrivers > 0 ? team.sum_pMargin_dollar / totalDrivers : 0;
        finalTeamData['pTotal_gross_current'] = totalDrivers > 0 ? team.sum_pTotal_gross / totalDrivers : 0;
        finalTeamData['pEstimated_net_current'] = totalDrivers > 0 ? team.sum_pEstimated_net / totalDrivers : 0;
        
        // --- CORRECTED TEAM-WIDE RATIOS (calculated from true totals) ---
        finalTeamData['rpmAll_current'] = team.sum_pAll_miles > 0 ? team.sum_pTotal_gross / team.sum_pAll_miles : 0;
        finalTeamData['pDriver_rpm_current'] = team.sum_pLoaded_miles > 0 ? team.sum_pDriver_gross_dollar / team.sum_pLoaded_miles : 0;

        // --- CORRECTED WEIGHTED AVERAGES (for metrics that are already percentages) ---
        finalTeamData['pMargin_current'] = team.weighted_pMargin_percent.totalWeight > 0 ? team.weighted_pMargin_percent.sum / team.weighted_pMargin_percent.totalWeight : 0;
        finalTeamData['pNet_current'] = team.weighted_pNet_percent.totalWeight > 0 ? team.weighted_pNet_percent.sum / team.weighted_pNet_percent.totalWeight : 0;
        finalTeamData['pDriverGross_current'] = team.weighted_pDriverGross_percent.totalWeight > 0 ? team.weighted_pDriverGross_percent.sum / team.weighted_pDriverGross_percent.totalWeight : 0;
        
        const driverHappiness = team.weighted_pMainCriteriaNetDriverMargin.totalWeight > 0 ? team.weighted_pMainCriteriaNetDriverMargin.sum / team.weighted_pMainCriteriaNetDriverMargin.totalWeight : 0;
        const companyHappiness = team.weighted_pMainCriteria2CashFlow.totalWeight > 0 ? team.weighted_pMainCriteria2CashFlow.sum / team.weighted_pMainCriteria2CashFlow.totalWeight : 0;
        finalTeamData['pMainCriteriaNetDriverMargin_current'] = driverHappiness;
        finalTeamData['pMainCriteria2CashFlow_current'] = companyHappiness;
        finalTeamData['mainCriteria_current'] = (driverHappiness + companyHappiness) / 2;

        // Cleanup temporary sum properties
        Object.keys(finalTeamData).forEach(key => {
            if (key.startsWith('sum_') || key.startsWith('weighted_')) {
                delete finalTeamData[key];
            }
        });
        delete finalTeamData.dispatchers;

        return finalTeamData;
    });
};

export const calculateConsistentlyLowPerformers = () => {
    // Step 1: Define the 4-week window to determine activity.
    const allUniqueDates = [...new Set(appState.allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const selectedDateIndex = allUniqueDates.indexOf(appState.selectedDate);
    if (selectedDateIndex === -1) return [];
    const fourWeekDateStrings = allUniqueDates.slice(selectedDateIndex, selectedDateIndex + 4);

    // Step 2: Create a list of dispatchers/teams active in that 4-week window.
    const groupKey = appState.rankingMode === 'team' ? 'dispatcherTeam' : 'dispatcherName';
    const activeEntities = new Set(
        appState.allHistoricalData
            .filter(d => fourWeekDateStrings.includes(d.date.toISOString().split('T')[0]))
            .map(d => d[groupKey])
            .filter(Boolean)
    );

    const metricHistory = getFilteredDataByDriverType(appState.allHistoricalData).filter(d => d[appState.lowPerformanceMetric] !== undefined);
    const metricInfo = coreMetrics.find(m => m.id === appState.lowPerformanceMetric);
    if (!metricInfo) return [];

    let relevantHistoryForLowPerformers = metricHistory;
    if (appState.lowPerfHistoryLookback === 'specificWeeks' && appState.lowPerfHistorySpecificWeeks) {
        const uniqueDatesInHistory = [...new Set(metricHistory.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
        const relevantUniqueDates = uniqueDatesInHistory.slice(selectedDateIndex, selectedDateIndex + appState.lowPerfHistorySpecificWeeks);
        relevantHistoryForLowPerformers = metricHistory.filter(d => relevantUniqueDates.includes(d.date.toISOString().split('T')[0]));
    } else if (appState.lowPerfHistoryLookback === 'allTime') {
        const endDate = new Date(appState.selectedDate);
        relevantHistoryForLowPerformers = metricHistory.filter(d => d.date.getTime() <= endDate.getTime());
    }

    // Step 3: Pre-filter the history to ONLY include active entities before calculations.
    const activeEntityHistory = relevantHistoryForLowPerformers.filter(d => activeEntities.has(d[groupKey]));

    const entityDailyMetrics = activeEntityHistory.reduce((acc, curr) => {
        const key = curr[groupKey];
        if (!key) return acc;
        if (!acc[key]) {
            acc[key] = [];
        }
        const val = typeof curr[appState.lowPerformanceMetric] === 'number' && !isNaN(curr[appState.lowPerformanceMetric]) ? curr[appState.lowPerformanceMetric] : null;
        if (val !== null) {
            acc[key].push({ date: curr.date, value: val });
        }
        return acc;
    }, {});

    const lowPerformers = [];
    const lowPerformerThresholdFactor = appState.lowPerformerThreshold / 100;

    for (const entityName in entityDailyMetrics) {
        const dailyData = entityDailyMetrics[entityName].sort((a, b) => a.date.getTime() - b.date.getTime());
        const relevantDaysCount = dailyData.length;
        if (relevantDaysCount === 0) continue;

        let lowDaysCount = 0;
        dailyData.forEach(day => {
            const allMetricsForDay = appState.allHistoricalData
                .filter(d => d.date.getTime() === day.date.getTime() && typeof d[appState.lowPerformanceMetric] === 'number' && !isNaN(d[appState.lowPerformanceMetric]))
                .map(d => d[appState.lowPerformanceMetric]);
            if (allMetricsForDay.length === 0) return;

            const sortedMetrics = [...allMetricsForDay].sort((a, b) => a - b);
            let percentileValue;

            if (metricInfo.lowerIsWorse) {
                const percentileIndex = Math.floor(lowPerformerThresholdFactor * sortedMetrics.length);
                percentileValue = sortedMetrics[percentileIndex];
                if (day.value <= percentileValue) {
                    lowDaysCount++;
                }
            } else {
                const percentileIndex = Math.floor((1 - lowPerformerThresholdFactor) * sortedMetrics.length);
                percentileValue = sortedMetrics[percentileIndex];
                if (day.value >= percentileValue) {
                    lowDaysCount++;
                }
            }
        });
        
        const minDaysThresholdFactor = appState.minLowDaysThreshold / 100;
        const requiredLowDays = Math.ceil(relevantDaysCount * minDaysThresholdFactor);

        if (lowDaysCount >= requiredLowDays && lowDaysCount > 0) {
            const currentEntityData = appState.data.find(d => d.entityName === entityName);
            lowPerformers.push({
                id: `${entityName}-low-${appState.lowPerformanceMetric}`,
                name: entityName,
                lowDaysCount: lowDaysCount,
                totalDays: relevantDaysCount,
                currentValue: currentEntityData ? currentEntityData[`${appState.lowPerformanceMetric}_current`] : null,
                currentRank: appState.unfilteredRanks.get(entityName) || '-',
                metricLabel: metricInfo.label,
                unit: metricInfo.unit,
            });
        }
    }
    return lowPerformers.sort((a, b) => b.lowDaysCount - a.lowDaysCount);
};

export const calculatePerformanceDrops = () => {
   const metricInfo = coreMetrics.find(m => {
       const baseId = appState.deviationMetric.replace('_4wkAvg', '');
       return m.id === baseId;
   }); 
   if (!metricInfo) return [];

   const drops = [];
   const dataToUse = getFilteredDataByDriverType(appState.allHistoricalData);
   
   const groupKey = appState.rankingMode === 'team' ? 'dispatcherTeam' : 'dispatcherName';
   const groupedByEntity = dataToUse.reduce((acc, curr) => {
       const key = curr[groupKey];
       if (!key) return acc;
       if (!acc[key]) {
           acc[key] = [];
       }
       acc[key].push(curr);
       return acc;
   }, {});

   const endDate = new Date(appState.selectedDate);

   for (const entityName in groupedByEntity) {
       const entityHistory = groupedByEntity[entityName].sort((a, b) => a.date.getTime() - b.date.getTime()); 
       
       if (entityHistory.length < 4) {
           continue;
       }

       const currentEntityProcessedData = appState.data.find(d => d.entityName === entityName);
       if (!currentEntityProcessedData) {
           continue;
       }
       
       const currentMetricKey = appState.deviationMetric.endsWith('_4wkAvg') ?
                                appState.deviationMetric :
                                `${appState.deviationMetric}_current`;
       const currentDayValue = currentEntityProcessedData[currentMetricKey];
       const currentRank = currentEntityProcessedData._sortRank;


       if (typeof currentDayValue !== 'number' || isNaN(currentDayValue) || currentDayValue === null) {
           continue;
       }

       let historyForAverage = [];
       const actualLastHistoricalDataPoint = entityHistory[entityHistory.length - 1]; 

       if (!actualLastHistoricalDataPoint) continue;

       if (appState.dropHistoryLookback === 'allTime') {
           historyForAverage = entityHistory.filter(d => d.date.getTime() < actualLastHistoricalDataPoint.date.getTime());
       } else if (appState.dropHistoryLookback === 'specificWeeks' && appState.dropHistorySpecificWeeks) {
           const uniqueDatesInHistory = [...new Set(entityHistory.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
           const currentDataDateString = actualLastHistoricalDataPoint.date.toISOString().split('T')[0];
           const currentDataDateIndex = uniqueDatesInHistory.indexOf(currentDataDateString);
           
           if (currentDataDateIndex === -1) { 
               continue;
           }

           const relevantUniqueDatesForAverage = uniqueDatesInHistory.slice(currentDataDateIndex + 1, currentDataDateIndex + 1 + appState.dropHistorySpecificWeeks);
           
           historyForAverage = entityHistory.filter(d => relevantUniqueDatesForAverage.includes(d.date.toISOString().split('T')[0]));

       } else {
           historyForAverage = entityHistory.filter(d => d.date.getTime() < actualLastHistoricalDataPoint.date.getTime());
       }

       const baseMetricIdForAverage = appState.deviationMetric.replace('_4wkAvg', '');
       const numericHistoricalValues = historyForAverage.map(d => d[baseMetricIdForAverage]).filter(val => typeof val === 'number' && !isNaN(val));

       if (numericHistoricalValues.length === 0) {
           continue; 
       }

       const averageValue = numericHistoricalValues.reduce((sum, val) => sum + val, 0) / numericHistoricalValues.length;

       let deviation = 0;
       if (averageValue !== 0) {
           deviation = ((currentDayValue - averageValue) / averageValue) * 100;
       }

       if (metricInfo.lowerIsWorse) {
           if (deviation <= -appState.deviationThreshold) {
               drops.push({
                   id: `${entityName}-drop-${appState.deviationMetric}`,
                   name: entityName,
                   currentValue: currentDayValue,
                   averageValue: averageValue,
                   deviation: deviation,
                   metricLabel: metricInfo.label,
                   unit: metricInfo.unit,
                   currentRank: currentRank,
               });
           }
       } else {
           if (deviation >= appState.deviationThreshold) {
               drops.push({
                   id: `${entityName}-drop-${appState.deviationMetric}`,
                   name: entityName,
                   currentValue: currentDayValue,
                   averageValue: averageValue,
                   deviation: deviation,
                   metricLabel: metricInfo.label,
                   unit: metricInfo.unit,
                   currentRank: currentRank,
               });
           }
       }
   }
   return drops.sort((a, b) => {
       const currentMetricInfo = coreMetrics.find(m => {
           const baseId = appState.deviationMetric.replace('_4wkAvg', '');
           return m.id === baseId;
       });
       if (currentMetricInfo && currentMetricInfo.lowerIsWorse) {
           return a.deviation - b.deviation;
       } else {
           return b.deviation - a.deviation;
       }
   });
};

export const calculateTrendingData = () => {
    const activeEntities = new Set(appState.data.map(d => d.entityName));
    const groupKey = appState.rankingMode === 'team' ? 'dispatcherTeam' : 'dispatcherName';
    const allTrends = [];

    const uniqueDates = [...new Set(appState.allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const selectedDateIndex = uniqueDates.indexOf(appState.selectedDate);

    const totalTrendPeriod = appState.trendOlderPeriod + appState.trendRecentPeriod;

    if (selectedDateIndex === -1 || (selectedDateIndex + totalTrendPeriod) > uniqueDates.length) {
        return { trendingUp: [], trendingDown: [] };
    }

    const trendDateStrings = uniqueDates.slice(selectedDateIndex, selectedDateIndex + totalTrendPeriod);
    const historicalDataForTrend = appState.allHistoricalData.filter(d => trendDateStrings.includes(d.date.toISOString().split('T')[0]));

    const metricsToAnalyze = appState.trendAnalysisMetric === 'overall' ? coreMetrics : [coreMetrics.find(m => m.id === appState.trendAnalysisMetric)];

    activeEntities.forEach(entityName => {
        let entityTrends = [];

        metricsToAnalyze.forEach(metric => {
            if (!metric) return;

            const entityMetricHistory = historicalDataForTrend
                .filter(d => d[groupKey] === entityName && typeof d[metric.id] === 'number' && !isNaN(d[metric.id]))
                .map(d => ({ date: d.date.toISOString().split('T')[0], value: d[metric.id] }));

            const olderPeriodDates = trendDateStrings.slice(appState.trendRecentPeriod, totalTrendPeriod);
            const recentPeriodDates = trendDateStrings.slice(0, appState.trendRecentPeriod);

            const olderValues = entityMetricHistory.filter(d => olderPeriodDates.includes(d.date)).map(d => d.value);
            const recentValues = entityMetricHistory.filter(d => recentPeriodDates.includes(d.date)).map(d => d.value);

            if (olderValues.length < appState.trendMinOlderStubs || recentValues.length < appState.trendMinRecentStubs) {
                return;
            }

            const avgOlder = olderValues.reduce((s, v) => s + v, 0) / olderValues.length;
            const avgRecent = recentValues.reduce((s, v) => s + v, 0) / recentValues.length;

            if (avgOlder === 0) return;

            const trendValue = avgRecent - avgOlder;
            const trendPercentage = (trendValue / avgOlder) * 100;

            if (Math.abs(trendPercentage) >= appState.trendSignificanceThreshold) {
                entityTrends.push({
                    metricId: metric.id,
                    metricLabel: metric.label,
                    unit: metric.unit,
                    trendValue,
                    trendPercentage
                });
            }
        });

        if (entityTrends.length > 0) {
            const mostSignificantTrend = entityTrends.sort((a, b) => Math.abs(b.trendPercentage) - Math.abs(a.trendPercentage))[0];
            allTrends.push({
                name: entityName,
                ...mostSignificantTrend
            });
        }
    });

    const trendingUp = allTrends.filter(t => t.trendPercentage > 0).sort((a,b) => b.trendPercentage - a.trendPercentage);
    const trendingDown = allTrends.filter(t => t.trendPercentage < 0).sort((a,b) => a.trendPercentage - b.trendPercentage);

    return { trendingUp, trendingDown };
};

export const calculateBumpChartData = () => {
    const bumpMetricInfo = coreMetrics.find(m => m.id === appState.bumpMetric.replace('_4wkAvg', '')) || coreMetrics.find(m => m.id === appState.bumpMetric);
    if (!bumpMetricInfo) return [];

    const dataToUse = getFilteredDataByDriverType(appState.allHistoricalData);

    const uniqueDates = [...new Set(dataToUse.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const selectedDateIndex = uniqueDates.indexOf(appState.selectedDate);
    const relevantDateStrings = uniqueDates.slice(selectedDateIndex, selectedDateIndex + appState.weeksBack);

    const relevantHistory = dataToUse.filter(d => {
        return relevantDateStrings.includes(d.date.toISOString().split('T')[0]);
    });

    const groupedByDate = relevantHistory.reduce((acc, curr) => {
        const dateKey = curr.date.toISOString().split('T')[0];
        if (!acc[dateKey]) {
            acc[dateKey] = { date: new Date(dateKey), entries: [] };
        }
        acc[dateKey].entries.push(curr);
        return acc;
    }, {});

    const dataWithRanks = Object.values(groupedByDate).map(dayData => {
        let dailyMetrics;
        const dateKey = dayData.date.toISOString().split('T')[0];

        if (appState.bumpMetric.endsWith('_4wkAvg')) {
            const precomputedData = appState.rankingMode === 'team'
                ? appState.precomputedTeam4WkAverages[dateKey]
                : appState.precomputedDispatcher4WkAverages[dateKey];
            dailyMetrics = precomputedData ? Object.entries(precomputedData).map(([entityName, avgData]) => ({
                name: entityName,
                value: avgData[appState.bumpMetric.replace('_4wkAvg', '')] ?? null
            })) : [];
        } else if (appState.rankingMode === 'team' && appState.bumpMetric.startsWith('rpmAll')) {
            const groupedByTeam = dayData.entries.reduce((acc, curr) => {
                if (!curr.dispatcherTeam) return acc;
                if (!acc[curr.dispatcherTeam]) {
                    acc[curr.dispatcherTeam] = { sum_pTotal_gross: 0, sum_pAll_miles: 0 };
                }
                const numDriversForRecord = curr.numDrivers || 0;
                acc[curr.dispatcherTeam].sum_pTotal_gross += (curr.pTotal_gross || 0) * numDriversForRecord;
                acc[curr.dispatcherTeam].sum_pAll_miles += (curr.pAll_miles || 0) * numDriversForRecord;
                return acc;
            }, {});
            dailyMetrics = Object.entries(groupedByTeam).map(([name, data]) => ({
                name,
                value: data.sum_pAll_miles > 0 ? data.sum_pTotal_gross / data.sum_pAll_miles : 0
            }));
        } else {
            const groupKey = appState.rankingMode === 'team' ? 'dispatcherTeam' : 'dispatcherName';
            const groupedEntities = dayData.entries.reduce((acc, curr) => {
                const key = curr[groupKey];
                if (!key) return acc;
                if (!acc[key]) {
                    acc[key] = { sum: 0, weight: 0 };
                }
                const weight = curr.numDrivers || 1;
                const metricValue = curr[appState.bumpMetric];
                if (typeof metricValue === 'number' && !isNaN(metricValue)) {
                    acc[key].sum += metricValue * weight;
                    acc[key].weight += weight;
                }
                return acc;
            }, {});
            dailyMetrics = Object.entries(groupedEntities).map(([name, data]) => ({
                name,
                value: data.weight > 0 ? data.sum / data.weight : null
            }));
        }

        const sortedDayEntries = dailyMetrics
            .filter(entry => typeof entry.value === 'number' && !isNaN(entry.value))
            .sort((a, b) => {
                if (bumpMetricInfo && bumpMetricInfo.lowerIsWorse === false) {
                    return a.value - b.value;
                }
                return b.value - a.value;
            });

        const ranksAndValues = { date: dayData.date };
        sortedDayEntries.forEach((entry, index) => {
            ranksAndValues[entry.name] = {
                rank: index + 1,
                value: entry.value
            };
        });
        return ranksAndValues;
    }).sort((a, b) => a.date.getTime() - b.date.getTime());

    return dataWithRanks;
};

export const getFilteredBumpChartEntityNames = () => {
    let filteredBumpChartEntityNames;
    if (appState.selectedBumpEntities.length === 0 && appState.data.length > 0) {
        filteredBumpChartEntityNames = [...appState.data]
            .sort((a, b) => {
                const aMainCriteria = typeof a.mainCriteria_current === 'number' && !isNaN(a.mainCriteria_current) ? a.mainCriteria_current : -Infinity; 
                const bMainCriteria = typeof b.mainCriteria_current === 'number' && !isNaN(b.mainCriteria_current) ? b.mainCriteria_current : -Infinity; 
                return bMainCriteria - aMainCriteria;
            })
            .slice(0, 5)
            .map(d => d.entityName);
    } else {
        const entityList = appState.rankingMode === 'team' ? appState.allTeamNames : appState.allDispatcherNames;
        filteredBumpChartEntityNames = entityList.filter(name => appState.selectedBumpEntities.includes(name));
    }
    return filteredBumpChartEntityNames;
};

export const getIndividualEntityChartData = (entityName) => {
    const { rankingMode, driverTypeFilter } = appState;
    const cachedData = appState.precomputationCache[rankingMode]?.[driverTypeFilter];

    if (cachedData) {
        return cachedData.get(entityName) || [];
    }
    
    // Fallback in case cache isn't ready.
    return [];
};


export const getCompanyOrAllTeamsCriteriaHistory = (entityName, entityType, allHistoricalData, numWeeks = 8) => {
    const uniqueDates = [...new Set(allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const relevantDates = uniqueDates.slice(0, numWeeks).sort();
    
    return relevantDates.map(dateString => {
        let relevantData = allHistoricalData.filter(d => d.date.toISOString().split('T')[0] === dateString);
        
        if (entityType === 'company') {
            relevantData = relevantData.filter(d => d.company_name === entityName);
        } else if (entityType === 'team') {
            relevantData = relevantData.filter(d => d.dispatcherTeam === entityName);
        }

        const criteriaValues = relevantData.map(d => d.mainCriteria).filter(v => typeof v === 'number' && !isNaN(v));
        
        if (criteriaValues.length === 0) {
            return { date: new Date(dateString), value: null };
        }
        
        const avgCriteria = criteriaValues.reduce((sum, v) => sum + v, 0) / criteriaValues.length;
        return { date: new Date(dateString), value: avgCriteria };
    });
};

export const getTeamRankHistory = (teamName, allHistoricalData, numWeeks = 8) => {
    const uniqueDates = [...new Set(allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const relevantDates = uniqueDates.slice(0, numWeeks).sort();

    const rankHistory = relevantDates.map(dateString => {
        const dataForDate = allHistoricalData.filter(d => d.date.toISOString().split('T')[0] === dateString);
        
        // --- FIX: Use the same team aggregation logic as the main table ---
        const aggregatedTeamsForDate = aggregateTeamData(dataForDate);

        const rankedData = aggregatedTeamsForDate
            .sort((a, b) => (b.mainCriteria_current || 0) - (a.mainCriteria_current || 0));

        const rank = rankedData.findIndex(d => d.entityName === teamName) + 1;
        const teamDataForDate = rankedData.find(d => d.entityName === teamName);

        return {
            date: new Date(dateString),
            value: rank > 0 ? rank : null,
            criteria: teamDataForDate ? teamDataForDate.mainCriteria_current : null
        };
    });
    return rankHistory;
};
