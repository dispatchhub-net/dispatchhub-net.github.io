export const UpdatesUI = {
    calculateTrends: function(dispatchers, stats, prevStats) {
        let maxRise = { id: null, val: -Infinity };
        let maxFall = { id: null, val: Infinity };
        
        let categoryDiffs = {
            EFF: { sum: 0, count: 0 },
            VEL: { sum: 0, count: 0 },
            OPS: { sum: 0, count: 0 },
            REV: { sum: 0, count: 0 },
            HLT: { sum: 0, count: 0 }
        };

        dispatchers.forEach(d => {
            const diff = d.diff || 0;

            if (maxRise.id === null || diff > maxRise.val) maxRise = { id: d.id, val: diff };
            if (maxFall.id === null || diff < maxFall.val) maxFall = { id: d.id, val: diff };

            const cleanName = d.name.trim().toLowerCase();
            const currentStats = stats[cleanName];
            const previousStats = prevStats ? prevStats[cleanName] : null;

            if (currentStats) {
                ['EFF', 'VEL', 'OPS', 'REV', 'HLT'].forEach(cat => {
                    const currentScore = (currentStats.scores && currentStats.scores[cat]) || 0;
                    const prevScore = (previousStats && previousStats.scores && previousStats.scores[cat]) !== undefined 
                                      ? previousStats.scores[cat] 
                                      : currentScore;
                    
                    const catChange = currentScore - prevScore;
                    
                    if (catChange !== 0) {
                        categoryDiffs[cat].sum += catChange;
                        categoryDiffs[cat].count++;
                    }
                });
            }
        });

        const catTrends = {};
        Object.keys(categoryDiffs).forEach(k => {
            const avg = categoryDiffs[k].count > 0 ? (categoryDiffs[k].sum / categoryDiffs[k].count) : 0;
            catTrends[k] = avg.toFixed(1);
        });

        if (maxRise.val === -Infinity) maxRise = { id: null, val: 0 };
        if (maxFall.val === Infinity) maxFall = { id: null, val: 0 };

        return { maxRise, maxFall, catTrends, hasData: true };
    },

    render: function(containerId, dispatchers, stats, prevStats, currentWeek) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const trends = this.calculateTrends(dispatchers, stats, prevStats);
        
        const riseD = dispatchers.find(d => d.id === trends.maxRise.id);
        const fallD = dispatchers.find(d => d.id === trends.maxFall.id);

        const prevWeek = currentWeek > 1 ? currentWeek - 1 : 1;

        let html = `
            <div class="lb-updates-header" style="margin-bottom: 15px; border-bottom: 1px solid #374151; padding-bottom: 10px;">
                <div style="font-size: 11px; font-weight: 800; color: #9ca3af; letter-spacing: 1px; text-transform: uppercase;">Performance Update</div>
                <div style="font-size: 14px; font-weight: 700; color: #f3f4f6;">WEEK ${currentWeek} <span style="color:#6b7280; font-size:12px; margin:0 4px;">vs</span> WEEK ${prevWeek}</div>
            </div>
            <div class="lb-updates-container">
        `;

        if (riseD && trends.maxRise.val > 0) {
            html += `
                <div class="update-card rise">
                    <div class="uc-header">BIGGEST IMPROVEMENT</div>
                    <div class="uc-body">
                        <img src="${riseD.photo}" class="uc-img" onerror="this.src='https://via.placeholder.com/50'">
                       <div class="uc-info">
                            <span class="uc-name">${riseD.name}</span>
                            <span class="uc-val text-green">▲ ${trends.maxRise.val.toFixed(0)} Points</span>
                        </div>
                    </div>
                </div>
            `;
        }

        if (fallD && trends.maxFall.val < 0) {
            html += `
                <div class="update-card fall">
                    <div class="uc-header">BIGGEST DROP</div>
                    <div class="uc-body">
                        <img src="${fallD.photo}" class="uc-img" onerror="this.src='https://via.placeholder.com/50'">
                       <div class="uc-info">
                            <span class="uc-name">${fallD.name}</span>
                            <span class="uc-val text-red">▼ ${Math.abs(trends.maxFall.val).toFixed(0)} Points</span>
                        </div>
                    </div>
                </div>
            `;
        }

        html += `<div class="cat-trends-grid">`;
        const catNames = { 'OPS': 'Operations', 'EFF': 'Efficiency', 'VEL': 'Velocity', 'REV': 'Financials', 'HLT': 'Health' };
        const catTooltips = {
            'OPS': 'Compliance, RC Entry, Calculator, Missing PPW, Tuesday Open, Overdue, Hidden Miles',
            'EFF': 'Expense Ratio, Weight, Net %, Gross %, Margin %',
            'VEL': 'Weekly RPM, Miles, Loads, RPM/Load, Trucks',
            'REV': 'Total Gross, Driver Gross, Margin, Load Rate, Net Pay, Consistency',
            'HLT': 'Retention, Tenure, Moves, Happiness, Wellness, Canceled, Balance'
        };

        html += `
        <style>
            .ctr-cat { position: relative; cursor: help; text-decoration: underline dotted #4b5563; text-underline-offset: 3px; }
            .ctr-cat:hover::after {
                content: attr(data-tooltip);
                position: absolute;
                bottom: 100%;
                left: 0;
                transform: translateY(-5px);
                background: #1f2937;
                border: 1px solid #4b5563;
                color: #e5e7eb;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 11px;
                font-weight: 500;
                white-space: normal;
                width: 180px;
                z-index: 9999;
                box-shadow: 0 4px 15px rgba(0,0,0,0.8);
                pointer-events: none;
                line-height: 1.4;
                text-transform: none;
                text-align: left;
            }
        </style>`;
        
        Object.entries(trends.catTrends).forEach(([key, val]) => {
            let num = parseFloat(val);
            const isPositive = num >= 0;
            const color = isPositive ? 'text-green' : 'text-red';
            const sign = isPositive ? 'better' : 'lower';
            const arrow = isPositive ? '▲' : '▼';
            
            html += `
                <div class="cat-trend-row">
                    <span class="ctr-cat" data-tooltip="${catTooltips[key]}">${catNames[key]}</span>
                    <span class="ctr-val ${color}">${Math.abs(num).toFixed(1)} ${arrow}</span>
                </div>
            `;
        });
        html += `</div></div>`;

        container.innerHTML = html;
    }
};