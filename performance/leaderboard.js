import { UpdatesUI } from './updates.js';
import { AllStarUI } from './all_star.js';

export const LeaderboardUI = {
    state: {
        mode: 'dispatcher', 
        isOpen: false
    },
    mainUI: null,

    init: function(context) {
        this.mainUI = context;
    },

    getCurrentWeek: function() {
        const now = new Date();
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        const daysToFirstThursday = (4 - startOfYear.getDay() + 7) % 7;
        const firstPayrollDate = new Date(now.getFullYear(), 0, 1 + daysToFirstThursday + 7);

        if (now < firstPayrollDate) return 1;

        const diffTime = Math.abs(now - firstPayrollDate);
        const currentWeek = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 7)) + 1;

        return currentWeek;
    },

    renderTriggerBtn: function(context) {
        this.init(context);
        const container = document.querySelector('.dota-view');
        if (!container) return;
        if (document.getElementById('lb-trigger')) return;

        const btn = document.createElement('div');
        btn.id = 'lb-trigger';
        btn.className = 'lb-trigger-btn';
        btn.innerHTML = `
            <div class="lb-podium-icon">
                <div class="lb-bar second"></div>
                <div class="lb-bar first"></div>
                <div class="lb-bar third"></div>
            </div>
            <div class="lb-label">LEADERBOARDS</div>
        `;
        
        btn.onclick = () => this.openModal();
        container.appendChild(btn);
    },

    openModal: function() {
        this.state.isOpen = true;
        const week = this.getCurrentWeek();
        
        const modal = document.createElement('div');
        modal.className = 'lb-modal-overlay';
        modal.innerHTML = `
            <div class="lb-modal-content">
                <button class="lb-close-btn">✕</button>
                <div class="lb-layout">
                    <div class="lb-main">
                        <div class="lb-header">
                            <div class="lb-header-left">
                                <h1 class="lb-title">DISPATCHER LEADERBOARD</h1>
                                <div class="lb-subtitle">WEEK ${week} • ${new Date().getFullYear()}</div>
                            </div>
                            <div class="lb-toggles">
                                <button class="lb-toggle ${this.state.mode === 'dispatcher' ? 'active' : ''}" id="mode-dsp">DISPATCHERS</button>
                                <button class="lb-toggle ${this.state.mode === 'team' ? 'active' : ''}" id="mode-team">TEAMS</button>
                            </div>
                        </div>
                        <div class="lb-table-wrapper" id="lb-table-container"></div>
                    </div>
                    <div class="lb-sidebar">
                        <div class="lb-sidebar-section top">
                            <button class="lb-allstar-btn" id="open-allstar-btn">
                                <div class="lb-headset-bg">
                                    <svg viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M12 1a9 9 0 0 0-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h4v1h-7v2h6c1.66 0 3-1.34 3-3V10a9 9 0 0 0-9-9z"/>
                                    </svg>
                                </div>
                                <span class="as-icon">★</span> 
                                <span style="position: relative; z-index: 2;">VIEW ALL-STAR TEAM</span>
                            </button>
                        </div>
                        <div class="lb-sidebar-section bottom">
                            <div class="lb-sb-header" style="display: flex; align-items: center; gap: 8px;">
                                WEEKLY UPDATES
                                <style>
                                    .lb-info-tooltip { position: relative; display: flex; align-items: center; cursor: help; }
                                    .lb-info-tooltip:hover::after {
                                        content: attr(data-tooltip);
                                        position: absolute;
                                        bottom: 100%;
                                        left: 50%;
                                        transform: translateX(-50%) translateY(-10px);
                                        background: #1f2937;
                                        border: 1px solid #4b5563;
                                        color: #e5e7eb;
                                        padding: 10px 14px;
                                        border-radius: 6px;
                                        font-size: 12px;
                                        line-height: 1.4;
                                        font-weight: 500;
                                        white-space: normal;
                                        width: 220px;
                                        text-align: center;
                                        z-index: 10001;
                                        box-shadow: 0 10px 25px rgba(0,0,0,0.8);
                                        pointer-events: none;
                                        text-transform: none;
                                        letter-spacing: normal;
                                    }
                                </style>
                                <div class="lb-info-tooltip" data-tooltip="Displays major performance changes (Risk/Rise) compared to the previous week.">
                                    <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; fill: #6b7280; opacity: 0.7;">
                                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                                    </svg>
                                </div>
                            </div>
                            <div id="lb-updates-content"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        
        requestAnimationFrame(() => modal.classList.add('active'));

        modal.querySelector('.lb-close-btn').onclick = () => this.closeModal(modal);
        document.getElementById('mode-dsp').onclick = () => this.switchMode('dispatcher');
        document.getElementById('mode-team').onclick = () => this.switchMode('team');
        
       const allStarBtn = document.getElementById('open-allstar-btn');
        if (allStarBtn) {
            allStarBtn.onclick = () => {
                const ui = (typeof AllStarUI !== 'undefined' ? AllStarUI : window.AllStarUI);
                if (ui) {
                    ui.mainUI = this.mainUI;
                    ui.openModal();
                } else {
                    console.error("AllStarUI is not loaded.");
                }
            };
        }

       this.renderTable();
        UpdatesUI.render('lb-updates-content', this.mainUI.state.dispatchers, this.mainUI.state.stats, this.mainUI.state.prevStats, week);
    },

    closeModal: function(modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 300);
        this.state.isOpen = false;
    },

    switchMode: function(mode) {
        this.state.mode = mode;
        document.getElementById('mode-dsp').className = `lb-toggle ${mode === 'dispatcher' ? 'active' : ''}`;
        document.getElementById('mode-team').className = `lb-toggle ${mode === 'team' ? 'active' : ''}`;
        
        const titleEl = document.querySelector('.lb-title');
        if (titleEl) {
            titleEl.textContent = mode === 'dispatcher' ? 'DISPATCHER LEADERBOARD' : 'DISPATCHER TEAM LEADERBOARD';
        }

        this.renderTable();
    },

    getRankChange: function(d, currentRank, prevMap) {
        if (!prevMap || !prevMap[d.id]) return `<span class="rnk-dash">-</span>`;
        const prevRank = prevMap[d.id];
        const diff = prevRank - currentRank;
        
        if (diff === 0) return `<span class="rnk-dash">-</span>`;
        if (diff > 0) return `<span class="rnk-up">▲ ${diff}</span>`;
        return `<span class="rnk-down">▼ ${Math.abs(diff)}</span>`;
    },

    generatePrevRankMap: function(list) {
        const prevList = list.map(d => {
            return { id: d.id, prevRating: d.rating - (d.diff || 0) };
        }).sort((a,b) => b.prevRating - a.prevRating);
        
        const map = {};
        prevList.forEach((item, idx) => map[item.id] = idx + 1);
        return map;
    },

    getScoreColor: function(score) {
        const val = parseFloat(score) || 0;
        if (val >= 75) return 'val-gold-text';
        if (val >= 61) return 'val-silver-text';
        return 'val-bronze-text';
    },

    renderTable: function() {
        const container = document.getElementById('lb-table-container');
        if (!container) return;

        let data = [];
        const isDispatcherMode = this.state.mode === 'dispatcher';
        
        if (isDispatcherMode) {
            data = [...this.mainUI.state.dispatchers].sort((a,b) => b.rating - a.rating);
        } else {
            data = this.calculateTeamStats();
        }

        const prevMap = this.generatePrevRankMap(isDispatcherMode ? this.mainUI.state.dispatchers : data);

        let html = `<table class="lb-table">`;
        
        data.forEach((item, index) => {
            const rank = index + 1;
            
            let rankClass = '';
            if (rank === 1) rankClass = 'first-place';
            else if (rank === 2) rankClass = 'second-place';
            else if (rank === 3) rankClass = 'third-place';

            const rowClass = `lb-row ${rankClass} ${isDispatcherMode ? 'clickable' : ''}`;
            
            const stats = isDispatcherMode ? 
                (this.mainUI.state.stats[item.name.trim().toLowerCase()]?.scores || {}) : item.scores;

            const changeIndicator = this.getRankChange(item, rank, prevMap);

            const getCls = (val) => this.getScoreColor(val);

            html += `
                <tr class="${rowClass}" data-id="${item.id}">
                    <td class="col-rank">#${rank}</td>
                    <td class="col-photo">
                        <div class="lb-img-wrap ${rank === 1 ? 'glow' : ''}">
                            <img src="${item.photo || item.teamLogo}" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MCA1MCI+PHJlY3Qgd2lkdGg9IjUwIiBoZWlnaHQ9IjUwIiBmaWxsPSIjMzM0MTU1Ii8+PC9zdmc+'">
                        </div>
                    </td>
                    <td class="col-name">
                        <div class="lb-name-text">${item.name}</div>
                    </td>
                    <td class="col-team">
                        ${isDispatcherMode ? `<img src="${item.teamLogo}" class="lb-team-logo">` : ''}
                    </td>
                    <td class="col-stats">
                        <div class="lb-stat-group">
                            <div class="lbs-item"><span class="lbl">REV</span><span class="val ${getCls(stats.REV)}">${stats.REV || 0}</span></div>
                            <div class="lbs-item"><span class="lbl">VEL</span><span class="val ${getCls(stats.VEL)}">${stats.VEL || 0}</span></div>
                            <div class="lbs-item"><span class="lbl">EFF</span><span class="val ${getCls(stats.EFF)}">${stats.EFF || 0}</span></div>
                            <div class="lbs-item"><span class="lbl">OPS</span><span class="val ${getCls(stats.OPS)}">${stats.OPS || 0}</span></div>
                            <div class="lbs-item"><span class="lbl">HLT</span><span class="val ${getCls(stats.HLT)}">${stats.HLT || 0}</span></div>
                        </div>
                    </td>
                    <td class="col-rating">
                        <div class="lb-rating-box">
                            <span class="lb-rating-val">${item.rating}</span>
                        </div>
                    </td>
                    <td class="col-move">
                        ${changeIndicator}
                    </td>
                </tr>
            `;
        });

        html += `</table>`;
        container.innerHTML = html;

        if (isDispatcherMode) {
            container.querySelectorAll('tr.lb-row').forEach(row => {
                row.onclick = () => {
                    const id = row.getAttribute('data-id');
                    this.openDispatcherProfile(id);
                };
            });
        }
    },

    openDispatcherProfile: function(id) {
        if (typeof window.openDispatcherProfile === 'function') {
            window.openDispatcherProfile(id);
        } else if (this.mainUI && typeof this.mainUI.openDispatcherModal === 'function') {
            this.mainUI.openDispatcherModal(id);
        } else if (typeof window.DispatchersUI !== 'undefined') {
            window.DispatchersUI.openDispatcherModal(id);
        }
    },

    calculateTeamStats: function() {
        const teams = {};
        const TEAMS_TO_SPLIT = ['Miles', 'Uros', 'Agnius', 'Stefan'];

        this.mainUI.state.dispatchers.forEach(d => {
            if (!d.team) return;
            
            let teamName = d.team;
            if (TEAMS_TO_SPLIT.includes(teamName)) {
                if (d.companyGroup === 'SMJ') teamName += ' SMJ';
                else if (d.companyGroup === 'EBInfinity') teamName += ' EB Infinity';
                else if (d.companyGroup === 'AmongUs') teamName += ' AmongUs';
                else return;
            }

            if (!teams[teamName]) {
                teams[teamName] = { 
                    id: teamName,
                    name: teamName, 
                    teamLogo: d.teamLogo, 
                    count: 0, 
                    sumOverall: 0,
                    sumScores: { REV:0, VEL:0, EFF:0, OPS:0, HLT:0 },
                    sumPrev: 0
                };
            }
            const t = teams[teamName];
            t.count++;
            t.sumOverall += d.rating;
            t.sumPrev += (d.rating - (d.diff || 0));
            
            const s = this.mainUI.state.stats[d.name.trim().toLowerCase()]?.scores || {};
            ['REV','VEL','EFF','OPS','HLT'].forEach(k => t.sumScores[k] += (s[k] || 0));
        });

        return Object.values(teams).map(t => {
            const scores = {};
            Object.keys(t.sumScores).forEach(k => scores[k] = Math.round(t.sumScores[k] / t.count));
            const rating = Math.round(t.sumOverall / t.count);
            const prevRating = Math.round(t.sumPrev / t.count);

            return {
                id: t.id,
                name: t.name,
                photo: t.teamLogo, 
                teamLogo: t.teamLogo,
                rating: rating,
                diff: rating - prevRating,
                scores: scores
            };
        }).sort((a,b) => b.rating - a.rating);
    }
};